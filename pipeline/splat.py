import argparse
import glob
import json
import math
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import cv2
import numpy as np

from elastic import DATA, ROOT

USAGE = """3D model of the venue for the security page: a Gaussian splat trained from a walk-through video

  python3 pipeline/splat.py check walk.mov        is the walk usable, and how long the rest takes (minutes)
  python3 pipeline/splat.py frames walk.mov [more.mov ...]   the sharpest frames of the walk -> images/
  python3 pipeline/splat.py poses                 where the phone was for each frame (COLMAP) -> sparse/0, undistorted/
  python3 pipeline/splat.py train                 the splat (Brush, on the Mac's GPU) -> splat.ply
  python3 pipeline/splat.py level                 stand it level on the floor, in metres from the phone height -> scene.json, venue.splat
  python3 pipeline/splat.py align                 level it on the floor and match it to the plan -> scene.json, venue.splat
  python3 pipeline/splat.py camera --name pit --frame pit.mov   place the security camera in it -> cameras/pit.json
  python3 pipeline/splat.py all walk.mov          frames, poses, train and level in one go, unattended

Everything goes to pipeline/data/venue/splat (or --work). Needs ffmpeg and colmap (brew install ffmpeg colmap) and
Brush's app (--brush, default .tools/brush/brush-app-aarch64-apple-darwin/brush_app from github.com/ArthurBrussee/brush).

The walk: the phone's 1x lens in landscape, 4K at 30 fps, HDR video off, exposure and focus locked. Keep walking: depth
comes from the phone moving through the space, so standing still or turning on the spot adds nothing (a fixed
camera's clip gives no model at all). Walk slowly and turn with the body; round the edges facing the middle, once at
chest height and once held high, then across the middle. Keep the floor in view. A long walk is fine, and several
videos of the same place can go in together.

check runs in a few minutes on any length: the share of the walk where the phone was really moving (against turning on
the spot, standing still, or moving too fast to follow), the stretches to redo, blur, HDR and a time estimate. Run it
before leaving the venue.

frames scores every frame from a small copy decoded on the video hardware, then takes the sharpest of each stretch at
full size (--width 1600): one a second of video, 300 to 1500 (--count), none where the phone stood still.

poses runs COLMAP on the CPU: features, then matching (every pair for up to 350 frames; beyond that each frame with its
neighbours, plus loop closing so the walk joins up where it passes the same place again, using COLMAP's vocabulary tree,
fetched once into .tools/colmap), the global mapper, then undistorted images for training. 15 minutes for 300 frames,
about an hour for 1500.

level needs no plan: it finds the floor, stands the model on it at height 0 and scales it so the phone was
--phone-height (1.5 m) above the floor, which is right to about 10%. Good for looking at the splat before the stations
are placed; align replaces it.

train runs Brush for --steps (30000; 7000 gives a quick look) with colour only (no view-dependent shading, which the
page does not draw) and at most --max-splats, at up to 1600 px (1280 above 600 frames). It saves a snapshot every 5000
steps and prints how long is left; a snapshot can go through level while training continues.

align finds the floor (the lowest large flat area facing up, under the phone) and shows a view of the model from above
next to the venue plan. Click a point on the left, then the same point on the plan; two pairs fix the model, three or
more show how well it fits. Corners of walls, pillars and doors work best. u undoes, s saves, q quits. The plan's
scale comes from the anchors file (security.py anchors), or --metres-per-px. Measured tape marks check the scale:
press m and click both marks on the left, with --span metres between them. Without a window: --pairs U,V=X,Y;...
(top view pixels = plan pixels; --top-only writes the top view and topdown.json first). It writes scene.json (model
to venue transform, in the venue frame of the page: x and z are the plan's metres, z down the plan, y up) and
venue.splat, the splat moved into that frame and trimmed to the venue for the browser.

camera registers one frame from the security camera's position (a still, or a video: its sharpest frame in the first
10 s) against the model. That gives the camera's exact position, direction and lens in the venue, so the page shows
what it covers and where its flash hits. The frame becomes the lit snapshot, and the image-to-plan mapping at wrist
height (--height, 0.9 m) is worked out from the pose. An existing calibration from security.py calibrate keeps its
clicked mapping unless --use-pose, and the pose's error at its spots is printed."""

WORK = os.path.join(DATA, 'venue', 'splat')
BRUSH = os.path.join(ROOT, '.tools', 'brush', 'brush-app-aarch64-apple-darwin', 'brush_app')
VENUE = os.path.join(ROOT, 'pipeline', 'venues', 'palace-of-fine-arts.json')
SECURITY = os.path.join(DATA, 'security')
VOCAB = os.path.join(ROOT, '.tools', 'colmap', 'vocab_tree_faiss_flickr100K_words32K.bin')
VOCAB_URL = 'https://github.com/colmap/colmap/releases/download/3.11.1/vocab_tree_faiss_flickr100K_words32K.bin'
SH_C0 = 0.28209479177387814
EYE_M = 1.5
SECONDS_PER_FRAME, MAX_FRAMES = 1.0, 1500
EXHAUSTIVE_MAX = 350
GRAB_WORKERS = 6
SNAPSHOT_STEPS = 5000
CHECK_FPS, CHECK_GAP = 2.0, 2
MOTION_MATCHES, PARALLAX_MIN, TURN_PX = 40, 0.15, 8.0
FLOOR_TILT_DEG = 20.0
WIN = 'BandIt splat align'
PANEL_W, PANEL_H = 800, 860
RED, AMBER, GREEN, WHITE, GREY, CYAN = (40, 40, 255), (0, 150, 255), (90, 220, 90), (240, 240, 240), (140, 140, 140), \
    (230, 200, 60)
FONT = cv2.FONT_HERSHEY_SIMPLEX


def say(text):
    print(f'{datetime.now().strftime("%H:%M:%S")} {text}', flush=True)


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def run(cmd, log=None, quiet=True):
    say('$ ' + ' '.join(os.path.basename(c) if i == 0 else c for i, c in enumerate(cmd)))
    t = time.time()
    with open(log, 'a') if log else open(os.devnull, 'w') as out:
        r = subprocess.run(cmd, stdout=out if quiet else None, stderr=subprocess.STDOUT if quiet else None)
    if r.returncode:
        raise SystemExit(f'{os.path.basename(cmd[0])} {cmd[1] if len(cmd) > 1 else ""} failed'
                         + (f', see {log}' if log else ''))
    return time.time() - t


def colmap(work, *args):
    return run(['colmap', *args], os.path.join(work, 'colmap.log'))


def probe(video):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                        'stream=width,height,r_frame_rate,codec_name,color_transfer:stream_side_data=rotation'
                        ':format=duration', '-of', 'json', video], capture_output=True, text=True)
    d = json.loads(r.stdout or '{}')
    if not d.get('streams'):
        raise SystemExit(f'cannot read {video}')
    s = d['streams'][0]
    num, den = (s.get('r_frame_rate') or '30/1').split('/')
    rot = next((int(x['rotation']) for x in s.get('side_data_list') or [] if 'rotation' in x), 0)
    w, h = s.get('width', 0), s.get('height', 0)
    if abs(rot) % 180 == 90:
        w, h = h, w
    return {'duration': float(d.get('format', {}).get('duration', 0)), 'width': w, 'height': h, 'rotation': rot,
            'fps': float(num) / float(den or 1), 'codec': s.get('codec_name'), 'transfer': s.get('color_transfer', '')}


def small_frames(video, fps, width):
    info = probe(video)
    height = int(round(info['height'] * width / info['width'] / 2) * 2)
    hw = ['-hwaccel', 'videotoolbox'] if info['codec'] in ('h264', 'hevc') else []
    p = subprocess.Popen(['ffmpeg', '-loglevel', 'error', *hw, '-i', video, '-vf',
                          f'fps={fps},scale={width}:{height}', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'],
                         stdout=subprocess.PIPE)
    size, n = width * height, 0
    while True:
        buf = p.stdout.read(size)
        if len(buf) < size:
            break
        yield n / fps, np.frombuffer(buf, np.uint8).reshape(height, width)
        n += 1
    p.wait()


def sharpness(grey):
    return float(cv2.Laplacian(grey, cv2.CV_32F).var())


def motion(a, b, orb, matcher):
    ka, da = orb.detectAndCompute(a, None)
    kb, db = orb.detectAndCompute(b, None)
    if da is None or db is None or len(ka) < 50 or len(kb) < 50:
        return 0, 0.0, 0.0
    m = matcher.match(da, db)
    if len(m) < MOTION_MATCHES:
        return len(m), 0.0, 0.0
    pa = np.float32([ka[x.queryIdx].pt for x in m])
    pb = np.float32([kb[x.trainIdx].pt for x in m])
    shift = float(np.median(np.linalg.norm(pa - pb, axis=1)))
    H, hin = cv2.findHomography(pa, pb, cv2.RANSAC, 2.0)
    F, fin = cv2.findFundamentalMat(pa, pb, cv2.FM_RANSAC, 1.0, 0.99)
    if H is None or F is None or fin is None or F.shape != (3, 3):
        return len(m), 0.0, shift
    hin, fin = hin.ravel() > 0, fin.ravel() > 0
    return len(m), float((fin & ~hin).sum()) / max(1, int(fin.sum())), shift


def auto_count(seconds):
    return int(np.clip(round(seconds / SECONDS_PER_FRAME), 300, MAX_FRAMES))


def runs(flags, times, minimum):
    out, start = [], None
    for f, t in zip(list(flags) + [False], list(times) + [times[-1] if times else 0]):
        if f and start is None:
            start = t
        elif not f and start is not None:
            if t - start >= minimum:
                out.append((start, t))
            start = None
    return out


def clock(t):
    return f'{int(t) // 60}:{int(t) % 60:02d}'


def check(args):
    total, moving_s = 0.0, 0.0
    orb, matcher = cv2.ORB_create(1500), cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    for video in args.video:
        info = probe(video)
        total += info['duration']
        say(f'{os.path.basename(video)}: {clock(info["duration"])}, {info["width"]} x {info["height"]} at '
            f'{info["fps"]:.0f} fps, {info["codec"]}')
        if info['transfer'] in ('arib-std-b67', 'smpte2084'):
            say('  recorded in HDR: the colours of the splat will look flat (Settings, Camera, Record Video, HDR off)')
        if info['height'] > info['width']:
            say('  portrait: landscape covers more of the room per frame')
        frames_, times, sharp, kind = [], [], [], []
        for t, g in small_frames(video, CHECK_FPS, 640):
            frames_.append(g)
            times.append(t)
            sharp.append(sharpness(g))
            if len(frames_) > CHECK_GAP:
                n, par, shift = motion(frames_[-1 - CHECK_GAP], g, orb, matcher)
                kind.append('lost' if n < MOTION_MATCHES else 'moving' if par >= PARALLAX_MIN
                            else 'turning' if shift >= TURN_PX else 'still')
                frames_[-1 - CHECK_GAP] = None
        steps = times[CHECK_GAP:]
        share = {k: kind.count(k) / max(1, len(kind)) for k in ('moving', 'turning', 'still', 'lost')}
        moving_s += share['moving'] * info['duration']
        say(f'  moving {100 * share["moving"]:.0f}%, only turning {100 * share["turning"]:.0f}%, standing still '
            f'{100 * share["still"]:.0f}%, too fast or blurred to follow {100 * share["lost"]:.0f}%')
        for name in ('still', 'turning', 'lost'):
            for a, b in runs([k == name for k in kind], steps, 6.0)[:6]:
                say(f'  {clock(a)} to {clock(b)}: {"standing still" if name == "still" else "turning on the spot" if name == "turning" else "lost track (too fast or blurred)"}')
        s = np.array(sharp)
        blur = runs(s < 0.35 * np.median(s), times, 2.0)
        for a, b in blur[:6]:
            say(f'  {clock(a)} to {clock(b)}: blurred')
    count = auto_count(total)
    say(f'usable walking: {clock(moving_s)} of {clock(total)}'
        + ('' if moving_s >= 0.5 * total else '; most of it does not move the phone, so the model will be thin. '
           'Walk the whole time; turning on the spot or standing adds nothing'))
    feat, match = count * 0.25, count * (2.9 if count <= EXHAUSTIVE_MAX else 0.6)
    say(f'plan: about {count} frames; frames {clock(total / 25 + count * 0.15)}, positions '
        f'{clock(feat + match + count * 0.6)}, training {clock(50 * 60)}, so roughly '
        f'{(total / 25 + count * 0.15 + feat + match + count * 0.6 + 3000) / 3600:.1f} h in all')


def frames(args):
    images = os.path.join(args.work, 'images')
    shutil.rmtree(images, ignore_errors=True)
    os.makedirs(images)
    infos = [probe(v) for v in args.video]
    total = sum(i['duration'] for i in infos)
    count = args.count or auto_count(total)
    fps = args.sample_fps or float(np.clip(3.0 * count / max(1.0, total), 1.0, 6.0))
    source, sharp, thumbs = [], [], []
    t0 = time.time()
    for video in args.video:
        got = 0
        for t, g in small_frames(video, fps, 480):
            source.append((video, t))
            sharp.append(sharpness(g))
            thumbs.append(cv2.resize(g, (160, int(160 * g.shape[0] / g.shape[1])), interpolation=cv2.INTER_AREA)
                          .astype(np.float32))
            got += 1
        if not got:
            raise SystemExit(f'no frames came out of {video}')
    n = len(source)
    say(f'{n} frames scored ({fps:.1f} a second over {clock(total)}) in {time.time() - t0:.0f} s')
    if n <= count:
        pick = list(range(n))
    else:
        edges = np.linspace(0, n, count + 1).astype(int)
        pick = [a + int(np.argmax(sharp[a:b])) for a, b in zip(edges[:-1], edges[1:]) if b > a]
    kept, last, still = [], None, 0
    for i in pick:
        if last is not None and source[i][0] == source[last][0] and \
                float(np.abs(thumbs[i] - thumbs[last]).mean()) < 1.5:
            still += 1
            continue
        kept.append(i)
        last = i
    side = args.width
    scale = f"scale='if(gt(iw,ih),{side},-2)':'if(gt(iw,ih),-2,{side})'"

    def grab(job):
        k, i = job
        video, t = source[i]
        out = os.path.join(images, f'frame_{k:05d}.jpg')
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-ss', f'{t:.3f}', '-i', video, '-frames:v', '1', '-vf', scale,
                        '-q:v', '2', '-y', out], check=True)
        return out

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=GRAB_WORKERS) as pool:
        list(pool.map(grab, enumerate(kept, 1)))
    with open(os.path.join(args.work, 'frames.json'), 'w') as f:
        json.dump({'videos': [os.path.basename(v) for v in args.video], 'sample_fps': fps,
                   'frames': {f'frame_{k:05d}.jpg': {'video': os.path.basename(source[i][0]),
                                                     'time': round(source[i][1], 3)}
                              for k, i in enumerate(kept, 1)}}, f, indent=1)
    s = np.array(sharp)
    ks = s[kept]
    say(f'{len(kept)} frames kept in {os.path.relpath(images, ROOT)} ({time.time() - t0:.0f} s to extract)'
        + (f', {still} dropped where the phone stood still' if still else ''))
    say(f'sharpness of the kept frames: median {np.median(ks):.0f}, lowest {ks.min():.0f} '
        f'(all frames median {np.median(s):.0f})')


def largest_model(sparse):
    best, count = None, -1
    for d in sorted(glob.glob(os.path.join(sparse, '*'))):
        f = os.path.join(d, 'images.bin')
        if os.path.exists(f):
            with open(f, 'rb') as fh:
                n = int.from_bytes(fh.read(8), 'little')
            if n > count:
                best, count = d, n
    return best, count


def poses(args):
    images = os.path.join(args.work, 'images')
    n = len(glob.glob(os.path.join(images, '*.jpg')))
    if not n:
        raise SystemExit(f'no frames in {images}: run frames first')
    db = os.path.join(args.work, 'colmap.db')
    sparse = os.path.join(args.work, 'sparse')
    und = os.path.join(args.work, 'undistorted')
    for p in (db, os.path.join(args.work, 'colmap.log')):
        if os.path.exists(p):
            os.remove(p)
    for d in (sparse, und):
        shutil.rmtree(d, ignore_errors=True)
    os.makedirs(sparse)
    t = colmap(args.work, 'feature_extractor', '--database_path', db, '--image_path', images,
               '--ImageReader.single_camera', '1', '--ImageReader.camera_model', 'SIMPLE_RADIAL',
               '--FeatureExtraction.use_gpu', '0', '--SiftExtraction.max_num_features', str(args.features))
    say(f'features for {n} frames in {t:.0f} s')
    matcher = args.matcher if args.matcher != 'auto' else ('exhaustive' if n <= EXHAUSTIVE_MAX else 'sequential')
    if matcher == 'exhaustive':
        t = colmap(args.work, 'exhaustive_matcher', '--database_path', db, '--FeatureMatching.use_gpu', '0')
    else:
        t = colmap(args.work, 'sequential_matcher', '--database_path', db, '--FeatureMatching.use_gpu', '0',
                   '--SequentialMatching.overlap', '15', '--SequentialMatching.quadratic_overlap', '1',
                   '--SequentialMatching.loop_detection', '1', '--SequentialMatching.loop_detection_period', '10',
                   '--SequentialMatching.loop_detection_num_images', '40',
                   '--SequentialMatching.vocab_tree_path', vocab_tree(args.vocab))
    say(f'{matcher} matching in {t:.0f} s' + ('' if matcher == 'exhaustive' else ', with loop closing'))
    mapper = 'global_mapper' if args.mapper == 'global' else 'mapper'
    t = colmap(args.work, mapper, '--database_path', db, '--image_path', images, '--output_path', sparse)
    model, count = largest_model(sparse)
    if model is None:
        raise SystemExit('COLMAP placed no frames: the walk needs more overlap or texture, see colmap.log')
    if os.path.basename(model) != '0':
        tmp = os.path.join(sparse, 'best')
        os.rename(model, tmp)
        if os.path.exists(os.path.join(sparse, '0')):
            os.rename(os.path.join(sparse, '0'), os.path.join(sparse, 'other'))
        os.rename(tmp, os.path.join(sparse, '0'))
    say(f'{mapper}: {count} of {n} frames placed in {t:.0f} s')
    if count < 0.8 * n:
        say('fewer than 4 in 5 frames placed: the model may only cover part of the walk')
    undistort(args.work)
    cams, imgs, pts = read_model(os.path.join(sparse, '0'), args.work)
    err = np.array([p['error'] for p in pts.values()])
    say(f'model: {len(imgs)} frames, {len(pts)} points, median reprojection error {np.median(err):.2f} px; '
        f'undistorted frames for training in {os.path.relpath(und, ROOT)}')


def undistort(work):
    und = os.path.join(work, 'undistorted')
    shutil.rmtree(und, ignore_errors=True)
    colmap(work, 'image_undistorter', '--image_path', os.path.join(work, 'images'), '--input_path',
           os.path.join(work, 'sparse', '0'), '--output_path', und, '--output_type', 'COLMAP')
    flat = os.path.join(und, 'sparse')
    if os.path.exists(os.path.join(flat, 'images.bin')):
        os.makedirs(os.path.join(flat, '0'))
        for f in glob.glob(os.path.join(flat, '*.bin')):
            shutil.move(f, os.path.join(flat, '0'))


def vocab_tree(path):
    path = path or VOCAB
    if os.path.exists(path):
        return path
    import requests
    os.makedirs(os.path.dirname(path), exist_ok=True)
    say(f'fetching the vocabulary tree for loop closing ({VOCAB_URL})')
    r = requests.get(VOCAB_URL, timeout=120)
    r.raise_for_status()
    with open(path + '.part', 'wb') as f:
        f.write(r.content)
    os.replace(path + '.part', path)
    return path


def train(args):
    data = os.path.join(args.work, 'undistorted')
    if not os.path.exists(os.path.join(data, 'sparse', '0', 'images.bin')):
        if not os.path.exists(os.path.join(args.work, 'sparse', '0', 'images.bin')):
            raise SystemExit(f'no model in {args.work}: run poses first')
        undistort(args.work)
    if not os.path.exists(args.brush):
        raise SystemExit(f'no Brush at {args.brush}')
    n = len(glob.glob(os.path.join(data, 'images', '*')))
    res = args.max_resolution or (1600 if n <= 600 else 1280)
    out = os.path.join(args.work, 'splat.ply')
    for f in glob.glob(os.path.join(args.work, 'splat*.ply')):
        os.remove(f)
    every = min(args.steps, SNAPSHOT_STEPS)
    cmd = [args.brush, data, '--total-steps', str(args.steps), '--export-every', str(every),
           '--export-path', args.work, '--export-name', 'splat_{iter}.ply', '--sh-degree', '0',
           '--max-splats', str(args.max_splats), '--max-resolution', str(res)]
    say(f'$ {os.path.basename(args.brush)} {" ".join(cmd[1:])}')
    say(f'training on {n} frames at up to {res} px for {args.steps} steps; a snapshot every {every} steps')
    t0, seen = time.time(), set()
    with open(os.path.join(args.work, 'brush.log'), 'a') as log:
        p = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT)
        while p.poll() is None:
            time.sleep(5)
            for f in sorted(glob.glob(os.path.join(args.work, 'splat_*.ply')), key=os.path.getmtime):
                step = int(os.path.basename(f)[6:-4])
                if step in seen:
                    continue
                seen.add(step)
                mins = (time.time() - t0) / 60
                say(f'step {step} of {args.steps} after {mins:.0f} min, about {mins * (args.steps / step - 1):.0f} min '
                    f'to go; snapshot {os.path.basename(f)}')
    if p.returncode:
        raise SystemExit('Brush failed, see brush.log')
    shots = sorted(glob.glob(os.path.join(args.work, 'splat_*.ply')), key=lambda f: int(os.path.basename(f)[6:-4]))
    if not shots:
        raise SystemExit('Brush wrote no splat, see brush.log')
    os.replace(shots[-1], out)
    for f in shots[:-1]:
        os.remove(f)
    say(f'{args.steps} steps in {(time.time() - t0) / 60:.1f} min: {os.path.relpath(out, ROOT)}, '
        f'{read_ply(out)[1]} splats')


def qvec_to_R(q):
    w, x, y, z = q
    return np.array([[1 - 2 * y * y - 2 * z * z, 2 * x * y - 2 * w * z, 2 * x * z + 2 * w * y],
                     [2 * x * y + 2 * w * z, 1 - 2 * x * x - 2 * z * z, 2 * y * z - 2 * w * x],
                     [2 * x * z - 2 * w * y, 2 * y * z + 2 * w * x, 1 - 2 * x * x - 2 * y * y]])


def R_to_qvec(R):
    w = math.sqrt(max(0.0, 1 + R[0, 0] + R[1, 1] + R[2, 2])) / 2
    x = math.copysign(math.sqrt(max(0.0, 1 + R[0, 0] - R[1, 1] - R[2, 2])) / 2, R[2, 1] - R[1, 2])
    y = math.copysign(math.sqrt(max(0.0, 1 - R[0, 0] + R[1, 1] - R[2, 2])) / 2, R[0, 2] - R[2, 0])
    z = math.copysign(math.sqrt(max(0.0, 1 - R[0, 0] - R[1, 1] + R[2, 2])) / 2, R[1, 0] - R[0, 1])
    q = np.array([w, x, y, z])
    return q / np.linalg.norm(q)


def read_model(model, work):
    txt = os.path.join(work, 'model_txt', os.path.basename(os.path.dirname(model)) + '_' + os.path.basename(model))
    shutil.rmtree(txt, ignore_errors=True)
    os.makedirs(txt)
    colmap(work, 'model_converter', '--input_path', model, '--output_path', txt, '--output_type', 'TXT')
    cams = {}
    for line in open(os.path.join(txt, 'cameras.txt')):
        if line.startswith('#') or not line.strip():
            continue
        v = line.split()
        cams[int(v[0])] = {'model': v[1], 'size': (int(v[2]), int(v[3])), 'params': [float(x) for x in v[4:]]}
    imgs = {}
    lines = [ln for ln in open(os.path.join(txt, 'images.txt')) if not ln.startswith('#')]
    for head, obs in zip(lines[0::2], lines[1::2]):
        v = head.split()
        R = qvec_to_R([float(x) for x in v[1:5]])
        t = np.array([float(x) for x in v[5:8]])
        o = obs.split()
        seen = sum(1 for k in range(2, len(o), 3) if o[k] != '-1')
        imgs[v[9]] = {'id': int(v[0]), 'R': R, 't': t, 'camera': int(v[8]), 'centre': -R.T @ t, 'points': seen}
    pts = {}
    for line in open(os.path.join(txt, 'points3D.txt')):
        if line.startswith('#') or not line.strip():
            continue
        v = line.split()
        pts[int(v[0])] = {'xyz': np.array([float(x) for x in v[1:4]]), 'rgb': [int(x) for x in v[4:7]],
                          'error': float(v[7]), 'track': (len(v) - 8) // 2}
    return cams, imgs, pts


def read_ply(path):
    with open(path, 'rb') as f:
        header = []
        while True:
            line = f.readline().decode('ascii', 'replace').strip()
            header.append(line)
            if line == 'end_header':
                break
        types = {'float': 'f4', 'float32': 'f4', 'double': 'f8', 'uchar': 'u1', 'uint8': 'u1', 'int': 'i4',
                 'uint': 'u4', 'short': 'i2', 'ushort': 'u2'}
        count, props = 0, []
        for line in header:
            v = line.split()
            if v[:2] == ['element', 'vertex']:
                count = int(v[2])
            elif v[:1] == ['property'] and len(v) == 3:
                props.append((v[2], '<' + types[v[1]]))
        if 'format binary_little_endian 1.0' not in header:
            raise SystemExit(f'{path}: only binary little-endian PLY is read')
        data = np.frombuffer(f.read(count * np.dtype(props).itemsize), np.dtype(props), count)
    return data, count


def floor_plane(imgs, pts):
    centres = np.array([i['centre'] for i in imgs.values()])
    up0 = np.mean([-i['R'].T @ np.array([0.0, 1.0, 0.0]) for i in imgs.values()], axis=0)
    up0 /= np.linalg.norm(up0)
    good = [p['xyz'] for p in pts.values() if p['track'] >= 3 and p['error'] < 2.0]
    P = np.array(good if len(good) > 500 else [p['xyz'] for p in pts.values()])
    some_p = P[::max(1, len(P) // 4000)]
    some_c = centres[::max(1, len(centres) // 50)]
    ref = float(np.median(np.linalg.norm(some_p[:, None] - some_c[None], axis=-1)))
    thr = 0.012 * ref
    rng = np.random.default_rng(1)
    cos_tilt = math.cos(math.radians(FLOOR_TILT_DEG))
    cands = []
    for _ in range(3000):
        a, b, c = P[rng.choice(len(P), 3, replace=False)]
        n = np.cross(b - a, c - a)
        norm = np.linalg.norm(n)
        if norm < 1e-12:
            continue
        n /= norm
        if n @ up0 < 0:
            n = -n
        if n @ up0 < cos_tilt:
            continue
        d = (P - a) @ n
        inl = np.abs(d) < thr
        k = int(inl.sum())
        above = float(np.median((centres - a) @ n))
        if k < 50 or above <= 2 * thr:
            continue
        cands.append((k, float(a @ up0), n, a))
    if not cands:
        raise SystemExit('no floor found: the walk needs more of the floor in view')
    most = max(c[0] for c in cands)
    k, _, n, a = min((c for c in cands if c[0] >= 0.3 * most), key=lambda c: c[1])
    inl = P[np.abs((P - a) @ n) < thr]
    for _ in range(3):
        mean = inl.mean(axis=0)
        n = np.linalg.svd(inl - mean)[2][-1]
        if n @ up0 < 0:
            n = -n
        dist = (P - mean) @ n
        inl = P[np.abs(dist) < thr]
    mean = inl.mean(axis=0)
    rms = float(np.sqrt(np.mean(((inl - mean) @ n) ** 2)))
    heights = (centres - mean) @ n
    return n, mean, rms, float(np.median(heights)), len(inl), len(P)


def level_frame(n, p0, centres):
    c = np.median(centres, axis=0)
    origin = c - n * ((c - p0) @ n)
    flat = centres - np.outer((centres - origin) @ n, n)
    v = np.linalg.svd(flat - flat.mean(axis=0))[2][0]
    ex = v - n * (v @ n)
    ex /= np.linalg.norm(ex)
    ey = np.cross(n, ex)
    return np.stack([ex, ey, n]), origin


def model_points(work, pts):
    ply = os.path.join(work, 'splat.ply')
    if os.path.exists(ply):
        d, _ = read_ply(ply)
        alpha = 1 / (1 + np.exp(-d['opacity']))
        keep = alpha > 0.5
        xyz = np.stack([d['x'], d['y'], d['z']], -1)[keep]
        rgb = np.clip(0.5 + SH_C0 * np.stack([d['f_dc_0'], d['f_dc_1'], d['f_dc_2']], -1)[keep], 0, 1) * 255
        return xyz, rgb, 'splat'
    xyz = np.array([p['xyz'] for p in pts.values()])
    rgb = np.array([p['rgb'] for p in pts.values()], np.float64)
    return xyz, rgb, 'COLMAP points'


def top_view(L, origin, unit_m, xyz, rgb, size=1400):
    q = (xyz - origin) @ L.T
    h = q[:, 2] * unit_m
    keep = (h > -0.3) & (h < 2.6)
    q, rgb, h = q[keep], rgb[keep], h[keep]
    lo = np.percentile(q[:, :2], 1, axis=0)
    hi = np.percentile(q[:, :2], 99, axis=0)
    pad = (hi - lo) * 0.06
    lo, hi = lo - pad, hi + pad
    k = (size - 1) / float(max(hi - lo))
    w, hgt = int((hi[0] - lo[0]) * k) + 1, int((hi[1] - lo[1]) * k) + 1
    img = np.zeros((hgt, w, 3), np.uint8)
    order = np.argsort(h)
    u = ((q[order, 0] - lo[0]) * k).astype(int)
    v = ((hi[1] - q[order, 1]) * k).astype(int)
    col = rgb[order][:, ::-1].astype(np.uint8)
    for du in (0, 1):
        for dv in (0, 1):
            img[np.clip(v + dv, 0, hgt - 1), np.clip(u + du, 0, w - 1)] = col
    view = {'lo': lo.tolist(), 'hi': hi.tolist(), 'px_per_unit': k, 'size': [w, hgt]}
    return img, view


def top_to_level(view, uv):
    lo, hi, k = view['lo'], view['hi'], view['px_per_unit']
    return np.array([lo[0] + uv[0] / k, hi[1] - uv[1] / k, 0.0])


def similarity_2d(src, dst):
    src, dst = np.asarray(src, float), np.asarray(dst, float)
    ms, md = src.mean(0), dst.mean(0)
    a, b = src - ms, dst - md
    cov = b.T @ a / len(src)
    U, S, Vt = np.linalg.svd(cov)
    D = np.diag([1.0, np.sign(np.linalg.det(U @ Vt))])
    R = U @ D @ Vt
    s = float(np.trace(np.diag(S) @ D) / (a ** 2).sum() * len(src))
    t = md - s * R @ ms
    return s, R, t


def load_plan(venue, anchors_path, mpp_arg):
    with open(venue) as f:
        v = json.load(f)
    plan = cv2.imread(os.path.join(ROOT, v['plan_image']))
    if plan is None:
        raise SystemExit(f'cannot read the venue plan {v["plan_image"]}')
    origin, mpp, source = [0.0, 0.0], mpp_arg, '--metres-per-px'
    if anchors_path and os.path.exists(anchors_path):
        with open(anchors_path) as f:
            a = json.load(f)
        if not mpp:
            mpp, source = a['plan']['metres_per_px'], os.path.relpath(anchors_path, ROOT)
        origin = a['plan'].get('origin', origin)
    return v, plan, origin, mpp, source


def solve(view, L, origin_L, pairs, plan_origin, mpp):
    src = np.array([p[0] for p in pairs], float)
    dst = np.array([p[1] for p in pairs], float)
    s2, R2, t2 = similarity_2d(src, dst)
    k = view['px_per_unit']
    unit_m = s2 * k * mpp
    flip = np.array([[1.0, 0, 0], [0, -1.0, 0], [0, 0, 1.0]])
    A = np.zeros((3, 3))
    A[np.ix_([0, 2], [0, 1])] = R2
    A[1, 2] = 1.0
    rot = A @ flip @ L
    off_uv = np.array([-view['lo'][0] * k, view['hi'][1] * k])
    plan0 = s2 * R2 @ off_uv + t2
    venue0 = np.array([(plan0[0] - plan_origin[0]) * mpp, 0.0, (plan0[1] - plan_origin[1]) * mpp])
    M = np.eye(4)
    M[:3, :3] = unit_m * rot
    M[:3, 3] = venue0 - unit_m * rot @ origin_L
    fit = s2 * (R2 @ src.T).T + t2
    resid = np.linalg.norm(fit - dst, axis=1) * mpp
    return M, unit_m, resid


def to_venue(M, p):
    return (M[:3, :3] @ np.asarray(p, float).T).T + M[:3, 3]


def write_splat(work, M, unit_m, bounds, limit):
    ply = os.path.join(work, 'splat.ply')
    if not os.path.exists(ply):
        say('no splat.ply yet: scene.json written, venue.splat comes after train and align again')
        return 0
    d, n = read_ply(ply)
    R = M[:3, :3] / unit_m
    xyz = to_venue(M, np.stack([d['x'], d['y'], d['z']], -1))
    (x0, y0, z0), (x1, y1, z1) = bounds
    keep = ((xyz[:, 0] >= x0) & (xyz[:, 0] <= x1) & (xyz[:, 1] >= y0) & (xyz[:, 1] <= y1) &
            (xyz[:, 2] >= z0) & (xyz[:, 2] <= z1))
    alpha = 1 / (1 + np.exp(-d['opacity']))
    keep &= alpha > 0.02
    idx = np.nonzero(keep)[0]
    logs = np.stack([d['scale_0'], d['scale_1'], d['scale_2']], -1)[idx]
    importance = alpha[idx] * np.exp(logs.sum(-1))
    idx = idx[np.argsort(-importance)][:limit]
    logs = np.stack([d['scale_0'], d['scale_1'], d['scale_2']], -1)[idx]
    scales = np.exp(logs) * unit_m
    q = np.stack([d['rot_0'], d['rot_1'], d['rot_2'], d['rot_3']], -1)[idx].astype(np.float64)
    q /= np.linalg.norm(q, axis=1, keepdims=True)
    r = R_to_qvec(R)
    w0, x0q, y0q, z0q = r
    w, x, y, z = q.T
    q2 = np.stack([w0 * w - x0q * x - y0q * y - z0q * z, w0 * x + x0q * w + y0q * z - z0q * y,
                   w0 * y - x0q * z + y0q * w + z0q * x, w0 * z + x0q * y - y0q * x + z0q * w], -1)
    rgb = np.clip(0.5 + SH_C0 * np.stack([d['f_dc_0'], d['f_dc_1'], d['f_dc_2']], -1)[idx], 0, 1)
    rgba = np.concatenate([rgb, alpha[idx, None]], -1)
    out = np.zeros(len(idx), np.dtype([('p', '<f4', 3), ('s', '<f4', 3), ('c', 'u1', 4), ('r', 'u1', 4)]))
    out['p'] = xyz[idx]
    out['s'] = scales
    out['c'] = np.clip(rgba * 255, 0, 255).astype(np.uint8)
    out['r'] = np.clip(q2 * 128 + 128, 0, 255).astype(np.uint8)
    path = os.path.join(work, 'venue.splat')
    out.tofile(path)
    say(f'{os.path.relpath(path, ROOT)}: {len(idx)} of {n} splats ({os.path.getsize(path) / 1e6:.0f} MB)')
    return len(idx)


def draw_text(img, s, org, colour=WHITE, scale=0.55, thick=1):
    cv2.putText(img, s, (org[0] + 1, org[1] + 1), FONT, scale, (0, 0, 0), thick + 2, cv2.LINE_AA)
    cv2.putText(img, s, org, FONT, scale, colour, thick, cv2.LINE_AA)


def fit_panel(img):
    k = min(PANEL_W / img.shape[1], PANEL_H / img.shape[0])
    return cv2.resize(img, (int(img.shape[1] * k), int(img.shape[0] * k)), interpolation=cv2.INTER_AREA), k


def align(args):
    model = os.path.join(args.work, 'sparse', '0')
    if not os.path.exists(os.path.join(model, 'images.bin')):
        raise SystemExit(f'no model in {model}: run poses first')
    cams, imgs, pts = read_model(model, args.work)
    centres = np.array([i['centre'] for i in imgs.values()])
    n, p0, rms, eye, n_floor, n_pts = floor_plane(imgs, pts)
    L, origin_L = level_frame(n, p0, centres)
    eye_unit = EYE_M / eye
    say(f'floor: {n_floor} of {n_pts} points within {rms * eye_unit * 100:.0f} cm of a plane, phone '
        f'{eye:.3f} model units above it (about {EYE_M} m if held at chest height)')
    xyz, rgb, what = model_points(args.work, pts)
    top, view = top_view(L, origin_L, eye_unit, xyz, rgb)
    cv2.imwrite(os.path.join(args.work, 'topdown.png'), top)
    json.dump(dict(view, L=L.tolist(), origin=origin_L.tolist()), open(os.path.join(args.work, 'topdown.json'), 'w'))
    say(f'top view of the {what} in {os.path.relpath(os.path.join(args.work, "topdown.png"), ROOT)}')
    if args.top_only:
        return
    venue, plan, plan_origin, mpp, source = load_plan(args.venue, args.anchors, args.metres_per_px)
    pairs, tape = [], []
    if args.pairs:
        for part in args.pairs.split(';'):
            if part.strip():
                a, b = part.split('=')
                pairs.append(([float(x) for x in a.split(',')], [float(x) for x in b.split(',')]))
    if args.tape:
        tape = [[float(x) for x in p.split(',')] for p in args.tape.split(';')]
    if not args.pairs:
        pairs, tape = click_pairs(top, plan, args.span)
        if pairs is None:
            return
    if len(pairs) < 2:
        raise SystemExit('two pairs of points at least')
    if not mpp:
        if len(tape) == 2 and args.span:
            mpp = None
        else:
            raise SystemExit('the plan has no scale: run security.py anchors first, or give --metres-per-px, or '
                             'measure tape marks (m, with --span)')
    if mpp is None:
        s2, _, _ = similarity_2d([p[0] for p in pairs], [p[1] for p in pairs])
        tape_units = math.dist(tape[0], tape[1]) / view['px_per_unit']
        mpp = args.span / tape_units / view['px_per_unit'] / s2
        source = f'the tape marks, {args.span} m apart'
    M, unit_m, resid = solve(view, L, origin_L, pairs, plan_origin, mpp)
    say(f'plan scale {mpp:.4f} m per pixel from {source}; model unit = {unit_m:.4f} m; phone height '
        f'{eye * unit_m:.2f} m')
    if len(pairs) > 2:
        say(f'pairs fit within {np.median(resid):.2f} m (worst {resid.max():.2f} m)')
    if not 1.0 <= eye * unit_m <= 2.4:
        say('the phone height comes out odd: check the pairs and the plan scale')
    check = None
    if len(tape) == 2:
        got = math.dist(tape[0], tape[1]) / view['px_per_unit'] * unit_m
        check = {'tape_points': tape, 'measured_m': args.span, 'model_m': round(got, 3)}
        if args.span:
            say(f'tape check: {got:.2f} m in the model against {args.span} m measured '
                f'({100 * (got / args.span - 1):+.1f}%)')
    floor_v = to_venue(M, [top_to_level(view, (0, 0)) @ L + origin_L,
                           top_to_level(view, view['size']) @ L + origin_L])
    lo = floor_v.min(0) - args.margin
    hi = floor_v.max(0) + args.margin
    bounds = [[float(lo[0]), -0.6, float(lo[2])], [float(hi[0]), args.ceiling, float(hi[2])]]
    count = write_splat(args.work, M, unit_m, bounds, args.web_splats)
    cam_v = to_venue(M, centres)
    scene = {'venue': os.path.relpath(args.venue, ROOT), 'created': iso(time.time()),
             'frame': 'x and z are plan metres (plan pixel = origin + (x, z) / metres_per_px), y is up',
             'model_to_venue': M.tolist(), 'metres_per_model_unit': unit_m,
             'plan': {'origin': plan_origin, 'metres_per_px': mpp, 'scale_from': source},
             'floor': {'rms_m': round(rms * unit_m, 3), 'points': n_floor},
             'phone_height_m': round(float(eye * unit_m), 2),
             'pairs': [{'top': list(map(float, a)), 'plan': list(map(float, b)), 'off_m': round(float(r), 3)}
                       for (a, b), r in zip(pairs, resid)],
             'tape': check, 'bounds': bounds, 'splat': 'venue.splat' if count else None, 'splats': count,
             'walk': [[round(float(v), 3) for v in c] for c in cam_v[::max(1, len(cam_v) // 120)]]}
    path = os.path.join(args.work, 'scene.json')
    with open(path, 'w') as f:
        json.dump(scene, f, indent=1)
    say(f'saved {os.path.relpath(path, ROOT)}')


def level(args):
    model = os.path.join(args.work, 'sparse', '0')
    if not os.path.exists(os.path.join(model, 'images.bin')):
        raise SystemExit(f'no model in {model}: run poses first')
    _, imgs, pts = read_model(model, args.work)
    centres = np.array([i['centre'] for i in imgs.values()])
    n, p0, rms, eye, n_floor, n_pts = floor_plane(imgs, pts)
    L, origin_L = level_frame(n, p0, centres)
    unit_m = args.phone_height / eye
    rot = np.array([[1.0, 0, 0], [0, 0, 1.0], [0, -1.0, 0]]) @ L
    M = np.eye(4)
    M[:3, :3] = unit_m * rot
    M[:3, 3] = -unit_m * rot @ origin_L
    say(f'floor: {n_floor} of {n_pts} points within {rms * unit_m * 100:.0f} cm of a plane; scaled so the phone was '
        f'{args.phone_height} m above it (about 10% either way)')
    xyz, _, _ = model_points(args.work, pts)
    v = to_venue(M, xyz)
    lo = np.percentile(v, 1, axis=0) - args.margin
    hi = np.percentile(v, 99, axis=0) + args.margin
    bounds = [[float(lo[0]), -0.6, float(lo[2])], [float(hi[0]), args.ceiling, float(hi[2])]]
    count = write_splat(args.work, M, unit_m, bounds, args.web_splats)
    cam_v = to_venue(M, centres)
    scene = {'venue': os.path.relpath(args.venue, ROOT), 'created': iso(time.time()), 'aligned': False,
             'frame': 'levelled on the floor at y = 0, y up, metres from the phone height; not yet matched to the plan',
             'model_to_venue': M.tolist(), 'metres_per_model_unit': unit_m,
             'plan': {'origin': [0.0, 0.0], 'metres_per_px': None, 'scale_from': f'phone {args.phone_height} m up'},
             'floor': {'rms_m': round(rms * unit_m, 3), 'points': n_floor}, 'phone_height_m': args.phone_height,
             'bounds': bounds, 'splat': 'venue.splat' if count else None, 'splats': count,
             'walk': [[round(float(c), 3) for c in p] for p in cam_v[::max(1, len(cam_v) // 120)]]}
    path = os.path.join(args.work, 'scene.json')
    with open(path, 'w') as f:
        json.dump(scene, f, indent=1)
    say(f'saved {os.path.relpath(path, ROOT)}: {(hi[0] - lo[0]):.0f} x {(hi[2] - lo[2]):.0f} m around the walk; '
        f'align later puts it on the plan')


def click_pairs(top, plan, span):
    left, kl = fit_panel(top)
    right, kr = fit_panel(plan)
    canvas_w = 2 * PANEL_W + 20
    state = {'pairs': [], 'pending': None, 'tape': [], 'measure': False}
    ox = PANEL_W + 20

    def on_mouse(event, x, y, *_):
        if event != cv2.EVENT_LBUTTONDOWN:
            return
        if x < PANEL_W and y < left.shape[0] and x < left.shape[1]:
            pt = (x / kl, y / kl)
            if state['measure']:
                state['tape'] = (state['tape'] + [pt])[-2:]
                if len(state['tape']) == 2:
                    state['measure'] = False
            else:
                state['pending'] = pt
        elif x >= ox and x - ox < right.shape[1] and y < right.shape[0] and state['pending']:
            state['pairs'].append((state['pending'], ((x - ox) / kr, y / kr)))
            state['pending'] = None

    cv2.namedWindow(WIN, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(WIN, canvas_w, PANEL_H + 60)
    cv2.setMouseCallback(WIN, on_mouse)
    while True:
        canvas = np.full((PANEL_H + 60, canvas_w, 3), 18, np.uint8)
        canvas[:left.shape[0], :left.shape[1]] = left
        canvas[:right.shape[0], ox:ox + right.shape[1]] = right
        for i, (a, b) in enumerate(state['pairs'], 1):
            pa = (int(a[0] * kl), int(a[1] * kl))
            pb = (int(b[0] * kr) + ox, int(b[1] * kr))
            for p in (pa, pb):
                cv2.circle(canvas, p, 6, CYAN, 2, cv2.LINE_AA)
                draw_text(canvas, str(i), (p[0] + 8, p[1] - 6), CYAN, 0.6, 2)
        if state['pending']:
            p = (int(state['pending'][0] * kl), int(state['pending'][1] * kl))
            cv2.circle(canvas, p, 7, AMBER, 2, cv2.LINE_AA)
        for p in state['tape']:
            cv2.drawMarker(canvas, (int(p[0] * kl), int(p[1] * kl)), GREEN, cv2.MARKER_TILTED_CROSS, 16, 2)
        if len(state['tape']) == 2:
            a, b = state['tape']
            cv2.line(canvas, (int(a[0] * kl), int(a[1] * kl)), (int(b[0] * kl), int(b[1] * kl)), GREEN, 1)
        tip = ('click the first tape mark' if state['measure'] and not state['tape'] else
               'click the second tape mark' if state['measure'] else
               'now click the same point on the plan' if state['pending'] else
               'click a corner, pillar or door on the model view (left)')
        draw_text(canvas, f'{tip}   pairs {len(state["pairs"])}   u undo   m tape marks'
                  f'{f" ({span} m)" if span else ""}   s save   q quit', (12, PANEL_H + 38), WHITE, 0.6)
        draw_text(canvas, 'model from above', (12, 24), WHITE)
        draw_text(canvas, 'venue plan', (ox + 12, 24), WHITE)
        cv2.imshow(WIN, canvas)
        key = cv2.waitKey(30) & 0xFF
        if key in (ord('q'), 27):
            cv2.destroyWindow(WIN)
            return None, None
        if key == ord('u'):
            if state['pending']:
                state['pending'] = None
            elif state['pairs']:
                state['pairs'].pop()
        if key == ord('m'):
            state['measure'], state['tape'] = True, []
        if key == ord('s') and len(state['pairs']) >= 2:
            cv2.destroyWindow(WIN)
            return state['pairs'], state['tape']


def camera(args):
    scene_path = os.path.join(args.work, 'scene.json')
    if not os.path.exists(scene_path):
        raise SystemExit('no scene.json: run align first')
    scene = json.load(open(scene_path))
    M = np.array(scene['model_to_venue'])
    unit_m = scene['metres_per_model_unit']
    folder = os.path.join(args.work, 'cameras', args.name)
    shutil.rmtree(folder, ignore_errors=True)
    os.makedirs(os.path.join(folder, 'images'))
    name = f'camera_{args.name}.jpg'
    still = os.path.join(folder, 'images', name)
    pick_frame(args.frame, still)
    db = os.path.join(folder, 'colmap.db')
    shutil.copy(os.path.join(args.work, 'colmap.db'), db)
    colmap(args.work, 'feature_extractor', '--database_path', db, '--image_path', os.path.join(folder, 'images'),
           '--ImageReader.camera_model', 'SIMPLE_RADIAL', '--FeatureExtraction.use_gpu', '0',
           '--SiftExtraction.max_num_features', str(args.features))
    _, imgs, _ = read_model(os.path.join(args.work, 'sparse', '0'), args.work)
    with open(os.path.join(folder, 'pairs.txt'), 'w') as f:
        for other in imgs:
            f.write(f'{name} {other}\n')
    colmap(args.work, 'matches_importer', '--database_path', db, '--match_list_path',
           os.path.join(folder, 'pairs.txt'), '--match_type', 'pairs', '--FeatureMatching.use_gpu', '0')
    out = os.path.join(folder, 'model')
    os.makedirs(out)
    colmap(args.work, 'image_registrator', '--database_path', db, '--input_path', os.path.join(args.work, 'sparse', '0'),
           '--output_path', out)
    cams, imgs2, _ = read_model(out, folder)
    if name not in imgs2:
        raise SystemExit('the frame could not be placed in the model: the walk needs to pass near the camera and '
                         'look the way it looks')
    im = imgs2[name]
    cam = cams[im['camera']]
    f, cx, cy, k1 = cam['params'][:4]
    w, h = cam['size']
    R_M = M[:3, :3] / unit_m
    R_v = im['R'] @ R_M.T
    t_v = unit_m * im['t'] - R_v @ M[:3, 3]
    centre = -R_v.T @ t_v
    K = np.array([[f, 0, cx], [0, f, cy], [0, 0, 1.0]])
    fwd = R_v[2]
    tilt = math.degrees(math.asin(max(-1.0, min(1.0, -fwd[1]))))
    say(f'camera {args.name}: {im["points"]} points matched, at x {centre[0]:.2f} z {centre[2]:.2f} m, '
        f'{centre[1]:.2f} m up, looking {tilt:.0f} degrees down, '
        f'{math.degrees(2 * math.atan(w / 2 / f)):.0f} degree wide lens')
    plan = scene['plan']
    mpp, (ox, oy) = plan['metres_per_px'], plan['origin']
    G = np.stack([R_v[:, 0], R_v[:, 2], args.height * R_v[:, 1] + t_v], axis=1)
    D = np.array([[mpp, 0, -ox * mpp], [0, mpp, -oy * mpp], [0, 0, 1.0]])
    N = np.diag([1.0 / w, 1.0 / h, 1.0])
    Hp = np.linalg.inv(N @ K @ G @ D)
    Hp /= Hp[2, 2]
    pose = {'K': K.tolist(), 'k1': k1, 'size': [w, h], 'R': R_v.tolist(), 't': t_v.tolist(),
            'centre': centre.tolist(), 'points': im['points'], 'height_m': args.height, 'created': iso(time.time())}
    cal_dir = os.path.join(args.out, 'cameras')
    os.makedirs(cal_dir, exist_ok=True)
    path = os.path.join(cal_dir, f'{args.name}.json')
    snap = f'{args.name}_lit.jpg'
    if os.path.exists(path):
        cal = json.load(open(path))
        errs = []
        for p in cal.get('points', []):
            v = Hp @ np.array([p['image'][0], p['image'][1], 1.0])
            errs.append(math.dist((v[0] / v[2], v[1] / v[2]), p['map']) * mpp)
        if errs:
            say(f'against the {len(errs)} calibration spots the pose is off by {np.median(errs):.2f} m median, '
                f'{max(errs):.2f} m worst')
        if args.use_pose:
            cal['homography_spots'] = cal.get('homography')
            cal['homography'] = Hp.tolist()
    else:
        shutil.copy(still, os.path.join(cal_dir, snap))
        cal = {'name': args.name, 'camera': args.source, 'frame': [w, h], 'snapshot': snap,
               'venue': scene['venue'], 'points': [], 'homography': Hp.tolist(), 'created': iso(time.time())}
    cal['pose'] = pose
    with open(path, 'w') as f:
        json.dump(cal, f, indent=1)
    say(f'saved {os.path.relpath(path, ROOT)}' + ('' if cal.get('points') and not args.use_pose else
                                                  ': its image-to-plan mapping comes from the pose'))


def pick_frame(src, dst):
    if src.lower().endswith(('.jpg', '.jpeg', '.png')):
        img = cv2.imread(src)
        if img is None:
            raise SystemExit(f'cannot read {src}')
        cv2.imwrite(dst, img, [cv2.IMWRITE_JPEG_QUALITY, 95])
        return
    cap = cv2.VideoCapture(src)
    best, sharp = None, -1.0
    while cap.get(cv2.CAP_PROP_POS_MSEC) < 10000:
        ok, f = cap.read()
        if not ok:
            break
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
        v = float(cv2.Laplacian(g, cv2.CV_32F).var())
        if v > sharp:
            best, sharp = f, v
    if best is None:
        raise SystemExit(f'cannot read {src}')
    cv2.imwrite(dst, best, [cv2.IMWRITE_JPEG_QUALITY, 95])


def everything(args):
    frames(args)
    poses(args)
    train(args)
    level(args)


def main():
    ap = argparse.ArgumentParser(description=USAGE, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('mode', choices=['check', 'frames', 'poses', 'train', 'level', 'align', 'camera', 'all'])
    ap.add_argument('video', nargs='*', help='frames, all: the walk-through video, or several of the same place')
    ap.add_argument('--work', default=WORK)
    ap.add_argument('--count', type=int, default=0, help='frames: how many to keep (default: one a second of video, 300 to 1500)')
    ap.add_argument('--sample-fps', type=float, default=0, help='frames: frames looked at a second (default: three per kept frame)')
    ap.add_argument('--width', type=int, default=1600, help='frames: longer side in pixels')
    ap.add_argument('--features', type=int, default=4096)
    ap.add_argument('--matcher', choices=['auto', 'exhaustive', 'sequential'], default='auto')
    ap.add_argument('--mapper', choices=['global', 'incremental'], default='global')
    ap.add_argument('--brush', default=BRUSH)
    ap.add_argument('--steps', type=int, default=30000)
    ap.add_argument('--max-splats', type=int, default=3000000)
    ap.add_argument('--max-resolution', type=int, default=0, help='train: longest side (default 1600, 1280 above 600 frames)')
    ap.add_argument('--vocab', help='poses: COLMAP vocabulary tree (default: fetched once into .tools/colmap)')
    ap.add_argument('--venue', default=VENUE)
    ap.add_argument('--anchors', default=os.path.join(SECURITY, 'anchors.json'))
    ap.add_argument('--metres-per-px', type=float)
    ap.add_argument('--pairs', help='align: U,V=X,Y;... top view pixels = plan pixels')
    ap.add_argument('--tape', help='align: U,V;U,V the two tape marks in top view pixels')
    ap.add_argument('--span', type=float, help='align: metres between the tape marks')
    ap.add_argument('--top-only', action='store_true')
    ap.add_argument('--margin', type=float, default=2.0, help='align: metres kept around the walked area')
    ap.add_argument('--ceiling', type=float, default=12.0, help='align: splats above this height are dropped')
    ap.add_argument('--web-splats', type=int, default=2500000)
    ap.add_argument('--name', help='camera: camera position name, for example pit')
    ap.add_argument('--frame', help='camera: a still or a video from the camera position')
    ap.add_argument('--source', default='0', help='camera: the live camera index or stream for a new calibration')
    ap.add_argument('--height', type=float, default=0.9, help='camera: wrist height for the image-to-plan mapping')
    ap.add_argument('--use-pose', action='store_true')
    ap.add_argument('--phone-height', type=float, default=EYE_M, help='level: metres the phone was held above the floor')
    ap.add_argument('--out', default=SECURITY)
    args = ap.parse_args()
    if args.mode in ('check', 'frames', 'all') and not args.video:
        ap.error('the walk-through video')
    if args.mode == 'camera' and not (args.name and args.frame):
        ap.error('camera needs --name and --frame')
    os.makedirs(args.work, exist_ok=True)
    {'check': check, 'frames': frames, 'poses': poses, 'train': train, 'level': level, 'align': align, 'camera': camera,
     'all': everything}[args.mode](args)


if __name__ == '__main__':
    main()
