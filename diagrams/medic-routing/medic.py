"""Medic routing in Excalidraw: four frames stacked top to bottom. Labels follow diagrams/generator/LABELS.md.

    for t in "Table 51" "Table 121" "Table 201"; do node path.mts "$t"; done > paths.jsonl
    python3 render.py paths.jsonl floor-paths.png -92 -12 -50 2 18
    LS=30 python3 render.py /dev/null doors.png -112 102 -54 47 9
    python3 medic.py medic-routing.excalidraw

path.mts runs web/src/floor-path.ts itself, so the paths on the picture are the ones the Live tab draws.
"""
import base64
import hashlib
import math
import pathlib
import sys

GEN = pathlib.Path(__file__).resolve().parent.parent / "generator"
sys.path.insert(0, str(GEN))
from lib import GLYPH, ICON, LINE, Box, Scene, aspect, text_size, wrap  # noqa: E402

HERE = pathlib.Path(__file__).resolve().parent
S = Scene()
GAP = 220
FS, AFS, ZFS, TFS = 28, 24, 26, 48
BH = 120
WHITE = "#ffffff"
LOGOS = GEN.parent / "logos"


def logo(name):
    return str(LOGOS / name)


STDB = logo("spacetimedb.svg")
MARK_H = {STDB: 38}
RUST, THREE, PYTHON = logo("rust.svg"), logo("threedotjs.svg"), logo("python.svg")
USER, PHONE, MONITOR, RADIO, WATCH, WALK, HEART, NFC = (logo(f"icon-{n}.svg") for n in (
    "user", "smartphone", "monitor", "radio", "watch", "footprints", "heart-pulse", "file-text"))
NFC = logo("nfc.svg")


def L(v, axis="y"):
    return v - (S.oy if axis == "y" else S.ox)


def title(t):
    S.text(40, 28, t, fs=TFS)


def need(label, icons=None, shape="rectangle"):
    lines = label.split("\n")
    ws = [len(s) * FS * 0.6 + 64 for s in lines]
    if icons:
        col = max((lg[1] if isinstance(lg, tuple) else ICON) * aspect(lg[0] if isinstance(lg, tuple) else lg)
                  for lg in icons.values())
        ws = [col + 12 + max(len(s) for s in lines) * FS * GLYPH + 80]
    return max(ws) / (0.62 if shape == "diamond" else 1)


def B(x, y, label, kind="stdb", w=None, h=BH, **kw):
    n = need(label, kw.get("icons"), kw.get("shape", "rectangle"))
    if w is None:
        w = n
    elif w < n - 1:
        print("NARROW", repr(label), round(w), round(n))
    k = 0.62 if kw.get("shape") == "diamond" else 1
    if len(wrap(label, w * k, FS)) != label.count("\n") + 1:
        print("WRAPS", repr(label))
    return S.box(x, y, w, label, kind, h=h, fs=FS, **kw)


def H(a, b, label=None, **kw):
    return S.h(a, b, label=label, fs=AFS, **kw)


def V(a, b, label=None, **kw):
    return S.v(a, b, label=label, fs=AFS, **kw)


def D(a, sa, fa, b, sb, fb, label=None, **kw):
    return S.link(a, sa, b, sb, label=label, fa=fa, fb=fb, fs=AFS, **kw)


def R(a, sa, b, sb, via, label=None, seg=0, fa=0.5, fb=0.5, **kw):
    pts = [a.side(sa, fa)] + list(via) + [b.side(sb, fb)]
    if label:
        mid = lambda p, q: ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
        t = seg + 1
        pts.insert(t, mid(pts[seg], pts[seg + 1]))
        while len(pts) != 2 * t + 1:
            if len(pts) < 2 * t + 1:
                pts.insert(len(pts) - 1, mid(pts[-2], pts[-1]))
            else:
                pts.insert(1, mid(pts[0], pts[1]))
                t += 1
    return S.arrow(a, b, pts, label=label, fs=AFS, **kw)


def Z(x, y, w, h, label, kind, logo_=None):
    return S.zone(x, y, w, h, label, kind, fs=ZFS, logo=logo_)


def picture(x, y, path, w):
    """A big picture at frame-local x, y, w pixels wide, with a thin border."""
    data = pathlib.Path(path).read_bytes()
    fid = hashlib.sha1(data).hexdigest()[:20]
    mime = "image/jpeg" if str(path).endswith(".jpg") else "image/png"
    S.files.setdefault(fid, {"mimeType": mime, "id": fid, "created": 1792828800000,
                             "dataURL": f"data:{mime};base64," + base64.b64encode(data).decode()})
    h = w / aspect(path) if mime == "image/png" else w * pic_ratio(path)
    el = S.base("image", S.ox + x, S.oy + y, w, h, fileId=fid, status="saved", scale=[1, 1], crop=None,
                strokeColor="transparent")
    S.base("rectangle", S.ox + x, S.oy + y, w, h, strokeColor="#868e96", strokeWidth=2, roughness=0)
    return Box(el)


def pic_ratio(path):
    from PIL import Image
    w, h = Image.open(path).size
    return h / w


def badge(box, n):
    d = 64
    rid, tid = S.uid("bg"), S.uid("bt")
    S.base("ellipse", box.x - 26, box.y - 26, d, d, id=rid, backgroundColor="#1e1e1e", strokeColor="#1e1e1e",
           boundElements=[{"type": "text", "id": tid}])
    s = str(n)
    tw, th = len(s) * 32 * 0.64 + 4, 32 * 1.25
    S.base("text", box.x - 26 + (d - tw) / 2, box.y - 26 + (d - th) / 2, tw, th, id=tid, strokeColor=WHITE, text=s,
           originalText=s, fontSize=32, fontFamily=5, textAlign="center", verticalAlign="middle", containerId=rid,
           autoResize=True, lineHeight=1.25)


def white_text(box):
    tid = [b["id"] for b in box.el["boundElements"] if b["type"] == "text"][0]
    next(e for e in S.elements if e["id"] == tid)["strokeColor"] = WHITE


def circle(cx, cy, r, stroke, fill="transparent", dashed=False, width=2):
    """A circle centred at frame-local cx, cy."""
    el = S.base("ellipse", S.ox + cx - r, S.oy + cy - r, 2 * r, 2 * r, strokeColor=stroke, backgroundColor=fill,
                strokeStyle="dashed" if dashed else "solid", strokeWidth=width, roughness=0)
    return Box(el)


# ---------------------------------------------------------------- 1. Medic routing
def routing(y0):
    S.begin_frame("Medic routing", 0, y0, 1000, 600)
    title("Medic routing")
    c1, c2, c3, c4, c5 = 60, 700, 1400, 1960, 2620
    r1, r2, r3, r4 = 220, 480, 660, 920
    band = B(c1, r1, "band\nfall or SOS", "device", w=480, icons={0: WATCH})
    near = B(c1, r2, "nearby bands\nlight circle", "device", w=480, icons={0: WATCH})
    bridge = B(c2, r1, "gateway\nband1t-bridge", "rust", w=520, icons={0: RADIO, 1: RUST})
    ingest = B(c3, r1, "ingest_band", "stdb", w=460)
    watch = B(c4, r1, "watch_bands\n500 ms", "stdb", w=460)
    incident = B(c3, r2, "incident\nstatus, medic", "stdb", w=460)
    snap = B(c4, r2, "incident_snapshot\nzone at that moment", "stdb", w=460)
    bands = B(c3, r3, "incident_band\nsubject, witnesses", "stdb", w=460)
    marker = B(c4, r3, "incident_marker\nwhere, who, status", "stdb", w=460)
    assign = B(c3, r4, "assign_medic\nResponding", "stdb", w=460)
    resolve = B(c4, r4, "resolve_incident\nResolved", "stdb", w=460)
    medic = B(c1, r4, "medic\nbandit-claims live", "web", w=480, icons={0: USER, 1: RUST})
    tap = B(c2, r3, "tap page (/t/code)\nmedical card", "web", w=520, icons={0: PHONE})
    desk = B(c2, r4, "organizer portal\n(/organizer, Claims)", "web", w=520, icons={0: MONITOR})
    live = B(c5, r3, "organizer portal\n(/organizer, Live)", "web", w=560, icons={0: MONITOR, 1: THREE})
    walk = B(c5, r4, "medic walk\nnearest door", "web", w=560, icons={0: WALK})
    claim = B(c5, r4 + 300, "claim\n(Decision Engine)", "claude", w=560, icons={0: HEART})
    Z(c3 - 40, r1 - 70, c4 + 460 + 40 - (c3 - 40), r4 + BH + 40 - (r1 - 70), "band1t module", "stdb", STDB)
    rows = Z(c3 - 20, r2 - 70, c4 + 460 + 20 - (c3 - 20), r3 + BH + 30 - (r2 - 70), "one transaction", "plain")
    V(band, near, "hear SOS")
    H(band, bridge, "sends flags")
    D(near, "r", 0.5, bridge, "b", 0.3, "sends circle")
    H(bridge, ingest, "calls")
    H(ingest, watch, "writes band")
    S.link(watch, "b", rows, "t", fa=0.5, fb=(watch.cx - rows.x) / rows.w, label="opens incident", fs=AFS)
    D(medic, "t", 0.5, tap, "l", 0.5, "taps band")
    H(medic, desk, "opens desk")
    D(tap, "r", 0.5, assign, "l", 0.25, "Take it")
    H(desk, assign, "Take it", y=assign.y + 0.75 * assign.h)
    S.link(assign, "t", rows, "b", fa=0.5, fb=(assign.cx - rows.x) / rows.w, label="updates", fs=AFS)
    S.link(resolve, "t", rows, "b", fa=0.5, fb=(resolve.cx - rows.x) / rows.w, label="updates", fs=AFS)
    yb = S.oy + r4 + BH + 110
    R(desk, "b", resolve, "b", [(desk.cx, yb), (resolve.cx, yb)], label="Resolve", seg=1)
    H(marker, live, "pushes row")
    V(live, walk, "draws")
    D(resolve, "r", 0.75, claim, "l", 0.5, "feeds claim")
    yt = S.oy + 130
    R(resolve, "r", bridge, "t", [(resolve.right + 70, resolve.cy), (resolve.right + 70, yt), (bridge.cx, yt)],
      label="clears SOS", seg=2, fa=0.25)
    for box, n in ((band, 1), (watch, 2), (tap, 3), (live, 4), (resolve, 5)):
        badge(box, n)
    return S.end_frame()


# ---------------------------------------------------------------- 2. Medic walk
def walk(y0):
    S.begin_frame("Medic walk", 0, y0, 1000, 600)
    title("Medic walk")
    floor = picture(60, 150, HERE / "floor-paths.png", 1800)
    sx, sw, rx = 1980, 520, 2620
    s1 = B(sx, 150, "incident_marker\nresponding_at", "stdb", w=sw)
    s2 = B(sx, 360, "nearest door\nstraight distance", "web", w=sw, icons={0: WALK})
    s3 = B(sx, 570, "snap to floor\n25 cm cells", "web", w=sw)
    s4 = B(sx, 770, "straight line\nclear?", "web", w=sw, h=200, shape="diamond")
    s5 = B(sx, 1060, "A* search\n8 directions", "web", w=sw)
    s6 = B(sx, 1270, "fewest corners", "web", w=sw)
    s7 = B(sx, 1480, "stop 1.4 m short\n5 m/s, 1.5 to 9 s", "web", w=sw)
    straight = B(rx, 0, "walk straight", "web", w=460, cy=L(s4.cy))
    json_ = B(rx, 0, "floor.json\nvenue_floor.py", "rust", w=460, cy=L(s3.cy), icons={1: PYTHON})
    crowd = B(rx, 0, "venue::floor\ncrowd walks", "rust", w=460, cy=L(s5.cy), icons={0: RUST})
    Z(sx - 30, 90, sw + 60, 1480 + BH + 40 - 90, "floor-path.ts", "web")
    V(s1, s2, "sets off")
    V(s2, s3, "snaps")
    V(s3, s4, "checks")
    V(s4, s5, "blocked")
    V(s5, s6, "straightens")
    V(s6, s7, "walks")
    H(s4, straight, "clear")
    H(json_, s3, "loads")
    H(s5, crowd, "same search", both=True)
    R(straight, "r", s7, "r", [(straight.right + 60, straight.cy), (straight.right + 60, s7.cy)], label="walks", seg=1)
    # what the picture shows
    ly = L(floor.bottom) + 50
    lw = 336
    chips = [("medic walk", "good", "#63e6be", False, False), ("straight line", "bad", "#ffe3e3", True, False),
             ("person down", "bad", "#ff8787", False, False), ("door", "web", "#4dabf7", False, False),
             ("tables, walls", "stdb", "#495057", False, True)]
    for i, (t, k, fill, dashed, white) in enumerate(chips):
        chip = B(60 + i * (lw + 30), ly, t, k, w=lw, fill=fill, dashed=dashed)
        if white:
            white_text(chip)
    shot = picture(60, ly + BH + 90, HERE / "live-medic.jpg", 1800)
    cy0 = max(L(shot.y) + 40, 1480 + BH + 120)
    status = [("open", "#ffc9c9"), ("medic on way", "#ffe8a3"), ("resolved", "#b2f2bb"), ("medic", WHITE)]
    for i, (t, fill) in enumerate(status):
        B(sx, cy0 + i * (BH + 50), t, "web", w=sw, fill=fill, icons={0: USER} if t == "medic" else None)
    return S.end_frame()


# ---------------------------------------------------------------- 3. Light circle
def light_circle(y0):
    S.begin_frame("Light circle", 0, y0, 1000, 600)
    title("Light circle")
    cx, cy, M = 700, 760, 90  # centre and pixels per metre
    outer = circle(cx, cy, 4.2 * M, "#1971c2", fill="#e7f5ff", width=3)
    inner = circle(cx, cy, 3.0 * M, "#1971c2", dashed=True, width=3)
    circle(cx, cy, 70, "#ff2f45", width=6)
    person = circle(cx, cy, 34, "#c92a2a", fill="#ff2f45")
    for k in range(8):
        a = math.radians(k * 45 + 20)
        r0 = (1.2 + 0.18 * (k % 4)) * M
        p0 = (cx + r0 * math.cos(a), cy + r0 * math.sin(a))
        p1 = (cx + 4.2 * M * math.cos(a), cy + 4.2 * M * math.sin(a))
        circle(*p0, 20, "#868e96", fill="#dee2e6", dashed=True)
        circle(*p1, 24, "#1864ab", fill="#4dabf7")
        d0, d1 = 26 / max(1, math.dist(p0, p1)), 30 / max(1, math.dist(p0, p1))
        q0 = (S.ox + p0[0] + (p1[0] - p0[0]) * d0, S.oy + p0[1] + (p1[1] - p0[1]) * d0)
        q1 = (S.ox + p1[0] - (p1[0] - p0[0]) * d1, S.oy + p1[1] - (p1[1] - p0[1]) * d1)
        S.arrow(None, None, [q0, q1], color="#1864ab")
    for k in range(10):
        a = math.radians(k * 36 + 5)
        r = (5.4 + 0.5 * (k % 3)) * M
        dot = circle(cx + r * math.cos(a), cy + r * math.sin(a), 22, "#2b8a3e", fill="#8ce99a")
        if k == 8:
            S.last_far = dot
    down = B(60, 170, "person down\nSOS or fall", "bad", w=420)
    within = B(60, 1220, "within 3 m\nlights blue", "stdb", w=420)
    back = B(900, 1220, "steps back\nto 4.2 m", "stdb", w=420)
    D(down, "b", 0.6, person, "t", 0.3)
    D(within, "t", 0.7, inner, "l", 0.85)
    D(back, "t", 0.5, outer, "b", 0.62)
    far = B(1000, 170, "farther\nstays green", "good", w=360)
    D(far, "l", 0.5, S.last_far, "r", 0.5)
    # how the circle forms, on the bands and in the module
    c1, c2 = 1580, 2260
    r1, r2, r3, r4 = 220, 480, 760, 980
    hear = B(c1, r1, "band hears SOS\n-58 dBm or more", "device", w=560, icons={0: WATCH})
    pulse = B(c2, r1, "pulses blue\nstate 4", "device", w=480)
    tick = B(c1, r2, "crowd_tick\n2 s", "stdb", w=560)
    step = B(c2, r2, "state 4\nsnapped to floor", "stdb", w=480)
    Z(c1 - 30, r1 - 70, c2 + 480 + 30 - (c1 - 30), BH + 100, "radio bands", "device")
    Z(c1 - 30, r2 - 70, c2 + 480 + 30 - (c1 - 30), BH + 100, "crowd bands", "stdb")
    wit = B(c1, r3, "incident_band\nwitnesses", "stdb", w=560)
    watch = B(c2, r3, "watch_bands\n500 ms", "stdb", w=480)
    res = B(c1, r4, "resolve_incident", "stdb", w=560)
    up = B(c2, r4, "back to team", "stdb", w=480, icons={0: WALK})
    H(hear, pulse, "lights")
    H(tick, step, "moves crowd")
    V(tick, wit, "records")
    H(watch, wit, "records")
    xr = S.ox + c2 + 480 + 80
    R(pulse, "r", watch, "r", [(xr, pulse.cy), (xr, watch.cy)], label="reports", seg=1)
    H(res, up, "stands up")
    badge(hear, 1)
    badge(tick, 2)
    return S.end_frame()


# ---------------------------------------------------------------- 4. Exits
def exits(y0):
    S.begin_frame("Exits", 0, y0, 1000, 600)
    title("Exits")
    shot = picture(60, 150, HERE / "exit-marker.jpg", 1200)
    picture(60, L(shot.bottom) + 60, HERE / "doors.png", 1200)
    c1, c2 = 1400, 2080
    r1, r2, r3 = 200, 420, 640
    marker = B(c1, r1, "station marker\nat each exit", "device", w=560, icons={0: RADIO})
    glow = B(c2, r1, "exit marker\nexit color", "device", w=500)
    band = B(c1, r2, "band\nloudest station", "device", w=560, icons={0: WATCH})
    guide = B(c2, r2, "GUIDE\nchases color", "device", w=500)
    zone = B(c1, r3, "zone\nnearest door", "stdb", w=560)
    H(marker, glow, "glows")
    V(marker, band, "sets zone")
    H(band, guide, "crowded")
    V(band, zone, "reports")
    D(guide, "b", 0.5, zone, "r", 0.5, "leads to")
    # doors close
    r4, r5, r6 = 980, 1200, 1420
    close = B(c1, r4, "close_doors\nend time", "stdb", w=560)
    head = B(c2, r4, "head_for_exits\n4 exit doors", "stdb", w=500)
    stays = B(c1, r5, "person down\nstays", "bad", w=560)
    out = B(c2, r5, "walk_team\nnearest exit", "stdb", w=500, icons={0: WALK})
    wait = B(c1, r6, "doors wait\nup to 120 s", "stdb", w=560)
    medic = B(c2, r6, "medic\nresolves", "web", w=500, icons={0: USER})
    Z(c1 - 30, r4 - 70, c2 + 500 + 30 - (c1 - 30), r6 + BH + 40 - (r4 - 70), "live run", "stdb")
    H(close, head, "sends crowd")
    V(head, out, "walks")
    V(close, stays, "keeps")
    V(stays, wait, "holds doors")
    D(medic, "l", 0.3, stays, "r", 0.7, "frees")
    return S.end_frame()


FRAMES = (routing, walk, light_circle, exits)
y = 0
for draw in FRAMES:
    y += draw(y) + GAP
S.dump(sys.argv[1] if len(sys.argv) > 1 else str(HERE / "medic-routing.excalidraw"))
print(len(S.elements), "elements")
