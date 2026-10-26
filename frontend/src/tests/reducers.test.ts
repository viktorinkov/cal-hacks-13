import { describe, expect, it } from 'vitest'
import type { Incident, StreamEvent, WorldSnapshot } from '@/contracts/domain'
import { venue } from '@/mock/venue'
import { applyEvents, emptyWorld, fromSnapshot, isNewerIncident } from '@/stores/reducers'

const inc = (status: Incident['status'], timeline = 1): Incident => ({
  incidentId: 'inc-1',
  displayId: 'INC-0001',
  reportedByDeviceId: 'band-03',
  reportedAt: 0,
  status,
  source: 'manual_sos',
  radioStatus: 'received',
  localizationStatus: 'estimated',
  cameraObservations: [],
  timeline: Array.from({ length: timeline }, (_, k) => ({ at: k, source: 'system' as const, text: String(k) })),
  guidanceCommandIds: [],
  isSimulated: true,
})

const snap: WorldSnapshot = {
  timestamp: 0,
  seq: 10,
  mode: 'simulation',
  venue,
  zones: [],
  devices: [],
  incidents: [],
  observations: [],
  commands: [],
  sources: [],
}

describe('incident state updates', () => {
  it('creates an incident from an SOS event', () => {
    const world = fromSnapshot(snap)
    const next = applyEvents(world, [{ type: 'incident', seq: 11, at: 5, incident: inc('reported') }])
    expect(next.incidents['inc-1'].status).toBe('reported')
    expect(next.seq).toBe(11)
    expect(next.lastEventAt).toBe(5)
  })

  it('does not let an older copy undo a newer one', () => {
    const world = applyEvents(fromSnapshot(snap), [{ type: 'incident', seq: 11, at: 5, incident: inc('responding', 4) }])
    const next = applyEvents(world, [{ type: 'incident', seq: 12, at: 6, incident: inc('acknowledged', 3) }])
    expect(next.incidents['inc-1'].status).toBe('responding')
    expect(isNewerIncident(inc('reported', 2), inc('reported', 3))).toBe(true)
    expect(isNewerIncident(inc('resolved', 2), inc('responding', 9))).toBe(false)
  })

  it('copies collections once per batch and leaves the old state untouched', () => {
    const world = fromSnapshot(snap)
    const events: StreamEvent[] = [
      { type: 'incident', seq: 11, at: 1, incident: inc('reported') },
      { type: 'incident', seq: 12, at: 2, incident: { ...inc('reported'), incidentId: 'inc-2' } },
    ]
    const next = applyEvents(world, events)
    expect(Object.keys(next.incidents)).toEqual(['inc-1', 'inc-2'])
    expect(world.incidents).toEqual({})
  })

  it('records venue pressure history from zone updates, bounded', () => {
    let w = { ...emptyWorld, ready: true }
    for (let k = 0; k < 700; k++) {
      w = applyEvents(w, [
        {
          type: 'zones',
          seq: k + 1,
          at: k * 1000,
          zones: [{ zoneId: 'WP', timestamp: k, congestionStatus: k % 2 ? 'caution' : 'normal', source: 'simulation', dataQuality: 'good', updatedAt: k, peakDensity: 2 }],
        },
      ])
    }
    expect(w.history.length).toBe(600)
    expect(w.history[w.history.length - 1].status).toBe('caution')
    expect(w.zoneSeries.WP.length).toBeLessThanOrEqual(240)
  })
})
