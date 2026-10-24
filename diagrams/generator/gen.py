"""BandIt system design in Excalidraw: twelve frames stacked top to bottom."""
import sys

from lib import KINDS, Scene, measure

S = Scene()
GAP = 220


def L(v, axis="y"):
    """Absolute scene coordinate back to frame-local."""
    return v - (S.oy if axis == "y" else S.ox)


def title(t, sub, width=1900):
    S.text(40, 28, t, fs=40)
    S.text(40, 92, sub, fs=20, width=width, color="#495057")


def legend(x, y, tbd=True):
    items = [("device", "devices"), ("rust", "Rust services"), ("stdb", "SpacetimeDB"),
             ("web", "browsers and people"), ("ext", "sponsor and outside APIs")] + ([("tbd", "TBD Leo")] if tbd else [])
    for i, (k, name) in enumerate(items):
        cx = x + (i % 3) * 300
        cy = y + (i // 3) * 46
        fill, stroke = KINDS[k]
        S.base("rectangle", S.ox + cx, S.oy + cy, 44, 28, backgroundColor=fill, strokeColor=stroke,
               strokeStyle="dashed" if k == "tbd" else "solid", roundness={"type": 3})
        S.text(cx + 56, cy + 2, name, fs=18)


def row(x0, y, w, gap, items, kind="stdb", fs=20, pad=0):
    """Boxes side by side with one shared height."""
    h = max(measure(lbl, w, fs) for lbl, _ in items) + pad
    return [S.box(x0 + i * (w + gap), y, w, lbl, k or kind, h=h, fs=fs) for i, (lbl, k) in enumerate(items)]


# ---------------------------------------------------------------- 1. Overview
def overview(y0):
    W, H = 2700, 600
    S.begin_frame("1 · Overview", 0, y0, W, H)
    title("How BandIt fits together",
          "SpacetimeDB holds the live, exact state. The Evidence Engine, built on Elastic, validates, organizes and "
          "ranks by meaning. The Decision Engine, Claude agents plus code, decides each insurance claim. Bright Data, "
          "Nessie and one Vultr server sit around them.", width=1800)
    legend(1900, 34, tbd=False)

    scr_l = ("Screens\nattendee page /t/{token}, host portal /organizer, the medic on the tap page, "
             "photographer /photo")
    bd_l = "Bright Data Web MCP\nscrapes the event's public pages before the doors open"
    top_h = max(measure(scr_l, 760), measure(bd_l, 520))
    screens = S.box(600, 240, 760, scr_l, "web", h=top_h)
    bd = S.box(1580, 240, 520, bd_l, "ext", h=top_h)

    db_l = ("SpacetimeDB on Maincloud: the band1t module\nbands, zones, incidents, medical cards, claims, wallets, "
            "the people graph; reducers write it, timers keep it current, views decide who sees what")
    ee_l = ("The Evidence Engine (Elastic Serverless)\norganizes the scrape, validates each claim and finds similar "
            "past claims, ranks each recap")
    mid_h = max(measure(db_l, 760), measure(ee_l, 520))
    my = 240 + top_h + 150
    stdb = S.box(600, my, 760, db_l, "stdb", h=mid_h)
    ee = S.box(1580, my, 520, ee_l, "ext", h=mid_h)

    bands = S.box(60, 240, 340, "Bands and station markers\ncrowd colors, SOS and the light circle run on the band "
                                "itself", "device")
    bridge = S.box(60, 0, 340, "Gateway and bandit-bridge\non the venue laptop", "rust", cy=L(stdb.cy))

    zy = L(stdb.bottom) + 110
    api = S.box(600, zy + 60, 400, "bandit-api and bandit-indexer\nserve the pages; copy rows one way into the "
                                   "Evidence Engine", "rust")
    cl_l = "Claude API\nclaude-opus-5-5"
    ns_l = "Nessie (Capital One)\nthe $200 wallet: merch purchases and claim payouts"
    cl_h, ns_h = measure(cl_l, 400), measure(ns_l, 400)
    de = S.box(1060, zy + 60, 440, "The Decision Engine: bandit-workers\nClaude agents read and review; code decides "
                                   "coverage, amounts and learned rules", "rust", h=50 + cl_h + 40 + ns_h + 20)
    claude = S.box(2200, zy + 110, 400, cl_l, "ext", h=cl_h)
    nessie = S.box(2200, zy + 110 + cl_h + 40, 400, ns_l, "ext", h=ns_h)

    S.zone(40, 180, 380, L(bridge.bottom) + 40 - 180, "At the venue", "device")
    S.zone(560, zy, 980, L(de.bottom) + 30 - zy, "One Vultr server", "rust")

    S.v(bands, bridge, x=bands.cx, label="radio, USB")
    S.h(bridge, stdb, y=stdb.cy, label="ingest_band")
    S.v(screens, stdb, x=screens.cx, label="subscriptions,\nreducer calls", both=True)
    S.v(bd, ee, x=bd.cx, label="scraped records")
    S.h(ee, stdb, y=stdb.cy, label="import_event in,\none-way copy out", both=True)
    S.v(stdb, api, x=api.cx, label="reads rows")
    S.v(stdb, de, x=(de.x + stdb.right) / 2, label="jobs and\nresults", both=True)
    ey = de.y + 25
    S.link(de, "r", ee, "b", fa=25 / de.h, via=[(ee.cx, ey), (ee.cx, (ey + ee.bottom) / 2)],
           label="claim copy out,\npast claims back", both=True)
    S.h(de, claude, y=claude.cy, label="AI calls")
    S.h(de, nessie, y=nessie.cy, label="purchases, deposits")
    return S.end_frame()


# ---------------------------------------------------------------- 2. Architecture
def architecture(y0):
    W, H = 2830, 600
    S.begin_frame("2 · Architecture", 0, y0, W, H)
    title("BandIt architecture",
          "SpacetimeDB holds the live, exact state and every write. The Evidence Engine, built on Elastic, validates, "
          "organizes and ranks by meaning. The Decision Engine, Claude agents plus code, makes the claim decisions. "
          "Bright Data scrapes the web before the event. Nessie moves the money.")
    legend(1900, 34)

    # browsers across the top
    ops_l = "Host portal at /organizer\none page for all staff: Live, Attendees, Claims, Event graph, Photos, Merch, Kibana, plus Bands in test mode; Event ended"
    app_l = "Attendee page at /t/{token}\nband setup, then a thank-you; turns into the recap live when the event ends"
    top_h = max(measure(ops_l, 320), measure(app_l, 420))
    Y0 = 190 + top_h + 80 + 70  # top of the SpacetimeDB, services and Elastic zones
    ops = S.box(880, 230, 320, ops_l, "web", h=top_h)
    app = S.box(1230, 230, 420, app_l, "web", h=top_h)
    auth = S.box(1980, 230, 330, "SpacetimeAuth\nmagic-link sign-in for attendees, staff and the module owner", "ext", h=top_h)
    kib = S.box(2420, 230, 350, "Kibana\nimport runs, bandit-organizer decisions, three dashboards", "ext", h=top_h)

    # SpacetimeDB
    S.text(880, Y0 + 50, "Live, exact state. Every write is a reducer call: one transaction, all or nothing. "
                     "Each change is pushed to every subscribed screen. Scheduled reducers (watch_bands, sweep, "
                     "social_tick, crowd_tick, job_reaper) keep it current inside the database.", fs=18, width=580)
    y = Y0 + 190
    venue, social = row(880, y, 280, 20, [
        ("Venue\nevent_state, zones, organizations, booths, schedule, scraped profiles", None),
        ("Social\nvisits, people you spent time with, the people graph, people in photos; the crowd: start_crowd, up to 2,000 bands from id 100", None)])
    y += venue.h + 30
    band1t, safety = row(880, y, 280, 20, [
        ("Band and encounter model (TBD Leo)\nbands, stations, encounters, zone visits", "tbd"),
        ("Safety\nincidents from SOS and falls; zone risk, exit colours, buzz", None)])
    y += band1t.h + 30
    insurance, pay = row(880, y, 280, 20, [
        ("Insurance\nclaims, evidence packs, learned rules, ledger, claimant_account (the Nessie wallet)", None),
        ("Payments and merch\nthe wallet_entry ledger, merch templates and orders", None)])
    y += insurance.h + 30
    jobs, roles = row(880, y, 280, 20, [
        ("Jobs\nslow and outside work, done by bandit-workers", None),
        ("Roles and views\nSpacetimeAuth gives each person one identity; the owner grants staff roles with grant_role; views return only the caller's rows", None)])
    stdb_bottom = L(jobs.bottom) + 30

    # venue floor and laptop
    bands = S.box(60, 300, 280, "Bands x9\n6 lite, 3 full with IMU and vibration; count neighbours, "
                                "show colours, SOS", "device")
    stations = S.box(60, L(bands.bottom) + 80, 200, "Station markers 101 to 105\nat the exits: zone anchors, exit colours",
                     "device")
    gateway = S.box(60, 0, 280, "Gateway\nESP32-C3 on USB", "device", cy=L(band1t.cy))
    cli = S.box(460, 0, 300, "bandit-claims (command-line tool)\ndrives test bands 90 to 99 through report_test_band and plants the claims", "rust",
                cy=L(venue.cy))
    bridge = S.box(460, 0, 300, "bandit-bridge\nserial lines in, ingest_band on each change and at most once a second per band, commands out",
                   "rust", cy=L(band1t.cy))
    camera = S.box(60, 0, 280, "Overhead phone camera\n(TBD Leo)", "tbd", cy=L(jobs.cy))
    vision = S.box(460, 0, 300, "bandit-vision (TBD Leo)\ncounts, person-down alerts, photo features", "tbd",
                   cy=L(jobs.cy))

    # Rust services
    api = S.box(1640, Y0 + 70, 300, "bandit-api\nserves both web apps; POST /api/blobs, GET /api/recap, /api/dev routes; holds the Elastic key", "rust")
    indexer = S.box(1640, L(api.bottom) + 50, 300, "bandit-indexer\none-way copy of booths and interests into "
                                                    "the Evidence Engine", "rust")
    bd_label = "Bright Data Web MCP\nscrapes event pages, company pages, the venue on Google Maps and the floor plan"
    bd_h = measure(bd_label, 250)
    ingest = S.box(1640, L(indexer.bottom) + 50, 300, "bandit-ingest\nruns once before the event: fetch, organize, "
                                                       "import", "rust", h=bd_h + 76)
    cl_label = "Claude API\nagents for the judgment calls: read bills, review causation, draft letters"
    ns_label = "Nessie (Capital One)\nthe wallet connected at band setup, claim payouts, merch purchases"
    cl_h, ns_h = measure(cl_label, 250), measure(ns_label, 250)
    wy = L(ingest.bottom) + 50
    workers = S.box(1640, wy, 300, "bandit-workers\nruns the jobs: Claude calls, Nessie payments, claim "
                                   "precedents", "rust", h=cl_h + 80 + ns_h)
    bd = S.box(2070, L(ingest.y), 250, bd_label, "ext", h=bd_h)
    claude = S.box(2070, wy, 250, cl_label, "ext", h=cl_h)
    nessie = S.box(2070, wy + cl_h + 80, 250, ns_label, "ext", h=ns_h)

    # Elastic boxes line up with the services that use them
    idx = S.box(2420, L(api.y) + 12, 350, "Order by meaning\nbandit-booths and bandit-people: GET /api/recap puts "
                                          "the people and booths closest to what the attendee is into first", "ext",
                h=indexer.bottom - api.y - 2)
    org = S.box(2420, L(ingest.y), 350, "Organize scraped records\nWorkflow bandit-organize: ES|QL joins, then "
                                        "the bandit-organizer agent, a reason for every merge", "ext", h=ingest.h)
    claims = S.box(2420, wy, 350, "Validate claim evidence\npipeline bandit-claims-validate; similar past claims "
                                  "ranked as precedents", "ext", h=workers.h)

    zb = max(stdb_bottom, L(workers.bottom) + 30, L(vision.bottom) + 30)
    venue_z = S.zone(40, 200, 320, zb - 200, "Venue floor", "device")
    S.zone(440, 200, 340, zb - 200, "Team laptop, online through a phone hotspot", "rust")
    S.zone(840, 190, 1950, top_h + 80, "Browsers", "web")
    stdb = S.zone(860, Y0, 620, zb - Y0, "SpacetimeDB Maincloud: the band1t module", "stdb")
    S.zone(1620, Y0, 340, zb - Y0, "Rust services on a Vultr server", "rust")
    ez = S.zone(2400, Y0, 390, zb - Y0, "The Evidence Engine (Elastic Serverless)", "ext")

    S.v(stations, bands, x=stations.cx, label="station\nbeacons")
    S.v(bands, gateway, x=S.ox + 312, label="ESP-NOW\n10 Hz", both=True)
    S.h(gateway, bridge, label="USB serial")
    S.h(bridge, band1t, label="ingest_band,\ncommands", both=True)
    S.h(cli, stdb, y=cli.cy, label="report_\ntest_band")
    S.h(camera, vision)
    S.h(vision, stdb, y=vision.cy, label="alerts")
    S.v(app, stdb, x=app.cx, label="subscriptions,\nreducer calls", both=True)
    S.v(ops, stdb, x=ops.cx, label="end_event,\nclaim decisions", both=True)
    S.link(app, "r", api, "t", fa=0.7, via=[(api.cx, app.y + 0.7 * app.h)], label="PDFs, recap order")
    S.h(app, auth, y=app.y + 0.3 * app.h, label="sign-in")
    S.v(kib, ez, x=kib.cx, label="reads")
    S.h(stdb, api, y=api.cy, label="reads rows")
    S.h(stdb, indexer, y=indexer.cy, label="subscribes")
    S.h(ingest, stdb, y=ingest.cy, label="import_event")
    S.h(stdb, workers, y=workers.cy, label="jobs and\nresults", both=True)
    S.h(api, idx, y=api.cy, label="recap order")
    S.h(indexer, idx, y=indexer.cy, label="one-way copy")
    S.h(ingest, bd, y=bd.cy, label="fetch")
    S.h(ingest, org, y=bd.bottom + 38, label="records in, bundle back", both=True)
    S.h(workers, claude, y=claude.cy, label="AI calls")
    S.h(workers, claims, y=claude.bottom + 40, label="claim copy out, precedents back", both=True)
    S.h(workers, nessie, y=nessie.cy, label="bank calls")
    return S.end_frame()


# ---------------------------------------------------------------- 3. SpacetimeDB live loop
def spacetimedb(y0):
    W, H = 2800, 600
    S.begin_frame("3 · SpacetimeDB live loop", 0, y0, W, H)
    title("SpacetimeDB runs the live event",
          "One Rust module, band1t, on Maincloud: 72 tables, 86 reducers, 54 views and 5 timers. A reducer is a "
          "function that runs as one transaction. Timers run reducers on a schedule. Every screen subscribes to "
          "views, so each change reaches it as soon as it commits.")
    x0 = 510
    ingest, watch, resolve = row(x0, 270, 660, 115, [
        ("ingest_band\nreducer: writes the band row: state, zone, last seen", None),
        ("watch_bands, every 500 ms\nopens an sos or fall incident and records the light circle as witnesses in "
         "incident_band, in one transaction", None),
        ("resolve_incident\nreducer, ops or medic: queues the band's clear command and opens the claim", None)])
    S.text(x0, L(ingest.bottom) + 34, "Timers: scheduled reducers", fs=20, color=KINDS["stdb"][1])
    timers = row(x0, L(ingest.bottom) + 80, 506, 62, [
        ("sweep, every 1 s\nmarks bands, stations and the gateway offline after 5 s without a message", None),
        ("social_tick, every 1 s\nzone_visit becomes a visit, encounter becomes a social_encounter, plus graph "
         "links", None),
        ("crowd_tick, every 2 s\nmoves the crowd from start_crowd: up to 2,000 bands from id 100", None),
        ("job_reaper, every 10 s\nputs a job back in the queue when its 60 s lease runs out; 3 attempts", None)])
    views_l = ("Views\neach caller gets only their rows: my_band, my_visits, my_encounters, my_wallet; "
               "medic_medical_cards: the cards this medic tapped; claims_board: staff only; worker_jobs: workers "
               "only; event_graph: one shared result with no names")
    roles_l = ("Roles: staff_role\nonly the owner can grant_role: ops, medic, photographer, tester, worker, vision, "
               "ingest, api, indexer")
    vy = L(timers[0].bottom) + 50
    vh = max(measure(views_l, 1642), measure(roles_l, 506))
    views = S.box(x0, vy, 1642, views_l, "stdb", h=vh)
    S.box(x0 + 3 * 568, vy, 506, roles_l, "stdb", h=vh)
    mod_bottom = L(views.bottom) + 40

    bridge = S.box(65, 0, 340, "Gateway and bandit-bridge\ncalls ingest_band at once on a change, otherwise at "
                               "most once a second per band", "rust", cy=L(ingest.cy))
    beacon = S.box(65, L(bridge.bottom) + 110, 340, "Band beacon\nten times a second over ESP-NOW", "device")

    sy = mod_bottom + 60 + 60
    scr = row(x0, sy, 370, 54, [
        ("Attendee page /t/{token}\nmy_attendee, my_band, my_visits, my_encounters, my_photos, my_wallet, "
         "my_merch_suggestions", None),
        ("Host portal /organizer\nband, open_incidents, claims_board, the board_ views, event_graph", None),
        ("Medic on the tap page\nrequest_medical_card logs the tap; medic_medical_cards returns the card", None),
        ("Photographer /photo\nregister_photo tags the people whose bands were in that zone", None)], kind="web", pad=30)
    auth = S.box(65, 0, 340, "SpacetimeAuth\nOIDC sign-in; its ID token is the SpacetimeDB identity", "ext",
                 cy=L(scr[0].cy))

    S.zone(40, 190, 390, L(beacon.bottom) + 40 - 190, "At the venue", "device")
    S.zone(470, 190, 2290, mod_bottom - 190, "SpacetimeDB Maincloud: the band1t module", "stdb")
    S.zone(470, mod_bottom + 60, L(scr[-1].right, "x") + 40 - 470, L(scr[0].bottom) + 40 - mod_bottom - 60,
           "Screens", "web")

    S.v(beacon, bridge, x=bridge.cx, label="radio")
    S.h(bridge, ingest)
    S.h(ingest, watch, label="band rows")
    S.h(watch, resolve, label="incident")
    for i, s in enumerate(scr):
        S.v(views, s, x=s.cx, label="subscriptions" if i == 0 else None)
    S.h(auth, scr[0], label="ID token")
    return S.end_frame()


# ---------------------------------------------------------------- 4. Data pipeline
def pipeline(y0):
    W, H = 3840, 600
    S.begin_frame("4 · Event data pipeline", 0, y0, W, H)
    title("Event data pipeline: Bright Data, then the Evidence Engine, then SpacetimeDB",
          "Runs once before the event from any event's public pages (Cal Hacks 13.0 is the first run), so no live "
          "step waits on a scrape. Bright Data does every fetch, Rust does the deterministic stages, the Evidence "
          "Engine organizes, and SpacetimeDB loads the checked bundle in one transaction.")
    L1, L2, L3, L4 = (170, 440), (460, 850), (870, 1300), (1320, 1550)

    seed = S.box(300, 0, 260, "Event seed\nstart URLs: the event site, its sponsor list on Devpost, the "
                              "schedule, the floor plan page", "rust", cy=650)
    bd = S.box(620, 230, 360, "Bright Data Web MCP\nextract with a schema per page, search_engine, LinkedIn and "
                              "Crunchbase company tools, the venue on Google Maps, browser screenshots", "ext")
    fetch = S.box(670, 0, 260, "fetch\none raw snapshot per call, kept as versioned files", "rust", cy=650)
    mp = S.box(1030, 510, 270, "map\nbooth centres from pixels to metres; each booth gets its nearest "
                               "station's zone", "rust")
    parse = S.box(1030, L(mp.bottom) + 40, 270, "parse\nrecords checked against their schema", "rust")
    claude = S.box(1030, 230, 270, "Claude API\nfloorplan_check reads the booth numbers off the plan image",
                   "ext")
    elabels = [
        (1320, 300, "Raw indices\nbandit-raw-pages, bandit-raw-orgs, bandit-raw-plan"),
        (1690, 320, "Workflow bandit-organize\nES|QL LOOKUP JOIN: exact matches by domain, booth number and stage"),
        (2080, 320, "Agent bandit-organizer\nAgent Builder decides the fuzzy matches, a reason for every merge in bandit-organizer-decisions"),
        (2470, 290, "bandit-bundles\none organized bundle per run, plus the gaps list")]
    eh = max(measure(t, w) for _, w, t in elabels)
    e1, e2, e3, e4 = [S.box(x, 930, w, t, "ext", h=eh) for x, w, t in elabels]
    gapfill = S.box(2080, 230, 320, "Bright Data extract\ngap fill for the agent: at most 10 calls per run, saved as "
                                    "snapshots", "ext", dashed=True)
    kib = S.box(1690, L(e1.y) + eh + 50, 1070, "Kibana: the Workflows run view shows every step and every merge "
                                                "with the agent's reason; dashboards over bandit-pipeline-events: "
                                                "BandIt · Cal Hacks 13.0 · scrape pipeline, and "
                                                "BandIt · Cal Hacks 13.0 · sponsors and prizes", "ext")
    validate = S.box(2470, 0, 290, "validate\nthe same rules as import_event; saved as the last good bundle",
                     "rust", cy=650)
    imp = S.box(2830, 1380, 300, "import_event\none transaction: the whole event or nothing; upsert by "
                                 "source_key", "stdb")
    tables = S.box(3200, 0, 300, "Live tables\nvenue, hall, organization, booth, schedule_slot, person "
                                 "(unclaimed profiles)", "stdb", cy=L(imp.cy))
    indexer = S.box(3200, 0, 300, "bandit-indexer\none-way copy of booths into bandit-booths for the recap "
                                  "order", "rust", cy=L(e1.cy))
    ops = S.box(3560, 0, 240, "Host portal\nKibana tab: import runs and what was loaded", "web", cy=L(imp.cy))

    S.zone(40, L1[0], W - 80, L1[1] - L1[0], "Outside APIs: Bright Data and Claude", "ext")
    S.zone(40, L2[0], W - 80, L2[1] - L2[0], "bandit-ingest (Rust)", "rust")
    S.zone(40, L3[0], W - 80, L3[1] - L3[0], "The Evidence Engine (Elastic Serverless): organize and check", "ext")
    S.zone(40, L4[0], W - 80, L4[1] - L4[0], "SpacetimeDB", "stdb")

    S.link(seed, "t", bd, "l", via=[(seed.cx, bd.cy)], label="start URLs")
    S.v(bd, fetch, x=bd.x + 0.42 * bd.w, label="JSON records,\nimages")
    S.link(fetch, "r", mp, "l", fa=0.25, via=[(fetch.right + 50, fetch.y + 0.25 * fetch.h), (fetch.right + 50, mp.cy)])
    S.link(fetch, "r", parse, "l", fa=0.75,
           via=[(fetch.right + 50, fetch.y + 0.75 * fetch.h), (fetch.right + 50, parse.cy)])
    S.v(claude, mp, x=claude.cx, label="booth centres")
    S.link(parse, "r", e1, "t", via=[(e1.x + 40, parse.cy)], fb=40 / e1.w)
    S.link(mp, "r", e1, "t", via=[(e1.x + 110, mp.cy)], fb=110 / e1.w, label="booth geometry")
    S.h(e1, e2)
    S.h(e2, e3)
    S.h(e3, e4)
    S.v(e3, gapfill, x=e3.cx, label="capped\ngap fill", dashed=True)
    S.v(e3, kib, x=e3.cx, dashed=True)
    S.v(e4, validate, x=e4.cx, label="bundle back")
    S.link(validate, "r", imp, "t", via=[(imp.cx, validate.cy)], label="last good bundle")
    S.h(imp, tables, label="rows")
    S.v(tables, indexer, x=tables.cx, label="subscribes")
    S.h(tables, ops, label="rows")
    return S.end_frame()


# ---------------------------------------------------------------- 5. The Evidence Engine
def evidence(y0):
    W, H = 2800, 600
    S.begin_frame("5 · The Evidence Engine", 0, y0, W, H)
    title("The Evidence Engine, built on Elastic",
          "Elastic does the work SpacetimeDB cannot: meaning. It gets one-way copies, never live state, and sends "
          "back an organized bundle, claim checks with similar past claims, and a recap order. All of it runs on "
          "Elastic Serverless.")
    lanes = []
    y = 190

    def lane(label, items, w, gap):
        nonlocal y
        boxes = row(80, y + 60, w, gap, items, pad=25)
        lanes.append((y, L(boxes[0].bottom) + 40, label))
        y = L(boxes[0].bottom) + 40 + 24
        for a, b in zip(boxes, boxes[1:]):
            S.h(a, b)
        return boxes

    lane("Organize the scrape", [
        ("bandit-ingest\nwrites bandit-raw-pages, bandit-raw-orgs, bandit-raw-plan", "rust"),
        ("Workflow bandit-organize\nES|QL LOOKUP JOIN: exact matches by run_id and domain, and by run_id and "
         "location", "ext"),
        ("Agent bandit-organizer, Agent Builder\nmerges the fuzzy matches with the tools bandit.records and "
         "bandit.candidates; a reason for every merge", "ext"),
        ("bandit-bundles\none organized bundle per run", "ext"),
        ("import_event\nSpacetimeDB loads the checked bundle in one transaction", "stdb")], 456, 90)
    lane("Validate each claim and find similar past claims", [
        ("bandit-workers, job claim_verify\na de-identified copy of the claim", "rust"),
        ("ingest pipeline bandit-claims-validate\nchecks the copy as it is indexed into bandit-claims; it never "
         "rejects; its verdict is the check elastic_validation", "ext"),
        ("Similar past claims\na semantic query on narrative: the top 3 of 30 seeded past claims", "ext"),
        ("submit_claim_checks\nclaim_precedent rows in SpacetimeDB", "stdb")], 600, 80)
    lane("Rank each recap by meaning", [
        ("bandit-indexer\ncopies findable attendees and booths one way from SpacetimeDB", "rust"),
        ("bandit-people and bandit-booths\nsemantic_text fields", "ext"),
        ("bandit-api GET /api/recap\norders the people and booths by closeness to your interests", "rust"),
        ("Your recap\nSpacetimeDB views give the exact lists; the Evidence Engine gives the order", "web")], 600, 80)
    lane("Show it in Kibana", [
        ("Kibana\ndashboards \"BandIt · Cal Hacks 13.0 · scrape pipeline\", \"BandIt · Cal Hacks 13.0 · sponsors and "
         "prizes\" and \"BandIt claims evidence\"; logs in bandit-organizer-decisions and bandit-pipeline-events",
         "ext")], 2640, 0)
    for top, bottom, label in lanes:
        S.zone(40, top, 2720, bottom - top, label, "ext")
    return S.end_frame()


# ---------------------------------------------------------------- 6. Insurance (the Decision Engine)
def insurance(y0):
    W, H = 4020, 600
    S.begin_frame("6 · The Decision Engine", 0, y0, W, H)
    title("The Decision Engine: insurance claim flow (Hyphenate track)",
          "The Decision Engine is the Claude agents in bandit-workers plus the code that decides coverage, amounts "
          "and learned rules. An incident becomes a claim with no form. The venue's liability policy pays. Claude reads the bill and "
          "judges causation, but never sees or sets an amount: code prices every line and decides the route. "
          "The organizer's approval teaches a rule that settles the next similar claim by itself.")
    lanes = {"L1": (170, 420), "L2": (440, 900), "L3": (920, 1160), "L4": (1180, 1420), "L5": (1440, 1720),
             "L6": (1740, 2000)}
    c = {k: (a + b) / 2 for k, (a, b) in lanes.items()}
    top2 = 590  # centre of the upper row in the SpacetimeDB lane

    fall = S.box(300, 0, 260, "Fall or SOS\nthe band flags it; bands close by pulse blue and become witnesses",
                 "device", cy=c["L1"] + 15)
    medic = S.box(610, 0, 260, "Medic (paramedic)\ntreats the fall, files the bill PDF in the host portal, resolves", "web",
                  cy=c["L1"] + 15)
    cam = S.box(1500, 0, 260, "Overhead camera (TBD Leo)\na second source for falls; sees property damage", "tbd",
                cy=c["L1"] + 15)
    inc = S.box(300, 0, 260, "Incident\nsnapshot and witnesses frozen in one transaction", "stdb", cy=top2)
    opn = S.box(610, 0, 260, "Claim opens on resolve\none per injured person, one per property incident", "stdb",
                cy=top2)
    bill = S.box(900, 0, 270, "Bill reader: claim_record_extract\nClaude reads the bill PDF into lines; it never sees the fee schedule",
                 "ext", cy=c["L3"] + 10)
    price = S.box(1200, 0, 260, "Price in code\nthe fee schedule caps each line, billed vs paid; duplicate bill "
                                "check", "stdb", cy=top2)
    pack = S.box(1500, 0, 260, "Evidence pack, hashed\nband report, light circle, staff notes, bill, policy", "stdb",
                 cy=top2)
    prec = S.box(1500, 0, 320, "Similar past claims\nbandit-claims-validate checks a de-identified copy; the top 3 come "
                               "back as checks and never refuse", "ext", cy=c["L4"] + 10)
    checks = S.box(1820, 0, 380, "Code checks at claim open\ncorroboration, staff, cover, payout", "stdb", shape="diamond",
                   h=220, fs=18, cy=top2)
    refused = S.box(1880, 0, 260, "Refused\nevery check listed, both values side by side", "bad", cy=810)
    cause = S.box(2190, 0, 300, "Causation review: claim_review\nClaude: does the injury follow from the fall? doubt sends it "
                                "to a person", "ext", cy=c["L3"] + 10)
    rule = S.box(2540, 0, 380, "Rule matches?\nshape, ceiling, corroborated, follows, not mass", "stdb",
                 shape="diamond", h=220, fs=18, cy=top2)
    auto = S.box(3030, 0, 260, "Auto-settled\ncites the rule version and who approved it", "good", cy=top2)
    route = S.box(2580, 0, 300, "The organizer decides\nevery claim no rule settles waits in the host portal's Claims tab, "
                                "3 or more hurt included", "web", cy=c["L5"] + 10)
    approve = S.box(3030, 0, 280, "Approve, learn on\nfails closed as stale if the amount or pack changed; writes "
                                  "rule v1 with the organizer's name", "web", cy=c["L5"] + 10)
    settle = S.box(3370, 0, 260, "Settling\nledger journals: J1 reserve, J2 approval, J3 paid", "stdb", cy=top2)
    payout = S.box(3370, 0, 280, "Payout\nclaim_payout deposits into the claimant's Nessie wallet; a property claim pays the "
                                 "repair vendor", "ext", cy=c["L6"] + 15)
    letters = S.box(3700, 0, 280, "Letters\nClaude drafts the decision letter and a recovery letter worded as a "
                                  "question", "ext", cy=c["L3"] + 10)
    recon = S.box(3700, 0, 280, "Reconciled\nthe insurer pays the receivable (J4)", "good", cy=top2)

    names = {"L1": "Bands and staff on the floor",
             "L2": "SpacetimeDB: claim state; the Decision Engine's code decides every amount",
             "L3": "The Decision Engine: Claude agents, run as jobs by bandit-workers",
             "L4": "The Evidence Engine (Elastic Serverless)",
             "L5": "The organizer, in the host portal's Claims tab", "L6": "Nessie"}
    kinds = {"L1": "device", "L2": "stdb", "L3": "ext", "L4": "ext", "L5": "web", "L6": "ext"}
    for k, (a, b) in lanes.items():
        S.zone(40, a, W - 80, b - a, names[k], kinds[k])

    S.v(fall, inc)
    S.v(medic, opn)
    S.text(L(fall.cx, "x") + 10, L(fall.bottom) + 6, "flag", fs=16, color="#343a40")
    S.text(L(medic.cx, "x") + 10, L(medic.bottom) + 6, "note, bill, resolve", fs=16, color="#343a40")
    S.h(inc, opn)
    S.link(opn, "r", bill, "t", via=[(bill.cx, opn.cy)], label="bill PDF")
    S.link(bill, "r", price, "b", via=[(price.cx, bill.cy)], label="lines")
    S.h(price, pack)
    S.v(pack, prec, x=pack.x + 0.5 * pack.w, label="precedent\nsearch", dashed=True)
    S.v(cam, pack, x=pack.cx + 60, dashed=True)
    S.h(pack, checks, y=checks.cy)
    S.v(checks, refused, x=checks.cx, label="fails")
    S.link(checks, "r", cause, "t", via=[(cause.cx, checks.cy)], label="pass, J1 reserve")
    S.link(cause, "r", rule, "l", via=[(rule.x - 30, cause.cy), (rule.x - 30, rule.cy)], label="verdict")
    S.h(rule, auto, y=rule.cy, label="yes")
    S.v(rule, route, x=rule.cx, label="no")
    S.h(route, approve, label="approve")
    S.link(route, "l", refused, "b", via=[(refused.cx, route.cy)], label="refuse_claim, J1r")
    # the learning loop back into the rule check
    lx = rule.right + 40
    ly = rule.cy + 55
    end_x = rule.cx + (rule.w / 2) * (1 - 55 / (rule.h / 2))
    S.arrow(approve, rule, [(approve.x, approve.y + 22), (lx, approve.y + 22), (lx, ly), (end_x + 6, ly)],
            dashed=True, color="#2b8a3e")
    S.text(L(lx, "x") + 14, c["L3"] - 30, "rule v1 settles\nthe next similar\nfall by itself", fs=18, color="#2b8a3e")
    S.h(auto, settle, label="J2")
    S.link(approve, "r", settle, "b", fb=0.3, via=[(settle.x + 0.3 * settle.w, approve.cy)])
    S.v(settle, payout, x=settle.x + 0.72 * settle.w, label="claim_payout")
    S.h(settle, recon, label="insurer\npays")
    S.link(settle, "b", letters, "t", fa=0.92, via=[(settle.x + 0.92 * settle.w, S.oy + 870), (letters.cx, S.oy + 870)])

    py = lanes["L6"][1] + 50
    S.panel(40, py, 1180, "Live learning, as the judges see it",
            "1. A live fall becomes a claim. No rule exists yet, so it waits for the organizer in the host "
            "portal's Claims tab.\n2. A late note makes the first tap fail as stale; the organizer approves "
            "again. The payout lands in the wallet and rule v1 is created with the organizer's name on it.\n3. "
            "Maya (band 91) falls the same way and settles in seconds under rule v1.\n4. A fake with witnesses in "
            "another zone is refused by code with every check listed.")
    S.panel(1260, py, 1260, "Edge cases, live or in the stress test",
            "Injury happened at home: Claude says doubt, a person decides.\nWitness bands in another zone: "
            "refused at claim open as witness_zone, zones side by side.\nAmount changed while approving: fails "
            "closed as stale.\nSame bill scanned again: marked duplicate, pays nothing, refused as zero_payout."
            "\nInjured person is venue staff: refused at claim open; workers' comp applies.\nThree or more hurt in "
            "one incident: no claim settles by rule; the organizer decides each.\nOnly code at claim open and the "
            "organizer refuse.", kind="bad")
    S.panel(2560, py, 1340, "Accuracy run and scorecard, before judging",
            "bandit-claims plants 3 rounds of 12 genuine claims and 6 decoys (sitting down, dropped phone, fake "
            "witnesses) through the same reducers a medic uses.\nStraight-through rate per round, rising as rules "
            "are learned.\nDollars wrongly paid on decoys: target $0.\nAuto-settle precision and recall; bill-review "
            "savings; incident to payout time; human touches per claim.\nShown in the Claims tab and the Kibana "
            "dashboard BandIt claims evidence.", kind="good")
    return S.end_frame()


# ---------------------------------------------------------------- 7. Claude jobs
def claude_jobs(y0):
    W, H = 2600, 600
    S.begin_frame("7 · Claude jobs", 0, y0, W, H)
    title("Claude jobs in bandit-workers",
          "Claude reads and writes words; code checks every answer and decides every amount. The model is "
          "claude-opus-5-5.")
    jobs = [
        ("medical_extract\na medical history or insurance card PDF becomes the medical card; only items that cite "
         "a page are kept", "apply_medical_extract\nthe attendee confirms the card"),
        ("claim_record_extract\nthe clinic bill PDF, read with medical_record_schema and checked by validate_record",
         "apply_medical_record\nthe bill lines go to the fee schedule in code"),
        ("claim_review\na verdict and causation; validate_review: consistent needs no concerns and causation "
         "supported", "submit_claim_review\na doubt sends the claim to the organizer"),
        ("claim_draft\nthe notice of loss fnol in the ACORD 3 layout, the approver summary and the claimant "
         "determination", "attach_claim_letters\ncode checks every figure, fact id and heading; a template "
                           "replaces a letter that still fails"),
        ("recovery_letter\nfor a property claim", "attach_recovery_letter"),
    ]
    y = 260
    pairs = []
    for job_l, res_l in jobs:
        h = max(measure(job_l, 960), measure(res_l, 800))
        pairs.append((S.box(600, y, 960, job_l, "ext", h=h), S.box(1720, y, 800, res_l, "stdb", h=h)))
        y += h + 40
    bottom = L(pairs[-1][0].bottom)
    queue = S.box(70, 260, 380, "SpacetimeDB job rows\nbandit-workers reads them through worker_jobs and takes a "
                                "60 s lease", "stdb", h=bottom - 260)
    S.zone(40, 190, 440, bottom + 40 - 190, "SpacetimeDB: the job queue", "stdb")
    S.zone(560, 190, 1040, bottom + 40 - 190, "Claude API, called by bandit-workers", "ext")
    S.zone(1680, 190, 880, bottom + 40 - 190, "Result reducers in SpacetimeDB", "stdb")
    for i, (job, res) in enumerate(pairs):
        S.h(queue, job, y=job.cy, label="lease" if i == 0 else None)
        S.h(job, res, label="result" if i == 0 else None)
    S.panel(40, bottom + 90, 2520, "Checks on every call",
            "Every call asks for json_schema output.\n"
            "An answer that breaks a rule is asked again once with the problems listed (ask_twice); the second "
            "call's kind is <kind>_retry.\n"
            "Every call, with its tokens, latency and any error, is recorded in model_call.", kind="note")
    return S.end_frame()


# ---------------------------------------------------------------- 8. Social and recap
def social(y0):
    W, H = 2860, 600
    S.begin_frame("8 · Social and recap flow", 0, y0, W, H)
    title("Social and recap flow",
          "The bands are the identity during the event. Memories come only from band, zone and time; the "
          "people you see afterwards are the ones you actually spent time with. When the host ends the event, "
          "every open attendee page turns into the recap live.")
    zt, zb = 190, 1320

    # 1. at the door
    a = []
    y = 260
    for lbl, k in [("Tap the band with your phone\nits NFC sticker opens your band's page, /t/{token}", "web"),
                   ("Sign in with SpacetimeAuth\na magic link at the first tap; the same identity on every device", "ext"),
                   ("Press the band's button when it blinks white\nthe band is now yours", "web"),
                   ("Your name and Meta socials\nInstagram, Facebook, Threads, typed by you; findable on or off", "web"),
                   ("Medical history and insurance card PDFs\nClaude reads them into your medical card", "ext"),
                   ("Are you one of these?\none tap on your scraped speaker or exhibitor profile (claim_person)",
                    "web"),
                   ("Check your medical card\nwhat Claude read, confirmed once", "web"),
                   ("Connect your Capital One wallet\na $200 Nessie account: claim payouts land here, merch is "
                    "paid from it", "ext"),
                   ("You're all set\na thank-you; the page shows nothing else until the event ends", "web")]:
        b = S.box(70, y, 500, lbl, k)
        a.append(b)
        y = L(b.bottom) + 46
    for p, q in zip(a, a[1:]):
        S.v(p, q, x=p.cx)

    # 2. during the event
    b1 = S.box(720, 260, 330, "Bands and zones (TBD Leo)\nthe band and encounter model in band1t", "tbd")
    b2 = S.box(720, L(b1.bottom) + 60, 330, "social_tick every 1 s\nzone_visit becomes a visit, encounter becomes "
                                            "a social_encounter", "stdb")
    b3 = S.box(720, L(b2.bottom) + 70, 330, "Visits\nsame zone for 2 minutes or more, named by the zone's booth",
               "stdb")
    b4 = S.box(1100, 0, 330, "Encounter rule (TBD Leo)\nstarting default: both findable, together for 3 minutes; writes social_encounter",
               "tbd", cy=L(b3.cy))
    b5 = S.box(720, L(max(b3.bottom, b4.bottom)) + 70, 710, "People graph: people_link\nmet, visited, works at, "
                                                           "exhibits; written in the same transaction as the visit "
                                                           "or encounter", "stdb")
    b6 = S.box(1480, 260, 320, "Photographer's photo\nuploaded through POST /api/blobs; its zone is the photographer's band zone then",
               "web")
    b7 = S.box(1480, L(b2.y), 320, "Who is in the photo\nfindable people whose bands were in that zone when it was "
                                   "taken", "stdb")
    b8 = S.box(1480, L(b7.bottom) + 60, 320, "Photo features (TBD Leo)\npeople count and caption", "tbd")

    # 3. after the event
    c1 = S.box(1940, 260, 420, "The organizer taps Event ended\nin the host portal: end_event writes event_state; reopen_event undoes it", "web")
    c2 = S.box(1940, L(c1.bottom) + 50, 420, "Every open attendee page turns into the recap\nlive, by subscription to event_state; /t/{token} "
                                             "reopens it later on any device", "web")
    c3 = S.box(1940, L(c2.bottom) + 50, 420, "SpacetimeDB views\nmy_encounters, my_visits, my_photos: the exact lists of who "
                                             "and what", "stdb")
    c4 = S.box(2420, 0, 380, "The Evidence Engine orders the lists\nGET /api/recap on bandit-api, by meaning against your "
                             "interests (bandit-people, bandit-booths)", "ext", cy=L(c3.cy))
    c5 = S.box(1940, L(max(c3.bottom, c4.bottom)) + 60, 860, "Your recap, on the same tap link\n1. where you were: zones over time\n"
                                                             "2. the people you spent time with, and their Meta socials "
                                                             "when they allow it\n3. the booths you spent time at\n"
                                                             "4. your photos with the people you met in them, tap to "
                                                             "share\n5. make it merch",
               "web")
    c6 = S.box(1940, L(c5.bottom) + 60, 420, "Merch suggestions\na photo of you placed in a hand-made template "
                                             "(tee, mug, poster, sponsor booth items); top 3 by minutes at that booth",
               "stdb")
    c7 = S.box(2420, 0, 380, "Buy with one tap\nbuy_merch, with a size for tees, paid from the Capital One wallet through Nessie", "ext",
               cy=L(c6.cy))

    zb = max(L(a[-1].bottom), L(c7.bottom), L(b8.bottom)) + 40
    S.zone(40, zt, 560, zb - zt, "1. At the door", "web")
    S.zone(690, zt, 1140, zb - zt, "2. During the event", "stdb")
    S.zone(1910, zt, 920, zb - zt, "3. After the event", "plain")

    S.link(a[2], "r", b1, "l", via=[(a[2].right + 60, a[2].cy), (a[2].right + 60, b1.cy)], label="your band")
    S.v(b1, b2, x=b1.cx)
    S.v(b2, b3, x=b3.cx)
    S.link(b2, "r", b4, "t", fa=0.75, via=[(b4.cx, b2.y + 0.75 * b2.h)])
    S.v(b3, b5, x=b3.cx, label="visited")
    S.v(b4, b5, x=b4.cx, label="met")
    S.v(b6, b7, x=b6.cx)
    S.v(b8, b7, x=b8.cx, dashed=True, label="re-cap to\nthe count")
    S.h(b2, b7, y=b2.y + 0.3 * b2.h, label="who was in that zone")
    S.link(b5, "r", c3, "l", fa=0.5, fb=0.72, via=[(1870 + S.ox, b5.cy), (1870 + S.ox, c3.y + 0.72 * c3.h)])
    S.link(b7, "r", c3, "l", fa=0.5, fb=0.3, via=[(1850 + S.ox, b7.cy), (1850 + S.ox, c3.y + 0.3 * c3.h)],
           label="people\nin photos")
    S.v(c1, c2, x=c1.cx, label="event_state")
    S.v(c2, c3, x=c2.cx)
    S.h(c3, c4)
    S.v(c3, c5, x=c3.cx)
    S.link(c4, "b", c5, "t", fb=(c4.cx - c5.x) / c5.w, label="order")
    S.v(c5, c6, x=c6.cx)
    S.h(c6, c7, label="order")
    wallet = a[-2]
    S.link(wallet, "r", c7, "b", via=[(wallet.right + 60, wallet.cy), (wallet.right + 60, S.oy + zb + 40),
                                      (c7.cx, S.oy + zb + 40)], dashed=True, label="the same wallet")
    return S.end_frame()


# ---------------------------------------------------------------- 9. Merch
def merch(y0):
    W, H = 2880, 600
    S.begin_frame("9 · Merch", 0, y0, W, H)
    title("Merch from your night (Visa track)",
          "No shopping with your hands full at the event. After the event, the recap suggests merch with your own "
          "photo from the booths where you spent the most time, and you buy it with one tap from your wallet.")
    ins = []
    y = 260
    for lbl in ["Your booth time\nvisit minutes in each booth zone",
                "Your photos\nthe photographer's photos you are in",
                "Templates\nassets/merch/templates.json: 6 templates, tee, mug and poster, 3 plain and 3 sponsor; "
                "load_merch_templates; tee $25, mug $18, poster $15"]:
        b = S.box(80, y, 380, lbl, "stdb", h=measure(lbl, 380) + 25)
        ins.append(b)
        y = L(b.bottom) + 40
    view = S.box(580, 260, 380, "my_merch_suggestions view\nthe top 3, ranked by your minutes in the template's "
                                "booth zones, then a photo taken there, then plain before sponsor", "stdb",
                 h=ins[-1].bottom - ins[0].y)
    chain = [(1100, 380, "Your photo in the template\ndrawn on a canvas in the recap page; the server renders no "
                         "image", "web"),
             (1540, 380, "Buy with one tap\nbuy_merch(template_id, photo_id, size), only after end_event; tee "
                         "sizes S, M, L, XL", "web"),
             (2060, 400, "The merch_purchase job\na Nessie purchase from your $200 wallet; settle_merch_order marks "
                         "the order paid", "ext"),
             (2540, 300, "Paid order\nstaff see it in board_merch_orders; the flow ends at a paid order", "good")]
    ch = max(measure(t, w) for _, w, t, _ in chain) + 40
    boxes = [S.box(x, 0, w, t, k, h=ch, cy=L(view.cy)) for x, w, t, k in chain]
    zb = L(ins[-1].bottom) + 40
    S.zone(40, 190, 960, zb - 190, "SpacetimeDB", "stdb")
    S.zone(1060, 190, 900, zb - 190, "The recap page", "web")
    S.zone(2020, 190, 480, zb - 190, "Nessie, through bandit-workers", "ext")
    for b in ins:
        S.h(b, view, y=b.cy)
    S.h(view, boxes[0], label="top 3")
    for a, b in zip(boxes, boxes[1:]):
        S.h(a, b)
    return S.end_frame()


# ---------------------------------------------------------------- 10. Nessie wallet
def nessie(y0):
    W, H = 2480, 600
    S.begin_frame("10 · Nessie wallet", 0, y0, W, H)
    title("The Nessie wallet",
          "Each attendee gets a Nessie customer and checking account with $200. Merch purchases and claim payouts "
          "go through it. The Nessie sandbox records them but never moves a balance, so the module keeps its own "
          "exact ledger, wallet_entry.")
    rows = [
        ([("Connect your wallet at band setup\nconnect_wallet queues the job wallet_open with $200", "web"),
          ("Nessie: a customer and a checking account\nbandit-workers calls create_customer and create_wallet", "ext"),
          ("record_wallet\nclaimant_account and a wallet_entry opening of +$200", "stdb")], "wallet_open", "+$200"),
        ([("Buy merch with one tap on the recap\nbuy_merch: a merch_order in paying and the job merch_purchase",
           "web"),
          ("Nessie: a purchase at the merchant BandIt merch", "ext"),
          ("settle_merch_order\na negative wallet_entry purchase; the order is paid", "stdb")], "merch_purchase",
         "- price"),
        ([("A claim payout\nthe job claim_payout, queued when the claim settles", "stdb"),
          ("Nessie: a deposit into the attendee's account", "ext"),
          ("record_claim_payout\na wallet_entry payout", "stdb")], "claim_payout", "+ payout"),
    ]
    y = 270
    drawn = []
    for items, job, amount in rows:
        bs = row(80, y, 480, 160, items, pad=20)
        drawn.append((bs, job, amount))
        y = L(bs[0].bottom) + 50
    top, bottom = drawn[0][0][0].y, drawn[-1][0][0].bottom
    wallet = S.box(2000, L(top), 400, "my_wallet\nthe balance is the sum of wallet_entry minus orders still paying; "
                                      "BandIt never reads the Nessie balance", "stdb", h=bottom - top)
    zb = L(bottom) + 40
    S.zone(40, 190, 580, zb - 190, "Triggers", "plain")
    S.zone(680, 190, 580, zb - 190, "Nessie (Capital One), called by bandit-workers", "ext", fs=20)
    S.zone(1320, 190, 1120, zb - 190, "SpacetimeDB: the wallet ledger", "stdb")
    for (a, b, c), job, amount in drawn:
        S.h(a, b)
        S.h(b, c)
        S.h(c, wallet, y=c.cy, label=amount)
    return S.end_frame()


# ---------------------------------------------------------------- 11. Vultr server
def vultr(y0):
    W, H = 2420, 600
    S.begin_frame("11 · Vultr server", 0, y0, W, H)
    title("One Vultr server",
          "Everything we host runs on one Vultr server in Silicon Valley at band1t.vip. Caddy terminates HTTPS and "
          "passes every request to bandit-api. The database stays on SpacetimeDB Maincloud.")
    ix, iw = 1140, 570
    api = S.box(ix, 330, iw, "bandit@api\nbandit-api serves /t/{token}, /organizer, /photo, /callback, /js, "
                             "/assets/merch, /blobs/{hash}", "rust")
    cl_h = ns_h = 64
    workers = S.box(ix, L(api.bottom) + 50, iw, "bandit@workers\nruns the Claude, Nessie and Evidence Engine jobs",
                    "rust", h=cl_h + 30 + ns_h)
    indexer = S.box(ix, L(workers.bottom) + 50, iw, "bandit@indexer\ncopies rows one way into the Evidence Engine",
                    "rust")
    caddy = S.box(600, 0, 380, "Caddy\nHTTPS for band1t.vip and www.band1t.vip; reverse_proxy to 127.0.0.1:8080",
                  "note", cy=L(api.cy))
    setup = S.box(600, 0, 380, "deploy/setup.sh\na 4 GB swapfile, Chromium, Caddy, the Bun build of the web pages, "
                               "cargo build with debug info off", "note", cy=L(indexer.cy))
    phones = S.box(60, 0, 360, "Phones and staff screens\nthe NFC tag holds band1t.vip/t/{token}; staff open "
                               "/organizer and /photo", "web", cy=L(caddy.cy))
    deploy = S.box(60, 0, 360, "scripts/deploy-vm root@band1t.vip\ncopies the .env keys and identities, then runs "
                               "deploy/setup.sh", "note", cy=L(setup.cy))
    stdb = S.box(1910, 0, 470, "SpacetimeDB Maincloud\nthe band1t module", "stdb", cy=L(api.cy))
    claude = S.box(1910, L(workers.y), 470, "Claude API", "ext", h=cl_h)
    nessie = S.box(1910, L(workers.y) + cl_h + 30, 470, "Nessie (Capital One)", "ext", h=ns_h)
    elastic = S.box(1910, 0, 470, "Elastic Serverless\nthe Evidence Engine", "ext", cy=L(indexer.cy))

    inner_b = L(indexer.bottom) + 40
    zb = max(inner_b, L(setup.bottom)) + 40
    S.zone(470, 190, 1320, zb - 190, "Vultr server, band1t.vip", "plain")
    S.zone(1100, 240, 650, inner_b - 240, "systemd unit bandit@.service: each instance runs target/debug/bandit-%i "
                                          "with Restart=always", "rust", fs=20)

    S.h(phones, caddy, label="HTTPS")
    S.h(caddy, api, label="proxy")
    S.v(setup, caddy, x=caddy.cx, label="installs", dashed=True)
    S.h(deploy, setup, label="runs")
    S.h(api, stdb, label="reads, calls")
    S.h(workers, claude, y=claude.cy, label="AI calls")
    S.h(workers, nessie, y=nessie.cy, label="bank calls")
    S.h(indexer, elastic, label="one-way copy")
    return S.end_frame()


# ---------------------------------------------------------------- 12. Hardware basics
def hardware(y0):
    W, H = 1860, 600
    S.begin_frame("12 · Hardware basics", 0, y0, W, H)
    title("Hardware basics",
          "The firmware is used as it is. Cameras and anything about vision are Leo's (TBD Leo).")
    phone = S.box(80, 190, 460, "Phone\nan NFC tap on the band opens the web app", "web")
    lite = S.box(80, L(phone.bottom) + 90, 460, "Lite band x6\nSeeed XIAO ESP32-C3, 12-LED WS2812B ring, SOS button "
                                                "(hold 3 s), NTAG215 NFC sticker, 500 mAh LiPo, printed case", "device")
    full = S.box(80, L(lite.bottom) + 30, 460, "Full band x3\neverything in a lite band, plus an MPU-6050 IMU for "
                                               "fall detection and a coin vibration motor", "device")
    stations = S.box(800, 0, 440, "Station markers x2 to 5, at the exits\nESP32-C3 SuperMini and a spare LED ring; ids 101 "
                                  "to 105; anchor the zones and glow their exit colour", "device", cy=L(lite.cy))
    gateway = S.box(800, 0, 440, "Gateway x1\nXIAO ESP32-C3 on USB, id 200; one JSON line per packet; sends each "
                                 "command 3 times", "device", cy=L(full.cy))
    bridge = S.box(1400, 0, 400, "bandit-bridge on the team laptop\nUSB serial at 115200 baud", "rust",
                   cy=L(gateway.cy))
    cam = S.box(1400, 0, 400, "Overhead phone camera on a stand\n(TBD Leo)", "tbd", cy=L(lite.cy))
    bands = S.zone(60, L(lite.y) - 50, 500, L(full.bottom) - L(lite.y) + 70, "9 bands, one firmware", "device",
                   fs=18)
    note = S.panel(40, L(max(full.bottom, gateway.bottom)) + 60, W - 80, "On the band, with no server",
                   "Counts the bands it hears and turns that into a green, yellow or red ring.\nIts zone is the "
                   "station marker it hears loudest; a band never knows a position.\nSOS or a fall: its ring strobes "
                   "red and the bands close by pulse blue.\nGuidance: the band shows the colour of the nearest exit's marker, and the full bands vibrate "
                   "to move people along the dispersion route.", kind="note")
    S.v(phone, lite, x=phone.cx, label="NFC")
    S.h(stations, bands, y=stations.cy, label="station beacons,\n5 Hz")
    S.h(bands, gateway, y=gateway.cy, label="ESP-NOW channel 1:\nbeacons 10 Hz,\ncommands back", both=True)
    S.h(gateway, bridge, label="USB serial")
    return S.end_frame()


y = 0
for draw in (overview, architecture, spacetimedb, pipeline, evidence, insurance, claude_jobs, social, merch,
             nessie, vultr, hardware):
    y += draw(y) + GAP
S.dump(sys.argv[1] if len(sys.argv) > 1 else "bandit-system-design.excalidraw")
print(len(S.elements), "elements")
