import { create } from 'zustand'
import type { BoardClaim, BoardFact, BoardCheck } from '@/cover/liveClaims'
import { scheduleCatalog } from './catalog'
import { syncFloor } from './floor'
import { loadHostConfig, type HostConfig } from './host'
import { DbConnection } from './module_bindings'
import { Timestamp } from 'spacetimedb'
import { sha256, uploadBlob, uploadPhoto, validateMedicalFile, type MedicalDocumentKind } from './uploads'
import { dropVenueSetup, subscribeVenueSetup } from './venueSetup'
import { attachLink, currentLink, dropLink } from './link'
import { bindViewer, isViewing, protectViewerReducers, viewedIdentity } from './viewing'
import { schedulePayments } from '@/payments/store'
import {
  readNight,
  type Handle,
  type RecapDeparture,
  type RecapEncounter,
  type RecapPhoto,
  type RecapShared,
  type RecapVisit,
} from '@/recap/night'

export const SPACETIME_URI = import.meta.env.VITE_SPACETIMEDB_URI || 'https://maincloud.spacetimedb.com'
export const SPACETIME_DB = import.meta.env.VITE_SPACETIMEDB_DB || 'bandit-calhacks13-sp82j'

/** Public tables. An anonymous identity can subscribe to these on their own. */
const FLOOR_QUERIES = [
  'SELECT * FROM venue',
  'SELECT * FROM zone',
  'SELECT * FROM band',
  'SELECT * FROM booth',
  'SELECT * FROM command',
  // Public. end_event writes this row, and every band's page reads it to flip to the recap.
  'SELECT * FROM event_state',
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
  'SELECT * FROM board_photos',
  'SELECT * FROM my_merch_orders',
  'SELECT * FROM board_ledger',
  'SELECT * FROM board_lines',
  'SELECT * FROM my_claims',
  'SELECT * FROM open_incidents',
  'SELECT * FROM board_charges',
  'SELECT * FROM board_merch_orders',
  'SELECT * FROM board_wallets',
  'SELECT * FROM board_fee_schedule',
  'SELECT * FROM board_merch_picks',
  'SELECT * FROM claims_board',
  'SELECT * FROM board_rule_proposals',
  'SELECT * FROM board_rules',
  'SELECT * FROM board_organizer_precedents',
  'SELECT * FROM board_policies',
  'SELECT * FROM medic_medical_cards',
]

/** Tables the desk can read without a staff role. Requested one at a time, after the floor. */
const DESK_QUERIES = [
  'SELECT * FROM merch_template',
  'SELECT * FROM organization',
  'SELECT * FROM person',
  'SELECT * FROM social_photos',
  'SELECT * FROM event_graph',
  'SELECT * FROM settings',
  'SELECT * FROM event_state',
  'SELECT * FROM departure',
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
  /** The staff name stored for this sign-in, when the database has one. */
  roleLabel: string
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
  walletEntriesReady: boolean
  chargesReady: boolean
  suggestionsReady: boolean
  merchOrdersReady: boolean
  photosReady: boolean
  /** Refusals of the attendee's payment views, by view name. */
  walletViewErrors: Record<string, string>
  /** True once the public floor subscription, which includes event_state, has applied. */
  eventReady: boolean
  /** True once the host's end_event has landed. The public event_state row. */
  eventEnded: boolean
  eventEndedAt: number | null
  eventName: string
  visits: RecapVisit[]
  encounters: RecapEncounter[]
  handles: Handle[]
  sharedVisits: RecapShared[]
  recapPhotos: RecapPhoto[]
  departure: RecapDeparture | null
  visitsReady: boolean
  encountersReady: boolean
  handlesReady: boolean
  sharedVisitsReady: boolean
  departureReady: boolean
  /** Refusals of the recap views, by view name. */
  recapViewErrors: Record<string, string>
  actors: Actor[]
  /** Whether the staff-only views subscribed. Empty tables still count as open. */
  staffViews: 'pending' | 'open' | 'refused'
  staffError: string | null
  /** Whether this sign-in asked for the staff views at all, and how each one answered. */
  staffRequested: boolean
  staffQueries: Record<string, 'open' | 'refused'>
  approve: (id: string) => Promise<void>
  refuse: (id: string, reason: string) => Promise<void>
  requestCard: (bandId: number) => Promise<void>
  claimBand: (token: string) => Promise<void>
  registerBand: (token: string, name: string) => Promise<void>
  submitMedicalDocument: (file: File, kind: MedicalDocumentKind) => Promise<{ hash: string }>
  retryMedicalDocument: (id: string) => Promise<void>
  confirmMedicalCard: () => Promise<void>
  connectWallet: () => Promise<void>
  approveCharge: (chargeId: string, amountSeenCents: number, packHashSeen: string) => Promise<void>
  waiveCharge: (chargeId: string, reason: string) => Promise<void>
  buyMerchAs: (nodeId: string, templateId: string, photoId: string, size: string) => Promise<void>
  disputeCharge: (chargeId: string, text: string) => Promise<void>
  buyMerch: (templateId: string, photoId: string, size: string) => Promise<void>
  rerunShoppingAgent: () => Promise<void>
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
  approveCharge(args: { chargeId: bigint; amountSeenCents: bigint; packHashSeen: string }): Promise<unknown>
  waiveCharge(args: { chargeId: bigint; reason: string }): Promise<unknown>
  buyMerchAs(args: { nodeId: bigint; templateId: bigint; photoId: bigint; size: string }): Promise<unknown>
  disputeCharge(args: { chargeId: bigint; text: string }): Promise<unknown>
  buyMerch(args: { templateId: bigint; photoId: bigint; size: string }): Promise<unknown>
  rerunShoppingAgent(args: Record<string, never>): Promise<unknown>
  registerPhoto(args: { url: string; takenAt: Timestamp; zoneId: bigint; caption: string }): Promise<unknown>
  approveRuleProposal(args: { proposalId: bigint; ceilingSeenCents: bigint }): Promise<unknown>
  rejectRuleProposal(args: { proposalId: bigint; reason: string }): Promise<unknown>
  setLowVis(args: { on: boolean }): Promise<unknown>
  endEvent(args: Record<string, never>): Promise<unknown>
  reopenEvent(args: Record<string, never>): Promise<unknown>
  leaveEarly(args: { nodeId: bigint }): Promise<unknown>
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
  const roleRows = rowsOf(db.myRoles)
  const roles = roleRows.map((row) => text(row.role)).filter(Boolean)
  const opsLabel = roleRows.find((row) => text(row.role) === 'ops' && text(row.label))
  const roleLabel = text(opsLabel?.label) || roleRows.map((row) => text(row.label)).find((label) => label) || ''
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
  const night = readNight(db)
  useSession.setState({
    phase: 'live',
    error: null,
    staff,
    owner,
    roles,
    roleLabel,
    me,
    insurer: policy ? text(policy.insurerName) || 'the insurer' : 'the insurer',
    claims,
    cards,
    myBand,
    medicalCard,
    medicalDocuments,
    wallet,
    eventEnded: night.eventEnded,
    eventEndedAt: night.eventEndedAt,
    eventName: night.eventName,
    visits: night.visits,
    encounters: night.encounters,
    handles: night.handles,
    sharedVisits: night.sharedVisits,
    recapPhotos: night.photos,
    departure: night.departure,
  })
  syncFloor(db)
  scheduleCatalog(db)
  schedulePayments(db)
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

/** Approve a proposed payment rule at the ceiling on screen. */
export async function approveProposal(id: string, ceilingCents: number): Promise<void> {
  await call(() => reducers().approveRuleProposal({ proposalId: BigInt(id), ceilingSeenCents: BigInt(ceilingCents) }))
}

/** Reject a proposed payment rule. The module keeps the reason. */
export async function rejectProposal(id: string, reason: string): Promise<void> {
  const trimmed = reason.trim()
  if (!trimmed) throw new Error('A rejection needs a reason.')
  await call(() => reducers().rejectRuleProposal({ proposalId: BigInt(id), reason: trimmed }))
}

/** Fire or smoke: every band guides its wearer to the exit colour of its zone. */
export async function setLowVisibility(on: boolean): Promise<void> {
  await call(() => reducers().setLowVis({ on }))
}

/** End the event. Every tap link switches to that person's recap. */
export async function endEvent(): Promise<void> {
  await call(() => reducers().endEvent({}))
}

/** Bring the live event back. */
export async function reopenEvent(): Promise<void> {
  await call(() => reducers().reopenEvent({}))
}

/** Send one attendee home before the doors close. Their recap opens once they are out. */
export async function leaveEarly(nodeId: string): Promise<void> {
  await call(() => reducers().leaveEarly({ nodeId: BigInt(nodeId) }))
}

function bandIdFromToken(token: string): number | null {
  const match = /^BANDIT-(\d{1,3})$/.exec(token)
  return match ? Number(match[1]) : null
}

async function claimTargetBand(token: string): Promise<void> {
  if (!conn) throw new Error('The database is not connected.')
  const current = useSession.getState().myBand
  if (current?.bandId === bandIdFromToken(token) && current.status === 'claimed') return
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
  const mine = state.myBand
  const connected = mine?.status === 'claimed' || mine?.status === 'waiting_for_press'
  if (!mine || !connected || (bandId != null && mine.bandId !== bandId)) {
    throw new Error('This wristband is not connected yet.')
  }
}

/** The secret the ranking endpoints expect in `x-bandit-session`. It stays in memory. */
export function attendeeApiSession(): Promise<string> {
  if (!conn) return Promise.reject(new Error('The database is not connected.'))
  return uploadSession()
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

type FloorLink = { disconnect: () => void; generation: number }

function linkSlot(): { current?: FloorLink } {
  const slot = globalThis as typeof globalThis & { __banditLink?: { current?: FloorLink } }
  if (!slot.__banditLink) slot.__banditLink = {}
  return slot.__banditLink
}

let generation = 0

function safePublish() {
  const current = linkSlot().current
  if (current && current.generation !== generation) return
  try {
    publish()
  } catch (error) {
    console.warn('[stdb] row update failed', messageOf(error))
  }
}

let publishQueued = false

/** A crowd tick updates many rows. Fold them into one read of the tables. */
function queuePublish() {
  if (publishQueued) return
  publishQueued = true
  window.setTimeout(() => {
    publishQueued = false
    safePublish()
  }, 200)
}

function wireTables(db: unknown) {
  const tables = db as Record<string, { onInsert?: (cb: () => void) => void; onDelete?: (cb: () => void) => void; onUpdate?: (cb: () => void) => void }>
  for (const table of Object.values(tables)) {
    table?.onInsert?.(queuePublish)
    table?.onDelete?.(queuePublish)
    table?.onUpdate?.(queuePublish)
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
    ['my_wallet_entries', 'walletEntriesReady'],
    ['my_charges', 'chargesReady'],
    ['my_merch_suggestions', 'suggestionsReady'],
    ['my_merch_orders', 'merchOrdersReady'],
    ['my_photos', 'photosReady'],
    ['my_visits', 'visitsReady'],
    ['my_encounters', 'encountersReady'],
    ['my_handles', 'handlesReady'],
    ['my_shared_visits', 'sharedVisitsReady'],
    ['my_departure', 'departureReady'],
  ] as const
  const paymentViews: readonly string[] = ['my_wallet_entries', 'my_charges', 'my_merch_suggestions', 'my_merch_orders', 'my_photos']
  const recapViews: readonly string[] = ['my_visits', 'my_encounters', 'my_handles', 'my_shared_visits', 'my_departure', 'my_photos']
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
        else if (paymentViews.includes(view)) useSession.setState((state) => ({ walletViewErrors: { ...state.walletViewErrors, [view]: reason } }))
        else if (recapViews.includes(view)) useSession.setState((state) => ({ recapViewErrors: { ...state.recapViewErrors, [view]: reason } }))
        else useSession.setState({ signupError: reason })
      })
      .subscribe(`SELECT * FROM ${view}`)
  }
}

function connect(token: string | undefined, played: boolean, host: HostConfig, view = '') {
  const staffViews = Boolean(token) || Boolean(view)
  const key = `bandit-token:${host.database}`
  // The socket this call handed to the side modules, so a replaced socket closing late leaves the new one alone.
  let linked: DbConnection | null = null
  return new Promise<void>((resolve, reject) => {
    console.info('[stdb] connecting', { database: host.database, anonymous: !token })
    DbConnection.builder()
      .withUri(host.spacetimeUrl)
      .withDatabaseName(host.database)
      .withToken(token)
      .onConnect((next, identity, newToken) => {
        void (async () => {
          if (view) {
            protectViewerReducers(next.reducers)
            await bindViewer(identity.toHexString(), view)
          }
          const slot = linkSlot()
          const previous = slot.current
          generation = (previous?.generation ?? 0) + 1
          slot.current = { disconnect: () => next.disconnect(), generation }
          if (previous && previous.generation !== generation) {
            try {
              previous.disconnect()
            } catch {
              // The replaced socket is already gone.
            }
          }
          conn = next
          apiSession = null
          claimRequests.clear()
          useSession.setState({
            phase: 'live', error: null, me: identity.toHexString(),
            myBand: null, myBandReady: false,
            medicalDocuments: [], medicalDocumentsReady: false,
            medicalCard: null, medicalCardReady: false,
            signupError: null, wallet: null, walletError: null,
            walletEntriesReady: false, chargesReady: false, suggestionsReady: false, merchOrdersReady: false, photosReady: false,
            walletViewErrors: {},
            eventReady: false,
            eventEnded: false, eventEndedAt: null, eventName: '',
            visits: [], encounters: [], handles: [], sharedVisits: [], recapPhotos: [], departure: null,
            visitsReady: false, encountersReady: false, handlesReady: false, sharedVisitsReady: false, departureReady: false,
            recapViewErrors: {},
            staffRequested: staffViews, staffQueries: {},
          })
          console.info('[stdb] connected', identity.toHexString())
          if (!view && !played && newToken) window.localStorage.setItem(key, newToken)
          wireTables(next.db)
          subscribeAttendeeViews(next)
          subscribeVenueSetup(next)
          next
            .subscriptionBuilder()
            .onApplied(() => {
              console.info('[stdb] floor subscription applied')
              if (conn === next) useSession.setState({ eventReady: true })
              safePublish()
              resolve()
              if (conn === next && currentLink() !== next) {
                linked = next
                attachLink(next)
              }
              // One query at a time. A view that never answers must not hold the rest of the desk.
              const pending = [...(staffViews ? STAFF_QUERIES : []), ...DESK_QUERIES]
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
                    if (staffViews) useSession.setState((state) => ({ staffViews: 'open', staffError: null, staffQueries: { ...state.staffQueries, [query]: 'open' } }))
                    safePublish()
                    go()
                  })
                  .onError((...args: unknown[]) => {
                    window.clearTimeout(timer)
                    const reason = messageOf(args[1] ?? args[0])
                    console.warn('[stdb] query refused', query, reason)
                    if (staffViews) useSession.setState((state) => ({ staffError: reason || 'A staff view was refused.', staffQueries: { ...state.staffQueries, [query]: 'refused' } }))
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
        })().catch((error: unknown) => { next.disconnect(); reject(error) })
      })
      .onConnectError((_ctx, error) => {
        console.warn('[stdb] connect error', messageOf(error))
        reject(error instanceof Error ? error : new Error(messageOf(error)))
      })
      .onDisconnect((_ctx, error) => {
        conn = null
        apiSession = null
        dropVenueSetup()
        if (linked && currentLink() === linked) dropLink()
        console.warn('[stdb] disconnected', error ? messageOf(error) : '')
        noteDisconnect('Connection lost.')
      })
      .build()
  })
}

async function open() {
  useSession.setState({ phase: 'connecting', error: null })
  const host = await loadHostConfig()
  if (isViewing()) {
    try { await connect(undefined, true, host, viewedIdentity()) }
    catch (error) { useSession.setState({ phase: 'error', error: messageOf(error) }) }
    return
  }
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

type SessionHot = {
  dispose: (cb: (data: Record<string, unknown>) => void) => void
  data: Record<string, unknown>
}

const sessionHot = (import.meta as ImportMeta & { hot?: SessionHot }).hot
if (sessionHot) {
  sessionHot.dispose((data) => {
    data.restart = true
  })
  if (sessionHot.data.restart) startSession()
}

export const useSession = create<SessionState>((set, get) => ({
  phase: 'idle',
  error: null,
  actionError: null,
  busy: false,
  staff: false,
  owner: false,
  roles: [],
  roleLabel: '',
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
  walletEntriesReady: false,
  chargesReady: false,
  suggestionsReady: false,
  merchOrdersReady: false,
  photosReady: false,
  walletViewErrors: {},
  eventReady: false,
  eventEnded: false,
  eventEndedAt: null,
  eventName: '',
  visits: [],
  encounters: [],
  handles: [],
  sharedVisits: [],
  recapPhotos: [],
  departure: null,
  visitsReady: false,
  encountersReady: false,
  handlesReady: false,
  sharedVisitsReady: false,
  departureReady: false,
  recapViewErrors: {},
  actors: [],
  staffViews: 'pending',
  staffError: null,
  staffRequested: false,
  staffQueries: {},
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
  // The backend compares the amount and pack hash with its own row, so a figure that moved is refused.
  approveCharge: async (chargeId, amountSeenCents, packHashSeen) => {
    await call(() => reducers().approveCharge({ chargeId: BigInt(chargeId), amountSeenCents: BigInt(amountSeenCents), packHashSeen }))
  },
  waiveCharge: async (chargeId, reason) => {
    const trimmed = reason.trim()
    if (!trimmed) throw new Error('Write why the charge is waived.')
    await call(() => reducers().waiveCharge({ chargeId: BigInt(chargeId), reason: trimmed }))
  },
  buyMerchAs: async (nodeId, templateId, photoId, size) => {
    await call(() => reducers().buyMerchAs({ nodeId: BigInt(nodeId), templateId: BigInt(templateId), photoId: BigInt(photoId), size }))
  },
  disputeCharge: async (chargeId, text) => {
    const trimmed = text.trim()
    if (!trimmed) throw new Error('Say what isn’t right.')
    await call(() => reducers().disputeCharge({ chargeId: BigInt(chargeId), text: trimmed }))
  },
  buyMerch: async (templateId, photoId, size) => {
    await call(() => reducers().buyMerch({ templateId: BigInt(templateId), photoId: BigInt(photoId), size }))
  },
  rerunShoppingAgent: async () => {
    await call(() => reducers().rerunShoppingAgent({}))
  },
}))

/** Upload one frame and register it in a zone, so it shows on the organizer photos page. */
export async function fileFrame(file: File, zoneId: string, takenAtMs: number, caption: string): Promise<string> {
  if (!conn) throw new Error('The database is not connected.')
  if (!/^\d+$/.test(zoneId)) throw new Error('Choose the zone where this frame was taken.')
  try {
    const uploaded = await uploadPhoto(file)
    const takenAt = Timestamp.fromDate(new Date(takenAtMs || Date.now()))
    await reducers().registerPhoto({
      url: uploaded.url,
      takenAt,
      zoneId: BigInt(zoneId),
      caption: caption.trim().slice(0, 140),
    })
    publish()
    return uploaded.url
  } catch (error) {
    const message = messageOf(error)
    if (message.includes('needs one of these roles')) throw new Error('This sign-in cannot file frames.')
    throw new Error(message)
  }
}

noteDisconnect = (message) => useSession.setState({
  phase: 'error', error: message,
  myBandReady: false, medicalDocumentsReady: false, medicalCardReady: false,
  walletEntriesReady: false, chargesReady: false, suggestionsReady: false, merchOrdersReady: false, photosReady: false,
  eventReady: false,
  visitsReady: false, encountersReady: false, handlesReady: false, sharedVisitsReady: false, departureReady: false,
})

/** What the desk tests render. No database connection. */
export function seedSession(claims: BoardClaim[], extras?: Partial<Pick<SessionState,
  'staff' | 'owner' | 'insurer' | 'cards' | 'wallet' | 'phase' | 'me' | 'roles' |
  'myBand' | 'myBandReady' | 'medicalDocuments' | 'medicalDocumentsReady' |
  'medicalCard' | 'medicalCardReady' | 'signupError' | 'walletError' |
  'walletEntriesReady' | 'chargesReady' | 'suggestionsReady' | 'merchOrdersReady' | 'photosReady' | 'walletViewErrors' |
  'eventReady' | 'eventEnded' | 'eventEndedAt' | 'eventName' | 'visits' | 'encounters' | 'handles' | 'sharedVisits' | 'recapPhotos' | 'departure' |
  'visitsReady' | 'encountersReady' | 'handlesReady' | 'sharedVisitsReady' | 'departureReady' | 'recapViewErrors' |
  'staffViews' | 'staffError' | 'staffRequested' | 'staffQueries'
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
    walletEntriesReady: false,
    chargesReady: false,
    suggestionsReady: false,
    merchOrdersReady: false,
    photosReady: false,
    walletViewErrors: {},
    eventReady: true,
    eventEnded: false,
    eventEndedAt: null,
    eventName: '',
    visits: [],
    encounters: [],
    handles: [],
    sharedVisits: [],
    recapPhotos: [],
    departure: null,
    visitsReady: false,
    encountersReady: false,
    handlesReady: false,
    sharedVisitsReady: false,
    departureReady: true,
    recapViewErrors: {},
    staffViews: 'pending',
    staffError: null,
    staffRequested: false,
    staffQueries: {},
    ...extras,
  })
}
