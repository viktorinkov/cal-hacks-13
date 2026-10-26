/**
 * Runtime validation for data that crosses the network boundary.
 *
 * Wire payloads are first passed through `camelizeKeys` (services/normalize.ts), so the Rust team can
 * send either snake_case or camelCase. Timestamps may be ISO 8601 strings or epoch milliseconds; both
 * become epoch milliseconds here. Missing arrays default to empty so an older backend still parses.
 */
import { z } from 'zod'
import type {
  CameraObservation,
  Device,
  GuidanceCommand,
  Incident,
  ScenarioState,
  SourceStatus,
  StreamEvent,
  TrackedEntity,
  Venue,
  WorldSnapshot,
  ZoneState,
} from './domain'

const timestamp = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === 'number' ? v : Date.parse(v)))
  .pipe(z.number())

const vec2 = z.object({ x: z.number(), y: z.number() })
const polygon = z.array(vec2)

const sectionKind = z.enum(['front', 'floor', 'wing', 'concourse', 'plaza', 'food', 'passage'])

export const venueSchema: z.ZodType<Venue, unknown> = z.object({
  venueId: z.string(),
  name: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  coordinateSystem: z
    .object({
      units: z.literal('m'),
      origin: z.literal('top-left'),
      xAxis: z.literal('east'),
      yAxis: z.literal('south'),
    })
    .default({ units: 'm', origin: 'top-left', xAxis: 'east', yAxis: 'south' }),
  zones: z.array(
    z.object({
      zoneId: z.string(),
      name: z.string(),
      section: sectionKind,
      polygon,
      areaM2: z.number().positive(),
      labelAt: vec2,
      elevationM: z.number().nonnegative().optional(),
    }),
  ),
  walkways: z
    .array(
      z.object({
        walkwayId: z.string(),
        name: z.string(),
        polygon,
        status: z.enum(['open', 'closed']),
        widthM: z.number(),
      }),
    )
    .default([]),
  exits: z
    .array(
      z.object({
        exitId: z.string(),
        name: z.string(),
        kind: z.enum(['exit', 'gate']),
        segment: z.tuple([vec2, vec2]),
      }),
    )
    .default([]),
  stages: z
    .array(
      z.object({
        stageId: z.string(),
        name: z.string(),
        polygon,
        deckHeightM: z.number().nonnegative().default(1.5),
        ledWall: z.object({ from: vec2, to: vec2, bottomM: z.number(), topM: z.number() }).optional(),
        truss: z.array(vec2).default([]),
        trussHeightM: z.number().nonnegative().default(9),
        barricade: polygon.default([]),
      }),
    )
    .default([]),
  structures: z
    .array(
      z.object({
        structureId: z.string(),
        name: z.string(),
        kind: z.enum(['stage', 'speaker', 'tower', 'tent', 'bar', 'counter', 'truck', 'table', 'wall', 'barrier', 'fence', 'container', 'block', 'pole', 'tier', 'rail']),
        footprint: polygon.min(3),
        heightM: z.number().nonnegative(),
        baseM: z.number().nonnegative().default(0),
        blocksMovement: z.boolean().default(true),
      }),
    )
    .default([]),
  platforms: z
    .array(z.object({ platformId: z.string(), name: z.string(), polygon: polygon.min(3), elevationM: z.number().nonnegative(), zoneId: z.string() }))
    .default([]),
  stairs: z
    .array(
      z.object({
        stairId: z.string(),
        name: z.string(),
        polygon: polygon.min(3),
        bottom: vec2,
        top: vec2,
        topElevationM: z.number().nonnegative(),
        platformId: z.string(),
      }),
    )
    .default([]),
  cameraLocations: z
    .array(
      z.object({
        cameraId: z.string(),
        name: z.string(),
        position: vec2,
        mountHeightM: z.number().nonnegative().default(5),
        coverage: polygon,
      }),
    )
    .default([]),
  stationLocations: z
    .array(
      z.object({
        stationId: z.string(),
        name: z.string(),
        kind: z.enum(['gateway', 'anchor', 'first_aid']),
        position: vec2,
      }),
    )
    .default([]),
  responderCorridors: z
    .array(
      z.object({
        corridorId: z.string(),
        name: z.string(),
        fromStationId: z.string(),
        path: polygon.min(2),
        widthM: z.number().positive(),
        lengthM: z.number().nonnegative(),
        servesZoneIds: z.array(z.string()),
        viaWalkwayIds: z.array(z.string()).default([]),
        preapproved: z.boolean(),
      }),
    )
    .default([]),
  obstacles: z
    .array(
      z.object({
        obstacleId: z.string(),
        name: z.string(),
        kind: z.enum(['stage', 'backstage', 'structure', 'facility', 'wall']),
        polygon,
      }),
    )
    .default([]),
  schedule: z.array(z.object({ title: z.string(), startsAt: timestamp, endsAt: timestamp })).default([]),
  timeZone: z.string().default('America/Los_Angeles'),
})

const ledPattern = z.enum(['ready', 'sos', 'steady_red', 'step_aside', 'help_coming', 'off', 'unknown'])

export const deviceSchema: z.ZodType<Device, unknown> = z.object({
  deviceId: z.string(),
  label: z.string(),
  hardwareVariant: z.enum(['full', 'light', 'gateway', 'station']),
  connectionStatus: z.enum(['connected', 'delayed', 'disconnected', 'unknown']).catch('unknown'),
  lastSeenAt: timestamp.nullable().default(null),
  currentPattern: ledPattern.catch('unknown'),
  sosActive: z.boolean().default(false),
  location: vec2.optional(),
  locationSource: z
    .enum(['camera', 'station_estimate', 'manually_assigned', 'simulated', 'unknown'])
    .catch('unknown'),
  locationConfidence: z.number().min(0).max(1).optional(),
  locationRadiusM: z.number().nonnegative().optional(),
  zoneId: z.string().optional(),
  hapticsSupported: z.boolean(),
  imuSupported: z.boolean().default(false),
  pendingCommandIds: z.array(z.string()).default([]),
  wearerLabel: z.string().nullable().default(null),
})

export const zoneStateSchema: z.ZodType<ZoneState, unknown> = z.object({
  zoneId: z.string(),
  timestamp,
  occupancyEstimate: z.number().nonnegative().optional(),
  estimatedDensity: z.number().nonnegative().optional(),
  peakDensity: z.number().nonnegative().optional(),
  flowIn: z.number().nonnegative().optional(),
  flowOut: z.number().nonnegative().optional(),
  congestionStatus: z.enum(['normal', 'caution', 'critical', 'unknown']).catch('unknown'),
  source: z.enum(['camera', 'simulation', 'estimated', 'forecast']),
  dataQuality: z.enum(['good', 'degraded', 'stale', 'missing']).catch('degraded'),
  updatedAt: timestamp,
})

export const trackedEntitySchema: z.ZodType<TrackedEntity, unknown> = z.object({
  id: z.string(),
  type: z.enum(['simulated_person', 'observed_person', 'physical_band']),
  x: z.number(),
  y: z.number(),
  velocity: vec2.optional(),
  source: z.enum(['simulation', 'camera', 'radio']),
  confidence: z.number().min(0).max(1).optional(),
  observedAt: timestamp,
  role: z.enum(['attendee', 'responder']).optional(),
})

const timelineEntry = z.object({
  at: timestamp,
  source: z.enum(['radio', 'camera', 'operator', 'device', 'system']),
  text: z.string(),
  actor: z.string().optional(),
})

export const incidentSchema: z.ZodType<Incident, unknown> = z.object({
  incidentId: z.string(),
  displayId: z.string(),
  reportedByDeviceId: z.string().nullable(),
  reportedAt: timestamp,
  status: z.enum(['reported', 'acknowledged', 'responding', 'resolved']),
  source: z.enum(['manual_sos', 'camera_suspicion', 'imu_suspicion', 'staff']),
  radioStatus: z.enum(['received', 'delayed', 'lost', 'unknown']).catch('unknown'),
  radio: z
    .object({
      gatewayId: z.string().optional(),
      receivedAt: timestamp.optional(),
      holdMs: z.number().optional(),
      impactG: z.number().optional(),
      stillSeconds: z.number().optional(),
    })
    .optional(),
  candidateZone: z.string().optional(),
  location: vec2.optional(),
  locationRadiusM: z.number().nonnegative().optional(),
  localizationStatus: z.enum(['unknown', 'estimated', 'visually_confirmed']).catch('unknown'),
  cameraObservations: z.array(z.string()).default([]),
  acknowledgedBy: z.string().optional(),
  acknowledgedAt: timestamp.optional(),
  resolvedAt: timestamp.optional(),
  resolution: z
    .object({
      reason: z.enum(['assisted_on_scene', 'handed_to_medical', 'false_alarm', 'other']),
      note: z.string().optional(),
      by: z.string().optional(),
    })
    .optional(),
  timeline: z.array(timelineEntry).default([]),
  guidanceCommandIds: z.array(z.string()).default([]),
  isSimulated: z.boolean().default(false),
})

export const observationSchema: z.ZodType<CameraObservation, unknown> = z.object({
  detectionId: z.string(),
  cameraId: z.string(),
  timestamp,
  kind: z.enum(['sos_flash', 'fall_pose']).default('sos_flash'),
  boundingBox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
  candidateZone: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  associatedIncidentId: z.string().optional(),
  evidenceUrl: z.string().url().optional(),
  status: z.enum(['pending', 'detected', 'ambiguous', 'not_visible']),
  worldLocation: vec2.optional(),
  worldRadiusM: z.number().nonnegative().optional(),
  isSimulated: z.boolean().default(false),
})

const deviceTarget = z.object({
  deviceId: z.string(),
  patternCode: ledPattern,
  haptic: z.boolean().default(false),
  status: z.enum(['pending', 'sent', 'acknowledged', 'failed', 'cancelled']),
  updatedAt: timestamp.optional(),
  attempts: z.number().int().nonnegative().default(0),
})

export const guidanceSchema: z.ZodType<GuidanceCommand, unknown> = z.object({
  commandId: z.string(),
  incidentId: z.string().optional(),
  corridorId: z.string().optional(),
  targetZoneIds: z.array(z.string()).default([]),
  targetDeviceIds: z.array(z.string()).default([]),
  targets: z.array(deviceTarget).default([]),
  patternCode: ledPattern,
  reason: z.string(),
  preview: z.object({
    corridorId: z.string(),
    corridorName: z.string(),
    lengthM: z.number(),
    groups: z.array(z.object({ patternCode: ledPattern, deviceIds: z.array(z.string()), label: z.string() })),
    advisoryCode: z.string(),
    alternativeCorridorIds: z.array(z.string()).default([]),
  }),
  approvalStatus: z.enum(['draft', 'pending_approval', 'approved', 'rejected', 'expired', 'cancelled']),
  approvedBy: z.string().optional(),
  approvedAt: timestamp.optional(),
  createdAt: timestamp,
  expiresAt: timestamp,
  deliveryStatus: z.enum(['not_sent', 'sending', 'partial', 'delivered', 'failed', 'cancelled']),
  acknowledgedDevices: z.array(z.string()).default([]),
  failedDevices: z.array(z.string()).default([]),
  isSimulated: z.boolean().default(false),
})

export const sourceStatusSchema: z.ZodType<SourceStatus, unknown> = z.object({
  sourceId: z.string(),
  kind: z.enum(['backend', 'gateway', 'camera', 'crowd', 'devices']),
  label: z.string(),
  status: z.enum(['ok', 'degraded', 'down', 'unknown']).catch('unknown'),
  lastUpdateAt: timestamp.nullable().default(null),
  isSimulated: z.boolean().default(false),
  detail: z.string().optional(),
})

const comparisonSchema = z.object({
  corridorId: z.string(),
  startedAt: timestamp,
  samples: z.array(z.object({ t: z.number(), withGuidance: z.number(), baseline: z.number() })),
  arrivalWithGuidanceS: z.number().nullable(),
  arrivalBaselineS: z.number().nullable(),
  peakNearWithGuidance: z.number(),
  peakNearBaseline: z.number(),
})

const scenarioStep = z.enum(['normal', 'congestion', 'sos', 'camera', 'acknowledge', 'guidance', 'compare'])

export const scenarioSchema: z.ZodType<ScenarioState, unknown> = z.object({
  seed: z.number(),
  step: scenarioStep,
  completed: z.array(scenarioStep).default([]),
  playing: z.boolean(),
  speed: z.number().positive(),
  autoplay: z.boolean(),
  cameraOutcome: z.enum(['detected', 'ambiguous', 'not_visible']),
  flakyRadio: z.boolean(),
  linkDown: z.boolean(),
  compliance: z.number().min(0).max(1),
  comparison: comparisonSchema.optional(),
  simulatedBands: z
    .object({ commandId: z.string(), signalled: z.number().int().nonnegative(), following: z.number().int().nonnegative(), estimate: z.boolean() })
    .optional(),
})

export const snapshotSchema: z.ZodType<WorldSnapshot, unknown> = z.object({
  timestamp,
  seq: z.number().int().nonnegative(),
  mode: z.enum(['simulation', 'live', 'hybrid']),
  venue: venueSchema,
  zones: z.array(zoneStateSchema).default([]),
  devices: z.array(deviceSchema).default([]),
  incidents: z.array(incidentSchema).default([]),
  observations: z.array(observationSchema).default([]),
  commands: z.array(guidanceSchema).default([]),
  sources: z.array(sourceStatusSchema).default([]),
  scenario: scenarioSchema.optional(),
  history: z
    .array(
      z.object({
        t: timestamp,
        peakDensity: z.number().nonnegative(),
        status: z.enum(['normal', 'caution', 'critical', 'unknown']).catch('unknown'),
        zoneId: z.string(),
      }),
    )
    .optional(),
})

const envelope = { seq: z.number().int().nonnegative(), at: timestamp }

export const streamEventSchema: z.ZodType<StreamEvent, unknown> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), ...envelope, snapshot: snapshotSchema }),
  z.object({ type: z.literal('zones'), ...envelope, zones: z.array(zoneStateSchema) }),
  z.object({ type: z.literal('device'), ...envelope, device: deviceSchema }),
  z.object({ type: z.literal('incident'), ...envelope, incident: incidentSchema }),
  z.object({ type: z.literal('observation'), ...envelope, observation: observationSchema }),
  z.object({ type: z.literal('guidance'), ...envelope, command: guidanceSchema }),
  z.object({ type: z.literal('source'), ...envelope, source: sourceStatusSchema }),
  z.object({ type: z.literal('entities'), ...envelope, entities: z.array(trackedEntitySchema) }),
  z.object({ type: z.literal('scenario'), ...envelope, scenario: scenarioSchema }),
  z.object({ type: z.literal('heartbeat'), ...envelope }),
])
