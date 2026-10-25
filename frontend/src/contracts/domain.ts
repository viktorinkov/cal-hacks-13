/**
 * BandIt frontend domain model.
 *
 * These are the stable shapes every component, store and renderer works with. Backend payloads are
 * normalised into them at the transport boundary (services/normalize.ts) and never leak past it.
 *
 * Coordinates are venue-local metres: origin at the top-left corner of the venue plan, x east,
 * y south (toward the gates). Timestamps are epoch milliseconds once normalised.
 */

export interface Vec2 {
  x: number
  y: number
}

export type Polygon = Vec2[]
export type Polyline = Vec2[]

// ---------------------------------------------------------------- venue

export type SectionKind = 'front' | 'floor' | 'wing' | 'concourse' | 'plaza' | 'food' | 'passage'

export interface VenueZone {
  zoneId: string
  name: string
  section: SectionKind
  polygon: Polygon
  areaM2: number
  /** Where the zone label sits on the map. */
  labelAt: Vec2
  /** Height of the zone's floor above the ground, for raised stands. 0 or absent: ground level. */
  elevationM?: number
}

/** A raised floor people can stand on, such as a side stand. */
export interface Platform {
  platformId: string
  name: string
  polygon: Polygon
  elevationM: number
  zoneId: string
}

/** A stair between the ground and a platform. `bottom` is on the ground, `top` meets the platform. */
export interface Stair {
  stairId: string
  name: string
  polygon: Polygon
  bottom: Vec2
  top: Vec2
  topElevationM: number
  platformId: string
}

export interface Walkway {
  walkwayId: string
  name: string
  polygon: Polygon
  status: 'open' | 'closed'
  widthM: number
}

export interface Exit {
  exitId: string
  name: string
  kind: 'exit' | 'gate'
  segment: [Vec2, Vec2]
}

export interface Stage {
  stageId: string
  name: string
  polygon: Polygon
  deckHeightM: number
  /** The video wall stands upright along this line. */
  ledWall?: { from: Vec2; to: Vec2; bottomM: number; topM: number }
  /** Lighting positions along the front truss. */
  truss: Vec2[]
  trussHeightM: number
  barricade: Polyline
}

export type StructureKind =
  | 'stage'
  | 'speaker'
  | 'tower'
  | 'tent'
  | 'bar'
  | 'counter'
  | 'truck'
  | 'table'
  | 'wall'
  | 'barrier'
  | 'fence'
  | 'container'
  | 'block'
  | 'pole'
  | 'tier'
  | 'rail'

/** Something built on the site, extruded on the 3D map. */
export interface Structure {
  structureId: string
  name: string
  kind: StructureKind
  footprint: Polygon
  heightM: number
  baseM: number
  /** People cannot walk through it. */
  blocksMovement: boolean
}

export interface CameraLocation {
  cameraId: string
  name: string
  position: Vec2
  mountHeightM: number
  /** Area the camera can see, as installed. Detections outside it are reported as not visible. */
  coverage: Polygon
}

export interface Station {
  stationId: string
  name: string
  kind: 'gateway' | 'anchor' | 'first_aid'
  position: Vec2
}

export interface ResponderCorridor {
  corridorId: string
  name: string
  /** Station the responders leave from. */
  fromStationId: string
  path: Polyline
  widthM: number
  lengthM: number
  servesZoneIds: string[]
  viaWalkwayIds: string[]
  /** Approved by venue safety staff during planning. The frontend never invents corridors. */
  preapproved: boolean
}

export interface Obstacle {
  obstacleId: string
  name: string
  kind: 'stage' | 'backstage' | 'structure' | 'facility' | 'wall'
  polygon: Polygon
}

export interface ScheduleSlot {
  title: string
  startsAt: number
  endsAt: number
}

export interface Venue {
  venueId: string
  name: string
  width: number
  height: number
  coordinateSystem: { units: 'm'; origin: 'top-left'; xAxis: 'east'; yAxis: 'south' }
  zones: VenueZone[]
  walkways: Walkway[]
  exits: Exit[]
  stages: Stage[]
  structures: Structure[]
  platforms: Platform[]
  stairs: Stair[]
  cameraLocations: CameraLocation[]
  stationLocations: Station[]
  responderCorridors: ResponderCorridor[]
  obstacles: Obstacle[]
  schedule: ScheduleSlot[]
  timeZone: string
}

// ---------------------------------------------------------------- devices

export type HardwareVariant = 'full' | 'light' | 'gateway' | 'station'
export type ConnectionStatus = 'connected' | 'delayed' | 'disconnected' | 'unknown'
export type LocationSource = 'camera' | 'station_estimate' | 'manually_assigned' | 'simulated' | 'unknown'

/** LED ring patterns from the hardware spec (12-pixel ring). */
export type LedPattern = 'ready' | 'sos' | 'steady_red' | 'step_aside' | 'help_coming' | 'off' | 'unknown'

export interface Device {
  deviceId: string
  /** Short label printed on the band, e.g. "03". */
  label: string
  hardwareVariant: HardwareVariant
  connectionStatus: ConnectionStatus
  lastSeenAt: number | null
  currentPattern: LedPattern
  sosActive: boolean
  location?: Vec2
  locationSource: LocationSource
  /** 0..1, only when the backend supplies one. Never derived in the frontend. */
  locationConfidence?: number
  /** Uncertainty radius in metres, only when the backend supplies one. */
  locationRadiusM?: number
  zoneId?: string
  hapticsSupported: boolean
  imuSupported: boolean
  pendingCommandIds: string[]
  /** Who is wearing it for the demo, if anyone. Not personal data: a role label only. */
  wearerLabel: string | null
}

// ---------------------------------------------------------------- crowd

export type CongestionStatus = 'normal' | 'caution' | 'critical' | 'unknown'
export type ZoneDataSource = 'camera' | 'simulation' | 'estimated' | 'forecast'
export type DataQuality = 'good' | 'degraded' | 'stale' | 'missing'

export interface ZoneState {
  zoneId: string
  timestamp: number
  occupancyEstimate?: number
  /** People per square metre, averaged over the zone. */
  estimatedDensity?: number
  /** People per square metre at the zone's densest spot. */
  peakDensity?: number
  /** People per minute entering / leaving over the last minute. */
  flowIn?: number
  flowOut?: number
  congestionStatus: CongestionStatus
  source: ZoneDataSource
  dataQuality: DataQuality
  updatedAt: number
}

export type EntityType = 'simulated_person' | 'observed_person' | 'physical_band'

export interface TrackedEntity {
  id: string
  type: EntityType
  x: number
  y: number
  velocity?: Vec2
  source: 'simulation' | 'camera' | 'radio'
  confidence?: number
  observedAt: number
  role?: 'attendee' | 'responder'
}

/** Entity kinds packed into frames. Simulation and observation are never mixed into one kind. */
export const EntityKind = {
  SimAttendee: 0,
  ObservedPerson: 1,
  SimResponder: 2,
} as const
export type EntityKindCode = (typeof EntityKind)[keyof typeof EntityKind]

/**
 * High-frequency spatial data, kept out of React. Positions are interleaved x,y in metres.
 * A frame is either fully simulated or fully observed; `source` says which.
 */
export interface EntityFrame {
  seq: number
  t: number
  source: 'simulation' | 'camera'
  count: number
  positions: Float32Array
  velocities: Float32Array
  kinds: Uint8Array
  /** 0 walking, 1 standing, 2 seated. Local crowd only; absent means everyone is upright. */
  pose?: Uint8Array
  /** Floor height under each person, metres. Absent means the plan point's surface, which is wrong under a balcony. */
  heights?: Float32Array
  /** Same-seed run without guidance, for the comparison overlay. Simulation only. */
  baseline?: { count: number; positions: Float32Array }
}

// ---------------------------------------------------------------- incidents

export type IncidentStatus = 'reported' | 'acknowledged' | 'responding' | 'resolved'
export type IncidentSource = 'manual_sos' | 'camera_suspicion' | 'imu_suspicion' | 'staff'
export type RadioStatus = 'received' | 'delayed' | 'lost' | 'unknown'
export type LocalizationStatus = 'unknown' | 'estimated' | 'visually_confirmed'

export type TimelineSource = 'radio' | 'camera' | 'operator' | 'device' | 'system'

export interface TimelineEntry {
  at: number
  source: TimelineSource
  text: string
  actor?: string
}

export interface RadioReport {
  gatewayId?: string
  receivedAt?: number
  /** How long the SOS button was held. */
  holdMs?: number
  /** IMU impact peak, full bands only. */
  impactG?: number
  stillSeconds?: number
}

export type ResolutionReason = 'assisted_on_scene' | 'handed_to_medical' | 'false_alarm' | 'other'

export interface Incident {
  incidentId: string
  /** Human label, e.g. INC-0142. */
  displayId: string
  reportedByDeviceId: string | null
  reportedAt: number
  status: IncidentStatus
  source: IncidentSource
  radioStatus: RadioStatus
  radio?: RadioReport
  candidateZone?: string
  location?: Vec2
  locationRadiusM?: number
  localizationStatus: LocalizationStatus
  cameraObservations: string[]
  acknowledgedBy?: string
  acknowledgedAt?: number
  resolvedAt?: number
  resolution?: { reason: ResolutionReason; note?: string; by?: string }
  timeline: TimelineEntry[]
  guidanceCommandIds: string[]
  /** True when the incident originated in the simulator rather than a physical band. */
  isSimulated: boolean
}

export type ObservationStatus = 'pending' | 'detected' | 'ambiguous' | 'not_visible'

export interface CameraObservation {
  detectionId: string
  cameraId: string
  timestamp: number
  kind: 'sos_flash' | 'fall_pose'
  /** Normalised 0..1 box within the camera frame. */
  boundingBox?: { x: number; y: number; w: number; h: number }
  candidateZone?: string
  confidence?: number
  associatedIncidentId?: string
  evidenceUrl?: string
  status: ObservationStatus
  /** Where the detection projects onto the venue, when the camera calibration allows it. */
  worldLocation?: Vec2
  worldRadiusM?: number
  isSimulated: boolean
}

// ---------------------------------------------------------------- guidance

export type ApprovalStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'expired' | 'cancelled'
export type DeliveryStatus = 'not_sent' | 'sending' | 'partial' | 'delivered' | 'failed' | 'cancelled'
export type TargetStatus = 'pending' | 'sent' | 'acknowledged' | 'failed' | 'cancelled'

export interface DeviceTarget {
  deviceId: string
  patternCode: LedPattern
  haptic: boolean
  status: TargetStatus
  updatedAt?: number
  attempts: number
}

export interface GuidanceGroup {
  patternCode: LedPattern
  deviceIds: string[]
  /** Plain words for the operator, e.g. "Step aside on the path". */
  label: string
}

export interface GuidancePreview {
  corridorId: string
  corridorName: string
  lengthM: number
  groups: GuidanceGroup[]
  /** Wording shown to people near the incident, from the venue's approved advisory set. */
  advisoryCode: string
  /** Other preapproved corridors that also reach this incident. */
  alternativeCorridorIds: string[]
}

export interface GuidanceCommand {
  commandId: string
  incidentId?: string
  corridorId?: string
  targetZoneIds: string[]
  targetDeviceIds: string[]
  targets: DeviceTarget[]
  patternCode: LedPattern
  reason: string
  preview: GuidancePreview
  approvalStatus: ApprovalStatus
  approvedBy?: string
  approvedAt?: number
  createdAt: number
  expiresAt: number
  deliveryStatus: DeliveryStatus
  acknowledgedDevices: string[]
  failedDevices: string[]
  isSimulated: boolean
}

export interface GuidancePreviewRequest {
  incidentId: string
  corridorId?: string
}

// ---------------------------------------------------------------- sources and world

export type OperatingMode = 'simulation' | 'live' | 'hybrid'

export interface SourceStatus {
  sourceId: string
  kind: 'backend' | 'gateway' | 'camera' | 'crowd' | 'devices'
  label: string
  status: 'ok' | 'degraded' | 'down' | 'unknown'
  lastUpdateAt: number | null
  isSimulated: boolean
  detail?: string
}

export type ScenarioStep = 'normal' | 'congestion' | 'sos' | 'camera' | 'acknowledge' | 'guidance' | 'compare'

export type CameraOutcome = 'detected' | 'ambiguous' | 'not_visible'

/** Demo director state. Only present when a demo service is running. */
export interface ScenarioState {
  seed: number
  step: ScenarioStep
  completed: ScenarioStep[]
  playing: boolean
  speed: number
  autoplay: boolean
  cameraOutcome: CameraOutcome
  flakyRadio: boolean
  linkDown: boolean
  /** Share of simulated attendees assumed to follow their band. */
  compliance: number
  comparison?: ComparisonResult
  /** Simulated attendees' bands that guidance reaches. The physical demo bands are the command's own targets. */
  simulatedBands?: SimulatedBands
}

export interface SimulatedBands {
  commandId: string
  /** Bands signalled so far; for a preview, the bands the path would signal if approved now. */
  signalled: number
  /** How many of them follow their band, under the compliance assumption. */
  following: number
  /** True for a preview: nothing has been sent yet. */
  estimate: boolean
}

export interface ComparisonSample {
  /** Seconds since guidance was approved. */
  t: number
  /** Simulated people within the corridor, with and without guidance. */
  withGuidance: number
  baseline: number
}

export interface ComparisonResult {
  corridorId: string
  startedAt: number
  samples: ComparisonSample[]
  /** Seconds for the simulated responder to reach the incident; null until they arrive. */
  arrivalWithGuidanceS: number | null
  arrivalBaselineS: number | null
  peakNearWithGuidance: number
  peakNearBaseline: number
}

/** Venue-wide crowd pressure over time: the densest zone at each sample. */
export interface PressureSample {
  t: number
  peakDensity: number
  status: CongestionStatus
  zoneId: string
}

export interface WorldSnapshot {
  timestamp: number
  seq: number
  mode: OperatingMode
  venue: Venue
  zones: ZoneState[]
  devices: Device[]
  incidents: Incident[]
  observations: CameraObservation[]
  commands: GuidanceCommand[]
  sources: SourceStatus[]
  scenario?: ScenarioState
  /** Recent pressure history so the timeline is not empty after a reload. Optional. */
  history?: PressureSample[]
}

// ---------------------------------------------------------------- stream

export type StreamEvent =
  | { type: 'snapshot'; seq: number; at: number; snapshot: WorldSnapshot }
  | { type: 'zones'; seq: number; at: number; zones: ZoneState[] }
  | { type: 'device'; seq: number; at: number; device: Device }
  | { type: 'incident'; seq: number; at: number; incident: Incident }
  | { type: 'observation'; seq: number; at: number; observation: CameraObservation }
  | { type: 'guidance'; seq: number; at: number; command: GuidanceCommand }
  | { type: 'source'; seq: number; at: number; source: SourceStatus }
  | { type: 'entities'; seq: number; at: number; entities: TrackedEntity[] }
  | { type: 'scenario'; seq: number; at: number; scenario: ScenarioState }
  | { type: 'heartbeat'; seq: number; at: number }

export type StreamEventType = StreamEvent['type']

export type ConnectionPhase = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface ConnectionState {
  phase: ConnectionPhase
  attempt: number
  lastMessageAt: number | null
  nextRetryAt: number | null
  error?: string
}
