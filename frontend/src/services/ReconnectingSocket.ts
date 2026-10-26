import type { ConnectionState } from '@/contracts/domain'

export interface SocketOptions {
  url: string
  /** First retry delay; doubles per attempt up to maxDelayMs, with full jitter. */
  baseDelayMs?: number
  maxDelayMs?: number
  /** Treat the link as dead if nothing arrives for this long (backend sends heartbeats). */
  idleTimeoutMs?: number
  /** Messages kept while no listener is attached. Oldest are dropped first. */
  maxBuffer?: number
  random?: () => number
  createSocket?: (url: string) => WebSocket
}

type Listener<T> = (value: T) => void

/**
 * One managed WebSocket: reconnects with exponential backoff and jitter, detects silent links with
 * an idle timeout, and reports its state. It only moves strings; parsing happens in the adapter.
 */
export class ReconnectingSocket {
  private readonly opts: Required<Omit<SocketOptions, 'createSocket' | 'random'>> & Pick<SocketOptions, 'createSocket' | 'random'>
  private ws: WebSocket | null = null
  private state: ConnectionState = { phase: 'idle', attempt: 0, lastMessageAt: null, nextRetryAt: null }
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private messageListeners = new Set<Listener<string>>()
  private stateListeners = new Set<Listener<ConnectionState>>()
  private openListeners = new Set<() => void>()
  private buffer: string[] = []
  private stopped = true

  constructor(opts: SocketOptions) {
    this.opts = {
      baseDelayMs: 500,
      maxDelayMs: 15_000,
      idleTimeoutMs: 10_000,
      maxBuffer: 500,
      ...opts,
    }
  }

  get connection(): ConnectionState {
    return this.state
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    if (this.ws) {
      this.ws.onopen = this.ws.onclose = this.ws.onerror = this.ws.onmessage = null
      this.ws.close()
      this.ws = null
    }
    this.setState({ phase: 'closed', nextRetryAt: null })
  }

  onMessage(cb: Listener<string>): () => void {
    this.messageListeners.add(cb)
    if (this.buffer.length) {
      const pending = this.buffer
      this.buffer = []
      pending.forEach(cb)
    }
    return () => this.messageListeners.delete(cb)
  }

  onState(cb: Listener<ConnectionState>): () => void {
    this.stateListeners.add(cb)
    cb(this.state)
    return () => this.stateListeners.delete(cb)
  }

  /** Called after every successful (re)connection, so the owner can resynchronise. */
  onOpen(cb: () => void): () => void {
    this.openListeners.add(cb)
    return () => this.openListeners.delete(cb)
  }

  /** Delay before retry `attempt` (1-based): full jitter over an exponential cap. */
  backoffDelay(attempt: number): number {
    const cap = Math.min(this.opts.maxDelayMs, this.opts.baseDelayMs * 2 ** Math.max(0, attempt - 1))
    const rand = this.opts.random ?? Math.random
    return Math.round(cap / 2 + rand() * (cap / 2))
  }

  private connect(): void {
    if (this.stopped) return
    this.setState({ phase: this.state.attempt === 0 ? 'connecting' : 'reconnecting', nextRetryAt: null })
    let ws: WebSocket
    try {
      ws = this.opts.createSocket ? this.opts.createSocket(this.opts.url) : new WebSocket(this.opts.url)
    } catch (err) {
      this.scheduleRetry(String(err))
      return
    }
    this.ws = ws
    ws.onopen = () => {
      this.setState({ phase: 'open', attempt: 0, error: undefined, nextRetryAt: null })
      this.armIdle()
      this.openListeners.forEach((l) => l())
    }
    ws.onmessage = (ev: MessageEvent) => {
      const data = typeof ev.data === 'string' ? ev.data : ''
      if (!data) return
      this.state = { ...this.state, lastMessageAt: Date.now() }
      this.armIdle()
      if (this.messageListeners.size === 0) {
        this.buffer.push(data)
        if (this.buffer.length > this.opts.maxBuffer) this.buffer.splice(0, this.buffer.length - this.opts.maxBuffer)
        return
      }
      this.messageListeners.forEach((l) => l(data))
    }
    ws.onerror = () => {
      // onclose follows; it owns the retry
    }
    ws.onclose = (ev: CloseEvent) => {
      this.ws = null
      this.clearIdle()
      if (!this.stopped) this.scheduleRetry(ev.reason || `closed (${ev.code})`)
    }
  }

  private scheduleRetry(error: string): void {
    const attempt = this.state.attempt + 1
    const delay = this.backoffDelay(attempt)
    this.setState({ phase: 'reconnecting', attempt, error, nextRetryAt: Date.now() + delay })
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, delay)
  }

  private armIdle(): void {
    this.clearIdle()
    this.idleTimer = setTimeout(() => {
      // a silent socket is a dead socket: force a reconnect
      this.ws?.close(4000, 'idle timeout')
    }, this.opts.idleTimeoutMs)
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.clearIdle()
  }

  private setState(patch: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...patch }
    this.stateListeners.forEach((l) => l(this.state))
  }
}
