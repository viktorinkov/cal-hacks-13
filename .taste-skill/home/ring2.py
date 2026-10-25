import json
import numpy as np
from PIL import Image, ImageDraw
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
green = face & (((g - np.maximum(r, b) > 50) & (g > 150)) | ((g > 215) & (g - r > 20)))
frost = face & (mx - mn < 28) & (lum > 140)
raw = green | frost
opened = ndi.binary_opening(raw, structure=np.ones((7, 7)))
lab, n = ndi.label(opened)
sizes = ndi.sum(opened, lab, range(1, n + 1))
keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s > 400])
ring = ndi.binary_closing(keep, structure=np.ones((9, 9)))
ring = ndi.binary_fill_holes(ring) & ~ndi.binary_fill_holes(ndi.binary_erosion(ring, iterations=1)) | ring
# Remove the inner disc that fill_holes may have filled: keep ring pixels that are bright or between two bright ones.
ring = keep | (ndi.binary_closing(keep, structure=np.ones((9, 9))) & raw)

pts = np.stack([xx[ring], yy[ring]], 1).astype(np.float64)
c = pts.mean(0)
cov = np.cov((pts - c).T)
evals, evecs = np.linalg.eigh(cov)
Wm = evecs @ np.diag(1 / np.sqrt(evals)) @ evecs.T
Winv = np.linalg.inv(Wm)
print('center', c)

closed = ndi.binary_closing(keep, structure=np.ones((11, 11)))
def sample(mask, x, y):
    xi, yi = int(round(x)), int(round(y))
    return 0 <= xi < W and 0 <= yi < H and mask[yi, xi]

thetas = np.arange(0, 360, 2.0)
inner, outer = [], []
for t in thetas:
    d = np.array([np.cos(np.radians(t)), np.sin(np.radians(t))])
    rs = np.arange(0.5, 2.6, 0.005)
    hits = []
    for rr in rs:
        p = c + Winv @ (d * rr)
        hits.append(sample(closed, p[0], p[1]))
    hits = np.array(hits)
    idx = np.where(hits)[0]
    if len(idx) == 0:
        inner.append(np.nan); outer.append(np.nan); continue
    # first contiguous run
    start = idx[0]
    end = start
    while end + 1 < len(hits) and hits[end + 1]:
        end += 1
    inner.append(rs[start]); outer.append(rs[end])
inner = np.array(inner); outer = np.array(outer)

def smooth(v, k=7):
    v = v.copy()
    nanm = np.isnan(v)
    v[nanm] = np.nanmedian(v)
    pad = np.r_[v[-k:], v, v[:k]]
    med = np.array([np.median(pad[i:i + 2 * k + 1]) for i in range(len(v))])
    pad = np.r_[med[-3:], med, med[:3]]
    return np.convolve(pad, np.ones(7) / 7, 'same')[3:-3]
def fit_ellipse(px, py):
    # Fitzgibbon direct least squares; returns conic coefficients.
    D = np.stack([px * px, px * py, py * py, px, py, np.ones_like(px)], 1)
    S = D.T @ D
    C = np.zeros((6, 6)); C[0, 2] = C[2, 0] = 2; C[1, 1] = -1
    ev, evec = np.linalg.eig(np.linalg.inv(S) @ C)
    k = np.argmax(np.real(ev) > 0) if np.any(np.real(ev) > 0) else 0
    return np.real(evec[:, k])

def ray_hit(coef, t):
    # Distance along the image-space ray from c in the whitened direction t that meets the conic.
    d = Winv @ np.array([np.cos(np.radians(t)), np.sin(np.radians(t))])
    A_, B_, C_, D_, E_, F_ = coef
    x0, y0 = c
    qa = A_ * d[0] ** 2 + B_ * d[0] * d[1] + C_ * d[1] ** 2
    qb = 2 * A_ * x0 * d[0] + B_ * (x0 * d[1] + y0 * d[0]) + 2 * C_ * y0 * d[1] + D_ * d[0] + E_ * d[1]
    qc = A_ * x0 ** 2 + B_ * x0 * y0 + C_ * y0 ** 2 + D_ * x0 + E_ * y0 + F_
    disc = qb * qb - 4 * qa * qc
    roots = [(-qb + s * np.sqrt(max(disc, 0))) / (2 * qa) for s in (1, -1)]
    return max(roots)

def robust(vals):
    ok = ~np.isnan(vals)
    for _ in range(4):
        pts_ = np.array([c + Winv @ (np.array([np.cos(np.radians(t)), np.sin(np.radians(t))]) * v) for t, v in zip(thetas[ok], vals[ok])])
        coef = fit_ellipse(pts_[:, 0], pts_[:, 1])
        pred = np.array([ray_hit(coef, t) for t in thetas])
        res = np.abs(vals - pred)
        res[np.isnan(res)] = np.inf
        ok = res < max(np.nanpercentile(res[np.isfinite(res)], 70), 0.01)
    return pred

inner_s, outer_s = robust(inner), robust(outer)
print('inner', np.round(np.percentile(inner_s, [5, 50, 95]), 3), 'outer', np.round(np.percentile(outer_s, [5, 50, 95]), 3))

# Lit lights in the photo: centroid angle of each green blob in whitened space.
gl, gn = ndi.label(ndi.binary_opening(green, structure=np.ones((5, 5))))
angs = []
for i in range(1, gn + 1):
    m = gl == i
    if m.sum() < 150:
        continue
    p = np.array([xx[m].mean(), yy[m].mean()])
    q = Wm @ (p - c)
    angs.append(np.degrees(np.arctan2(q[1], q[0])) % 360)
angs = sorted(angs)
print('green blob angles', np.round(angs, 1))
pitch = float(np.median(np.diff(angs))) if len(angs) > 1 else 30.0
count = int(round(360 / pitch))
pitch = 360 / count
phase = float(np.mean([(a_ - pitch / 2) % pitch for a_ in angs]))
print('pitch', pitch, 'count', count, 'phase', phase)

def ring_point(t, which):
    arr = inner_s if which == 'in' else outer_s
    tt = (t % 360) / 2.0
    i0 = int(np.floor(tt)) % len(arr)
    i1 = (i0 + 1) % len(arr)
    f = tt - np.floor(tt)
    rr = arr[i0] * (1 - f) + arr[i1] * f
    d = np.array([np.cos(np.radians(t)), np.sin(np.radians(t))])
    return c + Winv @ (d * rr)

# Export the edges every 2 degrees in image pixels.
edges = {
    'inner': [[round(float(v), 2) for v in ring_point(t, 'in')] for t in thetas],
    'outer': [[round(float(v), 2) for v in ring_point(t, 'out')] for t in thetas],
}
meta = {'width': W, 'height': H, 'center': [float(c[0]), float(c[1])], 'step': 2, 'count': count,
        'pitch': pitch, 'phase': phase, 'litAngles': [float(v) for v in angs], **edges}
json.dump(meta, open('band-ring.json', 'w'))

# The band with every light off: rebuild the lit lights from the unlit ones four positions round.
def interp(arr, t):
    tt = (t % 360) / 2.0
    i0 = np.floor(tt).astype(int) % len(arr)
    i1 = (i0 + 1) % len(arr)
    f = tt - np.floor(tt)
    return arr[i0] * (1 - f) + arr[i1] * f

allp = np.stack([xx.ravel(), yy.ravel()], 1).astype(np.float64)
qa = (allp - c) @ Wm.T
rr = np.hypot(qa[:, 0], qa[:, 1]).reshape(H, W)
tt = (np.degrees(np.arctan2(qa[:, 1], qa[:, 0])) % 360).reshape(H, W)
lit_lo = (phase + 9 * pitch - 8) % 360
lit_span = 3 * pitch + 16
in_sector = ((tt - lit_lo) % 360) < lit_span
rin, rout = interp(inner_s, tt), interp(outer_s, tt)
zone = in_sector & (rr > rin - 0.07) & (rr < rout + 0.05) & (al > 0)
s = (rr - rin) / (rout - rin)
ts = tt - 4 * pitch
rs = interp(inner_s, ts) + s * (interp(outer_s, ts) - interp(inner_s, ts))
d = np.stack([np.cos(np.radians(ts)), np.sin(np.radians(ts))], -1)
srcp = c + (d * rs[..., None]) @ Winv.T
sx = np.clip(srcp[..., 0], 0, W - 1.001)
sy = np.clip(srcp[..., 1], 0, H - 1.001)
x0i, y0i = np.floor(sx).astype(int), np.floor(sy).astype(int)
fx, fy = (sx - x0i)[..., None], (sy - y0i)[..., None]
rgb = a[..., :3]
samp = (rgb[y0i, x0i] * (1 - fx) * (1 - fy) + rgb[y0i, x0i + 1] * fx * (1 - fy)
        + rgb[y0i + 1, x0i] * (1 - fx) * fy + rgb[y0i + 1, x0i + 1] * fx * fy)
# Feather the copied zone into the original at its border.
feather = ndi.gaussian_filter(zone.astype(np.float32), 2.0)[..., None]
out = a.copy()
out[..., :3] = rgb * (1 - feather) + samp * feather
# Any green spill left on the bezel or the inner disc loses its tint.
o = out
gd = o[..., 1] - np.maximum(o[..., 0], o[..., 2])
tint = (gd > 3) & (xx < 420) & (al > 0)
grey = (o[..., 0] + o[..., 2]) / 2
for ch in range(3):
    o[..., ch] = np.where(tint, grey, o[..., ch])
# Strap through-holes show the studio backdrop; make them dark slots.
lum2 = 0.2126 * o[..., 0] + 0.7152 * o[..., 1] + 0.0722 * o[..., 2]
mx2, mn2 = o[..., :3].max(-1), o[..., :3].min(-1)
holes = (xx > 380) & (al > 160) & (mx2 - mn2 < 24) & (lum2 > 110)
k = np.clip((lum2 - 100) / 60, 0, 1)
for ch in range(3):
    o[..., ch] = np.where(holes, o[..., ch] * (1 - k) + 20 * k, o[..., ch])
# Light backdrop fringes on the silhouette take the band's own dark tone.
ringzone = (rr > np.min(inner_s) - 0.1) & (rr < np.max(outer_s) + 0.05)
edge = (al > 0) & (al < 250) & ~ringzone
fr = np.clip((lum2 - 60) / 120, 0, 1)
for ch in range(3):
    o[..., ch] = np.where(edge, o[..., ch] * (1 - fr) + 36 * fr, o[..., ch])
Image.fromarray(o.clip(0, 255).astype(np.uint8), 'RGBA').save('band-off.png', optimize=True)

# Check: draw the procedural lights over the photo, lit where the photo is lit.
chk = src.convert('RGB').copy()
dr = ImageDraw.Draw(chk, 'RGBA')
for i in range(count):
    t0 = phase + i * pitch + 2.2
    t1 = phase + (i + 1) * pitch - 2.2
    ts = np.linspace(t0, t1, 12)
    poly = [tuple(ring_point(t, 'out')) for t in ts] + [tuple(ring_point(t, 'in')) for t in ts[::-1]]
    dr.polygon(poly, outline=(255, 0, 255, 255))
chk = chk.resize((W * 2, H * 2))
chk.crop((0, 200, 820, 1100)).save('debug-ring.png')
