"""BandIt system design in Excalidraw: thirteen frames stacked top to bottom. Labels follow LABELS.md."""
import pathlib
import sys

from lib import GLYPH, ICON, Scene, aspect, wrap

S = Scene()
GAP = 220
FS, AFS, ZFS, TFS = 28, 24, 26, 48  # box text, arrow labels, zone labels, titles
BH = 120  # box height for one or two text lines
WHITE = "#ffffff"
LOGOS = pathlib.Path(__file__).resolve().parent.parent / "logos"


def logo(name):
    return str(LOGOS / name)


# wordmarks (the logo says the name) and icon logos (a name goes beside them)
STDB, ELASTIC, CAPONE, BRIGHT, SEEED = (logo(n) for n in (
    "spacetimedb.svg", "elastic.svg", "capital-one.svg", "bright-data.svg", "seeed.png"))
MARK_H = {STDB: 38, ELASTIC: 46, CAPONE: 46, BRIGHT: 44, SEEED: 26}
CLAUDE, VULTR, RUST, CADDY, ESP, NFC, TS, BUN = (logo(n + ".svg") for n in (
    "claude", "vultr", "rust", "caddy", "espressif", "nfc", "typescript", "bun"))
PYTHON, OPENCV, NUMPY, THREE, SPARK, COLMAP, KIBANA = (logo(n + ".svg") for n in (
    "python", "opencv", "numpy", "threedotjs", "spark", "colmap", "kibana"))
USER, PHONE, MONITOR, CAMERA, LAPTOP, FILE, RADIO, WATCH, WALLET, IMAGE, WALK, GRAPH3D = (
    logo(f"icon-{n}.svg") for n in (
        "user", "smartphone", "monitor", "camera", "laptop", "file-text", "radio", "watch", "wallet", "image",
        "footprints", "graph-3d"))
SHIELD = logo("icon-shield-check.svg")
HEART, HAMMER, LOCK = (logo(f"icon-{n}.svg") for n in ("heart-pulse", "hammer", "lock-open"))
SOCIALS = [logo(n + ".svg") for n in ("instagram", "facebook", "threads")]


def L(v, axis="y"):
    """Absolute scene coordinate back to frame-local."""
    return v - (S.oy if axis == "y" else S.ox)


def title(t):
    S.text(40, 28, t, fs=TFS)


def need(label, icons=None, wordmark=None, mark_h=44, shape="rectangle"):
    lines = label.split("\n")
    ws = [len(s) * FS * 0.6 + 64 for s in lines]
    if icons:
        col = max((lg[1] if isinstance(lg, tuple) else ICON) * aspect(lg[0] if isinstance(lg, tuple) else lg)
                  for lg in icons.values())
        ws = [col + 12 + max(len(s) for s in lines) * FS * GLYPH + 80]
    if wordmark:
        ws.append(mark_h * aspect(wordmark) + 48)
    return max(ws) / (0.62 if shape == "diamond" else 1)


def B(x, y, label, kind="stdb", w=None, h=BH, **kw):
    n = need(label, kw.get("icons"), kw.get("wordmark"), kw.get("mark_h", 44), kw.get("shape", "rectangle"))
    if w is None:
        w = n
    elif w < n - 1:
        print("NARROW", repr(label), round(w), round(n))
    k = 0.62 if kw.get("shape") == "diamond" else 1
    if len(wrap(label, w * k, FS)) != label.count("\n") + 1:
        print("WRAPS", repr(label))
    return S.box(x, y, w, label, kind, h=h, fs=FS, **kw)


def SV(x, y, mark, text, kind="ext", h=BH, fill=WHITE, **kw):
    """A service: its wordmark logo, then the product and (role) as text."""
    return B(x, y, text, kind, h=h, wordmark=mark, mark_h=MARK_H[mark], fill=fill, **kw)


def H(a, b, label=None, **kw):
    return S.h(a, b, label=label, fs=AFS, **kw)


def V(a, b, label=None, **kw):
    return S.v(a, b, label=label, fs=AFS, **kw)


def D(a, sa, fa, b, sb, fb, label=None, **kw):
    """Straight arrow between two sides, often a diagonal across a gap."""
    return S.link(a, sa, b, sb, label=label, fa=fa, fb=fb, fs=AFS, **kw)


def R(a, sa, b, sb, via, label=None, seg=0, fa=0.5, fb=0.5, **kw):
    """Arrow through absolute waypoints via, with its label in the middle of segment seg."""
    pts = [a.side(sa, fa)] + list(via) + [b.side(sb, fb)]
    if label:
        mid = lambda p, q: ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
        t = seg + 1
        pts.insert(t, mid(pts[seg], pts[seg + 1]))
        while len(pts) != 2 * t + 1:  # the label sits on the middle point, so pad with points on a line
            if len(pts) < 2 * t + 1:
                pts.insert(len(pts) - 1, mid(pts[-2], pts[-1]))
            else:
                pts.insert(1, mid(pts[0], pts[1]))
                t += 1
    return S.arrow(a, b, pts, label=label, fs=AFS, **kw)


def Z(x, y, w, h, label, kind, logo_=None):
    return S.zone(x, y, w, h, label, kind, fs=ZFS, logo=logo_)


SCREENS = "tap page (/t/code)\norganizer portal (/organizer)"
SCREEN_ICONS = {0: PHONE, 1: MONITOR}


# ---------------------------------------------------------------- 1. Overview
def overview(y0):
    S.begin_frame("1 · Overview", 0, y0, 1000, 600)
    title("BandIt")
    A, C1, C2, C3 = 60, 760, 1660, 2420
    r1, r2, r3 = 250, 520, 860
    bands = B(A, r1, "band\nstation marker", "device", w=400, icons={0: WATCH, 1: RADIO})
    bridge = B(A, r2, "band1t-bridge\nvenue laptop", "rust", w=400, icons={0: RUST, 1: LAPTOP})
    screens = B(C1, r1, SCREENS, "web", w=640, icons=SCREEN_ICONS)
    stdb = SV(C1, r2, STDB, "Maincloud (band1t module)", w=640)
    api = B(C1, r3, "bandit-api\nbandit-indexer", "rust", w=420, icons={0: RUST})
    bd = SV(C2, r1, BRIGHT, "Web MCP (scraper)", w=520)
    ee = SV(C2, r2, ELASTIC, "(Evidence Engine)", w=520)
    de = B(C2, r3, "bandit-workers\n(Decision Engine)", "rust", w=520, h=2 * BH + 40, icons={0: RUST})
    claude = B(C3, r3, "Anthropic Claude API\n(agents)", "ext", w=500, icons={0: CLAUDE}, fill=WHITE)
    nessie = SV(C3, r3 + BH + 40, CAPONE, "Nessie (wallet)", w=500)
    Z(40, r1 - 70, 440, L(bridge.bottom) + 40 - (r1 - 70), "venue", "device")
    Z(C1 - 20, r3 - 70, C2 + 520 + 20 - (C1 - 20), L(de.bottom) + 30 - (r3 - 70), "Vultr Cloud Compute", "rust",
      VULTR)
    V(bands, bridge, "sends state")
    H(bridge, stdb, "calls ingest_band")
    V(screens, stdb, "subscribes", both=True)
    V(bd, ee, "scrapes")
    H(ee, stdb, "copies, loads", both=True)
    V(stdb, api, "reads rows", x=api.right - 70)
    D(stdb, "b", 1 - 50 / stdb.w, de, "l", 0.5, "runs jobs", both=True)
    V(de, ee, "checks claims", both=True)
    H(de, claude, "asks", y=claude.cy)
    H(de, nessie, "pays", y=nessie.cy)
    return S.end_frame()


# ---------------------------------------------------------------- 2. Architecture
def architecture(y0):
    S.begin_frame("2 · Architecture", 0, y0, 1000, 600)
    title("Architecture")
    A, Bc, C, D_, E = 60, 720, 1440, 2380, 3120
    r0, z, r1, r2, r3 = 210, 450, 520, 720, 920
    web = B(C, r0, SCREENS, "web", w=640, icons=SCREEN_ICONS)
    auth = SV(Bc, r0, STDB, "SpacetimeAuth (sign-in)", w=480)
    bd = SV(D_, r0, BRIGHT, "Web MCP (scraper)", w=460)
    bands = B(A, r1, "band\nstation marker", "device", w=400, icons={0: WATCH, 1: RADIO})
    cams = B(A, r3, "security camera\none per zone", "device", w=400, icons={0: CAMERA})
    bridge = B(Bc, r1, "band1t-bridge", "rust", w=400, icons={0: RUST})
    secview = B(Bc, r3, "security view", "rust", w=400, icons={0: OPENCV})
    stdb = SV(C, r1, STDB, "Maincloud (band1t module)", w=640, h=r3 + BH - r1)
    ingest = B(D_, r1, "bandit-ingest", "rust", w=460, icons={0: RUST})
    api = B(D_, r2, "bandit-api\nbandit-indexer", "rust", w=460, icons={0: RUST})
    workers = B(D_, r3, "bandit-workers\n(Decision Engine)", "rust", w=460, icons={0: RUST})
    ee = SV(E, r1, ELASTIC, "(Evidence Engine)", w=500, h=r3 + BH - r1)
    zb = r3 + BH + 30
    claude = B(D_ - 280, zb + 110, "Anthropic Claude API\n(agents)", "ext", w=500, icons={0: CLAUDE}, fill=WHITE)
    nessie = SV(D_ + 280, zb + 110, CAPONE, "Nessie (wallet)", w=420)
    Z(40, z, 440, zb - z, "venue", "device")
    Z(Bc - 20, z, 440, zb - z, "venue laptop", "rust")
    Z(D_ - 20, z, 500, zb - z, "Vultr Cloud Compute", "rust", VULTR)
    H(bands, bridge, "sends state")
    H(bridge, stdb, "calls ingest_band")
    H(cams, secview, "streams video")
    H(secview, stdb, "reports sighting", y=secview.cy)
    V(web, stdb, "subscribes", both=True)
    H(auth, web, "signs in")
    V(bd, ingest, "scrapes", x=ingest.right - 60)
    H(ingest, stdb, "imports event")
    H(stdb, api, "reads rows")
    H(stdb, workers, "runs jobs", both=True)
    H(ingest, ee, "organizes")
    H(api, ee, "copies, ranks", both=True)
    H(workers, ee, "checks claims", both=True)
    V(workers, claude, "asks")
    V(workers, nessie, "pays")
    return S.end_frame()


# ---------------------------------------------------------------- 3. SpacetimeDB live loop
def spacetimedb(y0):
    S.begin_frame("3 · SpacetimeDB live loop", 0, y0, 1000, 600)
    title("SpacetimeDB")
    r1, r2, r3 = 290, 520, 800
    bridge = B(60, r1, "band1t-bridge", "rust", w=400, icons={0: RUST})
    ingest = B(640, r1, "ingest_band", "stdb", w=420)
    watch = B(1340, r1, "watch_bands\n500 ms", "stdb", w=420)
    resolve = B(2040, r1, "resolve_incident", "stdb", w=420)
    B(640, r2, "timers\nsweep, social_tick, crowd_tick, job_reaper", "stdb", w=800)
    views = B(1660, r2, "views\nmy_band, my_wallet, claims_board", "stdb", w=800)
    screens = B(1660, r3, "tap page (/t/code)\norganizer portal (/organizer)\nphoto page (/photo)", "web", w=800,
                h=150, icons={0: PHONE, 1: MONITOR, 2: IMAGE})
    auth = SV(640, 0, STDB, "SpacetimeAuth (sign-in)", w=480, cy=L(screens.cy))
    Z(600, 220, 1900, r2 + BH + 40 - 220, "band1t module", "stdb", STDB)
    H(bridge, ingest, "calls")
    H(ingest, watch, "writes band")
    H(watch, resolve, "opens incident")
    ch = S.oy + (r1 + BH + r2) / 2
    R(resolve, "b", bridge, "b", [(resolve.cx, ch), (bridge.cx, ch)], label="clears SOS", seg=1)
    V(views, screens, "pushes rows")
    H(auth, screens, "signs in")
    return S.end_frame()


# ---------------------------------------------------------------- 4. Vision
def vision(y0):
    S.begin_frame("4 · Vision", 0, y0, 1000, 600)
    title("Vision")
    c1, c2, c3, c4, c5 = 60, 780, 1500, 2200, 2860
    r0, z, r1, r2 = 180, 420, 490, 800
    cam = B(c1, r1, "security camera\none per zone", "device", w=440, icons={0: CAMERA})
    view = B(c2, r1, "security view\n4 Hz red flash", "rust", w=440, icons={0: OPENCV, 1: NUMPY})
    log = B(c3, r1, "radio log\nradio_*.jsonl", "note", w=420, icons={0: RADIO})
    band = B(c4, r1, "SOS band", "device", w=360, icons={0: WATCH})
    mod = SV(c5, r1, STDB, "report_camera_sighting", kind="stdb", w=460)
    gateway = B(c3, r0, "gateway\npyserial", "device", w=420, icons={0: RADIO, 1: PYTHON})
    page = B(c2, r2, "security page\nthree.js\nSpark", "web", w=440, h=150, icons={0: MONITOR, 1: THREE, 2: SPARK})
    cy = L(page.cy)
    brush = B(c3, 0, "Brush\n(Gaussian splat)", "ext", w=420, cy=cy, fill=WHITE)
    colmap = B(c4, 0, "COLMAP\n(poses)", "ext", w=360, cy=cy, icons={0: COLMAP}, fill=WHITE)
    walk = B(c5, 0, "phone walk", "web", w=460, cy=cy, icons={0: WALK})
    Z(c2 - 20, z, c4 + 360 + 20 - (c2 - 20), r1 + BH + 40 - z, "venue laptop", "rust", PYTHON)
    Z(c2 - 20, r2 - 70, c5 + 460 + 20 - (c2 - 20), L(page.bottom) + 30 - (r2 - 70), "3D venue", "plain")
    H(cam, view, "streams video")
    H(view, log, "finds flash")
    H(log, band, "matches SOS")
    H(band, mod, "reports sighting")
    V(gateway, log, "writes beacons")
    V(view, page, "serves page")
    H(walk, colmap, "picks frames")
    H(colmap, brush, "places frames")
    H(brush, page, "exports splat")
    return S.end_frame()


# ---------------------------------------------------------------- 5. Event data pipeline
def pipeline(y0):
    S.begin_frame("5 · Event data pipeline", 0, y0, 1000, 600)
    title("Event data")
    lanes = [(190, 210, "outside services", "ext", None), (420, 210, "bandit-ingest", "rust", RUST),
             (650, 250, "Evidence Engine", "ext", None), (920, 210, "band1t module", "stdb", STDB)]
    by = [top + 64 for top, _, _, _, _ in lanes]
    seed = B(60, by[1], "event seed\nstart URLs", "rust", w=340)
    fetch = B(620, by[1], "fetch, parse", "rust", w=360)
    bd = SV(620, by[0], BRIGHT, "Web MCP (scraper)", w=360)
    mp = B(1120, by[1], "map", "rust", w=300)
    claude = B(1120, by[0], "Anthropic Claude API\n(floorplan_check)", "ext", w=500, icons={0: CLAUDE}, fill=WHITE)
    wf = SV(1620, by[2], ELASTIC, "Workflows\n(bandit-organize)", w=420, h=160)
    agent = SV(2200, by[2], ELASTIC, "Agent Builder\n(bandit-organizer)", w=420, h=160)
    val = B(2780, by[1], "validate", "rust", w=300)
    imp = B(3140, by[3], "import_event", "stdb", w=360)
    W = 3580
    for top, lh, name, kind, lg in lanes:
        Z(40, top, W - 80, lh, name, kind, lg)
    H(seed, fetch, "gives URLs")
    V(bd, fetch)
    H(fetch, mp)
    V(claude, mp, x=mp.cx)
    R(mp, "r", wf, "t", [(wf.x + 80, mp.cy)], label="indexes records", fb=80 / wf.w)
    H(wf, agent, "merges")
    R(agent, "r", val, "b", [(val.x + 80, agent.cy)], label="returns bundle", fb=80 / val.w)
    R(val, "r", imp, "t", [(imp.x + 80, val.cy)], label="loads bundle", seg=1, fb=80 / imp.w)
    return S.end_frame()


# ---------------------------------------------------------------- 6. The Evidence Engine
def evidence(y0):
    S.begin_frame("6 · The Evidence Engine", 0, y0, 1000, 600)
    title("Evidence Engine")
    lanes = [
        ("organize scrape (bandit-ingest)",
         [lambda x, y: SV(x, y, ELASTIC, "Workflows\n(bandit-organize)", w=480, h=160),
          lambda x, y: SV(x, y, ELASTIC, "Agent Builder\n(bandit-organizer)", w=480, h=160),
          lambda x, y: B(x, y, "import_event", "stdb", w=480, h=160)], ["merges", "loads bundle"]),
        ("check claims (bandit-workers)",
         [lambda x, y: SV(x, y, ELASTIC, "ingest pipeline\n(bandit-claims-validate)", w=480, h=160),
          lambda x, y: SV(x, y, ELASTIC, "semantic search\n(similar claims)", w=480, h=160),
          lambda x, y: B(x, y, "submit_claim_checks", "stdb", w=480, h=160)], ["searches", "returns checks"]),
    ]
    X = [80 + j * 740 for j in range(3)]
    zones = []
    for i, (name, makers, labels) in enumerate(lanes):
        top = 170 + i * 270
        zones.append(Z(40, top, 2040, 250, name, "ext"))
        boxes = [mk(X[j], top + 64) for j, mk in enumerate(makers)]
        for a, b, lbl in zip(boxes, boxes[1:], labels):
            H(a, b, lbl)
    # raw band radio data and event photos, kept as they came for the dashboards
    top = 170 + 2 * 270
    zones.append(Z(40, top, 2040, 340, "store raw data (pipeline)", "ext"))
    raw = SV(X[2], top + 64, ELASTIC, "bandit-raw-radio\nbandit-raw-heard\nbandit-raw-gateway\nbandit-raw-photos",
             w=480, h=240)
    scripts = B(X[1], top + 64, "feed.py\nphotos.py", "rust", w=480, h=240, icons={0: PYTHON, 1: PYTHON})
    gateway = B(X[0], top + 64, "gateway", "device", w=480, h=100, icons={0: RADIO})
    photos = B(X[0], top + 64 + 140, "event photos", "note", w=480, h=100, icons={0: IMAGE})
    H(gateway, scripts, "records", y=gateway.cy)
    H(photos, scripts, "imports", y=photos.cy)
    H(scripts, raw, "stores")
    # recap suggestions: interests from the booths with the most minutes, ranked by meaning
    top = zones[-1].bottom - S.oy + 20
    zones.append(Z(40, top, 2040, 420, "rank recap (bandit-indexer, bandit-api)", "ext"))
    r1, r2 = top + 64, top + 64 + BH + 80
    visit = B(X[0], r1, "visit\ntop 5 booths", "stdb", w=480, icons={0: WALK})
    indexer = B(X[1], r1, "bandit-indexer", "rust", w=480, icons={0: RUST})
    people = SV(X[2], r1, ELASTIC, "bandit-people\nbandit-booths\n(semantic search)", w=480, h=r2 + BH - r1)
    api = B(X[1], r2, "bandit-api\nGET /api/recap", "rust", w=480, icons={0: RUST})
    recap = B(X[0], r2, "recap (/t/code)", "web", w=480, icons={0: PHONE})
    H(visit, indexer, "sets interests")
    H(indexer, people, "copies rows", y=indexer.cy)
    H(people, api, "ranks", y=api.cy)
    H(api, recap, "orders lists")
    # Kibana: the organizer's screen for the event data, the past claims and the raw data
    first, last = zones[0].cy, zones[2].cy
    kib = B(2260, 0, "Kibana\n(dashboards)", "ext", w=420, h=last - first + 160, icons={0: KIBANA}, fill=WHITE,
            cy=(first + last) / 2 - S.oy)
    for z in zones[:3]:
        H(z, kib, "shows", y=z.cy)
    return S.end_frame()


# ---------------------------------------------------------------- 7. The insurance Decision Engine
def badge(box, n):
    """A numbered stage marker on the top left corner of a box."""
    d = 64
    rid, tid = S.uid("bg"), S.uid("bt")
    S.base("ellipse", box.x - 26, box.y - 26, d, d, id=rid, backgroundColor="#1e1e1e", strokeColor="#1e1e1e",
           boundElements=[{"type": "text", "id": tid}])
    s = str(n)
    tw, th = len(s) * 32 * 0.64 + 4, 32 * 1.25
    S.base("text", box.x - 26 + (d - tw) / 2, box.y - 26 + (d - th) / 2, tw, th, id=tid, strokeColor=WHITE, text=s,
           originalText=s, fontSize=32, fontFamily=5, textAlign="center", verticalAlign="middle", containerId=rid,
           autoResize=True, lineHeight=1.25)


def insurance(y0):
    S.begin_frame("7 · Insurance Decision Engine", 0, y0, 1000, 600)
    S.text(40, 28, "Insurance Decision Engine", fs=64)
    A, Bx, C1, C2, D_, E, F = 60, 760, 1440, 2160, 2960, 3760, 4500
    p = [330, 640, 950]  # documents rows
    mk = dict(fill=WHITE)

    def person(x, cy, label, w=380):
        return B(x, 0, label, "web", w=w, h=240, wordmark=USER, mark_h=120, cy=cy, **mk)

    # 1. documents: three PDFs, each its own card
    organizer = person(A, p[0], "organizer")
    attendee = person(A, p[1], "attendee")
    venue_pdf = B(Bx, 0, "venue policy\nPDF", "note", w=440, h=260, wordmark=FILE, mark_h=120, cy=p[0])
    att_pdf = B(Bx, 0, "attendee policy\nPDF", "note", w=440, h=260, wordmark=FILE, mark_h=120, cy=p[1])
    report = B(Bx, 0, "hospital report\nmedical records, bill\nPDF", "note", w=440, h=260, wordmark=FILE,
               mark_h=100, cy=p[2])
    H(organizer, venue_pdf, "uploads at setup")
    H(attendee, att_pdf, "uploads at sign-up")
    D(attendee, "b", 0.5, report, "l", 0.5, "uploads with claim")

    # 2. the Evidence Engine reads every PDF
    top, bot = p[0] - 130, p[2] + 130
    Z(C1 - 40, top - 70, C2 + 560 - C1 + 80, 1270 - top + 70, "Evidence Engine", "ext", logo_=ELASTIC)
    ingest = B(C1, top, "ingest pipeline\nPDF text, pages", "ext", w=520, h=bot - top, wordmark=ELASTIC,
               mark_h=70, **mk)
    reader = B(C2, top, "Agent Builder\nWorkflows\nreads PDFs", "ext", w=520, h=p[1] + 130 - top, wordmark=ELASTIC,
               mark_h=70, **mk)
    clauses = B(C2, 860, "policy clauses\ninjury, damage, theft", "ext", w=520, h=370, wordmark=HAMMER, mark_h=100,
                **mk)
    mark = S.elements[-1]  # the incident types as a row of pictures: injury, damage, theft
    for i, icon in ((-1, HEART), (1, LOCK)):
        S.image(mark["x"] + i * 150 + (mark["width"] - 100 * aspect(icon)) / 2, mark["y"], icon, 100)
    for pdf in (venue_pdf, att_pdf, report):
        H(pdf, ingest, "PDF", y=pdf.cy)
    H(ingest, reader, "PDF pages", y=S.oy + (top + p[1] + 130) / 2)
    V(reader, clauses, "each clause", x=clauses.cx)

    # 3. the terms that drive the decision, from both policies
    venue_terms = B(D_, 0, "venue terms\ncovers injury, damage, theft\nstaff excluded\n$5,000 per claim\n"
                    "$25,000 per event\nminimum payout, deductible\nfee schedule", "stdb", w=620, h=360, wordmark=STDB, mark_h=50,
                    cy=p[0] - 20, **mk)
    att_terms = B(D_, 0, "attendee terms\ninsurer, plan\ncoverage, deductible", "stdb", w=620, h=230,
                  wordmark=STDB, mark_h=50, cy=p[1] + 20, **mk)
    bill = B(D_, 0, "bill lines\npage cites\ninjury codes", "stdb", w=620, h=230, wordmark=STDB, mark_h=50,
             cy=p[2] + 10, **mk)
    H(reader, venue_terms, "venue terms", y=venue_terms.cy)
    H(reader, att_terms, "attendee terms", y=att_terms.cy)
    D(reader, "r", 0.93, bill, "l", 0.5, "bill lines")
    checks = B(E, 0, "checks bill\ntotals, patient\ndate, injury code\nno duplicate", "rust", w=560, h=300,
               wordmark=RUST, mark_h=70, cy=bill.cy - S.oy)
    split = B(F, venue_terms.y - S.oy, "Which policy pays\ninjury: venue, rest to insurer\ndamage, theft: venue,\n"
              "then charge attendee\n$1,308 billed: venue $895\nattendee insurer $413", "rust", w=600, h=checks.bottom - venue_terms.y,
              wordmark=RUST, mark_h=90)
    H(bill, checks, "bill lines")
    H(venue_terms, split, "venue terms", y=venue_terms.cy)
    H(att_terms, split, "attendee terms", y=att_terms.cy)
    H(checks, split, "valid lines", y=checks.cy)

    # 4. the claim and its evidence, every source its own card
    e = [1660, 1980, 2280, 2560, 2840, 3120]
    claim = B(A, 0, "tap page (/t/code)\nHurt at the event?\nFile a claim", "web", w=500, h=290, wordmark=PHONE,
              mark_h=110, cy=e[0], **mk)
    venue_claim = B(A, 0, "organizer portal\n(/organizer, Claims)\ndamage, theft", "web", w=500, h=270,
                    wordmark=MONITOR, mark_h=100, cy=e[1], **mk)
    srcs = [B(A, 0, label, "device", w=500, h=240, wordmark=icon, mark_h=110, cy=y, **mk)
            for (label, icon), y in zip((("band", WATCH), ("light circle", RADIO), ("security camera", CAMERA),
                                         ("medic", USER)), e[2:])]
    facts = [B(820, 0, "file_claim\nown words, injury", "stdb", w=560, h=200, cy=e[0]),
             B(820, 0, "file_claim\ndamage, theft, who", "stdb", w=560, h=200, cy=e[1]),
             B(820, 0, "incident\nSOS, fall, damage", "stdb", w=560, h=200, cy=e[2]),
             B(820, 0, "witnesses\n2+ bands, same zone", "rust", w=560, h=200, cy=e[3]),
             B(820, 0, "camera sighting\nsame zone, 2 min", "rust", w=560, h=200, cy=e[4]),
             B(820, 0, "medic note\nwithin 30 min", "rust", w=560, h=200, cy=e[5])]
    V(attendee, claim, "files claim", x=attendee.cx)
    for src, fact, label in zip([claim, venue_claim] + srcs, facts, ("own words", "opens claim", "SOS or fall",
                                                                     "witness bands", "flash", "note")):
        H(src, fact, label, y=fact.cy)
    pack = B(1620, claim.y - S.oy, "evidence pack\nnumbered facts", "stdb", w=520, h=facts[-1].bottom - claim.y,
             wordmark=STDB, mark_h=50, **mk)
    for fact in facts:
        H(fact, pack, y=fact.cy)

    # 5. Claude investigates the claim with its tools
    claude = B(2360, pack.y - S.oy + 80, "Claude\ninvestigates claim\ncites clauses", "claude", w=760,
               h=pack.h - 160, wordmark=CLAUDE, mark_h=320, **mk)
    H(pack, claude, "opens claim", y=claude.cy)
    tz = Z(3320, pack.y - S.oy, 1800, 90 + 330 + 50 + 330 + 50, "tools", "plain")
    search = B(3360, pack.y - S.oy + 90, "search_policy\nread_clause\nboth policies", "ext", w=800, h=330,
               wordmark=ELASTIC, mark_h=60, **mk)
    rchecks = B(4240, pack.y - S.oy + 90, "read_checks\nbill checks\nwhich policy pays", "rust", w=840, h=330,
                wordmark=RUST, mark_h=60, **mk)
    revid = B(3360, search.bottom - S.oy + 50, "read_evidence\nband, light circle, security cameras\n"
              "medic notes, hospital report", "stdb", w=1720, h=330, wordmark=CAMERA, mark_h=110, **mk)
    cam = S.elements[-1]  # the wordmark image sits in the middle of the row
    for i, icon in ((-2, WATCH), (-1, RADIO), (1, USER), (2, FILE)):
        S.image(cam["x"] + i * 220 + (cam["width"] - 110 * aspect(icon)) / 2, cam["y"], icon, 110)
    H(claude, tz, "calls", y=tz.y + tz.h * 0.3)
    H(tz, claude, "returns", y=tz.y + tz.h * 0.7)
    R(search, "t", clauses, "b", [(search.cx, clauses.bottom + 80), (clauses.cx, clauses.bottom + 80)],
      label="semantic search", seg=1)
    V(split, rchecks, "venue share\ninsurer share", x=rchecks.cx)

    # 6. code holds Claude to its limits
    r3 = L(pack.bottom) + 330
    guard = B(2360, 0, "guard\namounts from code\nrefuse alone: failed check\npay alone: rule ceiling", "rust",
              w=760, h=330, wordmark=RUST, mark_h=70, cy=r3)
    refused = B(1300, 0, "refused\nreason shown", "bad", w=640, h=200, cy=r3)
    payout = B(3720, 0, "payout\nvenue share\nattendee charges\nup to $5,000 per claim\nwithin $25,000 per event\n"
               "double-entry journals", "rust", w=640, h=380, wordmark=RUST, mark_h=60, cy=r3)
    nessie = B(4600, 0, "deposit, charge\n(wallet)", "ext", w=500, h=240, wordmark=CAPONE, mark_h=60, cy=r3 - 100,
               **mk)
    charges = B(4600, 0, "tap page (/t/code)\ncharges, payouts", "web", w=500, h=270, wordmark=PHONE, mark_h=110,
                cy=r3 + 300, **mk)
    V(nessie, charges, "shows", x=nessie.cx)
    V(claude, guard, "pay, refuse\nor ask", x=claude.cx)
    H(guard, refused, "refuses", y=refused.cy)
    H(guard, payout, "pays", y=S.oy + r3)
    H(payout, nessie, "venue share\ncharges", y=nessie.cy)

    # 7. the organizer decides what code and Claude hand over
    r4 = r3 + 650
    org = B(2200, 0, "Organizer decides\norganizer portal\n(/organizer, Claims)", "web", w=1080, h=600,
            wordmark=USER, mark_h=260, cy=r4)
    stale = B(3720, 0, "amount and evidence\nunchanged", "rust", w=640, h=240, wordmark=RUST, mark_h=60, cy=r4)
    insurer = B(4600, 0, "attendee insurer claim\nnotice of loss", "claude", w=500, h=240, wordmark=CLAUDE,
                mark_h=90, cy=r4, **mk)
    rules = B(1240, 0, "learned rules\nversion, approver", "stdb", w=640, h=220, wordmark=STDB, mark_h=50,
              cy=L(org.y) + org.h * 0.72, **mk)
    history = B(1240, L(org.bottom) + 160, "decision history\nClaude steps, code checks, organizer calls", "stdb",
                w=3860, h=200, wordmark=STDB, mark_h=50, **mk)
    V(guard, org, "asks organizer", x=guard.cx + 120)
    H(org, stale, "approves", y=org.cy)
    V(stale, payout, "unchanged", x=stale.cx)
    R(payout, "r", insurer, "l", [(payout.right + 110, payout.y + payout.h * 0.85), (payout.right + 110, insurer.cy)],
      label="insurer share", seg=1, fa=0.85)
    D(org, "t", 0.06, refused, "b", 0.85, "refuses")
    teach = H(org, rules, "teaches a rule", dashed=True, color="#2b8a3e", y=rules.cy)
    teach["strokeWidth"] = 4
    R(rules, "t", guard, "b", [(rules.x + 120, org.y - 70), (guard.x + 120, org.y - 70)], label="rule ceiling",
      seg=1, fa=120 / rules.w, fb=120 / guard.w, dashed=True, color="#2b8a3e")
    V(history, org, "shows", x=org.cx)
    for box, n in ((venue_pdf, 1), (ingest, 2), (reader, 3), (claim, 4), (pack, 5), (split, 6), (claude, 7),
                   (guard, 8), (org, 9), (payout, 10)):
        badge(box, n)
    return S.end_frame()


# ---------------------------------------------------------------- 8. Claude jobs
def claude_jobs(y0):
    S.begin_frame("8 · Claude jobs", 0, y0, 1000, 600)
    title("Claude")
    jobs = [("medical_extract", "apply_medical_extract", "reads medical PDF"),
            ("claim_record_extract", "apply_medical_record", "reads hospital report"),
            ("claim_review", "submit_claim_review", "reviews claim"),
            ("claim_draft", "attach_claim_letters", "drafts letters")]
    rows = []
    for i, (job, res, verb) in enumerate(jobs):
        y = 270 + i * (BH + 50)
        rows.append((B(980, y, job, "ext", w=440), B(1710, y, res, "stdb", w=460), verb))
    top, bottom = 270, L(rows[-1][0].bottom)
    queue = B(70, top, "worker_jobs\n60 s lease", "stdb", w=480, h=bottom - top)
    Z(40, 200, 540, bottom + 40 - 200, "band1t module", "stdb", STDB)
    Z(950, 200, 500, bottom + 40 - 200, "Anthropic Claude API", "ext", CLAUDE)
    Z(1680, 200, 520, bottom + 40 - 200, "band1t module", "stdb", STDB)
    for i, (job, res, verb) in enumerate(rows):
        H(queue, job, verb, y=job.cy)
        H(job, res, "returns" if i == 0 else None)
    return S.end_frame()


# ---------------------------------------------------------------- 9. Social and recap
def social(y0):
    S.begin_frame("9 · Social and recap flow", 0, y0, 1000, 600)
    title("Social")
    c1, c2, c3, c4 = 60, 820, 1640, 2340
    r1, r2, r3 = 260, 480, 700
    gh = 4 * 35 + 50  # the event graph box holds four lines
    attendee = B(c1, r1, "attendee\ntap page (/t/code)", "web", w=520, icons={0: USER, 1: PHONE})
    auth = SV(c1, r2, STDB, "SpacetimeAuth (sign-in)", w=520)
    setup = B(c1, r3, "claim_band\nconfirm_medical_card\nconnect_wallet", "stdb", w=520, h=150)
    photo = B(c2, r1, "photo page (/photo)\nregister_photo", "web", w=560, icons={0: IMAGE})
    tick = B(c2, r2, "social_tick\nvisit, social_encounter", "stdb", w=560)
    graph = B(c2, r3, "Event graph\norganizer portal\n(/organizer)\n3d-force-graph, graphology", "web", w=560,
              h=gh, icons={0: (GRAPH3D, 34), 1: MONITOR})
    org = B(c3, r1, "organizer portal\n(/organizer)", "web", w=440, icons={0: MONITOR})
    recap = B(c3, r2, "recap (/t/code)", "web", w=440, h=r3 + gh - r2, icons={0: PHONE})
    ee = SV(c4, 0, ELASTIC, "(Evidence Engine)", w=440, cy=L(recap.cy) - 70)
    zt, zb = 190, r3 + gh + 40
    Z(40, zt, 560, zb - zt, "at door", "web")
    Z(c2 - 20, zt, 600, zb - zt, "during event", "stdb")
    Z(c3 - 20, zt, c4 + 440 + 20 - (c3 - 20), zb - zt, "after event", "plain")
    V(attendee, auth, "signs in")
    V(auth, setup, "sets up")
    D(setup, "r", 0.3, tick, "l", 0.7, "wears band")
    V(tick, graph, "writes links")
    V(tick, photo, "tags people")
    H(tick, recap, "lists people", y=tick.cy)
    D(photo, "r", 0.5, recap, "t", 0.12, "adds photos")
    V(org, recap, "ends event")
    H(ee, recap, "ranks lists", y=ee.cy)
    # the recap's share button: the photo goes out through the phone's share sheet
    sy, s = recap.bottom - 70, 44
    lx = ee.x + 40
    S.arrow(recap, None, [(recap.right, sy), (lx - 14, sy)], label="shares photo", fs=AFS)
    for i, path in enumerate(SOCIALS):
        S.image(lx + i * (s + 22), sy - s / 2, path, s)
    return S.end_frame()


# ---------------------------------------------------------------- 10. Merch and wallet
def merch(y0):
    S.begin_frame("10 · Merch and wallet", 0, y0, 1000, 600)
    title("Merch and wallet")
    ins = [B(80, 260 + i * (BH + 40), lbl, "stdb", w=560, icons=ic) for i, (lbl, ic) in enumerate([
        ("my_visits", None), ("my_photos", {0: IMAGE}), ("merch_template\ntee $25, mug $18, poster $15", None)])]
    view = B(840, 260, "my_merch_suggestions\ntop 3", "stdb", w=440, h=ins[-1].bottom - ins[0].y)
    recap = B(1600, 0, "recap (/t/code)", "web", w=440, cy=L(view.cy), icons={0: PHONE})
    r2 = L(ins[-1].bottom) + 120
    buy = B(1600, r2, "buy_merch", "stdb", w=440)
    pay = SV(840, r2, CAPONE, "Nessie (wallet)", w=440)
    settle = B(80, r2, "settle_merch_order", "good", w=560)
    for b in ins:
        H(b, view, y=b.cy)
    H(view, recap, "suggests")
    V(recap, buy, "taps buy")
    H(buy, pay, "queues purchase")
    H(pay, settle, "confirms")
    return S.end_frame()


# ---------------------------------------------------------------- 11. Capital One Nessie wallet
def nessie(y0):
    S.begin_frame("11 · Nessie wallet", 0, y0, 1000, 600)
    title("Capital One Nessie")
    rows = [(("connect_wallet", "web"), "Nessie (account)", "record_wallet", "opens account", "adds $200"),
            (("buy_merch", "web"), "Nessie (purchase)", "settle_merch_order", "buys", "subtracts price"),
            (("claim_payout", "stdb"), "Nessie (deposit)", "record_claim_payout", "deposits", "adds payout")]
    drawn = []
    for i, ((t, tk), n, r, v1, v2) in enumerate(rows):
        y = 270 + i * (BH + 60)
        drawn.append((B(80, y, t, tk, w=420), SV(760, y, CAPONE, n, w=400), B(1420, y, r, "stdb", w=440), v1, v2))
    top, bottom = drawn[0][0].y, drawn[-1][0].bottom
    wallet = B(2120, L(top), "my_wallet\nwallet_entry", "stdb", w=440, h=bottom - top, icons={0: WALLET})
    zb = L(bottom) + 40
    Z(40, 200, 500, zb - 200, "triggers", "plain")
    Z(720, 200, 480, zb - 200, "Capital One Nessie API", "ext")
    Z(1380, 200, 1220, zb - 200, "band1t module", "stdb", STDB)
    for a, b, c, v1, v2 in drawn:
        H(a, b, v1)
        H(b, c)
        H(c, wallet, v2, y=c.cy)
    return S.end_frame()


# ---------------------------------------------------------------- 12. Vultr server
def vultr(y0):
    S.begin_frame("12 · Vultr server", 0, y0, 1000, 600)
    title("Vultr")
    c1, c2, c3, c4 = 60, 740, 1440, 2240
    r1 = 340
    api = B(c3, r1, "bandit-api", "rust", w=420, icons={0: RUST})
    workers = B(c3, r1 + BH + 50, "bandit-workers", "rust", w=420, h=2 * BH + 30, icons={0: RUST})
    indexer = B(c3, L(workers.bottom) + 50, "bandit-indexer", "rust", w=420, icons={0: RUST})
    caddy = B(c2, r1, "Caddy\n(HTTPS proxy)", "ext", w=460, icons={0: CADDY}, fill=WHITE)
    pages = B(c2, L(indexer.y), "TypeScript (pages)\nBun (build)", "web", w=460, icons={0: TS, 1: BUN})
    users = B(c1, r1, "attendee, staff\nband1t.vip", "web", w=440, icons={0: USER})
    deploy = B(c1, L(indexer.y), "deploy-vm\nsetup.sh", "note", w=440)
    stdb = SV(c4, r1, STDB, "Maincloud (band1t module)", w=560)
    claude = B(c4, L(workers.y), "Anthropic Claude API\n(agents)", "ext", w=560, icons={0: CLAUDE}, fill=WHITE)
    nessie = SV(c4, L(workers.bottom) - BH, CAPONE, "Nessie (wallet)", w=560)
    elastic = SV(c4, L(indexer.y), ELASTIC, "(Evidence Engine)", w=560)
    inner_b = L(indexer.bottom) + 40
    Z(700, 200, 1240, inner_b + 40 - 200, "Vultr Cloud Compute", "plain", VULTR)
    Z(1400, 270, 500, inner_b - 270, "systemd (bandit@.service)", "rust")
    H(users, caddy, "visits")
    H(caddy, api, "proxies")
    H(deploy, pages, "builds")
    ym = S.oy + (r1 + BH + L(indexer.y)) / 2
    R(deploy, "t", caddy, "b", [(deploy.right - 60, ym), (caddy.cx, ym)], label="installs", seg=2,
      fa=1 - 60 / deploy.w, dashed=True)
    D(api, "l", 0.8, pages, "r", 0.2, "serves")
    H(api, stdb, "subscribes")
    H(workers, claude, "asks", y=claude.cy)
    H(workers, nessie, "pays", y=nessie.cy)
    H(indexer, elastic, "copies rows")
    return S.end_frame()


# ---------------------------------------------------------------- 13. Hardware basics
def hardware(y0):
    S.begin_frame("13 · Hardware basics", 0, y0, 1000, 600)
    title("Hardware")
    phone = B(80, 200, "phone", "web", w=480, icons={0: NFC})
    lite = SV(80, 510, SEEED, "lite band x6\nXIAO ESP32-C3", kind="device", h=150, w=480, fill=None)
    full = B(80, 720, "full band x3\n+ IMU, vibration", "device", w=480, icons={0: WATCH})
    bands = Z(60, 440, 520, 440, "9 bands, one firmware", "device")
    cam = B(920, 200, "security camera\none per zone", "device", w=480, icons={0: CAMERA})
    marker = B(920, 0, "station marker x2 to 5\nESP32-C3 SuperMini", "device", w=520, cy=L(lite.cy),
               icons={1: ESP})
    gateway = SV(920, 0, SEEED, "gateway\nXIAO ESP32-C3", kind="device", h=150, w=480, fill=None, cy=L(full.cy))
    laptop = B(1680, 0, "venue laptop\nband1t-bridge, security view", "device", w=560, cy=L(full.cy),
               icons={0: LAPTOP})
    Z(900, L(marker.y) - 70, 560, BH + 90, "at each exit", "device")
    V(phone, lite, "taps NFC", x=phone.right - 80)
    H(marker, bands, "loudest sets zone", y=marker.y + 32)
    H(marker, bands, "shows exit color", y=marker.y + 88)
    H(bands, gateway, "talks ESP-NOW", y=gateway.cy, both=True)
    H(gateway, laptop, "sends lines")
    D(lite, "r", 0.12, cam, "l", 0.85, "flashes red")
    R(cam, "r", laptop, "t", [(laptop.cx, cam.cy)], label="streams video", seg=1)
    return S.end_frame()


FRAMES = (overview, architecture, spacetimedb, vision, pipeline, evidence, insurance, claude_jobs, social, merch,
          nessie, vultr, hardware)
only = sys.argv[2:]  # frame function names, for a board of just those frames
y = 0
for draw in FRAMES:
    if not only or draw.__name__ in only:
        y += draw(y) + GAP
S.dump(sys.argv[1] if len(sys.argv) > 1 else "bandit-system-design.excalidraw")
print(len(S.elements), "elements")
