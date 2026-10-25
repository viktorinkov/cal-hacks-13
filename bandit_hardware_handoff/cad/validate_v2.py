"""v2 pill: independent analytic solid, component fit, component-vs-component, insertion sweeps,
clearances, exposed-ceiling (bridge) audit and mesh-vs-analytic agreement."""
import math, json, os, struct, itertools
import numpy as np
import bandit_v2 as V2
import bandit_case as M

P = V2.P; Z = V2.heights(P)
out = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- analytic solid (written from the spec, not the mesh)
L = P['tail_len'] + P['head']/2; CX = (P['head']/2 - P['tail_len'])/2
def in_outline(x, y, inset=0.0):
    return M.in_rr(L - 2*inset, P['head'] - 2*inset, P['R'] - inset, x - CX, y)
low = V2.lower_pred(P); up = V2.upper_pred(P)
usb_half = math.degrees(math.atan2(P['usb_w']/2, -P['bay_x_end']))
dx0, dx1, dg = P['divider']; dyw = V2.bay_half_width(P, dx0) + 0.3
rp = P['ring_pocket']/2

def in_base(x, y, z):
    if z < 0 or z > Z['top'] or not in_outline(x, y): return False
    if z <= Z['slot_top']: return abs(y) >= P['slot_w']/2
    if z <= Z['floor_top']: return True
    if z <= Z['seat']:
        if dx0 <= x <= dx1 and dg <= abs(y) <= dyw: return True          # divider posts
        if low(x, y): return False
        a = math.degrees(math.atan2(y, x)) % 360
        if Z['usb_bot'] <= z <= Z['usb_top'] and abs(a - 180) <= usb_half: return False
        cbw, cbd, cz0, cz1 = P['usb_cb']; cb_half = math.degrees(math.atan2(cbw/2, P['tail_len']))
        if cz0 <= z <= cz1 and abs(a - 180) <= cb_half and not in_outline(x, y, cbd): return False   # plug recess
        return True
    if z <= Z['lid_bot']:
        return not up(x, y)
    return not in_outline(x, y, P['lip'])

def in_lid(x, y, z):
    if not (Z['lid_bot'] <= z <= Z['top'] and in_outline(x, y, P['lip'] + P['clr'])): return False
    r = math.hypot(x, y)
    if r < P['button_hole']/2: return False
    wid, wod, wd = P['led_window']
    if z < Z['lid_bot'] + wd and wid/2 <= r <= wod/2: return False      # thin window over the LEDs
    return True

def solid(x, y, z): return in_base(x, y, z) or in_lid(x, y, z)

# ---------------------------------------------------------------- component envelopes
ft, bt, st = Z['floor_top'], Z['batt_top'], Z['seat']; e = 0.01
def box_pts(x0, x1, y0, y1, z0, z1, n=14):
    return [(x, y, z) for x in np.linspace(x0, x1, n) for y in np.linspace(y0, y1, n) for z in np.linspace(z0, z1, 6)]
def cyl_pts(cx, cy, r, z0, z1):
    return [(cx + rr*math.cos(t), cy + rr*math.sin(t), z) for rr in np.linspace(0, r, 6)
            for t in np.linspace(0, 2*math.pi, 36, endpoint=False) for z in np.linspace(z0, z1, 5)]
def ann_pts(r0, r1, z0, z1, ymax=None):
    pts = [(rr*math.cos(t), rr*math.sin(t), z) for rr in np.linspace(r0, r1, 6)
           for t in np.linspace(0, 2*math.pi, 90, endpoint=False) for z in np.linspace(z0, z1, 5)]
    return pts if ymax is None else [p for p in pts if abs(p[1]) < ymax]
def y_wall(x):   # +Y inner wall of the tail bay, including the rounded far corner
    xe, bh, rb = P['bay_x_end'], P['bay_half'], P['R'] - P['wall']
    if x < xe + rb: return (bh - rb) + math.sqrt(max(rb**2 - (x - (xe + rb))**2, 0))
    return V2.bay_half_width(P, x)
def wall_pts(x0, x1, z0, z1, off=0.3):
    return [(x, y_wall(x) - off, z) for x in np.linspace(x0, x1, 30) for z in np.linspace(z0, z1, 8)]

# tail layout
MPU   = (-36.6, -20.2, -16.5, 4.7, ft+e, ft+3.0)          # GY-521 21.2 x 16.4, 2.7 + tape; clear of the port's approach
MOT   = (-33.0, 11.2, 5.0, ft+e, ft+3.0)                  # coin motor, beside the MPU
XPCB  = (-40.2, -19.2, -8.9, 8.9, ft+4.8, ft+6.0)         # XIAO PCB, port down, receptacle flush with the end wall's inner face
XCAN  = (-34.7, -24.7, -5.0, 5.0, ft+3.3, ft+4.8)         # shield can etc. under the PCB
XPORT = (-41.5, -36.9, -4.5, 4.5, ft+1.5, ft+4.8)         # USB-C receptacle under the PCB (incl. its 1.3 overhang), flush with the wall
XUFL  = (-23.7, -19.7, 5.2, 8.9, ft+2.3, ft+4.8)          # U.FL plug hanging under the PCB, outside the MPU's footprint
SW    = (-3.0, 3.0, -3.0, 3.0, bt+e, bt+3.5)              # switch body on the battery
SWPL  = (0.0, 0.0, 1.75, bt+3.5, Z['switch_top'])         # plunger

components = {
  'battery 35 x 30 x 5.5 on the floor':            box_pts(-17.5, 17.5, -15, 15, ft+e, bt-e),
  'SOS switch 6x6 body on the battery, ring centre': box_pts(*SW),
  'SOS switch plunger up to the lid hole':         cyl_pts(0, 0, 1.75, bt+3.5, Z['switch_top']-e),
  'LED ring 37.5/27 x 3.2':                        ann_pts(13.55, 18.7, st+e, Z['ring_top']-e),
  'wires + solder under the ring (1.0 gap over battery)': ann_pts(13.55, 18.4, bt+e, st-e, ymax=12.0),
  'MPU-6050 in the tail, on the floor':            box_pts(*MPU),
  'coin motor in the tail, on the floor':          cyl_pts(*MOT),
  'XIAO PCB over MPU + motor (port down)':         box_pts(*XPCB),
  'XIAO shield can under the PCB':                 box_pts(*XCAN),
  'XIAO USB-C receptacle under the PCB':           box_pts(*XPORT),
  'USB-C cable shell through the window':          box_pts(-46, -41.5, -4.2, 4.2, ft+1.8, ft+4.5),
  'USB-C plug nose (12 x 6.5) in the outside recess':  box_pts(-48, -42.4, -6.0, 6.0, ft+0.5, ft+5.8),
  'U.FL plug under the XIAO':                      box_pts(*XUFL),
  'FPC antenna on the +Y tail wall (21 x 9.3)':    wall_pts(-41.0, -20.5, 3.0, 12.0),
  'battery leads through the divider gap':         box_pts(-21.0, -17.5, -6.0, 6.0, ft+0.3, ft+4.0),
  'fingertip reaching the plunger through the lid hole': cyl_pts(0, 0, 1.75, Z['switch_top']+e, Z['top']+1.0),
}
fit = {}
for k, pts in components.items():
    fit[k] = (sum(1 for p in pts if solid(*p)), len(pts))

# ---------------------------------------------------------------- component vs component
def box_in(b): return lambda x,y,z: b[0]<x<b[1] and b[2]<y<b[3] and b[4]<z<b[5]
def cyl_in(c): return lambda x,y,z: math.hypot(x-c[0], y-c[1])<c[2] and c[3]<z<c[4]
solids = {
 'battery': box_in((-17.5,17.5,-15,15,ft,bt)), 'switch': box_in(SW), 'plunger': cyl_in(SWPL),
 'ring': lambda x,y,z: 13.5<math.hypot(x,y)<18.75 and st<z<Z['ring_top'],
 'MPU': box_in(MPU), 'motor': cyl_in(MOT), 'XIAO pcb': box_in(XPCB), 'XIAO can': box_in(XCAN),
 'XIAO port': box_in(XPORT), 'U.FL': box_in(XUFL),
 'antenna': lambda x,y,z: -41<x<-20.5 and y_wall(x)-0.6<y<y_wall(x)-0.1 and 3<z<12,
}
boxes = {'battery': (-17.5,17.5,-15,15,ft,bt), 'switch': SW, 'plunger': (-2,2,-2,2,bt+3.5,Z['switch_top']),
         'ring': (-19,19,-19,19,st,Z['ring_top']), 'MPU': MPU, 'motor': (-38,-28,6.2,16.2,ft,ft+3.0),
         'XIAO pcb': XPCB, 'XIAO can': XCAN, 'XIAO port': XPORT, 'U.FL': XUFL,
         'antenna': (-41,-20.5,15,20,3,12)}
def grid(b, n=12):
    return [(x,y,z) for x in np.linspace(b[0],b[1],n) for y in np.linspace(b[2],b[3],n) for z in np.linspace(b[4],b[5],6)]
samples = {k: [p for p in grid(boxes[k]) if solids[k](*p)] for k in solids}
pair_hits = {}
for a, b in itertools.combinations(solids, 2):
    n = sum(1 for p in samples[a] if solids[b](*p)) + sum(1 for p in samples[b] if solids[a](*p))
    if n: pair_hits[f'{a} <-> {b}'] = n

# ---------------------------------------------------------------- insertion sweeps (base only; lid goes on last)
def sweep(fn, z_from, z_to, steps=12):
    h = n = 0
    for z in np.linspace(z_from, z_to, steps):
        pts = fn(z); n += len(pts); h += sum(1 for p in pts if in_base(*p))
    return h, n
sweeps = {
 'battery straight down into the pocket': sweep(lambda z: [(x,y,z) for x in np.linspace(-17.5,17.5,20) for y in np.linspace(-15,15,16)], 25, ft+e),
 'MPU straight down into the tail':       sweep(lambda z: [(x,y,z) for x in np.linspace(MPU[0],MPU[1],14) for y in np.linspace(MPU[2],MPU[3],14)], 25, ft+e),
 'motor straight down into the tail':     sweep(lambda z: [(MOT[0]+r*math.cos(t), MOT[1]+r*math.sin(t), z) for r in np.linspace(0,5,5) for t in np.linspace(0,2*math.pi,24,endpoint=False)], 25, ft+e),
 'switch straight down onto the battery': sweep(lambda z: [(x,y,z) for x in np.linspace(-3,3,8) for y in np.linspace(-3,3,8)], 25, bt+e),
 'LED ring straight down into its pocket': sweep(lambda z: [(r*math.cos(t), r*math.sin(t), z) for r in np.linspace(13.55,18.7,5) for t in np.linspace(0,2*math.pi,90,endpoint=False)], 25, st+e),
}
def xiao_pose(dx, dz, theta_deg):
    """All XIAO envelope points, rigidly moved: translate (dx, dz) and tilt about the port-end bottom edge."""
    th = math.radians(theta_deg); px, pz = XPORT[0], XPORT[4]
    pts = box_pts(*XPCB, n=10) + box_pts(*XCAN, n=8) + box_pts(*XPORT, n=8) + box_pts(*XUFL, n=6)
    outp = []
    for x, y, z in pts:
        rx, rz = x - px, z - pz
        xr = px + rx*math.cos(th) - rz*math.sin(th); zr = pz + rx*math.sin(th) + rz*math.cos(th)
        outp.append((xr + dx, y, zr + dz))
    return outp
xiao_path = [(0.0, 10.0*(1-t), 0.0) for t in np.linspace(0, 1, 14)]               # straight down
mpu_in, mot_in = box_in(MPU), cyl_in(MOT)
h = n = 0
for dx, dz, th in xiao_path:
    pts = xiao_pose(dx, dz, th); n += len(pts)
    h += sum(1 for p in pts if in_base(*p) or mpu_in(*p) or mot_in(*p))
sweeps['XIAO straight down onto MPU + motor (vs case, MPU and motor)'] = (h, n)

# ---------------------------------------------------------------- clearances
bw, bd, br = P['batt_pocket']
clear = {
 'on-wrist height (rails to lid top)': Z['top'],
 'footprint length x width': f"{L:.1f} x {P['head']:.1f}",
 'strap channel: width - 15.9 ribbon': P['slot_w'] - 15.9,
 'strap channel: height - 1.0 ribbon': P['slot_h'] - 1.0,
 'floor bridge span over the channel': P['slot_w'],
 'battery vs pocket X / Y (per side)': f"{(bw-35)/2:.2f} / {(bd-30)/2:.2f}",
 'ring OD vs pocket (radial)': (P['ring_pocket'] - P['ring_od'])/2,
 'ring bearing crescent width at +/-Y': rp - bd/2,
 'ring bottom above battery (wire gap)': P['ring_lift'],
 'ring top to lid underside': P['ring_gap'],
 'switch plunger top below lid top': Z['top'] - Z['switch_top'],
 'switch body top vs lid underside': Z['lid_bot'] - (bt+3.5),
 'switch body vs ring ID (radial)': 13.5 - math.hypot(3,3),
 'lid hole vs switch plunger (radial, plunger 3.5)': (P['button_hole'] - 3.5)/2,
 'XIAO near end sits between the divider posts by (X)': XPCB[1] - dx0,
 'divider gap half-width vs XIAO half-width': dg - 8.9,
 'MPU far end vs XIAO port (X)': MPU[0] - XPORT[1],
 'XIAO PCB back vs lid underside': Z['lid_bot'] - XPCB[5],
 'XIAO port bottom above floor': XPORT[4] - ft,
 'XIAO can bottom vs MPU/motor top (pad)': XCAN[4] - MPU[5],
 'USB window height - port (3.3)': (Z['usb_top']-Z['usb_bot']) - 3.3,
 'USB window inner width - receptacle (9.0)': 2*(-P['bay_x_end'])*math.tan(math.radians(usb_half)) - 9.0,
 'receptacle recess behind the end face (after the 0.7 outside recess)': P['wall'] - P['usb_cb'][1],
 'MPU vs bay flare wall at its near corner': V2.bay_half_width(P, MPU[1]) + MPU[2],
 'MPU near end to divider post (X)': dx0 - MPU[1],
 'MPU to motor (Y)': MOT[1]-MOT[2] - MPU[3],
 'motor vs bay corner wall (radial)': (P['R']-P['wall']) - (math.hypot(MOT[0]-(P['bay_x_end']+P['R']-P['wall']), MOT[1]-(P['bay_half']-P['R']+P['wall'])) + MOT[2]),
 'motor to bay far wall (X)': (MOT[0]-MOT[2]) - P['bay_x_end'],
 'motor vs USB port (Y)': (MOT[1]-MOT[2]) - XPORT[3],
 'tail bay spare height above the XIAO': Z['lid_bot'] - XPCB[5],
 'end wall / side wall thickness': f"{P['wall']} / {P['head']/2 - P['bay_half']:.1f}",
 'head side wall outside the pocket (Y)': P['head']/2 - bd/2,
 'lid vs rebate (per side)': P['clr'],
 'lid thickness over the LEDs (light window)': P['lid_t'] - P['led_window'][2],
}

# ---------------------------------------------------------------- exposed ceilings (what must bridge)
def ceilings():
    xs = np.arange(-44, 22.01, 0.25); ys = np.arange(-22, 22.01, 0.25); res = []
    for name, z in [('strap channel roof = floor', Z['slot_top']), ('USB window top', Z['usb_top']),
                    ('seat plane', Z['seat']), ('rebate step', Z['lid_bot'])]:
        mask = np.array([[in_base(x, y, z+0.05) and not in_base(x, y, z-0.05) for x in xs] for y in ys])
        if not mask.any(): res.append((name, z, 0, [])); continue
        seen = np.zeros_like(mask); comps = []
        for j0, i0 in zip(*np.where(mask)):
            if seen[j0,i0]: continue
            stack = [(j0,i0)]; seen[j0,i0] = True; cells = []
            while stack:
                j, i = stack.pop(); cells.append((j,i))
                for dj, di in ((1,0),(-1,0),(0,1),(0,-1)):
                    a, b = j+dj, i+di
                    if 0<=a<len(ys) and 0<=b<len(xs) and mask[a,b] and not seen[a,b]:
                        seen[a,b] = True; stack.append((a,b))
            c = np.array(cells); comps.append((xs[c[:,1]].min(), xs[c[:,1]].max(), ys[c[:,0]].min(), ys[c[:,0]].max(), len(c)*0.0625))
        res.append((name, z, mask.sum()*0.0625, comps))
    return res

# ---------------------------------------------------------------- mesh vs analytic
def read_stl(path):
    with open(path, 'rb') as f:
        f.read(80); n = struct.unpack('<I', f.read(4))[0]
        d = np.frombuffer(f.read(n*50), dtype=np.dtype([('n','<3f4'),('v','<9f4'),('a','<u2')]))
    return d['v'].reshape(-1,3,3).astype(float)
def inside_mesh(T, pts):
    v0, v1, v2 = T[:,0], T[:,1], T[:,2]; res = np.zeros(len(pts), bool)
    for i, p in enumerate(pts):
        d1 = (v0[:,0]-p[0])*(v1[:,1]-p[1]) - (v1[:,0]-p[0])*(v0[:,1]-p[1])
        d2 = (v1[:,0]-p[0])*(v2[:,1]-p[1]) - (v2[:,0]-p[0])*(v1[:,1]-p[1])
        d3 = (v2[:,0]-p[0])*(v0[:,1]-p[1]) - (v0[:,0]-p[0])*(v2[:,1]-p[1])
        hit = ((d1>=0)&(d2>=0)&(d3>=0)) | ((d1<=0)&(d2<=0)&(d3<=0))
        if not hit.any(): continue
        tri = T[hit]; n = np.cross(tri[:,1]-tri[:,0], tri[:,2]-tri[:,0]); nz = n[:,2]; ok = np.abs(nz) > 1e-9
        tri, n, nz = tri[ok], n[ok], nz[ok]
        zp = tri[:,0,2] - (n[:,0]*(p[0]-tri[:,0,0]) + n[:,1]*(p[1]-tri[:,0,1]))/nz
        res[i] = (np.sum(zp > p[2]) % 2) == 1
    return res

if __name__ == '__main__':
    ok = True
    print('COMPONENT FIT (points inside case solid / sampled):')
    for k, (h, n) in fit.items():
        if h: ok = False
        print(f"  {'OK ' if h == 0 else 'HIT'} {k}: {h}/{n}")
    print('\nCOMPONENT vs COMPONENT overlaps:')
    if pair_hits:
        ok = False
        for k, n in pair_hits.items(): print(f'  HIT {k}: {n} pts')
    else: print('  OK  none')
    print('\nINSERTION SWEEPS:')
    for k, (h, n) in sweeps.items():
        if h: ok = False
        print(f"  {'OK ' if h == 0 else 'HIT'} {k}: {h}/{n}")
    print('\nCLEARANCES (mm):')
    for k, v in clear.items():
        print(f'  {v if isinstance(v, str) else f"{v:6.2f}"}  {k}')
    print('\nEXPOSED CEILINGS (bridges when printing upright):')
    ceil = ceilings()
    for name, z, area, comps in ceil:
        print(f'  z={z:5.2f} {name}: {area:.0f} mm2 in {len(comps)} region(s)')
        for x0, x1, y0, y1, a in comps:
            print(f'      x {x0:6.2f}..{x1:6.2f} (span {x1-x0:5.2f})  y {y0:6.2f}..{y1:6.2f} (span {y1-y0:5.2f})  {a:.0f} mm2')
    T = read_stl(os.path.join(out, 'bandit_v2_base.stl'))
    rng = np.random.default_rng(2)
    pts = np.column_stack([rng.uniform(-44, 22, 2200), rng.uniform(-22, 22, 2200), rng.uniform(-0.5, 14, 2200)])
    seams = np.array(list(Z.values()) + [0.0])
    pts = pts[np.all(np.abs(pts[:,2][:,None]-seams[None,:]) > 0.06, axis=1)]
    mi = inside_mesh(T, pts); ai = np.array([in_base(*p) for p in pts])
    agree = float(np.mean(mi == ai)); mism = pts[mi != ai]
    print(f'\nMESH vs ANALYTIC: {agree*100:.2f}% agreement on {len(pts)} points ({len(mism)} mismatches)')
    for p in mism[:8]: print('    ', np.round(p, 2), 'mesh', bool(inside_mesh(T, p[None])[0]), 'analytic', in_base(*p))
    if agree < 0.995: ok = False
    print('\nHEIGHTS:', {k: round(v, 2) for k, v in Z.items()})
    print('\nOVERALL:', 'PASS' if ok else 'FAIL')
    json.dump({'fit': fit, 'pairs': pair_hits, 'sweeps': sweeps, 'clearances': clear,
               'ceilings': [(n, z, a, c) for n, z, a, c in ceil], 'mesh_agreement': agree, 'heights': Z, 'pass': ok},
              open(os.path.join(out, 'validation_v2.json'), 'w'), indent=1, default=float)
