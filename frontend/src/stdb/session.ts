import { create } from 'zustand'
import type { BoardClaim, BoardFact, BoardCheck } from '@/cover/liveClaims'
import { scheduleCatalog } from './catalog'
import { syncFloor } from './floor'
import { loadHostConfig, type HostConfig } from './host'
import { DbConnection } from './module_bindings'
import { sha256, uploadBlob, validateMedicalFile, type MedicalDocumentKind } from './uploads'

export const SPACETIME_URI = import.meta.env.VITE_SPACETIMEDB_URI || 'https://maincloud.spacetimedb.com'
export const SPACETIME_DB = import.meta.env.VITE_SPACETIMEDB_DB || 'bandit-calhacks13-sp82j'

/** Public tables. An anonymous identity can subscribe to these on their own. */
const FLOOR_QUERIES = [
  'SELECT * FROM venue',
  'SELECT * FROM zone',
  'SELECT * FROM band',
  'SELECT * FROM booth',
  'SELECT * FROM command',
]

/**
 * Staff views for a signed-in identity. They are not in the public floor subscription.
 * The live host never finishes a second combined set, and some views (the claims board, policies,
 * wallet, medical cards) never complete on their own, so those stay off this list. The ones below
 * are requested one at a time.
 */
const STAFF_QUERIES = [
  'SELECT * FROM my_roles',
  'SELECT * FROM my_owner',
  'SELECT * FROM board_checks',
  'SELECT * FROM board_facts',
  'SELECT * FROM board_attendees',
  'SELECT * FROM my_photos',
  'SELECT * FROM my_merch_orders',
  'SELECT * FROM board_ledger',
  'SELECT * FROM board_lines',
  'SELECT * FROM my_claims',
  'SELECT * FROM open_incidents',
]

/** Tables the desk can read without a staff role. Requested one at a time, after the floor. */
const DESK_QUERIES = [
  'SELECT * FROM merch_template',
  'SELECT * FROM organization',
  'SELECT * FROM person',
  'SELECT * FROM social_photos',
  'SELECT * FROM event_graph',
]

export interface Actor {
  name: string
  label: string
  token: string
}

export interface MedicalCardView {
  bandId: number
  name: string
  bloodType: string
  allergies: string
  conditions: string
  medications: string
  emergencyContact: string
  insurer: string
  plan: string
  memberId: string
  groupNumber: string
  insurerPhone?: string
  notes?: string
  status: string
}

export interface MyBandView {
  bandId: number
  status: string
  expiresAt: number | null
}

export interface MedicalDocumentView {
  id: string
  kind: string
  fileHash: string
  pageCount: number
  status: string
  jobId: string
  dropped: string[]
  uploadedAt: number
}

export interface WalletView {
  accountId: string
  balanceCents: number
}

interface SessionState {
  phase: 'idle' | 'connecting' | 'live' | 'error'
  error: string | null
  actionError: string | null
  busy: boolean
  staff: boolean
  owner: boolean
  roles: string[]
  me: string
  insurer: string
  claims: BoardClaim[]
  cards: MedicalCardView[]
  myBand: MyBandView | null
  myBandReady: boolean
  medicalDocuments: MedicalDocumentView[]
  medicalDocumentsReady: boolean
  medicalCard: MedicalCardView | null
  medicalCardReady: boolean
  signupError: string | null
  wallet: WalletView | null
  walletError: string | null
  actors: Actor[]
  /** Whether the staff-only views subscribed. Empty tables still count as open. */
  staffViews: 'pending' | 'open' | 'refused'
  staffError: string | null
  approve: (id: string) => Promise<void>
  refuse: (id: string, reason: string) => Promise<void>
  requestCard: (bandId: number) => Promise<void>
  claimBand: (token: string) => Promise<void>
  registerBand: (token: string, name: string) => Promise<void>
  submitMedicalDocument: (file: File, kind: MedicalDocumentKind) => Promise<{ hash: string }>
  retryMedicalDocument: (id: string) => Promise<void>
  confirmMedicalCard: () => Promise<void>
  connectWallet: () => Promise<void>
}

type Reducers = {
  approveClaim(args: {
    claimId: bigint
    amountSeenCents: bigint
    packHashSeen: string
    requestedCeilingCents?: bigint
    learn: boolean
  }): Promise<unknown>
  refuseClaim(args: { claimId: bigint; packHashSeen: string; reason: string }): Promise<unknown>
  requestMedicalCard(args: { bandId: number }): Promise<unknown>
  claimBand(args: { token: string }): Promise<unknown>
  updateProfile(args: { displayName: string; findable: boolean }): Promise<unknown>
  connectWallet(args: Record<string, never>): Promise<unknown>
  releaseBand(args: { bandId: number }): Promise<unknown>
  openApiSession(args: { tokenHash: string }): Promise<unknown>
  submitMedicalDocument(args: { kind: string; fileHash: string; pageCount: number }): Promise<unknown>
  confirmMedicalCard(args: Record<string, never>): Promise<unknown>
}

let conn: DbConnection | null = null
let opening: Promise<void> | null = null
let noteDisconnect: (message: string) => void = () => {}
let apiSession: Promise<string> | null = null
let pendingActions = 0
const claimRequests = new Map<string, Promise<void>>()

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return 'The database refused that.'
}

function cents(value: unknown): number {
  const n = typeof value === 'bigint' ? Number(value) : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function tagOf(value: unknown): string {
  if (value && typeof value === 'object' && 'tag' in value) return text((value as { tag: unknown }).tag)
  return text(value)
}

function hexOf(value: unknown): string {
  if (value && typeof value === 'object' && 'toHexString' in value) {
    const fn = (value as { toHexString: unknown }).toHexString
    if (typeof fn === 'function') return String(fn.call(value))
  }
  return ''
}

function clockOf(value: unknown): string {
  if (value && typeof value === 'object' && 'toDate' in value) {
    const fn = (value as { toDate: unknown }).toDate
    if (typeof fn === 'function') {
      const date = fn.call(value) as Date
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  }
  return ''
}

function millisOf(value: unknown): number | null {
  if (value && typeof value === 'object' && 'toDate' in value) {
    const fn = (value as { toDate: unknown }).toDate
    if (typeof fn === 'function') {
      const time = (fn.call(value) as Date).getTime()
      return Number.isFinite(time) ? time : null
    }
  }
  return null
}

function list(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean).join(', ')
  return text(value)
}

function rowsOf(table: unknown): Record<string, unknown>[] {
  if (!table || typeof table !== 'object' || !('iter' in table)) return []
  const iter = (table as { iter: unknown }).iter
  if (typeof iter !== 'function') return []
  return [...(iter.call(table) as Iterable<Record<string, unknown>>)]
}

function cardView(row: Record<string, unknown>, bandId: number, name: string): MedicalCardView {
  return {
    bandId,
    name: name || text(row.name),
    bloodType: text(row.bloodType),
    allergies: list(row.allergies),
    conditions: list(row.conditions),
    medications: list(row.medications),
    emergencyContact: text(row.emergencyContact),
    insurer: text(row.insurer),
    plan: text(row.plan),
    memberId: text(row.memberId),
    groupNumber: text(row.groupNumber),
    insurerPhone: text(row.insurerPhone),
    notes: text(row.notes),
    status: text(row.status),
  }
}

function readCard(value: unknown, bandId: number, name: string): MedicalCardView | null {
  if (!value || typeof value !== 'object') return null
  const tagged = value as { tag?: unknown; value?: unknown }
  if (tagged.tag === 'none' || tagged.tag === 'None') return null
  const row = (tagged.tag === 'some' || tagged.tag === 'Some' ? tagged.value : value) as Record<string, unknown>
  if (!row || typeof row !== 'object') return null
  return cardView(row, bandId, name)
}

function publish() {
  if (!conn) return
  const db = conn.db as unknown as Record<string, unknown>
  const roles = rowsOf(db.myRoles).map((row) => text(row.role)).filter(Boolean)
  const owner = rowsOf(db.myOwner).length > 0
  const staff = owner || roles.some((role) => role === 'ops' || role === 'medic')
  const me = hexOf((conn as unknown as { identity?: unknown }).identity)
  const checks = rowsOf(db.boardChecks)
  const facts = rowsOf(db.boardFacts)
  const policy = rowsOf(db.boardPolicies)[0]
  const board = rowsOf(db.claimsBoard)
  const mine = rowsOf(db.myClaims)
  const source = board.length > 0 ? board : mine
  const claims: BoardClaim[] = source.map((row) => {
    const id = String(row.id ?? '')
    const version = row.packVersion
    const ownChecks: BoardCheck[] = checks
      .filter((check) => String(check.claimId ?? '') === id && (version == null || check.packVersion === version))
      .map((check) => ({
        name: text(check.name),
        result: text(check.result),
        detail: text(check.detail),
        reader: text(check.reader),
      }))
    const ownFacts: BoardFact[] = facts
      .filter((fact) => String(fact.claimId ?? '') === id && (version == null || fact.packVersion === version))
      .sort((a, b) => cents(a.seq) - cents(b.seq))
      .map((fact) => ({
        seq: cents(fact.seq),
        key: text(fact.key),
        value: text(fact.value),
        source: text(fact.source),
      }))
    return {
      id,
      incidentKind: text(row.incidentKind),
      zoneName: text(row.zoneName),
      claimantName: text(row.claimantName),
      bandId: cents(row.bandId),
      status: tagOf(row.status),
      statusNote: text(row.statusNote),
      costCents: cents(row.costCents),
      payoutCents: cents(row.payoutCents),
      recoverableCents: cents(row.recoverableCents),
      venueCostCents: cents(row.venueCostCents),
      packHash: text(row.packHash),
      openedAt: clockOf(row.openedAt),
      routedToName: text(row.routedToName),
      routedToRole: text(row.routedToRole),
      routedTo: hexOf(row.routedTo),
      corroboration: text(row.corroboration),
      checks: ownChecks,
      facts: ownFacts,
    }
  })
  const cards: MedicalCardView[] = []
  for (const row of rowsOf(db.medicMedicalCards)) {
    const card = readCard(row.card, cents(row.bandId), text(row.name))
    if (card) cards.push(card)
  }
  const bandRow = rowsOf(db.myBand)[0]
  const myBand: MyBandView | null = bandRow ? {
    bandId: cents(bandRow.bandId),
    status: text(bandRow.status),
    expiresAt: millisOf(bandRow.expiresAt),
  } : null
  const own = rowsOf(db.myMedicalCard)[0]
  const medicalCard = own ? cardView(own, myBand?.bandId ?? 0, '') : null
  if (medicalCard && !cards.some((item) => item.memberId === medicalCard.memberId && item.bloodType === medicalCard.bloodType)) cards.unshift(medicalCard)
  const medicalDocuments: MedicalDocumentView[] = rowsOf(db.myMedicalDocuments).map((row) => ({
    id: String(row.id ?? ''),
    kind: text(row.kind),
    fileHash: text(row.fileHash),
    pageCount: cents(row.pageCount),
    status: text(row.status),
    jobId: String(row.jobId ?? ''),
    dropped: Array.isArray(row.dropped) ? row.dropped.map(text).filter(Boolean) : [],
    uploadedAt: millisOf(row.uploadedAt) ?? 0,
  }))
  const walletRow = rowsOf(db.myWallet)[0]
  const wallet = walletRow ? { accountId: text(walletRow.accountId), balanceCents: cents(walletRow.balanceCents) } : null
  useSession.setState({
    phase: 'live',
    error: null,
    staff,
    owner,
    roles,
    me,
    insurer: policy ? text(policy.insurerName) || 'the insurer' : 'the insurer',
    claims,
    cards,
    myBand,
    medicalCard,
    medicalDocuments,
    wallet,
  })
  syncFloor(db)
  scheduleCatalog(db)
}

async function call<T>(work: () => Promise<T>): Promise<T> {
  pendingActions += 1
  useSession.setState({ busy: true, actionError: null })
  try {
    const result = await work()
    publish()
    return result
  } catch (error) {
    useSession.setState({ actionError: messageOf(error) })
    throw error
  } finally {
    pendingActions -= 1
    useSession.setState({ busy: pendingActions > 0 })
  }
}

function reducers(): Reducers {
  if (!conn) throw new Error('The database is not connected.')
  return (conn as unknown as { reducers: Reducers }).reducers
}

/** Return a wristband to the pool. The attendee keeps their profile. */
export async function releaseBand(bandId: number): Promise<void> {
  await call(() => reducers().releaseBand({ bandId }))
}

function bandIdFromToken(token: string): number | null {
  const match = /^BANDIT-(\d{1,3})$/.exec(token)
  return match ? Number(match[1]) : null
}

async function claimTargetBand(token: string): Promise<void> {
  if (!conn) throw new Error('The database is not connected.')
  const current = useSession.getState().myBand
  if (current?.bandId === bandIdFromToken(token)) {
    if (current.status === 'claimed') return
    if (current.status === 'waiting_for_press' && (current.expiresAt === null || current.expiresAt > Date.now())) return
  }
  const pending = claimRequests.get(token)
  if (pending) return pending
  const request = (async () => { await reducers().claimBand({ token }); publish() })()
  claimRequests.set(token, request)
  try {
    await request
  } finally {
    claimRequests.delete(token)
  }
}

function requireClaimedBand(bandId?: number | null): void {
  const state = useSession.getState()
  if (!conn || state.phase !== 'live') throw new Error('The database is not connected.')
  if (!state.myBandReady) throw new Error('Your band is still being checked. Try again in a moment.')
  if (state.myBand?.status !== 'claimed' || (bandId != null && state.myBand.bandId !== bandId)) {
    throw new Error('Press the button on your band to finish claiming it first.')
  }
}

/** The secret stays in memory. The database only receives its SHA-256. */
function uploadSession(): Promise<string> {
  if (!apiSession) {
    apiSession = (async () => {
      const bytes = crypto.getRandomValues(new Uint8Array(32))
      const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
      const tokenHash = await sha256(new TextEncoder().encode(token).buffer)
      await reducers().openApiSession({ tokenHash })
      return token
    })().catch((error: unknown) => {
      apiSession = null
      throw error
    })
  }
  return apiSession
}

async function loadActors(): Promise<Actor[]> {
  try {
    const res = await fetch('/api/actors')
    if (!res.ok) return []
    const data: unknown = await res.json()
    if (!Array.isArray(data)) return []
    return data.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const row = item as { name?: unknown; label?: unknown; token?: unknown }
      if (typeof row.name !== 'string' || typeof row.token !== 'string') return []
      return [{ name: row.name, label: typeof row.label === 'string' ? row.label : row.name, token: row.token }]
    })
  } catch {
    return []
  }
}

function storedToken(database: string): string | undefined {
  const id = window.localStorage.getItem('bandit-id-token') ?? undefined
  const kept = window.localStorage.getItem(`bandit-token:${database}`) ?? window.localStorage.getItem('bandit-token') ?? undefined
  return id || kept
}

function safePublish() {
  try {
    publish()
  } catch (error) {
    console.warn('[stdb] row update failed', messageOf(error))
  }
}

function wireTables(db: unknown) {
  const tables = db as Record<string, { onInsert?: (cb: () => void) => void; onDelete?: (cb: () => void) => void; onUpdate?: (cb: () => void) => void }>
  for (const table of Object.values(tables)) {
    table?.onInsert?.(safePublish)
    table?.onDelete?.(safePublish)
    table?.onUpdate?.(safePublish)
  }
}

/** Ask the gateway to light a real band. Confirmation stays on the command row, not this call. */
export function sendBandPattern(bandId: number, pattern: string): void {
  if (!conn || !Number.isInteger(bandId) || bandId < 0 || bandId > 255) return
  const send = (conn as unknown as { reducers: { sendCommand?: (args: { target: number; name: string; arg: number; arg2: number }) => Promise<unknown> } }).reducers.sendCommand
  if (!send) return
  void send({ target: bandId, name: pattern, arg: 0, arg2: 0 }).catch((error) => {
    console.warn('[stdb] send_command failed', messageOf(error))
  })
}

/** Each attendee view is its own subscription, independent of the floor and every other view. */
function subscribeAttendeeViews(next: DbConnection) {
  const views = [
    ['my_band', 'myBandReady'],
    ['my_medical_documents', 'medicalDocumentsReady'],
    ['my_medical_card', 'medicalCardReady'],
    ['my_wallet', null],
  ] as const
  for (const [view, readiness] of views) {
    next.subscriptionBuilder()
      .onApplied(() => {
        if (conn !== next) return
        if (readiness) useSession.setState({ [readiness]: true })
        safePublish()
      })
      .onError((...args: unknown[]) => {
        if (conn !== next) return
        const reason = messageOf(args[1] ?? args[0])
        if (view === 'my_wallet') useSession.setState({ walletError: reason })
        else useSession.setState({ signupError: reason })
      })
      .subscribe(`SELECT * FROM ${view}`)
  }
}

function connect(token: string | undefined, played: boolean, host: HostConfig) {
  const key = `bandit-token:${host.database}`
  return new Promise<void>((resolve, reject) => {
    console.info('[stdb] connecting', { database: host.database, anonymous: !token })
    DbConnection.builder()
      .withUri(host.spacetimeUrl)
      .withDatabaseName(host.database)
      .withToken(token)
      .onConnect((next, identity, newToken) => {
        conn = next
        apiSession = null
        claimRequests.clear()
        useSession.setState({
          phase: 'live', error: null, me: identity.toHexString(),
          myBand: null, myBandReady: false,
          medicalDocuments: [], medicalDocumentsReady: false,
          medicalCard: null, medicalCardReady: false,
          signupError: null, wallet: null, walletError: null,
        })
        console.info('[stdb] connected', identity.toHexString())
        if (!played && newToken) window.localStorage.setItem(key, newToken)
        wireTables(next.db)
        subscribeAttendeeViews(next)
        next
          .subscriptionBuilder()
          .onApplied(() => {
            console.info('[stdb] floor subscription applied')
            safePublish()
            resolve()
            // One query at a time. A view that never answers must not hold the rest of the desk.
            const pending = [...(token ? STAFF_QUERIES : []), ...DESK_QUERIES]
            const subscribeNext = () => {
              const query = pending.shift()
              if (!query) return
              let moved = false
              const go = () => {
                if (moved) return
                moved = true
                subscribeNext()
              }
              const timer = window.setTimeout(go, 4000)
              next
                .subscriptionBuilder()
                .onApplied(() => {
                  window.clearTimeout(timer)
                  if (token) useSession.setState({ staffViews: 'open', staffError: null })
                  safePublish()
                  go()
                })
                .onError((...args: unknown[]) => {
                  window.clearTimeout(timer)
                  const reason = messageOf(args[1] ?? args[0])
                  console.warn('[stdb] query refused', query, reason)
                  if (token) useSession.setState({ staffError: reason || 'A staff view was refused.' })
                  go()
                })
                .subscribe(query)
            }
            subscribeNext()
          })
          .onError(() => {
            console.warn('[stdb] floor subscription refused')
            reject(new Error('The floor subscription was refused.'))
          })
          .subscribe(FLOOR_QUERIES)
      })
      .onConnectError((_ctx, error) => {
        console.warn('[stdb] connect error', messageOf(error))
        reject(error instanceof Error ? error : new Error(messageOf(error)))
      })
      .onDisconnect((_ctx, error) => {
        conn = null
        apiSession = null
        console.warn('[stdb] disconnected', error ? messageOf(error) : '')
        noteDisconnect('Connection lost.')
      })
      .build()
  })
}

async function open() {
  useSession.setState({ phase: 'connecting', error: null })
  const host = await loadHostConfig()
  const as = new URLSearchParams(window.location.search).get('as')
  const actors = await loadActors()
  useSession.setState({ actors })
  const played = actors.find((actor) => actor.name === as)
  if (as && !played) {
    useSession.setState({ actionError: `No test identity named ${as}.` })
  }
  const token = played?.token ?? storedToken(host.database)
  try {
    await connect(token, Boolean(played), host)
  } catch (error) {
    if (token && token === storedToken(host.database) && !played) {
      window.localStorage.removeItem(`bandit-token:${host.database}`)
      window.localStorage.removeItem('bandit-token')
      try {
        await connect(undefined, false, host)
        return
      } catch (retry) {
        useSession.setState({ phase: 'error', error: messageOf(retry) })
        return
      }
    }
    useSession.setState({ phase: 'error', error: messageOf(error) })
  }
}

export function startSession() {
  if (import.meta.env.MODE === 'test') return
  if (opening) return
  opening = open()
}

export const useSession = create<SessionState>((set, get) => ({
  phase: 'idle',
  error: null,
  actionError: null,
  busy: false,
  staff: false,
  owner: false,
  roles: [],
  me: '',
  insurer: 'the insurer',
  claims: [],
  cards: [],
  myBand: null,
  myBandReady: false,
  medicalDocuments: [],
  medicalDocumentsReady: false,
  medicalCard: null,
  medicalCardReady: false,
  signupError: null,
  wallet: null,
  walletError: null,
  actors: [],
  staffViews: 'pending',
  staffError: null,
  approve: async (id) => {
    const claim = get().claims.find((item) => item.id === id)
    if (!claim) return
    if (!conn) {
      if (import.meta.env.MODE !== 'test') {
        set({ actionError: 'The database is not connected.' })
        return
      }
      set({
        claims: get().claims.map((item) => (item.id === id ? { ...item, status: 'Settled', statusNote: 'Approved from this desk.' } : item)),
      })
      return
    }
    await call(() =>
      reducers().approveClaim({
        claimId: BigInt(claim.id),
        amountSeenCents: BigInt(claim.payoutCents),
        packHashSeen: claim.packHash,
        learn: false,
      }),
    )
  },
  refuse: async (id, reason) => {
    const claim = get().claims.find((item) => item.id === id)
    if (!claim) return
    const trimmed = reason.trim()
    if (!trimmed) {
      set({ actionError: 'A refusal needs a reason.' })
      return
    }
    if (!conn) {
      if (import.meta.env.MODE !== 'test') {
        set({ actionError: 'The database is not connected.' })
        return
      }
      set({
        claims: get().claims.map((item) => (item.id === id ? { ...item, status: 'Refused', statusNote: trimmed } : item)),
        actionError: null,
      })
      return
    }
    await call(() => reducers().refuseClaim({ claimId: BigInt(claim.id), packHashSeen: claim.packHash, reason: trimmed }))
  },
  requestCard: async (bandId) => {
    await call(() => reducers().requestMedicalCard({ bandId }))
  },
  claimBand: async (token) => {
    await call(() => claimTargetBand(token))
  },
  registerBand: async (token, name) => {
    await call(async () => {
      await claimTargetBand(token)
      requireClaimedBand(bandIdFromToken(token))
      await reducers().updateProfile({ displayName: name, findable: false })
      set({ walletError: null })
      try {
        await reducers().connectWallet({})
      } catch (error) {
        set({ walletError: messageOf(error) })
      }
    })
  },
  submitMedicalDocument: async (file, kind) => call(async () => {
    requireClaimedBand()
    const invalid = validateMedicalFile(file)
    if (invalid) throw new Error(invalid)
    const session = await uploadSession()
    const blob = await uploadBlob(file, kind, session)
    requireClaimedBand()
    await reducers().submitMedicalDocument({ kind, fileHash: blob.hash, pageCount: blob.pageCount })
    return { hash: blob.hash }
  }),
  retryMedicalDocument: async (id) => {
    await call(async () => {
      requireClaimedBand()
      const doc = get().medicalDocuments.find((item) => item.id === id)
      if (!doc) throw new Error('This document is no longer available. Choose the file again.')
      if (doc.kind !== 'insurance' && doc.kind !== 'history') throw new Error('This document cannot be retried here.')
      if (doc.status !== 'failed') throw new Error('This document has not failed. Wait for it to finish reading.')
      await reducers().submitMedicalDocument({ kind: doc.kind, fileHash: doc.fileHash, pageCount: doc.pageCount })
    })
  },
  confirmMedicalCard: async () => {
    await call(async () => {
      requireClaimedBand()
      if (!get().medicalCardReady || !get().medicalCard) throw new Error('Still reading your documents. Wait for your card to arrive.')
      if (get().medicalDocuments.some((doc) => doc.status === 'reading')) throw new Error('Still reading your documents. Wait for every document to finish.')
      await reducers().confirmMedicalCard({})
    })
  },
  connectWallet: async () => {
    await call(() => reducers().connectWallet({}))
  },
}))

noteDisconnect = (message) => useSession.setState({
  phase: 'error', error: message,
  myBandReady: false, medicalDocumentsReady: false, medicalCardReady: false,
})

/** What the desk tests render. No database connection. */
export function seedSession(claims: BoardClaim[], extras?: Partial<Pick<SessionState,
  'staff' | 'owner' | 'insurer' | 'cards' | 'wallet' | 'phase' | 'me' | 'roles' |
  'myBand' | 'myBandReady' | 'medicalDocuments' | 'medicalDocumentsReady' |
  'medicalCard' | 'medicalCardReady' | 'signupError' | 'walletError'
>>) {
  useSession.setState({
    phase: 'live',
    error: null,
    actionError: null,
    staff: true,
    owner: true,
    insurer: 'Northline',
    claims,
    cards: [],
    wallet: null,
    myBand: null,
    myBandReady: false,
    medicalDocuments: [],
    medicalDocumentsReady: false,
    medicalCard: null,
    medicalCardReady: false,
    signupError: null,
    walletError: null,
    ...extras,
  })
}
