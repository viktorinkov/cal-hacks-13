/**
 * CalHacks 13.0, traced from the Palace interior model. The hall runs north–south:
 * the entrance is the south end, the atrium is the far north end, and the mezzanine
 * is the raised east wing. Stairs meet that wing at its north end, its south end,
 * and one landing on the inner edge. Units are metres, origin top-left, y south.
 */
import type { Polygon, Stair, Structure, StructureKind, Vec2, Venue, VenueZone } from '@/contracts/domain'
import { polygonArea } from '@/lib/geometry'
import {
  palaceAtrium,
  palaceBroadway,
  palaceDeck,
  palaceEntrance,
  palaceEnvelope,
  palaceFood,
  palaceLetters,
  palaceMainWalls,
  palaceMezzWalls,
  palaceRooms,
  palaceShell,
  palaceSize,
  palaceSponsor,
  palaceSponsors,
  palaceStage,
  palaceStairs,
  palaceTables,
  palaceTheater,
} from './palaceTrace'

function turned(cx: number, cy: number, length: number, width: number, angle: number): Polygon {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const hx = length / 2
  const hy = width / 2
  return [
    [-hx, -hy],
    [hx, -hy],
    [hx, hy],
    [-hx, hy],
  ].map(([px, py]) => ({ x: cx + c * px - s * py, y: cy + s * px + c * py }))
}

let sid = 0
function solid(kind: StructureKind, name: string, footprint: Polygon, heightM: number, baseM = 0, blocksMovement = true): Structure {
  sid += 1
  return { structureId: `ch-${String(sid).padStart(3, '0')}`, name, kind, footprint, heightM, baseM, blocksMovement }
}

function segment(a: Vec2, b: Vec2, thickness: number): { footprint: Polygon; angle: number } {
  const angle = Math.atan2(b.y - a.y, b.x - a.x)
  const length = Math.max(0.4, Math.hypot(b.x - a.x, b.y - a.y))
  return { footprint: turned((a.x + b.x) / 2, (a.y + b.y) / 2, length, thickness, angle), angle }
}

function center(poly: Polygon): Vec2 {
  return {
    x: poly.reduce((sum, point) => sum + point.x, 0) / poly.length,
    y: poly.reduce((sum, point) => sum + point.y, 0) / poly.length,
  }
}

/** One table the fake crowd can sit at or stand beside. */
export interface TableSpot {
  x: number
  y: number
  tx: number
  ty: number
  nx: number
  ny: number
  row: number
  /** Table top, metres, along `tx`/`ty` and across `nx`/`ny`. */
  w: number
  d: number
  kind: 'long' | 'round'
}

export const calhacksTables: TableSpot[] = []

const structures: Structure[] = []

for (const [a, b] of palaceShell) {
  const piece = segment(a, b, 0.7)
  structures.push(solid('container', 'Outer wall', piece.footprint, 3.6))
}
for (const [a, b] of palaceMainWalls) {
  structures.push(solid('wall', 'Wall', segment(a, b, 0.35).footprint, 2.6))
}
for (const room of palaceRooms) {
  structures.push(solid(room.kind, room.name, room.poly, room.kind === 'container' ? 3.1 : 2.5))
}
structures.push(solid('stage', 'Stage', palaceStage, 1.05))
structures.push(solid('speaker', 'CAL HACKS', segment(palaceLetters.a, palaceLetters.b, 0.5).footprint, 4.6, 0.4, false))

for (const [a, b] of palaceMezzWalls) {
  structures.push(solid('tent', 'Mezzanine room', segment(a, b, 0.28).footprint, 2.4, 4.2))
}

palaceTables.forEach((table, index) => {
  const tx = Math.cos(table.angle)
  const ty = Math.sin(table.angle)
  const nx = -Math.sin(table.angle)
  const ny = Math.cos(table.angle)
  const base = table.mezz ? 4.2 : 0
  calhacksTables.push({ x: table.x, y: table.y, tx, ty, nx, ny, row: index, w: table.w, d: table.d, kind: 'long' })
  structures.push(solid('truck', 'Table', turned(table.x, table.y, table.w, table.d, table.angle), 0.74, base, false))
  for (const side of [-1, 1]) {
    structures.push(
      solid(
        'block',
        'Chairs',
        turned(table.x + nx * side * (table.d / 2 + 0.28), table.y + ny * side * (table.d / 2 + 0.28), table.w * 0.92, 0.32, table.angle),
        0.42,
        base,
        false,
      ),
    )
  }
})

for (const booth of palaceSponsors) {
  structures.push(solid('block', booth.name, turned(booth.x, booth.y, 2.2, 1.1, 0.4), 1.15, booth.mezz ? 4.2 : 0, false))
}

export interface CalhacksMark {
  id: string
  name: string
  x: number
  y: number
  z: number
  /** Hide until the camera is this many pixels per metre. Sponsors wait until you are close. */
  minScale: number
}

/** Palace metres (x, z) into the plan. Same shift the hall mesh uses. */
function fromPalace(x: number, z: number, height: number, id: string, name: string, minScale: number): CalhacksMark {
  return {
    id,
    name,
    x: Math.round((-z + 58.84) * 100) / 100,
    y: Math.round((x + 114.57) * 100) / 100,
    z: height,
    minScale,
  }
}

/** Names the GLB export flattened away. Positions are the Palace app's labels. */
const PLACES: [number, number, string][] = [
  [-67.2, -14.7, 'Pavilion'],
  [-30.45, -21.52, 'Atrium'],
  [9.71, -25.38, 'Gate #3'],
  [8.75, -17.06, 'Gate #4'],
  [5.16, -7.79, 'Broadway #1'],
  [31.41, 0.35, 'Broadway #2'],
  [56.52, 14.7, 'Broadway #3'],
  [63.79, 0.61, 'Breakout #5'],
  [84.44, 14.79, 'Food'],
  [30.27, -29.66, 'Palace Games'],
  [35, -17.06, 'Venue Staff Office'],
  [69.39, 36.05, 'Theater'],
  [86.63, 27.21, 'Box Office'],
  [-91.79, -2.89, 'Green Rooms'],
  [-10.06, -40.42, 'Catering Prep'],
]

const MEZZ_PLACES: [number, number, string][] = [
  [19.88, -36.11, 'Director (staff room)'],
  [31.12, -30.67, 'M8 · Coffee chat'],
  [39.59, -28.15, 'M7 / M6'],
  [48.63, -21.8, 'M5 · Hardware'],
  [7.36, -21.12, 'Mezzanine #2'],
  [32.19, -14.23, 'Mezzanine #3'],
  [59.07, 0, 'Mezzanine #4'],
]

export const calhacksMarks: CalhacksMark[] = [
  ...PLACES.map(([x, z, name]) => fromPalace(x, z, 2.4, name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, 7)),
  ...MEZZ_PLACES.map(([x, z, name]) => fromPalace(x, z, 5.8, name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, 8)),
  { id: 'stage', name: 'Stage', ...center(palaceStage), z: 2.6, minScale: 7 },
  ...palaceSponsors.map((booth) => ({
    id: `sp-${booth.n}`,
    name: booth.n ? `${booth.n} ${booth.name}` : booth.name,
    x: booth.x,
    y: booth.y,
    z: booth.mezz ? 5.8 : 2.2,
    minScale: 12,
  })),
]

function zone(zoneId: string, name: string, section: VenueZone['section'], polygon: Polygon, elevationM = 0): VenueZone {
  return {
    zoneId,
    name,
    section,
    polygon,
    areaM2: Math.max(1, Math.round(polygonArea(polygon))),
    labelAt: center(polygon),
    ...(elevationM ? { elevationM } : {}),
  }
}

const stairs: Stair[] = palaceStairs.map((flight) => ({
  stairId: flight.id,
  name: flight.name,
  polygon: flight.poly,
  bottom: flight.bottom,
  top: flight.top,
  topElevationM: 4.2,
  platformId: 'mezzanine',
}))

export const CALHACKS_CAPACITY: Record<string, number> = {
  broadway: 180,
  atrium: 500,
  mezzanine: 80,
  theater: 140,
  sponsor: 60,
  food: 40,
  entrance: 40,
}

export const calhacksVenue: Venue = {
  venueId: 'calhacks',
  name: 'CalHacks 13.0',
  width: palaceSize.width,
  height: palaceSize.height,
  coordinateSystem: { units: 'm', origin: 'top-left', xAxis: 'east', yAxis: 'south' },
  timeZone: 'America/Los_Angeles',
  zones: [
    zone('entrance', 'Entrance', 'plaza', palaceEntrance),
    zone('sponsor', 'Sponsor row', 'concourse', palaceSponsor),
    zone('food', 'Food and drinks', 'food', palaceFood),
    zone('theater', 'Theater', 'front', palaceTheater),
    zone('broadway', 'Broadway', 'front', palaceBroadway),
    zone('atrium', 'Atrium', 'floor', palaceAtrium),
    zone('mezzanine', 'Mezzanine', 'wing', palaceDeck, 4.2),
  ],
  walkways: [],
  exits: [
    {
      exitId: 'entry',
      name: 'Entrance',
      kind: 'gate',
      segment: [palaceEnvelope[palaceEnvelope.length - 8], palaceEnvelope[palaceEnvelope.length - 6]],
    },
  ],
  stages: [],
  structures,
  platforms: [{ platformId: 'mezzanine', name: 'Mezzanine', polygon: palaceDeck, elevationM: 4.2, zoneId: 'mezzanine' }],
  stairs,
  cameraLocations: [],
  stationLocations: [],
  responderCorridors: [],
  obstacles: [],
  schedule: [],
}

/** Live zone names land on the room they describe. Anything else sits in the Atrium. */
export function calhacksHome(name: string): string {
  const text = name.toLowerCase()
  if (text.includes('broadway') || text.includes('main stage') || text.includes('stage')) return 'broadway'
  if (text.includes('theater') || text.includes('theatre')) return 'theater'
  if (text.includes('mezzanine')) return 'mezzanine'
  if (text.includes('sponsor')) return 'sponsor'
  if (text.includes('food') || text.includes('drink')) return 'food'
  if (text.includes('entrance') || text.includes('concierge') || text.includes('gate')) return 'entrance'
  return 'atrium'
}
