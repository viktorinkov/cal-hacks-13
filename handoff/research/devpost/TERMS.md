# BandIt write-up terms

Use one word for one thing in devpost.md and on the diagrams. Define each term once, at its first use, in under ten words.

| Use | Means | Do not use |
| --- | --- | --- |
| attendee | a person at the event who wears a band | guest, user, wearer, visitor |
| organizer | the event staff who run the organizer portal | host, ops, admin (`ops` only as a code name) |
| medic | staff who treat people at the event | paramedic, responder |
| photographer | staff who take event photos | |
| band | the BandIt wristband | bracelet, wearable, device |
| station marker | the radio device that beacons its id so each band picks its zone. Use it for hardware, radio and zones | beacon station, anchor, zone marker |
| exit marker | the same device in its job at the door, glowing that exit's color. Use it for guidance and the nearest exit | exit beacon, exit station |
| security cameras | the cameras throughout the venue, each covering one zone, that feed the security view | security room camera, venue camera |
| zone | the area around one station marker | area, region, room |
| gateway | the USB radio that hears every band | receiver, hub |
| `band1t-bridge` | the program that passes gateway lines to the module | bandit-bridge, bridge service |
| the module | our SpacetimeDB module on Maincloud | backend, server, database (alone) |
| organizer portal (/organizer) | the organizer's web app | host portal, dashboard, ops dashboard |
| tap page (/t/code) | the page a band's NFC tag opens | band page, landing page |
| recap | the tap page after the event ends | summary page, afterwards summary |
| light circle | the bands near a person in trouble, pulsing blue | witness ring, halo |
| incident | an SOS, a fall or damage the module records | alert (alone), event (alone) |
| security view | the camera software on the venue laptop | vision service, camera app |
| camera sighting | the security view's record of a flash on an incident | verdict, assessment |
| medical card | the attendee's own health information | medical ID, medical profile |
| hospital report | the hospital's report and itemized bill for a claim | clinic report, medical record, medical report |
| claim | an insurance claim the attendee files after an incident | case, request |
| evidence pack | a claim's numbered facts, checks and fingerprint | evidence bundle |
| The Evidence Engine | Elastic's part: past claims, recap ranking, event setup and the raw data | Evidence agent, search |
| the insurance Decision Engine | Claude plus the Rust code that decides insurance claims | claims agent, Decision Engine (alone) |
| Capital One Nessie | the bank sandbox behind each wallet | Nessie (alone) |
| wallet | the attendee's Capital One Nessie account in BandIt | account (alone) |
| findable switch | the one consent switch at sign-up | privacy toggle |

## Paragraphs

Viktor's standing rule: write short paragraphs, never long ones.

1. At most 3 sentences per paragraph.
2. One idea per paragraph.
3. Each example gets its own small paragraph.
4. No long numbered step lists in prose. A flow of many steps belongs in a diagram.

## APIs and services

Always name the company and then the API or product, every time, never the bare product name:

- Anthropic Claude API
- Capital One Nessie API
- Bright Data Web MCP, Bright Data Web Unlocker API, Bright Data SERP API, Bright Data Browser API
- Elastic Agent Builder, Elastic Workflows, Elastic ES|QL
- SpacetimeDB Maincloud, SpacetimeDB SpacetimeAuth
- Vultr Cloud Compute

## Diagrams

Diagram labels use the same words as above.

1. A screen is: page name (route), for example organizer portal (/organizer, Claims), tap page (/t/code). A tab goes after the route, because the code has no /claims route.
2. A person is one word: attendee, medic, organizer, photographer.
3. A code piece is its exact name only: `watch_bands`, `buy_merch`.
4. A product shows its logo. If the logo is a wordmark that says the name, the logo replaces the name text. If the logo is an icon alone, keep the name beside it. Put the role in brackets as short text under the logo, for example (Evidence Engine) or (wallet). Logos and images are big: the main thing on the frame, never a small icon. Use original photos and product images instead of a box with words. Never embed app screenshots. Use short labels when enough; redraw unclear relationships with native shapes and labeled arrows. Vector art is fine where no real image exists, such as a phone or a laptop, at the same big size.
5. A device is its short name: band, station marker, exit marker, gateway, venue laptop, security camera.
6. An arrow label names what flows, in 1 to 4 words, plus the call name in code font when there is one. Every interaction gets a labeled arrow with a direction.
7. No sentences, no "the", no possessives, no track or prize names.
8. A frame title is one name, never a sentence: "BandIt", "Hardware", "Vision". Not "How BandIt fits together".
9. Make each frame visual. If an icon, a logo or a small picture can replace words on a box, use it. Text stays only for names and arrow verbs.
10. No placeholders: no TBD, TODO, "planned" or "?". Leave out any part that is not built.
11. No subtitle, caption or note under a frame title. The picture explains the frame.

Logos live in diagrams/logos/. The diagram generator keeps its own copy of these rules in diagrams/generator/LABELS.md.
