# Social

The social layer turns zone-level presence into memories: where an attendee spent time, who they hung out with, which photos they are in, a live people graph of who met whom and who visited which booth, and the social part of the recap page, which they can share. It is built only from what the bands already report (band, zone, time), so it needs no new hardware. Each attendee types their own Meta socials (Instagram, Facebook, Threads) at onboarding. After the event, the recap lists the people they hung out with and shows those people's socials when they allow it with `findable`. Everything here is optional: delete it and the safety features are untouched.

## Role in the system

Responsibilities:

- Derive `visit` rows from `presence_sample` in the social step of `memory_tick`, and write `social_encounter` rows there once two `findable` owners have been together for 3 minutes. The encounter rule is Leo's (TBD -- LEO).
- Write `shared_visit` rows in the same step when two `findable` attendees' visits to one zone overlap for at least 300 s (`SHARED_VISIT_MIN_SECONDS`, starting value), for the recap.
- Hold the people graph: derive `people_link` rows in the same step and serve them through `my_graph` and `event_graph`.
- Own the socials step of onboarding: the attendee types their handles into `social_handle`.
- BrightData.md: place the profile claim ("Is this you", one tap by an attendee who already owns a band) in the same onboarding flow. The `person` rows, `claim_person` and `person_claim` belong to [BrightData](../7-integrations/BrightData.md).
- Hold `social_handle` and show it only to people who share an encounter or a shared visit with its owner, while the owner has `findable` on.
- Register photographer photos, suggest `photo_tag` rows from presence and consent, and let attendees confirm or remove them.
- Provide the social part of the recap page as views keyed on the caller, and `share_link` tokens.
- Give `bandit-indexer` and `bandit-api` the views `social_attendees`, `social_visits` and `social_encounters`, which return findable attendees only, and give the service roles `social_shared_visits`.
- Give meaning to the consent switch `findable`, set through `set_consent`.

Non-responsibilities:

- It does not write `presence_sample`, `band_report` or any band state; it only reads them ([SpacetimeDB](../2-data/SpacetimeDB.md), [Safety](Safety.md)).
- It does not analyse images. People counts and captions come from Vision (TBD -- LEO) through `submit_photo_features` ([Vision](../4-devices/Vision.md)).
- It does not scrape people. Nobody's social profile is scraped; a handle comes only from its owner.
- Elastic.md: it does not rank by meaning. The order of the recap's people and booths comes from Elastic's `GET /recap/order` over a one-way copy of this file's findable rows ([Elastic](../7-integrations/Elastic.md)); the lists themselves come from this file's views.
- It does not make merch; it supplies the visits and confirmed photos that [Merch](Merch.md) builds its suggestions from.

## Interfaces

| Direction | Who | What flows | Transport |
|---|---|---|---|
| In | `memory_tick` (core, every 5 s) | Calls the social step after writing `presence_sample`; the step reads `presence_sample`, `band`, `attendee`, `consent`, `booth` and writes `visit`, `social_encounter`, `shared_visit`, `people_link` | In-module call (one line to remove) |
| In | BrightData.md: imported rows | `organization`, the booth's organisation and a claimed `person` row's organisation, read by the social step for `exhibits` and `works_at` links | Module tables |
| In | Simulator.md: the crowd | One simulated `attendee` per crowd band, written by `start_crowd`: a made-up display name, one Instagram handle in `social_handle`, `findable` on; marked by the band's `simulated` flag. `crowd_tick` writes the crowd's `presence_sample` rows | Module tables |
| In | Attendee app | `set_social_handle`, `remove_social_handle`, `respond_photo_tag`, `create_share_link`, `revoke_share_link` | SpacetimeDB TypeScript SDK |
| In | BrightData.md: profile claim | `person` rows (name, role, organisation, headshot) and the `claimed_people` view; `claim_person`, called by the signed-in app, copies a claimed profile onto the attendee and is defined in [BrightData](../7-integrations/BrightData.md) | Module tables |
| In | Photographer route of the attendee app (role `photographer`) | Photo bytes to `bandit-api` through `POST /api/blobs` with purpose `photo`, then `register_photo` with the returned URL `/blobs/<sha256>`, the capture time, the zone and an optional caption; `hide_photo` | HTTPS upload, then SDK |
| In | `bandit-api` (role `api`) | `register_blob` for the uploaded photo, stored under its SHA-256 (access class `shared`) | SDK |
| In | Vision.md (TBD -- LEO): `bandit-vision` | `submit_photo_features` for a `photo_features` job: people count and caption | SDK (role `vision`) |
| Out | Attendee app | Views keyed on the caller: `my_visits`, `my_encounters`, `my_shared_visits`, `my_graph`, `my_photos`, `my_share_links` | Subscription |
| Out | Ops dashboard big screen | View `event_graph`: the anonymous whole-event graph | Subscription |
| Out | `bandit-api` | `share_link` rows and the rows a link selects, for the public share page; Elastic.md: `social_encounters` and `social_visits`, the recap candidates for `GET /recap/order` | Subscription (role `api`) |
| Out | Elastic.md: `bandit-indexer` | the views `social_attendees`, `social_visits` and `social_encounters`, findable attendees only, into `bandit-memories` and `bandit-people`; never `social_handle` or photos | Subscription (role `indexer`) |
| Out | `job` table | Vision.md: job `photo_features` with the photo id, from `register_photo` | `enqueue_job` |
| Out | [Merch](Merch.md) | `visit`, `photo` and confirmed `photo_tag` rows for the merch suggestions | Module tables |

## Design

### From presence to visits and encounters

Presence is the only input: every 5 s `memory_tick` writes one `presence_sample` (band, zone, time) per live band. The social step runs right after, inside the same scheduled reducer, and considers only bands that have an owner, so unclaimed bands create no memories. Simulator.md: every crowd band has a simulated owner, and `crowd_tick` writes the crowd's `presence_sample` rows, so the simulated crowd creates visits, encounters, shared visits and graph links through this same step, and the big screen shows a real-looking crowd.

The question this diagram answers: what each memory row is derived from.

```mermaid
flowchart TD
    BR["band_report, latest per band"] -->|"memory_tick every 5 s"| PS[("presence_sample")]
    PS -->|"owned bands only"| ST["social step of memory_tick"]
    ST -->|"same zone 2 min or more"| V[("visit, names the zone's booth")]
    ST -->|"both findable, together 3 min (TBD -- LEO)"| E[("social_encounter")]
    V -->|"two findable visits to one zone overlap 300 s"| SV[("shared_visit")]
    V --> SUM["recap views keyed on the caller"]
    SV --> SUM
    V -->|"visited"| PL[("people_link")]
    E -->|"met"| PL
    E --> SUM
    classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
    class BR,PS,ST,V,E,SV,PL,SUM stdb
```

**Visits.** A visit is one attendee staying in one zone. The step keeps, per band, its current zone and how long it has been there, and a zone change counts only once 2 consecutive samples agree. A visit opens when the band has been in the zone for 2 minutes (starting value, calibrate at the venue) and closes when the band has been out of that zone for 2 minutes (starting value, calibrate at the venue), so a short walk past the boundary does not split it. In the venue layout each booth zone holds one booth, so a visit records that booth; a zone with no booth (the pit, an entrance) leaves `booth_id` empty. Why 2 minutes: the band's zone is "loudest station in the last 3 s", which flaps at boundaries, and 2 minutes of persistence filters that without hiding a real stop.

| `visit` field | Meaning |
|---|---|
| `id` | Assigned by SpacetimeDB |
| `attendee_id`, `band_id` | Whose visit, through which band |
| `zone_id`, `booth_id` | Where; `booth_id` is the zone's booth, empty for a zone without one |
| `started_at`, `ended_at` | Open visits have no end yet |
| `samples` | Number of 5 s ticks the band spent in the zone, for the minutes shown in the recap |
| `status` | `open`, `closed` |

**Encounters.** An encounter is two attendees who hung out. It exists once two bands' owners both have `findable` on and have been in the same zone together for 3 minutes (starting value, calibrate at the venue). The rule lives in the social step of `memory_tick`, and Leo will replace it with his own (TBD -- LEO). The social step writes a `social_encounter` row with the two attendees, the zone, the start, the end and the minutes together, and grows `minutes` while they stay together. The `met` link in the people graph is written in the same transaction. Everything else here reads only those rows, so a new rule changes nothing else.

| `social_encounter` field | Meaning |
|---|---|
| `id` | Assigned by SpacetimeDB |
| `attendee_a`, `attendee_b` | The pair, lower id first |
| `zone_id` | Where it started |
| `started_at`, `ended_at` | Open encounters have no end yet |
| `minutes` | Minutes together so far |
| `rule` | Which encounter rule produced the row (TBD -- LEO) |
| `status` | `open`, `closed` |

What an encounter shows each side: "Sam, 40 minutes together in Zone B around 21:10", with Sam's socials. Both sides see each other at the same moment, because the encounter exists only when both are `findable`.

**Shared visits.** A shared visit is two attendees who were in the same place for a while: people you were near at a booth, whether or not you met. When the social step opens or grows a visit of a `findable` attendee, it compares it with the other `findable` attendees' visits to the same zone. Where two visits overlap for at least 300 s (`SHARED_VISIT_MIN_SECONDS`, starting value, calibrate at the venue), it writes one `shared_visit` row for that pair of visits and grows `overlap_minutes` while both stay. A shared visit is not a `people_link` kind and adds nothing to the graph: it is two people measured in the same zone at the same time, shown in the recap next to the encounters.

| `shared_visit` field | Meaning |
|---|---|
| `id` | Assigned by SpacetimeDB |
| `attendee_a`, `attendee_b` | The pair, lower id first |
| `zone_id` | Where |
| `visit_a`, `visit_b` | The two overlapping visits, one per attendee |
| `started_at` | When the overlap began |
| `overlap_minutes` | Minutes both have been there together so far |
| `updated_at` | Last change |

What a shared visit shows each side: "You and Maya were both at the Elastic booth for 25 minutes from 21:40", with Maya's card while she is `findable`.

### People graph

The graph is the night as people, booths and companies, with the links the bands actually measured. It is derived data: the social step writes `people_link` rows in the same transaction that opens or grows a visit or an encounter, so a new link reaches every screen through its subscription at once. Only `findable` attendees get links; turning `findable` off deletes theirs.

The question this diagram answers: which kinds of nodes and links the graph holds.

```mermaid
flowchart LR
    A1(["attendee"]) ---|"met: minutes"| A2(["attendee"])
    A1 -->|"visited: minutes"| B[("booth")]
    A2 -->|"visited: minutes"| B
    B -->|"exhibits"| O[("organization")]
    A2 -->|"works_at"| O
    classDef web fill:#E3F2FD,stroke:#1565C0,color:#1A1A1A
    classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
    class A1,A2 web
    class B,O stdb
```

| `people_link.kind` | From, to | Written when | Weight |
|---|---|---|---|
| `met` | attendee, attendee | an encounter opens (3 minutes together; starting value, calibrate at the venue) | the encounter's minutes |
| `visited` | attendee, booth | a visit at a booth opens (2 minutes; starting value, calibrate at the venue) | minutes over all of the attendee's visits to that booth |
| `works_at` | attendee, organization | BrightData.md: the attendee claims a `person` profile whose imported row names an organisation | none |
| `exhibits` | booth, organization | BrightData.md: the imported booth names its organisation | none |

| `people_link` field | Meaning |
|---|---|
| `id` | Assigned by SpacetimeDB |
| `kind` | `met`, `visited`, `works_at`, `exhibits` |
| `from_kind`, `from_id` | `attendee` or `booth`, and its id |
| `to_kind`, `to_id` | `attendee`, `booth` or `organization`, and its id |
| `minutes` | Weight for `met` and `visited`; empty for the others |
| `updated_at` | Last change |

There is one row per pair of nodes and kind, updated as minutes grow. Two people at the same booth, or at the same company, are never stored as a pair: both link to the shared booth or organisation node, and that shared node is what pulls them into one cluster when the graph is drawn.

Two views read the table:

| View | Who | Rows |
|---|---|---|
| `my_graph` | each attendee, keyed on the caller | the caller's own links, plus the other `findable` attendees linked to the same booths and organisations; people the caller met appear by display name, everyone else as "someone" |
| `event_graph` | the Ops dashboard's big screen; an anonymous view, the same for every subscriber | every link as node ids, kinds and minutes only: no names, zones or timestamps |

The attendee app and the Ops dashboard draw both views in the browser ([Attendee-App](../5-apps/Attendee-App.md), [Ops-Dashboard](../5-apps/Ops-Dashboard.md)). Nothing on the graph comes from Elastic, and there are no links between people who never met. Shared visits stay off the graph; they appear only in the two attendees' recaps.

### Onboarding: profile and socials

The socials step comes right after tap to join in the attendee app ([Attendee-App](../5-apps/Attendee-App.md)). There is no sign-in with a social provider and no verification.

**BrightData.md: the profile claim.** When the app asks for a display name, it shows the unclaimed `person` profiles (exhibitors, speakers, sponsors and artists, built from the event's own pages) whose name matches what the attendee typed: the "Is this you" step. The attendee taps theirs, and the signed-in app calls `claim_person`, which accepts the claim only from an attendee who already owns a band; `claim_person`, `person_claim` and `claimed_people` are defined in [BrightData](../7-integrations/BrightData.md). A claimed profile gives the attendee its name as their display name when they have none, its headshot as their photo and, when the profile names an organisation, a `works_at` link in the people graph. Attendees without a profile skip the step.

**Socials.** The app then asks for the attendee's Meta handles, with or without a claimed profile: Instagram, Facebook and Threads, no other networks. Each one is a `social_handle` row written by `set_social_handle` with the platform and the handle exactly as typed. The owner changes or removes them later from the same screen. Onboarding has no company field: `works_at` comes only from the import and a claimed profile.

| `social_handle` field | Meaning |
|---|---|
| `id` | Assigned by SpacetimeDB |
| `attendee_id` | Owner |
| `platform` | `instagram`, `facebook`, `threads` |
| `value` | The handle, as typed |
| `linked_at` | When it was set |

**Who sees a handle.** A handle is never shown on a profile, a booth page or a share page. The views `my_encounters` and `my_shared_visits` join the counterpart's `social_handle` rows only while the counterpart has `findable` on; that join condition is the whole rule. Turning `findable` off removes the person's name and handles from every counterpart's list at once and closes their open encounters. Reducers: `set_social_handle` and `remove_social_handle`, owner only.

### Photos and tagging

The photographer route is part of the attendee app, gated by the `photographer` role like the medic route. It uploads a photo to `bandit-api` through `POST /api/blobs` with purpose `photo`. `bandit-api` stores the bytes in the blob store under their SHA-256, calls `register_blob` with access class `shared` and returns the URL `/blobs/<sha256>`, which `GET /blobs/{hash}` serves ([Rust-Backend](../3-services/Rust-Backend.md)). The route then calls `register_photo` with that URL, the capture time, the zone and an optional caption. The photographer picks the zone the photo was taken in from the venue's zones.

The question this diagram answers: how a photo becomes suggested tags that attendees confirm, and where Vision joins in.

```mermaid
sequenceDiagram
    participant PH as photographer route
    participant API as bandit-api
    participant M as band1t module
    participant V as bandit-vision (TBD -- LEO)
    participant AT as attendee app
    PH->>API: POST /api/blobs, purpose photo
    API->>API: store bytes under their SHA-256
    API->>M: register_blob, access class shared
    API-->>PH: URL /blobs/ plus the SHA-256
    PH->>M: register_photo, url, taken_at, zone, caption
    M->>M: bands in that zone at taken_at
    M->>M: suggested photo_tag rows, ranked, cap 8
    M-->>V: photo_features job
    V->>M: submit_photo_features, people count
    M->>M: re-cap to the people count
    M-->>AT: my_photos shows the suggestion
    AT->>M: respond_photo_tag, confirm or remove
```

Candidate rule: photo tags are suggested from the bands in the photo's zone at the moment it was taken. An attendee is a candidate when they have `findable` on and their band's `presence_sample` nearest `taken_at` puts it in the photo's zone. Candidates are ranked by how long their band had been in that zone when the photo was taken, so someone who was there for a while ranks above someone passing through. The list is capped at 8 (starting value) until Vision reports a people count, then at that count. Each candidate gets a `photo_tag` with status `suggested`, visible only to that candidate, who confirms or removes it with `respond_photo_tag`. Only confirmed tags appear to anyone else or count for merch. Photos never go to Elastic. Identity always comes from the band, never from a face.

Vision.md (TBD -- LEO): `register_photo` enqueues a `photo_features` job, and `bandit-vision` answers with `submit_photo_features`. The module uses the people count to re-cap the suggestions and the caption when the photographer gave none. How Vision computes its output is Leo's.

| `photo` field | Meaning |
|---|---|
| `id` | Assigned by SpacetimeDB |
| `photographer_attendee_id` | Who uploaded (role `photographer`) |
| `url` | `/blobs/<sha256>`: where the bytes are served from, access class `shared` |
| `taken_at` | Capture time from the file, else upload time |
| `zone_id` | The zone the photographer picked, where the photo was taken |
| `caption` | From the photographer, or from Vision (TBD -- LEO) |
| `people_count` | From Vision (TBD -- LEO), empty until then |
| `status` | `uploaded`, `tagged`, `hidden` |

| `photo_tag` field | Meaning |
|---|---|
| `id` | Assigned by SpacetimeDB |
| `photo_id`, `attendee_id` | Which photo, who |
| `rank` | Position in the candidate list |
| `status` | `suggested`, `confirmed`, `removed` |
| `updated_at` | Last change |

**Tap to share.** In the recap, each photo shows the people in it, by display name for people the attendee hung out with and as "someone" otherwise, the same way `my_photos` names them. A Share button under the photo opens the phone's own share sheet with the photo file, so the attendee posts it wherever they like. BandIt has no Instagram or Meta login and never tags anyone on a social network.

### The recap's social part

After the event these views are the social part of the recap page ([Attendee-App](../5-apps/Attendee-App.md)). When a staff member with `ops` runs `end_event`, the recap appears live on every open page; later the attendee reopens it from their tap link `/t/{token}`, signed in with SpacetimeAuth, on any device. During the event the same views show in the app. The social part is not one table: it is a set of views keyed on the caller's identity, so every attendee sees only their own rows and the module, not the app, enforces that.

| View | Rows |
|---|---|
| `my_visits` | The caller's `visit` rows joined with `zone` and `booth` names and the booth text, with minutes, plus the most visited booths |
| `my_encounters` | The people the caller hung out with: each `social_encounter` with the counterpart's display name, zone, time, minutes and `social_handle` rows, while the counterpart is `findable` |
| `my_shared_visits` | The people the caller was in the same place with: each `shared_visit` with the zone, the zone's booths, the start, the overlap minutes and the other person's card (display name and `social_handle` rows), while that person is `findable` |
| `my_photos` | Photos where the caller has a `suggested` or `confirmed` tag, with the other confirmed people by display name when the caller has an encounter with them, otherwise as "someone" |
| `my_share_links` | The caller's links and what each exposes |

The timeline is `my_visits` in time order with the gaps filled from `presence_sample` at zone level, computed in the app. The people and booths go by minutes together, and the shared visits go in time order. Elastic.md: the recap orders them with `GET /recap/order`, closest to what the attendee was into first; the views never depend on Elastic.

Three service views give the findable rows to `bandit-indexer` and `bandit-api` (roles `indexer` and `api`). A person who turns `findable` off drops out of all three at once.

| View | Rows |
|---|---|
| `social_attendees` | findable attendees: id and display name |
| `social_visits` | visits of findable attendees, with booth, zone, times and minutes |
| `social_encounters` | encounters whose two attendees are both findable, with zone, times and minutes |

`social_shared_visits` gives the shared visits, which are built only between findable attendees, to the service roles `indexer`, `worker` and `api`.


### Share links

A `share_link` is a token the attendee mints for one selection of their recap: their spacetime history, most visited booths and photos. `create_share_link` takes the selection (timeline yes or no, top zones, visits, people, a list of confirmed photo ids) and stores only a hash of a random token; the app shows the token once in the URL. `bandit-api` serves the page: it finds the link by token hash in its subscription, reads only the selected rows and renders a static page. People appear only as the owner's own recap names them (display name for people the owner hung out with, otherwise "someone") and never with handles, because the page is public to anyone with the link; photos appear only if confirmed and selected. `revoke_share_link` ends the page at once. Links expire 30 days after the event (starting value).

| `share_link` field | Meaning |
|---|---|
| `id` | Assigned by SpacetimeDB |
| `attendee_id` | Owner |
| `token_hash` | SHA-256 of the token in the URL; the token itself is never stored |
| `includes_timeline`, `includes_zones`, `includes_visits`, `includes_people` | The selection |
| `photo_ids` | Confirmed photos selected |
| `created_at`, `expires_at`, `revoked` | Lifetime |

### The consent switch

| Switch (`consent`, set by `set_consent`) | Effect here |
|---|---|
| `findable` | On: encounters, shared visits and graph links with this person are created, they can be suggested as a tag in photos, and the people they hung out with see their display name and socials. Off: no encounters, no shared visits and no tag suggestions, their graph links are deleted, and their name and handles leave every list; they can still be a photographer |

## Failure modes and fallbacks

| Failure | Effect | Design answer |
|---|---|---|
| Zone flaps between two stations at a boundary | Visits would split | A zone counts after 2 consecutive samples agree; visits open and close on 2 minute thresholds (starting values) |
| Many people in one zone | Strangers show up as people you hung out with | Only `findable` people appear; an encounter and its `met` link need 3 minutes together in one zone; `my_encounters` sorts by minutes |
| Attendee has no handles | An encounter shows a name with nothing to follow | `my_encounters` shows the display name and "no socials shared" |

## Dependencies

**Depends on**

- [SpacetimeDB](../2-data/SpacetimeDB.md): `presence_sample`, `band`, `attendee`, `consent`, `booth`, `zone`, `blob_ref`, `register_blob`, `job`, `enqueue_job`, `api_session`; the social step hook in `memory_tick`.
- [Attendee-App](../5-apps/Attendee-App.md): the socials step, the recap, graph and consent screens, the photographer route.
- [Ops-Dashboard](../5-apps/Ops-Dashboard.md): the big screen that draws `event_graph`.
- [Rust-Backend](../3-services/Rust-Backend.md): `bandit-api` for photo upload and the share page.
- [Hardware](../4-devices/Hardware.md): zone-level presence (band, zone, time) as the firmware reports it today.
- BrightData.md: `person` rows and the profile claim; `organization` and the booth's organisation for `works_at` and `exhibits` links. Without it, attendees type a display name and their socials, and the graph has no company nodes.
- Simulator.md: the crowd's simulated attendees from `start_crowd`, and `crowd_tick`. Without it, the graph holds real attendees only.
- Vision.md (TBD -- LEO): people count and captions. Without it, tags use presence only with the default cap of 8.
- This file does not depend on [Elastic](../7-integrations/Elastic.md); Elastic copies its findable rows to order the recap's suggestions.

**Used by**

- [Merch](Merch.md): visits, photos and confirmed tags for the merch suggestions. Merch needs this file.
- [Elastic](../7-integrations/Elastic.md): `bandit-memories` and `bandit-people` are copies of this file's findable rows, read through its `social_*` views, and `GET /recap/order` orders its recap lists.
- [Attendee-App](../5-apps/Attendee-App.md): the onboarding socials step, the graph and the recap's social part.
- [Ops-Dashboard](../5-apps/Ops-Dashboard.md): the big-screen graph.
- [Simulator](../3-services/Simulator.md): its simulated attendees go through the social step.

**If you delete this file**

- Remove the social step bullet from `memory_tick` in [SpacetimeDB](../2-data/SpacetimeDB.md), the Social.md rows in its registry tables, the Social.md note on `display_name`, and the tables `visit`, `social_encounter`, `shared_visit`, `people_link`, `social_handle`, `photo`, `photo_tag`, `share_link`, and the views `my_shared_visits`, `my_graph`, `event_graph`, `social_attendees`, `social_visits`, `social_encounters` and `social_shared_visits`.
- Remove the Social.md row from the endpoint registry in [Rust-Backend](../3-services/Rust-Backend.md) (photo upload, share page) and the Social.md `photo` purpose of `POST /api/blobs`, the socials onboarding step, the graph screen, the photographer route and the recap's social part from [Attendee-App](../5-apps/Attendee-App.md), the `photographer` role row and the big-screen graph from [Ops-Dashboard](../5-apps/Ops-Dashboard.md), the crowd (`start_crowd`, `stop_crowd`, `crowd_tick` and its simulated attendees) from [Simulator](../3-services/Simulator.md), steps 5 and 6a in [Flows](../1-overview/Flows.md), the memories row in the data ownership table of [Architecture](../1-overview/Architecture.md), and the Social.md row from the README components table.
- Remove the `bandit-memories` and `bandit-people` indices and `GET /recap/order` from [Elastic](../7-integrations/Elastic.md), and the photo tagging consumer and `photo_features` job from [Vision](../4-devices/Vision.md).
- The profile claim stays with [BrightData](../7-integrations/BrightData.md); a claimed `person` row then has no handles attached.
- Delete [Merch](Merch.md) too: every suggestion starts from a visit and a confirmed photo defined here.
- `presence_sample` stays: it is core and feeds incidents.

## Decisions

| Decision | Why |
|---|---|
| The photographer route lives in the attendee app, gated by the `photographer` role like the medic route | One app on the one public host; the role check is in the module, as for every other route |
| In the venue layout each booth zone holds one booth, so a visit names one booth | Zones are the only resolution the bands give; one booth per zone makes the visit exact with no hand-placed hints |
| Socials are Meta only (Instagram, Facebook, Threads), typed by the attendee at onboarding; no provider sign-in and no `verified` state | Meta is the sponsor track; typing needs no provider approval, and a handle is shown only to people who hung out with its owner |
| Onboarding has no company field; `works_at` comes only from the import and a claimed profile | Every company link then comes from the event's own pages, and onboarding stays short |
| No Bandshake and no connection requests: an encounter between two `findable` attendees is the connection, and each sees the other's name and socials | The project description: find who you hung out with and their Insta, afterwards |
| A handle has no per-handle sharing mode; every handle goes to the owner's encounter and shared-visit counterparts while `findable` is on | One switch, one rule; the former `on_connect` mode was built on connection requests |
| The share page shows display names only, never handles | The page is public to anyone with the link; `findable` shares socials with the people you hung out with, not with the public |
| A photo is shared with one tap through the phone's share sheet; BandIt never logs in to a social network or tags anyone there | tags come from zone and time, not faces, so they name people in the recap but are not tags to post |
| The photographer picks the photo's zone from the venue's zones, and tags come from the bands in that zone at `taken_at` | The photographer knows where the shot was taken, and the zone list is the same one the bands report, so tagging stays exact |
| After the event the attendee reaches the social part of the recap page from their tap link `/t/{token}`, signed in with SpacetimeAuth, on any device | The band's own URL is the way back, and the sign-in proves it is them ([Attendee-App](../5-apps/Attendee-App.md)) |
| An encounter starts when two `findable` owners have been in one zone together for 3 minutes (starting value); the rule is Leo's to replace (TBD -- LEO), and the rest of the design reads only the encounter rows | What counts as two people having met is spatial and vision work, so the rule can change without touching the recap, the graph or merch |
| Photo tags come from presence and Vision's people count only | The design uses the band firmware as it is |
| The recap's social part is the attendee's own visits, people and photos; there is no written story | The project description asks for the night back, not a story; the views already give it |
| The people graph lives in SpacetimeDB as the derived table `people_link`, written by the social step; Elastic draws nothing on it | Every link is an exact fact the bands measured, it must reach every screen live, and `findable` must be enforced in the views; there are no links between people who never met |
| Elastic.md: the recap's people come from `my_encounters`, its booths from `my_visits` and its shared visits from `my_shared_visits`; Elastic only orders the people and booths | SpacetimeDB decides who and what is on the list; meaning only changes the order ([Elastic](../7-integrations/Elastic.md)) |
| `bandit-indexer` and `bandit-api` read the views `social_attendees`, `social_visits` and `social_encounters`, which return findable attendees only | `findable` is enforced once, in the module, before anything leaves it |
| A shared visit is two `findable` attendees' visits to one zone that overlap for at least 300 s (`SHARED_VISIT_MIN_SECONDS`, starting value); it is a recap row, not a `people_link` kind | People you were in the same place with for a while belong in the recap next to the people you met, while the graph keeps only measured meetings and visits |
| Shared booths and companies are shared nodes, never pairs of people | One link per person instead of one per pair, and the shared node is what forms the cluster |
| Links appear when a visit reaches 2 minutes or an encounter opens at 3 minutes (starting values, calibrate at the venue) | Each threshold is the one that opens the visit or the encounter, so the graph and the recap agree |
| `event_graph` is one anonymous view with node ids, kinds and minutes only | The big screen shows the shape of the crowd to everyone in the room without naming anyone |
| Simulator.md: crowd bands get simulated owners from `start_crowd`, with `findable` on, made-up names and Meta handles, going through the same social step | The big screen shows a real-looking crowd instead of at most 9 people; the band's `simulated` flag tells them apart |
