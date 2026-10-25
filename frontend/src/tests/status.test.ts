import { describe, expect, it } from 'vitest'
import type { Device, GuidanceCommand, Incident, ZoneState } from '@/contracts/domain'
import { bandStatus, displayCongestion, freshness, headline, observationText, zoneSourceTag } from '@/lib/status'

const now = 1_000_000

function band(over: Partial<Device> = {}): Device {
  return {
    deviceId: 'band-04',
    label: '04',
    hardwareVariant: 'light',
    connectionStatus: 'connected',
    lastSeenAt: now,
    currentPattern: 'ready',
    sosActive: false,
    locationSource: 'simulated',
    location: { x: 1, y: 1 },
    hapticsSupported: false,
    imuSupported: false,
    pendingCommandIds: [],
    wearerLabel: 'Judge C',
    ...over,
  }
}

function command(status: GuidanceCommand['targets'][number]['status'], approval: GuidanceCommand['approvalStatus'] = 'approved', haptic = true): GuidanceCommand {
  return {
    commandId: 'cmd-1',
    incidentId: 'inc-1',
    corridorId: 'COR-FL-W',
    targetZoneIds: [],
    targetDeviceIds: ['band-04'],
    targets: [{ deviceId: 'band-04', patternCode: 'step_aside', haptic, status, attempts: 1 }],
    patternCode: 'step_aside',
    reason: '',
    preview: { corridorId: 'COR-FL-W', corridorName: 'x', lengthM: 50, groups: [], advisoryCode: 'A', alternativeCorridorIds: [] },
    approvalStatus: approval,
    createdAt: now,
    expiresAt: now + 90_000,
    deliveryStatus: 'sending',
    acknowledgedDevices: [],
    failedDevices: [],
    isSimulated: true,
  }
}

describe('device command status', () => {
  it('shows a command in flight as pending, not done', () => {
    const s = bandStatus(band(), [command('sent')], now)
    expect(s.pending).toBe(true)
    expect(s.text).toMatch(/^Sending/)
    expect(s.pattern).toBe('ready') // still what the band reports
  })

  it('keeps a failed delivery visibly failed', () => {
    const s = bandStatus(band(), [command('failed')], now)
    expect(s.failed).toBe(true)
    expect(s.tone).toBe('critical')
    expect(s.text).toMatch(/No confirmation/)
  })

  it('never claims a buzz on a lite band', () => {
    const s = bandStatus(band({ currentPattern: 'step_aside' }), [command('acknowledged')], now)
    expect(s.text).toBe('Step aside')
  })

  it('reports a buzz only for a full band that confirmed a haptic pattern', () => {
    const full = band({ hardwareVariant: 'full', hapticsSupported: true, currentPattern: 'step_aside' })
    expect(bandStatus(full, [command('acknowledged')], now).text).toBe('Step aside, buzzed')
  })

  it('shows previews as what will happen on approval', () => {
    expect(bandStatus(band(), [command('pending', 'pending_approval')], now).text).toBe('Step aside on approval')
  })

  it('labels offline bands without inventing a state', () => {
    const s = bandStatus(band({ connectionStatus: 'disconnected', wearerLabel: null }), [], now)
    expect(s.text).toBe('Unworn')
    expect(s.pattern).toBe('unknown')
  })
})

describe('stale and unknown data', () => {
  const zone: ZoneState = {
    zoneId: 'FL',
    timestamp: now,
    congestionStatus: 'normal',
    source: 'simulation',
    dataQuality: 'good',
    updatedAt: now,
  }

  it('grades freshness by age', () => {
    expect(freshness(now - 500, now)).toBe('current')
    expect(freshness(now - 5000, now)).toBe('delayed')
    expect(freshness(now - 20000, now)).toBe('stale')
    expect(freshness(null, now)).toBe('stale')
  })

  it('never shows a zone as current when the link is down', () => {
    expect(displayCongestion(zone, now, true)).toBe('normal')
    expect(displayCongestion(zone, now, false)).toBe('stale')
  })

  it('never shows old zone data as current', () => {
    expect(displayCongestion({ ...zone, updatedAt: now - 60_000 }, now, true)).toBe('stale')
  })

  it('treats missing zones as unknown, not safe', () => {
    expect(displayCongestion(undefined, now, true)).toBe('unknown')
    expect(displayCongestion({ ...zone, dataQuality: 'missing' }, now, true)).toBe('unknown')
  })

  it('labels simulated zone data as simulated', () => {
    expect(zoneSourceTag(zone)).toBe('sim')
    expect(zoneSourceTag({ ...zone, source: 'camera' })).toBe('camera')
    expect(zoneSourceTag(undefined)).toBe('unknown')
  })
})

describe('camera evidence wording', () => {
  it('does not equate a flash match with an identity', () => {
    const t = observationText({ detectionId: 'd', cameraId: 'CAM-01', timestamp: 0, kind: 'sos_flash', status: 'detected', confidence: 0.92, isSimulated: true })
    expect(t.detail).toMatch(/not a person’s identity/)
  })

  it('keeps the SOS standing when the camera cannot see it', () => {
    const t = observationText({ detectionId: 'd', cameraId: 'CAM-01', timestamp: 0, kind: 'sos_flash', status: 'not_visible', isSimulated: true })
    expect(t.detail).toMatch(/SOS still stands/)
  })
})

describe('headline', () => {
  const base = {
    commands: [],
    zones: [],
    zoneNames: { FL: 'Front Left' },
    zoneSections: {},
    people: 1800,
    simulated: true,
    connection: { phase: 'open' as const, attempt: 0, lastMessageAt: null, nextRetryAt: null },
    linkUp: true,
    lastDataAt: '21:14:00',
    now,
  }
  const inc: Incident = {
    incidentId: 'inc-1',
    displayId: 'INC-0142',
    reportedByDeviceId: 'band-03',
    reportedAt: now,
    status: 'reported',
    source: 'manual_sos',
    radioStatus: 'received',
    candidateZone: 'FL',
    localizationStatus: 'estimated',
    cameraObservations: [],
    timeline: [],
    guidanceCommandIds: [],
    isSimulated: true,
  }

  it('leads with the SOS and says nothing changes until approval', () => {
    const h = headline({ ...base, incidents: [inc] })
    expect(h.title).toBe('Someone pressed SOS')
    expect(h.sentence).toMatch(/Front Left, band-03/)
    expect(h.sentence).toMatch(/until you approve/)
  })

  it('says plainly when the data is not live', () => {
    const h = headline({ ...base, incidents: [inc], linkUp: false, connection: { ...base.connection, phase: 'reconnecting' } })
    expect(h.title).toBe('Connection lost')
    expect(h.sentence).toMatch(/not live/)
  })

  it('labels simulated head counts', () => {
    expect(headline({ ...base, incidents: [] }).sentence).toMatch(/simulated/)
  })
})
