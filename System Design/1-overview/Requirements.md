# Requirements

BandIt must show, live at Cal Hacks 13.0, that one wristband can keep a crowd safe and then turn the night into memories, payments and settled claims. This file states what the system must do, how well, at what scale and under which constraints. Every other file is a design that meets these requirements; [Architecture](Architecture.md) shows how they fit together and [Flows](Flows.md) walks the event step by step.

## Goals

1. A crowd that gets too dense sees it on their own wrists, before anyone at the venue laptop reacts, and every exit has an exit marker glowing its colour to walk to.
2. An attendee in trouble (SOS or a fall) is found fast: the bands around them light up, staff see the incident, and a medic takes it.
3. Every screen, from the organizer portal (/organizer) and a medic's phone to the bands themselves, agrees on the state of the venue at every moment.
4. When an organizer (`ops`) ends the event, every attendee's tap page (/t/code) turns into their recap, which gives them their night back: where they went, who they met, their photos, and things to buy or claim.
5. Each sponsor integration is real, visible at the event, and removable without breaking the core.

## Functional requirements

Core requirements are what the safety features need. Rows that start with a file name belong to an optional feature and go away with that file.

| Id | The system must | Owner |
|---|---|---|
| F1 | Let an attendee sign in with a magic link and claim a band by tapping its NFC sticker with their phone and pressing the band's button, then finish a short setup that ends on a thank-you screen; during the event the tap page shows nothing more | [Tap-Page](../5-apps/Tap-Page.md) |
| F2 | Colour each band by the crowd density it senses, on the band itself, with no round trip to the module | [Hardware](../4-devices/Hardware.md) |
| F3 | Stand an exit marker at each exit, glowing that exit's colour, with one station marker and one exit colour per zone; show each zone's level from its bands' own neighbour counts; let a crowded band chase its exit colour | [Safety](../6-features/Safety.md) |
| F3a | (TBD -- LEO) Exit routing: send each zone's bands and exit marker the zone's exit colour, send a crowded zone's bands to the nearest calm zone's door, and route around a door organizers close | [Safety](../6-features/Safety.md) |
| F4 | Turn an SOS hold or a detected fall into an incident with its witnesses, and light a circle of bands around the attendee | [Safety](../6-features/Safety.md) |
| F4a | (TBD -- LEO) Medic approach: move the attendees around an incident toward another door while the medic walks in through theirs | [Safety](../6-features/Safety.md) |
| F5 | Show staff a live map, each zone's level, the open incidents and the controls the venue needs (a medic taking an incident, notes, resolve, low visibility) | [Organizer-Portal](../5-apps/Organizer-Portal.md) |
| F6 | Let organizers send any of the 13 band commands (forced states, exit colours, thresholds and the rest) from the SpacetimeDB command line, delivered within about a second | [Gateway-Bridge](../3-services/Gateway-Bridge.md) |
| F7 | Record each band's stays per zone over time (`zone_visit`), so memories can be derived | [SpacetimeDB](../2-data/SpacetimeDB.md) |
| F8 | Medical-Card.md: read the medical history and health insurance PDFs an attendee uploads in setup into one medical card, and give it to a medic who taps that attendee's band or asks from the organizer portal's incident desk | [Medical-Card](../6-features/Medical-Card.md) |
| F9 | Capital-One-Nessie.md: give each attendee a Capital One Nessie sandbox wallet when they connect it at the last setup step, let them buy merch from it with one tap after the event, pay settled claims into it, and show its balance as the exact sum of its movements | [Capital-One-Nessie](../7-integrations/Capital-One-Nessie.md) |
| F10 | Social.md: turn presence into visits and encounters, grow a live people graph, tag photos, and show on the recap the people you hung out with and their Meta socials | [Social](../6-features/Social.md) |
| F11 | Merch.md: put the attendee's own photo on a few hand-made templates, suggest them by the booths the attendee spent time at, and sell them from the recap after the event | [Merch](../6-features/Merch.md) |
| F12 | Insurance.md: turn an incident into an insurance claim on the venue's general liability policy and settle it like a claims team would: read the urgent-care bill and pay each line against a fee schedule in code, check the evidence, duplicates and coverage in code, have the Anthropic Claude API judge causation without touching any amount, send every claim with a complication to the organizer, who decides it after the event, learn a settlement rule from each approval so the next similar claim settles by itself, keep a ledger, draft the notice of loss in ACORD 3 layout, and measure all of it on planted claims | [Insurance](../6-features/Insurance.md) |
| F13 | Bright-Data.md: load any event's real organisations, booths, floor plan and schedule from its public pages, given as start URLs in the event's seed | [Bright-Data](../7-integrations/Bright-Data.md) |
| F14 | Elastic.md: organize the scraped records into one checked bundle, and order each attendee's recap suggestions by meaning | [Elastic](../7-integrations/Elastic.md) |
| F15 | Vision.md (TBD -- LEO): show in the security view where a band calling for help is, from its flash on the security camera; count people from a security camera and confirm falls from frames | [Vision](../4-devices/Vision.md) |
| F16 | Test-Bands.md: run a crowd of up to 2,000 crowd bands (1,000 at the event) inside the module and ten test bands that report into the same tables as real ones | [Test-Bands](../3-services/Test-Bands.md) |
| F17 | When an organizer (`ops`) presses "Event ended", turn every open tap page into the recap live, and reopen it from the tap link for the band's signed-in owner on any phone | [Tap-Page](../5-apps/Tap-Page.md) |

## Non-functional requirements

| Quality | Target | How the design meets it |
|---|---|---|
| Band-local reaction | Density colour, SOS strobe and light circle within about 100 ms (one beacon interval) | decided on the band by the firmware ([Hardware](../4-devices/Hardware.md)) |
| Incident to staff | SOS or fall visible on the organizer portal within about 1 s | `band1t-bridge` forwards the flag change at once, `watch_bands` runs every 500 ms, and the subscription pushes the incident ([Safety](../6-features/Safety.md)) |
| Module to bands | A command on the bands within about 1 s | `band1t-bridge` sends each new `command` row at once, one at a time, waiting up to 400 ms for the gateway's ack, and the gateway sends it 3 times ([Gateway-Bridge](../3-services/Gateway-Bridge.md)) |
| Consistency | No two screens disagree about a zone's level or an incident's state | one module is the single source of truth; every change is a reducer transaction, and every screen works out a zone's level from the same rows ([SpacetimeDB](../2-data/SpacetimeDB.md)) |
| Safety without the module | Density colours, SOS and the light circle keep working if the venue laptop, the gateway or the internet fail | safety decisions that matter in the first second live on the band |
| Access | An attendee sees only their own data; Medical-Card.md: a medic sees a medical card by tapping the band, and every tap is logged | one sign-in (the SpacetimeDB SpacetimeAuth magic link) and per-caller views enforced inside the module |
| External services | No external service is ever on the safety path | every external call is made by a Rust worker, never by a reducer ([Rust-Backend](../3-services/Rust-Backend.md)) |
| Deletability | Any optional feature can be removed by deleting its file and the rows that name it | optional features add their own tables and reducers; core files mention them only in rows that start with the file name |

## Scale

BandIt is sized for the event, with headroom.

| Quantity | Value | Consequence |
|---|---|---|
| Real bands | 9 (6 lite, 3 full with fall detection) | the radio channel is lightly loaded |
| Station markers | one per zone, each standing at an exit of the venue; up to 5 (station ids 101 to 105) | zone-level presence only, never x/y; a band's zone is the one around its nearest door |
| Gateway | 1 (id 200) on USB to the venue laptop | one bridge process |
| Beacons | 10 per second per band, plus one heard list per second | about 100 serial lines per second from the real fleet |
| Test-Bands.md: crowd and test bands | up to 2,000 crowd bands (ids from 100; 1,000 at the event) and 10 test bands (ids 90 to 99) | the crowd moves inside the module every 2 s and writes only the bands that changed; the test bands report once a second through `report_test_band`, about 10 reducer calls per second |
| Real band reports to the module | each band at most once a second unless its line changed, plus its heard list once a second | about 20 reducer calls per second from `band1t-bridge` |
| Incident watch | `watch_bands` every 500 ms | a band's flag becomes an incident within half a second |
| Clients | 1 organizer portal on the big screen, the organizer portal on a few medics' phones, tens of attendee phones | subscriptions carry only changes |

## Constraints

- The hardware is fixed: XIAO ESP32-C3 bands, ESP-NOW on Wi-Fi channel 1, zone-level presence from station markers, no compass and no positions ([Hardware](../4-devices/Hardware.md)).
- The module and every service are Rust; only the two browser apps are TypeScript ([Rust-Backend](../3-services/Rust-Backend.md)).
- The module runs on SpacetimeDB Maincloud; the venue laptop gets internet from a team phone's hotspot ([Decisions](Decisions.md)).
- It runs first at a hackathon, Cal Hacks 13.0: the design follows a few clear happy paths, and an edge case is kept only when it protects a person, is something judges see at the event, or wins a sponsor track.

## Out of scope

Effort estimates, build instructions, paying at the venue, firmware changes (the design uses the firmware as it is), social networks other than Meta's, tagging people on social networks, false-alarm cancelling, privacy policy and legal text, synthetic-data concerns, clock synchronisation, positions finer than a zone, more than one gateway, and scraping people's social profiles (attendees type their own handles at onboarding).
