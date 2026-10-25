"""
BandIt v2 "pill": LED ring + battery head, electronics tail, strap threads under the floor (NATO).
Pure numpy, same mesh toolkit as v1 (imported from bandit_case). mm, Z up, X along the strap.
Ring centre = origin. Body runs from x = -L_tail to x = +W_head/2.
"""
import math, json, os
import numpy as np
import bandit_case as M     # Mesh, prism, ring, box, clipped_prism, rrect, circle, star_from_pred, in_rr

P = dict(
    # outline: rounded rectangle, ring at the origin, tail toward -X
    head=42.0,                 # width across the wrist (Y) and the head's length to +X (half = 21)
    tail_len=43.0,             # body extends to x = -tail_len
    R=10.0, wall=1.5,                  # body corner radius; the bay's far corners follow it at R - wall
    # strap channel under the floor (NATO thread-through): full length, rails on the bed
    slot_w=17.5, slot_h=1.3, floor=1.0,
    # stack
    batt_h=5.5, ring_lift=1.0, ring_h=3.2, ring_gap=0.4, lid_t=1.2, lip=0.8, clr=0.2,
    ring_od=37.5, ring_id=27.0, ring_pocket=38.3,
    batt_pocket=(37.0, 32.0, 3.0),
    # tail bay: flares from the battery pocket width to the bay width, then constant to the end wall
    bay_x_end=-41.5, flare_x=(-18.5, -24.0), bay_half=19.5,
    divider=(-20.0, -18.5, 9.2),       # x0, x1, half-width of the gap in the middle (XIAO is 17.8 wide; wires pass here)
    # USB-C window in the -X end wall
    usb_w=10.6, usb_z=(3.3, 7.5),      # receptacle sits flush with the inner face (XIAO drops straight in)
    usb_cb=(14.0, 0.7, 2.6, 8.2),      # shallow outside recess around the window (w, depth, z0, z1) so the plug reaches
    # SOS switch 6x6x5 standing on the battery at the ring centre, pressed directly through a hole in the lid
    switch_h=5.0, button_hole=6.5,
    led_window=(26.0, 39.0, 0.6),      # annular thinning on the lid underside over the LEDs: id, od, depth (lid is 0.6 there)
    N=720,
)

def heights(P):
    z = {}
    z['slot_top'] = P['slot_h']; z['floor_top'] = z['slot_top'] + P['floor']
    z['batt_top'] = z['floor_top'] + P['batt_h']
    z['seat'] = z['batt_top'] + P['ring_lift']
    z['ring_top'] = z['seat'] + P['ring_h']
    z['lid_bot'] = z['ring_top'] + P['ring_gap']
    z['top'] = z['lid_bot'] + P['lid_t']
    z['switch_top'] = z['batt_top'] + P['switch_h']
    z['usb_bot'], z['usb_top'] = P['usb_z']
    return z

# ---------------------------------------------------------------- 2D regions
def rrect_at(W, D, R, cx, cy):
    """Rounded rectangle centred at (cx, cy) as a polar contour about the origin (origin must be inside)."""
    hw, hd = W/2 - R, D/2 - R
    def fn(th):
        c, s = math.cos(th), math.sin(th)
        def sdf(t):
            px, py = abs(c*t - cx), abs(s*t - cy)
            return math.hypot(max(px-hw, 0), max(py-hd, 0)) - R
        lo, hi = 0.0, W + D
        for _ in range(50):
            mid = 0.5*(lo+hi)
            if sdf(mid) > 0: hi = mid
            else: lo = mid
        return 0.5*(lo+hi)
    return fn

def outline(P, inset=0.0):
    L = P['tail_len'] + P['head']/2
    return rrect_at(L - 2*inset, P['head'] - 2*inset, P['R'] - inset, (P['head']/2 - P['tail_len'])/2, 0.0)

def bay_half_width(P, x):
    """Half-width of the tail cavity at x (flares from the pocket width to bay_half)."""
    x0, x1 = P['flare_x']; bw, bd, _ = P['batt_pocket']
    if x >= x0: return bd/2
    if x <= x1: return P['bay_half']
    return bd/2 + (P['bay_half'] - bd/2) * (x0 - x)/(x0 - x1)

def lower_pred(P):
    bw, bd, br = P['batt_pocket']
    xe, bh, rb = P['bay_x_end'], P['bay_half'], P['R'] - P['wall']      # bay corner radius keeps the wall uniform
    def inside(x, y):
        if M.in_rr(bw, bd, br, x, y): return True
        if xe <= x <= P['flare_x'][0] and abs(y) <= bay_half_width(P, x):
            if x < xe + rb and abs(y) > bh - rb:                           # rounded far corners
                return math.hypot(x - (xe + rb), abs(y) - (bh - rb)) <= rb
            return True
        return False
    return inside

def upper_pred(P):
    low = lower_pred(P); rp = P['ring_pocket']/2
    return lambda x, y: math.hypot(x, y) <= rp or low(x, y)

# ---------------------------------------------------------------- parts
def build_base(P):
    z = heights(P); N = P['N']
    outer = outline(P); reb = outline(P, P['lip'])
    low = M.star_from_pred(lower_pred(P), rmax=60); up = M.star_from_pred(upper_pred(P), rmax=60)
    ov = 0.02
    m = M.Mesh()
    # rails + strap channel: outer outline clipped either side of the slot
    m.add(M.clipped_prism(outer, 0.0, z['slot_top']+ov, N, ymin= P['slot_w']/2))
    m.add(M.clipped_prism(outer, 0.0, z['slot_top']+ov, N, ymax=-P['slot_w']/2))
    m.add(M.prism(outer, z['slot_top'], z['floor_top']+ov, N))                       # floor (bridges the channel)
    # body bands; USB window is an angular cut in the -X end wall
    usb_half = math.degrees(math.atan2(P['usb_w']/2, -P['bay_x_end']))
    cbw, cbd, cz0, cz1 = P['usb_cb']; xo = -(P['tail_len']); cb_half = math.degrees(math.atan2(cbw/2, -xo))
    def outer_cb(th):   # outline pulled in by cbd around the window (shallow recess for the plug nose)
        d = abs((math.degrees(th) - 180 + 180) % 360 - 180)
        return outer(th) - cbd if d <= cb_half else outer(th)
    m.add(M.ring(outer, low, z['floor_top'], cz0+ov, N))
    m.add(M.ring(outer_cb, low, cz0, z['usb_bot']+ov, N))
    m.add(M.ring(outer_cb, low, z['usb_bot'], z['usb_top']+ov, N, keep=[(180+usb_half, 540-usb_half)]))
    m.add(M.ring(outer_cb, low, z['usb_top'], cz1+ov, N))
    m.add(M.ring(outer, low, cz1, z['seat']+ov, N))
    m.add(M.ring(outer, up,  z['seat'], z['lid_bot']+ov, N))
    m.add(M.ring(outer, reb, z['lid_bot'], z['top'], N))                              # rebate lip
    # divider between battery pocket and bay (two posts), with a wire gap in the middle
    x0, x1, g = P['divider']
    yw = bay_half_width(P, x0) + 0.3                                                  # overlap into the wall
    m.add(M.box(x0, x1,  g, yw, z['floor_top']-ov, z['seat']+ov))
    m.add(M.box(x0, x1, -yw, -g, z['floor_top']-ov, z['seat']+ov))
    return m

def build_lid(P):
    z = heights(P); N = P['N']
    outer = outline(P, P['lip'] + P['clr'])
    wid, wod, wd = P['led_window']
    m = M.Mesh()
    # lower band: everything outside the LED window annulus, plus the centre disc (minus the button hole)
    m.add(M.ring(outer, M.circle(wod), z['lid_bot'], z['lid_bot'] + wd + 0.02, N))
    m.add(M.ring(M.circle(wid), M.circle(P['button_hole']), z['lid_bot'], z['lid_bot'] + wd + 0.02, N))
    # upper band: full plate with the button hole
    m.add(M.ring(outer, M.circle(P['button_hole']), z['lid_bot'] + wd, z['top'], N))
    return m

if __name__ == '__main__':
    out = os.path.dirname(os.path.abspath(__file__))
    z = heights(P)
    parts = {'bandit_v2_base': build_base(P), 'bandit_v2_lid': build_lid(P)}
    def flipped(mesh):
        T = mesh.array().copy(); T[:,:,2] *= -1; T = T[:, ::-1, :]; T[:,:,2] -= T[:,:,2].min()
        f = M.Mesh(); f.tris = list(T); return f
    parts['bandit_v2_lid_facedown'] = flipped(parts['bandit_v2_lid'])
    report = {'heights': z, 'params': P, 'parts': {}}
    for name, mesh in parts.items():
        mesh.write_stl(os.path.join(out, name + '.stl'), name)
        lo, hi = mesh.bbox()
        report['parts'][name] = dict(triangles=len(mesh.tris), volume_mm3=round(mesh.volume(), 1),
            grams_pla=round(mesh.volume()*1.24/1000, 2),
            bbox_min=[round(float(v),2) for v in lo], bbox_max=[round(float(v),2) for v in hi],
            open_edges=mesh.check_closed())
    json.dump(report, open(os.path.join(out, 'report_v2.json'), 'w'), indent=2)
    for k, v in report['parts'].items():
        print(k, v['volume_mm3'], 'mm3', v['grams_pla'], 'g', 'bbox', v['bbox_min'], v['bbox_max'], 'open', v['open_edges'])
    print({k: round(v, 2) for k, v in z.items()})
