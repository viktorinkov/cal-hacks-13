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

Diagram labels use the same words as above. This is the single style guide for the main board, excerpts and generated exports. Other diagram references link here; edit these rules when the style changes.

1. A screen is: page name (route), using the real route or tab from `web/src`, for example organizer portal (/organizer, Claims), tap page (/t/code), recap (/t/code), photo page (/photo). A tab goes after the route, because the code has no /claims route.
2. A person is one word: attendee, medic, organizer, photographer, staff.
3. A code piece is its exact name only: `watch_bands`, `buy_merch`, `my_wallet`.
4. A product shows its logo as large artwork above its label. If the logo is a wordmark that says the name, the logo replaces the name text. If the logo is an icon alone, keep the name below it. Put the role in brackets as short text under the logo, at most two words, for example (Evidence Engine) or (wallet). Logos and images are big: the main thing on the frame, never a tiny inline brand icon. Use original photos and product images where they explain something useful. Never embed app screenshots. Use short labels when enough; redraw unclear relationships with native shapes and labeled arrows. Vector art is fine where no real image exists, such as a phone or a laptop, at the same big size.
5. A device is its short name: band, station marker, exit marker, gateway, venue laptop, security camera.
6. Every interaction gets a labeled arrow with a direction. Use 1 to 4 words naming the action or what flows. Keep exact call names where they are needed.
7. No sentences, no "the", no "in the", no possessives, no explanation in a box, no track or prize names. Keep implementation details such as hashes out of the diagrams.
8. A native frame label contains its two-digit board number and one name, never a sentence. Number the main board 01–19. Preserve the main board's names and numbers in excerpts: Claim Settlement is 08; Medic routing, Medic walk, Light circle and Exits are 16–19. Do not add a second title inside the frame or numbered badges on individual cards.
9. Make each frame visual with large logos, original images and useful illustrations. Put artwork above names. Use short labels where words explain enough; do not add an image just to decorate a card.
10. No placeholders: no TBD, TODO, "planned", "not built" or "?". Leave out any part that is not built.
11. No subtitle, caption or note under a frame title. The picture explains the frame.
12. Use Excalifont throughout: 48 px for card and zone labels, 40 px for arrow labels. Use the native frame label for the title.
13. Common artwork defaults are 128 px for icons and 200 px for a focal icon on a large card. Fit wordmarks within 520 px wide and 128 px high, preserving aspect ratio. Fit wide logos and multiple-image rows proportionally within their cards; do not stretch images or shrink them into inline decoration.
14. Plain cards have white backgrounds and outlines that retain their meaning by color. Keep colored zone backgrounds and good/bad accents where they convey meaning. Give every evidence item its own card.
15. Keep original images, logos and standalone maps where they explain something useful. The screenshot ban applies to every frame and excerpt.

Logos live in `diagrams/logos/`.
