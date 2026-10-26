import { describe, expect, it } from 'vitest'
import { boothHandle } from '@/booth/circle'
import { incidentAt, spotInBooth, deviceFromBand } from '@/booth/place'
import { MockBackend } from '@/mock/MockBackend'
import { CrowdSim } from '@/mock/sim/crowd'
import { venue } from '@/mock/venue'
import { bandFromRow, type FloorBand } from '@/stdb/floor'

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
    boothId: 4,
    hasPosition: false,
    state: 0,
    ...partial,
  }
}

describe('live booth', () => {
  it('maps a u32 band id and its booth coordinates', () => {
    const row = bandFromRow(
      { id: 4_000_000_001, zone: 3, online: true, sos: true, fall: false, xM: 1.25, yM: -0.5, boothId: 9n },
      'Ada',
    )
    expect(row.id).toBe(4_000_000_001)
    expect(row.boothId).toBe(9)
    expect(row.hasPosition).toBe(true)
    expect(row.xM).toBeCloseTo(1.25)
    expect(row.yM).toBeCloseTo(-0.5)
    expect(row.wearer).toBe('Ada')
    expect(row.sos).toBe(true)
    expect(bandFromRow({ id: 2, online: true }, null).hasPosition).toBe(false)
  })

  it('uses a measured offset inside the circle and does not invent a spot', () => {
    const booth = { x: 78, y: 58, r: 5 }
    expect(spotInBooth(band({ id: 7, xM: 1, yM: 0, hasPosition: true }), booth)).toEqual({ x: 79, y: 58 })
    const unknown = deviceFromBand(band({ id: 8 }), booth)
    expect(unknown.location).toBeUndefined()
    expect(unknown.locationSource).toBe('unknown')
    expect(deviceFromBand(band({ id: 5, state: 4 }), booth).currentPattern).toBe('steady_red')
    expect(deviceFromBand(band({ id: 4, state: 3, sos: false }), booth).currentPattern).toBe('sos')
    expect(spotInBooth(band({ id: 9, xM: 40, yM: 40, hasPosition: true }), booth)).toBeNull()
    const sos = incidentAt(band({ id: 8, sos: true }), booth)
    expect(sos).toEqual({ at: { x: 78, y: 58 }, radius: 5 })
    expect(incidentAt(band({ id: 7, xM: 1, yM: 0, hasPosition: true, sos: true }), booth)?.at).toEqual({ x: 79, y: 58 })
  })

  it('opens one live incident at the band and routes First Aid to the booth', () => {
    const backend = new MockBackend({ crowdSize: 40, warmupS: 0 })
    backend.setBooth({ x: 78, y: 58, r: 5 })
    const at = { x: 79, y: 58 }
    const inc = backend.reportLive({ deviceId: 'live-7', label: '07', at, radius: 1.5, kind: 'sos' })
    expect(inc).toMatchObject({ isSimulated: false, source: 'manual_sos', location: at, locationRadiusM: 1.5 })
    const again = backend.reportLive({ deviceId: 'live-7', label: '07', at, radius: 1.5, kind: 'sos' })
    expect(again?.incidentId).toBe(inc?.incidentId)
    const command = backend.preview({ incidentId: inc!.incidentId })
    expect(command.corridorId).toBe('COR-BOOTH')
    expect(command.preview.corridorName).toBe('First Aid to the live booth')
  })

  it('grabs the whole circle when the hall is fitted, and the rim only when zoomed in', () => {
    const circle = { x: 64, y: 150, r: 5 }
    expect(boothHandle(66, 150, circle, 3)).toBe('move')
    expect(boothHandle(64, 156, circle, 3)).toBe('move')
    expect(boothHandle(80, 150, circle, 3)).toBeNull()
    expect(boothHandle(69, 150, circle, 24)).toBe('resize')
    expect(boothHandle(64, 150, circle, 24)).toBe('move')
  })

  it('keeps simulated people outside the live circle', () => {
    const sim = new CrowdSim({ seed: 3, count: 180, venue, anchors: [], compliance: 0.5 })
    const circle = { x: 50, y: 28, r: 5 }
    sim.setKeepOut(circle)
    for (let step = 0; step < 25; step++) sim.step()
    for (let i = 0; i < sim.n; i++) {
      expect(Math.hypot(sim.x[i] - circle.x, sim.y[i] - circle.y)).toBeGreaterThan(circle.r)
    }
  })
})
