import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timedelta, timezone

from PIL import Image

from elastic import DATA, Elastic

USAGE = """import photos from a camera's SD card with corrected times

  python3 pipeline/photos.py /Volumes/CAMERA/DCIM --sync IMG_0001.JPG=21:14:05 --sync IMG_0150.JPG=23:02:41 \\
      --session calhacks [--tz -07:00] [--upload]

A sync shot is a photo of a phone showing a clock with seconds; give its file name and the time the phone shows.
One sync shot corrects the camera's offset, two (start and end) also correct its drift. Camera times without a
zone use --tz (California is -07:00 until Nov 1). Writes pipeline/data/photos_<session>_<time>.jsonl and, with
--upload, the same records to the bandit-photos index. Sync shots are kept but marked "sync": true."""

EXIF_IFD, MAKE, MODEL, DATETIME = 0x8769, 0x010F, 0x0110, 0x0132
ORIGINAL, SUBSEC, OFFSET = 0x9003, 0x9291, 0x9011
PHOTO_EXT = ('.jpg', '.jpeg')


def parse_tz(text):
    sign = -1 if text.startswith('-') else 1
    h, m = text.lstrip('+-').split(':')
    return timezone(sign * timedelta(hours=int(h), minutes=int(m)))


def read_photo(path, default_tz):
    with Image.open(path) as img:
        exif = img.getexif()
        sub = exif.get_ifd(EXIF_IFD)
        stamp = sub.get(ORIGINAL) or exif.get(DATETIME)
        if not stamp:
            return None
        frac = str(sub.get(SUBSEC, '')).strip()
        tz = parse_tz(sub[OFFSET]) if sub.get(OFFSET) else default_tz
        cam = datetime.strptime(str(stamp).strip(), '%Y:%m:%d %H:%M:%S').replace(tzinfo=tz)
        if frac.isdigit():
            cam += timedelta(seconds=float('0.' + frac))
        width, height = img.size
        make, model = str(exif.get(MAKE, '')).strip(), str(exif.get(MODEL, '')).strip()
    with open(path, 'rb') as f:
        digest = hashlib.sha1(f.read()).hexdigest()
    return {'cam': cam, 'camera_time': str(stamp).strip() + (f'.{frac}' if frac.isdigit() else ''),
            'name': os.path.basename(path), 'file': os.path.abspath(path), 'sha1': digest,
            'make': make, 'model': model, 'width': width, 'height': height}


def sync_points(photos, specs, default_tz):
    by_name = {p['name'].lower(): p for p in photos}
    points = []
    for spec in specs:
        name, _, shown = spec.partition('=')
        p = by_name.get(name.lower())
        if not p:
            raise SystemExit(f'sync photo {name} not found')
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


def main():
    ap = argparse.ArgumentParser(description=USAGE, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('folder')
    ap.add_argument('--sync', action='append', default=[])
    ap.add_argument('--tz', default='-07:00')
    ap.add_argument('--session', default=datetime.now().strftime('photos-%m%d'))
    ap.add_argument('--upload', action='store_true')
    ap.add_argument('--prefix', default='bandit')
    args = ap.parse_args()
    tz = parse_tz(args.tz)

    photos, skipped = [], 0
    for root, _, files in os.walk(args.folder):
        for f in sorted(files):
            if f.lower().endswith(PHOTO_EXT) and not f.startswith('._'):
                p = read_photo(os.path.join(root, f), tz)
                if p:
                    photos.append(p)
                else:
                    skipped += 1
    if not photos:
        raise SystemExit(f'no photos with EXIF time under {args.folder}')
    points = sync_points(photos, args.sync, tz)
    if not points:
        sys.stderr.write('no sync shot given: camera times are used as they are\n')

    records = []
    for p in sorted(photos, key=lambda p: p['cam']):
        off = offset_at(points, p['cam'].timestamp())
        utc = datetime.fromtimestamp(p['cam'].timestamp() + off, timezone.utc)
        records.append({'@timestamp': utc.isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
                        'camera_time': p['camera_time'], 'offset_s': round(off, 3), 'sync': p.get('sync', False),
                        'name': p['name'], 'file': p['file'], 'sha1': p['sha1'], 'make': p['make'],
                        'model': p['model'], 'width': p['width'], 'height': p['height'], 'session': args.session})

    os.makedirs(DATA, exist_ok=True)
    out = os.path.join(DATA, f'photos_{args.session}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.jsonl')
    with open(out, 'w') as f:
        for r in records:
            f.write(json.dumps(r, separators=(',', ':')) + '\n')

    offsets = [r['offset_s'] for r in records]
    print(f'{len(records)} photos ({skipped} without EXIF time skipped), {len(points)} sync shots')
    print(f'camera offset {offsets[0]:+.1f} s at the first photo, {offsets[-1]:+.1f} s at the last')
    print(f'first {records[0]["@timestamp"]}  last {records[-1]["@timestamp"]}')
    print(f'written to {out}')
    if args.upload:
        n = Elastic(args.prefix).bulk('photos', [(r['sha1'][:24], r) for r in records])
        print(f'{n} photo records uploaded to {args.prefix}-photos')


if __name__ == '__main__':
    main()
