"""
BandIt wrist puck case generator.
Pure numpy: builds watertight shells from polar-sampled profiles, writes binary STL,
checks each shell is closed, reports volumes.

Coordinate system: mm, origin at case center on the bottom face, Z up.
X axis = along the wrist strap (45 mm direction), Y across the wrist.
"""
import math, struct, json, os
import numpy as np

# ------------------------------------------------------------------ parameters
P = dict(
    # outer body (rounded rectangle, "squircle")
    W=45.0, D=43.0, R=13.0,
    wall=2.0,
    # strap channel through the base (ribbon runs along X)
    slot_w=17.5, slot_h=2.0,           # 5/8" ribbon is 15.9 wide, ~1.0 thick
    floor=1.2,                          # bridge floor over the slot
    # component stack
    batt_h=5.5,                         # 503035 cell with wrap
    xiao_h=4.5,                         # PCB 1.2 + USB-C 3.3 (port faces DOWN, board back faces UP)
    ring_h=3.2,                         # PCB 1.6 + 5050 LED 1.6
    ring_od=37.5, ring_id=27.0,
    ring_lift=0.5,                      # ring seat sits this far above the XIAO back (room for solder blobs + kapton)
    ring_gap=0.4,                       # air above the LEDs before the lid (also the button's travel reserve)
    lid_t=1.2,
    lip=0.8,                            # outer lip left around the lid rebate
    clr=0.20,                           # per-side clearance for the lid in the rebate (lid prints face-down: elephant foot)
    # lower cavity (floor .. ring seat): battery pocket + XIAO nose + lead bay + motor well.
    # Everything is a vertical pocket, so the base prints upright with no supports.
    batt_pocket=(37.0, 32.0, 3.0),      # x, y, corner radius; battery is 35 x 30 (1.0 per side, antenna on +Y wall)
    nose=(0.0, 21.0, 9.3),              # XIAO: x0, x1 (= inner face of the +X wall), half-width; XIAO is 21 x 17.8
    bay=(-20.5, -17.0, 6.5),            # battery lead bay at the -X end: x0, x1, half-width
    well=None,                          # (v1.0 had a floor well at (9.5,-14.2) r5.3; it overlapped the battery. Motor now rides on top of the MPU.)
    ring_pocket=38.3,                   # round pocket the LED ring drops into (ring OD 37.5)
    # USB-C opening through the +X wall
    usb_w=10.6, usb_h=4.0,              # 10.6 at the outer face tapers to 9.9 inside (receptacle 9.0, plug shell 8.4)
    # button cap over a 6x6x5 tactile switch glued to the XIAO back
    switch_h=5.0, switch_gap=0.1,       # cap plate underside sits 0.1 above the switch plunger at rest
    cap_hole=26.3, cap_cb=28.0, cap_cb_depth=0.6,     # hole 0.4 radial over the stem: lid prints face-down, so allow for elephant foot
    cap_stem=25.5, cap_flange=27.4, cap_flange_t=0.4,
    cap_top_t=1.0, cap_wall=1.2,
    nfc_d=25.2, nfc_depth=0.0,          # no recess: a 0.15 mm rim is not printable; the 25 mm NTAG sticker sits on the cap top
    N=720,                              # angular samples (0.5 deg)
)

# derived heights -------------------------------------------------------------
def heights(P):
    z = {}
    z['slot_top'] = P['slot_h']
    z['floor_top'] = P['slot_h'] + P['floor']
    z['batt_top'] = z['floor_top'] + P['batt_h']
    z['xiao_top'] = z['batt_top'] + P['xiao_h']          # XIAO back face (flat, faces up)
    z['seat'] = z['xiao_top'] + P['ring_lift']           # ring bears on the body here, floats over the XIAO
    z['ring_top'] = z['seat'] + P['ring_h']
    z['lid_bot'] = z['ring_top'] + P['ring_gap']          # rebate step
    z['top'] = z['lid_bot'] + P['lid_t']                  # top of body = top of lid
    z['usb_bot'] = z['batt_top'] - 0.3
    z['usb_top'] = z['usb_bot'] + P['usb_h']
    z['switch_top'] = z['xiao_top'] + P['switch_h']
    z['cap_top'] = z['switch_top'] + P['switch_gap'] + P['cap_top_t']
    z['cap_proud'] = z['cap_top'] - z['top']
    z['cb_top'] = z['lid_bot'] + P['cap_cb_depth']        # counterbore ceiling
    return z

# ------------------------------------------------------------------ profiles
def rr_radius(W, D, R, th):
    """Distance from origin to the boundary of a rounded rectangle along angle th."""
    hw, hd = W/2 - R, D/2 - R
    c, s = math.cos(th), math.sin(th)
    def sdf(t):
        px, py = abs(c*t), abs(s*t)
        qx, qy = max(px-hw, 0.0), max(py-hd, 0.0)
        return math.hypot(qx, qy) - R
    lo, hi = 0.0, max(W, D)
    for _ in range(50):
        mid = 0.5*(lo+hi)
        if sdf(mid) > 0: hi = mid
        else: lo = mid
    return 0.5*(lo+hi)

def rrect(W, D, R):
    return lambda th: rr_radius(W, D, R, th)

def circle(d):
    r = d/2
    return lambda th: r

def in_rr(W, D, R, x, y):
    hw, hd = W/2 - R, D/2 - R
    qx, qy = max(abs(x)-hw, 0.0), max(abs(y)-hd, 0.0)
    return math.hypot(qx, qy) <= R

def in_well(P, x, y):
    """Motor well: a disc, plus the cone from the origin tangent to it so the union stays
    star-shaped about the origin (the polar contour sampler needs that)."""
    if not P.get('well'): return False
    cx, cy, r = P['well']
    if math.hypot(x-cx, y-cy) <= r: return True
    dc = math.hypot(cx, cy); half = math.asin(r/dc)
    a = math.atan2(y, x) - math.atan2(cy, cx)
    a = (a + math.pi) % (2*math.pi) - math.pi
    return abs(a) <= half and math.hypot(x, y) <= dc

def lower_cavity_pred(P):
    """Lower cavity (floor .. seat): battery pocket U XIAO nose U lead bay U motor well."""
    bw, bd, br = P['batt_pocket']; nx0, nx1, nh = P['nose']; bx0, bx1, bh = P['bay']
    def inside(x, y):
        if in_rr(bw, bd, br, x, y): return True
        if nx0 <= x <= nx1 and abs(y) <= nh: return True
        if bx0 <= x <= bx1 and abs(y) <= bh: return True
        return in_well(P, x, y)
    return inside

def upper_cavity_pred(P):
    """Upper cavity (seat .. lid): ring pocket U battery pocket U motor well.
    The nose end and the lead bay are NOT included, so 2 mm lips bridge over them at the seat plane:
    they retain the XIAO and give the ring a wall at +/-X."""
    bw, bd, br = P['batt_pocket']; rp = P['ring_pocket']/2
    def inside(x, y):
        if math.hypot(x, y) <= rp: return True
        if in_rr(bw, bd, br, x, y): return True
        return in_well(P, x, y)
    return inside

def star_from_pred(pred, rmax=30.0):
    """Radial contour of a star-shaped region given a membership predicate (bisection along each ray)."""
    def fn(th):
        c, s = math.cos(th), math.sin(th)
        lo, hi = 0.0, rmax
        for _ in range(50):
            mid = 0.5*(lo+hi)
            if pred(c*mid, s*mid): lo = mid
            else: hi = mid
        return 0.5*(lo+hi)
    return fn

def union_fn(*fns):
    return lambda th: max(f(th) for f in fns)

def thetas(N):
    return np.linspace(0, 2*math.pi, N, endpoint=False)

def sample(fn, th):
    r = np.array([fn(t) for t in th])
    return np.stack([r*np.cos(th), r*np.sin(th)], axis=1)

# ------------------------------------------------------------------ mesh helpers
class Mesh:
    def __init__(self):
        self.tris = []  # list of (3,3) arrays
    def tri(self, a, b, c):
        self.tris.append(np.array([a, b, c], dtype=float))
    def quad(self, a, b, c, d):
        self.tri(a, b, c); self.tri(a, c, d)
    def add(self, other):
        self.tris.extend(other.tris)
    def array(self):
        return np.array(self.tris)
    def write_stl(self, path, name='bandit'):
        T = self.array()
        n = np.cross(T[:,1]-T[:,0], T[:,2]-T[:,0])
        n /= (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)
        with open(path, 'wb') as f:
            f.write(name.encode().ljust(80, b'\0'))
            f.write(struct.pack('<I', len(T)))
            for i in range(len(T)):
                f.write(struct.pack('<3f', *n[i]))
                for v in T[i]:
                    f.write(struct.pack('<3f', *v))
                f.write(b'\0\0')
    def volume(self):
        T = self.array()
        return float(np.einsum('ij,ij->i', T[:,0], np.cross(T[:,1], T[:,2])).sum()/6.0)
    def bbox(self):
        T = self.array().reshape(-1,3)
        return T.min(axis=0), T.max(axis=0)
    def check_closed(self, tol=1e-6):
        """Every directed edge must be matched by its reverse exactly once (per shell union)."""
        T = self.array()
        q = np.round(T/tol).astype(np.int64)
        edges = {}
        for t in q:
            for i in range(3):
                a, b = tuple(t[i]), tuple(t[(i+1)%3])
                edges[(a,b)] = edges.get((a,b),0)+1
        bad = 0
        for (a,b),cnt in edges.items():
            if cnt != 1 or edges.get((b,a),0) != 1:
                bad += 1
        return bad

def prism(fn, z0, z1, N):
    """Star-shaped solid (w.r.t. origin) extruded from z0 to z1."""
    th = thetas(N); pts = sample(fn, th)
    m = Mesh()
    cb, ct = np.array([0,0,z0]), np.array([0,0,z1])
    for i in range(N):
        a, b = pts[i], pts[(i+1)%N]
        A0, B0 = np.array([*a, z0]), np.array([*b, z0])
        A1, B1 = np.array([*a, z1]), np.array([*b, z1])
        m.tri(ct, A1, B1)            # top (CCW from above)
        m.tri(cb, B0, A0)            # bottom
        m.quad(A0, B0, B1, A1)       # side, outward
    return m

def ring(outer, inner, z0, z1, N, keep=None):
    """
    Annular solid between two star-shaped contours.
    keep: None for full ring, or list of (a,b) angle intervals in degrees to keep
    (the rest is cut away, with radial end caps).
    """
    m = Mesh()
    if keep is None:
        th = thetas(N); o = sample(outer, th); n = sample(inner, th)
        for i in range(N):
            j = (i+1)%N
            O0, O1 = np.array([*o[i], z0]), np.array([*o[i], z1])
            P0, P1 = np.array([*o[j], z0]), np.array([*o[j], z1])
            I0, I1 = np.array([*n[i], z0]), np.array([*n[i], z1])
            J0, J1 = np.array([*n[j], z0]), np.array([*n[j], z1])
            m.quad(O1, P1, J1, I1)   # top
            m.quad(O0, I0, J0, P0)   # bottom
            m.quad(O0, P0, P1, O1)   # outer wall
            m.quad(J0, I0, I1, J1)   # inner wall (faces the axis)
        return m
    step = 2*math.pi/N
    for (a_deg, b_deg) in keep:
        a, b = math.radians(a_deg), math.radians(b_deg)
        if b < a: b += 2*math.pi
        k = max(2, int(math.ceil((b-a)/step)))
        th = np.linspace(a, b, k+1)
        o = sample(outer, th); n = sample(inner, th)
        for i in range(k):
            j = i+1
            O0, O1 = np.array([*o[i], z0]), np.array([*o[i], z1])
            P0, P1 = np.array([*o[j], z0]), np.array([*o[j], z1])
            I0, I1 = np.array([*n[i], z0]), np.array([*n[i], z1])
            J0, J1 = np.array([*n[j], z0]), np.array([*n[j], z1])
            m.quad(O1, P1, J1, I1)
            m.quad(O0, I0, J0, P0)
            m.quad(O0, P0, P1, O1)
            m.quad(J0, I0, I1, J1)
        # end caps: at angle a, outward direction is decreasing theta
        O0, O1 = np.array([*o[0], z0]), np.array([*o[0], z1])
        I0, I1 = np.array([*n[0], z0]), np.array([*n[0], z1])
        m.quad(I0, O0, O1, I1)       # start cap (normal toward -theta)
        O0, O1 = np.array([*o[-1], z0]), np.array([*o[-1], z1])
        I0, I1 = np.array([*n[-1], z0]), np.array([*n[-1], z1])
        m.quad(O0, I0, I1, O1)       # end cap (normal toward +theta)
    return m

def box(x0, x1, y0, y1, z0, z1):
    m = Mesh()
    c = lambda x,y,z: np.array([x,y,z], dtype=float)
    A,B,C,Dd = c(x0,y0,z0), c(x1,y0,z0), c(x1,y1,z0), c(x0,y1,z0)
    E,F,G,H  = c(x0,y0,z1), c(x1,y0,z1), c(x1,y1,z1), c(x0,y1,z1)
    m.quad(A, Dd, C, B)   # bottom
    m.quad(E, F, G, H)    # top
    m.quad(A, B, F, E)    # -y
    m.quad(B, C, G, F)    # +x
    m.quad(C, Dd, H, G)   # +y
    m.quad(Dd, A, E, H)   # -x
    return m

def tube(outer, inner, z0, z1, N):
    return ring(outer, inner, z0, z1, N)

# ------------------------------------------------------------------ parts
def build_base(P):
    z = heights(P); N = P['N']
    W, D, R, t = P['W'], P['D'], P['R'], P['wall']
    outer = rrect(W, D, R)
    low   = star_from_pred(lower_cavity_pred(P))          # battery pocket U nose U bay U well
    up    = star_from_pred(upper_cavity_pred(P))          # ring pocket U battery pocket U well
    reb   = rrect(W-2*P['lip'], D-2*P['lip'], R-P['lip'])
    ov = 0.02  # tiny overlap between stacked shells so slicers union them cleanly
    m = Mesh()

    # 1) rails either side of the strap slot (z 0 .. slot_top)
    m.add(clipped_prism(outer, 0.0, z['slot_top']+ov, N, ymin= P['slot_w']/2))
    m.add(clipped_prism(outer, 0.0, z['slot_top']+ov, N, ymax=-P['slot_w']/2))

    # 2) floor (bridges the slot)
    m.add(prism(outer, z['slot_top'], z['floor_top']+ov, N))

    # 3) body bands. Inner profile per band; USB window cut by angle in its band.
    usb_half = math.degrees(math.atan2(P['usb_w']/2, W/2))
    m.add(ring(outer, low, z['floor_top'], z['usb_bot']+ov, N))
    m.add(ring(outer, low, z['usb_bot'],   z['usb_top']+ov, N, keep=[(usb_half, 360-usb_half)]))
    m.add(ring(outer, low, z['usb_top'],   z['seat']+ov, N))
    m.add(ring(outer, up,  z['seat'],      z['lid_bot']+ov, N))       # ring pocket; nose + bay lips form here
    m.add(ring(outer, reb, z['lid_bot'],   z['top'], N))              # rebate lip
    return m

def cav_plus(fn, d):
    """Contour slightly larger than fn so a ledge overlaps into the wall (no coplanar seams)."""
    return lambda th: fn(th) + d

def clipped_prism(fn, z0, z1, N, ymin=None, ymax=None):
    """Prism of a convex star-shaped profile, clipped by one horizontal line (y>=ymin or y<=ymax).
    The kept region is convex, so it is triangulated as a fan from its centroid."""
    y = ymin if ymin is not None else ymax
    inside = (lambda p: p[1] >= y) if ymin is not None else (lambda p: p[1] <= y)
    th = thetas(N*2)
    pts = sample(fn, th)
    flags = [inside(p) for p in pts]
    M = len(pts)
    # rotate so the sequence starts just after a transition from outside to inside
    start = next(i for i in range(M) if flags[i] and not flags[i-1])
    seq = [(i % M) for i in range(start, start+M)]
    arc = [pts[i] for i in seq if flags[i]]
    # exact crossings by bisection on angle, before the first and after the last kept sample
    def cross(i_lo, i_hi):
        """Bisect in increasing angle from th[i_lo] to th[i_hi]; inside-status flips between them."""
        a, b = th[i_lo], th[i_hi]
        if b < a: b += 2*math.pi
        pa = np.array([fn(a)*math.cos(a), fn(a)*math.sin(a)])
        in_a = inside(pa)
        for _ in range(60):
            mid = 0.5*(a+b)
            p = np.array([fn(mid)*math.cos(mid), fn(mid)*math.sin(mid)])
            if inside(p) == in_a: a = mid
            else: b = mid
        t = 0.5*(a+b)
        return np.array([fn(t)*math.cos(t), y])
    last_in = next(i for i in reversed(seq) if flags[i])
    first_out_after = seq[(seq.index(last_in)+1) % M]
    c0 = cross((start-1) % M, start)        # outside -> inside
    c1 = cross(last_in, first_out_after)    # inside -> outside
    poly = np.array([c0] + arc + [c1])
    cx, cy = poly.mean(axis=0)
    m = Mesh(); n = len(poly)
    cb, ct = np.array([cx,cy,z0]), np.array([cx,cy,z1])
    for i in range(n):
        a, b = poly[i], poly[(i+1)%n]
        A0, B0 = np.array([*a, z0]), np.array([*b, z0])
        A1, B1 = np.array([*a, z1]), np.array([*b, z1])
        m.tri(ct, A1, B1); m.tri(cb, B0, A0); m.quad(A0, B0, B1, A1)
    return m

def build_lid(P):
    z = heights(P); N = P['N']
    W, D, R = P['W'], P['D'], P['R']
    l = P['lip'] + P['clr']
    outer = rrect(W-2*l, D-2*l, R-l)
    # plate with a counterbored center hole (counterbore from below)
    m = Mesh()
    m.add(ring(outer, circle(P['cap_cb']),  z['lid_bot'], z['cb_top']+0.02, N))
    m.add(ring(outer, circle(P['cap_hole']), z['cb_top'], z['top'], N))
    return m

def build_cap(P):
    z = heights(P); N = P['N']
    m = Mesh()
    fl_bot = z['lid_bot'] + 0.2                 # flange floats 0.2 above the ring top plane
    fl_top = fl_bot + P['cap_flange_t']
    top_bot = z['cap_top'] - P['cap_top_t']
    inner = P['cap_stem'] - 2*P['cap_wall']
    # flange annulus + skirt wall
    m.add(ring(circle(P['cap_flange']), circle(inner), fl_bot, fl_top+0.02, N))
    m.add(ring(circle(P['cap_stem']), circle(inner), fl_top, top_bot+0.02, N))
    # top plate (optionally with an NFC recess; off by default, see nfc_depth)
    if P['nfc_depth'] > 0:
        m.add(ring(circle(P['cap_stem']), circle(P['nfc_d']), top_bot, z['cap_top'], N))
        m.add(prism(circle(P['nfc_d']+0.04), top_bot, z['cap_top']-P['nfc_depth'], N))
    else:
        m.add(prism(circle(P['cap_stem']), top_bot, z['cap_top'], N))
    return m

# ------------------------------------------------------------------ main
if __name__ == '__main__':
    out = os.path.dirname(os.path.abspath(__file__))
    z = heights(P)
    parts = {'bandit_base': build_base(P), 'bandit_lid': build_lid(P), 'bandit_cap': build_cap(P)}
    report = {'heights': z, 'params': P, 'parts': {}}
    for name, mesh in parts.items():
        mesh.write_stl(os.path.join(out, name + '.stl'), name)
        lo, hi = mesh.bbox()
        report['parts'][name] = dict(
            triangles=len(mesh.tris),
            volume_mm3=round(mesh.volume(), 1),
            grams_pla=round(mesh.volume()*1.24/1000, 1),
            bbox_min=[round(float(v),2) for v in lo], bbox_max=[round(float(v),2) for v in hi],
            open_edges=mesh.check_closed(),
        )
    # print-oriented copies: lid and cap flipped face-down, everything resting on z = 0
    def flipped(mesh):
        T = mesh.array().copy(); T[:,:,2] *= -1; T = T[:, ::-1, :]      # mirror z, restore winding
        T[:,:,2] -= T[:,:,2].min()
        f = Mesh(); f.tris = list(T); return f
    parts['bandit_lid_facedown'] = flipped(parts['bandit_lid'])
    parts['bandit_cap_facedown'] = flipped(parts['bandit_cap'])
    for name in ('bandit_lid_facedown', 'bandit_cap_facedown'):
        parts[name].write_stl(os.path.join(out, name + '.stl'), name)
        lo, hi = parts[name].bbox()
        report['parts'][name] = dict(triangles=len(parts[name].tris), volume_mm3=round(parts[name].volume(), 1),
            bbox_min=[round(float(v),2) for v in lo], bbox_max=[round(float(v),2) for v in hi], open_edges=parts[name].check_closed())
    with open(os.path.join(out, 'report.json'), 'w') as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report['parts'], indent=1))
    print({k: round(v,2) for k,v in z.items()})
