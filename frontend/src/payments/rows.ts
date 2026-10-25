/**
 * Rows from the payment views, read into plain values. Cents arrive as bigint and stay integer cents;
 * nothing here holds dollars.
 */

export function num(value: unknown): number {
  const n = typeof value === 'bigint' ? Number(value) : Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function idOf(value: unknown): string {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return text(value)
}

function unwrap(value: unknown): unknown {
  if (value && typeof value === 'object' && 'tag' in value) {
    const tagged = value as { tag: unknown; value?: unknown }
    if (tagged.tag === 'none' || tagged.tag === 'None') return null
    if (tagged.tag === 'some' || tagged.tag === 'Some') return tagged.value
  }
  return value
}

/** A SpacetimeDB timestamp (or an option of one) as epoch milliseconds. */
export function millis(value: unknown): number | null {
  const inner = unwrap(value)
  if (inner == null) return null
  if (typeof inner === 'number') return Number.isFinite(inner) && inner > 0 ? inner : null
  if (inner instanceof Date) return Number.isFinite(inner.getTime()) ? inner.getTime() : null
  if (typeof inner === 'object') {
    if ('toDate' in inner && typeof (inner as { toDate: unknown }).toDate === 'function') {
      const time = ((inner as { toDate: () => Date }).toDate()).getTime()
      return Number.isFinite(time) ? time : null
    }
    if ('microsSinceUnixEpoch' in inner) {
      const micros = num((inner as { microsSinceUnixEpoch: unknown }).microsSinceUnixEpoch)
      return micros > 0 ? Math.floor(micros / 1000) : null
    }
  }
  return null
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => (typeof item === 'bigint' || typeof item === 'number' ? idOf(item) : text(item))).filter(Boolean)
}

function bandOf(value: unknown): number | null {
  const n = num(value)
  return Number.isInteger(n) && n > 0 && n < 256 ? n : null
}

type Row = Record<string, unknown>

export interface Charge {
  id: string
  incidentId: string
  claimId: string
  attendeeName: string
  bandId: number | null
  namedByName: string
  namedByRole: string
  note: string
  amountCents: number
  packHash: string
  checks: string[]
  checksPassed: boolean
  recommendation: string
  recommendationReason: string
  clauseIds: string[]
  status: string
  disputeText: string
  approvedByName: string
  waiveReason: string
  paymentReference: string
  createdAt: number
  decidedAt: number | null
  paidAt: number | null
  insurerCents: number
  refundCents: number
}

export function readCharge(row: Row): Charge {
  return {
    id: idOf(row.id),
    incidentId: idOf(row.incidentId),
    claimId: idOf(row.claimId),
    attendeeName: text(row.attendeeName),
    bandId: bandOf(row.bandId),
    namedByName: text(row.namedByName),
    namedByRole: text(row.namedByRole),
    note: text(row.note),
    amountCents: num(row.amountCents),
    packHash: text(row.packHash),
    checks: strings(row.checks),
    checksPassed: row.checksPassed === true,
    recommendation: text(row.recommendation),
    recommendationReason: text(row.recommendationReason),
    clauseIds: strings(row.clauseIds),
    status: text(row.status),
    disputeText: text(row.disputeText),
    approvedByName: text(row.approvedByName),
    waiveReason: text(row.waiveReason),
    paymentReference: text(row.paymentReference),
    createdAt: millis(row.createdAt) ?? 0,
    decidedAt: millis(row.decidedAt),
    paidAt: millis(row.paidAt),
    insurerCents: num(row.insurerCents),
    refundCents: num(row.refundCents),
  }
}

export interface MerchOrder {
  id: string
  attendeeName: string
  nodeId: string
  templateId: string
  photoId: string
  title: string
  size: string
  amountCents: number
  status: string
  failure: string
  nessiePurchaseId: string
  createdAt: number
  updatedAt: number | null
  line: string
  photoUrl: string
}

/** Reads both `board_merch_orders` (staff) and `my_merch_orders` (the attendee's own). */
export function readMerchOrder(row: Row): MerchOrder {
  return {
    id: idOf(row.id),
    attendeeName: text(row.attendeeName),
    nodeId: idOf(row.nodeId),
    templateId: idOf(row.templateId),
    photoId: idOf(row.photoId),
    title: text(row.title),
    size: text(row.size),
    amountCents: num(row.amountCents),
    status: text(row.status),
    failure: text(row.failure),
    nessiePurchaseId: text(row.nessiePurchaseId),
    createdAt: millis(row.createdAt) ?? 0,
    updatedAt: millis(row.updatedAt),
    line: text(row.line),
    photoUrl: text(row.photoUrl),
  }
}

export interface Wallet {
  nodeId: string
  accountId: string
  balanceCents: number
}

export function readWallet(row: Row): Wallet {
  return { nodeId: idOf(row.nodeId), accountId: text(row.accountId), balanceCents: num(row.balanceCents) }
}

export interface WalletEntry {
  id: string
  kind: string
  /** Signed: money out of the wallet is negative. */
  amountCents: number
  memo: string
  nessieId: string
  createdAt: number
}

export function readWalletEntry(row: Row): WalletEntry {
  return {
    id: idOf(row.id),
    kind: text(row.kind),
    amountCents: num(row.amountCents),
    memo: text(row.memo),
    nessieId: text(row.nessieId),
    createdAt: millis(row.createdAt) ?? 0,
  }
}

export interface MyCharge {
  id: string
  incidentId: string
  incidentKind: string
  zoneName: string
  happenedAt: number
  amountCents: number
  status: string
  why: string
  clause: string
  disputeText: string
  paidAt: number | null
}

export function readMyCharge(row: Row): MyCharge {
  return {
    id: idOf(row.id),
    incidentId: idOf(row.incidentId),
    incidentKind: text(row.incidentKind),
    zoneName: text(row.zoneName),
    happenedAt: millis(row.happenedAt) ?? 0,
    amountCents: num(row.amountCents),
    status: text(row.status),
    why: text(row.why),
    clause: text(row.clause),
    disputeText: text(row.disputeText),
    paidAt: millis(row.paidAt),
  }
}

export interface PrintArea {
  width: number
  height: number
  x: number
  y: number
  w: number
  h: number
}

function printArea(row: Row): PrintArea {
  return { width: num(row.width), height: num(row.height), x: num(row.photoX), y: num(row.photoY), w: num(row.photoW), h: num(row.photoH) }
}

export interface Template {
  id: string
  title: string
  kind: string
  priceCents: number
  imageUrl: string
  area: PrintArea
  boothIds: string[]
}

export function readTemplate(row: Row): Template {
  return {
    id: idOf(row.id),
    title: text(row.title) || text(row.name),
    kind: text(row.kind),
    priceCents: num(row.priceCents),
    imageUrl: text(row.imageUrl),
    area: printArea(row),
    boothIds: strings(row.boothIds),
  }
}

/** One of the shopping agent's picks: a piece with a photo from the night printed on it. */
export interface MerchPick {
  key: string
  nodeId: string
  attendeeName: string
  rank: number
  templateId: string
  photoId: string
  photoUrl: string
  title: string
  kind: string
  priceCents: number
  imageUrl: string
  area: PrintArea
  line: string
  reason: string
  friends: string[]
}

export function readSuggestion(row: Row): MerchPick {
  const templateId = idOf(row.templateId)
  const photoId = idOf(row.photoId)
  return {
    key: `${templateId}:${photoId}`,
    nodeId: '',
    attendeeName: '',
    rank: num(row.rank),
    templateId,
    photoId,
    photoUrl: text(row.photoUrl),
    title: text(row.title),
    kind: text(row.kind),
    priceCents: num(row.priceCents),
    imageUrl: text(row.imageUrl),
    area: printArea(row),
    line: text(row.line),
    reason: text(row.reason),
    friends: strings(row.friends),
  }
}

/** `board_merch_picks` carries no price or title, so they come from the template. */
export function readBoardPick(row: Row, templates: Map<string, Template>): MerchPick {
  const templateId = idOf(row.templateId)
  const template = templates.get(templateId)
  return {
    key: idOf(row.id) || `${templateId}:${idOf(row.photoId)}`,
    nodeId: idOf(row.nodeId),
    attendeeName: text(row.attendeeName),
    rank: num(row.rank),
    templateId,
    photoId: idOf(row.photoId),
    photoUrl: text(row.photoUrl),
    title: template?.title ?? '',
    kind: template?.kind ?? '',
    priceCents: template?.priceCents ?? 0,
    imageUrl: template?.imageUrl ?? '',
    area: template?.area ?? { width: 0, height: 0, x: 0, y: 0, w: 0, h: 0 },
    line: text(row.line),
    reason: text(row.reason),
    friends: [],
  }
}

export interface Booth {
  id: string
  name: string
}

export interface Person {
  nodeId: string
  name: string
  bandId: number | null
}

export function readPerson(row: Row): Person {
  return { nodeId: idOf(row.nodeId), name: text(row.displayName), bandId: bandOf(row.bandId) }
}

export interface FeeCap {
  code: string
  description: string
  capCents: number
}

export function readFeeCap(row: Row): FeeCap {
  return { code: text(row.code), description: text(row.description), capCents: num(row.capCents) }
}

export interface IncidentPlace {
  id: string
  kind: string
  zoneName: string
}

/** The event's own window. Either end may be unknown. */
export interface Night {
  startsAt: number | null
  endsAt: number | null
}

/** Everything the organizer desk reads. Fixture and live data never mix inside one of these. */
export interface DeskData {
  charges: Charge[]
  orders: MerchOrder[]
  wallets: Wallet[]
  people: Person[]
  templates: Template[]
  booths: Booth[]
  fees: FeeCap[]
  incidents: IncidentPlace[]
  picks: MerchPick[]
  night: Night
}

/** Everything the attendee wallet reads besides `my_wallet` and `my_band`, which live on the session. */
export interface WalletData {
  entries: WalletEntry[]
  charges: MyCharge[]
  orders: MerchOrder[]
  suggestions: MerchPick[]
  templates: Template[]
}

export const EMPTY_DESK: DeskData = {
  charges: [], orders: [], wallets: [], people: [], templates: [], booths: [], fees: [], incidents: [], picks: [],
  night: { startsAt: null, endsAt: null },
}

export const EMPTY_WALLET: WalletData = { entries: [], charges: [], orders: [], suggestions: [], templates: [] }
