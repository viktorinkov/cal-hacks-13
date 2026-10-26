"""Draws the venue floor grid from above with the medic's real paths (from web/src/floor-path.ts)."""
import json, math, sys
from collections import deque
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = str(__import__('pathlib').Path(__file__).resolve().parents[2] / 'web' / 'venue') + '/'
f = json.load(open(ROOT + 'floor.json'))
spots = json.load(open(ROOT + 'spots.json'))
paths = [json.loads(l) for l in open(sys.argv[1])]
out = sys.argv[2]
cols, rows, cell, x0, z0 = f['cols'], f['rows'], f['cell'], f['x0'], f['z0']
open_ = np.zeros(cols * rows, dtype=bool)
i = 0
for k, n in enumerate(f['runs']):
    if k % 2 == 1:
        open_[i:i + n] = True
    i += n
open_ = open_.reshape(rows, cols)
# Closed cells joined to the grid's edge are outside the building; the rest are tables, walls, the stage.
outside = np.zeros_like(open_)
q = deque()
for r in range(rows):
    for c in (0, cols - 1):
        if not open_[r, c] and not outside[r, c]:
            outside[r, c] = True; q.append((r, c))
for c in range(cols):
    for r in (0, rows - 1):
        if not open_[r, c] and not outside[r, c]:
            outside[r, c] = True; q.append((r, c))
while q:
    r, c = q.popleft()
    for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nr, nc = r + dr, c + dc
        if 0 <= nr < rows and 0 <= nc < cols and not open_[nr, nc] and not outside[nr, nc]:
            outside[nr, nc] = True; q.append((nr, nc))

# Crop: model metres.
X0, X1, Z0, Z1 = float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6])
PX = float(sys.argv[7]) if len(sys.argv) > 7 else 16  # pixels per metre
W, H = int((X1 - X0) * PX), int((Z1 - Z0) * PX)
SS = 2  # drawn at twice the size, then shrunk for smooth edges
img = Image.new('RGB', (W * SS, H * SS), '#d6f0fb')
px = img.load()
FLOOR, BLOCK = (241, 243, 245), (73, 80, 87)
c0, c1 = int((X0 - x0) / cell), int(math.ceil((X1 - x0) / cell))
r0, r1 = int((Z0 - z0) / cell), int(math.ceil((Z1 - z0) / cell))
d = ImageDraw.Draw(img)
def to_px(x, z):
    return ((x - X0) * PX * SS, (z - Z0) * PX * SS)
for r in range(max(0, r0), min(rows, r1)):
    for c in range(max(0, c0), min(cols, c1)):
        if outside[r, c]:
            continue
        col = FLOOR if open_[r, c] else BLOCK
        a = to_px(x0 + c * cell, z0 + r * cell)
        b = to_px(x0 + (c + 1) * cell, z0 + (r + 1) * cell)
        d.rectangle([a[0], a[1], b[0] - 1, b[1] - 1], fill=col)

def font(sz):
    for path in ('/usr/share/fonts/opentype/inter/Inter-SemiBold.otf',
                 '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
                 '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'):
        if Path(path).is_file():
            return ImageFont.truetype(path, int(sz * SS))
    return ImageFont.load_default(size=int(sz * SS))
def ring(x, z, rad_m, width_m, colour):
    cx, cy = to_px(x, z); r = rad_m * PX * SS; w = max(2, int(width_m * PX * SS))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=colour, width=w)
def dot(x, z, rad_m, colour, outline=None, w=0):
    cx, cy = to_px(x, z); r = rad_m * PX * SS
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=colour, outline=outline, width=w)
def label(x, z, text, sz, colour, dx=0, dy=0, anchor='mm', bg=None):
    cx, cy = to_px(x, z)
    fnt = font(sz)
    tx, ty = cx + dx * SS, cy + dy * SS
    bb = d.textbbox((tx, ty), text, font=fnt, anchor=anchor)
    padding = 12 * SS
    tx += max(0, padding - bb[0]) - max(0, bb[2] + padding - W * SS)
    ty += max(0, padding - bb[1]) - max(0, bb[3] + padding - H * SS)
    if bg:
        bb = d.textbbox((tx, ty), text, font=fnt, anchor=anchor)
        d.rounded_rectangle([bb[0] - 8 * SS, bb[1] - 5 * SS, bb[2] + 8 * SS, bb[3] + 5 * SS], 6 * SS, fill=bg)
    d.text((tx, ty), text, font=fnt, fill=colour, anchor=anchor)
def dashed(a, b, colour, w, dash=10, gap=8):
    (ax, ay), (bx, by) = to_px(*a), to_px(*b)
    L = math.hypot(bx - ax, by - ay); n = L / ((dash + gap) * SS)
    for k in range(int(n) + 1):
        t0 = k * (dash + gap) * SS / L; t1 = min(1, t0 + dash * SS / L)
        if t0 >= 1: break
        d.line([(ax + (bx - ax) * t0, ay + (by - ay) * t0), (ax + (bx - ax) * t1, ay + (by - ay) * t1)], fill=colour, width=w * SS)

# Every door the medic can come in through.
EXIT_BLUE = '#2f6bff'
for s in spots:
    if s['kind'] in ('exit', 'entrance') and X0 <= s['x'] <= X1 and Z0 <= s['z'] <= Z1:
        if s['kind'] == 'exit':
            ring(s['x'], s['z'], 1.6, 0.6, EXIT_BLUE)
        else:
            dot(s['x'], s['z'], 0.7, EXIT_BLUE)

GAP_M = 1.4
for p in paths:
    way = p['way']; to = p['to']
    # Straight line from the door: crosses tables.
    dashed(way[0], p['snapped'], '#e03131', 3)
    # The walk the medic takes, along the aisles.
    pts = [to_px(*w) for w in way]
    d.line(pts, fill='#0ca678', width=7 * SS, joint='curve')
    for q in pts[1:-1]:
        d.ellipse([q[0] - 5 * SS, q[1] - 5 * SS, q[0] + 5 * SS, q[1] + 5 * SS], fill='#087f5b')
    # The person who fell: red rings.
    ring(to[0], to[1], 2.1, 0.35, '#ff2f45'); ring(to[0], to[1], 3.2, 0.2, '#ff8a96')
    dot(to[0], to[1], 0.55, '#ff2f45')
    # The medic stops 1.4 m short.
    along = [0]
    for k in range(1, len(way)):
        along.append(along[-1] + math.hypot(way[k][0] - way[k - 1][0], way[k][1] - way[k - 1][1]))
    m = along[-1] - GAP_M
    for k in range(1, len(way)):
        if m <= along[k]:
            t = (m - along[k - 1]) / max(1e-6, along[k] - along[k - 1])
            mx, mz = way[k - 1][0] + (way[k][0] - way[k - 1][0]) * t, way[k - 1][1] + (way[k][1] - way[k - 1][1]) * t
            break
    dot(mx, mz, 0.85, '#ffffff', outline='#2fe08a', w=4 * SS)
    label(mx, mz, '+', 15, '#0ca678')
    label(to[0], to[1], p['name'], 15, '#ffffff', dy=-50, bg='#c92a2a')

import os
LS = float(os.environ.get('LS', 15))
DOORS = (('Public Entrance', (-31.3, -3.5), 0, 38, 'mm'), ('Loading Doors', (-34.6, -44.3), 0, -36, 'mm'),
         ('Loading Doors', (43.5, 19.2), 0, 40, 'mm'), ('Business Entrance, Check-in', (88.5, 36.9), -40, 0, 'rm'))
for name, (x, z), dx, dy, anchor in DOORS:
    if X0 <= x <= X1 and Z0 <= z <= Z1:
        label(x, z, name, LS, '#ffffff', dx=dx * LS / 15, dy=dy * LS / 15, anchor=anchor, bg=EXIT_BLUE)
img = img.resize((W, H), Image.LANCZOS)
img.save(out)
print(out, W, H)
