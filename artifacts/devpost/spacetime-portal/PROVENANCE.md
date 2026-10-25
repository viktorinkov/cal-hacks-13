# SpacetimeDB portal evidence

Captured on 25 October 2026, approximately 12:23–12:27 UTC, from the signed-in SpacetimeDB Maincloud portal. These are native browser viewport screenshots, 1728 × 907 pixels. They have not been cropped, composited, relabeled or pixel-edited.

Source: https://spacetimedb.com/@viktorinkov/bandit-calhacks13-sp82j/tables

The portal uses one Tables URL for the selected tables and views. The browser was signed in through the existing GitHub account. Only table navigation, read-only filters and presentation controls were used. No reducer was run, no row was edited, and no job, incident or demo was started for these captures. The temporary helper tab did not replace the user's existing tabs.

## Recommended captures

### Maincloud band state

File: `maincloud-band-state.jpg`

The selected `band` table shows actual stored band IDs, state, neighboring-band counts, zones, battery, signal and SOS/fall flags. The sidebar also shows the separate `my_band` and `incident_bands` views. The table reported 1,010 stored rows at capture; this is not a count of physical bands or concurrent connected users.

Suggested placement: after the SpacetimeDB live-updates diagram, before the subscription diagram. This gives the diagram an actual database counterpart.

Suggested title: **Band state in Maincloud (number assigned by the document editor)**

Suggested general explanation:

> The band table keeps each device's latest report: its zone, nearby-band count, signal, battery and emergency flags. The organizer's map and safety rules use this shared event state. Each accepted update can also change the records followed by subscribed clients.

This is a public table, not proof that all floor telemetry is private. Caller-filtered views and public floor subscriptions are separate mechanisms.

### Maincloud worker jobs

File: `maincloud-worker-jobs.jpg`

The selected `job` table has the native read-only filter `id > 1400`. The viewport shows real `photo_features` records in queued, leased and done states, plus the `open` flag. The sidebar shows the separate `worker_jobs` view. Records changed from leased to done while the page's live-update control was enabled. This observation is not a concurrency or latency benchmark.

Suggested placement: immediately after the Jobs diagram and its lease explanation, as actual implementation evidence.

Suggested title: **Worker progress in Maincloud (number assigned by the document editor)**

Suggested general explanation:

> Background work stays visible in the same database as the event. Jobs move from queued to leased to done as workers claim them and return checked results. Stored attempts, errors and lease ownership let the server handle retries and reject results from a worker whose lease has expired.

The visible queue is a snapshot of existing work. It does not prove exactly-once external API side effects, a minimum queue depth, or a measured throughput improvement.

## Alternate capture

File: `maincloud-worker-view.jpg`

The selected `worker_jobs` view shows the caller identity and open jobs at capture. The count changes as existing workers complete jobs. The view filters to all open jobs for an authorized worker or owner. It does **not** restrict that worker to only its own leased jobs; the result reducers enforce lease ownership separately. The visible identity is a database identifier, not an authentication token.

Use this instead of the job-table image if the document needs stronger visual evidence of the view mechanism. Do not add both merely to repeat the same table. This capture does not establish another identity's denial behavior.

## Sponsor criteria and implementation

The saved official Hive prize card asks for a core realtime backend, shared state across users and agents, subscriptions, transactional updates, and server logic beside the data. Source: https://hive.hackberkeley.org/prizes. The exact previously verified text and provenance are in `handoff/research/sponsors/sponsor-tracks.md`, SpacetimeDB section. The separate Scrabblebot contest is not this project's track.

| Criterion | Concrete evidence | Limit |
| --- | --- | --- |
| Shared event state | Maincloud `band` table; live-updates diagram; incident reducers | A screenshot is a state snapshot, not a network timing measurement. |
| Agent coordination | Actual queued, leased and completed `job` rows; `worker_jobs` view | Do not claim a load test or exactly-once provider calls. |
| Transactional server logic | `claim_job` records lease owner/expiry; result reducers check the current lease before applying results | Rust implementation establishes the rule; the table screenshot shows its stored state. |
| Relevant subscriptions | Worker program subscribes to `worker_jobs`; attendee, medic, staff and service queries are inventoried in `diagrams/views.md` | Some broad public/staff subscriptions remain. Do not claim every device receives the mathematical minimum. |

Code checked in the local checkout at `340d9b4ce19d8c2aa70988e3ed0341e97f4400db` and compared with fetched `origin/vik-e2e` at `e8d0cfb3ba72357b8e21f39ee5f81a09a8c5a3d3`. The relevant lease and view bodies were unchanged; the fetched worker entry point includes the approved Elastic migration. Sources: `spacetimedb/server/src/jobs/mod.rs`, `spacetimedb/server/src/social/views.rs`, `crates/bandit-workers/src/main.rs`, and the full audited `diagrams/views.md` inventory.

The portal's overview/function metrics included missing-data panels. They were not selected for publication and are not evidence of zero use, measured uptime, or performance.

## Integrity

SHA-256:

```text
4e7e402920b576ac8f26e439560276c80ac5cfa8793908dd8f19bdefb36feb08  maincloud-band-state.jpg
eb173355bad9fb86162898cfe1163286d1b7a7ab8ceebbd49226725a55e738e9  maincloud-worker-jobs.jpg
eb80403111358cde47ce9bcc197f527ea9fd2f31c3fa558969d502353d98a8bb  maincloud-worker-view.jpg
```

Independent visual review passed with `/root/spacetime_portal_evidence/visual_review`. The reviewer selected band state and worker jobs as complementary evidence, with the worker view kept as an alternate. The fine table text needs a full-width image or access to the original image at native size. No credential or token is visible. The document editor owns numbering and final placement. No screenshot belongs inside an Excalidraw frame.
