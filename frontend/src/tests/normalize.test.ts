import { describe, expect, it } from 'vitest'
import { EntityKind } from '@/contracts/domain'
import { venueSchema } from '@/contracts/schemas'
import { venue } from '@/mock/venue'
import { camelizeKeys, framesFromEntities, parseSnapshot, parseStreamEvent } from '@/services/normalize'

const rustIncident = {
  type: 'incident',
  seq: 12,
  at: '2026-10-25T04:14:09.350Z',
  incident: {
    incident_id: 'inc-0142',
    display_id: 'INC-0142',
    reported_by_device_id: 'band-03',
    reported_at: '2026-10-25T04:14:09Z',
    status: 'reported',
    source: 'manual_sos',
    radio_status: 'received',
    radio: { gateway_id: 'GW-01', hold_ms: 1650 },
    localization_status: 'estimated',
    location: { x: 31.2, y: 12.9 },
    location_radius_m: 6,
    camera_observations: [],
    timeline: [{ at: 1792901649000, source: 'radio', text: 'Received by gw-01' }],
  },
}

describe('backend event normalisation', () => {
  it('camelises snake_case keys deeply', () => {
    expect(camelizeKeys({ a_b: [{ c_d: 1 }], e: { f_g_h: true } })).toEqual({ aB: [{ cD: 1 }], e: { fGH: true } })
  })

  it('parses a Rust-style incident event into a domain incident', () => {
    const r = parseStreamEvent(rustIncident)
    expect(r.ok).toBe(true)
    if (!r.ok || r.value.type !== 'incident') return
    const inc = r.value.incident
    expect(inc.incidentId).toBe('inc-0142')
    expect(inc.reportedAt).toBe(Date.parse('2026-10-25T04:14:09Z'))
    expect(r.value.at).toBe(Date.parse('2026-10-25T04:14:09.350Z'))
    expect(inc.radio?.holdMs).toBe(1650)
    // defaults fill what an older backend may omit
    expect(inc.guidanceCommandIds).toEqual([])
    expect(inc.isSimulated).toBe(false)
  })

  it('rejects events it does not understand instead of half-applying them', () => {
    expect(parseStreamEvent({ type: 'teleport', seq: 1, at: 0 }).ok).toBe(false)
    expect(parseStreamEvent({ ...rustIncident, incident: { ...rustIncident.incident, status: 'vanished' } }).ok).toBe(false)
    expect(parseStreamEvent({ type: 'heartbeat', seq: -1, at: 0 }).ok).toBe(false)
    const bad = parseStreamEvent({ type: 'device', seq: 3, at: 'not a date', device: {} })
    expect(bad.ok).toBe(false)
  })

  it('maps unknown enum values on devices to unknown rather than guessing', () => {
    const r = parseStreamEvent({
      type: 'device',
      seq: 4,
      at: 0,
      device: { device_id: 'band-07', label: '07', hardware_variant: 'light', connection_status: 'sleeping', current_pattern: 'disco', location_source: 'gps', haptics_supported: false },
    })
    expect(r.ok).toBe(true)
    if (!r.ok || r.value.type !== 'device') return
    expect(r.value.device.connectionStatus).toBe('unknown')
    expect(r.value.device.currentPattern).toBe('unknown')
    expect(r.value.device.locationSource).toBe('unknown')
    expect(r.value.device.location).toBeUndefined()
  })

  it('keeps simulated and observed people in separate frames', () => {
    const frames = framesFromEntities(
      [
        { id: 'a', type: 'simulated_person', x: 1, y: 2, source: 'simulation', observedAt: 0 },
        { id: 'b', type: 'observed_person', x: 3, y: 4, source: 'camera', observedAt: 0 },
        { id: 'c', type: 'physical_band', x: 5, y: 6, source: 'radio', observedAt: 0 },
        { id: 'm', type: 'simulated_person', role: 'responder', x: 7, y: 8, source: 'simulation', observedAt: 0 },
      ],
      9,
      100,
    )
    expect(frames).toHaveLength(2)
    const sim = frames.find((f) => f.source === 'simulation')!
    const cam = frames.find((f) => f.source === 'camera')!
    expect(sim.count).toBe(2)
    expect([...sim.kinds]).toEqual([EntityKind.SimAttendee, EntityKind.SimResponder])
    expect(cam.count).toBe(1)
    expect(cam.kinds[0]).toBe(EntityKind.ObservedPerson)
  })

  it('validates the seeded venue as wire data', () => {
    expect(venueSchema.safeParse(JSON.parse(JSON.stringify(venue))).success).toBe(true)
  })

  it('parses a minimal snapshot and fills defaults', () => {
    const r = parseSnapshot({ timestamp: 0, seq: 0, mode: 'live', venue: JSON.parse(JSON.stringify(venue)) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.devices).toEqual([])
    expect(r.value.incidents).toEqual([])
  })
})
