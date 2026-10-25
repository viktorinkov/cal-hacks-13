import { describe, expect, it } from 'vitest'
import { DEFAULT_DEMO_RING, demoIsActive, demoPath, hardwareAlerts, layoutDemo, patternOf } from '@/booth/demoRing'
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

  it('shows a hardware SOS on its band, without inventing an incident', () => {
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
    expect(snap.incidents).toEqual([])
    expect(snap.commands).toEqual([])
    expect(snap.devices.map((device) => device.currentPattern)).toEqual(['sos', 'ready'])
    expect(hardwareAlerts(input.bands, DEFAULT_DEMO_RING)).toHaveLength(1)
    expect(snap.sources.find((source) => source.sourceId === 'spacetimedb')?.detail).toMatch(/^3 inside/)
  })

  it('reads the beacon flag bit onto the band before an incident row arrives', () => {
    const raised = bandFromRow({ id: 96, online: true, sos: false, flags: 1, state: 3, xM: -85.4, yM: -7.8 }, null)
    const neighbour = bandFromRow({ id: 94, online: true, state: 4, xM: -80.9, yM: -9.3 }, null)
    const snap = placeOnCalhacks({
      venueName: 'Palace of Fine Arts',
      timeZone: 'America/Los_Angeles',
      zones: [],
      bands: [raised, neighbour, band({ id: 400, sos: true })],
      incidents: [],
    })
    expect(snap.incidents).toEqual([])
    expect(snap.commands).toEqual([])
    expect(patternOf(raised)).toBe('sos')
    expect(patternOf(neighbour)).toBe('steady_red')
    expect(layoutDemo([raised, neighbour], DEFAULT_DEMO_RING).map((item) => item.band.id).sort((a, b) => a - b)).toEqual([94, 96])
  })
})
