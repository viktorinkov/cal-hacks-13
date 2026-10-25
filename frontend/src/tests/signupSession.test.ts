import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({ conn: null as unknown, subscriptions: [] as { query: string | string[]; apply: () => void; refuse: (...args: unknown[]) => void }[] }))

vi.mock('@/stdb/catalog', () => ({ scheduleCatalog: vi.fn() }))
vi.mock('@/stdb/floor', () => ({ syncFloor: vi.fn() }))
vi.mock('@/stdb/host', () => ({ loadHostConfig: async () => ({ database: 'signup-test', spacetimeUrl: 'https://example.test' }) }))
vi.mock('@/stdb/module_bindings', () => ({
  DbConnection: {
    builder() {
      let connected: (...args: unknown[]) => void = () => {}
      const builder = {
        withUri() { return builder },
        withDatabaseName() { return builder },
        withToken() { return builder },
        onConnect(fn: typeof connected) { connected = fn; return builder },
        onConnectError() { return builder },
        onDisconnect() { return builder },
        build() { connected(harness.conn, { toHexString: () => 'identity' }, 'identity-token') },
      }
      return builder
    },
  },
}))

function table() {
  return {
    rows: [] as Record<string, unknown>[],
    iter() { return this.rows.values() },
    onInsert: vi.fn(), onUpdate: vi.fn(), onDelete: vi.fn(),
  }
}

function connection() {
  const db = { myBand: table(), myMedicalDocuments: table(), myMedicalCard: table(), myWallet: table() }
  const reducers = {
    claimBand: vi.fn().mockResolvedValue(undefined),
    updateProfile: vi.fn().mockResolvedValue(undefined),
    connectWallet: vi.fn().mockResolvedValue(undefined),
    openApiSession: vi.fn().mockResolvedValue(undefined),
    submitMedicalDocument: vi.fn().mockResolvedValue(undefined),
    confirmMedicalCard: vi.fn().mockResolvedValue(undefined),
  }
  return {
    db, reducers, identity: { toHexString: () => 'identity' },
    subscriptionBuilder() {
      let apply = () => {}
      let refuse = (..._args: unknown[]) => {}
      const builder = {
        onApplied(fn: typeof apply) { apply = fn; return builder },
        onError(fn: typeof refuse) { refuse = fn; return builder },
        subscribe(query: string | string[]) { harness.subscriptions.push({ query, apply, refuse }) },
      }
      return builder
    },
  }
}

function apply(view: string) {
  const subscription = harness.subscriptions.find((item) => item.query === `SELECT * FROM ${view}`)
  if (!subscription) throw new Error(`Missing subscription ${view}`)
  subscription.apply()
}

async function started() {
  const session = await import('@/stdb/session')
  session.startSession()
  // Other features can add subscriptions without changing attendee isolation.
  await vi.waitFor(() => expect(harness.subscriptions.map(({ query }) => query)).toEqual(expect.arrayContaining([
    'SELECT * FROM my_band', 'SELECT * FROM my_medical_documents', 'SELECT * FROM my_medical_card', 'SELECT * FROM my_wallet',
  ])))
  return session.useSession
}

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('MODE', 'development')
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
  harness.subscriptions = []
  harness.conn = connection()
  localStorage.clear()
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('attendee session', () => {
  it('subscribes each attendee view independently while the floor never completes', async () => {
    const store = await started()
    expect(harness.subscriptions.map((item) => item.query)).toEqual(expect.arrayContaining([
      'SELECT * FROM my_band', 'SELECT * FROM my_medical_documents', 'SELECT * FROM my_medical_card', 'SELECT * FROM my_wallet',
    ]))
    expect(store.getState()).toMatchObject({ myBandReady: false, medicalDocumentsReady: false, medicalCardReady: false })
    apply('my_band')
    apply('my_medical_documents')
    expect(store.getState()).toMatchObject({ myBandReady: true, myBand: null, medicalDocumentsReady: true, medicalDocuments: [], medicalCardReady: false })
    apply('my_medical_card')
    expect(store.getState()).toMatchObject({ medicalCardReady: true, medicalCard: null })
  })

  it('preserves a refused claim and does not save the profile or connect the wallet', async () => {
    const store = await started()
    const conn = harness.conn as ReturnType<typeof connection>
    conn.reducers.claimBand.mockRejectedValue(new Error('this band already belongs to someone'))
    await expect(store.getState().registerBand('BANDIT-05', 'Alex')).rejects.toThrow('this band already belongs to someone')
    expect(store.getState().actionError).toBe('this band already belongs to someone')
    expect(conn.reducers.updateProfile).not.toHaveBeenCalled()
    expect(conn.reducers.connectWallet).not.toHaveBeenCalled()
  })

  it('keeps a pending physical claim pending and blocks document upload', async () => {
    const store = await started()
    const conn = harness.conn as ReturnType<typeof connection>
    conn.db.myBand.rows = [{ bandId: 5, status: 'waiting_for_press', expiresAt: { toDate: () => new Date(Date.now() + 8000) } }]
    apply('my_band')
    await store.getState().claimBand('BANDIT-05')
    expect(conn.reducers.claimBand).not.toHaveBeenCalled()
    await expect(store.getState().submitMedicalDocument(new File(['%PDF'], 'history.pdf', { type: 'application/pdf' }), 'history')).rejects.toThrow(/Press the button/)
    expect(conn.reducers.openApiSession).not.toHaveBeenCalled()
  })

  it('edits an owned band without re-claiming, and does not fail registration when wallet creation fails', async () => {
    const store = await started()
    const conn = harness.conn as ReturnType<typeof connection>
    conn.db.myBand.rows = [{ bandId: 5, status: 'claimed' }]
    apply('my_band')
    conn.reducers.connectWallet.mockRejectedValue(new Error('Wallet service unavailable'))
    await expect(store.getState().registerBand('BANDIT-05', 'Alex')).resolves.toBeUndefined()
    expect(conn.reducers.claimBand).not.toHaveBeenCalled()
    expect(conn.reducers.updateProfile).toHaveBeenCalledWith({ displayName: 'Alex', findable: false })
    expect(conn.reducers.connectWallet).toHaveBeenCalledWith({})
    expect(store.getState()).toMatchObject({ walletError: 'Wallet service unavailable', actionError: null })
  })

  it('opens an ephemeral upload session, uploads bytes before submission, and never persists files or its secret', async () => {
    const store = await started()
    const conn = harness.conn as ReturnType<typeof connection>
    conn.db.myBand.rows = [{ bandId: 5, status: 'claimed' }]
    apply('my_band')
    const bytes = new TextEncoder().encode('%PDF-example').buffer
    const file = new File([bytes], 'history.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes })
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ hash, pages: 2 }) })
    vi.stubGlobal('fetch', fetch)
    const before = { ...localStorage }

    await expect(store.getState().submitMedicalDocument(file, 'history')).resolves.toEqual({ hash })
    expect(conn.reducers.openApiSession).toHaveBeenCalledTimes(1)
    const token = (fetch.mock.calls[0][1].headers as Record<string, string>)['x-bandit-session']
    expect(token).toHaveLength(64)
    const tokenHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), (byte) => byte.toString(16).padStart(2, '0')).join('')
    expect(conn.reducers.openApiSession).toHaveBeenCalledWith({ tokenHash })
    expect(conn.reducers.submitMedicalDocument).toHaveBeenCalledWith({ kind: 'history', fileHash: hash, pageCount: 2 })
    expect(conn.reducers.openApiSession.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[0])
    expect(fetch.mock.invocationCallOrder[0]).toBeLessThan(conn.reducers.submitMedicalDocument.mock.invocationCallOrder[0])
    expect({ ...localStorage }).toEqual(before)
  })

  it('maps live document status and dropped fields, retries by hash, and confirms the read card', async () => {
    const store = await started()
    const conn = harness.conn as ReturnType<typeof connection>
    conn.db.myBand.rows = [{ bandId: 5, status: 'claimed' }]
    apply('my_band')
    conn.db.myMedicalDocuments.rows = [{ id: 7n, kind: 'insurance', fileHash: 'f'.repeat(64), pageCount: 2, status: 'failed', jobId: 8n, dropped: ['Unclear field'], uploadedAt: { toDate: () => new Date(1000) } }]
    apply('my_medical_documents')
    expect(store.getState().medicalDocuments[0]).toMatchObject({ id: '7', status: 'failed', dropped: ['Unclear field'], uploadedAt: 1000, jobId: '8' })
    await store.getState().retryMedicalDocument('7')
    expect(conn.reducers.submitMedicalDocument).toHaveBeenCalledWith({ kind: 'insurance', fileHash: 'f'.repeat(64), pageCount: 2 })
    conn.db.myMedicalDocuments.rows[0].status = 'read'
    conn.db.myMedicalCard.rows = [{ bloodType: 'O+', insurer: 'Example', insurerPhone: '555-0100', status: 'extracted' }]
    apply('my_medical_documents')
    apply('my_medical_card')
    expect(store.getState().medicalCard).toMatchObject({ bandId: 5, insurerPhone: '555-0100', status: 'extracted' })
    await store.getState().confirmMedicalCard()
    expect(conn.reducers.confirmMedicalCard).toHaveBeenCalledWith({})
  })
})
