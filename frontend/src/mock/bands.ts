import type { Device, Vec2 } from '@/contracts/domain'

export interface MockBand {
  deviceId: string
  label: string
  variant: 'full' | 'light'
  wearer: string | null
  /** Where the wearer stands in the simulated venue. Null: the band has no position. */
  anchor: Vec2 | null
}

/**
 * The nine demo bands. All have LEDs and an SOS button; only the three full bands carry the IMU
 * and vibration motor. Judges wear 01-06 at the demo table; 09 sits in the charging case.
 */
export const MOCK_BANDS: MockBand[] = [
  { deviceId: 'band-01', label: '01', variant: 'full', wearer: 'Judge A', anchor: { x: 16, y: 47.5 } },
  { deviceId: 'band-02', label: '02', variant: 'full', wearer: 'Judge B', anchor: { x: 33.5, y: 10.5 } },
  { deviceId: 'band-03', label: '03', variant: 'full', wearer: 'Teammate', anchor: { x: 31.4, y: 12.4 } },
  { deviceId: 'band-04', label: '04', variant: 'light', wearer: 'Judge C', anchor: { x: 12, y: 49 } },
  { deviceId: 'band-05', label: '05', variant: 'light', wearer: 'Judge D', anchor: { x: 24.5, y: 32 } },
  { deviceId: 'band-06', label: '06', variant: 'light', wearer: 'Judge E', anchor: { x: 29, y: 10 } },
  { deviceId: 'band-07', label: '07', variant: 'light', wearer: 'Spare wearer', anchor: { x: 70, y: 28 } },
  { deviceId: 'band-08', label: '08', variant: 'light', wearer: 'Spare wearer', anchor: { x: 68, y: 11 } },
  { deviceId: 'band-09', label: '09', variant: 'light', wearer: null, anchor: null },
]

export function initialDevice(b: MockBand, now: number): Device {
  const offline = b.anchor === null
  return {
    deviceId: b.deviceId,
    label: b.label,
    hardwareVariant: b.variant,
    connectionStatus: offline ? 'disconnected' : 'connected',
    lastSeenAt: offline ? now - 12 * 60_000 : now,
    currentPattern: offline ? 'unknown' : 'ready',
    sosActive: false,
    location: b.anchor ? { ...b.anchor } : undefined,
    locationSource: b.anchor ? 'simulated' : 'unknown',
    hapticsSupported: b.variant === 'full',
    imuSupported: b.variant === 'full',
    pendingCommandIds: [],
    wearerLabel: b.wearer,
  }
}
