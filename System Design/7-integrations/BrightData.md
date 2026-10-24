# Bright Data

`bandit-ingest` is a Rust command-line tool the team runs before the event. It works for any event: it starts from the list of start URLs in the event's seed and fetches the event's public pages and its organisations' pages through the Bright Data Web MCP, saves every fetch as a versioned snapshot kept with the project, has Elastic organize the records into one event bundle (organisations, booths with positions, halls, schedule, unclaimed people profiles), and loads the bundle into SpacetimeDB in one transaction with the `import_event` reducer. Everything downstream (the Ops dashboard map, visits, the profile claim, the Elastic copy) sees ordinary SpacetimeDB rows and never knows a scrape happened. Bright Data owns every step that touches the web, Elastic every step after the raw records land, and SpacetimeDB everything live or exact. The snapshots mean that no demo or rerun depends on a live scrape. Cal Hacks 13.0 is the demo instance.

## Role in the system

Responsibilities:

- Fetch any event's public pages through the Bright Data Web MCP, starting from the start URLs in the event's seed: the event's site, its exhibitor or sponsor list, its schedule and its floor plan image; then each organisation's own site and its company facts. Keep a dated snapshot of every fetch.
- Build the booth geometry: Claude's `floorplan_check` reads booth numbers and their positions from the floor plan image, the hall's real width from the seed turns pixels into plan metres, and each booth gets the nearest station's zone.
- Build unclaimed `person` profiles from event pages only (speakers, judges, sponsor representatives, exhibitor contacts, artists), and let an attendee who has claimed their band claim their profile at onboarding with one tap.
- Validate the organized bundle in Rust, keep the last good bundle, and load it with `import_event`, keyed by stable source keys so reruns are idempotent. Every scraped row carries `source_url` and `fetched_at`.
- Own the optional tables `hall`, `organization`, `person` and `person_claim`, the reducers `import_event` and `claim_person`, and the view `claimed_people`.
- Report progress through `heartbeat` while it runs, like every Rust service.

Non-responsibilities:

- **Never scrapes people.** No person scraper, no social profile, no lookup of a person by name. People come only from what the event itself publishes. Every attendee types their own social handles at onboarding ([Social](../6-features/Social.md) owns `social_handle`). Elastic.md: the organizer's gap-fill tool is held to the same rule and fetches organisation and event pages only.
- Does not merge facts across sources. That is the organizer's job ([Elastic](Elastic.md)). Page extraction happens once, at fetch time, through Bright Data `extract` with the null rule; Elastic receives JSON records, never page bodies.
- Does not define zones or exits. The core seed in [SpacetimeDB](../2-data/SpacetimeDB.md) creates the station zones and the exits; the bundle never changes them.
- Does not scrape merch. [Merch](../6-features/Merch.md) loads its hand-made templates from `assets/merch/templates.json`.
- Does not run during the event and is never on the safety path.
- Does not own `booth`, `schedule_slot` or `venue` ([SpacetimeDB](../2-data/SpacetimeDB.md)); it fills them.

Elastic.md: the organize stage turns the records into the bundle. Without Elastic.md there is no scraped bundle to load, and booths and their organisations are entered by hand on the Ops dashboard with `upsert_booth`.

## Interfaces

| Interface | Direction | Who | What flows | Transport |
|---|---|---|---|---|
| Bright Data Web MCP | out | `bandit-ingest`, fetch stage | `search_engine` to find an organisation's official site; `extract` with a record schema and the null rule for event and exhibitor pages; `web_data_linkedin_company_profile` and `web_data_crunchbase_company` for company facts; `scrape_as_markdown` to find the floor plan image link; `scraping_browser_navigate` and `scraping_browser_screenshot` to capture the floor plan and logo images | HTTPS JSON-RPC tool calls to the remote MCP server, Pro mode on, with the account token |
| Elastic.md: Bright Data Web MCP, gap fill | out | the organizer agent in Elastic, through an Agent Builder MCP tool | `extract` on an organisation or event page the raw records name but no snapshot covers; one JSON record back; at most 10 calls per run (starting value) | the same MCP server with a zone token of its own that has its own spending limit ([Elastic](Elastic.md)) |
| Claude API | out | `bandit-ingest`, map stage, through `claude-client` | `floorplan_check`: the floor plan image and the booth numbers the exhibitor records list; back come the hall's edges and each visible booth's centre in pixels, or null | HTTPS Messages API, structured output; recorded in `model_call` ([Anthropic-Agent](Anthropic-Agent.md)) |
| Seed files | in | `bandit-ingest`, map and load stages | for the event: the list of start URLs, each with its page kind; per hall: name, real width in metres, offset in the venue plan frame; for the venue: plan origin and rotation, recorded on site at setup | hand-written files next to the core seed ([SpacetimeDB](../2-data/SpacetimeDB.md)) |
| Snapshot and bundle files | out and in | `bandit-ingest`; the team by review | raw snapshots with their fetch metadata, parsed records, and the last good bundle | versioned files kept with the project |
| Elastic.md: raw indices and the organizer | out and in | `bandit-ingest`, organize stage | parsed JSON records, map-stage geometry and the core station and zone rows out to `bandit-raw-pages`, `bandit-raw-orgs` and `bandit-raw-plan`; one `bandit-organize` workflow execution per run; back comes the bundle document from `bandit-bundles` | HTTPS Bulk API and Workflows API with the Elastic ingest key ([Elastic](Elastic.md)) |
| `import_event` reducer | out | `bandit-ingest`, load stage (role `ingest`) | the whole bundle; back come row counts per section | SpacetimeDB Rust client SDK, one reducer call, one transaction |
| `heartbeat` reducer | out | `bandit-ingest` while running | name, version, pages fetched, records built, rows imported, failures, every 5 s | SpacetimeDB reducer call |
| `claim_person` reducer | in | Attendee app, signed in as the attendee | the `person` id the attendee says is them; refused unless the caller already owns a band | SpacetimeDB reducer call |
| Loaded rows | out | `bandit-indexer` ([Elastic](Elastic.md)), Attendee app, Ops dashboard | `organization`, `booth`, `hall`, `schedule_slot`, `person` rows by subscription; the attendee app also reads `claimed_people` | SpacetimeDB subscription |

## Design

### Scope rule

The scrape covers the event and organisations, never people. The only person records are unclaimed profiles built from pages the event itself publishes (a speaker page, a judge list, a sponsor's named representative, an exhibitor's listed contact, an artist on the line-up), and they hold only what that page says: name, role, organisation, the photo it shows and the page it came from. Handles come from the attendee: their Instagram, Facebook and Threads handles, typed at onboarding ([Social](../6-features/Social.md)), with or without a claimed profile. So every fact about a person in the system is one the event published or the person entered.

### Sources

The import is the same for every event. The event's seed lists its start URLs, each with its page kind: the event's own site, its exhibitor or sponsor list, its schedule page and the page that shows its floor plan image. The page kind picks the record schema. Each source below is a named entry in the ingest configuration with the Web MCP tool that fetches it, the record schema, and the features that need it; only the start URLs change from one event to the next. Core safety needs none of them, which is why the whole file is optional.

The demo instance is Cal Hacks 13.0, at the Palace of Fine Arts. Its start URLs are the event's own site, its Devpost page (the sponsor list with tiers) and its schedule page.

| Source | Pages | Gives | Web MCP tools | Needed by |
|---|---|---|---|---|
| `event_pages` | the start URLs: the event's own site (sponsors, speakers, judges, venue, dates), its exhibitor or sponsor list (with tiers when it gives them) and its schedule page | `organization` candidates with tier; `person` candidates; `schedule_slot` records; event and venue facts | `extract` with a schema per page kind | booths and schedule for [Social](../6-features/Social.md), [Elastic](Elastic.md) and the attendee app; people for the profile claim |
| `exhibitor_pages` | each organisation's public home and about pages, found from the sponsor list or with `search_engine` | description, tags, logo, company social pages, booth number when the page states it | `search_engine`, `extract`; the browser tools for the logo image | booth descriptions for [Elastic](Elastic.md) |
| `org_facts` | the organisation's LinkedIn company page and Crunchbase company page | industry, headquarters, size range, founding year, short description, funding summary | `web_data_linkedin_company_profile`, `web_data_crunchbase_company` (company pages only) | richer booth documents in [Elastic](Elastic.md) |
| `floor_plan` | the floor plan image on the start URL of kind map | booth numbers and their positions | `scrape_as_markdown` finds the image link; `scraping_browser_navigate` and `scraping_browser_screenshot` capture the image | booth positions for the Ops map, [Social](../6-features/Social.md) visits and the Kibana map ([Elastic](Elastic.md)) |

### The Bright Data Web MCP

Every fetch goes through the Bright Data Web MCP server. `bandit-ingest` speaks the MCP protocol directly (JSON-RPC tool calls over HTTPS with the account token), so no agent runtime is involved. Pro mode is switched on, because `extract`, the company dataset tools and the browser tools are Pro tools; the credits cover them. Each tool has one job:

| Tool | Used for | Behaviour the design relies on |
|---|---|---|
| `extract` | every event and exhibitor page: a URL becomes JSON against a schema given in the call | always told to return null for a field it cannot find rather than guess; its output is validated against the schema before use |
| `search_engine` | finding an organisation's official site from its name on the sponsor list | one query per organisation that has no website on the event pages |
| `web_data_linkedin_company_profile`, `web_data_crunchbase_company` | company facts, collected by company page URL | structured JSON back; a call can take a minute or more, because Bright Data collects the page before answering |
| `scrape_as_markdown` | reading the event's map page to find the floor plan image link | a link hunt needs no schema |
| `scraping_browser_navigate`, `scraping_browser_screenshot` | capturing an image: the floor plan and each organisation's logo | the only tools that return an image; used for nothing else |

Elastic.md: the organizer's gap-fill tool calls the same `extract` through a separate zone token with its own spending limit, and its results are saved as snapshots like any other fetch.

Constraints the pipeline is built around:

- **Open pages, no sign-in.** Every source is a page anyone can open. `bandit-ingest` never signs in and never fills a form.
- **`extract` must not guess.** Every call carries the null rule and a strict schema. A record with a null required field is dropped and listed in the import report.
- **Credits are finite.** Each source has a page budget the run will not exceed, retries are capped at 3 per URL, and each call waits at most 10 min (starting value).
- **One run per import.** A person starts a run; there are no scheduled re-scrapes. A rerun reads the snapshots first and fetches only what is missing.

### Pipeline

Six stages, one of them in Elastic. Each stage reads the previous stage's artefacts, so any stage can be rerun alone. Bright Data owns the fetch, Rust owns the deterministic stages, and the Elastic organizer owns the organize stage.

| Stage | Reads | Produces | Notes |
|---|---|---|---|
| fetch | the ingest configuration and the event's start URLs from the seed | one raw snapshot per fetch: the JSON record or image, plus URL, time, tool, status and the SHA-256 of the body | never overwrites; the latest snapshot per source is marked. Elastic.md: gap-fill records from an earlier run are snapshots too and are read here, so the organizer finds no gap on a rerun |
| parse | latest snapshots | records with `source_key`, `source_url`, `fetched_at` | schema validation of the `extract` and dataset JSON; same snapshot, same output |
| map | the floor plan snapshot, the seed's hall entries, the station rows | booth geometry per hall: booth number, plan position, confidence, nearest station | the booth map below |
| Elastic.md: organize | parsed records, the map output, the core station and zone rows | the bundle: organisations deduplicated and merged across sources, booths linked to organisations and geometry, people linked to organisations, categories and tags, schedule slots matched to stages and zones, a reason per merge, a gaps list | writes the records to the raw indices, runs `bandit-organize` once, reads the bundle back and saves gap-fill records as snapshots ([Elastic](Elastic.md)) |
| validate | the bundle, the raw records of the run | a checked bundle, saved as the last good bundle | the same rules `import_event` enforces; a run that fails here leaves the previous last good bundle in place |
| load | the last good bundle | SpacetimeDB rows through one `import_event` call, and an import report with row counts per section, dropped records and the gaps list | one transaction: either the whole event is in or nothing changed. Afterwards the stage compares row counts per table with the bundle, and runs again before doors open |

The diagram answers: how do public pages become one bundle that lands in SpacetimeDB in a single transaction?

```mermaid
flowchart TB
  SRC["Public pages: event site, exhibitor sites, company pages, floor plan"] -->|"HTTPS"| BD["Bright Data Web MCP: extract, search_engine, company dataset tools, browser tools"]
  BD -->|"JSON records, images"| F["fetch stage"]
  F -->|"bodies and metadata"| SNAP["Raw snapshots (versioned files)"]
  SNAP -->|"JSON records"| P["parse stage"]
  SNAP -->|"floor plan image"| M["map stage"]
  CL["Claude API"] -->|"floorplan_check: booth centres in pixels"| M
  SEED["Seed: hall width and offset"] --> M
  P -->|"records"| O["organize stage (Elastic.md)"]
  M -->|"booth geometry, nearest station"| O
  O -.->|"records out, bundle back"| ES["Elastic Serverless: bandit-organize"]
  O -->|"bundle"| V["validate stage"]
  V -->|"saved as the last good bundle"| L["load stage"]
  L -->|"import_event, one transaction"| STDB["band1t module"]
  classDef rust fill:#FBE9E7,stroke:#BF360C,color:#1A1A1A
  classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
  classDef ext fill:#E0F2F1,stroke:#00695C,color:#1A1A1A
  class F,P,M,O,V,L,SNAP,SEED rust
  class STDB stdb
  class SRC,BD,CL,ES ext
```

### The booth map

The floor plan has one path. Bright Data captures the image the event publishes; Claude reads the booth numbers off it; one typed number, the hall's real width, turns pixels into metres; and ops fixes any booth that lands in the wrong place by dragging it on the Ops dashboard map. One floor plan image is one hall and one `hall` row; the Cal Hacks demo has one hall.

1. **Capture.** The fetch stage finds the image link on the event's map page (its start URL of kind map) with `scrape_as_markdown`, opens it with `scraping_browser_navigate` and saves `scraping_browser_screenshot` as the floor plan snapshot. The load stage uploads it through `bandit-api`'s blob endpoint, which calls `register_blob` with access class `staff`, and stores the id in `hall.sheet_blob_id`.
2. **Read.** `floorplan_check` ([Anthropic-Agent](Anthropic-Agent.md)) receives the image and the booth numbers the exhibitor records list. It returns the hall's outer edges in pixels and, for each booth number it can see, the centre in pixels with a confidence. A listed number it cannot see comes back null; it never invents a number that is not printed on the plan.
3. **Pixels to metres.** The seed holds the hall's real width in metres. Metres per pixel is that width divided by the hall's width in pixels, stored as `hall.metres_per_unit`. The hall's top-left corner plus the seed's offset (zero for the single demo hall) places every booth in the venue plan frame, the same frame the station positions are measured in.
4. **Nearest station zone.** Each booth centre is compared with the station positions (`station.plan_x_m`, `station.plan_y_m`, [SpacetimeDB](../2-data/SpacetimeDB.md)); the nearest station's zone becomes `booth.zone_id`. A booth farther than 40 m (starting value, calibrate) from every station gets no zone.
5. **Join and load.** The map stage hands this geometry to the organizer, whose `LOOKUP JOIN` step links each exhibitor's booth mention to its geometry by normalised booth number ([Elastic](Elastic.md)). Geometry without a mention becomes a booth named by its number, with kind `other`; a mention without geometry loads with `placement_source` `none`.
6. **Fix by hand.** Booths without a position or a zone load anyway, flagged, and appear in the Ops dashboard's booth fix-up panel (one panel row in [Ops-Dashboard](../5-apps/Ops-Dashboard.md) starting with "BrightData.md"). Ops drags each one to its place on the map, which calls `upsert_booth` and sets `booth.placement_source` to `manual`; a rerun of `import_event` never overwrites a `manual` placement.

The diagram answers: where does a booth's position come from?

```mermaid
flowchart TB
  IMG["Floor plan image (Bright Data browser tools)"] --> CHK["floorplan_check (Claude API)"]
  REC["Booth numbers from exhibitor records"] --> CHK
  CHK -->|"hall edges, booth centres in pixels"| N["Pixels to metres"]
  SEED["Seed: hall real width, offset"] --> N
  N -->|"booth number, plan metres"| Z["Nearest station zone"]
  ST["station rows"] -->|"plan positions"| Z
  Z -->|"booth geometry"| J["Organizer LOOKUP JOIN on booth number (Elastic.md)"]
  J -->|"booths in the bundle"| B["import_event"]
  B -->|"no position or no zone, flagged"| FIX["Ops dashboard: drag the booth (upsert_booth)"]
  classDef rust fill:#FBE9E7,stroke:#BF360C,color:#1A1A1A
  classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
  classDef web fill:#E3F2FD,stroke:#1565C0,color:#1A1A1A
  classDef ext fill:#E0F2F1,stroke:#00695C,color:#1A1A1A
  class N,Z,SEED rust
  class ST,B stdb
  class FIX web
  class IMG,CHK,REC,J ext
```

### Records, the bundle and import_event

Every record carries `source_key` (a stable string such as `event:org:elastic`, `event:person:` plus the listed name in lowercase, `plan:booth:B12`), `source_url` and `fetched_at`. `import_event` looks rows up by `source_key` and inserts or updates, so loading the same bundle twice changes nothing and a corrected description updates the same row (and the same Elastic document). The import never deletes: rows the bundle no longer contains are listed in the import report and a person decides.

The bundle has one section per table, loaded in dependency order inside the one transaction:

| Section | Target table | What `bandit-ingest` supplies | Owner of the table |
|---|---|---|---|
| event | `venue` | name, `starts_at` and `ends_at` from the event pages; `origin_lat`, `origin_lon` and `plan_rotation_deg` from the seed | [SpacetimeDB](../2-data/SpacetimeDB.md) |
| halls | `hall` | see below | this file |
| organizations | `organization` | see below | this file |
| booths | `booth` | `source_key`, name, kind (`sponsor`, `stage`, `food`, `help_desk`, `other`), booth number, `organization_id`, `hall_id`, `zone_id`, `plan_x_m`, `plan_y_m`, `placement_source` (`plan`, `manual`, `none`), description and tags (from the organisation when the booth has none), `source_url`, `fetched_at` | [SpacetimeDB](../2-data/SpacetimeDB.md) |
| schedule | `schedule_slot` | title, start, end, location text, `booth_id` when the location maps to a booth, speakers' `person` ids | [SpacetimeDB](../2-data/SpacetimeDB.md) |
| people | `person` | see below | this file |

`import_event` is callable by the `ingest` role, and by `ops` for a hand-made bundle. It validates every reference inside the bundle before touching a row (zones exist, organisation keys resolve, booth numbers are unique per hall), then upserts section by section and returns counts. One bad record aborts the whole call, so there is never a half-loaded event. A hackathon bundle is a few hundred rows, well inside one reducer call.

### Tables owned by this file

**`hall`** (one per floor plan image):

| Field | Type | Meaning |
|---|---|---|
| `id` | auto id | row id |
| `venue_id` | id | the venue |
| `source_key`, `source_url`, `fetched_at` | text, text, timestamp | provenance |
| `name` | text | from the seed |
| `sheet_blob_id` | blob id | the floor plan image, access class `staff`; the Ops dashboard draws it under the zones |
| `metres_per_unit` | float | metres per image pixel, from the hall's real width in the seed |
| `offset_x_m`, `offset_y_m` | float | where the hall's top-left corner sits in the venue plan frame, from the seed |

**`organization`** (exhibitor, sponsor, venue operator or act):

| Field | Type | Meaning |
|---|---|---|
| `id` | auto id | row id |
| `source_key`, `source_url`, `fetched_at` | text, text, timestamp | provenance of the primary record |
| `name` | text | |
| `kind` | text | `sponsor`, `exhibitor`, `venue`, `act`, `organiser` |
| `sponsor_tier` | text, optional | as the event lists it |
| `website` | text | official site |
| `logo_blob_id` | blob id, optional | uploaded through `bandit-api`'s blob endpoint, which calls `register_blob` with access class `shared` |
| `description` | text | merged by the organizer from the site, LinkedIn company and Crunchbase company facts ([Elastic](Elastic.md)) |
| `tags` | list of text | short lowercase topics; the first is the organizer's category |
| `industry`, `headquarters`, `size_range`, `founded_year`, `funding_summary` | text or integer, optional | from the company dataset tools; null when unknown |
| `linkedin_url`, `crunchbase_url` | text, optional | the company pages that were read |
| `social_pages` | list of text | the organisation's own public social pages |

**`person`** (an unclaimed profile from event pages):

| Field | Type | Meaning |
|---|---|---|
| `id` | auto id | row id |
| `source_key`, `source_url`, `fetched_at` | text, text, timestamp | the event page that listed the person |
| `display_name` | text | as listed |
| `role` | text | as listed |
| `organization_id` | id, optional | the organisation the page lists them under |
| `kind` | text | `speaker`, `exhibitor_contact`, `sponsor_rep`, `artist` |
| `headshot_url` | text | the photo the event page shows for the person; empty when it shows none |

`person` is public. Who claimed a profile is kept apart, in `person_claim`.

**`person_claim`** (one claimed profile; private):

| Field | Type | Meaning |
|---|---|---|
| `attendee` | identity, primary key | the attendee who claimed it; one profile per attendee |
| `person_id` | id | the claimed profile; one attendee per profile |
| `claimed_at` | timestamp | |

The view `claimed_people` is anonymous and returns only the claimed `person_id` values, so the app can leave taken profiles out of "Is this you?" without learning who took them.

### The profile claim, for band owners

A person listed by the event can claim their profile in the onboarding flow, after claiming the band. The proof is the band claim they already made: only an attendee who owns a band can claim a profile, and only the band claim's press makes someone a band owner. The claim needs no second press, no email and no `bandit-api` route.

1. The attendee has claimed their band by press and typed a display name ([Attendee-App](../5-apps/Attendee-App.md)). The app lists the `person` rows whose `display_name` matches what they typed and that `claimed_people` does not list: "Is this you?" Attendees with no match never see the step.
2. The attendee taps their profile. The signed-in app calls `claim_person` with the `person` id.
3. `claim_person` (person id; the caller is the attendee) checks, in order: the caller owns a band (`band.owner`, [SpacetimeDB](../2-data/SpacetimeDB.md)), otherwise it refuses with "claim your band first"; the profile exists, otherwise "no such profile"; nobody else holds the profile, otherwise "this profile is already claimed"; the caller holds no other profile, otherwise "you already claimed a profile". A repeat call for the profile the caller already holds changes nothing.
4. It writes the `person_claim` row and copies the profile onto the caller's `attendee` row: the `person_id`, the profile's `organization_id`, its `headshot_url` as `photo_url`, and its `display_name` only when the attendee has not typed one. The app sees the profile turn claimed through its subscription and continues with the socials step ([Social](../6-features/Social.md)).

The claim adds one thing to the people graph. Social.md: the claimed profile's `organization_id` gives the attendee their `works_at` link in `people_link`, written in the same transaction; a claimed profile is the only source of that link for an attendee, because onboarding asks for no company. The attendee's handles come from the socials step whether or not a profile was claimed. The first claim wins.

The sequence answers: how does a band owner claim "this profile is me"?

```mermaid
sequenceDiagram
  participant App as Attendee app, signed in
  participant Mod as band1t module
  App->>App: "Is this you?" lists person rows matching the typed name, minus claimed_people
  App->>Mod: claim_person (person id)
  Mod->>Mod: caller owns a band, profile free, caller holds no other profile
  Mod->>Mod: write person_claim, copy the profile onto the attendee row
  Mod-->>App: profile now claimed (subscription)
  App->>App: continue with the socials step
```

### One organisation, fetch to load

The sequence answers: for one exhibitor, what does a run do from the first tool call to rows the indexer sees?

```mermaid
sequenceDiagram
  participant OP as Team member
  participant ING as bandit-ingest
  participant BD as Bright Data Web MCP
  participant ES as Elastic Serverless
  participant STDB as band1t module
  participant IDX as bandit-indexer
  OP->>ING: start a full run for the event
  ING->>BD: extract (exhibitor page URL, schema, nulls for missing)
  BD-->>ING: JSON record (name, description, booth number, social pages)
  ING->>BD: web_data_linkedin_company_profile (company URL)
  BD-->>ING: company facts JSON
  Note over ING: snapshots written, parse gives records with source_key
  ING->>ING: map: booth B12 in hall A, nearest station 102
  ING->>ES: bulk records into the raw indices, start bandit-organize
  Note over ES: LOOKUP JOIN steps, then the agent for the unmatched remainder
  ES->>BD: gap fill: extract for an exhibitor with no website snapshot
  BD-->>ES: JSON record with source_url and fetched_at
  ES-->>ING: bundle document in bandit-bundles
  ING->>ING: save gap fetches as snapshots, validate, save the last good bundle
  ING->>STDB: import_event (bundle, one transaction)
  STDB-->>ING: counts per section
  STDB-->>IDX: organization and booth rows by subscription
```

`bandit-indexer` subscribes to `booth`, `organization`, `hall` and `schedule_slot`, so each import arrives as insert or update callbacks, and each booth becomes a `bandit-booths` document that carries its organisation's facts ([Elastic](Elastic.md)). `person` rows are never indexed; the app reads them from SpacetimeDB.

## Failure modes and fallbacks

| Failure | Effect | Design answer |
|---|---|---|
| A page or dataset call fails during a run | That source has no new data | The run keeps the source's previous snapshot; nothing at the event depends on a fetch |
| `floorplan_check` returns null for a booth, or a booth is farther than 40 m from every station | Booth without a position or a zone | It loads flagged; ops drags it into place on the Ops dashboard map before doors open |
| Elastic.md: the organizer run fails, or its bundle fails validation | No new bundle | The load stage loads the last good bundle it saved |
| A reference inside the bundle does not resolve | `import_event` would create dangling rows | `import_event` validates everything first and aborts the whole call; the previous load stays as it was |
| An attendee who owns no band tries to claim a profile | No proof of who they are | `claim_person` refuses with "claim your band first"; the app shows the band claim screen |
| Two attendees try to claim the same profile | Identity conflict | `claim_person` refuses a profile that is already claimed; the first claim wins, and `claimed_people` hides it from everyone else's list |

## Dependencies

**Depends on**

- [SpacetimeDB](../2-data/SpacetimeDB.md): tables `venue`, `zone`, `station` (with `plan_x_m`, `plan_y_m`), `booth` (with `booth_number`, `organization_id`, `hall_id`, `plan_x_m`, `plan_y_m`, `placement_source`, `source_url`, `fetched_at`), `schedule_slot`, `band` (its `owner`), `attendee`, `blob_ref`, `api_session`; reducers `heartbeat`, `grant_role`, `register_blob`, `upsert_booth`; the `ingest` and `api` roles; the core zone and station seed.
- [Rust-Backend](../3-services/Rust-Backend.md): the `bandit-api` process that hosts the blob endpoint.
- [Elastic](Elastic.md): the raw indices and the `bandit-organize` workflow for the organize stage. Without it, no scraped bundle is loaded.
- [Anthropic-Agent](Anthropic-Agent.md): `claude-client`, the `floorplan_check` use case, `model_call`. Anthropic-Agent.md: without it, booths load without positions and ops drags each one into place.
- [Social](../6-features/Social.md): the onboarding socials step that follows the profile claim (optional; without it a claimed `person` simply has no handles).
- A Bright Data account with credits and a Web MCP token in Pro mode; Elastic.md: a second zone token with its own spending limit for the gap-fill tool.

**Used by**

- [Elastic](Elastic.md): its organizer runs on the raw records this pipeline writes, and its output is loaded by this pipeline (a hard dependency on this file); its indexer copies the loaded booths with their organisation facts and positions.
- [Social](../6-features/Social.md): visits are "at booth B", the profile claim sits in its onboarding flow, and the people graph takes its `exhibits` links from `booth.organization_id` and its `works_at` links from claimed profiles.
- [Attendee-App](../5-apps/Attendee-App.md): the schedule and the "Is this you?" step.
- [Ops-Dashboard](../5-apps/Ops-Dashboard.md): the hall's floor plan image and the booth fix-up panel.
- [Merch](../6-features/Merch.md): a sponsor template names organisations, and `load_merch_templates` finds their booths through the imported `organization` rows.

**If you delete this file**

- `bandit-ingest` keeps only its seed mode, which loads the hand-written seed files through the setup reducers ([SpacetimeDB](../2-data/SpacetimeDB.md)). Remove its scraping stages and the BrightData.md parts of its rows in [Rust-Backend](../3-services/Rust-Backend.md) and [Architecture](../1-overview/Architecture.md) (interfaces, data ownership and failure tables).
- Remove `import_event`, `claim_person`, `claimed_people`, `hall`, `organization`, `person` and `person_claim` from the registry tables in [SpacetimeDB](../2-data/SpacetimeDB.md), the BrightData.md field rows on `booth` and `attendee`, the BrightData.md note on the `venue` origin fields, and the BrightData.md mentions in its `bandit-ingest` interface row and seed paragraph.
- Remove the BrightData.md rows from [Attendee-App](../5-apps/Attendee-App.md) and [Social](../6-features/Social.md) (the "Is this you?" step), the booth fix-up panel row, subscription row and `ingest` service card from [Ops-Dashboard](../5-apps/Ops-Dashboard.md), and the BrightData.md row from the README components table.
- Remove the `floorplan_check` row from [Anthropic-Agent](Anthropic-Agent.md).
- [Merch](../6-features/Merch.md) loads only its plain templates, because sponsor names have no organisations to match.
- [Elastic](Elastic.md) loses its organizer and keeps the copy of hand-entered booths. Booths, schedule slots and the venue row are entered by hand through `upsert_booth`, `upsert_schedule_slot` and the seed. Behaviour elsewhere is unchanged, because everything reads SpacetimeDB rows either way.

## Decisions

| Decision | Why |
|---|---|
| The floor plan has one path: Bright Data captures the published image, Claude `floorplan_check` reads booth numbers and positions, the hall's real width typed in the seed converts pixels to metres, and ops drags any misplaced booth on the Ops dashboard map | One pipeline to build and rehearse; a wrong position is fixed in seconds by hand, so no second reading method is needed |
| No exhibitor contact export, no `claim_contact` table, no email; `claim_person` accepts a claim only from an attendee who already owns a band | The band claim's press already proved who holds the band one step earlier, so the profile claim needs no second press and no email round trip |
| The signed-in app calls `claim_person` directly; there is no `bandit-api` route for it | The caller's SpacetimeDB identity is the attendee, so the module checks everything itself |
| One profile per attendee and one attendee per profile; the first claim wins | A profile is one listed person, so a second claimant is refused rather than merged |
| No merch scraping | [Merch](../6-features/Merch.md) loads a few hand-made templates from its own file |
| Only the Bright Data Web MCP, in Pro mode, with the tools named above | One product and one token to set up; the credits cover the Pro tools |
| No Claude merge of organisation facts (`scrape_extract` is removed) | The Elastic organizer is the one place facts are merged across sources |
| Without Elastic.md no scraped bundle loads; booths are entered by hand | The organizer is the only path from records to bundle, so there is no rules path to maintain |
| The last good bundle, saved by the validate stage, is the only fallback | The demo never depends on a live run |
| Every page becomes JSON through `extract`; there are no hand-written page parsers | Extraction happens once, at fetch time, with the null rule and a schema |
| The bundle never changes zones or exits | The core seed owns them, so the safety demo is the same with or without this file |
| The import works for any event: its input is the list of start URLs in the event's seed, and Cal Hacks 13.0 is the demo instance | The product must work at any venue; only the seed changes from one event to the next |
| The hall's width and offset and the venue's plan origin and rotation are typed in the seed | They are measured on site at setup; no map or geocoding source is scraped |
| Booth numbers are joined to geometry once, in the organizer's `LOOKUP JOIN` step | One owner per step; the map stage only produces geometry |
