import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({ conn: null as unknown, token: '' as string | undefined, subscriptions: [] as { query: string | string[]; apply: () => void }[] }))
vi.mock('@/stdb/catalog', () => ({ scheduleCatalog: vi.fn() }))
vi.mock('@/stdb/floor', () => ({ syncFloor: vi.fn() }))
vi.mock('@/stdb/host', () => ({ loadHostConfig: async () => ({ database: 'view-test', spacetimeUrl: 'https://example.test' }) }))
vi.mock('@/stdb/module_bindings', () => ({ DbConnection: { builder() {
  let connected: (...args: unknown[]) => void = () => {}
  const builder = {
    withUri() { return builder }, withDatabaseName() { return builder },
    withToken(token: string | undefined) { harness.token = token; return builder },
    onConnect(fn: typeof connected) { connected = fn; return builder },
    onConnectError() { return builder }, onDisconnect() { return builder },
    build() { connected(harness.conn, { toHexString: () => 'b'.repeat(64) }, 'viewer-secret') },
  }
  return builder
} } }))

function connection() {
  return {
    db: {}, disconnect: vi.fn(),
    reducers: { claimBand: vi.fn().mockResolvedValue(undefined), connectWallet: vi.fn().mockResolvedValue(undefined), openApiSession: vi.fn().mockResolvedValue(undefined) },
    subscriptionBuilder() {
      let apply = () => {}
      const builder = { onApplied(fn: typeof apply) { apply = fn; return builder }, onError() { return builder }, subscribe(query: string | string[]) { harness.subscriptions.push({ query, apply }) } }
      return builder
    },
  }
}

const originalParent = window.parent
beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('MODE', 'development')
  localStorage.clear()
  localStorage.setItem('bandit-token:view-test', 'owner-secret')
  localStorage.setItem('bandit-id-token', 'owner-sign-in')
  harness.subscriptions = []
  harness.conn = connection()
  harness.token = 'not-called'
  window.history.replaceState(null, '', `/view-as?view=${'a'.repeat(64)}&screen=card`)
})
afterEach(() => {
  vi.unstubAllEnvs()
  Object.defineProperty(window, 'parent', { configurable: true, value: originalParent })
  window.history.replaceState(null, '', '/')
  localStorage.clear()
})

describe('isolated viewer session', () => {
  it('binds a fresh identity before any subscription and preserves the owner credentials', async () => {
    let approve = () => {}
    const authorize = vi.fn(() => new Promise<void>((resolve) => { approve = resolve }))
    Object.defineProperty(window, 'parent', { configurable: true, value: { banditAuthorizeViewer: authorize } })
    const session = await import('@/stdb/session')
    session.startSession()
    await vi.waitFor(() => expect(authorize).toHaveBeenCalledWith('b'.repeat(64), 'a'.repeat(64), window))
    expect(harness.token).toBeUndefined()
    expect(harness.subscriptions).toHaveLength(0)
    approve()
    await vi.waitFor(() => expect(harness.subscriptions.length).toBeGreaterThan(0))
    harness.subscriptions.find(({ query }) => Array.isArray(query))?.apply()
    expect(harness.subscriptions.some(({ query }) => query === 'SELECT * FROM my_roles')).toBe(true)
    expect(localStorage.getItem('bandit-token:view-test')).toBe('owner-secret')
    expect(localStorage.getItem('bandit-id-token')).toBe('owner-sign-in')
    expect(session.useSession.getState().owner).toBe(false)
    const conn = harness.conn as ReturnType<typeof connection>
    await expect(conn.reducers.claimBand()).rejects.toThrow('read-only')
    await expect(conn.reducers.connectWallet()).rejects.toThrow('read-only')
    await conn.reducers.openApiSession()
    expect(conn.reducers.openApiSession).toHaveBeenCalledOnce()
  })

  it('does not subscribe or fall back to the owner after refused authorization', async () => {
    Object.defineProperty(window, 'parent', { configurable: true, value: { banditAuthorizeViewer: async () => { throw new Error('Owner refused this viewer.') } } })
    const session = await import('@/stdb/session')
    session.startSession()
    await vi.waitFor(() => expect(session.useSession.getState().phase).toBe('error'))
    expect(session.useSession.getState().error).toBe('Owner refused this viewer.')
    expect(harness.subscriptions).toHaveLength(0)
    expect(harness.token).toBeUndefined()
    expect(localStorage.getItem('bandit-token:view-test')).toBe('owner-secret')
  })

  it('rejects a viewer opened outside its owner frame', async () => {
    Object.defineProperty(window, 'parent', { configurable: true, value: window })
    const session = await import('@/stdb/session')
    session.startSession()
    await vi.waitFor(() => expect(session.useSession.getState().phase).toBe('error'))
    expect(session.useSession.getState().error).toMatch(/owner’s View As/)
    expect(harness.subscriptions).toHaveLength(0)
  })
})
