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
| organizer portal (/portal) | the plain organizer app on the main site | host portal, dashboard, ops dashboard |
| tap page (/t/code) | the page a band's NFC tag opens | band page, landing page |
| recap | the attendee's post-event people, places and photos | summary page, afterwards summary |
| light circle | the bands near a person in trouble, pulsing blue | witness ring, halo |
| incident | an SOS, a fall or damage the module records | alert (alone), event (alone) |
| security view | the camera software on the venue laptop | vision service, camera app |
| camera sighting | the security view's record of a flash on an incident | verdict, assessment |
| medical card | the attendee's own health information | medical ID, medical profile |
| hospital report | the hospital's report and itemized bill for a claim | clinic report, medical record, medical report |
| claim | an insurance claim the attendee files after an incident | case, request |
| evidence pack | a claim's numbered facts, checks and fingerprint | evidence bundle |
| The Evidence Engine | Elastic's indexed evidence, cited retrieval and semantic ranking | Evidence agent, search |
| the insurance Decision Engine | Elastic investigation with code-enforced approvals and settlement; Decision Engine in diagram titles | claims agent |
| Capital One Nessie | the bank sandbox behind each wallet | Nessie (alone) |
| wallet | the attendee's Capital One Nessie account in BandIt | account (alone) |
| findable switch | the one consent switch at sign-up | privacy toggle |

Coverage checks retrieve policy clauses. Past approved claims support separate precedent review and rule proposals. Elastic Workflows and Elastic Agent Builder coordinate model tasks; Claude can be the configured model, while Rust code and SpacetimeDB enforce decision and settlement boundaries.

The plain portal uses `/organizer` on `dev.band1t.vip` and `/portal` on the main site. The recap is implemented in the dev site's `/t/code` flow; the main site's attendee flow currently opens the separate registration frontend.

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

This is the single guide for the board, excerpts and exports. Use the names defined above.

1. **Make the artwork large.** Use original logos, useful photos and illustrations. Preserve their proportions and put labels below them. A wordmark already supplies the product name. Never put app screenshots in a diagram.
2. **Use soft colored fills and dark text.** Keep colors consistent for the same roles. Borders are subtle separators; color should be visible across the whole card. Keep failures red and successful outcomes green; workers should not look like errors.
3. **Keep each frame focused.** Answer one question in a compact layout that reads at fit-to-frame. Put full job, view, field and timing inventories in documents. Refer to another frame's output instead of repeating its flow.
4. **Keep labels readable and consistent.** Use Excalifont, short labels and the native frame title once. Preserve the board's two-digit frame numbers in excerpts. Do not add duplicate headings, subtitles or numbered card badges.
5. **Show who calls what.** Label directional arrows with the action or data. Use actual code names and page routes when needed, including the correct production portal route. Leave enough space around text and artwork.
6. **Explain the real behavior.** Show policy inputs and formulas for settlement amounts. Keep approved intended behavior; record code gaps and sponsor reasoning in the factual review instead of adding status placeholders to the drawing. Do not add track names or unsupported claims.
7. **Save each revision.** Preserve imported source boards unchanged. Keep editable checkpoints before major changes and publish reviewed updates promptly. Git and `.builds/diagram-history/` preserve saved versions, not every browser edit.

Logos live in `diagrams/logos/`.
