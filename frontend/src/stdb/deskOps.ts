/**
 * Staff actions that sit beside the session. The session already holds the socket and the
 * tables it subscribes to. This module watches that socket, subscribes the views the session
 * leaves off, and calls the reducers the map, the venue page, and the claims desk need.
 */
import { create } from 'zustand'
import { DbConnection } from './module_bindings'
import { uploadDeskPdf } from './uploads'

export interface DeskIncident {
  id: string
  kind: string
  status: string
  resolved: boolean
  zoneId: string
  bandId: number
  openedBy: string
  openedAt: number
  resolution: string
}

export interface DeskNote {
  id: string
  incidentId: string
  authorRole: string
  text: string
  costCents: number | null
  createdAt: number
}

export interface DeskCard {
  incidentId: string
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
  notes: string
  confirmed: boolean
}

export interface StaffMember {
  id: string
  email: string
  role: string
  name: string
  signedIn: boolean
}

export interface ViewablePerson {
  key: string
  identity: unknown
  hex: string
  name: string
  role: string
  bandId: number
  crowd: boolean
}

export interface PolicyDocument {
  id: string
  kind: string
  fileHash: string
  pageCount: number
  status: string
  clauseCount: number
  dropped: string[]
  error: string
  source: string
  uploadedAt: number
  confirmedAt: number
}

export interface PolicyTerm {
  id: string
  documentId: string
  coverKind: string
  name: string
  code: string
  shown: string
  readValue: string
  quote: string
  page: number
  status: string
  problem: string
}

export interface PolicyFormFound {
  part: string
  url: string
  formNumber: string
  title: string
  firstPage: number
  pageCount: number
}

export interface PolicyLookup {
  id: string
  insurer: string
  state: string
  liabilityForm: string
  propertyForm: string
  policyNumber: string
  status: string
  forms: PolicyFormFound[]
  note: string
  createdAt: number
}

export interface PolicyCover {
  policyId: string
  coverKind: string
  perClaimLimitCents: number
  aggregateLimitCents: number
  deductibleCents: number
  minimumPayoutCents: number
  serviceWindowDays: number
}

export interface PolicyNow {
  id: string
  policyNumber: string
  insurerName: string
  fnolContact: string
  periodStart: number
  periodEnd: number
  otherInsurance: string
  staffExcluded: boolean
  periodChecked: boolean
}

export interface UnclaimedInjury {
  incidentId: string
  kind: string
  zoneName: string
  bandId: number
  wearerName: string
  openedAt: number
  resolvedAt: number
  notes: string[]
}

export interface FiledClaim {
  id: string
  incidentId: string
  incidentKind: string
  coverKind: string
  status: string
  statusNote: string
  claimantName: string
  fnolHash: string
  summaryHash: string
  determinationHash: string
  recoveryHash: string
}



interface DeskState {
  ready: boolean
  error: string | null
  busy: boolean
  incidents: DeskIncident[]
  notes: DeskNote[]
  cards: DeskCard[]
  staff: StaffMember[]
  people: ViewablePerson[]
  documents: PolicyDocument[]
  terms: PolicyTerm[]
  lookups: PolicyLookup[]
  covers: PolicyCover[]
  policy: PolicyNow | null
  injuries: UnclaimedInjury[]
  filed: FiledClaim[]
}


export const useDesk = create<DeskState>(() => ({
  ready: false,
  error: null,
  busy: false,
  incidents: [],
  notes: [],
  cards: [],
  staff: [],
  people: [],
  documents: [],
  terms: [],
  lookups: [],
  covers: [],
  policy: null,
  injuries: [],
  filed: [],
}))

let conn: DbConnection | null = null
let pending = 0

const EXTRA_QUERIES = [
  'SELECT * FROM board_notes',
  'SELECT * FROM board_staff',
  'SELECT * FROM view_as_people',
  'SELECT * FROM board_policy_documents',
  'SELECT * FROM board_policy_terms',
  'SELECT * FROM board_venue_policy_lookups',
  'SELECT * FROM unclaimed_injuries',
  'SELECT * FROM board_covers',
]

type DeskReducers = {
  openIncident(args: { kind: string; zoneId: bigint; bandId: number; note: string }): Promise<unknown>
  assignMedic(args: { incidentId: bigint }): Promise<unknown>
  addIncidentNote(args: { incidentId: bigint; text: string; costCents?: bigint }): Promise<unknown>
  resolveIncident(args: { incidentId: bigint; resolution: string }): Promise<unknown>
  addStaff(args: { email: string; role: string; name: string }): Promise<unknown>
  removeStaff(args: { id: bigint }): Promise<unknown>
  viewAs(args: { viewer: unknown; target: unknown }): Promise<unknown>
  submitPolicyDocument(args: { fileHash: string; pageCount: number }): Promise<unknown>
  lookUpVenuePolicy(args: {
    insurer: string
    state: string
    liabilityForm: string
    propertyForm: string
    declarations: {
      policyNumber: string
      fnolContact: string
      periodStart: string
      periodEnd: string
      medicalLimitCents: bigint
      medicalAggregateCents: bigint
      propertyLimitCents: bigint
      propertyDeductibleCents: bigint
    }
  }): Promise<unknown>
  confirmPolicyTerms(args: { documentId: bigint }): Promise<unknown>
  submitMedicalRecord(args: { claimId: bigint; fileHash: string; pageCount: number }): Promise<unknown>
  fileClaimForWearer(args: { incidentId: bigint; statement: string; report: string }): Promise<unknown>
  retryClaimPayout(args: { claimId: bigint }): Promise<unknown>
  requestRecoveryLetter(args: { claimId: bigint; counterpartyName: string; counterpartyContact: string }): Promise<unknown>
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return 'The database refused that.'
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number {
  const n = typeof value === 'bigint' ? Number(value) : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function tag(value: unknown): string {
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

function millisOf(value: unknown): number {
  if (value && typeof value === 'object' && 'tag' in value) {
    const tagged = value as { tag?: unknown; value?: unknown }
    if (tagged.tag === 'none' || tagged.tag === 'None') return 0
    if (tagged.tag === 'some' || tagged.tag === 'Some') return millisOf(tagged.value)
  }
  if (value && typeof value === 'object' && 'toDate' in value) {
    const fn = (value as { toDate: unknown }).toDate
    if (typeof fn === 'function') {
      const time = (fn.call(value) as Date).getTime()
      return Number.isFinite(time) ? time : 0
    }
  }
  return 0
}

function rowsOf(table: unknown): Record<string, unknown>[] {
  if (!table || typeof table !== 'object' || !('iter' in table)) return []
  const iter = (table as { iter: unknown }).iter
  if (typeof iter !== 'function') return []
  return [...(iter.call(table) as Iterable<Record<string, unknown>>)]
}

function list(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean).join(', ')
  return text(value)
}

function someRow(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  const tagged = value as { tag?: unknown; value?: unknown }
  if (tagged.tag === 'none' || tagged.tag === 'None') return null
  const row = (tagged.tag === 'some' || tagged.tag === 'Some' ? tagged.value : value) as Record<string, unknown>
  return row && typeof row === 'object' ? row : null
}

function reducers(): DeskReducers {
  if (!conn) throw new Error('The database is not connected.')
  return (conn as unknown as { reducers: DeskReducers }).reducers
}

function readOwner() {
  if (!conn) return
  const db = conn.db as unknown as Record<string, unknown>
  const incidents: DeskIncident[] = rowsOf(db.openIncidents).map((row) => ({
    id: String(row.id ?? ''),
    kind: tag(row.kind).toLowerCase(),
    status: tag(row.status).toLowerCase(),
    resolved: row.resolved === true,
    zoneId: String(row.zoneId ?? ''),
    bandId: num(row.subjectBand),
    openedBy: text(row.openedBy),
    openedAt: millisOf(row.openedAt),
    resolution: text(row.resolution),
  }))
  const notes: DeskNote[] = rowsOf(db.boardNotes).map((row) => {
    const cost = row.costCents
    const missing = cost && typeof cost === 'object' && 'tag' in cost && ((cost as { tag?: unknown }).tag === 'none' || (cost as { tag?: unknown }).tag === 'None')
    return {
      id: String(row.id ?? ''),
      incidentId: String(row.incidentId ?? ''),
      authorRole: text(row.authorRole),
      text: text(row.text),
      costCents: missing || cost == null ? null : num(cost && typeof cost === 'object' && 'value' in cost ? (cost as { value: unknown }).value : cost),
      createdAt: millisOf(row.createdAt),
    }
  })
  const cards: DeskCard[] = []
  for (const row of rowsOf(db.medicMedicalCards)) {
    const card = someRow(row.card)
    if (!card) continue
    cards.push({
      incidentId: String(row.incidentId ?? ''),
      bandId: num(row.bandId),
      name: text(row.name) || text(card.name),
      bloodType: text(card.bloodType),
      allergies: list(card.allergies),
      conditions: list(card.conditions),
      medications: list(card.medications),
      emergencyContact: text(card.emergencyContact),
      insurer: text(card.insurer),
      plan: text(card.plan),
      memberId: text(card.memberId),
      notes: text(card.notes),
      confirmed: text(card.status).toLowerCase() === 'confirmed',
    })
  }
  const staff: StaffMember[] = rowsOf(db.boardStaff)
    .map((row) => ({
      id: String(row.id ?? ''),
      email: text(row.email),
      role: text(row.role),
      name: text(row.name),
      signedIn: someRow(row.account) != null || (row.account != null && typeof row.account === 'object' && !('tag' in row.account && ((row.account as { tag?: unknown }).tag === 'none' || (row.account as { tag?: unknown }).tag === 'None'))),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const people: ViewablePerson[] = rowsOf(db.viewAsPeople).map((row) => {
    const hex = hexOf(row.identity)
    const role = text(row.role)
    return {
      key: `${role} ${hex}`,
      identity: row.identity,
      hex,
      name: text(row.name),
      role,
      bandId: num(row.bandId),
      crowd: row.crowd === true,
    }
  })
  const documents: PolicyDocument[] = rowsOf(db.boardPolicyDocuments)
    .filter((row) => text(row.kind) === 'venue_policy' || text(row.kind) === '')
    .map((row) => ({
      id: String(row.id ?? ''),
      kind: text(row.kind),
      fileHash: text(row.fileHash),
      pageCount: num(row.pageCount),
      status: text(row.status),
      clauseCount: num(row.clauseCount),
      dropped: Array.isArray(row.dropped) ? row.dropped.map(text).filter(Boolean) : [],
      error: text(row.error),
      source: text(row.source),
      uploadedAt: millisOf(row.uploadedAt),
      confirmedAt: millisOf(row.confirmedAt),
    }))
    .sort((a, b) => Number(b.id) - Number(a.id))
  const terms: PolicyTerm[] = rowsOf(db.boardPolicyTerms).map((row) => ({
    id: String(row.id ?? ''),
    documentId: String(row.documentId ?? ''),
    coverKind: text(row.coverKind),
    name: text(row.name),
    code: text(row.code),
    shown: text(row.shown),
    readValue: text(row.readValue),
    quote: text(row.quote),
    page: num(row.page),
    status: text(row.status),
    problem: text(row.problem),
  }))
  const lookups: PolicyLookup[] = rowsOf(db.boardVenuePolicyLookups)
    .map((row) => ({
      id: String(row.id ?? ''),
      insurer: text(row.insurer),
      state: text(row.state),
      liabilityForm: text(row.liabilityForm),
      propertyForm: text(row.propertyForm),
      policyNumber: text(row.policyNumber),
      status: text(row.status),
      forms: Array.isArray(row.forms)
        ? row.forms.flatMap((item) => {
            if (!item || typeof item !== 'object') return []
            const form = item as Record<string, unknown>
            return [{
              part: text(form.part),
              url: text(form.url),
              formNumber: text(form.formNumber),
              title: text(form.title),
              firstPage: num(form.firstPage),
              pageCount: num(form.pageCount),
            }]
          })
        : [],
      note: text(row.note),
      createdAt: millisOf(row.createdAt),
    }))
    .sort((a, b) => b.createdAt - a.createdAt || Number(b.id) - Number(a.id))
  const covers: PolicyCover[] = rowsOf(db.boardCovers).map((row) => ({
    policyId: String(row.policyId ?? ''),
    coverKind: text(row.coverKind),
    perClaimLimitCents: num(row.perClaimLimitCents),
    aggregateLimitCents: num(row.aggregateLimitCents),
    deductibleCents: num(row.deductibleCents),
    minimumPayoutCents: num(row.minimumPayoutCents),
    serviceWindowDays: num(row.serviceWindowDays),
  }))
  const policyRow = rowsOf(db.boardPolicies).sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0))[0]
  const policy: PolicyNow | null = policyRow
    ? {
        id: String(policyRow.id ?? ''),
        policyNumber: text(policyRow.policyNumber),
        insurerName: text(policyRow.insurerName),
        fnolContact: text(policyRow.fnolContact),
        periodStart: millisOf(policyRow.periodStart),
        periodEnd: millisOf(policyRow.periodEnd),
        otherInsurance: text(policyRow.otherInsurance),
        staffExcluded: policyRow.staffExcluded === true,
        periodChecked: policyRow.periodChecked === true,
      }
    : null
  const injuries: UnclaimedInjury[] = rowsOf(db.unclaimedInjuries)
    .map((row) => ({
      incidentId: String(row.incidentId ?? ''),
      kind: text(row.kind),
      zoneName: text(row.zoneName),
      bandId: num(row.bandId),
      wearerName: text(row.wearerName),
      openedAt: millisOf(row.openedAt),
      resolvedAt: millisOf(row.resolvedAt),
      notes: Array.isArray(row.notes) ? row.notes.map(text).filter(Boolean) : [],
    }))
    .sort((a, b) => Number(a.incidentId) - Number(b.incidentId))
  const filed: FiledClaim[] = rowsOf(db.claimsBoard).map((row) => ({
    id: String(row.id ?? ''),
    incidentId: String(row.incidentId ?? ''),
    incidentKind: text(row.incidentKind),
    coverKind: text(row.coverKind),
    status: tag(row.status),
    statusNote: text(row.statusNote),
    claimantName: text(row.claimantName),
    fnolHash: text(row.fnolHash),
    summaryHash: text(row.summaryHash),
    determinationHash: text(row.determinationHash),
    recoveryHash: text(row.recoveryHash),
  }))
  useDesk.setState({ incidents, notes, cards, staff, people, documents, terms, lookups, covers, policy, injuries, filed })
}


function watch(table: unknown, read: () => void) {
  const t = table as { onInsert?: (cb: () => void) => void; onDelete?: (cb: () => void) => void; onUpdate?: (cb: () => void) => void } | undefined
  t?.onInsert?.(read)
  t?.onDelete?.(read)
  t?.onUpdate?.(read)
}

function subscribeExtras(next: DbConnection) {
  const pendingQueries = [...EXTRA_QUERIES]
  const step = () => {
    const query = pendingQueries.shift()
    if (!query || conn !== next) return
    let moved = false
    const go = () => {
      if (moved) return
      moved = true
      step()
    }
    const timer = window.setTimeout(go, 4000)
    next
      .subscriptionBuilder()
      .onApplied(() => {
        window.clearTimeout(timer)
        if (conn === next) {
          useDesk.setState({ ready: true, error: null })
          readOwner()
        }
        go()
      })
      .onError((...args: unknown[]) => {
        window.clearTimeout(timer)
        if (conn === next) useDesk.setState({ error: messageOf(args[1] ?? args[0]) })
        go()
      })
      .subscribe(query)
  }
  step()
}

/** Called from the venue subscription, which already receives the live socket. */
export function attachDesk(next: DbConnection) {
  conn = next
  const db = next.db as unknown as Record<string, unknown>
  for (const name of ['openIncidents', 'boardNotes', 'medicMedicalCards', 'boardStaff', 'viewAsPeople', 'boardPolicyDocuments', 'boardPolicyTerms', 'boardVenuePolicyLookups', 'boardCovers', 'boardPolicies', 'unclaimedInjuries', 'claimsBoard']) {
    watch(db[name], () => {
      if (conn === next) readOwner()
    })
  }
  readOwner()
  subscribeExtras(next)
}

export function detachDesk() {
  conn = null
  useDesk.setState({ ready: false })
}

async function call<T>(work: () => Promise<T>): Promise<T> {
  pending += 1
  useDesk.setState({ busy: true, error: null })
  try {
    const result = await work()
    readOwner()
    return result
  } catch (error) {
    const message = messageOf(error)
    useDesk.setState({ error: message })
    throw new Error(message)
  } finally {
    pending -= 1
    useDesk.setState({ busy: pending > 0 })
  }
}

export function incidentForBand(bandId: number): DeskIncident | undefined {
  return useDesk.getState().incidents.find((row) => row.bandId === bandId && !row.resolved)
}

/** Opens a fall or SOS when the map is showing the band before the incident row arrives. */
export async function ensureIncident(bandId: number, kind: string, zoneId: string): Promise<string> {
  const existing = incidentForBand(bandId)
  if (existing) return existing.id
  await call(() => reducers().openIncident({ kind, zoneId: BigInt(zoneId), bandId, note: '' }))
  for (let n = 0; n < 30; n += 1) {
    const row = incidentForBand(bandId)
    if (row) return row.id
    await new Promise((resolve) => window.setTimeout(resolve, 100))
  }
  throw new Error('The incident did not open.')
}

export async function assignMedic(incidentId: string): Promise<void> {
  await call(() => reducers().assignMedic({ incidentId: BigInt(incidentId) }))
}

export async function addIncidentNote(incidentId: string, note: string, costCents: bigint | null): Promise<void> {
  const textNote = note.trim()
  if (!textNote) throw new Error('Write the note first.')
  await call(() => reducers().addIncidentNote({
    incidentId: BigInt(incidentId),
    text: textNote,
    ...(costCents == null ? {} : { costCents }),
  }))
}

export async function resolveModuleIncident(incidentId: string, resolution: string): Promise<void> {
  await call(() => reducers().resolveIncident({ incidentId: BigInt(incidentId), resolution }))
}

export async function addStaffMember(email: string, role: string, name: string): Promise<void> {
  const trimmed = { email: email.trim(), role, name: name.trim() }
  if (!trimmed.name) throw new Error('Type their name.')
  if (!trimmed.email.includes('@')) throw new Error('Type the email they sign in with.')
  await call(() => reducers().addStaff(trimmed))
}

export async function removeStaffMember(id: string): Promise<void> {
  await call(() => reducers().removeStaff({ id: BigInt(id) }))
}

export async function submitPolicyFile(file: File): Promise<void> {
  await call(async () => {
    const blob = await uploadDeskPdf(file, 'policy')
    await reducers().submitPolicyDocument({ fileHash: blob.hash, pageCount: blob.pageCount })
  })
}

export interface PolicyLookupInput {
  insurer: string
  state: string
  liabilityForm: string
  propertyForm: string
  policyNumber: string
  fnolContact: string
  periodStart: string
  periodEnd: string
  medicalLimitCents: bigint
  medicalAggregateCents: bigint
  propertyLimitCents: bigint
  propertyDeductibleCents: bigint
}

export async function lookUpPolicy(input: PolicyLookupInput): Promise<void> {
  await call(() => reducers().lookUpVenuePolicy({
    insurer: input.insurer.trim(),
    state: input.state.trim(),
    liabilityForm: input.liabilityForm.trim(),
    propertyForm: input.propertyForm.trim(),
    declarations: {
      policyNumber: input.policyNumber.trim(),
      fnolContact: input.fnolContact.trim(),
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      medicalLimitCents: input.medicalLimitCents,
      medicalAggregateCents: input.medicalAggregateCents,
      propertyLimitCents: input.propertyLimitCents,
      propertyDeductibleCents: input.propertyDeductibleCents,
    },
  }))
}

export async function confirmPolicy(documentId: string): Promise<void> {
  await call(() => reducers().confirmPolicyTerms({ documentId: BigInt(documentId) }))
}

export async function submitClinicRecord(claimId: string, file: File): Promise<void> {
  await call(async () => {
    const blob = await uploadDeskPdf(file, 'medical')
    await reducers().submitMedicalRecord({ claimId: BigInt(claimId), fileHash: blob.hash, pageCount: blob.pageCount })
  })
}

export async function fileClaim(incidentId: string, statement: string, report: string): Promise<void> {
  const words = statement.trim()
  if (!words) throw new Error('Write what happened, in their words.')
  await call(() => reducers().fileClaimForWearer({ incidentId: BigInt(incidentId), statement: words, report }))
}

export async function retryPayout(claimId: string): Promise<void> {
  await call(() => reducers().retryClaimPayout({ claimId: BigInt(claimId) }))
}

export async function askRecoveryLetter(claimId: string, name: string, contact: string): Promise<void> {
  const counterpartyName = name.trim()
  const counterpartyContact = contact.trim()
  if (!counterpartyName || !counterpartyContact) throw new Error('Name who was handling the equipment, and how to reach them.')
  await call(() => reducers().requestRecoveryLetter({ claimId: BigInt(claimId), counterpartyName, counterpartyContact }))
}
