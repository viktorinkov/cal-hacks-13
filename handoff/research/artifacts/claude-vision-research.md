# BandIt vision with Claude

Saved from https://claude.ai/artifact/WWVwdxFACeR8Sgq2Mt7vm4, last updated 2026-10-24.

## Recommendation

Let a dedicated detector do the frame-by-frame work and let Claude judge events. YOLO person detection and pose run on the laptop on every frame, about 40 ms a frame on CPU for the nano pose model ([Ultralytics](https://docs.ultralytics.com/tasks/pose/)). When a band or YOLO flags a fall, a Rust worker sends Claude Opus 5.5 a few frames, the YOLO boxes and the band data, then writes Claude's verdict and report into SpacetimeDB.

- YOLO gives exact boxes, head counts and body keypoints at camera speed. Claude takes seconds per frame and counts only approximately.
- Claude adds what a detector cannot: deciding whether it was a fall or someone sitting down, whether a crowd is closing in, and writing the staff and insurance report. That is the "final agent" in your plan doc, and the Anthropic story.
- Claude takes images only, no video, and will not identify people by face. The bands do the identifying (zone, time, LED colour).
- Neither model is in the real-time safety path. Bands alert nearby bands directly; YOLO and Claude confirm and report afterwards.

## Vision jobs and track fit

Four vision jobs come out of the README and the hardware handoff; the first two carry the pitch.

| Vision job | What the vision does | Tracks it strengthens |
| --- | --- | --- |
| Pit density check (overhead phone camera) | YOLO (or a crowd-counting model at high density) counts people on every frame: ground truth next to the bands' own count, and the handoff's Plan B if radio counting is unstable. Claude looks only when a zone spikes or an SOS light circle needs confirming. | Best People-First Social Impact, Microsoft Built for the Real World, Best Hardware Hack, SpacetimeDB |
| Fall and SOS evidence | When a band flags a fall or SOS, reads the frames around that moment, confirms or rejects the fall, and writes the incident report. Same pipeline for property damage, such as a knocked-over speaker. | Anthropic, Hyphenate (insurance and claims), People-First |
| Photographer photo tagging | Reads each event photo: how many people, where they stand, which LED colours show. Combined with band zone and time, that gives who is in it. | Meta Bringing People Closer Together with AI |
| Merch picks | Chooses each attendee's best photos and writes captions and design text. It cannot draw the merch itself (see the model table). | Visa Reimagining Shopping |

Devpost lists no Anthropic prize; Anthropic appears only as an anchor sponsor ([Devpost](https://cal-hacks-13-0.devpost.com/)). Your plan doc names the track "Community-centered Claude application", so confirm the exact wording and judging at the Anthropic table. Crowd safety for event-goers fits a community-centered brief well. No prize targets vision itself: Bitdeer Model Studio hosts general vision chat models but no detectors ([catalog](https://developers.bitdeer.ai/docs/api/models-catalog)), Gemini is an MLH swag prize, and the MLH Vultr prize (cloud GPUs) fits only if you host detection for many camera streams.

## Model per job

YOLO handles every frame from every camera for free; Claude Opus 5.5 is called only on events, so its cost grows with incidents, not cameras.

| Job | Trigger | Model and settings | Input | Cost per call (approx.) |
| --- | --- | --- | --- | --- |
| People count and fall candidates | Every frame, every camera | YOLO26n person + pose (ONNX or CoreML); a crowd-counting model for packed zones | Camera frames | free, runs locally |
| Fall or SOS verdict + report | Band flag 1 or 2, or a YOLO pose that goes horizontal | `claude-opus-5-5`, effort `medium`, JSON schema output, `fallbacks: "default"` | 6 to 8 frames from the cameras covering that zone, YOLO boxes drawn on, plus band rows as JSON | about $0.06 |
| Property damage | Staff button on the dashboard | Same as fall | Frames from the chosen camera | about $0.06 |
| Photo tagging | Photographer upload | `claude-opus-5-5`, effort `medium`; Batch API (50% off) for bulk after the event | Photo at up to 2,576 px, YOLO person boxes, candidate bands for that zone and time | about $0.03 |
| Merch picks | End of event | `claude-opus-5-5` | Tagged photos + the attendee's summary | about $0.05 |

Costs assume Opus 5.5 list prices ($4 in / $20 out per million tokens) and image tokens from the formula in the next section. Drawing YOLO's boxes on the frames before sending lets Claude refer to each person without recounting.

Settings that bite on these models:

- Opus 5.5 cannot turn thinking off; lower effort instead, and read the answer block by `type`, not `content[0]`.
- Forced `tool_choice` returns a 400 on Opus 5.5. Get JSON from `output_config.format` with a JSON schema instead.
- Check `stop_reason` before reading output. `fallbacks: "default"` (beta header `server-side-fallback-2026-07-01`) retries a refusal on another model.
- Claude cannot generate or edit images. For merch, composite the chosen photos onto templates in Rust (the `image` crate) or use an image-generation model from another provider, then send the file to a print-on-demand service.

## Claude API facts that shape the design

No limit here blocks the plan; latency and per-frame cost rule Claude out of the frame loop, which is why YOLO handles frames and Claude handles events.

| Topic | Fact | What it means for BandIt |
| --- | --- | --- |
| Input | JPEG, PNG, GIF, WebP; animated images use only the first frame; no video input ([vision](https://platform.claude.com/docs/en/build-with-claude/vision)) | Send JPEG frames taken at intervals, labelled "Frame 1 (t−4 s)" and so on |
| Image size | Up to 8000×8000 px and 10 MB each; 32 MB per request; past 20 images, keep each at 2000 px or less | Resize to 1280×720 before sending |
| Images per request | Up to 600 | An 8-frame incident bundle fits easily |
| Image tokens | ceil(w/28) × ceil(h/28); Claude 4.7 and later downscale to 2,576 px on the long edge, at most 4,784 tokens | 1280×720 = 1,196 tokens; 1920×1080 = 2,691 |
| Metadata | Claude does not receive EXIF or other image metadata | Parse capture time in Rust (`kamadak-exif`) |
| People | Claude will not name people from images; counts of many small objects are approximate | Identity comes from bands; ask for counts per grid cell |
| Rate limits | Start tier: 1,000 requests, 2M input and 400k output tokens per minute per model; cache reads do not count toward input ([rate limits](https://platform.claude.com/docs/en/api/rate-limits)) | Event-only calls stay far below this; per-frame calls on 50 cameras would use all 1,000 requests. New accounts may start on a lower, unpublished Evaluation tier |
| Latency | No official seconds. Haiku 5.5 is ranked fastest. Artificial Analysis measured about 6.6 s to the first answer token for Haiku 5.5 at low effort on 10k-token text prompts ([AA](https://artificialanalysis.ai/models/claude-haiku-5-5-low/providers)) | Measure with your frames on Saturday; expect a few seconds per call |
| Batches | 50% off, most finish within an hour, max 24 h ([batches](https://platform.claude.com/docs/en/build-with-claude/batch-processing)) | Use for after-event photo tagging, not live alerts |
| Files API | Upload an image once, reuse it by `file_id`; 500 MB per file ([files](https://platform.claude.com/docs/en/build-with-claude/files)) | Upload each event photo once for tagging and merch |
| Caching | Image blocks can be cached; minimum prefix 512 tokens on these models; reads cost 10% of input ([caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)) | Matters little at event-only volume; worth it if a long venue briefing goes in every prompt |
| API version | `anthropic-version: 2026-10-21`; `temperature`, `top_p` and `top_k` return a 400 on every model ([migration](https://platform.claude.com/docs/en/api/migration-2026-10-21)) | Leave sampling parameters out of the request |

## Architecture: Rust worker, SpacetimeDB, Claude

A Rust vision worker on the laptop owns the cameras, runs YOLO on every frame and makes the Claude calls; SpacetimeDB holds the state everyone else reads.

**Diagram: BandIt vision architecture · Rust worker, SpacetimeDB, Claude**

What it shows: Claude confirms and reports; the bands raise the alarm.

Text in the diagram, in drawing order:

- Claude confirms and reports; the bands raise the alarm
- Bands + gateway
- ESP-NOW beacons, 10 Hz
- alert nearby bands directly
- JSON lines over USB serial
- Cameras
- overhead phone + venue cameras
- each mapped to band zones
- Photographer
- uploads event photos
- EXIF holds capture time
- Rust bridge
- parses gateway JSON lines
- calls SpacetimeDB reducers
- sends cmd lines back
- Rust vision worker
- keeps a 10 s frame ring buffer per camera
- resizes to 1280×720, reads EXIF, stamps laptop time
- YOLO person + pose on every frame; Claude on flags only
- SpacetimeDB
- tables: band_state, incident, pit_reading, camera, photo_tag
- frames kept on disk; rows hold file paths and thumbnails
- live state for the dashboard
- Claude Messages API
- Opus 5.5, events only
- fall verdict, report, photos
- JSON schema output
- Dashboard
- heatmap, SOS, incidents
- manual override button
- beacons up, cmds down
- frames
- photos
- reducers
- subscribes, writes results
- frames in
- JSON out
- subscribes

The worker subscribes to new `incident` rows, sends the matching frames to Claude, and writes the result back through a reducer, so the dashboard updates live. YOLO's per-zone counts go into `pit_reading` the same way.

Why a worker and not a SpacetimeDB procedure:

- Procedures can make HTTP calls (`ctx.http`, 30 s default timeout, up to 180 s), but they block private and loopback addresses, so they cannot reach cameras on the laptop or LAN ([procedures](https://spacetimedb.com/docs/functions/procedures)).
- An API key in the module's environment is stored in plain text and visible to collaborators.
- Large image rows slow commits and subscriptions; SpacetimeDB recommends files outside the database with paths in rows ([file storage](https://spacetimedb.com/docs/tables/file-storage)).
- A procedure is still a good SpacetimeDB-track showcase for a text-only step, such as the end-of-event incident summary built from rows. The docs disagree on whether Rust procedures need the `unstable` feature, so check spacetimedb 2.13.

Rust stack: no official Anthropic Rust SDK exists ([SDKs](https://platform.claude.com/docs/en/cli-sdks-libraries/overview)), so call the API with `reqwest` + `serde_json`. Run YOLO26n-pose exported to ONNX through the `ort` crate (ONNX Runtime), or as a small Python sidecar with `ultralytics` if parsing the ONNX output takes too long. Add `base64`, `image` (resize, draw boxes, encode JPEG), `kamadak-exif`, `tokio` and `spacetimedb-sdk`. Community Claude crates such as `rig-core` and `genai` exist but may lag behind `output_config` and the 5.5 settings.

Request shape for a fall verdict: `POST https://api.anthropic.com/v1/messages` with headers `x-api-key`, `anthropic-version: 2026-10-21`, `anthropic-beta: server-side-fallback-2026-07-01` and `content-type: application/json`. Repeat the text and image pair for each of the 6 to 8 frames.

```json
{
  "model": "claude-opus-5-5",
  "max_tokens": 16000,
  "fallbacks": "default",
  "output_config": {
    "effort": "medium",
    "format": {"type": "json_schema", "schema": {
      "type": "object",
      "properties": {
        "fall_confirmed": {"type": "boolean"},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        "crowd_closing_in": {"type": "boolean"},
        "description": {"type": "string"},
        "recommended_action": {"type": "string"},
        "report": {"type": "string"}
      },
      "required": ["fall_confirmed", "confidence", "crowd_closing_in", "description", "recommended_action", "report"],
      "additionalProperties": false
    }}
  },
  "system": "You review venue camera frames when a festival wristband reports a fall. Describe what happens; never identify people.",
  "messages": [{"role": "user", "content": [
    {"type": "text", "text": "Camera 2, frame 1, t-4 s. YOLO person boxes in green."},
    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "<JPEG>"}},
    {"type": "text", "text": "Camera 2, frame 2, t-2 s."},
    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "<JPEG>"}},
    {"type": "text", "text": "Band 3 reported a fall at t=0 in zone 101 with 6 strong neighbours. A YOLO pose near the centre went horizontal at t-1 s. Did someone fall, and is the crowd closing in? Write the staff report."}
  ]}]
}
```

Photo tagging uses the same shape with one photo, its YOLO person boxes and the list of candidate bands for that zone and time.

## At venue scale

A real venue has thousands of people and dozens of cameras in different places, so Claude's work must grow with incidents, never with cameras.

| Concern | Approach |
| --- | --- |
| Claude on every frame | Ruled out: 50 cameras at one frame every 3 s is 1,000 calls a minute, the whole Start-tier request limit, and about $290 an hour on Opus 5.5 |
| Detection load | YOLO per camera on a small edge box, or one GPU server for all streams (the MLH Vultr prize offers cloud GPUs) |
| Packed crowds | Above about 4 people per m² people hide each other and box detectors undercount. Use a density-map crowd counter such as CSRNet for those zones; keep YOLO pose for falls |
| Cameras to zones | A `camera` table maps each camera to the band zones (stations 101 to 105) it covers and their floor area, so counts become people per m² per zone, comparable with the bands' density |
| What SpacetimeDB stores | One `pit_reading` row per zone every second or two, not per frame or per person |
| Incident frames | On a band flag, the worker pulls the ring buffers of only the cameras covering that band's zone |
| Claude volume | Grows with incidents and photos; bulk photo tagging goes through the Batch API at 50% off |

## Privacy and policy guardrails

Identify people through the bands they opted into, never through faces; that keeps BandIt inside Anthropic's usage policy and matches the handoff's privacy answers.

- The [usage policy](https://www.anthropic.com/legal/aup) bars facial recognition and tracking people without consent, but allows analysis that people have agreed to. Collect that consent at the NFC sign-up tap.
- Prompts ask for positions, counts, LED colours and actions, never "who is this". Claude refuses to name people from images anyway.
- Staff screens show counts and zones; a name appears only on an SOS or fall incident, as the handoff already promises.
- YOLO runs locally, so only incident frames and event photos ever reach Claude. Delete raw frames after the event, except those attached to an incident. Files API uploads are not eligible for zero data retention, so send live frames as base64 instead of uploading them.

## Build order and questions for Leo

Get YOLO counting on one camera Saturday morning, then one Claude incident call; everything after reuses those two pieces.

1. YOLO26n-pose on the overhead phone feed: person count and keypoints per frame. Check it keeps up with the camera's frame rate.
2. Pit loop: the worker writes YOLO's count to `pit_reading`; the dashboard shows it beside the bands' `neigh` count.
3. One Claude request from Rust: 6 to 8 frames from a staged fall plus band data in, a JSON verdict and report out. Time it.
4. Fall pipeline: a 10 s frame ring buffer per camera, triggered by band flag 1 or 2 or a YOLO pose that goes horizontal, writes Claude's report onto the incident row.
5. Photo tagging on 3 to 5 test photos, then merch picks if time allows. Show the multi-camera, zone-mapped version in the pitch, even if the judging run uses two cameras.

Photo tagging option: when the photographer's app reports a shot, the backend sends each band in that zone its own colour, so Claude reads the ring colours in the photo and maps them to band ids. Today `state 8` (identify) blinks white for every band, so this needs a small firmware change, such as showing the band's exit colour in identify state.

Open questions for Leo:

- [ ] Which cameras: only the overhead phone on the light stand, or a second angle for falls?
- [ ] How does the laptop get frames: a phone app serving JPEG snapshots over Wi-Fi, or a USB webcam?
- [ ] What resolution and frame rate can each camera give?
- [ ] Clock sync: the gateway's `t` is uptime, so stamp frames and beacons with the laptop clock.
- [ ] Can identify state show a per-band colour for photo tagging?
- [ ] Which Anthropic account and tier will the team use, and are there hackathon credits?

## Sources

- [Vision](https://platform.claude.com/docs/en/build-with-claude/vision) and [vision coordinates](https://platform.claude.com/docs/en/build-with-claude/vision-coordinates)
- [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Rate limits](https://platform.claude.com/docs/en/api/rate-limits)
- [Reduce latency](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-latency)
- [Batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
- [Files API](https://platform.claude.com/docs/en/build-with-claude/files)
- [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [API versioning](https://platform.claude.com/docs/en/api/versioning) and [2026-10-21 migration](https://platform.claude.com/docs/en/api/migration-2026-10-21)
- [Client SDKs](https://platform.claude.com/docs/en/cli-sdks-libraries/overview) (no official Rust SDK)
- [Anthropic usage policy](https://www.anthropic.com/legal/aup)
- [Artificial Analysis: Haiku 5.5 low](https://artificialanalysis.ai/models/claude-haiku-5-5-low/providers)
- [Ultralytics YOLO pose models](https://docs.ultralytics.com/tasks/pose/)
- [Bitdeer AI model catalog](https://developers.bitdeer.ai/docs/api/models-catalog)
- [SpacetimeDB procedures](https://spacetimedb.com/docs/functions/procedures), [file storage](https://spacetimedb.com/docs/tables/file-storage), [Rust client SDK](https://spacetimedb.com/docs/clients/rust/)
- [Cal Hacks 13.0 Devpost](https://cal-hacks-13-0.devpost.com/)
- BandIt README and `bandit_hardware_handoff` (handoff prompt, gateway protocol, firmware)
