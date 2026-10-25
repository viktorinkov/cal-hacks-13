# Flows

The BandIt event flow is a short run of steps, from a judge joining with their own phone to their recap after the event. This file walks those steps in the order they run at the event, on their happy paths: what the audience sees, what happens underneath, and which doc owns each step.

It ends with an index of the sequence diagrams that show the steps in detail. [Architecture](Architecture.md) has the parts these flows run on.

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
| Attendee | a judge, on their own phone | a band, the tap page (/t/code) |
| Attendees in the density, SOS and fall steps | nine attendees, the judge among them; the three full bands go to the attendees in the fall and SOS script, the six lite bands to everyone else | the bands |
| Owner | the team member signed in with the identity that published the module, the only one who grants roles and adds staff | `grant_role` from the SpacetimeDB command line for the services, and the organizer portal (/organizer), whose Staff tab adds each staff member by email |
| Organizer | a team member with the `ops` role | the attendee list and "Event ended" in the organizer portal |
| Organizer at the big screen | a team member with `ops` at the venue laptop | the organizer portal, shown on the big screen |
| Medic | a team member with the `medic` role, without a band | the incident desk in the Claims tab of the organizer portal, on their phone; Medical-Card.md: the medic view when they tap a band |
| Insurance.md: Organizer, after the event | the same organizer, a team member with `ops` | "Waiting for your decision" in the Claims tab of the organizer portal |

During the event the medic is the only staff person apart from the organizers (`ops`) running the venue. There are no other staff roles.

## Design

### Before doors open

The venue and the event's real exhibitors are loaded before anyone arrives, so no step depends on a live scrape.

| Step | What happens | Owned by |
|---|---|---|
| 0. Seed | `import_event`, called through the SpacetimeDB HTTP API, loads the event bundle in one transaction: the venue, its zones (each with its station marker and exit colour), booths and the schedule. Each Rust service's identity gets its role with `grant_role`, and the owner adds each staff member by email on the organizer portal's Staff tab (`add_staff`); the account that signs in with that email gets the role. `start_safety_watch` starts `watch_bands`, and `band1t-bridge` registers itself with `register_bridge` when it first connects. Each exit marker glows the colour it saved; an organizer sets one with `set_exit` from the SpacetimeDB command line, and exit routing (TBD -- LEO) sends each exit marker its zone's colour | [SpacetimeDB](../2-data/SpacetimeDB.md), [Rust-Backend](../3-services/Rust-Backend.md), [Safety](../6-features/Safety.md) |
| Bright-Data.md: 0a. Import | `bandit-ingest` builds that bundle from the sources in the event's folder (`sources.json`; for Cal Hacks 13.0, the event site and its Devpost pages, then the sponsors' LinkedIn and Crunchbase records and the venue's Google Maps record), through the Bright Data Web MCP: organisations, prizes, people and the schedule. Each sponsor gets a booth at its spot in `booths.json`, else at the default spot, in the zone whose centre is nearest. `load_venue_spots` then matches the 3D venue's sponsor tables to the booths by name, and an organizer moves any misplaced booth with `place_booth` | [Bright-Data](../7-integrations/Bright-Data.md) |
| Elastic.md: 0b. Organize | between the fetch and the load, the Evidence Engine in Elastic runs `bandit-organize` in Elastic Workflows: it joins the raw records with Elastic ES\|QL and has the Elastic Agent Builder agent `bandit-organizer` decide the organisations that no exact match settles, giving the checked bundle that 0a loads | [Elastic](../7-integrations/Elastic.md) |
| Insurance.md: 0c. Accuracy run | the `bandit-claims` command-line tool (Test-Bands.md) plants three rounds of claims, 2 genuine and 4 fake in each, under the accuracy-run policy; the insurance Decision Engine settles, routes or refuses each one, the tool plays the organizer for the routed ones, and the Claims queue shows the scorecard. Its approved rules expire before doors open, so the event starts with no rule | [Insurance](../6-features/Insurance.md), [Test-Bands](../3-services/Test-Bands.md) |

### The event, step by step

Each row is the happy path. The doc in the last column owns the detail.

| Step | What the audience sees | What happens underneath | Owned by |
|---|---|---|---|
| 1. Join | A judge taps a band with their phone, signs in with the magic link sent to their email, presses the band's button when it blinks white, types a name, goes through the setup steps below, and lands on a thank-you screen: "You're all set", "Thanks, <name>. Enjoy <venue>." and "Keep your band on. After the event, tap it again for your recap: where you went, who you spent time with, and your photos." A later tap during the event opens setup at the first step not yet finished, or the thank-you once every step is done | The NFC URL opens the tap page from `bandit-api`; SpacetimeDB SpacetimeAuth signs the judge in and SpacetimeDB derives their identity from the ID token; `claim_band` sends the band IDENT; the press flag in the next beacons becomes a `Press` event, and `social_tick` completes the claim; `update_profile` saves the name and the findable switch; `resumeStep` picks the first unfinished step on each load; the tap page shows nothing more until `event_state.ended` | [Tap-Page](../5-apps/Tap-Page.md), [Hardware](../4-devices/Hardware.md), [SpacetimeDB](../2-data/SpacetimeDB.md) |
| Social.md: 1a. Socials | Right after the name, the judge types their Instagram, Facebook or Threads handle | `set_social_handle` writes one `social_handle` row per handle | [Social](../6-features/Social.md) |
| Medical-Card.md: 1b. Medical PDFs | The judge uploads their medical history PDF, then their health insurance PDF; each step has "Skip" | each PDF goes to `POST /api/blobs` with purpose `history` or `insurance`; the page calls `submit_medical_document`, which queues `medical_extract` | [Medical-Card](../6-features/Medical-Card.md) |
| Bright-Data.md: 1c. Profile claim | A judge whose name is on the event's pages sees "Are you one of these?" with their scraped profile and taps "This is me" | the signed-in tap page calls `claim_person`, which accepts it because the judge already owns a band from step 1, writes `person_claim` and copies the profile onto the attendee | [Bright-Data](../7-integrations/Bright-Data.md) |
| Medical-Card.md: 1d. Card check | The judge sees the card the Anthropic Claude API read from the PDFs, each item with its page, and taps "Looks right" | `medical_extract` wrote each kind's fields onto the one `medical_card`; `confirm_medical_card` sets it to `confirmed` | [Medical-Card](../6-features/Medical-Card.md) |
| Capital-One-Nessie.md: 1e. Wallet | The judge sees "Connect your Capital One wallet" and taps "Connect"; the step shows "Connecting your Capital One wallet", then "Your wallet is connected" with $200, and "Continue" leads to the thank-you | `connect_wallet` queues `wallet_open`; the worker opens a Capital One Nessie customer and account; `record_wallet` writes `claimant_account` and the $200 opening; the step waits on `my_wallet` | [Capital-One-Nessie](../7-integrations/Capital-One-Nessie.md) |
| 2. Crowd density | Nine attendees step into a taped 1.2 m square; rings go yellow, then GUIDE: four LEDs chase round each ring in the band's exit colour; the zone's level on the Live tab goes busy, then very busy; they walk out toward the exit marker glowing that colour, and rings go green | Bands count neighbours and change state on their own; the Live tab works out the zone's level from the bands' mean `neigh` against `settings.yellow` and `settings.red`; a band chases the exit colour it was last sent, blue after a reboot, and exit routing (TBD -- LEO) sends each band its zone's colour | [Safety](../6-features/Safety.md), [Hardware](../4-devices/Hardware.md), [Organizer-Portal](../5-apps/Organizer-Portal.md) |
| 3. SOS | An attendee holds their button for 3 s; their ring strobes red and every band close by pulses blue; the Live tab's alerts and the incident desk show the incident; an organizer resolves it and the strobe stops | The band reacts first; `band1t-bridge` forwards the flag at once with `ingest_band`; within 500 ms `watch_bands` opens the incident with its snapshot and subject row in one transaction and records the bands in the light circle as witnesses; `resolve_incident` sends one `clear` | [Safety](../6-features/Safety.md), [Organizer-Portal](../5-apps/Organizer-Portal.md) |
| 4. Fall and medic | An attendee on a full band falls; the same strobe and blue circle appear. The medic taps "Take it" on the incident in the incident desk and walks toward the blue ring. The medic adds a treatment note and resolves; the strobe stops | `watch_bands` opens a `fall` incident; `assign_medic` (role `medic`), `add_incident_note`, `resolve_incident` and its `clear` command | [Safety](../6-features/Safety.md), [Organizer-Portal](../5-apps/Organizer-Portal.md) |
| (TBD -- LEO) 4b. Medic approach | The medic taps, on the incident desk, the zone they come in from; the other bands in the incident zone chase the colour of the nearest other door, that door's exit marker chases, and attendees move toward it while the medic walks in through theirs | `state` and `exit` commands to the zone's bands that are neither the subject nor a witness, and `state` to that door's exit marker, all through the `command` table | [Safety](../6-features/Safety.md) |
| Medical-Card.md: 4a. Medical card | At the attendee, the medic taps the band with their phone and the medic view shows the card; "Tap band <band code> for the medical card" on the incident does the same from the desk | `request_medical_card` checks the `medic` role and that someone wears the band, and logs the tap with the open incident; `medic_medical_cards` shows the card | [Medical-Card](../6-features/Medical-Card.md) |
| Social.md: 5. The people graph grows | On the big screen the event's people graph turns slowly in 3D and grows live: a link flashes in the moment someone has stayed at a booth for 2 minutes or two people have been together for 3 minutes, and each new event photo grows into place among the people it caught | `social_tick` writes `people_link` in the same transaction as the visit or encounter; the `event_graph` view pushes it to the screen with everyone's name, and the staff view `board_photos` pushes each photo with the `findable` people the bands put in it. Test-Bands.md: the crowd attendees fill the graph out | [Social](../6-features/Social.md), [Organizer-Portal](../5-apps/Organizer-Portal.md) |
| 6. Event ended | An organizer (`ops`) presses "Event ended" in the organizer portal. Every judge's open thank-you screen turns into their recap, live. Later a judge reopens their tap link on any phone, signed in, and sees it again | `end_event` sets `event_state.ended`; every tap page subscribes to `event_state` and switches to the recap; the organizer portal stops offering `release_band` from then on | [Organizer-Portal](../5-apps/Organizer-Portal.md), [Tap-Page](../5-apps/Tap-Page.md), [SpacetimeDB](../2-data/SpacetimeDB.md) |
| Social.md: 6a. The night back | The recap opens with the space-time view, one bar per stay in a zone and a dot for each person met, then shows the people they spent time with, how they met and those people's socials when they allow it, the others who were there with them, the booths they spent time at, and their photos with tap to share | `social_tick` wrote the visits and the encounters; the space-time view is drawn from `my_visits` and `my_encounters`, and the photos from `my_photos`; the people and booths come from `GET /api/recap` (step 7) | [Social](../6-features/Social.md) |
| Elastic.md: 7. Ordered by meaning | On the recap, the people and booths closest to what the judge was into come first, ranked by the Evidence Engine in Elastic; there is no search box | `GET /api/recap` in `bandit-api` builds the caller's people and booths from the `social_*` views in its SpacetimeDB subscription, orders them with hybrid searches and a reranker on `bandit-people` and `bandit-booths`, and logs the order to `bandit-recap-rankings` | [Elastic](../7-integrations/Elastic.md) |
| Merch.md: 8. Merch | At the bottom of the recap the attendee sees their own photo on a t-shirt, mug or poster, some of them from a sponsor booth they spent time at, picks one and buys it with one tap | `my_merch_suggestions` gives the three products the shopping agent picked with the Anthropic Claude API when the event ended (`merch_picks`), else the hand-made templates ranked by the caller's booth minutes, each with one of their photos; the tap page places the photo in the template's photo area; `buy_merch` checks the wallet, writes the order and holds its amount. Capital-One-Nessie.md: a `merch_purchase` job records the purchase on the Capital One Nessie sandbox, and the wallet shows the new balance | [Merch](../6-features/Merch.md) |
| Insurance.md: 9. The claim during the event | Resolving the fall from step 4 with its treatment note opens a claim, and the medic files the urgent-care bill on it with "File the medical record". The Anthropic Claude API reads it, and code prices it against the fee schedule, billed and paid side by side. The Anthropic Claude API explains why the injury follows from the fall. No rule exists yet, so the claim waits for the organizer | `claim_record_extract`, fee schedule pricing in code, the evidence pack, `claim_review`, coverage in code, the ledger journal J1, and the route to the organizer: `routed_to_role` `ops` | [Insurance](../6-features/Insurance.md) |
| Insurance.md: 9a. The scripted claims run (Test-Bands.md) | After the event, before the organizer decides the claim of step 9, the `bandit-claims` tool runs six claims on the test bands with the Claims tab on the big screen. Jordan's fall waits for the organizer; the tool, playing the organizer, approves it with a stale amount, which fails closed, then with the current one, and rule v1 is created. Maya's similar fall settles in seconds under v1. A claim for an ankle hurt at home waits for the organizer; Lee's fake claim, with witnesses in another zone, is refused by code as `witness_zone` with every check listed; a broken speaker is approved with a recovery letter; and the insurer's payment reconciles claim 1 | the same reducers and jobs as steps 9 and 9b, driven by the tool as the medic and the organizer; `approve_claim` fails closed on the stale amount; the learned `settlement_rule` settles Maya's claim | [Insurance](../6-features/Insurance.md), [Test-Bands](../3-services/Test-Bands.md) |
| Insurance.md: 9b. The organizer decides | After "Event ended", the organizer opens "Waiting for your decision" in the Claims tab and approves the claim from step 9 with "Learn a rule from this approval" ticked. The payout lands in the claimant's wallet, shown in their recap | `approve_claim` checks the amount and SHA seen, records the organizer's `ops` label, posts J2, learns a `settlement_rule` when none covers the payout, and `claim_payout` pays; J3 posts when the deposit lands | [Insurance](../6-features/Insurance.md) |

Test-Bands.md: a crowd of 1,000 crowd bands, numbered from 100, each worn by a generated attendee who is `findable`, moves between the zones and sponsor booths inside the module for the whole event. It fills the venue map, the people graph and the recaps like a real event, and stays out of the safety path. The test bands (90 to 99) show on the map next to the real ones.

Elastic.md: Elastic Kibana, Elastic's web interface, closes the after-event steps. The team opens the Elastic Workflows run of `bandit-organize` that loaded the event's real exhibitors, one merge with the Elastic Agent Builder agent's reason, and the scrape pipeline and sponsors and prizes dashboards, while the organizer portal stays on the live venue.

### Sequence diagrams in other files

Each row names a diagram that already exists and the section it sits in.

| Step | Diagram | What it shows |
|---|---|---|
| Every live step | [Architecture](Architecture.md), "The live loop in one picture" | one beacon up to the organizer portal and one command back to the bands |
| 1. Join | [Tap-Page](../5-apps/Tap-Page.md), "Claim by press, then onboarding" | which process does what, from the tap to the thank-you screen |
| Bright-Data.md: 1c. Profile claim | [Bright-Data](../7-integrations/Bright-Data.md), "The profile claim, for band owners" | how a band owner claims a scraped profile with one tap |
| 3. SOS and 4. Fall and medic | [Organizer-Portal](../5-apps/Organizer-Portal.md), "Incident desk" | what staff see and do for one SOS, from the wrist to resolved |
| Medical-Card.md: 1b. Medical PDFs | [Medical-Card](../6-features/Medical-Card.md), "Extraction" | how an uploaded PDF becomes fields on the card |
| 6. Event ended | [Tap-Page](../5-apps/Tap-Page.md), "After the event" | how the "Event ended" press by an organizer (`ops`) turns every open page into the recap, and how the attendee opens it again later |
| Elastic.md: 7. Ordered by meaning | [Elastic](../7-integrations/Elastic.md), "Part three: ordering the recap's suggestions" | who talks to whom when the recap opens, and where the list comes from |
| Merch.md: 8. Merch | [Merch](../6-features/Merch.md), "From photo to order" | from a suggested photo on a template to a paid order |
| Insurance.md: 9. The claim during the event and 9b. The organizer decides | [Insurance](../6-features/Insurance.md), "During and after the event" | who acts on a claim during the event, and who acts after it |
| Insurance.md: 9a. The scripted claims run | [Insurance](../6-features/Insurance.md), "Test-Bands.md: the scripted claims run" | from Jordan's fall to Maya's claim settling under the rule the organizer's approval created |
| Bright-Data.md: 0a. Import | [Bright-Data](../7-integrations/Bright-Data.md), "One organisation, fetch to load" | for one exhibitor, from the first tool call to rows the indexer sees |

## Failure modes and fallbacks

Each step's failures belong to the doc that owns it. These are the ones that would stop the event flow in front of the judges, each with its one fallback.

| Failure during the event | Effect | Design answer |
|---|---|---|
| The judge presses after the 8 s window | The band claim expires | The screen says "No press arrived in time." and offers to claim again, which opens a new window ([Tap-Page](../5-apps/Tap-Page.md)). |
| Density readings flap in the taped square | Rings and the map disagree | An organizer turns on the override with `set_override` and drives the colours by hand with `force_state` from the SpacetimeDB command line, and the presenter says so ([Safety](../6-features/Safety.md)). |
| A sign-in email is slow | The judge waits on the sign-in page | SpacetimeDB SpacetimeAuth's sign-in page sends the link again, and the sign-in returns to the tap link ([Tap-Page](../5-apps/Tap-Page.md)). |
| After the event the judge's phone is not signed in | No recap on that phone | They open their tap link, sign in with the same email and get the same identity ([Tap-Page](../5-apps/Tap-Page.md)). |
| Test-Bands.md: the radio misbehaves in front of the judges | The hardware bands leave the map | The test bands carry on: the Bands tab walks them between zones and runs a fall on them, and the crowd keeps the map moving ([Test-Bands](../3-services/Test-Bands.md)). |
| Elastic.md: Elastic Kibana is slow at the close | Nothing to show on the Elastic side | The dashboards are saved with the project and show the saved import run ([Elastic](../7-integrations/Elastic.md)). |

## Dependencies

**Depends on:** every doc named in the step tables, and [Architecture](Architecture.md) for the parts.

**Used by:** [Requirements](Requirements.md) and [Architecture](Architecture.md) point here for the event flow.

**If you delete this file:** not intended; it is core. When you delete an optional feature, remove the rows that start with its file name from the step tables, the diagram index and the failure table, and its paragraph below the table of event steps (Test-Bands.md, Elastic.md).

## Decisions

| Decision | Why |
|---|---|
| The event runs an SOS and, separately, a fall | the SOS shows the button and the light circle; the fall shows the band's own detection and brings in the medic |
| The band press is used only to claim a band; nobody pays at the venue | the press keeps one meaning for the attendee: this band is mine |
| During the event the tap page is band setup, then a thank-you screen; the recap replaces it when the event ends | the band carries every safety cue, and the night comes back in the recap |
| The flows show happy paths only | each step has one path the team rehearses; failures stay in the owning docs, except the few above that would stop the event flow |
| The medic takes an incident with "Take it" in the incident desk | the medic knows whether they are free, and the incident then shows who is on it |
| During the event the medic is the only staff person apart from the organizers (`ops`): they take the incident, note the cost and resolve it | two staff roles cover the whole event, and nobody else needs a staff screen |
| A band in GUIDE chases its exit colour, and under low visibility a full band also pulses every 2 s | the ring cannot point, so colour and vibration are how a band moves its attendee to the door |
| The night comes back when an organizer (`ops`) presses "Event ended": every open page turns into the recap live, and the tap link reopens it later for the signed-in owner | one press by an organizer ends the night for everyone, with no email; the band's own URL is the way back |
| Test-Bands.md: the in-module crowd runs for the whole event | it lives in the module and needs no radio; the organizer portal redraws at most every 500 ms however many of its rows change, and its findable attendees give the venue map, the people graph and the recaps a real event's size |
| Social.md: the people graph is shown growing on the big screen during the event | a link is written in the same transaction as its visit or encounter, so the audience watches the graph grow as people move |
| Bright-Data.md: the import runs before the event, never during it | no step depends on a live scrape |
| Insurance.md: the fall in step 4 becomes the real claim; the medic files it during the event, and the organizer decides it after the event, once the scripted claims run (Test-Bands.md) is over | the medic works the venue and nobody decides money during the event; the scripted run starts with no rule, so the judges watch the system learn from the organizer's approval; the scorecard, the insurer's payment with its reconciliation difference and the refusal after reserve come from the accuracy run, so nobody types an insurer's entries in front of the judges |
| Elastic.md: Elastic Kibana is opened only after the after-event steps | the live screen is the organizer portal; Elastic Kibana shows only what Elastic holds |
