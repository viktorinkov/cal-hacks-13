/**
 * BackendAdapter over the in-browser MockBackend. It behaves like a remote service on purpose:
 * commands resolve after a network-like delay, results are deep copies, and the demo "link down"
 * switch drops events and refuses commands exactly as a dead WebSocket would, then resynchronises.
 */
import type { ConnectionState, EntityFrame, GuidanceCommand, GuidancePreviewRequest, Incident, ResolutionReason, StreamEvent, WorldSnapshot } from '@/contracts/domain'
import { CommandError, MockBackend, type MockBackendOptions } from '@/mock/MockBackend'
import { BackendError, type BackendAdapter, type DemoCapability, type DemoControls, type Unsubscribe } from './BackendAdapter'

export interface MockAdapterOptions extends MockBackendOptions {
  /** 'interval' runs the clock in real time; 'manual' leaves it to the caller (tests). */
  driver?: 'interval' | 'manual'
  /** Simulated network latency for commands, in ms. */
  latencyMs?: number
}

const ALL_CAPS: DemoCapability[] = [
  'triggerCongestion',
  'pressSos',
  'suspectFall',
  'setCameraOutcome',
  'setFlakyRadio',
  'setLinkDown',
  'setPlaying',
  'setSpeed',
  'setAutoplay',
]

export class MockBackendAdapter implements BackendAdapter {
  readonly kind = 'mock' as const
  readonly label = 'Simulation'
  readonly backend: MockBackend
  readonly demo: DemoControls

  private readonly latencyMs: number
  private readonly driver: 'interval' | 'manual'
  private timer: ReturnType<typeof setInterval> | null = null
  private last = 0
  private eventListeners = new Set<(e: StreamEvent) => void>()
  private frameListeners = new Set<(f: EntityFrame) => void>()
  private connListeners = new Set<(s: ConnectionState) => void>()
  private connection: ConnectionState = { phase: 'idle', attempt: 0, lastMessageAt: null, nextRetryAt: null }
  private linkDown = false
  private retryTimer: ReturnType<typeof setInterval> | null = null
  private unsubs: Unsubscribe[] = []

  constructor(opts: MockAdapterOptions = {}) {
    this.backend = new MockBackend(opts)
    this.latencyMs = opts.latencyMs ?? 380
    this.driver = opts.driver ?? 'interval'
    this.demo = this.buildDemo()
  }

  start(): void {
    if (this.unsubs.length) return
    this.unsubs.push(
      this.backend.onEvent((e) => {
        if (this.linkDown) return
        this.connection = { ...this.connection, lastMessageAt: Date.now() }
        this.eventListeners.forEach((l) => l(e))
      }),
      this.backend.onFrame((f) => {
        if (this.linkDown) return
        this.frameListeners.forEach((l) => l(f))
      }),
    )
    this.setConnection({ phase: 'open', attempt: 0 })
    if (this.driver === 'interval') {
      this.last = performance.now()
      this.timer = setInterval(() => {
        const now = performance.now()
        const dt = Math.min(250, now - this.last)
        this.last = now
        this.backend.advance(dt)
      }, 33)
    }
  }

  dispose(): void {
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    if (this.timer) clearInterval(this.timer)
    if (this.retryTimer) clearInterval(this.retryTimer)
    this.timer = this.retryTimer = null
    this.setConnection({ phase: 'closed' })
  }

  /** Manual driver: advance virtual time by exactly `ms`, in 100 ms steps. */
  advance(ms: number): void {
    this.backend.advanceExact(ms)
  }

  async getInitialState(): Promise<WorldSnapshot> {
    await this.delay(this.driver === 'manual' ? 0 : 120)
    this.guardLink()
    return this.backend.snapshot()
  }

  subscribeToEvents(cb: (e: StreamEvent) => void): Unsubscribe {
    this.eventListeners.add(cb)
    return () => this.eventListeners.delete(cb)
  }

  subscribeToFrames(cb: (f: EntityFrame) => void): Unsubscribe {
    this.frameListeners.add(cb)
    return () => this.frameListeners.delete(cb)
  }

  subscribeToConnection(cb: (s: ConnectionState) => void): Unsubscribe {
    this.connListeners.add(cb)
    cb(this.connection)
    return () => this.connListeners.delete(cb)
  }

  acknowledgeIncident(incidentId: string): Promise<Incident> {
    return this.command(() => this.backend.acknowledge(incidentId))
  }

  resolveIncident(incidentId: string, reason: ResolutionReason): Promise<Incident> {
    return this.command(() => this.backend.resolve(incidentId, reason))
  }

  previewGuidance(request: GuidancePreviewRequest): Promise<GuidanceCommand> {
    return this.command(() => this.backend.preview(request))
  }

  approveGuidance(commandId: string): Promise<GuidanceCommand> {
    return this.command(() => this.backend.approve(commandId))
  }

  cancelGuidance(commandId: string): Promise<GuidanceCommand> {
    return this.command(() => this.backend.cancel(commandId))
  }

  resendGuidance(commandId: string): Promise<GuidanceCommand> {
    return this.command(() => this.backend.resend(commandId))
  }

  resetSimulation(): Promise<void> {
    return this.command(() => this.backend.reset(true))
  }

  // ------------------------------------------------------------------ internals

  private async command<T>(fn: () => T): Promise<T> {
    this.guardLink()
    await this.delay(this.latencyMs)
    this.guardLink()
    try {
      return fn()
    } catch (err) {
      if (err instanceof CommandError) throw new BackendError(err.code, err.message, err.code === 'not_found' ? 404 : 409)
      throw err
    }
  }

  private guardLink(): void {
    if (this.linkDown) throw new BackendError('network', 'Could not reach the backend')
  }

  private delay(ms: number): Promise<void> {
    return ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms))
  }

  private setConnection(patch: Partial<ConnectionState>): void {
    this.connection = { ...this.connection, ...patch }
    this.connListeners.forEach((l) => l(this.connection))
  }

  private setLinkDown(on: boolean): void {
    if (on === this.linkDown) return
    this.linkDown = on
    this.backend.setLinkDown(on)
    if (on) {
      this.setConnection({ phase: 'reconnecting', attempt: 1, error: 'Connection to backend lost (simulated)', nextRetryAt: Date.now() + 1500 })
      this.retryTimer = setInterval(() => {
        this.setConnection({ attempt: this.connection.attempt + 1, nextRetryAt: Date.now() + 1500 })
      }, 1500)
    } else {
      if (this.retryTimer) clearInterval(this.retryTimer)
      this.retryTimer = null
      // the sync layer reloads the snapshot when the connection opens again
      this.setConnection({ phase: 'open', attempt: 0, error: undefined, nextRetryAt: null })
    }
  }

  private buildDemo(): DemoControls {
    const b = this.backend
    // presentation controls act on the simulated venue, which keeps running during an outage
    const run = (fn: () => void) => async () => {
      fn()
    }
    return {
      capabilities: new Set(ALL_CAPS),
      triggerCongestion: run(() => b.triggerCongestion()),
      pressSos: (deviceId?: string) => run(() => void b.pressSos(deviceId))(),
      suspectFall: (deviceId?: string) => run(() => void b.suspectFall(deviceId))(),
      setCameraOutcome: (o) => run(() => b.setCameraOutcome(o))(),
      setFlakyRadio: (on) => run(() => b.setFlakyRadio(on))(),
      setLinkDown: async (on) => this.setLinkDown(on),
      setPlaying: (on) => run(() => b.setPlaying(on))(),
      setSpeed: (s) => run(() => b.setSpeed(s))(),
      setAutoplay: (on) => run(() => b.setAutoplay(on))(),
    }
  }
}
