import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionState, EntityFrame, StreamEvent, WorldSnapshot } from '@/contracts/domain'
import { venue } from '@/mock/venue'
import type { BackendAdapter } from '@/services/BackendAdapter'
import { ReconnectingSocket } from '@/services/ReconnectingSocket'
import { StreamSync } from '@/services/sync'

// ------------------------------------------------------------------ a socket we can drive

class FakeSocket {
  static all: FakeSocket[] = []
  onopen: (() => void) | null = null
  onclose: ((e: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  closed = false
  constructor() {
    FakeSocket.all.push(this)
  }
  open() {
    this.onopen?.()
  }
  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
  drop() {
    this.onclose?.({ code: 1006, reason: '' })
  }
  close() {
    this.closed = true
    this.onclose?.({ code: 1000, reason: 'closed' })
  }
}

describe('WebSocket reconnection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeSocket.all = []
  })
  afterEach(() => vi.useRealTimers())

  const make = () =>
    new ReconnectingSocket({
      url: 'ws://test',
      baseDelayMs: 100,
      maxDelayMs: 1000,
      idleTimeoutMs: 5000,
      random: () => 1,
      createSocket: () => new FakeSocket() as unknown as WebSocket,
    })

  it('backs off exponentially with a cap', () => {
    const s = make()
    expect(s.backoffDelay(1)).toBe(100)
    expect(s.backoffDelay(2)).toBe(200)
    expect(s.backoffDelay(3)).toBe(400)
    expect(s.backoffDelay(10)).toBe(1000)
  })

  it('reports reconnecting after a drop, reconnects, and announces the reopen', () => {
    const s = make()
    const states: ConnectionState['phase'][] = []
    s.onState((c) => states.push(c.phase))
    const reopened = vi.fn()
    s.onOpen(reopened)
    s.start()
    FakeSocket.all[0].open()
    expect(s.connection.phase).toBe('open')
    FakeSocket.all[0].drop()
    expect(s.connection.phase).toBe('reconnecting')
    expect(s.connection.attempt).toBe(1)
    vi.advanceTimersByTime(100)
    expect(FakeSocket.all).toHaveLength(2)
    FakeSocket.all[1].open()
    expect(s.connection.phase).toBe('open')
    expect(s.connection.attempt).toBe(0)
    expect(reopened).toHaveBeenCalledTimes(2)
    expect(states).toContain('reconnecting')
    s.stop()
  })

  it('treats a silent link as dead', () => {
    const s = make()
    s.start()
    FakeSocket.all[0].open()
    vi.advanceTimersByTime(5001)
    expect(FakeSocket.all[0].closed).toBe(true)
    expect(s.connection.phase).toBe('reconnecting')
    s.stop()
  })

  it('buffers a bounded number of messages until someone listens', () => {
    const s = new ReconnectingSocket({ url: 'ws://t', maxBuffer: 3, createSocket: () => new FakeSocket() as unknown as WebSocket })
    s.start()
    FakeSocket.all[0].open()
    for (let k = 0; k < 5; k++) FakeSocket.all[0].message({ k })
    const got: string[] = []
    s.onMessage((m) => got.push(m))
    expect(got.map((m) => JSON.parse(m).k)).toEqual([2, 3, 4])
    s.stop()
  })
})

// ------------------------------------------------------------------ sequence handling

function snapshot(seq: number): WorldSnapshot {
  return { timestamp: 0, seq, mode: 'live', venue, zones: [], devices: [], incidents: [], observations: [], commands: [], sources: [] }
}

class FakeAdapter implements BackendAdapter {
  readonly kind = 'live' as const
  readonly label = 'fake'
  readonly demo = null
  snapshots: WorldSnapshot[] = []
  loads = 0
  events = new Set<(e: StreamEvent) => void>()
  conn = new Set<(c: ConnectionState) => void>()
  start() {}
  dispose() {}
  async getInitialState() {
    this.loads++
    return this.snapshots.shift() ?? snapshot(0)
  }
  subscribeToEvents(cb: (e: StreamEvent) => void) {
    this.events.add(cb)
    return () => this.events.delete(cb)
  }
  subscribeToFrames(_cb: (f: EntityFrame) => void) {
    return () => {}
  }
  subscribeToConnection(cb: (c: ConnectionState) => void) {
    this.conn.add(cb)
    return () => this.conn.delete(cb)
  }
  emit(e: StreamEvent) {
    this.events.forEach((l) => l(e))
  }
  setPhase(phase: ConnectionState['phase']) {
    this.conn.forEach((l) => l({ phase, attempt: 0, lastMessageAt: null, nextRetryAt: null }))
  }
  acknowledgeIncident = vi.fn()
  resolveIncident = vi.fn()
  previewGuidance = vi.fn()
  approveGuidance = vi.fn()
  cancelGuidance = vi.fn()
  resendGuidance = vi.fn()
  resetSimulation = vi.fn()
}

function harness(adapter: FakeAdapter) {
  const applied: number[] = []
  const snaps: number[] = []
  const phases: string[] = []
  const sync = new StreamSync(
    adapter,
    {
      snapshot: (s) => snaps.push(s.seq),
      events: (batch) => batch.forEach((e) => applied.push(e.seq)),
      frame: () => {},
      connection: () => {},
      phase: (p) => phases.push(p),
    },
    { schedule: () => () => {} },
  )
  return { sync, applied, snaps, phases }
}

const hb = (seq: number): StreamEvent => ({ type: 'heartbeat', seq, at: seq })

describe('stream synchronisation', () => {
  it('applies events in order and drops duplicates', async () => {
    const a = new FakeAdapter()
    a.snapshots.push(snapshot(5))
    const h = harness(a)
    h.sync.start()
    await Promise.resolve()
    await Promise.resolve()
    a.emit(hb(6))
    a.emit(hb(6))
    a.emit(hb(5))
    a.emit(hb(7))
    h.sync.flush()
    expect(h.applied).toEqual([6, 7])
    expect(h.sync.stats.duplicates).toBe(2)
  })

  it('buffers events that arrive while the snapshot loads, keeping only newer ones', async () => {
    const a = new FakeAdapter()
    a.snapshots.push(snapshot(10))
    const h = harness(a)
    h.sync.start()
    a.emit(hb(9))
    a.emit(hb(11))
    await Promise.resolve()
    await Promise.resolve()
    h.sync.flush()
    expect(h.snaps).toEqual([10])
    expect(h.applied).toEqual([11])
  })

  it('resynchronises on a sequence gap', async () => {
    const a = new FakeAdapter()
    a.snapshots.push(snapshot(1), snapshot(20))
    const h = harness(a)
    h.sync.start()
    await Promise.resolve()
    await Promise.resolve()
    a.emit(hb(2))
    a.emit(hb(9)) // 3..8 missing
    await Promise.resolve()
    await Promise.resolve()
    h.sync.flush()
    expect(h.sync.stats.gaps).toBe(1)
    expect(a.loads).toBe(2)
    expect(h.snaps).toEqual([1, 20])
    expect(h.phases).toContain('resyncing')
  })

  it('reloads the full state after the connection comes back', async () => {
    const a = new FakeAdapter()
    const h = harness(a)
    h.sync.start()
    a.setPhase('open')
    await Promise.resolve()
    a.setPhase('reconnecting')
    a.setPhase('open')
    await Promise.resolve()
    await Promise.resolve()
    expect(a.loads).toBe(2)
    expect(h.sync.stats.resyncs).toBe(1)
  })

  it('passes unsequenced local data (seq 0) straight through', async () => {
    const a = new FakeAdapter()
    a.snapshots.push(snapshot(3))
    const h = harness(a)
    h.sync.start()
    await Promise.resolve()
    await Promise.resolve()
    a.emit(hb(0))
    a.emit(hb(0))
    h.sync.flush()
    expect(h.applied).toEqual([0, 0])
  })
})
