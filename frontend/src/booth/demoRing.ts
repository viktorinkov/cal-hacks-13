import { create } from 'zustand'
import type { FloorBand } from '@/stdb/floor'
import type { Device, GuidanceCommand, Incident, LedPattern, Vec2 } from '@/contracts/domain'
import { ensureVenueFloor, routeOnVenueFloor } from '@/booth/floorGuide'
import { floorZ, routeToRing } from '@/booth/hallRoute'
import { serverRoute } from '@/booth/serverRoute'
import { calhacksVenue } from '@/mock/calhacks'
import { boothHandle } from './circle'

/**
 * The clear patch on the CalHacks floor where the hardware demo stands.
 * Simulated people stay outside it. A distress turns the ring red.
 * The operator opens the path from the entrance.
 */
export interface DemoRing {
  x: number
  y: number
  r: number
  editing: boolean
}

const KEY = 'bandit-demo-ring'
const VENUE_W = 110
const VENUE_H = 228

/** Firmware band states. 3 is the band that raised SOS. 4 is a neighbour the firmware turned red. */
export const S_SOS = 3
export const S_NEAR_SOS = 4

/** Radio and test bands. The simulated crowd starts at 100 and is not drawn as wristbands. */
export const HARDWARE_ID_MAX = 99

/** Metres either side of the cleared path. People inside it step away. */
export const DEMO_LANE = 2.2

/** Broadway, just inside the hall, so the walk up from the south entrance is visible. */
export const DEFAULT_DEMO_RING: DemoRing = { x: 64, y: 150, r: 5, editing: false }

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function read(): DemoRing {
  if (typeof window === 'undefined') return { ...DEFAULT_DEMO_RING }
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_DEMO_RING }
    const parsed = JSON.parse(raw) as Partial<DemoRing>
    return {
      x: clamp(Number(parsed.x) || DEFAULT_DEMO_RING.x, 4, VENUE_W - 4),
      y: clamp(Number(parsed.y) || DEFAULT_DEMO_RING.y, 4, VENUE_H - 4),
      r: clamp(Number(parsed.r) || DEFAULT_DEMO_RING.r, 3, 12),
      editing: false,
    }
  } catch {
    return { ...DEFAULT_DEMO_RING }
  }
}

function write(ring: DemoRing) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(KEY, JSON.stringify({ x: ring.x, y: ring.y, r: ring.r }))
}

export const useDemoRing = create<DemoRing>()(() => read())

export function moveDemoRing(x: number, y: number): void {
  useDemoRing.setState({
    x: clamp(x, 4, VENUE_W - 4),
    y: clamp(y, 4, VENUE_H - 4),
  })
}

export function resizeDemoRing(r: number): void {
  useDemoRing.setState({ r: clamp(r, 3, 12) })
}

export function setDemoRingEditing(editing: boolean): void {
  useDemoRing.setState({ editing })
}

export function saveDemoRing(): void {
  write(useDemoRing.getState())
}

export function demoRingHandle(x: number, y: number, ring: Pick<DemoRing, 'x' | 'y' | 'r'>, pxPerM?: number): 'move' | 'resize' | null {
  return boothHandle(x, y, ring, pxPerM)
}

/** South entrance, the bottom of the hall. */
export function demoEntrance(): Vec2 {
  return calhacksVenue.zones.find((zone) => zone.zoneId === 'entrance')?.labelAt ?? { x: 42, y: 196 }
}

/** The walk from the entrance to the rim of the ring. A `crowd_walk` route wins; the floor grid, then the local walk, fill in when none reaches. */
export function demoRoute(ring: Pick<DemoRing, 'x' | 'y' | 'r'>): { points: Vec2[]; z: number[] } {
  const from = demoEntrance()
  ensureVenueFloor()
  const dx = ring.x - from.x
  const dy = ring.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const rim = { x: ring.x - (dx / len) * ring.r, y: ring.y - (dy / len) * ring.r }
  const stored = serverRoute(from, rim)
  if (stored) {
    const last = stored[stored.length - 1]!
    const gap = Math.hypot(last.x - rim.x, last.y - rim.y)
    const points = gap > 0.4 && gap < 20 ? [...stored, rim] : stored
    return { points, z: points.map((point) => floorZ(point.x, point.y)) }
  }
  const walked = routeOnVenueFloor(from, rim)
  if (walked) return { points: walked, z: walked.map((point) => floorZ(point.x, point.y)) }
  return routeToRing(from, ring)
}

/** Plan of {@link demoRoute}. The line stops where the hardware is standing. */
export function demoPath(ring: Pick<DemoRing, 'x' | 'y' | 'r'>): Vec2[] {
  return demoRoute(ring).points
}

export function isHardware(band: FloorBand): boolean {
  return band.id >= 1 && band.id <= HARDWARE_ID_MAX
}

/** This band is showing the firmware's SOS, a fall, or the red neighbour light. */
export function bandLights(band: FloorBand): boolean {
  return band.sos || band.fall || band.state === S_SOS || band.state === S_NEAR_SOS
}

export function patternOf(band: FloorBand): LedPattern {
  if (band.sos || band.state === S_SOS) return 'sos'
  if (band.fall || band.state === S_NEAR_SOS) return 'steady_red'
  if (band.online) return 'ready'
  return 'off'
}

/** Wristbands to draw in the ring: the real ones that are on, or lighting up. */
export function shownHardware(bands: FloorBand[]): FloorBand[] {
  return bands.filter((band) => isHardware(band) && (band.online || bandLights(band))).sort((a, b) => a.id - b.id)
}

function zoneNear(at: Vec2): string | undefined {
  let bestId: string | undefined
  let best = Infinity
  for (const zone of calhacksVenue.zones) {
    const d = (zone.labelAt.x - at.x) ** 2 + (zone.labelAt.y - at.y) ** 2
    if (d < best) {
      best = d
      bestId = zone.zoneId
    }
  }
  return bestId
}

function idOf(reportedByDeviceId: string | null): number {
  const match = reportedByDeviceId?.match(/(\d+)$/)
  return match ? Number(match[1]) : 0
}

/** A hardware SOS or fall is in progress, so the ring is in distress. */
export function demoIsActive(bands: FloorBand[], incidents: Pick<Incident, 'status' | 'source' | 'isSimulated' | 'reportedByDeviceId'>[]): boolean {
  if (bands.some((band) => isHardware(band) && band.online && bandLights(band))) return true
  return incidents.some((incident) => {
    if (incident.status === 'resolved' || incident.isSimulated) return false
    if (incident.source !== 'manual_sos' && incident.source !== 'imu_suspicion') return false
    const id = idOf(incident.reportedByDeviceId)
    return id >= 1 && id <= HARDWARE_ID_MAX
  })
}

function measured(band: FloorBand, ring: Pick<DemoRing, 'x' | 'y' | 'r'>): Vec2 | null {
  if (!band.hasPosition || band.xM == null || band.yM == null) return null
  if (Math.hypot(band.xM, band.yM) <= ring.r) return { x: ring.x + band.xM, y: ring.y + band.yM }
  if (Math.hypot(band.xM - ring.x, band.yM - ring.y) <= ring.r) return { x: band.xM, y: band.yM }
  return null
}

export interface LaidBand {
  band: FloorBand
  at: Vec2
}

/**
 * Hardware sits in the ring. A measured offset is kept. Anything else is spaced around the
 * centre, with the band that raised the SOS in the middle.
 */
export function layoutDemo(bands: FloorBand[], ring: Pick<DemoRing, 'x' | 'y' | 'r'>): LaidBand[] {
  const shown = shownHardware(bands)
  const raised = new Set(shown.filter((band) => band.sos || band.fall || band.state === S_SOS))
  const placed: LaidBand[] = []
  const free: FloorBand[] = []
  for (const band of shown) {
    const known = measured(band, ring)
    if (known) placed.push({ band, at: known })
    else free.push(band)
  }
  const center = free.find((band) => raised.has(band))
  const orbit = free.filter((band) => band !== center)
  if (center) placed.push({ band: center, at: { x: ring.x, y: ring.y } })
  const radius = Math.min(ring.r * 0.62, 2.4)
  orbit.forEach((band, index) => {
    if (orbit.length === 1 && !center) {
      placed.push({ band, at: { x: ring.x, y: ring.y } })
      return
    }
    const angle = -Math.PI / 2 + (index / orbit.length) * Math.PI * 2
    placed.push({ band, at: { x: ring.x + Math.cos(angle) * radius, y: ring.y + Math.sin(angle) * radius } })
  })
  return placed
}

export function demoDevices(bands: FloorBand[], ring: Pick<DemoRing, 'x' | 'y' | 'r'>): Device[] {
  return layoutDemo(bands, ring).map(({ band, at }) => ({
    deviceId: `band-${band.id}`,
    label: String(band.id).padStart(2, '0'),
    hardwareVariant: band.hasMpu ? 'full' : 'light',
    connectionStatus: band.online ? 'connected' : 'disconnected',
    lastSeenAt: band.lastSeen,
    currentPattern: patternOf(band),
    sosActive: band.sos || band.state === S_SOS,
    location: at,
    locationSource: 'manually_assigned',
    zoneId: zoneNear(at) ?? 'demo',
    hapticsSupported: band.hasMotor,
    imuSupported: band.hasMpu,
    pendingCommandIds: [],
    wearerLabel: band.wearer,
  }))
}

function raisedIncident(item: LaidBand, now: number): Incident | null {
  const raised = item.band.sos || item.band.fall || item.band.state === S_SOS
  if (!raised) return null
  const sos = item.band.sos || item.band.state === S_SOS
  return {
    incidentId: `live-${item.band.id}`,
    displayId: sos ? `SOS-${item.band.id}` : `FALL-${item.band.id}`,
    reportedByDeviceId: `band-${item.band.id}`,
    reportedAt: item.band.lastSeen ?? now,
    status: 'reported',
    source: sos ? 'manual_sos' : 'imu_suspicion',
    radioStatus: 'received',
    location: item.at,
    locationRadiusM: 1.5,
    localizationStatus: 'estimated',
    candidateZone: zoneNear(item.at),
    cameraObservations: [],
    timeline: [{ at: item.band.lastSeen ?? now, source: 'device', text: sos ? `SOS on band ${item.band.id}` : `Fall on band ${item.band.id}` }],
    guidanceCommandIds: [],
    isSimulated: false,
  }
}

/**
 * A hardware SOS or fall opens the incident panel at the band's spot in the ring.
 * The crowd roster never does, and a neighbour that is only lit red does not open a second incident.
 */
export function hardwareAlerts(bands: FloorBand[], ring: Pick<DemoRing, 'x' | 'y' | 'r'>, now = Date.now()): Incident[] {
  const alerts: Incident[] = []
  for (const item of layoutDemo(bands, ring)) {
    const incident = raisedIncident(item, now)
    if (incident) alerts.push(incident)
  }
  return alerts
}

/** Keep a database incident, and add one from the band row when that row arrived first. */
export function mergeHardwareAlerts(open: Incident[], bands: FloorBand[], ring: Pick<DemoRing, 'x' | 'y' | 'r'>, now = Date.now()): Incident[] {
  const seen = new Set(open.map((incident) => idOf(incident.reportedByDeviceId)))
  const extra = hardwareAlerts(bands, ring, now).filter((incident) => !seen.has(idOf(incident.reportedByDeviceId)))
  return extra.length ? [...open, ...extra] : open
}

/** Move a hardware SOS onto its spot in the ring, and show one immediately if the incident row has not arrived. */
export function withDemoIncidents(open: Incident[], bands: FloorBand[], ring: Pick<DemoRing, 'x' | 'y' | 'r'>): Incident[] {
  const laid = layoutDemo(bands, ring)
  const moved = open.map((incident) => {
    const id = idOf(incident.reportedByDeviceId)
    const spot = laid.find((item) => item.band.id === id)
    if (!spot || incident.status === 'resolved' || !isHardware(spot.band)) return incident
    if (incident.source !== 'manual_sos' && incident.source !== 'imu_suspicion') return incident
    return { ...incident, location: spot.at, locationRadiusM: 1.5, localizationStatus: 'estimated' as const }
  })
  const seen = new Set(moved.map((incident) => idOf(incident.reportedByDeviceId)))
  for (const item of laid) {
    const raised = item.band.sos || item.band.fall || item.band.state === S_SOS
    if (!item.band.online || !raised || seen.has(item.band.id)) continue
    const sos = item.band.sos || item.band.state === S_SOS
    moved.push({
      incidentId: `demo-${item.band.id}`,
      displayId: sos ? `SOS-${item.band.id}` : `FALL-${item.band.id}`,
      reportedByDeviceId: `band-${item.band.id}`,
      reportedAt: item.band.lastSeen ?? Date.now(),
      status: 'reported',
      source: sos ? 'manual_sos' : 'imu_suspicion',
      radioStatus: 'received',
      location: item.at,
      locationRadiusM: 1.5,
      localizationStatus: 'estimated',
      candidateZone: zoneNear(item.at),
      cameraObservations: [],
      timeline: [{ at: item.band.lastSeen ?? Date.now(), source: 'device', text: sos ? `SOS on band ${item.band.id}` : `Fall on band ${item.band.id}` }],
      guidanceCommandIds: [],
      isSimulated: false,
    })
  }
  return moved
}

/** Drawn locally. Nothing here is sent to a wristband. The firmware already lit the neighbours. */
export function demoCommand(lengthM: number): GuidanceCommand {
  return {
    commandId: 'demo-path',
    corridorId: 'COR-DEMO',
    targetZoneIds: [],
    targetDeviceIds: [],
    targets: [],
    patternCode: 'step_aside',
    reason: 'Clear a path from the entrance to the demo',
    preview: {
      corridorId: 'COR-DEMO',
      corridorName: 'Entrance to the demo',
      lengthM,
      groups: [],
      advisoryCode: '',
      alternativeCorridorIds: [],
    },
    approvalStatus: 'approved',
    createdAt: 0,
    expiresAt: 0,
    deliveryStatus: 'delivered',
    acknowledgedDevices: [],
    failedDevices: [],
    isSimulated: true,
  }
}

interface HardwareState {
  bands: FloorBand[]
}

export const useHardware = create<HardwareState>()(() => ({ bands: [] }))

export function rememberHardware(bands: FloorBand[]): void {
  const next = shownHardware(bands)
  const prev = useHardware.getState().bands
  if (
    prev.length === next.length &&
    prev.every((band, i) => band.id === next[i]?.id && band.sos === next[i]?.sos && band.fall === next[i]?.fall && band.state === next[i]?.state && band.online === next[i]?.online && band.xM === next[i]?.xM && band.yM === next[i]?.yM)
  ) {
    return
  }
  useHardware.setState({ bands: next })
}
