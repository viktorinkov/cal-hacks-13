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

For Devpost only, use ordinary exact words and natural connected sentences; explain technical terms once, remove repeated explanations and mechanical first/second enumerations, and keep important facts. Preserve sponsor quotations, use one live-site URL in Try it out, and keep the closing disclosure brief. This writing preference does not override the diagram guide below.

Put “What it does” before “How it works.” Use product images and visuals in the first section, then technical diagrams and API suitability in the second. Keep the enclosure design in the technical hardware section.

Give sponsors detail in proportion to their substantive contribution, especially Elastic and SpacetimeDB. Explain the important technical insights without repeating earlier explanations or adding “this addresses the challenge” filler.

For the Devpost narrative, introduce sign-up in the opening and group the recap around people, photos and personal shopping. Order the product story as safety, social, shopping, then financial management. This does not change the established sponsor ranking or the board’s organization.

Name the final product section “Financial management for large events.” Keep its scope to the existing claims, charges, receipts, ledgers and merch booth accounting.

State the actual actor and action positively. Remove unprompted explanations of what does not happen when readers would already assume it. Keep necessary limits and consent boundaries, preferably as the behavior the system enforces.

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

1. **Make the artwork large.** Use original logos, useful photos and illustrations. Preserve their proportions and put labels below them. A wordmark already supplies the product name. Never put app screenshots in a diagram. Group operations inside one provider container when that clarifies ownership and avoids excessive repeated logos. This is a readability preference, not a one-logo limit: repeat a provider where separate contexts or clearer arrows make the flow easier to follow.
2. **Use soft colored fills and dark text.** Keep colors consistent for the same roles. Borders are subtle separators; color should be visible across the whole card. Keep failures red and successful outcomes green; workers should not look like errors.
3. **Keep property cells inside their parent.** Keep the main actor, component or object as a visible outer card. Replace a long property list with small filled text rectangles inside that card. Distinct actors and actual workflow or calculation stages may have their own cards and arrows; descriptive properties must not become artificial process steps. Related formula inputs and conditions belong inside their calculation group. Short labels may use several lines for one concept, and a coherent packet payload may stay together.
4. **Keep each frame focused.** Answer one question in a compact layout that reads at fit-to-frame. Put full job, view, field and timing inventories in documents. Refer to another frame's output instead of repeating its flow. There is no fixed diagram-count limit: keep distinct technical detail on the same board. Assess a diagram’s standalone visual value separately from whether it can merge with another. Prefer Devpost prose when a linear flow or parameter list adds little beyond text and the feature facts remain clear. Combine frames only when their shared question stays readable; preserve the agreed sponsor and hardware priorities.
5. **Keep labels readable and consistent.** Use Excalifont, short labels and the native frame title once. Preserve the board's two-digit frame numbers in excerpts. Do not add duplicate headings, subtitles or numbered card badges. Prefer plain phrases over unnecessary slash shorthand in prose labels; preserve meaningful slashes in API paths, URLs, units, formulas and code identifiers.
6. **Show who calls what.** Label directional arrows with the action or data. Use actual code names and page routes when needed, including the correct production portal route. Leave enough space around text and artwork.
7. **Explain the real behavior.** Show policy inputs and formulas for settlement amounts. Keep approved intended behavior; record code gaps and sponsor reasoning in the factual review instead of adding status placeholders to the drawing. Do not add track names or unsupported claims.
8. **Save each revision.** Preserve imported source boards unchanged. Keep editable checkpoints before major changes and publish reviewed updates promptly. Git and `.builds/diagram-history/` preserve saved versions, not every browser edit.

Logos live in `diagrams/logos/`.
