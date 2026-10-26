/**
 * Pure state transitions for world data. The store applies these in batches; tests call them
 * directly.
 */
import type {
  CameraObservation,
  CongestionStatus,
  Device,
  GuidanceCommand,
  Incident,
  OperatingMode,
  PressureSample,
  ScenarioState,
  SourceStatus,
  StreamEvent,
  Venue,
  WorldSnapshot,
  ZoneState,
} from '@/contracts/domain'

export interface ZoneSample {
  t: number
  peak: number
  count: number
}

const ZONE_SERIES_LIMIT = 240

export interface WorldData {
  ready: boolean
  mode: OperatingMode
  venue: Venue | null
  zones: Record<string, ZoneState>
  devices: Record<string, Device>
  incidents: Record<string, Incident>
  observations: Record<string, CameraObservation>
  commands: Record<string, GuidanceCommand>
  sources: Record<string, SourceStatus>
  scenario: ScenarioState | null
  history: PressureSample[]
  /** Recent samples per zone (1 s resolution), for the inspector's chart. */
  zoneSeries: Record<string, ZoneSample[]>
  seq: number
  /** Backend time of the newest event applied. */
  lastEventAt: number | null
}

export const emptyWorld: WorldData = {
  ready: false,
  mode: 'simulation',
  venue: null,
  zones: {},
  devices: {},
  incidents: {},
  observations: {},
  commands: {},
  sources: {},
  scenario: null,
  history: [],
  zoneSeries: {},
  seq: 0,
  lastEventAt: null,
}

const HISTORY_LIMIT = 600

function byId<T, K extends keyof T>(list: T[], key: K): Record<string, T> {
  const out: Record<string, T> = {}
  for (const item of list) out[String(item[key])] = item
  return out
}

export function fromSnapshot(s: WorldSnapshot): WorldData {
  return {
    ready: true,
    mode: s.mode,
    venue: s.venue,
    zones: byId(s.zones, 'zoneId'),
    devices: byId(s.devices, 'deviceId'),
    incidents: byId(s.incidents, 'incidentId'),
    observations: byId(s.observations, 'detectionId'),
    commands: byId(s.commands, 'commandId'),
    sources: byId(s.sources, 'sourceId'),
    scenario: s.scenario ?? null,
    history: (s.history ?? []).slice(-HISTORY_LIMIT),
    zoneSeries: {},
    seq: s.seq,
    lastEventAt: s.timestamp,
  }
}

const STATUS_RANK: Record<Incident['status'], number> = { reported: 0, acknowledged: 1, responding: 2, resolved: 3 }

/** True if `next` is at least as far along as `prev`. Guards against a slow HTTP reply undoing a newer event. */
export function isNewerIncident(prev: Incident | undefined, next: Incident): boolean {
  if (!prev) return true
  const a = STATUS_RANK[prev.status]
  const b = STATUS_RANK[next.status]
  if (b !== a) return b > a
  return next.timeline.length >= prev.timeline.length
}

const APPROVAL_RANK: Record<GuidanceCommand['approvalStatus'], number> = {
  draft: 0,
  pending_approval: 1,
  approved: 2,
  rejected: 3,
  expired: 3,
  cancelled: 3,
}
const TARGET_RANK = { pending: 0, sent: 1, failed: 2, acknowledged: 3, cancelled: 3 } as const

export function isNewerCommand(prev: GuidanceCommand | undefined, next: GuidanceCommand): boolean {
  if (!prev) return true
  const a = APPROVAL_RANK[prev.approvalStatus]
  const b = APPROVAL_RANK[next.approvalStatus]
  if (b !== a) return b > a
  const progress = (c: GuidanceCommand) =>
    c.targets.reduce((sum, t) => sum + TARGET_RANK[t.status] * 10 + t.attempts, 0)
  return progress(next) >= progress(prev)
}

const CONGESTION_RANK: Record<CongestionStatus, number> = { normal: 0, unknown: 1, caution: 2, critical: 3 }

/** The venue's worst zone right now, for the pressure timeline. */
export function pressureSample(zones: ZoneState[], at: number): PressureSample | null {
  let worst: ZoneState | null = null
  for (const z of zones) {
    if (!worst) {
      worst = z
      continue
    }
    const a = CONGESTION_RANK[worst.congestionStatus]
    const b = CONGESTION_RANK[z.congestionStatus]
    if (b > a || (b === a && (z.peakDensity ?? 0) > (worst.peakDensity ?? 0))) worst = z
  }
  if (!worst) return null
  return { t: at, peakDensity: worst.peakDensity ?? 0, status: worst.congestionStatus, zoneId: worst.zoneId }
}

/**
 * Apply a batch of stream events to world data, copying each collection at most once.
 * Snapshot events are handled by the sync layer, not here.
 */
export function applyEvents(state: WorldData, events: StreamEvent[]): WorldData {
  if (!events.length) return state
  const next: WorldData = { ...state }
  const touched = new Set<keyof WorldData>()
  const own = <K extends 'zones' | 'devices' | 'incidents' | 'observations' | 'commands' | 'sources'>(key: K): WorldData[K] => {
    if (!touched.has(key)) {
      touched.add(key)
      next[key] = { ...state[key] } as WorldData[K]
    }
    return next[key]
  }
  for (const e of events) {
    if (e.seq > next.seq) next.seq = e.seq
    if (next.lastEventAt === null || e.at > next.lastEventAt) next.lastEventAt = e.at
    switch (e.type) {
      case 'zones': {
        const zones = own('zones')
        for (const z of e.zones) zones[z.zoneId] = z
        const series = { ...next.zoneSeries }
        for (const z of e.zones) {
          const list = series[z.zoneId] ?? []
          const last = list[list.length - 1]
          if (!last || e.at - last.t >= 1000) {
            series[z.zoneId] = [...list, { t: e.at, peak: z.peakDensity ?? 0, count: z.occupancyEstimate ?? 0 }].slice(-ZONE_SERIES_LIMIT)
          }
        }
        next.zoneSeries = series
        const sample = pressureSample(e.zones, e.at)
        const last = next.history[next.history.length - 1]
        if (sample && (!last || sample.t - last.t >= 1000)) {
          next.history = [...next.history, sample].slice(-HISTORY_LIMIT)
        }
        break
      }
      case 'device':
        own('devices')[e.device.deviceId] = e.device
        break
      case 'incident': {
        const incidents = own('incidents')
        if (isNewerIncident(incidents[e.incident.incidentId], e.incident)) incidents[e.incident.incidentId] = e.incident
        break
      }
      case 'observation':
        own('observations')[e.observation.detectionId] = e.observation
        break
      case 'guidance': {
        const commands = own('commands')
        if (isNewerCommand(commands[e.command.commandId], e.command)) commands[e.command.commandId] = e.command
        break
      }
      case 'source':
        own('sources')[e.source.sourceId] = e.source
        break
      case 'scenario':
        next.scenario = e.scenario
        break
      case 'entities':
      case 'heartbeat':
      case 'snapshot':
        break
    }
  }
  return next
}
