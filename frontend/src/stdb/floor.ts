import type { Device, Incident, SectionKind, Venue, VenueZone, WorldSnapshot, ZoneState } from '@/contracts/domain'
import { rect } from '@/lib/geometry'
import { CALHACKS_CAPACITY, calhacksHome, calhacksVenue } from '@/mock/calhacks'
import { bindCrowdCast, startCalhacksCrowd } from '@/mock/calhacksCrowd'
import { HARDWARE_ID_MAX } from '@/booth/demoRing'
import { setLiveBands } from '@/booth/place'
import { currentPlan } from '@/map/venuePlan'
import { resetServerTime, setClockRate } from '@/stores/clock'
import { frames, baselineFrames } from '@/stores/frames'
import { useConnection } from '@/stores/connection'
import { useWorld } from '@/stores/world'

/**
 * The live floor. SpacetimeDB stores a zone as a point and an area, and a band as the station it
 * last reported. On the CalHacks plan the crowd rows seed the people, and a position tick that
 * does not change who is present does not rebuild the hall. Wristband icons are only the hardware
 * in the ring. The square projection remains for tests.
 */

export interface FloorZone {
  id: string
  name: string
  kind: string
  stationId: number
  x: number
  y: number
  area: number
  capacity: number
}

export interface FloorBand {
  id: number
  zone: number
  online: boolean
  sos: boolean
  fall: boolean
  lastSeen: number | null
  hasMotor: boolean
  hasMpu: boolean
  wearer: string | null
  /** Metres from the booth, or a plan coordinate, when the row carries them. */
  xM: number | null
  yM: number | null
  boothId: number
  hasPosition: boolean
  /** Firmware state. 3 is SOS, 4 is a neighbour turned red. */
  state: number
}

export interface FloorIncident {
  id: string
  kind: string
  zoneId: string
  stationId: number
  bandId: number
  openedAt: number | null
  resolved: boolean
  /** `open`, `responding`, or `resolved`, from the incident row. */
  status: string
}

export interface FloorInput {
  venueName: string
  timeZone: string
  zones: FloorZone[]
  bands: FloorBand[]
  incidents: FloorIncident[]
  now?: number
}

let seq = 0
let lastInput: FloorInput | null = null
let venueKey = ''
let venueCache: Venue | null = null
/** What the map draws: crowd presence, online state and position all move people on the floor. */
let floorStamp = ''

function stampOf(input: FloorInput): string {
  let crowd = 0
  let hash = 2166136261
  let hardware = ''
  for (const band of input.bands) {
    if (band.id > HARDWARE_ID_MAX) {
      crowd += 1
      hash ^= band.id
      hash ^= band.online ? 0x9e3779 : 0
      hash ^= band.zone * 31
      hash ^= Math.round((band.xM ?? 0) * 10)
      hash ^= Math.round((band.yM ?? 0) * 10) << 8
      hash = Math.imul(hash, 16777619)
      continue
    }
    hardware += `${band.id}:${band.online ? 1 : 0}:${band.sos ? 1 : 0}:${band.fall ? 1 : 0}:${band.state}:${band.zone};`
  }
  let incidents = ''
  for (const incident of input.incidents) incidents += `${incident.id}:${incident.resolved ? 1 : 0}:${incident.kind};`
  return `${input.zones.length}:${input.venueName}:${crowd}:${hash >>> 0}:${hardware}:${incidents}`
}

export function isFloorLive(): boolean {
  return currentPlan() === 'calhacks'
}

function rowsOf(table: unknown): Record<string, unknown>[] {
  if (!table || typeof table !== 'object' || !('iter' in table)) return []
  const iter = (table as { iter: unknown }).iter
  if (typeof iter !== 'function') return []
  return [...(iter.call(table) as Iterable<Record<string, unknown>>)]
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number {
  const n = typeof value === 'bigint' ? Number(value) : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function tag(value: unknown): string {
  if (value && typeof value === 'object' && 'tag' in value) return text((value as { tag: unknown }).tag).toLowerCase()
  return text(value).toLowerCase()
}

function standing(incident: FloorIncident): Incident['status'] {
  if (incident.resolved || incident.status === 'resolved') return 'resolved'
  if (incident.status === 'responding') return 'responding'
  return 'reported'
}

function finite(value: unknown): number | null {
  if (value == null) return null
  const n = num(value)
  return Number.isFinite(n) ? n : null
}

/** Beacon flag bits, the same ones `ingest_band` copies onto the public `band` row. */
const F_SOS = 1
const F_FALL = 2

/** One `band` row. `id` is a u32. `x_m` and `y_m` are optional in older rows. */
export function bandFromRow(row: Record<string, unknown>, wearer: string | null): FloorBand {
  const xM = finite(row.xM)
  const yM = finite(row.yM)
  const flags = num(row.flags)
  return {
    id: num(row.id),
    zone: num(row.zone),
    online: row.online === true,
    sos: row.sos === true || (flags & F_SOS) !== 0,
    fall: row.fall === true || (flags & F_FALL) !== 0,
    lastSeen: millis(row.lastSeen),
    hasMotor: row.hasMotor === true,
    hasMpu: row.hasMpu === true,
    wearer,
    xM,
    yM,
    boothId: num(row.boothId),
    hasPosition: xM != null && yM != null,
    state: num(row.state),
  }
}

function millis(value: unknown): number | null {
  if (value && typeof value === 'object' && 'toDate' in value) {
    const fn = (value as { toDate: unknown }).toDate
    if (typeof fn === 'function') return (fn.call(value) as Date).getTime()
  }
  return null
}

function sectionOf(kind: string): SectionKind {
  if (kind === 'stage' || kind === 'front') return 'front'
  if (kind === 'wing' || kind === 'concourse' || kind === 'plaza' || kind === 'food' || kind === 'passage') return kind
  return 'floor'
}

function square(zone: FloorZone): { polygon: ReturnType<typeof rect>; label: { x: number; y: number }; side: number } {
  const side = Math.max(8, Math.sqrt(Math.max(zone.area, 1)))
  return { polygon: rect(zone.x - side / 2, zone.y - side / 2, side, side), label: { x: zone.x, y: zone.y }, side }
}

export function projectFloor(input: FloorInput): WorldSnapshot | null {
  if (input.zones.length === 0) return null
  const now = input.now ?? Date.now()
  const drawn = input.zones.map((zone) => ({ zone, ...square(zone) }))
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const item of drawn) {
    for (const point of item.polygon) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
  }
  const pad = 8
  const shiftX = minX - pad
  const shiftY = minY - pad
  for (const item of drawn) {
    item.polygon = item.polygon.map((point) => ({ x: point.x - shiftX, y: point.y - shiftY }))
    item.label = { x: item.label.x - shiftX, y: item.label.y - shiftY }
  }
  const key = drawn.map((item) => `${item.zone.id}:${item.zone.x}:${item.zone.y}:${item.zone.area}:${item.zone.name}`).join('|')
  if (key !== venueKey || !venueCache) {
    const zones: VenueZone[] = drawn.map((item) => ({
      zoneId: item.zone.id,
      name: item.zone.name,
      section: sectionOf(item.zone.kind),
      polygon: item.polygon,
      areaM2: item.zone.area > 0 ? item.zone.area : item.side * item.side,
      labelAt: item.label,
    }))
    venueCache = {
      venueId: 'live',
      name: input.venueName || 'Venue',
      width: Math.max(20, maxX - minX + pad * 2),
      height: Math.max(20, maxY - minY + pad * 2),
      coordinateSystem: { units: 'm', origin: 'top-left', xAxis: 'east', yAxis: 'south' },
      zones,
      walkways: [],
      exits: [],
      stages: [],
      structures: [],
      platforms: [],
      stairs: [],
      cameraLocations: [],
      stationLocations: [],
      responderCorridors: [],
      obstacles: [],
      schedule: [],
      timeZone: input.timeZone || 'America/Los_Angeles',
    }
    venueKey = key
  }
  const venue = venueCache
  const byStation = new Map(drawn.map((item) => [item.zone.stationId, item]))
  const grouped = new Map<string, FloorBand[]>()
  for (const band of input.bands) {
    const place = byStation.get(band.zone)
    if (!place) continue
    const list = grouped.get(place.zone.id) ?? []
    list.push(band)
    grouped.set(place.zone.id, list)
  }

  const devices: Device[] = []
  for (const [zoneId, bands] of grouped) {
    const place = drawn.find((item) => item.zone.id === zoneId)
    if (!place) continue
    const radius = Math.min(place.side * 0.28, 6)
    bands.forEach((band, index) => {
      const angle = (index / bands.length) * Math.PI * 2
      const seated = bands.length === 1 ? place.label : { x: place.label.x + Math.cos(angle) * radius, y: place.label.y + Math.sin(angle) * radius }
      const measured = band.hasPosition && band.xM != null && band.yM != null ? { x: band.xM - shiftX, y: band.yM - shiftY } : null
      devices.push({
        deviceId: `band-${band.id}`,
        label: String(band.id).padStart(2, '0'),
        hardwareVariant: 'full',
        connectionStatus: band.online ? 'connected' : 'disconnected',
        lastSeenAt: band.lastSeen,
        currentPattern: band.sos ? 'sos' : band.fall ? 'steady_red' : band.online ? 'ready' : 'off',
        sosActive: band.sos,
        location: measured ?? seated,
        locationSource: 'station_estimate',
        zoneId,
        hapticsSupported: band.hasMotor,
        imuSupported: band.hasMpu,
        pendingCommandIds: [],
        wearerLabel: band.wearer,
      })
    })
  }

  const zones: ZoneState[] = drawn.map((item) => {
    const bands = grouped.get(item.zone.id) ?? []
    const area = item.zone.area > 0 ? item.zone.area : item.side * item.side
    const density = bands.length / area
    const alert = bands.some((band) => band.sos || band.fall)
    const congestionStatus = alert ? 'critical' : item.zone.capacity > 0 && bands.length / item.zone.capacity >= 0.8 ? 'caution' : 'normal'
    return {
      zoneId: item.zone.id,
      timestamp: now,
      occupancyEstimate: bands.length,
      estimatedDensity: density,
      peakDensity: density,
      congestionStatus,
      source: 'estimated',
      dataQuality: 'good',
      updatedAt: now,
    }
  })

  const incidents: Incident[] = []
  for (const incident of input.incidents) {
    const place = drawn.find((item) => item.zone.id === incident.zoneId) ?? drawn.find((item) => item.zone.stationId === incident.stationId)
    const kind = incident.kind || 'incident'
    incidents.push({
      incidentId: incident.id,
      displayId: `INC-${incident.id}`,
      reportedByDeviceId: incident.bandId ? `band-${incident.bandId}` : null,
      reportedAt: incident.openedAt ?? now,
      status: standing(incident),
      source: kind === 'sos' ? 'manual_sos' : kind === 'fall' ? 'imu_suspicion' : kind === 'property' ? 'camera_suspicion' : 'staff',
      radioStatus: 'received',
      candidateZone: place?.zone.id,
      location: place?.label,
      localizationStatus: place ? 'estimated' : 'unknown',
      cameraObservations: [],
      timeline: [{ at: incident.openedAt ?? now, source: 'device', text: `${kind} on band ${incident.bandId || 'unknown'}` }],
      guidanceCommandIds: [],
      isSimulated: false,
    })
  }

  seq += 1
  return {
    timestamp: now,
    seq,
    mode: 'live',
    venue,
    zones,
    devices,
    incidents,
    observations: [],
    commands: [],
    sources: [
      {
        sourceId: 'spacetimedb',
        kind: 'backend',
        label: 'SpacetimeDB',
        status: 'ok',
        lastUpdateAt: now,
        isSimulated: false,
        detail: input.venueName,
      },
    ],
  }
}

/** Bands and incidents from the database. Crowd rows seed the people on the floor. Wristband icons stay with the hardware in the ring. */
export function placeOnCalhacks(input: FloorInput | null): WorldSnapshot {
  const now = input?.now ?? Date.now()
  const byStation = new Map((input?.zones ?? []).map((zone) => [zone.stationId, zone]))
  const byId = new Map((input?.zones ?? []).map((zone) => [zone.id, zone]))
  const grouped = new Map<string, FloorBand[]>()
  const capacity = new Map<string, number>()
  for (const band of input?.bands ?? []) {
    if (band.id > HARDWARE_ID_MAX) continue
    const source = byStation.get(band.zone)
    if (!source) continue
    const home = calhacksHome(source.name)
    const list = grouped.get(home) ?? []
    list.push(band)
    grouped.set(home, list)
  }
  for (const source of input?.zones ?? []) {
    const home = calhacksHome(source.name)
    capacity.set(home, (capacity.get(home) ?? 0) + source.capacity)
  }

  const devices: Device[] = []
  for (const [zoneId, bands] of grouped) {
    const place = calhacksVenue.zones.find((zone) => zone.zoneId === zoneId)
    if (!place) continue
    bands.forEach((band) => {
      devices.push({
        deviceId: `band-${band.id}`,
        label: String(band.id).padStart(2, '0'),
        hardwareVariant: 'full',
        connectionStatus: band.online ? 'connected' : 'disconnected',
        lastSeenAt: band.lastSeen,
        currentPattern: band.sos ? 'sos' : band.fall ? 'steady_red' : band.online ? 'ready' : 'off',
        sosActive: band.sos,
        ...(band.hasPosition && band.xM != null && band.yM != null ? { location: { x: band.xM, y: band.yM } } : {}),
        locationSource: 'station_estimate' as const,
        zoneId,
        hapticsSupported: band.hasMotor,
        imuSupported: band.hasMpu,
        pendingCommandIds: [],
        wearerLabel: band.wearer,
      })
    })
  }

  // Occupancy comes from the band rows themselves: a crowd member counts while the backend
  // says they are inside (online with a zone), a hardware band counts wherever it last reported.
  const occupancy = new Map<string, number>()
  const alerted = new Set<string>()
  for (const band of input?.bands ?? []) {
    if (band.zone === 0) continue
    const source = byStation.get(band.zone)
    if (!source) continue
    const home = calhacksHome(source.name)
    if (band.id > HARDWARE_ID_MAX && !band.online) continue
    occupancy.set(home, (occupancy.get(home) ?? 0) + 1)
    if (band.sos || band.fall) alerted.add(home)
  }

  const zones: ZoneState[] = calhacksVenue.zones.map((zone) => {
    const room = capacity.get(zone.zoneId) || CALHACKS_CAPACITY[zone.zoneId] || 1
    const area = zone.areaM2 || 1
    const count = occupancy.get(zone.zoneId) ?? 0
    const density = count / area
    const alert = alerted.has(zone.zoneId)
    const cautionLine = zone.section === 'front' ? 3.8 : 3.1
    const criticalLine = zone.section === 'front' ? 4.8 : 4.1
    return {
      zoneId: zone.zoneId,
      timestamp: now,
      occupancyEstimate: count,
      estimatedDensity: density,
      peakDensity: density,
      congestionStatus: alert || density >= criticalLine ? 'critical' : count / room >= 0.8 || density >= cautionLine ? 'caution' : 'normal',
      source: 'estimated',
      dataQuality: 'good',
      updatedAt: now,
    }
  })

  const incidents: Incident[] = []
  for (const incident of input?.incidents ?? []) {
    const source = byId.get(incident.zoneId) ?? byStation.get(incident.stationId)
    const home = calhacksHome(source?.name ?? '')
    const place = calhacksVenue.zones.find((zone) => zone.zoneId === home)
    const kind = incident.kind || 'incident'
    const subject = input?.bands.find((band) => band.id === incident.bandId)
    const at = subject?.hasPosition && subject.xM != null && subject.yM != null ? { x: subject.xM, y: subject.yM } : undefined
    incidents.push({
      incidentId: incident.id,
      displayId: `INC-${incident.id}`,
      reportedByDeviceId: incident.bandId ? `band-${incident.bandId}` : null,
      reportedAt: incident.openedAt ?? now,
      status: standing(incident),
      source: kind === 'sos' ? 'manual_sos' : kind === 'fall' ? 'imu_suspicion' : kind === 'property' ? 'camera_suspicion' : 'staff',
      radioStatus: 'received',
      candidateZone: place?.zoneId,
      location: at ?? place?.labelAt,
      localizationStatus: at || place ? 'estimated' : 'unknown',
      cameraObservations: [],
      timeline: [{ at: incident.openedAt ?? now, source: 'device', text: `${kind} on band ${incident.bandId || 'unknown'}` }],
      guidanceCommandIds: [],
      isSimulated: false,
    })
  }

  const inside = [...occupancy.values()].reduce((sum, count) => sum + count, 0)
  seq += 1
  return {
    timestamp: now,
    seq,
    mode: input ? 'live' : 'simulation',
    venue: calhacksVenue,
    zones,
    devices,
    incidents,
    observations: [],
    commands: [],
    sources: input
      ? [{ sourceId: 'spacetimedb', kind: 'backend' as const, label: 'SpacetimeDB', status: 'ok' as const, lastUpdateAt: now, isSimulated: false, detail: `${inside.toLocaleString('en-US')} inside · ${input.venueName}` }]
      : [],
  }
}

/** Shows the CalHacks plan, with live bands once a subscription has arrived. */
export function presentCalhacks(): void {
  const world = useWorld.getState()
  // A hot-reloaded copy of this module has no rows yet. It must not wipe the floor the live socket is drawing.
  if (!lastInput && world.venue?.venueId === 'calhacks' && (Object.keys(world.devices).length > 0 || Object.keys(world.incidents).length > 0)) return
  resetServerTime(Date.now())
  setClockRate(1)
  if (world.venue?.venueId !== 'calhacks') {
    frames.clear()
    baselineFrames.clear()
  }
  startCalhacksCrowd()
  bindCrowdCast(lastInput?.bands ?? [])
  useWorld.getState().applySnapshot(placeOnCalhacks(lastInput))
}

/** Reads the subscribed tables and, once a venue plan is there, makes it the map. */
export function syncFloor(db: Record<string, unknown>): boolean {
  const venueRow = rowsOf(db.venue)[0]
  const zones: FloorZone[] = rowsOf(db.zone).map((row) => ({
    id: String(row.id ?? ''),
    name: text(row.name) || 'Zone',
    kind: text(row.kind),
    stationId: num(row.stationId),
    x: num(row.planXM),
    y: num(row.planYM),
    area: num(row.areaSqM),
    capacity: num(row.capacity),
  }))
  const wearers = new Map<number, string>()
  for (const row of rowsOf(db.boardAttendees)) {
    const bandId = num(row.bandId)
    const name = text(row.displayName)
    if (bandId && name) wearers.set(bandId, name)
  }
  const bands: FloorBand[] = rowsOf(db.band).map((row) => bandFromRow(row, wearers.get(num(row.id)) ?? null))
  const incidents: FloorIncident[] = rowsOf(db.openIncidents).map((row) => ({
    id: String(row.id ?? ''),
    kind: tag(row.kind),
    zoneId: String(row.zoneId ?? ''),
    stationId: num(row.stationId),
    bandId: num(row.subjectBand),
    openedAt: millis(row.openedAt),
    resolved: row.resolved === true,
    status: tag(row.status),
  }))
  setLiveBands(bands)
  if (zones.length === 0) return false
  lastInput = {
    venueName: text(venueRow?.venueName) || text(venueRow?.name),
    timeZone: text(venueRow?.timezone) || 'America/Los_Angeles',
    zones,
    bands,
    incidents,
  }
  if (currentPlan() !== 'calhacks') return false
  const nextStamp = stampOf(lastInput)
  const changed = nextStamp !== floorStamp
  floorStamp = nextStamp
  if (changed) presentCalhacks()
  const at = Date.now()
  useConnection.setState({
    connection: { phase: 'open', attempt: 1, lastMessageAt: at, nextRetryAt: null },
    sync: 'live',
    syncError: null,
    lastDataAt: at,
  })
  return true
}
