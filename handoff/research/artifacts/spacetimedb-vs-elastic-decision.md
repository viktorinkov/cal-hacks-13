# How BandIt shows SpacetimeDB and Elastic

Saved from https://claude.ai/artifact/E1y2UsCJk5sACEiPAK3ZnW, last updated 2026-10-24.

## What this doc is for

This doc lays out where each BandIt data flow could live, SpacetimeDB or Elastic, so you can choose. It does not recommend. Each open choice lists the options, what each one costs, what it gives up, and what a judge would see. The facts come from the code on `vik-e2e` and the system design docs.

## What each system is uniquely good at

**SpacetimeDB** is a database that runs the application's logic inside it. Five things only it gives us:

- **Reducers are transactions.** When a medic taps "Take it", the incident's status and its medic change together, and resolving the incident opens its claim inside the same transaction.
- **Subscriptions push on commit.** The organizer map, the medic's phone and the big screen change the moment a reducer commits, with no polling and no second server in between.
- **High write throughput.** Every beacon the gateway hears is one `ingest_band` reducer call, and `crowd_tick` moves a crowd of about 1,000 bands every 2 seconds, with every screen following by subscription.
- **Scheduled reducers run the event.** `watch_bands` opens an incident as soon as a band reports SOS or a fall, `social_tick` turns time spent together into visits, encounters and graph links, and `sweep` marks a silent band offline. All of them run inside the database, next to the data.
- **Identity and roles live next to the data.** Every caller has an identity, every reducer checks its role, and per-caller views decide who sees what. A medical card opens only for the medic who tapped that band, because a view says so, and every tap is logged for the host.

What it cannot do, from its own docs: it has no vector or full-text search, its SQL API can count rows but cannot group or sum them, and a subscription joins at most two tables on indexed columns. It keeps its tables in memory, so a log that grows all night costs memory for as long as it is kept.

**Elastic** is a search and analytics engine over documents. Four things only it gives us:

- **Meaning without managing vectors.** A `semantic_text` field embeds text with Jina when it is written, and a semantic query ranks by meaning and highlights the passage that matched.
- **An agent over messy records.** The `bandit-organize` Workflow runs the `bandit-organizer` agent with ES|QL `LOOKUP JOIN` to link scraped pages from different sites into one clean set of sponsors, booths and prizes.
- **Checks at the door.** An ingest pipeline validates every document as it arrives.
- **History you can look at.** ES|QL and Kibana dashboards group, sum and chart millions of rows over time.

What it cannot do for us: it does not push changes to browsers, it cannot show each attendee only what they may see, and it has no transactions across records. A copy in Elastic always runs slightly behind.

### The rule from your earlier discussion

Elastic answers questions, and SpacetimeDB holds state and acts. An Elastic agent changes something only by calling a SpacetimeDB action, and the same state is not stored in both places. Each option below says whether it keeps this rule, so you can see where bending it would buy a stronger moment for one judge.

### Where the two meet today

1. **Import bundle.** Elastic's organizer produces a bundle, Rust validates it, and one `import_event` reducer writes it into SpacetimeDB in a single transaction.
2. **Read-only copy.** `bandit-indexer` copies booths and each findable attendee's interests from SpacetimeDB into `bandit-booths` and `bandit-people`, and `claims-elastic` sends a de-identified copy of each claim into `bandit-claims`. Turning `findable` off deletes the copy.
3. **Ranked ids.** `bandit-api` asks Elastic to order the people and booths already on your recap, and keeps their minutes order when Elastic does not answer. SpacetimeDB decides who is on the list; Elastic only decides the order.
4. **Checks.** The three past claims that read most like a new one come back as `claim_precedent` checks through the `submit_claim_checks` reducer. They inform the adjuster and never decide the claim.

## Flows with only one workable home

These have no real second option, because only one system can do what the flow needs. They are listed so the open choices below are the whole picture.

- **Live band positions: SpacetimeDB.** Every line the gateway hears becomes `ingest_band`, `ingest_station` and `ingest_heard`, and the crowd moves inside the module through `crowd_tick`. Staff commands such as `set_exit` go into a command queue in the same database, and the bridge reports each one back with `command_sent`. Elastic cannot push a moving map to every screen. This is where SpacetimeDB's write throughput shows, whatever you choose for the radio history. Judges see about 1,000 people moving on the organizer map and the big screen, a zone turning red as it fills, and a station changing its exit colour when staff set it.
- **SOS and incidents: SpacetimeDB.** `watch_bands` opens the incident, "Take it" assigns the medic, and resolving it opens the claim in the same transaction. Staff screens read `open_incidents`, which returns nothing to anyone else. Elastic has no push and no per-viewer privacy. Judges see a band press appear on every staff screen within a second.
- **Scraped sponsors: Elastic organizes, SpacetimeDB holds the result.** Only Elastic has the `bandit-organizer` agent and ES|QL `LOOKUP JOIN` over messy pages, and only SpacetimeDB can put the checked result on every map in one `import_event` transaction. Judges see Kibana's "scrape pipeline" and "sponsors and prizes" dashboards, then the booths appear on the map.
- **Medical card, merch and payments: SpacetimeDB.** The card is read only through private views and is never copied. Merch comes from a view over your memories, and the wallet records each purchase on Nessie. None of them asks a question about meaning or history.

## The open choices

### Choice 1: Where the raw radio history goes

**Today.** Leo's `feed.py` uploads every line the gateway hears to `bandit-raw-radio`, `bandit-raw-heard` and `bandit-raw-gateway` every 2 seconds. Only the real bands reach the gateway, about 10 of them. The crowd of about 1,000 moves inside the module and never touches the radio, so this history has no crowd in it. Nothing reads these indices yet. Elastic.md keeps them for Kibana and for Leo's matching of photos to band data afterwards. SpacetimeDB keeps each band's current row, not its history.

**A. Keep it in Elastic and show it in Kibana.** Add a "Radio log" dashboard: beacons per band over the night, battery by band, every SOS and fall press on a timeline, and signal strength per station.

- Cost: one dashboard function in `bandit-ingest`'s `dashboards.rs`, from the panel helpers already there.
- Gives up: little, but the dashboard shows about 10 bands, so it is a modest Elastic moment next to the import and claims dashboards.
- Judges see: a Kibana history of the real bands' night.
- Rule: kept. History only, nothing acts on it.

**B. Keep it in Elastic and leave it out of the judging story.** It stays as Leo's matching store and a record of the night.

- Cost: none beyond fixing the Architecture.md row.
- Gives up: an Elastic moment, though Elastic still has the scrape, claims and recap moments.
- Judges see: nothing from it.
- Rule: kept.

**C. Keep the history in SpacetimeDB.** A beacon log table that `ingest_band` appends to.

- Cost: one table, one insert in `ingest_band`, and a reducer that prunes old rows.
- Gives up: the log grows all night in memory, and SpacetimeDB's SQL cannot group or sum it, so there is no chart of the night without exporting it. Write throughput is already visible through the live map, so this adds stored rows rather than a new moment.
- Judges see: the same live map as today, plus a row count.
- Rule: kept, since the history then lives only in SpacetimeDB, but it puts history in a store built for current state.

**D. Keep it on the laptop only.** `feed.py` stops uploading, and the `.jsonl` files stay as the record.

- Cost: run feed.py without its upload flag.
- Gives up: Leo's photo matching would read the local files, and there is no history anyone else can query.
- Judges see: nothing from it.
- Rule: kept.

### Choice 2: Whether the camera's SOS confirmation reaches the incident

**Today.** Leo's `security.py` reads the raw radio log and the ranged positions on the laptop, finds the band's red 4 Hz flash on the camera, sounds an alarm until someone acknowledges it, and serves its own page on port 8770. It works with no internet, and Vision.md decided it reads the gateway directly for that reason. It writes each event to its own `events.jsonl`, including `located` when the camera finds the person. None of this reaches SpacetimeDB, so the organizer and the medic never learn that the camera found the person, and the room has two alarm systems that do not talk. The module already has the reducer for it, `submit_vision_assessment`, which sets the incident's camera status.

**A. Leave it standalone.**

- Cost: none.
- Gives up: the camera's confirmation never reaches the medic.
- Judges see: the security desk and the incident screens as two separate things.
- Rule: not affected.

**B. Send its result to SpacetimeDB, page unchanged.** A small sender next to the page follows `events.jsonl`. Each `located` line becomes a confirmed `submit_vision_assessment` on that band's open incident, with the snapshot stored as its frame. Offline, the page works as today and the sender catches up later.

- Cost: about 60 lines of Python in a new file. One line in the module so the `vision` role can read `open_incidents`, which only staff can read today. One line on the organizer's incident card to show the camera status.
- Gives up: nothing on the page; the acknowledgement stays local.
- Judges see: "seen on camera" on the incident, on every staff screen, a second after the camera finds the person.
- Rule: kept.

**C. Send its events to Elastic instead.** The same kind of sender writes `located` and `acknowledged` into a `bandit-raw` index, and Kibana shows a security timeline.

- Cost: a similar sender and one index mapping, no module change.
- Gives up: the medic still does not see it live, because Elastic does not push.
- Judges see: a Kibana timeline of what the camera saw, after the fact.
- Rule: kept, as history only.

**D. Make the page read incidents from SpacetimeDB.** One alarm system for the whole room.

- Cost: a rewrite of the page's input, which is Leo's code.
- Gives up: the page stops working without internet, which reverses the Vision.md decision.
- Judges see: one consistent alarm across the security desk and the staff phones.
- Rule: kept.

### Choice 3: Where the ranged positions go

**Today.** The ranging tool writes each real band's position, to within about half a metre, to `positions_*.jsonl` on the laptop, and only the security page draws it. In SpacetimeDB, each band row has a map position: the crowd stands at booth spots, but a real band is placed at its zone's centre, and `ingest_band` resets it there on every beacon.

**A. Leave them on the laptop.**

- Cost: none.
- Gives up: on the organizer map, real people sit at their zone's centre among a crowd placed at booths.
- Judges see: zones, not where a person is.
- Rule: not affected.

**B. Write them onto the band row in SpacetimeDB.** One reducer that only the `vision` role may call sets a band's map position, and `ingest_band` keeps a fresh ranged position instead of resetting it. The sender from Choice 2B posts the latest positions about once a second.

- Cost: one reducer, a freshness check in `ingest_band`, and a loop in the sender. The map already draws the band row's position, so the screens need no change.
- Gives up: nothing; it does need the sender from Choice 2B or one like it.
- Judges see: real people at their real spot on the map, and the medic sees exactly where to go.
- Rule: kept.

**C. Send them to Elastic.** Positions go into a `bandit-raw` index as points, and a Kibana map shows how people moved over the night.

- Cost: one index mapping, a loop in `feed.py`, and one Kibana map.
- Gives up: the positions are not live for the medic.
- Judges see: a Kibana map of movement, after the fact.
- Rule: kept, as history only.

B and C can both be done. That puts positions in both places, live in SpacetimeDB and history in Elastic, which the rule allows only while nothing live reads the Elastic copy.

### Choice 4: How visible Elastic is in the recap and the people graph

**Today.** SpacetimeDB holds the graph: `social_tick` writes `people_link` rows (met, visited, works at, exhibits), `my_graph` shows each attendee their own neighbourhood, `event_graph` shows the whole room on the big screen without names, and only `findable` attendees get links. For the recap, `bandit-indexer` copies each findable attendee's interests (their top booths) into `bandit-people`, and `bandit-api` asks Elastic to order the suggested people and booths. Each suggestion carries a score but no reason, so the recap shows an order and a judge cannot tell that Elastic did anything. Decisions.md removed the earlier dashed "similar interest" links and the semantic lens on the graph.

**A. Leave it as it is.**

- Cost: none.
- Gives up: Elastic's part of the recap stays invisible.
- Judges see: a well-ordered list with nothing that credits Elastic.
- Rule: kept.

**B. Show the reason with each suggestion.** Turn on semantic highlighting for the `interests` field in the ranking query, and return the best-matching phrase with each person and booth. The recap shows it under each one, for example "both into wearable robotics", for people already on your recap only.

- Cost: one highlight clause in `search.rs`, one field on each suggestion, and one line in the recap.
- Gives up: nothing; the list and its consent stay SpacetimeDB's.
- Judges see: why each person is near the top, in words Elastic found.
- Rule: kept.

**C. Bring back the dashed links on the graph.** A route returns, for each person in your graph, the others in it who share your interests, and the graph draws them as dashed lines next to the measured ones.

- Cost: a new route in `bandit-api` and dashed edges in the graph view, and reversing the Decisions.md row that removed them.
- Gives up: the graph would mix links the bands measured with links Elastic inferred, which is why they were removed.
- Judges see: Elastic's meaning drawn on the big picture, next to SpacetimeDB's live links.
- Rule: kept, since Elastic returns ids only.

### Choice 5: Where Leo's photos go

**Today.** Leo's `photos.py` imports photos with their exact time and GPS into local files and into Elastic's `bandit-raw-photos`. It never calls the module, so none of these photos is tagged or shown in a recap. The only caller of `register_photo` today is the attendee app's photo page, which uses the current time and a zone the user picks. `register_photo` tags the findable attendees whose bands were in that zone at that time, up to 8, and each tagged person confirms or removes the tag. Social.md says photos never go to Elastic, while Elastic.md keeps `bandit-raw-photos` for Leo's matching, so the two docs disagree.

**A. Leave them where they are.**

- Cost: none.
- Gives up: Leo's photos never reach anyone's recap.
- Judges see: only photos taken in the attendee app.
- Rule: kept, but the photo records in Elastic have no reader.

**B. Register them in SpacetimeDB and keep the raw record in Elastic.** `photos.py` uploads each photo through `bandit-api`'s blob route and calls `register_photo` with the exact time and the zone where the photographer's band was at that moment. Elastic answers that question from the raw radio history, which gives Choice 1's archive a reader.

- Cost: about 40 lines of Python, one service identity with the `photographer` role, and one line in Social.md.
- Gives up: the photo's import record exists in Elastic as well as the photo in SpacetimeDB.
- Judges see: a photo turning up in the recaps of the people who were standing there, waiting for them to confirm.
- Rule: kept while the Elastic record is only an import log that nothing on screen reads.

**C. Register them in SpacetimeDB and stop writing them to Elastic.** The same import, with the zone read from the local radio log, and `photos.py` no longer writes `bandit-raw-photos`.

- Cost: about 40 lines of Python, one service identity, one index mapping removed from `elastic.py`, and one line in Elastic.md.
- Gives up: Elastic has no photo data at all.
- Judges see: the same as B.
- Rule: kept, and matches Social.md.

### Choice 6: How much of a claim lives in Elastic

**Today.** The claim record, coverage rules, authority matrix, approvals, ledger and payout are in SpacetimeDB, and `resolve_incident` opens the claim in the same transaction. The semantic part is already in Elastic: `claims-elastic` sends a de-identified copy of each claim into `bandit-claims` through the `bandit-claims-validate` pipeline, a semantic query compares its story with a history of 30 past claims, and the three closest come back as `claim_precedent` checks, each with its outcome and payout, through `submit_claim_checks`. The Kibana dashboard "BandIt claims evidence" charts the copies: claims tonight, payouts by zone, outcomes by incident kind, and the errors validation caught. Insurance.md says precedents are checks only, and a claim must decide the same way with or without Elastic.

**A. Keep the split as it is.**

- Cost: none.
- Gives up: Elastic informs the adjuster but never changes a claim's path.
- Judges see: three similar past claims next to the new one, the adjuster approving, the payout in the ledger, and the Kibana claims dashboard.
- Rule: kept.

**B. Let the precedents shape the claim's path.** For example, a claim whose closest past claims were mostly denied goes to a person instead of the automatic route. The change still happens in a SpacetimeDB reducer.

- Cost: one rule in the insurance module that reads the precedent scores, and an Insurance.md change.
- Gives up: a claim's path then depends on a ranking that can change when the index or the embedding model changes, and it no longer decides the same way without Elastic.
- Judges see: Elastic visibly steering a claim.
- Rule: kept in form, since only a reducer changes the claim, but Elastic's answer now drives a decision.

**C. Move the claim itself into Elastic.** The claim, its story and its status live in `bandit-claims`, and search over them is native.

- Cost: a rewrite of the insurance flow.
- Gives up: paying exactly once needs one transaction across the claim, the ledger and the payout, which Elastic does not offer. The adjuster's screen would have to poll, and medical details in a claim would rely on app code for privacy instead of a view.
- Judges see: claims and their meaning in Kibana, but the payout story loses its guarantee.
- Rule: broken, since claim state would live in Elastic.

## All choices at a glance

| Choice | Options | The judge it matters most to |
| --- | --- | --- |
| 1. Raw radio history | A Elastic with a Kibana radio log · B Elastic, not shown · C SpacetimeDB table · D laptop only | Elastic |
| 2. Camera's SOS confirmation | A standalone · B into the incident through SpacetimeDB · C Kibana timeline · D page reads SpacetimeDB | SpacetimeDB |
| 3. Ranged positions | A laptop only · B band row in SpacetimeDB · C Kibana movement map | SpacetimeDB, or Elastic for C |
| 4. Elastic in the recap and graph | A as it is · B reason under each suggestion · C dashed links back | Elastic |
| 5. Leo's photos | A as they are · B SpacetimeDB plus Elastic import record · C SpacetimeDB only | both |
| 6. Claims | A split as it is · B precedents shape the path · C claim in Elastic | both |

The choices are independent, except that 3B reuses the sender from 2B, and 5B is the reader that would give 1A or 1B a use beyond Kibana.

## Doc mismatches to fix whichever way you choose

- Architecture.md says the raw radio log stays on the laptop, while `feed.py` uploads it to Elastic.
- Elastic.md lists a `bandit-memories` index that nothing writes.
- The design docs call the scheduled reducer `memory_tick`, while the code calls it `social_tick`.
- Architecture.md names the recap route `GET /recap/order`, while the code ranks the suggestions inside `bandit-api`'s recap.
- Social.md says photos never go to Elastic, while Elastic.md keeps `bandit-raw-photos`.

## Sources

- The earlier rule: Decisions.md and Architecture.md in the system design ("What each database does best", data ownership).
- Code on `vik-e2e`: `spacetimedb/server/src` (ingest, sweep, safety, vision, social and its crowd, medical, insurance, commands, tuning), `crates/bandit-api` (`main.rs`, `summary.rs`, `search.rs`), `crates/bandit-indexer`, `crates/claims-elastic`, `crates/bandit-ingest/src/dashboards.rs`, `pipeline/feed.py`, `pipeline/elastic.py`, `pipeline/photos.py`, `pipeline/security.py`, `web/src/pages/organizer.ts` and `web/src/pages/photo.ts`.
- Insurance.md: precedents are checks only, and a claim decides the same with or without Elastic.
- Vision.md: the security view reads the gateway directly so it works offline.
- SpacetimeDB views (indexed lookups, per-caller and anonymous views): [Views](https://spacetimedb.com/docs/functions/views)
- SpacetimeDB SQL (subscriptions join at most two tables on indexed columns; the query API has no grouping or sums): [SQL reference](https://spacetimedb.com/docs/reference/sql)
- SpacetimeDB has no vector or full-text search in its docs index: [llms.txt](https://spacetimedb.com/docs/llms.txt)
- Highlighting the most relevant fragments of a `semantic_text` field: [Search and retrieve semantic_text fields](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text-search-retrieval)
- ES|QL joins used by the organizer: [LOOKUP JOIN](https://www.elastic.co/docs/reference/query-languages/esql/commands/lookup-join)
