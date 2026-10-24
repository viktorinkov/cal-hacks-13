"""Live view of the BandIt fleet through the gateway's serial port, plus a command prompt.

    python3 tools/gateway_monitor.py [port] [--label spread]

port defaults to the connected board that answers "info" as the gateway. Every line from the gateway is logged
unchanged to logs/bandit_<label>_<time>.jsonl (calibrate.py reads these). At the prompt:
    cmd <target> <name> [arg] [arg2]     sent to the gateway, e.g. cmd 0 exit 2, cmd 3 pay, cmd 0 thresh 3 5
    info                                 the gateway's identity line
    label <name>                         writes {"label":"<name>","wall":<unix time>} into the log (marks a run)
    quit
Needs pyserial (pip install pyserial).
"""
import json
import os
import sys
import threading
import time

import serial

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fleet  # noqa: E402

STATE = ['IDLE', 'YELLOW', 'GUIDE', 'SOS', 'NEAR_SOS', 'PAY', 'PAID', 'CONNECT', 'IDENT', 'OFF', 'FIND', 'FOUND_ME']
FLAGS = (('S', 1), ('F', 2), ('P', 4), ('L', 8), ('M', 16), ('V', 32))
EXITS = ['-', 'blue', 'magenta', 'cyan', 'white', 'orange', 'violet']


def find_gateway():
    for port, _ in fleet.esp_ports():
        d = fleet.info(port)
        if d and d.get('info') == 'gateway':
            return port
    sys.exit('no gateway found; pass the port')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    label = 'run'
    if '--label' in sys.argv:
        label = sys.argv[sys.argv.index('--label') + 1]
        args = [a for a in args if a != label]
    port = args[0] if args else find_gateway()
    ser = serial.Serial(port, 115200, timeout=0.2)
    logdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'logs')
    os.makedirs(logdir, exist_ok=True)
    logpath = os.path.join(logdir, time.strftime(f'bandit_{label}_%Y%m%d_%H%M%S.jsonl'))
    log = open(logpath, 'a')
    lock = threading.Lock()
    bands, stations, heard, notes = {}, {}, {}, []

    def write_log(line):
        with lock:
            log.write(line + '\n')
            log.flush()

    def reader():
        buf, synced = b'', False
        ser.reset_input_buffer()
        while True:
            buf += ser.read(4096)
            if not synced:   # the port opened mid-line: drop the fragment before the first newline
                if b'\n' not in buf:
                    continue
                buf, synced = buf.split(b'\n', 1)[1], True
            while b'\n' in buf:
                raw, buf = buf.split(b'\n', 1)
                line = raw.decode(errors='replace').strip()
                if not line:
                    continue
                write_log(line)
                try:
                    d = json.loads(line)
                except ValueError:
                    notes.append(line)
                    continue
                d['seen'] = time.time()
                t = d.get('type')
                if t == 1:
                    bands[d['id']] = d
                elif t == 2:
                    stations[d['id']] = d
                elif t == 4:
                    heard[d['id']] = d
                elif t != 3:
                    notes.append(line)
                del notes[:-6]

    def painter():
        while True:
            time.sleep(0.5)
            now = time.time()
            out = [f'BandIt fleet via {port}   log {os.path.basename(logpath)}   flags S=SOS F=fall P=press L=lowbat M=mpu V=motor',
                   ' id  rssi neigh zone  bat state     flags  find  age  heard (id:rssi)']
            for i in sorted(bands):
                d = bands[i]
                st = STATE[d['state']] if d['state'] < len(STATE) else d['state']
                fl = ''.join(c for c, m in FLAGS if d['flags'] & m)
                h = heard.get(i, {}).get('heard', [])
                hs = ' '.join(f'{a}:{b}' for a, b in h[:8])
                out.append(f"{i:>3} {d['rssi']:>5} {d['neigh']:>5} {d['zone']:>4} {d['bat']:>4} {st:<9} {fl:<6} {d.get('find', 0):>4} "
                           f"{now - d['seen']:4.1f}s  {hs}")
            for i in sorted(stations):
                d = stations[i]
                c = d['state']
                out.append(f"{i:>3} {d['rssi']:>5}  station exit {c} ({EXITS[c] if c < len(EXITS) else '?'})  {now - d['seen']:4.1f}s")
            out += [''] + notes[-6:] + ['', 'cmd> ']
            sys.stdout.write('\x1b[2J\x1b[H' + '\n'.join(out))
            sys.stdout.flush()

    threading.Thread(target=reader, daemon=True).start()
    if sys.stdout.isatty():
        threading.Thread(target=painter, daemon=True).start()
    while True:
        try:
            cmd = input().strip()
        except EOFError:
            break
        if not cmd:
            continue
        if cmd == 'quit':
            break
        if cmd.startswith('label '):
            write_log(json.dumps({'label': cmd[6:].strip(), 'wall': round(time.time(), 3)}, separators=(',', ':')))
            notes.append(f'label {cmd[6:].strip()}')
            continue
        ser.write((cmd + '\n').encode())
    time.sleep(0.3)
    log.close()


if __name__ == '__main__':
    main()
