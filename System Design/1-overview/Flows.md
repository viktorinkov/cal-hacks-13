# Flows

The BandIt demo is a short run of steps, from a judge joining with their own phone to an insurance claim that the judge approves, which teaches a rule that settles the next claim by itself. This file walks those steps in the order the demo runs, on their happy paths: what the audience sees, what happens underneath, and which doc owns each step. It ends with an index of the sequence diagrams that show the steps in detail. [Architecture](Architecture.md) has the parts these flows run on.

## Role in the system

This file owns:

- the setup that runs before the demo, step by step;
- the demo itself, step by step, in the order it runs;
- the index of the key sequence diagrams in other files.

It owns no behaviour. Every step is defined by the doc named in its row, and a step here never adds a rule its owner does not have.

## Interfaces

The flows run over the connections in [Architecture](Architecture.md) and add none of their own. These are the people in them.

| Person | Played by | Uses |
|---|---|---|
| Attendee | a judge, on their own phone | a band, the attendee app |
| Wearers | nine people, the judge among them; the three full bands go to the people in the fall and SOS script, the six lite bands to everyone else | the bands |
| Ops | a team member at the demo laptop | the Ops dashboard, shown on the big screen |
| Medic | a team member with the `medic` role, without a band | the medic view of the attendee app |
| Hyphenate.md: Risk manager | the same judge, on their own phone, with `risk_manager` granted live for the demo | the Claims queue on the Ops dashboard |

## Design

### Before the demo

The venue and the event's real exhibitors are loaded before anyone arrives, so no demo step depends on a live scrape.

| Step | What happens | Owned by |
|---|---|---|
| 0. Seed | `bandit-ingest` in seed mode loads the venue, zones, exits, stations, bands and role grants through the setup reducers; each Rust service's identity gets its role | [SpacetimeDB](../2-data/SpacetimeDB.md), [Rust-Backend](../3-services/Rust-Backend.md) |
| BrightData.md: 0a. Import | `bandit-ingest` fetches the event's public pages from the start URLs in its seed (for the demo, the Cal Hacks 13.0 pages) through the Bright Data Web MCP and loads one bundle of organisations, booths, the floor plan and the schedule with `import_event`, in one transaction; ops drags any misplaced booth on the Ops dashboard map | [BrightData](../7-integrations/BrightData.md) |
| Elastic.md: 0b. Organize | between the fetch and the load, the Workflow `bandit-organize` turns the raw records into the checked bundle that 0a loads | [Elastic](../7-integrations/Elastic.md) |
| Hyphenate.md: 0c. Accuracy run | `bandit-sim` plants three rounds of claims, genuine and fake, under the accuracy-run policy; the claims agent settles, routes or refuses each one, and the Claims queue shows the scorecard. Its learned rules expire before doors open, so the demo starts with no rule | [Hyphenate](../7-integrations/Hyphenate.md), [Simulator](../3-services/Simulator.md) |

### The demo, step by step

Each row is the happy path. The doc in the last column owns the detail.

| Step | What the audience sees | What happens underneath | Owned by |
|---|---|---|---|
| 1. Join | A judge taps a band with their phone, signs up with a name and an email for the recap, and presses the band's button when it blinks white | The NFC URL opens the attendee app from `bandit-api`; `claim_band_start` puts the band in IDENT; the press flag in the next beacons completes the claim | [Attendee-App](../5-apps/Attendee-App.md), [Hardware](../4-devices/Hardware.md), [SpacetimeDB](../2-data/SpacetimeDB.md) |
| BrightData.md: 1a. Profile claim | A judge whose name is on the event's pages is offered their scraped profile in the "Is this you" step, taps it and presses the band to confirm | `POST /claim/person` calls `request_person_claim`; the band press completes it through `confirm_person_claim` | [BrightData](../7-integrations/BrightData.md) |
| 2. Crowd density | Nine wearers step into a taped 1.2 m square; rings go yellow, then red, and chase an exit colour while the full bands vibrate; that exit's station marker glows the same colour; people walk out toward it and rings go green | Bands count neighbours locally; `venue_tick` raises the zone's risk on the dashboard, keeps its exit colour assigned and sends `buzz` to the full bands | [Safety](../6-features/Safety.md), [Hardware](../4-devices/Hardware.md), [Ops-Dashboard](../5-apps/Ops-Dashboard.md) |
| 3. SOS | A wearer holds their button for 3 s; their ring strobes red and every band close by pulses blue; the dashboard shows the incident, its witnesses and a 60 s countdown; ops acknowledges and resolves it | The band reacts first; `ingest_band_reports` opens the incident, freezes the snapshot and arms the escalation timer in one transaction; later batches add the light-circle witnesses | [Safety](../6-features/Safety.md), [Ops-Dashboard](../5-apps/Ops-Dashboard.md) |
| 4. Fall and medic | A wearer on a full band falls; the same strobe and blue circle appear. Ops assigns the medic with one tap on their entry zone; the other bands in the zone turn to a side exit's colour and the full bands vibrate, so people move sideways while the medic walks toward the blue ring. The medic adds a treatment note and resolves; the strobe stops | `ack_incident`, `assign_medic`, medic-approach directives and `buzz` from `venue_tick`, `add_incident_note`, `resolve_incident` and its `clear` command | [Safety](../6-features/Safety.md), [Ops-Dashboard](../5-apps/Ops-Dashboard.md) |
| Medical-ID.md: 4a. Medical card | Before resolving, the medic taps the person's band and their medical card appears | The `medic` role plus the open incident unlocks the card; the read is logged | [Medical-ID](../6-features/Medical-ID.md) |
| Social.md: 5. The people graph grows | On the big screen the event's people graph grows live: a link appears the moment someone has stayed at a booth for 2 minutes or two people have been together for 3 minutes | The social step of `memory_tick` writes `people_link` in the same transaction as the visit or encounter; the anonymous `event_graph` view pushes it to the screen. Simulator.md: the simulated attendees fill the graph out | [Social](../6-features/Social.md), [Ops-Dashboard](../5-apps/Ops-Dashboard.md) |
| 6. The recap email | Ops sends the recap emails. The judge opens the email on their phone, taps the link, and their recap page opens as them, starting with their space-time view | `send_recap_emails` enqueues one `recap_email` job per attendee with an email; `bandit-workers` stores the token hash with `issue_recap_link` and sends the email through Resend; `GET /summary/{token}` in `bandit-api` redeems the link and hands the browser the attendee's own identity | [Attendee-App](../5-apps/Attendee-App.md), [Rust-Backend](../3-services/Rust-Backend.md), [SpacetimeDB](../2-data/SpacetimeDB.md) |
| Social.md: 6a. The night back | Below the space-time view the recap page shows the booths they visited, the people they hung out with and those people's socials when they allow it, their photos with tap to share, and their graph | The social step of `memory_tick` wrote the visits and, with the encounter rule (TBD -- LEO), the encounters; the summary reads views keyed on the caller | [Social](../6-features/Social.md) |
| Elastic.md: 7. Search by meaning | The attendee finds "the photo of me with the robot" and "booths about wearable robotics"; on their own graph, dashed links show which of the people they met are into the same things | `bandit-api` narrows each search to the caller's own zones and times from SpacetimeDB, then Elastic ranks by meaning; `GET /graph/similar` ranks people by the interests in `bandit-people` | [Elastic](../7-integrations/Elastic.md) |
| Merch.md: 8. Merch | At the bottom of the recap page the attendee sees their own photo on a t-shirt, mug or poster, some of them from a sponsor booth they spent time at, picks one and confirms the payment | `my_merch_suggestions` ranks the caller's confirmed photos against the hand-made templates; the app places the photo in the template's photo area; `place_merch_order` starts the payment. Payments-Nessie.md: the payment is confirmed in the session the recap link opened and settled on the Nessie sandbox by a `nessie_purchase` job | [Merch](../6-features/Merch.md) |
| Hyphenate.md: 9. The claims | The medic attaches the urgent-care bill from the fall in step 4. Claude reads it, and code pays it against the fee schedule, billed and paid side by side. Claude explains why the injury follows from the fall. No rule exists yet, so the claim waits for a judge, who approves it on their own phone as risk manager; a late note makes their first tap fail as stale, and they approve again. The payout lands in the wallet and rule v1 is created with the judge's name on it. A similar fall from the simulator then settles in seconds under v1, and a fake with witnesses in another zone is refused with every check listed | `bill_extract`, fee schedule pricing in code, the evidence pack, `causation_review`, coverage in code, the authority matrix, the ledger journals, `nessie_payout` and the learned `settlement_rule`; the accuracy-run scorecard, the reserve reversal (J1r) and the insurer's payment (J4) come from the accuracy run before the demo | [Hyphenate](../7-integrations/Hyphenate.md) |

Simulator.md: a crowd of up to 200 virtual bands, each with a simulated owner who is `findable`, runs alongside the real bands for the whole demo, so the map and the people graph look like a real event.

Elastic.md: Kibana, Elastic's web interface, closes the after-event steps. The team opens the `bandit-organize` Workflows run that loaded the event's real exhibitors, one merge with the agent's reason, and the Event story and Interest map dashboards, while the Ops dashboard stays on the live venue.

### Sequence diagrams in other files

Each row names a diagram that already exists and the section it sits in.

| Step | Diagram | What it shows |
|---|---|---|
| Every live step | [Architecture](Architecture.md), "The live loop in one picture" | one beacon up to the dashboard and one directive back to a band |
| 1. Join | [Attendee-App](../5-apps/Attendee-App.md), "Claim by press, then onboarding" | which process does what, from the tap to the home screen |
| BrightData.md: 1a. Profile claim | [BrightData](../7-integrations/BrightData.md), "The profile claim, confirmed by a band press" | how a press on the band confirms that a scraped profile is the attendee's |
| 3. SOS and 4. Fall and medic | [Safety](../6-features/Safety.md), "SOS and fall" | from the flag on the band and the light circle to the medic standing next to the person |
| Medical-ID.md: 4a. Medical card | [Medical-ID](../6-features/Medical-ID.md), "The medic tap flow" | from the medic's phone touching the band to the card on screen |
| Elastic.md: 7. Search by meaning | [Elastic](../7-integrations/Elastic.md), "Part two: search, downstream of SpacetimeDB" | who talks to whom in a photo search, and where the filter comes from |
| 6. The recap email | [Attendee-App](../5-apps/Attendee-App.md), "After the event" | how one email brings an attendee back to their recap as themselves |
| Merch.md: 8. Merch | [Merch](../6-features/Merch.md), "From photo to order" | from a suggested photo on a template to a paid order |
| Hyphenate.md: 9. The claims | [Hyphenate](../7-integrations/Hyphenate.md), "The live-learning demo" | from the fall to the second claim settling under the rule the judge's approval created |
| BrightData.md: 0a. Import | [BrightData](../7-integrations/BrightData.md), "One organisation, fetch to load" | for one exhibitor, from the first tool call to rows the indexer sees |

## Failure modes and fallbacks

Each step's failures belong to the doc that owns it. These are the ones that would stop the demo in front of the judges, each with its one fallback.

| Failure during the demo | Effect | Design answer |
|---|---|---|
| The judge presses after the 8 s window | The band claim expires | The screen offers "Try again", which opens a new window ([Attendee-App](../5-apps/Attendee-App.md)). |
| Density readings flap in the taped square | Rings and the map disagree | Ops drives the colours from the dashboard with the override badge showing, and the presenter says so ([Safety](../6-features/Safety.md)). |
| The recap email is slow or lands in spam | The judge cannot open their recap from the email | The phone the judge joined with still holds its session, so `/me` opens the same recap page ([Attendee-App](../5-apps/Attendee-App.md)). |
| Simulator.md: the radio misbehaves in front of the judges | The real bands stop moving the map | `bandit-sim` replays a recorded rehearsal log under virtual ids ([Simulator](../3-services/Simulator.md)). |
| Elastic.md: Kibana is slow at the close | Nothing to show on the Elastic side | The dashboards are saved with the project and show the saved import run ([Elastic](../7-integrations/Elastic.md)). |
| Hyphenate.md: the judge's approval cannot be made live | The first claim has no approver and no rule is learned | The owner loads the fallback rule v1, and the second claim and the refusal run unchanged ([Hyphenate](../7-integrations/Hyphenate.md)). |

## Dependencies

**Depends on:** every doc named in the step tables, and [Architecture](Architecture.md) for the parts.

**Used by:** [Requirements](Requirements.md) and [Architecture](Architecture.md) point here for the demo.

**If you delete this file:** not intended; it is core. When you delete an optional feature, remove the rows that start with its file name from the step tables, the diagram index and the failure table, and its paragraph below the demo table (Simulator.md, Elastic.md).

## Decisions

| Decision | Why |
|---|---|
| The demo runs an SOS and, separately, a fall | the SOS shows the button and the light circle; the fall shows the band's own detection, brings in the medic and becomes the live claim in step 9, the first claim of its shape (`fall`), so its approval teaches rule v1 |
| The band press is used only to claim a band and a profile; nobody pays at the venue | the press keeps one meaning for the wearer: this band, and this profile, are mine |
| The flows show happy paths only | each step has one path the team rehearses; failures stay in the owning docs, except the few above that would stop the demo |
| The medic is assigned by ops with one tap on the entry zone | medics do not wear bands, so ops always names the zone they come from |
| Guidance always pairs the route colour with vibration on the full bands | the ring cannot point, so colour plus vibration is how a band moves its wearer along the dispersion route |
| The night comes back through one recap email that ops sends after the event | the bands are handed back at the end, so a link that works in any browser is the way back |
| Simulator.md: the simulated crowd runs for the whole demo | 200 bands is the size the dashboard handles without throttling, and its findable owners give the map and the people graph a real event's size |
| Social.md: the people graph is shown growing on the big screen during the event | a link is written in the same transaction as its visit or encounter, so the audience watches the graph grow as people move |
| BrightData.md: the import runs before the demo, never during it | no step depends on a live scrape |
| Hyphenate.md: the claim starts with no rule, a judge approves it live, and a second claim settles under the rule that approval created | the judges watch the system learn from them; the scorecard, the insurer's payment with its reconciliation difference and the refusal after reserve come from the accuracy run, so nobody types an adjuster's entries in front of the judges. If the approval cannot be made live, the owner loads the fallback rule v1 |
| Elastic.md: Kibana is opened only after the after-event steps | the live screen is the Ops dashboard; Kibana shows only what Elastic holds |
