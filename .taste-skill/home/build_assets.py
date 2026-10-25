import json
import os
import numpy as np
from PIL import Image, ImageOps

OUT = '../../.worktrees/home/frontend/src/home/assets'
MERCH = '../../.worktrees/home/assets/merch'
os.makedirs(OUT, exist_ok=True)

band = Image.open('band-off.png').convert('RGBA')
band.save(f'{OUT}/band.webp', 'WEBP', quality=90, method=6)
print('band', band.size, os.path.getsize(f'{OUT}/band.webp'))

meta = json.load(open('band-ring.json'))
slim = {k: meta[k] for k in ('width', 'height', 'center', 'step', 'count', 'pitch', 'phase', 'inner', 'outer')}
slim['inner'] = [[round(x, 1), round(y, 1)] for x, y in slim['inner']]
slim['outer'] = [[round(x, 1), round(y, 1)] for x, y in slim['outer']]
slim['pitch'] = round(slim['pitch'], 3)
slim['phase'] = round(slim['phase'], 2)
slim['center'] = [round(v, 1) for v in slim['center']]
json.dump(slim, open(f'{OUT}/ring.json', 'w'), separators=(',', ':'))

photos = {
    'stage-green': 'assets/beach-please-2022-main-stage-green-lights.jpg',
    'hands-up': 'assets/concert-crowd-unsplash.jpg',
    'mud': 'assets/muddy-evening-concert-crowd-saemangeum-30-july.jpg',
}
for name, path in photos.items():
    im = Image.open(path).convert('RGB')
    for w in (2400, 1200):
        h = round(im.height * w / im.width)
        im.resize((w, h), Image.LANCZOS).save(f'{OUT}/{name}-{w}.jpg', 'JPEG', quality=78, optimize=True, progressive=True)
        print(name, w, h, os.path.getsize(f'{OUT}/{name}-{w}.jpg'))


def key_in(template, photo, out, w=1000, crop_y=0.5):
    t = Image.open(f'{MERCH}/{template}.png').convert('RGB')
    a = np.asarray(t).astype(int)
    green = (a[..., 1] > 200) & (a[..., 0] < 90) & (a[..., 2] < 90)
    ys, xs = np.where(green)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    bw, bh = x1 - x0, y1 - y0
    p = Image.open(photo).convert('RGB')
    p = ImageOps.fit(p, (bw, bh), Image.LANCZOS, centering=(0.5, crop_y))
    # Printed look on fabric and ceramic: a touch flatter than the photograph.
    p = Image.blend(p, Image.new('RGB', p.size, (24, 24, 26)), 0.06)
    t.paste(p, (x0, y0), Image.fromarray((green[y0:y1, x0:x1] * 255).astype(np.uint8)))
    t = t.resize((w, round(t.height * w / t.width)), Image.LANCZOS)
    t.save(f'{OUT}/{out}.jpg', 'JPEG', quality=82, optimize=True, progressive=True)
    print(out, t.size, os.path.getsize(f'{OUT}/{out}.jpg'))


key_in('tee', 'assets/concert-crowd-unsplash.jpg', 'merch-tee', crop_y=0.45)
key_in('mug', 'assets/muddy-evening-concert-crowd-saemangeum-30-july.jpg', 'merch-mug', crop_y=0.6)
key_in('poster', 'assets/concert-crowd-unsplash.jpg', 'merch-poster', crop_y=0.4)
key_in('poster_booth_crawl', 'assets/muddy-evening-concert-crowd-saemangeum-30-july.jpg', 'merch-crawl', crop_y=0.55)
