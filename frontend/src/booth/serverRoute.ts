/**
 * Responder line taken from SpacetimeDB `crowd_walk` routes.
 * Each path is model metres (x east, z south), the same frame as the floor grid.
 */
import type { Vec2 } from '@/contracts/domain'
import { floorToPlan } from '@/map/palacePlan'

/** Both ends of a stored walk must sit at least this close to the entrance and the ring. */
const NEAR_M = 40

let walks: Vec2[][] = []

function rowsOf(table: unknown): Record<string, unknown>[] {
  if (!table || typeof table !== 'object' || !('iter' in table)) return []
  const iter = (table as { iter: unknown }).iter
  if (typeof iter !== 'function') return []
  return [...(iter.call(table) as Iterable<Record<string, unknown>>)]
}

/** Model x,z pairs to plan points. An odd or empty list is dropped. */
export function planOfPath(path: unknown): Vec2[] | null {
  if (!Array.isArray(path) || path.length < 4 || path.length % 2 !== 0) return null
  const points: Vec2[] = []
  for (let i = 0; i < path.length; i += 2) {
    const x = Number(path[i])
    const z = Number(path[i + 1])
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null
    points.push(floorToPlan([x, z]))
  }
  return points
}

/** Replace the routes the floor is drawing from. Pass an empty list to fall back to the local walk. */
export function setServerWalks(rows: { path?: unknown }[]): void {
  const next: Vec2[][] = []
  for (const row of rows) {
    const points = planOfPath(row.path)
    if (points) next.push(points)
  }
  walks = next
}

/** Read `crowd_walk` off the subscribed database. */
export function syncServerWalks(db: Record<string, unknown>): void {
  setServerWalks(rowsOf(db.crowdWalk))
}

function dist2(a: Vec2, b: Vec2): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2
}

/**
 * The stored walk that best joins `from` to `to`, oriented that way.
 * Nothing when no route has both ends within 40 m.
 */
export function serverRoute(from: Vec2, to: Vec2): Vec2[] | null {
  const cap = NEAR_M * NEAR_M
  let best: Vec2[] | null = null
  let bestD = Infinity
  for (const points of walks) {
    const start = points[0]!
    const end = points[points.length - 1]!
    const forward = dist2(start, from) + dist2(end, to)
    const backward = dist2(end, from) + dist2(start, to)
    const flip = backward < forward
    const nearFrom = flip ? dist2(end, from) : dist2(start, from)
    const nearTo = flip ? dist2(start, to) : dist2(end, to)
    if (nearFrom > cap || nearTo > cap) continue
    const score = flip ? backward : forward
    if (score >= bestD) continue
    bestD = score
    best = flip ? [...points].reverse() : points
  }
  return best
}
