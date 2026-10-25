/**
 * Keeps the stores in step with a backend: loads the snapshot, buffers events that arrive while it
 * loads, drops duplicates, resynchronises on sequence gaps and after reconnects, and batches events
 * into one store update per animation frame.
 */
import type { ConnectionState, EntityFrame, StreamEvent, WorldSnapshot } from '@/contracts/domain'
import type { BackendAdapter, Unsubscribe } from './BackendAdapter'

export interface SyncSinks {
  snapshot(s: WorldSnapshot): void
  events(batch: StreamEvent[]): void
  frame(f: EntityFrame): void
  connection(c: ConnectionState): void
  phase(p: 'loading' | 'live' | 'resyncing' | 'error', error?: string): void
}

export interface SyncOptions {
  /** Max events held while a snapshot loads. Oldest are dropped; a gap then forces a resync. */
  maxBuffer?: number
  /** How to schedule a batch flush. Defaults to requestAnimationFrame. */
  schedule?: (fn: () => void) => () => void
}

const defaultSchedule = (fn: () => void): (() => void) => {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(fn)
    return () => cancelAnimationFrame(id)
  }
  const id = setTimeout(fn, 16)
  return () => clearTimeout(id)
}

export class StreamSync {
  private readonly adapter: BackendAdapter
  private readonly sinks: SyncSinks
  private readonly maxBuffer: number
  private readonly schedule: (fn: () => void) => () => void
  private lastSeq = 0
  private loading = false
  private buffer: StreamEvent[] = []
  private queue: StreamEvent[] = []
  private cancelFlush: (() => void) | null = null
  private unsubs: Unsubscribe[] = []
  private lastPhase: ConnectionState['phase'] = 'idle'
  private stopped = false
  private loadToken = 0
  /** Counters for diagnostics and tests. */
  stats = { duplicates: 0, gaps: 0, resyncs: 0, dropped: 0 }

  constructor(adapter: BackendAdapter, sinks: SyncSinks, opts: SyncOptions = {}) {
    this.adapter = adapter
    this.sinks = sinks
    this.maxBuffer = opts.maxBuffer ?? 2000
    this.schedule = opts.schedule ?? defaultSchedule
  }

  start(): void {
    this.stopped = false
    this.unsubs.push(
      this.adapter.subscribeToEvents((e) => this.onEvent(e)),
      this.adapter.subscribeToFrames((f) => this.sinks.frame(f)),
      this.adapter.subscribeToConnection((c) => this.onConnection(c)),
    )
    this.adapter.start()
    void this.load('loading')
  }

  stop(): void {
    this.stopped = true
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    this.cancelFlush?.()
    this.cancelFlush = null
    this.adapter.dispose()
  }

  /** Apply queued events now (tests, or before a synchronous read). */
  flush(): void {
    this.cancelFlush?.()
    this.cancelFlush = null
    if (!this.queue.length) return
    const batch = this.queue
    this.queue = []
    this.sinks.events(batch)
  }

  async resync(): Promise<void> {
    await this.load('resyncing')
  }

  private async load(phase: 'loading' | 'resyncing'): Promise<void> {
    const token = ++this.loadToken
    this.loading = true
    this.sinks.phase(phase)
    if (phase === 'resyncing') this.stats.resyncs++
    try {
      const snap = await this.adapter.getInitialState()
      if (this.stopped || token !== this.loadToken) return
      this.applySnapshot(snap)
      this.sinks.phase('live')
    } catch (err) {
      if (this.stopped || token !== this.loadToken) return
      this.loading = false
      this.sinks.phase('error', err instanceof Error ? err.message : String(err))
    }
  }

  private applySnapshot(snap: WorldSnapshot): void {
    this.queue = []
    this.cancelFlush?.()
    this.cancelFlush = null
    this.lastSeq = snap.seq
    this.sinks.snapshot(snap)
    this.loading = false
    const buffered = this.buffer
    this.buffer = []
    for (const e of buffered) this.onEvent(e)
  }

  private onEvent(e: StreamEvent): void {
    if (e.type === 'snapshot') {
      // the backend pushed a full state (e.g. after a demo reset)
      this.loadToken++
      this.applySnapshot(e.snapshot)
      this.sinks.phase('live')
      return
    }
    if (this.loading) {
      this.buffer.push(e)
      if (this.buffer.length > this.maxBuffer) {
        this.buffer.shift()
        this.stats.dropped++
      }
      return
    }
    if (e.seq !== 0) {
      if (e.seq <= this.lastSeq) {
        this.stats.duplicates++
        return
      }
      if (e.seq > this.lastSeq + 1) {
        this.stats.gaps++
        this.buffer.push(e)
        void this.load('resyncing')
        return
      }
      this.lastSeq = e.seq
    }
    this.queue.push(e)
    if (!this.cancelFlush) this.cancelFlush = this.schedule(() => this.flush())
  }

  private onConnection(c: ConnectionState): void {
    const was = this.lastPhase
    this.lastPhase = c.phase
    this.sinks.connection(c)
    if (c.phase === 'open' && was !== 'open' && was !== 'idle' && was !== 'connecting') {
      void this.load('resyncing')
    }
  }
}
