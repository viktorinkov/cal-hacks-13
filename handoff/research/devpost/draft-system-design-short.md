## System design

BandIt is a live system. About 1,000 bands, the staff screens and every attendee's phone read and write the same event at the same time. The design follows one rule: one place holds the truth, and every screen watches that place. That place is SpacetimeDB.

### How SpacetimeDB runs the live event

SpacetimeDB is a database that also runs the server code. Our code is one Rust module, published to SpacetimeDB Maincloud (their hosted cloud). The module has 72 tables, 86 reducers, 54 views and 5 timers. These terms come up below:

- A reducer is a function inside the database. It runs as one transaction: all of its writes happen, or none of them do.
- A scheduled reducer is a reducer that the database runs on a timer.
- A subscription is a live query. The client gets the current rows, then each change as soon as it commits.
- A view is a read-only query inside the database that knows who is asking.

This is what happens in the database when someone falls:

1. The band sends a beacon (a short radio message) ten times a second. The USB gateway hears it, and `bandit-bridge` calls the reducer `ingest_band` with it.
2. Every 500 ms, the scheduled reducer `watch_bands` reads the newest band rows. If a band reports SOS or a fall, it opens the incident and records the bands around it (the light circle) in the same transaction.
3. The organizer portal and the medic's phone subscribe to the incident rows. The incident appears on both screens without any polling, and no app server sits between the band and the screen.
4. The medic taps the person's band. The view `medic_medical_cards` returns that person's medical card to that medic only, and the module logs the tap.
5. The medic resolves the incident. A reducer opens the claim and adds a job row for the workers in one transaction.

The other four timers keep the rest of the event current. `sweep` marks a band offline after 5 seconds without a beacon (every 1 s). `social_tick` turns zone visits and encounters into memories and graph links (every 1 s). `crowd_tick` moves the crowd through the venue's zones and booths (every 2 s). `job_reaper` puts a stuck job back in the queue when its 60-second lease runs out (every 10 s).

### Views: who sees what

Every table is private unless we mark it public. A client reads private rows only through a view, and the view filters by the identity of the caller. The identity comes from the SpacetimeAuth sign-in, so a person is the same identity on every device.

| View | Who gets rows | What it returns |
| --- | --- | --- |
| `my_band`, `my_visits`, `my_encounters`, `my_graph` | each attendee | only their own band, visits, the people they met and their part of the graph |
| `medic_medical_cards` | each medic | the cards of the bands that this medic tapped |
| `claims_board` | the organizer | every claim with its facts, checks and decision |
| `my_wallet` | each attendee | their own balance, summed from their wallet entries |
| `event_graph` | everyone on the big screen | the whole event with no names, computed once and shared by all viewers |
| `worker_jobs` | each worker | only the queued jobs of the kind it runs |

Because the database enforces access, a bug in a web page cannot show one person's row to someone else.

### Design decisions and why

| Decision | Why | What we did not do |
| --- | --- | --- |
| Crowd colors, SOS and the light circle run on the band itself | A fall cannot wait for Wi-Fi or a server | No cloud round trip before the bands light up |
| One SpacetimeDB module holds all live state | Many writers and many screens must never disagree about a zone or an incident | No app server with its own cache in front of a database |
| No reducer calls an outside service. Slow work is a job row that a Rust worker leases | Nothing on the safety path waits for Claude, Elastic or a bank | No AI or bank calls inside the live path |
| The Evidence Engine gets a one-way copy and sends back only ids and scores | Money and live state stay exact in SpacetimeDB, and ranking by meaning is what Elastic does well | No live state in Elastic and no typed search |
| Claude reads and writes words, and code decides coverage and amounts | Payouts must be repeatable and auditable | The model never sets a payout |
| A rule comes only from a human approval, and an approval made on changed numbers fails | The organizer is the authority, and the system repeats the decision exactly | No rules that the model learns by itself |
| One sign-in for everyone, with the SpacetimeAuth magic link | The same person is the same identity on every device, and we store no password | No separate staff login |
| The wallet balance is the module's own sum | The Nessie sandbox records purchases and deposits but does not move a balance | No balance read back from the bank |
| One Vultr server serves the pages and runs the workers, and Maincloud hosts the database | One public address goes on the NFC tags, and the services keep running when the venue laptop sleeps | No second database host, so there is never a second source of truth |
| Presence is by zone | The bands know which station marker is loudest, not an exact position | No positions on a map that the hardware cannot measure |

### When something fails

| Failure | What still works |
| --- | --- |
| The venue internet drops | The bands keep crowd colors, SOS and the light circle. The security view keeps reading the radio on the venue laptop. |
| The bridge stops | After 5 seconds, `sweep` marks its bands offline, so the portal shows them as stale instead of showing old data as live. |
| A worker stops in the middle of a job | `job_reaper` returns the job to the queue after its lease ends and tries up to 3 times. |
| The organizer approves a claim whose numbers changed | The approval fails and no money moves. |
