# Prompt for the coding agent: Bright Data venue setup in the command center

## Context

An organizer types an event's name; Bright Data finds the venue and a public 3D model of it; our map
shows that venue. The backend half exists on the `vik-e2e` branch (same repo). The React command
center (`frontend/`, branch `frontend/command-center`) is replacing the old organizer portal and has
none of the UI. Build it there. Judges see this page first, so the design work in §5 is half the
job, not polish at the end.

What exists on `vik-e2e` (read it, don't change it):

- Reducer `start_venue_setup({ eventName })` (needs the `ops` role) in
  `spacetimedb/server/src/venue/setup.rs`. It queues a `venue_setup` job.
- Worker `crates/bandit-workers/src/venue.rs`: Bright Data search for the event → Web Unlocker reads
  the pages → Claude picks the event site, the venue and the pages likely to hold a 3D map → picks
  the map among their links → `pipeline/venue_model.py --url` captures the model through Bright
  Data's Browser API (a three.js scene, a Babylon scene, or a glTF file the page loads) → model and
  layout go to the blob store.
- Each step is written as it happens to table `venue_setup_step` (`setup_id`, `step`, `detail`,
  `at`). Step names: `Searching`, `Found the event`, `Reading pages`, `Opening the 3D map`,
  `No model there`, `No 3D map found`, `Saved the model`.
- Table `venue_setup`: `status` (`running` / `ready` / `no model` / `failed`), `event_site`,
  `venue_name`, `address`, `map_url`, `method`, `model_url`, `layout_url`, `model_bytes`, `meshes`,
  `triangles`, `places`, `size_x/y/z`, `floor_plans`, `sources: Fact[] { label, value }`, `error`.
- Reducer `choose_venue({ setupId })` and table `chosen_venue`: the venue the app shows. Setup 0 is
  the Palace of Fine Arts model that ships with the app (`/venue/venue.glb`).
- The old portal's Venue tab, `web/src/venue-setup.ts`, is the behaviour reference (not the code
  style): it starts runs, lists steps, shows "Pages used", previews the model and picks the venue.

What the command center lacks:

- `frontend/src/stdb/module_bindings/` has no venue setup tables or reducers.
- `frontend/src/map/hallMesh.ts` always loads `/venue/venue.glb` and moves it into plan metres with
  Palace-only constants (`OX`, `OY`, `bake`). Zones, labels and the simulated crowd come from the
  hand-traced Palace plan (`src/mock/calhacks.ts`, `src/mock/palaceTrace.ts`).

## 1. Bindings and session

- Regenerate the bindings from the module (e.g. `spacetime generate --lang typescript --out-dir
  frontend/src/stdb/module_bindings --module-path <vik-e2e>/spacetimedb/server`, or from the
  published database). Don't hand-edit generated files.
- Check that the deployed database (`bandit-calhacks13-sp82j`) has `venue_setup`,
  `venue_setup_step` and `chosen_venue`. If it doesn't, say so and build against the replay (§4).
- Subscribe to those three public tables in their own subscription, one query at a time like the
  others in `src/stdb/session.ts`, so a hang doesn't stall the floor or staff views.
- Add `startVenueSetup(eventName)` and `chooseVenue(setupId)` actions in `session.ts`, next to the
  existing ones. Components don't call reducers directly.

## 2. Venue setup page (`/venue`)

Add the route in `App.tsx` (`Pages`) and a "Venue" tab in `components/desk/DeskTabs.tsx`. Use
`DeskFrame` for the header and tabs. This section says what the page does; §5 says how it should
look and feel, and matters as much.

- **Start:** event-name input and a "Find the venue" button. Show reducer refusals inline (not
  signed in as ops, already running, empty name).
- **Runs:** past and running setups, newest first: event name, venue, status, when. The Palace
  (setup 0) is pinned as the default.
- **Step timeline** for the selected run:
  - One row per `venue_setup_step` in `at` order: step name, detail, time since the run started.
  - While `status` is `running`, the latest step shows as in progress. Dead ends (`No model there`)
    are muted, not red. The last step is marked done or failed.
  - URLs in a detail are links (new tab, `rel="noreferrer"`). The `Reading pages` list shows as
    chips of short domains.
  - Tag each step with the tool that did it, from the step name and `method`: Bright Data SERP
    (Searching), Web Unlocker (Reading pages; glTF file downloads), Browser API (Opening the 3D map,
    the capture), Claude (picking the event, venue and map). Don't invent tags the data doesn't
    support.
- **Sources:** the `sources` facts ("Pages used (N)"), `floor_plans` links and `map_url`, so it is
  clear what was read.
- **Result:** venue name, address, capture method, meshes, triangles, size X × Y × Z m, model size.
  For `no model` say "No public 3D model found for <venue>"; for `failed` show `error`.
- **3D preview:** a three.js viewer for `model_url` (GLTFLoader + OrbitControls; add lights, the
  GLBs have none; frame the bounding box). Load it lazily, with loading and failure states.
- **Use this venue:** calls `chooseVenue`. Show which venue is current, from `chosen_venue`.
- **Model URL:** find out how `model_url` resolves from the command center. The old portal reads
  same-origin `/blobs/<hash>`; the command center is served at `/cc/` on that host (`build:host`)
  and from Vite in dev. Add a Vite dev proxy if needed. Don't hard-code a host.

## 3. The chosen venue on the map

- `HallMesh` takes the chosen venue's model URL (default `/venue/venue.glb`).
- The Palace keeps today's constants exactly: no visual change.
- Any other venue: compute the transform from the model's bounding box (model space is metres,
  y up → plan space x east, y south, z up), origin at the box's min corner plus a margin. Size the
  map's venue width and height from it so the camera frames it.
- Another venue has no traced plan, so no zones, exits or crowd paths. Hide the Palace zones,
  labels and simulated crowd for it, and show a clear note on the map ("3D model only: zones not
  set up yet"). Never draw Palace zones on another building. Bands and incidents are hidden too:
  their positions are on the Palace's plan, so on another building they would land in the wrong
  place. Only the event floor (`calhacks`) is replaced; the simulated concert hall stays as it is.
- Switching venues disposes the old mesh (`HallMesh.destroy` already frees geometry and
  materials).

## 4. Replay: the Palace of Fine Arts

A live run can take several minutes, so the page leads with a replay of the **Cal Hacks 13.0 run at
the Palace of Fine Arts**. It ends on the model that already ships with the app
(`/venue/venue.glb`), so there is nothing extra to bundle.

- **No recorded run exists yet.** The live database has no `venue_setup` rows (checked
  2026-10-25), so the bundled run (`frontend/src/venue/palaceRun.ts`) is put back together only
  from facts in the repo: the model's own measurements (106 meshes, 115,545 triangles,
  213.9 × 16.5 × 96.7 m, 11,612,520 bytes), the worker's step wording and search queries, the map
  page it was captured from (hive.hackberkeley.org/venue-map, which embeds
  palace-interior.vercel.app) and the floor plan in `pipeline/venues/palace-of-fine-arts.json`.
  It says on screen that it is reconstructed and that its step times are approximate. Never invent
  page URLs or step details.
- **When a real run is recorded** (an organizer signed in as ops runs "Cal Hacks 13"), the same
  Replay controls work on it, and it can replace the reconstructed one.
- **Opens finished**, on the saved model, so the first screen answers the question. "Replay the run"
  restarts it from the first step.
- **Controls:** play / pause, speed (real time, 4×, "In 30 s"), and the run strip is the scrubber
  (drag, or arrow keys, Home and End).
- Never present a replay as live.

## 5. Design

The page follows the `design-taste-frontend` skill's **app-screen** rules
(`.claude/skills/design-taste-frontend/references/app-screens.md`), not its landing-page rules.
Load the skill and read that file whole before changing the page. The style dealt for it is
**data-terminal** (seed 748908342, kept in `.taste-skill/venue/direction.json`), with the app's own
palette and type kept.

- **The question it answers:** "Did the search find this event's venue and a 3D model I can put on
  the map?" The model viewport is the biggest block and sits on the first screen at 1440 × 900. The
  line under the title states the finding ("Palace of Fine Arts, captured from
  hive.hackberkeley.org/venue-map: 214 × 97 m, 115,545 triangles.").
- **The move:** every selection (desk tab, replay speed, roof toggle) is the same 1px champagne line
  under its label. Champagne otherwise only marks the stage the run is in and the one primary button.
- **The signature element:** the run strip, with Search, Read and Capture each as long as it really
  took, the tools each used (SERP API, Web Unlocker, Browser API, Claude) and the model saved at
  the end. It doubles as the replay's scrubber.
- **Layout:** a toolbar (the event-name field and a picker for the search shown), then the run's
  heading with its status, replay controls and "Use this venue". Under it the strip, then the steps
  and the pages it kept (5/12) beside the model (7/12). The two columns end level.
- **The rules that matter here:** no entrance animations (only rows arriving and controls
  responding), no gradients, glows or glass, no tracked uppercase labels or mono tags, numbers in
  tabular figures with separators, a dash for anything missing, every state written out (loading,
  connecting, refused, no model, failed, model failed to load), and `prefers-reduced-motion` stops
  the turntable and the row motion.
- **The check:** `node .claude/skills/design-taste-frontend/scripts/lint.mjs --app` on the files,
  and `inspect.mjs --app http://localhost:<port>/venue`. Both report 0 FAIL. Two WARNs stand,
  with reasons: the panel border is the app's `--nc-line` at 14% alpha, which the inspector reads
  without its alpha; and the 40px title is the desk header every desk page shares.

## Constraints

- Don't change the worker, the pipeline or the module on `vik-e2e`. If the UI needs a field they
  don't provide, report it.
- The frontend never calls Bright Data directly, only the module. Don't commit `.env` or any Bright
  Data credentials.
- Keep `npm test`, `npm run typecheck` and `npm run lint` passing. Add tests for:
  - the timeline: step order, and the running / done / dead-end states;
  - the replay: the Palace fixture's steps play in order, speed and scrubbing work, and it ends on
    the result;
  - the Palace fixture against the bundled `venue.glb` (meshes, triangles, size, bytes);
  - the `HallMesh` transform for a non-Palace bounding box, and the Palace unchanged;
  - a start refusal showing inline.
- No horizontal overflow at 1440, 768 or 390 px wide.

## Done when

- Signed in as ops: type an event name, watch the steps arrive live with their sources, preview the
  model, click "Use this venue", and the map shows that venue's model, framed, with the "3D model
  only" note.
- With no backend, `/venue` opens on the finished Palace replay. "Replay the run" at "In 30 s"
  plays Search → Read → Capture → Save in about 30 seconds and ends on the Palace model, which is
  already the venue on the map.
- The skill's `inspect.mjs --app` reports 0 FAIL at 1440, 768 and 390 px, and you have looked at
  every screenshot it lists.
- No console errors.
