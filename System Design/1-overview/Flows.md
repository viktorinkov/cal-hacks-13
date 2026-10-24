# Flows

The BandIt event flow is a short run of steps, from a judge joining with their own phone to an insurance claim that the judge approves, which teaches a rule that settles the next claim by itself. This file walks those steps in the order they run at the event, on their happy paths: what the audience sees, what happens underneath, and which doc owns each step. It ends with an index of the sequence diagrams that show the steps in detail. [Architecture](Architecture.md) has the parts these flows run on.

## Role in the system

This file owns:

- the setup that runs before doors open, step by step;
- the event itself, step by step, in the order it runs;
- the index of the key sequence diagrams in other files.

It owns no behaviour. Every step is defined by the doc named in its row, and a step here never adds a rule its owner does not have.

## Interfaces

The flows run over the connections in [Architecture](Architecture.md) and add none of their own. These are the people in them.

| Person | Played by | Uses |
|---|---|---|
| Attendee | a judge, on their own phone | a band, the attendee app |
| Wearers | nine people, the judge among them; the three full bands go to the people in the fall and SOS script, the six lite bands to everyone else | the bands |
| Owner | the team member signed in with the identity that published the module, the only one who grants roles | the staff panel on the Ops dashboard |
| Host | a team member with the `ops` role | the host portal on the Ops dashboard |
| Ops | a team member at the venue laptop | the Ops dashboard, shown on the big screen |
| Medic | a team member with the `medic` role, without a band | the incident desk in the Claims tab of the Ops dashboard, on their phone |
| Hyphenate.md: Risk manager | the same judge, on their own phone, with `risk_manager` granted live by the owner, who picks the judge from the host attendee list | the Claims queue on the Ops dashboard |

## Design

### Before doors open

The venue and the event's real exhibitors are loaded before anyone arrives, so no step depends on a live scrape.

| Step | What happens | Owned by |
|---|---|---|
| 0. Seed | `bandit-ingest` in seed mode loads the venue, zones, exits, stations, bands and role grants through the setup reducers; each Rust service's identity gets its role, and the owner grants each staff member's role from the short identity code on their screen | [SpacetimeDB](../2-data/SpacetimeDB.md), [Rust-Backend](../3-services/Rust-Backend.md) |
| BrightData.md: 0a. Import | `bandit-ingest` fetches the event's public pages from the start URLs in its seed (for Cal Hacks 13.0, the event's own pages) through the Bright Data Web MCP and loads one bundle of organisations, booths, the floor plan and the schedule with `import_event`, in one transaction; ops drags any misplaced booth on the Ops dashboard map | [BrightData](../7-integrations/BrightData.md) |
| Elastic.md: 0b. Organize | between the fetch and the load, the Workflow `bandit-organize` turns the raw records into the checked bundle that 0a loads | [Elastic](../7-integrations/Elastic.md) |
| Hyphenate.md: 0c. Accuracy run | the `bandit-claims` command-line tool (Simulator.md) plants three rounds of claims, genuine and fake, under the accuracy-run policy; the claims agent settles, routes or refuses each one, and the Claims queue shows the scorecard. Its learned rules expire before doors open, so the event starts with no rule | [Hyphenate](../7-integrations/Hyphenate.md), [Simulator](../3-services/Simulator.md) |

### The event, step by step

Each row is the happy path. The doc in the last column owns the detail.

| Step | What the audience sees | What happens underneath | Owned by |
|---|---|---|---|
| 1. Join | A judge taps a band with their phone, signs in with the magic link sent to their email, presses the band's button when it blinks white, types a name, goes through the setup steps below, and lands on a thank-you screen: "You're all set", "Thanks, <name>. Enjoy <venue>." and "Keep your band on. After the event, tap it again for your recap: where you went, who you spent time with, and your photos." A later tap shows the same screen | The NFC URL opens the attendee app from `bandit-api`; SpacetimeAuth signs the judge in and SpacetimeDB derives their identity from the ID token; `claim_band` puts the band in IDENT; the press flag in the next beacons completes the claim; `update_profile` saves the name; an attendee who already has a display name lands on the thank-you; the attendee page shows nothing more until `event_state.ended` | [Attendee-App](../5-apps/Attendee-App.md), [Hardware](../4-devices/Hardware.md), [SpacetimeDB](../2-data/SpacetimeDB.md) |
| Social.md: 1a. Socials | Right after the name, the judge types their Instagram, Facebook or Threads handle | `set_social_handle` writes one `social_handle` row per handle | [Social](../6-features/Social.md) |
| Medical-ID.md: 1b. Medical PDFs | The judge uploads their medical history PDF, then their health insurance PDF; each step has "Skip" | each PDF goes to `POST /api/blobs` with purpose `history` or `insurance`; the page calls `submit_medical_document`, which queues `medical_extract` | [Medical-ID](../6-features/Medical-ID.md) |
| BrightData.md: 1c. Profile claim | A judge whose name is on the event's pages sees "Are you one of these?" with their scraped profile and taps "This is me" | the signed-in app calls `claim_person`, which accepts it because the judge already owns a band from step 1, writes `person_claim` and copies the profile onto the attendee | [BrightData](../7-integrations/BrightData.md) |
| Medical-ID.md: 1d. Card check | The judge sees the card Claude read from the PDFs, each item with its page, and taps "Looks right" | `medical_extract` wrote each kind's fields onto the one `medical_card`; `confirm_medical_card` sets it to `confirmed` | [Medical-ID](../6-features/Medical-ID.md) |
| Payments-Nessie.md: 1e. Wallet | The judge sees "Connect your Capital One wallet" and taps "Connect"; the step shows "Connecting your Capital One wallet", then "Your wallet is connected" with $200, and "Continue" leads to the thank-you | `connect_wallet` queues `wallet_open`; the worker opens a Nessie customer and account; `record_wallet` writes `claimant_account` and the $200 opening; the step waits on `my_wallet` | [Payments-Nessie](../7-integrations/Payments-Nessie.md) |
| 2. Crowd density | Nine wearers step into a taped 1.2 m square; rings go yellow, then red, and chase an exit colour while the full bands vibrate; that exit's station marker glows the same colour; people walk out toward it and rings go green | Bands count neighbours locally; `venue_tick` raises the zone's risk on the dashboard, keeps its exit colour assigned and sends `buzz` to the full bands | [Safety](../6-features/Safety.md), [Hardware](../4-devices/Hardware.md), [Ops-Dashboard](../5-apps/Ops-Dashboard.md) |
| 3. SOS | A wearer holds their button for 3 s; their ring strobes red and every band close by pulses blue; the dashboard shows the incident, its witnesses and a 60 s countdown; ops acknowledges and resolves it | The band reacts first; `ingest_band_reports` opens the incident, freezes the snapshot and arms the escalation timer in one transaction; later batches add the light-circle witnesses | [Safety](../6-features/Safety.md), [Ops-Dashboard](../5-apps/Ops-Dashboard.md) |
| 4. Fall and medic | A wearer on a full band falls; the same strobe and blue circle appear. Ops acknowledges. The medic taps "Take it" on the incident in the incident desk and walks toward the blue ring. The medic adds a treatment note and resolves; the strobe stops | `ack_incident`, `assign_medic` (role `medic`), `add_incident_note`, `resolve_incident` and its `clear` command | [Safety](../6-features/Safety.md), [Ops-Dashboard](../5-apps/Ops-Dashboard.md) |
| (TBD -- LEO) 4b. Medic approach | The medic taps the zone they come in from; the other bands in the zone turn to a side exit's colour and the full bands vibrate, so people move sideways while the medic walks in | `medic_entry_zone_id`, the `medic_approach` directives and `buzz` from `venue_tick` | [Safety](../6-features/Safety.md) |
| Medical-ID.md: 4a. Medical card | Before resolving, the medic taps "Tap band N for the medical card" on the incident, and the card appears inside it | `request_medical_card` checks the `medic` role and the open incident on that band and logs the request; `medic_medical_cards` shows the card until the incident is resolved | [Medical-ID](../6-features/Medical-ID.md) |
| Social.md: 5. The people graph grows | On the big screen the event's people graph grows live: a link appears the moment someone has stayed at a booth for 2 minutes or two people have been together for 3 minutes | The social step of `memory_tick` writes `people_link` in the same transaction as the visit or encounter; the anonymous `event_graph` view pushes it to the screen. Simulator.md: the simulated attendees fill the graph out | [Social](../6-features/Social.md), [Ops-Dashboard](../5-apps/Ops-Dashboard.md) |
| 6. Event ended | The host, a staff member with `ops`, presses "Event ended" in the host portal. Every judge's open thank-you screen turns into their recap page, live. Later a judge reopens their tap link on any device, signed in, and sees it again | `end_event` sets `event_state.ended`; every attendee page subscribes to `event_state` and switches to the recap; `release_band` is refused from then on | [Ops-Dashboard](../5-apps/Ops-Dashboard.md), [Attendee-App](../5-apps/Attendee-App.md), [SpacetimeDB](../2-data/SpacetimeDB.md) |
| Social.md: 6a. The night back | The recap page opens with the space-time view, one bar per stay in a zone and a dot for each person met, then shows the booths they visited, the people they hung out with and those people's socials when they allow it, their photos with tap to share, and their graph | The social step of `memory_tick` wrote the visits and, with the encounter rule (TBD -- LEO), the encounters; the space-time view is drawn from `my_visits` and `my_encounters`; the recap reads views keyed on the caller | [Social](../6-features/Social.md) |
| Elastic.md: 7. Ordered by meaning | On the recap, the people and booths closest to what the judge was into come first; there is no search box | `GET /recap/order` in `bandit-api` takes the caller's candidates from SpacetimeDB views and orders them with semantic queries on `bandit-people` and `bandit-booths` | [Elastic](../7-integrations/Elastic.md) |
| Merch.md: 8. Merch | At the bottom of the recap page the attendee sees their own photo on a t-shirt, mug or poster, some of them from a sponsor booth they spent time at, picks one and buys it with one tap | `my_merch_suggestions` ranks the hand-made templates by the caller's booth minutes, each with one of their confirmed photos; the app places the photo in the template's photo area; `buy_merch` checks the wallet, writes the order and holds its amount. Payments-Nessie.md: a `merch_purchase` job records the purchase on the Nessie sandbox, and the wallet shows the new balance | [Merch](../6-features/Merch.md) |
| Hyphenate.md: 9. The claims | The medic attaches the urgent-care bill from the fall in step 4. Claude reads it, and code pays it against the fee schedule, billed and paid side by side. Claude explains why the injury follows from the fall. No rule exists yet, so the claim waits for a judge, who approves it on their own phone as risk manager; a late note makes their first tap fail as stale, and they approve again. The payout lands in the claimant's wallet, shown in their recap, and rule v1 is created with the judge's name on it. A similar fall from the simulator then settles in seconds under v1, and Lee's fake claim, with witnesses in another zone, is refused by code as `witness_zone` with every check listed | `claim_record_extract`, fee schedule pricing in code, the evidence pack, `claim_review`, coverage in code, the authority matrix, the ledger journals, `claim_payout` and the learned `settlement_rule`; the accuracy-run scorecard, the reserve reversal (J1r) and the insurer's payment (J4) come from the accuracy run before doors open | [Hyphenate](../7-integrations/Hyphenate.md) |

Simulator.md: a crowd of up to 80 crowd bands, each with a simulated owner who is `findable`, moves between the zones inside the module for the whole event, so the people graph and the recaps look like a real event, and the simulated bands (90 to 99) show on the map next to the real ones.

Elastic.md: Kibana, Elastic's web interface, closes the after-event steps. The team opens the `bandit-organize` Workflows run that loaded the event's real exhibitors, one merge with the agent's reason, and the scrape pipeline and sponsors and prizes dashboards, while the Ops dashboard stays on the live venue.

### Sequence diagrams in other files

Each row names a diagram that already exists and the section it sits in.

| Step | Diagram | What it shows |
|---|---|---|
| Every live step | [Architecture](Architecture.md), "The live loop in one picture" | one beacon up to the dashboard and one directive back to a band |
| 1. Join | [Attendee-App](../5-apps/Attendee-App.md), "Claim by press, then onboarding" | which process does what, from the tap to the thank-you screen |
| BrightData.md: 1c. Profile claim | [BrightData](../7-integrations/BrightData.md), "The profile claim, for band owners" | how a band owner claims a scraped profile with one tap |
| 3. SOS and 4. Fall and medic | [Safety](../6-features/Safety.md), "SOS and fall" | from the flag on the band and the light circle to the medic standing next to the person |
| Medical-ID.md: 1b. Medical PDFs | [Medical-ID](../6-features/Medical-ID.md), "Extraction" | how an uploaded PDF becomes fields on the card |
| 6. Event ended | [Attendee-App](../5-apps/Attendee-App.md), "After the event" | how the "Event ended" press by a staff member with `ops` turns every open page into the recap, and how the attendee opens it again later |
| Elastic.md: 7. Ordered by meaning | [Elastic](../7-integrations/Elastic.md), "Part three: ordering the recap's suggestions" | who talks to whom when the recap page opens, and where the list comes from |
| Merch.md: 8. Merch | [Merch](../6-features/Merch.md), "From photo to order" | from a suggested photo on a template to a paid order |
| Hyphenate.md: 9. The claims | [Hyphenate](../7-integrations/Hyphenate.md), "The live-learning run" | from the fall to the second claim settling under the rule the judge's approval created |
| BrightData.md: 0a. Import | [BrightData](../7-integrations/BrightData.md), "One organisation, fetch to load" | for one exhibitor, from the first tool call to rows the indexer sees |

## Failure modes and fallbacks

Each step's failures belong to the doc that owns it. These are the ones that would stop the event flow in front of the judges, each with its one fallback.

| Failure during the event | Effect | Design answer |
|---|---|---|
| The judge presses after the 8 s window | The band claim expires | The screen says "No press arrived in time." and offers to claim again, which opens a new window ([Attendee-App](../5-apps/Attendee-App.md)). |
| Density readings flap in the taped square | Rings and the map disagree | Ops drives the colours from the dashboard with the override badge showing, and the presenter says so ([Safety](../6-features/Safety.md)). |
| A sign-in email is slow | The judge waits on the sign-in screen | The screen offers "Send again" ([Attendee-App](../5-apps/Attendee-App.md)). |
| After the event the judge's device is not signed in | No recap on that device | They open their tap link, sign in with the same email and get the same identity ([Attendee-App](../5-apps/Attendee-App.md)). |
| Simulator.md: the radio misbehaves in front of the judges | The real bands stop moving the map | The `bandit-claims` tool replays a recorded rehearsal log on the simulated ids 91 to 99, as its own run and never during the scripted claims run ([Simulator](../3-services/Simulator.md)). |
| Elastic.md: Kibana is slow at the close | Nothing to show on the Elastic side | The dashboards are saved with the project and show the saved import run ([Elastic](../7-integrations/Elastic.md)). |
| Hyphenate.md: the judge's approval cannot be made live | The first claim has no approver and no rule is learned | A staff member with `ops` loads the fallback rule v1, and the second claim and the refusal run unchanged ([Hyphenate](../7-integrations/Hyphenate.md)). |

## Dependencies

**Depends on:** every doc named in the step tables, and [Architecture](Architecture.md) for the parts.

**Used by:** [Requirements](Requirements.md) and [Architecture](Architecture.md) point here for the event flow.

**If you delete this file:** not intended; it is core. When you delete an optional feature, remove the rows that start with its file name from the step tables, the diagram index and the failure table, and its paragraph below the table of event steps (Simulator.md, Elastic.md).

## Decisions

| Decision | Why |
|---|---|
| The event runs an SOS and, separately, a fall | the SOS shows the button and the light circle; the fall shows the band's own detection, brings in the medic and becomes the live claim in step 9, the first claim of its shape (`fall`), so its approval teaches rule v1 |
| The band press is used only to claim a band; nobody pays at the venue | the press keeps one meaning for the wearer: this band is mine |
| During the event the attendee page is band setup, then a thank-you screen; the recap replaces it when the event ends | the band carries every safety cue, and the night comes back in the recap |
| The flows show happy paths only | each step has one path the team rehearses; failures stay in the owning docs, except the few above that would stop the event flow |
| The medic takes an incident with "Take it" in the incident desk | the medic knows whether they are free, and the incident then shows who is on it |
| Guidance always pairs the route colour with vibration on the full bands | the ring cannot point, so colour plus vibration is how a band moves its wearer to its exit |
| The night comes back when a staff member with `ops` presses "Event ended": every open page turns into the recap live, and the tap link reopens it later for the signed-in owner | one press by the host ends the night for everyone, with no email; the band's own URL is the way back |
| Simulator.md: the in-module crowd runs for the whole event | it lives in the module and sends no band reports, so it costs the dashboard nothing, and its findable owners give the people graph and the recaps a real event's size |
| Social.md: the people graph is shown growing on the big screen during the event | a link is written in the same transaction as its visit or encounter, so the audience watches the graph grow as people move |
| BrightData.md: the import runs before the event, never during it | no step depends on a live scrape |
| Hyphenate.md: the claim starts with no rule, a judge approves it live, and a second claim settles under the rule that approval created | the judges watch the system learn from them; the scorecard, the insurer's payment with its reconciliation difference and the refusal after reserve come from the accuracy run, so nobody types an adjuster's entries in front of the judges. If the approval cannot be made live, a staff member with `ops` loads the fallback rule v1 |
| Elastic.md: Kibana is opened only after the after-event steps | the live screen is the Ops dashboard; Kibana shows only what Elastic holds |
