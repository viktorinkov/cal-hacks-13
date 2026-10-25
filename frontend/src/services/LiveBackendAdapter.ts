/**
 * Talks to the Rust backend over HTTP (commands, initial state) and one WebSocket (events).
 * Routes are provisional and live in routes.ts. Payloads are validated in normalize.ts; anything
 * that fails validation is dropped and counted, never half-applied.
 */
import type { ConnectionState, EntityFrame, GuidanceCommand, Incident, StreamEvent, WorldSnapshot } from '@/contracts/domain'
import { BackendError, type BackendAdapter, type DemoCapability, type DemoControls, type Unsubscribe } from './BackendAdapter'
import { createHttp } from './http'
import { LocalCrowdSource } from './LocalCrowdSource'
import { framesFromEntities, parseGuidance, parseIncident, parseSnapshot, parseStreamEvent } from './normalize'
import { ReconnectingSocket } from './ReconnectingSocket'
import { routes } from './routes'

export interface LiveAdapterOptions {
  apiBaseUrl: string
  wsUrl: string
  /** Run the in-browser crowd until the backend streams entities. */
  localCrowd: boolean
  /** The backend exposes the presentation endpoints under /v1. */
  demoService: boolean
  fetchImpl?: typeof fetch
  createSocket?: (url: string) => WebSocket
}

export class LiveBackendAdapter implements BackendAdapter {
  readonly kind = 'live' as const
  readonly label: string
  readonly demo: DemoControls | null
  /** Payloads rejected by validation since start, for the diagnostics readout. */
  rejected = 0
  lastRejection: string | null = null

  private readonly http: ReturnType<typeof createHttp>
  private readonly socket: ReconnectingSocket
  private readonly opts: LiveAdapterOptions
  private eventListeners = new Set<(e: StreamEvent) => void>()
  private frameListeners = new Set<(f: EntityFrame) => void>()
  private crowd: LocalCrowdSource | null = null
  private unsubs: Unsubscribe[] = []

  constructor(opts: LiveAdapterOptions) {
    this.opts = opts
    this.label = opts.localCrowd ? 'Live backend · local crowd' : 'Live backend'
    this.http = createHttp({ baseUrl: opts.apiBaseUrl, fetchImpl: opts.fetchImpl })
    this.socket = new ReconnectingSocket({ url: opts.wsUrl, createSocket: opts.createSocket })
    this.demo = this.buildDemo()
  }

  start(): void {
    this.unsubs.push(
      this.socket.onMessage((raw) => this.handleMessage(raw)),
    )
    this.socket.start()
  }

  dispose(): void {
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    this.socket.stop()
    this.crowd?.stop()
  }

  async getInitialState(): Promise<WorldSnapshot> {
    const raw = await this.http.get(routes.state)
    const parsed = parseSnapshot(raw)
    if (!parsed.ok) throw new BackendError('bad_snapshot', `Snapshot failed validation: ${parsed.error}`)
    const snap = parsed.value
    if (this.opts.localCrowd && !this.crowd) {
      this.crowd = new LocalCrowdSource(snap.venue)
      this.crowd.onFrame((f) => this.frameListeners.forEach((l) => l(f)))
      this.crowd.onZones((zones) => {
        // unsequenced local data (seq 0): applied without affecting backend ordering
        const event: StreamEvent = { type: 'zones', seq: 0, at: Date.now(), zones }
        this.eventListeners.forEach((l) => l(event))
      })
      this.crowd.start()
    }
    if (this.crowd) return { ...snap, mode: 'hybrid' }
    return snap
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
    return this.socket.onState(cb)
  }

  /** Fires after each reconnect so the sync layer can reload the snapshot. */
  onReconnected(cb: () => void): Unsubscribe {
    return this.socket.onOpen(cb)
  }

  async acknowledgeIncident(incidentId: string): Promise<Incident> {
    return this.incident(await this.http.post(routes.acknowledge(incidentId)))
  }

  async resolveIncident(incidentId: string, reason: string): Promise<Incident> {
    return this.incident(await this.http.post(routes.resolve(incidentId), { reason }))
  }

  async previewGuidance(request: { incidentId: string; corridorId?: string }): Promise<GuidanceCommand> {
    return this.guidance(await this.http.post(routes.previewGuidance, request))
  }

  async approveGuidance(commandId: string): Promise<GuidanceCommand> {
    return this.guidance(await this.http.post(routes.approveGuidance(commandId)))
  }

  async cancelGuidance(commandId: string): Promise<GuidanceCommand> {
    return this.guidance(await this.http.post(routes.cancelGuidance(commandId)))
  }

  async resendGuidance(commandId: string): Promise<GuidanceCommand> {
    return this.guidance(await this.http.post(routes.resendGuidance(commandId)))
  }

  async resetSimulation(): Promise<void> {
    if (!this.opts.demoService) throw new BackendError('unavailable', 'This backend has no scripted-run service')
    await this.http.post(routes.demo('reset'))
  }

  // ------------------------------------------------------------------ internals

  private handleMessage(raw: string): void {
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      this.reject('not JSON')
      return
    }
    const parsed = parseStreamEvent(json)
    if (!parsed.ok) {
      this.reject(parsed.error)
      return
    }
    const event = parsed.value
    this.crowd?.observe(event)
    if (event.type === 'entities') {
      for (const f of framesFromEntities(event.entities, event.seq, event.at)) this.frameListeners.forEach((l) => l(f))
    }
    this.eventListeners.forEach((l) => l(event))
  }

  private reject(reason: string): void {
    this.rejected += 1
    this.lastRejection = reason
    if (import.meta.env.DEV) console.warn('[bandit] dropped stream message:', reason)
  }

  private incident(raw: unknown): Incident {
    const parsed = parseIncident(raw)
    if (!parsed.ok) throw new BackendError('bad_response', `Incident failed validation: ${parsed.error}`)
    return parsed.value
  }

  private guidance(raw: unknown): GuidanceCommand {
    const parsed = parseGuidance(raw)
    if (!parsed.ok) throw new BackendError('bad_response', `Guidance failed validation: ${parsed.error}`)
    return parsed.value
  }

  private buildDemo(): DemoControls | null {
    const caps = new Set<DemoCapability>()
    if (this.opts.localCrowd) caps.add('triggerCongestion')
    if (this.opts.demoService) {
      ;(['pressSos', 'suspectFall', 'setCameraOutcome', 'setFlakyRadio', 'setPlaying', 'setSpeed', 'setAutoplay'] as const).forEach((c) => caps.add(c))
    }
    if (caps.size === 0) return null
    const remote = (action: string, body: unknown = {}) => async () => {
      if (!this.opts.demoService) throw new BackendError('unavailable', 'This backend has no scripted-run service')
      await this.http.post(routes.demo(action), body)
    }
    return {
      capabilities: caps,
      triggerCongestion: async () => {
        if (this.crowd) this.crowd.triggerCongestion()
        else await remote('congestion')()
      },
      pressSos: (deviceId?: string) => remote('sos', { deviceId })(),
      suspectFall: (deviceId?: string) => remote('fall', { deviceId })(),
      setCameraOutcome: (outcome) => remote('camera-outcome', { outcome })(),
      setFlakyRadio: (on) => remote('flaky-radio', { on })(),
      setLinkDown: async () => {
        throw new BackendError('unavailable', 'Link drops can only be staged locally')
      },
      setPlaying: (on) => remote('playing', { on })(),
      setSpeed: (speed) => remote('speed', { speed })(),
      setAutoplay: (on) => remote('autoplay', { on })(),
    }
  }
}
