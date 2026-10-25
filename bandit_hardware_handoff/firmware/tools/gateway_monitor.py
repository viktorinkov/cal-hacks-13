"""Live view of the BandIt fleet through the gateway's serial port, plus a command prompt.
    pip install pyserial
    python gateway_monitor.py /dev/cu.usbmodem1101        (macOS; Windows: COM5)
Logs every JSON line to bandit_log_<time>.jsonl for calibration. Type gateway commands at the prompt, e.g.  cmd 0 exit 2
"""
import sys, json, time, threading, serial

port = sys.argv[1] if len(sys.argv) > 1 else '/dev/cu.usbmodem1101'
ser = serial.Serial(port, 115200, timeout=0.2)
log = open(time.strftime('bandit_log_%Y%m%d_%H%M%S.jsonl'), 'a')
STATE = ['IDLE', 'YELLOW', 'GUIDE', 'SOS', 'NEAR_SOS', 'PAY', 'PAID', 'CONNECT', 'IDENT', 'OFF']
fleet = {}

def reader():
    while True:
        line = ser.readline().decode(errors='replace').strip()
        if not line: continue
        log.write(line + '\n'); log.flush()
        try: d = json.loads(line)
        except Exception: print(line); continue
        if 'id' in d: d['seen'] = time.time(); fleet[d['id']] = d

def painter():
    while True:
        time.sleep(0.5)
        rows = []
        for i in sorted(fleet):
            d = fleet[i]; age = time.time() - d['seen']
            kind = {1: 'band', 2: 'station', 3: 'gateway'}.get(d.get('type'), '?')
            st = STATE[d['state']] if d.get('state', 99) < len(STATE) else d.get('state')
            flags = ''.join(f for f, m in (('S', 1), ('F', 2), ('P', 4), ('L', 8)) if d.get('flags', 0) & m)
            rows.append(f"{i:>4} {kind:<8} rssi {d.get('rssi'):>4}  neigh {d.get('neigh'):>2}  zone {d.get('zone'):>3}  bat {d.get('bat'):>3}  {st:<9} {flags:<4} {age:4.1f}s")
        sys.stdout.write('\x1b[2J\x1b[H' + 'BandIt fleet (S=SOS F=fall P=press L=lowbat)\n' + '\n'.join(rows) + '\n\ncmd> ')
        sys.stdout.flush()

threading.Thread(target=reader, daemon=True).start()
threading.Thread(target=painter, daemon=True).start()
while True:
    try: cmd = input()
    except EOFError: break
    if cmd.strip(): ser.write((cmd.strip() + '\n').encode())
