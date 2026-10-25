/** Walkable, seatable and blocked footprints on the CalHacks plan. */
import type { VenueZone } from '@/contracts/domain'
import { pointInPolygon } from '@/lib/geometry'
import { onStair } from '@/booth/hallRoute'
import { calhacksVenue } from './calhacks'

export const FLOOR_ZONES = ['theater', 'food', 'entrance', 'sponsor', 'broadway', 'atrium', 'mezzanine'] as const

export const floorRooms = FLOOR_ZONES.map((id) => calhacksVenue.zones.find((zone) => zone.zoneId === id)).filter((zone): zone is VenueZone => !!zone)

/** Mezzanine sits over the atrium, so it wins when a point is in both. */
export function zoneAt(x: number, y: number): number {
  const mezz = floorRooms.findIndex((room) => room.zoneId === 'mezzanine')
  if (mezz >= 0 && pointInPolygon(x, y, floorRooms[mezz]!.polygon)) return mezz
  for (let i = 0; i < floorRooms.length; i++) {
    if (i !== mezz && pointInPolygon(x, y, floorRooms[i]!.polygon)) return i
  }
  return -1
}

/**
 * Closed floor is furniture, rooms, and walls. Chairs are the only seatable band. Everything else
 * inside a room polygon is a walking path, including the aisles between table rows.
 */
type FloorKind = 'seat' | 'closed'

interface Footprint {
  poly: { x: number; y: number }[]
  minX: number
  minY: number
  maxX: number
  maxY: number
  kind: FloorKind
}

const CELL = 8
const floorGrid = new Map<string, Footprint[]>()

function addFootprint(poly: { x: number; y: number }[], kind: FloorKind): void {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of poly) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  const foot: Footprint = { poly, minX, minY, maxX, maxY, kind }
  const x0 = Math.floor(minX / CELL)
  const x1 = Math.floor(maxX / CELL)
  const y0 = Math.floor(minY / CELL)
  const y1 = Math.floor(maxY / CELL)
  for (let gx = x0; gx <= x1; gx++) {
    for (let gy = y0; gy <= y1; gy++) {
      const key = `${gx},${gy}`
      const list = floorGrid.get(key) ?? []
      list.push(foot)
      floorGrid.set(key, list)
    }
  }
}

for (const structure of calhacksVenue.structures) {
  if (structure.name === 'Chairs') addFootprint(structure.footprint, 'seat')
  else if (structure.name === 'Table' || structure.blocksMovement || structure.kind === 'block' || structure.kind === 'stage' || structure.kind === 'speaker') {
    addFootprint(structure.footprint, 'closed')
  }
}

/** Walkway, chair, blocked furniture, or outside the hall. */
export function floorUse(x: number, y: number): 'walk' | 'seat' | 'closed' | 'out' {
  if (zoneAt(x, y) < 0) return 'out'
  const list = floorGrid.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`)
  let seat = false
  if (list) {
    for (const foot of list) {
      if (x < foot.minX || x > foot.maxX || y < foot.minY || y > foot.maxY) continue
      if (!pointInPolygon(x, y, foot.poly)) continue
      if (foot.kind === 'closed') return 'closed'
      seat = true
    }
  }
  return seat ? 'seat' : 'walk'
}

export function walkable(x: number, y: number): boolean {
  return floorUse(x, y) === 'walk' && !onStair(x, y)
}
