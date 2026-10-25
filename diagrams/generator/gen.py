"""BandIt system design in Excalidraw: twenty-three frames stacked top to bottom, the last four drawn by\n../medic-routing/medic.py. Labels follow LABELS.md."""
import json
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
HEART, HAMMER, LOCK, BROKEN = (logo(f"icon-{n}.svg") for n in ("heart-pulse", "hammer", "lock-open", "package-x"))
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


def Z(x, y, w, h, label, kind, logo_=None, indent=0):
    return S.zone(x, y, w, h, label, kind, fs=ZFS, logo=logo_, indent=indent)


SCREENS = "attendee portal\norganizer desk + portal"
SCREEN_ICONS = {0: PHONE, 1: MONITOR}


# ---------------------------------------------------------------- 1. Overview
def overview(y0):
    S.begin_frame("1 · Overview", 0, y0, 1000, 600)
    title("Band1t")
    A, C1, C2, C3 = 60, 760, 1660, 2420
    r1, r2, r3, r4 = 250, 800, 1200, 1500
    bands = B(A, r1, "band\nstation marker", "device", w=400, icons={0: WATCH, 1: RADIO})
    bridge = B(A, r2, "band1t-bridge\nvenue laptop", "rust", w=400, icons={0: RUST, 1: LAPTOP})
    screens = B(C1, r1, SCREENS, "web", w=640, icons=SCREEN_ICONS)
    stdb = SV(C1, r2, STDB, "Maincloud (band1t module)", kind="stdb", w=640)
    api = B(C1, r3, "bandit-api", "rust", w=420, icons={0: RUST})
    indexer = B(C2, r3, "bandit-indexer", "rust", w=520, icons={0: RUST})
    bd = SV(C2, r1, BRIGHT, "Web MCP (scraper)", w=520)
    ingest = B(C2, 520, "bandit-ingest", "rust", w=520, icons={0: RUST})
    ee = SV(C2, r2, ELASTIC, "Search + Workflows", w=520)
    de = B(C2, r4, "bandit-workers\n(Decision Engine)", "rust", w=520, h=2 * BH + 40, icons={0: RUST})
    claude = B(C3, r4, "Anthropic Claude\n(configured model)", "ext", w=500, icons={0: CLAUDE}, fill=WHITE)
    nessie = SV(C3, r4 + BH + 40, CAPONE, "Nessie (wallet)", w=500)
    Z(40, r1 - 70, 440, L(bridge.bottom) + 40 - (r1 - 70), "venue", "device")
    Z(C1 - 20, r3 - 150, C2 + 520 + 20 - (C1 - 20), L(de.bottom) + 30 - (r3 - 150),
      "Vultr Cloud Compute", "rust", VULTR)
    V(bands, bridge, "sends state")
    H(bridge, stdb, "calls ingest_band")
    V(stdb, screens, "live rows", x=stdb.x + 160)
    V(screens, stdb, "reducer calls", x=stdb.right - 160)
    V(ingest, bd, "fetches pages", both=True)
    V(ingest, ee, "raw records", x=ingest.x + 100)
    V(ee, ingest, "event bundle", x=ingest.right - 100)
    D(ingest, "l", 0.5, stdb, "r", 0.5, "calls import_event")
    V(stdb, api, "live rows", x=api.right - 70)
    D(stdb, "r", 0.5, indexer, "l", 0.5, "live rows")
    V(indexer, ee, "indexes rows")
    D(stdb, "b", 1 - 50 / stdb.w, de, "l", 0.5, "jobs, results", both=True)
    R(de, "t", ee, "r", [S.P(C2 + 260, 1420), S.P(2300, 1420), S.P(2300, r2 + BH / 2)],
      "runs tasks", seg=2, both=True)
    R(ee, "r", claude, "t", [(claude.cx, ee.cy)], "runs model", seg=1)
    H(de, nessie, "pays", y=nessie.cy)
    return S.end_frame()


# ---------------------------------------------------------------- 2. Architecture
def architecture(y0):
    S.begin_frame("2 · Architecture", 0, y0, 1000, 600)
    title("Architecture")
    A, Bc, C, D_, E = 60, 720, 1440, 2380, 3120
    r0, z, r1, r2, r3 = 210, 450, 520, 720, 920
    web = B(C, r0, "tap page (/t/code)\norganizer portal (/portal)", "web", w=640, icons=SCREEN_ICONS)
    auth = SV(D_, r0, STDB, "SpacetimeAuth (sign-in)", w=480)
    bd = SV(E, r0, BRIGHT, "Web MCP + Unlocker\nBrowser API", w=500, h=180)
    bands = B(A, r1, "band\nstation marker", "device", w=400, icons={0: WATCH, 1: RADIO})
    gateway = B(A, r2, "gateway", "device", w=400, icons={0: RADIO})
    cams = B(A, r3, "security camera\none per zone", "device", w=400, icons={0: CAMERA})
    bridge = B(Bc, r2, "band1t-bridge", "rust", w=400, icons={0: RUST})
    secview = B(Bc, r3, "security view", "rust", w=400, icons={0: OPENCV})
    stdb = SV(C, r1, STDB, "Maincloud (band1t module)", kind="stdb", w=640, h=r3 + 220 - r1)
    api = B(D_, r2, "bandit-api\nbandit-indexer", "rust", w=460, icons={0: RUST})
    workers = B(D_, r3, "bandit-workers\nevent importer", "rust", w=460, h=220, icons={0: RUST})
    ee = SV(E, r1, ELASTIC, "Search + Workflows\nAgent Builder", w=500, h=r3 + 220 - r1)
    zb = r3 + 220 + 30
    claude = B(E, zb + 110, "Anthropic Claude\n(configured model)", "ext", w=500, icons={0: CLAUDE}, fill=WHITE)
    nessie = SV(D_ + 280, zb + 110, CAPONE, "Nessie (wallet)", w=420)
    Z(40, z, 440, zb - z, "venue", "device")
    Z(Bc - 20, z, 500, zb - z, "venue laptop", "rust")
    Z(D_ - 20, z, 500, zb - z, "Vultr Cloud Compute", "rust", VULTR)
    V(bands, gateway, "radio state", x=bands.x + 90)
    V(gateway, bands, "commands", x=bands.right - 90)
    H(gateway, bridge, "USB state", y=bridge.y + 30)
    H(bridge, gateway, "USB commands", y=bridge.bottom - 30)
    H(bridge, stdb, "calls ingest_band", y=bridge.y + 30)
    H(stdb, bridge, "pending commands", y=bridge.bottom - 30)
    H(cams, secview, "streams video")
    H(secview, stdb, "reports sighting", y=secview.cy)
    V(stdb, web, "row changes", x=stdb.x + 160)
    V(web, stdb, "reducer calls", x=stdb.right - 160)
    H(auth, web, "signs in")
    H(stdb, api, "row changes")
    H(stdb, workers, "open jobs", y=workers.y + 30)
    H(workers, stdb, "job results + bundle", y=workers.bottom - 30)
    R(workers, "t", bd, "l",
      [S.P(workers.x + workers.w * .7, 880), S.P(2960, 880), S.P(2960, L(bd.cy))],
      label="search + fetch", seg=2, fa=.7, both=True)
    H(api, ee, "copies, ranks", both=True)
    H(workers, ee, "model + import tasks", y=workers.y + 30)
    H(ee, workers, "task results", y=workers.bottom - 30)
    V(ee, claude, "uses model")
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
    incident = B(2040, r1, "incident", "stdb", w=420)
    resolve = B(2740, r1, "resolve_incident", "stdb", w=420)
    organizer = B(3440, 180, "organizer", "web", w=400, icons={0: USER})
    medic = B(3440, 440, "medic", "web", w=400, icons={0: USER})
    B(640, r2, "timers\nsweep, social_tick, live_tick\ncrowd_tick, job_reaper", "stdb", w=800, h=150)
    views = B(2360, r2, "views\nmy_band, my_wallet, claims_board", "stdb", w=800)
    screens = B(2360, r3, "tap page (/t/code)\norganizer portal (/portal)\nphoto page (/photo)", "web", w=800,
                h=150, icons={0: PHONE, 1: MONITOR, 2: IMAGE})
    auth = SV(640, 0, STDB, "SpacetimeAuth (sign-in)", w=480, cy=L(screens.cy))
    Z(600, 220, 2600, r2 + BH + 40 - 220, "band1t module", "stdb", STDB)
    H(bridge, ingest, "calls")
    H(ingest, watch, "writes band")
    H(watch, incident, "opens incident")
    H(resolve, incident, "closes incident")
    D(organizer, "l", 0.5, resolve, "r", 0.25, "resolves")
    D(medic, "l", 0.5, resolve, "r", 0.75, "resolves")
    ch = S.oy + (r1 + BH + r2) / 2
    R(resolve, "b", bridge, "b", [(resolve.cx, ch), (bridge.cx, ch)], label="pending clear command", seg=1)
    V(views, screens, "pushes rows")
    H(auth, screens, "signs in")
    return S.end_frame()


# ---------------------------------------------------------------- 4. Vision
def vision(y0):
    S.begin_frame("4 · Vision", 0, y0, 1000, 600)
    title("Vision")
    c1, c2, c3, c4, c5 = 60, 780, 1500, 2200, 2860
    r0, z, r1, r2 = 180, 100, 490, 800
    cam = B(c1, r1, "security camera\none per zone", "device", w=440, icons={0: CAMERA})
    view = B(c2, 0, "security view\nOpenCV · NumPy\n4 Hz red flash", "rust", w=440, h=160,
             cy=r1 + BH / 2, icons={0: OPENCV, 1: NUMPY})
    log = B(c2, r0, "radio log\nradio_*.jsonl", "note", w=440, icons={0: RADIO})
    band = B(c3, r1, "matched band", "device", w=420, icons={0: WATCH})
    mod = SV(c4, r1, STDB, "report_camera_sighting", kind="stdb", w=460)
    gateway = B(c1, r0, "gateway\npyserial", "device", w=440, icons={0: RADIO, 1: PYTHON})
    page = B(c2, r2, "security page\nthree.js", "web", w=440, h=150,
             icons={0: MONITOR, 1: THREE, 2: SPARK})
    cy = L(page.cy)
    brush = B(c3, 0, "Brush\n(Gaussian splat)", "ext", w=420, cy=cy, fill=WHITE)
    colmap = B(c4, 0, "COLMAP\n(poses)", "ext", w=360, cy=cy, icons={0: COLMAP}, fill=WHITE)
    walk = B(c5, 0, "phone walk", "web", w=460, cy=cy, icons={0: WALK})
    Z(c2 - 20, z, c3 + 420 + 20 - (c2 - 20), r1 + BH + 70 - z, "venue laptop", "rust", PYTHON)
    Z(c2 - 20, r2 - 70, c5 + 460 + 20 - (c2 - 20), L(page.bottom) + 30 - (r2 - 70), "3D venue", "plain")
    H(gateway, log, "writes beacons")
    V(log, view, "SOS flags")
    H(cam, view, "streams video")
    H(view, band, "matches SOS")
    H(band, mod, "reports sighting")
    V(view, page, "serves page")
    H(walk, colmap, "picks frames")
    H(colmap, brush, "places frames")
    H(brush, page, "exports splat")
    return S.end_frame()


# ---------------------------------------------------------------- 5. Event data pipeline
def pipeline(y0):
    S.begin_frame("06 · Event data", 0, y0, 2980, 2170)
    x0, x1, x2, x3 = 80, 760, 1480, 2300

    organizer = B(x0, 220, "organizer\nconfigured event sources", "web", w=480, h=240,
                  wordmark=USER, mark_h=90)
    queue = SV(x1, 220, STDB, "event_import job", kind="stdb", w=520, h=240)
    importer = B(x2, 220, "server worker\nevent importer", "rust", w=600, h=240,
                 wordmark=RUST, mark_h=90)
    fetched = SV(x3, 220, BRIGHT, "Web MCP\npages + datasets", w=560, h=240)
    organized = SV(x3, 670, ELASTIC, "Workflows + Agent Builder\nES|QL exact joins\norganizes source records", w=560, h=280)
    imported = SV(x2, 670, STDB, "validated event rows\npeople · booths · schedule\none transaction", kind="stdb", w=600, h=280)
    live = B(x1, 670, "live event views", "web", w=520, h=280,
             wordmark=MONITOR, mark_h=90)
    Z(40, 80, 2900, 950, "event import", "rust")

    H(organizer, queue, "start import")
    H(queue, importer, "live job")
    H(importer, fetched, "fetch records", y=importer.y + 65)
    H(fetched, importer, "returns records", y=importer.bottom - 65)
    D(importer, "r", .85, organized, "l", .35, "organize + return", both=True)
    V(importer, imported, "save event bundle", x=importer.x + 180)
    H(imported, live, "live rows")

    requester = B(x0, 1300, "organizer\nevent name", "web", w=480, h=240,
                  wordmark=USER, mark_h=90)
    setup = SV(x1, 1300, STDB, "venue_setup job", kind="stdb", w=520, h=240)
    worker = B(x2, 1300, "server worker\nvenue setup", "rust", w=600, h=240,
               wordmark=RUST, mark_h=90)
    browser = SV(x3, 1300, BRIGHT, "Web MCP · search\nUnlocker API · pages\nBrowser API · 3D model", w=560, h=240)
    select = SV(x3, 1750, ELASTIC, "venue_find + venue_map\nselect known URLs", w=560, h=280)
    result = SV(x2, 1750, STDB, "venue_setup result\nmodel + source links", kind="stdb", w=600, h=280)
    choice = B(x1, 1750, "organizer\nselects ready venue", "web", w=520, h=280,
               wordmark=USER, mark_h=90)
    chosen = SV(x0, 1750, STDB, "chosen_venue\nportal display", kind="stdb", w=480, h=280)
    Z(40, 1160, 2900, 950, "venue model", "rust")

    H(requester, setup, "start setup")
    H(setup, worker, "live job")
    H(worker, browser, "search + capture", y=worker.y + 65)
    H(browser, worker, "returns results", y=worker.bottom - 65)
    D(worker, "r", .85, select, "l", .35, "select + return", both=True)
    V(worker, result, "save venue model", x=worker.x + 180)
    H(result, choice, "ready result")
    H(choice, chosen, "choose venue")
    return S.end_frame()


# ---------------------------------------------------------------- 6. The Evidence Engine
def evidence(y0):
    S.begin_frame("7 · Evidence Engine", 0, y0, 3680, 1800)
    title("Evidence Engine")
    x = [80, 820, 1560, 2300, 3040]
    w = 560
    r1, r2 = 240, 740
    policies = B(x[0], r1, "policy PDFs\nvenue + attendee health", "note", w=w, h=240, icons={0: FILE})
    pages = SV(x[1], r1, ELASTIC, "bandit-documents\nindexed PDF pages", w=w, h=240)
    reader = SV(x[2], r1, ELASTIC, "bandit-read-document\nquotes + page numbers", w=w, h=240)
    checked = B(x[3], r1, "bandit-workers\nchecks each quote", "rust", w=w, h=240, icons={0: RUST})
    clauses = SV(x[4], r1, ELASTIC, "bandit-policy-clauses\nvalidated clauses", w=w, h=240)
    claim = B(x[0], r2, "de-identified claim\ncodes, facts, amounts", "note", w=w, h=260, icons={0: FILE})
    validation = SV(x[1], r2, ELASTIC, "bandit-claims-validate\nbandit-claims\nPainless checks", w=w, h=260)
    search = SV(x[2], r2, ELASTIC, "hybrid search + rerank\nup to 5 clauses\nvenue + injury health plan", w=w, h=260)
    checks = SV(x[3], r2, STDB, "submit_claim_checks\nvalidation + citations", kind="stdb", w=w, h=260)
    decision = B(x[4], r2, "Decision Engine\nevidence + quoted clauses", "rust", w=w, h=260, icons={0: SHIELD})
    Z(40, 170, 3600, 1110, "Policy evidence", "ext")
    H(policies, pages, "indexes pages")
    H(pages, reader, "reads pages")
    H(reader, checked, "returns quotes")
    H(checked, clauses, "indexes clauses")
    H(claim, validation, "validates fields")
    H(validation, search, "queries narrative")
    R(clauses, "b", search, "t",
      [(clauses.cx, S.oy + 590), (search.cx, S.oy + 590)],
      label="filters policies", seg=1)
    H(search, checks, "returns clauses")
    R(validation, "b", checks, "b",
      [(validation.cx, S.oy + 1140), (checks.cx, S.oy + 1140)],
      label="adds validation", seg=1)
    H(checks, decision, "informs decision")
    r3 = 1420
    visits = B(x[0], r3, "visit + booth rows\ntop 5 spots by minutes\nbooths + whole zones", "stdb", w=w, h=240, icons={0: WALK})
    indexer = B(x[1], r3, "bandit-indexer\nfindable attendees", "rust", w=w, h=240, icons={0: RUST})
    people = SV(x[2], r3, ELASTIC, "bandit-people\nbandit-booths\nsemantic_text", w=w, h=240)
    api = B(x[3], r3, "bandit-api\nhybrid search + rerank\neligible IDs only", "rust", w=w, h=240, icons={0: RUST})
    recap = B(x[4], r3, "recap\ndev.band1t.vip/t/code\nranked people + booths", "web", w=w, h=240, icons={0: PHONE})
    Z(40, 1320, 3600, 430, "Interests and discovery", "ext")
    H(visits, indexer, "builds interests")
    H(indexer, people, "indexes text")
    H(people, api, "ranks candidates")
    H(api, recap, "orders suggestions")
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
    S.begin_frame("08 · Decision Engine", 0, y0, 2400, 1620)

    # Scope and one decision path; evidence mechanics are in frame 07,
    # payment operations in frame 13.
    injury = B(36, 120, "attendee injury\nvenue + health plan", "device", w=408, h=240,
               wordmark=HEART, mark_h=96, fill=WHITE)
    property_ = B(36, 450, "venue property\ndamage / theft\nvenue policy", "device", w=408, h=240,
                  wordmark=HAMMER, mark_h=96, fill=WHITE)
    agent = SV(624, 264, ELASTIC, "Agent Builder\n(investigation)\ncompares evidence\nrequests clause search\ncompares + cites", w=444, h=312)
    guard = SV(1224, 264, STDB, "code guards\ncoverage + amounts\napproved rule ceiling\nrefusal needs failed check", kind="stdb", w=444, h=312)
    settlement = B(1818, 264, "settlement\ninjury payout\nproperty booking\nledger entries", "good", w=444, h=312,
                   wordmark=WALLET, mark_h=96)

    D(injury, "r", 0.5, agent, "l", 0.25, "injury evidence")
    D(property_, "r", 0.5, agent, "l", 0.75, "loss evidence")
    H(agent, guard, "recommends")
    H(guard, settlement, "within rule")

    formula = B(36, 774,
                "Policy amounts (code)\n"
                "eligible bill = capped service lines\n"
                "medical basis = eligible bill after plan share\n"
                "property basis = logged repair / replacement\n"
                "payout = min(basis, per-claim, remaining cover)\n"
                "recovery = max(payout − deductible, 0)\n"
                "deductible changes recovery, not payout",
                "rust", w=1032, h=360)
    refused = B(1224, 774, "refused\nreason shown", "bad", w=444, h=312,
                wordmark=SHIELD, mark_h=96)
    review = B(1818, 774, "organizer\ncase-by-case decision\npolicy gap / mismatch:\nnever teaches a rule", "web", w=444, h=312,
               wordmark=USER, mark_h=96, fill=WHITE)
    R(formula, "t", guard, "l", [(formula.cx, S.oy + 726), (S.ox + 1140, S.oy + 726),
                                (S.ox + 1140, guard.y + 234)], label="code amounts", seg=1, fb=0.75)
    V(guard, refused, "checked refusal")
    D(guard, "r", 0.8, review, "l", 0.2, "needs review")
    V(review, settlement, "approves")
    H(review, refused, "refuses")

    # The learning loop is deliberately prominent and separate from coverage.
    # Only simple organizer approvals become reusable payment authority.
    precedents = B(36, 1308, "3 alike approvals\nsimple claims\nsame kind + cover", "note", w=444, h=264,
                   wordmark=FILE, mark_h=96)
    proposal = SV(624, 1308, ELASTIC, "Agent Builder\n(rule proposer)\nES|QL precedents\nhighest payout ceiling", w=444, h=264)
    approval = B(1224, 1308, "organizer\napproves the rule\nchecks its ceiling", "web", w=444, h=264,
                 wordmark=USER, mark_h=96, fill=WHITE)
    rule = SV(1818, 1308, STDB, "approved rule\nfuture matching claims\ninside policy + ceiling", kind="good", w=444, h=264)
    R(review, "b", precedents, "t", [(review.cx, S.oy + 1194), (precedents.cx, S.oy + 1194)],
      label="simple approvals", seg=1)
    H(precedents, proposal, "finds pattern")
    H(proposal, approval, "proposed rule")
    H(approval, rule, "grants authority")
    R(rule, "r", guard, "t", [(S.ox + 2358, rule.cy), (S.ox + 2358, S.oy + 60),
                               (guard.cx, S.oy + 60)], label="future claims", seg=2)
    return S.end_frame()


# ---------------------------------------------------------------- Queues
CLAUDE_JOBS = [  # job kind, result reducer, what Claude does
    ("medical_extract", "apply_medical_extract", "reads medical history"),
    ("clinic_report", "file_clinic_report", "writes hospital report"),
    ("claim_review", "report_claim_step\nsubmit_claim_review", "investigates, decides"),
    ("claim_draft", "attach_claim_letters", "drafts letters"),
    ("recovery_letter", "attach_recovery_letter", "drafts letter"),
    ("merch_picks", "submit_merch_picks", "picks merch"),
    ("photo_features", "submit_photo_features", "counts people"),
]
JOB_KINDS = [  # every job kind in the code, by the outside service its worker calls
    ("Anthropic Claude API", "ext", CLAUDE, "asks", [k for k, _, _ in CLAUDE_JOBS]),
    ("(Evidence Engine)", "ext", ELASTIC, "reads, checks, counts", ["claim_verify", "document_read", "rule_proposal"]),
    ("Web MCP (scraper)", "ext", BRIGHT, "scrapes", ["venue_setup", "plan_lookup", "venue_policy_lookup"]),
    ("Nessie (wallet)", "ext", CAPONE, "pays", ["wallet_open", "merch_purchase", "charge_payment", "claim_payout"]),
]
KIND_W, KIND_H, KIND_STEP = 460, 96, 30  # one job kind box, and the gap between boxes


def queues(y0):
    """One shared work lifecycle; the task catalogue belongs in the design docs."""
    S.begin_frame("Queues", 0, y0, 2240, 600)
    title("Queues")

    producer = SV(60, 280, STDB, "feature reducers", "stdb", w=420, h=220)
    queued = SV(760, 200, STDB, "job · worker_jobs\n60 s lease\ndocuments + photos\nclaims + rules\nletters + merch\nevent + policies\nwallet actions", "stdb", w=600, h=380)
    worker = B(1710, 280, "bandit-workers\nchecks responses", "rust", w=450, h=220,
               wordmark=RUST, mark_h=75)
    H(producer, queued, "queues job")
    H(worker, queued, "claim_job", y=S.oy + 320)
    H(queued, worker, "live job rows", y=S.oy + 420)
    R(worker, "t", queued, "t", [S.P(1935, 100), S.P(1120, 100)],
      "fail_job", seg=1, fb=0.6)

    # The scheduled reducer and a reported failure share the same retry policy.
    timer = SV(60, 720, STDB, "job_reaper\nexpired leases", "stdb", w=420, h=210)
    retry = B(760, 720, "retry delay\n5 s × attempt\nDead after 3 attempts", "stdb", w=600, h=210)
    H(timer, retry, "checks every 10 s")
    V(queued, retry, "failed attempt", x=S.ox + 930)
    V(retry, queued, "requeues", x=S.ox + 1210)

    # A service group shows the worker boundary, with no provider-to-provider call.
    external = Z(1590, 700, 610, 620, "External execution", "ext")
    SV(1630, 780, ELASTIC, "Workflows\nai.prompt · text tasks\nai.agent → Agent Builder\n(decisions + reading)", w=530, h=245)
    SV(1630, 1080, BRIGHT, "Web MCP\nUnlocker API\nBrowser API", w=295, h=190)
    SV(1960, 1080, CAPONE, "Nessie API", w=200, h=190)
    V(worker, external, "calls", x=S.ox + 1810)
    V(external, worker, "returns", x=S.ox + 2070)

    result = SV(760, 1040, STDB, "result reducer\nchecks lease\napplies + completes", "stdb", w=600, h=250)
    views = B(60, 1040, "live views", "web", w=420, h=250,
              wordmark=MONITOR, mark_h=75)
    R(worker, "l", result, "r", [S.P(1490, 456), S.P(1490, 1165)],
      "submits result", seg=1, fa=0.8)
    H(result, views, "streams rows")

    # Review decisions are explicit actions; model output cannot approve them.
    Z(40, 1390, 2160, 290, "Human approval", "plain")
    pending = B(70, 1480, "claims · rules\ncharges", "stdb", w=470, h=150)
    organizer = B(800, 1480, "organizer", "web", w=420, h=150,
                  wordmark=USER, mark_h=64)
    approval = B(1560, 1480, "approve_claim\napprove_rule_proposal\napprove_charge", "stdb", w=600, h=150)
    H(pending, organizer, "shows for review")
    H(organizer, approval, "approves")
    R(result, "b", pending, "t", [S.P(1060, 1350), S.P(305, 1350)],
      "claim + rule review", seg=1)
    return S.end_frame()


def claude_jobs(y0):
    S.begin_frame("09 · Elastic workflows", 0, y0, 1000, 600)
    title("Elastic workflows")

    caller = B(100, 180, "bandit-workers\ntask + answer schema", "rust", w=650, h=260,
               icons={0: RUST})
    provider = SV(1350, 150, ELASTIC, "Workflows + Agent Builder", w=700, h=320)
    model = B(2720, 200, "Claude\n(model)", "ext", w=600, h=220,
              icons={0: CLAUDE}, fill=WHITE)
    H(caller, provider, "starts execution")
    H(provider, model, "calls model", y=model.y + 55)
    H(model, provider, "returns answer", y=model.bottom - 55)

    xs = [80, 960, 1840, 2720]
    top, lower = 770, 1330
    prompt = B(xs[0], top, "ai.prompt\nform fields, merch, letters", "ext", w=680, h=320,
               icons={0: FILE}, fill=WHITE)
    evidence = B(xs[1], top, "ai.agent\npolicy clauses\nrule proposals", "ext", w=680, h=320,
                 icons={0: SEARCH}, fill=WHITE)
    investigator = B(xs[2], top, "ai.agent\nclaim investigation", "ext", w=680, h=320,
                     icons={0: SHIELD}, fill=WHITE)
    reader = B(xs[3], top, "ai.agent\nphoto count + caption\nmedical page text", "ext", w=680, h=320,
               icons={0: IMAGE}, fill=WHITE)

    answer = B(xs[0], lower, "structured answer\nfixed JSON schema", "web", w=680, h=280)
    records = B(xs[1], lower, "document pages\napproved claim history", "ext", w=680, h=280,
                icons={0: FILE})
    scoped = B(xs[2], lower, "claim-scoped tools\nread_evidence · read_checks\nsearch_policy · read_clause", "rust",
               w=680, h=280, icons={0: RUST})
    pixels = B(xs[3], lower, "photo / scanned page\ntemporary attachment", "web", w=680, h=280,
               icons={0: IMAGE})
    checked = B(1250, 1980, "bandit-workers\nvalidates + submits\nexecution, model, usage\nclaim evidence steps", "rust",
                w=1050, h=280, icons={0: RUST})

    for fraction, mode in zip((0.12, 0.37, 0.63, 0.88), (prompt, evidence, investigator, reader)):
        D(provider, "b", fraction, mode, "t", 0.5, "runs")
    V(prompt, answer, "fills schema")
    V(records, evidence, "grounds answer")
    D(investigator, "b", 0.25, scoped, "t", 0.25, "requests read")
    D(scoped, "t", 0.75, investigator, "b", 0.75, "returns evidence")
    V(pixels, reader, "supplies image")

    R(answer, "b", checked, "l", [(answer.cx, checked.cy)], label="checks fields", seg=1)
    R(evidence, "r", checked, "t", [(S.ox + 1730, evidence.y + evidence.h * 0.8),
                                      (S.ox + 1730, S.oy + 1770),
                                      (checked.x + checked.w * 0.15, S.oy + 1770)],
      label="returns citations", seg=2, fa=0.8, fb=0.15)
    R(investigator, "r", checked, "t", [(S.ox + 2620, investigator.y + investigator.h * 0.8),
                                         (S.ox + 2620, S.oy + 1860),
                                         (checked.x + checked.w * 0.75, S.oy + 1860)],
      label="recommends decision", seg=2, fa=0.8, fb=0.75)
    R(reader, "r", checked, "r", [(S.ox + 3530, reader.y + reader.h * 0.8),
                                   (S.ox + 3530, checked.cy)],
      label="returns fields", seg=2, fa=0.8)
    return S.end_frame()


USERS, CLOCK, PIN, STORE, SPARKLES, BUILDING, TIMER, HANDS, SEARCH = (logo(f"icon-{n}.svg") for n in (
    "users", "clock", "map-pin", "store", "sparkles", "building-2", "timer", "handshake", "search-check"))


def card(x, cy, label, kind, icon, w, h, mh=80, **kw):
    """A big card: its picture on top, the name and the rule under it."""
    return B(x, 0, label, kind, w=w, h=h, wordmark=icon, mark_h=mh, cy=cy, **kw)


def logo_row(icons, h, step):
    """Turn the card just drawn's centred picture into a row: extra pictures left and right of it."""
    mark = S.elements[-1]
    for i, icon in icons:
        S.image(mark["x"] + i * step + (mark["width"] - h * aspect(icon)) / 2, mark["y"], icon, h)


def socials_card(x, cy, label, w, h=220):
    box = card(x, cy, label, "stdb", SOCIALS[1], w, h, 60)
    logo_row(((-1, SOCIALS[0]), (1, SOCIALS[2])), 60, 90)
    return box


# ---------------------------------------------------------------- 9. Social: how links between people form
def social(y0):
    S.begin_frame("9 · Social", 0, y0, 1000, 600)
    S.text(40, 28, "Social", fs=64)
    X0, X1, X2, X3, X4, X5 = 60, 760, 1600, 2440, 3320, 4180
    mk = dict(fill=WHITE)

    # 1. sign up: the attendee taps their band and fills in the tap page
    su = [335, 555, 775, 995]
    attendee = card(X0, 665, "attendee", "web", USER, 440, 240, 120, **mk)
    tap = card(X1, 665, "tap page\n(/t/code)", "web", PHONE, 560, 400, 150, **mk)
    claim = card(X2, su[0], "claim_band\npress band button", "stdb", WATCH, 560, 190, 70)
    profile = card(X2, su[1], "update_profile\nname, findable on", "stdb", SHIELD, 560, 190, 70)
    person = card(X2, su[2], "claim_person\ncompany", "stdb", BUILDING, 560, 190, 70)
    handles = socials_card(X2, su[3], "set_social_handle\nInstagram, Facebook, Threads", 560, 190)
    Z(40, 170, X2 + 560 + 20 - 40, 1130 - 170, "sign up", "web")
    H(attendee, tap, "taps band")
    for box, verb in zip((claim, profile, person, handles), ("claims band", "sets name", "picks profile", "adds socials")):
        D(tap, "r", 0.5, box, "l", 0.5, verb)

    # 2. the band hears station markers and other bands
    rz, rc, rp = 1435, 1860, 2230  # zone row, up close row, photo row
    band = card(X0, (1300 + 1985) / 2, "band", "device", WATCH, 440, 640, 200, **mk)
    marker = card(X1, rz, "station marker\nloudest one\nsets zone", "device", RADIO, 560, 280, 90, **mk)
    other = card(X1, rc, "other band\n-62 dBm or louder", "device", WATCH, 560, 250, 90, **mk)
    Z(40, 1170, X1 + 560 + 20 - 40, 2045 - 1170, "venue", "device", indent=40)
    D(band, "r", 0.3, marker, "l", 0.5, "hears")
    D(band, "r", 0.7, other, "l", 0.5, "hears")
    stay = card(X2, rz, "zone_visit\nstay in a zone", "stdb", PIN, 560, 250, 80)
    enc = card(X2, rc, "encounter\nseconds up close", "stdb", TIMER, 560, 250, 80)
    H(marker, stay, "opens stay")
    H(other, enc, "adds seconds")

    # 3. social_tick turns stays and seconds into visits, shared visits and meetings
    visit = card(X3, 1300, "visit\n2 min in a zone", "stdb", WALK, 600, 230, 80)
    shared = card(X3, 1570, "shared_visit\n5 min, same zone\nsame time", "stdb", USERS, 600, 260, 80)
    met = card(X3, rc, "social_encounter\nmet: 3 min up close\nboth findable", "stdb", HANDS, 600, 260, 80)
    tick = Z(X3 - 20, 1115, 640, L(met.bottom) + 40 - 1115, "social_tick (every 1 s)", "stdb", indent=40)
    D(stay, "r", 0.3, visit, "l", 0.5, "stays")
    D(stay, "r", 0.7, shared, "l", 0.5, "overlaps")
    H(enc, met, "minutes")

    # 4. photos: the photographer picks the zone, Elastic counts the people, the bands say who they are
    shooter = card(X0, rp, "photographer", "web", CAMERA, 440, 260, 130, **mk)
    page = card(X1, rp, "photo page (/photo)\nregister_photo\nzone, time", "web", IMAGE, 560, 300, 100, **mk)
    counts = SV(X2, 0, ELASTIC, "counts people\ncaption, no names", w=560, h=300, cy=rp)
    tags = card(X3, rp, "photo_tag\nbands in that zone then\nclaimed bands first\nthen near most others\nup to people count", "stdb",
                IMAGE, 600, 320, 80)
    H(shooter, page, "uploads")
    H(page, counts, "photo")
    H(counts, tags, "people count")
    gx = X2 + 560 + 110  # down the gap between the stays and the rules
    R(stay, "r", tags, "t", [(S.ox + gx, stay.y + stay.h * 0.92), (S.ox + gx, tags.y - 45),
                              (tags.x + 120, tags.y - 45)], label="zone stays", seg=1, fa=0.92, fb=120 / tags.w)
    D(enc, "b", 0.85, tags, "l", 0.2, "near others")

    # 5. the people graph: one link per pair, weighed in minutes
    works = card(X4, su[2], "works_at\nperson to company", "stdb", BUILDING, 600, 190, 70)
    exhibits = card(X4, 1030, "exhibits\nbooth to company", "stdb", STORE, 600, 190, 70)
    visited = card(X4, 1300, "visited\nperson to booth\nweight: minutes", "stdb", WALK, 600, 260, 80)
    metl = card(X4, rc, "met\nperson to person\nweight: minutes together", "stdb", HANDS, 600, 260, 80)
    links = Z(X4 - 20, su[2] - 95 - 70, 640, L(metl.bottom) + 40 - (su[2] - 95 - 70), "people_link", "stdb", STDB,
              indent=40)
    inph = card(X4, rp, "in_photo\nphoto to person\ncounts as 30 min", "web", IMAGE, 600, 300, 80, **mk)
    H(person, works, "company")
    H(visit, visited, "minutes")
    D(visit, "r", 0.2, exhibits, "l", 0.6, "booth company")
    H(met, metl, "minutes")
    H(tags, inph, "tags")

    # The link types above explain the graph; its destination only needs a name.
    graph_y = L((links.y + inph.bottom) / 2)
    graph = B(X5, 0, "Event graph\norganizer portal (/portal)", "web", w=800,
              h=220, cy=graph_y, fill=WHITE)
    memories = B(X5, 0, "Memories\ngroups named by booth", "web", w=800,
                 h=180, cy=L(graph.bottom) + 250, fill=WHITE)
    D(links, "r", 0.5, graph, "l", 0.25, "draws links")
    D(inph, "r", 0.5, graph, "l", 0.8, "draws photos")
    V(graph, memories, "groups links")
    for box, n in ((tap, 1), (band, 2), (tick, 3), (page, 4), (links, 5), (graph, 6)):
        badge(box, n)
    return S.end_frame()


# ---------------------------------------------------------------- 10. Interests: booth time ranks the people you met
def interests(y0):
    S.begin_frame("11 · Interests", 0, y0, 1000, 600)
    x0, x1, x2, x3 = 60, 800, 1600, 2480
    visits = B(x0, 200, "booth / zone minutes\ndescriptions + tags", "stdb",
               w=500, h=240, icons={0: WALK, 1: STORE})
    indexer = B(x1, 200, "bandit-indexer\ntop 5 spots by minutes\nfindable only", "rust",
                w=560, h=240, icons={0: RUST})
    indexed = SV(x2, 200, ELASTIC, "people + booth interests", w=640, h=240)
    social = SV(x0, 650, STDB, "visits + shared places\npeople met or nearby\nphotos + socials",
                kind="stdb", w=500, h=400)
    api = B(x1, 650, "bandit-api\npeople + booths\nmost minutes first", "rust",
            w=560, h=400, icons={0: RUST})
    ranked = SV(x2, 650, ELASTIC,
                "hybrid search + rerank\nclosest interests first\nminutes if no answer",
                w=640, h=400)
    person = B(x3, 510, "suggested person\nphoto + name\ntheir booths + minutes\nshared booths first\nmet at + time\nminutes together\nphotos together",
               "web", w=660, h=590,
               icons={0: USER, 1: SOCIALS[0], 2: SOCIALS[1], 3: SOCIALS[2]})

    ended = B(x0, 1300, "event ends\nattendee leaves", "web", w=500, h=240,
              icons={0: USER})
    recap = B(x1, 1300, "recap\ndev.band1t.vip/t/code\nplaces + minutes\npeople + booths", "web",
              w=560, h=240, icons={0: PHONE})
    photos = B(x2, 1300, "your photos\nshare photo + @handles", "web", w=640, h=240,
               icons={0: IMAGE, 1: SOCIALS[0], 2: SOCIALS[1], 3: SOCIALS[2]})
    merch = B(x3, 1300, "make it merch\nphoto + booth memories", "web", w=660, h=240,
              wordmark=str(LOGOS.parent.parent / "assets" / "merch" / "tee.png"), mark_h=100)

    H(visits, indexer, "visits + booths")
    H(indexer, indexed, "indexes interests")
    V(indexed, ranked, "interest text")
    H(social, api, "recap rows")
    H(api, ranked, "candidates", y=api.y + 100)
    H(ranked, api, "ranked results", y=api.bottom - 100)
    R(api, "b", person, "b",
      [(api.x + api.w * 0.85, S.oy + 1170), (person.cx, S.oy + 1170)],
      label="person details", seg=1, fa=0.85)
    V(api, recap, "shows recap", x=api.x + 150)
    H(ended, recap, "opens")
    H(recap, photos, "your memories")
    H(photos, merch, "personalizes")
    return S.end_frame()


# ---------------------------------------------------------------- 11. Merch and wallet
def merch(y0):
    S.begin_frame("12 · Merch and wallet", 0, y0, 3200, 1600)
    template_image = str(LOGOS.parent.parent / "assets" / "merch" / "tee.png")
    x0, x1, x2, x3 = 60, 820, 1640, 2460
    visits = B(x0, 200, "my_visits\nplaces + minutes", "stdb", w=640, h=220, icons={0: WALK})
    photos = B(x0, 560, "my_photos\nattendee's own photos", "stdb", w=640, h=220, icons={0: IMAGE})
    templates = B(x0, 920, "merch_template\nproduct + price", "stdb", w=640, h=220,
                  wordmark=template_image, mark_h=150)
    ended = B(x1, 80, "attendee leaves\nevent ends", "web", w=640, h=220, icons={0: WALK})
    workflow = SV(x1, 460, ELASTIC, "(shopping workflow)\nmerch_picks", w=640, h=520)
    suggestions = B(x2, 460, "my_merch_suggestions\nup to 3 choices\nown photo + printed line\ntemplate price",
                    "stdb", w=640, h=520, icons={0: STORE})
    attendee = B(x3, 460, "attendee\nchooses item\nsize + shipping address\nduring / after event",
                 "web", w=640, h=520, icons={0: PHONE})
    checkout = B(x3, 1260, "buy_merch_with_shipping", "stdb", w=640, h=260, icons={0: STORE})
    payment = B(x2, 1260, "wallet payment\norder price", "ext", w=640, h=260, icons={0: WALLET})
    paid = B(x1, 1260, "my_merch_orders\npaid order", "good", w=640, h=260, icons={0: FILE})

    V(ended, workflow, "queues picks")
    D(visits, "r", .5, workflow, "l", .2, "visits")
    D(photos, "r", .5, workflow, "l", .5, "captions + tags")
    D(templates, "r", .5, workflow, "l", .8, "catalogue")
    R(visits, "t", suggestions, "t", [(visits.cx, S.oy + 30), (suggestions.cx, S.oy + 30)],
      label="ranks until picks", seg=1)
    H(workflow, suggestions, "submit_merch_picks")
    H(suggestions, attendee, "suggests")
    V(attendee, checkout, "buys with address")
    H(checkout, payment, "pays")
    H(payment, paid, "payment confirmed")
    return S.end_frame()


# ---------------------------------------------------------------- 12. Capital One Nessie wallet
def nessie(y0):
    S.begin_frame("13 · Capital One Nessie", 0, y0, 1000, 600)
    title("Capital One Nessie")
    rows = [
        (350, "connect_wallet", "wallet_open", "Nessie (account)", "record_wallet", "opens account", "initial $200 credit"),
        (770, "buy_merch_with_shipping", "merch_purchase", "Nessie (purchase)", "settle_merch_order", "records purchase", "subtracts price"),
        (1190, "injury approved", "claim_payout", "Nessie (deposit)", "record_claim_payout", "deposits injury payout", "adds injury payout"),
        (1850, "pay_charge", "charge_payment", "Nessie (purchase)", "record_charge_payment", "records venue purchase", "subtracts charge"),
    ]
    drawn = []
    for y, trigger, job, operation, reducer, request, entry in rows:
        action = B(60, y, trigger, "good" if job == "claim_payout" else "stdb", w=560, h=180,
                   **({"icons": {0: HEART}} if job == "claim_payout" else {}))
        worker = B(980, y, job, "rust", w=420, h=180)
        api = SV(1760, y, CAPONE, operation, w=420, h=180)
        callback = B(2520, y, reducer, "stdb", w=600, h=180)
        drawn.append((action, worker, api, callback, request, entry))
    approval = B(60, 1590, "approve_charge", "stdb", w=560, h=180)
    V(approval, drawn[-1][0], "organizer approves")
    top, bottom = drawn[0][0].y, drawn[-1][0].bottom
    wallet = B(3460, L(top), "my_wallet\nwallet_entry", "stdb", w=420, h=bottom - top, icons={0: WALLET})
    zb = L(bottom) + 320
    Z(20, 220, 640, zb - 220, "triggers", "plain")
    Z(940, 220, 500, zb - 220, "bandit-workers", "rust")
    Z(1720, 220, 500, zb - 220, "Capital One Nessie API", "ext")
    Z(2480, 220, 1440, zb - 220, "band1t module", "stdb", STDB)
    for action, worker, api, callback, request, entry in drawn:
        H(action, worker, "attendee pays" if worker == drawn[-1][1] else "queues")
        D(worker, "r", 0.25, api, "l", 0.25, request)
        D(api, "l", 0.75, worker, "r", 0.75, "returns IDs")
        channel = worker.bottom + 100
        middle = (worker.cx + callback.cx) / 2
        R(worker, "b", callback, "b", [(worker.cx, channel), (middle - 160, channel),
            (middle + 160, channel), (callback.cx, channel)], label="calls reducer", seg=2)
        H(callback, wallet, entry, y=callback.cy)
    return S.end_frame()


# ---------------------------------------------------------------- 13. Vultr server
def vultr(y0):
    S.begin_frame("14 · Vultr", 0, y0, 1000, 600)
    title("Vultr")
    c1, c2, c3, c4 = 60, 840, 1740, 2580
    r1, r2, r3 = 400, 760, 1120
    api = B(c3, r1, "bandit-api", "rust", w=420, icons={0: RUST})
    workers = B(c3, r2, "bandit-workers", "rust", w=420, h=320, icons={0: RUST})
    indexer = B(c3, r3 + 60, "bandit-indexer", "rust", w=420, icons={0: RUST})
    caddy = B(c2, r1, "Caddy\n(HTTPS, files)", "ext", w=600, h=180, icons={0: CADDY}, fill=WHITE)
    desk = B(c2, r2, "desk (/organizer, /cc/)\nportal (/portal)\nband1t.vip", "web", w=600, h=220,
             icons={0: MONITOR})
    pages = B(c2, r3, "plain pages, assets\n/photo, /js\ndev.band1t.vip pages", "web", w=600, h=220,
              icons={0: MONITOR})
    users = B(c1, r1, "attendee, staff\nband1t.vip\ndev.band1t.vip", "web", w=500, h=180,
              icons={0: USER})
    deploy = B(c1, r3, "scripts/deploy-vm\ndeploy/setup.sh\nBun (build)", "note", w=500, h=220,
               icons={2: BUN})
    stdb = SV(c4, r1, STDB, "Maincloud (band1t module)", kind="stdb", w=560)
    workflows = SV(c4, r2, ELASTIC, "(Workflows)", w=560)
    nessie = SV(c4, r2 + 200, CAPONE, "Nessie (wallet)", w=560)
    elastic = SV(c4, L(indexer.y), ELASTIC, "(Evidence Engine)", w=560)
    inner_b = max(L(indexer.bottom), L(pages.bottom)) + 40
    Z(800, 200, 1440, inner_b + 40 - 200, "Vultr Cloud Compute", "plain", VULTR)
    Z(1700, 320, 500, inner_b - 320, "systemd (bandit@.service)", "rust")
    H(users, caddy, "visits")
    H(caddy, api, "other paths")
    V(caddy, desk, "serves")
    D(api, "l", 0.8, pages, "r", 0.2, "serves")
    H(deploy, pages, "builds")
    D(deploy, "r", 0.2, desk, "l", 0.8, "builds")
    ym = S.oy + 660
    R(deploy, "t", caddy, "l", [(deploy.cx, ym), (caddy.x - 100, ym), (caddy.x - 100, caddy.cy)],
      label="installs", seg=1, fb=0.8, dashed=True)
    H(api, stdb, "subscribes")
    H(workers, workflows, "runs workflows", y=workflows.cy)
    H(workers, nessie, "pays", y=nessie.cy)
    H(indexer, elastic, "copies rows")
    return S.end_frame()


# ---------------------------------------------------------------- 14. Hardware basics
def hardware(y0):
    S.begin_frame("14 · Hardware basics", 0, y0, 1000, 600)
    title("Hardware")
    phone = B(80, 200, "phone", "web", w=480, icons={0: NFC})
    lite = SV(80, 510, SEEED, "lite band x6\nXIAO ESP32-C3", kind="device", h=150, w=480, fill=None)
    full = B(80, 720, "full band x3\n+ IMU, vibration", "device", w=480, icons={0: WATCH})
    bands = Z(60, 440, 520, 440, "9 bands, one firmware", "device")
    cam = B(920, 200, "security camera\none per zone", "device", w=480, icons={0: CAMERA})
    marker = B(920, 0, "station marker x2 to 5\nESP32-C3 SuperMini", "device", w=520, cy=L(lite.cy),
               icons={1: ESP})
    gateway = B(920, 0, "gateway\nESP32-C3 SuperMini", "device", h=150, w=480,
                icons={0: ESP}, cy=L(full.cy))
    laptop = B(1680, 0, "venue laptop\nband1t-bridge, security view", "device", w=560, cy=L(full.cy),
               icons={0: LAPTOP})
    Z(900, L(marker.y) - 70, 560, BH + 90, "at each exit", "device")
    V(phone, bands, "taps NFC", x=phone.right - 80)
    H(marker, bands, "loudest sets zone", y=marker.y + 32)
    H(marker, bands, "sets exit color", y=marker.y + 88)
    H(bands, gateway, "talks ESP-NOW", y=gateway.cy, both=True)
    H(gateway, laptop, "serial reports", y=gateway.cy - 32)
    H(laptop, gateway, "serial commands", y=gateway.cy + 32)
    D(bands, "r", 0.12, cam, "l", 0.85, "flashes on alarm")
    R(cam, "r", laptop, "t", [(laptop.cx, cam.cy)], label="streams video", seg=1)
    return S.end_frame()


def stack(path, y0, first):
    """Add the frames another generator drew (its .excalidraw file) under the board, numbered on from first."""
    scene = json.loads(pathlib.Path(path).read_text())
    els = scene["elements"]
    top = min(e["y"] for e in els)
    ids = {e["id"]: "m" + e["id"] for e in els}  # a prefix keeps its ids apart from this board's
    frames = sorted((e for e in els if e["type"] == "frame"), key=lambda e: e["y"])
    names = {f["id"]: f"{first + i} · {f['name']}" for i, f in enumerate(frames)}
    for e in els:
        e = json.loads(json.dumps(e))
        e["y"] += y0 - top
        e["name"] = names.get(e["id"], e.get("name"))
        e["id"] = ids[e["id"]]
        e["groupIds"] = ["m" + group for group in e.get("groupIds", [])]
        for k in ("frameId", "containerId"):
            if e.get(k):
                e[k] = ids[e[k]]
        for k in ("startBinding", "endBinding"):
            if e.get(k):
                e[k]["elementId"] = ids[e[k]["elementId"]]
        e["boundElements"] = [dict(b, id=ids[b["id"]]) for b in e.get("boundElements") or []]
        if e["name"] is None:
            del e["name"]
        S.elements.append(e)
    S.files.update(scene.get("files", {}))
    return max(e["y"] + e["height"] for e in frames) - min(e["y"] for e in frames)


def band_wiring(y0):
    S.begin_frame("20 · Band wiring", 0, y0, 3540, 1850)
    left, middle, right = 80, 1360, 2800
    rows = (220, 520, 820, 1120)
    board = B(middle, rows[0],
              "XIAO ESP32-C3\nsame board + firmware\nUSB-C charging + serial\nLiPo charger · 380 mA\n3V3 regulator\nESP-NOW · 8 dBm",
              "device", w=760, h=1120, icons={0: ESP}, wordmark=SEEED, mark_h=70)

    ring = B(left, rows[0], "12-LED ring\nWS2812B\nbrightness 64 / 255", "device", w=600, h=220)
    button = B(left, rows[1], "SOS button\nunder ring centre\npull-up · wakes deep sleep", "device", w=600, h=220)
    imu = B(left, rows[2], "MPU-6050 (GY-521)\noptional · full bands\nI2C 0x68 · ±8 g\n100 reads/s",
            "device", w=600, h=220, dashed=True)
    motor = B(left, rows[3], "coin vibration motor\noptional · full bands\n2N2222 transistor\nPWM 20 kHz · 70%",
              "device", w=600, h=220, dashed=True)

    battery = B(right, rows[0], "500 mAh LiPo\nprotected cell\nring + motor supply", "device", w=660, h=220)
    antenna = B(right, rows[1], "FPC antenna\noutside case · on lid", "device", w=660, h=220, icons={0: RADIO})
    divider = B(right, rows[2], "battery divider\n2 × 200 kΩ\nnot fitted", "device", w=660, h=220, dashed=True)
    B(right, rows[3], "NTAG215 NFC sticker\nno wires\nopens band1t.vip/t/BANDIT-0N",
      "device", w=660, h=220, icons={0: NFC})

    H(board, ring, "D1 · GPIO3 → 330 Ω → DIN\nbattery rail", y=ring.cy)
    H(button, board, "D2 · GPIO4 → button → GND", y=button.cy)
    H(board, imu, "D4 · GPIO6 SDA\nD5 · GPIO7 SCL\n3V3 + GND", y=imu.cy, both=True, dashed=True)
    H(board, motor, "D6 · GPIO21 → 1 kΩ → base", y=motor.cy, dashed=True)
    H(battery, board, "BAT+ / BAT− pads", y=battery.cy)
    H(board, antenna, "U.FL", y=antenna.cy, both=True)
    H(divider, board, "D0 · GPIO2 (A0)\nbattery % when fitted", y=divider.cy, dashed=True)

    B(80, 1530, "D8 + D9: never wired\nstrapping pins\nD9 = BOOT", "bad", w=740, h=240)
    B(960, 1530, "Ring + motor: battery rail\n5V live only on USB", "note", w=740, h=240)
    B(1840, 1530, "No power switch\none click: deep sleep\none click: wake\nunlit ring ≈ 12 mA", "note", w=740, h=240)
    B(2720, 1530, "Printed pill case · 64 × 42 mm\nring in head · battery below\nbutton hole · 6.5 mm", "device", w=740, h=240)
    return S.end_frame()


def exit_markers_gateway(y0):
    S.begin_frame("21 · Exit markers and gateway", 0, y0, 1000, 600)
    title("Exit markers and gateway")

    power = B(100, 630, "power bank\nUSB 5 V", "device", w=350, h=140)
    station = B(650, 520, "ESP32-C3 SuperMini\nstation 101–105\none per exit", "device",
                w=500, h=360, icons={0: ESP})
    diode = B(1300, 250, "1N4001 diode\nstripe toward ring", "device", w=500, h=180)
    resistor = B(1300, 630, "330 Ω", "device", w=350, h=140)
    ring = B(1900, 520, "12-LED ring\nexit color\nbrightness 120", "device", w=500, h=360)
    modes = B(100, 1260, "gateway modes\nbreathe · chase · strobe · off\n101 blue · 102 magenta\nsaved exit color",
              "device", w=1200, h=200)
    beacon = B(1800, 1220, "beacon\nid + exit color\n5 Hz · 21 dBm", "device",
               w=600, h=260, icons={0: RADIO})
    Z(40, 180, 2420, 1380, "exit markers", "device")

    gateway = B(2700, 520, "ESP32-C3 SuperMini\ngateway 200\nUSB power", "device",
                w=550, h=360, icons={0: ESP})
    laptop = B(3900, 520, "venue laptop\nrecorder\nband1t-bridge", "rust",
               w=700, h=360, icons={0: LAPTOP})
    radio = B(2700, 1210, "hears every packet\ncommands ×3\n40 ms apart", "device",
              w=550, h=300, icons={0: RADIO})
    module = SV(3900, 1250, STDB, "Maincloud (band1t module)", kind="stdb", w=700, h=260)
    Z(2560, 180, 2200, 1380, "gateway", "device")

    H(power, station, "USB-C")
    R(station, "t", diode, "l", [(station.cx, diode.cy)], label="5V pin", seg=1)
    R(diode, "r", ring, "t", [(ring.cx, diode.cy)], label="ring 5V")
    H(station, resistor, "GPIO10")
    H(resistor, ring, "DIN")
    R(station, "b", ring, "b",
      [(station.x + station.w * 0.8, S.oy + 1030), (ring.cx, S.oy + 1030)],
      label="G → GND", seg=1, fa=0.8)
    R(station, "b", beacon, "t",
      [(station.x + station.w * 0.15, S.oy + 1130), (beacon.cx, S.oy + 1130)],
      label="broadcasts", seg=1, fa=0.15)

    H(gateway, laptop, "USB serial\nJSON per packet", y=gateway.y + 110)
    H(laptop, gateway, "cmd <target> <name> [args]", y=gateway.y + 270)
    V(gateway, radio, "ESP-NOW", both=True)
    V(laptop, module, "ingest_band, ingest_heard,\ningest_station, command_sent")
    return S.end_frame()


def band_firmware(y0):
    S.begin_frame("22 · Band firmware", 0, y0, 3800, 1900)

    def card(x, y, label, art, w=820, h=330, kind="device"):
        return B(x, y, label, kind, w=w, h=h, fill=WHITE,
                 wordmark=art, mark_h=160)

    left, middle, right = 80, 1420, 2900
    rows = (140, 580, 1020, 1460)
    peers = card(left, rows[0], "nearby bands\nstates + heard lists", RADIO)
    stations = card(left, rows[1], "station markers\nid + color + signal", RADIO)
    button = card(left, rows[2], "SOS button\nhold 3 s", WATCH)
    fall = card(left, rows[3], "fall sensor\nfree fall → impact\n→ stillness", HEART)

    band = card(middle, 580,
                "band firmware\nESP32-C3\nnon-blocking main loop\nown SOS / fall first\nno internet needed",
                WATCH, w=960, h=770)

    helpers = card(right, rows[0],
                   "3 nearest helpers\ncopy caller's SOS color\nfrom caller's heard list", WATCH)
    alarm = card(right, rows[1],
                 "12-LED ring\nmanual SOS: orange\nfall: red\nmotor on full bands", WATCH)
    exits = card(right, rows[2],
                 "nearest station color\n2 dB switching margin\nidle / crowd / low visibility", RADIO)
    gateway = card(right, rows[3], "gateway\nband state + heard lists", RADIO)

    for source, fraction, label in (
        (peers, 0.10, "hears peers"),
        (stations, 0.35, "hears stations"),
        (button, 0.65, "raises SOS"),
        (fall, 0.90, "detects fall"),
    ):
        D(source, "r", 0.5, band, "l", fraction, label)
    for target, fraction, label in (
        (helpers, 0.10, "selects helpers"),
        (alarm, 0.35, "drives alarm"),
        (exits, 0.65, "guides to exit"),
        (gateway, 0.90, "broadcasts reports"),
    ):
        D(band, "r", fraction, target, "l", 0.5, label)
    return S.end_frame()



def views(y0):
    """Compact audience map; the separate inventory accounts for all 75 views."""
    S.begin_frame("23 · Live views", 0, y0, 3440, 2230)

    module = SV(60, 800, STDB, "band1t module\nprivate tables\npublic venue state", kind="stdb", w=660, h=440)
    bus_x = 1040
    bus_top, bus_bottom = 250, 1990
    S.base("line", S.ox + bus_x, S.oy + bus_top, 0, bus_bottom - bus_top,
           points=[[0, 0], [0, bus_bottom - bus_top]],
           strokeColor="#364fc7", strokeWidth=2, roughness=0,
           lastCommittedPoint=None, startBinding=None, endBinding=None,
           startArrowhead=None, endArrowhead=None)
    S.arrow(module, None, [module.side("r"), S.P(bus_x, L(module.cy))],
            label="committed rows", fs=AFS)

    def audience(y, names, filter_label, person, purpose, art, kind="web", public=False):
        row = B(1390, y, names, "stdb" if not public else "web", w=900, h=220)
        client = B(2750, y, person + "\n" + purpose, kind, w=600, h=220,
                   icons={0: art})
        S.arrow(None, row, [S.P(bus_x, y + 110), row.side("l")],
                label=filter_label, fs=AFS,
                color="#495057" if public else "#364fc7", dashed=public)
        H(row, client, "live rows" if not public else "row changes")
        return row, client

    audience(140, "my_band\nmy_medical_card\nmy_wallet",
             "identity match", "attendee", "band + health + balance", PHONE)
    audience(430, "medic_medical_cards",
             "granted reader", "medic", "tapped medical cards", HEART)
    audience(720, "claims_board (ops / medic)\nclaim_clauses(claim_id) (ops)\nowner access",
             "role checks", "organizer", "board + claim detail", MONITOR)
    audience(1010, "social_attendees\nsocial_visits",
             "service roles", "API + indexer", "profiles + visits", RUST, "rust")
    audience(1300, "worker_jobs",
             "worker / owner", "workers", "queued + leased jobs", RUST, "rust")
    audience(1590, "event_graph\nclaimed_people",
             "anonymous", "venue + tap pages", "graph + profiles", GRAPH3D, public=True)
    audience(1880, "public tables\ncommand: pending = true\nband · zone · venue",
             "client query", "bridge + venue screens", "commands + floor", RADIO,
             public=True)
    return S.end_frame()


FRAMES = (overview, architecture, spacetimedb, queues, vision, pipeline, evidence, insurance, claude_jobs, social, interests, merch,
          nessie, vultr, hardware)
MEDIC = LOGOS.parent / "medic-routing" / "medic-routing.excalidraw"  # medic routing, walk, light circle, exits
only = sys.argv[2:]  # frame function names, for a board of just those frames
y = n = 0
for draw in FRAMES:
    if not only or draw.__name__ in only:
        y += draw(y) + GAP
        n += 1
        frame = next(e for e in reversed(S.elements) if e["type"] == "frame")
        frame["name"] = f"{n} · {frame['name'].split(' · ')[-1]}"  # numbered in board order
if not only or "medic" in only:
    y += stack(MEDIC, y, n + 1) + GAP
for draw in (band_wiring, exit_markers_gateway, band_firmware, views):
    if not only or draw.__name__ in only:
        y += draw(y) + GAP
S.dump(sys.argv[1] if len(sys.argv) > 1 else "bandit-system-design.excalidraw")
print(len(S.elements), "elements")
