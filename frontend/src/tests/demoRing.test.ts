import { describe, expect, it } from 'vitest'
import { DEFAULT_DEMO_RING, DEMO_LANE, demoIsActive, demoPath, hardwareAlerts, layoutDemo, patternOf } from '@/booth/demoRing'
import { CalhacksCrowd, floorUse } from '@/mock/calhacksCrowd'
import { bandFromRow, placeOnCalhacks, type FloorBand, type FloorInput } from '@/stdb/floor'

function band(partial: Partial<FloorBand> & Pick<FloorBand, 'id'>): FloorBand {
  return {
    zone: 1,
    online: true,
    sos: false,
    fall: false,
    lastSeen: 1,
    hasMotor: true,
    hasMpu: true,
    wearer: null,
    xM: null,
    yM: null,
    boothId: 0,
    hasPosition: false,
    state: 0,
    ...partial,
  }
}

describe('demo ring', () => {
  it('matches the firmware light: SOS flashes, a neighbour stays red', () => {
    expect(patternOf(bandFromRow({ id: 4, online: true, sos: false, state: 3 }, null))).toBe('sos')
    expect(patternOf(bandFromRow({ id: 5, online: true, sos: false, state: 4 }, null))).toBe('steady_red')
    expect(patternOf(bandFromRow({ id: 6, online: true, state: 0 }, null))).toBe('ready')
    expect(bandFromRow({ id: 7, online: true }, null).state).toBe(0)
    // The radio beacon carries distress in the flag byte. Ingest copies that bit onto `sos`.
    const fromFlags = bandFromRow({ id: 8, online: true, sos: false, fall: false, flags: 1, state: 0 }, null)
    expect(fromFlags.sos).toBe(true)
    expect(patternOf(fromFlags)).toBe('sos')
    expect(bandFromRow({ id: 9, online: true, flags: 2, state: 0 }, null).fall).toBe(true)
  })

  it('draws the hardware inside the ring and leaves the crowd roster off the map', () => {
    const ring = DEFAULT_DEMO_RING
    const laid = layoutDemo(
      [
        band({ id: 2, sos: true, state: 3 }),
        band({ id: 3, state: 4 }),
        band({ id: 8, xM: 1.2, yM: -0.4, hasPosition: true }),
        band({ id: 400, sos: true }),
        band({ id: 9, online: false }),
      ],
      ring,
    )
    expect(laid.map((item) => item.band.id).sort((a, b) => a - b)).toEqual([2, 3, 8])
    expect(laid.find((item) => item.band.id === 2)?.at).toEqual({ x: ring.x, y: ring.y })
    const neighbour = laid.find((item) => item.band.id === 3)!.at
    expect(Math.hypot(neighbour.x - ring.x, neighbour.y - ring.y)).toBeLessThan(ring.r)
    expect(laid.find((item) => item.band.id === 8)?.at).toEqual({ x: ring.x + 1.2, y: ring.y - 0.4 })
  })

  it('runs the cleared path from the entrance to the rim, and only for a live hardware alert', () => {
    const path = demoPath(DEFAULT_DEMO_RING)
    expect(path.length).toBeGreaterThan(2)
    const end = path[path.length - 1]!
    expect(Math.hypot(end.x - DEFAULT_DEMO_RING.x, end.y - DEFAULT_DEMO_RING.y)).toBeCloseTo(DEFAULT_DEMO_RING.r, 0)
    expect(path[0]!.y).toBeGreaterThan(DEFAULT_DEMO_RING.y)
    expect(demoIsActive([band({ id: 2, state: 4 })], [])).toBe(true)
    expect(demoIsActive([band({ id: 2, online: false, sos: true })], [])).toBe(false)
    expect(demoIsActive([band({ id: 240, sos: true })], [])).toBe(false)
  })

  it('opens a hardware SOS at the ring, and leaves the crowd roster alone', () => {
    const input: FloorInput = {
      venueName: 'Palace of Fine Arts',
      timeZone: 'America/Los_Angeles',
      zones: [{ id: '1', name: 'Hacking floor', kind: 'floor', stationId: 1, x: 0, y: 0, area: 10, capacity: 10 }],
      bands: [
        band({ id: 4, sos: true, state: 3 }),
        band({ id: 5, state: 4 }),
        band({ id: 400, sos: true }),
      ],
      incidents: [],
    }
    const snap = placeOnCalhacks(input)
    expect(snap.incidents.map((incident) => incident.reportedByDeviceId)).toEqual(['band-4'])
    expect(snap.commands).toEqual([])
    expect(snap.incidents[0]?.location).toEqual({ x: DEFAULT_DEMO_RING.x, y: DEFAULT_DEMO_RING.y })
    expect(snap.incidents[0]?.isSimulated).toBe(false)
    expect(hardwareAlerts(input.bands, DEFAULT_DEMO_RING)).toHaveLength(1)
    expect(snap.sources.find((source) => source.sourceId === 'spacetimedb')?.detail).toMatch(/^2 live on the floor/)
  })

  it('opens the ring from the beacon flag bit, before an incident row arrives', () => {
    const raised = bandFromRow({ id: 96, online: true, sos: false, flags: 1, state: 3, xM: -85.4, yM: -7.8 }, null)
    const neighbour = bandFromRow({ id: 94, online: true, state: 4, xM: -80.9, yM: -9.3 }, null)
    const snap = placeOnCalhacks({
      venueName: 'Palace of Fine Arts',
      timeZone: 'America/Los_Angeles',
      zones: [],
      bands: [raised, neighbour, band({ id: 400, sos: true })],
      incidents: [],
    })
    expect(snap.incidents.map((incident) => incident.incidentId)).toEqual(['live-96'])
    expect(snap.incidents[0]?.location).toEqual({ x: DEFAULT_DEMO_RING.x, y: DEFAULT_DEMO_RING.y })
    expect(snap.commands).toEqual([])
    expect(patternOf(neighbour)).toBe('steady_red')
    expect(layoutDemo([raised, neighbour], DEFAULT_DEMO_RING).map((item) => item.band.id).sort((a, b) => a - b)).toEqual([94, 96])
  })

  it('walks simulated people out of the ring and off the path', () => {
    const crowd = new CalhacksCrowd(40, 9)
    const ring = { x: 64, y: 150, r: 4 }
    const seated = crowd.people[0]!
    seated.x = ring.x
    seated.y = ring.y
    seated.pose = 2
    const walker = crowd.people.slice(1).find((person) => floorUse(person.x, person.y) === 'walk')
    expect(walker).toBeTruthy()
    const path = [
      { x: walker!.x, y: walker!.y - 8 },
      { x: walker!.x, y: walker!.y + 8 },
    ]
    crowd.setDemo(ring, path)
    for (let step = 0; step < 90; step++) crowd.step()
    expect(Math.hypot(seated.x - ring.x, seated.y - ring.y)).toBeGreaterThan(ring.r)
    const lane = Math.abs(walker!.x - path[0]!.x)
    expect(lane).toBeGreaterThan(DEMO_LANE - 0.05)
    expect(crowd.revealed()).toBeGreaterThan(0)
  })
})
