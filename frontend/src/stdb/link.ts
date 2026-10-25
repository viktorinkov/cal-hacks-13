/**
 * The session's live socket, for modules that sit beside the session. session.ts hands every new
 * socket to attachLink and calls dropLink when it closes. A module registers once with onLink and
 * subscribes its own views on each socket it is handed, so it never holds the session's queries up.
 */
import type { DbConnection } from './module_bindings'

type Hook = { attach: (conn: DbConnection) => void; drop: () => void }

const hooks = new Set<Hook>()
let current: DbConnection | null = null

/** Run `attach` on the current socket and every later one, and `drop` when one closes. */
export function onLink(attach: (conn: DbConnection) => void, drop: () => void = () => {}): () => void {
  const hook = { attach, drop }
  hooks.add(hook)
  if (current) attach(current)
  return () => {
    hooks.delete(hook)
  }
}

export function currentLink(): DbConnection | null {
  return current
}

export function attachLink(conn: DbConnection): void {
  current = conn
  for (const hook of hooks) {
    try {
      hook.attach(conn)
    } catch (error) {
      console.warn('[stdb] link attach failed', messageOf(error))
    }
  }
}

export function dropLink(): void {
  current = null
  for (const hook of hooks) {
    try {
      hook.drop()
    } catch {
      // A module that cannot let go of a closed socket has nothing left to clean.
    }
  }
}

/** The reducers on the current socket, typed by the caller. */
export function linkReducers<T>(): T {
  if (!current) throw new Error('The database is not connected.')
  return (current as unknown as { reducers: T }).reducers
}

/** The current socket's client cache, keyed by table accessor (camelCase). */
export function linkDb(): Record<string, unknown> | null {
  return current ? (current.db as unknown as Record<string, unknown>) : null
}

/**
 * Subscribe one query at a time. A view that never answers must not hold the rest, so each one
 * gets four seconds before the next is asked for.
 */
export function subscribeEach(
  conn: DbConnection,
  queries: readonly string[],
  on: { applied?: (query: string) => void; refused?: (query: string, reason: string) => void } = {},
): void {
  const pending = [...queries]
  const step = () => {
    const query = pending.shift()
    if (!query || current !== conn) return
    let moved = false
    const go = () => {
      if (moved) return
      moved = true
      step()
    }
    const timer = window.setTimeout(go, 4000)
    conn
      .subscriptionBuilder()
      .onApplied(() => {
        window.clearTimeout(timer)
        if (current === conn) on.applied?.(query)
        go()
      })
      .onError((...args: unknown[]) => {
        window.clearTimeout(timer)
        if (current === conn) on.refused?.(query, messageOf(args[1] ?? args[0]))
        go()
      })
      .subscribe(query)
  }
  step()
}

/** Call `read` whenever a row of these tables (camelCase accessors) changes. */
export function watchTables(conn: DbConnection, names: readonly string[], read: () => void): void {
  const db = conn.db as unknown as Record<string, { onInsert?: (cb: () => void) => void; onDelete?: (cb: () => void) => void; onUpdate?: (cb: () => void) => void } | undefined>
  const guarded = () => {
    if (current === conn) read()
  }
  for (const name of names) {
    db[name]?.onInsert?.(guarded)
    db[name]?.onDelete?.(guarded)
    db[name]?.onUpdate?.(guarded)
  }
}

export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return 'The database refused that.'
}

export function rowsOf(table: unknown): Record<string, unknown>[] {
  if (!table || typeof table !== 'object' || !('iter' in table)) return []
  const iter = (table as { iter: unknown }).iter
  if (typeof iter !== 'function') return []
  return [...(iter.call(table) as Iterable<Record<string, unknown>>)]
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** u64 and i64 arrive as bigint. Numbers on screen are small enough for a double. */
export function num(value: unknown): number {
  const n = typeof value === 'bigint' ? Number(value) : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

/** An enum's variant, lowercased: the SDK gives `{ tag: 'Running' }`. */
export function tag(value: unknown): string {
  if (value && typeof value === 'object' && 'tag' in value) return text((value as { tag: unknown }).tag).toLowerCase()
  return text(value).toLowerCase()
}

export function hexOf(value: unknown): string {
  if (value && typeof value === 'object' && 'toHexString' in value) {
    const fn = (value as { toHexString: unknown }).toHexString
    if (typeof fn === 'function') return String(fn.call(value))
  }
  return ''
}

/** The inner value of an Option, or null for none. Plain values pass through. */
export function someOf(value: unknown): unknown {
  if (value && typeof value === 'object' && 'tag' in value) {
    const tagged = value as { tag?: unknown; value?: unknown }
    if (tagged.tag === 'none' || tagged.tag === 'None') return null
    if (tagged.tag === 'some' || tagged.tag === 'Some') return tagged.value ?? null
  }
  return value ?? null
}

/** A Timestamp (or an Option of one) in epoch milliseconds, 0 when missing. */
export function millisOf(value: unknown): number {
  const inner = someOf(value)
  if (inner && typeof inner === 'object' && 'toDate' in inner) {
    const fn = (inner as { toDate: unknown }).toDate
    if (typeof fn === 'function') {
      const time = (fn.call(inner) as Date).getTime()
      return Number.isFinite(time) ? time : 0
    }
  }
  return 0
}
