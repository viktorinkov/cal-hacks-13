import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_DEMO_RING, S_NEAR_SOS, S_SOS, useHardware } from '@/booth/demoRing'
import { acknowledgeHall, openHallPath, resetHallDemo, scriptedBands, triggerHallSos, useHallDemo } from '@/booth/hallDemo'
import { placeOnCalhacks, type FloorBand, type FloorInput } from '@/stdb/floor'

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

const input: FloorInput = {
  venueName: 'Palace of Fine Arts',
  timeZone: 'America/Los_Angeles',
  zones: [{ id: '1', name: 'Hacking floor', kind: 'floor', stationId: 1, x: 0, y: 0, area: 10, capacity: 10 }],
  bands: [band({ id: 91 })],
  incidents: [],
}

describe('hall demo', () => {
  afterEach(() => {
    resetHallDemo()
    useHardware.setState({ bands: [] })
  })

  it('sets off a stand-in SOS and keeps the path closed', () => {
    triggerHallSos()
    const bands = scriptedBands()
    expect(bands[0]?.state).toBe(S_SOS)
    expect(bands.slice(1).every((item) => item.state === S_NEAR_SOS)).toBe(true)
    expect(bands.every((item) => item.id <= 99)).toBe(true)
    const snap = placeOnCalhacks(input)
    expect(snap.incidents).toHaveLength(1)
    expect(snap.incidents[0]).toMatchObject({
      status: 'reported',
      source: 'manual_sos',
      isSimulated: false,
      location: { x: DEFAULT_DEMO_RING.x, y: DEFAULT_DEMO_RING.y },
    })
    expect(snap.commands).toEqual([])
  })

  it('opens the yellow path only when the operator says so', () => {
    triggerHallSos()
    acknowledgeHall()
    let snap = placeOnCalhacks(input)
    expect(snap.incidents[0]?.status).toBe('acknowledged')
    expect(snap.commands[0]).toMatchObject({ commandId: 'demo-path', approvalStatus: 'pending_approval', deliveryStatus: 'not_sent' })
    openHallPath()
    snap = placeOnCalhacks(input)
    expect(snap.incidents[0]?.status).toBe('responding')
    expect(snap.commands[0]?.approvalStatus).toBe('approved')
    resetHallDemo()
    snap = placeOnCalhacks(input)
    expect(snap.incidents).toEqual([])
    expect(snap.commands).toEqual([])
  })

  it('keeps the rehearsal when that band is online but quiet', () => {
    triggerHallSos()
    const id = useHallDemo.getState().sosId!
    useHardware.setState({ bands: [band({ id, online: true, sos: false, state: 0 })] })
    expect(scriptedBands().some((item) => item.id === id && item.sos)).toBe(true)
    const snap = placeOnCalhacks({ ...input, bands: [band({ id, online: true, sos: false, state: 0 })] })
    expect(snap.incidents.map((incident) => incident.incidentId)).toEqual([`live-${id}`])
    expect(snap.commands).toEqual([])
  })

  it('clears the rehearsal when SOS is pressed again', () => {
    triggerHallSos()
    expect(useHallDemo.getState().scripted).toBe(true)
    const first = placeOnCalhacks(input)
    expect(first.incidents).toHaveLength(1)
    triggerHallSos()
    expect(useHallDemo.getState().scripted).toBe(false)
    expect(scriptedBands()).toEqual([])
    const snap = placeOnCalhacks(input)
    expect(snap.incidents).toEqual([])
    expect(snap.commands).toEqual([])
  })

  it('leaves a real distress alone and still waits to open the path', () => {
    useHardware.setState({ bands: [band({ id: 4, sos: true, state: S_SOS })] })
    triggerHallSos()
    expect(useHallDemo.getState().scripted).toBe(false)
    const live: FloorInput = { ...input, bands: [band({ id: 4, sos: true, state: S_SOS })] }
    let snap = placeOnCalhacks(live)
    expect(snap.incidents.map((incident) => incident.reportedByDeviceId)).toEqual(['band-4'])
    expect(snap.commands).toEqual([])
    openHallPath()
    snap = placeOnCalhacks(live)
    expect(snap.incidents[0]?.status).toBe('responding')
    expect(snap.commands[0]).toMatchObject({ commandId: 'demo-path', approvalStatus: 'approved', incidentId: snap.incidents[0]?.incidentId })
  })
})
