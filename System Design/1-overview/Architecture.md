# Architecture

BandIt is a festival wristband plus a backend that turns a crowd of bands into a live, shared map of the event. The bands sense crowd density and emergencies on their own. One SpacetimeDB database holds every piece of live state and performs every action. Feature services (search, AI, payments, insurance, merch) hang off that database and can be removed one by one. This file is the map: how the parts fit, where data lives, how the system is deployed, and what happens when a part fails.

## Role in the system

This file owns:

- the system context and the container view (every process and who it talks to);
- the data ownership rules (which store is the source of truth for what);
- the deployment;
- the cross-cutting failure table and the mapping from prize tracks to components.

It does not describe any component's internals. Those live in the component files listed in [README](../README.md).

## Interfaces

Every connection in the system. Names match the component docs.

| From | To | What flows | Transport |
|---|---|---|---|
| Band | Band, station marker, gateway | beacons (id, flags, neighbour count, zone, state, seq) | ESP-NOW broadcast, channel 1, 10 Hz |
| Station marker | Band, gateway | station beacons (id, exit colour) | ESP-NOW broadcast, 5 Hz |
| Gateway | Band, station marker | commands (`state`, `exit`, `clear`, `buzz`, `thresh`, `rssi`, `override`) | ESP-NOW broadcast, each sent 3 times |
| Gateway | `bandit-bridge` | one JSON line per packet heard; command lines back | USB serial, 115200 baud |
| `bandit-bridge` | `bandit` module | `ingest_band_reports` every 250 ms; subscriptions to `band_directive`, `band_command`, `fleet_config` | SpacetimeDB Rust client SDK (WebSocket) |
| Simulator.md: `bandit-sim` | `bandit` module | reports for up to 200 virtual bands through the same reducer | SpacetimeDB Rust client SDK |
| Ops dashboard, Attendee app | `bandit` module | reducer calls; subscriptions to their slice | SpacetimeDB TypeScript client SDK (WebSocket) |
| Ops dashboard, Attendee app | `bandit-api` | the app files, uploads and downloads, and the feature endpoints listed in [Rust-Backend](../3-services/Rust-Backend.md) | HTTPS, same origin |
| `bandit-workers` | `bandit` module | claim jobs, submit results | SpacetimeDB Rust client SDK |
| `bandit-workers` | Resend | one recap email per attendee after the event, with a one-time link ([Rust-Backend](../3-services/Rust-Backend.md)) | HTTPS |
| Anthropic-Agent.md, Payments-Nessie.md: `bandit-workers` | Claude API, Nessie | AI calls, bank calls | HTTPS |
| Elastic.md: `bandit-indexer` | `bandit` module, Elastic Serverless | subscription in, bulk index writes out | SDK in, HTTPS out |
| Elastic.md: `bandit-api` | Elastic Serverless | meaning-ranked search queries and `GET /graph/similar`, filtered first by SpacetimeDB rows | HTTPS |
| `bandit-ingest` | `bandit` module | the seed through the setup reducers | SDK |
| BrightData.md: `bandit-ingest` | Bright Data Web MCP, Claude API, `bandit` module | page fetches and extraction; `floorplan_check`; `import_event` | HTTPS; SDK |
| Elastic.md: `bandit-ingest` | Elastic Serverless | parsed JSON records in; the organizer workflow's bundle back | HTTPS |
| Elastic.md, Hyphenate.md: `bandit-workers` | Elastic Serverless, `bandit` module | a de-identified copy of each claim into `bandit-claims` through the pipeline `bandit-claims-validate`; the ids and scores of similar past claims back, written through `attach_claim_precedents` | HTTPS; SDK |
| Elastic.md: the organizer agent | Bright Data Web MCP | at most 10 gap-fill `extract` calls per run, through an Agent Builder MCP tool | HTTPS |
| Vision.md (TBD -- LEO): `bandit-vision` | `bandit` module, `bandit-api`, Claude API | zone counts, ground alerts, incident assessments, property events, photo features; frames stored as blobs; frames to Claude | reducer calls; HTTPS |

## Design

### Principles

1. **Safety never waits.** Density colours, SOS, fall detection and the light circle run on the bands themselves. The server adds coordination (exit choice, dispersion guidance, evacuation, escalation), but the bands stay useful if the laptop, the network or the cloud is gone.
2. **One source of truth.** The SpacetimeDB module `bandit` holds all live state. Every change is a reducer call, so it happens completely or not at all, and every screen sees the same committed state through subscriptions.
3. **Copies flow one way.** Any other store holds only files or a copy of committed rows. Results come back as SpacetimeDB ids, and acting on them is again a reducer call.
4. **Slow and external work goes through a queue.** AI, bank and mail work are `job` rows claimed by `bandit-workers`. Code decides money, coverage, safety and access; the model only reads and writes words.
5. **Every feature can be deleted.** Core components are enough for the safety demo. Each optional feature owns its tables, reducers and jobs, so removing its doc and code removes it cleanly.
6. **The backend is Rust.** The module, every service and every shared library are Rust. Only the two browser apps are TypeScript.

### System context

Who uses BandIt, and which outside services it relies on.

```mermaid
flowchart LR
  Attendee["Attendee"]
  Staff["Staff: ops, medics, approvers"]
  BandIt["BandIt: bands, gateway, SpacetimeDB module, Rust services, web apps"]
  Elastic["Elastic Serverless"]
  Claude["Claude API"]
  Nessie["Nessie"]
  Bright["Bright Data"]
  Resend["Resend"]
  Vision["Vision service (TBD -- LEO)"]

  Attendee -->|"taps band, signs up, presses to claim, opens the recap email after"| BandIt
  Staff -->|"watches the map, handles incidents, approves claims"| BandIt
  BandIt -->|"scraped records to organize; search copy and queries"| Elastic
  Elastic -.->|"capped gap-fill fetches"| Bright
  BandIt -->|"cards, floor plan, letters"| Claude
  BandIt -->|"accounts, merch purchases, payouts"| Nessie
  BandIt -->|"fetch pages before the event"| Bright
  BandIt -->|"one recap email per attendee"| Resend
  Vision -->|"counts, alerts, photo features"| BandIt

  classDef web fill:#E3F2FD,stroke:#1565C0,color:#1A1A1A
  classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
  classDef ext fill:#E0F2F1,stroke:#00695C,color:#1A1A1A
  classDef tbd fill:#F5F5F5,stroke:#757575,color:#1A1A1A,stroke-dasharray:5 5
  class Attendee,Staff web
  class BandIt stdb
  class Elastic,Claude,Nessie,Bright,Resend ext
  class Vision tbd
```

### Containers

Every running process and the main flows between them. The left half is the live safety path; the right half is the feature services.

```mermaid
flowchart LR
  subgraph Venue["Venue floor"]
    Bands["Bands x9"]
    Stations["Station markers"]
    Gateway["Gateway"]
  end
  subgraph Laptop["Demo laptop"]
    Bridge["bandit-bridge"]
    Sim["bandit-sim"]
  end
  STDB[("bandit module on SpacetimeDB")]
  subgraph Apps["Browsers"]
    Ops["Ops dashboard"]
    App["Attendee app"]
  end
  subgraph Services["Rust services"]
    API["bandit-api"]
    Workers["bandit-workers"]
    Indexer["bandit-indexer"]
    Ingest["bandit-ingest"]
  end
  subgraph SaaS["External services"]
    Elastic["Elastic Serverless"]
    Claude["Claude API"]
    Nessie["Nessie"]
    Bright["Bright Data"]
    Resend["Resend"]
  end

  Bands <-->|"ESP-NOW beacons"| Stations
  Bands <-->|"beacons up, commands down"| Gateway
  Gateway <-->|"USB serial lines"| Bridge
  Bridge <-->|"reports up, directives down"| STDB
  Sim -->|"simulated reports"| STDB
  Ops <-->|"subscriptions, ops reducers"| STDB
  App <-->|"subscriptions, attendee reducers"| STDB
  Ops -->|"app files"| API
  App -->|"app files, uploads, search"| API
  API -->|"queries"| Elastic
  Workers <-->|"jobs"| STDB
  Workers -->|"HTTPS"| Claude
  Workers -->|"HTTPS"| Nessie
  Workers -->|"recap emails"| Resend
  Workers <-->|"claim copies out, precedent ids back"| Elastic
  Indexer -->|"subscribe"| STDB
  Indexer -->|"bulk index"| Elastic
  Ingest -->|"fetch pages"| Bright
  Ingest -->|"floorplan_check"| Claude
  Ingest -->|"JSON records; organized bundle back"| Elastic
  Elastic -.->|"gap fill, capped"| Bright
  Ingest -->|"import_event, setup reducers"| STDB

  classDef device fill:#FFF3E0,stroke:#E65100,color:#1A1A1A
  classDef rust fill:#FBE9E7,stroke:#BF360C,color:#1A1A1A
  classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
  classDef web fill:#E3F2FD,stroke:#1565C0,color:#1A1A1A
  classDef ext fill:#E0F2F1,stroke:#00695C,color:#1A1A1A
  class Bands,Stations,Gateway device
  class Bridge,Sim,API,Workers,Indexer,Ingest rust
  class STDB stdb
  class Ops,App web
  class Elastic,Claude,Nessie,Bright,Resend ext
```

Vision.md (TBD -- LEO): the Vision service is left out of this picture. Leo's default is a Rust process, `bandit-vision`, on the demo laptop. It pulls snapshots from one overhead phone camera over the pit, runs person and pose detection locally for head counts and person-down alerts, asks Claude to assess an event only after a band or the detector flags it, and writes the results through the reducers in [Vision](../4-devices/Vision.md). Identity always comes from the bands, never from faces.

### The live loop in one picture

What happens to one beacon, and how a server decision gets back to a band. Everything here is either on the band or a reducer call; nothing waits on AI or a queue. When the module guides people (crowd risk, evacuation, a medic approach), each band shows the colour of its route and the full bands also vibrate through the `buzz` command, so wearers feel the cue to move along the dispersion route ([Safety](../6-features/Safety.md)).

```mermaid
sequenceDiagram
  participant B as Band
  participant G as Gateway
  participant BR as bandit-bridge
  participant M as bandit module
  participant D as Ops dashboard
  B->>B: count neighbours, pick zone, set colour locally
  B-)G: beacon (ESP-NOW, 10 Hz)
  G->>BR: JSON line (USB serial)
  BR->>M: ingest_band_reports (batch every 250 ms)
  M->>M: update band_report, open incident if SOS or fall
  M-->>D: subscription update (map, fleet, incidents)
  M->>M: venue_tick every 500 ms: zone density, risk, exit choice
  M-->>BR: band_directive (exit colour, forced state), band_command buzz
  BR->>G: cmd lines: exit, state, buzz
  G-)B: command (sent 3 times)
  B->>B: show route colour, full bands vibrate
```

### Data ownership

Where each kind of data lives, and where copies go. "Source of truth" means the only place that data may be changed.

| Data | Source of truth | Written by | Copies |
|---|---|---|---|
| Venue layout: zones, exits, stations, booths, schedule | `bandit` module | the setup reducers from the seed (`bandit-ingest` seed mode), ops; BrightData.md: `import_event` | none; Elastic.md: `bandit-booths` |
| Bands, attendees, consent, staff roles | `bandit` module | attendee app, ops | none |
| Live band reports, zone state, directives, commands | `bandit` module | `bandit-bridge`, `venue_tick`; Simulator.md: `bandit-sim` | none |
| Incidents, snapshots, witnesses, notes | `bandit` module | `ingest_band_reports`, ops, medics | none |
| Presence history | `bandit` module (`presence_sample`) | `memory_tick` | none; Social.md: derives `visit` from it and writes `encounter` by the encounter rule (TBD -- LEO); Elastic.md copies both to `bandit-memories` under consent |
| Zone history | `bandit` module (`zone_sample`) | `memory_tick` | none |
| Social.md: the people graph | `bandit` module (`people_link`) | the social step of `memory_tick`; `exhibits` links from the import | none; Elastic.md: `bandit-people` holds each findable attendee's interests, never the links |
| Medical-ID.md, Hyphenate.md: medical card, insurance policy | `bandit` module, private tables | attendee app, workers | never copied |
| Payments-Nessie.md, Hyphenate.md: payments, claims, ledger | `bandit` module | reducers; workers record external ids | Nessie holds the mirror bank records; Elastic.md: a de-identified copy of each claim in `bandit-claims` (codes, amounts, zones, times and a narrative built by code), used only to rank similar past claims |
| Recap links | `bandit` module (`recap_link`, token hashes only) | `bandit-workers` through `issue_recap_link`; `bandit-api` through `redeem_recap_link` | none; the attendee tokens `bandit-api` keeps for the links are files on the Fly volume until the links expire |
| Files: photos, PDFs, letters | the blob store, a folder on the Fly volume | `bandit-api` and `bandit-workers`, each through `register_blob` | `blob_ref` row in the module (hash, size, owner, access class) |
| Raw radio log | `.jsonl` files on the laptop | `bandit-bridge` | stay on the laptop; used for calibration and replay |
| BrightData.md: raw fetch snapshots | versioned files kept with the project | `bandit-ingest` | loaded into the module through `import_event` |
| Anthropic-Agent.md: model calls | `model_call` rows plus response blobs | `bandit-workers`, `bandit-ingest`; Vision.md (TBD -- LEO): `bandit-vision` | used for audit |
| Elastic.md: raw scraped records and the organized bundle | Elastic raw indices and `bandit-bundles` | `bandit-ingest`, the organizer workflow | working data before the import; rebuilt from the snapshots at every run, never read at the event |

### What each database does best

SpacetimeDB and Elastic solve different problems, and BandIt shows each one doing what only it does. SpacetimeDB solves live shared state: many devices, services and screens changing and watching the same venue at once, where every screen must agree within one transaction.

What only SpacetimeDB does here:

| Strength | Where BandIt uses it | Why it matters here |
|---|---|---|
| Logic runs inside the database, as transactions | `ingest_band_reports` opens an SOS incident, freezes its snapshot with the bands in the light circle, and schedules the escalation in one reducer ([SpacetimeDB](../2-data/SpacetimeDB.md), [Safety](../6-features/Safety.md)) | every screen sees all of it or none of it; no app server sits between a band flag and the incident row |
| Push to every client on commit | the Ops map, the medic phone, the attendee app and the bridge subscribe to queries and receive each change, with a local cache to render from | an SOS reaches the medic without polling, and the bridge reads its directives from the cache |
| Timers inside the database | scheduled reducers: `venue_tick` turns band reports into zone state and exit colours; `memory_tick` turns presence into history | the derived safety state is computed where the data lives, on a fixed cadence |
| Identity and access next to the data | claiming a band by pressing it binds the band to the phone's identity; reducers check `staff_role`; views return only the caller's rows (`staff_incidents` for staff; the caller's own band and consent for attendees) | access is enforced once, in the database, for every client, so an app bug cannot widen it |
| The space-time mapping | `presence_sample`, written by `memory_tick`: which band was in which zone, and when | it is the filter other questions start from (Social.md: visits and encounters; Elastic.md: the search filter through `api_presence_windows`) |
| One schema, typed clients, one hosted database | `spacetime generate` gives the Rust services and both TypeScript apps the same types; Maincloud hosts the module, so bands (through the bridge), phones, staff and services all reach the same database | six kinds of clients stay in step with one schema, and no server of ours sits on the live path |

Elastic.md: BandIt uses a second database because it has a second, different problem. Elastic solves finding by meaning: messy scraped text, captions and images, where the answer is a ranked list, plus the analysis of all of it in Kibana. Neither database does the other's job, and they meet in exactly three places, plus a fourth for Hyphenate.md's claim precedents, shown in the diagram after this table. Live state never lives in Elastic. What only Elastic does here:

| Strength | Where BandIt uses it | Why it matters here |
|---|---|---|
| Ranking by meaning | `semantic_text` fields on `.jina-embeddings-v5-text-small` plus keyword matching, merged with reciprocal rank fusion, in `GET /search/booths`, `/search/memories` and `/search/photos` ([Elastic](../7-integrations/Elastic.md)) | "booths about wearable robotics" finds booths that never use those words; SpacetimeDB filters by exact values and has no relevance ranking or vectors |
| Images and text in one vector space | an `image_vector` from `jina-clip-v2` on every photo thumbnail | "the photo of me with the robot" finds photos by what is in them, not only by caption |
| An agent that resolves messy records | the Agent Builder agent `bandit-organizer` on the Elastic Managed LLM, run by the Workflow `bandit-organize` with a JSON schema per section, searching candidates and giving a reason per merge | one company spelled three ways becomes one organisation before anything reaches the live database |
| Bulk joins where raw data lands | ES\|QL `LOOKUP JOIN` steps match booth numbers, domains and stage names across thousands of raw records | the messy raw records never enter the live database; only the checked bundle does |
| Place as a ranking signal | `geo_point` distance boosts "near the east hall" | distance shapes the ranking instead of only filtering it |
| Analysis you can see | Kibana, Elastic's web interface: the Workflows execution view, Agent Builder, and the Import run, Search, Event story and Interest map dashboards | the team shows how the data was organized and what people looked for, without touching the live screens |

The diagram shows where the two meet and which way data flows at each meeting point.

```mermaid
flowchart TB
  BD["Bright Data records"] -->|"raw JSON"| ES["Elastic: organize, rank by meaning, analyze in Kibana"]
  ES -->|"1. import: one checked bundle, loaded by import_event"| STDB["SpacetimeDB: live state, every write"]
  STDB -->|"2. copy: consented rows, one way, by bandit-indexer"| ES
  ES -->|"3. search: ranked ids only, through bandit-api, inside the caller's zones and times"| APP["Attendee app"]
  STDB <-->|"4. Hyphenate.md precedents: de-identified claim copy in, past-claim ids and scores back through a reducer"| ES
  STDB <-->|"live: subscriptions out, reducer calls in"| APP
  classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
  classDef ext fill:#E0F2F1,stroke:#00695C,color:#1A1A1A
  classDef web fill:#E3F2FD,stroke:#1565C0,color:#1A1A1A
  class STDB stdb
  class ES,BD ext
  class APP web
```

The people graph is the clearest example of the split:

- Social.md: SpacetimeDB holds the graph. `memory_tick` writes `people_link` rows (`met`, `visited`, `works_at`, `exhibits`) in the same transaction as the encounter or visit they come from, so a new link reaches every screen by subscription at once. `my_graph` gives each caller only their own neighbourhood and `event_graph` gives the ops big screen an anonymous picture of the whole event; only `findable` attendees get links. The browser draws these facts as solid links, live.
- Elastic.md: Elastic adds the meaning. `bandit-people` holds each findable attendee's interests, built from their top booths, and `GET /graph/similar` returns the people who are into the same things. The browser draws them as dashed links in the same picture, refreshed every 30 s; they arrive as ids only and never flow back into SpacetimeDB.

### Which store answers which question

The line is drawn by the question: exact, live or transactional questions go to SpacetimeDB; questions of meaning go to Elastic.

| Question or data | Store | Why |
|---|---|---|
| Every write: claims, incidents, payments, consent, imports | SpacetimeDB reducers | one transactional write path, so every screen sees the same committed state |
| Live state: band reports, zone state, directives, incidents | SpacetimeDB tables and subscriptions | pushed to every client the instant a transaction commits; nothing polls |
| Who was in which zone, and when | SpacetimeDB (`presence_sample`) | derived by `memory_tick` from raw reports; the filter every other question starts from |
| Plain lists: my visits, the people I hung out with, my photos by zone and time, a booth by id or name | SpacetimeDB views | exact rows, already scoped to the caller by the view; no ranking needed |
| People and the links between them: who owns which band, who hung out with whom, whose socials a person may see | SpacetimeDB tables and views | exact rows that reducers write and views read by key under consent; Elastic only ever ranks a consented copy |
| Consent and access: who may see a card, a tag, a memory | SpacetimeDB views and reducers | enforced by the database on every read; an app or index bug cannot widen it |
| Elastic.md: organizing scraped data before the import | Elastic (raw indices, fixed `LOOKUP JOIN` steps, the organizer agent, `bandit-bundles`) | exact joins and fuzzy entity resolution across messy sources are search work; the result is still loaded by a reducer |
| Elastic.md: "booths about wearable robotics", "the photo of me with the robot near the main stage" | Elastic (`bandit-booths`, `bandit-memories`, `bandit-photos`) | ranking by meaning with text and image vectors, over candidates SpacetimeDB narrowed by zone, time and consent |
| Elastic.md, Hyphenate.md: "which past claims look like this one" | Elastic (`bandit-claims`) | ranking by meaning over a de-identified copy against 30 seeded past claims; the ids and scores come back as checks through a reducer and never change an amount |
| Files: photos, PDFs, letters | the blob store on the Fly volume, with a `blob_ref` row | big bytes stay out of rows and subscriptions; the access class is still decided in the module |

### Deployment

Where each process runs, and how it reaches the database. There is one deployment. External services are left out of the picture: the Fly.io services and `bandit-ingest` call them over HTTPS.

```mermaid
flowchart TB
  subgraph Floor["Venue floor"]
    Bands["Bands"]
    Stations["Station markers, USB power"]
    Gateway["Gateway on USB"]
    Phones["Phones: judges' own, medic"]
  end
  subgraph Laptop["Demo laptop, online through a team phone's hotspot"]
    Bridge["bandit-bridge"]
    Sim["bandit-sim"]
    Ingest["bandit-ingest, before the event"]
    OpsUI["Ops dashboard in a browser"]
  end
  subgraph Fly["Fly.io Machine, always on"]
    Svc["bandit-api, bandit-workers, bandit-indexer"]
    Vol[("Fly volume: blobs")]
  end
  Maincloud[("SpacetimeDB Maincloud: bandit")]

  Bands <-->|"ESP-NOW"| Stations
  Bands <-->|"ESP-NOW"| Gateway
  Gateway -->|"USB serial"| Bridge
  Bridge -->|"WebSocket"| Maincloud
  Sim -->|"WebSocket"| Maincloud
  Ingest -->|"seed, import_event"| Maincloud
  OpsUI -->|"WebSocket"| Maincloud
  OpsUI -->|"app files"| Svc
  Phones -->|"NFC URL, app files, uploads, search"| Svc
  Phones -->|"WebSocket"| Maincloud
  Svc -->|"WebSocket"| Maincloud
  Svc -->|"files"| Vol

  classDef device fill:#FFF3E0,stroke:#E65100,color:#1A1A1A
  classDef rust fill:#FBE9E7,stroke:#BF360C,color:#1A1A1A
  classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
  classDef web fill:#E3F2FD,stroke:#1565C0,color:#1A1A1A
  class Bands,Stations,Gateway device
  class Bridge,Sim,Ingest,Svc,Vol rust
  class Maincloud stdb
  class Phones,OpsUI web
```

- The `bandit` database runs on SpacetimeDB Maincloud only. There is no standalone copy and no second host, so there is never a second source of truth.
- `bandit-api`, `bandit-workers` and `bandit-indexer` run on one always-on Fly.io Machine. `bandit-api` serves both web apps as static files from its public HTTPS host, which is the host written into the NFC tags, so judges use their own phones. Blobs are files on a Fly volume attached to that Machine ([Rust-Backend](../3-services/Rust-Backend.md)).
- The demo laptop runs only what needs the room: `bandit-bridge` on the gateway's USB cable and the Ops dashboard in a browser. `bandit-ingest` runs on it once before the event.
- Simulator.md: `bandit-sim` runs on the demo laptop.
- Vision.md (TBD -- LEO): `bandit-vision` runs on the demo laptop.
- The laptop gets internet from a team phone's hotspot, so venue Wi-Fi is not on the critical path.

### Identifiers that cross component boundaries

| Identifier | Format | Assigned by | Used by |
|---|---|---|---|
| Band id | 1 to 9 for real bands (one byte on the radio); 1000 and up for simulated bands | firmware flag; `bandit-sim` | radio, bridge, module, dashboard |
| Station id | 101 to 105; exit colour index defaults to id minus 100 | firmware flag | radio, zone selection, exit guidance |
| Gateway id | 200 | firmware | radio |
| NFC token | `BANDIT-01` to `BANDIT-09` in the URL `https://<host>/t/BANDIT-0n`, where `<host>` is `bandit-api`'s public host | written to each sticker | attendee app landing, medic view |
| Attendee id | SpacetimeDB identity of the attendee app's connection | SpacetimeDB | every per-person table and view |
| Service identity | one SpacetimeDB identity per Rust process, with a `staff_role` row | owner at setup | role checks in reducers |
| Row ids | auto-increment ids assigned by the module | SpacetimeDB | every other table, Elastic document ids, job payloads |

### Demo flows

The demo runs as a fixed sequence of steps from joining to the insurance claim, and [Flows](Flows.md) walks each step, names the doc that owns it and indexes the sequence diagrams in the other files.

### Access model in one paragraph

Every privileged reducer checks the caller's `staff_role`. People roles are `owner`, `ops`, `medic`, `photographer`, `floor_manager`, `risk_manager` and `adjuster`. Each Rust service has its own identity with a service role (`bridge`, `simulator`, `vision`, `ingest`, `indexer`, `worker`, `api`). Tables with personal data are private. Clients read them only through views keyed on who is asking, so rules such as "a medic sees a card only during an open incident" are enforced by the database, not by the app ([SpacetimeDB](../2-data/SpacetimeDB.md)).

### Prize tracks and where they live

| Track | What BandIt shows | Main docs |
|---|---|---|
| SpacetimeDB | the whole live world in one module on Maincloud: reducers as transactions (an SOS incident, its snapshot, its light circle and its escalation in one commit), subscriptions pushing every change to six kinds of clients, scheduled reducers computing zone state and history, identity and per-caller views enforcing access, typed bindings for Rust and TypeScript | [SpacetimeDB](../2-data/SpacetimeDB.md), [Safety](../6-features/Safety.md), [Gateway-Bridge](../3-services/Gateway-Bridge.md) |
| Elastic.md: best use of Elastic Agent Builder on Serverless | an Agent Builder agent (`bandit-organizer`) run by a Workflow with a schema per section, which resolves messy scraped records into one checked bundle before it loads into SpacetimeDB; meaning-ranked search over booths, memories and photos (text and image vectors); "into the same things" links on the people graph; Hyphenate.md: similar past claims ranked for each claim; Kibana views of every import run and dashboards of what people searched and where they spent time | [Elastic](../7-integrations/Elastic.md) |
| Hyphenate.md: autonomous systems for finance | a claims agent that learns live: a band's fall becomes a claim; Claude reads the urgent-care bill and code pays it against a fee schedule; Claude explains causation; a judge approves the first claim as risk manager, which teaches a rule, and the next similar claim settles in seconds under it; fakes are refused with every check listed. Behind it: evidence packs, coverage in code, an authority matrix, fail-closed approvals, a ledger, the notice of loss in ACORD 3 layout and a scorecard from planted claims | [Hyphenate](../7-integrations/Hyphenate.md) |
| Payments-Nessie.md: Capital One, best use of Nessie | merch bought in the app after the event and settled on the Nessie sandbox; claim payouts | [Payments-Nessie](../7-integrations/Payments-Nessie.md) |
| Merch.md: Visa, reimagining shopping | merch made from your own photo at the booths you loved, bought from your recap after the event | [Merch](../6-features/Merch.md) |
| Social impact and real-world tracks | preventive crowd-crush guidance with exit colours and vibration, the SOS light circle, dispersion around a medic; Medical-ID.md: medic access to the card | [Safety](../6-features/Safety.md), [Hardware](../4-devices/Hardware.md); Medical-ID.md |

## Failure modes and fallbacks

The failures that can happen during the demo, and the one answer to each. The first three are on the live path.

| Failure | Effect | Design answer |
|---|---|---|
| The laptop, the bridge, the gateway or the laptop's hotspot fails | No new reports reach the database; the dashboard greys bands after 5 s | Bands keep density colours, SOS, fall detection and the light circle on their own; the bridge resyncs directives when it reconnects ([Gateway-Bridge](../3-services/Gateway-Bridge.md)). |
| Radio density readings flap in the demo square | Rings and the map disagree | Ops drives the colours from the dashboard with the override badge showing, and the presenter says so ([Safety](../6-features/Safety.md)). |
| A band reboots | It loses forced states and live calibration | The bridge sees its `seq` reset and re-sends directives and `fleet_config` ([Gateway-Bridge](../3-services/Gateway-Bridge.md)). |
| Elastic.md: Elastic is unreachable during the demo | The search box fails | The app hides search and shows the exact lists from SpacetimeDB views, and the people graph keeps only its solid links; Hyphenate.md: claims carry no precedent checks and decide the same way; nothing live reads Elastic ([Elastic](../7-integrations/Elastic.md)). |
| Anthropic-Agent.md: Claude is slow or refuses | A letter or card is late; Hyphenate.md: a bill is not read or a claim has no causation review | Each feature falls back without AI as its doc describes; Hyphenate.md: staff type the bill lines and the claim goes to a person; nothing live waits on Claude ([Anthropic-Agent](../7-integrations/Anthropic-Agent.md)). |
| Payments-Nessie.md: Nessie is down | A merch order cannot settle | The order stays unpaid and the app offers to pay again; nothing else waits on Nessie ([Payments-Nessie](../7-integrations/Payments-Nessie.md)). |

## Dependencies

**Depends on:** every component doc, for the detail behind each box.

**Used by:** [README](../README.md) points here first; [Flows](Flows.md) and every component doc refer here for the big picture.

**If you delete a component:** remove its rows from the Interfaces, Data ownership, Which store answers which question, prize and failure tables above, its bullet in Deployment, its node from the diagrams, and its rows in [Flows](Flows.md). Core components (Hardware, Gateway-Bridge, SpacetimeDB, Safety, Ops-Dashboard, Attendee-App, Rust-Backend) are not meant to be deleted.

## Decisions

| Decision | Why |
|---|---|
| The `bandit` database runs on Maincloud only, and the demo laptop gets internet from a team phone's hotspot | one deployment means one source of truth, one set of identities and no switch-over during the demo; venue Wi-Fi is off the critical path |
| BrightData.md: the import works for any event, from the start URLs in its seed; the demo instance is Cal Hacks 13.0 | the product must work at any venue, and the judges are at Cal Hacks 13.0, so the booths, schedule and organisations on screen are ones they can check against the room |
| Judges use their own phones; `bandit-api` serves both web apps from its public HTTPS host, which the NFC tags hold | one host in the tags, and the app files, uploads and search share one origin |
| `bandit-api`, `bandit-workers` and `bandit-indexer` run on one Fly.io Machine; the laptop runs only the bridge, the simulator, `bandit-ingest` and the Ops dashboard | the laptop holds what needs the gateway's cable or the team's hands; the services keep running when the laptop sleeps |
| Social.md: people and the links between them live in SpacetimeDB tables; no graph database, separate Postgres or Kibana Graph | every link is an exact fact from a visit, an encounter row or the import, written in the same transaction as its visit or encounter, pushed live and filtered per caller by views; a graph of hundreds of nodes needs only one or two hops of indexed lookups; Kibana Graph is unavailable on Serverless and discovers implicit links, which the visit and encounter rows already record. Elastic.md: Elastic adds only the "into the same things" meaning |
| Payments-Nessie.md: nobody pays at the venue; Nessie settles only the merch bought in the app after the event and the claim payouts | the band press stays for claiming a band and a profile, and the money moments the demo shows are the merch checkout and the insurance payout |
| Full bands vibrate through `buzz` alongside the route colour whenever the module guides people | the ring has no compass, so colour plus vibration is how a band points its wearer along the dispersion route |
| The failure table keeps only failures that can happen during the demo | infrastructure faults outside the demo are handled in each component's own doc |
