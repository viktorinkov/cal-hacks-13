"""Band1t system design in Excalidraw: API integrations, feature journeys and engineering details on one board. Labels follow LABELS.md."""
import json
import pathlib
import sys

from lib import GLYPH, ICON, Box, Scene, aspect, wrap

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





USERS, CLOCK, PIN, STORE, SPARKLES, BUILDING, TIMER, HANDS, SEARCH = (logo(f"icon-{n}.svg") for n in (
    "users", "clock", "map-pin", "store", "sparkles", "building", "timer", "hand", "search"))
HERE = LOGOS.parent / "medic-routing"


def picture(x, y, path, w):
    """A standalone floor drawing with a thin border."""
    h = w / aspect(path)
    el = S.image(S.ox + x, S.oy + y, path, h)
    S.base("rectangle", S.ox + x, S.oy + y, w, h, strokeColor="#868e96", strokeWidth=2, roughness=0)
    return Box(el)



def card(x, y, label, icon, kind="web", w=520, h=240):
    return B(x, y, label, kind, w=w, h=h, wordmark=icon, mark_h=120, fill=WHITE)



def architecture(y0):
    S.begin_frame("Architecture", 0, y0, 4260, 1880)
    bands = B(60, 730, "radio devices", "device", w=500, h=260, icons={0: WATCH, 1: RADIO})
    cameras = B(60, 1260, "security cameras", "device", w=500, h=260, wordmark=CAMERA, mark_h=110)
    bridge = B(800, 730, "radio bridge", "rust", w=540, h=260, icons={0: RADIO, 1: RUST})
    vision = B(800, 1260, "security view", "rust", w=540, h=260, wordmark=OPENCV, mark_h=110)
    browser = B(1610, 160, "web clients", "web", w=680, h=260, icons={0: PHONE, 1: MONITOR})
    module = SV(1610, 730, STDB, "Maincloud module", kind="stdb", w=680, h=790)
    caddy = B(2610, 160, "Caddy", "ext", w=600, h=260, wordmark=CADDY, mark_h=100)
    api = B(2610, 730, "bandit-api", "rust", w=600, h=260, wordmark=RUST, mark_h=100)
    workers = B(2610, 1130, "bandit-workers", "rust", w=600, h=260, wordmark=RUST, mark_h=100)
    indexer = B(2610, 1530, "bandit-indexer", "rust", w=600, h=260, wordmark=RUST, mark_h=100)
    bright = SV(3580, 160, BRIGHT, "source acquisition", w=600, h=260)
    elastic = SV(3580, 730, ELASTIC, "search + model tasks", w=600, h=660)
    wallet = SV(3580, 1530, CAPONE, "Nessie wallet", w=600, h=260)
    Z(20, 590, 580, 1030, "venue", "device")
    Z(760, 590, 620, 1030, "venue laptop", "rust", LAPTOP)
    Z(2570, 50, 680, 1780, "Vultr Cloud Compute", "plain", VULTR)
    H(bands, bridge, "radio → USB", y=bands.y + 80)
    H(bridge, bands, "band commands", y=bands.bottom - 70)
    H(cameras, vision, "video")
    H(bridge, module, "band reports", y=bridge.y + 70)
    H(module, bridge, "pending commands", y=bridge.bottom - 70)
    H(vision, module, "camera sightings")
    V(browser, module, "reducer calls", x=browser.x + 160)
    V(module, browser, "live rows", x=browser.right - 160)
    H(browser, caddy, "HTTPS", both=True)
    V(caddy, api, "API requests")
    H(module, api, "event rows")
    H(module, workers, "jobs", y=workers.y + 70)
    H(workers, module, "checked results", y=workers.bottom - 70)
    D(module, "b", .7, indexer, "l", .5, "event rows")
    H(api, elastic, "search + rerank", both=True, y=api.cy)
    H(workers, elastic, "tasks + evidence", both=True, y=workers.cy)
    D(indexer, "r", .5, elastic, "b", .5, "indexes rows")
    R(workers, "r", bright, "l", [(S.ox + 3400, workers.y + 45), (S.ox + 3400, bright.cy)],
      label="fetch sources", seg=1, fa=.17, both=True)
    R(workers, "r", wallet, "r", [(S.ox + 3420, workers.y + workers.h*.85),
      (S.ox + 3420, S.oy + 1440), (S.ox + 3620, S.oy + 1440),
      (S.ox + 4220, S.oy + 1440), (S.ox + 4220, wallet.cy)],
      label="wallet operations", seg=2, fa=.85, both=True)
    return S.end_frame()


def spacetimedb(y0):
    S.begin_frame("SpacetimeDB", 0, y0, 3670, 1940)
    call = B(60, 170, "SDK reducer call", "web", w=720, h=300, wordmark=TS, mark_h=100)
    reducer = B(990, 170, "Rust reducer", "rust", w=720, h=300, wordmark=RUST, mark_h=100)
    commit = SV(1920, 170, STDB, "atomic commit", kind="stdb", w=720, h=300)
    query = B(2850, 170, "SQL subscription", "web", w=720, h=300, wordmark=MONITOR, mark_h=100)
    for card in (call, reducer, commit, query):
        card.el.setdefault("customData", {}).update(diagramArtworkHeight=260, diagramArtworkMaxWidth=800)
    H(call, reducer, "invokes")
    H(reducer, commit, "writes together")
    H(query, commit, "selects rows")
    audiences = [
      (60, 660, "attendee", "my_band", "identity filter", PHONE, "web"),
      (990, 660, "medic", "medic_medical_cards", "granted reader", HEART, "web"),
      (1920, 660, "staff desk", "claims_board", "staff role", MONITOR, "web"),
      (2850, 660, "API + indexer", "social_visits", "service role", RUST, "rust"),
      (60, 1260, "workers", "worker_jobs", "worker role", RUST, "rust"),
      (990, 1260, "shared graph", "event_graph", "public projection", GRAPH3D, "web"),
      (1920, 1260, "radio bridge", "pending command rows", "client query", RADIO, "rust"),
      (2850, 1260, "public venue tables", "floor rows", "client-selected rows", GRAPH3D, "web"),
    ]
    feeds = Z(20, 570, 3590, 1310, "subscription results", "stdb")
    for x, y, who, view_name, scope, art, kind in audiences:
        first = len(S.elements)
        parent = Z(x, y, 720, 520, who, kind, art)
        parent.el.update(backgroundColor="#e9edf2" if kind == "rust" else "#d0ebff", strokeColor="#b5bfca")
        parent.el.setdefault("customData", {}).update(diagramComponent=True, diagramCenteredHeader=True,
                                                     diagramHeaderArtworkHeight=260)
        for element in S.elements[first:]:
            if element["type"] == "text":
                element["strokeColor"] = "#1e1e1e"
        for dy, label in ((220, view_name), (360, scope)):
            cell = B(x + 40, y + dy, label, "stdb", w=640, h=100)
            cell.el.update(backgroundColor="#f5f7ff", strokeColor="#c0cbe4", strokeWidth=1)
            cell.el.setdefault("customData", {})["diagramParentComponent"] = parent.id
    S.link(commit, "b", feeds, "t", fa=.5, fb=(commit.cx-feeds.x)/feeds.w,
           label="pushes committed changes", fs=AFS)
    return S.end_frame()


def jobs(y0):
    S.begin_frame("Jobs", 0, y0, 3050, 1540)
    action = B(60, 180, "feature action", "web", w=560, h=260, wordmark=USER, mark_h=100)
    queue = SV(840, 180, STDB, "queued job", kind="stdb", w=560, h=260)
    worker = B(1620, 180, "server worker", "rust", w=560, h=260, wordmark=RUST, mark_h=100)
    lease = B(2400, 180, "live lease", "stdb", w=560, h=260, wordmark=CLOCK, mark_h=100)
    services = B(2400, 760, "external API call", "ext", w=560, h=280, icons={0: ELASTIC, 1: BRIGHT, 2: CAPONE})
    check = B(1620, 760, "validate response", "rust", w=560, h=280, wordmark=SHIELD, mark_h=100)
    result = SV(840, 760, STDB, "result reducer", kind="stdb", w=560, h=280)
    clients = B(60, 760, "updated feature view", "web", w=560, h=280, wordmark=MONITOR, mark_h=100)
    retry = B(2400, 1270, "retry policy", "note", w=560, h=200, wordmark=CLOCK, mark_h=80)
    H(action, queue, "queues work")
    H(queue, worker, "live job row")
    H(worker, lease, "claims job")
    V(lease, services, "must be current", x=lease.right - 110)
    D(worker, "r", .8, services, "l", .3, "calls API")
    H(services, check, "returns data")
    H(check, result, "submits result")
    H(result, clients, "pushes rows")
    R(lease, "b", result, "r", [(lease.x + 90, S.oy + 520), (result.right + 100, S.oy + 520), (result.right + 100, result.y + 75)],
      label="checked again", seg=1, fa=90/lease.w, fb=.27)
    V(services, retry, "error or timeout")
    R(retry, "b", queue, "b", [(retry.cx, S.oy + 1510), (S.ox + 20, S.oy + 1510),
      (S.ox + 20, S.oy + 540), (queue.cx, S.oy + 540)],
      label="eligible retry", seg=1)
    return S.end_frame()


def prepare_event(y0):
    return _import_acquisition_frame(y0, "event-import-source.excalidraw",
                                     "event_import_", frame_id="frame477", reserve_ids=62)




def respond_incident(y0):
    S.begin_frame("Respond to an incident", 0, y0, 3440, 1820)
    band = B(60, 200, "SOS or fall flags", "device", w=560, h=240, wordmark=WATCH, mark_h=100)
    telemetry = B(820, 200, "hardware telemetry", "rust", w=560, h=240, icons={0: RADIO, 1: RUST})
    incident = SV(1580, 200, STDB, "incident transaction", kind="stdb", w=560, h=240)
    desk = B(2340, 200, "incident on desk", "web", w=560, h=240, wordmark=MONITOR, mark_h=100)
    assign = B(2340, 720, "medic takes incident", "stdb", w=560, h=240, wordmark=HEART, mark_h=100)
    medic = B(1580, 720, "assigned medic", "web", w=560, h=240, wordmark=USER, mark_h=100)
    route = B(820, 720, "route display", "web", w=560, h=240, wordmark=WALK, mark_h=100)
    attendee = B(60, 720, "attendee", "web", w=560, h=240, wordmark=HEART, mark_h=100)
    tap = B(60, 1240, "tap band", "web", w=560, h=240, wordmark=NFC, mark_h=100)
    grant = B(820, 1240, "medical-card grant", "stdb", w=560, h=240, wordmark=SHIELD, mark_h=100)
    card = B(1580, 1240, "medical card", "web", w=560, h=240, wordmark=FILE, mark_h=100)
    resolve = B(2340, 1240, "resolve incident", "stdb", w=560, h=240, wordmark=HEART, mark_h=100)
    H(band, telemetry, "reports state")
    H(telemetry, incident, "ingest + watch")
    H(incident, desk, "live rows")
    V(desk, assign, "Take it")
    H(assign, medic, "assigns")
    H(medic, route, "opens route")
    H(route, attendee, "medic walks")
    V(attendee, tap, "medic taps")
    H(tap, grant, "requests access")
    H(grant, card, "granted view")
    H(card, resolve, "medic resolves")
    R(resolve, "b", telemetry, "t", [(resolve.cx, S.oy + 1680), (S.ox + 3320, S.oy + 1680),
      (S.ox + 3320, S.oy + 80), (telemetry.cx, S.oy + 80)], label="clear command", seg=2)
    return S.end_frame()


def routes_space(y0):
    """Append the two reviewed native flows while retaining their existing IDs."""
    import copy
    import random

    source_names = (
        "medic-route-display-source.excalidraw",
        "crowd-clearance-source.excalidraw",
    )
    offset = y0
    existing_ids = {element["id"] for element in S.elements}
    for filename in source_names:
        source = json.loads((LOGOS.parent / filename).read_text())
        frame = next(element for element in source["elements"] if element["type"] == "frame")
        assert not existing_ids.intersection(element["id"] for element in source["elements"]), filename
        for original in source["elements"]:
            element = copy.deepcopy(original)
            element["y"] += offset - frame["y"]
            S.elements.append(element)
            existing_ids.add(element["id"])
        for file_id, record in source.get("files", {}).items():
            if file_id in S.files:
                assert S.files[file_id]["dataURL"] == record["dataURL"]
            else:
                S.files[file_id] = copy.deepcopy(record)
        offset += frame["height"] + GAP

    # The original combined function reserved numeric IDs 931 through 1018.
    # Keep the following generated hardware IDs and random metadata unchanged.
    S.n = max(S.n + 88, 1018)
    for _ in range(176):
        random.randint(1, 2**31 - 1)
    return offset - y0 - GAP




def elastic_evidence(y0):
    """Indexed evidence and scoped retrieval, without the feature journeys."""
    S.begin_frame("Elastic evidence", 0, y0, 3320, 2040)
    x = [80, 760, 1440, 2120, 2800]
    w, h = 440, 360

    pages = B(x[0], 160, "Policy pages", "note", w=w, h=h,
              wordmark=FILE, mark_h=90)
    indexed = SV(x[1], 160, ELASTIC, "Document index", w=w, h=h)
    reader = SV(x[2], 160, ELASTIC, "Document reader", w=w, h=h)
    checked = B(x[3], 160, "Quote validation", "rust", w=w, h=h,
                wordmark=RUST, mark_h=90)
    clauses = SV(x[4], 160, ELASTIC, "Clause index", w=w, h=h)
    H(pages, indexed, "worker indexes")
    H(indexed, reader, "reads pages")
    H(reader, checked, "returns quotes")
    H(checked, clauses, "indexes checked text")

    query = B(x[1], 880, "Worker query", "rust", w=w, h=h,
              wordmark=RUST, mark_h=90)
    search = _elastic_component(x[2], 880, w, h, "Hybrid search", "ext", ELASTIC)
    _elastic_property(search, x[2] + 30, 1090, w - 60, "policy IDs")
    rerank = SV(x[3], 880, ELASTIC, "Jina rerank", w=w, h=h)
    citations = B(x[4], 880, "Cited clauses", "good", w=w, h=h,
                  wordmark=FILE, mark_h=90)
    H(query, search, "scoped retrieval")
    H(search, rerank, "ranks candidates")
    H(rerank, citations, "returns evidence")
    R(clauses, "b", search, "t",
      [S.P(3020, 680), S.P(1660, 680)], "searches clauses", seg=1)

    history = B(x[0], 1600, "Approved claims", "note", w=w, h=h,
                wordmark=FILE, mark_h=90)
    esql = SV(x[1], 1600, ELASTIC, "ES|QL", w=w, h=h)
    precedents = B(x[2], 1600, "Precedents", "good", w=w, h=h,
                   wordmark=SHIELD, mark_h=90)
    api = B(x[3], 1600, "bandit-api", "rust", w=w, h=h,
            wordmark=RUST, mark_h=90)
    matches = B(x[4], 1600, "Ranked people", "good", w=w, h=h,
                wordmark=USERS, mark_h=90)
    H(history, esql, "queries offered IDs")
    H(esql, precedents, "returns prior decisions")
    V(api, rerank, "query + eligible evidence", x=api.x + 120)
    R(rerank, "r", matches, "t",
      [S.P(2670, 1060), S.P(2670, 1440), S.P(3020, 1440)],
      "returns ranking", seg=2)
    return S.end_frame()


def elastic_execution(y0):
    """Import the reviewed investigation while preserving later element identities."""
    import random

    source_path = LOGOS.parent / "elastic-claim-investigation-source.excalidraw"
    source = json.loads(source_path.read_text())
    frame = next(element for element in source["elements"] if element["type"] == "frame")
    frame_id = "frame" + str(S.n + 1)
    id_map = {element["id"]: frame_id if element["type"] == "frame" else "exec04v2_" + element["id"]
              for element in source["elements"]}
    existing_ids = {element["id"] for element in S.elements}
    assert not existing_ids.intersection(id_map.values())

    # The former frame allocated 58 IDs and generated two random values per element.
    # Reserve the same sequence so all later IDs, seeds and nonces remain stable.
    S.n += 58
    for _ in range(58):
        original_seed = random.randint(1, 2**31 - 1)
        random.randint(1, 2**31 - 1)

    def remap(value, key=None):
        if isinstance(value, dict):
            return {k: remap(v, k) for k, v in value.items()}
        if isinstance(value, list):
            if key == "groupIds":
                return ["exec04v2_" + group for group in value]
            return [remap(item) for item in value]
        if isinstance(value, str) and key in {
            "id", "frameId", "containerId", "elementId", "diagramParentComponent"
        }:
            return id_map.get(value, value)
        return value

    origin_x, origin_y = frame["x"], frame["y"]
    for element in remap(source["elements"]):
        element["x"] -= origin_x
        element["y"] += y0 - origin_y
        if element["type"] == "frame":
            element["seed"] = original_seed
            element["version"] = 2
        S.elements.append(element)

    for file_id, record in source.get("files", {}).items():
        if file_id in S.files:
            assert S.files[file_id]["dataURL"] == record["dataURL"]
            assert S.files[file_id]["mimeType"] == record["mimeType"]
        else:
            S.files[file_id] = record
    return frame["height"]


def _import_acquisition_frame(y0, filename, prefix, frame_id=None, reserve_ids=0):
    """Import reviewed native artwork without changing later generated element IDs."""
    import random
    source_dir = pathlib.Path(globals().get("_ACQUISITION_SOURCE_DIR", LOGOS.parent))
    source = json.loads((source_dir / filename).read_text())
    frame = next(element for element in source["elements"] if element["type"] == "frame")
    id_map = {element["id"]: prefix + element["id"] for element in source["elements"]}
    if frame_id:
        id_map[frame["id"]] = frame_id
    origin_x, origin_y = frame["x"], frame["y"]
    height = frame["height"]
    for element in source["elements"]:
        element["id"] = id_map[element["id"]]
        element["x"] -= origin_x
        element["y"] = y0 + element["y"] - origin_y
        for key in ("frameId", "containerId"):
            if element.get(key):
                element[key] = id_map[element[key]]
        element["groupIds"] = [prefix + group for group in element.get("groupIds", [])]
        for bound in element.get("boundElements") or []:
            bound["id"] = id_map[bound["id"]]
        for key in ("startBinding", "endBinding"):
            binding = element.get(key)
            if binding:
                binding["elementId"] = id_map[binding["elementId"]]
        custom = element.get("customData") or {}
        for key in ("diagramParentComponent",):
            if custom.get(key) in id_map:
                custom[key] = id_map[custom[key]]
        if element["type"] == "frame":
            custom.update(diagramStyleVersion=1, diagramImportedSource="diagrams/" + filename)
            element["customData"] = custom
        S.elements.append(element)
    for file_id, record in source.get("files", {}).items():
        if file_id in S.files:
            assert S.files[file_id]["dataURL"] == record["dataURL"]
            assert S.files[file_id]["mimeType"] == record["mimeType"]
        else:
            S.files[file_id] = record
    # The old generator consumed one ID and two seeded draws per element.
    # New artwork uses prefixed IDs; reserve the old allocation for later frames.
    S.n += reserve_ids
    for _ in range(reserve_ids * 2):
        random.randint(1, 2**31 - 1)
    return height


def bright_data(y0):
    return _import_acquisition_frame(y0, "policy-discovery-source.excalidraw",
                                     "policy_lookup_", frame_id="frame296", reserve_ids=55)


def capture_venue_map(y0):
    return _import_acquisition_frame(y0, "venue-map-capture-source.excalidraw",
                                     "venue_capture_")


def _elastic_component(x, y, w, h, label, kind="ext", logo_=None):
    first = len(S.elements)
    box = Z(x, y, w, h, label, kind, logo_)
    box.el.update(backgroundColor={"ext": "#c3fae8", "rust": "#e9edf2"}.get(kind, "#dbe4ff"), strokeColor="#b5bfca")
    box.el.setdefault("customData", {})["diagramComponent"] = True
    for element in S.elements[first:]:
        if element["type"] == "text":
            element["strokeColor"] = "#1e1e1e"
    return box


def _elastic_property(parent, x, y, w, text, h=90):
    cell = B(x, y, text, "stdb", w=w, h=h)
    cell.el.update(backgroundColor="#f5f7ff", strokeColor="#c0cbe4", strokeWidth=1)
    cell.el.setdefault("customData", {})["diagramParentComponent"] = parent.id
    return cell



def _social_component(x, y, w, h, label, kind="stdb", logo_=None):
    """One owning component; its properties are nested data, not process steps."""
    first = len(S.elements)
    box = Z(x, y, w, h, label, kind, logo_)
    box.el["backgroundColor"] = {"stdb": "#dbe4ff", "rust": "#e9edf2", "device": "#ffe8cc", "ext": "#c3fae8"}.get(kind, "#d0ebff")
    box.el["strokeColor"] = "#b5bfca"
    box.el.setdefault("customData", {})["diagramComponent"] = True
    for element in S.elements[first:]:
        if element["type"] == "text":
            element["strokeColor"] = "#1e1e1e"
    return box


def _social_property(parent, x, y, w, text, h=90):
    cell = B(x, y, text, "stdb", w=w, h=h)
    cell.el.update(backgroundColor="#f5f7ff", strokeColor="#c0cbe4", strokeWidth=1)
    cell.el.setdefault("customData", {})["diagramParentComponent"] = parent.id
    return cell


def find_people(y0):
    S.begin_frame("Find people again", 0, y0, 3380, 1450)
    query = B(60, 160, "Who did I meet\nat the Meta booth?\n/friends", "web", w=600, h=260,
              wordmark=PHONE, mark_h=100)
    api = B(880, 160, "attendee search", "rust", w=560, h=260,
            wordmark=RUST, mark_h=100)
    engine = SV(1660, 160, ELASTIC, "candidate ranking", w=600, h=260)
    result = _social_component(2500, 160, 600, 440, "closest connections", "web", USER)
    _social_property(result, 2540, 350, 520, "recorded evidence reason", h=100)
    _social_property(result, 2540, 480, 520, "social links", h=80)

    met = _social_component(60, 660, 600, 420, "candidate evidence", "stdb", STDB)
    _social_property(met, 100, 850, 520, "your recorded meetings", h=90)
    _social_property(met, 100, 970, 520, "findable people", h=70)
    place = B(880, 660, "named-place check", "note", w=560, h=260,
              wordmark=PIN, mark_h=100)
    reconnect = B(2500, 820, "reconnect", "web", w=600, h=260,
                  icons={0: SOCIALS[0], 1: SOCIALS[1], 2: SOCIALS[2]})
    visits = SV(880, 1140, STDB, "overlapping booth visits", kind="stdb", w=560, h=240)

    H(query, api, "search phrase")
    H(api, engine, "query + eligible facts", y=api.y + 70)
    H(engine, api, "ranked candidates", y=api.bottom - 70)
    R(api, "t", result, "t", [(api.cx, S.oy + 70), (result.cx, S.oy + 70)],
      label="orders + explains", seg=1)
    H(met, place, "eligible people")
    V(visits, place, "booth + time overlap")
    V(api, place, "place phrase", x=api.x + 100)
    V(place, api, "eligible facts", x=api.x + 450)
    V(result, reconnect, "opens socials")
    return S.end_frame()




def photo_memories(y0):
    S.begin_frame("Memories engine", 0, y0, 3420, 1680)
    photo = _social_component(60, 170, 570, 600, "photographer's photo", "web", CAMERA)
    _social_property(photo, 100, 390, 490, "capture zone", h=100)
    _social_property(photo, 100, 530, 490, "capture time", h=100)
    worker = B(880, 170, "photo worker", "rust", w=560, h=260,
               wordmark=RUST, mark_h=110)
    engine = SV(1660, 170, ELASTIC, "photo analysis", w=600, h=260)
    analysis = _social_component(2500, 170, 600, 620, "photo analysis result", "rust", FILE)
    reading = _social_property(analysis, 2540, 390, 520, "people count", h=100)
    caption = _social_property(analysis, 2540, 550, 520, "photo caption", h=160)
    tags = SV(1660, 690, STDB, "band/time candidate tags", kind="stdb", w=600, h=240)
    recap = B(880, 690, "your tagged photos", "web", w=560, h=240,
              wordmark=IMAGE, mark_h=110)
    share = B(60, 1280, "share photo + @handles", "web", w=570, h=280,
              icons={0: SOCIALS[0], 1: SOCIALS[1], 2: SOCIALS[2]})
    memories = _social_component(880, 1280, 560, 320, "Memories", "web", STORE)
    _social_property(memories, 920, 1470, 480, "groups named by booth", h=90)
    graph = B(1660, 1280, "portal event graph", "web", w=600, h=280,
              wordmark=GRAPH3D, mark_h=120)
    relations = _social_component(2500, 1160, 600, 440, "event relationships", "stdb", STDB)
    _social_property(relations, 2540, 1360, 520, "encounters with minutes", h=80)
    _social_property(relations, 2540, 1470, 520, "booth visits with minutes", h=80)

    H(photo, worker, "uploads photo")
    H(worker, engine, "reads photo", y=worker.y + 70)
    H(engine, worker, "count + caption", y=worker.bottom - 70)
    R(worker, "t", analysis, "t", [(worker.cx, S.oy + 70), (analysis.cx, S.oy + 70)],
      label="records result", seg=1)
    D(reading, "l", .5, tags, "r", .2, "up to count")
    R(photo, "r", tags, "l", [(S.ox + 740, photo.y + photo.h*.8),
                                 (S.ox + 740, S.oy + 1000),
                                 (S.ox + 1550, S.oy + 1000),
                                 (S.ox + 1550, tags.y + tags.h * .8)],
      label="bands present then", seg=2, fa=.8, fb=.8)
    H(tags, recap, "selected candidates")
    R(caption, "b", recap, "r", [(caption.cx, S.oy + 1060),
                                  (S.ox + 1510, S.oy + 1060),
                                  (S.ox + 1510, recap.y + recap.h * .8)],
      label="caption", seg=1, fb=.8)
    D(recap, "b", .25, share, "t", .75, "phone share sheet")
    V(tags, graph, "photo-person links")
    H(relations, graph, "encounters + visits")
    H(graph, memories, "groups communities")
    return S.end_frame()



def settle_claim(y0):
    """A current claim's decision and distinct financial outcomes."""
    S.begin_frame("Settle a claim", 0, y0, 3520, 1770)
    injury = B(60, 160, "attendee injury", "device", w=500, h=240,
               wordmark=HEART, mark_h=96)
    property_ = B(60, 510, "venue property loss", "device", w=500, h=240,
                  wordmark=HAMMER, mark_h=96)
    evidence_ = SV(760, 335, ELASTIC, "Evidence Engine\ncited evidence", w=560, h=300)
    decision = SV(1460, 335, ELASTIC, "Decision Engine\nrecommendation", w=560, h=300)
    guard = SV(2160, 335, STDB, "settlement guard\nchecks authority", kind="stdb", w=560, h=300)
    injury_paid = SV(2860, 160, CAPONE, "Nessie\ninjury deposit", w=560, h=240)
    property_paid = B(2860, 510, "venue or repair vendor\nproperty booking", "good", w=560, h=240,
                      wordmark=HAMMER, mark_h=96)
    amounts = SV(760, 930, STDB, "Policy amounts\nfixed by code", kind="stdb", w=560, h=240)
    organizer = B(2160, 930, "organizer\nindividual decision", "web", w=560, h=240,
                  wordmark=USER, mark_h=96)
    refused = B(2860, 930, "refused claim\nreason retained", "bad", w=560, h=240,
                wordmark=SHIELD, mark_h=96)

    D(injury, "r", .5, evidence_, "l", .25, "medical evidence")
    D(property_, "r", .5, evidence_, "l", .75, "loss evidence")
    H(evidence_, decision, "checked facts")
    R(amounts, "r", decision, "l", [S.P(1390, 1050), S.P(1390, 485)], "fixed figures", seg=1)
    H(decision, guard, "proposes decision")
    D(guard, "r", .25, injury_paid, "l", .5, "authorized injury")
    D(guard, "r", .75, property_paid, "l", .5, "authorized property")
    V(guard, organizer, "needs review", x=guard.x + 140)
    V(organizer, guard, "approves", x=guard.x + 420)
    D(guard, "r", .9, refused, "l", .2, "checked refusal")
    H(organizer, refused, "refuses")

    responsibility = B(60, 1450, "organizer names\nresponsible attendee", "web", w=500, h=240,
                       wordmark=USER, mark_h=96)
    charge = B(760, 1450, "proposed charge\nlogged loss", "stdb", w=560, h=240,
               wordmark=FILE, mark_h=96)
    decided = B(1460, 930, "claim decided", "stdb", w=560, h=240,
                wordmark=SHIELD, mark_h=96)
    approval = B(1460, 1450, "organizer\napproves charge", "web", w=560, h=240,
                 wordmark=USER, mark_h=96)
    payer = B(2160, 1450, "attendee\npays charge", "web", w=560, h=240,
              wordmark=USER, mark_h=96)
    charged = SV(2860, 1450, CAPONE, "Nessie\ncharge purchase", w=560, h=240)
    V(property_, responsibility, "records responsibility", x=property_.x + 140)
    H(responsibility, charge, "proposes")
    R(guard, "l", decided, "t", [S.P(2090, 545), S.P(2090, 850), S.P(1740, 850)],
      "records outcome", seg=2, fa=.7)
    V(decided, approval, "required first")
    H(charge, approval, "awaits approval")
    H(approval, payer, "approved charge")
    H(payer, charged, "confirms payment")
    return S.end_frame()


def policy_amounts(y0):
    """Related inputs and formulas belong inside their calculation component."""
    S.begin_frame("Policy amounts", 0, y0, 3920, 2240)
    medical = _claim_component(60, 80, 1320, 990, "medical basis", "device", HEART)
    _claim_property(medical, 100, 280, 380, "billed amount")
    _claim_property(medical, 520, 280, 380, "fee cap per unit")
    _claim_property(medical, 940, 280, 400, "service units")
    _claim_property(medical, 100, 410, 1240, "eligible line = min(billed, cap × units)")
    _claim_property(medical, 100, 540, 1240, "covered bill = sum eligible lines")
    _claim_property(medical, 100, 670, 1240, "health-plan copay · when available")
    _claim_property(medical, 100, 800, 1240, "excess cover + copay: min(copay, covered bill)")
    _claim_property(medical, 100, 930, 1240, "otherwise: covered bill")

    property_ = _claim_component(60, 1130, 1320, 310, "property basis", "device", HAMMER)
    _claim_property(property_, 100, 1320, 1240, "Recorded property costs")

    payout = _claim_component(1630, 250, 1000, 990, "settlement payout", "stdb", STDB)
    _claim_property(payout, 1670, 450, 920, "per-claim limit")
    _claim_property(payout, 1670, 580, 440, "aggregate limit")
    _claim_property(payout, 2150, 580, 440, "aggregate used")
    _claim_property(payout, 1670, 710, 920, "remaining = max(aggregate limit − used, 0)")
    _claim_property(payout, 1670, 840, 920, "payout = min(basis, per-claim, remaining)", h=130)
    _claim_property(payout, 1670, 1020, 920, "deductible does not reduce payout")

    recovery = _claim_component(2880, 450, 980, 650, "insurer recovery + venue cost", "rust", WALLET)
    _claim_property(recovery, 2920, 650, 900, "deductible")
    _claim_property(recovery, 2920, 780, 900, "recovery = max(payout − deductible, 0)")
    _claim_property(recovery, 2920, 910, 900, "venue cost = payout − recovery")
    D(medical, "r", .5, payout, "l", .33, "injury basis")
    R(property_, "r", payout, "l", [S.P(1500, 1285), S.P(1500, 1040)], "property basis", seg=1, fb=.8)
    H(payout, recovery, "payout")
    _policy_allocation_example(2760, 1160)
    return S.end_frame()


def _policy_allocation_example(x, y):
    """A compact worked allocation, exported from these same editable elements."""
    first = len(S.elements)
    parent = _claim_component(x, y, 1100, 1020, "One injury claim · calculated split", "stdb")

    def amount(dx, dy, label, value, fill):
        component = _claim_component(x + dx, y + dy, 480, 240, label, "stdb")
        component.el["backgroundColor"] = fill
        component.el["customData"]["diagramParentComponent"] = parent.id
        number = _claim_property(component, x + dx + 30, y + dy + 100, 420, value, h=110)
        for element in S.elements:
            if element.get("containerId") == number.id:
                element.setdefault("customData", {})["diagramTextSize"] = 96
        return component

    care = amount(40, 130, "Covered care", "$895", "#ffe8cc")
    copay = amount(580, 130, "Plan copay", "$55", "#fff3bf")
    plan = amount(40, 530, "Health-plan share", "$840", "#c3fae8")
    venue = amount(580, 530, "Venue-cover payout", "$55", "#d3f9d8")
    V(care, plan, "minus copay")
    V(copay, venue, "within cover limits")
    _claim_property(parent, x + 40, y + 830, 1020,
                    "Excess venue cover · claim limit and cover remaining ≥ $55", h=130)
    for element in S.elements[first:]:
        element.setdefault("customData", {})["diagramExcerpt"] = "policy-allocation-example"


def _claim_component(x, y, w, h, label, kind="stdb", logo_=None):
    """A real component, with small filled property cells inside its boundary."""
    first = len(S.elements)
    box = Z(x, y, w, h, label, kind, logo_)
    box.el["backgroundColor"] = {"stdb": "#dbe4ff", "rust": "#e9edf2", "device": "#ffe8cc", "ext": "#c3fae8"}.get(kind, "#d0ebff")
    box.el["strokeColor"] = "#b5bfca"
    box.el.setdefault("customData", {})["diagramComponent"] = True
    for element in S.elements[first:]:
        if element["type"] == "text":
            element["strokeColor"] = "#1e1e1e"
    return box


def _claim_property(parent, x, y, w, text, h=90):
    cell = B(x, y, text, "stdb", w=w, h=h)
    cell.el.update(backgroundColor="#f5f7ff", strokeColor="#c0cbe4", strokeWidth=1)
    cell.el.setdefault("customData", {})["diagramParentComponent"] = parent.id
    return cell


def approve_rule(y0):
    """Simple precedents become explicitly approved, code-bounded authority."""
    S.begin_frame("Approve a reusable rule", 0, y0, 3700, 980)
    precedents = _claim_component(60, 150, 560, 680, "approved precedents", "device", FILE)
    _claim_property(precedents, 100, 350, 480, "at least 3 approved\nsimple claims", h=100)
    _claim_property(precedents, 100, 500, 480, "same incident kind\nand cover kind", h=100)
    _claim_property(precedents, 100, 650, 480, "complicated claims\nnever teach a rule", h=100)
    proposal = SV(760, 350, ELASTIC, "Decision Engine\nproposes from precedents", w=480, h=280)
    scope = _claim_component(1380, 100, 920, 780, "proposed rule · code-enforced scope", "stdb", STDB)
    _claim_property(scope, 1420, 300, 400, "incident kind")
    _claim_property(scope, 1860, 300, 400, "cover kind")
    _claim_property(scope, 1420, 430, 400, "all event zones")
    _claim_property(scope, 1860, 430, 400, "corroboration\nrequired")
    _claim_property(scope, 1420, 560, 840, "ceiling = highest cited payout")
    _claim_property(scope, 1420, 690, 840, "ceiling ≤ policy per-claim limit")
    organizer = B(2440, 350, "organizer\nreviews scope + ceiling", "web", w=480, h=280,
                  wordmark=USER, mark_h=96)
    rule = SV(3060, 350, STDB, "approved rule version\nfuture guarded authority", kind="stdb", w=560, h=280)
    H(precedents, proposal, "cites claims")
    H(proposal, scope, "validated proposal")
    H(scope, organizer, "shown for approval")
    H(organizer, rule, "approves")
    return S.end_frame()




def hardware(y0):
    S.begin_frame("15 · Band data flow", 0, y0, 4300, 2240)

    band = B(60, 650, "band firmware\nXIAO ESP32-C3", "device",
             w=520, h=350, wordmark=WATCH, mark_h=150)
    beacon = B(860, 260,
               "State beacon · 14 bytes\nid, flags, state, zone\nneigh, bat, seq, find target\n100 ms + jitter",
               "note", w=600, h=330, icons={0: RADIO})
    heard = B(860, 1120,
              "Heard report\nup to 16 peer ID / RSSI pairs\nfresh within 2 s\n1 s + jitter",
              "note", w=600, h=330, icons={0: RADIO})
    station = B(1660, 150,
                "Station beacon\nid + exit color · 5 Hz",
                "device", w=600, h=260, icons={0: RADIO})
    gateway = B(1660, 650, "gateway 200\nESP32-C3 SuperMini", "device",
                w=600, h=350, wordmark=ESP, mark_h=150)
    bridge = B(2460, 650, "band1t-bridge\nvenue laptop\nparse + route", "rust",
               w=600, h=350, wordmark=RUST, mark_h=150)
    ingest_state = B(3360, 470, "ingest_band", "stdb", w=700, h=180)
    ingest_proximity = B(3360, 810, "ingest_heard", "stdb", w=700, h=180)
    ingest_marker = B(3360, 1150, "ingest_station", "stdb", w=700, h=180)
    receipt = B(3360, 1490, "command_sent", "stdb", w=700, h=180)
    pending = B(3360, 1830, "command rows\npending = true", "stdb", w=700, h=180)
    Z(3260, 190, 940, 1900, "Maincloud module", "stdb", STDB)
    serial = B(2460, 1420,
               "Serial command\ncmd target name [args]",
               "note", w=600, h=280, icons={0: FILE})
    radio = B(1660, 1420,
              "Radio command · 14 bytes\ntarget, cmd, arg, arg2\n3 copies · 40 ms apart\nsame sequence",
              "note", w=600, h=280, icons={0: RADIO})
    ack = B(2460, 1860,
            "Gateway ACK or error\nACK means queued\nfor radio transmission",
            "note", w=600, h=280, icons={0: RADIO})

    D(band, "r", .25, beacon, "l", .5, "state")
    D(band, "r", .75, heard, "l", .5, "proximity")
    D(beacon, "r", .5, gateway, "l", .25, "ESP-NOW")
    D(heard, "r", .5, gateway, "l", .75, "ESP-NOW")
    V(station, gateway, "ESP-NOW")
    H(gateway, bridge, "JSON lines\n115200 baud", y=gateway.y + 100)
    D(bridge, "r", .2, ingest_state, "l", .5, "band beacon")
    D(bridge, "r", .45, ingest_proximity, "l", .5, "heard report")
    D(bridge, "r", .7, ingest_marker, "l", .5, "station beacon")
    R(pending, "l", bridge, "r",
      [S.P(3180, L(pending.cy)), S.P(3180, L(bridge.bottom) - 30)],
      label="new commands", seg=1, fb=.92)
    V(bridge, serial, "formats")
    H(serial, radio, "gateway queues")
    R(radio, "b", band, "b",
      [S.P(radio.cx, 1740), S.P(band.cx, 1740)],
      label="ESP-NOW · band deduplicates sequence", seg=1)
    R(gateway, "b", ack, "t",
      [S.P(gateway.cx, 1110), S.P(2360, 1110), S.P(2360, 1790), S.P(ack.cx, 1790)],
      label="queue receipt", seg=2)
    D(ack, "r", .5, receipt, "l", .5, "bridge calls")
    return S.end_frame()



def exit_markers_gateway(y0):
    S.begin_frame("21 · Exit markers and gateway", 0, y0, 3600, 1840)

    def component(x, y, w, h, label, art=None, kind="device"):
        first = len(S.elements)
        box = Z(x, y, w, h, label, kind, art)
        box.el.update(backgroundColor="#ffe8cc" if kind == "device" else "#e9edf2",
                      strokeColor="#b5bfca")
        box.el.setdefault("customData", {})["diagramComponent"] = True
        for element in S.elements[first:]:
            if element["type"] == "text":
                element["strokeColor"] = "#1e1e1e"
        return box

    def prop(parent, x, y, w, label, h=100):
        cell = B(x, y, label, "stdb", w=w, h=h)
        cell.el.update(backgroundColor="#f5f7ff", strokeColor="#c0cbe4", strokeWidth=1)
        cell.el.setdefault("customData", {})["diagramParentComponent"] = parent.id
        return cell

    power = component(60, 800, 300, 220, "Power bank")
    prop(power, 80, 890, 260, "USB 5 V")

    station = component(500, 500, 900, 1100, "ESP32-C3 SuperMini · exit station", ESP)
    prop(station, 540, 720, 390, "Station IDs\n101–105")
    prop(station, 970, 720, 390, "One per exit")
    prop(station, 540, 850, 820, "Modes\nbreathe · chase · strobe · off")
    for x, y, label, color in (
        (540, 980, "101 · blue", "#0000ff"),
        (970, 980, "102 · magenta", "#ff00ff"),
        (540, 1100, "103 · cyan", "#00ffff"),
        (970, 1100, "104 · white", "#ffffff"),
        (540, 1220, "105 · orange", "#ffa500"),
        (970, 1220, "Exit color\nsaved in flash", None),
    ):
        field = prop(station, x, y, 390, label)
        if color:
            S.base("rectangle", S.ox + x + 20, S.oy + y + 29, 42, 42,
                   backgroundColor=color, strokeColor="#495057", strokeWidth=2,
                   roughness=0, roundness={"type": 3},
                   customData={"diagramParentComponent": field.id,
                               "diagramSignalColor": label.split(" · ")[1]})
    prop(station, 540, 1340, 820, "Beacon sends station ID + exit color")
    prop(station, 540, 1460, 390, "Beacon rate\n5 Hz")
    prop(station, 970, 1460, 390, "Radio power\n21 dBm")

    diode = component(1500, 180, 500, 240, "1N4001 diode")
    prop(diode, 1520, 280, 460, "Stripe toward ring")
    resistor = component(1600, 850, 250, 180, "Resistor")
    prop(resistor, 1620, 920, 210, "330 Ω", h=80)

    ring = component(2000, 500, 600, 680, "Exit LED ring")
    prop(ring, 2040, 650, 520, "LED count\n12", h=120)
    prop(ring, 2040, 800, 520, "Brightness\n120", h=120)
    prop(ring, 2040, 950, 520, "Shows station exit color", h=140)

    gateway = component(2800, 300, 760, 920, "ESP32-C3 SuperMini · gateway", ESP)
    prop(gateway, 2840, 540, 680, "Gateway ID\n200")
    prop(gateway, 2840, 680, 680, "Radio\nESP-NOW")
    prop(gateway, 2840, 820, 320, "Channel\n1")
    prop(gateway, 3200, 820, 320, "Radio power\n21 dBm")
    prop(gateway, 2840, 960, 680, "Powered by USB", h=140)
    laptop = B(2800, 1450, "venue laptop\nband1t-bridge\nBand data flow", "rust",
               w=760, h=330, wordmark=LAPTOP, mark_h=140)

    H(power, station, "USB-C", y=power.cy)
    R(station, "t", diode, "l", [(station.cx, diode.cy)], label="5V pin", seg=1)
    R(diode, "r", ring, "t", [(ring.cx, diode.cy)], label="ring 5V")
    H(station, resistor, "GPIO10", y=resistor.cy)
    H(resistor, ring, "DIN", y=resistor.cy)
    R(station, "b", ring, "b",
      [(station.x + station.w * 0.8, S.oy + 1710), (ring.cx, S.oy + 1710)],
      label="G → GND", seg=1, fa=0.8)
    V(gateway, laptop, "USB-C\npower + serial", both=True)
    return S.end_frame()



def vision(y0):
    S.begin_frame("05 · Vision", 0, y0, 3100, 2010)

    def G(x, y, w, label, items, kind="note", cols=2, image=None):
        rows = (len(items) + cols - 1) // cols
        h = 140 + rows * 160
        zone = S.zone(x, y, w, h, label, "plain", fs=ZFS, logo=image)
        cell_w = (w - 60 - (cols - 1) * 20) / cols
        for i, item in enumerate(items):
            B(x + 30 + (i % cols) * (cell_w + 20), y + 130 + (i // cols) * 160,
              item, kind, w=cell_w, h=140)
        return zone

    camera = G(60, 180, 500, "Camera input", ["Video frames", "Frame time"],
               "device", image=CAMERA)
    spectrum = G(800, 180, 560, "Flash filter", ["1.5 s window", "4 Hz signal", "Red channel", "Reject nearby rates"],
                 "rust", image=OPENCV)
    tracks = G(1580, 180, 560, "Flash tracks", ["Blob grouping", "Stable IDs", "Spot position"],
               "rust", image=NUMPY)
    calibration = B(2360, 240, "Camera-to-plan\ntransform", "note",
                    w=660, h=300, wordmark=GRAPH3D, mark_h=100)

    radio = G(60, 790, 1300, "Radio and ranging inputs",
              ["Band ID", "SOS/fall flags", "Zone", "Position", "Uncertainty", "Receive time"],
              "note", cols=3, image=RADIO)
    fusion = G(1580, 790, 560, "Match calling bands",
               ["Fresh flags", "Radio match", "Uncertainty gate"], "rust", image=PYTHON)
    located = G(2360, 790, 660, "Located observation",
                ["Camera", "Band ID", "Zone", "Image point", "Plan point", "Time", "Radio offset"],
                "note", cols=3, image=WATCH)

    page = G(60, 1510, 800, "Security page",
             ["State JSON\nGET /state", "Live video\nGET /live.mjpg", "Acknowledge\nPOST /ack"],
             "web", image=SPARK)
    archive = G(1120, 1510, 800, "Local evidence",
                ["Event log", "Marked image", "3 s clip"], "note", cols=3, image=FILE)
    module = SV(2220, 1570, STDB, "report_camera_sighting",
                kind="stdb", w=800, h=300)

    H(camera, spectrum, "timestamped frames")
    H(spectrum, tracks, "flash blobs")
    H(calibration, tracks, "maps pixels")
    V(tracks, fusion, "tracked spots")
    H(radio, fusion, "fresh radio state")
    H(fusion, located, "band + spot")
    D(fusion, "b", .2, page, "t", .9, "local HTTP", both=True)
    D(located, "b", .15, archive, "t", .85, "saves evidence")
    V(located, module, "reports sighting")
    return S.end_frame()


def venue_reconstruction(y0):
    S.begin_frame("24 · Venue reconstruction", 0, y0, 3360, 1690)

    def G(x, y, w, label, items, kind="note", cols=2, image=None):
        rows = (len(items) + cols - 1) // cols
        h = 140 + rows * 160
        zone = S.zone(x, y, w, h, label, "plain", fs=ZFS, logo=image)
        cell_w = (w - 60 - (cols - 1) * 20) / cols
        for i, item in enumerate(items):
            B(x + 30 + (i % cols) * (cell_w + 20), y + 130 + (i // cols) * 160,
              item, kind, w=cell_w, h=140)
        return zone

    walk = B(60, 180, "Walk-through video", "device",
             w=520, h=300, wordmark=PHONE, mark_h=100)
    frames = G(820, 180, 600, "Frame selection",
               ["Sharpness score", "Stillness filter"], "rust", image=OPENCV)
    poses = G(1660, 180, 600, "COLMAP",
              ["Feature matching", "Camera poses", "3D points", "Undistorted images"], "ext", image=COLMAP)
    train = G(2500, 180, 780, "Brush",
              ["Gaussian training", "splat.ply"], "ext", image=GRAPH3D)

    camera = G(60, 900, 520, "Camera registration",
               ["Camera frame", "Image matching", "Camera pose", "Lens calibration"], "device", image=CAMERA)
    mapping = G(820, 900, 600, "Camera-to-plan mapping",
                ["Wrist-height ray", "Plan coordinates"], "note", image=logo("icon-map-pin.svg"))
    view = G(1660, 900, 600, "Security page",
             ["venue.splat", "scene.json", "Camera coverage"], "web", image=SPARK)
    align = G(2500, 900, 780, "Align model to venue",
              ["Floor plane", "Plan landmarks", "Measured scale", "Venue transform", "Venue bounds"],
              "rust", image=GRAPH3D)

    H(walk, frames, "video")
    H(frames, poses, "sharp images")
    H(poses, train, "poses + images")
    V(train, align, "trained splat")
    H(align, view, "venue model")
    R(poses, "b", camera, "t",
      [(poses.cx, S.oy + 760), (camera.cx, S.oy + 760)],
      label="registered model", seg=1)
    H(camera, mapping, "camera pose")
    H(mapping, view, "image-to-plan mapping")
    R(align, "b", mapping, "b",
      [(align.cx, S.oy + 1640), (mapping.cx, S.oy + 1640)],
      label="venue transform", seg=1)
    return S.end_frame()



def _product_frame(y0, filename, prefix, artwork_sources=None):
    """Preserve approved native product illustrations on the same editable board."""
    source_path = LOGOS.parent / filename
    source = json.loads(source_path.read_text())
    frame = next(element for element in source["elements"] if element["type"] == "frame")
    id_map = {element["id"]: prefix + element["id"] for element in source["elements"]}
    scale = 2
    origin_x, origin_y = frame["x"], frame["y"]
    for element in source["elements"]:
        element["id"] = id_map[element["id"]]
        element["x"] = (element["x"] - origin_x) * scale
        element["y"] = y0 + (element["y"] - origin_y) * scale
        element["width"] *= scale
        element["height"] *= scale
        element["strokeWidth"] *= scale
        if element["type"] == "arrow":
            element["strokeWidth"] = 6
        if element.get("fontSize"):
            element["fontSize"] *= scale
        if element.get("points"):
            element["points"] = [[x * scale, y * scale] for x, y in element["points"]]
        if element.get("frameId"):
            element["frameId"] = id_map[element["frameId"]]
        if element.get("containerId"):
            element["containerId"] = id_map[element["containerId"]]
        element["groupIds"] = [prefix + group for group in element.get("groupIds", [])]
        for bound in element.get("boundElements") or []:
            bound["id"] = id_map[bound["id"]]
        for key in ("startBinding", "endBinding"):
            binding = element.get(key)
            if binding:
                binding["elementId"] = id_map[binding["elementId"]]
                if "gap" in binding:
                    binding["gap"] *= scale
        if element["type"] == "frame":
            element.setdefault("customData", {}).update(
                diagramStyleVersion=1,
                diagramImportedSource="diagrams/" + filename)
        if artwork_sources and element.get("customData", {}).get("assetSource") in artwork_sources:
            element["customData"]["assetSource"] = artwork_sources[element["customData"]["assetSource"]]
        S.elements.append(element)
    for file_id, record in source.get("files", {}).items():
        if file_id in S.files:
            assert S.files[file_id]["dataURL"] == record["dataURL"]
            assert S.files[file_id]["mimeType"] == record["mimeType"]
        else:
            S.files[file_id] = record
    return frame["height"]


def fire_evacuation(y0):
    return _product_frame(y0, "fire-evacuation-source.excalidraw", "fire_")


def photo_product_flow(y0):
    names = ("photographer-illustration.svg", "nearby-bands-illustration.svg", "recap-photo-illustration.svg")
    sources = {"artifacts/devpost/social-photo-flow/" + name: "diagrams/product-assets/" + name for name in names}
    return _product_frame(y0, "photo-flow-source.excalidraw", "photo_", sources)


def merch_product_flow(y0):
    return _product_frame(y0, "merch-image-source.excalidraw", "merch_")



def nessie(y0):
    """One provider, its operations and references, then local wallet accounting."""
    S.begin_frame("Capital One Nessie", 0, y0, 4480, 1770)
    provider = _nessie_component(1000, 100, 1600, 1040, "Nessie API", "ext")
    brand = S.image(S.ox + 1070, S.oy + 155, CAPONE, 175)
    brand.setdefault("customData", {})["diagramParentComponent"] = provider.id
    customer = _nessie_component(1060, 350, 620, 230, "Create customer", "ext", parent=provider)
    _nessie_property(customer, 1100, 445, 540, "returns customer_id")
    account = _nessie_component(1920, 350, 620, 230, "Checking account", "ext", parent=provider)
    _nessie_property(account, 1960, 445, 540, "returns account_id")
    deposit = _nessie_component(1060, 790, 620, 230, "Deposit", "ext", parent=provider)
    _nessie_property(deposit, 1100, 885, 540, "returns deposit_id")
    purchase = _nessie_component(1920, 790, 620, 230, "Purchase", "ext", parent=provider)
    _nessie_property(purchase, 1960, 885, 540, "returns purchase_id")
    H(customer, account, "worker uses customer ID")

    setup = B(80, 350, "Wallet setup", "web", w=550, h=230,
              wordmark=PHONE, mark_h=100)
    injury = B(80, 790, "Approved injury payout", "good", w=550, h=230,
               wordmark=HEART, mark_h=100)
    setup.el.setdefault("customData", {})["diagramArtworkHeight"] = 200
    injury.el.setdefault("customData", {})["diagramArtworkHeight"] = 200
    H(setup, customer, "worker POST")
    H(injury, deposit, "worker POST")

    ledger = _nessie_component(2970, 790, 620, 350, "wallet_entry", "stdb", STDB)
    _nessie_property(ledger, 3010, 935, 540, "signed amount_cents")
    _nessie_property(ledger, 3010, 1045, 540, "Nessie reference", h=70)
    total = _nessie_component(2970, 350, 620, 350, "Spendable balance", "rust", RUST)
    _nessie_property(total, 3010, 495, 540, "sum wallet_entry cents")
    _nessie_property(total, 3010, 605, 540, "subtract pending holds", h=70)
    wallet = SV(3890, 350, STDB, "my_wallet", kind="stdb", w=500, h=350)
    H(total, wallet, "available cents")
    V(ledger, total, "wallet entries")
    R(account, "r", ledger, "l", [S.P(2770, 465), S.P(2770, 877.5)],
      "worker records opening", seg=1, fb=.25)
    H(purchase, ledger, "worker records debit", y=purchase.cy)
    R(deposit, "b", ledger, "b", [S.P(1370, 1210), S.P(2580, 1210), S.P(3280, 1210)],
      "worker records credit", seg=2)

    approval = B(80, 1390, "Organizer approves charge", "good", w=550, h=300,
                 wordmark=USER, mark_h=100)
    payment = B(920, 1390, "Attendee pays", "web", w=550, h=300,
                wordmark=PHONE, mark_h=100)
    merch = B(1940, 1390, "Merch checkout", "web", w=550, h=300,
              wordmark=STORE, mark_h=100)
    H(approval, payment, "permits payment")
    R(payment, "t", purchase, "b", [S.P(1195, 1290), S.P(2050, 1290)],
      "worker POST", seg=1, fb=.21)
    R(merch, "t", purchase, "b", [S.P(2390, 1240)],
      "worker POST", seg=0, fa=(2390 - 1940) / 550, fb=(2390 - 1920) / 620)
    return S.end_frame()




def _nessie_component(x, y, w, h, label, kind="stdb", logo_=None, parent=None):
    first = len(S.elements)
    box = Z(x, y, w, h, label, kind, logo_)
    box.el.update(backgroundColor={"ext": "#c3fae8", "stdb": "#dbe4ff", "rust": "#e9edf2"}.get(kind, "#d0ebff"), strokeColor="#b5bfca")
    box.el.setdefault("customData", {})["diagramComponent"] = True
    if parent:
        box.el["backgroundColor"] = "#e7fbf2"
        box.el["customData"]["diagramParentComponent"] = parent.id
    for element in S.elements[first:]:
        if element["type"] == "text":
            element["strokeColor"] = "#1e1e1e"
    return box


def _nessie_property(parent, x, y, w, text, h=90):
    cell = B(x, y, text, "stdb", w=w, h=h)
    cell.el.update(backgroundColor="#f5f7ff", strokeColor="#c0cbe4", strokeWidth=1)
    cell.el.setdefault("customData", {})["diagramParentComponent"] = parent.id
    return cell



def band_wiring(y0):
    S.begin_frame("20 · Band wiring", 0, y0, 3540, 3240)

    def component(x, y, w, h, label, art=None, dashed=False):
        first = len(S.elements)
        box = Z(x, y, w, h, label, "device", art)
        box.el.update(backgroundColor="#ffe8cc", strokeColor="#b5bfca",
                      strokeStyle="dashed" if dashed else "solid")
        box.el.setdefault("customData", {})["diagramComponent"] = True
        for element in S.elements[first:]:
            if element["type"] == "text":
                element["strokeColor"] = "#1e1e1e"
        return box

    def prop(parent, x, y, label, w=310, h=130, dashed=False):
        cell = B(x, y, label, "stdb", w=w, h=h, dashed=dashed)
        cell.el.update(backgroundColor="#f5f7ff", strokeColor="#c0cbe4", strokeWidth=1)
        cell.el.setdefault("customData", {})["diagramParentComponent"] = parent.id
        return cell

    left, middle, right = 80, 1360, 2800
    rows = (180, 820, 1460, 2100)
    board = component(middle - 20, rows[0], 800, 2480,
                      "XIAO ESP32-C3 · band controller", SEEED)
    values = (
        ("Same firmware\nlite + full bands", "USB-C\ncharging + serial"),
        ("LiPo charger\n380 mA", "3V3 regulator"),
        ("ESP-NOW transmit\n8 dBm", "5V pin live\nonly on USB"),
        ("D8 + D9\nnever wired", "D9\nBOOT"),
        ("No power\nswitch", "Unlit ring\n≈12 mA"),
        ("One click\ndeep sleep", "One click\nwake"),
    )
    for row, pair in enumerate(values):
        for col, label in enumerate(pair):
            prop(board, middle + 20 + col * 380, 540 + row * 330,
                 label, w=350, h=240)

    ring = component(left - 20, rows[0], 720, 560, "LED ring · WS2812B")
    prop(ring, left, rows[0] + 270, "LED count\n12")
    prop(ring, left + 350, rows[0] + 270, "Brightness\n64 / 255")
    prop(ring, left, rows[0] + 420, "Power: battery rail", w=660)

    button = component(left - 20, rows[1], 720, 560, "SOS control · button")
    prop(button, left, rows[1] + 270, "Under ring\ncentre")
    prop(button, left + 350, rows[1] + 270, "Pull-up input")
    prop(button, left, rows[1] + 420, "Wakes deep sleep", w=660)

    imu = component(left - 20, rows[2], 720, 560, "Motion · MPU-6050 · GY-521", dashed=True)
    prop(imu, left, rows[2] + 270, "Optional\nfull bands", dashed=True)
    prop(imu, left + 350, rows[2] + 270, "I2C address\n0x68")
    prop(imu, left, rows[2] + 420, "Range\n±8 g")
    prop(imu, left + 350, rows[2] + 420, "Read rate\n100 / second")

    motor = component(left - 20, rows[3], 720, 560, "Haptics · coin vibration motor", dashed=True)
    prop(motor, left, rows[3] + 270, "Optional\nfull bands", dashed=True)
    prop(motor, left + 350, rows[3] + 270, "Driver\n2N2222")
    prop(motor, left, rows[3] + 420, "PWM rate\n20 kHz")
    prop(motor, left + 350, rows[3] + 420, "Duty cycle\n70%")

    battery = component(right - 20, rows[0], 720, 560, "Battery supply · LiPo")
    prop(battery, right, rows[0] + 270, "Capacity\n500 mAh")
    prop(battery, right + 350, rows[0] + 270, "Protected cell")
    prop(battery, right, rows[0] + 420, "Supplies ring + motor", w=660)

    antenna = component(right - 20, rows[1], 720, 560, "FPC antenna", RADIO)
    prop(antenna, right, rows[1] + 270, "Mounted on lid", w=660)
    prop(antenna, right, rows[1] + 420, "Outside case", w=660)

    divider = component(right - 20, rows[2], 720, 560, "Battery measurement · divider", dashed=True)
    prop(divider, right, rows[2] + 270, "Resistance\n2 × 200 kΩ")
    prop(divider, right + 350, rows[2] + 270, "Not fitted", dashed=True)
    prop(divider, right, rows[2] + 420, "Battery % when fitted", w=660)

    nfc = component(right - 20, rows[3], 720, 560, "Tap link · NTAG215 NFC sticker", NFC)
    prop(nfc, right, rows[3] + 270, "No wires", w=660)
    prop(nfc, right, rows[3] + 420, "Opens\nband1t.vip/t/BANDIT-0N", w=660)

    H(board, ring, "D1 · GPIO3\n330 Ω → DIN", y=ring.cy)
    H(button, board, "D2 · GPIO4\nbutton → GND", y=button.cy)
    H(board, imu, "D4 · GPIO6 SDA\nD5 · GPIO7 SCL\n3V3 + GND", y=imu.cy,
      both=True, dashed=True)
    H(board, motor, "D6 · GPIO21\n1 kΩ → base", y=motor.cy, dashed=True)
    H(battery, board, "BAT+ and BAT− pads", y=battery.cy)
    H(board, antenna, "U.FL", y=antenna.cy, both=True)
    H(divider, board, "D0 · GPIO2 (A0)", y=divider.cy, dashed=True)

    case = component(2780, 2740, 720, 440, "Printed pill case")
    prop(case, 2800, 2830, "Size\n64 × 42 mm", h=140)
    prop(case, 3150, 2830, "Button hole\n6.5 mm", h=140)
    prop(case, 2800, 3020, "Ring in head · battery below", w=660, h=140)
    return S.end_frame()



def band_firmware(y0):
    S.begin_frame("22 · Band firmware", 0, y0, 4000, 2660)

    def cell(x, y, text, kind="device", w=600, h=220, art=None):
        kw = {"wordmark": art, "mark_h": 130} if art else {}
        return B(x, y, text, kind, w=w, h=h, **kw)

    def component(x, y, w, h, label, art=None):
        first = len(S.elements)
        parent = Z(x, y, w, h, label, "device", art)
        parent.el.update(backgroundColor="#ffe8cc", strokeColor="#b5bfca")
        parent.el.setdefault("customData", {})["diagramComponent"] = True
        for element in S.elements[first:]:
            if element["type"] == "text":
                element["strokeColor"] = "#1e1e1e"
        return parent

    def prop(parent, x, y, w, label, h=140, fill="#f5f7ff"):
        child = B(x, y, label, "stdb", w=w, h=h)
        child.el.update(backgroundColor=fill, strokeColor="#c0cbe4", strokeWidth=1)
        child.el.setdefault("customData", {})["diagramParentComponent"] = parent.id
        return child

    firmware = component(40, 80, 3920, 430, "ESP32-C3 · band firmware", WATCH)
    prop(firmware, 90, 290, 1080, "Non-blocking main loop")
    prop(firmware, 1370, 290, 1200, "Own SOS or fall first")
    prop(firmware, 2770, 290, 1100, "No internet needed")

    Z(40, 560, 3920, 780, "own incident — overrides helper and exit colors", "device")
    button = component(90, 640, 1260, 340, "SOS button", WATCH)
    prop(button, 130, 850, 1180, "Hold 3 s", h=90)
    ring = component(2290, 640, 760, 650, "12-LED ring")
    orange = prop(ring, 2370, 840, 600, "Orange SOS", fill="#fff4e6")
    red = prop(ring, 2370, 1110, 600, "Red fall", fill="#ffe3e3")
    motor = component(3210, 880, 650, 390, "Motor")
    prop(motor, 3250, 1090, 570, "Full bands only", h=110)
    freefall = cell(90, 1070, "Free fall", "note", w=540)
    impact = cell(810, 1070, "Impact", "note", w=540)
    stillness = cell(1530, 1070, "Stillness", "note", w=540)
    H(button, orange, "raises SOS")
    H(freefall, impact, "then")
    H(impact, stillness, "then")
    H(stillness, red, "raises fall")
    D(orange, "r", .5, motor, "l", .25, "vibrates")
    D(red, "r", .5, motor, "l", .75, "vibrates")

    Z(40, 1400, 3920, 440, "nearby caller — when this band has no own incident", "device")
    heard = cell(90, 1460, "Caller’s\nheard list", w=660, h=340, art=RADIO)
    helpers = cell(1130, 1530, "Select 3\nnearest helpers", "rust", w=740)
    selected = cell(2210, 1530, "This band\nis selected", "note", w=660)
    copy = cell(3210, 1530, "Copy caller’s\nSOS color", w=650)
    H(heard, helpers, "ranks peers")
    H(helpers, selected, "checks")
    H(selected, copy, "yes")

    Z(40, 1900, 3920, 700, "exit guidance — when no incident color is active", "device")
    station = cell(90, 2110, "Station beacon\nid + color + signal", w=600, h=340, art=RADIO)
    nearest = cell(1030, 2190, "Nearest station", "rust", w=650)
    margin = cell(1990, 2190, "Switch at\n2 dB margin", "note", w=650)
    exitcolor = cell(3150, 2190, "Show nearest\nstation color", w=710)
    idle = cell(2770, 1990, "Idle", "note", w=280, h=120)
    crowd = cell(2770, 2200, "Crowd", "note", w=280, h=120)
    lowvis = cell(2770, 2390, "Low\nvisibility", "note", w=280, h=120)
    H(station, nearest, "compares signal")
    H(nearest, margin, "changes only")
    R(margin, "b", exitcolor, "b", [S.P(2315, 2560), S.P(3505, 2560)],
      "keeps color stable", seg=1)
    D(idle, "r", .5, exitcolor, "t", .25, "")
    H(crowd, exitcolor)
    D(lowvis, "r", .5, exitcolor, "b", .25, "")
    return S.end_frame()







FRAMES = (architecture, spacetimedb, elastic_evidence, elastic_execution, bright_data,
          nessie, jobs, prepare_event, capture_venue_map, find_people, photo_memories,
          settle_claim, policy_amounts, approve_rule, respond_incident,
          routes_space, fire_evacuation, photo_product_flow, merch_product_flow, hardware, band_wiring, exit_markers_gateway,
          band_firmware, vision, venue_reconstruction)

ALIASES = {
    "overview": ("architecture",), "vultr": ("architecture",),
    "queues": ("jobs",), "pipeline": ("prepare_event",),
    "evidence": ("elastic_evidence",), "claude_jobs": ("elastic_execution",),
    "social": ("find_people", "photo_memories"),
    "insurance": ("settle_claim", "policy_amounts", "approve_rule"),
    "medic": ("respond_incident", "routes_space"),
    "views": ("spacetimedb",),
}
requested = sys.argv[2:]
only = {name for item in requested for name in ALIASES.get(item, (item,))}
known = {draw.__name__ for draw in FRAMES}
unknown = only - known
if unknown:
    raise SystemExit("Unknown frame: " + ", ".join(sorted(unknown)))
y = 0
for draw in FRAMES:
    if not only or draw.__name__ in only:
        y += draw(y) + GAP
S.dump(sys.argv[1] if len(sys.argv) > 1 else "bandit-system-design.excalidraw")
print(len(S.elements), "elements")
