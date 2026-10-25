# BandIt backend integration (frontend contract)

For the Rust backend team. This is what the command center expects. Everything here is
**provisional**: tell the frontend owner what you change and we update `frontend/src/services/routes.ts`
and `frontend/src/contracts/schemas.ts`; nothing else in the UI depends on the wire format.

The canonical types are `frontend/src/contracts/domain.ts`. The validators that enforce them are
`frontend/src/contracts/schemas.ts`. A message that fails validation is dropped and counted,
never half-applied.

## Conventions

- **Keys:** camelCase or snake_case; the frontend converts snake_case on receipt (serde's
  default works as is).
- **Time:** ISO 8601 strings or epoch milliseconds. Venue local time zone is in the venue
  config (`timeZone`).
- **Space:** venue-local metres. Origin at the top-left of the plan, x east, y south (toward the
  gates). Polygons are lists of `{x, y}`.
- **Unknown is a value.** Send `"unknown"` or leave an optional field out. Never fill a location,
  confidence or battery level you do not have.
- **Simulated is a flag.** Anything produced by a simulator sets `isSimulated: true` (incidents,
  observations, commands) or `source: "simulation"` (zones, entities).

## Transport

| Purpose | Method and route | Body | Reply |
| --- | --- | --- | --- |
| Initial state | `GET /v1/state` | | `WorldSnapshot` |
| Event stream | `WS /v1/stream` | | `StreamEvent` messages, one JSON object each |
| Acknowledge incident | `POST /v1/incidents/{id}/acknowledge` | `{}` | `Incident` |
| Resolve incident | `POST /v1/incidents/{id}/resolve` | `{ "reason": "assisted_on_scene" \| "handed_to_medical" \| "false_alarm" \| "other" }` | `Incident` |
| Preview guidance | `POST /v1/guidance/preview` | `{ "incidentId": "...", "corridorId"?: "..." }` | `GuidanceCommand` with `approvalStatus: "pending_approval"` |
| Approve guidance | `POST /v1/guidance/{id}/approve` | `{}` | `GuidanceCommand` with `approvalStatus: "approved"`, targets `"sent"` |
| Cancel guidance | `POST /v1/guidance/{id}/cancel` | `{}` | `GuidanceCommand` |
| Resend to failed bands | `POST /v1/guidance/{id}/resend` | `{}` | `GuidanceCommand` |
| Demo service (optional) | `POST /v1/demo/{reset\|congestion\|sos\|fall\|camera-outcome\|flaky-radio\|playing\|speed\|autoplay}` | small JSON | `{}` |

Errors: any non-2xx with `{ "code": "...", "message": "..." }`. The message is shown to the
operator, so write it for a person ("Incident is already resolved"). Use 404 for unknown ids and
409 for state conflicts. The frontend times out a command after 8 s and tells the operator
nothing changed.

**Command replies mean accepted, not done.** After `approve`, the bands have not changed yet.
Each band's acknowledgement arrives later as a `guidance` event with that target's status
moving `sent → acknowledged` (or `failed`). The UI never shows a band as signalling before that.

**Authority stays with you.** The frontend never sends LED patterns or device ids of its own
choosing: it asks for a preview, shows it, and approves it by id. Validate on your side that the
approving operator may do so and that the preview has not expired (`expiresAt`).

## Snapshot

`GET /v1/state` and the `snapshot` event return:

```json
{
  "timestamp": "2026-10-25T04:14:00Z",
  "seq": 4182,
  "mode": "live",
  "venue": { "venueId": "main-stage", "name": "Main Stage", "width": 100, "height": 64, "...": "see Venue" },
  "zones": [],
  "devices": [],
  "incidents": [],
  "observations": [],
  "commands": [],
  "sources": [],
  "history": []
}
```

`seq` is the sequence number of the last event already reflected in the snapshot. `history`
(optional) is recent venue pressure, `{t, peakDensity, status, zoneId}` per second, so the
timeline is not empty after a reload.

The venue config the frontend ships with is `frontend/src/mock/venue.ts`; it is valid wire data
(a test checks it). The backend can serve the same document: zones, walkways, exits, stages,
structures (footprints and heights for the 3D map), camera locations and coverage, stations,
preapproved responder corridors, and the set times.

## Events

Every message has `type`, `seq` and `at`.

| type | payload | when |
| --- | --- | --- |
| `snapshot` | `snapshot: WorldSnapshot` | after a reset, or whenever you want the client to start over |
| `zones` | `zones: ZoneState[]` | crowd numbers per zone, about twice a second |
| `device` | `device: Device` | any change: pattern, connection, location, pending commands |
| `incident` | `incident: Incident` | creation and every change, with the full timeline |
| `observation` | `observation: CameraObservation` | camera search started, then its result |
| `guidance` | `command: GuidanceCommand` | preview, approval, each band acknowledgement or failure, cancel, expiry |
| `source` | `source: SourceStatus` | gateway, camera or feed health changes |
| `entities` | `entities: TrackedEntity[]` | crowd positions, if the backend streams them (5 to 10 Hz) |
| `scenario` | `scenario: ScenarioState` | demo director state, demo service only |
| `heartbeat` | | at least every 2 s when nothing else is sent |

Examples:

```json
{ "type": "incident", "seq": 4190, "at": "2026-10-25T04:14:09.350Z",
  "incident": { "incidentId": "inc-0142", "displayId": "INC-0142", "reportedByDeviceId": "band-03",
    "reportedAt": "2026-10-25T04:14:09Z", "status": "reported", "source": "manual_sos",
    "radioStatus": "received", "radio": { "gatewayId": "GW-01", "holdMs": 1650 },
    "candidateZone": "FL", "location": { "x": 31.2, "y": 12.9 }, "locationRadiusM": 6,
    "localizationStatus": "estimated", "cameraObservations": [],
    "timeline": [{ "at": "2026-10-25T04:14:09Z", "source": "device", "text": "SOS held 1.7 s on band-03" }],
    "guidanceCommandIds": [], "isSimulated": false } }

{ "type": "guidance", "seq": 4221, "at": "2026-10-25T04:14:27.800Z",
  "command": { "commandId": "cmd-77", "incidentId": "inc-0142", "corridorId": "COR-FL-W",
    "approvalStatus": "approved", "deliveryStatus": "partial",
    "targets": [ { "deviceId": "band-02", "patternCode": "steady_red", "haptic": false, "status": "acknowledged", "attempts": 1 },
                 { "deviceId": "band-05", "patternCode": "step_aside", "haptic": false, "status": "sent", "attempts": 1 } ],
    "acknowledgedDevices": ["band-02"], "failedDevices": [], "...": "see GuidanceCommand" } }
```

`entities` packs simulated and observed people separately on the client; a simulated person is
never drawn as an observed one. Physical bands are drawn from `device` state, not from entities.

## Ordering and recovery

- `seq` increases by exactly one per event on the stream. The client drops anything `<=` the last
  seq it applied, and treats a jump as a gap: it reloads `GET /v1/state` and applies buffered
  events after the snapshot's `seq`.
- On every reconnect the client reloads the snapshot before showing anything as live.
- Events that arrive while the snapshot loads are buffered (up to 2,000) and replayed.
- `seq: 0` means unsequenced and is applied without ordering. The client uses it for its own
  local simulated crowd in hybrid mode; the backend should not need it.
- No heartbeat for 10 s closes the socket and triggers a reconnect (exponential backoff with
  jitter, 0.5 s to 15 s).
- An `incident` or `guidance` event older than what the client has (lower status, fewer timeline
  entries or acknowledgements) is ignored, so a slow HTTP reply cannot undo a newer event.

## Enumerations

- `Device.hardwareVariant`: `full` (LED, button, IMU, vibration), `light` (LED, button), `gateway`, `station`
- `Device.connectionStatus`: `connected`, `delayed`, `disconnected`, `unknown`
- `Device.locationSource`: `camera`, `station_estimate`, `manually_assigned`, `simulated`, `unknown`
- LED patterns: `ready`, `sos`, `steady_red`, `step_aside`, `help_coming`, `off`, `unknown`
- `ZoneState.congestionStatus`: `normal`, `caution`, `critical`, `unknown` (thresholds are yours)
- `Incident.status`: `reported`, `acknowledged`, `responding`, `resolved`
- `Incident.source`: `manual_sos`, `camera_suspicion`, `imu_suspicion`, `staff`
- `Incident.localizationStatus`: `unknown`, `estimated`, `visually_confirmed`
- `CameraObservation.status`: `pending`, `detected`, `ambiguous`, `not_visible`
- `GuidanceCommand.approvalStatus`: `draft`, `pending_approval`, `approved`, `rejected`, `expired`, `cancelled`
- `GuidanceCommand.deliveryStatus`: `not_sent`, `sending`, `partial`, `delivered`, `failed`, `cancelled`
- Target status: `pending`, `sent`, `acknowledged`, `failed`, `cancelled`

## Questions for the backend team

1. Routes and payloads above: keep, or tell us yours?
2. Does the gateway estimate an SOS location from anchor RSSI, and with what uncertainty radius?
   The UI draws `locationRadiusM` as a dashed circle.
3. Will the camera service send evidence image URLs (`evidenceUrl`)? Until then the frontend draws
   a labelled simulated frame in simulation mode only, and shows no frame for live detections.
4. Who chooses the corridor for an incident, and can there be more than one option? The preview
   carries `alternativeCorridorIds`; the UI offers them as a choice.
5. How long should approved signals last before they expire? The mock uses 90 s.
6. Will crowd positions come from the backend for the demo, or do we keep the in-browser crowd
   (hybrid)? Hybrid is the current default.
7. Operator identity: the UI shows "J. Rivera". Is there an auth token to send, or is the demo
   single-operator?
