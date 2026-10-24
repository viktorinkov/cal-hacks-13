# Decisions

This is the decision log for choices that cut across several files. Each component file ends with its own Decisions table for choices that stay inside it. Every decision here is final for the demo; there are no open questions in this design. Rows that start with a file name belong to an optional feature and go away with that file.

## How BandIt is built

| Decision | Why | Where it shows |
|---|---|---|
| Safety decisions that matter in the first second are made on the band | a crowd crush or a fall cannot wait for a laptop, a radio hop or the internet | [Hardware](../4-devices/Hardware.md), [Safety](../6-features/Safety.md) |
| One SpacetimeDB module is the single source of truth for everything live | many writers and many screens must never disagree about a zone or an incident; reducers are transactions and subscriptions push every change | [SpacetimeDB](../2-data/SpacetimeDB.md) |
| Every backend service is Rust; only the two browser apps are TypeScript | one language for the module and the services, sharing generated types | [Rust-Backend](../3-services/Rust-Backend.md) |
| No reducer calls an external service; slow or external work is a `job` row done by a Rust worker | nothing on the safety path waits on the network | [SpacetimeDB](../2-data/SpacetimeDB.md), [Rust-Backend](../3-services/Rust-Backend.md) |
| Presence is zone-level only | the hardware knows which station marker is loudest, never a position | [Hardware](../4-devices/Hardware.md), [SpacetimeDB](../2-data/SpacetimeDB.md) |
| The design uses the firmware as it is; no firmware changes are proposed | the team is not working on the hardware | [Hardware](../4-devices/Hardware.md) |
| Bands point people along dispersion routes with exit colours and, on full bands, vibration | the bands have no compass; colour and vibration work in smoke and noise | [Safety](../6-features/Safety.md) |
| Each component lives in its own file and optional ones can be deleted | the team can drop a feature late without untangling the rest | [README](../README.md) |
| The design follows a few happy paths; an edge case stays only if it protects a person, a judge will see it, or it wins a sponsor track | a hackathon demo is judged on what works end to end | every file |
| Diagrams are Mermaid, rendered and checked before commit | GitHub renders them inline and they diff as text | [README](../README.md) |

## Deployment

| Decision | Why | Where it shows |
|---|---|---|
| The `bandit` database runs on SpacetimeDB Maincloud only; there is no standalone fallback | one deployment means one set of identities, one host and no switch-over during the demo | [Architecture](Architecture.md), [SpacetimeDB](../2-data/SpacetimeDB.md) |
| The demo laptop gets internet from a team phone's hotspot | venue Wi-Fi is the least reliable link at a hackathon, so it is off the critical path | [Architecture](Architecture.md) |
| `bandit-api`, `bandit-workers` and `bandit-indexer` run on one always-on Fly.io VM; `bandit-api` also serves both web apps from the same HTTPS origin | judges use their own phones on one public host written into the NFC tags, and the services keep running when the laptop sleeps | [Rust-Backend](../3-services/Rust-Backend.md) |
| Blobs are files on a Fly volume on that VM | one machine, no bucket to configure | [Rust-Backend](../3-services/Rust-Backend.md) |
| The laptop runs only what needs it: `bandit-bridge` (USB to the gateway), `bandit-sim` and the Ops dashboard; Vision.md: `bandit-vision` (TBD -- LEO); BrightData.md: `bandit-ingest` before the event | the gateway cable and the camera are physically there | [Architecture](Architecture.md) |

## Identity and attendee data

| Decision | Why | Where it shows |
|---|---|---|
| An attendee claims a band by tapping its sticker and pressing its button | one gesture the wearer learns once, and it proves they hold the band | [Attendee-App](../5-apps/Attendee-App.md) |
| No OAuth; one recap email after the event with a one-time sign-in link | the band is the identity during the event; the bands are handed back at the end, so one email whose link works once brings each attendee back to their recap page as their own identity | [Attendee-App](../5-apps/Attendee-App.md) |
| Social.md: attendees type their own social handles at onboarding, Meta only (Instagram, Facebook, Threads) | no verification flow to build; Meta is the sponsor track; people's social profiles are never scraped | [Social](../6-features/Social.md) |
| Social.md: there is no company field at onboarding; `works_at` comes from the import and a claimed profile | one less form field, and the company is already known for exhibitors and speakers | [Social](../6-features/Social.md) |
| Simulator.md: each simulated band has a simulated owner with a made-up name and Meta handles from the simulator's seed | the big-screen people graph shows a real-looking crowd, through the same social step as real bands | [Simulator](../3-services/Simulator.md) |
| BrightData.md: an attendee claims their scraped profile by picking it at onboarding and pressing their band | a happy path with no email round trip | [BrightData](../7-integrations/BrightData.md) |

## Sponsors and external services

| Decision | Why | Where it shows |
|---|---|---|
| SpacetimeDB holds live state and every write; Elastic.md: Elastic organizes scraped records and ranks by meaning, and never holds live state | each database is used for the problem it solves best | [Architecture](Architecture.md) |
| Social.md: the people graph's links live in SpacetimeDB; Elastic.md: "into the same things" links come from Elastic and are drawn dashed | measured links are exact, private and change live; similarity is meaning | [Social](../6-features/Social.md), [Elastic](../7-integrations/Elastic.md) |
| Elastic.md: the Workflow `bandit-organize` is the only organizer path; a failed run loads the last good bundle | one path to explain and to demo; the saved bundle keeps the demo safe | [Elastic](../7-integrations/Elastic.md) |
| Elastic.md: Elastic agents organize and validate data; judgments go to Claude | each agent does one kind of work | [Elastic](../7-integrations/Elastic.md), [Anthropic-Agent](../7-integrations/Anthropic-Agent.md) |
| Elastic.md: the team shows the Elastic side in Kibana (Workflows runs, Agent Builder, four dashboards) | it is the most visual way to show organizing and search, and it never repeats the live Ops dashboard | [Elastic](../7-integrations/Elastic.md) |
| Anthropic-Agent.md: every Claude call goes through `claude-client` with `claude-opus-5-5` | one client, one model, every call recorded | [Anthropic-Agent](../7-integrations/Anthropic-Agent.md) |
| BrightData.md: everything is fetched through the Bright Data Web MCP, starting from the start URLs in the event's seed; Cal Hacks 13.0 is the demo instance | one product and one token for pages, company facts and search; only the seed changes from one event to the next | [BrightData](../7-integrations/BrightData.md) |
| BrightData.md: the floor plan is read from its image by Claude and fixed by hand on the Ops map | one path that works for whatever image the event publishes | [BrightData](../7-integrations/BrightData.md) |
| Merch.md: merch is a few templates the team makes by hand before the event, with the attendee's own photo placed in each template's photo area by the app; no image API and no image generation anywhere | no AI or server rendering on the path to a sale, and any event loads its own templates | [Merch](../6-features/Merch.md) |
| Payments-Nessie.md: nothing is paid at the venue; each attendee gets a Nessie sandbox wallet, pays for merch from it in the app after the event, and receives settled claims into it | the README moves shopping to after the event; the claim payout landing on its own is the Nessie demo moment | [Payments-Nessie](../7-integrations/Payments-Nessie.md) |
| Hyphenate.md: insurance is shown as a claims agent that learns live: the first claim has no rule, a judge approves it as risk manager, and the next similar claim settles under the rule that approval created; code checks the facts and computes money, Claude reads the bill and explains causation, and every approval becomes a rule. An accuracy run on planted claims gives the scorecard, and the edge cases (stale approval, witnesses in another zone, injury at home, re-scanned duplicate bill, staff injury, refusal after reserve, a reconciliation difference) are shown, not described. The only fallback is a pre-seeded rule v1 | the finance track judges a system that decides money on its own and can prove it is right; a judge teaching it a rule shows both in one minute | [Hyphenate](../7-integrations/Hyphenate.md) |
| Hyphenate.md, Elastic.md: similar past claims come back from Elastic only as checks, as ids and scores written through a reducer, and never change an amount; the claim copy is de-identified | ranking by meaning is what Elastic does best, and money and live state stay in SpacetimeDB | [Hyphenate](../7-integrations/Hyphenate.md), [Elastic](../7-integrations/Elastic.md) |
| Vision.md: cameras and models are Leo's call (TBD -- LEO); the other files depend only on the interface | the vision hardware is not settled; the rest of the system does not wait on it | [Vision](../4-devices/Vision.md) |
