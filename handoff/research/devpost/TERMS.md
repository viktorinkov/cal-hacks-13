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
| The Evidence Engine | checked incident facts and policy evidence for claims | Evidence agent, search |
| Memories engine | photo tagging, sharing and event communities | Photos and Memories (diagram title) |
| Safety engine | local warnings, incident response and exit guidance | |
| the insurance Decision Engine | Elastic investigation with code-enforced approvals and settlement; Decision Engine in diagram titles | claims agent |
| Capital One Nessie | the bank sandbox behind each wallet | Nessie (alone) |
| wallet | the attendee's Capital One Nessie account in BandIt | account (alone) |
| findable switch | the one consent switch at sign-up | privacy toggle |

Coverage checks retrieve policy clauses. Past approved claims support separate precedent review and rule proposals. Elastic Workflows and Elastic Agent Builder coordinate model tasks; Claude can be the configured model, while Rust code and SpacetimeDB enforce decision and settlement boundaries.

Engine names describe product flows spanning the services they need. Use specific task names for each service's contribution within a flow.

The plain portal uses `/organizer` on `dev.band1t.vip` and `/portal` on the main site. The recap is implemented in the dev site's `/t/code` flow; the main site's attendee flow currently opens the separate registration frontend.

## Paragraphs

Viktor's standing rule: write short paragraphs, never long ones.

For Devpost only, use ordinary exact words and natural connected sentences; explain technical terms once, remove repeated explanations and mechanical first/second enumerations, and keep important facts. Preserve sponsor quotations and use one live-site URL in Try it out. This writing preference does not override the diagram guide below.

Put “What it does” before “How it works.” “What it does” explains general product behavior in nontechnical language: what attendees and organizers can do, what happens next and what they receive. Use product images, UI captures and simple behavior diagrams. The policy allocation example belongs here because it shows how costs are shared.

“How it works” explains the technical systems behind those behaviors: components, data flow, API calls, validation, authority and why each service fits its task. Put technical diagrams and the enclosure design here. Avoid repeating the product walkthrough.

Explain general behavior in the surrounding prose even when an image shows a specific claim or run. Keep case numbers, names, individual amounts and one-off evidence details inside the image or its source notes. Captions name the behavior shown; they do not retell the pictured case. Keep general formulas, enforced thresholds and relevant statistics where they explain the system or its purpose.

Give every Devpost image a visible heading with its reading-order number in parentheses. Usually give each image one to three paragraphs below it, but judge the total reading length by word length, word count and sentence count together. More than three very short paragraphs can work; one longer paragraph can be enough. Use less text when the visual needs little explanation. Explain the behavior, mechanism or result it shows; a repeated title or alt text is not enough. Save a new diagram with its numbered heading and explanation together so the shared document remains readable during edits.

Give sponsors detail in proportion to their substantive contribution, especially Elastic and SpacetimeDB. Explain the important technical insights without repeating earlier explanations or adding “this addresses the challenge” filler.

Keep sentences concise without making the article thin. Give each distinct feature enough explanation and useful visual detail to be understood. Expand sponsor sections with their substantive contributions, design choices and supported outcomes. Split a dense diagram into focused diagrams when that makes the system clearer; do not cut features to meet an arbitrary length or diagram count.

For the Devpost narrative, introduce sign-up in the opening and group the recap around people, photos and personal shopping. Order the product story as safety, social, shopping, then financial management. This does not change the established sponsor ranking or the board’s organization.

Name the final product section “Financial management for large events.” Keep its scope to the existing claims, charges, receipts, ledgers and merch booth accounting.

State the actual actor and action positively. Remove unprompted explanations of what does not happen when readers would already assume it. Keep necessary limits and consent boundaries, preferably as the behavior the system enforces.

Keep a comfortable reading length between useful images in feature and technical explanations. Judge words, sentence length and sentence count across section headings; headings do not remove that reading burden. Paragraph count is a guide, not a hard limit. Use a relevant diagram, product image or UI capture when it explains the next part of the flow, rather than adding decoration to satisfy a quota. Track entries and reference lists can remain text when their points are already illustrated elsewhere.

Preserve distinct product features when shortening text or images. Crowd-crush prevention, medic response and fire evacuation are separate behaviors; combine only repeated explanations of the same behavior. Meet the visual rhythm rule with a useful image or clearer grouping, never by deleting a feature.

1. Prefer short paragraphs. Judge their length from the words and sentences together, not a fixed count alone.
2. One idea per paragraph.
3. Explain the general behavior instead of narrating individual examples. Use a useful image for a concrete example when needed.
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
2. **Use soft colored fills and dark text.** Keep colors consistent for the same roles. Borders are subtle separators; color should be visible across the whole card. Parent cards and nested property cells need clear visual separation at normal article size. Avoid layers of similar green on green or orange on orange on yellow; use distinct light fills or a neutral parent with colored result cells. Keep failures red and successful outcomes green; workers should not look like errors. Preserve actual hardware signal colors in labeled signals even when surrounding card fills change.
3. **Keep property cells inside their parent.** Keep the main actor, component or object as a visible outer card. Replace a long property list with small filled text rectangles inside that card. Distinct actors and actual workflow or calculation stages may have their own cards and arrows; descriptive properties must not become artificial process steps. Related formula inputs and conditions belong inside their calculation group. Short labels may use several lines for one concept, and a coherent packet payload may stay together.
4. **Keep each frame focused.** Answer one question in a compact layout that reads at fit-to-frame. Put full job, view, field and timing inventories in documents. Refer to another frame's output instead of repeating its flow. Before creating a diagram, inspect the current board and saved exports; reuse an existing diagram that already answers the question, including the medic walk. There is no fixed diagram-count limit: keep distinct technical detail on the same board. Assess a diagram’s standalone visual value separately from whether it can merge with another. Prefer Devpost prose when a linear flow or parameter list adds little beyond text and the feature facts remain clear. Combine frames only when their shared question stays readable; preserve the agreed sponsor and hardware priorities.
5. **Keep labels readable and consistent.** Use Excalifont, short labels and the native frame title once. Preserve the board's two-digit frame numbers in excerpts. Do not add duplicate headings, subtitles or numbered card badges. Prefer plain phrases over unnecessary slash shorthand in prose labels; preserve meaningful slashes in API paths, URLs, units, formulas and code identifiers.
6. **Show who calls what.** Label directional arrows with the action or data. Use actual code names and page routes when needed, including the correct production portal route. Leave enough space around text and artwork.
7. **Explain the real behavior.** Show policy inputs and formulas for settlement amounts. Keep approved intended behavior; record code gaps and sponsor reasoning in the factual review instead of adding status placeholders to the drawing. Do not add track names or unsupported claims.
8. **Save each revision.** Preserve imported source boards unchanged. Keep editable checkpoints before major changes and publish reviewed updates promptly. Git and `.builds/diagram-history/` preserve saved versions, not every browser edit.

Independent flows do not belong together just because they use the same sponsor or API. Group them only when the diagram explains a shared decision, dependency or useful comparison. Otherwise, move each flow into its existing feature diagram or give a distinct question its own compact frame. Medic route display and crowd clearance need separate diagrams and explanations; reuse their existing artwork when splitting them. Show the task and outcome rather than a generic list of transport calls. Keep sponsor contributions visible where they do the work.

Logos live in `diagrams/logos/`.
