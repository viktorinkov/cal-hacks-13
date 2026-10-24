# Requirements

BandIt must show, live at Cal Hacks 13.0, that one wristband can keep a crowd safe and then turn the night into memories, payments and settled claims. This file states what the system must do, how well, at what scale and under which constraints. Every other file is a design that meets these requirements; [Architecture](Architecture.md) shows how they fit together and [Flows](Flows.md) walks the event step by step.

## Goals

1. A crowd that gets too dense sees it on their own wrists and is guided to a clear exit, before anyone at a laptop reacts.
2. A person in trouble (SOS or a fall) is found fast: the bands around them light up, staff see the incident with its witnesses, and a medic takes it.
3. Every screen (staff dashboard, medic phone, the bands themselves) agrees on the state of the venue at every moment.
4. When a staff member with `ops` ends the event, every attendee's page turns into their recap, which gives them their night back: where they went, who they met, their photos, and things to buy or claim.
5. Each sponsor integration is real, visible at the event, and removable without breaking the core.

## Functional requirements

Core requirements are what the safety features need. Rows that start with a file name belong to an optional feature and go away with that file.

| Id | The system must | Owner |
|---|---|---|
| F1 | Let an attendee sign in with a magic link and claim a band by tapping its NFC sticker with their phone and pressing the band's button, then finish a short setup that ends on a thank-you screen; during the event the attendee page shows nothing more | [Attendee-App](../5-apps/Attendee-App.md) |
| F2 | Colour each band by the crowd density it senses, on the band itself, with no server round trip | [Hardware](../4-devices/Hardware.md) |
| F3 | Compute density and risk per zone, give each zone an exit colour that bands and station markers show, and buzz the full bands when guidance starts | [Safety](../6-features/Safety.md) |
| F3a | (TBD -- LEO) Choose each zone's exit along `zone_link` paths, the dispersion route, and reroute the zones around an exit that staff block | [Safety](../6-features/Safety.md) |
| F4 | Turn an SOS hold or a detected fall into an incident with its witnesses, light and buzz a circle of bands around the person, and escalate if nobody acknowledges | [Safety](../6-features/Safety.md) |
| F5 | Show staff a live map, the fleet, incidents and controls (acknowledge, a medic taking an incident, low visibility, override) | [Ops-Dashboard](../5-apps/Ops-Dashboard.md) |
| F6 | Let staff force states, exit colours and prompts on bands, delivered within about a second | [Gateway-Bridge](../3-services/Gateway-Bridge.md) |
| F7 | (TBD -- LEO) Record zone-level presence over time, the space-time mapping, so the night can be replayed and memories derived | [SpacetimeDB](../2-data/SpacetimeDB.md) |
| F8 | Medical-ID.md: read the medical history and health insurance PDFs an attendee uploads in setup into one medical card, and give it to a medic who asks for it from the Ops dashboard's incident desk for the band of someone in an open `sos` or `fall` incident | [Medical-ID](../6-features/Medical-ID.md) |
| F9 | Payments-Nessie.md: give each attendee a Nessie sandbox wallet when they connect it at the last setup step, let them buy merch from it with one tap after the event, pay settled claims into it, and show its balance as the exact sum of its movements | [Payments-Nessie](../7-integrations/Payments-Nessie.md) |
| F10 | Social.md: turn presence into visits and encounters, grow a live people graph, tag photos, and show on the recap the people you hung out with and their Meta socials | [Social](../6-features/Social.md) |
| F11 | Merch.md: put the attendee's own photo on a few hand-made templates, suggest them by the booths the attendee spent time at, and sell them from the recap page after the event | [Merch](../6-features/Merch.md) |
| F12 | Insurance.md: turn an incident into an insurance claim on the venue's general liability policy and settle it like a claims team would: read the urgent-care bill and pay each line against a fee schedule in code, check the evidence, duplicates and coverage in code, have Claude judge causation without touching any amount, send every claim that no learned rule settles to the organizer, who decides it after the event, learn a settlement rule from each approval so the next similar claim settles by itself, keep a ledger, draft the notice of loss in ACORD 3 layout, and measure all of it on planted claims | [Insurance](../6-features/Insurance.md) |
| F13 | BrightData.md: load any event's real organisations, booths, floor plan and schedule from its public pages, given as start URLs in the event's seed | [BrightData](../7-integrations/BrightData.md) |
| F14 | Elastic.md: organize the scraped records into one checked bundle, and order each attendee's recap suggestions by meaning | [Elastic](../7-integrations/Elastic.md) |
| F15 | Vision.md (TBD -- LEO): count people from a camera and confirm falls from frames | [Vision](../4-devices/Vision.md) |
| F16 | Simulator.md: run a crowd of up to 80 crowd bands inside the module and ten simulated bands that report into the same tables as real ones | [Simulator](../3-services/Simulator.md) |
| F17 | When a staff member with `ops` presses "Event ended", turn every open attendee page into the recap page live, and reopen it from the tap link for the band's signed-in owner on any device | [Attendee-App](../5-apps/Attendee-App.md) |

## Non-functional requirements

| Quality | Target | How the design meets it |
|---|---|---|
| Band-local reaction | Density colour, SOS strobe and light circle within about 100 ms (one beacon interval) | decided on the band by the firmware ([Hardware](../4-devices/Hardware.md)) |
| Incident to staff | SOS or fall visible on the dashboard within about 0.75 s | one bridge batch (250 ms) plus one transaction, pushed by subscription ([Safety](../6-features/Safety.md)) |
| Server to bands | A forced state or exit colour on the bands within about 1 s | one bridge pass plus three radio repeats ([Gateway-Bridge](../3-services/Gateway-Bridge.md)) |
| Consistency | No two screens disagree about a zone's risk or an incident's state | one database is the single source of truth; every change is a reducer transaction ([SpacetimeDB](../2-data/SpacetimeDB.md)) |
| Safety without servers | Density colours, SOS and the light circle keep working if the laptop, the gateway or the internet fail | safety decisions that matter in the first second live on the band |
| Access | An attendee sees only their own data; a medic sees a medical card only during an open incident | one sign-in (the SpacetimeAuth magic link) and per-caller views enforced inside the database |
| External services | No external service is ever on the safety path | every external call is made by a Rust worker, never by a reducer ([Rust-Backend](../3-services/Rust-Backend.md)) |
| Deletability | Any optional feature can be removed by deleting its file and the rows that name it | optional features add their own tables and reducers; core files mention them only in rows that start with the file name |

## Scale

BandIt is sized for the event, with headroom from the simulator.

| Quantity | Value | Consequence |
|---|---|---|
| Real bands | 9 (6 lite, 3 full with fall detection) | the radio channel is lightly loaded |
| Station markers | 2 to 5 (ids 101 to 105), one per zone | zone-level presence only, never x/y |
| Gateway | 1 (id 200) on USB to the venue laptop | one bridge process |
| Beacons | 10 per second per band | about 90 serial lines per second from the real fleet |
| Simulator.md: crowd and simulated bands | up to 80 crowd bands (ids 10 to 89) and 10 simulated bands (ids 90 to 99) | the crowd moves inside the module every 5 s and sends no reports; the simulated bands report once a second through `report_sim_band`, about 10 reducer calls per second |
| Real band reports to the module | one batch every 250 ms | 4 reducer calls per second from the bridge |
| Venue tick | every 500 ms | zone state and exits recomputed twice a second |
| Clients | 1 Ops dashboard on the big screen, the Ops dashboard on a few medics' phones, tens of attendee phones | subscriptions carry only changes |

## Constraints

- The hardware is fixed: XIAO ESP32-C3 bands, ESP-NOW on Wi-Fi channel 1, zone-level presence from station markers, no compass and no positions ([Hardware](../4-devices/Hardware.md)).
- Every backend service is Rust; only the two browser apps are TypeScript ([Rust-Backend](../3-services/Rust-Backend.md)).
- The database is SpacetimeDB on Maincloud; the venue laptop gets internet from a team phone's hotspot ([Decisions](Decisions.md)).
- It runs first at a hackathon, Cal Hacks 13.0: the design follows a few clear happy paths, and an edge case is kept only when it protects a person, is something judges see at the event, or wins a sponsor track.

## Out of scope

Effort estimates, build instructions, paying at the venue, firmware changes (the design uses the firmware as it is), social networks other than Meta's, tagging people on social networks, false-alarm cancelling, privacy policy and legal text, synthetic-data concerns, clock synchronisation, positions finer than a zone, more than one gateway, and scraping people's social profiles (attendees type their own handles at onboarding).
