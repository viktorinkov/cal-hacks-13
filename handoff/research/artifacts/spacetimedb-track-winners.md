# SpacetimeDB hackathon track winners

Saved from https://claude.ai/artifact/ADaeQh4kkpTCqRV4SdP8Cb, last updated 2026-10-24.

The page has 3 tabs: SpacetimeDB hackathon track winners, BandIt: SpacetimeDB, BandIt: Elastic. Each tab is one section below.

## Tab: SpacetimeDB hackathon track winners

Tab last updated 2026-10-24.

How this applies to our project: [BandIt: SpacetimeDB](#tab-bandit-spacetimedb-bandit-on-spacetimedb) for the live system and [BandIt: Elastic](#tab-bandit-elastic-bandit-on-elastic) for search and the agent.

### TL;DR

- Two recent hackathons had public SpacetimeDB tracks with Devpost results: **HopHacks Fall 2025** (Gaming Track: Best Use of SpacetimeDB) and **MHacks 2026** (Best Use of Spacetime, Oct 3–4, 2026). I found 6 confirmed track winners.
- Stated criteria are thin. HopHacks: "the most polished app using SpacetimeDB." MHacks: no track text, general criteria were innovation, technical complexity, usability, theme. Cal Hacks 13.0: Spacetime's blog promises "a special prize for the most impressive use of Spacetime"; Devpost lists no amount or criteria.
- Winning pattern: SpacetimeDB is **the entire backend** (no separate server), with server-authoritative logic in reducers, **scheduled reducers** running a world tick, subscriptions driving live UI across many clients, and a visibly multiplayer presentation.

### Confirmed track winners

| Hackathon | Project | What it is | How it used SpacetimeDB |
| --- | --- | --- | --- |
| MHacks 2026 | [Traycer](https://devpost.com/software/traycer-ai-food-waste-intelligence) | Cafeteria food-waste intelligence: camera tray scanning + virtual cafeteria + AI agents | Strongest example. "Backend powering every component." 2 modules, 25 tables. Vision service writes via reducers (one transaction recomputes grams/carbon/cost); tray JPEGs stored in a table; **scheduled reducer ticks the cafeteria model every 200 ms**; AI worker picks up job rows; agents query the same DB so answers match the dashboard. |
| MHacks 2026 | [CoClip](https://devpost.com/software/coclip) ([repo](https://github.com/anuragsk05/CoClip)) | Real-time collaborative video editor where humans and an AI agent edit one timeline (built on OpenCut) | Rust module holds timeline/media/project state; humans and the AI both edit through reducers; Maincloud hosting. Hard part they highlighted: syncing large media efficiently. |
| HopHacks F25 | [BeatBoxing](https://devpost.com/software/beatboxing) | Webcam boxing rhythm game (OpenCV hand tracking) with multiplayer rooms | Rust module for low-latency multiplayer room state. Also won **Best Overall Hack**. |
| HopHacks F25 | [HopQuest](https://devpost.com/software/hopquest-xaqf0y) | Campus NFC tag-hunt game with live map and admin dashboard | Rust reducers for game logic, tables for players/tags, every claim pushed live to players and admin; Maincloud. |
| HopHacks F25 | [Crack The Code](https://devpost.com/software/crack-the-code-ojk243) | Multiplayer game teaching prompt injection against LLMs, with spectators | Game state, real-time chat, persistent conversation history, live spectator counts. LLM calls in a separate Node service. |
| HopHacks F25 | [Geometry Core](https://devpost.com/software/geometry-core) | Bullet-hell horde defense game | C# module; page gives few details. |

Prizes: HopHacks $500/$300/$100 cash plus matching Maincloud credits (4 winners). MHacks $1,000/$500/$200. I could not confirm MHacks' 3rd-place winner from the public pages.

### Deep dives: how three winners use SpacetimeDB

Traycer and CoClip (MHacks) put their logic, auth and AI coordination inside the database. BeatBoxing (HopHacks, also Best Overall) used it as a thin synced lobby and won on polish. Counts are from each repo's module source, lifecycle reducers included.

| Project | Module | Tables | Reducers | Server tick | AI / non-human clients |
| --- | --- | --- | --- | --- | --- |
| Traycer | TypeScript, 2 modules | 25 | 21 + 3 views | 200 ms per sim run | Vision service, LLM worker, 2 voice agents |
| CoClip | Rust | 16 | 45 | none | Gemini agent, same reducers as humans |
| BeatBoxing | Rust | 2 | 11 | none | Python webcam tracker, through key presses |

#### Traycer (MHacks 2026, Best Use of Spacetime)

A cafeteria food-waste tracker: a phone camera scores leftover trays, a dashboard turns grams into carbon, water and cost, and virtual AI diners try out menu changes before anyone cooks. [Devpost](https://devpost.com/software/traycer-ai-food-waste-intelligence) · [repo](https://github.com/anton-3/traycer)

**Diagram: Traycer system design · 2 modules, 4 clients**

What it shows: Every Traycer subsystem reads and writes one SpacetimeDB.

Text in the diagram, in drawing order:

- Every Traycer subsystem reads and writes one SpacetimeDB
- Vision service (Python)
- Phone frames over WebSocket to
- YOLO-World, ByteTrack, OpenAI vision
- Sim worker (Node)
- Claims a diner decision job,
- asks OpenAI, submits the action
- SpacetimeDB on Maincloud, the only backend
- traycer-camera module, 10 tables
- upsert_observation is idempotent by rev:
- replaces the tray food rows and recomputes
- food and service totals in one transaction
- tray_snapshot holds JPEG bytes, immutable
- Photo writes gated by an identity table
- sim module, 15 tables
- tickWorld: scheduled reducer every 200 ms
- moves diners, queues, seats, counts waste
- Writes a decision job when a diner must choose
- Worker holds a lease with heartbeats; a missed
- deadline falls back to a rule-based choice
- upsert_observation
- claimDecision, submitDecision
- worker_jobs view (SQL poll, every 3 s)
- spacetime sql (subscribe)
- Waste dashboard
- Recomputes totals in the
- browser; Gemini summary
- Relay voice agents
- LeBron and Gordon read
- tray rows during calls
- 3D cafeteria
- React Three Fiber draws
- sim_student rows live

**How it uses SpacetimeDB**

- **One writer, idempotent.** The camera module is written by a single reducer, `upsert_observation`. It takes a full snapshot, ignores stale revisions, swaps the tray's food rows and recomputes `food_total` and `service_total` in the same transaction, so retries and replays can't double count.
- **Images in the database.** Tray photos are stored as byte arrays in `tray_snapshot`. The reducer checks the JPEG header, a SHA-256 digest and a 256 KB cap, and refuses to overwrite.
- **The cafeteria model runs inside the database.** The sim module imports the app's own `@traycer/sim-core` package. `tickWorld` is a scheduled reducer that advances the world every 200 ms and writes students, trays, conversations and waste events as rows the 3D view subscribes to.
- **LLM calls go through a job queue.** When a diner must decide, the tick writes a `sim_decision_job` row. A Node worker takes a 15-second lease (`registerWorker`, `heartbeatWorker`), claims the job, calls OpenAI and submits the action with a generation number. If it misses the deadline, the tick applies a rule-based fallback so the sim never stalls.
- **Auth in the schema.** A `sim_grant` identity table gates every write, and views (`worker_jobs`, `my_access`) only return rows to granted identities.

##### Decision loop: the sim never waits on an LLM

Each AI diner decision is a `sim_decision_job` row. Its status moves through the states below, and the scheduled tick cleans up anything late, so a slow or dead model call can't freeze the cafeteria.

**Diagram: Traycer decision job lifecycle · 5 states**

What it shows: Every AI decision is a row with a lease, a deadline and a fallback.

Text in the diagram, in drawing order:

- Every AI decision is a row with a lease, a deadline and a fallback
- tickWorld
- diner must decide
- pending
- worker can see it
- claimed
- 30 s deadline set
- applied
- world advances
- ready
- held while paused
- stale
- never applied
- insert
- claim_decision
- submit_decision
- deadline passed (30 s): rule-based fallback
- submitted while paused
- next tick applies
- re-queued
- diner replaced
- Between claim and submit, the Node worker calls OpenAI with only that diner's context and legal actions:
- 10 s timeout, up to 3 attempts, 1 repair of a malformed action, then the fallback.

1. The shared engine inside `tickWorld` reaches a decision point. `persist()` inserts a `pending` job with the diner's context, revision and list of legal actions.
2. The Node worker sees it through the private `worker_jobs` view (granted identities only) and dispatches every 100 ms, 8 jobs at a time by default.
3. `claim_decision` checks the worker's lease and epoch, sets `claimed`, bumps `generation` and sets a 30-second deadline.
4. The worker calls OpenAI (Responses API, with OpenRouter as backup) using only that diner's memory, nearby roster, menu and legal actions. Every attempt is logged with `record_attempt`: tokens, latency, model and request id.
5. `submit_decision` re-checks owner, epoch and generation, then the engine checks the action is still legal. A running sim applies it at once; a paused one parks it as `ready`.
6. A missed deadline gets a deterministic fallback on the next tick. A diner who left meanwhile turns the job `stale`.

The model can only return one of nine typed actions: `choose_food`, `eat`, `finish_meal`, `invite_nearby`, `respond_to_invitation`, `speak`, `pass_turn`, `leave_conversation`, `continue_journey`.

##### Data model: a private checkpoint plus public projections

The sim keeps the engine's full state as one JSON blob in a private `sim_checkpoint` row, and every tick re-derives small public tables that clients subscribe to. The camera module stores raw snapshots and keeps totals up to date on write.

| Module | Group | Tables | Visibility | Role |
| --- | --- | --- | --- | --- |
| sim | Control and auth | `sim_grant`, `sim_checkpoint`, `sim_run`, `sim_tick_schedule` | grant, checkpoint, schedule private; run public | Who may write; full engine state; run status, speed, worker lease; the 200 ms timer |
| sim | World projections | `sim_student`, `sim_inspection`, `sim_tray_item`, `sim_conversation`, `sim_invitation`, `sim_message` | public | Position and heading, persona and memory, each plate's served/eaten/left grams, chats |
| sim | Event history | `sim_waste_event`, `sim_activity_event`, `sim_visit_summary` | public | Append-only log, exported to NDJSON then pruned |
| sim | AI work queue | `sim_decision_job`, `sim_api_attempt` | private (read through views) | Job status, owner, generation, deadline; token and latency per call |
| camera | Ingest | `service`, `tray_observation`, `food_item` | public | Meal service; raw observation JSON with `rev`; one row per food on a tray |
| camera | Derived totals | `food_total`, `service_total`, `impact_factor` | public | Grams, kg CO2, litres, dollars per food and per service; seeded factors |
| camera | Images | `tray_snapshot`, `snapshot_writer`, `snapshot_writer_grant`, `snapshot_purge` | snapshot public, rest private | JPEG bytes; writer allow-list; purge tombstones |

Two shortcuts worth copying: optional fields use sentinels (`''`, `-1`, `0`) instead of option types so SQL rows stay flat, and fast-changing nested state (`stateJson`, `worldJson`, `metricsJson`) is stored as JSON strings rather than modelled as tables.

##### How the core behaviors work

**Camera writes can't double count.** The vision service resends the full current version of a tray every time anything about it changes (new capture, AI re-estimate, staff accept or reject), stamped with a revision number. SpacetimeDB ignores any version older than the one it has, throws away that tray's old food rows, writes the new ones and recalculates the per-food and per-service totals, all in one transaction. Retries, crash replays and AI rewrites never inflate the numbers.

**The database is the game loop.** Creating a sim run also creates a repeating timer, and SpacetimeDB fires the tick every 200 ms. Each tick loads the world, applies finished AI decisions, substitutes a fallback for any that timed out, advances time (capped at half a second so a hiccup doesn't cause a jump) and rewrites the public tables the 3D view renders. Only the database can trigger a tick. If the worker's lease has lapsed, the run pauses itself as "awaiting worker" rather than running on stale decisions.

**Late AI answers can't overwrite newer ones.** To submit a decision, a worker must still hold its lease, be the same process (epoch) that claimed the job, and quote the job's current generation number. A worker that crashed and came back is refused; an identical retry is accepted silently; a conflicting duplicate is an error.

**One rulebook everywhere.** The same sim package runs inside the database, in the browser's offline mode and in tests, so the rules exist in exactly one place.

##### Reliability, and what isn't wired up

The team engineered for a flaky judging floor: anything can drop and the system recovers. Their own [architecture doc](https://github.com/anton-3/traycer/blob/main/docs/spacetimedb-architecture-current.md) lists the details.

| Failure | What happens |
| --- | --- |
| Wi-Fi drops mid-service | Vision fsyncs each observation to a local journal first, retries reducer calls with 0.5 to 8 s backoff, and replays on restart. JPEGs go through a separate disk outbox. |
| Bad payload | The reducer throws `traycer:invalid`; the uploader quarantines that record and moves on. |
| Sim worker crashes | Lease is 15 s, renewed every 5 s. The tick marks the run `awaiting_worker`; a restarted worker reconnects with its cached token and resumes. |
| Event tables grow | Worker exports finished visits to NDJSON with a SHA-256 per record, then calls `acknowledge_archive`. Acknowledged visits older than 1 hour are pruned; at 1,000 unexported visits the run pauses as `storage_blocked`. |
| Browser refresh | The 3D view rehydrates from a fresh subscription and interpolates motion; the world keeps running server-side. |

What is not connected, per that same doc: the camera and sim databases share nothing, the waste dashboard polls SQL every 3 seconds and recomputes totals in the browser instead of subscribing to `food_total`, and the Gemini summary is cached in Python rather than written back. The Relay agents read both databases through the `spacetime sql` CLI.

**What stood out**

- Two SpacetimeDB modules feed four very different clients (vision pipeline, LLM worker, voice agents, 3D view), so the agents' answers always match the dashboard. That "single source of truth" is the core of their pitch.
- Production patterns in a hackathon build: idempotent writes, worker leases, deadline fallbacks, retention and pruning reducers, binary blobs.
- It stacked many sponsors (Relay, ElevenLabs, Gemini, OpenAI) without SpacetimeDB losing its central role.

#### CoClip (MHacks 2026, Best Use of Spacetime)

"Google Docs for video editing": a fork of the open-source OpenCut editor where several people and a Gemini agent edit one timeline live, with cursors, roles and chat. [Devpost](https://devpost.com/software/coclip) · [repo](https://github.com/anuragsk05/CoClip)

**Diagram: CoClip system design · 3 clients, 1 module**

What it shows: Humans and the Gemini agent edit through the same reducers.

Text in the diagram, in drawing order:

- Humans and the Gemini agent edit through the same reducers
- Editor A (OpenCut fork)
- Preview, render, export stay
- local; adapter maps UI edits
- to reducers, applies rows
- Editor B (shared link)
- Viewer or editor role from
- the invite; live cursor and
- playhead via presence
- Gemini agent
- Opens the same session;
- tools map 1:1 to reducers
- like move_clip, split_clip
- edit reducers
- subscribed rows
- SpacetimeDB module (Rust): 16 tables, 45 reducers
- Timeline state
- project, scene, track, clip,
- clip_effect, project_metadata
- Each edit bumps the project
- revision and logs history
- Shared media
- asset + asset_chunk rows:
- 256 KB slices, 512 MB max
- Clients rebuild playable
- files from the chunks
- Access and presence
- Roles and share links checked
- in every write reducer;
- presence keyed by connection;
- history tags human or agent

**How it uses SpacetimeDB**

- **The database is the project.** A Rust module with 16 tables and 45 reducers owns tracks, clips, effects, assets, presence, chat and edit history. The editor keeps preview, rendering and export local. A collaboration adapter turns each UI action into a reducer call and patches subscribed rows back into OpenCut's local state.
- **Every edit is a transaction with a revision.** Each write reducer opens an `Edit` that checks the caller's role, bumps `project.revision` and appends to `edit_history` with the actor, whether it was a human or the agent, and the connection. An error rolls all of it back, revision included.
- **Video travels through the database too.** Files are split into 256 KB `asset_chunk` rows, up to 512 MB per file. Collaborators subscribe to the chunks and rebuild a playable local copy, so the presentation needed no S3 (S3 and R2 references are in the schema for later).
- **Presence per connection.** `presence` rows (playhead, selection, cursor) are keyed by connection id, so two tabs of one user show as two collaborators. `client_disconnected` removes the row and marks the user offline only when their last tab closes.
- **The AI is just another collaborator.** The agent uses `gemini-3.5-flash-lite`, opens the same session as a human and its tools map one-to-one to reducers. Their README says it outright: "Do not create a privileged AI-only mutation API."

##### Edit lifecycle: one reducer call, every screen updates

The local editor moves first so dragging feels instant; SpacetimeDB then makes the edit canonical and fans it out. The trick that makes this work with several tabs per person is the `origin` column.

**Diagram: CoClip edit lifecycle · one reducer call, three subscribers**

What it shows: An edit is one transaction, then every other screen catches up.

Text in the diagram, in drawing order:

- An edit is one transaction, then every other screen catches up
- Editor A
- SpacetimeDB
- Editor B
- Gemini agent
- Drag a clip; local
- timeline moves first
- Edit::open: role check,
- project revision + 1
- clip row: origin = A
- append edit_history
- Err: all of it rolls back
- move_clip(project, clip, start)
- origin = A: echo dropped
- applied to local tracks
- agent view refreshes
- same reducers
- solid: reducer call, dashed: subscription update

1. Editor A drags a clip. OpenCut updates its own timeline immediately, and the adapter calls `move_clip` with tick-based times (`i64` `MediaTime`, never floats).
2. The reducer opens an `Edit`: checks A's role (owner, editor or agent can write; viewers can't), bumps `project.revision`, writes the clip with `revision`, `updated_by` and `origin` (A's connection id), and appends an `edit_history` row. Any `Err` rolls all of it back.
3. Every subscriber gets the changed clip row. Editor A sees `origin` equals its own connection and drops the echo. Editor B (and A's second tab, if open) patches its local tracks.
4. The agent's session gets the same row, re-renders its model-facing view, and can answer with reducer calls of its own.

Why `origin` and not identity: one person can have two editors open, and each must see the other's changes. Write seats are capped at 4 active editors per project (`MAX_ACTIVE_EDITORS`); extra joiners who want to edit are flagged `at_capacity`.

##### Data model: typed where reducers reason, JSON where only the editor does

Columns the reducers do math on (times, ordering, roles, volume) are typed; editor-only details (element params, animations, masks, effect values) ride along as a JSON `data` or `params` string. Timeline positions are `i64` tick counts so both sides agree exactly.

| Group | Table | Key fields |
| --- | --- | --- |
| Access | `user` | identity, name, color, `kind` (Human or Agent), online, last_seen |
| Access | `project_member` | project, identity, `role` (Owner, Editor, Agent, Viewer) |
| Access | `share_invite` | token, project, `can_write` |
| Access | `collaborator` | connection id, project, role, `can_write`, `at_capacity` |
| Access | `live_session` | project, host, active |
| Timeline | `project` | id, name, owner, `revision` |
| Timeline | `project_metadata` | canvas size, fps, background |
| Timeline | `scene` | project, name, is_main, position |
| Timeline | `track` | scene, `group` (Overlay, Main, Audio), kind, position, muted, hidden, revision |
| Timeline | `clip` | track, kind, `start_time`, `duration`, `trim_start`, `trim_end`, rate, volume_db, `data` JSON, revision, updated_by, `origin` |
| Timeline | `clip_effect` | clip, effect_type, position, enabled, `params` JSON, revision |
| Media | `asset` | project, name, `storage` (Local, S3, R2, Spacetime), location, mime_type, byte_size, width, height, duration |
| Media | `asset_chunk` | asset, `chunk_index`, `chunk_count`, `bytes` (up to 256 KB) |
| Live | `presence` | connection id (key), playhead, selection, cursor x/y, is_playing |
| Live | `edit_history` | revision, `op` (one of 24 typed ops), target, actor, actor_kind, origin, JSON payload |
| Live | `chat_message` | project, author, text (2,000 chars max, last 200 kept) |

##### How the core behaviors work

**Every edit follows the same three steps.** Check the caller may write, bump the project revision, then make the change and log it with who did it (human or agent) and from which connection. If any step fails nothing is saved, not even the revision bump. All 24 edit types (move, trim, split, effects, assets and so on) share this path, which is why permissions and history are always consistent.

**Splits are computed on the server.** The server cuts the clip in exact media ticks. The left half keeps its id, the right half takes an id the client chose up front (so both sides agree without an extra round trip), effects are copied across, and the split is logged once.

**Permissions follow the connection.** A view-only link stays view-only even if the same person is an editor in another window. When the host ends the session or removes a guest, that guest's next write is refused.

**Media uploads in slices.** Each slice must belong to an asset marked as stored in SpacetimeDB, be at most 256 KB, and fit within a 512 MB file. Re-uploading clears stale slices. Writing media doesn't bump the revision, because bytes aren't an edit.

**Clients ignore their own echoes** by comparing each incoming row's origin connection with their own, so only other people's changes get re-applied.

##### The AI agent: a collaborator, not a service

The agent gets no special API. It joins like a person, so reducer validation, permissions and history apply to it unchanged, and a human can override anything it does.

- **Joining.** `CollabAgent.open` opens the same `CollabSession` an editor uses with `asAgent: true`, then calls `declare_agent` so its edits show as `actor_kind = Agent` in history and presence. It skips media bytes (`includeMediaBytes: false`) because downloading hundreds of MB timed out on a serverless function.
- **What the model sees.** `view.ts` reshapes the flat rows into a nested timeline in seconds instead of ticks, and drops anything the model can't act on.
- **What it can do.** 14 tools, each a thin wrapper over the reducer of the same name: `move_clip`, `trim_clip`, `split_clip`, `delete_clip`, `set_volume`, `set_clip_muted`, `set_clip_hidden`, `add_effect`, `remove_effect`, `toggle_effect`, `update_effect_params`, `set_track_muted`, `set_track_hidden`, `rename_project`. A reducer `Err` comes back to the model as a failed tool result.
- **Model and prompt.** Default `gemini-3.5-flash-lite` through `@google/genai`, picked because it's free on the Developer API. A bundled editing playbook teaches timeline semantics, for example "Hide this clip" means `set_clip_hidden`, not delete; re-read the timeline after each dependent edit and use the real returned ids; never claim an operation succeeded when it was rejected.

This is the most reusable idea in the whole set: if your AI feature writes through the same reducers as your users, you get auth, conflict handling, live sync and an audit trail for free, and the pitch shows humans and AI editing side by side.

**What stood out**

- A pitch anyone gets in five words, attached to a genuinely hard real-time problem (large media) that SpacetimeDB visibly solved.
- Forking an existing open-source editor meant the whole weekend went into the collaboration layer, which is exactly what this track judges.
- A written `architecture.md` that draws the line between what lives in the database and what stays in the client.

#### BeatBoxing (HopHacks Fall 2025, Best Use of SpacetimeDB and Best Overall Hack)

A browser rhythm game with a Baltimore street-art look: you punch at your webcam to hit notes, solo or against a friend in a two-player lobby, and you can import Guitar Hero charts. [Devpost](https://devpost.com/software/beatboxing) · [repo](https://github.com/SamanthaJeanneb/Beat-Boxing-HopHacks2025)

**Diagram: BeatBoxing system design · 2 players, 1 lobby row**

What it shows: BeatBoxing keeps a whole match in one lobby row.

Text in the diagram, in drawing order:

- BeatBoxing keeps a whole match in one lobby row
- Body tracker (Python)
- OpenCV + MediaPipe read
- punches from the webcam
- Body tracker (Python)
- Same script, run by
- the blue player
- Browser game, red
- React + TypeScript on
- Vercel; a key = a punch
- Browser game, blue
- Computes its own hits,
- reports the score total
- SpacetimeDB (Rust)
- lobby: one row per code
- red/blue identity, chars,
- ready flags, song, scores
- set_ready starts the match
- once both ready + song set
- user: online on connect
- key presses
- Each browser calls reducers (create_lobby, join_lobby, set_ready, set_score)
- and subscribes to its lobby row, so both screens show both scores live.

**How it uses SpacetimeDB**

- **Two tables, nine game reducers.** `lobby` holds a whole match in one row keyed by a 4 to 12 character code: both identities, characters, ready flags, song, a started flag and live scores. `user` tracks who is online through the connect and disconnect hooks.
- **Light server rules.** Reducers check the caller is red or blue in that lobby. `set_ready` flips `started` only when both players are ready and a song is set, and changing the song resets the scores.
- **Scores are client-reported.** The browser counts hits and calls `set_score` with its total, so the server trusts the client. Fine for judging, easy to cheat.
- **Webcam input never touches the database.** `bodyTracker.py` (OpenCV + MediaPipe) detects punches and fires key presses with `pyautogui`; the browser treats them like keyboard input.

##### Match flow: one row, six stages

There is no match table, no score history and no tick. A match is just the `lobby` row changing shape, and both browsers subscribe to that one row with `SELECT * FROM lobby WHERE code='<CODE>'`.

**Diagram: BeatBoxing lobby lifecycle · 6 stages, 1 row**

What it shows: One lobby row walks through the whole match.

Text in the diagram, in drawing order:

- One lobby row walks through the whole match
- 1. Created
- create_lobby(code)
- caller becomes red; code is
- 4 to 12 letters or digits
- 2. Joined
- join_lobby(code)
- fills the empty side (blue);
- a third player is refused
- 3. Setup
- set_character, set_song
- each side picks a boxer;
- either player picks the song
- 4. Ready
- set_ready(true)
- both ready and a song set:
- the reducer sets started
- 5. Live match
- set_score(total) on each hit
- each client judges its own
- notes, opponent sees it live
- 6. Results
- client-side screen
- compares red_score and
- blue_score; nothing else saved
- set_song: back to setup

1. **Create.** The host picks a code; `create_lobby` uppercases it, checks it is 4 to 12 alphanumerics and unused, and seats the caller as red.
2. **Join.** `join_lobby` seats the second identity as blue; rejoining is a no-op and a third player gets "Lobby is full".
3. **Setup.** Each side calls `set_character`; either side can call `set_song`, which also resets `started` and both scores.
4. **Ready.** `set_ready` recomputes both flags and sets `started = true` only when both are ready and a song is chosen. That flip is the start signal both clients react to.
5. **Play.** Each browser judges its own notes (Perfect within 80 ms, Great 150 ms, Good 250 ms) and calls `set_score` with its running total, so the opponent's score ticks up live on your screen.
6. **Results.** The results screen compares `red_score` and `blue_score`; nothing is written afterwards. The `user` table separately flips `online` through the connect and disconnect hooks.

##### Data model: two tables, started from the chat quickstart

The `user` table and its connect hooks are carried over from SpacetimeDB's chat example (the code comment says so), and `red_count` / `blue_count` with the `increment` reducers look like leftovers from an earlier counter prototype that the final game doesn't need.

| Table | Field | Type | Meaning |
| --- | --- | --- | --- |
| `lobby` | `code` | String, primary key | Uppercased join code |
| `lobby` | `red`, `blue` | Option\<Identity> | Who holds each side |
| `lobby` | `red_char`, `blue_char` | Option\<String> | Chosen boxer |
| `lobby` | `red_ready`, `blue_ready` | bool | Ready flags |
| `lobby` | `song_id` | Option\<String> | Chosen chart |
| `lobby` | `started` | bool | Set by `set_ready` when both are ready |
| `lobby` | `red_score`, `blue_score` | u32 | Running totals pushed by each client |
| `lobby` | `red_count`, `blue_count` | u32 | Unused counters from the prototype |
| `lobby` | `created` | Timestamp | Creation time |
| `user` | `identity` | Identity, primary key | SpacetimeDB identity from the saved token |
| `user` | `name` | Option\<String> | Display name (unused in the game) |
| `user` | `online` | bool | Flipped by `client_connected` / `client_disconnected` |

##### How the core behaviors work

**The server decides when a match starts.** Each player only sets their own ready flag. Every time a flag changes, the reducer checks whether both are ready and a song is chosen; if so it marks the match started, and both browsers react to that change at once.

**Scores are trusted from the client.** Each browser judges its own notes and sends its running total after every hit. The server only checks that the sender is red or blue in that lobby, then stores whatever number arrives.

**The webcam talks through the keyboard.** A Python script runs pose tracking on the webcam, classifies wrist motion against the shoulders with a 0.8 s cooldown, and presses a key. The browser can't tell it from a keyboard, which kept Python completely out of the network path.

| Detected move | Key |
| --- | --- |
| Block | F |
| Left hook | S |
| Right hook | L |
| Left uppercut | K |
| Right uppercut | D |

##### What a stronger SpacetimeDB version would change

BeatBoxing shows how far polish carries a thin backend. These are the gaps a Spacetime judge at Cal Hacks would likely spot, each a few lines of module code:

- **Judge hits on the server.** Store the chart's notes in a table, send `hit(lane)` events, and score them against `ctx.timestamp`. That makes cheating hard and gives you a "server-authoritative" line for the pitch.
- **Synchronised start.** Write a `starts_at` timestamp a few seconds ahead and have both clients begin the song then, instead of reacting to the `started` flip whenever it arrives.
- **Lock down `set_song`.** It is the one lobby reducer without a membership check, so anyone who knows a code can change the song and reset both scores.
- **Persist results.** A `match_result` table and a leaderboard view turn one-off games into something worth subscribing to, including for spectators.
- **Clean up.** Delete or expire lobbies on disconnect with a scheduled reducer, and drop the unused counter fields.

**What stood out**

- It won on fun and polish (hand-drawn art, smooth web performance), not database depth. HopHacks' stated criterion was "most polished app."
- The team's own highlight was how fast a working multiplayer game came together in SpacetimeDB while they were still learning Rust.
- For Cal Hacks this is the floor, not the bar: Spacetime's MHacks picks (Traycer, CoClip) put the game logic on the server.

#### Side by side: what the three teach for a Cal Hacks build

The further the rules move into the module, the stronger the SpacetimeDB story: Traycer runs its whole cafeteria model inside it, CoClip enforces every edit there, BeatBoxing only decides when a match starts.

|  | Traycer | CoClip | BeatBoxing |
| --- | --- | --- | --- |
| What SpacetimeDB replaces | API server, job queue, image store, game loop | Collaboration server and file transfer | Lobby server |
| Who writes | Python service (HTTP), Node LLM worker, operators | Humans and the agent, same reducers | Two browsers |
| Logic on the server | Full sim engine, waste totals | Roles, revisions, clip split math | Ready and start rule |
| Scheduled reducers | 200 ms world tick | none | none |
| Auth | Identity grant table plus views | Role per connection, share tokens, 4 write seats | Red or blue side check |
| AI | LLM through job rows with lease and fallback | Gemini as a normal collaborator | none |
| One-line pitch | One source of truth for waste | Google Docs for video | Punch to the beat |

Patterns worth stealing:

1. **Put the rules in the module, keep clients thin.** Share one package between module and client if you can (Traycer's `sim-core`).
2. **Route AI through rows.** Either a job table with a lease, a deadline and a fallback (Traycer), or the AI as an ordinary client calling the same reducers (CoClip). Both keep the pitch alive when a model is slow. An Elastic Agent Builder call slots in exactly where OpenAI sits in Traycer's loop.
3. **Use a scheduled reducer for anything time-based**: ticks, countdowns, expiry, cleanup.
4. **Tag writes with the connection** (`origin`) so multiple tabs and the AI never fight over echoes.
5. **Make the sync visible on stage**: two screens and an AI acting at once is what judges remember.
6. **Still polish it.** BeatBoxing won Best Overall on art and feel with a two-table backend.

### Other notable winners built on SpacetimeDB (won non-Spacetime prizes)

- [Physical Realities](https://devpost.com/software/physical-realities) — **MHacks 2026 Grand Prize**. Theme-park sim with thousands of AI guests; SpacetimeDB stores sim state and pushes live updates to a PixiJS isometric view.
- [DoodleFFA](https://devpost.com/software/doodleffa) — MHacks (ElevenLabs). Phone-drawn weapons battle royale; **20 tick/s scheduled reducer** battle sim, phones send inputs via reducers, API keys in a private table.
- [Ripple](https://devpost.com/software/ripple-mkcbr5) and [Sprout](https://devpost.com/software/sprout-x41rji) — MHacks (Fetch.ai). Ripple uses SpacetimeDB as a job queue for agent workers with version-locked claims; Sprout keeps answers in a private table and scores server-side to prevent cheating.
- [Tab](https://devpost.com/software/tab-groupchat-finances) (Photon iMessage), [Bounty](https://devpost.com/software/bounty-hkz38e) (Figma; geofenced job clock with 30 s scheduled check), [runa](https://devpost.com/software/runa) (Gemini), [Orbit](https://devpost.com/software/orbit-qrgmd8), [EcoBite](https://devpost.com/software/ecobite-gn5ris), [ARGUS](https://devpost.com/software/argus-ulf1yd), [Settlr](https://devpost.com/software/settlr-s4gr9y), [snuffed](https://devpost.com/software/snuffed).
- Takeaway: at MHacks, roughly 15 of ~40 winners used SpacetimeDB, so simply using it won't stand out at Cal Hacks. Depth of use will.

### What Spacetime seems to reward

1. **No other backend.** Winners and Spacetime's own showcase repos say "the database is the server." Use **procedures with `ctx.http.fetch`** to call LLMs/APIs from inside the module, private tables for secrets.
2. **Server-authoritative world ticks.** Scheduled reducers ticking a world (Traycer 200 ms, DoodleFFA 20 Hz, scalpal patient physiology) are the most recurring "impressive" feature.
3. **Humans and AI agents sharing one live state.** CoClip, Traycer, Ripple, and the Bengaluru Spacetime hackathon's Map Room (20 tables, 17 reducers, 4 procedures) all make agents first-class clients writing through reducers.
4. **Many screens in sync.** Phones + big screen, players + admin, collaborators + spectators. Make the real-time sync visible in the pitch.
5. **Polish.** HopHacks literally judged "most polished"; a game or toy that judges can join from their phone is an easy win.
6. **Lean into Spacetime features** by name in the write-up: tables, reducers, subscriptions, scheduled reducers, procedures, views, private tables, `identity_connected` presence, Maincloud deploy. Quantify ("25 tables, 52 reducers").

### Cal Hacks 13.0 notes

- Spacetime is an anchor sponsor; CEO Tyler Cloutier runs a workshop. They're also running **Scrabblebot**, an e-sport where you build an AI bot for a Scrabble-style tile auction game on SpacetimeDB (Swiss rounds, ELO leaderboard, TypeScript bot starter): [repo PR](https://github.com/clockworklabs/scrabblebot/pull/14).
- Recent Spacetime blog themes (good hints at what impresses them): live Wikipedia dashboard, video conferencing over a database, "does it scale" benchmarks, building a multiplayer game in 30 min with Claude Code.

### Sources

[HopHacks F25 Devpost](https://hophacks-fall-2025.devpost.com/) · [MHacks 2026 Devpost](https://mhacks-2026.devpost.com/) · [Spacetime at Cal Hacks](https://spacetimedb.com/blog/spacetime-at-calhacks) · [Spacetime blog](https://spacetimedb.com/blog) · [Map Room repo](https://github.com/Piyush-sahoo/spacetime-hacks) · [DoodleFFA write-up](https://dev.to/mayozoz/doodleffa-4f1p) · [Cal Hacks 13.0 Devpost](https://cal-hacks-13-0.devpost.com/)

Repos read for the deep dives: [anton-3/traycer](https://github.com/anton-3/traycer) (incl. its [SpacetimeDB architecture doc](https://github.com/anton-3/traycer/blob/main/docs/spacetimedb-architecture-current.md)) · [anuragsk05/CoClip](https://github.com/anuragsk05/CoClip) · [SamanthaJeanneb/Beat-Boxing-HopHacks2025](https://github.com/SamanthaJeanneb/Beat-Boxing-HopHacks2025) · [Traycer Devpost](https://devpost.com/software/traycer-ai-food-waste-intelligence) · [CoClip Devpost](https://devpost.com/software/coclip) · [BeatBoxing Devpost](https://devpost.com/software/beatboxing)

## Tab: BandIt: SpacetimeDB (BandIt on SpacetimeDB)

Tab last updated 2026-10-24.

Build BandIt's live system on SpacetimeDB and use Elastic as the search and agent layer over a one-way copy of its data. Bright Data scrapes the event's booths and schedule before doors open, and that data enters through SpacetimeDB like everything else. This tab is the SpacetimeDB half; the Elastic half is in [BandIt: Elastic](#tab-bandit-elastic-bandit-on-elastic).

### How SpacetimeDB and Elastic split the work

They don't compete, because they answer different questions. SpacetimeDB holds state and acts: positions, incidents, band commands and memories, pushed live to every band and screen. Elastic searches and answers: fuzzy text, meaning, places and history. One rule keeps the line clean: Elastic is never a source of truth, and anything it finds becomes an action only when an app calls a SpacetimeDB reducer.

| Option | What it means | Effect on the SpacetimeDB prize | Call |
| --- | --- | --- | --- |
| SpacetimeDB + Elastic as a search layer | SpacetimeDB owns everything; an indexer copies booths, memories and photos to Elastic, where search and an Agent Builder agent answer questions | Neutral to positive: SpacetimeDB stays the heart, and the Elastic prize comes into reach | Build this |
| SpacetimeDB only | Every feature in one module, with exact lookups instead of search | Strongest single story, but no free-text search or agent | Fallback if Elastic slips |
| Elastic in the live path | Band positions or incidents stream into Elastic and screens read from there | Hurts: two sources of truth, and SpacetimeDB looks like a relay | Avoid |

Build order: the fall scenario on real bands first, then Elastic. Bright Data has no prize listed at Cal Hacks 13.0 (per the scraping research), so treat it as plumbing. Elastic's prize is "Best use of the Elastic Agent Builder on a Serverless instance" ($1,200 plus Meta Quest 3S headsets for 1st, $1,436 plus Bose headphones for 2nd), and Visa's "Reimagining Shopping" prize ($5,000) still fits the merch idea. Spacetime hasn't published an amount for its prize.

### Why this design fits the SpacetimeDB track

BandIt already describes its core as a "spacetime map", and the design below copies what made Traycer and CoClip win: the database runs the world, many kinds of clients share it, and AI never blocks the live loop.

| What the winners did | BandIt's version |
| --- | --- |
| Server-run world on a scheduled reducer (Traycer's 200 ms tick) | A venue tick fuses band and camera signals into positions, crowd density and per-band commands |
| Many different clients on one source of truth | Bands (through a bridge), the camera service, an ops dashboard, a paramedic view, attendee phones, an agent worker |
| AI routed through rows with a fallback | Merch and photo agents claim job rows; the safety loop never waits on a model |
| Access rules inside the database (grant tables, views, per-connection roles) | Medical and insurance data in private tables, shown to a paramedic only while their incident is open |
| One visible real-time moment | A person "falls" and every band around them turns red and points away within a tick |

### System design

One SpacetimeDB module is the only source of truth. Bands, cameras and photographers write raw signals in, and Bright Data's scrape of booths and schedule is loaded once at setup. A scheduled venue tick turns signals into positions, risk and per-band commands, and every band and screen reads its slice by subscription. Below the line, an indexer keeps a one-way copy in Elastic for search and the agent.

**Diagram: BandIt system design · SpacetimeDB holds the truth, Elastic searches a copy**

What it shows: One SpacetimeDB module runs BandIt; Elastic only searches a copy.

Text in the diagram, in drawing order:

- One SpacetimeDB module runs BandIt; Elastic only searches a copy
- BandIt bands
- IMU, BLE, NFC, LEDs,
- buzz motor, compass
- Venue cameras
- count people per zone,
- spot a person down
- Photographers
- time, place, heading,
- image features
- Bright Data scrape
- event site, booths,
- schedule, floor plan
- Band bridge
- BLE up to reducers,
- commands back down
- SpacetimeDB module: the only source of truth
- Live sensing
- BLE sightings, zone counts,
- band status, fall alerts
- Venue tick, every 250 ms
- fuses signals into positions,
- density and crowd risk
- Incidents and commands
- per-band LED, buzz, heading;
- escalation timers
- Identity (private)
- attendee, medical,
- insurance, NFC claim
- Memories
- visits, encounters,
- photos, summary view
- Agent jobs
- merch work; worker
- claims with a lease
- Venue and booths
- zones, exits, booth
- details from scrape
- readings
- commands
- zone counts
- photo metadata
- booth data, at setup
- subscriptions
- Ops dashboard
- live map, hot zones,
- incident queue
- Paramedic view
- route plus medical
- card, incident only
- Attendee app
- signup, alerts and
- post-event summary
- Agent worker
- claims merch jobs,
- calls models, submits
- Elastic Serverless: search and agents over a copy
- semantic + geo search over booths, memories, photos; Agent Builder agent
- indexer keeps a copy in sync
- search, ask the agent
- lookups

| Component | Runs on | Talks to SpacetimeDB by | Job |
| --- | --- | --- | --- |
| Band | ESP32 with IMU, BLE, NFC tag, LED ring, vibration motor, compass | The bridge, over BLE | Detect falls, report nearby bands, show colour, buzz, point a direction |
| Band bridge | Phone or laptop near the bands | SDK connection: calls reducers, subscribes to its bands' command rows | Carry readings up and commands down, so the ESP32 never needs a database client |
| Vision service | Laptop with the venue cameras | Reducer calls (HTTP is enough, as Traycer did) | Count people per zone, flag a person on the ground |
| Photo uploader | Photographer's laptop or phone | Reducer call per photo | Time, rough position and direction, image features, a caption |
| Ingest worker | Script using Bright Data, run before the event | Setup reducers | Turn the scraped pages into zones, exits and booths with descriptions, tags and links |
| Ops dashboard | Browser | Subscriptions | Live map, hot zones, incidents, manual emergency modes |
| Paramedic view | Phone | Subscription to a view gated by an open incident | Route to the patient and their medical card |
| Attendee app | Phone browser, opened by tapping the band | Reducers to sign up; a per-attendee view for the summary | Account, consent, alerts, post-event summary, search box |
| Agent worker | Node or Python process | Claims job rows, submits results through reducers | Merch designs grounded in facts from Elastic; never in the safety path |
| Indexer | Node or Python process | Subscribes to the tables marked for Elastic | Keep Elastic's copy in sync, one way |
| Elastic Serverless | Elastic Cloud | Never directly | Search and the Agent Builder agent, covered in the Elastic tab |

The bridge is the one piece BandIt adds that the winners didn't need. It keeps the bands simple and gives you one place to retry when Bluetooth drops.

### Data model

28 tables in seven groups. The split that matters most is between raw signals that devices write, derived state that only the tick writes, and personal data that nobody reads except through a view keyed on who is asking.

| Group | Table | What one row is | Written by | Who can read it | Copied to Elastic |
| --- | --- | --- | --- | --- | --- |
| Venue layout (public, loaded at setup) | Zone | An area of the venue: its shape, floor area, safe capacity and neighbouring zones | Ingest worker; ops fixes shapes | Everyone | Yes |
|  | Exit | A door: where it is, which zone it opens from, open or blocked | Ingest worker; ops | Everyone | No |
|  | Booth | A stage or stand: name, area, and the description, tags and links scraped for it | Ingest worker; ops places it on the plan | Everyone | Yes |
|  | Anchor | A fixed beacon or camera with a known position; cameras also store their field of view | Ops | Staff | No |
| Identity (private) | Attendee | One person, keyed by their SpacetimeDB identity: display name, socials, consent choices | The attendee, through sign-up | Themself; others only through consented views | No |
|  | Band | One physical band: its id, NFC claim secret, owner, battery, last time heard | Sign-up and the bridge | Ops sees status; the owner sees theirs | No |
|  | Medical card | Allergies, conditions, emergency contact | The attendee | The attendee; a paramedic only while assigned to that person's open incident | Never |
|  | Insurance | Insurer and policy reference | The attendee | The attendee; ops inside an incident report | Never |
|  | Staff role | An identity and its role: ops, paramedic, photographer, bridge, vision, agent worker, indexer | Ops (seeded by the owner) | Checked by every privileged reducer | No |
| Live sensing (private, short-lived) | Sighting | The latest signal strength one band heard from another band or an anchor; one row per pair, overwritten | Bridge | Only the tick | No |
|  | Zone count | The latest people count a camera sees in a zone | Vision service | Only the tick | No |
|  | Ground alert | A camera thinks a person is on the floor at a spot | Vision service | The fall logic | No |
| Derived (only the tick writes) | Band position | Where a band is now, its zone and how sure the estimate is | Tick | Ops; the owner sees their own | No |
|  | Position trail | A position reading every couple of seconds per band, kept for the event | Tick | Nobody directly; feeds photos, encounters and insurance | No |
|  | Zone state | Density, trend and risk level (normal, watch, high) | Tick | Everyone, so the app can show busy areas | Recorded once a minute, for ops analytics |
|  | Venue mode | Normal, or evacuate for the whole venue or chosen zones | Ops | Everyone | No |
| Incidents and commands | Incident | A fall, crowd risk, fire or property event: place, time, status, assigned paramedic | Fall logic, tick, ops | Staff | No |
|  | Incident snapshot | A frozen record taken when the incident opens: density, nearby bands, cameras covering the spot | Fall logic | Ops and the injured attendee | No |
|  | Band command | What one band should show right now: colour, pattern, vibration, compass heading, reason, expiry | Tick and fall logic | Each bridge, for the bands it serves | No |
|  | Escalation timer | A scheduled row that fires if an incident is not acknowledged in time | Fall logic | Internal | No |
| Memories | Visit | An attendee at a booth or stage, from when to when | Memory tick | The owner, through their summary | Yes |
|  | Encounter | Two attendees close together for a while: start, end, where, how close | Memory tick | Both people; socials only after both accept | Only if both allow being found |
|  | Connection request | One attendee asking to swap socials with someone they met | The attendee | Both people | No |
|  | Photo | Time, the photographer's position and heading, field of view, image features, a caption, thumbnail stored as chunk rows | Photographer upload | Tagged attendees | Yes, thumbnail included for image search |
|  | Photo tag | An attendee who is likely in a photo: confidence and status (suggested, confirmed, removed) | Photo upload; the attendee confirms | The tagged attendee | Confirmed tags only |
| Agents and shopping | Agent job | Merch design or report work: inputs, status, lease holder, lease expiry, attempts, deadline | Reducers create; the worker claims | The worker; the owner sees status | No |
|  | Merch design | A generated design and the items it fits | The worker, through a submit reducer | The owner and the people in it | No |
|  | Order | Items an attendee picked and the order status | The attendee | The owner | No |

Four rules keep this model clean:

- **Raw in, derived out.** Devices only write the sensing tables. Only the tick writes positions, zone state and live commands, so two writers never fight over a row and every screen sees the same truth.
- **Overwrite live data, keep periodic history.** Sightings and zone counts are one row per pair or zone, overwritten in place, so the tables stay small however long the event runs. History lives only in the position trail, at a slow rate.
- **Private by default.** Every table with personal data is private. Clients reach it only through views that check the caller's identity, so the paramedic rule ("only while your incident is open") is enforced by the database, not by the app.
- **Search gets a copy, never the original.** Only the tables marked in the last column go to Elastic, through the indexer, one way. Medical and insurance data never leave SpacetimeDB.

### Core behaviors

Each behavior below is one reducer, or one pass of a scheduled reducer, so it either happens completely or not at all. Timings are starting points to tune on the day, not measured numbers.

#### Before doors open: load the venue

The ingest worker pulls the event's public pages through Bright Data: the exhibitor list, booth pages, schedule and floor plan. It writes zones, exits and booths into SpacetimeDB through setup reducers, with each booth's description, tags and links. Names and descriptions scrape well; positions usually don't, because floor plans tend to be images or PDFs, so someone places each booth on the plan by hand once. The indexer then copies the booths to Elastic, and search works from that moment.

#### 1. Tap to join

The band's NFC tag opens the attendee app with the band's id and a claim secret. The phone connects to SpacetimeDB and gets its own identity. The claim reducer checks that the band is unclaimed and the secret matches, then links band and person in one step, so a band can never end up with two owners. Medical card, insurance, socials and consent choices are each saved through their own reducer into private tables. Consent is per feature: being findable after the event, being tagged in photos, and appearing on merch are separate switches.

#### 2. Signals in

Every band scans for nearby bands and fixed anchors about once a second and hands a batch of signal strengths to its bridge. The bridge sends one reducer call per band per batch, not one per sighting. That reducer checks the caller has the bridge role, then overwrites the matching sighting rows. The vision service does the same for people counts per zone a couple of times a second, and raises a ground alert when it sees a person lying down. The band also reports which command it is currently showing, which tells ops which bands actually lit up.

#### 3. The venue tick

A scheduled reducer runs about every 250 ms and is the only thing that turns raw signals into state. Each pass it:

- estimates each band's position as a weighted average of the anchors and bands it hears, weighted by signal strength, then smooths it against the last position so dots don't jump;
- checks band counts per zone against camera counts, and trusts the camera when they disagree, because most people near a zone may not be wearing bands yet;
- writes a new position only when a band moves more than a set distance, so subscriptions don't flood;
- recomputes density and risk per zone;
- refreshes every live band command for open incidents and the current venue mode, and drops sightings that have gone stale.

BLE gives zone-level accuracy, a few metres at best. The design only asks for that: "which zone, and which side of the fallen person", never centimetres.

#### 4. Crowd risk and early dispersal

When a zone stays above its density limit for several ticks in a row, the tick opens a crowd-risk incident. Requiring several ticks stops the zone flickering on and off at the threshold. Bands at the edge of that zone get an amber command that points toward the least crowded neighbouring zone, which thins the hot spot from the outside in. Ops sees the zone go amber on the map. When density drops back under the limit for a while, the incident closes and the commands lapse.

#### 5. Fall response

A fall can be reported by the band (the IMU sees a drop, a hit, then stillness) or by a camera ground alert. If the band and a camera report the same fall close together in time and space, the two reports merge into one incident with higher confidence. The fall reducer does everything in one transaction:

- opens the incident at the fallen band's last position;
- freezes the incident snapshot for insurance;
- writes commands for every band within a small radius: flashing red, a strong buzz, and a compass heading that points away from the fallen person, bent toward the less crowded side and never toward another hazard;
- gives the fallen person's own band a steady white beacon so responders can spot them;
- schedules the escalation timer.

The bridges are already subscribed to command rows for their bands, so the new rows reach them as soon as the transaction commits, and they push them over BLE. The heading in each command is a compass bearing, and each band rotates its LED arrow using its own compass, so the arrow points the right way however the wrist is turned. From then on every tick re-aims the arrows as people move and releases bands that have moved clear.

#### 6. Escalation

If nobody acknowledges the incident before the escalation timer fires, its reducer raises the priority, widens the radius, alerts every paramedic and sounds the ops alarm, then schedules the next step. Acknowledging the incident deletes the timer row, so a handled incident never escalates. This is the same pattern Traycer used for its deadlines: a timer row instead of a loop in some outside server.

#### 7. Paramedic corridor

When a paramedic accepts the incident, the assignment is written on the incident. At that moment the paramedic's medical-card view starts returning the patient's card, and their phone shows the card and a live route without any extra request. The tick draws a corridor from the paramedic to the patient on every pass; bands inside it turn yellow and point sideways, out of the corridor, and the corridor shrinks as the paramedic gets closer. When the incident is resolved, the assignment ends, the card disappears from the paramedic's phone because the view no longer returns it, and the commands expire.

#### 8. Fire and evacuation

Ops switches the venue, or just some zones, into evacuate mode and can mark exits as blocked. At setup the zones are stored as a graph with walking distances between neighbours. Each tick, every band gets a heading toward the next zone on its best path out. "Best" adds a penalty for how crowded each exit already is, so people spread across exits instead of all choosing the nearest one. Bands show a green arrow with a steady pulse and a repeating buzz, which still works in smoke or darkness. A band that reaches an exit zone turns solid green and goes quiet.

#### 9. Insurance record

The snapshot frozen at the start of every incident is the insurance story: what happened, when, where, how dense it was, which bands were nearby as possible witnesses, which cameras covered that spot, and the injured person's insurer reference. Because it is written in the same transaction as the incident, it can't drift from what actually happened. The vision service can also open a property incident with no person involved, such as a fallen speaker, using the same snapshot. Drafting a claim summary from the snapshot is a job for the agent worker, outside the live path.

#### 10. Visits and encounters

A slower memory tick, every few seconds, reads positions instead of raw signals. A visit opens after an attendee has stayed inside a booth's area for a couple of minutes and closes after they have been gone for a couple of minutes. An encounter opens when two attendees who both allow it stay within a couple of metres for several minutes; short gaps merge into the same encounter, and a closeness score grows with time and proximity. The memory tick only compares bands in the same or neighbouring grid cells, so its cost grows with how crowded a spot is, not with the square of the attendance.

#### 11. Photo tagging

The photographer's uploader sends the capture time, the photographer's position (from their own band) and compass heading, the lens angle, image features such as how many faces it saw and where in the frame, and a thumbnail as chunk rows. The upload reducer looks up the position trail at that moment, finds attendees inside the camera's view cone and distance range, ranks them by how centred they are, keeps no more than the number of faces seen, and writes suggested tags. Only attendees who allow photo tagging are considered. Each person confirms or removes their tag in their summary, and confirmed tags give a one-tap share that tags everyone else who confirmed.

#### 12. Post-event summary

The summary is a view keyed on the caller, so every attendee sees only their own: a timeline of zones and visits, top booths with their scraped descriptions, photos they're tagged in, and the people they met. Someone you met appears as "someone you spent 40 minutes with near the main stage" until both of you accept a connection request; only then do socials appear, for both sides at once. Free-text questions about the night, like "which robotics booths did I visit?", go to the Elastic agent, which answers from the copy. The share link is a token row that exposes only the parts the attendee picked.

#### 13. Merch through agent jobs

The attendee picks a memory, for example a set at the main stage with two friends. A reducer creates a merch job that points to that memory, the photos, and the people in it who allow merch. The worker claims the job with a short lease and an attempt count, asks Elastic for facts about the memory (the artist, the booth's description, the best photo captions), calls the image model, uploads the design as chunk rows and submits it. The submit reducer rejects a result whose lease has expired or been handed to someone else, so a slow duplicate worker can't overwrite a newer result. A scheduled reaper puts expired leases back in the queue, and after a few failed attempts a template design with no AI is used, so the attendee always gets something. Friends in the design get a notice and can order the same item. Payment happens outside SpacetimeDB; the order row only tracks status.

#### 14. Keeping Elastic in sync

The indexer is an ordinary SpacetimeDB client with the indexer role. It subscribes to the tables marked for Elastic in the data model; a new subscription first delivers every current row, then each change as it commits. The indexer writes each row to Elastic under the row's own id, so writing the same row twice is harmless and a restart simply rebuilds the copy. Nothing flows back: when the Elastic agent finds something worth acting on, the app or the worker calls a normal reducer.

### Fall response, step by step

This is the moment judges will remember, and every arrow in it is a reducer call or a subscription update. Nothing in the path waits on a model, a queue or a second database.

**Diagram: Fall response · detect, protect, respond, resolve**

What it shows: A fall turns every nearby band red in one transaction.

Text in the diagram, in drawing order:

- A fall turns every nearby band red in one transaction
- Solid arrows are calls; dashed arrows are subscription updates
- Nearby bands
- Fallen band
- Bridge
- SpacetimeDB
- Ops dashboard
- Paramedic
- Detect
- IMU sees a fall
- fall alert, BLE
- calls fall reducer
- Protect
- One transaction:
- open incident, freeze snapshot,
- command every band nearby,
- start the escalation timer
- incident appears
- command rows
- red + buzz + arrow
- white beacon
- Every tick: re-aim arrows,
- renew expiry, release bands
- Respond
- acknowledge
- accepts incident
- card + live route
- corridor commands
- yellow, step aside
- Resolve
- resolves incident
- Card vanishes, commands expire,
- bands go back to normal
- If nobody acknowledges in time
- the escalation timer fires: wider radius, every paramedic alerted, ops alarm, timer re-armed

The whole protect phase comes out of one committed transaction, so ops, the bridge and the paramedic can never see different versions of the incident. Every later change, whether the arrows re-aiming, the corridor opening or the bands going back to normal, is the tick or a reducer rewriting rows that clients are already subscribed to.

### Risks and open questions

| Risk | Why it matters | Design answer |
| --- | --- | --- |
| Noisy BLE positions | Signal strength swings with bodies, walls and how the band is worn | Fixed anchors at known spots, smoothing, zone-level claims only, cameras override zone counts; run the pitch in a small marked area |
| Bridge throughput | A phone or laptop can hold only a handful of BLE connections at once | Go connectionless: bands put their sightings in their advertisements and the bridge scans; the bridge broadcasts commands tagged with band ids; more bridges means more coverage |
| Only a few physical bands | Crowd behaviour needs hundreds of people; you will have a handful of bands | A scripted client drives virtual test bands through the same reducers, like Traycer's virtual cafeteria, with the real bands moving inside the scripted crowd |
| Venue Wi-Fi | Hackathon Wi-Fi is crowded, and the fall moment can't stall | Run the module locally on a laptop on a hotspot for the live pitch, with the same module on Maincloud as the public link |
| Tick cost as data grows | A 250 ms tick has to finish well inside 250 ms | Overwrite live rows, compare only nearby grid cells, write positions only on movement, keep memories on a slower tick |
| Schema churn mid-hackathon | Changing an existing table's columns may force a data wipe when you republish | Freeze the data model above early and add new tables instead of reshaping old ones |
| Scraped floor plans | Booth names and descriptions scrape well; positions rarely do | Place booths on the plan by hand once, and scrape only names, descriptions and the schedule |
| Bright Data without ID verification | Residential proxies, logins and some sites stay locked until a person reviews a company-email application, which can take up to 48 hours (per the scraping research) | Stick to public event pages through the Web Unlocker or scraper APIs, and save the scrape to a file so the pitch never depends on a live scrape |

Open questions for the team:

- How many bands and anchors will physically exist on judging day?
- Is the camera service doing people counts only, or also spotting a person on the ground?
- Does the bridge run on a phone or a laptop? That decides which BLE stack you fight with.
- Which module language? Traycer used TypeScript and CoClip used Rust. TypeScript keeps the module, dashboard and indexer in one language if the team is web-heavy.
- Is merch checkout real (it would fit the Visa shopping prize) or made-up?
- Which event's site will you scrape for the pitch?

## Tab: BandIt: Elastic (BandIt on Elastic)

Tab last updated 2026-10-24.

Elastic is BandIt's search and agent layer. It holds a one-way copy of the venue data from the Bright Data scrape and the memories attendees allow to be found, answers fuzzy questions about them, and never touches the live safety loop.

The Elastic prize at Cal Hacks 13.0 is "Best use of the Elastic Agent Builder on a Serverless instance": $1,200 plus Meta Quest 3S headsets for 1st, and $1,436 plus Bose QuietComfort headphones for 2nd. So the agent is the centre of this half, and the indices exist to give it good tools. Agent Builder is generally available and on by default in every Serverless project, and the free trial runs 14 days.

### Why Elastic next to SpacetimeDB

SpacetimeDB is built for exact, live, transactional state. Elastic is built for ranked, fuzzy retrieval over text, meaning, places and history. Neither does the other's job well, so each question in BandIt has one clear owner.

| Question | Who answers | Why |
| --- | --- | --- |
| "Where is band 42 right now?" | SpacetimeDB | Live state, pushed by subscription |
| "Who is within 3 m of the fallen person?" | SpacetimeDB | It has to happen inside the fall transaction |
| "Show me my timeline" | SpacetimeDB | Exact rows for one person, already a view |
| "Booths about wearable robotics" | Elastic | Matches meaning, not exact words |
| "That drone booth near the main stage" | Elastic | Meaning plus a place |
| "The photo of me near the main stage around 9 with someone in a red jacket" | Elastic | Caption text, a time window and a place, ranked together |
| "Which AI hardware booths did I spend the most time at?" | Elastic | Joins your visits with what each booth is about |
| "Busiest hour per zone tonight" | Elastic | Aggregation over history |

### Architecture

Data only flows one way into Elastic, and every result flows back out as SpacetimeDB ids. That keeps Elastic replaceable: if it goes down, search stops, but nothing live does.

**Diagram: BandIt Elastic architecture · 4 indices, 1 agent, a one-way copy**

What it shows: Elastic reads a copy; every action goes back through SpacetimeDB.

Text in the diagram, in drawing order:

- Elastic reads a copy; every action goes back through SpacetimeDB
- Bright Data scrape
- public event pages
- Ingest worker
- clean, dedupe, save
- SpacetimeDB
- source of truth
- venue and booths
- visits, encounters
- photos and tags
- zone state
- reducers:
- connect, merch job
- Indexer
- one way, by row id
- Elastic Serverless project
- booths
- meaning, tags,
- map position
- memories
- visits and
- encounters
- photos
- caption, time,
- place, people
- zone stats
- per-minute
- zone density
- Agent Builder agent: BandIt guide
- tools: find booths, my visits, find photos, find people, busy zones
- every memory tool is filtered to the asking attendee
- answers with SpacetimeDB ids; never writes anywhere
- Search API
- holds the Elastic key
- Attendee app
- search box, chat
- Merch worker
- design facts
- Ops analytics
- Kibana dashboard
- setup reducers
- changes
- upserts
- queries, chat
- dashboards
- every action is a reducer call with SpacetimeDB ids

### Data flow: scrape, load, index, ask, act

1. **Scrape, before the event.** The ingest worker uses Bright Data to fetch the event's public pages (exhibitor list, booth pages, schedule, floor plan) and saves the result to a file, so a rerun or the pitch never depends on a live scrape.
2. **Load.** It writes zones, exits and booths into SpacetimeDB through setup reducers. SpacetimeDB assigns the booth ids that everything else uses, and someone places each booth on the plan by hand once.
3. **Index.** The indexer subscribes to booths, zones, visits, consented encounters, photos and confirmed photo tags. The first sync delivers every row, then each change as it commits. It writes each row to Elastic under the row's own id, and Elastic turns the text into embeddings as it indexes.
4. **Ask.** The attendee app's search box, the agent chat and the merch worker all go through a small server-side search API that holds the Elastic key. It passes the asking attendee's id along, and every memory tool requires it, so answers are always about that person's own visits, encounters and photos.
5. **Act.** Every result carries SpacetimeDB ids. Anything that changes state, like sending a connection request or starting a merch job, is a normal reducer call with those ids.

The scrape goes through SpacetimeDB instead of straight into Elastic for three reasons: there is one id space for booths, positions get fixed in one place, and Elastic can be wiped and rebuilt from SpacetimeDB at any time by restarting the indexer.

### Indices

Four indices, each fed by the indexer from SpacetimeDB tables. Every document's id is the SpacetimeDB row id, so writing a row twice just overwrites it.

| Index | Comes from | Key fields | How it's searched | Used by |
| --- | --- | --- | --- | --- |
| booths | Booth and zone rows | Name (text and keyword), description and tags (semantic text), zone name, map position (geo point), schedule slots, SpacetimeDB booth id | Hybrid: meaning plus keywords, fused with RRF, boosted by distance from a place | Search box, the find-booths tool, the merch worker |
| memories | Visits, and encounters both people allow to be found | Attendee id, kind (visit or encounter), start and end time, minutes, place, and the booth's name, description and tags copied in | Filter by attendee and time, match booth text by meaning, add up minutes | The my-visits and find-people tools |
| photos | Photos and confirmed photo tags | Photo id, time, place, caption (semantic text), tagged attendee ids, and optionally the thumbnail for image search | Filter by tagged attendee, time window and distance, then rank by caption (or image) match | The find-photos and find-people tools, the merch worker |
| zone stats | Zone state, recorded once a minute | Zone id, minute, density, risk level | Aggregations by zone and hour | The busy-zones tool, the Kibana dashboard |

Five mapping choices matter:

- **Pick the embedding model on purpose.** On Serverless, semantic text now defaults to Jina's v5 text model rather than ELSER, and their scores sit on different scales. Set the model explicitly on every semantic text field so results don't shift under you.
- **Write a clear description on each index.** Agent Builder's index search tool reads each index's description to choose where to look, and it searches only one index per query.
- **Copy booth text into memories when indexing, instead of joining when searching.** ES|QL has a lookup join, but last year's Cal Hacks winners hit confusing join errors on Serverless, and copying keeps every agent question to one simple query.
- **Store positions as real coordinates.** Convert floor-plan metres to latitude and longitude around the venue's real address, so standard distance queries work.
- **Image search is a bonus, captions are the baseline.** Elastic's new image-and-text field (with Jina's omni model) can match "red jacket" against the photo itself, but it is a technical preview. Caption search with semantic text works without it.

### The agent and its tools

One custom agent, "BandIt guide". Its instructions say: answer only about this event and the asking attendee, use the tools rather than guessing, never reveal someone who hasn't allowed being found, and end every answer with the SpacetimeDB ids it used, so the app can turn them into cards and buttons.

| Tool | Type | What it does | Inputs |
| --- | --- | --- | --- |
| Find booths | Index search tool on booths | Open-ended booth discovery by meaning, keywords and place | The question itself |
| My visits | ES\|QL tool, fixed query | The attendee's visits, matched to a topic by meaning, minutes added up per booth | Attendee id, topic, time range |
| Find photos | ES\|QL tool, fixed query | Photos the attendee is confirmed in, within a time window and distance of a place, ranked by caption match | Attendee id, description, time, place |
| Find people | ES\|QL tool, fixed query | People from the attendee's encounters, or confirmed in a given photo, who allow being found | Attendee id, photo id or place and time |
| Busy zones | ES\|QL tool, fixed query | Density per zone over a time range, for ops questions | Time range |
| Get by id | Built-in tool | Fetch one booth or photo by id | Document id |

Most tools are fixed ES|QL queries with parameters, not queries the model writes itself. Models struggle to write ES|QL (a lesson Elastic published from last year's Cal Hacks winners), and fixed queries are faster and give the same answer every time. Only booth discovery is left open-ended.

**How the apps reach it.** The search API calls Agent Builder's converse API with an API key, streaming the answer back to the attendee app. Agent Builder also exposes every agent as an MCP server and over A2A, but the pitch doesn't need either.

**Stretch: let the agent act.** Elastic Workflows can be exposed to an agent as a tool, and a workflow's HTTP step can call SpacetimeDB's HTTP reducer endpoint. That lets the agent, for example, start a merch job when the attendee asks for one in the chat. It is still a reducer call, so the one-way rule holds, and it shows judges Agent Builder doing more than search.

### Search behaviors end to end

#### Find a booth

An attendee types "drone booth near the main stage". The search API runs one hybrid query on the booths index: meaning-based match on the description and tags, keyword match on the name, and a boost for booths close to the main stage's map position. Each result carries its SpacetimeDB booth id, and the app uses that id to highlight the booth on the live map, which still draws from SpacetimeDB.

#### Ask about your night

"Which AI hardware booths did I spend the most time at?" goes to the agent. Its "my visits" tool searches the memories index, filtered to the asking attendee. The indexer copies each booth's name, description and tags into every visit it indexes, so one query can match "AI hardware" by meaning and add up minutes per booth, with no join at search time. The agent answers with booth names, minutes and ids, and tapping one opens it in the summary, which is a SpacetimeDB view.

#### Find the photo, then the person

"The photo of me near the main stage around 9 with someone in a red jacket" uses the "find photos" tool: photos where the attendee is a confirmed tag, taken within a time window around 9, near the main stage, ranked by how well the caption matches "red jacket". Other people confirmed in that photo who allow being found come back only as "someone you were with". The app then offers "send connection request", which is a reducer call, and socials stay hidden until both people accept. That last rule is enforced in SpacetimeDB, not Elastic.

#### Facts for merch

The merch worker skips the agent and queries the indices directly, which is faster and more predictable: the booth or stage description, the artist and set from the schedule, and the best photo captions for the chosen memory. Those facts go into the image-model prompt, so the design is about the real moment.

#### Ops analytics

The indexer copies zone state once a minute into the zone stats index. A dashboard in Kibana shows density per zone over the night and the peak hours. This is history only; the live map stays on SpacetimeDB.

### Where Elastic fits and where it doesn't

| Feature | Lives in | Elastic's role |
| --- | --- | --- |
| Positions, crowd risk, fall, fire, paramedic corridor | SpacetimeDB | None. These need one transaction and an instant push to bands |
| Medical card and insurance | SpacetimeDB private tables | None. Never copied |
| Incident snapshots | SpacetimeDB | None |
| Venue and booth data | SpacetimeDB, loaded from the scrape | Semantic and geo search over the copy |
| Visits, encounters, summary timeline | SpacetimeDB | Free-text questions over the copy; the timeline itself stays a SpacetimeDB view |
| Photo tagging | SpacetimeDB | Finding photos by caption, time and place; the tagging match itself stays in SpacetimeDB |
| Finding someone you met | SpacetimeDB holds encounters and connection requests | Fuzzy lookup over consented encounters and photo captions; the request itself is a reducer call |
| Merch agent | SpacetimeDB job rows and the worker | Facts for the design prompt |
| Ops analytics | SpacetimeDB holds live zone state | Busiest hours and hot spots over minute-by-minute snapshots, on a dashboard |

### Elastic-specific risks

| Risk | Why it matters | Design answer |
| --- | --- | --- |
| Trial LLM limits | Serverless trials restrict LLM and ML token usage, and the docs don't confirm a managed LLM is included | Create the project and test one agent question in the first hours; if it is capped, add your own LLM connector |
| The agent writes bad queries | Models struggle with ES\|QL | Fixed ES\|QL tools with parameters; only booth discovery is open-ended |
| Index search picks the wrong index | It searches one index per query and chooses by the index description | Clear descriptions, and one dedicated tool per memory index |
| Image search is a preview | The image-and-text field is a technical preview | Captions with semantic text are the baseline |
| Mapping changes mid-hackathon | Changing a field's type means reindexing | Point the indexer at a fresh index and restart it; it rebuilds from SpacetimeDB in one sync |
| Agent latency on stage | A model round trip takes seconds | Show the instant search box first, then one agent question; keep the agent out of the fall scenario |
| No Bright Data to Elastic connector | Bright Data can't deliver into Elasticsearch directly | Not needed: the scrape goes through the ingest worker into SpacetimeDB, and the indexer handles Elastic |
