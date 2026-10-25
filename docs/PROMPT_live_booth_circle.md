# Prompt for the main coding agent: live booth circle on a simulated venue

## Context

The frontend (`frontend/`) connects straight to SpacetimeDB Maincloud (database `bandit-calhacks13-sp82j`,
client in `src/stdb/session.ts`, floor mapping in `src/stdb/floor.ts`). We have only 5–8 real
wristbands, and during judging they will all be at our demo booth. The plan:

- The map stays a simulated venue everywhere, except **one small circle** that is live. The circle
  can be moved and resized, and it stands for the booth. Real bands from SpacetimeDB are shown only
  inside it.
- Everyone outside the circle is a simulated attendee, as today.
- Responder paths, guidance commands, band signalling counts and the with/without comparison
  **stay on the frontend** (`MockBackend` / `CrowdSim`). The backend does not need to send them.

## Fix 1: generated bindings are out of date (live data is being dropped)

The browser console logs this repeatedly:
`RangeError: Offset is outside the bounds of the DataView` in
`BinaryReader.readI64 … lastSeen` (and `readU16`).

Cause, checked against the live schema
(`GET https://maincloud.spacetimedb.com/v1/database/bandit-calhacks13-sp82j/schema?version=9`):

- `src/stdb/module_bindings/band_table.ts` says `id: u8`. The deployed module has **`id: u32`** and
  three new trailing columns: **`x_m: f32`, `y_m: f32`, `booth_id: u64`**.
- Because `id` is three bytes wider than the bindings expect, every later field is read at the
  wrong offset. The decoder runs off the end at `last_seen`. Band rows fail to decode, so band
  inserts and updates (SOS, fall, online) never reach the UI.
- `open_incidents` is not in the schema's table list. It is probably a view. Confirm that the
  subscription `SELECT * FROM open_incidents` actually returns rows.

To do:

1. Regenerate the bindings from the deployed module (e.g.
   `spacetime generate --lang typescript --out-dir frontend/src/stdb/module_bindings --module-path <server module>`,
   or point it at the published database). Don't hand-edit the generated files.
2. Update `src/stdb/floor.ts` (`FloorBand`, `rowsOf` mapping) for `id` as a number, and add `x_m`,
   `y_m` and `booth_id`. If a band has `x_m`/`y_m`, use them as its position instead of seating
   it in its station's room.
3. Check the other subscribed tables (`zone`, `venue`, `claims_board`, …) against the schema the
   same way.
4. Done when the console shows no DataView errors for 5 minutes with bands updating, and an SOS
   press on a real band shows up on the map.

## Fix 2: no connection from headless or fresh browsers

The Feeds dot is green in the desktop pane but red in headless Playwright, so the floor is marked
stale there. `MapEngine` then hides density, trails and live markers (`stale = !isLive(...)`).

Likely causes, in order (verify, don't assume):

- The session relies on a token saved in the browser (the pane has one, a fresh profile does
  not). Look at how `session.ts` builds the `DbConnection` and what happens with no token.
- An RLS-filtered view (`my_roles`, `my_owner`, …) rejects an anonymous identity, and the whole
  subscription fails.
- The decode error from Fix 1 throws inside the message handler and kills the connection.

To do:

1. Log the connect, subscribe-applied and error callbacks in `session.ts`, then run the e2e test.
2. Make an anonymous or new identity connect and subscribe to the public floor tables. Keep
   staff-only queries in a separate subscription, so one failing doesn't stall the other.
3. Done when `npx playwright test` reaches a live floor. The e2e test also fails today only
   because of these page errors (`expect(errors).toEqual([])`).

## Build: one live booth circle on the simulated venue

- **Venue:** use the simulated concert venue (`?venue=simulation`, `MockBackend` + `CrowdSim`) as the
  base map for the demo. The full 3D, density glow, paths and comparison already work there.
- **Live circle:**
  - **What it is:** a round live area with a centre and a radius in metres, ~4–6 m by default.
    It is drawn on the map with a clear "LIVE · booth" label and a different edge from the
    simulated areas, which keep the striped "sim" mark.
  - **Reconfigurable:**
    - Drag its centre and its edge on the map, in a mode that operators can toggle on and off.
    - Keep the setting in `localStorage`.
    - Optionally store it in SpacetimeDB through `booth_id` and the `booth` table, if the backend
      supports that.
- **Real bands in the circle:**
  - **Placement:** every band from SpacetimeDB is placed inside the circle, using `x_m`/`y_m`
    relative to the booth when present. Otherwise lay them out evenly around the centre.
  - **Markers:** real bands keep their LED ring markers, and SOS/fall come from the live row.
  - **No invented positions:** a band without a position stays in the bands list with "position
    unknown". Never invent a precise spot.
- **Simulated crowd:**
  - Keep simulated attendees out of the circle: an obstacle or keep-out ring in `CrowdSim`, so no
    simulated person stands where the real bands are.
  - The physical demo bands now in `MockBackend` (`MOCK_BANDS`) are replaced by the live ones when
    the link is up. They fall back to the mock bands when it's down, and the link state shows in
    the Feeds menu.
- **Incidents:**
  - **SOS opens an incident:** a real SOS or fall from `open_incidents` / `band` opens an incident
    in the existing panel, with the location set to the band's spot in the circle.
  - **Guidance stays local:** acknowledge, preview path, approve and resolve keep running on the
    frontend mock. The responder path is routed from First Aid to the circle with the existing
    corridor logic; add a corridor that ends at the booth if needed.
  - **Band counts:** "signal N bands" counts the live bands in the circle plus the simulated crowd
    bands (`scenario.simulatedBands`), shown separately, as the UI does now ("6 of 6 demo bands
    confirmed" + "N crowd bands (simulated)").
  - **Commands to real bands:** if the backend has a reducer for this (`command_sent`, `command`
    table), send step-aside / help-coming patterns to the real bands when the path is approved.
    Show "confirmed" only on the band's acknowledgement row, never optimistically.
- **Honesty:** everything outside the circle stays labelled simulated, and everything inside is
  live. If the link drops, the circle greys out and says "Connection lost", as the rest of the app
  does.

## Don't touch / constraints

- Don't commit `.env` (it holds server-side credentials). The frontend only needs
  `VITE_SPACETIMEDB_URI` and `VITE_SPACETIMEDB_DB`.
- Keep the existing tests passing (`npm test`, `npm run typecheck`, `npm run lint`). Add tests for:
  - the band row mapping (u32 id, `x_m`/`y_m`)
  - the circle keep-out in `CrowdSim`
  - an incident from a live band opening at the circle.
