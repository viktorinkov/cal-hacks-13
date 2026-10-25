# Bright Data

BandIt uses three Bright Data products, each for the job it does best:

- the Bright Data Web MCP, for every page and dataset the event import reads, and for the search that starts a venue setup;
- the Bright Data Web Unlocker API, for the raw HTML of the pages a venue setup reads, and for a linked model file;
- the Bright Data Browser API, for exporting a venue's 3D model from inside its own web page.

`bandit-ingest` is a Rust command-line tool the team runs before the event. It reads the event's public pages and three Bright Data datasets through the Bright Data Web MCP, and saves every answer as a snapshot file kept with the project. The Evidence Engine in Elastic then organizes the records, and `bandit-ingest` loads the checked bundle into SpacetimeDB in one `import_event` transaction.

Everything downstream reads ordinary SpacetimeDB rows: the sponsors on the organizer portal (/organizer), the booths of the recap, "Are you one of these?" at onboarding, the people graph's `works_at` and `exhibits` links, and the sponsor merch. Without the import those screens have no sponsors, booths or speakers.

The 3D hall on the Live view (/live) and the organizer portal's Venue setup tab is a model exported through the Bright Data Browser API. For any other event, an organizer sets up the venue from the event's name alone (see Venue setup from the event's name).

## Role in the system

Responsibilities:

- Fetch the event's public pages and its company and place datasets through the Bright Data Web MCP, from the list in the event's `sources.json`, and keep a snapshot of every answer.
- Turn the snapshots into records in Rust, hand them to the Elastic Workflow `bandit-organize`, check what comes back, and assemble one event bundle.
- Give every sponsor a booth: its spot from the hand-written `booths.json`, its zone the one whose centre is nearest.
- Load the bundle with `import_event` over the SpacetimeDB HTTP API, keyed by stable source keys so a rerun updates rows instead of adding them.
- Build unclaimed `person` profiles from event pages only (the event site's speakers), and let an attendee who has claimed their band claim their profile at onboarding with one tap.
- Export the Cal Hacks venue map's 3D model through the Bright Data Browser API (`pipeline/venue_model.py`), kept as `web/venue/venue.glb`.
- Set up any event's venue from its name, started from the organizer portal: search, let the Anthropic Claude API pick the event site, the venue and its public 3D map, and save the venue's model.
- Own the tables `organization`, `person`, `person_claim`, `venue_setup`, `venue_setup_step` and `chosen_venue`, the reducers `claim_person`, `start_venue_setup`, `report_venue_setup_step`, `finish_venue_setup` and `choose_venue`, the view `claimed_people`, and the job kind `venue_setup`.

Non-responsibilities:

- **Never scrapes people.** No person scraper, no social profile, no lookup of a person by name. Every attendee types their own social handles at onboarding ([Social](../6-features/Social.md) owns `social_handle`).
- Does not merge facts across sources. The Elastic Workflow `bandit-organize` does that ([Elastic](Elastic.md)).
- Does not define zones. Each zone, with its station id and exit colour, is written by hand in the event's `zones.json`, which goes into the bundle unchanged ([SpacetimeDB](../2-data/SpacetimeDB.md)).
- Does not scrape merch. [Merch](../6-features/Merch.md) loads its hand-made templates from `assets/merch/templates.json`.
- Runs no Bright Data call during the event and none on the safety path. The only Bright Data run the organizer portal starts is a venue setup.
- Does not own `venue`, `zone`, `booth` or `schedule_slot` ([SpacetimeDB](../2-data/SpacetimeDB.md)); `import_event` fills them from the bundle.

## Interfaces

| Interface | Direction | Who | What flows | Transport |
|---|---|---|---|---|
| Bright Data Web MCP, import | out | `bandit-ingest fetch` | `scrape_as_markdown` for each page in `sources.json`; `run_scraper`, `get_scraper_progress` and `get_scraper_results` for each dataset | MCP `tools/call` over HTTPS to `mcp.brightdata.com/mcp`, tool groups `advanced_scraping`, `browser` and `scrapers`, with `BRIGHTDATA_API_TOKEN` |
| Event folder | in | every `bandit-ingest` stage | `event.json` (name, website, time zone), `sources.json` (pages and datasets), `zones.json` (the station marker plan), `booths.json` (booth spots) | hand-written files in `crates/bandit-ingest/events/<slug>/` |
| Snapshots, records and bundles | out and in | each stage writes what the next reads | `snapshots/`, `records/records.jsonl`, `records/plan.jsonl`, `bundles/<run id>.organized.json`, `bundles/<run id>.json` | files in the event folder, kept with the project |
| Elastic raw indices and `bandit-organize` | out and in | `bandit-ingest organize` | records out to `bandit-raw-pages`, `bandit-raw-orgs` and `bandit-raw-plan`; one Elastic Workflows run; back comes one document from `bandit-bundles`; decisions to `bandit-organizer-decisions`; stage timings to `bandit-pipeline-events` | Elasticsearch Bulk, ES\|QL and search APIs with `ELASTICSEARCH_API_KEY`; the Elastic Kibana Workflows API with `KIBANA_API_KEY` ([Elastic](Elastic.md)) |
| `import_event` | out | `bandit-ingest load`, role `ingest` | the bundle; then the `import_run` row with the counts per section | SpacetimeDB HTTP API: `POST /v1/database/<database>/call/import_event`, then `POST /v1/database/<database>/sql` |
| `claim_person` | in | tap page (/t/code), signed in as the attendee | the `person` id the attendee says is them; refused unless the caller already owns a band | SpacetimeDB reducer call |
| Bright Data Browser API | out | `pipeline/venue_model.py`, run by hand before the event, and by `bandit-workers` for a venue setup | opens a venue map in Bright Data's remote browser and exports its 3D scene in the page as binary glTF; back come the file in 3 MB parts and a screenshot | CDP over a secure WebSocket to `brd.superproxy.io:9222`, through Playwright, with `BRIGHTDATA_CUSTOMER_ID`, `BRIGHTDATA_BROWSER_ZONE` and `BRIGHTDATA_BROWSER_PASSWORD` |
| Venue model file | out | `pipeline/venue_model.py` to the project | `web/venue/venue.glb` (metres, y up, no lights), copied only when under 20 MB | file |
| Venue spots | out | `pipeline/venue_spots.py` writes `web/venue/spots.json`; `scripts/e2e-setup` loads it with `load_venue_spots` (role `ops`) | the hall's hacker tables, sponsor tables, stage, food line and doors, in the model's metres | file; SpacetimeDB command line |
| Venue setup tab | in | organizer portal, role `ops` | `start_venue_setup` with the event's name; `choose_venue` with the setup to show | SpacetimeDB reducer call |
| Bright Data Web MCP, venue setup | out | `bandit-workers`, job `venue_setup` | `search_engine` with three queries about the event's name | MCP `tools/call` over HTTPS, with `BRIGHTDATA_API_TOKEN` |
| Bright Data Web Unlocker API | out | `bandit-workers`, job `venue_setup`; `pipeline/venue_model.py` for a model file link | each page the run reads, as raw HTML; a linked `.glb` or `.gltf` file | HTTPS `POST https://api.brightdata.com/request` with the zone `BRIGHTDATA_ZONE` and format `raw` |
| Anthropic Claude API, venue setup | out | `bandit-workers`, through `claude-client` | `venue_find`: the search results in, the event site, the venue, its address and the pages to read out. `venue_map`: the pages read in, the 3D maps, the floor plans and the labelled sources out, or the next pages to read | HTTPS Messages API, structured output; recorded in `model_call` ([Anthropic-Claude-API](Anthropic-Claude-API.md)) |
| Venue setup steps and result | out | `bandit-workers` (role `worker`) to the module | `report_venue_setup_step` for each step; `finish_venue_setup` with the venue, the model and layout hashes, and the model's size and part counts | SpacetimeDB reducer calls |
| Loaded rows | out | `bandit-indexer` ([Elastic](Elastic.md)), tap page, organizer portal | `organization`, `booth`, `zone` and `schedule_slot` by subscription to `bandit-indexer`; `venue`, `organization`, `person` and `claimed_people` to the tap page; `venue`, `zone`, `booth` and `organization` to the organizer portal | SpacetimeDB subscription |

## Design

### Scope rule

The import covers the event, its sponsors and its venue, never people. The only person records are unclaimed profiles built from the event's own site: the speakers it lists, each with the name, title, organisation and text that page shows.

Handles come from the attendee: their Instagram, Facebook and Threads handles, typed at onboarding ([Social](../6-features/Social.md)), with or without a claimed profile.

Every dataset row loses its fields about people before its snapshot is saved. The fetch stage drops the 15 fields in `PEOPLE_FIELDS`, among them `employees`, `founders`, `contacts`, `top_reviews`, `investors` and `contact_email`.

### Which Bright Data tool does which job

Each tool was picked for what the step needs, and each is used for nothing else.

| Tool | Product | Used for | Why this tool |
|---|---|---|---|
| `scrape_as_markdown` | Bright Data Web MCP (its Web Unlocker underneath) | every page in `sources.json`: the event site, the Devpost page, the Devpost dates page and the venue map page | the Rust parsers read markdown links and image alt text: a sponsor's link with its logo, a prize's sponsor tag in brackets, the venue line's maps.google.com link |
| `run_scraper`, `get_scraper_progress`, `get_scraper_results` | Bright Data Web MCP (the Bright Data Web Scraper API underneath) | the LinkedIn company dataset `gd_l1vikfnt1wgvvqz95w` (41 company pages), the Crunchbase company dataset `gd_l1vijqt9jfj7olije` (4) and the Google Maps dataset `gd_m8ebnr0q2qlklc02fz` (the venue's place), each collected by URL | structured company and place records with no page to parse; `run_scraper` returns a snapshot id, and the fetch stage polls `get_scraper_progress` every 30 s until `get_scraper_results` has the rows |
| `search_engine` | Bright Data Web MCP | the venue setup's three searches: the event's name, "<name> venue map" and "<name> venue 3D map floor plan" | a venue setup starts from a name alone, with no URL |
| Web Unlocker `POST /request` | Bright Data Web Unlocker API | the pages a venue setup reads; a linked `.glb` or `.gltf` file | the raw HTML keeps the `iframe`, `embed`, `object` and `model-viewer` tags and the model file links that a 3D map hides in, which markdown drops |
| Remote browser over CDP | Bright Data Browser API | exporting a venue's 3D scene | only a real browser runs the page's three.js, and the export needs a script in the page before it loads |

The MCP server marks scraped text as untrusted. Both MCP clients keep only the text between its `UNTRUSTED` markers, and the venue setup tells the Anthropic Claude API to treat every page as data and ignore any instruction in it.

### Sources

The import is the same for every event; only the event folder changes. `sources.json` lists the pages, each with its source name and page kind, and the datasets, each with its dataset id and the URLs to collect. The page kind picks the parser.

Cal Hacks 13.0, at the Palace of Fine Arts, is the first event it runs at. Its folder is `crates/bandit-ingest/events/calhacks-13`.

| Source | Page kind | Fetched with | Gives |
|---|---|---|---|
| `site` (calhacks.io) | `event_site` | `scrape_as_markdown` | `organization_candidate` records from the sponsor and partner links, `person_candidate` records from the speaker list, `venue_fact` records from the FAQ |
| `devpost` | `devpost` | `scrape_as_markdown` | `organization_candidate` records with their tier, `prize` records with their cash amount and sponsor tag, the submission deadline, and the venue's name and address from the maps.google.com link |
| `devpost_dates` | `devpost_dates` | `scrape_as_markdown` | `schedule_item` records and the event's start and end |
| `venue_map` (hive.hackberkeley.org/venue-map) | `venue_map` | `scrape_as_markdown` | no records |
| `linkedin` | `linkedin_company` | `run_scraper` on `gd_l1vikfnt1wgvvqz95w` | `company_facts` records: industry, headquarters, size, founding year, about text, logo |
| `crunchbase` | `crunchbase_company` | `run_scraper` on `gd_l1vijqt9jfj7olije` | `company_facts` records: industries, address, founding year, description, a funding summary |
| `gmaps` | `google_maps` | `run_scraper` on `gd_m8ebnr0q2qlklc02fz` | one `venue_place` record: name, address, latitude and longitude, description, website, rating, phone number and opening hours |

The saved Cal Hacks 13.0 run, `calhacks-13-20261024t0828z`, turned these into 245 records. The Elastic Workflow `bandit-organize` made 62 organisations of them: 53 by an exact domain join and 9 merged by the Elastic Agent Builder agent `bandit-organizer`. The bundle holds 62 organisations, 51 booths, 3 people and 2 schedule slots.

### Pipeline

Eight stages, one of them in Elastic. Each stage reads the files the previous one wrote, so any stage can run alone. `bandit-ingest run --event <slug>` runs them all under a fresh run id, the event's slug plus the UTC time, such as `calhacks-13-20261024t0828z`.

| Stage | Command | Reads | Writes |
|---|---|---|---|
| fetch | `bandit-ingest fetch` | `sources.json` | one snapshot per source and URL in `snapshots/<source>/`: the body, the URL, the tool, the time and the body's SHA-256; a new fetch rewrites it |
| parse | `bandit-ingest parse` | the snapshots | `records/records.jsonl`, each record with `source_key`, `source_url`, `fetched_at` and `snapshot_sha256` |
| map | `bandit-ingest map` | `zones.json`, `booths.json` | `records/plan.jsonl`: one `zone` record per zone and one `booth_spot` record per spot, with its nearest zone |
| organize | `bandit-ingest organize` | both record files | the records in the three raw indices, one run of `bandit-organize`, the decisions in `bandit-organizer-decisions`, and `bundles/<run id>.organized.json` |
| assemble | `bandit-ingest assemble` | the records, the organized decisions, `zones.json`, `booths.json` | `bundles/<run id>.json`, the bundle with its `bundle_hash` |
| load | `bandit-ingest load <bundle>` | the bundle | SpacetimeDB rows through one `import_event` call, then the `import_run` counts |
| verify | `bandit-ingest verify <bundle>` | the bundle | row counts per table in SpacetimeDB against the bundle |
| dashboards | `bandit-ingest dashboards` | the run id | the Elastic Kibana dashboards "scrape pipeline" and "sponsors and prizes" for the run |

`bandit-ingest elastic-setup` creates the raw indices, the Elastic Agent Builder tools `bandit.records` and `bandit.candidates`, the agent `bandit-organizer` and the workflow, before the first run.

The organize stage checks the workflow's document before it saves anything. Every key it names must be a record of the run or an organisation it defined, and every organisation candidate, prize, person and schedule item must have a decision; otherwise the stage stops.

The assemble stage checks again in Rust: each category is on the fixed list, every link points at a defined organisation, and the event has its Google Maps `venue_place` record. A run that fails a check writes no bundle.

The question this diagram answers: how do public pages become one bundle that lands in SpacetimeDB in a single transaction?

```mermaid
flowchart TB
  SRC["Public pages and datasets: calhacks.io, Devpost, LinkedIn, Crunchbase, Google Maps"] -->|"HTTPS"| BD["Bright Data Web MCP"]
  BD -->|"markdown, scrape_as_markdown"| F["fetch stage"]
  BD -->|"dataset rows, run_scraper"| F
  F -->|"people fields dropped, one file per URL"| SNAP["Snapshots in the event folder"]
  SNAP -->|"markdown and rows"| P["parse stage"]
  SEED["zones.json, booths.json"] -->|"zones and spots"| M["map stage"]
  P -->|"records.jsonl"| O["organize stage"]
  M -->|"plan.jsonl"| O
  O -->|"records, workflow run"| ES["Elastic Workflows: bandit-organize"]
  ES -->|"bundle document, bandit-bundles"| O
  O -->|"organized decisions"| A["assemble stage"]
  SEED -->|"zones, booth spots"| A
  A -->|"bundle file"| L["load stage"]
  L -->|"HTTP API, import_event"| STDB["band1t module"]
  classDef rust fill:#FBE9E7,stroke:#BF360C,color:#1A1A1A
  classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
  classDef ext fill:#E0F2F1,stroke:#00695C,color:#1A1A1A
  class F,P,M,O,A,L,SNAP,SEED rust
  class STDB stdb
  class SRC,BD,ES ext
```

### Booth positions

The event's pages give no booth positions, so the team places them. There are two steps: a booth row per sponsor, then the sponsor tables on the 3D floor.

1. **A booth per sponsor.** The assemble stage gives every organisation of kind `sponsor` one booth, `booth:<domain>`. Its spot comes from `booths.json`: the entry for its domain gives `placement` `plan`, and no entry gives the file's `default_spot` with `placement` `zone`. Its zone is the one whose centre (`plan_x_m`, `plan_y_m` in `zones.json`) is nearest the spot.
2. **The 3D floor.** `pipeline/venue_spots.py` writes `web/venue/spots.json` from the venue map's named locations and the hall's floor layout: the hacker tables by number, the sponsor tables with the way they face, the stage, the food line and the doors, in the 3D model's metres. `load_venue_spots` (role `ops`, from `scripts/e2e-setup`) stores them as `venue_spot` rows and gives each sponsor table the booth whose name or organisation name matches it; booths left over take the tables left over.
3. **By hand.** `place_booth` (role `ops`) moves a booth to a zone and a spot and marks it `manual`. A rerun of `import_event` keeps a `manual` booth's zone and spot.

For Cal Hacks 13.0, `booths.json` lists no spots, so all 51 booths load at the sponsor row's centre with `placement` `zone`. The crowd and the Live view send each booth's visitors to its sponsor table.

The question this diagram answers: where does a booth's position come from?

```mermaid
flowchart TB
  ORG["Sponsor organisations in the organized decisions"] -->|"one booth each"| A["assemble stage"]
  BJ["booths.json: spots by domain, default_spot"] -->|"spot, plan or zone"| A
  ZJ["zones.json: zone centres"] -->|"nearest zone"| A
  A -->|"booth rows in the bundle, import_event"| B["booth table"]
  SP["web/venue/spots.json from pipeline/venue_spots.py"] -->|"sponsor tables, load_venue_spots"| VS["venue_spot table"]
  B -->|"booth and organisation names"| VS
  OPS["Organizer"] -->|"zone and spot, place_booth"| B
  classDef rust fill:#FBE9E7,stroke:#BF360C,color:#1A1A1A
  classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
  classDef web fill:#E3F2FD,stroke:#1565C0,color:#1A1A1A
  class ORG,A,BJ,ZJ,SP rust
  class B,VS stdb
  class OPS web
```

### The venue model

The Cal Hacks venue map (hive.hackberkeley.org/venue-map) embeds a 3D model of the Palace of Fine Arts hall that the Cal Hacks team built in three.js from their floor plans. `pipeline/venue_model.py` exports that model once, before the event, as one binary glTF file, `web/venue/venue.glb`: the floors, walls, rooms and mezzanine, the hacker and sponsor tables, the chairs and the table numbers, in metres with y up and no lights. It is a script the team runs by hand, not a service.

1. **Open the map.** The script connects Playwright to the Bright Data Browser API over CDP and opens the page the venue map embeds (palace-interior.vercel.app) in Bright Data's remote browser. Before the page loads, a small script stands in for the three.js developer tools, which every three.js scene reports to when it is built, so the page hands over its scenes.
2. **Flatten.** Once a scene is captured, the page waits 8 s for the plan textures to load. The largest scene is then merged into one mesh per material in world coordinates: each repeated table and chair becomes its own geometry, the table numbers are baked in from their number sheet, and lights and helpers are left out.
3. **Export.** In the same page, three.js's GLTFExporter for the page's own three.js release (r186) writes the binary glTF. The script reads it back in 3 MB parts, checks the file's header, and saves it with a screenshot of the map and a summary of its size, meshes and bounds under `var/venue-3d/brightdata/palace-interior/`.
4. **Keep it.** With `--assets`, the script copies the file to `web/venue/venue.glb` when it is under 20 MB; the export is about 12 MB. The model is kept with the project, so nothing at the event calls Bright Data.

The question this diagram answers: where does the venue model come from, and who shows it?

```mermaid
flowchart LR
  PY["pipeline/venue_model.py, run by hand"] -->|"Playwright over CDP"| BR["Bright Data Browser API: remote browser"]
  BR -->|"opens the page"| MAP["Cal Hacks venue map: the hall in three.js"]
  MAP -->|"scene captured, flattened, exported in the page"| BR
  BR -->|"GLB in 3 MB parts"| PY
  PY -->|"--assets, under 20 MB"| GLB[("web/venue/venue.glb")]
  GLB -->|"served at /venue by bandit-api"| PV["Live view and Venue setup tab: three.js"]
  classDef ext fill:#E0F2F1,stroke:#00695C,color:#1A1A1A
  classDef web fill:#E3F2FD,stroke:#1565C0,color:#1A1A1A
  class BR,MAP ext
  class PV web
```

`bandit-api` serves the `web/venue` folder at `/venue`. The Live view (/live) draws the model with the bands on it, and the organizer portal's Venue setup tab draws it as the default venue. `web/venue/index.html` previews it on its own with OrbitControls.

### Venue setup from the event's name

The Cal Hacks 13.0 model ships with the app and is the default venue. For any other event, an organizer (`ops`) types the event's name on the organizer portal's Venue setup tab, and `bandit-workers` finds the venue and its public 3D map and saves the venue's model.

Each step lands in the module as it happens, so the tab shows the run live ([Organizer-Portal](../5-apps/Organizer-Portal.md)).

1. **Start.** "Find the venue" calls `start_venue_setup(event_name)`, which needs `ops`, a name of 1 to 200 characters and no running setup with the same name. It writes a `venue_setup` row in status `running`, its first step "Queued", and a job of kind `venue_setup`.
2. **Search.** The worker calls the Bright Data Web MCP's `search_engine` three times: the event's name, "<name> venue map" and "<name> venue 3D map floor plan".
3. **Find the event.** The Anthropic Claude API (`venue_find`) reads the results and returns the event site, the venue's name and address, and up to 6 pages to read. Code checks that every address in the answer is one the results named.
4. **Read the pages.** The worker reads those pages through the Bright Data Web Unlocker API and keeps each page's title, an excerpt and up to 80 links that look like maps, frames, 3D tours or model files. The Anthropic Claude API (`venue_map`) then picks up to 3 3D maps among those links, with the floor plans and the labelled pages it used. When it finds no map, it names up to 4 next pages, for one more round.
5. **Export the model.** For each picked map in turn, the worker runs `pipeline/venue_model.py --url <map> --out <dir>` for at most 7 minutes. In the Bright Data Browser API's remote browser, the script catches a three.js scene, a Babylon.js scene or a glTF file the page loads; a link straight to a `.glb` or `.gltf` file is downloaded through the Bright Data Web Unlocker API instead. The first map that gives a model wins.
6. **Finish.** The worker stores `model.glb` and `layout.json` (the model's named parts with their boxes) in the blob store, registers both as `shared` blobs with the purposes `venue_model` and `venue_layout`, and calls `finish_venue_setup`. The setup turns `ready` with its model, or `no model` when no map gave one.
7. **Show it.** The tab's "Shown venue" list holds the default and every `ready` setup, and `choose_venue` stores the choice in the one `chosen_venue` row. The tab draws the chosen model with three.js.

The worker calls `report_venue_setup_step` for each step and `finish_venue_setup` at the end, both only while it holds the job's lease. When the job uses up its attempts, the module marks the setup `failed` with the job's error.

The question this diagram answers: what happens between an event's name and its venue model?

```mermaid
flowchart LR
  ORG["organizer portal (/organizer): Venue setup"] -->|"event name, start_venue_setup"| MOD["band1t module"]
  MOD -->|"venue_setup job"| W["bandit-workers"]
  W -->|"3 queries, search_engine"| MCP["Bright Data Web MCP"]
  W -->|"results and pages, venue_find, venue_map"| CL["Anthropic Claude API"]
  W -->|"page addresses"| WU["Bright Data Web Unlocker API"]
  W -->|"map address, venue_model.py --url"| BR["Bright Data Browser API"]
  W -->|"model.glb, layout.json"| BLOB[("blob store")]
  W -->|"steps, finish_venue_setup"| MOD
  MOD -->|"steps, live"| ORG
  ORG -->|"shown venue, choose_venue"| MOD
  classDef ext fill:#E0F2F1,stroke:#00695C,color:#1A1A1A
  classDef web fill:#E3F2FD,stroke:#1565C0,color:#1A1A1A
  classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
  classDef rust fill:#FBE9E7,stroke:#BF360C,color:#1A1A1A
  class MCP,CL,WU,BR ext
  class ORG web
  class MOD stdb
  class W,BLOB rust
```

It is not Vision's 3D venue model: Leo's Gaussian splat is trained from a phone walk-through video and drawn in the security view ([Vision](../4-devices/Vision.md)), while this one is the Cal Hacks team's own 3D map, exported as it is.

### Records, the bundle and import_event

Every record carries `source_key` (its source, then a stable key: `devpost:org:anthropic`, `site:person:enoreyes`, `linkedin:org:visa.com`), `source_url`, `fetched_at` and the snapshot's SHA-256. The bundle's own keys are `event:calhacks-13` for the venue, `org:<domain>` for an organisation and `booth:<domain>` for a booth.

`import_event` looks every row up by `source_key` and inserts or updates it, so loading the same bundle twice changes nothing and a corrected description updates the same row (and the same Elastic document). The import never deletes.

The bundle has one section per table, loaded in this order inside the one transaction:

| Section | Target table | What `bandit-ingest` supplies | Owner of the table |
|---|---|---|---|
| venue | `venue` | the event's name, website and time zone from `event.json`; its start and end from the Devpost dates page; from the Google Maps record, the venue's name, address, latitude and longitude, description and source URL, with its rating, phone number and opening hours added to the facts; the FAQ answers as facts | [SpacetimeDB](../2-data/SpacetimeDB.md) |
| zones | `zone` | each zone of `zones.json` as written | [SpacetimeDB](../2-data/SpacetimeDB.md) |
| organizations | `organization` | see below | this file |
| people | `person` | see below | this file |
| booths | `booth` | `source_key`, the zone and organisation keys, name, kind `sponsor`, description and tags (the organisation's category first), `plan_x_m`, `plan_y_m`, `placement` (`plan` or `zone`), `source_url`, `fetched_at`; `booth_number` stays empty, because no source gives one | [SpacetimeDB](../2-data/SpacetimeDB.md) |
| schedule | `schedule_slot` | title, kind, start, end, location text, and the zone and host organisation the agent linked | [SpacetimeDB](../2-data/SpacetimeDB.md) |

`import_event` is callable by the `ingest` role, and by an organizer (`ops`) for a hand-made bundle. It needs a `source_key` and a name on every row, refuses a bundle in which two zones share a station id, and refuses a key that points at a zone, organisation, person or booth the bundle does not define.

A refusal rolls back the whole call, so there is never a half-loaded event. Each call also writes one `import_run` row with the run id, the bundle hash, who imported it and the rows inserted and updated per section.

### Tables owned by this file

**`organization`** (a sponsor or partner the event lists):

| Field | Type | Meaning |
|---|---|---|
| `id` | auto id | row id |
| `source_key`, `venue_id` | text, id | `org:<domain>`, and the event |
| `name`, `domain`, `website` | text | as the event lists it; the domain is the organisation's primary website domain |
| `kind` | text | `sponsor`, or `partner` when every record lists it as a partner |
| `sponsor_tier` | text | the tier Devpost lists |
| `logo_url` | text | the logo from the company facts or Devpost |
| `description`, `category`, `tags` | text, text, list of text | merged by the `bandit-organizer` agent from the event's records and the company facts ([Elastic](Elastic.md)); the category is one of 15 fixed values |
| `industry`, `headquarters`, `size_range`, `founded_year`, `linkedin_url` | text or number | from the LinkedIn company record the agent picked; empty when there is none |
| `crunchbase_url`, `funding_summary` | text | from the Crunchbase company record; empty when there is none |
| `prizes` | list of text | the prizes the agent linked to it, each with its cash amount |
| `source_url`, `fetched_at`, `updated_at` | text, timestamps | provenance of its first record, and the last change |

**`person`** (an unclaimed profile from the event site):

| Field | Type | Meaning |
|---|---|---|
| `id` | auto id | row id |
| `source_key`, `venue_id` | text, id | `site:person:` plus the listed name, and the event |
| `display_name`, `title`, `bio` | text | as listed |
| `kind`, `role` | text | `speaker`, and the speaker slot such as "opening speaker" |
| `organization_id` | id, 0 for none | the organisation the agent linked them to |
| `headshot_url`, `links` | text, list of text | empty in the Cal Hacks 13.0 bundle |
| `source_url`, `fetched_at`, `updated_at` | text, timestamps | provenance |

`person` is public. Who claimed a profile is kept apart, in `person_claim`.

**`person_claim`** (one claimed profile; private):

| Field | Type | Meaning |
|---|---|---|
| `attendee` | identity, primary key | the attendee who claimed it; one profile per attendee |
| `person_id` | id, indexed | the claimed profile; one attendee per profile |
| `claimed_at` | timestamp | |

The view `claimed_people` is anonymous and returns only the claimed `person_id` values, so the tap page can leave taken profiles out of "Are you one of these?" without learning who took them.

### The profile claim, for band owners

A person listed by the event can claim their profile in the onboarding flow, after claiming the band. The proof is the band claim they already made: only an attendee who owns a band can claim a profile, and only the band claim's press makes someone a band owner. The claim needs no second press, no email and no `bandit-api` route.

1. The attendee has claimed their band by press and typed a display name; the step comes later in setup ([Tap-Page](../5-apps/Tap-Page.md)). The tap page lists the `person` rows whose `display_name` contains a word of what they typed and that `claimed_people` does not list: "Are you one of these?" Attendees with no match never see the step, and "None of these" goes on.
2. The attendee taps "This is me" on their profile. The signed-in tap page calls `claim_person` with the `person` id.
3. `claim_person` (person id; the caller is the attendee) checks, in order: the caller owns a band (a `band_owner` row, [SpacetimeDB](../2-data/SpacetimeDB.md)), otherwise it refuses with "claim your band first"; the profile exists, otherwise "no such profile"; nobody else holds the profile, otherwise "this profile is already claimed"; the caller holds no other profile, otherwise "you already claimed a profile". A repeat call for the profile the caller already holds changes nothing.
4. It writes the `person_claim` row and copies the profile onto the caller's `attendee` row: the `person_id`, the profile's `organization_id`, its `headshot_url` as `photo_url`, and its `display_name` only when the attendee has not typed one. The tap page continues with the next setup step ([Tap-Page](../5-apps/Tap-Page.md)).

The claim adds one thing to the people graph. Social.md: the claimed profile's `organization_id` gives the attendee their `works_at` link in `people_link`, written in the same transaction; a claimed profile is the only source of that link for an attendee, because onboarding asks for no company.

The attendee's handles come from the socials step whether or not a profile was claimed. The first claim wins.

The question this diagram answers: how does a band owner claim "this profile is me"?

```mermaid
sequenceDiagram
  participant App as Tap page, signed in
  participant Mod as band1t module
  App->>App: "Are you one of these?" lists person rows matching the typed name, minus claimed_people
  App->>Mod: claim_person (person id)
  Mod->>Mod: caller owns a band, profile free, caller holds no other profile
  Mod->>Mod: write person_claim, copy the profile onto the attendee row, works_at link
  Mod-->>App: reducer accepted
  App->>App: continue with the next setup step
```

### One organisation, fetch to load

The question this diagram answers: for one sponsor, what does a run do from the first tool call to rows the indexer sees?

```mermaid
sequenceDiagram
  participant OP as Team member
  participant ING as bandit-ingest
  participant BD as Bright Data Web MCP
  participant ES as Elastic
  participant STDB as band1t module
  participant IDX as bandit-indexer
  OP->>ING: bandit-ingest run --event calhacks-13
  ING->>BD: scrape_as_markdown (Devpost page)
  BD-->>ING: markdown with the sponsor's link, logo and tier
  ING->>BD: run_scraper (LinkedIn company dataset, company page URLs)
  BD-->>ING: snapshot id
  ING->>BD: get_scraper_progress, then get_scraper_results
  BD-->>ING: company rows, people fields then dropped
  Note over ING: snapshots saved, then parse gives devpost:org:visa and linkedin:org:visa.com
  ING->>ES: bulk records into the raw indices, run bandit-organize
  Note over ES: ES|QL LOOKUP JOIN on domain, then the bandit-organizer agent for the rest
  ES-->>ING: bundle document in bandit-bundles
  ING->>ING: check the decisions, assemble org:visa.com and booth:visa.com
  ING->>STDB: import_event over the HTTP API (one transaction)
  STDB-->>ING: import_run counts per section
  STDB-->>IDX: organization and booth rows by subscription
```

`bandit-indexer` subscribes to `zone`, `organization`, `booth` and `schedule_slot`, so each import arrives as insert or update callbacks, and each booth becomes a `bandit-booths` document that carries its organisation's description and tags ([Elastic](Elastic.md)). `person` rows are never indexed; the tap page reads them from SpacetimeDB.

## Failure modes and fallbacks

| Failure | Effect | Design answer |
|---|---|---|
| A page or dataset call fails during a fetch | The fetch stage stops | The snapshots already in the event folder stay, so parse, organize, assemble and load run again from them without Bright Data; nothing at the event depends on a fetch |
| A dataset collection is slow | The fetch waits | The stage polls `get_scraper_progress` every 30 s, and each MCP call waits at most 10 minutes |
| The `bandit-organize` run fails, or its document names an unknown key or leaves a record without a decision | No organized file for that run | The organize stage stops; the last bundle file in `bundles/` stays, and `scripts/e2e-setup` loads the newest one |
| A category is off the list, a link points at an undefined organisation, or there is no Google Maps record | No bundle for that run | The assemble stage stops before it writes a file |
| A reference inside the bundle does not resolve | `import_event` would create dangling rows | `import_event` refuses and the whole call rolls back; the previous load stays as it was |
| A booth has no spot in `booths.json` | The booth stands at the default spot | It loads with `placement` `zone` in its nearest zone; `load_venue_spots` gives it a sponsor table, and `place_booth` moves it by hand |
| An attendee who owns no band tries to claim a profile | No proof of who they are | `claim_person` refuses with "claim your band first" |
| Two attendees try to claim the same profile | Identity conflict | `claim_person` refuses a profile that is already claimed; the first claim wins, and `claimed_people` hides it from everyone else's list |
| A venue setup reads no page | No pages to pick a map from | Pages that fail are skipped; when none can be read, the job fails and is retried |
| A venue setup finds no 3D map, or no picked map gives a model | No model for that event | The setup ends `no model`, with its venue, floor plans and the pages it used; the shown venue stays as it was |
| The Anthropic Claude API names an address it was not given | A made-up page | Code refuses the answer and asks a second time with the problems listed; when that fails too, the job fails and is retried |
| A venue setup job uses up its attempts | The run stops | The module marks the setup `failed` with the job's error; the organizer can start it again |

## Dependencies

**Depends on**

- [SpacetimeDB](../2-data/SpacetimeDB.md): tables `venue`, `zone` (with `plan_x_m`, `plan_y_m`), `booth` (with `organization_id`, `plan_x_m`, `plan_y_m`, `placement`, `source_url`, `fetched_at`), `schedule_slot`, `import_run`, `venue_spot`, `band_owner`, `attendee`, `blob_ref`; reducers `import_event`, `grant_role`, `place_booth`, `load_venue_spots`; the `ingest`, `ops` and `worker` roles.
- [Rust-Backend](../3-services/Rust-Backend.md): the `bandit-api` process that serves `/venue`; `bandit-workers`, which runs the job `venue_setup` and, for it, `pipeline/venue_model.py` with Python and Playwright on the Vultr VM.
- [Elastic](Elastic.md): the raw indices and the Elastic Workflow `bandit-organize` for the organize stage. Without it, no bundle is assembled.
- [Anthropic-Claude-API](Anthropic-Claude-API.md): `claude-client`, the `venue_find` and `venue_map` calls, `model_call`.
- [Social](../6-features/Social.md): the onboarding socials step, which comes before the profile claim (optional; without it a claimed `person` simply has no handles).
- A Bright Data account with credits and an API token for the Bright Data Web MCP; a Bright Data Web Unlocker API zone; a Bright Data Browser API zone with its customer id, zone name and password.

**Used by**

- [Elastic](Elastic.md): its Elastic Workflow `bandit-organize` runs on the raw records this pipeline writes, and its output is assembled and loaded by this pipeline; its indexer copies the loaded booths with their organisation facts.
- [Social](../6-features/Social.md): visits are "at booth B", the profile claim sits in its onboarding flow, and the people graph takes its `exhibits` links from `booth.organization_id` and its `works_at` links from claimed profiles.
- [Tap-Page](../5-apps/Tap-Page.md): the "Are you one of these?" step.
- [Organizer-Portal](../5-apps/Organizer-Portal.md): the sponsors in the attendee list's Company column, and the Venue setup tab.
- [Merch](../6-features/Merch.md): a sponsor template names organisations, and `load_merch_templates` finds their booths through the imported `organization` rows.
- [Test-Bands](../3-services/Test-Bands.md): the crowd staffs the sponsors' booths, sends visitors to their sponsor tables, and its booth staff work at the booth's organisation.

**If you delete this file**

- `bandit-ingest` and its event folder go. Booths, schedule slots and the venue row then come from a hand-written bundle loaded with `import_event`, such as `scripts/e2e/bundle.json`. Remove the Bright-Data.md parts of its rows in [Rust-Backend](../3-services/Rust-Backend.md) and [Architecture](../1-overview/Architecture.md).
- Remove `claim_person`, `claimed_people`, `organization`, `person` and `person_claim` from the registry tables in [SpacetimeDB](../2-data/SpacetimeDB.md), and the Bright-Data.md field rows on `booth`, `attendee`, `schedule_slot` and `venue`.
- Remove the Bright-Data.md rows from [Tap-Page](../5-apps/Tap-Page.md) and [Social](../6-features/Social.md) (the "Are you one of these?" step), the Bright-Data.md subscription row and the scrape pipeline line under the Kibana tab from [Organizer-Portal](../5-apps/Organizer-Portal.md), and the Bright-Data.md row from the README components table.
- Delete `pipeline/venue_model.py`, `pipeline/venue_spots.py` and the `web/venue` folder (the model, its spots and its preview page), and remove the two Bright-Data.md lines in [Vision](../4-devices/Vision.md). The Live view then has no 3D hall.
- Remove `venue_setup`, `venue_setup_step`, `chosen_venue`, their four reducers and the job kind `venue_setup` from [SpacetimeDB](../2-data/SpacetimeDB.md), the job from `bandit-workers` in [Rust-Backend](../3-services/Rust-Backend.md), the Venue setup tab from [Organizer-Portal](../5-apps/Organizer-Portal.md), and the `venue_find` and `venue_map` rows from [Anthropic-Claude-API](Anthropic-Claude-API.md).
- [Merch](../6-features/Merch.md) loads only its plain templates, because sponsor names have no organisations to match.
- [Test-Bands](../3-services/Test-Bands.md)'s crowd still visits the booths of the hand-written bundle, and its booth staff get no `works_at` link; remove the Bright-Data.md lines there.
- [Elastic](Elastic.md) loses the Elastic Workflow `bandit-organize` and keeps the copy of hand-entered booths. Behaviour elsewhere is unchanged, because everything reads SpacetimeDB rows either way.

## Decisions

| Decision | Why |
|---|---|
| The import reads every page and dataset through the Bright Data Web MCP: `scrape_as_markdown` for pages, `run_scraper` with `get_scraper_progress` and `get_scraper_results` for datasets | one token and one protocol for the whole fetch stage; markdown keeps the links and alt text the parsers read, and the datasets give company and place facts with no page to parse |
| Company facts come from the LinkedIn and Crunchbase company datasets, and the venue's place from the Google Maps dataset, collected by URL | structured records by URL, so sponsor descriptions, headquarters and the venue's address and pin need no scraper of our own |
| Every dataset row loses its people fields (`PEOPLE_FIELDS`) before its snapshot is saved | every fact about a person in the system is one the event published or the person entered |
| The venue setup reads pages through the Bright Data Web Unlocker API as raw HTML | a 3D map hides in `iframe`, `embed`, `object` and `model-viewer` tags and model file links, which markdown drops |
| The venue model goes through the Bright Data Browser API | the export puts a script in the map's page before it loads and runs the page's own exporter inside it, so it needs a remote browser session it drives itself over CDP |
| Every Bright Data answer is a snapshot file kept with the project, rewritten by the next fetch of the same URL | parse, organize, assemble and load rerun without Bright Data, and the event never waits on a live scrape |
| Pages are parsed in Rust, one parser per page kind; Elastic receives JSON records, never page bodies | the page kinds are few and known, and a parser's output is the same for the same snapshot |
| `bandit-ingest` calls `import_event` through the SpacetimeDB HTTP API with its own saved identity | a one-shot loader needs no subscription, and its first load prints the one `grant_role` command that gives it `ingest` |
| A booth's spot comes from the hand-written `booths.json`, its zone from the nearest zone centre, and its sponsor table on the 3D floor from `load_venue_spots` by name | the event publishes no booth positions; the team writes the few that matter, and every other booth still has a zone and a table |
| An organizer moves a booth with `place_booth`, and a re-import keeps a `manual` booth | a wrong spot is fixed in seconds by hand, and the fix survives the next run |
| No exhibitor contact export and no email; `claim_person` accepts a claim only from an attendee who already owns a band | the band claim's press already proved who holds the band one step earlier, so the profile claim needs no second press and no email round trip |
| The signed-in app calls `claim_person` directly; there is no `bandit-api` route for it | the caller's SpacetimeDB identity is the attendee, so the module checks everything itself |
| One profile per attendee and one attendee per profile; the first claim wins | a profile is one listed person, so a second claimant is refused rather than merged |
| No merch scraping | [Merch](../6-features/Merch.md) loads a few hand-made templates from its own file |
| The venue model is the Cal Hacks team's own 3D venue map, exported once before the event and kept as `web/venue/venue.glb`, at most 20 MB | they built the hall in metres from their floor plans, with every table and chair, so one export gives the whole hall, and nothing at the event waits on Bright Data |
| The export is one Python script in `pipeline/`: run by hand for the default venue, and by `bandit-workers` for a venue setup | both paths share one exporter |
| A venue setup starts from the event's name alone | an organizer at any event knows its name; the search, the Anthropic Claude API and the export find the rest |
| The Anthropic Claude API may name only addresses that the search results and the pages gave it | code checks every address in its answer, so a setup never opens a page that nothing linked |
| Each step of a venue setup is a `venue_setup_step` row, and the organizer picks the shown venue (`chosen_venue`) | the tab shows the run live by subscription, and a new setup never replaces the venue on screen by itself |
| The Elastic Workflow `bandit-organize` is the one place facts are merged across sources, and `bandit-ingest` checks its answer twice, once after the workflow and once while assembling | one owner per step, and a wrong key never reaches SpacetimeDB |
| The scrape never changes a zone; zones, their station ids and their exit colours are hand-written in `zones.json` | the safety features stay the same whatever the scrape finds |
| The import works for any event: its input is the event folder, and Cal Hacks 13.0 is the first event it runs at | the product must work at any venue; only the folder changes from one event to the next |
