/**
 * Settlements, rule approval and the merch desk. This module rides the session's socket through
 * link.ts: it subscribes the claim evidence views the session leaves off, copies the rows it needs
 * into a store, and calls the settlement, rule and merch reducers.
 */
import { create } from 'zustand'
import { formatCents, parseDollars } from '@/cover/money'
import { bandFromCode } from '@/lib/bandCode'
import { bandLabel } from '@/payments/model'
import type { DbConnection } from './module_bindings'
import { linkDb, linkReducers, messageOf, millisOf, num, onLink, rowsOf, someOf, subscribeEach, tag, text, watchTables } from './link'
import { useSession } from './session'

export interface SettleClaim {
  id: string
  incidentId: string
  incidentKind: string
  coverKind: string
  claimantName: string
  bandId: number
  zoneName: string
  policyId: string
  /** The status variant, lowercased: awaitingrecord, readingrecord, verifying, reviewing, routed, paying, settled, refused, reconciled. */
  status: string
  statusNote: string
  packVersion: number
  packHash: string
  corroboration: string
  costCents: number
  payoutCents: number
  recoverableCents: number
  venueCostCents: number
  reviewVerdict: string
  decidedBy: string
  settlementRuleId: string
  settlementRuleVersion: number
  routedToName: string
  refusalReason: string
  payoutReference: string
  fnolHash: string
  summaryHash: string
  determinationHash: string
  recoveryHash: string
  openedAt: number
  decidedAt: number
  settledAt: number
  reconciledAt: number
  updatedAt: number
  statement: string
}

export interface ClaimReview {
  id: string
  claimId: string
  packVersion: number
  verdict: string
  causation: string
  summary: string
  concerns: string[]
  innocentExplanations: string[]
  missingEvidence: string[]
  citedFactIds: number[]
  rejected: string[]
  createdAt: number
}

export interface ClaimRecord {
  id: string
  claimId: string
  fileHash: string
  pageCount: number
  status: string
  documentKind: string
  patientName: string
  providerName: string
  dateOfService: string
  invoiceNumber: string
  reasonForVisit: string
  history: string
  diagnoses: string[]
  billedCents: number
  coveredCents: number
  dropped: string[]
  submittedAt: number
  extractedAt: number
}

export interface ClinicReport {
  id: string
  claimId: string
  scenario: string
  choice: string
  visitDate: string
  status: string
  providerName: string
  fileHash: string
  problems: string[]
  requestedAt: number
  receivedAt: number
}

export interface ClaimApproval {
  id: string
  claimId: string
  approverName: string
  approverRole: string
  decision: string
  amountSeenCents: number
  learn: boolean
  requestedCeilingCents: number | null
  reason: string
  decidedAt: number
}

export interface ClaimClause {
  id: string
  claimId: string
  packVersion: number
  clauseId: string
  policy: string
  section: string
  page: number
  text: string
  score: number
}

export interface ClaimDecision {
  id: string
  at: number
  incidentId: string
  claimId: string
  actor: string
  who: string
  what: string
  why: string
}

export interface EvidenceFact {
  id: string
  seq: number
  source: string
  key: string
  value: string
  observedAt: number
  reader: string
  reference: string
}

export interface EvidenceCheck {
  id: string
  name: string
  result: string
  detail: string
  reader: string
  createdAt: number
}

export interface BilledLine {
  id: string
  lineNo: number
  code: string
  description: string
  billedCents: number
  allowedCents: number
  coveredCents: number
  outcome: string
  reason: string
}

export interface LedgerEntry {
  id: string
  journalId: string
  journal: string
  account: string
  debitCents: number
  creditCents: number
  memo: string
  postedAt: number
}

export interface ResponsibleCharge {
  id: string
  incidentId: string
  claimId: string
  attendeeName: string
  bandId: number
  namedByName: string
  namedByRole: string
  note: string
  amountCents: number
  status: string
}

export interface PolicyBrief {
  id: string
  insurerName: string
  policyNumber: string
}

export interface RuleBrief {
  id: string
  version: number
  approverName: string
  ceilingCents: number
}

export interface SettleOrder {
  id: string
  nodeId: string
  attendeeName: string
  templateId: string
  title: string
  size: string
  amountCents: number
  status: string
  failure: string
  nessiePurchaseId: string
  createdAt: number
  line: string
  photoUrl: string
}

export interface MerchTemplateRow {
  id: string
  name: string
  title: string
  kind: string
  priceCents: number
  imageUrl: string
  width: number
  height: number
  photoX: number
  photoY: number
  photoW: number
  photoH: number
  boothIds: string[]
}

export interface MerchPick {
  id: string
  nodeId: string
  attendeeName: string
  rank: number
  templateId: string
  photoId: string
  photoUrl: string
  line: string
  reason: string
  createdAt: number
}

export interface EventPhoto {
  id: string
  url: string
  takenAt: number
  zoneName: string
  caption: string
  nodeIds: string[]
  peopleCount: number
  read: boolean
}

export interface AttendeeWallet {
  nodeId: string
  name: string
  bandId: number
  accountId: string
  balanceCents: number
}

interface SettlementState {
  error: string | null
  busy: boolean
  claims: Record<string, SettleClaim>
  reviews: Record<string, ClaimReview>
  records: Record<string, ClaimRecord>
  extractedRecords: Record<string, ClaimRecord>
  clinicReports: Record<string, ClinicReport>
  approvals: Record<string, ClaimApproval[]>
  clauses: Record<string, ClaimClause[]>
  decisions: Record<string, ClaimDecision[]>
  facts: Record<string, EvidenceFact[]>
  checks: Record<string, EvidenceCheck[]>
  lines: Record<string, BilledLine[]>
  ledger: Record<string, LedgerEntry[]>
  /** The latest charge named on each incident, by incident id. */
  charges: Record<string, ResponsibleCharge>
  policies: Record<string, PolicyBrief>
  rules: Record<string, RuleBrief>
  zones: Record<string, string>
  bandNames: Record<number, string>
  orders: SettleOrder[]
  shipping: Record<string, string>
  templates: MerchTemplateRow[]
  picks: MerchPick[]
  photos: EventPhoto[]
  wallets: AttendeeWallet[]
  booths: Record<string, string>
}

type Rows = Pick<
  SettlementState,
  | 'claims'
  | 'reviews'
  | 'records'
  | 'extractedRecords'
  | 'clinicReports'
  | 'approvals'
  | 'clauses'
  | 'decisions'
  | 'facts'
  | 'checks'
  | 'lines'
  | 'ledger'
  | 'charges'
  | 'policies'
  | 'rules'
  | 'zones'
  | 'bandNames'
  | 'orders'
  | 'shipping'
  | 'templates'
  | 'picks'
  | 'photos'
  | 'wallets'
  | 'booths'
>

const EMPTY_ROWS: Rows = {
  claims: {},
  reviews: {},
  records: {},
  extractedRecords: {},
  clinicReports: {},
  approvals: {},
  clauses: {},
  decisions: {},
  facts: {},
  checks: {},
  lines: {},
  ledger: {},
  charges: {},
  policies: {},
  rules: {},
  zones: {},
  bandNames: {},
  orders: [],
  shipping: {},
  templates: [],
  picks: [],
  photos: [],
  wallets: [],
  booths: {},
}

export const useSettlement = create<SettlementState>(() => ({ error: null, busy: false, ...EMPTY_ROWS }))

/** Stable empty lists for selectors, so a claim with no rows does not re-render every time. */
export const NONE: readonly never[] = Object.freeze([])

/** The views the session does not subscribe. claim_clauses takes the claim id and is asked for per claim. */
export const SETTLEMENT_QUERIES = [
  'SELECT * FROM board_reviews',
  'SELECT * FROM board_records',
  'SELECT * FROM board_approvals',
  'SELECT * FROM board_clinic_reports',
  'SELECT * FROM decision',
  'SELECT * FROM board_merch_shipping',
] as const

const WATCHED = [
  'claimsBoard',
  'boardReviews',
  'boardRecords',
  'boardApprovals',
  'boardClinicReports',
  'claimClauses',
  'decision',
  'boardFacts',
  'boardChecks',
  'boardLines',
  'boardLedger',
  'boardCharges',
  'boardPolicies',
  'boardRules',
  'zone',
  'boardAttendees',
  'boardMerchOrders',
  'boardMerchShipping',
  'merchTemplate',
  'boardMerchPicks',
  'boardPhotos',
  'boardWallets',
  'booth',
] as const

type SettlementReducers = {
  recordInsurerPayment(args: { claimId: bigint; amountCents: bigint; reference: string }): Promise<unknown>
  nameResponsibleBand(args: { incidentId: bigint; bandId: number; note: string }): Promise<unknown>
  approveRuleScopeReview(args: { proposalId: bigint; ceilingSeenCents: bigint; scopeSeen: string }): Promise<unknown>
  approveRuleProposal(args: { proposalId: bigint; ceilingSeenCents: bigint }): Promise<unknown>
  rerunShoppingAgent(args: Record<string, never>): Promise<unknown>
  buyMerchAsWithShipping(args: {
    nodeId: bigint
    templateId: bigint
    photoId: bigint
    size: string
    shippingAddress: string
  }): Promise<unknown>
}

let linked: DbConnection | null = null
let clauseClaims = new Set<string>()
let timer: number | null = null
let pending = 0

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : []
}

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? value.map(num) : []
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

function idOf(value: unknown): string {
  return value == null ? '' : String(value)
}

function optionalCents(value: unknown): number | null {
  const inner = someOf(value)
  return inner == null ? null : num(inner)
}

function byId(a: { id: string }, b: { id: string }): number {
  return Number(a.id) - Number(b.id)
}

function group<T>(rows: T[], key: (row: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const row of rows) {
    const k = key(row)
    ;(out[k] ??= []).push(row)
  }
  return out
}

/** The row with the highest id for each claim. */
function latest<T extends { id: string; claimId: string }>(rows: T[]): Record<string, T> {
  const out: Record<string, T> = {}
  for (const row of rows) {
    const held = out[row.claimId]
    if (!held || Number(row.id) > Number(held.id)) out[row.claimId] = row
  }
  return out
}

function readClaim(row: Record<string, unknown>): SettleClaim {
  return {
    id: idOf(row.id),
    incidentId: idOf(row.incidentId),
    incidentKind: text(row.incidentKind),
    coverKind: text(row.coverKind),
    claimantName: text(row.claimantName),
    bandId: num(row.bandId),
    zoneName: text(row.zoneName),
    policyId: idOf(row.policyId),
    status: tag(row.status),
    statusNote: text(row.statusNote),
    packVersion: num(row.packVersion),
    packHash: text(row.packHash),
    corroboration: text(row.corroboration),
    costCents: num(row.costCents),
    payoutCents: num(row.payoutCents),
    recoverableCents: num(row.recoverableCents),
    venueCostCents: num(row.venueCostCents),
    reviewVerdict: text(row.reviewVerdict),
    decidedBy: text(row.decidedBy),
    settlementRuleId: num(row.settlementRuleId) ? idOf(row.settlementRuleId) : '',
    settlementRuleVersion: num(row.settlementRuleVersion),
    routedToName: text(row.routedToName),
    refusalReason: text(row.refusalReason),
    payoutReference: text(row.payoutReference),
    fnolHash: text(row.fnolHash),
    summaryHash: text(row.summaryHash),
    determinationHash: text(row.determinationHash),
    recoveryHash: text(row.recoveryHash),
    openedAt: millisOf(row.openedAt),
    decidedAt: millisOf(row.decidedAt),
    settledAt: millisOf(row.settledAt),
    reconciledAt: millisOf(row.reconciledAt),
    updatedAt: millisOf(row.updatedAt),
    statement: text(row.statement),
  }
}

/** Copy every watched table off the current socket into the store. */
export function readSettlement(): void {
  const db = linkDb()
  if (!db) return

  const claimList = rowsOf(db.claimsBoard).map(readClaim)
  const claims: Record<string, SettleClaim> = {}
  for (const claim of claimList) claims[claim.id] = claim
  const packOf = (claimId: string) => claims[claimId]?.packVersion

  const reviewRows: ClaimReview[] = rowsOf(db.boardReviews).map((row) => ({
    id: idOf(row.id),
    claimId: idOf(row.claimId),
    packVersion: num(row.packVersion),
    verdict: text(row.verdict),
    causation: text(row.causation),
    summary: text(row.summary),
    concerns: strings(row.concerns),
    innocentExplanations: strings(row.innocentExplanations),
    missingEvidence: strings(row.missingEvidence),
    citedFactIds: numbers(row.citedFactIds),
    rejected: strings(row.rejected),
    createdAt: millisOf(row.createdAt),
  }))
  // The review of the newest evidence pack wins; within a pack, the latest review.
  const reviews: Record<string, ClaimReview> = {}
  for (const review of reviewRows) {
    const held = reviews[review.claimId]
    if (!held || review.packVersion > held.packVersion || (review.packVersion === held.packVersion && Number(review.id) > Number(held.id))) {
      reviews[review.claimId] = review
    }
  }

  const recordRows: ClaimRecord[] = rowsOf(db.boardRecords).map((row) => ({
    id: idOf(row.id),
    claimId: idOf(row.claimId),
    fileHash: text(row.fileHash),
    pageCount: num(row.pageCount),
    status: text(row.status),
    documentKind: text(row.documentKind),
    patientName: text(row.patientName),
    providerName: text(row.providerName),
    dateOfService: text(row.dateOfService),
    invoiceNumber: text(row.invoiceNumber),
    reasonForVisit: text(row.reasonForVisit),
    history: text(row.history),
    diagnoses: strings(row.diagnoses),
    billedCents: num(row.billedCents),
    coveredCents: num(row.coveredCents),
    dropped: strings(row.dropped),
    submittedAt: millisOf(row.submittedAt),
    extractedAt: millisOf(row.extractedAt),
  }))
  const records = latest(recordRows)
  const extractedRecords = latest(recordRows.filter((row) => row.status === 'extracted'))

  const clinicReports = latest<ClinicReport>(
    rowsOf(db.boardClinicReports).map((row) => ({
      id: idOf(row.id),
      claimId: idOf(row.claimId),
      scenario: text(row.scenario),
      choice: text(row.choice),
      visitDate: text(row.visitDate),
      status: text(row.status),
      providerName: text(row.providerName),
      fileHash: text(row.fileHash),
      problems: strings(row.problems),
      requestedAt: millisOf(row.requestedAt),
      receivedAt: millisOf(row.receivedAt),
    })),
  )

  const approvals = group<ClaimApproval>(
    rowsOf(db.boardApprovals)
      .map((row) => ({
        id: idOf(row.id),
        claimId: idOf(row.claimId),
        approverName: text(row.approverName),
        approverRole: text(row.approverRole),
        decision: text(row.decision),
        amountSeenCents: num(row.amountSeenCents),
        learn: row.learn === true,
        requestedCeilingCents: optionalCents(row.requestedCeilingCents),
        reason: text(row.reason),
        decidedAt: millisOf(row.decidedAt),
      }))
      .sort(byId),
    (row) => row.claimId,
  )

  // Clauses: only the newest evidence pack's search counts, best match first.
  const clauseRows: ClaimClause[] = rowsOf(db.claimClauses).map((row) => ({
    id: idOf(row.id),
    claimId: idOf(row.claimId),
    packVersion: num(row.packVersion),
    clauseId: text(row.clauseId),
    policy: text(row.policy),
    section: text(row.section),
    page: num(row.page),
    text: text(row.text),
    score: num(row.score),
  }))
  const clauses: Record<string, ClaimClause[]> = {}
  for (const [claimId, rows] of Object.entries(group(clauseRows, (row) => row.claimId))) {
    const newest = Math.max(0, ...rows.map((row) => row.packVersion))
    clauses[claimId] = rows.filter((row) => row.packVersion === newest).sort((a, b) => b.score - a.score)
  }

  const decisions = group<ClaimDecision>(
    rowsOf(db.decision)
      .map((row) => ({
        id: idOf(row.id),
        at: millisOf(row.at),
        incidentId: idOf(row.incidentId),
        claimId: idOf(row.claimId),
        actor: text(row.actor),
        who: text(row.who),
        what: text(row.what),
        why: text(row.why),
      }))
      .filter((row) => row.claimId !== '' && row.claimId !== '0')
      .sort(byId),
    (row) => row.claimId,
  )

  const facts = group<EvidenceFact & { claimId: string }>(
    rowsOf(db.boardFacts)
      .filter((row) => num(row.packVersion) === packOf(idOf(row.claimId)))
      .map((row) => ({
        id: idOf(row.id),
        claimId: idOf(row.claimId),
        seq: num(row.seq),
        source: text(row.source),
        key: text(row.key),
        value: text(row.value),
        observedAt: millisOf(row.observedAt),
        reader: text(row.reader),
        reference: text(row.reference),
      }))
      .sort((a, b) => a.seq - b.seq),
    (row) => row.claimId,
  )

  const checks = group<EvidenceCheck & { claimId: string }>(
    rowsOf(db.boardChecks)
      .filter((row) => num(row.packVersion) === packOf(idOf(row.claimId)))
      .map((row) => ({
        id: idOf(row.id),
        claimId: idOf(row.claimId),
        name: text(row.name),
        result: text(row.result),
        detail: text(row.detail),
        reader: text(row.reader),
        createdAt: millisOf(row.createdAt),
      }))
      .sort(byId),
    (row) => row.claimId,
  )

  const lines = group<BilledLine & { claimId: string }>(
    rowsOf(db.boardLines)
      .map((row) => ({
        id: idOf(row.id),
        claimId: idOf(row.claimId),
        lineNo: num(row.lineNo),
        code: text(row.code),
        description: text(row.description),
        billedCents: num(row.billedCents),
        allowedCents: num(row.allowedCents),
        coveredCents: num(row.coveredCents),
        outcome: text(row.outcome),
        reason: text(row.reason),
      }))
      .sort((a, b) => a.lineNo - b.lineNo),
    (row) => row.claimId,
  )

  const ledger = group<LedgerEntry & { claimId: string }>(
    rowsOf(db.boardLedger)
      .map((row) => ({
        id: idOf(row.id),
        claimId: idOf(row.claimId),
        journalId: idOf(row.journalId),
        journal: text(row.journal),
        account: text(row.account),
        debitCents: num(row.debitCents),
        creditCents: num(row.creditCents),
        memo: text(row.memo),
        postedAt: millisOf(row.postedAt),
      }))
      .sort(byId),
    (row) => row.claimId,
  )

  const charges: Record<string, ResponsibleCharge> = {}
  for (const row of rowsOf(db.boardCharges)) {
    const charge: ResponsibleCharge = {
      id: idOf(row.id),
      incidentId: idOf(row.incidentId),
      claimId: idOf(row.claimId),
      attendeeName: text(row.attendeeName),
      bandId: num(row.bandId),
      namedByName: text(row.namedByName),
      namedByRole: text(row.namedByRole),
      note: text(row.note),
      amountCents: num(row.amountCents),
      status: text(row.status),
    }
    const held = charges[charge.incidentId]
    if (!held || Number(charge.id) > Number(held.id)) charges[charge.incidentId] = charge
  }

  const policies: Record<string, PolicyBrief> = {}
  for (const row of rowsOf(db.boardPolicies)) {
    policies[idOf(row.id)] = { id: idOf(row.id), insurerName: text(row.insurerName), policyNumber: text(row.policyNumber) }
  }

  const rules: Record<string, RuleBrief> = {}
  for (const row of rowsOf(db.boardRules)) {
    rules[idOf(row.id)] = { id: idOf(row.id), version: num(row.version), approverName: text(row.approverName), ceilingCents: num(row.ceilingCents) }
  }

  const zones: Record<string, string> = {}
  for (const row of rowsOf(db.zone)) zones[idOf(row.id)] = text(row.name)

  const people = new Map<string, { name: string; bandId: number }>()
  const bandNames: Record<number, string> = {}
  for (const row of rowsOf(db.boardAttendees)) {
    const nodeId = idOf(row.nodeId)
    const bandId = num(row.bandId)
    const name = text(row.displayName)
    people.set(nodeId, { name, bandId })
    if (bandId) bandNames[bandId] = name
  }

  const orders: SettleOrder[] = rowsOf(db.boardMerchOrders)
    .map((row) => ({
      id: idOf(row.id),
      nodeId: idOf(row.nodeId),
      attendeeName: text(row.attendeeName),
      templateId: idOf(row.templateId),
      title: text(row.title),
      size: text(row.size),
      amountCents: num(row.amountCents),
      status: text(row.status),
      failure: text(row.failure),
      nessiePurchaseId: text(row.nessiePurchaseId),
      createdAt: millisOf(row.createdAt),
      line: text(row.line),
      photoUrl: text(row.photoUrl),
    }))
    .sort((a, b) => byId(b, a))

  const shipping: Record<string, string> = {}
  for (const row of rowsOf(db.boardMerchShipping)) shipping[idOf(row.orderId)] = text(row.shippingAddress)

  const templates: MerchTemplateRow[] = rowsOf(db.merchTemplate)
    .map((row) => ({
      id: idOf(row.id),
      name: text(row.name),
      title: text(row.title),
      kind: text(row.kind),
      priceCents: num(row.priceCents),
      imageUrl: text(row.imageUrl),
      width: num(row.width),
      height: num(row.height),
      photoX: num(row.photoX),
      photoY: num(row.photoY),
      photoW: num(row.photoW),
      photoH: num(row.photoH),
      boothIds: ids(row.boothIds),
    }))
    .sort(byId)

  const picks: MerchPick[] = rowsOf(db.boardMerchPicks)
    .map((row) => ({
      id: idOf(row.id),
      nodeId: idOf(row.nodeId),
      attendeeName: text(row.attendeeName),
      rank: num(row.rank),
      templateId: idOf(row.templateId),
      photoId: idOf(row.photoId),
      photoUrl: text(row.photoUrl),
      line: text(row.line),
      reason: text(row.reason),
      createdAt: millisOf(row.createdAt),
    }))
    .sort((a, b) => a.attendeeName.localeCompare(b.attendeeName) || a.rank - b.rank)

  const photos: EventPhoto[] = rowsOf(db.boardPhotos)
    .map((row) => ({
      id: idOf(row.id),
      url: text(row.url),
      takenAt: millisOf(row.takenAt),
      zoneName: text(row.zoneName),
      caption: text(row.caption),
      nodeIds: ids(row.nodeIds),
      peopleCount: num(row.peopleCount),
      read: row.read === true,
    }))
    .sort((a, b) => b.takenAt - a.takenAt || byId(b, a))

  const wallets: AttendeeWallet[] = rowsOf(db.boardWallets)
    .flatMap((row) => {
      const nodeId = idOf(row.nodeId)
      const person = people.get(nodeId)
      if (!person) return []
      return [{ nodeId, name: person.name || 'no name yet', bandId: person.bandId, accountId: text(row.accountId), balanceCents: num(row.balanceCents) }]
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const booths: Record<string, string> = {}
  for (const row of rowsOf(db.booth)) booths[idOf(row.id)] = text(row.name)

  useSettlement.setState({
    claims,
    reviews,
    records,
    extractedRecords,
    clinicReports,
    approvals,
    clauses,
    decisions,
    facts,
    checks,
    lines,
    ledger,
    charges,
    policies,
    rules,
    zones,
    bandNames,
    orders,
    shipping,
    templates,
    picks,
    photos,
    wallets,
    booths,
  })
}

function schedule() {
  if (timer != null) return
  timer = window.setTimeout(() => {
    timer = null
    readSettlement()
  }, 30)
}

function attach(conn: DbConnection) {
  linked = conn
  clauseClaims = new Set()
  watchTables(conn, WATCHED, schedule)
  readSettlement()
  subscribeEach(conn, SETTLEMENT_QUERIES, { applied: schedule })
}

function drop() {
  linked = null
  clauseClaims = new Set()
  if (timer != null) window.clearTimeout(timer)
  timer = null
  useSettlement.setState({ ...EMPTY_ROWS, busy: false })
}

onLink(attach, drop)

/** claim_clauses is a view that takes the claim id, so each claim on screen asks for its own. */
export function watchClaimClauses(claimId: string): void {
  if (!linked || !/^\d+$/.test(claimId) || clauseClaims.has(claimId)) return
  clauseClaims.add(claimId)
  subscribeEach(linked, [`SELECT * FROM claim_clauses(${claimId})`], { applied: schedule })
}

function reducers(): SettlementReducers {
  return linkReducers<SettlementReducers>()
}

async function call(work: () => Promise<unknown>): Promise<void> {
  pending += 1
  useSettlement.setState({ busy: true, error: null })
  try {
    await work()
    readSettlement()
  } catch (error) {
    const message = messageOf(error)
    useSettlement.setState({ error: message })
    throw new Error(message)
  } finally {
    pending -= 1
    useSettlement.setState({ busy: pending > 0 })
  }
}

/** True when this sign-in may use the settlement and merch forms. */
export function isOps(state: { owner: boolean; roles: string[] }): boolean {
  return state.owner || state.roles.includes('ops')
}

/** Dollars as typed into the insurer payment field, in cents. Zero is allowed: an insurer can pay nothing. */
export function insurerCents(value: string): number | null {
  if (/^0+(\.0{1,2})?$/.test(value.trim())) return 0
  return parseDollars(value)
}

/** A band as staff type it: 7, 07, Band 07, BANDIT-07 or its tag code like K3QX-9A7M. */
export function parseBandNumber(value: string): number | null {
  const q = value.trim()
  const match = /^(?:bandit-|band\s*)?(\d{1,9})$/i.exec(q)
  if (match) {
    const id = Number(match[1])
    return Number.isInteger(id) && id > 0 && id <= 0xffffffff ? id : null
  }
  return bandFromCode(q.replace(/^band\s+/i, '')) || null
}

export async function recordInsurerPayment(claimId: string, dollars: string, reference: string): Promise<void> {
  await call(async () => {
    const cents = insurerCents(dollars)
    if (cents == null) throw new Error('The amount is in dollars, for example 180.00.')
    await reducers().recordInsurerPayment({ claimId: BigInt(claimId), amountCents: BigInt(cents), reference: reference.trim() })
  })
}

export async function nameResponsibleBand(incidentId: string, band: string, note: string): Promise<void> {
  await call(async () => {
    const bandId = parseBandNumber(band)
    if (bandId == null) throw new Error(`${band.trim() || 'That'} is not a band number. A band number looks like 07.`)
    await reducers().nameResponsibleBand({ incidentId: BigInt(incidentId), bandId, note: note.trim() })
  })
}

/**
 * Approve a proposed payment rule at the ceiling on screen. A scope that needs review goes through
 * approve_rule_scope_review with the rule text as the scope seen; every other proposal through
 * approve_rule_proposal. A refusal also lands in the session's actionError, which the rules page shows.
 */
export async function approveRule(proposal: { id: string; status: string; ceilingCents: number; rule: string }): Promise<void> {
  const proposalId = BigInt(proposal.id)
  const ceilingSeenCents = BigInt(Math.round(proposal.ceilingCents))
  useSession.setState({ actionError: null })
  try {
    await call(() =>
      proposal.status === 'scope_proposed'
        ? reducers().approveRuleScopeReview({ proposalId, ceilingSeenCents, scopeSeen: proposal.rule })
        : reducers().approveRuleProposal({ proposalId, ceilingSeenCents }),
    )
  } catch (error) {
    useSession.setState({ actionError: messageOf(error) })
    throw error
  }
}

export async function rerunShoppingAgent(): Promise<void> {
  await call(() => reducers().rerunShoppingAgent({}))
}

export const ADDRESS_LIMIT = 1000

export async function buyAsAttendee(input: { nodeId: string; templateId: string; photoId: string; size: string; shippingAddress: string }): Promise<void> {
  await call(async () => {
    const shippingAddress = input.shippingAddress.trim()
    if (!shippingAddress) throw new Error('Write the shipping address.')
    if (shippingAddress.length > ADDRESS_LIMIT) throw new Error('The shipping address is longer than 1,000 characters.')
    await reducers().buyMerchAsWithShipping({
      nodeId: BigInt(input.nodeId),
      templateId: BigInt(input.templateId),
      photoId: BigInt(input.photoId),
      size: input.size,
      shippingAddress,
    })
  })
}

// ---------------------------------------------------------------------------------------------
// Wording shared by the claim docket and the merch desk.

const MEDICAL_KINDS = new Set(['sos', 'fall'])
const COVER: Record<string, string> = { medical_payments: 'medical payments', medical: 'medical', property: 'property' }

/** Who the payout goes to. */
export function payeeOf(claim: Pick<SettleClaim, 'coverKind' | 'incidentKind' | 'claimantName'>): string {
  if (claim.coverKind !== 'property') return `${claim.claimantName || 'the claimant'}'s wallet`
  return claim.incidentKind === 'theft' ? 'the venue, to replace what was stolen' : 'the repair vendor'
}

export function isPayoutFailed(claim: Pick<SettleClaim, 'status' | 'statusNote'>): boolean {
  return claim.status === 'paying' && /payout failed/i.test(claim.statusNote)
}

/** What the insurer has paid back on this claim: the cash debits of its J4 journals. */
export function insurerPaidCents(ledger: readonly LedgerEntry[]): number {
  return ledger.filter((row) => row.journal.startsWith('J4') && row.account === 'cash').reduce((sum, row) => sum + row.debitCents, 0)
}

/** One sentence on what the claim waits for. Routed claims are left to the docket's own line. */
export function waitingLine(claim: SettleClaim, hasClinicReport: boolean, ledger: readonly LedgerEntry[]): string {
  switch (claim.status) {
    case 'awaitingrecord':
      if (!MEDICAL_KINDS.has(claim.incidentKind)) return 'Waiting for the evidence to be gathered.'
      return hasClinicReport ? 'Waiting for the hospital report.' : "Waiting for the medical record: upload the clinic's report below."
    case 'readingrecord':
      return 'Waiting for the Evidence Engine to read the hospital report.'
    case 'verifying':
      return 'Waiting for the Elastic checks.'
    case 'reviewing':
      return "Waiting for the claims agent's review."
    case 'paying':
      if (isPayoutFailed(claim)) return `Approved. The payout to ${payeeOf(claim)} failed and waits for a retry.`
      return `Approved. Paying ${formatCents(claim.payoutCents)} to ${payeeOf(claim)}.`
    case 'settled':
      return `Paid out. Waiting for the insurer to pay ${formatCents(claim.recoverableCents)} back.`
    case 'refused':
      return 'Refused: nothing is paid. Nothing is waiting.'
    case 'reconciled':
      if (!ledger.some((row) => row.journal.startsWith('J4') && row.account === 'cash')) return 'Closed: the insurer payment is recorded. Nothing is waiting.'
      return `Closed: the insurer paid ${formatCents(insurerPaidCents(ledger))} back. Nothing is waiting.`
    default:
      return ''
  }
}

/** Cost, paid out, insurer pays back, the venue carries. Empty when nothing is costed yet. */
export function whoPays(claim: SettleClaim, policy: PolicyBrief | undefined): [string, number][] {
  if (!claim.costCents && !claim.payoutCents) return []
  const cover = `${COVER[claim.coverKind] ?? claim.coverKind.replaceAll('_', ' ')} cover${claim.incidentKind === 'theft' ? ', theft as a cause of loss' : ''}`
  const insurer = policy ? `Insurer pays back: ${policy.insurerName}, policy ${policy.policyNumber}, ${cover}` : 'Insurer pays back'
  const rows: [string, number][] = [
    ['Cost', claim.costCents],
    [`Paid out to ${payeeOf(claim)}`, claim.payoutCents],
    [insurer, claim.recoverableCents],
    ['The venue carries (deductible)', claim.venueCostCents],
  ]
  if (claim.costCents > claim.payoutCents) rows.push(['Not covered', claim.costCents - claim.payoutCents])
  return rows
}

export function letterLinks(claim: Pick<SettleClaim, 'fnolHash' | 'summaryHash' | 'determinationHash' | 'recoveryHash'>): { href: string; label: string }[] {
  const all: [string, string][] = [
    [claim.fnolHash, 'First notice of loss to the insurer'],
    [claim.summaryHash, 'Approver summary'],
    [claim.determinationHash, 'Claimant letter'],
    [claim.recoveryHash, 'Recovery letter'],
  ]
  return all.filter(([hash]) => hash).map(([hash, label]) => ({ href: `/blobs/${hash}`, label }))
}

/** "Oct 25, 04:12", or just the time when it falls on `sameDayAs`. */
export function stamp(ms: number, sameDayAs = 0): string {
  if (!ms) return ''
  const date = new Date(ms)
  if (sameDayAs && new Date(sameDayAs).toDateString() === date.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ---------------------------------------------------------------------------------------------
// How the evidence was gathered and weighed: one line per step, in time order.

export interface TrailStep {
  at: number
  source: string
  text: string
}

export interface TrailInput {
  claim: SettleClaim
  facts: readonly EvidenceFact[]
  checks: readonly EvidenceCheck[]
  decisions: readonly ClaimDecision[]
  review: ClaimReview | undefined
  approvals: readonly ClaimApproval[]
  clinic: ClinicReport | undefined
  record: ClaimRecord | undefined
  ledger: readonly LedgerEntry[]
  rules: Record<string, RuleBrief>
  zones: Record<string, string>
  bandNames: Record<number, string>
}

const INCIDENT: Record<string, string> = { fall: 'Fall', sos: 'SOS', property: 'Property damage', theft: 'Theft from the venue', breakage: 'Property damage' }
const OPENER: Record<string, string> = { band: 'the band', ops: 'the organizer', medic: 'a medic', vision: 'the venue camera' }

interface FactGroup {
  source: string
  reference: string
  at: number
  values: Map<string, string[]>
}

function groupFacts(facts: readonly EvidenceFact[]): FactGroup[] {
  const out: FactGroup[] = []
  for (const fact of facts) {
    const last = out[out.length - 1]
    const same = last && last.source === fact.source && last.reference === fact.reference && last.at === fact.observedAt
    const target = same ? last : { source: fact.source, reference: fact.reference, at: fact.observedAt, values: new Map<string, string[]>() }
    if (!same) out.push(target)
    target.values.set(fact.key, [...(target.values.get(fact.key) ?? []), fact.value])
  }
  return out
}

function centsText(value: string): string {
  const n = Number(value || 0)
  return formatCents(Number.isFinite(n) ? n : 0)
}

export function buildTrail(input: TrailInput): TrailStep[] {
  const { claim } = input
  const steps: TrailStep[] = []
  const add = (at: number, source: string, line: string) => {
    if (at) steps.push({ at, source, text: line })
  }
  const band = (id: number) => {
    const name = input.bandNames[id] || (id === claim.bandId ? claim.claimantName : '')
    return `${bandLabel(id)}${name ? ` (${name})` : ''}`
  }
  const zone = (id: string) => (id === '0' || !id ? 'no zone' : input.zones[id] || `zone ${id}`)
  const listOf = (value: string) => (value === 'none' || !value ? [] : value.split(', '))

  const groups = groupFacts(input.facts)
  for (let i = 0; i < groups.length; i += 1) {
    const head = groups[i]
    const v = (key: string) => head.values.get(key)?.[0] ?? ''
    const run = (source: string) => {
      const taken = [head]
      while (groups[i + 1]?.source === source) {
        i += 1
        taken.push(groups[i])
      }
      return taken
    }
    switch (head.source) {
      case 'incident_snapshot':
        if (head.values.has('incident_kind')) {
          add(head.at, 'Incident', `${INCIDENT[v('incident_kind')] ?? v('incident_kind')} opened by ${OPENER[v('opened_by')] ?? v('opened_by')} in ${zone(v('zone_id'))}`)
        } else {
          const circle = listOf(v('circle_bands')).map((id) => band(Number(id)))
          const lit = groups.some((item) => item.source === 'light_circle')
          const tail = lit ? '' : `; ${circle.length ? `light circle on ${circle.join(', ')}` : 'no band showed the light circle'}`
          add(head.at, 'Bands around it', `${v('band_count')} bands in the zone, about ${v('neigh_mean')} close to each${tail}`)
        }
        break
      case 'band_report': {
        const flag = v('fall_flag') === '1' ? 'fall' : v('sos_flag') === '1' ? 'SOS' : 'alert'
        add(head.at, 'Band', `${band(Number(v('band_id')))} raised the ${flag} flag, ${v('neigh')} bands close by, heard by station ${v('station_id')}`)
        break
      }
      case 'light_circle': {
        const taken = run('light_circle')
        const witnesses = taken.map((item) => {
          const [, id, , zoneId, , dbm] = (item.values.get('witness')?.[0] ?? '').split(' ')
          return `${band(Number(id))} in ${zone(zoneId ?? '')}${dbm && dbm !== '0' ? `, ${dbm} dBm` : ''}`
        })
        const first = taken.reduce((a, b) => (b.at < a.at ? b : a))
        add(first.at, 'Light circle', `${witnesses.length} ${witnesses.length === 1 ? 'band' : 'bands'} around it lit the light circle: ${witnesses.join('; ')}`)
        break
      }
      case 'staff_note': {
        const cost = v('cost_cents')
        add(head.at, 'Staff note', `${v('note')}${cost ? ` (${centsText(cost)})` : ''}`)
        break
      }
      case 'zone_context': {
        const near = listOf(v('nearby_booths'))
        const now = v('schedule_now')
        add(head.at, 'Venue', `${v('zone_name')} (${v('zone_kind')}, capacity ${v('zone_capacity')})${now && now !== 'none' ? `; ${now} was on` : ''}${near.length ? `; near ${near.join(', ')}` : ''}`)
        break
      }
      case 'presence': {
        const taken = run('presence')
        add(taken[0].at, 'Where the band was', taken.map((item) => item.values.get('zone_stay')?.[0] ?? '').join(', then '))
        break
      }
      case 'vision_assessment': {
        let frames = 0
        while (groups[i + 1]?.source === 'vision_assessment' && !groups[i + 1].values.has('vision_confirmed')) {
          i += 1
          frames += 1
        }
        if (head.values.has('vision_confirmed')) {
          const seen = v('vision_confirmed') === 'yes' ? 'Confirmed' : 'Did not confirm'
          add(head.at, 'Camera', `${seen} it (${v('vision_confidence')} sure): ${v('vision_description')}; ${frames} ${frames === 1 ? 'frame' : 'frames'} kept`)
        }
        break
      }
      case 'policy':
        add(
          head.at,
          'Policy',
          `${v('policy_number')} with ${v('insurer')}: ${v('cover_kind').replace('_', ' ')}, up to ${centsText(v('per_claim_limit_cents'))} a claim, deductible ${centsText(v('deductible_cents'))}, ${centsText(v('aggregate_remaining_cents'))} left`,
        )
        break
      case 'responsible_party': {
        const where = [v('band_in_zone') === 'yes' && 'was in the zone', v('band_at_spot') === 'yes' && 'was at the spot'].filter(Boolean).join(' and ')
        const by = v('named_by') === 'medic' ? 'medic' : 'organizer'
        const note = v('naming_note')
        add(head.at, 'Named', `The ${by} named ${v('responsible_name')}, ${band(Number(v('responsible_band')))}, as who did it${where ? `; the band ${where}` : ''}${note ? `: ${note}` : ''}`)
        break
      }
      default:
        break
    }
  }

  const claimant = claim.claimantName || 'no claimant'
  add(claim.openedAt, 'Claim', claim.statement ? `${claimant} filed the claim: "${claim.statement}"` : `Claim opened for ${claimant}`)

  const clinic = input.clinic
  if (clinic) {
    add(clinic.requestedAt, 'Hospital', 'Hospital report requested')
    if (clinic.status === 'received') add(clinic.receivedAt, 'Hospital', `Hospital report received from ${clinic.providerName}, visit ${clinic.visitDate}`)
    if (clinic.status === 'failed') add(clinic.receivedAt || clinic.requestedAt, 'Hospital', `The hospital report failed: ${clinic.problems.join('; ')}`)
  }

  const record = input.record
  if (record) {
    if (!clinic) add(record.submittedAt, 'Medical record', 'Medical record filed')
    const at = record.extractedAt || record.submittedAt
    if (record.status === 'extracted') {
      add(at, 'Evidence Engine', `Read the record: ${record.documentKind} for ${record.patientName} from ${record.providerName} on ${record.dateOfService}; ${record.diagnoses.join('; ')}; billed ${formatCents(record.billedCents)}, covered ${formatCents(record.coveredCents)}`)
    } else if (record.status !== 'reading') {
      add(at, 'Evidence Engine', `Could not read the record: ${record.dropped.join('; ')}`)
    }
  }

  for (const reader of ['code', 'elastic', 'model']) {
    const mine = input.checks.filter((check) => check.reader === reader)
    if (!mine.length) continue
    const failed = mine.filter((check) => check.result === 'fail')
    const passed = mine.filter((check) => check.result === 'pass').length
    const last = mine.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))
    const label = reader === 'code' ? 'Code' : reader === 'elastic' ? 'Elastic' : 'Claude'
    const evidence = reader === 'code' && claim.corroboration ? `; evidence ${claim.corroboration}` : ''
    const failures = failed.length ? ` (${failed.map((check) => `${check.name}: ${check.detail}`).join('; ')})` : ''
    add(last.createdAt, label, `${mine.length} ${mine.length === 1 ? 'check' : 'checks'}: ${passed} passed, ${failed.length} failed${failures}${evidence}`)
  }

  const lastCheck = input.checks.reduce((top, check) => Math.max(top, check.createdAt), 0)
  const agents = input.decisions.filter(
    (row) => (row.actor === 'Claude' || row.actor === 'Evidence Engine' || (row.actor === 'Decision Engine' && row.who === 'Investigator')) && row.at >= lastCheck,
  )
  for (const row of agents) add(row.at, row.actor === 'Claude' ? 'Decision Engine' : row.actor, row.why ? `${row.what}: ${row.why}` : row.what)

  const review = input.review
  if (review && !agents.length) add(review.createdAt, 'Decision Engine', `${review.verdict.replace('_', ' ')}: ${review.summary}`)
  if (review?.rejected.length) add(review.createdAt, 'Code', `Set the agent's decision aside: ${review.rejected.join('; ')}`)

  for (const approval of input.approvals) {
    const verb = approval.decision === 'approve' ? 'approved' : 'refused'
    add(approval.decidedAt, 'Decision', `${approval.approverName} (${approval.approverRole}) ${verb} at ${formatCents(approval.amountSeenCents)}${approval.learn ? ', learned a rule' : ''}${approval.reason ? `: ${approval.reason}` : ''}`)
  }

  const rule = claim.settlementRuleId ? input.rules[claim.settlementRuleId] : undefined
  if (claim.decidedBy === 'claude' && claim.settlementRuleId) {
    add(claim.decidedAt, 'Decision', `Paid on the Decision Engine's decision, inside the ${rule ? `${formatCents(rule.ceilingCents)} ` : ''}authority of rule v${claim.settlementRuleVersion}${rule ? ` from ${rule.approverName}` : ''}`)
  } else if (claim.decidedBy === 'rule') {
    add(claim.decidedAt, 'Decision', `Settled on its own under rule v${claim.settlementRuleVersion}${rule ? `, learned from ${rule.approverName}` : ''}`)
  } else if (claim.decidedBy === 'claude') {
    add(claim.decidedAt, 'Decision', `Refused on the Decision Engine's decision, which rests on a failed check: ${claim.refusalReason}`)
  } else if (claim.decidedBy && claim.decidedBy !== 'approver') {
    add(claim.decidedAt, 'Decision', `Refused by ${claim.decidedBy}: ${claim.refusalReason || claim.statusNote}`)
  } else if (claim.status === 'routed') {
    add(claim.updatedAt, 'Decision', `Sent to the organizer: ${claim.statusNote}`)
  }

  const journals = group([...input.ledger], (row) => row.journalId)
  let paid = false
  let reconciled = false
  for (const rows of Object.values(journals)) {
    const journal = rows[0].journal
    const debits = rows.reduce((sum, row) => sum + row.debitCents, 0)
    const cash = rows.filter((row) => row.account === 'cash').reduce((sum, row) => sum + row.debitCents, 0)
    let line = `${journal}: ${formatCents(debits)}`
    if (journal.startsWith('J1r')) line = `Released the ${formatCents(debits)} reserve`
    else if (journal.startsWith('J1')) line = `Reserved ${formatCents(debits)} for the payout`
    else if (journal.startsWith('J2')) line = `Booked ${formatCents(debits)} as recoverable from the insurer`
    else if (journal.startsWith('J3')) line = `Paid ${formatCents(debits)}${claim.claimantName ? ` to ${claim.claimantName}` : ''}${claim.payoutReference ? ` (${claim.payoutReference})` : ''}`
    else if (journal.startsWith('J4')) line = `The insurer paid ${formatCents(cash)}`
    paid ||= journal.startsWith('J3')
    reconciled ||= journal.startsWith('J4')
    add(rows[0].postedAt, 'Ledger', line)
  }
  if (!paid) add(claim.settledAt, 'Ledger', `Settled${claim.payoutReference ? ` (${claim.payoutReference})` : ''}`)
  if (!reconciled) add(claim.reconciledAt, 'Ledger', 'Reconciled with the insurer')

  return steps.sort((a, b) => a.at - b.at)
}

// ---------------------------------------------------------------------------------------------
// Merch sales: what each product and each sponsor booth took on paid orders.

/** Print cost by template kind, in cents, and the booth fee, as the dev organizer counts them. */
export const PRINT_CENTS: Record<string, number> = { tee: 800, mug: 500, poster: 300 }
export const BOOTH_FEE_PERCENT = 10

export interface SalesLine {
  orders: number
  sales: number
  print: number
  fee: number
  owed: number
}

export function marginOf(line: SalesLine): number {
  return line.sales - line.print - line.owed
}

function blank(): SalesLine {
  return { orders: 0, sales: 0, print: 0, fee: 0, owed: 0 }
}

function addTo(target: SalesLine, part: SalesLine) {
  target.orders += part.orders
  target.sales += part.sales
  target.print += part.print
  target.fee += part.fee
  target.owed += part.owed
}

/** Split cents across n booths; the first booth takes the remainder. */
function split(cents: number, n: number): number[] {
  const each = Math.floor(cents / n)
  return Array.from({ length: n }, (_, index) => (index === 0 ? cents - each * (n - 1) : each))
}

export function merchSales(orders: readonly SettleOrder[], templates: readonly MerchTemplateRow[]) {
  const products = new Map<string, { template: MerchTemplateRow; line: SalesLine }>()
  const booths = new Map<string, SalesLine>()
  const total = blank()
  const byTemplate = new Map(templates.map((template) => [template.id, template]))
  for (const order of orders) {
    if (order.status !== 'paid') continue
    const template = byTemplate.get(order.templateId)
    if (!template) continue
    const boothIds = [...template.boothIds].sort((a, b) => Number(a) - Number(b))
    const sales = order.amountCents
    const print = PRINT_CENTS[template.kind.toLowerCase()] ?? 0
    const fee = boothIds.length ? Math.floor((sales * BOOTH_FEE_PERCENT) / 100) : 0
    const part: SalesLine = { orders: 1, sales, print, fee, owed: boothIds.length ? sales - print - fee : 0 }
    const product = products.get(template.id) ?? { template, line: blank() }
    addTo(product.line, part)
    addTo(total, part)
    products.set(template.id, product)
    if (!boothIds.length) continue
    const [s, p, f] = [split(sales, boothIds.length), split(print, boothIds.length), split(fee, boothIds.length)]
    boothIds.forEach((boothId, index) => {
      const line = booths.get(boothId) ?? blank()
      addTo(line, { orders: 1, sales: s[index], print: p[index], fee: f[index], owed: s[index] - p[index] - f[index] })
      booths.set(boothId, line)
    })
  }
  return { products, booths, total }
}

/** The shopping agent's picks for one attendee, or plain merch with their latest photo when it has not picked yet. */
export function picksFor(nodeId: string, name: string, picks: readonly MerchPick[], photos: readonly EventPhoto[], templates: readonly MerchTemplateRow[]): MerchPick[] {
  const mine = picks.filter((pick) => pick.nodeId === nodeId).sort((a, b) => a.rank - b.rank)
  if (mine.length) return mine
  const photo = photos.filter((item) => item.nodeIds.includes(nodeId)).sort((a, b) => Number(b.id) - Number(a.id))[0]
  if (!photo) return []
  return templates
    .filter((template) => template.boothIds.length === 0)
    .map((template, index) => ({
      id: template.id,
      nodeId,
      attendeeName: name,
      rank: index + 1,
      templateId: template.id,
      photoId: photo.id,
      photoUrl: photo.url,
      line: '',
      reason: 'Made with your event photo.',
      createdAt: photo.takenAt,
    }))
}

export const TEE_SIZES = ['S', 'M', 'L', 'XL'] as const

export function takesSize(kind: string): boolean {
  return kind.toLowerCase() === 'tee'
}
