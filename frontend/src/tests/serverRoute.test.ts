import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_DEMO_RING, demoEntrance, demoRoute } from '@/booth/demoRing'
import { planOfPath, setServerWalks, syncServerWalks } from '@/booth/serverRoute'
import { planToFloor } from '@/map/palacePlan'

afterEach(() => setServerWalks([]))

function flat(points: { x: number; y: number }[]): number[] {
  return points.flatMap((point) => planToFloor(point))
}

describe('server responder route', () => {
  it('draws the crowd_walk that joins the entrance to the ring', () => {
    const from = demoEntrance()
    const ring = DEFAULT_DEMO_RING
    const via = { x: (from.x + ring.x) / 2, y: (from.y + ring.y) / 2 - 6 }
    const local = demoRoute(ring).points
    setServerWalks([{ path: flat([{ x: 8, y: 12 }, { x: 9, y: 14 }]) }])
    expect(demoRoute(ring).points).toEqual(local)
    setServerWalks([{ path: flat([from, via, { x: ring.x, y: ring.y + ring.r + 2 }]) }])
    const route = demoRoute(ring)
    const hit = route.points.some((point) => Math.hypot(point.x - via.x, point.y - via.y) < 0.05)
    expect(hit).toBe(true)
    const end = route.points[route.points.length - 1]!
    expect(Math.hypot(end.x - ring.x, end.y - ring.y)).toBeCloseTo(ring.r, 0)
  })

  it('reads model pairs off the crowd_walk table', () => {
    const via = { x: 50, y: 160 }
    const path = flat([demoEntrance(), via])
    expect(planOfPath(path)?.[1]).toMatchObject({ x: via.x, y: via.y })
    syncServerWalks({ crowdWalk: { iter: () => [{ path }] } })
    expect(demoRoute(DEFAULT_DEMO_RING).points.some((point) => Math.hypot(point.x - via.x, point.y - via.y) < 0.05)).toBe(true)
    syncServerWalks({})
    expect(demoRoute(DEFAULT_DEMO_RING).points.some((point) => Math.hypot(point.x - via.x, point.y - via.y) < 0.05)).toBe(false)
  })
})
