/**
 * Wires one backend adapter to the stores. Exactly one runtime is active per session; starting a
 * new one stops the previous one, which keeps React Strict Mode's double effects harmless.
 */
import { create } from 'zustand'
import type { AppConfig } from '@/app/config'
import { useBooth } from '@/booth/circle'
import { incidentAt, liveBands, liveDevices, watchLiveBands } from '@/booth/place'
import type { StreamEvent } from '@/contracts/domain'
import { resetServerTime, observeServerTime, setClockRate } from '@/stores/clock'
import { useConnection } from '@/stores/connection'
import { baselineFrames, frames } from '@/stores/frames'
import { useWorld } from '@/stores/world'
import type { BackendAdapter } from './BackendAdapter'
import { LiveBackendAdapter } from './LiveBackendAdapter'
import { MockBackendAdapter } from './MockBackendAdapter'
import { MOCK_BANDS } from '@/mock/bands'
import { mapController } from '@/map/controller'
import { currentPlan, useVenuePlan, type VenuePlan } from '@/map/venuePlan'
import { stopCalhacksCrowd } from '@/mock/calhacksCrowd'
import { isFloorLive, presentCalhacks } from '@/stdb/floor'
import { useSession } from '@/stdb/session'
import { StreamSync, type SyncOptions } from './sync'

interface Runtime {
  adapter: BackendAdapter
  sync: StreamSync
}

let current: Runtime | null = null
let stopBoothWatch: (() => void) | null = null
let boothStamp = ''
const mockBandIds = new Set(MOCK_BANDS.map((band) => band.deviceId))

function spacetimeUp(): boolean {
  return useSession.getState().phase === 'live'
}

function mockBackend(): MockBackendAdapter['backend'] | null {
  const adapter = getAdapter()
  if (adapter?.kind !== 'mock') return null
  return (adapter as MockBackendAdapter).backend
}

function applyBoothToSim(): void {
  const backend = mockBackend()
  if (!backend) return
  if (currentPlan() !== 'simulation') {
    backend.setBooth(null)
    return
  }
  const circle = useBooth.getState()
  backend.setBooth(circle)
}

function openLiveIncidents(): void {
  const backend = mockBackend()
  if (!backend || currentPlan() !== 'simulation' || !spacetimeUp()) return
  const circle = useBooth.getState()
  for (const band of liveBands()) {
    const place = incidentAt(band, circle)
    if (!place) continue
    backend.reportLive({
      deviceId: `live-${band.id}`,
      label: String(band.id).padStart(2, '0'),
      at: place.at,
      radius: place.radius,
      kind: band.fall && !band.sos ? 'fall' : 'sos',
    })
  }
}

/** On the concert map, live bands replace the demo wristbands while SpacetimeDB is up. */
function stampLiveBooth(): void {
  if (currentPlan() !== 'simulation') {
    boothStamp = ''
    return
  }
  const world = useWorld.getState()
  if (world.venue?.venueId !== 'main-stage') return
  const up = spacetimeUp()
  const phase = useSession.getState().phase
  const circle = useBooth.getState()
  const mockPresent = [...mockBandIds].some((id) => world.devices[id])
  const key = `${up}|${phase}|${mockPresent}|${circle.x.toFixed(2)},${circle.y.toFixed(2)},${circle.r.toFixed(2)}|${liveBands()
    .map((band) => `${band.id}:${band.sos}:${band.fall}:${band.online}:${band.xM}:${band.yM}`)
    .join(',')}`
  if (key === boothStamp && world.sources.spacetimedb) return
  boothStamp = key
  const devices = { ...world.devices }
  const live = liveDevices(circle)
  if (up) {
    for (const id of mockBandIds) delete devices[id]
    for (const device of live) devices[device.deviceId] = device
  }
  const inside = live.filter((device) => device.location).length
  useWorld.setState({
    devices,
    mode: up ? 'hybrid' : 'simulation',
    sources: {
      ...world.sources,
      spacetimedb: {
        sourceId: 'spacetimedb',
        kind: 'backend',
        label: 'SpacetimeDB',
        status: up ? 'ok' : phase === 'connecting' ? 'unknown' : 'down',
        lastUpdateAt: up ? Date.now() : (world.sources.spacetimedb?.lastUpdateAt ?? null),
        isSimulated: false,
        detail: up
          ? `${inside} of ${live.length} live bands in the booth`
          : phase === 'error'
            ? 'Connection lost'
            : 'Connecting',
      },
    },
  })
}

function hideMockBands(batch: StreamEvent[]): StreamEvent[] {
  if (currentPlan() !== 'simulation' || !spacetimeUp()) return batch
  return batch.filter((event) => event.type !== 'device' || !mockBandIds.has(event.device.deviceId))
}

function bindBooth(): void {
  stopBoothWatch?.()
  const unBooth = useBooth.subscribe(() => {
    applyBoothToSim()
    stampLiveBooth()
  })
  const unSession = useSession.subscribe((state, prev) => {
    if (state.phase !== prev.phase) stampLiveBooth()
  })
  watchLiveBands(() => {
    applyBoothToSim()
    openLiveIncidents()
    stampLiveBooth()
  })
  stopBoothWatch = () => {
    unBooth()
    unSession()
  }
}

/** The active adapter, for components that must re-render when the runtime starts or stops. */
export const useRuntime = create<{ adapter: BackendAdapter | null }>()(() => ({ adapter: null }))

export function createAdapter(config: AppConfig): BackendAdapter {
  if (config.mode === 'live') {
    return new LiveBackendAdapter({
      apiBaseUrl: config.apiBaseUrl,
      wsUrl: config.wsUrl,
      localCrowd: config.localCrowd,
      demoService: config.demoService,
    })
  }
  return new MockBackendAdapter()
}

export function startRuntime(adapter: BackendAdapter, opts?: SyncOptions): Runtime {
  stopRuntime()
  const world = useWorld.getState()
  const conn = useConnection.getState()
  world.clear()
  frames.clear()
  baselineFrames.clear()
  const sync = new StreamSync(
    adapter,
    {
      snapshot: (s) => {
        if (isFloorLive()) {
          if (useWorld.getState().venue?.venueId !== 'calhacks') presentCalhacks()
          return
        }
        frames.clear()
        baselineFrames.clear()
        resetServerTime(s.timestamp)
        if (s.scenario) setClockRate(s.scenario.playing ? s.scenario.speed : 0)
        useWorld.getState().applySnapshot(s)
        stampLiveBooth()
        conn.touch()
      },
      events: (batch) => {
        if (isFloorLive()) return
        batch = hideMockBands(batch)
        let latest = 0
        for (const e of batch) {
          if (e.at > latest) latest = e.at
          if (e.type === 'scenario') setClockRate(e.scenario.playing ? e.scenario.speed : 0)
        }
        if (latest) observeServerTime(latest)
        useWorld.getState().applyEvents(batch)
        stampLiveBooth()
        useConnection.getState().touch()
      },
      frame: (f) => {
        if (isFloorLive()) return
        frames.push({ ...f, baseline: undefined })
        if (f.baseline) {
          baselineFrames.push({
            seq: f.seq,
            t: f.t,
            source: 'simulation',
            count: f.baseline.count,
            positions: f.baseline.positions,
            velocities: new Float32Array(0),
            kinds: new Uint8Array(f.baseline.count),
          })
        } else if (baselineFrames.latest()) {
          baselineFrames.clear()
        }
      },
      connection: (c) => {
        if (isFloorLive()) return
        useConnection.getState().setConnection(c)
      },
      phase: (p, error) => {
        if (isFloorLive()) return
        useConnection.getState().setSync(p, error ?? null)
      },
    },
    opts,
  )
  current = { adapter, sync }
  useRuntime.setState({ adapter })
  bindBooth()
  sync.start()
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    // debugging and end-to-end hooks; not shipped in production builds
    ;(window as unknown as { __bandit?: unknown }).__bandit = {
      adapter,
      sync,
      world: useWorld,
      connection: useConnection,
      session: useSession,
      booth: useBooth,
      liveBands,
      map: mapController,
    }
  }
  return current
}

export function stopRuntime(): void {
  stopBoothWatch?.()
  stopBoothWatch = null
  if (!current) return
  current.sync.stop()
  current = null
  useRuntime.setState({ adapter: null })
}

export function getAdapter(): BackendAdapter | null {
  return current?.adapter ?? null
}

export function getSync(): StreamSync | null {
  return current?.sync ?? null
}

/** Switches the map between the CalHacks plan and the in-browser concert. */
export function selectVenuePlan(plan: VenuePlan): void {
  if (currentPlan() === plan && useWorld.getState().venue) {
    useVenuePlan.setState({ plan })
    return
  }
  useVenuePlan.setState({ plan })
  if (plan === 'calhacks') {
    presentCalhacks()
    return
  }
  stopCalhacksCrowd()
  const adapter = getAdapter()
  if (adapter?.kind === 'mock') {
    const snap = (adapter as MockBackendAdapter).backend.snapshot()
    frames.clear()
    baselineFrames.clear()
    useWorld.getState().applySnapshot(snap)
    applyBoothToSim()
    stampLiveBooth()
    const at = Date.now()
    useConnection.getState().setConnection({ phase: 'open', attempt: 0, lastMessageAt: at, nextRetryAt: null })
    useConnection.getState().setSync('live')
    useConnection.getState().touch()
  }
}
