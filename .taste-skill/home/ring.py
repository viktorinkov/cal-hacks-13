import json
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

src = Image.open('band-cutout.png').convert('RGBA')
a = np.asarray(src).astype(np.float32)
H, W = a.shape[:2]
r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
mx = np.maximum(np.maximum(r, g), b)
mn = np.minimum(np.minimum(r, g), b)
lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
yy, xx = np.mgrid[0:H, 0:W]

face = (xx < 400) & (yy > 110) & (yy < 560) & (al > 200)
green = face & (g - np.maximum(r, b) > 50) & (g > 160)
frost = face & (mx - mn < 28) & (lum > 140)
raw = green | frost

# Thin rim highlights on the bezel vanish under an opening; the ring segments are 30px thick.
opened = ndi.binary_opening(raw, structure=np.ones((7, 7)))
lab, n = ndi.label(opened)
sizes = ndi.sum(opened, lab, range(1, n + 1))
keep = np.zeros_like(opened)
for i, s in enumerate(sizes, 1):
    if s > 400:
        keep |= lab == i
ring = ndi.binary_dilation(keep, structure=np.ones((3, 3))) & raw
print('components', n, 'kept', int((sizes > 400).sum()), 'ring px', int(ring.sum()))

pts = np.stack([xx[ring], yy[ring]], 1).astype(np.float64)
c = pts.mean(0)
cov = np.cov((pts - c).T)
evals, evecs = np.linalg.eigh(cov)
Wm = evecs @ np.diag(1 / np.sqrt(evals)) @ evecs.T
q = (pts - c) @ Wm.T
rad = np.hypot(q[:, 0], q[:, 1])
ang = np.degrees(np.arctan2(q[:, 1], q[:, 0])) % 360
print('center', c, 'rad pct', np.percentile(rad, [1, 50, 99]))

hist, _ = np.histogram(ang, bins=360, range=(0, 360))
sm = np.convolve(np.r_[hist[-3:], hist, hist[:3]], np.ones(5) / 5, 'same')[3:-3]
best = min((sm[((off + 30 * np.arange(12)) % 360).astype(int)].sum(), off) for off in np.arange(0, 30, 0.5))
off = best[1]
print('gap phase', best)

allpts = np.stack([xx, yy], -1).reshape(-1, 2).astype(np.float64)
qa = (allpts - c) @ Wm.T
aa = (np.degrees(np.arctan2(qa[:, 1], qa[:, 0])) % 360).reshape(H, W)
seg = (((aa - off) % 360) // 30).astype(int)

# Soft core: the segment's own brightness profile, feathered at the mask edge.
soft = ndi.gaussian_filter(ring.astype(np.float32), 1.0)
bright = np.clip((np.maximum(lum, g * 0.9) - 95) / 120, 0, 1)
core = soft * np.maximum(bright, 0.35 * soft)

# The band with every light off.
out = a.copy()
gd = g - np.maximum(r, b)
glow = (gd > 4) & (al > 0)
near_ring = ndi.binary_dilation(ring, structure=np.ones((5, 5)))
inside = glow & near_ring
outside = glow & ~near_ring
frost_med = np.median(lum[frost & ~glow])
vin = mx * (frost_med / max(np.median(mx[inside]), 1))
vin = np.clip(vin, 0, frost_med * 1.08)
for ch, k in ((0, 1.0), (1, 1.0), (2, 0.985)):
    out[..., ch] = np.where(inside, vin * k, out[..., ch])
base = np.maximum(r, b)
for ch in range(3):
    out[..., ch] = np.where(outside, base, out[..., ch])

# Strap through-holes show the studio backdrop; make them dark slots.
holes = (xx > 380) & (al > 160) & (mx - mn < 24) & (lum > 110)
k = np.clip((lum - 100) / 60, 0, 1)
for ch in range(3):
    out[..., ch] = np.where(holes, out[..., ch] * (1 - k) + 20 * k, out[..., ch])

# Light backdrop fringes on the silhouette take the band's own dark tone.
edge = (al > 0) & (al < 250) & ~near_ring
fr = np.clip((lum - 60) / 120, 0, 1)
for ch in range(3):
    out[..., ch] = np.where(edge, out[..., ch] * (1 - fr) + 36 * fr, out[..., ch])

Image.fromarray(out.clip(0, 255).astype(np.uint8), 'RGBA').save('band-off.png', optimize=True)

ys, xs = np.where(core > 0.02)
x0, x1, y0, y1 = max(xs.min() - 2, 0), xs.max() + 3, max(ys.min() - 2, 0), ys.max() + 3
bw, bh = x1 - x0, y1 - y0
cols = 4
sprite = np.zeros((bh * 3, bw * cols), np.uint8)
for i in range(12):
    m = np.where(seg == i, core, 0)[y0:y1, x0:x1]
    ty, tx = divmod(i, cols)
    sprite[ty * bh:(ty + 1) * bh, tx * bw:(tx + 1) * bw] = (m * 255).astype(np.uint8)
Image.fromarray(sprite, 'L').save('band-ring.png', optimize=True)

lit = [int(((seg == i) & green).sum()) for i in range(12)]
# Angle of each segment centre in image space (degrees, 0 = right, clockwise because y points down).
centres = []
for i in range(12):
    m = (seg == i) & ring
    centres.append([float(xx[m].mean()), float(yy[m].mean())])
meta = {
    'width': W, 'height': H,
    'ring': {'x': int(x0), 'y': int(y0), 'w': int(bw), 'h': int(bh), 'cols': cols},
    'center': [float(c[0]), float(c[1])],
    'segments': centres,
    'litInPhoto': lit,
}
json.dump(meta, open('band-ring.json', 'w'), indent=1)
print('bbox', x0, y0, bw, bh, 'lit', lit)

dbg = np.zeros((H, W, 3), np.uint8)
pal = np.array([[255,80,80],[255,160,60],[255,230,60],[160,255,60],[60,255,120],[60,255,230],[60,160,255],[80,80,255],[170,70,255],[255,70,220],[255,255,255],[128,128,128]])
for i in range(12):
    m = (seg == i) & (core > 0.1)
    dbg[m] = (pal[i] * np.clip(core[m], 0.3, 1)[:, None]).astype(np.uint8)
Image.fromarray(dbg).save('debug-seg.png')
