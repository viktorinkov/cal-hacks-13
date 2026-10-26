import type { Device, Vec2 } from '@/contracts/domain'
import type { FloorBand } from '@/stdb/floor'
import type { BoothCircle } from './circle'
import { patternOf, rememberHardware, S_SOS } from './demoRing'

/** Where a band sits inside the booth. Missing coordinates stay unplaced. */
export function spotInBooth(band: FloorBand, booth: Pick<BoothCircle, 'x' | 'y' | 'r'>): Vec2 | null {
  if (!band.hasPosition || band.xM == null || band.yM == null) return null
  if (Math.hypot(band.xM, band.yM) <= booth.r) return { x: booth.x + band.xM, y: booth.y + band.yM }
  if (Math.hypot(band.xM - booth.x, band.yM - booth.y) <= booth.r) return { x: band.xM, y: band.yM }
  return null
}

/**
 * SOS and fall open at the band's spot. With no coordinates the incident covers the whole booth,
 * and the band itself stays "position unknown".
 */
export function incidentAt(
  band: FloorBand,
  booth: Pick<BoothCircle, 'x' | 'y' | 'r'>,
): { at: Vec2; radius: number } | null {
  if (!band.sos && !band.fall) return null
  const spot = spotInBooth(band, booth)
  if (spot) return { at: spot, radius: 1.5 }
  return { at: { x: booth.x, y: booth.y }, radius: booth.r }
}

export function deviceFromBand(band: FloorBand, booth: Pick<BoothCircle, 'x' | 'y' | 'r'>): Device {
  const spot = spotInBooth(band, booth)
  return {
    deviceId: `live-${band.id}`,
    label: String(band.id).padStart(2, '0'),
    hardwareVariant: band.hasMpu ? 'full' : 'light',
    connectionStatus: band.online ? 'connected' : 'disconnected',
    lastSeenAt: band.lastSeen,
    currentPattern: patternOf(band),
    sosActive: band.sos || band.state === S_SOS,
    location: spot ?? undefined,
    locationSource: spot ? 'station_estimate' : 'unknown',
    zoneId: spot ? 'GB' : undefined,
    hapticsSupported: band.hasMotor,
    imuSupported: band.hasMpu,
    pendingCommandIds: [],
    wearerLabel: band.wearer,
  }
}

let latest: FloorBand[] = []
let hear: ((bands: FloorBand[]) => void) | null = null

export function liveBands(): FloorBand[] {
  return latest
}

export function liveDevices(booth: Pick<BoothCircle, 'x' | 'y' | 'r'>): Device[] {
  return latest.map((band) => deviceFromBand(band, booth))
}

export function setLiveBands(bands: FloorBand[]): void {
  latest = bands
  rememberHardware(bands)
  hear?.(bands)
}

export function watchLiveBands(fn: (bands: FloorBand[]) => void): void {
  hear = fn
  if (latest.length) fn(latest)
}
