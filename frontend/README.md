# BandIt Command Center (frontend)

The operator screen for BandIt: a live 3D map of the venue, wristband SOS incidents with camera
evidence, and staff-approved crowd guidance delivered to the bands. It runs on its own in
**simulation mode** (no hardware, no backend), and talks to the Rust backend in **live mode**
through one adapter.

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The app opens on the CalHacks 13.0 floor; pick **Simulation** in the
venue menu next to the BandIt wordmark for the simulated concert venue this demo runs on. The top
bar and every simulated number carry the striped **Simulation** mark.

## The 90-second demo

The **Demo** strip (bottom left) runs the story. Each step calls the same operator commands the
live system uses. Shortcuts work anywhere on the page.

| Step | What happens | Shortcut |
| --- | --- | --- |
| Normal | Reset: a settled crowd of 2,900 simulated people, seed 2026, with the pit in front of the stage packed to about 5 people/m² | ⇧1 |
| Surge | The set changes; people stream from the concourse to the front through West Passage. After about 15 s the passage and Concourse West go to caution and density columns rise. | ⇧2 |
| SOS | band-03 holds its SOS button (simulated press). The incident opens and the map flies to it. Nothing changes on any band yet. | ⇧3 |
| Camera | Automatic: CAM-01 looks for the SOS flash and returns *seen*, *unclear* or *not in view* (choose in options). | |
| Acknowledge | The operator takes it. The backend returns its preapproved corridor as a preview, framed on the map. | ⇧5 |
| Path | Approve: the six demo bands are signalled and each confirms over the radio one by one; full bands also vibrate. The simulated crowd's bands in the lane and around the person are signalled too, and counted separately (marked sim). A simulated medic walks the cleared lane. | ⇧6 |
| Resolve | Close the incident. The comparison card shows the same seed run without bands: how long the medic took in each. | ⇧7 |

Demo options (the sliders icon): camera outcome, a flaky radio (one lite band never confirms; use
**Resend**), dropping the backend link (shows the stale and reconnect states), speed, an
autoplay loop for the booth, and a second scenario: a possible fall on band-01 (IMU + CAM-02).
Also ⇧P pause, ⇧F fall, ⇧L link.

The zones and bands panel starts folded at the bottom left; open it, then drag its corner or the
divider between its cards to resize (sizes are remembered in this browser). The incident panel
sits at the bottom right and can fold the same way. **Feeds** (top right) lists the backend, gateway, cameras and crowd source.

On the map: drag to pan, scroll to zoom, right-drag (or shift-drag) to rotate and tilt, click a
zone or band to inspect it. With the map focused: arrows pan, `+`/`-` zoom, `Q`/`E` rotate, `0`
fits the venue. The toolbar switches between the 3D model and the flat plan and opens the layer
list.

## Modes

| Mode | How | What is live |
| --- | --- | --- |
| Simulation (default) | `VITE_BANDIT_MODE=mock` | Nothing. Everything runs in the browser from a seed. |
| Hybrid | `VITE_BANDIT_MODE=live`, `VITE_BANDIT_CROWD=local` | Bands, incidents, camera observations and commands come from the backend; the crowd is the in-browser simulator until the backend streams entities. |
| Live | `VITE_BANDIT_MODE=live`, `VITE_BANDIT_CROWD=backend` | Everything from the backend. |

Copy `.env.example` to `.env.local`. On the demo laptop you can switch without rebuilding:
`http://localhost:5173/?mode=live&api=http://10.0.0.5:8080&ws=ws://10.0.0.5:8080/v1/stream`.

The backend contract is in [docs/BACKEND_INTEGRATION.md](../docs/BACKEND_INTEGRATION.md).

## How it is built

React 19, TypeScript (strict), Vite, Tailwind 4 and shadcn/ui for the panels; PixiJS 8 for the
map; Zustand for state; Zod at the network boundary; Recharts for the two small charts;
Vitest, Testing Library and Playwright for tests.

Five layers, each only talking to the one below it:

| Layer | Where | Owns |
| --- | --- | --- |
| A. Presentation | `src/components/` | Panels, dialogs, controls. Never parses packets. |
| B. Spatial renderer | `src/map/` | One PixiJS application that draws the venue every frame straight from the stores, outside React. |
| C. State | `src/stores/` | Domain state (Zustand), UI state, and a frame buffer for positions that bypasses React entirely. |
| D. Transport | `src/services/` | Adapters, WebSocket, validation, sequence handling, resync. |
| E. Commands | `src/services/operatorCommands.ts` | Acknowledge, preview, approve, cancel, resend, resolve. Each waits for the backend. |

```
src/
  contracts/   domain types (domain.ts) and wire schemas (schemas.ts)
  services/    BackendAdapter, LiveBackendAdapter, MockBackendAdapter, ReconnectingSocket,
               StreamSync, normalize, routes, operatorCommands, runtime
  mock/        the simulated backend: venue, bands, scenario director, crowd simulator
  stores/      world (domain), ui, connection, frames, clock
  map/         MapEngine, projection maths, layers/ (venue, stage, crowd, density, marks),
               overlay/ (DOM labels the engine positions), VenueMap.tsx
  components/  dashboard/, incidents/, interventions/, simulation/, ui/ (shadcn)
  lib/         tokens, formatting, plain-language status, geometry
  tests/       unit and integration tests
e2e/           Playwright: the whole demo through the real interface
```

### The map

The simulated venue is an axonometric 3D model drawn by PixiJS: the floor slab with painted zones,
and extruded structures (stage deck, an upright LED wall, PA and delay towers, truss, FOH tent,
food trucks and tables, gate queue lanes, fences, first aid and merch tents) with directional
shading and cast shadows. The pit between the stage and the main floor is run as a pit: people press toward the
barricade, it normally holds about 5 people/m², and its caution and critical lines are 5.6 and
6.4 (3.1 and 4.1 elsewhere). Each wing has two raised stands (3.2 m terraces with railings and a
bar) either side of the side exit, reached by stairs from the floor; the crowd model has two
levels, so people climb the stairs to stand on them. Occlusion is tested per person against each
structure's far edge at that person's place across the view, so nobody shows on a roof or a wall
they are behind. Nine moving-head lights on the truss and towers sweep slow coloured pools across
the crowd and dim while an incident is open. The projection is orthographic, so the floor maps to
the screen by one affine matrix: movement trails and the density glow are textures on the floor,
and picking is an exact inverse (`src/map/projection.ts`, tested).

Positions arrive at 10 Hz and are interpolated (Catmull-Rom) to the display rate. People show as
dots when zoomed out and as standing figures when zoomed in. React never re-renders per frame:
labels are DOM nodes the engine moves through `transform`, and counts reach React four times a
second. If the frame rate stays under 38 fps for three seconds, trails switch off.

Layers (toolbar → Layers): people, trails (walkers only; nobody standing leaves a mark), density
(an amber glow smoothed over a few metres, so it follows masses of people and never single
people, burning pale where they are packed; on both venues; plus columns where the backend marks
a zone caution or critical, and a light red wash on congested zones), zone status, flow arrows,
bands, incidents, responder corridors,
camera coverage, structures, floor grid, labels, and the without-guidance ghosts.

### Safety rules the code enforces

- An SOS stays on screen whatever the camera finds; *not in view* and *unclear* never hide it.
- A missing location is never invented. Bands without one stay in the list, off the map.
  Estimated locations draw their uncertainty radius.
- A camera match locates a band's flash. The interface says so and never names a person.
- Simulated data carries the striped mark and the word *sim* wherever it appears, including the
  simulated camera frame.
- When the link drops, the map greys out, the headline says *Connection lost*, commands pause,
  and on reconnect the full state is reloaded before anything is shown as live.
- Zone data older than eight seconds shows as stale; zones with no data show as *no data*, never
  as normal.
- Nothing shows as done until the backend confirms it. A band counts as signalling only after it
  acknowledges over the radio; a band that does not confirm stays visibly failed until resent.
- Lite bands never show a vibration.
- The frontend never computes routes. Corridors are preapproved in the venue configuration and
  the backend chooses one.

## Tests

```bash
npm test            # unit and integration (Vitest, jsdom)
npm run test:e2e    # the full demo in headless Chromium (Playwright starts the dev server)
npm run typecheck
npm run lint
```

The first `test:e2e` run needs a browser: `npx playwright install chromium`.

What is covered: event normalisation and validation, data-source labels, incident and command
state transitions, device command status (pending, failed, partial, lite bands never buzz),
world-to-screen transforms, stale and unknown data, simulation determinism, WebSocket backoff,
idle detection and reconnect, sequence gaps, duplicates and resync, and token drift between CSS
and the renderer. Integration tests drive the real command centre against the mock backend:
SOS opens and focuses an incident, the camera-unconfirmed case stays visible, acknowledgement
waits for the backend, guidance goes from preview to pending to delivered, partial delivery and
resend, link loss and recovery, resolve and reset. The Playwright test runs the whole story
with real clicks and checks the page throws no errors.

## Status

**Implemented:** everything above, in simulation mode, verified in the browser at 1440×900 and
1920×1080.

**Mocked:** the backend (`src/mock/MockBackend.ts`), the crowd (a seeded social-force model,
`src/mock/sim/crowd.ts`; it stands in for the modelling team's simulator and is not a safety
model), camera detections and evidence frames (drawn in the browser), band radio
acknowledgements, and the medic's walk.

**Blocked on the backend team:** confirming the routes and payloads in the integration spec, the
`/v1/demo/*` endpoints for driving a live demo, and real evidence image URLs.

**Not yet verified:** live and hybrid modes against a real Rust service (the adapter is built
and unit-tested against the contract, not against a server), behaviour on a low-end laptop GPU,
and screen-reader behaviour beyond the live announcements and labelled controls.

**Known limits:** the bundle is about 390 kB gzipped (PixiJS and Recharts); the map is
designed for a desktop operator screen and is not tuned for phones; the comparison assumes 75% of
simulated attendees follow their band.
