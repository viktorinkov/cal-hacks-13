## System design

BandIt is a live system. About 1,000 bands, the staff screens and every attendee's phone read and write the same event at the same time. The design follows one rule: one place holds the shared truth, and every screen watches that place. That place is SpacetimeDB. What it does says what people see in each case. This section says how each case runs.

### How SpacetimeDB runs the live event

SpacetimeDB is a database that also runs the server code. Our code is one Rust module, published to SpacetimeDB Maincloud (their hosted cloud). The module has 72 tables, 86 reducers, 54 views and 5 timers. These terms come up below:

- A reducer is a function inside the database. It runs as one transaction: all of its writes happen, or none of them do.
- A scheduled reducer is a reducer that the database runs on a timer.
- A subscription is a live query. The client gets the current rows, then each change as soon as it commits.
- A view is a read-only query inside the database that knows who is asking.

The five timers keep the event current. `watch_bands` opens incidents (every 500 ms). `sweep` marks a band offline after 5 seconds without a report (every 1 s). `social_tick` turns zone visits and encounters into memories and graph links (every 1 s). `crowd_tick` moves the crowd through the venue's zones and booths and sets its bands' colors (every 2 s). `job_reaper` puts a stuck job back in the queue when its 60-second lease runs out (every 10 s).

Slow work, such as a call to Claude, Elastic or the bank, never runs inside a reducer. A reducer adds a job row instead. A `bandit-workers` process leases the job for 60 seconds, does the work and reports back through a reducer. A job that fails 3 times is marked failed.

### Case by case

#### Stopping a crush before it starts

1. Station markers stand at every exit, beacon their id five times a second and glow their exit color. Band firmware takes the loudest marker of the last 3 s as its zone, so its zone's exit is its nearest exit. It takes zone 0 when it hears no marker.
2. Every 250 ms, band firmware counts the bands it heard in the last 2 s at -62 dBm (a radio signal strength) or stronger. It smooths that count into `neigh`, the neighbor count that each beacon carries.
3. The ring is green below 3, yellow from 3 and red from 5, and red adds a circling light in the exit color. The ring steps back down only at two or more below 3 or 5, so it does not flicker.
4. `band1t-bridge` reads the gateway's serial lines and calls the reducer `ingest_band` when a band's values change, or once a second. `ingest_band` writes the `band` row with `neigh`, light state and zone, and `ingest_station` records each marker's color in `station`.
5. The crowd's bands carry no radio, so `crowd_tick` sets their `neigh` and color every 2 s. It counts the bands within 1.5 m of each one and applies the firmware's color rule with the same limits.
6. The organizer portal subscribes to `band`, `zone`, `station` and `settings`, which holds the limits 3 and 5. For each zone it averages `neigh` over the live bands and shows calm, busy from 3 or very busy from 5, beside the exit color.

The bridge resends each band's report once a second even when nothing changes, so `sweep` never marks a quiet but live band offline.

#### Finding the exit

1. Each zone row holds one marker (`zone.station_id`) and one exit color (`zone.exit_colour`). The organizer sets exit colors with the reducer `set_exit`.
2. The portal's low-visibility button calls `set_low_vis`, which updates `settings` and adds a `lowvis` row for every band to the `command` table.
3. `band1t-bridge` subscribes to pending `command` rows and writes each one to the gateway, which broadcasts it to the bands. The bridge then reports it with `command_sent`.
4. With `lowvis 1`, band firmware turns the ring red with a light that circles in its nearest exit's color. The circling gets faster as the band nears the marker that glows that color, and bands with a motor add a guide pulse.
5. SOS and the light circle outrank exit guidance on every band. A second button sends `lowvis 0` the same way.

Other `ops`-only reducers add `command` rows too: `set_thresholds`, `set_rssi`, `force_state`, `haptic` for vibration and `start_find` to find a friend's band.

#### A fall or an SOS

1. Band firmware latches SOS when the wearer holds the button for 3 s, and keeps it until another hold or a `clear` command. A band with a motion sensor also latches a fall after an impact above 2.8 g and then 1.5 s of stillness.
2. While a latch holds, the ring strobes red four times a second and a band with a motor plays the SOS vibration. Every beacon from that band carries the SOS or fall flag.
3. Every band that hears the flag at -58 dBm or stronger pulses blue, and each beacon renews its 1.5 s window. A blue band sends no flag of its own, so the light circle never spreads beyond the bands near the person.
4. The gateway passes the beacon to `band1t-bridge`, which calls `ingest_band` at once because the flags changed. `ingest_band` sets `sos` or `fall` on the `band` row and logs the change in the `event` table.
5. On its 500 ms tick, `watch_bands` picks the online bands with SOS or fall set. For a band with no open incident, it opens one in `incident`, kind `fall` or `sos`, in its marker's zone.
6. In the same transaction, `watch_bands` writes an `incident_snapshot` with the band's state, the bands at that marker and the light circle. It adds the band as the `subject` row of `incident_band`, and each blue band as a `witness` row with how strongly it heard the person.
7. The portal and the medics' phones subscribe to the view `open_incidents`, which returns unresolved incidents only to organizers and medics. The incident appears on every screen without polling.

`watch_bands` skips a band for 10 s after its incident resolves, so a flag still set while the `clear` command travels opens no duplicate.

#### The medic and the medical card

1. The medic signs in with email and sends the organizer the identity code that the portal shows. The module owner calls `grant_role`, which writes the `medic` role to `staff_role`.
2. At sign-up, a `medical_extract` job sends each PDF to Claude, and code drops items that cite no page. `apply_medical_extract` writes the `medical_card` row, which only the attendee, through `my_medical_card`, and a tapping medic can read.
3. The band's NFC tag opens its link, such as `/t/D3CW-EPX2`, and `bandit-api` serves the tap page. The page finds `medic` in `my_roles`, shows the medic view, never claims the band, and calls the reducer `request_medical_card`.
4. `request_medical_card` refuses anyone without the `medic` role and a band that nobody wears. It writes a `medical_access_log` row with the medic, wearer, band, time and open incident.
5. The view `medic_medical_cards` then gives the phone the wearer's name, the incident and the card, from this medic's latest tap on the band.
6. "Take it" calls `assign_medic`, which sets the incident to `Responding`. On the incident desk, the medic adds a treatment note and an optional cost with `add_incident_note`.
7. "Resolve" calls `resolve_incident`, which marks the incident resolved and writes a `clear` command so the band leaves SOS. In the same transaction, it opens a `claim` row for the wearer when the incident has a staff note. The claim waits for the clinic's medical report.

The view reads only rows that `request_medical_card` writes, so every card a medic sees has a matching log row.

#### The security camera

1. Before doors open, `security.py calibrate` tells a helper's band, through the gateway, to blink white 2.5 times a second. It pairs each blink with the spot that staff click on the plan, and four or more spots map the picture onto the plan.
2. `feed.py record` writes every gateway line to a file on the venue laptop. `security.py watch` follows that file and reads the SOS and fall flags in each band's beacon.
3. Every third frame, `FlashFinder` measures how much each pixel's red level swings at 4 Hz over the last 1.5 seconds. A spot counts as a flash when its swing is at least twice the swing at 2.5 and 5.5 Hz, and mostly red.
4. When a beacon from the last 6 seconds carries the SOS or fall flag, `security.py watch` opens a call and sounds the alarm. The call takes the strongest flash that no other call holds. A red 4 Hz flash with no SOS on the radio gets only a quiet yellow marker.
5. For each incident in the camera's zone, the security view sends its verdict to the reducer `submit_vision_assessment`. The `vision_assessment` row holds confirmed or not, a confidence, the camera, each frame's time and hash (fingerprint), and an insurance-ready paragraph.
6. When the camera sees damage, such as a fallen speaker, the security view calls `report_property_event`, which opens a property incident in the camera's zone.
7. With `--serve 8770`, the security view also serves its page: the marked live feed beside a 3D view, where each call is a red column. The alarm repeats every 5 seconds until someone acknowledges it.

The radio says which band calls and the camera says exactly where, so no face recognition runs anywhere.

#### An accident claim

1. An API call to Claude writes each claim's clinic report as a PDF with an itemized bill, and chance decides whether it matches the incident. `submit_medical_record` adds a `claim_record_extract` job row.
2. The worker sends the PDF to Claude, which returns structured output, JSON in a fixed shape. `validate_record` in `bandit-insurance` drops malformed lines, Claude gets one retry with the problems, and a record that fails twice goes to the organizer.
3. `cover_lines` caps each billed line at the fee schedule, for example a $385.00 visit at $275.00. `compute_amounts` sets the payout to the covered total, up to $5,000 per claim and the rest of the $25,000 event limit.
4. `rebuild` writes a new version of the evidence pack, the claim's numbered facts and code checks, with a SHA-256 fingerprint of the facts. `corroborate` passes the camera verdict when it says confirmed, its camera covers the incident zone and a frame lies within 120 seconds.
5. A `claim_verify` job copies codes, amounts, zone and time, with no names, into Elastic. The Evidence Engine checks the copy in its `bandit-claims-validate` pipeline and returns the 3 closest decided past claims, with scores and outcomes.
6. `submit_claim_checks` stores them in `claim_precedent` and queues a `claim_review` job, where Claude flags a report whose time, story or injury does not fit. `submit_claim_review` rejects a review that cites a fact outside the pack or prints a dollar figure the claim does not carry.
7. `decide`, the code half of the Decision Engine, refuses disputed evidence and sends failed checks to the organizer. It settles a claim alone only when two sources agree, the review says consistent and a rule from an earlier approval covers the payout.
8. The organizer's Approve button calls `approve_claim` with the amount and pack hash on screen, and the reducer fails as stale when either no longer matches. With "learn" ticked, approving an $895.00 claim writes rule v1 in `settlement_rule`, so a later $180.00 claim settles alone.
9. A `claim_payout` job deposits the payout in the guest's Nessie account. `post` books the reserve, the insurer's debt, the deposit and the insurer's later payment in the ledger, a double-entry book that refuses unbalanced entries.
10. A `claim_draft` job has Claude draft the notice of loss, the organizer's summary and the guest's letter. Code allows only the claim's own amounts as dollar figures, and it replaces a letter that fails twice with its own template.

The notice carries the full pack hash, so an auditor with the `evidence_fact` rows can recompute it and see that no fact changed.

#### Meeting people

1. The NFC tag opens `/t/<band code>`, and the page signs the attendee in and calls the reducer `claim_band`, which blinks the band white. A press within 8 s reaches `ingest_band` as a `Press` event, and `social_tick` turns it into a `band_owner` row.
2. The reducer `update_profile` saves the display name and `findable`, the one consent switch. The reducer `set_social_handle` saves each Instagram, Facebook or Threads handle.
3. Band firmware reports the bands it hears and their signal strength, and `band1t-bridge` passes each list to the reducer `ingest_heard`. Each pair at -62 dBm or stronger gains at most 2 s per report in its `encounter` row.
4. Every second, `social_tick` copies each `encounter` of two findable wearers into a `social_encounter`. At 180 s together, it marks the pair as met and writes a `met` link, a `people_link` row between the two people.
5. When a band's zone changes, `ingest_band` closes its `zone_visit` stay and opens a new one, and drops any stay under 5 s. `social_tick` turns a stay of 120 s or more into a `visit` and links a findable wearer to that zone's booths.
6. The `/photo` page uploads a picture to `bandit-api` and calls the reducer `register_photo` with the zone the photographer picks and the upload time. It matches on `zone_visit` stays, never on faces, and tags up to 8 findable people whose bands were in that zone then.
7. When staff run `end_event`, every open `/t/` page turns into the recap. It reads `my_visits`, `my_encounters` and `my_photos`, and gets the people and booths from `bandit-api` at `/api/recap`.
8. The portal's Event graph tab draws the view `event_graph` in 3D. People appear as unnamed dots, while booths and companies carry their names.

Encounters come from bands hearing each other, not from zones, so two people in one zone meet only when their bands are close.

#### Buying merch and getting paid

1. At band setup, the attendee taps Connect, and the reducer `connect_wallet` adds a `wallet_open` job row. The worker creates a $200 checking account on Nessie, and the reducer `record_wallet` writes a +$200 `opening` row in `wallet_entry`.
2. The view `my_merch_suggestions` pairs each product design with a photo of the attendee and ranks the pairs by minutes at the design's sponsor booths. The recap page draws each of the top 3 photos into its design, and the server renders no image.
3. The attendee taps Buy, and the page calls the reducer `buy_merch`. It checks that the event is over, the attendee is in the photo, and their balance covers the price.
4. In the same transaction, `buy_merch` writes a `merch_order` row in state `paying` and a `merch_purchase` job row. The view `my_wallet` subtracts every order still `paying`, so the balance on the recap drops at once.
5. The worker records a purchase on the attendee's Nessie account. Then the reducer `settle_merch_order` adds a `purchase` row of minus the price to `wallet_entry` and marks the order `paid`.
6. For a claim payout, the worker deposits the money into the attendee's Nessie account, or into a new $0 account if they have none. The reducer `record_claim_payout` adds a `payout` row to `wallet_entry`.
7. Each retry of a purchase or deposit first looks for a Nessie record with the same memo, so nothing happens twice. After the third failed attempt, the order shows `failed` and its money returns to the balance.

Counting `paying` orders as spent makes the balance check exact, so two quick taps never spend the same money.

### Views: who sees what

Every table is private unless we mark it public. A client reads private rows only through a view, and the view filters by the identity of the caller. The identity comes from the SpacetimeAuth sign-in, so a person is the same identity on every device.

| View | Who gets rows | What it returns |
| --- | --- | --- |
| `my_band`, `my_visits`, `my_encounters`, `my_photos` | each attendee | only their own band, visits, the people they met and the photos they are in |
| `open_incidents` | organizers and medics | the incidents that are not resolved yet |
| `medic_medical_cards` | each medic | the cards of the bands that this medic tapped |
| `claims_board` and the other `board_*` views | organizers and medics | every claim, with its facts, checks and decision |
| `my_wallet` | each attendee | their spendable balance: wallet entries minus orders still being paid |
| `event_graph` | anyone | the whole event with no names, computed once and shared by all viewers |
| `worker_jobs` | the workers | every open job, and each worker takes the kinds it runs |

Because the database enforces access, a bug in a web page cannot show one person's row to someone else.

### Design decisions and why

| Decision | Why | What we did not do |
| --- | --- | --- |
| Crowd colors, SOS and the light circle run on the band itself | A fall cannot wait for Wi-Fi or a server | No cloud round trip before the bands light up |
| One SpacetimeDB module holds all shared live state | Many writers and many screens must never disagree about a zone or an incident | No app server with its own cache in front of a database |
| No reducer calls an outside service. Slow work is a job row that a Rust worker leases | Nothing on the safety path waits for Claude, Elastic or a bank | No AI or bank calls inside the live path |
| The Evidence Engine gets a copy with no names and sends back past claims with scores | Money and live state stay exact in SpacetimeDB, and ranking by meaning is what Elastic does well | No live state in Elastic |
| Claude reads and writes words, and code decides coverage and amounts | Payouts must be repeatable and auditable | The model never sets a payout |
| A rule comes only from a human approval, and an approval made on changed numbers fails | The organizer is the authority, and the system repeats the decision exactly | No rules that the model learns by itself |
| One sign-in for everyone, with the SpacetimeAuth magic link | The same person is the same identity on every device, and we store no password | No separate staff login |
| The wallet balance is the module's own sum | The Nessie sandbox records purchases and deposits but does not move a balance | No balance read back from the bank |
| One Vultr server serves the pages and runs the workers, and Maincloud hosts the database | One public address goes on the NFC tags, and the services keep running when the venue laptop sleeps | No second database host, so there is never a second source of truth |
| Presence is by zone, and each zone is the area around one exit marker | The bands know which marker is loudest, not an exact position | No positions on a map that the hardware cannot measure |
| The camera finds light, and the band says who it is | People are found without face recognition | No faces stored or matched |

### When something fails

| Failure | What still works |
| --- | --- |
| The venue internet drops | The bands keep crowd colors, exit guidance, SOS and the light circle. The security view keeps reading the radio on the venue laptop and keeps its alarm. |
| The bridge stops | After 5 seconds, `sweep` marks its bands offline, and the portal takes them off the map and out of the zone counts instead of showing old data as live. |
| A worker stops in the middle of a job | `job_reaper` returns the job to the queue after its lease ends and tries up to 3 times. |
| The organizer approves a claim whose numbers changed | The approval fails and no money moves. |
| The bank fails 3 times on a purchase | The order shows as failed and its money returns to the balance. |
