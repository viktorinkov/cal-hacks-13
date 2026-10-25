# Architecture

BandIt is a festival wristband plus a SpacetimeDB module and Rust services that turn a crowd of bands into a live, shared map of the event. The bands sense crowd density and emergencies on their own.

One SpacetimeDB module, `band1t`, holds every piece of live state and performs every action. Feature services (Elastic, AI, payments, insurance, merch) hang off the module and can be removed one by one.

This file is the map: how the parts fit, where data lives, how the system is deployed, and what happens when a part fails.

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
| Band | Band, station marker, gateway | beacons (id, flags, neighbour count, zone, state, seq, the friend it is finding) at 10 Hz; a heard list (every peer heard in the last 2 s) once a second | ESP-NOW broadcast, channel 1 |
| Station marker | Band, gateway | station marker beacons (station id, exit colour) | ESP-NOW broadcast, 5 Hz |
| Gateway | Band, station marker | the 13 commands, such as `state`, `exit`, `clear` and `lowvis` | ESP-NOW broadcast, each sent 3 times |
| Gateway | `band1t-bridge` | one JSON line per packet heard; command lines back | USB serial, 115200 baud |
| `band1t-bridge` | `band1t` module | `gateway_up`; `ingest_band` when a band's line changes, else at most once a second; `ingest_station`; `ingest_heard`; `command_sent`; one subscription to the pending `command` rows | SpacetimeDB Rust client SDK (WebSocket) |
| The SpacetimeDB command line, run by the owner and organizers | `band1t` module | role grants, `import_event`, `start_safety_watch`, and the band commands that have no control on a page | SpacetimeDB CLI over HTTPS |
| Test-Bands.md: the `bandit-claims` command-line tool and `bandit-api`'s dev routes | `band1t` module | reports for the 10 test bands (90 to 99) through `report_test_band`; Social.md: the crowd, up to 2,000 bands from 100 (1,000 at the event), runs inside the module | SpacetimeDB Rust client SDK |
| Organizer portal (/organizer), tap page (/t/code) | `band1t` module | reducer calls; subscriptions to their slice | SpacetimeDB TypeScript client SDK (WebSocket) |
| Organizer portal, tap page | SpacetimeDB SpacetimeAuth | the magic-link email sign-in; an ID token that SpacetimeDB checks on connect | HTTPS, OpenID Connect |
| Organizer portal, tap page | `bandit-api` | the app files, uploads and downloads, and the feature endpoints listed in [Rust-Backend](../3-services/Rust-Backend.md) | HTTPS, same origin |
| `bandit-workers` | `band1t` module | claim jobs, submit results | SpacetimeDB Rust client SDK |
| Anthropic-Claude-API.md, Capital-One-Nessie.md: `bandit-workers` | Anthropic Claude API, Capital One Nessie API | AI calls, bank calls | HTTPS |
| Elastic.md: `bandit-indexer` | `band1t` module, Elastic Serverless | subscription in, bulk index writes out | SDK in, HTTPS out |
| Elastic.md: `bandit-api` | Elastic Serverless | `GET /recap/order`: semantic queries that order the recap's people and booths, over candidates SpacetimeDB listed | HTTPS |
| Bright-Data.md: `bandit-ingest` | Bright Data Web MCP, Anthropic Claude API, `band1t` module | page fetches and extraction; `floorplan_check`; `import_event` | HTTPS; SDK |
| Bright-Data.md: `pipeline/venue_model.py`, run by hand before the event | Bright Data Browser API | the Cal Hacks venue map opened in a remote browser; its 3D scene back as the file `web/venue/venue.glb` | CDP over WebSocket, through Playwright |
| Bright-Data.md: `bandit-workers`, job `venue_setup` | Bright Data Web MCP, Bright Data Web Unlocker API, Anthropic Claude API, Bright Data Browser API | a venue set up from the event's name on the organizer portal: search, pages, the picks `venue_find` and `venue_map`, and the model exported by `pipeline/venue_model.py` | HTTPS; CDP over WebSocket, through Playwright |
| Elastic.md: `bandit-ingest` | Elastic Serverless | parsed JSON records in; the bundle back from `bandit-organize` in Elastic Workflows | HTTPS |
| Elastic.md, Insurance.md: `bandit-workers` | Elastic Serverless, `band1t` module | a de-identified copy of each claim into `bandit-claims` through the pipeline `bandit-claims-validate`; the ids and scores of similar past claims back, written through `submit_claim_checks` | HTTPS; SDK |
| Elastic.md: the Elastic Agent Builder agent `bandit-organizer` | Bright Data Web MCP | at most 10 gap-fill `extract` calls per run, through an Agent Builder MCP tool | HTTPS |
| Vision.md (TBD -- LEO): `bandit-vision` | `band1t` module, `bandit-api`, Anthropic Claude API | zone counts, ground alerts, camera sightings, property events, photo features; frames stored as blobs; frames to the Anthropic Claude API | reducer calls; HTTPS |

## Design

### Principles

1. **Safety never waits.** Density colours, SOS, fall detection and the light circle run on the bands themselves. The module adds the incident record, the staff screens and the commands organizers send, but the bands stay useful if the venue laptop, the network or the cloud is gone.
2. **One source of truth.** The SpacetimeDB module `band1t` holds all live state. Every change is a reducer call, so it happens completely or not at all, and every screen sees the same committed state through subscriptions.
3. **Copies flow one way.** Any other store holds only files or a copy of committed rows. Results come back as SpacetimeDB ids, and acting on them is again a reducer call.
4. **Slow and external work goes through a queue.** AI and bank work are `job` rows claimed by `bandit-workers`. Code decides money, coverage, safety and access; the model only reads and writes words.
5. **Every feature can be deleted.** Core components are enough for the safety features. Each optional feature owns its tables, reducers and jobs, so removing its doc and code removes it cleanly.
6. **The module and services are Rust.** The module, every service and every shared library are Rust. Only the two browser apps are TypeScript.

### System context

Who uses BandIt, and which outside services it relies on.

```mermaid
flowchart LR
  Attendee["Attendee"]
  Staff["Staff: organizers and medics"]
  BandIt["BandIt: bands, gateway, band1t module, Rust services, organizer portal, tap page"]
  Auth["SpacetimeDB SpacetimeAuth"]
  Elastic["Elastic Serverless"]
  AnthropicAPI["Anthropic Claude API"]
  NessieAPI["Capital One Nessie API"]
  Bright["Bright Data"]
  Vision["bandit-vision (TBD -- LEO)"]

  Attendee -->|"taps band, presses to claim, reopens the tap link for the recap"| BandIt
  Staff -->|"runs the event, watches the map, handles incidents"| BandIt
  Attendee -->|"signs in by magic link"| Auth
  Staff -->|"signs in by magic link"| Auth
  Auth -->|"ID token, one identity per person"| BandIt
  BandIt -->|"scraped records to organize; one-way copy; recap order"| Elastic
  Elastic -.->|"capped gap-fill fetches"| Bright
  BandIt -->|"cards, floor plan, letters"| AnthropicAPI
  BandIt -->|"accounts, merch purchases, payouts"| NessieAPI
  BandIt -->|"fetch pages before the event"| Bright
  Vision -->|"counts, alerts, photo features"| BandIt

  classDef web fill:#E3F2FD,stroke:#1565C0,color:#1A1A1A
  classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
  classDef ext fill:#E0F2F1,stroke:#00695C,color:#1A1A1A
  classDef tbd fill:#F5F5F5,stroke:#757575,color:#1A1A1A,stroke-dasharray:5 5
  class Attendee,Staff web
  class BandIt stdb
  class Auth,Elastic,AnthropicAPI,NessieAPI,Bright ext
  class Vision tbd
```

### Containers

Every running process and the main flows between them. The left half is the live safety path; the right half is the feature services.

```mermaid
flowchart LR
  subgraph Venue["Venue floor"]
    Bands["Bands x9"]
    StationMarkers["Station markers"]
    Gateway["Gateway"]
  end
  subgraph Laptop["Venue laptop"]
    Bridge["band1t-bridge"]
    CLI["SpacetimeDB command line"]
    Sim["bandit-claims (Test-Bands.md)"]
  end
  STDB[("band1t module on SpacetimeDB Maincloud")]
  subgraph Apps["Browsers"]
    Portal["Organizer portal"]
    App["Tap page"]
  end
  subgraph Services["Rust services"]
    API["bandit-api"]
    Workers["bandit-workers"]
    Indexer["bandit-indexer"]
    Ingest["bandit-ingest"]
  end
  subgraph SaaS["External services"]
    Elastic["Elastic Serverless"]
    AnthropicAPI["Anthropic Claude API"]
    NessieAPI["Capital One Nessie API"]
    Bright["Bright Data"]
    Auth["SpacetimeDB SpacetimeAuth"]
  end

  Bands <-->|"ESP-NOW beacons"| StationMarkers
  Bands <-->|"beacons up, commands down"| Gateway
  Gateway <-->|"USB serial lines"| Bridge
  Bridge <-->|"reports up, commands down"| STDB
  CLI -->|"grants, organizer commands"| STDB
  Sim -->|"test band reports"| STDB
  Portal <-->|"subscriptions, organizer reducers"| STDB
  App <-->|"subscriptions, attendee reducers"| STDB
  Portal -->|"app files"| API
  App -->|"app files, uploads, recap order"| API
  Portal -->|"sign-in"| Auth
  App -->|"sign-in"| Auth
  API -->|"queries"| Elastic
  Workers <-->|"jobs"| STDB
  Workers -->|"HTTPS"| AnthropicAPI
  Workers -->|"HTTPS"| NessieAPI
  Workers -->|"venue setup"| Bright
  Workers <-->|"claim copies out, precedent ids back"| Elastic
  Indexer -->|"subscribe"| STDB
  Indexer -->|"bulk index"| Elastic
  Ingest -->|"fetch pages"| Bright
  Ingest -->|"floorplan_check"| AnthropicAPI
  Ingest -->|"JSON records; organized bundle back"| Elastic
  Elastic -.->|"gap fill, capped"| Bright
  Ingest -->|"import_event"| STDB

  classDef device fill:#FFF3E0,stroke:#E65100,color:#1A1A1A
  classDef rust fill:#FBE9E7,stroke:#BF360C,color:#1A1A1A
  classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
  classDef web fill:#E3F2FD,stroke:#1565C0,color:#1A1A1A
  classDef ext fill:#E0F2F1,stroke:#00695C,color:#1A1A1A
  class Bands,StationMarkers,Gateway device
  class Bridge,CLI,Sim,API,Workers,Indexer,Ingest rust
  class STDB stdb
  class Portal,App web
  class Elastic,AnthropicAPI,NessieAPI,Bright,Auth ext
```

Vision.md (TBD -- LEO): the security cameras are left out of this picture. Leo's security view runs on the venue laptop beside `band1t-bridge`. It records the gateway, finds a calling band's 4 Hz red flash on the security camera, and shows in the security view where the attendee is, from local files and without the module.

Vision.md (TBD -- LEO): `bandit-vision`, which would send the module head counts, person-down alerts, camera sightings and photo features through the reducers in [Vision](../4-devices/Vision.md), is Leo's to build. Identity always comes from the bands, never from faces.

### The live loop in one picture

What happens to one beacon, and how a command from an organizer gets back to the bands. Everything here is either on the band or a reducer call; nothing waits on AI or a queue. A band guides its attendee on its own: in GUIDE it chases its exit colour, and under low visibility it chases faster as it nears the exit marker glowing that colour while a full band pulses every 2 s ([Safety](../6-features/Safety.md)).

(TBD -- LEO) Exit routing and the medic approach send their colours and states through the same `command` table ([Safety](../6-features/Safety.md)).

```mermaid
sequenceDiagram
  participant B as Band
  participant G as Gateway
  participant BR as band1t-bridge
  participant M as band1t module
  participant D as Organizer portal
  B->>B: count neighbours, pick zone, set colour locally
  B-)G: beacon (ESP-NOW, 10 Hz)
  G->>BR: JSON line (USB serial)
  BR->>M: ingest_band (at once on a change, else once a second)
  M->>M: update the band row and its stay
  M-->>D: subscription update (map, zone table, alerts)
  M->>M: watch_bands every 500 ms: open an incident on an SOS or fall flag
  D->>M: an organizer reducer, such as set_low_vis
  M-->>BR: new command row (subscription)
  BR->>G: cmd line, such as cmd 0 lowvis 1
  G-)B: command (sent 3 times)
  BR->>M: command_sent after the gateway's ack
```

### Data ownership

Where each kind of data lives, and where copies go. "Source of truth" means the only place that data may be changed.

| Data | Source of truth | Written by | Copies |
|---|---|---|---|
| Venue layout: zones (each with its station marker and exit colour), booths, schedule | `band1t` module | `import_event` from the event bundle; organizers with `set_zone_station` and `place_booth`; Bright-Data.md: `bandit-ingest` builds the bundle | none; Elastic.md: `bandit-booths` |
| Bands, attendees, consent, staff roles | `band1t` module | tap page, organizers, the owner (role grants) | none |
| Band rows, station markers, the gateway, heard lists, events, commands, settings | `band1t` module | `band1t-bridge` through the ingest reducers, `sweep`, the `ops` reducers; Test-Bands.md: `report_test_band` from the `bandit-claims` tool and `bandit-api`, and `crowd_tick` for the crowd | none |
| Incidents, snapshots, witnesses, notes | `band1t` module | `watch_bands`, organizers, medics | none |
| Stays and encounters | `band1t` module (`zone_visit`, `encounter`) | `ingest_band`, `ingest_heard`, `sweep`; Test-Bands.md: `report_test_band` and `crowd_tick` | none; Social.md: `social_tick` turns them into `visit` and `social_encounter`; Elastic.md copies both, for findable attendees only, to `bandit-memories` |
| Social.md: the people graph | `band1t` module (`people_link`) | `social_tick`; `exhibits` links from the import | none; Elastic.md: `bandit-people` holds each findable attendee's interests, never the links |
| Medical-Card.md, Insurance.md: medical card (with the attendee's own health insurance), the venue's insurance policy | `band1t` module, private tables | tap page, workers | never copied |
| Capital-One-Nessie.md, Insurance.md: wallets, claims, ledger | `band1t` module | reducers; workers record the Capital One Nessie ids | Capital One Nessie holds the bank records but never moves a balance, so the wallet balance is the module's own sum; Elastic.md: a de-identified copy of each claim in `bandit-claims` (codes, amounts, zones, times and a narrative built by code), used only to rank similar past claims |
| Files: photos, PDFs, letters | the blob store, a folder in `/var/lib/bandit` on the Vultr VM | `bandit-api` and `bandit-workers`, each through `register_blob` | `blob_ref` row in the module (hash, size, owner, access class) |
| Bright-Data.md: raw fetch snapshots | versioned files kept with the project | `bandit-ingest` | loaded into the module through `import_event` |
| Anthropic-Claude-API.md: model calls | `model_call` rows plus response blobs | `bandit-workers`, `bandit-ingest`; Vision.md (TBD -- LEO): `bandit-vision` | used for audit |
| Elastic.md: raw scraped records and the organized bundle | Elastic raw indices and `bandit-bundles` | `bandit-ingest`, `bandit-organize` in Elastic Workflows | working data before the import; rebuilt from the snapshots at every run, never read at the event |

### What each database does best

SpacetimeDB and Elastic solve different problems, and BandIt shows each one doing what only it does. SpacetimeDB solves live shared state: many devices, services and screens changing and watching the same venue at once, where every screen must agree within one transaction.

What only SpacetimeDB does here:

| Strength | Where BandIt uses it | Why it matters here |
|---|---|---|
| Logic runs inside the database, as transactions | `watch_bands` opens an SOS incident, freezes its snapshot with the bands in the light circle and records its subject band in one transaction ([SpacetimeDB](../2-data/SpacetimeDB.md), [Safety](../6-features/Safety.md)) | every screen sees all of it or none of it; no app server sits between a band flag and the incident row |
| Push to every client on commit | the organizer portal's map, the medic's incident desk, the tap page and `band1t-bridge` subscribe to queries and receive each change, with a local cache to render from | an SOS reaches the medic without polling, and each new `command` row reaches `band1t-bridge` the moment it commits |
| Timers inside the database | scheduled reducers: `watch_bands` (500 ms) opens incidents from band flags and records witnesses; `sweep` (1 s) marks silent bands offline; `social_tick` (1 s) turns stays and encounters into memories | the derived state is computed where the data lives, on a fixed cadence |
| Identity and access next to the data | claiming a band by pressing it binds the band to the signed-in identity, which SpacetimeDB derives from the SpacetimeDB SpacetimeAuth ID token; reducers check `staff_role`; views return only the caller's rows (`open_incidents` for staff; the caller's own band for attendees) | access is enforced once, in the module, for every client, so an app bug cannot widen it |
| The space-time mapping | `zone_visit`, written by `ingest_band` as a band's zone changes: which band stayed in which zone, and when | it is the filter other questions start from (Social.md: visits and encounters; Elastic.md: the recap candidates it orders) |
| One schema, typed clients, one hosted module | `spacetime generate` gives the Rust services and both TypeScript apps the same types; SpacetimeDB Maincloud hosts the module, so bands (through `band1t-bridge`), phones, staff and services all reach the same module | six kinds of clients stay in step with one schema, and no server of ours sits on the live path |

Elastic.md: BandIt uses a second database because it has a second, different problem. Elastic solves meaning: messy scraped text before the import, and the order of an attendee's recap by what they were into, plus the analysis of it in Elastic Kibana.

Elastic.md: SpacetimeDB decides who and what is on the list (exact, private, live); Elastic decides the order by meaning (and organizes the scraped data, and finds claim precedents). Neither database does the other's job, and they meet in exactly three places, plus a fourth for Insurance.md's claim precedents, shown in the diagram after this table.

Elastic.md: live state never lives in Elastic. What only Elastic does here:

| Strength | Where BandIt uses it | Why it matters here |
|---|---|---|
| Ordering by meaning | `semantic_text` fields on `.jina-embeddings-v5-text-small`: `GET /recap/order` puts the people an attendee met and the booths they visited in order of how close they are to what the attendee was into ([Elastic](../7-integrations/Elastic.md)) | two people who visited different booths can still care about the same things; SpacetimeDB filters by exact values and has no relevance ranking or vectors |
| An agent that resolves messy records | the Elastic Agent Builder agent `bandit-organizer` on the Elastic Managed LLM, run by `bandit-organize` in Elastic Workflows with a JSON schema per section, searching candidates and giving a reason per merge | one company spelled three ways becomes one organisation before anything reaches the module |
| Bulk joins where raw data lands | Elastic ES\|QL `LOOKUP JOIN` steps match booth numbers, domains and stage names across thousands of raw records | the messy raw records never enter the module; only the checked bundle does |
| Analysis you can see | Elastic Kibana, Elastic's web interface: the Elastic Workflows execution view, Elastic Agent Builder, and the dashboards "BandIt · Cal Hacks 13.0 · scrape pipeline" and "BandIt · Cal Hacks 13.0 · sponsors and prizes"; Insurance.md: the "BandIt claims evidence" dashboard | the team shows how the data was organized and what the scrape found about the event, without touching the live screens |

The diagram shows where the two meet and which way data flows at each meeting point.

```mermaid
flowchart TB
  BD["Bright Data records"] -->|"raw JSON"| ES["Elastic: organize, order by meaning, analyze in Elastic Kibana"]
  ES -->|"1. import: one checked bundle, loaded by import_event"| STDB["SpacetimeDB: live state, every write"]
  STDB -->|"2. copy: findable rows, one way, by bandit-indexer"| ES
  ES -->|"3. order: ranked ids for the recap, through bandit-api, over candidates SpacetimeDB listed"| APP["Tap page"]
  STDB <-->|"4. Insurance.md precedents: de-identified claim copy in, past-claim ids and scores back through a reducer"| ES
  STDB <-->|"live: subscriptions out, reducer calls in"| APP
  classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
  classDef ext fill:#E0F2F1,stroke:#00695C,color:#1A1A1A
  classDef web fill:#E3F2FD,stroke:#1565C0,color:#1A1A1A
  class STDB stdb
  class ES,BD ext
  class APP web
```

The recap is the clearest example of the split:

- Social.md: SpacetimeDB holds the people graph and the lists. `social_tick` writes `people_link` rows (`met`, `visited`, `works_at`, `exhibits`) in the same transaction as the encounter or visit they come from, so a new link reaches every screen by subscription at once.
- Social.md: `my_graph` gives each caller only their own neighbourhood and `event_graph` gives the big screen the whole event with everyone's name, drawn in 3D with the event photos from the staff view `board_photos` among the people in them; only `findable` attendees get links. The recap's people come from `my_encounters` and its booths from `my_visits`.
- Elastic.md: Elastic orders the lists. `bandit-people` holds each findable attendee's interests, built from their top booths, and `GET /recap/order` puts the people and booths closest to what the attendee was into first. It returns ids only, adds no one to the list and draws nothing on the graph.

### Which store answers which question

The line is drawn by the question: exact, live or transactional questions go to SpacetimeDB; questions of meaning go to Elastic.

| Question or data | Store | Why |
|---|---|---|
| Every write: claims, incidents, payments, consent, imports | SpacetimeDB reducers | one transactional write path, so every screen sees the same committed state |
| Live state: band rows, station markers, commands, incidents | SpacetimeDB tables and subscriptions | pushed to every client the instant a transaction commits; nothing polls |
| Who was in which zone, and when | SpacetimeDB (`zone_visit`) | written by `ingest_band` as a band's zone changes; the filter every other question starts from |
| Plain lists: my visits, the people I hung out with, my photos by zone and time, a booth by id or name | SpacetimeDB views | exact rows, already scoped to the caller by the view; no ranking needed |
| People and the links between them: who owns which band, who hung out with whom, whose socials a person may see | SpacetimeDB tables and views | exact rows that reducers write and views read by key under consent; Elastic only ever orders a findable copy |
| Consent and access: who may see a card, a tag, a memory | SpacetimeDB views and reducers | enforced by the module on every read; an app or index bug cannot widen it |
| Elastic.md: organizing scraped data before the import | Elastic (raw indices, fixed `LOOKUP JOIN` steps, the Elastic Agent Builder agent, `bandit-bundles`) | exact joins and fuzzy entity resolution across messy sources are search work; the result is still loaded by a reducer |
| Elastic.md: "of the people I hung out with, who is most into the same things as me" | Elastic (`bandit-people`, `bandit-booths`) through `GET /recap/order` | ordering by meaning over candidates SpacetimeDB listed; there is no typed search |
| Elastic.md, Insurance.md: "which past claims look like this one" | Elastic (`bandit-claims`) | ranking by meaning over a de-identified copy against 30 seeded past claims; the ids and scores come back as checks through a reducer and never change an amount |
| Files: photos, PDFs, letters | the blob store in `/var/lib/bandit`, with a `blob_ref` row | big bytes stay out of rows and subscriptions; the access class is still decided in the module |

### Deployment

Where each process runs, and how it reaches the module. There is one deployment. External services are left out of the picture: the services on the VM and `bandit-ingest` call them over HTTPS.

```mermaid
flowchart TB
  subgraph Floor["Venue floor"]
    Bands["Bands"]
    StationMarkers["Station markers, USB power"]
    Gateway["Gateway on USB"]
    Phones["Phones: judges' own, medic"]
  end
  subgraph Laptop["Venue laptop, online through a team phone's hotspot"]
    Bridge["band1t-bridge"]
    Sim["bandit-claims (Test-Bands.md)"]
    Ingest["bandit-ingest, before the event"]
    OpsUI["Organizer portal in a browser"]
  end
  subgraph VM["Vultr VM, always on: band1t.vip"]
    Svc["Caddy, then bandit-api, bandit-workers, bandit-indexer as systemd services"]
    Vol[("/var/lib/bandit: identities, blobs, records")]
  end
  STDBCloud[("SpacetimeDB Maincloud: band1t")]

  Bands <-->|"ESP-NOW"| StationMarkers
  Bands <-->|"ESP-NOW"| Gateway
  Gateway -->|"USB serial"| Bridge
  Bridge -->|"WebSocket"| STDBCloud
  Sim -->|"WebSocket"| STDBCloud
  Ingest -->|"seed, import_event"| STDBCloud
  OpsUI -->|"WebSocket"| STDBCloud
  OpsUI -->|"app files"| Svc
  Phones -->|"NFC URL, app files, uploads, recap order"| Svc
  Phones -->|"WebSocket"| STDBCloud
  Svc -->|"WebSocket"| STDBCloud
  Svc -->|"files"| Vol

  classDef device fill:#FFF3E0,stroke:#E65100,color:#1A1A1A
  classDef rust fill:#FBE9E7,stroke:#BF360C,color:#1A1A1A
  classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
  classDef web fill:#E3F2FD,stroke:#1565C0,color:#1A1A1A
  class Bands,StationMarkers,Gateway device
  class Bridge,Sim,Ingest,Svc,Vol rust
  class STDBCloud stdb
  class Phones,OpsUI web
```

- The `band1t` module runs on SpacetimeDB Maincloud only, as the database `bandit-calhacks13-sp82j`. There is no standalone copy and no second host, so there is never a second source of truth.
- `bandit-api`, `bandit-workers` and `bandit-indexer` run on one always-on Debian VM on Vultr, as systemd services that restart on failure. Caddy on the VM serves HTTPS for band1t.vip and passes each request to `bandit-api`.
- `bandit-api` serves both web apps as static files from band1t.vip, which is the host written into the NFC tags, so judges use their own phones. The three services share the data folder `/var/lib/bandit`: the service identities, the blob store and the rendered records ([Rust-Backend](../3-services/Rust-Backend.md)).
- The venue laptop runs only what needs the venue: `band1t-bridge` on the gateway's USB cable, the organizer portal in a browser, and the SpacetimeDB command line for the band commands that have no control on a page. `bandit-ingest` runs on it once before the event.
- Test-Bands.md: the `bandit-claims` command-line tool runs on the venue laptop.
- Vision.md (TBD -- LEO): `bandit-vision` runs on the venue laptop.
- The venue laptop gets internet from a team phone's hotspot, so venue Wi-Fi is not on the critical path.

### Identifiers that cross component boundaries

| Identifier | Format | Assigned by | Used by |
|---|---|---|---|
| Band id | 32 bits, never shown to people; ids 1 to 99 fit one byte, as on the radio: 1 to 9 for real bands; Test-Bands.md: 90 to 99 for the test bands, and the crowd's bands from 100, which only the module and the organizer portal see | firmware flag; Test-Bands.md: `start_crowd` and the test band id range | radio, bridge, module, organizer portal |
| Station id | 101 to 105; the station marker's colour defaults to the station id minus 100 | firmware flag | radio, the zone pick on the band, `zone.station_id` |
| Gateway id | 200 | firmware | radio |
| Band code | eight characters in two groups of four, such as `K3QX-9A7M`, computed from the band id with a check character ([Tap-Page](../5-apps/Tap-Page.md)); the NFC token is the URL `https://band1t.vip/t/<band code>`, on `bandit-api`'s public host | `band_code` in the module and the same function in the web pages; written to each sticker | the tap page, `claim_band`, every staff screen that names a band |
| Attendee id | SpacetimeDB identity derived from the SpacetimeDB SpacetimeAuth ID token (issuer and subject), the same on every device | SpacetimeDB | every per-person table and view |
| Service identity | one SpacetimeDB identity per Rust process, with a `staff_role` row; `band1t-bridge`'s identity is the one row of `bridge`, from `register_bridge`, not a role | the owner at setup; `band1t-bridge` registers itself | role checks in reducers |
| Row ids | auto-increment ids assigned by the module | SpacetimeDB | every other table, Elastic document ids, job payloads |

### The event flow

The event runs as a fixed sequence of steps from joining to the recap, and [Flows](Flows.md) walks each step, names the doc that owns it and indexes the sequence diagrams in the other files.

### Access model in brief

Every person signs in with the SpacetimeDB SpacetimeAuth magic link, and every privileged reducer checks the caller's `staff_role`. People roles are `owner` (the publishing identity, the only one that grants roles), `ops` (the organizer, who runs the event) and `medic` (the medic during the event).

Each Rust service has its own identity with a service role (`tester`, `vision`, `ingest`, `indexer`, `worker`, `api`). `band1t-bridge` holds no role: it is the one identity that registered with `register_bridge`.

Tables with personal data are private. Clients read them only through views keyed on who is asking, so rules such as "an attendee sees only their own band" are enforced by the module, not by the app ([SpacetimeDB](../2-data/SpacetimeDB.md)).

Social.md: one more people role, `photographer`, uploads booth photos.

### Prize tracks and where they live

| Track | What BandIt shows | Main docs |
|---|---|---|
| SpacetimeDB | the whole live world in one module on SpacetimeDB Maincloud: reducers as transactions (an SOS incident, its snapshot and its light circle in one commit), subscriptions pushing every change to six kinds of clients, scheduled reducers that open incidents, sweep silent bands and turn stays into memories, identity from the SpacetimeDB SpacetimeAuth sign-in and per-caller views enforcing access, typed bindings for Rust and TypeScript | [SpacetimeDB](../2-data/SpacetimeDB.md), [Safety](../6-features/Safety.md), [Gateway-Bridge](../3-services/Gateway-Bridge.md) |
| Elastic.md: best use of Elastic Agent Builder on Serverless | an Elastic Agent Builder agent (`bandit-organizer`) run by Elastic Workflows with a schema per section, which resolves messy scraped records into one checked bundle before it loads into SpacetimeDB; each attendee's recap suggestions ordered by meaning; Insurance.md: similar past claims ranked for each claim; Elastic Kibana dashboards of every scrape pipeline run and of the event's sponsors and prizes, linked from the organizer portal's "Kibana" tab. Where people spent time and what they were into shows in each attendee's recap, ordered by meaning | [Elastic](../7-integrations/Elastic.md) |
| Insurance.md: Hyphenate, autonomous systems for finance | The Decision Engine, which learns from the organizer: a band's fall becomes a claim; the Anthropic Claude API reads the urgent-care bill and code pays it against a fee schedule; the Anthropic Claude API explains causation; the organizer approves the first claim after the event, which teaches a rule, and the next similar claim settles in seconds under it; fakes are refused by code with every check listed. Behind it: evidence packs, coverage in code, fail-closed approvals, a ledger, the notice of loss in ACORD 3 layout and a scorecard from planted claims | [Insurance](../6-features/Insurance.md) |
| Capital-One-Nessie.md: Capital One, best use of the Capital One Nessie API | a $200 Capital One Nessie sandbox wallet per attendee, merch bought from it with one tap after the event, and claim payouts into it | [Capital-One-Nessie](../7-integrations/Capital-One-Nessie.md) |
| Merch.md: Visa, reimagining shopping | merch made from your own photo at the booths you loved, bought from your recap after the event | [Merch](../6-features/Merch.md) |
| Social impact and real-world tracks | crowd density on every wrist, an exit marker at every exit in that exit's colour, the SOS light circle, low visibility; Medical-Card.md: medic access to the card from a tap on the band or from the incident desk | [Safety](../6-features/Safety.md), [Hardware](../4-devices/Hardware.md); Medical-Card.md |
| (TBD -- LEO) Social impact, exit routing and the medic approach | each zone's bands sent to their nearest open door, and the crowd moved aside for a medic | [Safety](../6-features/Safety.md) |

## Failure modes and fallbacks

The failures that can happen during the event, and the one answer to each. The first three are on the live path.

| Failure | Effect | Design answer |
|---|---|---|
| The venue laptop, `band1t-bridge`, the gateway or the venue laptop's hotspot fails | No new reports reach the module; `sweep` marks the hardware bands offline after 5 s and the map drops them | Bands keep density colours, SOS, fall detection and the light circle on their own; `band1t-bridge` exits when it loses SpacetimeDB, and the team starts it again ([Gateway-Bridge](../3-services/Gateway-Bridge.md)). |
| Radio density readings flap in the taped square | Rings and the map disagree | An organizer turns on the override with `set_override` and drives the colours by hand with `force_state` from the SpacetimeDB command line, and the presenter says so ([Safety](../6-features/Safety.md)). |
| A band reboots | It keeps its saved thresholds, RSSI and low visibility, but forgets its exit colour (back to blue), the override and any forced state | An organizer sends the exit colour again with `set_exit` from the SpacetimeDB command line ([Safety](../6-features/Safety.md)). |
| A sign-in email is slow | A judge waits on the sign-in screen | The screen offers "Send again"; a judge already signed in on their phone stays signed in ([Tap-Page](../5-apps/Tap-Page.md)). |
| Elastic.md: Elastic is unreachable during the event | The recap's suggestions are not ordered by meaning | The recap shows both lists by minutes together; Insurance.md: claims carry no precedent checks and decide the same way; nothing live reads Elastic ([Elastic](../7-integrations/Elastic.md)). |
| Anthropic-Claude-API.md: the Anthropic Claude API is slow or refuses | A letter or card is late; Insurance.md: a bill is not read or a claim has no causation review | Each feature falls back without AI as its doc describes; Medical-Card.md: the card step shows "Check later" and setup goes on without a card; Insurance.md: staff type the bill lines and the claim goes to a person; nothing live waits on the Anthropic Claude API ([Anthropic-Claude-API](../7-integrations/Anthropic-Claude-API.md)). |
| Capital-One-Nessie.md: the Capital One Nessie API is down | A wallet cannot open, and a merch order or a payout cannot settle | Each job retries without paying twice; a dead purchase fails the order and frees its money, so the attendee can buy again; a dead payout waits for `retry_claim_payout`; nothing else waits on the Capital One Nessie API ([Capital-One-Nessie](../7-integrations/Capital-One-Nessie.md)). |

## Dependencies

**Depends on:** every component doc, for the detail behind each box.

**Used by:** [README](../README.md) points here first; [Flows](Flows.md) and every component doc refer here for the big picture.

**If you delete a component:** remove its rows from the Interfaces, Data ownership, Which store answers which question, prize and failure tables above, its bullet in Deployment, its node from the diagrams, and its rows in [Flows](Flows.md). Core components (Hardware, Gateway-Bridge, SpacetimeDB, Safety, Organizer-Portal, Tap-Page, Rust-Backend) are not meant to be deleted.

## Decisions

| Decision | Why |
|---|---|
| The `band1t` module runs on SpacetimeDB Maincloud only, and the venue laptop gets internet from a team phone's hotspot | one deployment means one source of truth, one set of identities and no switch-over during the event; venue Wi-Fi is off the critical path |
| Bright-Data.md: the import works for any event, from the start URLs in its seed; Cal Hacks 13.0 is the first event it runs at | the product must work at any venue, and the judges are at Cal Hacks 13.0, so the booths, schedule and organisations on screen are ones they can check against the venue |
| Judges use their own phones; `bandit-api` serves both web apps from its public HTTPS host, which the NFC tags hold | one host in the tags, and the app files, uploads and API calls share one origin |
| `bandit-api`, `bandit-workers` and `bandit-indexer` run on one Vultr VM; the venue laptop runs only `band1t-bridge`, the `bandit-claims` tool, `bandit-ingest` and the organizer portal | the venue laptop holds what needs the gateway's cable or the team's hands; the services keep running when the venue laptop sleeps |
| Social.md: people and the links between them live in SpacetimeDB tables; no graph database, separate Postgres or Elastic Kibana Graph | every link is an exact fact from a visit, an encounter row or the import, written in the same transaction as its visit or encounter, pushed live and filtered per caller by views; a graph of hundreds of nodes needs only one or two hops of indexed lookups; Elastic Kibana Graph is unavailable on Serverless and discovers implicit links, which the visit and encounter rows already record. Elastic.md: Elastic only orders the recap's suggestions |
| Capital-One-Nessie.md: nobody pays at the venue; the Capital One Nessie API settles only the merch bought in the app after the event and the claim payouts | the band press stays for claiming a band, and the money moments judges see at the event are the merch checkout and the insurance payout |
| A band in GUIDE chases its exit colour; under low visibility it chases faster as it nears the exit marker glowing that colour, and a full band pulses every 2 s | the ring has no compass, so colour, speed and vibration are how a band points its attendee to the door |
| One sign-in for every person: the SpacetimeDB SpacetimeAuth magic link, with no other providers | the identity comes from the ID token's issuer and subject, so a judge is the same attendee on every device, and BandIt keeps no password and sends no email |
| The failure table keeps only failures that can happen during the event | other infrastructure faults are handled in each component's own doc |
