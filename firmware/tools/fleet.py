"""BandIt fleet table and serial helper for boards plugged into this laptop.

    python3 tools/fleet.py table                 ask every connected ESP32-C3 for "info" and print the whiteboard
                                                 table (id, MAC, hasMpu, hasMotor, fw). Every answer is appended
                                                 to logs/fleet.jsonl, so bands flashed earlier stay in the table.
    python3 tools/fleet.py send <port> <line>... send lines (e.g. "id 3" "save") and print the answers
    python3 tools/fleet.py targets               ports that are bands or blank (used by build.sh all-bands)
    python3 tools/fleet.py ports                 port and MAC of every connected ESP32-C3 (no serial traffic)

Needs pyserial (pip install pyserial). The C3's USB serial number is its MAC, so ports are told apart without
touching the boards; "table" and "send" open the port with default DTR/RTS, so nothing resets.
"""
import json
import os
import sys
import time

import serial
from serial.tools import list_ports

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, '..', 'logs', 'fleet.jsonl')
ESP_VID = 0x303A


def esp_ports():
    return sorted((p.device, (p.serial_number or '?').upper()) for p in list_ports.comports()
                  if p.vid == ESP_VID and p.device.startswith('/dev/cu.'))


def open_port(port):
    # Leave DTR/RTS alone. pyserial sets them one at a time, and DTR low with RTS high is the C3's reset request.
    return serial.Serial(port, 115200, timeout=0.05)


def converse(port, lines, wait=1.2, want=None):
    """Send lines, collect JSON answers for `wait` s (or until a line with key `want` arrives)."""
    out = []
    try:
        s = open_port(port)
    except (serial.SerialException, OSError) as e:
        return [{'err': str(e)}]
    with s:
        s.reset_input_buffer()
        for line in lines:
            s.write((line + '\n').encode())
            time.sleep(0.05)
        end, buf = time.time() + wait, b''
        while time.time() < end:
            buf += s.read(4096)
            while b'\n' in buf:
                raw, buf = buf.split(b'\n', 1)
                try:
                    d = json.loads(raw.decode(errors='replace').strip())
                except ValueError:
                    continue
                if want is None or want in d:
                    out.append(d)
                    if want is not None:
                        return out
    return out


def info(port):
    for attempt in range(2):
        got = converse(port, ['info'], wait=1.5, want='info')
        if got and 'info' in got[0]:
            return got[0]
    return None


def remember(d, port):
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, 'a') as f:
        f.write(json.dumps(dict(d, port=port, seen=time.strftime('%Y-%m-%d %H:%M:%S'))) + '\n')


def table():
    known = {}
    if os.path.exists(LOG):
        for line in open(LOG):
            try:
                d = json.loads(line)
                known[d['mac']] = dict(d, port='-')
            except (ValueError, KeyError):
                pass
    for port, mac in esp_ports():
        d = info(port)
        if d is None:
            known[mac] = {'info': 'no answer', 'mac': mac, 'port': port}
            continue
        remember(d, port)
        known[d.get('mac', mac)] = dict(d, port=port)
    rows = sorted(known.values(), key=lambda d: ({'band': 0, 'station': 1, 'gateway': 2}.get(d.get('info'), 3), d.get('id', 0)))
    print(f"{'role':<9}{'id':>4}  {'mac':<18} {'mpu':>3} {'motor':>5}  {'fw':<22} port")
    for d in rows:
        yesno = lambda k: '' if k not in d else ('yes' if d[k] else 'no')
        print(f"{d.get('info', '?'):<9}{d.get('id', ''):>4}  {d.get('mac', ''):<18} {yesno('hasMpu'):>3} "
              f"{yesno('hasMotor'):>5}  {d.get('fw', ''):<22} {d.get('port')}")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'table'
    if cmd == 'ports':
        for port, mac in esp_ports():
            print(port, mac)
    elif cmd == 'table':
        table()
    elif cmd == 'targets':
        for port, mac in esp_ports():
            d = info(port)
            if d is None or d.get('info') == 'band':
                print(port)
    elif cmd == 'send' and len(sys.argv) >= 4:
        for d in converse(sys.argv[2], sys.argv[3:], wait=1.5):
            print(json.dumps(d))
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == '__main__':
    main()
