import argparse
import base64
import glob
import gzip
import hashlib
import http.server
import itertools
import json
import math
import os
import shutil
import socketserver
import struct
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import datetime, timezone

import cv2
import numpy as np
import requests

from elastic import DATA, ROOT

USAGE = """where each event photo was taken, found in the venue's Gaussian splat, and whose bands it caught

  python3 pipeline/photo_place.py map                  a 3D feature map of the venue, rendered from the splat
  python3 pipeline/photo_place.py align                where the splat sits on the venue map (web/venue)
  python3 pipeline/photo_place.py locate PHOTO ...     each photo's camera: where, which way, which lens
  python3 pipeline/photo_place.py place [--positions F | --test-bands 12]   landmarks and bands in each photo
  python3 pipeline/photo_place.py view                 the venue in 3D with every photo where it was taken
  python3 pipeline/photo_place.py test                 how accurate locate is, on views the map never saw

The splat (assets/venue/hall.spz, 2.9 million Gaussians trained from a walk through the hall) is the venue model.
Its file is in the frame of the walk's COLMAP run; hall-splat.json turns that into splat units with +y up and the
floor at y = 0. Poses here are in those units: x and z across the floor, y up.

map renders the splat with the GPU through headless Chrome (Spark, the same renderer as the security page) from
standing height all over the floor: every --spacing units (3) where the floor is open, eight directions each, a
colour view and a depth view. The depth view comes from the splat itself: each Gaussian is coloured by its distance
in three linear ranges, so the blended pixel is the depth the colour view shows there. Every SuperPoint feature of
every colour view is lifted to the 3D point it shows: a point cloud in which each point carries the look of the venue
around it, like the output of photogrammetry, but taken from the splat. About 25 minutes, into
pipeline/data/venue/photo_map. Features and matching are SuperPoint and LightGlue (github.com/cvg/LightGlue, on the
GPU through Metal), which match a sharp photo to the softer splat many times better than SIFT does.

align finds the 2D similarity that puts the splat's walls on the outline of the venue map's floor (web/venue/floor.json)
by trying every rotation and a range of scales, the shift for each found by FFT correlation. Walls alone slide along a
curved hall, so it then refines in 3D against the venue model (web/venue/venue.glb, with its tables, bleacher stairs
and mezzanine) by trimmed ICP from 75 starts. It says what share of the splat's floor lands on the venue's floor and
how close the splat ends to the model, and draws both in align.png to check by eye. The scale is the size of one
splat unit in metres (0.86 for hall.spz). --pairs takes hand-picked point pairs instead.

locate scores every map view against the photo on the GPU: how many photo features have a clear, mutual best match
among the view's. LightGlue then matches the photo to each of the best 30 views, spread out, and PnP on the matched
map points ranks them. From each of the best few it renders the splat with the photo's own lens, matches the photo
to the render with LightGlue, solves the camera from the 2D to 3D matches (RANSAC on four-point samples, then
Levenberg-Marquardt) and renders again from there, until the camera stops moving. The guess that converges with the
most agreeing features wins. The lens comes from the photo's EXIF (35 mm equivalent focal length), else it is solved
with the pose. Each photo gets a record (its camera, how many features agree, their error in pixels) and an overlay:
the photo next to, blended with and checkered against the splat seen from where the photo was taken.

place turns each camera into venue terms: its spot in metres on the venue map, the landmarks it shows (sponsor tables,
stage, doors and areas from web/venue/spots.json, hidden ones left out by the splat's depth), and whose bands it
caught. A band is in a photo when most of its position circle at chest height falls inside the frame within 15 m and
in front of what the splat shows there; the band at the camera is the photographer's. Band positions come from
ranging.py --positions (metres in the venue frame, the line nearest the photo's time); without radio data,
--test-bands places seeded test wearers around each photo. The result, places.json, says who to send each photo to.

view serves the 3D page: the splat with every photo hanging where it was taken, its landmarks and its bands. Pick a
photo, then "Through the lens" flies into its camera and lays the photo over the splat.

test renders views between the map's viewpoints with random height, direction and lens, darkens, blurs and recompresses
them like a phone photo would be, locates each and prints how far off position and direction come out."""

SPLAT = os.path.join(ROOT, 'assets', 'venue', 'hall.spz')
SPLAT_META = os.path.join(ROOT, 'assets', 'venue', 'hall-splat.json')
WEB = os.path.join(ROOT, 'pipeline', 'photo_place_web')
FLOOR = os.path.join(ROOT, 'web', 'venue', 'floor.json')
SPOTS = os.path.join(ROOT, 'web', 'venue', 'spots.json')
VENUE_GLB = os.path.join(ROOT, 'web', 'venue', 'venue.glb')
WORK = os.path.join(DATA, 'venue', 'photo_map')
VENDOR = os.path.join(DATA, 'web-vendor')
CDN = 'https://cdn.jsdelivr.net/npm/'
VENDOR_PACKAGES = ('three@0.180.0/', '@sparkjsdev/spark@2.4.0/')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
SH_C0 = 0.28209479177387814
EYE_M = 1.6
MAP_W, MAP_H, MAP_HFOV = 1024, 768, 90.0
CV_FROM_GL = np.diag([1.0, -1.0, -1.0, 1.0])


def say(text):
    print(f'{time.strftime("%H:%M:%S")} {text}', flush=True)


def load_splat(path=SPLAT, meta=SPLAT_META):
    raw = gzip.decompress(open(path, 'rb').read())
    magic, version, n, sh, frac, _flags, _ = struct.unpack('<IIIBBBB', raw[:16])
    if magic != 0x5053474E or version not in (2, 3):
        sys.exit(f'{path} is not an SPZ file of version 2 or 3')
    off = 16

    def take(size):
        nonlocal off
        block = np.frombuffer(raw, np.uint8, size, off)
        off += size
        return block

    p = take(n * 9).reshape(n, 3, 3).astype(np.int32)
    fixed = p[..., 0] | (p[..., 1] << 8) | (p[..., 2] << 16)
    xyz = np.where(fixed & 0x800000, fixed - (1 << 24), fixed).astype(np.float32) / (1 << frac)
    alpha = take(n).astype(np.float32) / 255.0
    rgb = np.clip(0.5 + SH_C0 * (take(n * 3).reshape(n, 3) / 255.0 - 0.5) / 0.15, 0, 1).astype(np.float32)
    scale = np.exp(take(n * 3).reshape(n, 3).astype(np.float32) / 16.0 - 10.0)
    m = np.array(json.load(open(meta))['toMetresYUp_rowMajor'], np.float64).reshape(4, 4)
    s = float(np.cbrt(abs(np.linalg.det(m[:3, :3]))))
    return {'xyz': (xyz @ m[:3, :3].T + m[:3, 3]).astype(np.float32), 'alpha': alpha, 'rgb': rgb,
            'size': scale.max(1) * s, 'matrix': m}


def cut_splat(path, out, keep_fn, meta=SPLAT_META):
    raw = gzip.decompress(open(path, 'rb').read())
    magic, version, n, sh, frac, flags, res = struct.unpack('<IIIBBBB', raw[:16])
    m = np.array(json.load(open(meta))['toMetresYUp_rowMajor'], np.float64).reshape(4, 4)
    p = np.frombuffer(raw, np.uint8, n * 9, 16).reshape(n, 3, 3).astype(np.int32)
    fixed = p[..., 0] | (p[..., 1] << 8) | (p[..., 2] << 16)
    xyz = np.where(fixed & 0x800000, fixed - (1 << 24), fixed).astype(np.float64) / (1 << frac)
    alpha = np.frombuffer(raw, np.uint8, n, 16 + n * 9) / 255.0
    scales = np.frombuffer(raw, np.uint8, n * 3, 16 + n * 13).reshape(n, 3)
    size = np.exp(scales.max(1) / 16.0 - 10.0) * np.cbrt(abs(np.linalg.det(m[:3, :3])))
    keep = keep_fn(xyz @ m[:3, :3].T + m[:3, 3], alpha, size)
    sh_dim = {0: 0, 1: 3, 2: 8, 3: 15}[sh]
    sizes = [9, 1, 3, 3, 4 if version >= 3 else 3, sh_dim * 3]
    parts, off = [], 16
    for size in sizes:
        block = np.frombuffer(raw, np.uint8, n * size, off).reshape(n, size) if size else np.zeros((n, 0), np.uint8)
        parts.append(block[keep].tobytes())
        off += n * size
    header = struct.pack('<IIIBBBB', magic, version, int(keep.sum()), sh, frac, flags, res)
    with open(out, 'wb') as f:
        f.write(gzip.compress(header + b''.join(parts), compresslevel=6))
    return int(keep.sum()), n


def look_at(pos, yaw_deg, pitch_deg):
    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    f = np.array([math.cos(pitch) * math.cos(yaw), math.sin(pitch), math.cos(pitch) * math.sin(yaw)])
    r = np.cross(f, [0.0, 1.0, 0.0])
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    m = np.eye(4)
    m[:3, 0], m[:3, 1], m[:3, 2], m[:3, 3] = r, u, -f, pos
    return m


def intrinsics(f, w, h):
    return np.array([[f, 0, w / 2], [0, f, h / 2], [0, 0, 1]], np.float64)


def fov_y(f, h):
    return math.degrees(2 * math.atan(h / 2 / f))


def describe_pose(c2w_gl):
    fwd, up = -c2w_gl[:3, 2], c2w_gl[:3, 1]
    heading = math.degrees(math.atan2(fwd[2], fwd[0])) % 360
    pitch = math.degrees(math.asin(np.clip(fwd[1], -1, 1)))
    right = np.cross(fwd, [0, 1, 0])
    roll = 0.0
    if np.linalg.norm(right) > 1e-6:
        right /= np.linalg.norm(right)
        roll = math.degrees(math.atan2(np.dot(up, right), np.dot(up, np.cross(right, fwd))))
    return {'position': [round(float(v), 3) for v in c2w_gl[:3, 3]], 'heading_deg': round(heading, 1),
            'pitch_deg': round(pitch, 1), 'roll_deg': round(roll, 1)}


class Pages(http.server.SimpleHTTPRequestHandler):
    server_version = 'photo_place'

    def log_message(self, *_):
        pass

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/scene.json' and getattr(self.server, 'cut', None):
            return self.send(json.dumps({'splat': '/splat.spz', 'cut': '/splat_cut.spz', 'matrix': self.server.matrix_col})
                             .encode(), 'application/json')
        if path == '/scene.json':
            return self.send(json.dumps({'splat': '/splat.spz', 'matrix': self.server.matrix_col}).encode(), 'application/json')
        if path == '/splat.spz':
            return self.file(SPLAT, 'application/octet-stream')
        if path.startswith('/vendor/'):
            return self.vendor(path[len('/vendor/'):])
        extra = self.server.routes.get(path) if hasattr(self.server, 'routes') else None
        if extra:
            return self.file(*extra) if isinstance(extra, tuple) else self.send(*extra())
        local = os.path.normpath(os.path.join(WEB, path.lstrip('/')))
        if local.startswith(WEB) and os.path.isfile(local):
            kind = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'}.get(os.path.splitext(local)[1])
            return self.file(local, kind or 'application/octet-stream')
        self.send_error(404)

    def send(self, data, kind):
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def file(self, path, kind):
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(os.path.getsize(path)))
        self.end_headers()
        with open(path, 'rb') as f:
            shutil.copyfileobj(f, self.wfile)

    def vendor(self, rel):
        if '..' in rel or not rel.startswith(VENDOR_PACKAGES):
            return self.send_error(404)
        local = os.path.join(VENDOR, rel)
        if not os.path.exists(local):
            try:
                r = requests.get(CDN + rel, timeout=30)
                r.raise_for_status()
                data = r.content
            except requests.RequestException as e:
                say(f'cannot fetch {rel} from jsDelivr ({e})')
                return self.send_error(502)
            os.makedirs(os.path.dirname(local), exist_ok=True)
            with open(local + '.part', 'wb') as f:
                f.write(data)
            os.replace(local + '.part', local)
        self.file(local, 'text/javascript')


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def serve(port, matrix, routes=None, host='127.0.0.1'):
    srv = Server((host, port), Pages)
    srv.matrix_col = [float(v) for v in np.asarray(matrix).T.flatten()]
    srv.routes = routes or {}
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


class Chrome:

    def __init__(self, url, chrome=CHROME, port=9334):
        import websocket
        self.profile = os.path.join(WORK, '.chrome')
        shutil.rmtree(self.profile, ignore_errors=True)
        self.proc = subprocess.Popen([chrome, '--headless=new', f'--remote-debugging-port={port}',
                                      f'--user-data-dir={self.profile}', '--no-first-run', '--no-default-browser-check',
                                      '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling',
                                      '--disable-renderer-backgrounding', '--ignore-gpu-blocklist', 'about:blank'],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        ws_url = None
        for _ in range(150):
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version', timeout=1) as r:
                    ws_url = json.load(r)['webSocketDebuggerUrl']
                break
            except OSError:
                time.sleep(0.1)
        if not ws_url:
            self.close()
            sys.exit(f'Chrome did not start ({chrome})')
        self.ws = websocket.create_connection(ws_url, timeout=120, suppress_origin=True)
        self.ids = itertools.count(1)
        target = self.call('Target.createTarget', {'url': 'about:blank'})['targetId']
        self.session = self.call('Target.attachToTarget', {'targetId': target, 'flatten': True})['sessionId']
        self.call('Runtime.enable', session=self.session)
        self.call('Page.enable', session=self.session)
        self.errors = []
        self.call('Page.navigate', {'url': url}, session=self.session)
        ready = self.js('window.ready', wait_for='window.ready')
        if ready != 'ready':
            self.close()
            sys.exit(f'the render page did not load the splat: {ready} {self.errors[:3]}')
        for _ in range(3):
            self.render(look_at(np.array([0.0, EYE_M, 0.0]), 0, 0), 500, 640, 480, depth_scale=0.5, frames=20)

    def call(self, method, params=None, session=None):
        i = next(self.ids)
        msg = {'id': i, 'method': method, 'params': params or {}}
        if session:
            msg['sessionId'] = session
        self.ws.send(json.dumps(msg))
        while True:
            reply = json.loads(self.ws.recv())
            if reply.get('method') == 'Runtime.exceptionThrown':
                self.errors.append(reply['params']['exceptionDetails'].get('exception', {}).get('description'))
            if reply.get('id') == i:
                if 'error' in reply:
                    raise RuntimeError(f'{method}: {reply["error"]}')
                return reply.get('result', {})

    def js(self, expression, wait_for=None):
        if wait_for:
            for _ in range(600):
                if self.call('Runtime.evaluate', {'expression': f'typeof {wait_for} !== "undefined"', 'returnByValue': True},
                             session=self.session)['result'].get('value'):
                    break
                time.sleep(0.1)
        r = self.call('Runtime.evaluate', {'expression': expression, 'returnByValue': True, 'awaitPromise': True},
                      session=self.session)
        if 'exceptionDetails' in r:
            raise RuntimeError(r['exceptionDetails'].get('exception', {}).get('description', 'render page error'))
        return r['result'].get('value')

    def render(self, c2w_gl, f, w, h, depth_scale=0.5, frames=6):
        dw, dh = (int(round(w * depth_scale)), int(round(h * depth_scale))) if depth_scale else (0, 0)
        out = self.js(f'window.render({json.dumps([float(v) for v in c2w_gl.T.flatten()])}, {fov_y(f, h)}, {w}, {h}, '
                      f'{dw}, {dh}, {frames})')
        colour = cv2.imdecode(np.frombuffer(base64.b64decode(out['colour']), np.uint8), cv2.IMREAD_COLOR)
        depth = decode_depth(out['depth']) if out['depth'] else None
        return colour, depth

    def close(self):
        try:
            self.proc.terminate()
            self.proc.wait(5)
        except Exception:
            self.proc.kill()
        shutil.rmtree(self.profile, ignore_errors=True)


def decode_depth(png_b64):
    img = cv2.imdecode(np.frombuffer(base64.b64decode(png_b64), np.uint8), cv2.IMREAD_UNCHANGED).astype(np.float32)
    far, mid, near, cover = img[..., 2] * (100 / 255), img[..., 1] * (25 / 255), img[..., 0] * (6 / 255), img[..., 3] / 255
    d = far.copy()
    use_mid = (mid < 21) & (np.abs(mid - far) < np.maximum(0.8, 0.08 * far))
    d[use_mid] = mid[use_mid]
    use_near = use_mid & (near < 5) & (np.abs(near - mid) < 0.3)
    d[use_near] = near[use_near]
    bad = (cover < 0.7) | (~use_mid & (far < 21)) | (d < 0.3)
    d[bad] = np.nan
    return d


def sample_depth(depth, pts, scale):
    h, w = depth.shape
    u = np.clip(np.round(pts[:, 0] * scale).astype(int), 1, w - 2)
    v = np.clip(np.round(pts[:, 1] * scale).astype(int), 1, h - 2)
    patch = np.stack([depth[v + dv, u + du] for dv in (-1, 0, 1) for du in (-1, 0, 1)], 1)
    d = depth[v, u]
    finite = np.isfinite(patch)
    filled = np.where(finite, patch, d[:, None])
    near_ok = finite & (np.abs(filled - d[:, None]) < 0.06 * d[:, None] + 0.05)
    ok = np.isfinite(d) & (near_ok.sum(1) >= 5)
    return np.where(ok, d, np.nan)


def lift(pts, d, K, c2w_gl):
    rays = np.c_[(pts[:, 0] - K[0, 2]) / K[0, 0], (pts[:, 1] - K[1, 2]) / K[1, 1], np.ones(len(pts))]
    cam = rays * d[:, None]
    c2w = c2w_gl @ CV_FROM_GL
    return (cam @ c2w[:3, :3].T + c2w[:3, 3]).astype(np.float32)


class Net:

    def __init__(self, keypoints=4096):
        import torch
        from lightglue import LightGlue, SuperPoint
        if not os.environ.get('SSL_CERT_FILE'):
            import certifi
            os.environ['SSL_CERT_FILE'] = certifi.where()
        self.torch = torch
        self.dev = torch.device('mps' if torch.backends.mps.is_available() else 'cpu')
        self.sp = SuperPoint(max_num_keypoints=keypoints).eval().to(self.dev)
        self.lg = LightGlue(features='superpoint').eval().to(self.dev)

    def extract(self, bgr):
        torch = self.torch
        img = torch.from_numpy(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)).permute(2, 0, 1).float().div(255).to(self.dev)
        with torch.no_grad():
            f = self.sp.extract(img)
        return f['keypoints'][0].cpu().numpy(), f['descriptors'][0].cpu().numpy(), f

    def feats(self, kp, desc, size):
        t = self.torch
        return {'keypoints': t.from_numpy(np.ascontiguousarray(kp, np.float32))[None].to(self.dev),
                'descriptors': t.from_numpy(np.ascontiguousarray(desc, np.float32))[None].to(self.dev),
                'image_size': t.tensor([[float(size[0]), float(size[1])]], device=self.dev)}

    def match(self, fa, fb):
        with self.torch.no_grad():
            out = self.lg({'image0': fa, 'image1': fb})
        return out['matches'][0].cpu().numpy()


def open_floor(splat, cell=1.0):
    xyz, a = splat['xyz'], splat['alpha']
    solid = a > 0.25
    lo = np.percentile(xyz[solid][:, [0, 2]], 0.5, axis=0) - 2
    hi = np.percentile(xyz[solid][:, [0, 2]], 99.5, axis=0) + 2
    nx, nz = (np.ceil((hi - lo) / cell)).astype(int) + 1
    ix = ((xyz[:, 0] - lo[0]) / cell).astype(int)
    iz = ((xyz[:, 2] - lo[1]) / cell).astype(int)
    inside = (ix >= 0) & (ix < nx) & (iz >= 0) & (iz < nz)
    floor = np.zeros((nz, nx), np.int32)
    block = np.zeros((nz, nx), np.int32)
    y = xyz[:, 1]
    f = inside & solid & (y > -0.8) & (y < 0.45)
    b = inside & solid & (y > 0.6) & (y < 2.2)
    np.add.at(floor, (iz[f], ix[f]), 1)
    np.add.at(block, (iz[b], ix[b]), 1)
    ok = (floor >= 4) & (block <= 6)
    ok = cv2.erode(ok.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) | (ok & (block == 0))
    return ok, lo, cell


def viewpoints(splat, spacing, seed=7):
    ok, lo, cell = open_floor(splat)
    rng = np.random.default_rng(seed)
    zs, xs = np.nonzero(ok)
    pts = np.c_[lo[0] + (xs + 0.5) * cell, lo[1] + (zs + 0.5) * cell]
    keys = np.floor(pts / spacing).astype(int)
    chosen = {}
    centre = (keys + 0.5) * spacing
    d = np.linalg.norm(pts - centre, axis=1)
    for i in np.argsort(d):
        chosen.setdefault(tuple(keys[i]), pts[i])
    views = []
    for x, z in chosen.values():
        base = rng.uniform(0, 45)
        for k in range(8):
            views.append({'pos': [float(x), EYE_M, float(z)], 'yaw': (base + 45 * k) % 360, 'pitch': 4.0})
    return views


def build_map(args):
    os.makedirs(WORK, exist_ok=True)
    splat = load_splat()
    views = viewpoints(splat, args.spacing)
    if args.limit:
        views = views[:args.limit]
    say(f'{len(splat["xyz"]) / 1e6:.2f} M Gaussians; {len(views) // 8} standing points, {len(views)} views to render')
    net = Net(keypoints=args.features)
    srv = serve(args.port, splat['matrix'])
    chrome = Chrome(f'http://127.0.0.1:{args.port}/render.html', args.chrome)
    f = (MAP_W / 2) / math.tan(math.radians(MAP_HFOV / 2))
    K = intrinsics(f, MAP_W, MAP_H)
    thumbs = os.path.join(WORK, 'views')
    os.makedirs(thumbs, exist_ok=True)
    all_kp, all_desc, all_xyz, all_view, meta = [], [], [], [], []
    t0 = time.time()
    try:
        for i, v in enumerate(views):
            c2w = look_at(np.array(v['pos']), v['yaw'], v['pitch'])
            colour, depth = chrome.render(c2w, f, MAP_W, MAP_H)
            kp, desc, _ = net.extract(colour)
            d = sample_depth(depth, kp, depth.shape[1] / MAP_W)
            keep = np.isfinite(d) & (d < 60)
            all_kp.append(kp[keep].astype(np.float32))
            all_desc.append(desc[keep].astype(np.float16))
            all_xyz.append(lift(kp[keep], d[keep], K, c2w))
            all_view.append(np.full(int(keep.sum()), i, np.int32))
            cv2.imwrite(os.path.join(thumbs, f'{i:05d}.jpg'), cv2.resize(colour, (320, 240), interpolation=cv2.INTER_AREA),
                        [cv2.IMWRITE_JPEG_QUALITY, 80])
            meta.append({'pos': v['pos'], 'yaw': v['yaw'], 'pitch': v['pitch'], 'c2w': c2w.tolist(), 'points': int(keep.sum())})
            if (i + 1) % 80 == 0:
                rate = (time.time() - t0) / (i + 1)
                say(f'{i + 1} of {len(views)} views, {rate:.2f} s each, {(len(views) - i - 1) * rate / 60:.0f} min left')
    finally:
        chrome.close()
        srv.shutdown()
    xyz = np.concatenate(all_xyz)
    np.savez(os.path.join(WORK, 'map.npz'), desc=np.concatenate(all_desc), kp=np.concatenate(all_kp), xyz=xyz,
             view=np.concatenate(all_view))
    json.dump({'views': meta, 'K': K.tolist(), 'size': [MAP_W, MAP_H], 'spacing': args.spacing, 'features': 'superpoint',
               'splat': os.path.relpath(SPLAT, ROOT), 'built': datetime.now(timezone.utc).isoformat(timespec='seconds')},
              open(os.path.join(WORK, 'views.json'), 'w'))
    say(f'map: {len(xyz)} 3D features from {len(views)} views in {(time.time() - t0) / 60:.1f} min -> {WORK}')


class Map:

    def __init__(self, net, per_view=1024):
        path = os.path.join(WORK, 'map.npz')
        if not os.path.exists(path):
            sys.exit(f'no map in {WORK}: run "photo_place.py map" first')
        z = np.load(path)
        if 'kp' not in z:
            sys.exit(f'the map in {WORK} has the older SIFT features: run "photo_place.py map" again')
        self.desc, self.kp, self.xyz, view = z['desc'], z['kp'], z['xyz'], z['view']
        self.meta = json.load(open(os.path.join(WORK, 'views.json')))
        self.views = self.meta['views']
        self.net = net
        n = len(self.views)
        starts = np.searchsorted(view, np.arange(n))
        ends = np.minimum(np.searchsorted(view, np.arange(n), side='right'), starts + per_view)
        packed = np.zeros((n, per_view, self.desc.shape[1]), np.float16)
        self.index = np.full((n, per_view), -1, np.int64)
        for v in range(n):
            k = ends[v] - starts[v]
            packed[v, :k] = self.desc[starts[v]:ends[v]]
            self.index[v, :k] = np.arange(starts[v], ends[v])
        torch = net.torch
        self.torch, self.dev = torch, net.dev
        self.packed = torch.from_numpy(packed).to(self.dev)
        self.valid = torch.from_numpy(self.index >= 0).to(self.dev)
        self.pos = np.array([v['pos'] for v in self.views], np.float32)
        self.yaw = np.array([v['yaw'] for v in self.views], np.float32)

    def score(self, qdesc, ratio=0.9, batch=16):
        torch = self.torch
        q = torch.from_numpy(np.ascontiguousarray(qdesc)).to(self.dev, torch.float16)
        out = torch.zeros(len(self.views), device=self.dev)
        rows = torch.arange(q.shape[0], device=self.dev)[None, :]
        for s in range(0, len(self.views), batch):
            sim = torch.einsum('nd,bmd->bnm', q, self.packed[s:s + batch]).float()
            sim = sim.masked_fill(~self.valid[s:s + batch][:, None, :], -2)
            top, ti = sim.topk(2, dim=2)
            d = torch.sqrt(torch.clamp(2 - 2 * top, min=0))
            mutual = sim.argmax(dim=1).gather(1, ti[..., 0]) == rows
            out[s:s + batch] = ((d[..., 0] < ratio * d[..., 1]) & mutual).sum(1).float()
        return out.cpu().numpy()

    def feats(self, v):
        idx = self.index[v][self.index[v] >= 0]
        return self.net.feats(self.kp[idx], self.desc[idx], self.meta['size']), idx


def photo_focal(path, w, h):
    try:
        from PIL import Image
        exif = Image.open(path).getexif()
        f35 = exif.get_ifd(0x8769).get(0xA405) or exif.get(0xA405)
        if f35:
            return float(f35) * math.hypot(w, h) / math.hypot(36, 24)
    except Exception:
        pass
    return None


def solve_pnp(pts2d, pts3d, K, thresh, iterations=60000):
    if len(pts2d) < 8:
        return None
    p3, p2 = pts3d.astype(np.float64), pts2d.astype(np.float64)
    ok, rvec, tvec, inl = cv2.solvePnPRansac(p3, p2, K, None, iterationsCount=iterations, reprojectionError=thresh,
                                             confidence=0.99999, flags=cv2.SOLVEPNP_AP3P)
    if not ok or inl is None or len(inl) < 6:
        return None
    rvec, tvec = cv2.solvePnPRefineLM(p3[inl[:, 0]], p2[inl[:, 0]], K, None, rvec, tvec)
    inl = np.nonzero(reproj_error(p2, p3, K, rvec, tvec) < thresh)[0]
    return (rvec, tvec, inl) if len(inl) >= 6 else None


def refine_with_focal(pts2d, pts3d, K, rvec, tvec):
    from scipy.optimize import least_squares
    cx, cy = K[0, 2], K[1, 2]

    def residual(p):
        Kp = np.array([[p[6], 0, cx], [0, p[6], cy], [0, 0, 1]])
        proj, _ = cv2.projectPoints(pts3d, p[:3], p[3:6], Kp, None)
        return (proj[:, 0] - pts2d).ravel()

    p0 = np.r_[rvec.ravel(), tvec.ravel(), K[0, 0]]
    r = least_squares(residual, p0, loss='huber', f_scale=2.0, max_nfev=200)
    return r.x[:3].reshape(3, 1), r.x[3:6].reshape(3, 1), float(r.x[6])


def c2w_from(rvec, tvec):
    R, _ = cv2.Rodrigues(rvec)
    w2c = np.eye(4)
    w2c[:3, :3], w2c[:3, 3] = R, tvec.ravel()
    return np.linalg.inv(w2c) @ CV_FROM_GL


def rt_from(c2w_gl):
    w2c = np.linalg.inv(c2w_gl @ CV_FROM_GL)
    return cv2.Rodrigues(w2c[:3, :3])[0], w2c[:3, 3].reshape(3, 1).copy()


def reproj_error(pts2d, pts3d, K, rvec, tvec):
    proj, _ = cv2.projectPoints(pts3d.astype(np.float64), rvec, tvec, K, None)
    return np.linalg.norm(proj[:, 0] - pts2d, axis=1)


class Locator:
    WIDTH = 1024

    def __init__(self, chrome):
        self.net = Net()
        self.map = Map(self.net)
        self.chrome = chrome

    def candidates(self, fphoto, desc, pts, K, w, shortlist=30, keep=6):
        m = self.map
        score = m.score(desc)
        shortlisted = []
        for v in np.argsort(-score):
            if len(shortlisted) >= shortlist:
                break
            if all(np.linalg.norm(m.pos[v] - m.pos[p]) > 2.5 or abs((m.yaw[v] - m.yaw[p] + 180) % 360 - 180) > 40
                   for p in shortlisted):
                shortlisted.append(int(v))
        checked = []
        for v in shortlisted:
            fv, idx = m.feats(v)
            mm = self.net.match(fphoto, fv)
            sol = solve_pnp(pts[mm[:, 0]], m.xyz[idx[mm[:, 1]]], K, 8.0 * w / 1024, iterations=20000) if len(mm) >= 12 else None
            checked.append((len(sol[2]) if sol else 0, len(mm), v, sol))
        checked.sort(key=lambda c: (-c[0], -c[1]))
        return checked[:keep], score

    def step(self, fphoto, pts, K, c2w, w, h, thresh):
        colour, depth = self.chrome.render(c2w, K[0, 0], w, h, depth_scale=0.5)
        rp, _, frender = self.net.extract(colour)
        mm = self.net.match(fphoto, frender)
        if len(mm) < 12:
            return None
        d = sample_depth(depth, rp[mm[:, 1]], depth.shape[1] / w)
        ok = np.isfinite(d)
        p2, p3 = pts[mm[ok, 0]], lift(rp[mm[ok, 1]], d[ok], K, c2w)
        sol = solve_pnp(p2, p3, K, thresh)
        return sol + (p2, p3) if sol else None

    def converge(self, fphoto, pts, K, c2w, w, h, rounds=8):
        history = []
        for k in range(rounds):
            sol = self.step(fphoto, pts, K, c2w, w, h, (8.0 if k < 2 else 4.0) * w / 1024)
            if not sol or (k >= 1 and len(sol[2]) < 15):
                return None, history
            rvec, tvec, inl, p2, p3 = sol
            new = c2w_from(rvec, tvec)
            moved = float(np.linalg.norm(new[:3, 3] - c2w[:3, 3]))
            err = reproj_error(p2[inl], p3[inl], K, rvec, tvec)
            history.append({'inliers': int(len(inl)), 'error_px': round(float(np.median(err)), 2), 'moved': round(moved, 3)})
            c2w = new
            if k >= 2 and moved < 0.02:
                break
        return (c2w, inl, p2, p3), history

    def locate(self, path, focal=None, out_dir=None):
        img = cv2.imread(path)
        if img is None:
            return {'photo': path, 'error': 'cannot read'}
        h0, w0 = img.shape[:2]
        s = self.WIDTH / max(h0, w0)
        img = cv2.resize(img, (int(round(w0 * s)), int(round(h0 * s))), interpolation=cv2.INTER_AREA)
        h, w = img.shape[:2]
        f_exif = photo_focal(path, w0, h0)
        f = (focal or f_exif or 0.8 * max(w0, h0)) * s
        K = intrinsics(f, w, h)
        pts, desc, fphoto = self.net.extract(img)
        rec = {'photo': os.path.abspath(path), 'size': [w0, h0], 'features': int(len(pts)),
               'focal_exif_px': round(f_exif, 1) if f_exif else None}
        checked, score = self.candidates(fphoto, desc, pts, K, w)
        tries, best = [], None
        for inl_count, matches, v, sol in checked:
            start = np.array(self.map.views[v]['c2w'])
            if sol and inl_count >= 10 and np.linalg.norm(c2w_from(sol[0], sol[1])[:3, 3] - start[:3, 3]) < 8:
                start = c2w_from(sol[0], sol[1])
            result, history = self.converge(fphoto, pts, K, start, w, h)
            tries.append({'view': v, 'score': int(score[v]), 'matches': int(matches), 'map_inliers': int(inl_count),
                          'inliers': history[-1]['inliers'] if history else 0, 'converged': result is not None})
            if result and (best is None or len(result[1]) > len(best[0][1])):
                best = (result, history, v)
            if best and len(best[0][1]) >= 300:
                break
        rec['tries'] = tries
        if not best:
            rec['error'] = 'no guess converged on the splat'
            return rec
        (c2w, inl, p2, p3), history, view = best
        if len(inl) >= 40 and not focal and not f_exif:
            rvec, tvec = rt_from(c2w)
            rvec, tvec, f2 = refine_with_focal(p2[inl], p3[inl].astype(np.float64), K, rvec, tvec)
            if 0.4 * w < f2 < 2.5 * w:
                K, c2w = intrinsics(f2, w, h), c2w_from(rvec, tvec)
        last = history[-1]
        rec.update(describe_pose(c2w))
        rec.update({'c2w': np.round(c2w, 6).tolist(), 'focal_px': round(K[0, 0] / s, 1),
                    'hfov_deg': round(math.degrees(2 * math.atan(w / 2 / K[0, 0])), 1), 'inliers': last['inliers'],
                    'error_px': last['error_px'], 'start_view': view, 'refine': history})
        rec['confident'] = bool(last['inliers'] >= 60 and last['error_px'] < 3.0 and last['moved'] < 0.15)
        if out_dir:
            rec['overlay'] = self.overlay(img, c2w, K, out_dir, os.path.splitext(os.path.basename(path))[0])
        return rec

    def overlay(self, img, c2w, K, out_dir, name):
        h, w = img.shape[:2]
        colour, depth = self.chrome.render(c2w, K[0, 0], w, h, depth_scale=0.25)
        os.makedirs(out_dir, exist_ok=True)
        np.save(os.path.join(out_dir, f'{name}_depth.npy'), depth.astype(np.float16))
        cell = max(32, w // 12)
        yy, xx = np.mgrid[0:h, 0:w]
        checker = ((yy // cell + xx // cell) % 2).astype(bool)
        mixed = np.where(checker[..., None], img, colour)
        board = np.vstack([np.hstack([img, colour]), np.hstack([mixed, cv2.addWeighted(img, 0.5, colour, 0.5, 0)])])
        board = cv2.resize(board, (1600, int(1600 * board.shape[0] / board.shape[1])), interpolation=cv2.INTER_AREA)
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, f'{name}_overlay.jpg')
        cv2.imwrite(path, board, [cv2.IMWRITE_JPEG_QUALITY, 88])
        cv2.imwrite(os.path.join(out_dir, f'{name}_splat.jpg'), colour, [cv2.IMWRITE_JPEG_QUALITY, 88])
        return path


def with_renderer(args, fn):
    splat_matrix = np.array(json.load(open(SPLAT_META))['toMetresYUp_rowMajor']).reshape(4, 4)
    srv = serve(args.port, splat_matrix)
    chrome = Chrome(f'http://127.0.0.1:{args.port}/render.html', args.chrome)
    try:
        return fn(chrome)
    finally:
        chrome.close()
        srv.shutdown()


def locate_cmd(args):
    paths = []
    for p in args.photos:
        paths += sorted(glob.glob(os.path.join(p, '*'))) if os.path.isdir(p) else [p]
    paths = [p for p in paths if os.path.splitext(p)[1].lower() in ('.jpg', '.jpeg', '.png', '.heic')]
    out_dir = args.out or os.path.join(WORK, 'located')

    def run(chrome):
        loc = Locator(chrome)
        records = []
        for p in paths:
            t = time.time()
            rec = loc.locate(p, args.focal, out_dir)
            rec['seconds'] = round(time.time() - t, 1)
            records.append(rec)
            if 'error' in rec:
                say(f'{os.path.basename(p)}: {rec["error"]}')
            else:
                x, y, z = rec['position']
                say(f'{os.path.basename(p)}: at x {x:.2f} z {z:.2f} m, {y:.2f} m up, heading {rec["heading_deg"]:.0f}, '
                    f'pitch {rec["pitch_deg"]:.0f}, {rec["hfov_deg"]:.0f} deg lens; {rec["inliers"]} features agree, '
                    f'{rec["error_px"]} px; {"confident" if rec["confident"] else "unsure"} ({rec["seconds"]} s)')
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, 'photos.json')
        old = {r['photo']: r for r in json.load(open(path))} if os.path.exists(path) else {}
        old.update({r['photo']: r for r in records})
        json.dump(list(old.values()), open(path, 'w'), indent=1)
        say(f'{sum(1 for r in records if r.get("confident"))} of {len(records)} placed with confidence -> {path}')

    with_renderer(args, run)


def rot2(deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array([[c, -s], [s, c]])


def venue_floor():
    f = json.load(open(FLOOR))
    cells = np.zeros(f['cols'] * f['rows'], np.uint8)
    pos, val = 0, 0
    for run in f['runs']:
        cells[pos:pos + run] = val
        pos += run
        val ^= 1
    return cells.reshape(f['rows'], f['cols']), float(f['x0']), float(f['z0']), float(f['cell'])


def wall_cells(splat, res):
    xyz, a = splat['xyz'], splat['alpha']
    w = xyz[(a > 0.3) & (xyz[:, 1] > 2.5) & (xyz[:, 1] < 6.0)][:, [0, 2]]
    key, cnt = np.unique(np.floor(w / res).astype(int), axis=0, return_counts=True)
    return (key[cnt >= 8] + 0.5) * res


def floor_cells(splat, res):
    xyz, a = splat['xyz'], splat['alpha']
    f = xyz[(a > 0.25) & (xyz[:, 1] > -0.8) & (xyz[:, 1] < 0.45)][:, [0, 2]]
    key, cnt = np.unique(np.floor(f / res).astype(int), axis=0, return_counts=True)
    return (key[cnt >= 6] + 0.5) * res


def align_search(splat, res=0.5):
    from scipy.signal import fftconvolve
    mask, x0, z0, cell = venue_floor()
    vm = cv2.resize(mask.astype(np.float32), None, fx=cell / res, fy=cell / res, interpolation=cv2.INTER_AREA)
    hall = cv2.morphologyEx((vm > 0.3).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    edge = cv2.morphologyEx(hall, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8))
    pad = 160
    dist = np.pad(np.minimum(cv2.distanceTransform(1 - edge, cv2.DIST_L2, 5) * res, 4.0), pad, constant_values=4.0)
    walls = wall_cells(splat, res)
    centre = np.median(walls, 0)

    def score(scale, ang):
        R = rot2(ang)
        q = (walls - centre) @ R.T * scale / res
        off = -q.min(0)
        q += off
        img = np.zeros((int(q[:, 1].max()) + 2, int(q[:, 0].max()) + 2), np.float32)
        np.add.at(img, (q[:, 1].astype(int), q[:, 0].astype(int)), 1)
        if img.shape[0] > dist.shape[0] or img.shape[1] > dist.shape[1]:
            return None
        sc = fftconvolve(dist, img[::-1, ::-1], mode='valid') / img.sum()
        k = np.unravel_index(np.argmin(sc), sc.shape)
        shift = np.array([x0, z0]) + res * (off + np.array([k[1], k[0]]) - pad) - scale * R @ centre
        return float(sc[k]), float(scale), float(ang), shift

    coarse = [r for r in (score(s, a) for s in np.arange(0.8, 1.201, 0.02) for a in np.arange(-180, 180, 1.5)) if r]
    coarse.sort(key=lambda r: r[0])
    b = coarse[0]
    fine = [r for r in (score(s, a) for s in np.arange(b[1] - 0.03, b[1] + 0.0301, 0.005)
                        for a in np.arange(b[2] - 2, b[2] + 2.01, 0.25)) if r]
    best = min(fine, key=lambda r: r[0])
    rival = next((r for r in coarse if abs((r[2] - best[2] + 180) % 360 - 180) > 20), None)
    return best, rival, (hall, x0, z0, res)


def glb_triangles(path):
    data = open(path, 'rb').read()
    jlen = struct.unpack('<I', data[12:16])[0]
    g = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blob = data[off + 8:off + 8 + struct.unpack('<I', data[off:off + 4])[0]]

    def accessor(i):
        a = g['accessors'][i]
        bv = g['bufferViews'][a['bufferView']]
        kind = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a['componentType']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        size = np.dtype(kind).itemsize * n
        stride = bv.get('byteStride') or size
        raw = np.frombuffer(blob, np.uint8, (a['count'] - 1) * stride + size, start)
        rows = np.lib.stride_tricks.as_strided(raw, (a['count'], size), (stride, 1))
        return np.frombuffer(rows.tobytes(), kind).reshape(a['count'], n)

    def local(nd):
        if 'matrix' in nd:
            return np.array(nd['matrix'], float).reshape(4, 4).T
        m = np.eye(4)
        if 'scale' in nd:
            m = np.diag(list(nd['scale']) + [1.0]) @ m
        if 'rotation' in nd:
            x, y, z, w = nd['rotation']
            r = np.eye(4)
            r[:3, :3] = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                         [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                         [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
            m = r @ m
        if 'translation' in nd:
            t = np.eye(4)
            t[:3, 3] = nd['translation']
            m = t @ m
        return m

    out = []

    def walk(i, parent):
        nd = g['nodes'][i]
        m = parent @ local(nd)
        for prim in g['meshes'][nd['mesh']]['primitives'] if 'mesh' in nd else []:
            if prim.get('mode', 4) != 4:
                continue
            v = accessor(prim['attributes']['POSITION']).astype(np.float64) @ m[:3, :3].T + m[:3, 3]
            idx = accessor(prim['indices']).reshape(-1, 3) if 'indices' in prim else np.arange(len(v)).reshape(-1, 3)
            out.append(v[idx])
        for c in nd.get('children', []):
            walk(c, m)

    for i in g['scenes'][g.get('scene', 0)]['nodes']:
        walk(i, np.eye(4))
    return np.concatenate(out)


def surface_points(tris, n, seed=0):
    rng = np.random.default_rng(seed)
    a, b, c = tris[:, 0], tris[:, 1], tris[:, 2]
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    k = rng.choice(len(tris), n, p=area / area.sum())
    u, v = rng.random(n), rng.random(n)
    flip = u + v > 1
    u[flip], v[flip] = 1 - u[flip], 1 - v[flip]
    return a[k] + (b[k] - a[k]) * u[:, None] + (c[k] - a[k]) * v[:, None]


def icp_align(splat, scale, ang, shift):
    from scipy.spatial import cKDTree
    model = surface_points(glb_triangles(VENUE_GLB), 400000)
    model = model[(model[:, 1] > 0.08) & (model[:, 1] < 9)]
    tree = cKDTree(model)
    xyz, a, size = splat['xyz'], splat['alpha'], splat['size']
    pick = (a > 0.5) & (size < 0.25) & (xyz[:, 1] > 0.35) & (xyz[:, 1] < 9.5)
    rng = np.random.default_rng(1)
    src = xyz[pick][rng.choice(int(pick.sum()), min(150000, int(pick.sum())), replace=False)].astype(np.float64)

    def apply(p, s, deg, t):
        R = rot2(deg)
        xz = p[:, [0, 2]] @ (s * R).T + t
        return np.c_[xz[:, 0], s * p[:, 1], xz[:, 1]]

    def run(s, deg, t, iters, far, near):
        t = np.asarray(t, float)
        for k in range(iters):
            d, j = tree.query(apply(src, s, deg, t), distance_upper_bound=far + (near - far) * min(1.0, k / (0.7 * iters)))
            ok = np.isfinite(d)
            if ok.sum() < 1000:
                break
            p, m = src[ok], model[j[ok]]
            pc, mc = p.mean(0), m.mean(0)
            p0, m0 = p - pc, m - mc
            cov = p0[:, [0, 2]].T @ m0[:, [0, 2]]
            deg = math.degrees(math.atan2(cov[0, 1] - cov[1, 0], cov[0, 0] + cov[1, 1]))
            R = rot2(deg)
            turned = np.c_[(p0[:, [0, 2]] @ R.T)[:, 0], p0[:, 1], (p0[:, [0, 2]] @ R.T)[:, 1]]
            s = float((turned * m0).sum() / (p0 ** 2).sum())
            t = mc[[0, 2]] - s * R @ pc[[0, 2]]
        d, _ = tree.query(apply(src, s, deg, t), distance_upper_bound=2.0)
        close = np.isfinite(d)
        return s, deg, t, float(np.mean(d < 0.25)), float(np.mean(d < 0.5)), float(np.median(d[close])) if close.any() else 9.0

    starts = [run(scale, ang + dang, np.asarray(shift) + np.array([dx, dz]), 20, 3.0, 1.0)
              for dang in (-4, -2, 0, 2, 4) for dx in (-8, -4, 0, 4, 8) for dz in (-4, 0, 4)]
    starts.sort(key=lambda r: -r[3])
    best = max((run(r[0], r[1], r[2], 40, 1.5, 0.5) for r in starts[:5]), key=lambda r: r[3])
    best = best[:3] + best[4:]
    return best


def similarity_from_pairs(src, dst):
    src, dst = np.asarray(src, float), np.asarray(dst, float)
    ms, md = src.mean(0), dst.mean(0)
    a, b = src - ms, dst - md
    u, sv, vt = np.linalg.svd(b.T @ a / len(src))
    d = np.sign(np.linalg.det(u @ vt))
    R = u @ np.diag([1, d]) @ vt
    scale = (sv * [1, d]).sum() / (a ** 2).sum() * len(src)
    return scale, R, md - scale * R @ ms


class Venue:

    KINDS = ('sponsor_table', 'stage', 'entrance', 'exit', 'food', 'place', 'area')

    def __init__(self, path=None):
        path = path or os.path.join(WORK, 'align.json')
        if not os.path.exists(path):
            sys.exit(f'no {path}: run "photo_place.py align" first')
        a = json.load(open(path))
        self.M, self.t, self.scale = np.array(a['matrix']), np.array(a['shift']), float(a['scale'])
        self.Minv = np.linalg.inv(self.M)
        self.landmarks = self.group(json.load(open(SPOTS)))

    def to_venue(self, xz):
        return np.asarray(xz, float) @ self.M.T + self.t

    def to_splat(self, xz):
        return (np.asarray(xz, float) - self.t) @ self.Minv.T

    @classmethod
    def group(cls, spots):
        out = []
        for s in spots:
            if s['kind'] not in cls.KINDS:
                continue
            for g in out:
                if g['kind'] == s['kind'] and g['name'] == s['name'] and math.dist(g['xz'], (s['x'], s['z'])) < 6:
                    g['members'].append((s['x'], s['z']))
                    g['xz'] = tuple(np.mean(g['members'], 0))
                    break
            else:
                out.append({'kind': s['kind'], 'name': s['name'], 'xz': (s['x'], s['z']), 'members': [(s['x'], s['z'])]})
        tables = [s for s in spots if s['kind'] == 'table']
        return [{'kind': g['kind'], 'name': g['name'], 'x': round(g['xz'][0], 2), 'z': round(g['xz'][1], 2)} for g in out] + \
               [{'kind': 'table', 'name': s['name'], 'x': s['x'], 'z': s['z']} for s in tables]


def align_cmd(args):
    os.makedirs(WORK, exist_ok=True)
    splat = load_splat()
    if args.pairs:
        pairs = [p.split('=') for p in args.pairs.split(';') if p.strip()]
        src = [[float(v) for v in a.split(',')] for a, _ in pairs]
        dst = [[float(v) for v in b.split(',')] for _, b in pairs]
        scale, R, t = similarity_from_pairs(src, dst)
        ang = math.degrees(math.atan2(R[1, 0], R[0, 0]))
        resid = np.linalg.norm(np.asarray(src) @ (scale * R).T + t - np.asarray(dst), axis=1)
        chamfer, rival, method = None, None, f'{len(pairs)} point pairs, residual {resid.max():.2f} m at most'
        mask, x0, z0, cell = venue_floor()
        hall_info = (cv2.morphologyEx((cv2.resize(mask.astype(np.float32), None, fx=cell / 0.5, fy=cell / 0.5) > 0.3)
                                      .astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)), x0, z0, 0.5)
    else:
        say('matching the splat walls to the venue map outline (about a minute)')
        (chamfer, scale, ang, t), rival, hall_info = align_search(splat)
        R = rot2(ang)
        method = 'walls on the venue map outline'
        if os.path.exists(VENUE_GLB):
            say(f'walls: {scale:.3f} x R({ang:.2f} deg); refining in 3D against the venue model (a few minutes)')
            scale, ang, t, fit, median = icp_align(splat, scale, ang, t)
            R = rot2(ang)
            method = (f'walls on the venue map outline, then 3D against web/venue/venue.glb: {fit * 100:.0f}% of splat '
                      f'points within 0.5 m of the model, median {median:.2f} m')
    hall, x0, z0, res = hall_info
    fl = floor_cells(splat, 0.5) @ (scale * R).T + t
    q = ((fl - [x0, z0]) / res).astype(int)
    ok = (q[:, 0] >= 0) & (q[:, 0] < hall.shape[1]) & (q[:, 1] >= 0) & (q[:, 1] < hall.shape[0])
    on_floor = float(np.mean(hall[q[ok, 1], q[ok, 0]] > 0)) if ok.any() else 0.0
    out = {'scale': round(scale, 5), 'angle_deg': round(ang, 3), 'matrix': (scale * R).round(6).tolist(),
           'shift': [round(float(v), 3) for v in t], 'method': method, 'splat_floor_on_venue_floor': round(on_floor, 3),
           'walls_off_m': round(chamfer, 3) if chamfer is not None else None,
           'next_best_off_m': round(rival[0], 3) if rival else None,
           'made': datetime.now(timezone.utc).isoformat(timespec='seconds')}
    json.dump(out, open(os.path.join(WORK, 'align.json'), 'w'), indent=1)
    draw_alignment(splat, out, os.path.join(WORK, 'align.png'))
    say(f'venue = {scale:.3f} x R({ang:.2f} deg) x splat + ({t[0]:.2f}, {t[1]:.2f}): the splat is in units of '
        f'{scale:.3f} m; {on_floor * 100:.0f}% of its floor lands on the venue floor'
        + (f'; walls {chamfer:.2f} m off the outline on average (next best rotation {rival[0]:.2f} m)' if chamfer else '')
        + f' -> {os.path.join(WORK, "align.png")}')


def draw_alignment(splat, a, path, cell=0.25):
    mask, x0, z0, _ = venue_floor()
    img = cv2.cvtColor((mask * 70).astype(np.uint8), cv2.COLOR_GRAY2BGR)
    M, t = np.array(a['matrix']), np.array(a['shift'])
    xyz, al = splat['xyz'], splat['alpha']
    for sel, colour in (((al > 0.25) & (xyz[:, 1] > -0.8) & (xyz[:, 1] < 0.45), (0, 1, 0)),
                        ((al > 0.3) & (xyz[:, 1] > 2.5) & (xyz[:, 1] < 6), (1, 0.35, 0)),
                        ((al > 0.2) & (xyz[:, 1] > 0.62) & (xyz[:, 1] < 0.95), (0, 0.45, 1))):
        q = ((xyz[sel][:, [0, 2]] @ M.T + t - [x0, z0]) / cell).astype(int)
        ok = (q[:, 0] >= 0) & (q[:, 0] < img.shape[1]) & (q[:, 1] >= 0) & (q[:, 1] < img.shape[0])
        acc = np.zeros(img.shape[:2])
        np.add.at(acc, (q[ok, 1], q[ok, 0]), 1)
        lvl = np.clip(np.log1p(acc) * 60, 0, 255)
        for ch, k in enumerate(colour):
            img[..., ch] = np.maximum(img[..., ch], (lvl * k).astype(np.uint8))
    for s in json.load(open(SPOTS)):
        if s['kind'] in ('place', 'area', 'entrance', 'exit'):
            p = (int((s['x'] - x0) / cell), int((s['z'] - z0) / cell))
            cv2.circle(img, p, 4, (255, 255, 255), -1)
            cv2.putText(img, s['name'][:22], (p[0] + 5, p[1] + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
    cv2.imwrite(path, img)


def photo_time(path, tz='-07:00'):
    try:
        from photos import parse_tz, read_photo
        r = read_photo(path, parse_tz(tz))
        return r['cam'].astimezone(timezone.utc) if r else None
    except Exception:
        return None


def project(points, rec):
    c2w = np.array(rec['c2w']) @ CV_FROM_GL
    w2c = np.linalg.inv(c2w)
    cam = points @ w2c[:3, :3].T + w2c[:3, 3]
    w, h = rec['size']
    f = rec['focal_px']
    with np.errstate(divide='ignore', invalid='ignore'):
        uv = np.c_[f * cam[:, 0] / cam[:, 2] + w / 2, f * cam[:, 1] / cam[:, 2] + h / 2]
    return uv, cam[:, 2]


def visible(points, rec, depth, slack):
    uv, z = project(points, rec)
    w, h = rec['size']
    inside = (z > 0.3) & (uv[:, 0] >= 0) & (uv[:, 0] < w) & (uv[:, 1] >= 0) & (uv[:, 1] < h)
    if depth is not None and inside.any():
        dh, dw = depth.shape
        u = np.clip((uv[inside, 0] * dw / w).astype(int), 0, dw - 1)
        v = np.clip((uv[inside, 1] * dh / h).astype(int), 0, dh - 1)
        d = depth[v, u]
        clear = ~np.isfinite(d) | (z[inside] <= d + slack)
        inside[np.nonzero(inside)[0][~clear]] = False
    return inside, uv, z


def test_bands(rec, venue, count, seed):
    mask, x0, z0, cell = venue_floor()
    rng = np.random.default_rng(seed)
    cam = venue.to_venue(np.array(rec['c2w'])[[0, 2], 3][None])[0]
    rows, cols = np.nonzero(mask)
    xz = np.c_[x0 + (cols + 0.5) * cell, z0 + (rows + 0.5) * cell]
    near = xz[np.linalg.norm(xz - cam, axis=1) < 25]
    picks = near[rng.choice(len(near), size=min(count, len(near)), replace=False)] if len(near) else np.zeros((0, 2))
    bands = [{'band': 1, 'x': round(float(cam[0] + rng.normal(0, 0.4)), 2), 'z': round(float(cam[1] + rng.normal(0, 0.4)), 2),
              'r': 0.8, 'test': True}]
    for i, (x, z) in enumerate(picks):
        bands.append({'band': 10 + i, 'x': round(float(x), 2), 'z': round(float(z), 2), 'r': round(float(rng.uniform(0.5, 1.6)), 2),
                      'test': True})
    return bands


def bands_at(positions, when, window_s=5.0):
    best = {}
    t = when.timestamp()
    for line in positions:
        dt = abs(line['wall'] - t)
        if dt <= window_s and (line['band'] not in best or dt < best[line['band']][0]):
            best[line['band']] = (dt, line)
    return [{'band': b, 'x': l['x'], 'z': l['y'], 'r': l.get('r', 1.0)} for b, (_, l) in best.items()]


def place_photo(rec, venue, depth, bands, photographer=None, max_m=15.0):
    c2w = np.array(rec['c2w'])
    cam_s = c2w[:3, 3]
    cam_v = venue.to_venue(cam_s[[0, 2]][None])[0]
    fwd = -c2w[:3, 2]
    fwd_v = venue.to_venue(np.array([cam_s[[0, 2]] + fwd[[0, 2]]]))[0] - cam_v
    heading = math.degrees(math.atan2(fwd_v[1], fwd_v[0])) % 360
    s = venue.scale
    lm = venue.landmarks
    lm_xz = np.array([[l['x'], l['z']] for l in lm])
    dist = np.linalg.norm(lm_xz - cam_v, axis=1)
    lm_splat = venue.to_splat(lm_xz)
    pts = np.c_[lm_splat[:, 0], np.full(len(lm), 1.0 / s), lm_splat[:, 1]]
    vis, uv, z = visible(pts, rec, depth, slack=1.5 / s)
    order = np.argsort(dist)
    named = [i for i in order if lm[i]['kind'] not in ('table', 'area')]
    area = next((lm[i] for i in order if lm[i]['kind'] == 'area' and dist[i] < 18), None)
    table = next((i for i in order if lm[i]['kind'] == 'table'), None)
    by = named[0] if named and dist[named[0]] < 12 else table if table is not None and dist[table] < 5 else None
    near = [{'name': lm[i]['name'], 'kind': lm[i]['kind'], 'm': round(float(dist[i]), 1)} for i in named[:4]]
    w = rec['size'][0]
    in_view = [i for i in order if vis[i] and dist[i] < 45 and lm[i]['kind'] != 'table']
    shown = [{'name': lm[i]['name'], 'kind': lm[i]['kind'], 'm': round(float(dist[i]), 1),
              'px': [round(float(uv[i, 0])), round(float(uv[i, 1]))]} for i in in_view][:8]
    central = [s for s in shown if s['kind'] != 'area' and abs(s['px'][0] - w / 2) < 0.4 * w and s['m'] < 30]
    ahead = central[0] if central else None
    where = (f'{dist[by]:.1f} m from {lm[by]["name"]}' if by is not None else 'in the hall') + \
            (f' in the {area["name"]}' if area else '') + (f', facing {ahead["name"]} ({ahead["m"]:.0f} m away)' if ahead else '')
    out_bands = []
    rng = np.random.default_rng(7)
    disc = rng.uniform(0, 1, (32, 2))
    disc = np.c_[np.sqrt(disc[:, 0]) * np.cos(2 * np.pi * disc[:, 1]), np.sqrt(disc[:, 0]) * np.sin(2 * np.pi * disc[:, 1])]
    for b in bands:
        centre = np.array([b['x'], b['z']])
        d = float(np.linalg.norm(centre - cam_v))
        samples = venue.to_splat(centre + disc * max(0.3, b['r']))
        pts = np.c_[samples[:, 0], np.full(len(samples), 1.2 / s), samples[:, 1]]
        vis_b, uv_b, _ = visible(pts, rec, depth, slack=0.8 / s)
        share = float(vis_b.mean()) if d <= max_m else 0.0
        c_uv, c_z = project(np.c_[venue.to_splat(centre[None]), [[1.2 / s]]][:, [0, 2, 1]], rec)
        out_bands.append({'band': b['band'], 'x': b['x'], 'z': b['z'], 'r': b['r'], 'm': round(d, 1),
                          'in_view': round(share, 2), 'px': [round(float(c_uv[0, 0])), round(float(c_uv[0, 1]))]
                          if c_z[0] > 0 else None, 'test': b.get('test', False)})
    shooter = photographer or next((b['band'] for b in sorted(out_bands, key=lambda b: b['m']) if b['m'] < 2.5), None)
    for b in out_bands:
        b['role'] = 'photographer' if b['band'] == shooter else 'in photo' if b['in_view'] >= 0.5 else \
            'maybe' if b['in_view'] >= 0.2 else 'not in view'
    send = [b['band'] for b in sorted(out_bands, key=lambda b: (-b['in_view'], b['m'])) if b['role'] in ('in photo', 'photographer')]
    return {'venue': {'x': round(float(cam_v[0]), 2), 'z': round(float(cam_v[1]), 2), 'height_m': round(float(cam_s[1] * s), 2),
                      'heading_deg': round(heading, 1)},
            'where': where, 'near': near, 'shows': shown, 'bands': sorted(out_bands, key=lambda b: (-b['in_view'], b['m'])),
            'send_to': send, 'photographer': shooter,
            'by': lm[by]['name'] if by is not None else None, 'by_m': round(float(dist[by]), 1) if by is not None else None,
            'area': area['name'] if area else None, 'facing': ahead['name'] if ahead else None,
            'facing_m': ahead['m'] if ahead else None}


def place_cmd(args):
    venue = Venue()
    located = os.path.join(WORK, 'located')
    records = [r for r in json.load(open(os.path.join(located, 'photos.json'))) if 'c2w' in r]
    positions = [json.loads(l) for l in open(args.positions)] if args.positions else None
    out = []
    for i, rec in enumerate(records):
        name = os.path.splitext(os.path.basename(rec['photo']))[0]
        depth_path = os.path.join(located, f'{name}_depth.npy')
        depth = np.load(depth_path).astype(np.float32) if os.path.exists(depth_path) else None
        when = photo_time(rec['photo'])
        if positions is not None and when:
            bands = bands_at(positions, when)
        elif args.test_bands:
            bands = test_bands(rec, venue, args.test_bands, seed=int.from_bytes(name.encode()[:8].ljust(8, b'0'), 'little') % 2 ** 32)
        else:
            bands = []
        p = place_photo(rec, venue, depth, bands, photographer=args.photographer)
        if not rec['confident']:
            p['send_to'] = []
        p.update({'id': name, 'photo': rec['photo'], 'taken': when.isoformat() if when else None, 'c2w': rec['c2w'],
                  'size': rec['size'], 'focal_px': rec['focal_px'], 'hfov_deg': rec['hfov_deg'], 'inliers': rec['inliers'],
                  'error_px': rec['error_px'], 'confident': rec['confident'], 'test_bands': bool(args.test_bands and positions is None)})
        out.append(p)
        say(f'{name}: {p["where"]}; ' + (f'send to {p["send_to"] or "nobody"}' + (f' (photographer {p["photographer"]})'
                                                                                 if p['photographer'] else '')
                                        if rec['confident'] else 'unsure, held back until someone checks it'))
    json.dump({'photos': out, 'landmarks': venue.landmarks, 'align': json.load(open(os.path.join(WORK, 'align.json')))},
              open(os.path.join(WORK, 'places.json'), 'w'), indent=1)
    say(f'{len(out)} photos placed, {sum(1 for p in out if p["confident"])} surely enough to send -> '
        f'{os.path.join(WORK, "places.json")}')


def export_cmd(args):
    places = os.path.join(WORK, 'places.json')
    if not os.path.exists(places):
        sys.exit(f'no {places}: run "photo_place.py place" first')
    data = json.load(open(places))
    venue = Venue()
    out = os.path.abspath(args.out)
    photos_dir, scan_dir = os.path.join(out, 'photos'), os.path.join(out, 'scan')
    os.makedirs(photos_dir, exist_ok=True)
    os.makedirs(scan_dir, exist_ok=True)
    located = {r['photo']: r for r in json.load(open(os.path.join(WORK, 'located', 'photos.json')))}
    url = args.url.rstrip('/')

    def images(path, name):
        img = cv2.imread(path)
        for suffix, side in (('', 1600), ('_thumb', 560)):
            s = min(1.0, side / max(img.shape[:2]))
            small = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) if s < 1 else img
            cv2.imwrite(os.path.join(photos_dir, f'{name}{suffix}.jpg'), small, [cv2.IMWRITE_JPEG_QUALITY, 86])
        with open(path, 'rb') as f:
            return hashlib.sha256(f.read()).hexdigest()

    placed = []
    for p in data['photos']:
        rec = located.get(p['photo'], {})
        def scan_xz(x, z):
            return [round(float(v), 3) for v in venue.to_splat(np.array([[x, z]]))[0]]
        placed.append({
            'id': p['id'], 'sha256': images(p['photo'], p['id']),
            'image': f'{url}/photos/{p["id"]}.jpg', 'thumb': f'{url}/photos/{p["id"]}_thumb.jpg',
            'taken': p['taken'], 'size': p['size'], 'focal': p['focal_px'], 'c2w': p['c2w'], 'sure': p['confident'],
            'points': p['inliers'], 'error': p['error_px'], 'by': p.get('by'), 'byM': p.get('by_m'), 'area': p.get('area'),
            'facing': p.get('facing'), 'facingM': p.get('facing_m'), 'heading': p['venue']['heading_deg'],
            'sendTo': p['send_to'], 'photographer': p['photographer'], 'testBands': p['test_bands'],
            'bands': [{'band': b['band'], 'xz': scan_xz(b['x'], b['z']), 'r': round(b['r'] / venue.scale, 3), 'role': b['role']}
                      for b in p['bands']],
            'start': rec.get('start_view'),
        })
    placed_ids = {p['photo'] for p in data['photos']}
    unplaced = []
    for path, rec in located.items():
        if path in placed_ids or not os.path.exists(path):
            continue
        name = os.path.splitext(os.path.basename(path))[0]
        when = photo_time(path)
        unplaced.append({'id': name, 'sha256': images(path, name), 'image': f'{url}/photos/{name}.jpg',
                         'thumb': f'{url}/photos/{name}_thumb.jpg', 'taken': when.isoformat() if when else None,
                         'size': rec.get('size')})
    for name, src in (('hall.spz', SPLAT), ('hall-roofless.spz', os.path.join(WORK, 'view', 'hall_cut.spz'))):
        dst = os.path.join(scan_dir, name)
        if not os.path.exists(src):
            sys.exit(f'{src} is missing: run "photo_place.py view" once to cut the roofless scan')
        if not os.path.exists(dst) or os.path.getsize(dst) != os.path.getsize(src):
            shutil.copyfile(src, dst)
    matrix = np.array(json.load(open(SPLAT_META))['toMetresYUp_rowMajor']).reshape(4, 4)
    json.dump({'scan': {'full': f'{url}/scan/hall.spz', 'roofless': f'{url}/scan/hall-roofless.spz',
                        'matrix': [float(v) for v in matrix.T.flatten()], 'metre': round(1 / venue.scale, 5)},
               'photos': sorted(placed, key=lambda p: p['taken'] or ''), 'unplaced': sorted(unplaced, key=lambda p: p['taken'] or '')},
              open(os.path.join(out, 'places.json'), 'w'), indent=1)
    say(f'{len(placed)} placed and {len(unplaced)} unplaced photos, and the scan, -> {out}')


def view_cmd(args):
    places = os.path.join(WORK, 'places.json')
    if not os.path.exists(places):
        sys.exit(f'no {places}: run "photo_place.py place" first')
    data = json.load(open(places))
    cache = os.path.join(WORK, 'view')
    os.makedirs(cache, exist_ok=True)
    routes = {'/': (os.path.join(WEB, 'index.html'), 'text/html'), '/places.json': (places, 'application/json')}
    for p in data['photos']:
        small = os.path.join(cache, f'{p["id"]}.jpg')
        if not os.path.exists(small) or os.path.getmtime(small) < os.path.getmtime(p['photo']):
            img = cv2.imread(p['photo'])
            s = 1600 / max(img.shape[:2])
            if s < 1:
                img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
            cv2.imwrite(small, img, [cv2.IMWRITE_JPEG_QUALITY, 86])
        routes[f'/photo/{p["id"]}.jpg'] = (small, 'image/jpeg')
    matrix = np.array(json.load(open(SPLAT_META))['toMetresYUp_rowMajor']).reshape(4, 4)
    cut = os.path.join(cache, 'hall_cut.spz')
    if not os.path.exists(cut) or os.path.getmtime(cut) < max(os.path.getmtime(SPLAT), os.path.getmtime(places)):
        venue = Venue()
        mask, x0, z0, cell = venue_floor()
        hall = cv2.dilate(cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)), np.ones((9, 9), np.uint8))

        def keep(xyz, alpha, size):
            v = venue.to_venue(xyz[:, [0, 2]])
            col, row = ((v[:, 0] - x0) / cell).astype(int), ((v[:, 1] - z0) / cell).astype(int)
            inside = (col >= 0) & (col < hall.shape[1]) & (row >= 0) & (row < hall.shape[0])
            inside[inside] = hall[row[inside], col[inside]] > 0
            low = xyz[:, 1] * venue.scale <= args.cut_m
            floater = (size * venue.scale > 0.6) & (alpha < 0.35)
            return inside & low & ~floater

        kept, total = cut_splat(SPLAT, cut, keep)
        say(f'the hall without its roof: {kept} of {total} Gaussians, inside the venue and below {args.cut_m:g} m')
    routes['/splat_cut.spz'] = (cut, 'application/octet-stream')
    srv = serve(args.port, matrix, routes, host=args.host)
    srv.cut = True
    say(f'{len(data["photos"])} photos on http://{args.host}:{args.port}/ (Ctrl-C stops)')
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        srv.shutdown()


def degrade(img, rng):
    out = img.astype(np.float32) / 255
    out = np.clip(out ** rng.uniform(0.8, 1.25) * rng.uniform(0.75, 1.15), 0, 1)
    out = cv2.GaussianBlur(out, (0, 0), rng.uniform(0.4, 1.2))
    out = np.clip(out + rng.normal(0, 0.012, out.shape), 0, 1)
    ok, buf = cv2.imencode('.jpg', (out * 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, int(rng.uniform(60, 90))])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def test_cmd(args):
    rng = np.random.default_rng(args.seed)
    views = json.load(open(os.path.join(WORK, 'views.json')))['views']
    spots = np.unique(np.array([v['pos'] for v in views]), axis=0)
    out_dir = os.path.join(WORK, 'test')
    os.makedirs(out_dir, exist_ok=True)

    def run(chrome):
        loc = Locator(chrome)
        rows = []
        for k in range(args.count):
            a, b = spots[rng.integers(len(spots))], spots[rng.integers(len(spots))]
            pos = a + (b - a) * min(1.0, 2.0 / max(np.linalg.norm(b - a), 1e-6)) * rng.uniform(0, 1)
            pos = pos + np.r_[rng.uniform(-0.6, 0.6), rng.uniform(-0.35, 0.3), rng.uniform(-0.6, 0.6)]
            yaw, pitch = rng.uniform(0, 360), rng.uniform(-8, 14)
            w, h = 1600, 1200
            f = w / 2 / math.tan(math.radians(rng.uniform(55, 75) / 2))
            truth = look_at(pos, yaw, pitch)
            colour, _ = chrome.render(truth, f, w, h, depth_scale=0)
            path = os.path.join(out_dir, f'test_{k:03d}.jpg')
            cv2.imwrite(path, degrade(colour, rng))
            t = time.time()
            rec = loc.locate(path, focal=f)
            if 'c2w' not in rec:
                rows.append(None)
                say(f'test {k}: not placed ({rec.get("error")})')
                continue
            est = np.array(rec['c2w'])
            dpos = float(np.linalg.norm(est[:3, 3] - truth[:3, 3]))
            dR = est[:3, :3].T @ truth[:3, :3]
            dang = math.degrees(math.acos(np.clip((np.trace(dR) - 1) / 2, -1, 1)))
            rows.append((dpos, dang, rec['inliers'], rec['confident']))
            say(f'test {k}: off by {dpos * 100:.1f} cm and {dang:.2f} deg, {rec["inliers"]} features agree '
                f'({time.time() - t:.1f} s)')
        placed = [r for r in rows if r]
        if placed:
            d = np.array([r[0] for r in placed])
            a = np.array([r[1] for r in placed])
            say(f'placed {len(placed)} of {len(rows)}; position off by median {np.median(d) * 100:.1f} cm, 90% within '
                f'{np.percentile(d, 90) * 100:.1f} cm; direction off by median {np.median(a):.2f} deg, 90% within '
                f'{np.percentile(a, 90):.2f} deg; {sum(1 for r in placed if r[3])} marked confident')

    with_renderer(args, run)


def main():
    ap = argparse.ArgumentParser(description=USAGE, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='mode', required=True)
    m = sub.add_parser('map')
    m.add_argument('--spacing', type=float, default=3.0, help='metres between standing points')
    m.add_argument('--features', type=int, default=1024, help='SuperPoint features per view')
    m.add_argument('--limit', type=int, default=0, help='render only this many views (a quick look)')
    lo = sub.add_parser('locate')
    lo.add_argument('photos', nargs='+', help='photos or folders of photos')
    lo.add_argument('--focal', type=float, help='focal length in pixels of the full-size photo, if EXIF lacks it')
    lo.add_argument('--out', help='where the records and overlays go (default pipeline/data/venue/photo_map/located)')
    al = sub.add_parser('align')
    al.add_argument('--pairs', help='instead of the search: splat x,z = venue x,z pairs, for example "30,-14=-6,-23;..."')
    pl = sub.add_parser('place')
    pl.add_argument('--positions', help='ranging.py --positions file, band positions in venue metres')
    pl.add_argument('--test-bands', type=int, default=0, help='without band data: this many seeded test wearers per photo')
    pl.add_argument('--photographer', type=int, help="the photographer's band")
    ex = sub.add_parser('export')
    ex.add_argument('--out', required=True, help='folder the page serves, for example frontend/public/venue/place')
    ex.add_argument('--url', default='/venue/place', help='where that folder is served from')
    v = sub.add_parser('view')
    v.add_argument('--port', type=int, default=8782)
    v.add_argument('--host', default='127.0.0.1')
    v.add_argument('--cut-m', type=float, default=3.5, help='the overview leaves out the splat above this height')
    t = sub.add_parser('test')
    t.add_argument('--count', type=int, default=30)
    t.add_argument('--seed', type=int, default=11)
    for p in (m, lo, t):
        p.add_argument('--port', type=int, default=8781)
        p.add_argument('--chrome', default=CHROME)
    args = ap.parse_args()
    {'map': build_map, 'locate': locate_cmd, 'align': align_cmd, 'place': place_cmd, 'export': export_cmd, 'view': view_cmd, 'test': test_cmd}[args.mode](args)


if __name__ == '__main__':
    main()
