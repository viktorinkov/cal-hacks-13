"""Pack as many BandIt v2 parts as fit on one Prusa CORE One bed (250 x 220), two beds by colour:
  bandit_v2_bed_black.stl  : bases (upright) + button plugs (top down)
  bandit_v2_bed_clear.stl  : lids (face down)
Pure translation of the validated single-part meshes; every copy is checked for bbox overlap and bed fit.
"""
import os, sys, json, struct, itertools
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bandit_case as M
import bandit_v2 as V

out = os.path.dirname(os.path.abspath(__file__))
BED = (250.0, 220.0)       # CORE One printable area
MARGIN = 5.0               # from the bed edge
GAP = 4.0                  # between parts
BTN_GAP = 4.0

def read_stl(path):
    with open(path, 'rb') as f:
        f.read(80); n = struct.unpack('<I', f.read(4))[0]
        d = np.frombuffer(f.read(n*50), dtype=np.dtype([('n','<3f4'),('v','<9f4'),('a','<u2')]))
    return d['v'].reshape(-1,3,3).astype(float)

def rot90(T):              # about Z: (x, y) -> (-y, x)
    T = T.copy(); x = T[:,:,0].copy(); T[:,:,0] = -T[:,:,1]; T[:,:,1] = x; return T

def flipped(T):
    T = T.copy(); T[:,:,2] *= -1; T = T[:, ::-1, :]; T[:,:,2] -= T[:,:,2].min(); return T

def normalise(T):          # move min corner to (0,0,0)
    T = T.copy(); T -= T.reshape(-1,3).min(axis=0); return T

def grid_fit(w, d):
    """How many w x d footprints fit, as (cols, rows), trying both orientations; returns best (count, rotated, cols, rows)."""
    best = None
    for rotated, (pw, pd) in ((False, (w, d)), (True, (d, w))):
        cols = int((BED[0] - 2*MARGIN + GAP) // (pw + GAP))
        rows = int((BED[1] - 2*MARGIN + GAP) // (pd + GAP))
        if best is None or cols*rows > best[0]: best = (cols*rows, rotated, cols, rows, pw, pd)
    return best

def place(T, count, rotated, cols, rows, pw, pd):
    """Lay copies on a grid from the bed's (MARGIN, MARGIN) corner. Returns list of (translated tris, bbox)."""
    base = normalise(rot90(T) if rotated else T)
    copies = []
    for i in range(count):
        c, r = i % cols, i // cols
        dx, dy = MARGIN + c*(pw + GAP), MARGIN + r*(pd + GAP)
        C = base.copy(); C[:,:,0] += dx; C[:,:,1] += dy
        lo = C.reshape(-1,3).min(axis=0); hi = C.reshape(-1,3).max(axis=0)
        copies.append((C, (lo, hi)))
    return copies

def write(path, tris, name):
    m = M.Mesh(); m.tris = list(tris); m.write_stl(path, name); return m

def check(copies, label):
    """No two bboxes closer than GAP-0.01 in XY, everything inside the bed with MARGIN."""
    for (_, (lo, hi)) in copies:
        assert lo[0] >= MARGIN-1e-6 and lo[1] >= MARGIN-1e-6 and hi[0] <= BED[0]-MARGIN+1e-6 and hi[1] <= BED[1]-MARGIN+1e-6, (label, lo, hi)
    for (a, b) in itertools.combinations(copies, 2):
        (lo1, hi1), (lo2, hi2) = a[1], b[1]
        sep_x = max(lo1[0]-hi2[0], lo2[0]-hi1[0]); sep_y = max(lo1[1]-hi2[1], lo2[1]-hi1[1])
        assert max(sep_x, sep_y) >= min(GAP, BTN_GAP) - 0.01, (label, 'too close', sep_x, sep_y)
    allo = np.min([c[1][0] for c in copies], axis=0); allhi = np.max([c[1][1] for c in copies], axis=0)
    return allo, allhi

# ---------------------------------------------------------------- parts
# same geometry as the validated STLs, sampled at 2.5 degree steps instead of 0.5 so the 15-up bed files stay under 10 MB
Pc = dict(V.P); Pc['N'] = 144
base_T = V.build_base(Pc).array()
lid_T  = flipped(V.build_lid(Pc).array())
# button plug (the optional cap for the switch plunger), rebuilt here since it is no longer part of the case design
Z = V.heights(V.P); plug_d, plug_proud = 5.8, 0.8
plug_top = Z['top'] + plug_proud
pm = M.Mesh()
pm.add(M.prism(M.circle(plug_d), Z['switch_top'], plug_top - 0.3 + 0.01, 144))
pm.add(M.prism(M.circle(plug_d - 0.6), plug_top - 0.3, plug_top, 144))
plug_T = flipped(pm.array())

def footprint(T):
    lo = T.reshape(-1,3).min(axis=0); hi = T.reshape(-1,3).max(axis=0); return hi[0]-lo[0], hi[1]-lo[1], hi[2]-lo[2]

report = {}
# ---------------------------------------------------------------- black bed: bases + buttons
bw, bd, bh = footprint(base_T)
n, rotated, cols, rows, pw, pd = grid_fit(bw, bd)
bases = place(base_T, n, rotated, cols, rows, pw, pd)
# buttons in the free strip beside the last column (or above the last row), one column/row of plugs
used_x = MARGIN + cols*(pw + GAP) - GAP; used_y = MARGIN + rows*(pd + GAP) - GAP
free_x = BED[0] - MARGIN - used_x; free_y = BED[1] - MARGIN - used_y
pw_b, pd_b, ph_b = footprint(plug_T)
buttons = []
pb = normalise(plug_T)
if free_x - GAP >= pw_b:        # column along +X edge
    x0 = used_x + GAP
    nb = int((BED[1] - 2*MARGIN + BTN_GAP) // (pd_b + BTN_GAP))
    for i in range(min(nb, n)):
        C = pb.copy(); C[:,:,0] += x0; C[:,:,1] += MARGIN + i*(pd_b + BTN_GAP)
        lo = C.reshape(-1,3).min(axis=0); hi = C.reshape(-1,3).max(axis=0); buttons.append((C, (lo, hi)))
elif free_y - GAP >= pd_b:      # row along +Y edge
    y0 = used_y + GAP
    nb = int((BED[0] - 2*MARGIN + BTN_GAP) // (pw_b + BTN_GAP))
    for i in range(min(nb, n)):
        C = pb.copy(); C[:,:,1] += y0; C[:,:,0] += MARGIN + i*(pw_b + BTN_GAP)
        lo = C.reshape(-1,3).min(axis=0); hi = C.reshape(-1,3).max(axis=0); buttons.append((C, (lo, hi)))
black = bases + buttons
lo, hi = check(black, 'black')
T = np.concatenate([c[0] for c in black]); T[:,:,0] -= (lo[0]+hi[0])/2; T[:,:,1] -= (lo[1]+hi[1])/2   # centre on origin
mb = write(os.path.join(out, 'bandit_v2_bed_black.stl'), T, 'bandit_v2_bed_black')
report['black'] = dict(bases=n, buttons=len(buttons), rotated=rotated, grid=f'{cols} x {rows}',
                       extent=[round(float(hi[0]-lo[0]),1), round(float(hi[1]-lo[1]),1), round(float(hi[2]-lo[2]),1)],
                       grams_pla=round(mb.volume()*1.24/1000, 1), triangles=len(mb.tris))

# ---------------------------------------------------------------- clear bed: lids
lw, ld, lh = footprint(lid_T)
n2, rotated2, cols2, rows2, pw2, pd2 = grid_fit(lw, ld)
lids = place(lid_T, n2, rotated2, cols2, rows2, pw2, pd2)
lo2, hi2 = check(lids, 'clear')
T2 = np.concatenate([c[0] for c in lids]); T2[:,:,0] -= (lo2[0]+hi2[0])/2; T2[:,:,1] -= (lo2[1]+hi2[1])/2
ml = write(os.path.join(out, 'bandit_v2_bed_clear.stl'), T2, 'bandit_v2_bed_clear')
report['clear'] = dict(lids=n2, rotated=rotated2, grid=f'{cols2} x {rows2}',
                       extent=[round(float(hi2[0]-lo2[0]),1), round(float(hi2[1]-lo2[1]),1), round(float(hi2[2]-lo2[2]),1)],
                       grams_pla=round(ml.volume()*1.24/1000, 1), triangles=len(ml.tris))
report['bed'] = BED; report['margin'] = MARGIN; report['gap'] = GAP
json.dump(report, open(os.path.join(out, 'bed_report.json'), 'w'), indent=2)
print(json.dumps(report, indent=1))

# ---------------------------------------------------------------- plan picture
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
fig, axes = plt.subplots(1, 2, figsize=(14, 6.4), dpi=110)
for ax, copies, title, col in ((axes[0], black, f"BLACK bed: {n} bases + {len(buttons)} buttons", (0.2,0.2,0.22)),
                               (axes[1], lids, f"TRANSLUCENT bed: {n2} lids (face down)", (0.75,0.85,0.95))):
    ax.add_patch(Rectangle((0,0), BED[0], BED[1], fc='0.93', ec='k', lw=1))
    for (_, (l, h)) in copies:
        ax.add_patch(Rectangle((l[0], l[1]), h[0]-l[0], h[1]-l[1], fc=col, ec='k', lw=0.5))
    ax.set_xlim(-5, BED[0]+5); ax.set_ylim(-5, BED[1]+5); ax.set_aspect('equal')
    ax.set_title(f"{title}\nCORE One bed 250 x 220, {MARGIN:.0f} mm edge margin, {GAP:.0f} mm between parts", fontsize=10)
    ax.set_xlabel('X (mm)'); ax.set_ylabel('Y (mm)')
plt.tight_layout(); plt.savefig(os.path.join(out, 'bandit_v2_beds.png')); plt.close()
print('wrote bandit_v2_beds.png')
