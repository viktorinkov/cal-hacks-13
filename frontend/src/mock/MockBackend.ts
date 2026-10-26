/**
 * A simulated BandIt backend that runs in the browser.
 *
 * It owns the same things the Rust service will own: incident authority, device state, guidance
 * commands and their acknowledgements. The frontend talks to it only through MockBackendAdapter,
 * which exposes exactly the BackendAdapter interface the live service implements, so every screen
 * exercises the real code paths. Everything it produces is flagged as simulated.
 *
 * Time is virtual: `advance(ms)` moves the clock in fixed 100 ms steps, so a run is reproducible
 * from its seed regardless of frame rate.
 */
import type {
  CameraObservation,
  CameraOutcome,
  ComparisonResult,
  CongestionStatus,
  Device,
  EntityFrame,
  GuidanceCommand,
  GuidanceGroup,
  GuidancePreviewRequest,
  Incident,
  LedPattern,
  ResponderCorridor,
  PressureSample,
  ResolutionReason,
  ScenarioState,
  ScenarioStep,
  SourceStatus,
  StreamEvent,
  Vec2,
  Venue,
  WorldSnapshot,
  ZoneState,
} from '@/contracts/domain'
import { EntityKind } from '@/contracts/domain'
import { liveDevices } from '@/booth/place'
import { useBooth } from '@/booth/circle'
import { Path, distance, newProjectResult, pointInPolygon } from '@/lib/geometry'
import { sendBandPattern } from '@/stdb/session'
import { MOCK_BANDS, initialDevice } from './bands'
import { STORY_START } from './clock'
import { CrowdSim, SIM_DT } from './sim/crowd'
import { Rng } from './sim/rng'
import { venue as defaultVenue } from './venue'

export const OPERATOR = 'Leo P'
export const MEDIC = 'M-1 R. Patel'
const AUTOPLAY_ACTOR = 'Autoplay'

export interface MockBackendOptions {
  seed?: number
  crowdSize?: number
  /** Seconds of crowd simulated before the story clock starts, so the crowd looks settled. */
  warmupS?: number
  venue?: Venue
}

export class CommandError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

interface Timer {
  at: number
  order: number
  fn: () => void
}

type EventBody = StreamEvent extends infer E ? (E extends { seq: number; at: number } ? Omit<E, 'seq' | 'at'> : never) : never

const STEP_MS = SIM_DT * 1000
/** Seconds of warm-up before zones and the pressure timeline are recorded. */
const SETTLE_S = 60

const THRESHOLDS: Record<string, [number, number]> = {
  // the pit in front of the stage is run as a pit (barricade, pit crew, a higher rated density),
  // so a packed rail is its normal state; everywhere else people still need room to move
  front: [5.6, 6.4],
  passage: [3.1, 4.1],
  default: [3.1, 4.1],
}

export class MockBackend {
  readonly venue: Venue
  readonly seed: number
  readonly crowdSize: number
  readonly warmupS: number

  now = STORY_START
  seq = 0
  sim!: CrowdSim
  baseline: CrowdSim | null = null
  devices = new Map<string, Device>()
  incidents = new Map<string, Incident>()
  observations = new Map<string, CameraObservation>()
  commands = new Map<string, GuidanceCommand>()
  zones = new Map<string, ZoneState>()
  sources = new Map<string, SourceStatus>()
  scenario!: ScenarioState
  history: PressureSample[] = []

  private listeners = new Set<(e: StreamEvent) => void>()
  private frameListeners = new Set<(f: EntityFrame) => void>()
  private timers: Timer[] = []
  private timerOrder = 0
  private accum = 0
  private stepCount = 0
  private rng!: Rng
  private incidentCounter = 141
  private boothCorridor: ResponderCorridor | null = null
  private idCounter = 0
  private agentOfDevice = new Map<string, number>()
  private comparisonPath: Path | null = null
  private comparisonStop = -1
  private startedAt = STORY_START
  private autoplayDone = new Set<string>()

  constructor(opts: MockBackendOptions = {}) {
    this.venue = opts.venue ?? defaultVenue
    this.seed = opts.seed ?? 2026
    this.crowdSize = opts.crowdSize ?? 2900
    this.warmupS = opts.warmupS ?? 90
    this.reset(false)
  }

  // ------------------------------------------------------------------ subscriptions

  onEvent(cb: (e: StreamEvent) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  onFrame(cb: (f: EntityFrame) => void): () => void {
    this.frameListeners.add(cb)
    return () => this.frameListeners.delete(cb)
  }

  snapshot(): WorldSnapshot {
    return {
      timestamp: this.now,
      seq: this.seq,
      mode: 'simulation',
      venue: this.venue,
      zones: [...this.zones.values()],
      devices: [...this.devices.values()].map(cloneDevice),
      incidents: [...this.incidents.values()].map(cloneIncident),
      observations: [...this.observations.values()].map((o) => ({ ...o })),
      commands: [...this.commands.values()].map(cloneCommand),
      sources: [...this.sources.values()].map((s) => ({ ...s })),
      scenario: { ...this.scenario, completed: [...this.scenario.completed] },
      history: [...this.history],
    }
  }

  // ------------------------------------------------------------------ clock

  /** Advance the virtual clock by `ms` of wall time, scaled by the playback speed. */
  advance(ms: number): void {
    if (!this.scenario.playing) return
    this.accum += ms * this.scenario.speed
    let steps = 0
    while (this.accum >= STEP_MS && steps < 8) {
      this.accum -= STEP_MS
      this.step()
      steps++
    }
    if (steps === 8) this.accum = 0
  }

  /** Run exactly `ms` of virtual time, ignoring speed and the catch-up cap. For tests and tools. */
  advanceExact(ms: number): void {
    const steps = Math.round(ms / STEP_MS)
    for (let k = 0; k < steps; k++) this.step()
  }

  /** One 100 ms tick. Public for tests. */
  step(): void {
    this.sim.step()
    this.baseline?.step()
    this.now += STEP_MS
    this.stepCount++
    this.runTimers()
    this.runAutoplay()
    if (this.stepCount % 5 === 0) this.emitZones()
    if (this.stepCount % 3 === 0) this.emitDevicePositions()
    if (this.stepCount % 10 === 0) {
      const bandsChanged = this.sampleSimBands()
      if (!this.sampleComparison() && bandsChanged) this.emitScenario()
      this.emit({ type: 'heartbeat' })
    }
    this.emitFrame()
  }

  private schedule(delayMs: number, fn: () => void): void {
    this.timers.push({ at: this.now + delayMs, order: this.timerOrder++, fn })
    this.timers.sort((a, b) => a.at - b.at || a.order - b.order)
  }

  private runTimers(): void {
    while (this.timers.length && this.timers[0].at <= this.now) {
      const t = this.timers.shift()!
      t.fn()
    }
  }

  // ------------------------------------------------------------------ reset

  reset(announce = true): void {
    this.rng = new Rng(this.seed ^ 0x5bd1e995)
    this.timers = []
    this.incidents.clear()
    this.observations.clear()
    this.commands.clear()
    this.baseline = null
    this.comparisonPath = null
    this.comparisonStop = -1
    this.incidentCounter = 141
    this.autoplayDone.clear()
    this.history = []
    this.stepCount = 0
    this.accum = 0
    const anchors = MOCK_BANDS.filter((b) => b.anchor).map((b) => b.anchor!)
    this.agentOfDevice.clear()
    MOCK_BANDS.forEach((b, i) => {
      if (b.anchor) this.agentOfDevice.set(b.deviceId, i)
    })
    this.sim = new CrowdSim({ seed: this.seed, count: this.crowdSize, venue: this.venue, anchors, compliance: 0.75 })
    // warm up so the crowd has settled and the pressure timeline has a recent past
    const warmSteps = Math.round(this.warmupS / SIM_DT)
    this.now = STORY_START - warmSteps * STEP_MS
    // the first seconds are people finding their places, not pressure: keep them off the timeline
    const settleSteps = Math.min(warmSteps, Math.round(SETTLE_S / SIM_DT))
    for (let k = 0; k < warmSteps; k++) {
      this.sim.step()
      this.now += STEP_MS
      if (k % 10 === 9 && k >= settleSteps) this.computeZones()
    }
    this.now = STORY_START
    this.startedAt = this.now
    this.devices.clear()
    for (const b of MOCK_BANDS) this.devices.set(b.deviceId, initialDevice(b, this.now))
    this.syncDevicePositions()
    this.computeZones()
    const prev = this.scenario
    this.scenario = {
      seed: this.seed,
      step: 'normal',
      completed: ['normal'],
      playing: true,
      speed: prev?.speed ?? 1,
      autoplay: prev?.autoplay ?? false,
      cameraOutcome: prev?.cameraOutcome ?? 'detected',
      flakyRadio: prev?.flakyRadio ?? false,
      linkDown: false,
      compliance: 0.75,
    }
    this.initSources()
    if (announce) this.emit({ type: 'snapshot', snapshot: this.snapshot() })
  }

  private initSources(): void {
    const ok = (s: Omit<SourceStatus, 'lastUpdateAt' | 'status'> & Partial<SourceStatus>): SourceStatus => ({
      status: 'ok',
      lastUpdateAt: this.now,
      ...s,
    })
    this.sources.clear()
    const list: SourceStatus[] = [
      ok({ sourceId: 'backend', kind: 'backend', label: 'Local backend', isSimulated: true, detail: 'Runs in this browser tab' }),
      ok({ sourceId: 'gateway:GW-01', kind: 'gateway', label: 'Gateway gw-01', isSimulated: true }),
      ok({ sourceId: 'camera:CAM-01', kind: 'camera', label: 'CAM-01', isSimulated: true }),
      ok({ sourceId: 'camera:CAM-02', kind: 'camera', label: 'CAM-02', isSimulated: true }),
      ok({ sourceId: 'crowd', kind: 'crowd', label: `Crowd · seed ${this.seed}`, isSimulated: true, detail: `${this.crowdSize.toLocaleString('en-US')} local attendees` }),
    ]
    for (const s of list) this.sources.set(s.sourceId, s)
  }

  // ------------------------------------------------------------------ emission

  private emit(body: EventBody): void {
    this.seq += 1
    const event = { ...body, seq: this.seq, at: this.now } as StreamEvent
    for (const l of this.listeners) l(event)
  }

  private emitFrame(): void {
    if (!this.frameListeners.size) return
    const sim = this.sim
    const r = sim.responder
    const count = sim.n + (r.active ? 1 : 0)
    const positions = new Float32Array(count * 2)
    const velocities = new Float32Array(count * 2)
    const kinds = new Uint8Array(count)
    for (let i = 0; i < sim.n; i++) {
      positions[2 * i] = sim.x[i]
      positions[2 * i + 1] = sim.y[i]
      velocities[2 * i] = sim.vx[i]
      velocities[2 * i + 1] = sim.vy[i]
    }
    if (r.active) {
      const k = sim.n
      positions[2 * k] = r.x
      positions[2 * k + 1] = r.y
      velocities[2 * k] = r.vx
      velocities[2 * k + 1] = r.vy
      kinds[k] = EntityKind.SimResponder
    }
    const frame: EntityFrame = { seq: this.stepCount, t: this.now, source: 'simulation', count, positions, velocities, kinds }
    if (this.baseline) {
      const b = this.baseline
      const bp = new Float32Array((b.n + (b.responder.active ? 1 : 0)) * 2)
      for (let i = 0; i < b.n; i++) {
        bp[2 * i] = b.x[i]
        bp[2 * i + 1] = b.y[i]
      }
      if (b.responder.active) {
        bp[2 * b.n] = b.responder.x
        bp[2 * b.n + 1] = b.responder.y
      }
      frame.baseline = { count: bp.length / 2, positions: bp }
    }
    for (const l of this.frameListeners) l(frame)
  }

  private computeZones(): void {
    const samples = this.sim.zoneSamples()
    let worst: PressureSample | null = null
    for (const z of this.venue.zones) {
      const s = samples.get(z.zoneId)
      if (!s) continue
      const [caution, critical] = THRESHOLDS[z.section] ?? THRESHOLDS.default
      const status: CongestionStatus = s.peak >= critical ? 'critical' : s.peak >= caution ? 'caution' : 'normal'
      this.zones.set(z.zoneId, {
        zoneId: z.zoneId,
        timestamp: this.now,
        occupancyEstimate: s.count,
        estimatedDensity: round2(s.density),
        peakDensity: round2(s.peak),
        flowIn: s.flowIn,
        flowOut: s.flowOut,
        congestionStatus: status,
        source: 'simulation',
        dataQuality: 'good',
        updatedAt: this.now,
      })
      // pressure relative to the zone's own caution line, so a packed front of stage does not dominate
      const rel = s.peak / caution
      if (!worst || rel > worst.peakDensity / (THRESHOLDS[zoneSection(this.venue, worst.zoneId)] ?? THRESHOLDS.default)[0]) {
        worst = { t: this.now, peakDensity: round2(s.peak), status, zoneId: z.zoneId }
      }
    }
    if (worst && (this.history.length === 0 || this.now - this.history[this.history.length - 1].t >= 1000)) {
      this.history.push(worst)
      if (this.history.length > 600) this.history.shift()
    }
  }

  private emitZones(): void {
    this.computeZones()
    this.emit({ type: 'zones', zones: [...this.zones.values()] })
  }

  private syncDevicePositions(): void {
    for (const [id, agent] of this.agentOfDevice) {
      const d = this.devices.get(id)
      if (!d || d.connectionStatus === 'disconnected') continue
      d.location = { x: round2(this.sim.x[agent]), y: round2(this.sim.y[agent]) }
      d.zoneId = this.sim.zoneIdAt(this.sim.x[agent], this.sim.y[agent])
      d.lastSeenAt = this.now
    }
  }

  private emitDevicePositions(): void {
    this.syncDevicePositions()
    for (const id of this.agentOfDevice.keys()) {
      const d = this.devices.get(id)
      if (d && d.connectionStatus !== 'disconnected') this.emit({ type: 'device', device: cloneDevice(d) })
    }
  }

  private emitDevice(d: Device): void {
    this.emit({ type: 'device', device: cloneDevice(d) })
  }

  private emitIncident(inc: Incident): void {
    this.emit({ type: 'incident', incident: cloneIncident(inc) })
  }

  private emitCommand(cmd: GuidanceCommand): void {
    this.emit({ type: 'guidance', command: cloneCommand(cmd) })
  }

  private emitScenario(): void {
    this.emit({ type: 'scenario', scenario: { ...this.scenario, completed: [...this.scenario.completed] } })
  }

  private markStep(step: ScenarioStep): void {
    this.scenario.step = step
    if (!this.scenario.completed.includes(step)) this.scenario.completed.push(step)
    this.emitScenario()
  }

  private nextId(prefix: string): string {
    this.idCounter += 1
    return `${prefix}-${this.seed.toString(36)}${this.idCounter.toString(36).padStart(4, '0')}`
  }

  // ------------------------------------------------------------------ scripted triggers

  triggerCongestion(): void {
    this.sim.startSurge(50)
    this.markStep('congestion')
  }

  /** The equivalent of someone holding the SOS button on a band. */
  pressSos(deviceId = 'band-03', actor = 'test'): Incident | null {
    const dev = this.devices.get(deviceId)
    if (!dev || dev.connectionStatus === 'disconnected') return null
    const agent = this.agentOfDevice.get(deviceId)
    const truth = agent !== undefined ? { x: this.sim.x[agent], y: this.sim.y[agent] } : dev.location
    if (!truth) return null
    const pressedAt = this.now
    dev.sosActive = true
    dev.currentPattern = 'sos'
    this.emitDevice(dev)
    void actor
    // radio packet reaches the gateway ~350 ms later
    const incidentId = `inc-${String(++this.incidentCounter).padStart(4, '0')}`
    const displayId = `INC-${String(this.incidentCounter).padStart(4, '0')}`
    const estimate = this.radioEstimate(truth)
    const zoneId = this.sim.zoneIdAt(estimate.x, estimate.y) ?? dev.zoneId
    const inc: Incident = {
      incidentId,
      displayId,
      reportedByDeviceId: deviceId,
      reportedAt: pressedAt,
      status: 'reported',
      source: 'manual_sos',
      radioStatus: 'received',
      radio: { gatewayId: 'GW-01', receivedAt: pressedAt + 350, holdMs: 1650 },
      candidateZone: zoneId,
      location: estimate,
      locationRadiusM: 6,
      localizationStatus: 'estimated',
      cameraObservations: [],
      timeline: [
        { at: pressedAt, source: 'device', text: `SOS held 1.7 s on band-${dev.label}` },
        { at: pressedAt + 350, source: 'radio', text: 'Received by gw-01, position estimated from anchors' },
      ],
      guidanceCommandIds: [],
      isSimulated: true,
    }
    this.schedule(350, () => {
      this.incidents.set(incidentId, inc)
      if (agent !== undefined) this.sim.setIncident(truth, agent)
      this.emitIncident(inc)
      this.markStep('sos')
      this.startCameraSearch(inc, truth, 'sos_flash')
    })
    return inc
  }

  /** A full band's IMU reports an impact followed by stillness. Experimental. */
  suspectFall(deviceId = 'band-01'): Incident | null {
    const dev = this.devices.get(deviceId)
    if (!dev || !dev.imuSupported || dev.connectionStatus === 'disconnected') return null
    const agent = this.agentOfDevice.get(deviceId)
    const truth = agent !== undefined ? { x: this.sim.x[agent], y: this.sim.y[agent] } : dev.location
    if (!truth) return null
    const impactAt = this.now
    if (agent !== undefined) this.sim.setIncident(truth, agent)
    const incidentId = `inc-${String(++this.incidentCounter).padStart(4, '0')}`
    const displayId = `INC-${String(this.incidentCounter).padStart(4, '0')}`
    const estimate = this.radioEstimate(truth)
    const inc: Incident = {
      incidentId,
      displayId,
      reportedByDeviceId: deviceId,
      reportedAt: impactAt + 4200,
      status: 'reported',
      source: 'imu_suspicion',
      radioStatus: 'received',
      radio: { gatewayId: 'GW-01', receivedAt: impactAt + 4300, impactG: 2.9, stillSeconds: 4 },
      candidateZone: this.sim.zoneIdAt(estimate.x, estimate.y) ?? dev.zoneId,
      location: estimate,
      locationRadiusM: 6,
      localizationStatus: 'estimated',
      cameraObservations: [],
      timeline: [
        { at: impactAt, source: 'device', text: `band-${dev.label} wrist impact 2.9 g` },
        { at: impactAt + 4200, source: 'device', text: 'Then 4 s with no movement' },
        { at: impactAt + 4300, source: 'radio', text: 'Received by gw-01' },
      ],
      guidanceCommandIds: [],
      isSimulated: true,
    }
    this.schedule(4300, () => {
      this.incidents.set(incidentId, inc)
      this.emitIncident(inc)
      this.markStep('sos')
      this.startCameraSearch(inc, truth, 'fall_pose')
    })
    return inc
  }

  private radioEstimate(truth: Vec2): Vec2 {
    const a = this.rng.range(0, Math.PI * 2)
    const r = this.rng.range(1.5, 3.2)
    return { x: round2(truth.x + Math.cos(a) * r), y: round2(truth.y + Math.sin(a) * r) }
  }

  private startCameraSearch(inc: Incident, truth: Vec2, kind: CameraObservation['kind']): void {
    const cam = this.venue.cameraLocations.find((c) => pointInPolygon(truth.x, truth.y, c.coverage)) ?? this.venue.cameraLocations[0]
    const obs: CameraObservation = {
      detectionId: this.nextId('det'),
      cameraId: cam.cameraId,
      timestamp: this.now,
      kind,
      associatedIncidentId: inc.incidentId,
      candidateZone: inc.candidateZone,
      status: 'pending',
      isSimulated: true,
    }
    this.observations.set(obs.detectionId, obs)
    inc.cameraObservations.push(obs.detectionId)
    inc.timeline.push({
      at: this.now,
      source: 'camera',
      text: kind === 'sos_flash' ? `${cam.cameraId} looking for the SOS flash` : `${cam.cameraId} checking pose`,
    })
    this.emit({ type: 'observation', observation: { ...obs } })
    this.emitIncident(inc)

    this.schedule(kind === 'sos_flash' ? 2300 : 1200, () => {
      const current = this.incidents.get(inc.incidentId)
      if (!current || current.status === 'resolved') return
      const inView = pointInPolygon(truth.x, truth.y, cam.coverage)
      const outcome: CameraOutcome = inView ? this.scenario.cameraOutcome : 'not_visible'
      obs.timestamp = this.now
      if (outcome === 'detected') {
        obs.status = 'detected'
        obs.confidence = kind === 'sos_flash' ? 0.92 : 0.71
        obs.boundingBox = { x: 0.44, y: 0.6, w: 0.13, h: 0.15 }
        obs.worldLocation = { x: round2(truth.x + this.rng.range(-0.3, 0.3)), y: round2(truth.y + this.rng.range(-0.3, 0.3)) }
        obs.worldRadiusM = 1.5
        current.location = obs.worldLocation
        current.locationRadiusM = 1.5
        current.localizationStatus = 'visually_confirmed'
        current.candidateZone = this.sim.zoneIdAt(obs.worldLocation.x, obs.worldLocation.y) ?? current.candidateZone
        current.timeline.push({
          at: this.now,
          source: 'camera',
          text:
            kind === 'sos_flash'
              ? `${cam.cameraId} matched the SOS flash pattern (0.92)`
              : `${cam.cameraId} pose: upright to ground in 0.8 s (0.71)`,
        })
      } else if (outcome === 'ambiguous') {
        obs.status = 'ambiguous'
        obs.confidence = 0.48
        obs.boundingBox = { x: 0.3, y: 0.55, w: 0.4, h: 0.22 }
        current.timeline.push({ at: this.now, source: 'camera', text: `${cam.cameraId} saw two flashing sources; not matched` })
      } else {
        obs.status = 'not_visible'
        current.timeline.push({ at: this.now, source: 'camera', text: `Not in ${cam.cameraId}'s view; location stays a radio estimate` })
      }
      this.emit({ type: 'observation', observation: { ...obs } })
      this.emitIncident(current)
      this.markStep('camera')
    })
  }

  setCameraOutcome(o: CameraOutcome): void {
    this.scenario.cameraOutcome = o
    this.emitScenario()
  }

  setFlakyRadio(on: boolean): void {
    this.scenario.flakyRadio = on
    const gw = this.sources.get('gateway:GW-01')
    if (gw) {
      gw.status = on ? 'degraded' : 'ok'
      gw.detail = on ? 'Packet loss to some bands' : undefined
      gw.lastUpdateAt = this.now
      this.emit({ type: 'source', source: { ...gw } })
    }
    this.emitScenario()
  }

  setPlaying(on: boolean): void {
    this.scenario.playing = on
    this.emitScenario()
  }

  setSpeed(speed: number): void {
    this.scenario.speed = Math.max(0.25, Math.min(4, speed))
    this.emitScenario()
  }

  setAutoplay(on: boolean): void {
    this.scenario.autoplay = on
    this.emitScenario()
  }

  setLinkDown(on: boolean): void {
    this.scenario.linkDown = on
  }

  /** The live booth is a keep-out for the simulated crowd, and First Aid can walk to its centre. */
  setBooth(circle: { x: number; y: number; r: number } | null): void {
    this.sim.setKeepOut(circle)
    this.baseline?.setKeepOut(circle)
    if (!circle) {
      this.boothCorridor = null
      return
    }
    const from = { x: 10.3, y: 56 }
    this.boothCorridor = {
      corridorId: 'COR-BOOTH',
      name: 'First Aid to the live booth',
      fromStationId: 'FA-01',
      path: [from, { x: circle.x, y: circle.y }],
      widthM: 3,
      lengthM: Math.round(Math.hypot(circle.x - from.x, circle.y - from.y)),
      servesZoneIds: [],
      viaWalkwayIds: [],
      preapproved: true,
    }
  }

  /**
   * A real SOS or fall. Guidance still runs here. A repeat signal for the same band does not open
   * a second incident.
   */
  reportLive(input: { deviceId: string; label: string; at: Vec2; radius: number; kind: 'sos' | 'fall' }): Incident | null {
    const existing = [...this.incidents.values()].find((item) => item.reportedByDeviceId === input.deviceId && item.status !== 'resolved')
    if (existing) return existing
    const incidentId = `inc-${String(++this.incidentCounter).padStart(4, '0')}`
    const displayId = `INC-${String(this.incidentCounter).padStart(4, '0')}`
    const zoneId = this.sim.zoneIdAt(input.at.x, input.at.y)
    const inc: Incident = {
      incidentId,
      displayId,
      reportedByDeviceId: input.deviceId,
      reportedAt: this.now,
      status: 'reported',
      source: input.kind === 'fall' ? 'imu_suspicion' : 'manual_sos',
      radioStatus: 'received',
      radio: { gatewayId: 'GW-01', receivedAt: this.now, holdMs: input.kind === 'sos' ? 1650 : undefined },
      candidateZone: zoneId,
      location: { ...input.at },
      locationRadiusM: input.radius,
      localizationStatus: input.radius > 2 ? 'unknown' : 'estimated',
      cameraObservations: [],
      timeline: [
        {
          at: this.now,
          source: 'device',
          text: input.kind === 'fall' ? `Fall reported on band ${input.label}` : `SOS on band ${input.label}`,
        },
        { at: this.now, source: 'radio', text: 'Received from the live booth' },
      ],
      guidanceCommandIds: [],
      isSimulated: false,
    }
    this.incidents.set(incidentId, inc)
    this.emitIncident(inc)
    return inc
  }

  // ------------------------------------------------------------------ operator commands

  acknowledge(incidentId: string, actor = OPERATOR): Incident {
    const inc = this.requireIncident(incidentId)
    if (inc.status === 'resolved') throw new CommandError('conflict', 'Incident is already resolved')
    if (inc.status === 'reported') {
      inc.status = 'acknowledged'
      inc.acknowledgedBy = actor
      inc.acknowledgedAt = this.now
      inc.timeline.push({ at: this.now, source: 'operator', text: `Acknowledged by ${actor}`, actor })
      this.emitIncident(inc)
      this.markStep('acknowledge')
    }
    return cloneIncident(inc)
  }

  preview(req: GuidancePreviewRequest): GuidanceCommand {
    const inc = this.requireIncident(req.incidentId)
    if (inc.status === 'resolved') throw new CommandError('conflict', 'Incident is resolved')
    if (!inc.location) throw new CommandError('no_location', 'Incident has no location to route to')
    const options = this.corridorsFor(inc)
    const corridor = req.corridorId ? this.venue.responderCorridors.find((c) => c.corridorId === req.corridorId) : options[0]
    if (!corridor) throw new CommandError('no_corridor', 'No preapproved corridor reaches this zone')
    // drop any earlier draft for this incident
    for (const c of this.commands.values()) {
      if (c.incidentId === inc.incidentId && c.approvalStatus === 'pending_approval') {
        c.approvalStatus = 'cancelled'
        c.deliveryStatus = 'cancelled'
        this.emitCommand(c)
      }
    }
    const path = new Path(corridor.path)
    const pr = newProjectResult()
    const groups: Record<'help_coming' | 'steady_red' | 'step_aside', string[]> = { help_coming: [], steady_red: [], step_aside: [] }
    const pool = [...this.devices.values()]
    if (!inc.isSimulated) {
      for (const extra of liveDevices(useBooth.getState())) {
        if (!pool.some((item) => item.deviceId === extra.deviceId)) pool.push(extra)
      }
    }
    for (const d of pool) {
      if (!d.location || d.connectionStatus === 'disconnected') continue
      if (d.deviceId === inc.reportedByDeviceId) groups.help_coming.push(d.deviceId)
      else if (distance(d.location, inc.location) <= 6) groups.steady_red.push(d.deviceId)
      else if (path.project(d.location.x, d.location.y, pr).distance <= 3.5) groups.step_aside.push(d.deviceId)
    }
    const allGroups: GuidanceGroup[] = [
      { patternCode: 'steady_red', deviceIds: groups.steady_red, label: 'Steady red near the person' },
      { patternCode: 'step_aside', deviceIds: groups.step_aside, label: 'Step aside on the path' },
      { patternCode: 'help_coming', deviceIds: groups.help_coming, label: 'Help is coming' },
    ]
    const groupList = allGroups.filter((g) => g.deviceIds.length > 0)
    const targets = groupList.flatMap((g) =>
      g.deviceIds.map((id) => ({
        deviceId: id,
        patternCode: g.patternCode,
        haptic: (this.devices.get(id)?.hapticsSupported ?? false) && g.patternCode !== 'steady_red',
        status: 'pending' as const,
        attempts: 0,
      })),
    )
    const cmd: GuidanceCommand = {
      commandId: this.nextId('cmd'),
      incidentId: inc.incidentId,
      corridorId: corridor.corridorId,
      targetZoneIds: corridor.servesZoneIds,
      targetDeviceIds: targets.map((t) => t.deviceId),
      targets,
      patternCode: 'step_aside',
      reason: `Clear a path for First Aid to ${inc.displayId}`,
      preview: {
        corridorId: corridor.corridorId,
        corridorName: corridor.name,
        lengthM: corridor.lengthM,
        groups: groupList,
        advisoryCode: 'ADV-CLEAR-PATH',
        alternativeCorridorIds: options.map((c) => c.corridorId).filter((id) => id !== corridor.corridorId),
      },
      approvalStatus: 'pending_approval',
      createdAt: this.now,
      expiresAt: this.now + 120_000,
      deliveryStatus: 'not_sent',
      acknowledgedDevices: [],
      failedDevices: [],
      isSimulated: true,
    }
    this.commands.set(cmd.commandId, cmd)
    if (!inc.guidanceCommandIds.includes(cmd.commandId)) inc.guidanceCommandIds.push(cmd.commandId)
    // the simulated attendees wear bands too: estimate how many this path would reach
    const near = this.personAt(inc) ?? inc.location
    const est = this.sim.countInGuidanceArea(path, near)
    this.scenario.simulatedBands = { commandId: cmd.commandId, signalled: est, following: Math.round(est * this.scenario.compliance), estimate: true }
    this.emitCommand(cmd)
    this.emitIncident(inc)
    this.emitScenario()
    return cloneCommand(cmd)
  }

  approve(commandId: string, actor = OPERATOR): GuidanceCommand {
    const cmd = this.requireCommand(commandId)
    if (cmd.approvalStatus !== 'pending_approval') throw new CommandError('conflict', `Guidance is ${cmd.approvalStatus}`)
    if (this.now > cmd.expiresAt) {
      cmd.approvalStatus = 'expired'
      this.emitCommand(cmd)
      throw new CommandError('expired', 'Preview expired; preview again')
    }
    const inc = cmd.incidentId ? this.incidents.get(cmd.incidentId) : undefined
    cmd.approvalStatus = 'approved'
    cmd.approvedBy = actor
    cmd.approvedAt = this.now
    cmd.expiresAt = this.now + 90_000
    cmd.deliveryStatus = 'sending'
    for (const t of cmd.targets) {
      t.status = 'sent'
      t.attempts = 1
      t.updatedAt = this.now
      const d = this.devices.get(t.deviceId)
      if (d && !d.pendingCommandIds.includes(cmd.commandId)) {
        d.pendingCommandIds.push(cmd.commandId)
        this.emitDevice(d)
      }
    }
    this.emitCommand(cmd)
    if (inc) {
      inc.status = 'responding'
      const crowd = this.scenario.simulatedBands?.commandId === cmd.commandId ? this.scenario.simulatedBands : undefined
      const also = crowd ? ` and about ${crowd.signalled} crowd bands` : ''
      inc.timeline.push({ at: this.now, source: 'operator', text: `Path approved by ${actor}; sending to ${cmd.targets.length} test bands${also}`, actor })
      inc.timeline.push({ at: this.now, source: 'system', text: `${MEDIC} sent along the path, radio Ch 5` })
      this.emitIncident(inc)
      this.startIntervention(cmd, inc)
    }
    // per-band acknowledgements arrive over the radio, nearest first
    const gw = this.venue.stationLocations.find((s) => s.kind === 'gateway')?.position ?? { x: 50, y: 32 }
    const ordered = [...cmd.targets].sort((a, b) => {
      const da = this.devices.get(a.deviceId)?.location
      const db = this.devices.get(b.deviceId)?.location
      return (da ? distance(da, gw) : 99) - (db ? distance(db, gw) : 99)
    })
    const flaky = this.scenario.flakyRadio ? ordered.filter((t) => this.devices.get(t.deviceId)?.hardwareVariant === 'light').pop() : undefined
    ordered.forEach((t, k) => {
      if (t.deviceId.startsWith('live-')) {
        const id = Number(t.deviceId.slice(5))
        if (Number.isFinite(id)) sendBandPattern(id, t.patternCode)
        return
      }
      if (flaky && t.deviceId === flaky.deviceId) {
        this.schedule(3500, () => this.failTarget(cmd.commandId, t.deviceId))
      } else {
        this.schedule(600 + k * 220, () => this.ackTarget(cmd.commandId, t.deviceId))
      }
    })
    this.markStep('guidance')
    this.schedule(90_000, () => this.expire(cmd.commandId))
    return cloneCommand(cmd)
  }

  /** Resend to bands that failed or are still pending. */
  resend(commandId: string): GuidanceCommand {
    const cmd = this.requireCommand(commandId)
    if (cmd.approvalStatus !== 'approved') throw new CommandError('conflict', 'Guidance is not active')
    const retry = cmd.targets.filter((t) => t.status === 'failed' || t.status === 'sent')
    retry.forEach((t, k) => {
      t.status = 'sent'
      t.attempts += 1
      t.updatedAt = this.now
      cmd.failedDevices = cmd.failedDevices.filter((id) => id !== t.deviceId)
      this.schedule(900 + k * 200, () => this.ackTarget(cmd.commandId, t.deviceId))
    })
    cmd.deliveryStatus = deliveryOf(cmd)
    this.emitCommand(cmd)
    return cloneCommand(cmd)
  }

  cancel(commandId: string, actor = OPERATOR, quiet = false): GuidanceCommand {
    const cmd = this.requireCommand(commandId)
    if (cmd.approvalStatus === 'cancelled' || cmd.approvalStatus === 'expired') return cloneCommand(cmd)
    const wasActive = cmd.approvalStatus === 'approved'
    cmd.approvalStatus = 'cancelled'
    cmd.deliveryStatus = 'cancelled'
    for (const t of cmd.targets) if (t.status !== 'acknowledged') t.status = 'cancelled'
    this.emitCommand(cmd)
    if (wasActive) {
      this.restoreBands(cmd)
      this.sim.setGuidance(null, null)
      this.comparisonStop = this.now
      const inc = cmd.incidentId ? this.incidents.get(cmd.incidentId) : undefined
      if (inc && !quiet) {
        inc.timeline.push({ at: this.now, source: 'operator', text: `Signals stopped by ${actor}`, actor })
        this.emitIncident(inc)
      }
    }
    return cloneCommand(cmd)
  }

  resolve(incidentId: string, reason: ResolutionReason, actor = OPERATOR): Incident {
    const inc = this.requireIncident(incidentId)
    if (inc.status === 'resolved') return cloneIncident(inc)
    for (const id of inc.guidanceCommandIds) {
      const c = this.commands.get(id)
      if (c && (c.approvalStatus === 'approved' || c.approvalStatus === 'pending_approval')) this.cancel(id, actor, true)
    }
    inc.status = 'resolved'
    inc.resolvedAt = this.now
    inc.resolution = { reason, by: actor }
    inc.timeline.push({ at: this.now, source: 'operator', text: `Resolved by ${actor}: ${REASON_TEXT[reason]}`, actor })
    const reporter = inc.reportedByDeviceId ? this.devices.get(inc.reportedByDeviceId) : undefined
    if (reporter && reporter.sosActive) {
      this.schedule(500, () => {
        reporter.sosActive = false
        reporter.currentPattern = 'ready'
        this.emitDevice(reporter)
      })
    }
    this.emitIncident(inc)
    const anyOpen = [...this.incidents.values()].some((i) => i.status !== 'resolved')
    if (!anyOpen) {
      this.sim.setIncident(null, null)
      this.schedule(6000, () => {
        if (![...this.incidents.values()].some((i) => i.status !== 'resolved')) this.sim.clearResponder()
      })
    }
    if (this.comparisonStop < 0) this.comparisonStop = this.now
    this.markStep('compare')
    return cloneIncident(inc)
  }

  // ------------------------------------------------------------------ guidance internals

  corridorsFor(inc: Incident) {
    const zone = inc.candidateZone
    const all = [...this.venue.responderCorridors, ...(this.boothCorridor ? [this.boothCorridor] : [])].filter((c) => c.preapproved)
    const serving = all.filter((c) => zone && c.servesZoneIds.includes(zone))
    const pool = serving.length ? serving : all
    const loc = inc.location
    return [...pool].sort((a, b) => {
      if (!loc) return 0
      const ea = a.path[a.path.length - 1]
      const eb = b.path[b.path.length - 1]
      return distance(ea, loc) - distance(eb, loc)
    })
  }

  private startIntervention(cmd: GuidanceCommand, inc: Incident): void {
    const corridor =
      this.venue.responderCorridors.find((c) => c.corridorId === cmd.corridorId) ??
      (this.boothCorridor?.corridorId === cmd.corridorId ? this.boothCorridor : undefined)
    if (!corridor || !inc.location) return
    const path = new Path(corridor.path)
    const target = this.personAt(inc) ?? inc.location
    // fork the crowd before guidance changes anything: same seed, same state, no bands
    this.baseline = this.sim.clone()
    this.sim.setGuidance(path, target)
    this.scenario.simulatedBands = { commandId: cmd.commandId, signalled: 0, following: 0, estimate: false }
    this.sim.dispatchResponder(path, target)
    this.baseline.dispatchResponder(path, target)
    this.comparisonPath = path
    this.comparisonStop = -1
    this.scenario.comparison = {
      corridorId: corridor.corridorId,
      startedAt: this.now,
      samples: [],
      arrivalWithGuidanceS: null,
      arrivalBaselineS: null,
      peakNearWithGuidance: 0,
      peakNearBaseline: 0,
    }
    this.sampleComparison()
  }

  /** Where the person who pressed SOS is now, if a simulated attendee wears the band. */
  private personAt(inc: Incident): Vec2 | null {
    const agent = inc.reportedByDeviceId ? this.agentOfDevice.get(inc.reportedByDeviceId) : undefined
    return agent !== undefined ? { x: this.sim.x[agent], y: this.sim.y[agent] } : null
  }

  /** Refresh the simulated bands count while guidance runs. True if it changed. */
  private sampleSimBands(): boolean {
    const cur = this.scenario.simulatedBands
    if (!cur || cur.estimate || !this.sim.field) return false
    const { signalled, following } = this.sim.signalledCount()
    if (signalled === cur.signalled && following === cur.following) return false
    this.scenario.simulatedBands = { ...cur, signalled, following }
    return true
  }

  /** True if it emitted the scenario. */
  private sampleComparison(): boolean {
    const cmp = this.scenario.comparison
    if (!cmp || !this.baseline || !this.comparisonPath) return false
    // stop when guidance ends: after that the two runs no longer differ only by the bands
    if (this.comparisonStop >= 0) return false
    const target = this.sim.incident ?? this.sim.responder.target
    const t = Math.round((this.now - cmp.startedAt) / 1000)
    const withG = this.sim.countOnPath(this.comparisonPath, 1.5)
    const base = this.baseline.countOnPath(this.comparisonPath, 1.5)
    const next: ComparisonResult = { ...cmp, samples: [...cmp.samples, { t, withGuidance: withG, baseline: base }].slice(-180) }
    if (target) {
      next.peakNearWithGuidance = Math.max(cmp.peakNearWithGuidance, this.sim.countNear(target, 4))
      next.peakNearBaseline = Math.max(cmp.peakNearBaseline, this.baseline.countNear(target, 4))
    }
    const r = this.sim.responder
    const rb = this.baseline.responder
    if (r.arrivedAt >= 0 && next.arrivalWithGuidanceS === null) next.arrivalWithGuidanceS = round1(r.arrivedAt - r.dispatchedAt)
    if (rb.arrivedAt >= 0 && next.arrivalBaselineS === null) next.arrivalBaselineS = round1(rb.arrivedAt - rb.dispatchedAt)
    this.scenario.comparison = next
    this.emitScenario()
    return true
  }

  private ackTarget(commandId: string, deviceId: string): void {
    const cmd = this.commands.get(commandId)
    if (!cmd || cmd.approvalStatus !== 'approved') return
    const t = cmd.targets.find((x) => x.deviceId === deviceId)
    if (!t || t.status === 'acknowledged') return
    t.status = 'acknowledged'
    t.updatedAt = this.now
    if (!cmd.acknowledgedDevices.includes(deviceId)) cmd.acknowledgedDevices.push(deviceId)
    cmd.failedDevices = cmd.failedDevices.filter((id) => id !== deviceId)
    cmd.deliveryStatus = deliveryOf(cmd)
    const d = this.devices.get(deviceId)
    if (d) {
      d.currentPattern = t.patternCode
      d.pendingCommandIds = d.pendingCommandIds.filter((id) => id !== commandId)
      d.lastSeenAt = this.now
      this.emitDevice(d)
    }
    this.emitCommand(cmd)
    if (cmd.deliveryStatus === 'delivered') {
      const inc = cmd.incidentId ? this.incidents.get(cmd.incidentId) : undefined
      if (inc) {
        inc.timeline.push({ at: this.now, source: 'device', text: `${cmd.acknowledgedDevices.length} test bands confirmed their signals` })
        this.emitIncident(inc)
      }
    }
  }

  private failTarget(commandId: string, deviceId: string): void {
    const cmd = this.commands.get(commandId)
    if (!cmd || cmd.approvalStatus !== 'approved') return
    const t = cmd.targets.find((x) => x.deviceId === deviceId)
    if (!t || t.status !== 'sent') return
    t.status = 'failed'
    t.updatedAt = this.now
    if (!cmd.failedDevices.includes(deviceId)) cmd.failedDevices.push(deviceId)
    cmd.deliveryStatus = deliveryOf(cmd)
    const d = this.devices.get(deviceId)
    if (d) {
      d.pendingCommandIds = d.pendingCommandIds.filter((id) => id !== commandId)
      this.emitDevice(d)
    }
    this.emitCommand(cmd)
    const inc = cmd.incidentId ? this.incidents.get(cmd.incidentId) : undefined
    if (inc) {
      const label = this.devices.get(deviceId)?.label ?? deviceId
      inc.timeline.push({ at: this.now, source: 'radio', text: `band-${label} did not confirm after 3.5 s` })
      this.emitIncident(inc)
    }
  }

  private expire(commandId: string): void {
    const cmd = this.commands.get(commandId)
    if (!cmd || cmd.approvalStatus !== 'approved') return
    cmd.approvalStatus = 'expired'
    cmd.deliveryStatus = 'cancelled'
    this.emitCommand(cmd)
    this.restoreBands(cmd)
    this.sim.setGuidance(null, null)
    this.comparisonStop = this.now
    const inc = cmd.incidentId ? this.incidents.get(cmd.incidentId) : undefined
    if (inc) {
      inc.timeline.push({ at: this.now, source: 'system', text: 'Signals ended after 90 s' })
      this.emitIncident(inc)
    }
  }

  /** Send bands back to ready. Each change still needs the band's acknowledgement. */
  private restoreBands(cmd: GuidanceCommand): void {
    cmd.targets.forEach((t, k) => {
      const d = this.devices.get(t.deviceId)
      if (!d) return
      d.pendingCommandIds = d.pendingCommandIds.filter((id) => id !== cmd.commandId)
      this.schedule(400 + k * 150, () => {
        if (d.sosActive) return
        d.currentPattern = 'ready' satisfies LedPattern
        d.lastSeenAt = this.now
        this.emitDevice(d)
      })
    })
  }

  private requireIncident(id: string): Incident {
    const inc = this.incidents.get(id)
    if (!inc) throw new CommandError('not_found', `No incident ${id}`)
    return inc
  }

  private requireCommand(id: string): GuidanceCommand {
    const cmd = this.commands.get(id)
    if (!cmd) throw new CommandError('not_found', `No guidance ${id}`)
    return cmd
  }

  // ------------------------------------------------------------------ autoplay

  private runAutoplay(): void {
    if (!this.scenario.autoplay) return
    const t = (this.now - this.startedAt) / 1000
    const once = (key: string, at: number, fn: () => void) => {
      if (t >= at && !this.autoplayDone.has(key)) {
        this.autoplayDone.add(key)
        fn()
      }
    }
    const open = () => [...this.incidents.values()].find((i) => i.status !== 'resolved')
    once('congestion', 6, () => this.triggerCongestion())
    once('sos', 16, () => this.pressSos('band-03', AUTOPLAY_ACTOR))
    once('ack', 23, () => {
      const i = open()
      if (i) this.acknowledge(i.incidentId, AUTOPLAY_ACTOR)
    })
    once('preview', 24, () => {
      const i = open()
      if (i && i.location) this.preview({ incidentId: i.incidentId })
    })
    once('approve', 27, () => {
      const c = [...this.commands.values()].find((x) => x.approvalStatus === 'pending_approval')
      if (c) this.approve(c.commandId, AUTOPLAY_ACTOR)
    })
    once('resolve', 72, () => {
      const i = open()
      if (i) this.resolve(i.incidentId, 'assisted_on_scene', AUTOPLAY_ACTOR)
    })
    once('loop', 88, () => this.reset(true))
  }
}

// ------------------------------------------------------------------ helpers

const REASON_TEXT: Record<ResolutionReason, string> = {
  assisted_on_scene: 'assisted on scene',
  handed_to_medical: 'handed to medical',
  false_alarm: 'false alarm',
  other: 'other',
}

function deliveryOf(cmd: GuidanceCommand): GuidanceCommand['deliveryStatus'] {
  const n = cmd.targets.length
  const acked = cmd.targets.filter((t) => t.status === 'acknowledged').length
  const failed = cmd.targets.filter((t) => t.status === 'failed').length
  if (n === 0) return 'delivered'
  if (acked === n) return 'delivered'
  if (failed === n) return 'failed'
  if (acked > 0 || failed > 0) return 'partial'
  return 'sending'
}

function zoneSection(venue: Venue, zoneId: string): string {
  return venue.zones.find((z) => z.zoneId === zoneId)?.section ?? 'default'
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

function cloneDevice(d: Device): Device {
  return { ...d, location: d.location ? { ...d.location } : undefined, pendingCommandIds: [...d.pendingCommandIds] }
}

function cloneIncident(i: Incident): Incident {
  return {
    ...i,
    location: i.location ? { ...i.location } : undefined,
    radio: i.radio ? { ...i.radio } : undefined,
    cameraObservations: [...i.cameraObservations],
    timeline: i.timeline.map((t) => ({ ...t })),
    guidanceCommandIds: [...i.guidanceCommandIds],
    resolution: i.resolution ? { ...i.resolution } : undefined,
  }
}

function cloneCommand(c: GuidanceCommand): GuidanceCommand {
  return {
    ...c,
    targets: c.targets.map((t) => ({ ...t })),
    targetDeviceIds: [...c.targetDeviceIds],
    targetZoneIds: [...c.targetZoneIds],
    acknowledgedDevices: [...c.acknowledgedDevices],
    failedDevices: [...c.failedDevices],
    preview: { ...c.preview, groups: c.preview.groups.map((g) => ({ ...g, deviceIds: [...g.deviceIds] })) },
  }
}
