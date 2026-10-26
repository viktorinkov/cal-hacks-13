# Bright Data portal evidence

Three native captures show existing provider use. These belong in the technical Bright Data section, beside their relevant purpose diagrams. They do not belong inside Excalidraw. The article writer should assign image numbers.

## Recommended placement and draft captions

### Completed company-data collections

`company-scraper-completed-snapshots.jpg` — place beside **Prepare the event**. This is the strongest completion evidence: the provider shows ready batches and records returned.

Draft: **Bright Data’s structured scrapers return public company information in consistent fields. Band1t uses these records to enrich booths with company descriptions, industries and logos, while saved source snapshots keep the import traceable.**

### Public document requests

`web-unlocker-source-domains.jpg` — place beside **Find policy documents**. It shows activity across public event, venue and insurer websites.

Draft: **Web Unlocker retrieves public pages and document files selected during a lookup. Band1t then checks the PDF and its printed plan or form details before using it as evidence.**

### Venue pages opened through Browser API

`browser-api-venue-sources.jpg` — place beside **Capture a public venue map**. It shows prior browser activity on interactive map and model pages. Some domains are candidate or reference sites, so do not imply that all produced usable models.

Draft: **An interactive venue map needs a browser to run its page. Browser API supplies that environment, allowing the venue worker to recover a usable 3D scene or model asset for the event map.**

Each draft explains general behavior. Pair these with the existing diagrams; do not add a new paragraph reciting the screenshot’s counts. Current code ownership should remain aligned with the independently reviewed Bright Data flow work.

## Criteria checked

The official [Cal Hacks prize page](https://hive.hackberkeley.org/prizes) was re-read on 25 October 2026. Its Bright Data criteria remain consistent with the saved sponsor research: essential live public-web acquisition, a useful core experience for a clear user, real-site results, resilience to web failures, useful cleaned output and thoughtful tool selection. The work must respect site access boundaries and avoid private personal-data scraping. The exact visible text is saved in `criteria-source.txt`.

The combination is justified by the different output needed: [Web Unlocker](https://docs.brightdata.com/products/web-unlocker/introduction) retrieves page responses, [Scraper API](https://docs.brightdata.com/products/scrapers/overview) returns structured records, and [Browser API](https://docs.brightdata.com/products/scraping-browser/introduction) runs JavaScript-heavy pages. These are official provider capabilities; the screenshots establish actual project activity separately.

## Evidence limits

No new paid scrape, model export, portal configuration or provider test was run for these captures. The scraper table explicitly reports completed collections. The source-domain tables show activity, not success of every lookup or export. The dataset preview offered only download actions, so no invented result-view screenshot was created.

The saved repository LinkedIn snapshot contains 41 records with zero error records. Its date and dataset agree with one older portal batch. The wrapper lacks the provider snapshot ID, so do not claim a stronger linkage. Full provenance and image hashes are in `provenance.json`.

Independent visual review: **PASS**, 25 October 2026. All three captures are legible at full width, preserve native UI context and expose no visible API keys, passwords, tokens, personal email addresses or credential-bearing URLs. Keep them full-width or enlargeable. Source-domain activity and completed collection batches are distinct evidence; none establishes downstream feature success.

Current implementation reference: fetched `origin/vik-e2e` at `219d48e`. Relevant files are `crates/bandit-workers/src/event_import.rs`, `crates/bandit-ingest/src/fetch.rs`, `crates/bandit-ingest/src/organize.rs`, `crates/bandit-workers/src/plan.rs`, `crates/bandit-workers/src/venue_policy.rs`, `crates/bandit-workers/src/brightdata.rs`, `crates/bandit-workers/src/document.rs`, `crates/bandit-workers/src/venue.rs` and `pipeline/venue_model.py`. The plan check enforces printed insurer and plan; venue policy validation enforces form and edition. Do not claim strict year or venue-insurer matching.
