"""BandIt system design in Excalidraw: five frames stacked top to bottom."""
import sys

from lib import KINDS, Scene, measure

S = Scene()
GAP = 220


def L(v, axis="y"):
    """Absolute scene coordinate back to frame-local."""
    return v - (S.oy if axis == "y" else S.ox)


def title(t, sub):
    S.text(40, 28, t, fs=40)
    S.text(40, 92, sub, fs=20, width=1900, color="#495057")


def legend(x, y):
    items = [("device", "devices"), ("rust", "Rust services"), ("stdb", "SpacetimeDB"),
             ("web", "browsers and people"), ("ext", "sponsor and outside APIs"), ("tbd", "TBD Leo")]
    for i, (k, name) in enumerate(items):
        cx = x + (i % 3) * 300
        cy = y + (i // 3) * 46
        fill, stroke = KINDS[k]
        S.base("rectangle", S.ox + cx, S.oy + cy, 44, 28, backgroundColor=fill, strokeColor=stroke,
               strokeStyle="dashed" if k == "tbd" else "solid", roundness={"type": 3})
        S.text(cx + 56, cy + 2, name, fs=18)


def row(x0, y, w, gap, items, kind="stdb", fs=20):
    """Boxes side by side with one shared height."""
    h = max(measure(lbl, w, fs) for lbl, _ in items)
    return [S.box(x0 + i * (w + gap), y, w, lbl, k or kind, h=h, fs=fs) for i, (lbl, k) in enumerate(items)]


# ---------------------------------------------------------------- 1. Architecture
def architecture(y0):
    W, H = 2830, 600
    S.begin_frame("1 · Architecture", 0, y0, W, H)
    title("1 · BandIt architecture",
          "SpacetimeDB holds the live, exact state and every write. Elastic validates, organizes and ranks by "
          "meaning. Claude agents make the judgment calls. Bright Data scrapes the web before the event. "
          "Nessie moves the money.")
    legend(1900, 34)

    # browsers across the top
    ops_l = "Ops dashboard\nmap, incidents, claims queue; its host portal layout: attendees, alerts, Event ended"
    app_l = "Attendee app at /t/{token}\nSpacetimeAuth sign-in; turns into the recap live when the event ends"
    top_h = max(measure(ops_l, 320), measure(app_l, 420))
    Y0 = 190 + top_h + 80 + 70  # top of the SpacetimeDB, services and Elastic zones
    ops = S.box(880, 230, 320, ops_l, "web", h=top_h)
    app = S.box(1230, 230, 420, app_l, "web", h=top_h)
    auth = S.box(1980, 230, 330, "SpacetimeAuth\nmagic-link sign-in for attendees and staff", "ext", h=top_h)
    kib = S.box(2420, 230, 350, "Kibana\nimport runs, bandit-organizer decisions, three dashboards", "ext", h=top_h)

    # SpacetimeDB
    S.text(880, Y0 + 50, "Live, exact state. Every write is a reducer call: one transaction, all or nothing. "
                     "Each change is pushed to every subscribed screen. Scheduled reducers (venue_tick, "
                     "memory_tick) derive zone state and history inside the database.", fs=18, width=580)
    y = Y0 + 190
    venue, social = row(880, y, 280, 20, [
        ("Venue\nevent_state, zones, organizations, booths, schedule, scraped profiles", None),
        ("Social\nvisits, shared visits, people you hung out with, the people graph, photo tags; the simulated crowd on bands 10 to 89", None)])
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
        ("Roles and views\nSpacetimeAuth gives each person one identity; only the module owner grants roles; views return only the caller's rows", None)])
    stdb_bottom = L(jobs.bottom) + 30

    # venue floor and laptop
    bands = S.box(60, 300, 280, "Bands x9\n6 lite, 3 full with IMU and vibration; count neighbours, "
                                "show colours, SOS", "device")
    stations = S.box(60, L(bands.bottom) + 80, 200, "Station markers 101 to 105\nzone anchors, exit colours",
                     "device")
    gateway = S.box(60, 0, 280, "Gateway\nESP32-C3 on USB", "device", cy=L(band1t.cy))
    sim = S.box(460, 0, 300, "bandit-claims (demo tool)\ndrives demo bands 90 to 99 through report_sim_band and plants the claims", "rust",
                cy=L(venue.cy))
    bridge = S.box(460, 0, 300, "bandit-bridge\nserial lines in, ingest_band_reports every 250 ms, directives out",
                   "rust", cy=L(band1t.cy))
    camera = S.box(60, 0, 280, "Overhead phone camera\n(TBD Leo)", "tbd", cy=L(jobs.cy))
    vision = S.box(460, 0, 300, "bandit-vision (TBD Leo)\ncounts, person-down alerts, photo features", "tbd",
                   cy=L(jobs.cy))

    # Rust services
    api = S.box(1640, Y0 + 70, 300, "bandit-api\nserves both web apps; POST /api/blobs, GET /recap/order, demo routes; holds the Elastic key", "rust")
    indexer = S.box(1640, L(api.bottom) + 50, 300, "bandit-indexer\none-way copy of booths and interests into "
                                                    "Elastic", "rust")
    bd_label = "Bright Data Web MCP\nscrapes event pages, company pages, the venue on Google Maps and the floor plan"
    bd_h = measure(bd_label, 250)
    ingest = S.box(1640, L(indexer.bottom) + 50, 300, "bandit-ingest\nbefore the event: fetch, organize, "
                                                       "import", "rust", h=bd_h + 76)
    cl_label = "Claude API\nagents for the judgment calls: read bills, review causation, draft letters"
    ns_label = "Nessie (Capital One)\nwallets at sign-up, claim payouts, merch purchases"
    cl_h, ns_h = measure(cl_label, 250), measure(ns_label, 250)
    wy = L(ingest.bottom) + 50
    workers = S.box(1640, wy, 300, "bandit-workers\nruns the jobs: Claude calls, Nessie payments, claim "
                                   "precedents", "rust", h=cl_h + 80 + ns_h)
    bd = S.box(2070, L(ingest.y), 250, bd_label, "ext", h=bd_h)
    claude = S.box(2070, wy, 250, cl_label, "ext", h=cl_h)
    nessie = S.box(2070, wy + cl_h + 80, 250, ns_label, "ext", h=ns_h)

    # Elastic boxes line up with the services that use them
    idx = S.box(2420, L(api.y) - 10, 350, "Order by meaning\nbandit-booths and bandit-people: GET /recap/order puts "
                                          "the people and booths closest to what the attendee is into first", "ext",
                h=indexer.bottom - api.y + 20)
    org = S.box(2420, L(ingest.y), 350, "Organize scraped records\nWorkflow bandit-organize: ES|QL joins, then "
                                        "the bandit-organizer agent, a reason for every merge", "ext", h=ingest.h)
    claims = S.box(2420, wy, 350, "Validate claim evidence\npipeline bandit-claims-validate; similar past claims "
                                  "ranked as precedents", "ext", h=workers.h)

    zb = max(stdb_bottom, L(workers.bottom) + 30, L(vision.bottom) + 30)
    venue_z = S.zone(40, 200, 320, zb - 200, "Venue floor", "device")
    S.zone(440, 200, 340, zb - 200, "Demo laptop, online through a phone hotspot", "rust")
    S.zone(840, 190, 1950, top_h + 80, "Browsers", "web")
    stdb = S.zone(860, Y0, 620, zb - Y0, "SpacetimeDB Maincloud: the band1t module", "stdb")
    S.zone(1620, Y0, 340, zb - Y0, "Rust services", "rust")
    ez = S.zone(2400, Y0, 390, zb - Y0, "Elastic Serverless", "ext")

    S.v(stations, bands, x=stations.cx, label="station\nbeacons")
    S.v(bands, gateway, x=S.ox + 312, label="ESP-NOW\n10 Hz", both=True)
    S.h(gateway, bridge, label="USB serial")
    S.h(bridge, band1t, label="reports and\ndirectives", both=True)
    S.h(sim, stdb, y=sim.cy, label="report_\nsim_band")
    S.h(camera, vision)
    S.h(vision, stdb, y=vision.cy, label="alerts")
    S.v(app, stdb, x=app.cx, label="subscriptions,\nreducer calls", both=True)
    S.v(ops, stdb, x=ops.cx, label="end_event,\napprovals", both=True)
    S.link(app, "r", api, "t", fa=0.7, via=[(api.cx, app.y + 0.7 * app.h)], label="uploads, recap order")
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


# ---------------------------------------------------------------- 2. Data pipeline
def pipeline(y0):
    W, H = 3840, 600
    S.begin_frame("2 · Event data pipeline", 0, y0, W, H)
    title("2 · Event data pipeline: Bright Data, then Elastic, then SpacetimeDB",
          "Runs once before the event from any event's public pages (Cal Hacks 13.0 is the first run), so no live "
          "step waits on a scrape. Bright Data does every fetch, Rust does the deterministic stages, Elastic "
          "organizes, and SpacetimeDB loads the checked bundle in one transaction.")
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
    ops = S.box(3560, 0, 240, "Ops dashboard\ndrag a misplaced booth (upsert_booth)", "web", cy=L(imp.cy))

    S.zone(40, L1[0], W - 80, L1[1] - L1[0], "Outside APIs: Bright Data and Claude", "ext")
    S.zone(40, L2[0], W - 80, L2[1] - L2[0], "bandit-ingest (Rust)", "rust")
    S.zone(40, L3[0], W - 80, L3[1] - L3[0], "Elastic Serverless: organize and check", "ext")
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
    S.h(tables, ops, label="flags")
    return S.end_frame()


# ---------------------------------------------------------------- 3. Insurance
def insurance(y0):
    W, H = 4020, 600
    S.begin_frame("3 · Insurance claim flow", 0, y0, W, H)
    title("3 · Insurance claim flow (Hyphenate track)",
          "An incident becomes a claim with no form. The venue's liability policy pays. Claude reads the bill and "
          "judges causation, but never sees or sets an amount: code prices every line and decides the route. "
          "A judge's approval teaches a rule that settles the next similar claim by itself.")
    lanes = {"L1": (170, 420), "L2": (440, 900), "L3": (920, 1160), "L4": (1180, 1420), "L5": (1440, 1720),
             "L6": (1740, 2000)}
    c = {k: (a + b) / 2 for k, (a, b) in lanes.items()}
    top2 = 590  # centre of the upper row in the SpacetimeDB lane

    fall = S.box(300, 0, 260, "Fall or SOS\nthe band flags it; bands close by pulse blue and become witnesses",
                 "device", cy=c["L1"] + 15)
    medic = S.box(610, 0, 260, "Medic\nadds a treatment note, uploads the bill through POST /api/blobs, resolves", "web",
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
    route = S.box(2580, 0, 300, "Named approver\nthe lowest role whose ceiling covers the payout: floor manager $500, "
                                "risk manager $5,000; 3 or more hurt: the adjuster", "web", cy=c["L5"] + 10)
    approve = S.box(3030, 0, 280, "Approve, learn on\nfails closed as stale if the amount or pack changed; writes "
                                  "rule v1 with the approver's name", "web", cy=c["L5"] + 10)
    settle = S.box(3370, 0, 260, "Settling\nledger journals: J1 reserve, J2 approval, J3 paid", "stdb", cy=top2)
    payout = S.box(3370, 0, 280, "Payout\nclaim_payout deposits into the claimant's Nessie wallet; a property claim pays the "
                                 "repair vendor", "ext", cy=c["L6"] + 15)
    letters = S.box(3700, 0, 280, "Letters\nClaude drafts the decision letter and a recovery letter worded as a "
                                  "question", "ext", cy=c["L3"] + 10)
    recon = S.box(3700, 0, 280, "Reconciled\nthe insurer pays the receivable (J4)", "good", cy=top2)

    names = {"L1": "Bands and staff on the floor", "L2": "SpacetimeDB: claim state; code decides every amount",
             "L3": "Claude agents, run as jobs by bandit-workers", "L4": "Elastic",
             "L5": "People: named approvers, in the Claims queue", "L6": "Nessie"}
    kinds = {"L1": "device", "L2": "stdb", "L3": "ext", "L4": "ext", "L5": "web", "L6": "ext"}
    for k, (a, b) in lanes.items():
        S.zone(40, a, W - 80, b - a, names[k], kinds[k])

    S.v(fall, inc, label="flag")
    S.v(medic, opn, label="note, bill,\nresolve")
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
    S.panel(40, py, 1180, "Live-learning demo",
            "1. The fall from the demo becomes a claim. No rule exists yet, so it waits for a judge playing risk "
            "manager on the Ops dashboard on their own phone.\n2. A late note makes the first tap fail as stale; the judge approves "
            "again. The payout lands in the wallet and rule v1 is created with the judge's name on it.\n3. A "
            "similar fall from the simulator settles in seconds under rule v1.\n4. A fake with witnesses in "
            "another zone is refused by code with every check listed.")
    S.panel(1260, py, 1260, "Edge cases, live or in the stress test",
            "Injury happened at home: Claude says doubt, a person decides.\nWitness bands in another zone: "
            "refused at claim open as witness_zone, zones side by side.\nAmount changed while approving: fails "
            "closed as stale.\nSame bill scanned again: marked duplicate, pays nothing, refused as zero_payout."
            "\nInjured person is venue staff: refused at claim open; workers' comp applies.\nThree or more hurt in "
            "one incident: every claim goes to the adjuster.\nOnly code at claim open and the named approver refuse.", kind="bad")
    S.panel(2560, py, 1340, "Accuracy run and scorecard, before the demo",
            "bandit-claims plants 3 rounds of 12 genuine claims and 6 decoys (sitting down, dropped phone, fake "
            "witnesses) through the same reducers a medic uses.\nStraight-through rate per round, rising as rules "
            "are learned.\nDollars wrongly paid on decoys: target $0.\nAuto-settle precision and recall; bill-review "
            "savings; incident to payout time; human touches per claim.\nShown in the Claims queue and the Kibana "
            "dashboard BandIt claims evidence.", kind="good")
    return S.end_frame()


# ---------------------------------------------------------------- 4. Social and recap
def social(y0):
    W, H = 2860, 600
    S.begin_frame("4 · Social and recap flow", 0, y0, W, H)
    title("4 · Social and recap flow",
          "The bands are the identity during the event. Memories come only from band, zone and time; the "
          "people you see afterwards are the ones you actually spent time with. When the host ends the event, "
          "every open attendee page turns into the recap live.")
    zt, zb = 190, 1320

    # 1. at the door
    a = []
    y = 260
    for lbl, k in [("Tap the band with your phone\nits NFC sticker opens /t/{token} in the attendee app", "web"),
                   ("Sign in with SpacetimeAuth\na magic link at the first tap; the same identity on every device", "ext"),
                   ("Press the band's button when it blinks white\nthe band is now yours", "web"),
                   ("Your display name\nsaving it opens your wallet", "web"),
                   ("Is this you?\none tap on your scraped speaker or exhibitor profile; claim_person links it to "
                    "you as the band's owner", "web"),
                   ("Your Meta socials\nInstagram, Facebook, Threads, typed by you", "web"),
                   ("Nessie wallet\nwallet_open puts $200 in claimant_account when you save your name", "ext")]:
        b = S.box(70, y, 500, lbl, k)
        a.append(b)
        y = L(b.bottom) + 46
    for p, q in zip(a, a[1:]):
        S.v(p, q, x=p.cx)

    # 2. during the event
    b1 = S.box(720, 260, 330, "Bands and zones (TBD Leo)\nthe band and encounter model in band1t", "tbd")
    b2 = S.box(720, L(b1.bottom) + 60, 330, "memory_tick every 5 s\npresence_sample: which band was in which zone, "
                                            "and when", "stdb")
    b3 = S.box(720, L(b2.bottom) + 70, 330, "Visits\nsame zone for 2 minutes or more, named by the zone's booth",
               "stdb")
    b4 = S.box(1100, 0, 330, "Encounter rule (TBD Leo)\nstarting default: both findable, together for 3 minutes; writes social_encounter",
               "tbd", cy=L(b3.cy))
    b5 = S.box(720, L(max(b3.bottom, b4.bottom)) + 70, 710, "People graph: people_link\nmet, visited, works at, "
                                                           "exhibits; written in the same transaction as the visit "
                                                           "or encounter, so the big screen grows live", "stdb")
    b6 = S.box(1480, 260, 320, "Photographer's photo\nuploaded through POST /api/blobs; its zone is the photographer's band zone then",
               "web")
    b7 = S.box(1480, L(b2.y), 320, "Suggested photo tags\nfindable people whose bands were in that zone; each "
                                   "confirms or removes their tag", "stdb")
    b8 = S.box(1480, L(b7.bottom) + 60, 320, "Photo features (TBD Leo)\npeople count and caption", "tbd")
    b9 = S.box(720, L(b5.bottom) + 60, 400, "Shared visits: shared_visit\ntwo findable people in one zone for 5 minutes "
                                           "or more, met or not", "stdb")

    # 3. after the event
    c1 = S.box(1940, 260, 420, "Ops taps Event ended\nend_event in the host portal writes event_state; reopen_event undoes it", "web")
    c2 = S.box(1940, L(c1.bottom) + 50, 420, "Every open attendee page turns into the recap\nlive, by subscription to event_state; /t/{token} "
                                             "reopens it later on any device", "web")
    c3 = S.box(1940, L(c2.bottom) + 50, 420, "SpacetimeDB views\nmy_encounters, my_shared_visits, my_visits, my_photos: the "
                                             "exact lists of who and what", "stdb")
    c4 = S.box(2420, 0, 380, "Elastic orders the lists\nGET /recap/order on bandit-api, by meaning against your "
                             "interests (bandit-people, bandit-booths)", "ext", cy=L(c3.cy))
    c5 = S.box(1940, L(max(c3.bottom, c4.bottom)) + 60, 860, "Your recap page\n1. your space-time view of the night\n"
                                                             "2. your most visited booths\n3. the people you hung out "
                                                             "with, and their socials when they allow it\n4. your photos "
                                                             "with the people in each, and tap to share\n5. merch",
               "web")
    c6 = S.box(1940, L(c5.bottom) + 60, 420, "Merch suggestions\nyour confirmed photo placed in a hand-made template "
                                             "(tee, mug, poster, sponsor booth items); top 3 by minutes at that booth",
               "stdb")
    c7 = S.box(2420, 0, 380, "Buy with one tap\nbuy_merch checks the wallet balance in the same transaction; merch_purchase records it on Nessie", "ext",
               cy=L(c6.cy))

    zb = max(L(a[-1].bottom), L(c7.bottom), L(b8.bottom), L(b9.bottom)) + 40
    S.zone(40, zt, 560, zb - zt, "1. At the door", "web")
    S.zone(690, zt, 1140, zb - zt, "2. During the event", "stdb")
    S.zone(1910, zt, 920, zb - zt, "3. After the event", "plain")

    S.link(a[2], "r", b1, "l", via=[(a[2].right + 60, a[2].cy), (a[2].right + 60, b1.cy)], label="your band")
    S.v(b1, b2, x=b1.cx)
    S.v(b2, b3, x=b3.cx)
    S.link(b2, "r", b4, "t", fa=0.75, via=[(b4.cx, b2.y + 0.75 * b2.h)])
    S.v(b3, b5, x=b3.cx, label="visited")
    S.link(b3, "l", b9, "l", via=[(b3.x - 18, b3.cy), (b3.x - 18, b9.cy)])
    S.link(b9, "r", c3, "l", fb=0.9, via=[(1890 + S.ox, b9.cy), (1890 + S.ox, c3.y + 0.9 * c3.h)])
    S.v(b4, b5, x=b4.cx, label="met")
    S.v(b6, b7, x=b6.cx)
    S.v(b8, b7, x=b8.cx, dashed=True, label="re-cap to\nthe count")
    S.h(b2, b7, y=b2.y + 0.3 * b2.h, label="who was in that zone")
    S.link(b5, "r", c3, "l", fa=0.5, fb=0.72, via=[(1870 + S.ox, b5.cy), (1870 + S.ox, c3.y + 0.72 * c3.h)])
    S.link(b7, "r", c3, "l", fa=0.5, fb=0.3, via=[(1850 + S.ox, b7.cy), (1850 + S.ox, c3.y + 0.3 * c3.h)],
           label="confirmed\ntags")
    S.v(c1, c2, x=c1.cx, label="event_state")
    S.v(c2, c3, x=c2.cx)
    S.h(c3, c4)
    S.v(c3, c5, x=c3.cx)
    S.link(c4, "b", c5, "t", fb=(c4.cx - c5.x) / c5.w, label="order")
    S.v(c5, c6, x=c6.cx)
    S.h(c6, c7, label="order")
    S.link(a[-1], "b", c7, "b", via=[(a[-1].cx, S.oy + zb + 40), (c7.cx, S.oy + zb + 40)], dashed=True,
           label="the same wallet")
    return S.end_frame()


# ---------------------------------------------------------------- 5. Hardware basics
def hardware(y0):
    W, H = 1860, 600
    S.begin_frame("5 · Hardware basics", 0, y0, W, H)
    title("5 · Hardware basics (decided)",
          "The firmware is used as it is. Cameras and anything about vision are Leo's (TBD Leo).")
    phone = S.box(80, 190, 460, "Phone\nan NFC tap on the band opens the web app", "web")
    lite = S.box(80, L(phone.bottom) + 90, 460, "Lite band x6\nSeeed XIAO ESP32-C3, 12-LED WS2812B ring, SOS button "
                                                "(hold 3 s), NTAG215 NFC sticker, 500 mAh LiPo, printed case", "device")
    full = S.box(80, L(lite.bottom) + 30, 460, "Full band x3\neverything in a lite band, plus an MPU-6050 IMU for "
                                               "fall detection and a coin vibration motor", "device")
    stations = S.box(800, 0, 440, "Station markers x2 to 5\nESP32-C3 SuperMini and a spare LED ring; ids 101 to "
                                  "105; anchor the zones and glow the exit colour", "device", cy=L(lite.cy))
    gateway = S.box(800, 0, 440, "Gateway x1\nXIAO ESP32-C3 on USB, id 200; one JSON line per packet; sends each "
                                 "command 3 times", "device", cy=L(full.cy))
    bridge = S.box(1400, 0, 400, "bandit-bridge on the demo laptop\nUSB serial at 115200 baud", "rust",
                   cy=L(gateway.cy))
    cam = S.box(1400, 0, 400, "Overhead phone camera on a stand\n(TBD Leo)", "tbd", cy=L(lite.cy))
    bands = S.zone(60, L(lite.y) - 50, 500, L(full.bottom) - L(lite.y) + 70, "9 bands, one firmware", "device",
                   fs=18)
    note = S.panel(40, L(max(full.bottom, gateway.bottom)) + 60, W - 80, "On the band, with no server",
                   "Counts the bands it hears and turns that into a green, yellow or red ring.\nIts zone is the "
                   "station marker it hears loudest; a band never knows a position.\nSOS or a fall: its ring strobes "
                   "red and the bands close by pulse blue.\nGuidance is the route colour, and the full bands vibrate "
                   "to move people along the dispersion route.", kind="note")
    S.v(phone, lite, x=phone.cx, label="NFC")
    S.h(stations, bands, y=stations.cy, label="station beacons,\n5 Hz")
    S.h(bands, gateway, y=gateway.cy, label="ESP-NOW channel 1:\nbeacons 10 Hz,\ncommands back", both=True)
    S.h(gateway, bridge, label="USB serial")
    return S.end_frame()


y = 0
for draw in (architecture, pipeline, insurance, social, hardware):
    y += draw(y) + GAP
S.dump(sys.argv[1] if len(sys.argv) > 1 else "bandit-system-design.excalidraw")
print(len(S.elements), "elements")
