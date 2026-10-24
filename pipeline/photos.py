import argparse
import hashlib
import json
import os
import signal
import sys
import time
from datetime import datetime, timedelta, timezone

from PIL import Image

from elastic import DATA, PREFIX, Elastic

try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
    HEIF = True
except ImportError:
    HEIF = False

INBOX = os.path.expanduser('~/Desktop/band1t-photos')
USAGE = """import photos with exact times and locations, for matching against the band data

  python3 pipeline/photos.py --session calhacks --upload             photos in ~/Desktop/band1t-photos
  python3 pipeline/photos.py --session calhacks --upload --watch     keep running, import each photo dropped in
  python3 pipeline/photos.py /Volumes/CARD/DCIM --sync IMG_0001.JPG=21:14:05 --session calhacks    camera SD card

iPhone: AirDrop the photos to the Mac and drag them into ~/Desktop/band1t-photos. HEIC and JPEG both work, the
phone's clock is already exact, and its location is kept when the photo has one. Screenshots, videos and Live Photo
movies are skipped. Camera: a sync shot is a photo of a phone showing a clock with seconds; pass its file name and
the time shown. One corrects the offset, two (start and end) also the drift. Times without a zone use --tz
(California is -07:00 until Nov 1). Records go to pipeline/data/photos_<session>_<time>.jsonl, and with --upload to
the bandit-raw-photos index; importing a photo again never creates a duplicate."""

EXIF_IFD, GPS_IFD, MAKE, MODEL, DATETIME = 0x8769, 0x8825, 0x010F, 0x0110, 0x0132
ORIGINAL, SUBSEC, OFFSET = 0x9003, 0x9291, 0x9011
PHOTO_EXT = ('.jpg', '.jpeg', '.heic', '.heif')
SETTLE_S = 2


def parse_tz(text):
    sign = -1 if text.startswith('-') else 1
    h, m = text.lstrip('+-').split(':')
    return timezone(sign * timedelta(hours=int(h), minutes=int(m)))


def read_gps(exif):
    g = exif.get_ifd(GPS_IFD)
    if not g or 2 not in g or 4 not in g:
        return {}

    def degrees(v):
        d, m, s = (float(x) for x in v)
        return d + m / 60 + s / 3600

    lat = degrees(g[2]) * (-1 if str(g.get(1, 'N')).upper().startswith('S') else 1)
    lon = degrees(g[4]) * (-1 if str(g.get(3, 'E')).upper().startswith('W') else 1)
    out = {'location': {'lat': round(lat, 7), 'lon': round(lon, 7)}}
    if 31 in g:
        out['gps_accuracy_m'] = round(float(g[31]), 1)
    return out


def read_photo(path, default_tz):
    with Image.open(path) as img:
        exif = img.getexif()
        sub = exif.get_ifd(EXIF_IFD)
        stamp = sub.get(ORIGINAL) or exif.get(DATETIME)
        if not stamp:
            return None
        frac = str(sub.get(SUBSEC, '')).strip()
        tz = parse_tz(str(sub[OFFSET])) if sub.get(OFFSET) else default_tz
        cam = datetime.strptime(str(stamp).strip(), '%Y:%m:%d %H:%M:%S').replace(tzinfo=tz)
        if frac.isdigit():
            cam += timedelta(seconds=float('0.' + frac))
        width, height = img.size
        make, model = str(exif.get(MAKE, '')).strip(), str(exif.get(MODEL, '')).strip()
        gps = read_gps(exif)
    with open(path, 'rb') as f:
        digest = hashlib.sha1(f.read()).hexdigest()
    return dict({'cam': cam, 'camera_time': str(stamp).strip() + (f'.{frac}' if frac.isdigit() else ''),
                 'name': os.path.basename(path), 'file': os.path.abspath(path), 'sha1': digest, 'make': make,
                 'model': model, 'width': width, 'height': height,
                 'source': 'iphone' if make.lower() == 'apple' else 'camera'}, **gps)


def scan(folder, tz, settle):
    photos, skipped = [], 0
    for root, _, files in os.walk(folder):
        for f in sorted(files):
            low, path = f.lower(), os.path.join(root, f)
            if f.startswith('.') or not low.endswith(PHOTO_EXT):
                continue
            if settle and time.time() - os.path.getmtime(path) < settle:
                continue
            if low.endswith(('.heic', '.heif')) and not HEIF:
                raise SystemExit('HEIC photos need pillow-heif: python3 -m pip install --user pillow-heif')
            try:
                p = read_photo(path, tz)
            except (OSError, ValueError, SyntaxError):
                p = None
            if p:
                photos.append(p)
            else:
                skipped += 1
    return photos, skipped


def sync_points(photos, specs, default_tz, strict):
    by_name = {p['name'].lower(): p for p in photos}
    points = []
    for spec in specs:
        name, _, shown = spec.partition('=')
        p = by_name.get(name.lower())
        if not p:
            if strict:
                raise SystemExit(f'sync photo {name} not found')
            continue
        if 'T' in shown:
            true = datetime.fromisoformat(shown)
            true = true if true.tzinfo else true.replace(tzinfo=default_tz)
        else:
            clock = datetime.strptime(shown, '%H:%M:%S.%f' if '.' in shown else '%H:%M:%S').time()
            true = datetime.combine(p['cam'].date(), clock, tzinfo=p['cam'].tzinfo)
            if abs((true - p['cam']).total_seconds()) > 43200:
                true += timedelta(days=1 if true < p['cam'] else -1)
        p['sync'] = True
        points.append((p['cam'].timestamp(), true.timestamp()))
    return sorted(points)


def offset_at(points, cam_s):
    if not points:
        return 0.0
    if len(points) == 1:
        return points[0][1] - points[0][0]
    (c0, t0), (c1, t1) = points[0], points[-1]
    o0, o1 = t0 - c0, t1 - c1
    return o0 if c1 == c0 else o0 + (o1 - o0) * (cam_s - c0) / (c1 - c0)


def to_records(photos, points, session):
    records = []
    for p in sorted(photos, key=lambda p: p['cam']):
        off = offset_at(points, p['cam'].timestamp())
        utc = datetime.fromtimestamp(p['cam'].timestamp() + off, timezone.utc)
        r = {'@timestamp': utc.isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
             'camera_time': p['camera_time'], 'offset_s': round(off, 3), 'sync': p.get('sync', False),
             'source': p['source'], 'name': p['name'], 'file': p['file'], 'sha1': p['sha1'], 'make': p['make'],
             'model': p['model'], 'width': p['width'], 'height': p['height'], 'session': session}
        for k in ('location', 'gps_accuracy_m'):
            if k in p:
                r[k] = p[k]
        records.append(r)
    return records


def say(text):
    print(text, flush=True)


def stop(*_):
    raise KeyboardInterrupt


def main():
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    ap = argparse.ArgumentParser(description=USAGE, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('folder', nargs='?', default=INBOX)
    ap.add_argument('--sync', action='append', default=[])
    ap.add_argument('--tz', default='-07:00')
    ap.add_argument('--session', default=datetime.now().strftime('photos-%m%d'))
    ap.add_argument('--upload', action='store_true')
    ap.add_argument('--watch', action='store_true')
    ap.add_argument('--prefix', default=PREFIX)
    args = ap.parse_args()
    tz = parse_tz(args.tz)
    if args.folder == INBOX:
        os.makedirs(INBOX, exist_ok=True)
    es = Elastic(args.prefix) if args.upload else None
    os.makedirs(DATA, exist_ok=True)
    out = os.path.join(DATA, f'photos_{args.session}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.jsonl')
    seen, total = set(), 0
    if args.watch:
        say(f'watching {args.folder}: drop photos in, Ctrl-C to stop')
    try:
        while True:
            photos, skipped = scan(args.folder, tz, SETTLE_S if args.watch else 0)
            points = sync_points(photos, args.sync, tz, strict=not args.watch)
            new = []
            for p in photos:
                if p['sha1'] not in seen and all(p['sha1'] != q['sha1'] for q in new):
                    new.append(p)
            if not photos and not args.watch:
                raise SystemExit(f'no photos with a capture time in {args.folder}')
            if new:
                records = to_records(new, points, args.session)
                with open(out, 'a') as f:
                    for r in records:
                        f.write(json.dumps(r, separators=(',', ':')) + '\n')
                seen.update(p['sha1'] for p in new)
                total += len(records)
                located = sum(1 for r in records if 'location' in r)
                say(f'{len(records)} photos imported ({located} with location, {skipped} skipped), '
                      f'{len(points)} sync shots, {records[0]["@timestamp"]} to {records[-1]["@timestamp"]}')
                if not points and any(r['source'] == 'camera' for r in records):
                    say('camera photos without a sync shot: their times are used as the camera recorded them')
                if es:
                    n = es.bulk('photos', [(r['sha1'][:24], r) for r in records])
                    say(f'{n} uploaded to {args.prefix}-photos')
            if not args.watch:
                break
            time.sleep(3)
    except KeyboardInterrupt:
        pass
    say(f'{total} photos imported in total, records in {out}')


if __name__ == '__main__':
    main()
