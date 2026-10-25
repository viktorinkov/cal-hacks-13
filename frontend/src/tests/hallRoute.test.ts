import { describe, expect, it } from 'vitest'
import { DEFAULT_DEMO_RING, demoEntrance, demoRoute } from '@/booth/demoRing'
import { onStair } from '@/booth/hallRoute'
import { calhacksVenue } from '@/mock/calhacks'
import { floorUse } from '@/mock/calhacksCrowd'
import { pointInPolygon } from '@/lib/geometry'

function samples(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5))
    for (let s = 0; s <= n; s++) {
      const t = s / n
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
  }
  return out
}

function crossing(points: { x: number; y: number }[], y: number): number {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const lo = Math.min(a.y, b.y)
    const hi = Math.max(a.y, b.y)
    if (y < lo || y > hi || a.y === b.y) continue
    const t = (y - a.y) / (b.y - a.y)
    return a.x + (b.x - a.x) * t
  }
  throw new Error(`path does not cross y=${y}`)
}

describe('hall route', () => {
  it('follows the broadway aisle beside the tables and keeps the atrium aisle', () => {
    const ring = { x: 71.9, y: 53.3, r: 5 }
    const route = demoRoute(ring)
    expect(crossing(route.points, 146)).toBeGreaterThan(54)
    expect(crossing(route.points, 146)).toBeLessThan(62)
    expect(crossing(route.points, 120)).toBeGreaterThan(62)
    expect(crossing(route.points, 120)).toBeLessThan(69)
    expect(crossing(route.points, 80)).toBeGreaterThan(70)
    expect(crossing(route.points, 80)).toBeLessThan(80)
    for (const point of samples(route.points)) {
      expect(onStair(point.x, point.y)).toBe(false)
      if (Math.hypot(point.x - ring.x, point.y - ring.y) > ring.r + 0.4) expect(floorUse(point.x, point.y)).toBe('walk')
    }
  })

  it('walks the ground floor to the ring and does not cross a stair', () => {
    const route = demoRoute(DEFAULT_DEMO_RING)
    expect(route.points.length).toBeGreaterThan(2)
    expect(route.z.every((z) => z === 0)).toBe(true)
    const end = route.points[route.points.length - 1]!
    expect(Math.hypot(end.x - DEFAULT_DEMO_RING.x, end.y - DEFAULT_DEMO_RING.y)).toBeCloseTo(DEFAULT_DEMO_RING.r, 0)
    expect(route.points[0]!.y).toBeGreaterThan(demoEntrance().y - 20)
    const placed = demoRoute({ x: 71.9, y: 53.3, r: 5 })
    for (const point of samples(placed.points)) expect(onStair(point.x, point.y)).toBe(false)
    for (const point of samples(route.points)) {
      expect(onStair(point.x, point.y)).toBe(false)
      const onGround = calhacksVenue.zones.some((zone) => !(zone.elevationM ?? 0) && pointInPolygon(point.x, point.y, zone.polygon))
      expect(onGround).toBe(true)
    }
  })

  it('stays on the ground under the balcony instead of climbing off the railing', () => {
    const deck = calhacksVenue.platforms[0]!
    const ring = { x: 80, y: 140, r: 4 }
    expect(pointInPolygon(ring.x, ring.y, deck.polygon)).toBe(true)
    const route = demoRoute(ring)
    expect(route.z.every((z) => z === 0)).toBe(true)
    expect(route.points.length).toBeGreaterThan(2)
    for (const point of samples(route.points)) {
      expect(onStair(point.x, point.y)).toBe(false)
      const onGround = calhacksVenue.zones.some((zone) => !(zone.elevationM ?? 0) && pointInPolygon(point.x, point.y, zone.polygon))
      expect(onGround).toBe(true)
    }
  })
})
