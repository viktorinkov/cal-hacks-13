# How your photos find you

This product illustration answers: **How does a photographer's photo reach my recap without identifying my face?** It belongs in **What it does → Your recap → People and photos**, next to the current recap screenshot. The technical **Memories engine** drawing remains in **How it works**.

## Verified behavior

Checked against fetched `origin/vik-e2e`, commit `219d48e079651fc5851e32cf0cb172eebededa57`, on 2026-10-25. A separate read-only agent independently traced the same path.

| Visible statement | Code evidence |
| --- | --- |
| Photographer adds a photo and chooses its event area. | `web/src/pages/photo.ts:17–21,38` uploads the file, reads the selected zone, and calls `registerPhoto`. |
| Time is recorded when added. | `web/src/pages/photo.ts:21` passes `Timestamp.now()` as `takenAt`. |
| Bands in that area and time suggest who appears. | `spacetimedb/server/src/social/photos.rs:24–62` considers worn bands with a zone visit covering the recorded time. It ranks claimed attendees before the crowd, then recent band proximity, then arrival time. |
| Image analysis supplies a people count and caption. | `crates/bandit-workers/src/photo.rs:36–41,59–68,114` uses the Elastic image model with count and caption output fields. The prompt forbids names and appearance guesses. |
| Tags are estimates. | The matching path ranks location/proximity candidates. It does not establish who appears through visual identity matching. |
| New matches need Findable. | `spacetimedb/server/src/social/photos.rs:39` filters candidates by current findable status. |
| Matching photos appear in the attendee's recap. | `spacetimedb/server/src/social/views.rs:360–386` selects photos tagged to the caller and adds other currently findable attendees' names/socials. |
| Image analysis does not identify faces. | `crates/bandit-workers/src/photo.rs:36–41,59–68` requests a count and caption, with no identity output or facial identity matching in this path. Images are processed. |

## Implementation gap kept visible

The photographer page uses upload time as capture time. Delayed uploads can therefore match the wrong zone visit. The separate EXIF importer in `pipeline/photos.py` does not supply this portal's `register_photo` call. The visual accurately says **Time is recorded when added**. Root was notified that a capture-time input or metadata path is an implementation gap, not a reason to weaken the approved photo feature.

The fixed final 20-tag cap was removed in `8df0b18`. Registration still starts with eight provisional candidates, and the worker validates a people count from 0 through 200. The illustration makes no unlimited-tag claim.

Findable prevents selection for new matches and filters names/socials shown to other attendees. Turning it off does not erase the original photo or existing stored photo tags. The illustration makes no deletion or anonymity promise.

## Suggested article copy

**Title:** How your photos find you

The photographer adds a photo and chooses its event area. Band1t combines nearby band records with a people count from the image to suggest who appears. Matching photos reach attendees' recaps, and Findable controls new matches.

Use the illustration to carry the privacy explanation; do not repeat its full text in the article. Keep the safety sensing explanation separate.

## Source and export

- `social-photo-flow.excalidraw` is the editable native scene, with 30 elements and three embedded original vector illustrations.
- `make_social_photo_visual.py` builds the scene and its original SVG artwork without touching the shared diagram generator.
- `photographer-illustration.svg`, `nearby-bands-illustration.svg`, and `recap-photo-illustration.svg` are original filled vector art made for this visual. They are not app screens, photographs, or a physical hardware rendering.
- Final SVG and PNG are exported through the official Excalidraw 0.18 renderer. The manual SVG in the generator is only a fallback preview.
- The native frame title appears once on the board. The article's numbered image heading is assigned by its integration owner.
- Board publication is owned by `diagram_restructure`; this standalone scene is an editable source, not a competing current board.

## Independent review

`diagram_asset_check` inspected the final PNG, native source, all three original illustration files, and code evidence. Final visual review passed with the label **New matches need Findable**. The reviewer confirmed readable text, no overlap or clipping, complete frame/image references, no screenshot content, and matching provenance hashes. The reviewer made no edits.
