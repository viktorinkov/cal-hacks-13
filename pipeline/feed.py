import argparse
import glob
import hashlib
import json
import os
import select
import signal
import sys
import threading
import time
import tty
from datetime import datetime, timezone

from elastic import DATA, Elastic

STATIONS = [101, 102, 103, 104, 105]
USAGE = """record the gateway with wall-clock time, and load it into Elastic

  python3 pipeline/feed.py record --port /dev/cu.usbmodemXXXX --session calhacks [--upload] [--mirror]
  python3 pipeline/feed.py upload pipeline/data/radio_calhacks_*.jsonl

record writes pipeline/data/radio_<session>_<time>.jsonl, one {"wall","ts","session","line"} per gateway line:
wall is when the laptop read it, ts is when the gateway heard it (its uptime anchored to the laptop clock).
--upload also sends to Elastic every 2 s. --mirror opens a pseudo-terminal that carries the same lines and
passes commands back to the gateway; point the SpacetimeDB bridge or gateway_monitor at the printed path.
upload sends recorded files afterwards; re-uploading a file does not create duplicates."""


class GatewayClock:
    def __init__(self):
        self.base = None
        self.last_t = None

    def stamp(self, t, wall_ms):
        if not isinstance(t, int):
            return wall_ms
        if self.last_t is not None and t < self.last_t - 1000:
            self.base = None
        self.last_t = t
        if self.base is None or wall_ms - t < self.base:
            self.base = wall_ms - t
        return t + self.base


def iso_ms(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def to_doc(rec):
    raw, wall, session = rec['line'], rec.get('ts', rec['wall']), rec.get('session', 'run')
    doc_id = hashlib.sha1(f'{wall}|{raw}'.encode()).hexdigest()[:24]
    try:
        d = json.loads(raw)
    except ValueError:
        return 'gateway', doc_id, {'@timestamp': wall, 'session': session, 'event': 'text', 'raw': raw}
    base = {'@timestamp': wall, 'session': session}
    t = d.get('type')
    if t == 1:
        f = d.get('flags', 0)
        return 'radio', doc_id, dict(base, kind='band', id=d['id'], gateway_t=d.get('t'), rssi_gateway=d.get('rssi'),
                                     flags=f, sos=bool(f & 1), fall=bool(f & 2), pressed=bool(f & 4),
                                     neigh=d.get('neigh'), zone=d.get('zone'), bat=d.get('bat'), state=d.get('state'),
                                     seq=d.get('seq'), find=d.get('find'))
    if t == 2:
        return 'radio', doc_id, dict(base, kind='station', id=d['id'], gateway_t=d.get('t'),
                                     rssi_gateway=d.get('rssi'), exit_colour=d.get('state'), seq=d.get('seq'))
    if t == 4:
        heard = d.get('heard', [])
        stations = {str(i): r for i, r in heard if i >= 101}
        return 'heard', doc_id, dict(base, id=d['id'], gateway_t=d.get('t'), rssi_gateway=d.get('rssi'),
                                     neighbours=[{'id': i, 'rssi': r} for i, r in heard if i <= 99],
                                     stations=stations,
                                     station_vector=[float(stations.get(str(s), -100)) for s in STATIONS])
    if t == 3:
        return None
    event = next((k for k in ('gateway', 'info', 'ack', 'err') if k in d), 'other')
    return 'gateway', doc_id, dict(base, event=event, raw=raw)


class Uploader:
    def __init__(self, es):
        self.es, self.queue, self.lock, self.sent = es, [], threading.Lock(), 0

    def add(self, rec):
        doc = to_doc(rec)
        if doc:
            with self.lock:
                self.queue.append(doc)

    def flush(self):
        with self.lock:
            batch, self.queue = self.queue, []
        by_kind = {}
        for kind, doc_id, doc in batch:
            by_kind.setdefault(kind, []).append((doc_id, doc))
        try:
            for kind, docs in by_kind.items():
                for i in range(0, len(docs), 2000):
                    self.sent += self.es.bulk(kind, docs[i:i + 2000])
        except Exception as e:
            sys.stderr.write(f'upload failed, the local file keeps everything: {e}\n')

    def run(self):
        while True:
            time.sleep(2)
            self.flush()


class Mirror:
    def __init__(self, port):
        self.port = port
        self.master, self.slave = os.openpty()
        tty.setraw(self.master)
        tty.setraw(self.slave)
        os.set_blocking(self.master, False)
        self.pending = b''
        self.path = os.ttyname(self.slave)
        threading.Thread(target=self.commands, daemon=True).start()

    def send(self, data):
        if len(self.pending) > 65536:
            return
        self.pending += data
        while self.pending:
            try:
                n = os.write(self.master, self.pending)
            except (BlockingIOError, OSError):
                return
            self.pending = self.pending[n:]

    def commands(self):
        while True:
            r, _, _ = select.select([self.master], [], [], 0.2)
            if r:
                try:
                    data = os.read(self.master, 1024)
                except OSError:
                    continue
                if data:
                    self.port.write(data)


def stop(*_):
    raise KeyboardInterrupt


def record(args):
    import serial
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    os.makedirs(DATA, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    path = os.path.join(DATA, f'radio_{args.session}_{stamp}.jsonl')
    port = serial.Serial(args.port, 115200, timeout=0.2)
    uploader = None
    if args.upload:
        uploader = Uploader(Elastic(args.prefix))
        threading.Thread(target=uploader.run, daemon=True).start()
    mirror = Mirror(port) if args.mirror else None
    if mirror:
        sys.stderr.write(f'mirror: {mirror.path}\n')
    sys.stderr.write(f'recording {args.port} -> {path}\n')
    out = open(path, 'a', buffering=1)
    clock = GatewayClock()
    drain_until = time.time() + 1.0
    buf, synced, lines, last = b'', False, 0, time.time()
    port.reset_input_buffer()
    try:
        while True:
            buf += port.read(4096)
            if time.time() < drain_until:
                buf = b''
                continue
            if not synced:
                if b'\n' not in buf:
                    continue
                buf, synced = buf.split(b'\n', 1)[1], True
            while b'\n' in buf:
                raw, buf = buf.split(b'\n', 1)
                if mirror:
                    mirror.send(raw + b'\n')
                text = raw.decode(errors='replace').strip()
                if not text:
                    continue
                wall_ms = time.time() * 1000
                try:
                    t = json.loads(text).get('t')
                except (ValueError, AttributeError):
                    t = None
                rec = {'wall': iso_ms(wall_ms), 'ts': iso_ms(clock.stamp(t, wall_ms)), 'session': args.session,
                       'line': text}
                out.write(json.dumps(rec, separators=(',', ':')) + '\n')
                lines += 1
                if uploader:
                    uploader.add(rec)
            if time.time() - last >= 10:
                last = time.time()
                sent = f', {uploader.sent} uploaded' if uploader else ''
                sys.stderr.write(f'{lines} lines recorded{sent}\n')
    except KeyboardInterrupt:
        pass
    finally:
        out.close()
        if uploader:
            uploader.flush()
            sys.stderr.write(f'{uploader.sent} documents uploaded\n')


def upload(args):
    es = Elastic(args.prefix)
    up = Uploader(es)
    files = [f for pattern in args.files for f in sorted(glob.glob(pattern))]
    for f in files:
        n = 0
        for line in open(f):
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            if args.session:
                rec['session'] = args.session
            up.add(rec)
            n += 1
            if len(up.queue) >= 5000:
                up.flush()
        up.flush()
        print(f'{f}: {n} lines')
    print(f'{up.sent} documents uploaded to {es.prefix}-*')


def main():
    ap = argparse.ArgumentParser(description=USAGE, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--prefix', default='bandit')
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('record')
    r.add_argument('--port', required=True)
    r.add_argument('--session', default=datetime.now().strftime('run-%m%d-%H%M'))
    r.add_argument('--upload', action='store_true')
    r.add_argument('--mirror', action='store_true')
    u = sub.add_parser('upload')
    u.add_argument('files', nargs='+')
    u.add_argument('--session')
    args = ap.parse_args()
    record(args) if args.cmd == 'record' else upload(args)


if __name__ == '__main__':
    main()
