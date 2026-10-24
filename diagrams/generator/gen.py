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
PYTHON, OPENCV, NUMPY, THREE, SPARK, COLMAP = (logo(n + ".svg") for n in (
    "python", "opencv", "numpy", "threedotjs", "spark", "colmap"))
USER, PHONE, MONITOR, CAMERA, LAPTOP, FILE, RADIO, WATCH, WALLET, IMAGE, WALK = (logo(f"icon-{n}.svg") for n in (
    "user", "smartphone", "monitor", "camera", "laptop", "file-text", "radio", "watch", "wallet", "image",
    "footprints"))


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
        ("rank recap (bandit-indexer)",
         [lambda x, y: SV(x, y, ELASTIC, "bandit-people\nbandit-booths", w=480, h=160),
          lambda x, y: B(x, y, "bandit-api\nGET /api/recap", "rust", w=480, h=160, icons={0: RUST}),
          lambda x, y: B(x, y, "recap (/t/code)", "web", w=480, h=160, icons={0: PHONE})], ["ranks", "orders lists"]),
    ]
    for i, (name, makers, labels) in enumerate(lanes):
        top = 170 + i * 270
        Z(40, top, 2040, 250, name, "ext")
        boxes = [mk(80 + j * 740, top + 64) for j, mk in enumerate(makers)]
        for a, b, lbl in zip(boxes, boxes[1:], labels):
            H(a, b, lbl)
    return S.end_frame()


# ---------------------------------------------------------------- 7. The Decision Engine
def insurance(y0):
    S.begin_frame("7 · The Decision Engine", 0, y0, 1000, 600)
    title("Decision Engine")
    c = [60, 780, 1460, 2240, 2900]
    r1, r2, r3 = 240, 520, 800
    attendee = B(c[0], r1, "attendee", "web", w=460, icons={0: USER})
    tap = B(c[0], r2, "tap page (/t/code)", "web", w=460, icons={0: PHONE})
    incident = B(c[1], r1, "incident\nlight circle\ncamera sighting", "stdb", w=420, h=150)
    file_ = B(c[1], r2, "file_claim", "stdb", w=420)
    report = B(c[1], r3, "hospital report\nPDF, itemized bill", "note", w=420, icons={0: FILE})
    pack = B(c[2], r1, "evidence pack\nprice, date, cover", "stdb", w=520, h=r2 + BH - r1)
    extract = B(c[2], r3, "Anthropic Claude API\n(claim_record_extract)", "ext", w=520, icons={0: CLAUDE},
                fill=WHITE)
    refused = B(c[3], r1, "refused\nchecks listed", "bad", w=400)
    review = B(c[3], r2, "Claude\n(claim_review)", "ext", w=400, icons={0: CLAUDE}, fill=WHITE)
    payout = SV(c[4], r1, CAPONE, "Nessie (payout)", w=480)
    rule = B(c[4], 0, "rule match", "stdb", w=480, h=220, shape="diamond", cy=r2 + BH / 2)
    org = B(c[4], r3, "organizer portal\n(/organizer, Claims)", "web", w=480, icons={0: MONITOR})
    V(attendee, tap, "opens")
    H(tap, file_, "files claim")
    H(file_, pack, "opens claim", y=file_.cy)
    H(incident, pack, "adds facts", y=incident.cy)
    V(file_, report, "requests report")
    H(report, extract)
    V(extract, pack, "adds lines")
    H(pack, refused, "fails", y=refused.cy)
    H(pack, review, "passes", y=review.cy)
    H(review, rule, "confirms story", y=rule.cy)
    V(rule, payout, "settles", x=rule.cx)
    V(rule, org, "escalates", x=rule.cx)
    lx = rule.cx + 170  # the learning loop meets the diamond's lower right edge
    edge = rule.cy + rule.h / 2 * (1 - 170 / (rule.w / 2)) + 5
    S.arrow(org, rule, [(lx, org.y), (lx, edge)], label="learns rule", dashed=True, color="#2b8a3e", fs=AFS)
    R(org, "r", payout, "r", [(org.right + 90, org.cy), (org.right + 90, payout.cy)], label="approves", seg=1)
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
    c1, c2, c3, c4 = 60, 820, 1540, 2240
    r1, r2, r3 = 260, 480, 700
    attendee = B(c1, r1, "attendee\ntap page (/t/code)", "web", w=520, icons={0: USER, 1: PHONE})
    auth = SV(c1, r2, STDB, "SpacetimeAuth (sign-in)", w=520)
    setup = B(c1, r3, "claim_band\nconfirm_medical_card\nconnect_wallet", "stdb", w=520, h=150)
    photo = B(c2, r1, "photo page (/photo)\nregister_photo", "web", w=480, icons={0: IMAGE})
    tick = B(c2, r2, "social_tick\nvisit, social_encounter", "stdb", w=480)
    graph = B(c2, r3, "people graph", "stdb", w=480)
    org = B(c3, r1, "organizer portal\n(/organizer)", "web", w=440, icons={0: MONITOR})
    recap = B(c3, r2, "recap (/t/code)", "web", w=440, h=r3 + 150 - r2, icons={0: PHONE})
    ee = SV(c4, 0, ELASTIC, "(Evidence Engine)", w=440, cy=L(recap.cy))
    zt, zb = 190, r3 + 150 + 40
    Z(40, zt, 560, zb - zt, "at door", "web")
    Z(c2 - 20, zt, 520, zb - zt, "during event", "stdb")
    Z(c3 - 20, zt, c4 + 440 + 20 - (c3 - 20), zb - zt, "after event", "plain")
    V(attendee, auth, "signs in")
    V(auth, setup, "sets up")
    D(setup, "r", 0.3, tick, "l", 0.7, "wears band")
    V(tick, graph, "writes links")
    V(tick, photo, "tags people")
    H(graph, recap, "lists people", y=graph.cy)
    D(photo, "r", 0.7, recap, "l", 0.1, "adds photos")
    V(org, recap, "ends event")
    H(ee, recap, "ranks lists", y=ee.cy)
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


y = 0
for draw in (overview, architecture, spacetimedb, vision, pipeline, evidence, insurance, claude_jobs, social, merch,
             nessie, vultr, hardware):
    y += draw(y) + GAP
S.dump(sys.argv[1] if len(sys.argv) > 1 else "bandit-system-design.excalidraw")
print(len(S.elements), "elements")
