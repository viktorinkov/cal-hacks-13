/**
 * The yellow entrance path, taken from the venue floor grid rather than the local one-metre walk.
 * The grid and the search are `floorPath.ts`, the same ones the module uses for `crowd_walk`.
 */
import { floorToPlan, planToFloor } from '@/map/palacePlan'
import type { Vec2 } from '@/contracts/domain'
import { Floor } from './floorPath'

let floor: Floor | null = null
let loading: Promise<void> | null = null
const cache = new Map<string, Vec2[] | null>()

/** Tests install a grid directly. Passing null clears it. */
export function installVenueFloor(next: Floor | null): void {
  floor = next
  cache.clear()
}

/** Fetch `/venue/floor.json` once. A missing file leaves the local walk in place. */
export function ensureVenueFloor(): void {
  if (floor || loading || import.meta.env.MODE === 'test') return
  loading = Floor.load('/venue/floor.json')
    .then((next) => {
      floor = next ?? null
      cache.clear()
    })
    .catch(() => {
      floor = null
    })
}

/**
 * The walkable corners from `from` to `to` in plan metres, or null when the grid is not loaded
 * or no aisle joins the two points.
 */
export function routeOnVenueFloor(from: Vec2, to: Vec2): Vec2[] | null {
  if (!floor) return null
  const key = `${Math.round(from.x * 2)}:${Math.round(from.y * 2)}:${Math.round(to.x * 2)}:${Math.round(to.y * 2)}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const way = floor.path(floor.snap(planToFloor(from)), floor.snap(planToFloor(to)))
  const points = way && way.length >= 2 ? way.map((point) => floorToPlan(point)) : null
  cache.set(key, points)
  return points
}
