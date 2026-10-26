import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_DEMO_RING, demoRoute } from '@/booth/demoRing'
import { installVenueFloor } from '@/booth/floorGuide'
import { Floor } from '@/booth/floorPath'

const file = JSON.parse(readFileSync(resolve('public/venue/floor.json'), 'utf8')) as ConstructorParameters<typeof Floor>[0]

describe('venue floor path', () => {
  afterEach(() => installVenueFloor(null))

  it('draws the entrance path through the floor grid instead of a straight line', () => {
    installVenueFloor(new Floor(file))
    const route = demoRoute(DEFAULT_DEMO_RING)
    expect(route.points.length).toBeGreaterThan(2)
    const start = route.points[0]!
    const end = route.points[route.points.length - 1]!
    const span = Math.hypot(end.x - start.x, end.y - start.y) || 1
    let off = 0
    for (const point of route.points) {
      const t = ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / (span * span)
      const x = start.x + (end.x - start.x) * t
      const y = start.y + (end.y - start.y) * t
      off = Math.max(off, Math.hypot(point.x - x, point.y - y))
    }
    expect(off).toBeGreaterThan(3)
  })
})
