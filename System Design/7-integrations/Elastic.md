# Elastic

The Evidence Engine is Elastic's part of BandIt: one Elastic Cloud Serverless project that organizes and validates data and ranks it by meaning. It answers the Elastic track, "Best use of the Elastic Agent Builder on a Serverless instance": an Elastic Agent Builder agent runs inside an Elastic Workflow, every text field is searched by meaning, an ingest pipeline checks every claim copy, and Elastic Kibana shows each step.

BandIt's design rule: SpacetimeDB owns live and exact state, The Evidence Engine validates and organizes data and ranks it by meaning, and the Anthropic Claude API makes the judgments. For a claim, the judgment and the decision belong to the insurance Decision Engine: the Anthropic Claude API plus Rust code in the module.

The Evidence Engine has four jobs, each explained in [The four jobs of The Evidence Engine](#the-four-jobs-of-the-evidence-engine): organize the scraped event data before import, order each attendee's recap suggestions by meaning, find the 3 closest past claims and validate each claim copy for the insurance Decision Engine, and show the team the data in Elastic Kibana.

Elastic judges the track on four criteria, which follow one line: Search → Reason → Act. This is where BandIt meets each one.

| Elastic's criterion | Step | Where BandIt meets it |
|---|---|---|
| 01 Elasticsearch: "Creative, meaningful use of search" | Search | Elastic ES\|QL `LOOKUP JOIN` steps make the exact joins of an import run, a `FORK` + `FUSE` hybrid search gives the agent its candidates, semantic queries order each recap and find the 3 closest past claims, and an ingest pipeline checks every claim copy on the way in |
| 02 Jina embeddings: "Search by meaning, in any language" | Search | every `semantic_text` field (`text`, `description`, `interests`, `narrative`) names `.jina-embeddings-v5-text-small`, which embeds each document on write and each query at search time; no BandIt process computes a vector |
| 03 Agent Builder + Workflows: "Agents that answer and act" | Reason, Act | the Elastic Workflow `bandit-organize` calls the Elastic Agent Builder agent `bandit-organizer` in two schema-checked `ai.agent` steps, and its `save_bundle` step writes the bundle that `bandit-ingest` checks and loads with `import_event` |
| 04 Cloud Serverless: "Zero ops, free for the weekend" | all three | one Elastic Cloud Serverless project with no cluster to size; the Elastic Inference Service serves the embedding model and the agent's LLM, and every index, tool, agent and workflow is created from files in the repo (`bandit-ingest elastic-setup`) or by the process that writes it, when it starts |

For claims, the Reason and Act steps belong to the insurance Decision Engine: The Evidence Engine finds the evidence, and the Anthropic Claude API and Rust code decide ([How The Evidence Engine feeds the insurance Decision Engine](#how-the-evidence-engine-feeds-the-insurance-decision-engine)).

Vision.md: it also keeps the venue laptop's raw radio log and photo records for after the event.

Nobody chats with it, it never holds truth, it never sees a name on a claim, and it never sits in the safety path. If it disappears, the module keeps the event it loaded, the recap lists its suggestions by minutes, and claims decide without precedents.

## Role in the system

Responsibilities:

- Hold the raw records of one import run in three raw indices, `bandit-raw-pages`, `bandit-raw-orgs` and `bandit-raw-plan`, every document tagged with its `run_id`.
- Organize them. The Elastic Workflow `bandit-organize` makes the exact joins with Elastic ES|QL `LOOKUP JOIN` steps, then calls the Elastic Agent Builder agent `bandit-organizer` twice, each time with a JSON schema that requires one decision per listed domain, prize, speaker or schedule item. The result is one document per run in `bandit-bundles`: organisations merged across domains, each with its company facts record, category, tags and description; prizes, speakers and schedule items linked; and gaps listed.
- Keep two logs of each import run for Elastic Kibana: `bandit-organizer-decisions`, one document per decision with its reason, and `bandit-pipeline-events`, one document per step of the run.
- Keep a one-way copy of booths and of findable attendees' interests in two indices: `bandit-booths` and `bandit-people`.
- Order the recap's suggestions. `GET /api/recap` in `bandit-api` builds the caller's recap from SpacetimeDB rows and puts its suggested people and booths in order of meaning. `bandit-api` holds the Elastic key; browsers never talk to Elastic.
- Insurance.md: hold the index `bandit-claims` and its ingest pipeline `bandit-claims-validate`, validate each de-identified claim copy, and rank it by meaning against decided past claims: 30 seeded ones and decided live claims from earlier events.
- Vision.md: hold Leo's raw radio log and photo records in `bandit-raw-radio`, `bandit-raw-heard`, `bandit-raw-gateway` and `bandit-raw-photos`, for after the event.
- Give the team its Elastic Kibana views: the Elastic Workflows execution view of `bandit-organize`, the `bandit-organizer` agent's tool calls in Elastic Agent Builder, and the two dashboards `bandit-ingest` installs for each event: "BandIt · Cal Hacks 13.0 · scrape pipeline" and "BandIt · Cal Hacks 13.0 · sponsors and prizes" for Cal Hacks 13.0. Vision.md: the "BandIt band radio and photos" dashboard. The "BandIt recap suggestions" dashboard. Insurance.md: the "BandIt claims evidence" dashboard.
- Keep each attendee's latest recap ranking in `bandit-recap-rankings`, written by `bandit-api` and read only by Elastic Kibana.
- Give the organizer portal (/organizer) its "Kibana" tab: Elastic's jobs in the order of the event, a short note on each, and links to its Elastic Kibana views ([Organizer-Portal](../5-apps/Organizer-Portal.md)).

Non-responsibilities:

- Not a source of truth. Elastic never writes to SpacetimeDB: `bandit-ingest` checks the bundle and calls `import_event` ([Bright-Data](Bright-Data.md)). The recap order carries SpacetimeDB ids only, and any action on a suggestion (a tag answer, a merch order) is an ordinary reducer call made by the app, owned by [Social](../6-features/Social.md) or [Merch](../6-features/Merch.md).

  Insurance.md: what comes back from Elastic on a claim is one validation check and up to 3 precedents, which `bandit-workers` writes through `submit_claim_checks`; they never change an amount.
- No chat. No agent talks to attendees or staff, there is no conversation route, and there are no per-attendee agent tools or keys. The one agent runs in two steps of one workflow execution per import, started by `bandit-ingest`.
- No decisions. Elastic organizes and validates data; a judgment about people or events goes to the Anthropic Claude API through `claude-client` over SpacetimeDB rows ([Anthropic-Claude-API](Anthropic-Claude-API.md)). Incidents never enter Elastic (Insurance.md: a claim copy names only the incident's kind, zone and time), and the insurance Decision Engine's code never reads the precedents.
- Not in the safety path. Bands, commands, density and incidents never read or write Elastic ([Safety](../6-features/Safety.md)). No Elastic Kibana view runs the live event: the live screen is the [organizer portal](../5-apps/Organizer-Portal.md).
- Does not hold the people graph. The links between people, booths and companies are facts the bands measured, kept in SpacetimeDB (`people_link`, `my_graph`, `event_graph`, [Social](../6-features/Social.md)). Elastic draws no links on the graph, and nothing about the graph flows back from Elastic into SpacetimeDB.
- Never receives payment or bank data, medical cards, raw `band`, `zone_visit` or `encounter` rows, incidents, `person` rows or photo images, and the copy indices hold nothing about an attendee who is not findable. Scraped people appear only as speakers in the raw records of one import run, taken from public event pages, and `bandit-ingest` strips the people fields from Bright Data's company datasets before parsing.

  The recap is where attendees reach Elastic. A caller with no `bandit-people` document, findable or not, is ranked with a text built from their own visits (`visited_text`), sent as the query and not stored. The recap rankings name the attendee and the people on their recap by display name.

  Insurance.md: the one exception for insurance data is the de-identified claim copy in `bandit-claims`: incident kind, zone, time, witness count, corroboration, diagnosis and service codes, amounts, the hospital report's SHA-256 and a narrative built by code. It holds no names, no attendee or band ids, and no staff notes, visit reasons or history.
- Does not fetch pages. Bright Data owns every step that touches the web ([Bright-Data](Bright-Data.md)). Elastic receives JSON records that `bandit-ingest` parsed in Rust, never HTML or Markdown, and makes no web call.

## Interfaces

| Interface | Direction | Who | What flows | Transport |
|---|---|---|---|---|
| Elastic Bulk API, raw indices | in | `bandit-ingest`, organize stage ([Bright-Data](Bright-Data.md)) | one JSON record per document, parsed from Bright Data's snapshots (event pages, the LinkedIn and Crunchbase company datasets, the Google Maps venue) and from the team's plan files; id `<run_id>:<source_key>`; the run's old documents are deleted first | HTTPS, `ELASTICSEARCH_API_KEY` |
| Elastic Workflows API | in | `bandit-ingest`, organize stage | start one execution of `bandit-organize` with the run id; poll it every 5 s, for at most 30 minutes | HTTPS to Elastic Kibana, `KIBANA_API_KEY` |
| Agent tools | internal | `bandit-organizer` | two fixed Elastic ES\|QL tools over the raw indices: `bandit.records` and `bandit.candidates` | Elastic-internal |
| `bandit-bundles` | out | `bandit-ingest` | one document per run: the domain join rows, the organisation decisions, the prize, speaker and schedule links, the gaps and the model connector | HTTPS `_search` with a `term` on `run_id` |
| Elastic Bulk API, run logs | in | `bandit-ingest`, organize stage | one `bandit-organizer-decisions` document per decision in the bundle it read back, and one `bandit-pipeline-events` document per step of the run, with its time and counts | HTTPS, `ELASTICSEARCH_API_KEY` |
| Elastic Kibana Dashboards API | in | `bandit-ingest`, at the end of each full run; `kibana/install.sh` | the two event dashboards, created or replaced with that run's id in every query; the radio and photos, recap suggestions and (Insurance.md) claims evidence dashboards from their saved files in `kibana/` | HTTPS to Elastic Kibana, `KIBANA_API_KEY` |
| Elastic setup | in | `bandit-ingest elastic-setup` | the index mappings, the two agent tools, the agent and the workflow, from `crates/bandit-ingest/elastic/` | HTTPS to Elasticsearch and Elastic Kibana |
| SpacetimeDB subscription | in | `bandit-indexer` (role `indexer`) | rows of `zone`, `organization`, `booth`, `schedule_slot`; from Social.md: the views `social_attendees` and `social_visits` | SpacetimeDB Rust client SDK over WebSocket; initial sync, then every committed change |
| Elastic Bulk API, copy indices | out | `bandit-indexer` | index and delete operations on `bandit-booths` and `bandit-people`, keyed by booth id and attendee id | HTTPS, `ELASTICSEARCH_API_KEY` |
| `GET /api/recap` | in | the recap on the tap page (/t/code) ([Tap-Page](../5-apps/Tap-Page.md)) | the session token in the `x-bandit-session` header; returns the caller's recap, with `suggested_people` and `suggested_booths` in order, each with its score, and `suggestions_ranked` | HTTPS JSON on `bandit-api` |
| `api_sessions` and Social views | in | `bandit-api` (role `api`) | the session token, hashed with SHA-256 and matched in `api_sessions` to get the caller's identity; `social_attendees`, `social_visits`, `social_encounters` and the other rows the recap shows | SpacetimeDB subscription ([SpacetimeDB](../2-data/SpacetimeDB.md), [Social](../6-features/Social.md)) |
| Elasticsearch search | out | `bandit-api` | for `GET /api/recap`: an `ids` query for the caller's `bandit-people` document, then one semantic query on `bandit-people` and one on `bandit-booths`; each call times out after 10 s | HTTPS, `ELASTICSEARCH_API_KEY` |
| `bandit-recap-rankings` | in | `bandit-api` | after each ranked recap, one document per attendee (id: attendee id): the places their interests text names, the order Elastic chose with the first booth's and person's scores, and the booth that minutes alone put first | HTTPS, `ELASTICSEARCH_API_KEY` |
| Vision.md: Elastic Bulk API, raw radio and photos | in | Leo's `feed.py` and `photos.py` on the venue laptop ([Vision](../4-devices/Vision.md)) | one document per gateway line and per photo, with a document id from its content, so a second upload adds nothing | HTTPS, from the laptop's `.env` keys |
| Insurance.md: `bandit-claims`, through the pipeline `bandit-claims-validate` | in | `bandit-workers`: job `claim_verify`, the seed when it first creates the index, and job `claim_draft` | one de-identified document per pack version (`claim-<id>-v<n>`); the 30 seeded past claims (`history-01` to `history-30`); the outcome and payout once a claim is paid | HTTPS, `ELASTICSEARCH_API_KEY` |
| Insurance.md: precedent search | out | `bandit-workers` | one semantic query on `narrative` per claim copy; the top 3 decided past claims as reference, outcome, payout, narrative and score, which the worker writes to SpacetimeDB through Insurance.md's `submit_claim_checks` | HTTPS, `ELASTICSEARCH_API_KEY` |
| Elastic Kibana | in | the team, signed in to the Elastic Cloud project | the Elastic Workflows execution view, Elastic Agent Builder, and the five dashboards: scrape pipeline, sponsors and prizes, band radio and photos, recap suggestions and (Insurance.md) claims evidence; read only on every BandIt index | HTTPS in a browser; Elastic Cloud logins, never attendees |

## Design

### The Evidence Engine in one picture

The question this diagram answers: what goes into The Evidence Engine, what Elastic does with it, and what comes out?

```mermaid
flowchart LR
  subgraph IN["Inputs"]
    IDX["bandit-indexer: one-way copy of the module's booths and findable attendees' visits"]
    WRK["bandit-workers, job claim_verify: de-identified claim copy, no names"]
    WRB["bandit-workers, job claim_draft: a paid claim's outcome"]
    ING["bandit-ingest: Bright Data's raw records of one import run"]
    LAP["venue laptop: raw radio and photo records"]
  end
  subgraph EL["Inside Elastic Serverless: no names on claim copies, never the source of truth, never in the safety path"]
    COPY["bandit-booths, bandit-people"]
    PIPE["bandit-claims-validate (ingest pipeline: Painless script -> bandit-claims)"]
    CLM["bandit-claims: claim copies and 30 seeded past claims"]
    RAW["bandit-raw-pages, bandit-raw-orgs, bandit-raw-plan"]
    WF["bandit-organize (Elastic Workflow: ES|QL LOOKUP JOIN -> bandit-raw-orgs, bandit-raw-plan)"]
    TOOLS["bandit.records, bandit.candidates (ES|QL, FORK + FUSE hybrid -> raw indices)"]
    AG["bandit-organizer (Elastic Agent Builder agent, 2 ai.agent steps)"]
    BUN["bandit-bundles"]
    LOGS["bandit-organizer-decisions, bandit-pipeline-events"]
    VRAW["bandit-raw-radio, -heard, -gateway, -photos"]
    QR["recap ranking (semantic, filtered to candidates -> bandit-people, bandit-booths)"]
    QC["similar_claims (semantic on narrative, k = 3, skips live claims under 24 h -> bandit-claims)"]
    RANK["bandit-recap-rankings"]
    INF[".jina-embeddings-v5-text-small (inference endpoint: embeds every semantic_text field on write, and each semantic query)"]
  end
  subgraph OUT["Outputs"]
    RCP["recap on the tap page, via bandit-api"]
    KIBR["Elastic Kibana: recap suggestions dashboard, ES|QL"]
    SCC["module reducer submit_claim_checks; the insurance Decision Engine decides after"]
    KIBC["Elastic Kibana: claims evidence dashboard, ES|QL"]
    IMP["module reducer import_event"]
    KIBE["Elastic Kibana: scrape pipeline and sponsors dashboards, ES|QL"]
    KIBV["Elastic Kibana: band radio and photos dashboard, ES|QL"]
  end
  IDX -->|"booths + interests, _bulk"| COPY
  WRK -->|"claim copy, PUT _doc"| PIPE
  PIPE -->|"copy + validation fields"| CLM
  WRB -->|"outcome + payout, set_outcome"| CLM
  ING -->|"JSON records, _bulk"| RAW
  ING -->|"run id, Workflows API"| WF
  RAW -->|"joined rows, LOOKUP JOIN"| WF
  WF -->|"open items, ai.agent step"| AG
  RAW -->|"this run's records"| TOOLS
  TOOLS -->|"records + top 5 candidates"| AG
  AG -->|"decisions + reasons, structured output"| WF
  WF -->|"one document per run, save_bundle"| BUN
  ING -->|"decisions + step times, _bulk"| LOGS
  LAP -->|"gateway lines + photos, _bulk"| VRAW
  COPY -->|"booth texts + interests"| QR
  CLM -->|"decided past claims"| QC
  INF -->|"query embedding, semantic"| QR
  INF -->|"query embedding, semantic"| QC
  IDX ~~~ INF
  QR -->|"ranked ids + scores, GET /api/recap"| RCP
  QC -->|"top 3 + scores, submit_claim_checks"| SCC
  BUN -->|"checked bundle, import_event"| IMP
  LOGS -->|"run charts, Dashboards API"| KIBE
  CLM -->|"claim charts, install.sh"| KIBC
  QR -->|"latest ranking, log_ranking"| RANK
  RANK -->|"ranking charts, install.sh"| KIBR
  VRAW -->|"radio charts, install.sh"| KIBV
  QC ~~~ RCP
  QC ~~~ KIBR
  QC ~~~ KIBV
  QC ~~~ SCC
  QC ~~~ IMP
  QC ~~~ KIBC
  QC ~~~ KIBE
  classDef device fill:#FFF3E0,stroke:#E65100,color:#1A1A1A
  classDef rust fill:#FBE9E7,stroke:#BF360C,color:#1A1A1A
  classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
  classDef web fill:#E3F2FD,stroke:#1565C0,color:#1A1A1A
  classDef ext fill:#E0F2F1,stroke:#00695C,color:#1A1A1A
  class IDX,WRK,WRB,ING rust
  class LAP device
  class COPY,PIPE,CLM,RAW,VRAW,INF,WF,TOOLS,AG,BUN,LOGS,QR,QC,RANK,KIBR,KIBC,KIBE,KIBV ext
  class SCC,IMP stdb
  class RCP web
```

The title of the middle box is the boundary. Every output passes through a Rust process that checks it: `bandit-api` for the recap, `bandit-workers` for `submit_claim_checks`, and `bandit-ingest` for `import_event`. Elastic itself never calls the module.

### Indices

One row per index. "Names" means names of people; company and booth names are public facts.

| Index | One document | Written by | Read by, and how | Names |
|---|---|---|---|---|
| `bandit-raw-pages` | one record parsed from a public event page: `organization_candidate`, `prize`, `person_candidate` (a speaker), `schedule_item` or `venue_fact` | `bandit-ingest`, organize stage, `_bulk`, id `<run_id>:<source_key>` | `bandit-organize` (Elastic ES\|QL); the agent's tools `bandit.records` (Elastic ES\|QL) and `bandit.candidates` (Elastic ES\|QL, keyword plus semantic); both event dashboards (Elastic ES\|QL) | speakers' names as the event's pages print them |
| `bandit-raw-orgs` (lookup mode) | one company facts record from LinkedIn or Crunchbase (`company_facts`), or the Google Maps venue (`venue_place`) | `bandit-ingest`, as above | `LOOKUP JOIN ... ON run_id, domain`; both agent tools; both event dashboards | none: `fetch` strips the datasets' people fields |
| `bandit-raw-plan` (lookup mode) | one zone or one sponsor's booth spot from the team's plan files (`zone`, `booth_spot`) | `bandit-ingest`, as above | `LOOKUP JOIN ... ON run_id, location_norm`; `bandit.records`; the scrape pipeline dashboard | none |
| `bandit-bundles` | the organized result of one import run, id = run id | the workflow's last step, `save_bundle` (`elasticsearch.index`) | `bandit-ingest`, `_search` with a `term` on `run_id` | speakers only as source keys |
| `bandit-organizer-decisions` | one decision with its reason: `organization`, `prize_link`, `person_link`, `schedule_link` or `gap` | `bandit-ingest`, `_bulk`, after it checks the bundle | both event dashboards (Elastic ES\|QL) | speakers' names on `person_link` decisions |
| `bandit-pipeline-events` | one step of one run, with its time and counts | `bandit-ingest`, `POST _doc` from `log_event` | the scrape pipeline dashboard (Elastic ES\|QL) | none |
| `bandit-booths` | one booth, with its organisation's facts, its tags and its schedule titles in `description` | `bandit-indexer`, `_bulk` index and delete, id = booth id | `bandit-api` for `GET /api/recap`: `semantic` on `description`, filtered to the candidate booth ids; the recap suggestions dashboard (Elastic ES\|QL) | none |
| `bandit-people` | one findable attendee: attendee id, graph node id, company name and `interests` | `bandit-indexer`, `_bulk` index and delete, id = attendee id | `bandit-api`: an `ids` query for the caller's own `interests`, then `semantic` on `interests`, filtered to the candidate node ids; the recap suggestions dashboard | none: ids and a company name |
| `bandit-recap-rankings` | one attendee's latest recap ranking, id = attendee id: the places their interests name, the people and booths in Elastic's order, the first person's and booth's scores, and the booth that minutes alone put first | `bandit-api`, `PUT _doc` from `log_ranking`, after each ranked recap | only the recap suggestions dashboard (Elastic ES\|QL) | the attendee and the people on their recap, by display name |
| `bandit-claims` | one de-identified claim pack version (`claim-<id>-v<n>`), or one of 30 seeded past claims (`history-01` to `history-30`) | `bandit-workers`: job `claim_verify` (`PUT _doc` through `bandit-claims-validate`), the seed when it first creates the index (`_bulk`), job `claim_draft` (`_update` with the outcome) | `bandit-workers`: `semantic` on `narrative`; the claims evidence dashboard (Elastic ES\|QL) | none |
| `bandit-raw-radio`, `bandit-raw-heard`, `bandit-raw-gateway`, `bandit-raw-photos` | one gateway line, heard list or photo record | `feed.py` and `photos.py` on the venue laptop, `_bulk` | only the band radio and photos dashboard (Elastic ES\|QL), after the event | none |

Every `semantic_text` field names the inference endpoint `.jina-embeddings-v5-text-small` on the Elastic Inference Service: `text` in the three import raw indices, `description`, `interests` and `narrative`. Elastic embeds a document's text when it is written and the query text when it is searched, so no BandIt process computes a vector.

`bandit-indexer`, `bandit-api` and `bandit-workers` put `ELASTIC_INDEX_PREFIX` (`bandit` on the VM) in front of their index names. A local run writes `bandit-e2e-*` and never mixes into the live indices.

### The four jobs of The Evidence Engine

Each job says what starts it, what it gets, what Elastic does, what comes out and what that result can change. The Parts further down hold the detail.

#### Organize the scraped event data before import

**Trigger.** The team runs `bandit-ingest run --event calhacks-13` once before the event; its organize stage does this job.

**Input.** The 250 JSON records of one import run, parsed in Rust from what Bright Data fetched, plus the team's zones and booth spots.

**In Elastic.**

1. `_bulk` writes the records into `bandit-raw-pages`, `bandit-raw-orgs` and `bandit-raw-plan`, and `semantic_text` embeds each record's `text`.
2. `bandit-ingest` starts the Elastic Workflow `bandit-organize` with the run id through the Elastic Workflows API, and polls it every 5 s.
3. Elastic ES|QL steps make the exact joins: `join_orgs` (`LOOKUP JOIN bandit-raw-orgs ON run_id, domain`), `join_keys` (`STATS ... BY org_key`) and `join_schedule` (`LOOKUP JOIN bandit-raw-plan ON run_id, location_norm`). Two more list the prizes and speakers, and two `data.parseJson` steps build JSON schemas that require exactly one decision per domain, prize, speaker and schedule item.
4. Two `ai.agent` steps call the Elastic Agent Builder agent `bandit-organizer` with those schemas: `organize_orgs` decides who is who across domains, and `link_records` links prizes, speakers and schedule items. The agent's only tools are the Elastic ES|QL tools `bandit.records` and `bandit.candidates`.
5. `save_bundle` (`elasticsearch.index`) writes the result as one document to `bandit-bundles`.

**Output.** `bandit-ingest` reads the document back, checks it in Rust, logs every decision to `bandit-organizer-decisions`, assembles the event bundle and loads it with `import_event`.

**Can change** which organisations, booths, speakers and schedule slots the module imports, with their categories, tags and descriptions. **Cannot** write to the module, invent a key (the Rust check rejects any key that is not in the run), or touch anything live. Detail: [Part one](#part-one-organizing-the-scraped-data-upstream-of-spacetimedb).

#### Order each attendee's recap suggestions by meaning

**Trigger.** After the organizer ends the event, the recap on the tap page calls `GET /api/recap` on `bandit-api` with its session token.

**Input.** The caller's candidates, which `bandit-api` builds from SpacetimeDB rows: the findable people they hung out with, and every booth in the zones they visited. `bandit-indexer` keeps the copy they are ranked against.

**In Elastic.**

1. An `ids` query gets the caller's `bandit-people` document and its `interests` text.
2. Two `semantic` queries run at once with that text: one on `bandit-people` `interests`, filtered with `terms` on the candidates' `node_id`, and one on `bandit-booths` `description`, filtered on the candidates' `booth_id`.
3. Elastic embeds the query with the same inference endpoint and returns the candidates best match first, with scores.

**Output.** `bandit-api` puts `suggested_people` and `suggested_booths` in that order and sets `suggestions_ranked`. It then writes the caller's latest ranking to `bandit-recap-rankings` (`log_ranking`) for the recap suggestions dashboard; a failed write is only logged.

**Can change** the order of the two lists. **Cannot** add a person or a booth (every query is filtered to the candidates), decide who is findable, or hold up the recap: after 10 s, or on any error, the lists stay in minutes order. Detail: [Part two](#part-two-the-one-way-copy-downstream-of-spacetimedb) and [Part three](#part-three-ordering-the-recaps-suggestions).

#### Find the 3 closest past claims and validate the claim copy

**Trigger.** The module enqueues the job `claim_verify` each time it builds a pack version of a claim that has an amount to pay.

**Input.** The job's `VerifyPayload`, which `bandit-workers` turns into a de-identified copy: codes, amounts, zone, time and one narrative sentence from a fixed template (`narrative_for`).

**In Elastic.**

1. `PUT bandit-claims/_doc/claim-<id>-v<n>?pipeline=bandit-claims-validate`: the ingest pipeline's Painless `script` processor checks the copy and writes `validation.valid` and `validation.errors`. It never rejects a document.
2. `semantic_text` embeds the `narrative`.
3. One `semantic` query on `narrative`, with the copy's own narrative as the query, runs over decided claims only, skips this claim and every live claim from the last 24 h, and keeps one hit per claim (`collapse` on `claim_id`). The worker takes the top 3.

**Output.** One `elastic_validation` check and up to 3 precedents (reference, outcome, payout, narrative, score), written through `submit_claim_checks`.

**Can change** the route: a failed validation sends the claim to the organizer, and the precedents can too, through the Anthropic Claude API's review. **Cannot** change an amount, refuse a claim, or see a name. Detail: the next section and [the claims part](#insurancemd-similar-past-claims-bandit-claims-and-bandit-claims-validate).

#### Show the team the data in Elastic Kibana

**Trigger.** `bandit-ingest` installs the two event dashboards at the end of each full run through the Elastic Kibana Dashboards API (`PUT /api/dashboards/<id>`). `kibana/install.sh` installs the other three through the same API, from `kibana/radio.json`, `kibana/recap.json` and `kibana/claims.json`.

**Input.** The import raw indices and the two run logs, the raw radio and photo indices, the copy indices with `bandit-recap-rankings`, and `bandit-claims`.

**In Elastic.**

1. Every chart and count is an Elastic ES|QL query, such as `FROM bandit-organizer-decisions | WHERE run_id == "<run>" | STATS ...`, with the run id fixed in the two event dashboards.
2. The Elastic Workflows execution view shows each step of `bandit-organize` with its time and output.
3. Elastic Agent Builder keeps each `ai.agent` step's conversation (`create-conversation: true`), so the team can open every tool call of `bandit-organizer`.

**Output.** Five dashboards: "BandIt · Cal Hacks 13.0 · scrape pipeline" (`bandit-pipeline-calhacks-13`), "BandIt · Cal Hacks 13.0 · sponsors and prizes" (`bandit-event-calhacks-13`), "BandIt band radio and photos" (`bandit-radio`), "BandIt recap suggestions" (`bandit-recap`) and "BandIt claims evidence" (`bandit-claims`).

The organizer portal's "Kibana" tab walks through Elastic's jobs in the order of the event: before it (organizing), during it (the radio log and photos), after it (the recap), and claims. Each has a short note and links to its views: the five dashboards, the `bandit-organize` runs (`/app/workflows`) and the `bandit-organizer` agent (`/app/agent_builder`).

**Can change** nothing: every view is read only. **Cannot** show anything live; the organizer portal shows the live event from SpacetimeDB. Detail: [Part four](#part-four-elastic-kibana-what-the-team-shows).

### How The Evidence Engine feeds the insurance Decision Engine

The insurance Decision Engine is the Anthropic Claude API plus the Rust code that decides insurance claims ([Insurance](../6-features/Insurance.md)). The Evidence Engine gives it two things for each pack version: a validation check and up to 3 similar past claims.

The question this diagram answers: what happens to one claim between its evidence pack and the organizer's screen, and where do the precedents go?

```mermaid
sequenceDiagram
  participant M as band1t module
  participant W as bandit-workers
  participant P as pipeline bandit-claims-validate
  participant ES as index bandit-claims
  participant C as Anthropic Claude API
  participant O as organizer portal
  Note over M,ES: Find the evidence: The Evidence Engine
  M->>M: rebuild builds the evidence pack, then enqueues claim_verify
  M->>W: job claim_verify with its VerifyPayload
  W->>W: claim_doc builds the de-identified copy and narrative_for its narrative
  W->>P: PUT _doc claim-ID-vN, no names
  P->>ES: the copy with validation.valid and validation.errors, narrative embedded
  W->>ES: semantic query on narrative, k = 3, decided claims, skips live claims under 24 h
  ES-->>W: top 3, for example history-04 with its score
  W->>M: submit_claim_checks with the elastic_validation check and 3 precedents
  M->>M: one claim_precedent row each, then queue_review
  Note over M,O: Decide: the insurance Decision Engine
  M->>W: job claim_review, ReviewPayload with the precedents
  W->>C: review prompt with a precedents block
  C-->>W: verdict, causation, cited fact ids
  W->>M: submit_claim_review
  M->>M: decide reads checks, review gate and rule, never claim_precedent
  M-->>O: board_precedents, shown as Similar past claims (Elastic)
  O->>M: approve_claim on a routed claim
  Note over M,ES: Write back: the paid claim becomes evidence
  M->>W: job claim_draft once the claim is paid
  W->>ES: set_outcome writes the outcome and payout to claim-ID-vN
```

**`claim_review` receives the precedents today.** `review_payload` in the module reads this pack version's `claim_precedent` rows, best score first, into `ReviewPayload.precedents`. `bandit-workers` prints them in the prompt as a `<precedents>` block, one line each, such as `history-04 (similarity <score>): outcome auto_settled, paid $98.00: Fall in zone Main stage left at 22:10 ...`. The system prompt tells the Anthropic Claude API to use them "to see how claims like this were decided, never as evidence about this claimant".

**Code never reads them.** `decide` in `bandit-insurance` reads the checks, the corroboration, the review gate and the learned rule, and nothing in the decision code reads `claim_precedent`. The precedents reach the decision only through the review's verdict, which can hold automation and route the claim to the organizer; `validate_review` rejects any dollar figure in the review that is not one of the claim's own amounts.

**The validation check routes.** A copy that fails `bandit-claims-validate` becomes a failed `elastic_validation` check, and `decide` routes the claim with "failed checks: elastic_validation". If Elastic is down, `on_job_dead` stores the info check "Elastic was unavailable; no validation or precedents" and queues `claim_review` anyway.

**The organizer sees them.** The staff-only view `board_precedents` feeds the claim's detail in the organizer portal, under "Similar past claims (Elastic)": reference, outcome, payout, score and narrative.

**Paid claims become precedents.** Once a claim is paid, job `claim_draft` writes its outcome and payout back to its copy (`set_outcome`), so it can be a precedent at a later event; a refused live claim keeps an empty outcome and never becomes one. The incoming `claimant_statement`, the attendee's own words from `file_claim`, goes to `claim_review` only, because `claim_doc` builds the Elastic copy from fixed fields and a fixed template.

### Why Elastic and not SpacetimeDB

Each store does what it is best at. SpacetimeDB owns all live state and every write (reducers are the only write path), the subscriptions that push changes to the apps, the space-time mapping of zones and times, every exact list, and the findable switch. Elastic owns three things SpacetimeDB is not built for: fuzzy entity resolution across messy scraped sources before the import, ordering by meaning with semantic search, and checking each claim copy as it arrives.

SpacetimeDB decides who and what is on the list (exact, private, live); Elastic decides the order by meaning. Elastic orders only candidates SpacetimeDB already listed, it never decides access, and it never holds live state. The people graph is all SpacetimeDB: its nodes and links are facts the bands measured.

| Question | Who answers | Why |
|---|---|---|
| "Is `Elastic` on the event's sponsor list the same company as the LinkedIn record under another domain?" | Elastic, `bandit-organize` | Entity resolution over messy text, before the import |
| "Which zone does the schedule line `Stage A, Hall 1` belong to?" | Elastic, `bandit-organize` | Free-text location matched to zone names, by `LOOKUP JOIN` first and by the agent second |
| "Which zone is band 7 in right now?" | SpacetimeDB | Live `band` row, pushed by subscription |
| "Who is in the light circle around the fallen person?" | SpacetimeDB | Written inside the incident transaction; must never wait on a search |
| "Who did I hang out with tonight?" | SpacetimeDB, `my_encounters` | Exact encounter rows the bands measured; `findable` is checked in the view |
| "Which booths and companies tie the crowd together?" | SpacetimeDB, the people graph | `visited`, `works_at` and `exhibits` links to shared booth and company nodes, pushed live to the big screen through `event_graph` |
| "Of the people I hung out with, who is most into the same things as me?" | Elastic, `GET /api/recap` | Two people who visited different booths can still care about the same things; only embeddings of the booth texts can tell. The answer is an order, never a new name on the list |
| "Of the booths in the zones I visited, which fit me best?" | Elastic, `GET /api/recap` | My interests matched to booth descriptions by meaning |
| Insurance.md: "Which past claims look like this one?" | Elastic, `bandit-claims` | Meaning over a de-identified narrative; the answer is context on the claim, never an amount |

Presence is zone-level only ([SpacetimeDB](../2-data/SpacetimeDB.md)), and the copy indices hold no positions at all: a booth carries its zone's id and name, and an attendee's interests name zones and booths.

### What Elastic does not do

- It does not serve lists or search. There is no typed query anywhere in BandIt. "My visits", "my encounters", "my photos" and "the booth with number B12" are SpacetimeDB views in the apps; the one attendee route, `GET /api/recap`, builds its lists from SpacetimeDB rows and only orders two of them with Elastic.
- It does not decide who may see what. The indexer copies only findable attendees, and `bandit-api` takes every candidate from SpacetimeDB rows (`api_sessions`, `social_attendees`, `social_encounters`, `social_visits`). No Elastic query, model or key decides access.
- It does not hold or discover graph links. The bands measure who met whom and who stood at which booth, and SpacetimeDB stores those links ([Social](../6-features/Social.md)). Elastic Kibana Graph is not used: it is unavailable on Elastic Cloud Serverless, and it discovers links from terms that occur together in documents, while here the links are already measured.
- It does not hold live state or history. Live counts, band rows, stays and incidents stay in the module. The Elastic Kibana dashboards read the import run's records and logs, the recap copy and rankings, Vision.md: the raw radio log and photo records, and Insurance.md: the de-identified claim copies; none of them shows a live count or a zone's density.
- It does not fetch or crawl. Elastic's Open Crawler is not used, the agent has no web tool, and there are no scheduled re-scrapes: one run per import. Bright Data cannot deliver to Elasticsearch directly, so `bandit-ingest` bulk-indexes the records itself.
- It does not read floor plans. Zones and booth spots come from the team's plan files (`zones.json`, `booths.json`) through the map stage of `bandit-ingest`, and reach Elastic as `bandit-raw-plan` records.

### Part one: organizing the scraped data, upstream of SpacetimeDB

Scraped records are messy in regular ways. One organisation appears under several website domains (its own site, a careers or short-link domain, a parent company in a dataset); a prize names its sponsor in a tag such as `[Acme] Best Use of Acme`; a speaker's company and a schedule item's location are free text.

Fixed Elastic ES|QL `LOOKUP JOIN` steps handle the regular cases deterministically, before any model runs. The irregular remainder is where a model with search tools helps: it finds candidates by meaning, picks one or none, and says why.

Each step has one owner: Bright Data fetched every page, Rust parsed the pages into records, the join steps of `bandit-organize` make the exact links, the agent makes the fuzzy ones, and Rust decides what is loadable.

The question this diagram answers: how do raw records become the bundle that lands in SpacetimeDB?

```mermaid
flowchart TB
  ING["bandit-ingest: fetch, parse, map"] -->|"JSON records, _bulk"| RAW["Raw indices: bandit-raw-pages, bandit-raw-orgs, bandit-raw-plan"]
  ING -->|"run id, Workflows API"| WF["Elastic Workflow bandit-organize"]
  RAW -->|"joined rows, LOOKUP JOIN"| WF
  WF -->|"open items + JSON schema, ai.agent"| AG["Elastic Agent Builder agent bandit-organizer"]
  RAW -->|"records, bandit.records + bandit.candidates"| AG
  AG -->|"plan, judge candidates"| LLM["Elastic Managed LLM"]
  AG -->|"decisions + reasons, structured output"| WF
  WF -->|"one document per run, save_bundle"| BUN["bandit-bundles"]
  BUN -->|"read by run id, _search"| VAL["bandit-ingest: check and assemble in Rust"]
  VAL -->|"decisions + step times, _bulk"| LOGS["bandit-organizer-decisions, bandit-pipeline-events"]
  VAL -->|"event bundle, import_event"| STDB["band1t module"]
  STDB -->|"booths without a plan spot, place_booth"| FIX["organizer"]
  classDef rust fill:#FBE9E7,stroke:#BF360C,color:#1A1A1A
  classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
  classDef web fill:#E3F2FD,stroke:#1565C0,color:#1A1A1A
  classDef ext fill:#E0F2F1,stroke:#00695C,color:#1A1A1A
  class ING,VAL rust
  class STDB stdb
  class FIX web
  class RAW,WF,AG,LLM,BUN,LOGS ext
```

**Raw indices.** `bandit-ingest` writes every record with a `run_id` and deletes the run's old documents first, so a rerun replaces them and the agent's tools always filter on the current run. `bandit-raw-orgs` and `bandit-raw-plan` are created with `index.mode` set to `lookup`, so they can sit on the right side of a `LOOKUP JOIN`.

Every document carries its source (`source_key`, `source_url`, `fetched_at`, `snapshot_sha256`), its join keys (`domain`, `org_key`, `location_norm`, `aliases`), a `text` field mapped as `semantic_text`, the printed texts (`tier_text`, `role_text`, `location_text`, `start_text`, `end_text`) and everything else under `fields`, such as a prize's `fields.cash_usd`. The Cal Hacks 13.0 run holds 250 documents, of the kinds the [Indices](#indices) table lists.

**The workflow.** `bandit-organize` is an Elastic Workflow, defined in `crates/bandit-ingest/elastic/workflows/bandit-organize.yaml`, that `bandit-ingest` starts once per import run through the Elastic Workflows API, passing the run id. Elastic Workflows are generally available on Elastic Cloud Serverless; the feature is switched on in the project settings.

| Step | Elastic feature | What it does |
|---|---|---|
| `join_orgs` | Elastic ES\|QL, `LOOKUP JOIN bandit-raw-orgs ON run_id, domain` | joins every organisation candidate to the company facts records with the same website domain; one row per domain |
| `join_keys` | Elastic ES\|QL, `STATS ... BY org_key` | groups prizes and speakers with the organisation candidates that print the same normalised name |
| `join_schedule` | Elastic ES\|QL, `LOOKUP JOIN bandit-raw-plan ON run_id, location_norm` | matches each schedule item's location to a zone name |
| `list_prizes`, `list_people` | Elastic ES\|QL | the prizes and speakers to link |
| `org_schema`, `link_schema` | `data.parseJson` | JSON schemas that require exactly one decision per domain, prize, speaker and schedule item |
| `organize_orgs` | `ai.agent`, agent `bandit-organizer` | who is who across domains: key, name, facts record, category, tags, description, match method and reason; organisation gaps |
| `link_records` | `ai.agent`, agent `bandit-organizer` | each prize, speaker and schedule item to an organisation and a zone, with a reason; link gaps |
| `save_bundle` | `elasticsearch.index` | one document in `bandit-bundles`, id = run id |

Every Elastic ES|QL step ends in `LIMIT 500`, and nothing a model says can change the join rows: the agent gets them in its message and must never undo them. A malformed answer fails its schema inside Elastic.

`bandit-ingest` polls the execution every 5 s, reads the document back and checks it in Rust: every key it uses must be a `source_key` of the run or an organisation key it defined, and every organisation candidate, prize, speaker and schedule item must have a decision. `assemble` then checks that every category is on the fixed list, that no organisation appears twice and that every link points at a defined organisation, builds the event bundle from the run's records and hashes it; `import_event` checks once more inside the transaction.

If the workflow fails or a check fails, `bandit-ingest` stops before `import_event`, so the module keeps the event it loaded last. The failed execution stays in Elastic Kibana, the bundles of earlier runs stay saved in `events/calhacks-13/bundles/`, and `bandit-ingest load` loads one of them.

**Run logs.** Two more indices record each run for the Elastic Kibana dashboards. `bandit-ingest` writes both, and the agent's tools never read them; a rerun of the same run id replaces that run's decisions.

| Index | One document per | Fields |
|---|---|---|
| `bandit-organizer-decisions` | decision in the bundle `bandit-ingest` read back: one per organisation, prize link, person link, schedule link and gap | `run_id`, `decision_kind` (`organization`, `prize_link`, `person_link`, `schedule_link`, `gap`), `key` (the record or organisation decided on), `organization_key`, `name`, `category`, `tags`, `match_method` (`exact_domain` or `agent`, on organisations), `reason` (the agent's sentence), `at` |
| `bandit-pipeline-events` | step of one run: `index_records`, each workflow step as `workflow.<step>`, `workflow`, `read_bundle`, `write_decisions`, `save_bundle` | `run_id`, `stage`, `at`, `duration_ms`, `counts` (an object of counts for that step), `note` |

**What the `bandit-organizer` agent decides.** It decides who is who and how records link, and nothing else. The exact wording lives in `crates/bandit-ingest/elastic/agents/bandit-organizer.instructions.md`:

- Use only records of the run in the task. Build on the exact joins the workflow made; never undo one.
- For what the joins left open, look up candidates with `bandit.candidates` and pick one or none. Never merge on a name alone when the domains differ; merge different domains only on clear evidence beyond the name. Every merge and every link gets a one-sentence reason.
- Every key returned is a `source_key` from the task or a tool result, or an organisation key the agent defined (`org:` plus the primary domain). Never invent a key.
- Pick as `facts_key` the one company facts record that is clearly about the organisation, else `""`. Give it one category from the fixed list and at most 5 lowercase tags; descriptions and tags come only from the text in the records, never from the model's own knowledge.
- When not sure, leave the link empty (`""`) and add a gap: something a person has to fix, with the record's key and a one-sentence reason.

The fixed category list: `ai`, `developer_tools`, `cloud`, `data`, `security`, `fintech`, `crypto`, `venture`, `design`, `hardware`, `gaming`, `food_drink`, `health`, `education`, `other`. The JSON schema of `organize_orgs` enforces it, and `assemble` checks it again.

**Tools.** Two fixed, parameterised Elastic ES|QL tools, defined in `crates/bandit-ingest/elastic/tools/`. Fixed queries keep the run filter, the limits and the field choices where the model cannot drop them, and the agent's built-in Elastic tools are off (`enable_elastic_capabilities: false`), so these two are all it can call.

| Tool id | Index | Parameters | Returns | Why this shape |
|---|---|---|---|---|
| `bandit.records` | `bandit-raw-pages`, `bandit-raw-orgs`, `bandit-raw-plan` | `run_id`, `record_kind` | every record of that kind in the run, sorted by `source_key`, at most 300 rows, `text` cut to 300 characters | the agent's work list |
| `bandit.candidates` | `bandit-raw-pages`, `bandit-raw-orgs` | `run_id`, `query` | the 5 best records: `FORK` runs a keyword `MATCH` on `name` and a semantic `MATCH` on `text`, and `FUSE` merges them with reciprocal rank fusion | the one place the model shapes a query |

Both tools have a `LIMIT`, and the agent runs one section at a time, because the most common Elastic Agent Builder failure is a tool response or an answer larger than the model's context.

**The matching ladder.** Elastic's entity-resolution pattern, used for organisation merging and for linking prizes, speakers and schedule items.

The question this diagram answers: in what order is a match tried, and when does the model get involved?

```mermaid
flowchart LR
  C["Candidate: organisation, prize, speaker or schedule item"] -->|"domain, location_norm"| E["Exact join: LOOKUP JOIN step"]
  E -->|"hit"| M["Decision with source keys and a reason"]
  E -->|"miss"| H["Agent: bandit.candidates, keyword + semantic, FUSE"]
  H -->|"top 5 candidates"| J["Agent judges: one match or none, with a short reason"]
  J -->|"match"| M
  J -->|"none"| N["Empty link and a gap for a person to fix"]
  classDef ext fill:#E0F2F1,stroke:#00695C,color:#1A1A1A
  class C,E,H,J,M,N ext
```

The exact joins are deterministic and cheap, so most records never need the model's judgment. The judge step is the only place the model decides; it must pick from the candidates it was given and write one sentence of reason, which lands in `bandit-organizer-decisions` next to the decision. The reviewer reads the reasons, not the prompt.

**The LLM behind Elastic Agent Builder.** Elastic Agent Builder runs the agent on the project's default connector, an Elastic Managed LLM served by the Elastic Inference Service; the saved Cal Hacks 13.0 run records `.anthropic-claude-5-sonnet-chat_completion`. BandIt's own Anthropic Claude API key is not wired into Elastic, and every call BandIt makes to it stays in `claude-client` ([Anthropic-Claude-API](Anthropic-Claude-API.md)).

### Part two: the one-way copy, downstream of SpacetimeDB

Data enters the copy indices only from SpacetimeDB. It leaves only as ids and scores for `bandit-api`, and as charts in the recap suggestions dashboard.

The question this diagram answers: which rows reach the copy, and who reads it?

```mermaid
flowchart LR
  STDB["band1t module"] -->|"zone, organization, booth, schedule_slot, subscription"| IDX["bandit-indexer"]
  STDB -->|"Social.md views: social_attendees, social_visits"| IDX
  IDX -->|"changed documents, _bulk at most once a second"| ES["Elastic Serverless: bandit-booths, bandit-people"]
  ES -->|"ranked ids + scores, semantic queries"| API["bandit-api: GET /api/recap"]
  ES -->|"booth and people charts, ES|QL"| KIB["Elastic Kibana: recap suggestions dashboard"]
  classDef rust fill:#FBE9E7,stroke:#BF360C,color:#1A1A1A
  classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
  classDef ext fill:#E0F2F1,stroke:#00695C,color:#1A1A1A
  class IDX,API rust
  class STDB stdb
  class ES,KIB ext
```

**bandit-indexer.** A Rust process with the `indexer` service role, on the Vultr VM next to `bandit-api`, as the systemd service `bandit@indexer`. It is an ordinary SpacetimeDB client: one connection to the `band1t` database, subscriptions to the copied tables and views, and a dirty flag that every row callback sets. On start it prints its identity so the owner can grant the `indexer` role with `grant_role` ([SpacetimeDB](../2-data/SpacetimeDB.md)).

- **Rebuild, then write the difference.** At most once a second, when something changed, the indexer rebuilds every document from the SDK cache, writes the ones that differ from what it last wrote, and deletes the ones it no longer builds, in bulk requests of 100. Joins happen here, at build time, so queries never join.
- **Self-repair.** On start it creates each index whose alias is missing and lists the ids already in Elastic, so the first flush deletes anything stale. An operation Elastic did not apply leaves the flag set, and the next flush tries again.
- **Generations.** Each logical index is an alias (`bandit-booths`) over a generation index (`bandit-booths-001`); `bandit-api` only names the alias. The module knows nothing about Elastic: there is no "indexed" flag in SpacetimeDB.

| Table or view (owner) | Copied to | Filter |
|---|---|---|
| `zone` (SpacetimeDB.md) | folded into both: the zone name on a booth; the zone's name and description in `interests` | none; venue layout is public |
| `booth`, `schedule_slot` (SpacetimeDB.md) | `bandit-booths` | none; venue content |
| `organization` (Bright-Data.md) | folded into `bandit-booths` (name, kind, sponsor tier, description, tags) and `bandit-people` (the attendee's company name) | none; facts about companies |
| `social_attendees` view (Social.md) | `bandit-people` | the indexer keeps only attendees with `findable` on |
| `social_visits` view (Social.md) | folded into `bandit-people` `interests` | visits of findable attendees only |
| everything else: `band`, `zone_visit`, `encounter`, `person`, `people_link`, `photo`, `photo_tag`, incidents, medical, payments, insurance, `job`, `blob_ref`, vision tables | never | live band data, graph links and photos stay in the module and the blob store; Insurance.md: a de-identified claim copy reaches `bandit-claims` from `bandit-workers`, never through the indexer |

The findable switch is `attendee.findable`, given meaning by [Social](../6-features/Social.md). When an attendee turns it off, the next flush no longer builds their `bandit-people` document and deletes it.

**`bandit-booths`** (one document per `booth` row, id = booth id): `booth_id`, `name`, `booth_number`, `kind`, `tags` (the booth's tags, then its organisation's), `zone_id`, `zone_name`, `organization_id`, `org_name`, `org_kind`, `sponsor_tier`, and `description` (semantic_text): the booth's description, its organisation's description, the tags and its schedule titles, one per line, so one meaning search covers all of them.

**`bandit-people`** (one document per findable attendee, id = attendee id as hex): `attendee_id`, `node_id` (the attendee's node in the people graph, which the recap ranks by), `organization` (their company's name), and `interests` (semantic_text). `interests` is built from the attendee's top 5 spots by visit minutes: for each, the zone's name and description, then the name, description and tags of the booth the visit names, or of every booth in the zone when it names none. The spots go in zone and booth order, so the document changes only when the set of spots changes, not as minutes add up.

### Part three: ordering the recap's suggestions

The recap ([Tap-Page](../5-apps/Tap-Page.md)) asks `bandit-api` for `GET /api/recap` once the organizer ends the event. `bandit-api` builds the whole recap from its subscription cache, including two lists of suggestions: `suggested_people`, everyone the attendee hung out with who is findable, and `suggested_booths`, every booth in a zone they visited, with the minutes spent there ([Social](../6-features/Social.md)).

SpacetimeDB rows decide who and what is on each list. Elastic only decides the order of these two, so the people and booths closest to what the attendee was into come first; there is no query box, and the attendee's own `interests` text is the query.

**`GET /api/recap`.** One route in `bandit-api`, handler `recap`; [Rust-Backend](../3-services/Rust-Backend.md) owns the process and this file owns the ranking. It hashes the `x-bandit-session` token, finds the caller in the `api_sessions` view, builds the recap from its cache with both lists by minutes, and ranks them as [the recap job](#order-each-attendees-recap-suggestions-by-meaning) shows. A caller with no `bandit-people` document is ranked with the same kind of text built from their visits in the cache (`visited_text`).

`apply_ranking` puts both lists in Elastic's order with their scores; candidates Elastic did not return follow without a score, by minutes, and `suggestions_ranked` becomes true. `log_ranking` then writes the caller's latest ranking to `bandit-recap-rankings`, next to the booth that minutes alone put first, for the recap suggestions dashboard.

If an Elastic call fails or takes more than 10 s, the recap comes back with the suggestions by minutes and `suggestions_ranked` false. The tap page draws the suggestion cards from this answer and acts through reducers.

The question this diagram answers: when the recap page opens, who talks to whom, and where does the list come from?

```mermaid
sequenceDiagram
  participant APP as Tap page, recap
  participant API as bandit-api
  participant STDB as band1t module
  participant ES as Elastic Serverless
  STDB-->>API: social views and api_sessions, by subscription
  APP->>API: GET /api/recap with the x-bandit-session token
  API->>API: hash the token, find the caller in api_sessions
  API->>API: build the recap from the cache, suggestions by minutes
  API->>ES: ids query for the caller's bandit-people document
  ES-->>API: interests text
  API->>ES: semantic query on bandit-people interests, terms on candidate node_id
  API->>ES: semantic query on bandit-booths description, terms on candidate booth_id
  ES-->>API: ranked ids and scores
  API->>ES: PUT bandit-recap-rankings, log_ranking
  API-->>APP: the recap with suggestions in order and suggestions_ranked
  APP->>STDB: subscribe to my_visits and my_encounters for the night's timeline
```

### Insurance.md: similar past claims, `bandit-claims` and `bandit-claims-validate`

[Insurance](../6-features/Insurance.md) sends a de-identified copy of each claim pack version here. It is the only insurance data Elastic receives, and [How The Evidence Engine feeds the insurance Decision Engine](#how-the-evidence-engine-feeds-the-insurance-decision-engine) shows where the results go.

`bandit-workers` builds the copy in code (`claim_doc` in job `claim_verify`) from the job's `VerifyPayload`, never through the indexer. It holds no names, no attendee or band ids, and no staff notes, visit reasons or history; a property claim's damage is written only as "equipment damaged", because staff type its description.

The 30 past claims are synthetic, written by the team in `crates/claims-elastic/src/history.rs`: two earlier events at the same venue, with 13 auto-settled, 13 approved and 4 refused. `bandit-workers` seeds them through the same pipeline when it first creates the index, and checks that every one passed validation.

**`bandit-claims`** (one document per claim pack version, id `claim-<claim id>-v<pack version>`, so a retried job overwrites the same document; plus the seeded past claims). The mapping is `dynamic: false`, so a field outside this table is never indexed.

| Field | Type | Holds |
|---|---|---|
| `doc_id` | keyword | the document id; `history-01` to `history-30` for a seeded claim |
| `claim_id` | long | the SpacetimeDB claim id; 800001 to 800030 for a seeded claim |
| `pack_version` | integer | the pack version the copy was built from; 1 on a seeded claim |
| `source` | keyword | `live` or `history` |
| `venue` | keyword | the venue's name |
| `incident_kind` | keyword | `sos`, `fall` or `property` |
| `cover_kind` | keyword | `medical_payments` or `property` |
| `zone_id`, `zone_name` | long, keyword | the incident's zone |
| `incident_at` | date | the incident's time |
| `corroboration` | keyword | `corroborated`, `uncorroborated` or `disputed` |
| `witness_count` | integer | light-circle witnesses in the incident zone |
| `diagnosis_codes`, `service_codes` | keyword | the hospital report's ICD-10-CM codes, and its CPT and HCPCS codes |
| `record_sha256` | keyword | the hospital report's SHA-256; the report itself stays outside Elastic |
| `billed_cents`, `covered_cents`, `payout_cents` | long | the amounts code computed |
| `outcome` | keyword | empty while open; `auto_settled` or `approved` once paid; seeded claims also hold `refused` |
| `narrative` | semantic_text, `.jina-embeddings-v5-text-small` | one sentence built by `narrative_for` from a fixed template, such as "Fall in zone Main stage left at 22:10 during a headline set; 3 light-circle witnesses in the same zone; medic note within 12 minutes; right wrist sprain S63.501A; first aid only." |
| `validation.valid`, `validation.errors` | boolean, keyword | written by the pipeline |
| `indexed_at` | date | written by the pipeline |

**`bandit-claims-validate`** is the index's default pipeline (`index.default_pipeline`), and every write also names it. One Painless `script` processor never rejects a document: it writes `validation.valid` and one entry in `validation.errors` for each problem.

- `missing:<field>`: `claim_id`, `pack_version`, `incident_kind`, `cover_kind`, `incident_at` or `narrative` is empty;
- `bad_incident_kind`, `bad_incident_at`, and `incident_in_future` for a time more than 60 s ahead;
- `injury_needs_zone` and `injury_needs_witness_count` on an SOS or a fall;
- `bad_cents:<field>` for an amount that is negative or not a whole number of cents, and `covered_exceeds_billed`;
- `bad_diagnosis_code` and `bad_service_code` for a code that is not shaped like ICD-10-CM, CPT or HCPCS.

An empty narrative is dropped so the embedding cannot fail the write, and a processor error marks the document invalid with `pipeline_error`. The worker turns the result into the `elastic_validation` check: an invalid copy fails it, which routes the claim to the organizer with the errors listed, and Elastic never refuses a claim.

**The search.** After the write, `similar_claims` runs one `semantic` query on `narrative`, with the copy's own narrative as the query text. It keeps decided claims only, skips this claim and every live claim from the last 24 h, so precedents are always from earlier events, then collapses on `claim_id` and takes the top 3.

### Part four: Elastic Kibana, what the team shows

Elastic Kibana is Elastic's web app, where a team configures Elastic Workflows and Elastic Agent Builder, watches each workflow run step by step, and builds dashboards over any index. For BandIt it is the most visual way to show the Elastic side: how messy scraped records became one checked bundle, what the scrape found about the event's sponsors and prizes, what the gateway heard, and where meaning changed a recap's order. Insurance.md: and what the claims look like, what was paid and which evidence failed validation.

Elastic Kibana reads only what Elastic already holds. The live event is shown in the [organizer portal](../5-apps/Organizer-Portal.md) from SpacetimeDB subscriptions, so no Elastic Kibana view repeats a live count, a zone's density or an incident. Only the team opens Elastic Kibana, signed in to the Elastic Cloud project.

The question this diagram answers: which Elastic Kibana view reads which data, and where does that data come from?

```mermaid
flowchart LR
  subgraph Sources["Data Elastic holds"]
    RUN["One import run: raw indices, bandit-organizer-decisions, bandit-pipeline-events"]
    RAD["Vision.md: bandit-raw-radio, -heard, -gateway, -photos"]
    REC["bandit-booths, bandit-people, bandit-recap-rankings"]
    CLM["Insurance.md: bandit-claims"]
  end
  subgraph Kibana["Elastic Kibana, opened by the team"]
    WFV["Elastic Workflows: executions of bandit-organize, step by step"]
    ABV["Elastic Agent Builder: bandit-organizer's conversations and tool calls"]
    D1["Dashboard: BandIt · Cal Hacks 13.0 · scrape pipeline"]
    D2["Dashboard: BandIt · Cal Hacks 13.0 · sponsors and prizes"]
    D3["Vision.md dashboard: BandIt band radio and photos"]
    D4["Dashboard: BandIt recap suggestions"]
    D5["Insurance.md dashboard: BandIt claims evidence"]
  end
  RUN -->|"step runs, workflow record"| WFV
  RUN -->|"tool calls, ai.agent conversation"| ABV
  RUN -->|"counts + decisions, ES|QL"| D1
  RUN -->|"prizes + companies, ES|QL"| D2
  RAD -->|"beacons + photos, ES|QL"| D3
  REC -->|"rankings + booths, ES|QL"| D4
  CLM -->|"claims + validation, ES|QL"| D5
  STDB["band1t module: live state"] -->|"live rows, subscriptions"| OPS["organizer portal: the live screen"]
  classDef ext fill:#E0F2F1,stroke:#00695C,color:#1A1A1A
  classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
  classDef web fill:#E3F2FD,stroke:#1565C0,color:#1A1A1A
  class RUN,RAD,REC,CLM,WFV,ABV,D1,D2,D3,D4,D5 ext
  class STDB stdb
  class OPS web
```

| Elastic Kibana view | Reads | What it shows | When the team opens it |
|---|---|---|---|
| Elastic Workflows, executions of `bandit-organize` | the execution record of `bandit-organize` | each step of one import run in order: the Elastic ES\|QL join steps with their rows, both `ai.agent` sections, the final index step, the time each took and any error | at the event, to show judges how the event got loaded |
| Elastic Agent Builder, the `bandit-organizer` agent | the conversation each `ai.agent` step saved | the tools the agent called, the candidates each search returned, and the reason behind every merge and link | at the event, next to the workflow; when a reviewer checks a merge |
| Dashboard: "BandIt · Cal Hacks 13.0 · scrape pipeline" (id `bandit-pipeline-calhacks-13`) | the three raw indices, `bandit-organizer-decisions` and `bandit-pipeline-events`, for the run it was installed with | a note naming the run and who did each part; four counts: raw records from Bright Data, organisations after merging, matches only the agent could make, gaps flagged for review; records by source and kind; how each organisation was matched (exact domain or agent); a table of the decisions with their reasons; the time each pipeline step took; the gaps list | before the load stage, to review the bundle; at the event, to show judges how the event got loaded |
| Dashboard: "BandIt · Cal Hacks 13.0 · sponsors and prizes" (id `bandit-event-calhacks-13`) | `bandit-raw-pages`, `bandit-raw-orgs` and `bandit-organizer-decisions`, for the same run | four counts: prize cash in USD, prizes, sponsors and partners, company profiles from LinkedIn and Crunchbase; prize cash by sponsor; sponsors by the category the agent gave them; sponsors by tier; a tag cloud of what the sponsors work on; a table of the companies with domain, source, industry, headquarters, size and founding year | at the event, to show what the scrape found about it |
| Insurance.md: Dashboard: "BandIt claims evidence" (id `bandit-claims`) | `bandit-claims` | a note on what the index holds, how it is checked and what comes back to the claim; four counts: claims tonight, past claims to match against, evidence failing validation, paid tonight in USD; tonight's claims as Elastic holds them; outcomes and incident kinds, tonight and past; paid tonight by zone in USD; the validation result of every document | at the event, next to the Claims queue in the organizer portal |
| Vision.md: Dashboard: "BandIt band radio and photos" (id `bandit-radio`) | `bandit-raw-radio`, `bandit-raw-heard`, `bandit-raw-gateway`, `bandit-raw-photos` | a note on what the recorders write; four counts: beacons heard, bands heard, heard lists, photos recorded; beacons every 10 s by bands and station markers; each band and station marker with its beacons and signal at the gateway; band beacons by zone and by flag (SOS, fall, button press); heard lists per band; the recording sessions; the photo records | after a recording, to check what the gateway heard |
| Dashboard: "BandIt recap suggestions" (id `bandit-recap`) | `bandit-booths`, `bandit-people`, `bandit-recap-rankings` | a note on who decides the list and who decides the order; four counts: booths it ranks, attendees it ranks, recaps ranked, recaps where meaning changed the first booth; each attendee's latest ranking with the first booth by meaning next to the first by minutes; the booths and people suggested first most often; the booths it ranks | after "Event ended", once attendees open their recaps |

The organizer portal's "Kibana" tab walks through Elastic's jobs in the order of the event: organizing the scraped event data, the bands' radio log and the photos, ordering the recap's suggestions, and checking claim evidence. Each job has a short note and links to its views: the two event dashboards, the `bandit-organize` workflow runs and the `bandit-organizer` agent; the radio and photos dashboard; the recap suggestions dashboard; Insurance.md: the claims evidence dashboard. Every chart opens in Elastic Kibana ([Organizer-Portal](../5-apps/Organizer-Portal.md)).

Every chart and count is an Elastic ES|QL query. `bandit-ingest` installs the two event dashboards through the Elastic Kibana Dashboards API at the end of each full run, one pair per event (the ids end in the event's slug, `calhacks-13` for Cal Hacks 13.0), with that run's id fixed in every query, and its `dashboards` command installs them again for any saved run. So they keep showing the saved import run even when no new run happens.

The radio and photos, recap suggestions and (Insurance.md) claims evidence dashboards go in through the same API from their saved files in `kibana/`, by `kibana/install.sh`.

Elastic Kibana Graph is not used: it is unavailable on Serverless.

### Vision.md: the raw radio log and photos

Leo's recorders on the venue laptop write four more raw indices through `pipeline/elastic.py` ([Vision](../4-devices/Vision.md)). They are separate from the import run's raw indices, and `bandit-organize`, the indexer and the recap never read them. They are kept for the team to line photos up against the band data in Elastic Kibana after the event; live state never comes from them.

| Index | One document per | Main fields |
|---|---|---|
| `bandit-raw-radio` | band or station marker beacon the gateway heard | session, time, band id or station marker id, the SOS, fall and press flags, `neigh`, zone, battery, state, `seq`; for an exit marker, its exit colour |
| `bandit-raw-heard` | heard list from a band (packet type 4, sent about every 1 s) | session, time, band id, the RSSI of each neighbour band and of each station marker, and the five station marker RSSIs as one vector |
| `bandit-raw-gateway` | other gateway line (boot, info, ack, error) | session, time, `event`, the raw text |
| `bandit-raw-photos` | imported photo, never the image itself | session, time (corrected by the sync shot for a camera), file name and SHA-1, camera make and model, size, location and its accuracy |

## Failure modes and fallbacks

| Failure | Effect | Design answer |
|---|---|---|
| A `bandit-organize` run fails (model quota, agent error) or its bundle fails the Rust checks | No new bundle | `bandit-ingest` stops before `import_event`, so the module keeps the event it loaded last; the failed execution stays in Elastic Kibana, and `bandit-ingest load` loads a bundle saved by an earlier run |
| The agent merges two different organisations | Wrong facts on a booth | A merge of different domains needs evidence beyond the name; every merge carries a reason, and the team reads them in the scrape pipeline dashboard's decisions table before the load stage |
| Elastic Serverless unreachable | `GET /api/recap` cannot rank | The recap comes back with the suggestions by minutes and `suggestions_ranked` false. Insurance.md: `claim_verify` fails after its attempts, `on_job_dead` stores the info check "Elastic was unavailable; no validation or precedents" and queues `claim_review`, so the claim decides without precedents. Nothing live reads Elastic |
| Insurance.md: `bandit-claims-validate` marks a claim copy invalid | The claim is flagged | The `elastic_validation` check fails with the pipeline's errors, and `decide` routes the claim to the organizer; it is never refused for it |
| Insurance.md: writing the outcome back fails | The paid claim never becomes a precedent | `claim_draft` logs it and carries on; the claim itself is not affected |
| `bandit-indexer` down | New visits are not copied | The recap ranks against the last copy, and a caller with no document is ranked by `visited_text`; on restart the indexer lists the ids in Elastic, rebuilds every document and writes the difference |
| `findable` switched off after indexing | A stale document of an attendee who is no longer findable | The next flush no longer builds the attendee's `bandit-people` document and deletes it |

## Dependencies

**Depends on**

- [Bright-Data](Bright-Data.md): the `bandit-ingest` pipeline that writes the raw indices, starts `bandit-organize`, checks the bundle and calls `import_event`; the `organization` rows that the copy carries.
- [SpacetimeDB](../2-data/SpacetimeDB.md): tables `zone`, `booth`, `schedule_slot`; reducer `grant_role`; the `indexer` and `api` service roles.
- [Rust-Backend](../3-services/Rust-Backend.md): the `bandit-api` and `bandit-ingest` process shells, the Vultr VM, and the `.env` that holds `ELASTICSEARCH_API_KEY` and `KIBANA_API_KEY`; Insurance.md: the `bandit-workers` shell for the `claim_verify` job.
- [Social](../6-features/Social.md): the views `social_attendees`, `social_visits`, `social_encounters` and `api_sessions`, and the `findable` meaning behind them. Social.md: without it `bandit-people` stays empty, there is no recap list to order, and only the booth copy works.
- An Elastic Cloud Serverless project with Elastic Agent Builder, Elastic Workflows and the Elastic Inference Service, and Elastic Kibana for the team.

**Used by**

- [Bright-Data](Bright-Data.md): the organize stage of its pipeline (one row starting with "Elastic.md").
- [Tap-Page](../5-apps/Tap-Page.md): the order of the recap's people and booths, through `GET /api/recap`.
- [Organizer-Portal](../5-apps/Organizer-Portal.md): the "Kibana" tab.
- [Social](../6-features/Social.md): the order of its recap suggestions.
- [Insurance](../6-features/Insurance.md): `bandit-claims` and `bandit-claims-validate` validate its de-identified claim copies and rank them against decided past claims, and the results come back as a check and precedents through its `submit_claim_checks`.
- [Architecture](../1-overview/Architecture.md) and [Flows](../1-overview/Flows.md): the Elastic container for `bandit-organize` and the recap order, steps 0b and 7 and the Elastic Kibana close.
- The team, in Elastic Kibana.

**If you delete this file**

- Remove `bandit-indexer`, and the Elastic ranking and `bandit-recap-rankings` in `GET /api/recap`, from [Rust-Backend](../3-services/Rust-Backend.md) (process table, binaries row, endpoint registry) and from [Architecture](../1-overview/Architecture.md) (interfaces rows, context, container and deployment diagrams, data ownership rows, the prize row and the failure row; in "What each database does best", the paragraph starting "Elastic.md:", its table and the diagram after it). Remove the Elastic.md rows (step 0b, step 7, its diagram index row and its failure row), the Elastic.md decision row and the Elastic Kibana paragraph from [Flows](../1-overview/Flows.md).
- Remove the "Elastic.md" rows from [SpacetimeDB](../2-data/SpacetimeDB.md) (the `bandit-indexer` interfaces row, the `indexer` role row, the subscriptions row and the registry row) and turn its "Copied" labels into "Not copied".
- Remove the Elastic.md organize stage row, interface rows, diagram nodes, sequence steps, failure row and dependency bullets from [Bright-Data](Bright-Data.md). `bandit-ingest` then has no organized bundle to load, and booths and their organisations are written by hand into the bundle that `import_event` loads.
- Remove the recap order rows from [Tap-Page](../5-apps/Tap-Page.md) and the Elastic bullets from [Social](../6-features/Social.md); the recap then lists its people and booths by minutes. Remove the "Kibana" tab from [Organizer-Portal](../5-apps/Organizer-Portal.md), the Elastic.md bullet from [Anthropic-Claude-API](Anthropic-Claude-API.md), and the Elastic row and node in [README](../README.md).
- In [Insurance](../6-features/Insurance.md), remove its "Elastic.md:" part (similar past claims, the `claim_verify` job, the `claim_precedent` table, `submit_claim_checks`, the 30 past claims seed, the claims evidence dashboard and the Elastic.md rows in its tables), and the claim precedent rows in [Architecture](../1-overview/Architecture.md), [SpacetimeDB](../2-data/SpacetimeDB.md), [Rust-Backend](../3-services/Rust-Backend.md) and [Decisions](../1-overview/Decisions.md). Claims then decide with no validation check and no precedents in the review.
- The `indexer` role can be dropped from the seed, and the Social views lose their `indexer` and `api` readers; `booth.plan_x_m`, `booth.plan_y_m`, `zone.plan_x_m`, `zone.plan_y_m` and the `venue` origin fields stay, because the organizer portal's venue map uses them.
- Delete the Elastic Serverless project; no data is lost, because Elastic only held a copy and working data.

## Decisions

| Decision | Why |
|---|---|
| The Elastic Workflow `bandit-organize` is the only organize path | Elastic Workflows are generally available on Serverless; the join steps, the schema-checked `ai.agent` steps and the execution record in Elastic Kibana are what judges see at the event |
| A failed run loads nothing, and there is no second organize path | The event never waits on a live organize run, and every loaded bundle went through the same joins and the same agent |
| The exact joins happen once, in the workflow's `LOOKUP JOIN` steps, and the agent gets their rows | One owner per step; the model judges only what the joins left open |
| The agent has two fixed Elastic ES\|QL tools and no web tool | Fixed queries keep the run filter and the limits out of the model's hands, and Bright Data owns every step that touches the web |
| Elastic Agent Builder uses the project's Elastic Managed LLM; BandIt's Anthropic Claude API key is not wired into Elastic | It works the moment the project exists, needs no second key, and keeps every BandIt call to the Anthropic Claude API in `claude-client` and `model_call`. Elastic agents organize and validate; judgments go to the Anthropic Claude API |
| Every text field uses `.jina-embeddings-v5-text-small`, named on the field | Scores from different models cannot be mixed, and the Serverless default can change |
| `bandit-indexer` rebuilds every document and writes the difference, at most once a second | No per-row bookkeeping, and a restart or a lost write repairs itself at the next flush |
| The people graph's links live in SpacetimeDB; Elastic draws nothing on the graph, and nothing about the graph flows back | Links are exact, private facts that change live |
| Insurance.md: a de-identified copy of each claim goes to `bandit-claims`; a check and precedents come back only through `submit_claim_checks`, and decision code never reads the precedents | Ranking similar past claims by meaning is what Elastic does best; money, routes and live state stay in SpacetimeDB, and the precedents reach the decision only as context for the Anthropic Claude API's review |
| Insurance.md: `bandit-claims-validate` is the index's default pipeline; it never rejects a document, it marks it valid or invalid, and an invalid copy routes the claim to the organizer | Elastic checks data and never decides money; a person looks at anything it flags |
| Insurance.md: precedents are decided claims from earlier events; live claims from the last 24 h are skipped | A precedent shows how a claim like this was decided, never what happened to someone else tonight |
| Elastic Kibana Graph is not used, and no Elastic Kibana view draws a network | Elastic Kibana Graph is unavailable on Elastic Cloud Serverless, and it discovers links from co-occurring terms, while the links are already rows in SpacetimeDB, drawn live on the big screen's event graph ([Social](../6-features/Social.md)) |
| SpacetimeDB decides who and what is on the recap list; Elastic only orders it, through `GET /api/recap` | The list is exact and private and comes from what the bands measured; meaning is the one thing only Elastic's embeddings add, and a stranger can never appear |
| `bandit-people` builds `interests` from the attendee's top 5 spots by visit minutes, a booth or a whole zone, listed in zone and booth order | Where someone spent time says what they are into, the booth texts are already clean after the import, and a stable order means a document is rewritten only when the spots change |
