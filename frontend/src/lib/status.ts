/**
 * Plain-language status derived from domain state. Kept pure so the wording can be tested, and so
 * every screen says the same thing about the same fact.
 */
import type {
  CameraObservation,
  ConnectionState,
  CongestionStatus,
  Device,
  GuidanceCommand,
  Incident,
  LedPattern,
  SectionKind,
  SimulatedBands,
  ZoneState,
} from '@/contracts/domain'
import { bandName } from './format'

/** The simulated crowd's bands for this command, if the scenario reports them (simulation only). */
export function simBandsFor(sim: SimulatedBands | undefined, commandId: string | undefined): SimulatedBands | null {
  return sim && commandId && sim.commandId === commandId ? sim : null
}

export type Tone = 'neutral' | 'ok' | 'caution' | 'critical' | 'help' | 'muted' | 'sim'

// ---------------------------------------------------------------- data sources

export type SourceTag = 'sim' | 'live' | 'camera' | 'estimate' | 'forecast' | 'radio' | 'manual' | 'unknown'

export function zoneSourceTag(z: ZoneState | undefined): SourceTag {
  if (!z) return 'unknown'
  switch (z.source) {
    case 'simulation':
      return 'sim'
    case 'camera':
      return 'camera'
    case 'estimated':
      return 'estimate'
    case 'forecast':
      return 'forecast'
  }
}

export const sourceTagText: Record<SourceTag, string> = {
  sim: 'sim',
  live: 'live',
  camera: 'camera',
  estimate: 'estimate',
  forecast: 'forecast',
  radio: 'radio',
  manual: 'manual',
  unknown: 'no data',
}

export function locationSourceText(d: Device): string {
  switch (d.locationSource) {
    case 'camera':
      return 'seen by camera'
    case 'station_estimate':
      return d.locationRadiusM ? `estimated ±${Math.round(d.locationRadiusM)} m` : 'estimated from anchors'
    case 'manually_assigned':
      return 'placed by staff'
    case 'simulated':
      return 'simulated position'
    case 'unknown':
      return 'position unknown'
  }
}

// ---------------------------------------------------------------- freshness

export type Freshness = 'current' | 'delayed' | 'stale'

export function freshness(updatedAt: number | null | undefined, now: number, delayedMs = 3000, staleMs = 10000): Freshness {
  if (updatedAt === null || updatedAt === undefined) return 'stale'
  const age = now - updatedAt
  if (age > staleMs) return 'stale'
  if (age > delayedMs) return 'delayed'
  return 'current'
}

/** A zone's status as it should be shown: stale data is never shown as current, unknown never as safe. */
export function displayCongestion(z: ZoneState | undefined, now: number, linkUp: boolean): CongestionStatus | 'stale' {
  if (!z) return 'unknown'
  if (!linkUp || freshness(z.updatedAt, now, 3000, 8000) === 'stale' || z.dataQuality === 'stale') return 'stale'
  if (z.dataQuality === 'missing') return 'unknown'
  return z.congestionStatus
}

export const congestionText: Record<CongestionStatus | 'stale', string> = {
  normal: 'Normal',
  caution: 'Caution',
  critical: 'Critical',
  unknown: 'No data',
  stale: 'Stale',
}

export const congestionTone: Record<CongestionStatus | 'stale', Tone> = {
  normal: 'ok',
  caution: 'caution',
  critical: 'critical',
  unknown: 'muted',
  stale: 'muted',
}

// ---------------------------------------------------------------- bands

export const patternText: Record<LedPattern, string> = {
  ready: 'Ready',
  sos: 'SOS',
  steady_red: 'Steady red',
  step_aside: 'Step aside',
  help_coming: 'Help is coming',
  off: 'Off',
  unknown: 'Unknown',
}

export interface BandStatus {
  text: string
  tone: Tone
  /** The pattern to draw: what the band reports, or what it will show once it confirms. */
  pattern: LedPattern
  pending: boolean
  failed: boolean
}

/**
 * What a band is doing. The band's own report is the truth; a command in flight is shown as
 * pending, never as done, and a band without vibration never shows a buzz.
 */
export function bandStatus(d: Device, commands: GuidanceCommand[], now: number): BandStatus {
  if (d.connectionStatus === 'disconnected') {
    return { text: d.wearerLabel ? 'Offline' : 'Unworn', tone: 'muted', pattern: 'unknown', pending: false, failed: false }
  }
  const delayed = d.connectionStatus === 'delayed' || freshness(d.lastSeenAt, now, 8000, 30000) !== 'current'
  const preview = commands.find((c) => c.approvalStatus === 'pending_approval' && c.targetDeviceIds.includes(d.deviceId))
  const active = commands.find((c) => c.approvalStatus === 'approved' && c.targetDeviceIds.includes(d.deviceId))
  const target = active?.targets.find((t) => t.deviceId === d.deviceId)
  if (d.sosActive) return { text: 'SOS pressed', tone: 'critical', pattern: 'sos', pending: false, failed: false }
  if (target?.status === 'failed') {
    return { text: `No confirmation · ${patternText[target.patternCode].toLowerCase()} not shown`, tone: 'critical', pattern: d.currentPattern, pending: false, failed: true }
  }
  if (target?.status === 'sent' || target?.status === 'pending') {
    return { text: `Sending ${patternText[target.patternCode].toLowerCase()}…`, tone: 'caution', pattern: d.currentPattern, pending: true, failed: false }
  }
  if (preview) {
    const t = preview.targets.find((x) => x.deviceId === d.deviceId)
    if (t) return { text: `${patternText[t.patternCode]} on approval`, tone: 'neutral', pattern: t.patternCode, pending: true, failed: false }
  }
  const buzz = d.currentPattern === 'step_aside' && d.hapticsSupported && target?.haptic ? ', buzzed' : ''
  const text = `${patternText[d.currentPattern]}${buzz}${delayed ? ' · last heard late' : ''}`
  const tone: Tone =
    d.currentPattern === 'steady_red' ? 'critical' : d.currentPattern === 'step_aside' ? 'caution' : d.currentPattern === 'help_coming' ? 'help' : delayed ? 'muted' : 'neutral'
  return { text, tone, pattern: d.currentPattern, pending: false, failed: false }
}

// ---------------------------------------------------------------- incidents

export function incidentTitle(i: Incident): string {
  switch (i.source) {
    case 'manual_sos':
      return 'SOS pressed'
    case 'imu_suspicion':
      return 'Possible fall'
    case 'camera_suspicion':
      return 'Camera flagged someone'
    case 'staff':
      return 'Reported by staff'
  }
}

export const incidentStatusText: Record<Incident['status'], string> = {
  reported: 'Needs a person',
  acknowledged: 'Acknowledged',
  responding: 'Responding',
  resolved: 'Resolved',
}

export function localizationText(i: Incident): string {
  switch (i.localizationStatus) {
    case 'visually_confirmed':
      return 'Seen by camera'
    case 'estimated':
      return i.locationRadiusM ? `Radio estimate ±${Math.round(i.locationRadiusM)} m` : 'Radio estimate'
    case 'unknown':
      return 'Location unknown'
  }
}

export function observationText(o: CameraObservation | undefined): { title: string; detail: string; tone: Tone } {
  if (!o) return { title: 'No camera check', detail: 'No camera covers this spot.', tone: 'muted' }
  const pct = o.confidence !== undefined ? ` (${o.confidence.toFixed(2)})` : ''
  switch (o.status) {
    case 'pending':
      return { title: `${o.cameraId} is looking`, detail: o.kind === 'sos_flash' ? 'Searching for the SOS flash pattern.' : 'Checking posture in the frame.', tone: 'neutral' }
    case 'detected':
      return {
        title: o.kind === 'sos_flash' ? `Flash pattern matched${pct}` : `Fall-like pose${pct}`,
        detail:
          o.kind === 'sos_flash'
            ? 'The camera saw an SOS flash where the radio placed it. That locates a band, not a person’s identity.'
            : 'Crouching or dancing can look like this. Check the frame.',
        tone: o.kind === 'sos_flash' ? 'ok' : 'caution',
      }
    case 'ambiguous':
      return { title: `Not matched${pct}`, detail: 'More than one flashing source in view. The location stays a radio estimate.', tone: 'caution' }
    case 'not_visible':
      return { title: `Not in ${o.cameraId}'s view`, detail: 'The location stays a radio estimate. The SOS still stands.', tone: 'muted' }
  }
}

// ---------------------------------------------------------------- headline

export interface Headline {
  title: string
  sentence: string
  tone: Tone
}

/**
 * The one sentence the screen leads with: does anyone need help, and is it reaching them?
 */
export function headline(args: {
  incidents: Incident[]
  commands: GuidanceCommand[]
  zones: ZoneState[]
  zoneNames: Record<string, string>
  zoneSections: Record<string, SectionKind>
  people: number
  simulated: boolean
  connection: ConnectionState
  linkUp: boolean
  lastDataAt: string
  now: number
  /** Bands the simulated crowd wears, when the scenario reports them. */
  simulatedBands?: SimulatedBands
  /** CalHacks hardware lights its neighbours in firmware, without an approval step. */
  venueId?: string
}): Headline {
  const { incidents, commands, zones, zoneNames } = args
  if (!args.linkUp && args.connection.phase !== 'idle') {
    return {
      title: 'Connection lost.',
      sentence: `Showing what we had at ${args.lastDataAt}. It is not live. Reconnecting.`,
      tone: 'muted',
    }
  }
  const open = incidents.filter((i) => i.status !== 'resolved').sort((a, b) => a.reportedAt - b.reportedAt)
  const first = open[0]
  if (first) {
    const where = first.candidateZone ? zoneNames[first.candidateZone] ?? first.candidateZone : 'an unknown spot'
    const who = first.reportedByDeviceId ? bandName(first.reportedByDeviceId.replace('band-', '')) : 'staff'
    const more = open.length > 1 ? ` ${open.length - 1} more open.` : ''
    if (first.status === 'reported') {
      return {
        title: first.source === 'manual_sos' ? 'Someone pressed SOS.' : first.source === 'imu_suspicion' ? 'Someone may have fallen.' : 'Someone may need help.',
        sentence:
          args.venueId === 'calhacks'
            ? `${where}, ${who}. Nearby wristbands are already red.${more}`
            : `${where}, ${who}. Nothing changes on the bands until you approve.${more}`,
        tone: 'critical',
      }
    }
    const active = commands.find((c) => c.incidentId === first.incidentId && c.approvalStatus === 'approved')
    if (first.status === 'responding' && active?.commandId === 'demo-path' && args.venueId === 'calhacks') {
      return {
        title: 'A path is open.',
        sentence: `A yellow path is clearing from the entrance to ${where}. People along it are stepping aside.${more}`,
        tone: 'help',
      }
    }
    if (first.status === 'responding' && active) {
      const confirmed = active.acknowledgedDevices.length
      const total = active.targets.length
      const crowd = simBandsFor(args.simulatedBands, active.commandId)
      return {
        title: 'A path is open.',
        sentence: crowd
          ? `First Aid is on the way to ${where}. ${crowd.signalled} crowd bands told to move (simulated); ${confirmed} of ${total} demo bands confirmed.${more}`
          : `First Aid is on the way to ${where}. ${confirmed} of ${total} bands confirmed their signals.${more}`,
        tone: 'help',
      }
    }
    if (first.status === 'responding') {
      return { title: 'Help is on the way.', sentence: `First Aid is heading to ${where}. The bands are back to ready.${more}`, tone: 'help' }
    }
    if (args.venueId === 'calhacks') {
      return {
        title: 'You are on it.',
        sentence: `Open the path from the entrance to ${where} when you are ready. Nothing is sent to the wristbands.${more}`,
        tone: 'caution',
      }
    }
    return {
      title: 'You are on it.',
      sentence: `Review the path for First Aid to ${where}, then send it to the bands.${more}`,
      tone: 'caution',
    }
  }
  const critical = zones.filter((z) => z.congestionStatus === 'critical')
  const caution = zones.filter((z) => z.congestionStatus === 'caution')
  const sim = args.simulated ? ' (simulated)' : ''
  if (critical.length || caution.length) {
    const z = (critical[0] ?? caution[0])!
    const name = zoneNames[z.zoneId] ?? z.zoneId
    return {
      title: critical.length ? `${name} is packed.` : `Getting tight at ${name}.`,
      sentence: `Peak ${z.peakDensity?.toFixed(1) ?? '—'} people per m²${sim}, above the venue's ${critical.length ? 'critical' : 'caution'} line.`,
      tone: critical.length ? 'critical' : 'caution',
    }
  }
  const recent = incidents.filter((i) => i.status === 'resolved').sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))[0]
  if (recent && recent.resolvedAt && args.now - recent.resolvedAt < 25_000) {
    // the latest resolution leads for a short while after the fact
    return { title: 'Resolved.', sentence: `${recent.displayId} closed. Every band is back to ready.`, tone: 'ok' }
  }
  return {
    title: 'All quiet.',
    sentence: '',
    tone: 'ok',
  }
}
