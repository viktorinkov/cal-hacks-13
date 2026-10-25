import { describe, expect, it } from 'vitest'
import { calhacksVenue } from '@/mock/calhacks'
import { placeOnCalhacks, projectFloor, type FloorInput } from '@/stdb/floor'

const input: FloorInput = {
  venueName: 'Palace of Fine Arts',
  timeZone: 'America/Los_Angeles',
  now: 1_700_000_000_000,
  zones: [
    { id: '1', name: 'Main stage', kind: 'stage', stationId: 105, x: 120, y: 10, area: 200, capacity: 150 },
    { id: '2', name: 'Hacking floor', kind: 'floor', stationId: 101, x: 0, y: 10, area: 200, capacity: 150 },
  ],
  bands: [
    { id: 92, zone: 101, online: true, sos: false, fall: true, lastSeen: 1, hasMotor: true, hasMpu: true, wearer: 'Sam Patel', xM: null, yM: null, boothId: 0, hasPosition: false, state: 0 },
    { id: 94, zone: 101, online: true, sos: false, fall: false, lastSeen: 1, hasMotor: false, hasMpu: false, wearer: null, xM: null, yM: null, boothId: 0, hasPosition: false, state: 0 },
    { id: 3, zone: 0, online: false, sos: false, fall: false, lastSeen: null, hasMotor: false, hasMpu: false, wearer: null, xM: null, yM: null, boothId: 0, hasPosition: false, state: 0 },
  ],
  incidents: [{ id: '4', kind: 'fall', zoneId: '2', stationId: 101, bandId: 92, openedAt: 50, resolved: false, status: 'open' }],
}

describe('live floor', () => {
  it('places bands on the zone they reported and keeps them inside the plan', () => {
    const snap = projectFloor(input)
    expect(snap).not.toBeNull()
    expect(snap!.mode).toBe('live')
    expect(snap!.venue.name).toBe('Palace of Fine Arts')
    expect(snap!.venue.zones.find((zone) => zone.zoneId === '1')?.section).toBe('front')
    expect(snap!.devices.map((device) => device.deviceId).sort()).toEqual(['band-92', 'band-94'])
    const sam = snap!.devices.find((device) => device.deviceId === 'band-92')!
    expect(sam.currentPattern).toBe('steady_red')
    expect(sam.wearerLabel).toBe('Sam Patel')
    expect(sam.zoneId).toBe('2')
    const other = snap!.devices.find((device) => device.deviceId === 'band-94')!
    expect(sam.location).not.toEqual(other.location)
    for (const device of snap!.devices) {
      expect(device.location!.x).toBeGreaterThanOrEqual(0)
      expect(device.location!.y).toBeGreaterThanOrEqual(0)
      expect(device.location!.x).toBeLessThanOrEqual(snap!.venue.width)
      expect(device.location!.y).toBeLessThanOrEqual(snap!.venue.height)
    }
    const floor = snap!.zones.find((zone) => zone.zoneId === '2')!
    expect(floor.occupancyEstimate).toBe(2)
    expect(floor.congestionStatus).toBe('critical')
    expect(snap!.incidents[0]).toMatchObject({ displayId: 'INC-4', source: 'imu_suspicion', candidateZone: '2', status: 'reported' })
  })

  it('does not replace the map until the database has a plan', () => {
    expect(projectFloor({ ...input, zones: [] })).toBeNull()
  })

  it('keeps live band ids in the roster and off the CalHacks map', () => {
    const snap = placeOnCalhacks(input)
    expect(snap.venue.venueId).toBe('calhacks')
    expect(snap.venue).toBe(calhacksVenue)
    expect(snap.devices.map((device) => device.deviceId).sort()).toEqual(['band-92', 'band-94'])
    for (const device of snap.devices) expect(device.location).toBeUndefined()
    expect(snap.devices.find((device) => device.deviceId === 'band-92')?.zoneId).toBe('atrium')
    expect(snap.incidents[0]?.candidateZone).toBe('atrium')
    expect(placeOnCalhacks(null).devices).toEqual([])
  })

  it('leaves crowd falls off the operator map', () => {
    const snap = placeOnCalhacks({
      ...input,
      incidents: [
        ...input.incidents,
        { id: '75', kind: 'fall', zoneId: '2', stationId: 101, bandId: 888, openedAt: 60, resolved: false },
      ],
    })
    expect(snap.incidents.map((incident) => incident.incidentId)).toEqual(['4'])
  })

  it('does not turn the crowd table into wristband markers', () => {
    const crowd = {
      id: 400,
      zone: 101,
      online: true,
      sos: false,
      fall: false,
      lastSeen: 1,
      hasMotor: true,
      hasMpu: true,
      wearer: 'Mina Cole',
      xM: 12,
      yM: 40,
      boothId: 0,
      hasPosition: true,
      state: 0,
    }
    const snap = placeOnCalhacks({ ...input, bands: [...input.bands, crowd] })
    expect(snap.devices.map((device) => device.deviceId)).not.toContain('band-400')
    expect(snap.devices.map((device) => device.deviceId).sort()).toEqual(['band-92', 'band-94'])
  })
})