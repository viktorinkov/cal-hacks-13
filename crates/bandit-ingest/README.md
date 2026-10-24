# bandit-ingest

Scrapes an event (Cal Hacks 13.0 first) through Bright Data, organizes the records in Elastic, and loads the checked event bundle into SpacetimeDB in one `import_event` transaction.

| Stage | Command | Reads | Writes |
|---|---|---|---|
| fetch | `cargo run -- fetch --event calhacks-13` | `events/<slug>/sources.json` | `events/<slug>/snapshots/` (raw Bright Data results) |
| parse | `cargo run -- parse --event calhacks-13` | snapshots | `records/records.jsonl` |
| map | `cargo run -- map --event calhacks-13` | `zones.json`, `booths.json` | `records/plan.jsonl` |
| organize | `cargo run -- organize --event calhacks-13 --run-id <id>` | records | Elastic raw indices, the `bandit-organize` workflow, `bundles/<id>.organized.json` |
| assemble | `cargo run -- assemble --event calhacks-13 --run-id <id>` | records, organized decisions | `bundles/<id>.json` |
| load | `cargo run -- load --event calhacks-13 <bundle>` | bundle | SpacetimeDB `import_event` |
| verify | `cargo run -- verify --event calhacks-13 <bundle>` | bundle | row counts per table |

`cargo run -- run --event calhacks-13` does all of them with a fresh run id. `cargo run -- elastic-setup --event calhacks-13` creates the Elastic indices, the Agent Builder tools and agent, the Kibana workflow and the dashboards.

Credentials come from the repo `.env`. On the first load, the tool creates its own SpacetimeDB identity, saves its token under `.secrets/`, and prints the one `spacetime call ... grant_role` command the database owner runs to give it the `ingest` role.

Who owns what: Bright Data does every step that touches the web, Elastic organizes the records (exact joins with ES|QL `LOOKUP JOIN`, fuzzy matching by the `bandit-organizer` agent), Rust checks the result, and SpacetimeDB holds the loaded rows.

Every event has its own folder, `events/<slug>/`: `event.json` (name, website, timezone), `sources.json` (the pages and Bright Data datasets to fetch), `zones.json` and `booths.json`, plus its snapshots, records and bundles. Every command takes `--event <slug>`; Cal Hacks 13.0 is `events/calhacks-13`.

`zones.json` is the team's station plan: one zone per station marker (radio ids 101 to 105). Edit it at the venue; a booth is assigned to the zone whose centre is nearest to its spot in `booths.json`.
