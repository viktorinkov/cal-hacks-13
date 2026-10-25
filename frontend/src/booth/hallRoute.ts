/**
 * A walk a person can actually take through the Palace.
 * The ground floor and the mezzanine are different levels. Stairs are the only way between them.
 * A route never cuts across a flight, through a wall, or off the edge of the deck.
 */
import type { Vec2 } from '@/contracts/domain'
import { pointInPolygon } from '@/lib/geometry'
import { calhacksVenue } from '@/mock/calhacks'

/** One cell is one metre. */
const GW = 110
const GH = 228
const N = GW * GH
const DECK = calhacksVenue.platforms[0]?.elevationM ?? 4.2

interface Cell {
  ix: number
  iy: number
}

interface Step {
  x: number
  y: number
  z: number
}

const deck = calhacksVenue.platforms[0]?.polygon ?? []
const stairs = calhacksVenue.stairs
const groundZones = calhacksVenue.zones.filter((zone) => !(zone.elevationM ?? 0))

interface Blocker {
  poly: Vec2[]
  minX: number
  minY: number
  maxX: number
  maxY: number
  up: boolean
  wall: boolean
}

const blockers: Blocker[] = calhacksVenue.structures
  .filter((structure) => structure.name !== 'Chairs')
  .map((structure) => {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const point of structure.footprint) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
    const up = structure.baseM >= 2
    const wall = structure.blocksMovement || structure.kind === 'stage' || structure.kind === 'wall' || structure.kind === 'container'
    return { poly: structure.footprint, minX, minY, maxX, maxY, up, wall }
  })

let openGround: Uint8Array | null = null
let openDeck: Uint8Array | null = null
/** Metres of open floor around a ground cell. Wide halls are cheap in the middle. */
let clearance: Uint8Array | null = null

/** Beyond this, more open floor does not change the walk. Narrow atrium aisles all sit inside it. */
const CLEAR = 8
/** How hard a step is pushed off a wall or a table edge. */
const EDGE = 0.9

/** A plan point lies on a flight of stairs. People walk those end to end, not across them. */
export function onStair(x: number, y: number): boolean {
  for (const stair of stairs) if (pointInPolygon(x, y, stair.polygon)) return true
  return false
}

function inGround(x: number, y: number): boolean {
  for (const zone of groundZones) if (pointInPolygon(x, y, zone.polygon)) return true
  return false
}

function onDeck(x: number, y: number): boolean {
  return deck.length > 0 && pointInPolygon(x, y, deck)
}

function hits(x: number, y: number, up: boolean, wallsOnly: boolean): boolean {
  for (const block of blockers) {
    if (wallsOnly && !block.wall) continue
    if (up) {
      if (!block.up) continue
    } else if (block.up && block.wall) {
      // Mezzanine rooms stand on the deck. Tables and booths still block the plan.
      continue
    }
    if (x < block.minX || x > block.maxX || y < block.minY || y > block.maxY) continue
    if (pointInPolygon(x, y, block.poly)) return true
  }
  return false
}

/** Height of the floor a ring sits on. Under the balcony is still the ground floor. */
export function floorZ(x: number, y: number): number {
  if (inGround(x, y)) return 0
  return onDeck(x, y) ? DECK : 0
}

function ensure(): void {
  if (openGround) return
  openGround = new Uint8Array(N)
  openDeck = new Uint8Array(N)
  clearance = new Uint8Array(N)
  const queue: number[] = []
  for (let iy = 0; iy < GH; iy++) {
    for (let ix = 0; ix < GW; ix++) {
      const x = ix + 0.5
      const y = iy + 0.5
      const at = iy * GW + ix
      if (inGround(x, y) && !onStair(x, y) && !hits(x, y, false, false)) openGround[at] = 1
      const inset = onDeck(x, y) && onDeck(x + 0.45, y) && onDeck(x - 0.45, y) && onDeck(x, y + 0.45) && onDeck(x, y - 0.45)
      if (inset && !onStair(x, y) && !hits(x, y, true, false)) openDeck[at] = 1
      if (openGround[at]) continue
      clearance[at] = 0
      queue.push(at)
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!
    const dist = clearance[at]!
    if (dist >= CLEAR) continue
    const ix = at % GW
    const iy = Math.floor(at / GW)
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = ix + dx
      const ny = iy + dy
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue
      const next = ny * GW + nx
      if (clearance[next] !== 0 && clearance[next]! <= dist + 1) continue
      if (!openGround![next]) continue
      clearance[next] = dist + 1
      queue.push(next)
    }
  }
}

/** High against a wall or a table, zero once the floor is wide enough to be an aisle. */
function edgeBias(ix: number, iy: number): number {
  if (ix < 0 || iy < 0 || ix >= GW || iy >= GH || !clearance) return 0
  return Math.max(0, CLEAR - clearance[iy * GW + ix]!)
}

function grid(level: number): Uint8Array {
  ensure()
  return (level === 0 ? openGround : openDeck)!
}

function isOpen(level: number, ix: number, iy: number): boolean {
  if (ix < 0 || iy < 0 || ix >= GW || iy >= GH) return false
  return grid(level)[iy * GW + ix] === 1
}

function nearest(level: number, x: number, y: number, max: number): Cell | null {
  const ix0 = Math.floor(x)
  const iy0 = Math.floor(y)
  const r = Math.ceil(max)
  let best: Cell | null = null
  let bestD = max * max
  for (let iy = iy0 - r; iy <= iy0 + r; iy++) {
    for (let ix = ix0 - r; ix <= ix0 + r; ix++) {
      if (!isOpen(level, ix, iy)) continue
      const d = (ix + 0.5 - x) ** 2 + (iy + 0.5 - y) ** 2
      if (d <= bestD) {
        bestD = d
        best = { ix, iy }
      }
    }
  }
  return best
}

function at(cell: Cell): Vec2 {
  return { x: cell.ix + 0.5, y: cell.iy + 0.5 }
}

/** The walkable cell just outside the ring, on the side the entrance can reach. */
function approach(level: number, ring: { x: number; y: number; r: number }, from: Vec2): Cell | null {
  const near = ring.r + 3.5
  const ix0 = Math.floor(ring.x - near)
  const ix1 = Math.floor(ring.x + near)
  const iy0 = Math.floor(ring.y - near)
  const iy1 = Math.floor(ring.y + near)
  let best: Cell | null = null
  let bestD = Infinity
  for (let iy = iy0; iy <= iy1; iy++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      if (!isOpen(level, ix, iy)) continue
      const x = ix + 0.5
      const y = iy + 0.5
      const d = Math.hypot(x - ring.x, y - ring.y)
      if (d < ring.r - 0.2 || d > near) continue
      const via = Math.hypot(x - from.x, y - from.y)
      if (via < bestD) {
        bestD = via
        best = { ix, iy }
      }
    }
  }
  return best ?? nearest(level, ring.x, ring.y, 12)
}

class Heap {
  private readonly a: { f: number; i: number }[] = []

  get size(): number {
    return this.a.length
  }

  push(f: number, i: number): void {
    const a = this.a
    a.push({ f, i })
    let n = a.length - 1
    while (n > 0) {
      const p = (n - 1) >> 1
      if (a[p]!.f <= a[n]!.f) break
      const swap = a[p]!
      a[p] = a[n]!
      a[n] = swap
      n = p
    }
  }

  pop(): { f: number; i: number } | undefined {
    const a = this.a
    const top = a[0]
    const last = a.pop()
    if (!top) return undefined
    if (a.length && last) {
      a[0] = last
      let n = 0
      for (;;) {
        const l = n * 2 + 1
        const r = l + 1
        let s = n
        if (l < a.length && a[l]!.f < a[s]!.f) s = l
        if (r < a.length && a[r]!.f < a[s]!.f) s = r
        if (s === n) break
        const swap = a[s]!
        a[s] = a[n]!
        a[n] = swap
        n = s
      }
    }
    return top
  }
}

const NEIGHBORS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
]

function search(level: number, start: Cell, goal: Cell): Cell[] | null {
  const startI = start.iy * GW + start.ix
  const goalI = goal.iy * GW + goal.ix
  if (startI === goalI) return [start]
  const gScore = new Float64Array(N)
  gScore.fill(Infinity)
  gScore[startI] = 0
  const parent = new Int32Array(N)
  parent.fill(-1)
  const closed = new Uint8Array(N)
  const heap = new Heap()
  const gx = goal.ix + 0.5
  const gy = goal.iy + 0.5
  heap.push(Math.hypot(start.ix + 0.5 - gx, start.iy + 0.5 - gy), startI)
  while (heap.size) {
    const next = heap.pop()!
    if (closed[next.i]) continue
    if (next.i === goalI) {
      const out: Cell[] = []
      let cursor = goalI
      while (cursor >= 0) {
        out.push({ ix: cursor % GW, iy: Math.floor(cursor / GW) })
        cursor = parent[cursor]!
      }
      out.reverse()
      return out
    }
    closed[next.i] = 1
    const ix = next.i % GW
    const iy = Math.floor(next.i / GW)
    const base = gScore[next.i]!
    for (const [dx, dy, cost] of NEIGHBORS) {
      const nx = ix + dx
      const ny = iy + dy
      if (!isOpen(level, nx, ny)) continue
      if (dx !== 0 && dy !== 0 && (!isOpen(level, ix + dx, iy) || !isOpen(level, ix, iy + dy))) continue
      const ni = ny * GW + nx
      if (closed[ni]) continue
      const bias = level === 0 ? 1 + EDGE * edgeBias(nx, ny) : 1
      const g = base + cost * bias
      if (g >= gScore[ni]!) continue
      gScore[ni] = g
      parent[ni] = next.i
      heap.push(g + Math.hypot(nx + 0.5 - gx, ny + 0.5 - gy), ni)
    }
  }
  return null
}

function segmentOk(level: number, a: Vec2, b: Vec2): boolean {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const n = Math.max(1, Math.ceil(len / 0.45))
  const stay = level === 0 ? Math.min(edgeBias(Math.floor(a.x), Math.floor(a.y)), edgeBias(Math.floor(b.x), Math.floor(b.y))) + 1 : 0
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = a.x + (b.x - a.x) * t
    const y = a.y + (b.y - a.y) * t
    if (onStair(x, y)) return false
    if (!isOpen(level, Math.floor(x), Math.floor(y))) return false
    if (hits(x, y, level !== 0, false)) return false
    if (level === 0 && edgeBias(Math.floor(x), Math.floor(y)) > stay) return false
  }
  return true
}

/** Drop grid corners wherever the straight walk still stays on the same floor. */
function smooth(level: number, cells: Cell[]): Vec2[] {
  const points = cells.map(at)
  if (points.length <= 2) return points
  const out: Vec2[] = [points[0]!]
  let i = 0
  while (i < points.length - 1) {
    let best = i + 1
    for (let j = points.length - 1; j > i + 1; j--) {
      if (segmentOk(level, points[i]!, points[j]!)) {
        best = j
        break
      }
    }
    out.push(points[best]!)
    i = best
  }
  return out
}

/** The last step may cross chairs to reach the ring. It may not cross a stair, a wall, or the railing. */
function canFinish(level: number, a: Vec2, b: Vec2): boolean {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const n = Math.max(1, Math.ceil(len / 0.4))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = a.x + (b.x - a.x) * t
    const y = a.y + (b.y - a.y) * t
    if (onStair(x, y)) return false
    if (level === 0) {
      if (!inGround(x, y) || hits(x, y, false, true)) return false
    } else if (!onDeck(x, y) || hits(x, y, true, true)) return false
  }
  return true
}

function climb(bottom: Vec2, top: Vec2): Step[] {
  const steps: Step[] = []
  const n = 6
  for (let i = 0; i <= n; i++) {
    const t = i / n
    steps.push({
      x: bottom.x + (top.x - bottom.x) * t,
      y: bottom.y + (top.y - bottom.y) * t,
      z: DECK * t,
    })
  }
  return steps
}

function dedupe(steps: Step[]): Step[] {
  const out: Step[] = []
  for (const step of steps) {
    const prev = out[out.length - 1]
    if (prev && Math.hypot(prev.x - step.x, prev.y - step.y) < 0.2 && Math.abs(prev.z - step.z) < 0.05) continue
    out.push(step)
  }
  return out
}

function finish(steps: Step[], ring: { x: number; y: number; r: number }, level: number): Step[] {
  const last = steps[steps.length - 1]
  if (!last) return steps
  const dx = last.x - ring.x
  const dy = last.y - ring.y
  const len = Math.hypot(dx, dy) || 1
  if (len < 0.4) return steps
  const rim = { x: ring.x + (dx / len) * ring.r, y: ring.y + (dy / len) * ring.r, z: level === 0 ? 0 : DECK }
  if (!canFinish(level, last, rim)) return steps
  return dedupe([...steps, rim])
}

const cache = new Map<string, { points: Vec2[]; z: number[] }>()

/**
 * Walk from the entrance to the rim of the ring.
 * On the ground the whole way when the ring is on the ground, stairs included only to reach the deck.
 */
export function routeToRing(from: Vec2, ring: { x: number; y: number; r: number }): { points: Vec2[]; z: number[] } {
  const key = `${Math.round(from.x * 2)}:${Math.round(from.y * 2)}:${Math.round(ring.x * 2)}:${Math.round(ring.y * 2)}:${Math.round(ring.r * 2)}`
  const hit = cache.get(key)
  if (hit) return hit
  ensure()
  const level = inGround(ring.x, ring.y) ? 0 : onDeck(ring.x, ring.y) ? 1 : 0
  const start = nearest(0, from.x, from.y, 14)
  const built = start ? build(start, from, ring, level) : null
  const steps = built ?? [{ ...from, z: 0 }, { x: ring.x, y: ring.y, z: floorZ(ring.x, ring.y) }]
  const route = { points: steps.map(({ x, y }) => ({ x, y })), z: steps.map((step) => step.z) }
  cache.set(key, route)
  return route
}

function build(start: Cell, from: Vec2, ring: { x: number; y: number; r: number }, level: number): Step[] | null {
  if (level === 0) {
    const goal = approach(0, ring, from)
    if (!goal) return null
    const cells = search(0, start, goal)
    if (!cells) return null
    const walked = smooth(0, cells)
    if (walked[0] && segmentOk(0, from, walked[0])) walked.unshift(from)
    return finish(
      walked.map((point) => ({ ...point, z: 0 })),
      ring,
      0,
    )
  }
  let best: Step[] | null = null
  let bestLen = Infinity
  for (const stair of stairs) {
    const bottom = nearest(0, stair.bottom.x, stair.bottom.y, 8)
    const top = nearest(1, stair.top.x, stair.top.y, 8)
    const goal = approach(1, ring, stair.top)
    if (!bottom || !top || !goal) continue
    const down = search(0, start, bottom)
    const up = search(1, top, goal)
    if (!down || !up) continue
    const steps = dedupe([
      ...smooth(0, down).map((point) => ({ ...point, z: 0 })),
      ...climb(stair.bottom, stair.top),
      ...smooth(1, up).map((point) => ({ ...point, z: DECK })),
    ])
    const walked = finish(steps, ring, 1)
    let len = 0
    for (let i = 1; i < walked.length; i++) len += Math.hypot(walked[i]!.x - walked[i - 1]!.x, walked[i]!.y - walked[i - 1]!.y)
    if (len < bestLen) {
      bestLen = len
      best = walked
    }
  }
  return best
}
