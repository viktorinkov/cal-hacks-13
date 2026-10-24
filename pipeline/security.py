import argparse
import glob
import json
import math
import os
import shutil
import signal
import subprocess
import threading
import time
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np
import requests

from elastic import DATA, ROOT

USAGE = """security-room view: finds a band's flashing ring in a live camera feed and shows where it is

  python3 pipeline/security.py calibrate --camera 0 --name pit --gateway /dev/ttys012 --band 2
  python3 pipeline/security.py watch --name pit
  python3 pipeline/security.py anchors --span 20

calibrate, with the lights on. The first second of video becomes the lit snapshot (space takes a new one). A
helper wearing a band stands on a spot; click that spot on the map (click the small map to zoom, then the zoomed
map to place it exactly). The band is put into identify, a white blink, through --gateway: the gateway's port, or
the recorder's --mirror path while the recorder runs. Once the blink holds still for a second, the spot is
recorded. With no band at hand, click the spot in the camera picture instead. Hold the band at wrist height. Four
spots or more, spread over the area and not in a line, then s saves. u undoes the last spot, q quits. --spots
X,Y;X,Y... gives the map spots in order instead of clicks.

watch follows the newest radio file the recorder writes (pipeline/data/radio_*.jsonl, or --radio). A band whose
beacon carries SOS or fall flashes its whole ring red 4 times a second. The camera looks for exactly that: red
that switches on and off at 4 Hz. Steady red such as exit signs, other colours and other rates are ignored. When
the radio has an SOS, the flash is marked on the live feed, on the lit snapshot and on the venue map, and an alarm
sounds until a acknowledges it. A red 4 Hz flash with no SOS on the radio only gets a quiet yellow marker. Each
located SOS saves the view and the last 3 s of video under pipeline/data/security/ and a line in events.jsonl.
An SOS stays on screen until the radio reports it cleared. q quits. --record FILE.mp4 also writes the whole view to a
video (a backup for the demo, or a record of the night), at --record-fps (30, the camera's rate).

Radio positions: watch also follows the newest pipeline/data/positions_*.jsonl (or --positions), written by
firmware/tools/ranging.py track --anchors ... --positions .... Every placed band is a dot on the map. An SOS band's
radio position is an amber circle on the map and, through the camera calibration, on the live feed and the lit
snapshot, so the operator knows where to look before the flash is found or when it is hidden. With several SOS
bands at once, each flash goes to the band whose radio position is nearest. Radio positions are about half a metre
to a metre off; the camera's flash is exact.

anchors places the stations and the gateway on the venue plan, once, at the venue: 1 to 5 choose station 101 to
105, g the gateway; click the big plan, then the zoomed plan to place it exactly. The plan has no scale, so press m
and click two points --span metres apart (two stations measured with a tape, a wall of known length). s writes
pipeline/data/security/anchors.json for ranging.py, q quits. Without a window: --place 101=X,Y (plan pixels, any
number of times) with --metres-per-px.

Point the camera at the area from above head height, tilted down, with Center Stage off (Control Center, Video
Effects) so the picture does not pan, and keep it still after calibrating.

The security page: watch --serve 8770 also serves http://127.0.0.1:8770/ (--host 0.0.0.0 for another screen). It shows
the venue in 3D, the splat from pipeline/splat.py if there is one (else the plan as the floor), with the stations, every
placed band, each SOS as a red column with its radio circle, and the security camera with what it covers and the line
from it to the flash it found. Beside it, the live camera feed with the same markings as the window. 1, 2 and 3 show
the 3D view, the feed, or both; a acknowledges, like the window. A camera placed with splat.py camera has an exact
position in the model; one calibrated only here is not drawn in 3D. three.js and Spark load from jsDelivr once and are
kept in pipeline/data/web-vendor, so the page also works offline afterwards."""

F_SOS, F_FALL = 1, 2
SOS_HZ, IDENT_HZ, SIDE_HZ = 4.0, 2.5, 1.5
WINDOW_S = 1.5
ANALYSIS_W = 640
EVERY = 3
MIN_AMP = 18.0
SELECT = 2.0
RED_RATIO = 1.6
WHITE_RATIO = 0.35
STABLE = 2
LOST_S = 1.5
MATCH = 0.05
STILL = 0.02
STILL_S = 1.0
NEW_SPOT = 0.05
RADIO_FRESH_S = 6.0
POS_FRESH_S = 5.0
RADIO_GATE_M = 3.0
DROP_STALE_S = 60.0
CLIP_S = 3.0
CLIP_W = 960
ALARM_EVERY_S = 5.0
IDENT_EVERY_S = 5.0
IDENT_HOLD = 60
CANVAS_W, CANVAS_H = 1600, 900
LIVE_W, LIVE_H = 1120, 630
SIDE_W, LIT_H, ZOOM_H = 480, 270, 270
ZOOM = 5.0
ZOOM_METRES = 24.0
WIN = 'BandIt security'
OUT = os.path.join(DATA, 'security')
VENUE = os.path.join(ROOT, 'pipeline', 'venues', 'palace-of-fine-arts.json')
WEB = os.path.join(ROOT, 'pipeline', 'security_web')
VENDOR = os.path.join(DATA, 'web-vendor')
CDN = 'https://cdn.jsdelivr.net/npm/'
VENDOR_PACKAGES = ('three@0.180.0/', '@sparkjsdev/spark@2.4.0/')
SPLAT = os.path.join(DATA, 'venue', 'splat')
WEB_FPS, WEB_W, WRIST_M = 15.0, 1280, 0.9
TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
         '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.splat': 'application/octet-stream'}
ALARM_SOUND = '/System/Library/Sounds/Sosumi.aiff'
FOUND_SOUND = '/System/Library/Sounds/Glass.aiff'
RED, AMBER, YELLOW, WHITE, GREY, GREEN, DARK = (
    (40, 40, 255), (0, 150, 255), (0, 225, 255), (240, 240, 240), (140, 140, 140), (90, 220, 90), (18, 18, 18))
FONT = cv2.FONT_HERSHEY_SIMPLEX


def say(text):
    print(f'{datetime.now().strftime("%H:%M:%S")} {text}', flush=True)


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def stop(*_):
    raise KeyboardInterrupt


def sound(path, enabled):
    if enabled and os.path.exists(path):
        subprocess.Popen(['afplay', path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


class Source:
    def __init__(self, spec, fast):
        self.name = str(spec)
        self.live = self.name.isdigit()
        self.label = f'camera {self.name}' if self.live else os.path.basename(self.name)
        self.cap = cv2.VideoCapture(int(self.name) if self.live else self.name)
        if not self.cap.isOpened():
            raise SystemExit(f'cannot open camera or video {self.name}')
        if self.live:
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
            self.cap.set(cv2.CAP_PROP_FPS, 30)
        self.fast, self.start = fast, None

    def read(self):
        ok, frame = self.cap.read()
        if not ok:
            return None, None
        if self.live:
            return time.monotonic(), frame
        t = self.cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
        if not self.fast:
            if self.start is None:
                self.start = time.monotonic() - t
            wait = self.start + t - time.monotonic()
            if wait > 0:
                time.sleep(wait)
        return t, frame


def pool(frame, width):
    k = max(1, int(round(frame.shape[1] / width)))
    if k > 1:
        frame = cv2.dilate(frame, np.ones((k, k), np.uint8))[k // 2::k, k // 2::k]
    return np.ascontiguousarray(frame)


class FlashFinder:
    def __init__(self, hz, colour):
        self.hz, self.colour = hz, colour
        self.freqs = (hz, hz - SIDE_HZ, hz + SIDE_HZ)
        self.frames = deque()
        self.tracks = []
        self.next_id = 1

    def add(self, t, small):
        self.frames.append((t, small))
        while t - self.frames[0][0] > WINDOW_S:
            self.frames.popleft()

    def ready(self):
        return len(self.frames) >= 10 and self.frames[-1][0] - self.frames[0][0] >= 0.8 * WINDOW_S

    def rate(self):
        if len(self.frames) < 2:
            return 0.0
        return (len(self.frames) - 1) / max(1e-6, self.frames[-1][0] - self.frames[0][0])

    def amplitudes(self, x, ts):
        span = max(1e-6, ts[-1])
        h = 0.5 - 0.5 * np.cos(2 * np.pi * ts / span)
        rows, sums = [h], []
        for f in self.freqs:
            c, s = h * np.cos(2 * np.pi * f * ts), h * np.sin(2 * np.pi * f * ts)
            rows += [c, s]
            sums.append((c.sum(), s.sum()))
        r = np.array(rows, np.float32) @ x
        hs = h.sum()
        mean = r[0] / hs
        out = []
        for i, (cs, ss) in enumerate(sums):
            re, im = r[1 + 2 * i] - mean * cs, r[2 + 2 * i] - mean * ss
            out.append(2.0 * np.sqrt(re * re + im * im) / hs)
        return out

    def blobs(self):
        ts = np.array([t for t, _ in self.frames], np.float64)
        ts -= ts[0]
        frames = [f for _, f in self.frames]
        h, w = frames[0].shape[:2]
        chan = 2 if self.colour == 'red' else 1
        x = np.stack([f[:, :, chan] for f in frames]).reshape(len(frames), -1).astype(np.float32)
        a, lo, hi = self.amplitudes(x, ts)
        hit = (a >= MIN_AMP) & (a >= SELECT * np.maximum(lo, hi))
        if not hit.any():
            return []
        mask = cv2.dilate(hit.reshape(h, w).astype(np.uint8), np.ones((3, 3), np.uint8))
        count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        amp = a.reshape(h, w)
        found = []
        for i in (np.argsort(-stats[1:, cv2.CC_STAT_AREA])[:12] + 1):
            x0, y0, bw, bh = (int(v) for v in stats[i, :4])
            inside = labels[y0:y0 + bh, x0:x0 + bw] == i
            weight = amp[y0:y0 + bh, x0:x0 + bw] * inside
            total = float(weight.sum())
            if total <= 0:
                continue
            ys, xs = np.nonzero(inside)
            series = np.stack([f[y0 + ys, x0 + xs] for f in frames]).astype(np.float32).mean(axis=1)
            ab, ag, ar = self.amplitudes(series, ts)[0]
            if self.colour == 'red' and ar < RED_RATIO * max(ag, ab):
                continue
            if self.colour == 'white' and min(ab, ag, ar) < WHITE_RATIO * max(ab, ag, ar):
                continue
            wv = weight[ys, xs]
            cx = x0 + float((xs * wv).sum() / total)
            cy = y0 + float((ys * wv).sum() / total)
            found.append({'pos': ((cx + 0.5) / w, (cy + 0.5) / h), 'strength': total})
        return found

    def update(self, t):
        for tr in self.tracks:
            tr['hit'] = False
        for b in sorted(self.blobs(), key=lambda b: -b['strength']):
            best, dist = None, MATCH
            for tr in self.tracks:
                d = math.dist(tr['pos'], b['pos'])
                if not tr['hit'] and d < dist:
                    best, dist = tr, d
            if best is None:
                best = {'id': self.next_id, 'hits': 0, 'pos': b['pos'], 'anchor': b['pos'], 'still_since': t}
                self.next_id += 1
                self.tracks.append(best)
            best['pos'] = (0.5 * best['pos'][0] + 0.5 * b['pos'][0], 0.5 * best['pos'][1] + 0.5 * b['pos'][1])
            if math.dist(best['anchor'], best['pos']) > STILL:
                best['anchor'], best['still_since'] = best['pos'], t
            best.update(hits=best['hits'] + 1, last=t, hit=True, strength=b['strength'])
        self.tracks = [tr for tr in self.tracks if t - tr['last'] <= LOST_S]
        return [tr for tr in self.tracks if tr['hits'] >= STABLE]


class Follower(threading.Thread):

    def __init__(self, path, pattern, what):
        super().__init__(daemon=True)
        self.fixed, self.pattern, self.what = path, pattern, what
        self.path, self.offset = None, 0
        self.lock = threading.Lock()

    def newest(self):
        if self.fixed:
            return self.fixed
        files = glob.glob(self.pattern)
        return max(files, key=os.path.getmtime) if files else None

    def run(self):
        while True:
            path = self.newest()
            if path and path != self.path and os.path.exists(path):
                self.path, self.offset = path, os.path.getsize(path)
                say(f'following the {self.what} in {os.path.basename(path)}')
            if self.path and os.path.exists(self.path):
                with open(self.path) as f:
                    f.seek(self.offset)
                    chunk = f.read()
                    if chunk.endswith('\n'):
                        self.offset = f.tell()
                    else:
                        chunk = chunk[:chunk.rfind('\n') + 1]
                        self.offset += len(chunk.encode())
                for line in chunk.splitlines():
                    self.handle(line)
            time.sleep(0.2)


class Radio(Follower):
    def __init__(self, path):
        super().__init__(path, os.path.join(DATA, 'radio_*.jsonl'), 'radio')
        self.bands, self.last = {}, None

    def handle(self, text):
        try:
            d = json.loads(json.loads(text)['line'])
        except (ValueError, KeyError, TypeError):
            return
        if d.get('type') != 1 or not 1 <= d.get('id', 0) <= 99:
            return
        with self.lock:
            self.bands[d['id']] = {'flags': d.get('flags', 0), 'zone': d.get('zone', 0), 'state': d.get('state', 0),
                                   'seen': time.time()}
            self.last = time.time()

    def snapshot(self):
        with self.lock:
            return {b: dict(v) for b, v in self.bands.items()}

    def status(self):
        if not self.path:
            return 'radio: waiting for the recorder (pipeline/data/radio_*.jsonl)', AMBER
        if self.last is None:
            return f'radio: {os.path.basename(self.path)}, no band heard yet', AMBER
        age = time.time() - self.last
        return f'radio: {os.path.basename(self.path)}, last beacon {age:.1f} s ago', GREEN if age < 3 else AMBER


class Positions(Follower):

    def __init__(self, path):
        super().__init__(path, os.path.join(DATA, 'positions_*.jsonl'), 'band positions')
        self.bands = {}

    def handle(self, text):
        try:
            d = json.loads(text)
        except ValueError:
            return
        if not isinstance(d, dict) or 'band' not in d or 'px' not in d:
            return
        d['seen'] = time.time()
        with self.lock:
            self.bands[d['band']] = d

    def snapshot(self):
        now = time.time()
        with self.lock:
            return {b: dict(v) for b, v in self.bands.items() if now - v['seen'] <= POS_FRESH_S}

    def status(self):
        if not self.path:
            return 'positions: none (ranging.py track --anchors ... --positions pipeline/data/positions_<name>.jsonl)', GREY
        n = len(self.snapshot())
        if not n:
            return f'positions: {os.path.basename(self.path)}, no band placed in the last 5 s', AMBER
        return f'positions: {os.path.basename(self.path)}, {n} band{"s" if n > 1 else ""} placed', GREEN


class Gateway:
    def __init__(self, path):
        self.port, self.fd = None, None
        if os.path.basename(path).startswith('cu.'):
            import serial
            self.port = serial.Serial(path, 115200, timeout=0.2)
        else:
            self.fd = os.open(path, os.O_WRONLY | os.O_NOCTTY | os.O_NONBLOCK)

    def send(self, text):
        data = (text + '\n').encode()
        try:
            if self.port:
                self.port.reset_input_buffer()
                self.port.write(data)
            else:
                os.write(self.fd, data)
        except OSError as e:
            say(f'gateway: {e}')


def load_plan(venue):
    with open(venue) as f:
        v = json.load(f)
    plan = cv2.imread(os.path.join(ROOT, v['plan_image']))
    if plan is None:
        raise SystemExit(f'cannot read the venue plan {v["plan_image"]}')
    return v['name'], plan


def cal_dir(out):
    return os.path.join(out, 'cameras')


def load_cal(out, name):
    path = os.path.join(cal_dir(out), f'{name}.json')
    if not os.path.exists(path):
        return None
    with open(path) as f:
        cal = json.load(f)
    cal['H'] = np.array(cal['homography'], np.float64)
    cal['Hinv'] = np.linalg.inv(cal['H'])
    cal['lit'] = cv2.imread(os.path.join(cal_dir(out), cal['snapshot']))
    return cal


def ring_in_image(cal, centre, radius, n=24):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        v = cal['Hinv'] @ np.array([centre[0] + radius * math.cos(a), centre[1] + radius * math.sin(a), 1.0])
        if v[2] <= 1e-9:
            return None
        x, y = v[0] / v[2], v[1] / v[2]
        if not (-0.2 <= x <= 1.2 and -0.2 <= y <= 1.2):
            return None
        pts.append((x, y))
    return pts


def to_map(H, pos):
    v = H @ np.array([pos[0], pos[1], 1.0])
    return float(v[0] / v[2]), float(v[1] / v[2])


def save_cal(out, name, camera, frame, snapshot, points, venue):
    img = np.array([p['image'] for p in points], np.float64)
    dst = np.array([p['map'] for p in points], np.float64)
    H, _ = cv2.findHomography(img, dst, 0)
    if H is None or not np.isfinite(H).all():
        say('those spots do not give a usable mapping: spread them over the area, not in a line')
        return None
    err = [math.dist(to_map(H, p['image']), p['map']) for p in points]
    os.makedirs(cal_dir(out), exist_ok=True)
    cv2.imwrite(os.path.join(cal_dir(out), f'{name}_lit.jpg'), snapshot, [cv2.IMWRITE_JPEG_QUALITY, 92])
    data = {'name': name, 'camera': str(camera), 'frame': [frame.shape[1], frame.shape[0]],
            'snapshot': f'{name}_lit.jpg', 'venue': os.path.relpath(venue, ROOT), 'points': points,
            'homography': H.tolist(), 'error_plan_px': [round(e, 1) for e in err], 'created': iso(time.time())}
    path = os.path.join(cal_dir(out), f'{name}.json')
    with open(path, 'w') as f:
        json.dump(data, f, indent=1)
    if len(points) == 4:
        say(f'saved {path}: 4 spots always fit exactly, a fifth spot would show how accurate the mapping is')
    else:
        say(f'saved {path}: {len(points)} spots, worst mapping error {max(err):.1f} plan pixels')
    return data


def fit(img, box):
    x, y, w, h = box
    ih, iw = img.shape[:2]
    s = min(w / iw, h / ih)
    nw, nh = max(1, int(iw * s)), max(1, int(ih * s))
    return cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA), (x + (w - nw) // 2, y + (h - nh) // 2, nw, nh)


def paste(canvas, img, rect):
    x, y, w, h = rect
    canvas[y:y + h, x:x + w] = img


def at(rect, pos):
    x, y, w, h = rect
    return int(x + pos[0] * w), int(y + pos[1] * h)


def text(canvas, s, org, colour=WHITE, scale=0.55, thick=1):
    for d in (1, 2):
        cv2.putText(canvas, s, (org[0] + d, org[1] + d), FONT, scale, (0, 0, 0), thick, cv2.LINE_AA)
    cv2.putText(canvas, s, org, FONT, scale, colour, thick, cv2.LINE_AA)


def marker(canvas, pt, colour, label, big, t, right=CANVAS_W):
    r = int(26 + 7 * math.sin(2 * math.pi * 2 * t)) if big else 14
    cv2.circle(canvas, pt, r, (0, 0, 0), 6 if big else 4, cv2.LINE_AA)
    cv2.circle(canvas, pt, r, colour, 3 if big else 2, cv2.LINE_AA)
    if big:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            cv2.line(canvas, (pt[0] + dx * (r + 4), pt[1] + dy * (r + 4)), (pt[0] + dx * (r + 16), pt[1] + dy * (r + 16)),
                     colour, 3, cv2.LINE_AA)
    if label:
        scale, thick = (0.6, 2) if big else (0.5, 1)
        width = cv2.getTextSize(label, FONT, scale, thick)[0][0]
        x = pt[0] + r + 8 if pt[0] + r + 8 + width < right - 4 else pt[0] - r - 8 - width
        text(canvas, label, (x, pt[1] - r // 2), colour, scale, thick)


class Layout:
    def __init__(self, plan):
        self.plan = plan
        ph, pw = plan.shape[:2]
        self.scale = min(SIDE_W / pw, (CANVAS_H - LIT_H - ZOOM_H) / ph)
        self.map_h = int(round(ph * self.scale))
        width = min(SIDE_W, int(round(pw * self.scale)))
        self.map_img = np.full((self.map_h, SIDE_W, 3), DARK, np.uint8)
        self.map_img[:, :width] = cv2.resize(plan, (width, self.map_h), interpolation=cv2.INTER_AREA)
        self.live_box = (0, 0, LIVE_W, LIVE_H)
        self.lit_box = (LIVE_W, 0, SIDE_W, LIT_H)
        self.map_box = (LIVE_W, LIT_H, SIDE_W, self.map_h)
        self.zoom_box = (LIVE_W, LIT_H + self.map_h, SIDE_W, ZOOM_H)
        self.zoom_scale = self.scale * ZOOM
        self.zoom_origin = (0.0, 0.0)
        self.live_rect = self.live_box
        self.lit_rect = None

    def map_pt(self, m):
        x, y, _, _ = self.map_box
        return int(x + m[0] * self.scale), int(y + m[1] * self.scale)

    def zoom_local(self, m):
        return int((m[0] - self.zoom_origin[0]) * self.zoom_scale), int((m[1] - self.zoom_origin[1]) * self.zoom_scale)

    def targets(self, canvas):
        return ((canvas, self.map_pt, self.scale), (self.zimg, self.zoom_local, self.zoom_scale))

    def finish(self, canvas):
        zx, zy, zw, zh = self.zoom_box
        canvas[zy:zy + zh, zx:zx + zw] = self.zimg
        cv2.rectangle(canvas, (zx, zy), (zx + zw - 1, zy + zh - 1), AMBER, 1)

    def draw_maps(self, canvas, centre):
        x, y, w, h = self.map_box
        canvas[y:y + h, x:x + w] = self.map_img
        ph, pw = self.plan.shape[:2]
        cw, ch = SIDE_W / self.zoom_scale, ZOOM_H / self.zoom_scale
        ox = min(max(0.0, centre[0] - cw / 2), pw - cw)
        oy = min(max(0.0, centre[1] - ch / 2), ph - ch)
        self.zoom_origin = (ox, oy)
        crop = self.plan[int(oy):int(oy + ch) + 1, int(ox):int(ox + cw) + 1]
        zx, zy, zw, zh = self.zoom_box
        self.zimg = cv2.resize(crop, (zw, zh), interpolation=cv2.INTER_LINEAR)
        tl, br = self.map_pt((ox, oy)), self.map_pt((ox + cw, oy + ch))
        cv2.rectangle(canvas, tl, br, AMBER, 1)

    def draw_area(self, canvas, cal):
        if not cal or not cal['points']:
            return
        pts = np.array([p['map'] for p in cal['points']], np.float32)
        hull = cv2.convexHull(pts).reshape(-1, 2)
        for img, f, _ in self.targets(canvas):
            poly = np.array([f(p) for p in hull], np.int32)
            cv2.polylines(img, [poly], True, GREY, 1, cv2.LINE_AA)

    def click(self, pt):
        x, y = pt
        for name, box in (('live', self.live_rect), ('map', self.map_box), ('zoom', self.zoom_box)):
            bx, by, bw, bh = box
            if bx <= x < bx + bw and by <= y < by + bh:
                if name == 'live':
                    return name, ((x - bx) / bw, (y - by) / bh)
                if name == 'map':
                    return name, ((x - bx) / self.scale, (y - by) / self.scale)
                return name, (self.zoom_origin[0] + (x - bx) / self.zoom_scale,
                              self.zoom_origin[1] + (y - by) / self.zoom_scale)
        return None, None


def base_canvas(layout, frame, lit):
    canvas = np.full((CANVAS_H, CANVAS_W, 3), DARK, np.uint8)
    img, layout.live_rect = fit(frame, layout.live_box)
    paste(canvas, img, layout.live_rect)
    if lit is not None:
        img, layout.lit_rect = fit(lit, layout.lit_box)
        paste(canvas, img, layout.lit_rect)
        text(canvas, 'lit view', (layout.lit_box[0] + 8, 22), WHITE, 0.5)
    else:
        layout.lit_rect = None
        text(canvas, 'no lit snapshot yet', (layout.lit_box[0] + 20, LIT_H // 2), GREY)
    return canvas


def incident_label(inc, now):
    zone = f', zone {inc["zone"]}' if inc['zone'] else ''
    age = int(now - inc['opened'])
    head = f'{"FALL" if inc["fall"] else "SOS"} band {inc["band"]}{zone}, {age // 60}:{age % 60:02d} ago'
    radio = inc.get('radio')
    if inc['stale']:
        state = f'radio lost {int(now - inc["heard"])} s ago'
    elif inc['visible']:
        state = 'located by the camera'
        if radio and inc.get('agree_m') is not None:
            state += f', radio position {inc["agree_m"]:.1f} m from it'
    elif inc['pos']:
        state = 'flash hidden, last seen position marked'
    elif radio:
        state = f'radio position only, within about {radio["r"]:.1f} m; not seen by the camera'
    else:
        state = 'not seen by the camera, no radio position'
    return f'{head}: {state}{", acknowledged" if inc["ack"] else ""}'


def draw_radio(canvas, layout, cal, placed, incidents, tnow):
    sos = {i['band']: i for i in incidents}
    for band, p in sorted(placed.items()):
        if band in sos:
            continue
        for img, f, _ in layout.targets(canvas):
            q = f(p['px'])
            cv2.circle(img, q, 4, (0, 0, 0), -1, cv2.LINE_AA)
            cv2.circle(img, q, 3, WHITE, -1, cv2.LINE_AA)
        q = layout.zoom_local(p['px'])
        text(layout.zimg, str(band), (q[0] + 5, q[1] - 4), GREY, 0.4)
    for band, inc in sos.items():
        p = inc.get('radio')
        if not p:
            continue
        for img, f, scale in layout.targets(canvas):
            q = f(p['px'])
            cv2.circle(img, q, max(5, int(p['r_px'] * scale)), (0, 0, 0), 4, cv2.LINE_AA)
            cv2.circle(img, q, max(5, int(p['r_px'] * scale)), AMBER, 2, cv2.LINE_AA)
        q = layout.zoom_local(p['px'])
        text(layout.zimg, f'band {band} by radio', (q[0] - 60, q[1] + int(p['r_px'] * layout.zoom_scale) + 18), AMBER,
             0.5)
        if not cal or inc['visible']:
            continue
        ring = ring_in_image(cal, p['px'], p['r_px'])
        if not ring:
            continue
        for rect in (layout.live_rect, layout.lit_rect):
            if rect:
                dashed_ring(canvas, rect, ring, band, tnow)


def dashed_ring(canvas, rect, ring, band, tnow):
    poly = np.array([at(rect, v) for v in ring], np.int32)
    dash = int(tnow * 4) % 2
    for i in range(len(poly)):
        if i % 2 == dash:
            cv2.line(canvas, tuple(poly[i]), tuple(poly[(i + 1) % len(poly)]), AMBER, 2, cv2.LINE_AA)
    top = poly[np.argmin(poly[:, 1])]
    text(canvas, f'band {band} by radio', (int(top[0]) - 50, int(top[1]) - 8), AMBER, 0.5)


def draw_live(frame, cal, incidents, quiet, tnow):
    k = min(1.0, WEB_W / frame.shape[1])
    img = cv2.resize(frame, (int(frame.shape[1] * k), int(frame.shape[0] * k)), interpolation=cv2.INTER_AREA)
    rect = (0, 0, img.shape[1], img.shape[0])
    for inc in incidents:
        p = inc.get('radio')
        if p and cal and not inc['visible']:
            ring = ring_in_image(cal, p['px'], p['r_px'])
            if ring:
                dashed_ring(img, rect, ring, inc['band'], tnow)
    for tr in quiet:
        marker(img, at(rect, tr['pos']), YELLOW, 'flash, no SOS on radio', False, tnow, img.shape[1])
    for inc in incidents:
        if inc['pos']:
            label = f'{"FALL" if inc["fall"] else "SOS"} band {inc["band"]}'
            marker(img, at(rect, inc['pos']), RED if inc['visible'] else GREY, label, True, tnow, img.shape[1])
    return cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 80])[1].tobytes()


def render_watch(layout, frame, cal, incidents, quiet, status, tnow, placed=None):
    canvas = base_canvas(layout, frame, cal['lit'] if cal else None)
    now = time.time()
    located = [i for i in incidents if i['map']]
    by_radio = [i for i in incidents if i.get('radio')]
    if located:
        centre = max(located, key=lambda i: i['located'] or 0)['map']
    elif by_radio:
        centre = tuple(max(by_radio, key=lambda i: i['opened'])['radio']['px'])
    elif cal and cal['points']:
        centre = tuple(np.mean([p['map'] for p in cal['points']], axis=0))
    else:
        centre = (layout.plan.shape[1] / 2, layout.plan.shape[0] / 2)
    mpp = next((p['mpp'] for p in (placed or {}).values() if p.get('mpp')), None)
    layout.zoom_scale = SIDE_W * mpp / ZOOM_METRES if mpp else layout.scale * ZOOM
    layout.draw_maps(canvas, centre)
    layout.draw_area(canvas, cal)
    draw_radio(canvas, layout, cal, placed or {}, incidents, tnow)
    panels = [(r, r[0] + r[2]) for r in (layout.live_rect, layout.lit_rect) if r]
    for tr in quiet:
        for rect, right in panels:
            marker(canvas, at(rect, tr['pos']), YELLOW, 'flash, no SOS on radio', False, tnow, right)
    for inc in incidents:
        if not inc['pos']:
            continue
        colour = RED if inc['visible'] else GREY
        label = f'{"FALL" if inc["fall"] else "SOS"} band {inc["band"]}'
        for rect, right in panels:
            marker(canvas, at(rect, inc['pos']), colour, label, True, tnow, right)
        if inc['map']:
            for img, f, _ in layout.targets(canvas):
                p = f(inc['map'])
                cv2.circle(img, p, 9, (0, 0, 0), -1, cv2.LINE_AA)
                cv2.circle(img, p, 7, colour, -1, cv2.LINE_AA)
            q = layout.zoom_local(inc['map'])
            text(layout.zimg, label, (q[0] + 12, q[1] + 5), colour, 0.55, 2)
    layout.finish(canvas)
    y = LIVE_H + 30
    text(canvas, f'BandIt security   {datetime.now().strftime("%H:%M:%S")}', (16, y), WHITE, 0.7, 2)
    for line, colour in status:
        y += 26
        text(canvas, line, (16, y), colour)
    y += 10
    for inc in sorted(incidents, key=lambda i: i['opened']):
        y += 28
        colour = WHITE if inc['ack'] else (RED if inc['pos'] or not inc['stale'] else AMBER)
        text(canvas, incident_label(inc, now), (16, y), colour, 0.6, 2)
    if quiet:
        y += 26
        text(canvas, f'{len(quiet)} red flash{"es" if len(quiet) > 1 else ""} with no SOS on the radio', (16, y), YELLOW)
    text(canvas, 'a acknowledge   q quit', (16, CANVAS_H - 14), GREY, 0.5)
    text(canvas, 'map', (LIVE_W + 8, LIT_H + 18), WHITE, 0.5)
    if any(not i['ack'] for i in incidents) and int(tnow * 2) % 2 == 0:
        cv2.rectangle(canvas, (0, 0), (CANVAS_W - 1, CANVAS_H - 1), RED, 14)
    return canvas


def save_incident(out, inc, canvas, clip, fps, camera):
    folder = os.path.join(out, f'{datetime.fromtimestamp(inc["opened"]).strftime("%Y%m%d_%H%M%S")}_band{inc["band"]}')
    os.makedirs(folder, exist_ok=True)
    cv2.imwrite(os.path.join(folder, 'view.jpg'), canvas, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if clip:
        first = cv2.imdecode(np.frombuffer(clip[0][1], np.uint8), cv2.IMREAD_COLOR)
        writer = cv2.VideoWriter(os.path.join(folder, 'last_3s.mp4'), cv2.VideoWriter_fourcc(*'mp4v'),
                                 max(5.0, min(60.0, fps)), (first.shape[1], first.shape[0]))
        for _, data in clip:
            writer.write(cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR))
        writer.release()
    return folder


class Web:

    def __init__(self, host, port, scene, files):
        self.public, self.files = scene, files
        self.lock = threading.Lock()
        self.jpeg, self.seq, self.state = None, 0, b'{}'
        self.viewers, self.acks, self.last_frame, self.last_state = 0, 0, -1.0, -1.0
        web = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, *_):
                pass

            def do_GET(self):
                try:
                    web.get(self)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def do_POST(self):
                if self.path == '/ack':
                    with web.lock:
                        web.acks += 1
                    web.send(self, b'{}', 'application/json')
                else:
                    self.send_error(404)

        self.server = ThreadingHTTPServer((host, port), Handler)
        self.server.daemon_threads = True
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        say(f'security page on http://{host}:{port}/')

    def send(self, h, body, kind, cache=False):
        h.send_response(200)
        h.send_header('Content-Type', kind)
        h.send_header('Content-Length', str(len(body)))
        h.send_header('Cache-Control', 'max-age=86400' if cache else 'no-store')
        h.end_headers()
        h.wfile.write(body)

    def file(self, h, path, cache=False):
        if not path or not os.path.exists(path):
            return h.send_error(404)
        h.send_response(200)
        h.send_header('Content-Type', TYPES.get(os.path.splitext(path)[1], 'application/octet-stream'))
        h.send_header('Content-Length', str(os.path.getsize(path)))
        h.send_header('Cache-Control', 'max-age=86400' if cache else 'no-cache')
        h.end_headers()
        with open(path, 'rb') as f:
            shutil.copyfileobj(f, h.wfile, 1 << 20)

    def get(self, h):
        path = h.path.split('?')[0]
        if path in ('/', '/index.html', '/app.js', '/style.css'):
            return self.file(h, os.path.join(WEB, 'index.html' if path == '/' else path[1:]))
        if path == '/scene.json':
            return self.send(h, json.dumps(self.public).encode(), 'application/json')
        if path == '/state':
            with self.lock:
                body = self.state
            return self.send(h, body, 'application/json')
        if path == '/live.mjpg':
            return self.stream(h)
        if path in self.files:
            return self.file(h, self.files[path])
        if path.startswith('/vendor/'):
            return self.vendor(h, path[len('/vendor/'):])
        h.send_error(404)

    def vendor(self, h, rel):
        if '..' in rel or not rel.startswith(VENDOR_PACKAGES):
            return h.send_error(404)
        local = os.path.join(VENDOR, rel)
        if not os.path.exists(local):
            try:
                r = requests.get(CDN + rel, timeout=30)
                r.raise_for_status()
                data = r.content
            except requests.RequestException as e:
                say(f'page: cannot fetch {rel} from jsDelivr ({e})')
                return h.send_error(502)
            os.makedirs(os.path.dirname(local), exist_ok=True)
            with open(local + '.part', 'wb') as f:
                f.write(data)
            os.replace(local + '.part', local)
        self.file(h, local, cache=True)

    def stream(self, h):
        h.send_response(200)
        h.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
        h.send_header('Cache-Control', 'no-store')
        h.send_header('Connection', 'close')
        h.end_headers()
        with self.lock:
            self.viewers += 1
        seen = -1
        try:
            while True:
                with self.lock:
                    jpeg, seq = self.jpeg, self.seq
                if jpeg is None or seq == seen:
                    time.sleep(0.01)
                    continue
                seen = seq
                h.wfile.write(b'--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n' % len(jpeg))
                h.wfile.write(jpeg + b'\r\n')
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with self.lock:
                self.viewers -= 1

    def frame_due(self, tnow):
        if self.viewers and tnow - self.last_frame >= 1.0 / WEB_FPS:
            self.last_frame = tnow
            return True
        return False

    def put_frame(self, jpeg):
        with self.lock:
            self.jpeg, self.seq = jpeg, self.seq + 1

    def state_due(self, tnow):
        if tnow - self.last_state >= 0.2:
            self.last_state = tnow
            return True
        return False

    def put_state(self, state):
        body = json.dumps(state).encode()
        with self.lock:
            self.state = body

    def take_acks(self):
        with self.lock:
            n, self.acks = self.acks, 0
        return n


def web_scene(args, cal, plan, venue_name):
    files = {'/plan.png': None, '/lit.jpg': None, '/venue.splat': None}
    with open(args.venue) as f:
        files['/plan.png'] = os.path.join(ROOT, json.load(f)['plan_image'])
    origin, mpp, anchors = [0.0, 0.0], None, []
    if os.path.exists(args.anchors):
        with open(args.anchors) as f:
            a = json.load(f)
        origin, mpp = a['plan'].get('origin', origin), a['plan'].get('metres_per_px')
        for aid, (x, y) in sorted(a['anchors'].items(), key=lambda kv: int(kv[0])):
            anchors.append({'id': int(aid), 'name': anchor_name(int(aid)), 'x': x, 'z': y,
                            'kind': 'gateway' if int(aid) == 200 else 'station'})
    splat = None
    scene_path = os.path.join(args.splat, 'scene.json')
    if os.path.exists(scene_path):
        with open(scene_path) as f:
            s = json.load(f)
        if mpp is None:
            origin, mpp = s['plan']['origin'], s['plan']['metres_per_px']
        elif s['plan']['metres_per_px'] and (abs(s['plan']['metres_per_px'] - mpp) > 1e-3 * mpp
                                             or list(s['plan']['origin']) != list(origin)):
            say('the splat was aligned with a different plan scale than the anchors: run splat.py align again')
        if s.get('splat') and os.path.exists(os.path.join(args.splat, s['splat'])):
            files['/venue.splat'] = os.path.join(args.splat, s['splat'])
            splat = {'url': '/venue.splat', 'splats': s['splats'], 'bounds': s['bounds'], 'walk': s.get('walk', [])}
    camera = None
    if cal:
        files['/lit.jpg'] = os.path.join(cal_dir(args.out), cal['snapshot'])
        camera = {'name': cal['name'], 'lit': '/lit.jpg', 'pose': cal.get('pose')}
    scene = {'venue': venue_name, 'plan': {'url': '/plan.png', 'size': [plan.shape[1], plan.shape[0]],
                                           'origin': origin, 'metres_per_px': mpp},
             'anchors': anchors, 'splat': splat, 'camera': camera, 'wrist_m': WRIST_M}
    return scene, {k: v for k, v in files.items() if v}


def web_state(incidents, quiet, placed, bands, status, rate, cal, scene, now):
    origin, mpp = scene['plan']['origin'], scene['plan']['metres_per_px']
    height = (cal.get('pose') or {}).get('height_m', WRIST_M) if cal else WRIST_M

    def metres(px):
        if px is None or not mpp:
            return None
        return [round((px[0] - origin[0]) * mpp, 3), round(height, 2), round((px[1] - origin[1]) * mpp, 3)]

    levels = {GREEN: 'ok', AMBER: 'warn', GREY: 'dim', RED: 'bad', YELLOW: 'warn'}
    out = []
    for b in sorted(set(bands) | set(placed)):
        v, p = bands.get(b, {}), placed.get(b)
        if v and now - v['seen'] > RADIO_FRESH_S and not p:
            continue
        out.append({'id': b, 'flags': v.get('flags', 0), 'state': v.get('state', 0), 'zone': v.get('zone', 0),
                    'x': p['x'] if p else None, 'z': p['y'] if p else None, 'r': p['r'] if p else None})
    incs = []
    for inc in sorted(incidents, key=lambda i: i['opened']):
        p = inc.get('radio')
        incs.append({'band': inc['band'], 'fall': inc['fall'], 'zone': inc['zone'], 'age': round(now - inc['opened'], 1),
                     'ack': inc['ack'], 'stale': inc['stale'], 'visible': inc['visible'],
                     'located': round(inc['located'] - inc['opened'], 2) if inc['located'] else None,
                     'hit': metres(inc['map']), 'radio': {'x': p['x'], 'z': p['y'], 'r': p['r']} if p else None,
                     'agree_m': round(inc['agree_m'], 2) if inc.get('agree_m') is not None else None,
                     'label': incident_label(inc, now)})
    flashes = [{'hit': metres(to_map(cal['H'], f['pos'])) if cal else None} for f in quiet]
    return {'time': iso(now), 'fps': round(rate, 1), 'bands': out, 'incidents': incs, 'quiet': flashes,
            'alarm': any(not i['ack'] for i in incidents),
            'status': [{'text': s, 'level': levels.get(c, 'dim')} for s, c in status]}


def watch(args):
    signal.signal(signal.SIGTERM, stop)
    os.makedirs(args.out, exist_ok=True)
    cal = load_cal(args.out, args.name) if args.name else None
    if args.name and not cal:
        say(f'no calibration named {args.name} in {cal_dir(args.out)}: live feed only, no lit view or map position')
    venue_name, plan = load_plan(args.venue)
    layout = Layout(plan)
    web, scene = None, None
    if args.serve:
        scene, files = web_scene(args, cal, plan, venue_name)
        web = Web(args.host, args.serve, scene, files)
    src = Source(args.camera if args.camera is not None else (cal['camera'] if cal else '0'), args.fast)
    finder = FlashFinder(SOS_HZ, 'red')
    radio = Radio(args.radio)
    radio.start()
    positions = Positions(args.positions)
    positions.start()
    events = open(os.path.join(args.out, 'events.jsonl'), 'a')
    camera = args.name or src.name

    def log(event, **kw):
        rec = dict({'time': iso(time.time()), 'event': event, 'camera': camera}, **kw)
        events.write(json.dumps(rec) + '\n')
        events.flush()
        say(' '.join(f'{k}={v}' for k, v in rec.items() if k != 'time'))

    if not args.headless:
        cv2.namedWindow(WIN, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(WIN, *args.window)
    say(f'watching {src.name} for red 4 Hz flashes')
    clip, incidents, quiet_seen, released, flashes = deque(), {}, set(), set(), []
    recorder = None
    frames, busy, started = 0, 0.0, time.monotonic()
    try:
        while True:
            t, frame = src.read()
            if frame is None:
                break
            work = time.perf_counter()
            finder.add(t, pool(frame, args.analysis_width))
            if frames % EVERY == 0 and finder.ready():
                flashes = finder.update(t)
            small = cv2.resize(frame, (CLIP_W, int(frame.shape[0] * CLIP_W / frame.shape[1])), interpolation=cv2.INTER_AREA)
            clip.append((t, cv2.imencode('.jpg', small, [cv2.IMWRITE_JPEG_QUALITY, 80])[1].tobytes()))
            while t - clip[0][0] > CLIP_S:
                clip.popleft()
            now = time.time()
            bands = radio.snapshot()
            for band, v in bands.items():
                alarm = v['flags'] & (F_SOS | F_FALL)
                fresh = now - v['seen'] <= RADIO_FRESH_S
                inc = incidents.get(band)
                if alarm and fresh and not inc:
                    incidents[band] = {'band': band, 'zone': v['zone'], 'fall': not v['flags'] & F_SOS,
                                       'opened': now, 'heard': v['seen'], 'located': None, 'pos': None, 'map': None,
                                       'visible': False, 'track': None, 'ack': False, 'stale': False, 'alarmed': now,
                                       'saved': False}
                    log('sos', band=band, zone=v['zone'], fall=bool(v['flags'] & F_FALL))
                    sound(ALARM_SOUND, not args.quiet)
                elif inc:
                    inc['heard'], inc['stale'] = v['seen'], not fresh
                    if inc['zone'] != v['zone'] and v['zone']:
                        inc['zone'] = v['zone']
                    if not alarm and fresh:
                        log('cleared', band=band)
                        released.add(inc['track'])
                        del incidents[band]
                    elif inc['stale'] and inc['ack'] and now - v['seen'] > DROP_STALE_S:
                        log('dropped', band=band, reason='radio lost and acknowledged')
                        released.add(inc['track'])
                        del incidents[band]
            placed = positions.snapshot()
            for inc in incidents.values():
                p = placed.get(inc['band'])
                if p:
                    if not inc.get('radio'):
                        log('radio_position', band=inc['band'], map=p['px'], within_m=p['r'])
                    inc['radio'] = p
            visible = {tr['id']: tr for tr in flashes}
            taken = {i['track'] for i in incidents.values() if i['track'] in visible}
            waiting = [i for i in incidents.values() if visible.get(i['track']) is None]
            newly = []
            for inc in sorted(incidents.values(), key=lambda i: i['opened']):
                tr = visible.get(inc['track'])
                if tr is None:
                    free = [f for f in flashes if f['id'] not in taken]
                    p = inc.get('radio')
                    if free and p and cal:
                        def gap(f):
                            return math.dist(to_map(cal['H'], f['pos']), p['px']) * p['mpp']
                        tr = min(free, key=gap)
                        if gap(tr) > max(RADIO_GATE_M, 2 * p['r']) and not (len(free) == 1 and len(waiting) == 1):
                            tr = None
                    else:
                        tr = max(free, key=lambda f: f['strength']) if free else None
                    if tr:
                        inc['track'] = tr['id']
                        taken.add(tr['id'])
                inc['visible'] = tr is not None
                if tr:
                    inc['pos'] = tr['pos']
                    inc['map'] = to_map(cal['H'], tr['pos']) if cal else None
                    p = inc.get('radio')
                    inc['agree_m'] = math.dist(inc['map'], p['px']) * p['mpp'] if p and inc['map'] else None
                    if inc['located'] is None:
                        inc['located'] = now
                        newly.append(inc)
            quiet = [f for f in flashes if f['id'] not in taken and f['id'] not in released]
            for f in quiet:
                if f['id'] not in quiet_seen:
                    quiet_seen.add(f['id'])
                    log('flash_without_sos', image=[round(f['pos'][0], 3), round(f['pos'][1], 3)])
            for inc in incidents.values():
                if not inc['ack'] and now - inc['alarmed'] >= ALARM_EVERY_S:
                    inc['alarmed'] = now
                    sound(ALARM_SOUND, not args.quiet)
            rate = finder.rate()
            status = [radio.status(),
                      (f'{src.label}: {rate:.0f} fps' + ('' if rate >= 12 or not finder.ready() else
                                                               ', too slow to see a 4 Hz flash'),
                       GREEN if rate >= 12 or not finder.ready() else AMBER),
                      (f'calibration {cal["name"]}: ' + (f'{len(cal["points"])} spots' if cal['points'] else
                                                         'placed in the 3D model') if cal else
                       'not calibrated: no map position', GREY if cal else AMBER),
                      positions.status()]
            canvas = render_watch(layout, frame, cal, list(incidents.values()), quiet, status,
                                  time.monotonic() - started, placed)
            for inc in newly:
                folder = save_incident(args.out, inc, canvas, list(clip), rate or 30.0, camera)
                log('located', band=inc['band'], zone=inc['zone'], image=[round(v, 3) for v in inc['pos']],
                    map=[round(v, 1) for v in inc['map']] if inc['map'] else None,
                    radio=inc['radio']['px'] if inc.get('radio') else None,
                    radio_off_m=round(inc['agree_m'], 2) if inc.get('agree_m') is not None else None,
                    seconds=round(inc['located'] - inc['opened'], 2),
                    saved=os.path.relpath(folder, ROOT) if folder.startswith(ROOT) else folder)
                sound(FOUND_SOUND, not args.quiet)
            if web:
                tnow = time.monotonic() - started
                if web.frame_due(tnow):
                    web.put_frame(draw_live(frame, cal, list(incidents.values()), quiet, tnow))
                if web.state_due(tnow):
                    web.put_state(web_state(list(incidents.values()), quiet, placed, bands, status, rate, cal, scene,
                                            now))
                if web.take_acks():
                    for inc in incidents.values():
                        if not inc['ack']:
                            inc['ack'] = True
                            log('acknowledged', band=inc['band'], by='page')
            busy += time.perf_counter() - work
            frames += 1
            if args.record:
                if recorder is None:
                    recorder = cv2.VideoWriter(args.record, cv2.VideoWriter_fourcc(*'mp4v'), args.record_fps,
                                               (canvas.shape[1], canvas.shape[0]))
                    say(f'recording the view to {args.record}')
                recorder.write(canvas)
            if not args.headless:
                cv2.imshow(WIN, canvas)
                key = cv2.waitKey(1) & 0xFF
                if key in (ord('q'), 27):
                    break
                if key == ord('a'):
                    for inc in incidents.values():
                        if not inc['ack']:
                            inc['ack'] = True
                            log('acknowledged', band=inc['band'])
            if args.seconds and time.monotonic() - started >= args.seconds:
                break
    except KeyboardInterrupt:
        pass
    if recorder is not None:
        recorder.release()
    say(f'{frames} frames, {1000 * busy / max(1, frames):.1f} ms of work per frame')


def parse_spots(text):
    spots = []
    for part in (text or '').split(';'):
        if part.strip():
            x, y = part.split(',')
            spots.append((float(x), float(y)))
    return spots


def render_cal(layout, frame, snapshot, points, pending, flashes, zoom_centre, notes, tnow):
    canvas = base_canvas(layout, frame, snapshot)
    layout.draw_maps(canvas, zoom_centre)
    for tr in flashes:
        marker(canvas, at(layout.live_rect, tr['pos']), WHITE, 'band blinking', False, tnow, LIVE_W)
    for n, p in enumerate(points, 1):
        for rect in (layout.live_rect, layout.lit_rect):
            if rect:
                pt = at(rect, p['image'])
                cv2.circle(canvas, pt, 6, GREEN, -1, cv2.LINE_AA)
                text(canvas, str(n), (pt[0] + 8, pt[1] - 6), GREEN, 0.55, 2)
        for img, f, _ in layout.targets(canvas):
            pt = f(p['map'])
            cv2.circle(img, pt, 5, GREEN, -1, cv2.LINE_AA)
            text(img, str(n), (pt[0] + 7, pt[1] - 5), GREEN, 0.5, 1)
    if pending:
        for img, f, _ in layout.targets(canvas):
            cv2.drawMarker(img, f(pending), AMBER, cv2.MARKER_CROSS, 18, 2, cv2.LINE_AA)
    layout.finish(canvas)
    y = LIVE_H + 30
    text(canvas, 'BandIt camera calibration', (16, y), WHITE, 0.7, 2)
    for line, colour in notes:
        y += 26
        text(canvas, line, (16, y), colour)
    text(canvas, 'click map: choose spot   click camera: place spot by hand   space: new snapshot   u: undo   s: save   q: quit',
         (16, CANVAS_H - 14), GREY, 0.5)
    return canvas


def calibrate(args):
    signal.signal(signal.SIGTERM, stop)
    if not args.name:
        raise SystemExit('calibrate needs --name, the name of this camera position')
    if args.gateway and not args.band:
        raise SystemExit('--gateway needs --band, the band the helper wears')
    _, plan = load_plan(args.venue)
    layout = Layout(plan)
    src = Source(args.camera if args.camera is not None else '0', args.fast)
    finder = FlashFinder(IDENT_HZ, 'white')
    gateway = Gateway(args.gateway) if args.gateway else None
    spots = parse_spots(args.spots)
    st = {'click': None}
    if not args.headless:
        cv2.namedWindow(WIN, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(WIN, *args.window)
        cv2.setMouseCallback(WIN, lambda e, x, y, f, s: s.update(click=(x, y)) if e == cv2.EVENT_LBUTTONDOWN else None, st)
    snapshot, points, pending, last_ident, flashes = None, [], None, 0.0, []
    zoom_centre = (plan.shape[1] / 2, plan.shape[0] / 2)
    t_first, frames, frame, saved = None, 0, None, None
    say(f'calibrating {args.name} from {src.name}')

    def record(pos, how):
        nonlocal pending
        points.append({'image': [round(pos[0], 4), round(pos[1], 4)], 'map': [round(pending[0], 1), round(pending[1], 1)],
                       'how': how})
        say(f'spot {len(points)}: picture {points[-1]["image"]} is map {points[-1]["map"]} ({how})')
        pending = None

    try:
        while True:
            t, got = src.read()
            if got is None:
                break
            frame = got
            t_first = t if t_first is None else t_first
            if snapshot is None and t - t_first >= 1.0:
                snapshot = frame.copy()
                say('lit snapshot taken')
            finder.add(t, pool(frame, args.analysis_width))
            if frames % EVERY == 0 and finder.ready():
                flashes = finder.update(t)
            if pending is None and spots:
                pending = spots.pop(0)
                zoom_centre = pending
                say(f'spot {len(points) + 1}: waiting for the band at map {pending}')
            if pending and gateway and time.monotonic() - last_ident >= IDENT_EVERY_S:
                gateway.send(f'cmd {args.band} state 8 {IDENT_HOLD}')
                last_ident = time.monotonic()
            if pending:
                ready = [tr for tr in flashes if t - tr['still_since'] >= STILL_S and tr.get('hit')
                         and all(math.dist(tr['pos'], p['image']) > NEW_SPOT for p in points)]
                if ready:
                    record(max(ready, key=lambda tr: tr['strength'])['pos'], 'flash')
            if st['click']:
                where, pos = layout.click(st['click'])
                st['click'] = None
                if where in ('map', 'zoom'):
                    pending = pos
                    if where == 'map':
                        zoom_centre = pos
                    last_ident = 0.0
                elif where == 'live' and pending:
                    record(pos, 'click')
            notes = []
            if snapshot is None:
                notes.append(('taking the lit snapshot', AMBER))
            if pending:
                notes.append((f'spot {len(points) + 1}: waiting for the band blinking at the chosen map spot'
                              + (f' (identify sent to band {args.band})' if gateway else ''), AMBER))
            else:
                notes.append((f'{len(points)} spots recorded: click the next spot on the map', WHITE))
            if len(points) >= 4:
                notes.append(('enough spots to save (s), more spread-out spots make it more exact', GREEN))
            canvas = render_cal(layout, frame, snapshot, points, pending, flashes, zoom_centre, notes,
                                frames / 30.0)
            frames += 1
            if not args.headless:
                cv2.imshow(WIN, canvas)
                key = cv2.waitKey(1) & 0xFF
                if key in (ord('q'), 27):
                    break
                if key == ord(' '):
                    snapshot = frame.copy()
                    say('new lit snapshot taken')
                if key == ord('u') and points:
                    say(f'spot {len(points)} removed')
                    points.pop()
                if key == ord('s'):
                    if len(points) < 4:
                        say(f'{len(points)} spots: at least 4 are needed')
                    elif snapshot is not None:
                        saved = save_cal(args.out, args.name, src.name, frame, snapshot, points, args.venue)
    except KeyboardInterrupt:
        pass
    if args.headless and saved is None and len(points) >= 4 and snapshot is not None:
        save_cal(args.out, args.name, src.name, frame, snapshot, points, args.venue)
    elif saved is None:
        say(f'not saved ({len(points)} spots)')


ANCHOR_KEYS = {ord(str(i)): 100 + i for i in range(1, 6)}
ANCHOR_KEYS[ord('g')] = 200


def anchor_name(aid):
    return 'gateway' if aid == 200 else f'station {aid}'


def save_anchors(path, placed_px, mpp, venue):
    data = {'anchors': {str(a): [round(x * mpp, 3), round(y * mpp, 3)] for a, (x, y) in sorted(placed_px.items())},
            'plan': {'origin': [0.0, 0.0], 'metres_per_px': mpp},
            'plan_px': {str(a): [round(x, 1), round(y, 1)] for a, (x, y) in sorted(placed_px.items())},
            'venue': os.path.relpath(venue, ROOT), 'created': iso(time.time())}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(data, f, indent=1)
    say(f'saved {path}: {", ".join(anchor_name(a) for a in sorted(placed_px))}, {mpp:.4f} m per plan pixel')
    if len(placed_px) < 3:
        say('fewer than three anchors: two alone cannot tell which side of the line between them a band is on')


def render_anchors(layout, placed_px, selected, measure, mpp, zoom_centre, notes):
    canvas = np.full((CANVAS_H, CANVAS_W, 3), DARK, np.uint8)
    img, layout.live_rect = fit(layout.plan, layout.live_box)
    paste(canvas, img, layout.live_rect)
    layout.draw_maps(canvas, zoom_centre)
    ph, pw = layout.plan.shape[:2]
    big = lambda m: at(layout.live_rect, (m[0] / pw, m[1] / ph))
    views = ((canvas, big),) + tuple((img, f) for img, f, _ in layout.targets(canvas))
    for a, m in sorted(placed_px.items()):
        for img, f in views:
            q = f(m)
            cv2.circle(img, q, 6, (0, 0, 0), -1, cv2.LINE_AA)
            cv2.circle(img, q, 5, AMBER if a == 200 else GREEN, -1, cv2.LINE_AA)
        q = layout.zoom_local(m)
        text(layout.zimg, anchor_name(a), (q[0] + 8, q[1] - 6), WHITE, 0.5)
        q = big(m)
        text(canvas, str(a) if a != 200 else 'gw', (q[0] + 7, q[1] - 5), WHITE, 0.45)
    for i, m in enumerate(measure):
        for img, f in (views[0], views[2]):
            cv2.drawMarker(img, f(m), YELLOW, cv2.MARKER_CROSS, 16, 2, cv2.LINE_AA)
            if i:
                cv2.line(img, f(measure[0]), f(m), YELLOW, 2, cv2.LINE_AA)
    layout.finish(canvas)
    x0 = LIVE_W + 12
    text(canvas, 'BandIt anchors', (x0, 30), WHITE, 0.7, 2)
    lines = [f'placing: {anchor_name(selected)}',
             f'scale: {mpp:.4f} m per plan pixel' if mpp else 'scale: not set (m, then two clicks)',
             '1-5 station 101-105, g gateway', 'click the big plan, then the zoom', 'm measure  s save  q quit']
    for i, line in enumerate(lines):
        text(canvas, line, (x0, 62 + 26 * i), GREY if i > 1 else WHITE, 0.55)
    y = LIVE_H + 30
    for line, colour in notes:
        text(canvas, line, (16, y), colour)
        y += 26
    return canvas


def anchors(args):
    _, plan = load_plan(args.venue)
    layout = Layout(plan)
    placed_px = {}
    for spec in args.place or []:
        aid, _, xy = spec.partition('=')
        x, y = (float(v) for v in xy.split(','))
        placed_px[int(aid)] = (x, y)
    mpp = args.metres_per_px
    if args.headless:
        if not placed_px or not mpp:
            raise SystemExit('without a window, give --place ID=X,Y for each anchor and --metres-per-px')
        save_anchors(args.anchors_out, placed_px, mpp, args.venue)
        return
    st = {'click': None}
    cv2.namedWindow(WIN, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(WIN, *args.window)
    cv2.setMouseCallback(WIN, lambda e, x, y, f, s: s.update(click=(x, y)) if e == cv2.EVENT_LBUTTONDOWN else None, st)
    selected, measuring, measure = 101, False, []
    zoom_centre = (plan.shape[1] / 2, plan.shape[0] / 2)
    notes = [('choose an anchor with 1 to 5 or g, then click where it stands', WHITE)]
    ph, pw = plan.shape[:2]
    while True:
        if st['click']:
            where, pos = layout.click(st['click'])
            st['click'] = None
            point = None
            if where == 'live':
                point = (pos[0] * pw, pos[1] * ph)
                zoom_centre = point
            elif where in ('map', 'zoom'):
                point = pos
                if where == 'map':
                    zoom_centre = point
            if point and measuring and where in ('live', 'zoom'):
                measure.append(point)
                if len(measure) == 2:
                    measuring = False
                    length = math.dist(*measure)
                    if not args.span:
                        notes = [('give --span METRES to turn the measured line into a scale', AMBER)]
                    elif length > 1:
                        mpp = args.span / length
                        notes = [(f'{length:.0f} plan pixels = {args.span} m: {mpp:.4f} m per pixel', GREEN)]
            elif point and not measuring:
                placed_px[selected] = point
                notes = [(f'{anchor_name(selected)} at plan {point[0]:.0f}, {point[1]:.0f}', GREEN)]
        canvas = render_anchors(layout, placed_px, selected, measure, mpp, zoom_centre, notes)
        cv2.imshow(WIN, canvas)
        key = cv2.waitKey(30) & 0xFF
        if key in (ord('q'), 27):
            break
        if key in ANCHOR_KEYS:
            selected = ANCHOR_KEYS[key]
            if selected in placed_px:
                zoom_centre = placed_px[selected]
        if key == ord('m'):
            measuring, measure = True, []
            notes = [(f'click two points {args.span or "?"} m apart (big plan or zoom)', YELLOW)]
        if key == ord('s'):
            if not placed_px or not mpp:
                notes = [('place at least one anchor and set the scale first', AMBER)]
            else:
                save_anchors(args.anchors_out, placed_px, mpp, args.venue)
                notes = [(f'saved {os.path.relpath(args.anchors_out, ROOT)}', GREEN)]


def main():
    ap = argparse.ArgumentParser(description=USAGE, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('mode', choices=['calibrate', 'watch', 'anchors'])
    ap.add_argument('--camera', help='camera index or video file (watch: defaults to the calibrated camera)')
    ap.add_argument('--name', help='camera position name, for example pit')
    ap.add_argument('--venue', default=VENUE)
    ap.add_argument('--radio', help='radio file to follow instead of the newest one the recorder writes')
    ap.add_argument('--positions', help='positions file to follow instead of the newest pipeline/data/positions_*')
    ap.add_argument('--place', action='append', help='anchors: ID=X,Y in plan pixels, for example 101=1480,650')
    ap.add_argument('--metres-per-px', type=float, help='anchors: the plan scale, if known')
    ap.add_argument('--span', type=float, help='anchors: metres between the two points clicked after m')
    ap.add_argument('--anchors-out', default=os.path.join(OUT, 'anchors.json'))
    ap.add_argument('--gateway', help='calibrate: gateway port or the recorder\'s --mirror path')
    ap.add_argument('--band', type=int, help='calibrate: the band the helper wears')
    ap.add_argument('--spots', help='calibrate: map spots in order, X,Y;X,Y;...')
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--analysis-width', type=int, default=ANALYSIS_W)
    ap.add_argument('--window', type=int, nargs=2, default=[1440, 810])
    ap.add_argument('--headless', action='store_true')
    ap.add_argument('--fast', action='store_true', help='video files: run as fast as possible, not in real time')
    ap.add_argument('--quiet', action='store_true', help='no alarm sounds')
    ap.add_argument('--seconds', type=float, default=0)
    ap.add_argument('--record', help='watch: also write the whole view, frame by frame, to this .mp4')
    ap.add_argument('--record-fps', type=float, default=30.0)
    ap.add_argument('--serve', type=int, metavar='PORT', help='watch: also serve the security page on this port')
    ap.add_argument('--host', default='127.0.0.1', help='watch: address for the page (0.0.0.0 for other screens)')
    ap.add_argument('--anchors', default=os.path.join(OUT, 'anchors.json'), help='watch: stations for the page')
    ap.add_argument('--splat', default=SPLAT, help='watch: the folder splat.py works in')
    args = ap.parse_args()
    {'calibrate': calibrate, 'watch': watch, 'anchors': anchors}[args.mode](args)


if __name__ == '__main__':
    main()
