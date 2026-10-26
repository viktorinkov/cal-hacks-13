import { formatCents } from '@/cover/money'
import { bandCode, bandFromCode } from '@/lib/bandCode'
import type { Charge, DeskData, MerchOrder, MyCharge, Night, Person, Template, Wallet, WalletData, WalletEntry } from './rows'

export type Source = 'merch' | 'charge' | 'wallet'
export type DisplayStatus = 'decision' | 'pending' | 'paid' | 'failed' | 'disputed' | 'waived' | 'refunded' | 'other'
export type KnownStatus = Exclude<DisplayStatus, 'other'>

export const STATUS_ORDER: KnownStatus[] = ['decision', 'pending', 'paid', 'failed', 'disputed', 'waived', 'refunded']

export const STATUS_LABEL: Record<KnownStatus, string> = {
  decision: 'Needs a decision',
  pending: 'Pending',
  paid: 'Paid',
  failed: 'Failed',
  disputed: 'Disputed',
  waived: 'Waived',
  refunded: 'Refunded',
}

/** One payment, whatever it came from. Amounts are integer cents. */
export interface Payment {
  id: string
  rowId: string
  source: Source
  attendeeName: string
  bandId: number | null
  nodeId: string
  /** Positive for merch and charges; signed for wallet entries (money out is negative). */
  amountCents: number
  status: DisplayStatus
  rawStatus: string
  /** The pill's words: the display status, or the raw value when it isn't one we know. */
  label: string
  createdAt: number
  settledAt: number | null
  reference: string
  what: string
  kind: string
  where: string
  failure: string
  refundCents: number
}

/*
 * The backend module isn't in this repo, so its status strings aren't documented here. These are the
 * values a charge or an order can plausibly carry; anything else shows as a neutral pill with its own text.
 */
const CHARGE_STATUS: Record<string, KnownStatus> = {
  recommended: 'decision', pending: 'decision', pending_approval: 'decision', awaiting_approval: 'decision',
  awaiting_decision: 'decision', needs_decision: 'decision', proposed: 'decision', named: 'decision',
  open: 'decision', in_review: 'decision', review: 'decision',
  approved: 'pending', charging: 'pending', paying: 'pending', queued: 'pending', processing: 'pending',
  submitted: 'pending', sent: 'pending', sending: 'pending',
  paid: 'paid', settled: 'paid', complete: 'paid', completed: 'paid', succeeded: 'paid', captured: 'paid', collected: 'paid',
  failed: 'failed', declined: 'failed', error: 'failed', payment_failed: 'failed', insufficient_funds: 'failed',
  disputed: 'disputed', contested: 'disputed', under_dispute: 'disputed',
  waived: 'waived',
  refunded: 'refunded', partially_refunded: 'refunded',
}

const MERCH_STATUS: Record<string, KnownStatus> = {
  pending: 'pending', queued: 'pending', placed: 'pending', ordered: 'pending', created: 'pending', new: 'pending',
  requested: 'pending', sent: 'pending', sending: 'pending', submitted: 'pending', processing: 'pending',
  settling: 'pending', paying: 'pending', awaiting_bank: 'pending',
  paid: 'paid', settled: 'paid', complete: 'paid', completed: 'paid', fulfilled: 'paid', succeeded: 'paid', purchased: 'paid',
  failed: 'failed', declined: 'failed', error: 'failed', rejected: 'failed', insufficient_funds: 'failed',
  refunded: 'refunded',
}

function key(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function plain(raw: string): string {
  const words = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!words) return ''
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}

function labelOf(status: DisplayStatus, raw: string): string {
  return status === 'other' ? plain(raw) || 'No status' : STATUS_LABEL[status]
}

/** A charge before anyone decided it is waiting on a person, whatever word the backend used. */
export function chargeStatus(raw: string, decided: boolean): DisplayStatus {
  const mapped = CHARGE_STATUS[key(raw)]
  if (!mapped) return 'other'
  if (mapped === 'decision' && decided) return 'pending'
  return mapped
}

export function merchStatus(raw: string, failure: string): DisplayStatus {
  const mapped = MERCH_STATUS[key(raw)]
  if (failure.trim() && mapped !== 'paid' && mapped !== 'refunded') return 'failed'
  return mapped ?? 'other'
}

export function entryStatus(entry: WalletEntry): DisplayStatus {
  if (/refund/i.test(entry.kind)) return 'refunded'
  return entry.amountCents < 0 ? 'paid' : 'other'
}

/** The documented mapping, printed in the report and checked by the tests. */
export const STATUS_MAPPING = { charge: CHARGE_STATUS, merch: MERCH_STATUS }

/** A missing value prints as a grey dash, never as a zero. */
export const MISSING = '—'

/** The band number as the strap prints it: 07, 23, 140. */
export function bandDigits(bandId: number): string {
  return String(bandId).padStart(2, '0') // taste-skill-ignore: the strap's own band number
}

/** The band's tag code, for example `Band K3QX-9A7M`. */
export function bandLabel(bandId: number | null): string {
  return bandId == null ? 'No band' : `Band ${bandCode(bandId)}`
}

export function plural(word: string, count: number): string {
  if (count === 1 || !word) return word
  return /s$/i.test(word) ? word : `${word}s`
}

interface Lookup {
  people: Map<string, Person>
  templates: Map<string, Template>
  booths: Map<string, string>
  incidents: Map<string, { kind: string; zoneName: string }>
}

function lookup(desk: Pick<DeskData, 'people' | 'templates' | 'booths' | 'incidents'>): Lookup {
  return {
    people: new Map(desk.people.map((person) => [person.nodeId, person])),
    templates: new Map(desk.templates.map((template) => [template.id, template])),
    booths: new Map(desk.booths.map((booth) => [booth.id, booth.name])),
    incidents: new Map(desk.incidents.map((incident) => [incident.id, incident])),
  }
}

export function boothOf(templateId: string, templates: Map<string, Template>, booths: Map<string, string>): string {
  const template = templates.get(templateId)
  for (const id of template?.boothIds ?? []) {
    const name = booths.get(id)
    if (name) return name
  }
  return ''
}

export function paymentFromCharge(charge: Charge, incidents: Lookup['incidents'] = new Map()): Payment {
  const status = chargeStatus(charge.status, charge.decidedAt != null)
  const incident = incidents.get(charge.incidentId)
  const kind = incident?.kind ? plain(incident.kind).toLowerCase() : ''
  const what = kind && !/^damage$/.test(kind) ? `Damage charge · ${kind}` : 'Damage charge'
  return {
    id: `charge:${charge.id}`,
    rowId: charge.id,
    source: 'charge',
    attendeeName: charge.attendeeName,
    bandId: charge.bandId,
    nodeId: '',
    amountCents: charge.amountCents,
    status,
    rawStatus: charge.status,
    label: labelOf(status, charge.status),
    createdAt: charge.createdAt,
    settledAt: charge.paidAt,
    reference: charge.paymentReference,
    what,
    kind: 'charge',
    where: incident?.zoneName ?? '',
    failure: status === 'failed' ? 'The bank did not take the payment.' : '',
    refundCents: charge.refundCents,
  }
}

export function paymentFromOrder(order: MerchOrder, context: Pick<Lookup, 'people' | 'templates' | 'booths'>): Payment {
  const status = merchStatus(order.status, order.failure)
  const template = context.templates.get(order.templateId)
  const person = context.people.get(order.nodeId)
  const title = order.title || template?.title || 'Merch'
  return {
    id: `merch:${order.id}`,
    rowId: order.id,
    source: 'merch',
    attendeeName: order.attendeeName || person?.name || '',
    bandId: person?.bandId ?? null,
    nodeId: order.nodeId,
    amountCents: order.amountCents,
    status,
    rawStatus: order.status,
    label: labelOf(status, order.status),
    createdAt: order.createdAt,
    settledAt: status === 'paid' ? order.updatedAt : null,
    reference: order.nessiePurchaseId,
    what: order.size ? `${title} · ${order.size}` : title,
    kind: template?.kind ?? '',
    where: boothOf(order.templateId, context.templates, context.booths),
    failure: status === 'failed' ? plainFailure(order.failure) : '',
    refundCents: status === 'refunded' ? order.amountCents : 0,
  }
}

export function paymentFromEntry(entry: WalletEntry): Payment {
  const status = entryStatus(entry)
  return {
    id: `wallet:${entry.id}`,
    rowId: entry.id,
    source: 'wallet',
    attendeeName: '',
    bandId: null,
    nodeId: '',
    amountCents: entry.amountCents,
    status,
    rawStatus: entry.kind,
    label: labelOf(status, entry.kind),
    createdAt: entry.createdAt,
    settledAt: entry.createdAt,
    reference: entry.nessieId,
    what: entry.memo || plain(entry.kind) || 'Wallet entry',
    kind: entry.kind,
    where: '',
    failure: '',
    refundCents: status === 'refunded' ? Math.abs(entry.amountCents) : 0,
  }
}

function newestFirst(a: Payment, b: Payment): number {
  return b.createdAt - a.createdAt || b.id.localeCompare(a.id)
}

/** Inside the event's own window. With no window known, every row counts. */
export function inNight(at: number, night: Night): boolean {
  if (night.startsAt != null && at < night.startsAt) return false
  if (night.endsAt != null && at > night.endsAt) return false
  return true
}

/** Every merch order and charge on the desk, newest first, inside the night. */
export function deskPayments(desk: DeskData): Payment[] {
  const context = lookup(desk)
  return [
    ...desk.orders.map((order) => paymentFromOrder(order, context)),
    ...desk.charges.map((charge) => {
      const payment = paymentFromCharge(charge, context.incidents)
      const person = desk.people.find((item) => item.bandId != null && item.bandId === charge.bandId)
      return person ? { ...payment, nodeId: person.nodeId } : payment
    }),
  ]
    .filter((payment) => inNight(payment.createdAt, desk.night))
    .sort(newestFirst)
}

/** The attendee's activity: wallet entries and merch orders, one row per movement, newest first. */
export function walletActivity(data: WalletData): Payment[] {
  const templates = new Map(data.templates.map((template) => [template.id, template]))
  const orders = data.orders.map((order) => paymentFromOrder(order, { people: new Map(), templates, booths: new Map() }))
  const purchaseIds = new Set(data.orders.map((order) => order.nessiePurchaseId).filter(Boolean))
  const entries = data.entries.filter((entry) => !entry.nessieId || !purchaseIds.has(entry.nessieId)).map(paymentFromEntry)
  return [...orders, ...entries].sort(newestFirst)
}

export interface Figures {
  throughCents: number
  paidCount: number
  refundCents: number
  decisionCount: number
  disputedCount: number
  failedCount: number
  failedCents: number
  failedMerch: number
  failedCharges: number
  walletsOpen: number
  walletCents: number
}

/** Each figure is a sum over the same rows the table shows under that figure's filter. */
export function figuresOf(payments: Payment[], wallets: Wallet[]): Figures {
  const paid = payments.filter((payment) => payment.status === 'paid')
  const failed = payments.filter((payment) => payment.status === 'failed')
  return {
    throughCents: paid.reduce((sum, payment) => sum + payment.amountCents, 0),
    paidCount: paid.length,
    refundCents: payments.reduce((sum, payment) => sum + payment.refundCents, 0),
    decisionCount: payments.filter((payment) => payment.status === 'decision').length,
    disputedCount: payments.filter((payment) => payment.status === 'disputed').length,
    failedCount: failed.length,
    failedCents: failed.reduce((sum, payment) => sum + payment.amountCents, 0),
    failedMerch: failed.filter((payment) => payment.source === 'merch').length,
    failedCharges: failed.filter((payment) => payment.source === 'charge').length,
    walletsOpen: wallets.length,
    walletCents: wallets.reduce((sum, wallet) => sum + wallet.balanceCents, 0),
  }
}

function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

export function clock(ms: number | null): string {
  if (!ms) return ''
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** The line under the title: what in tonight's rows most needs the operator. */
export function findingOf(figures: Figures, payments: Payment[]): string {
  const parts: string[] = []
  if (figures.decisionCount) parts.push(`${figures.decisionCount} ${plural('charge', figures.decisionCount)} ${figures.decisionCount === 1 ? 'is' : 'are'} waiting for a decision`)
  if (figures.disputedCount) {
    parts.push(figures.decisionCount
      ? `${figures.disputedCount} ${figures.disputedCount === 1 ? 'is' : 'are'} disputed`
      : `${figures.disputedCount} ${plural('charge', figures.disputedCount)} ${figures.disputedCount === 1 ? 'is' : 'are'} disputed`)
  }
  if (figures.failedMerch) parts.push(`${figures.failedMerch} merch ${plural('order', figures.failedMerch)} failed at the bank`)
  if (figures.failedCharges) parts.push(`${figures.failedCharges} charge ${plural('payment', figures.failedCharges)} failed at the bank`)
  if (parts.length) return `${joinParts(parts)}.`
  if (!payments.length) return 'No payments yet tonight.'
  const last = payments.filter((payment) => payment.status === 'paid').map((payment) => payment.settledAt ?? payment.createdAt).sort((a, b) => b - a)[0]
  return last ? `Nothing needs you. The last payment settled at ${clock(last)}.` : 'Nothing needs you.'
}

export function titleOf(figures: Figures, count: number): string {
  if (!count) return 'Nothing through the bands yet.'
  return `${formatCents(figures.throughCents)} through the bands tonight.`
}

export type Filter = 'all' | DisplayStatus

export function filterCounts(payments: Payment[]): Record<Filter, number> {
  const counts: Record<Filter, number> = { all: payments.length, decision: 0, pending: 0, paid: 0, failed: 0, disputed: 0, waived: 0, refunded: 0, other: 0 }
  for (const payment of payments) counts[payment.status] += 1
  return counts
}

export function applyFilter(payments: Payment[], filter: Filter): Payment[] {
  return filter === 'all' ? payments : payments.filter((payment) => payment.status === filter)
}

/** "07", "7", "band 7", "Band 07", "#7" → 7, and a tag code like "K3QX-9A7M" or "Band K3QX-9A7M" → its band. */
export function parseBand(query: string): number | null {
  const q = query.trim()
  const match = /^(?:band\s*|b\s*|#\s*)?(\d{1,3})$/i.exec(q)
  if (match) {
    const n = Number(match[1])
    return n > 0 && n < 256 ? n : null
  }
  const id = bandFromCode(q.replace(/^band\s+/i, ''))
  return id > 0 && id < 256 ? id : null
}

export function searchPayments(payments: Payment[], query: string): Payment[] {
  const q = query.trim().toLowerCase()
  if (!q) return payments
  const band = parseBand(q)
  if (band != null) return payments.filter((payment) => payment.bandId === band)
  return payments.filter((payment) => payment.attendeeName.toLowerCase().includes(q) || payment.reference.toLowerCase().includes(q))
}

export interface PinnedWallet {
  bandId: number
  name: string
  nodeId: string
  wallet: Wallet | null
}

/** Searching a band number pins that band's wallet above the results. */
export function pinnedWallet(desk: Pick<DeskData, 'people' | 'wallets'>, query: string): PinnedWallet | null {
  const band = parseBand(query)
  if (band == null) return null
  const person = desk.people.find((item) => item.bandId === band)
  if (!person) return { bandId: band, name: '', nodeId: '', wallet: null }
  return { bandId: band, name: person.name, nodeId: person.nodeId, wallet: desk.wallets.find((wallet) => wallet.nodeId === person.nodeId) ?? null }
}

export const BIN_MINUTES = 15

export interface Bin {
  start: number
  cents: number
  count: number
  rows: Payment[]
}

/** Paid money in 15-minute bins across the span of the night that saw payments. */
export function binsOf(payments: Payment[], night: Night): Bin[] {
  const paid = payments.filter((payment) => payment.status === 'paid')
  const step = BIN_MINUTES * 60_000
  const times = paid.map((payment) => payment.settledAt ?? payment.createdAt)
  if (!times.length) return []
  const first = Math.max(Math.min(...times), night.startsAt ?? -Infinity)
  const last = Math.min(Math.max(...times), night.endsAt ?? Infinity)
  const start = Math.floor(first / step) * step
  const count = Math.max(1, Math.floor((last - start) / step) + 1)
  const bins: Bin[] = Array.from({ length: count }, (_, index) => ({ start: start + index * step, cents: 0, count: 0, rows: [] }))
  paid.forEach((payment, index) => {
    const slot = Math.min(count - 1, Math.max(0, Math.floor((times[index] - start) / step)))
    bins[slot].cents += payment.amountCents
    bins[slot].count += 1
    bins[slot].rows.push(payment)
  })
  return bins
}

/** "14 tees at the Anthropic booth": what made the biggest bin, from its own rows. */
export function annotateBin(bin: Bin): string {
  const merch = bin.rows.filter((payment) => payment.source === 'merch')
  if (!merch.length) return `${bin.count} ${plural('charge', bin.count)} paid`
  const groups = new Map<string, Payment[]>()
  for (const payment of merch) {
    const group = `${payment.where}|${payment.kind || payment.what}`
    groups.set(group, [...(groups.get(group) ?? []), payment])
  }
  const [group, rows] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0]
  const [booth, item] = group.split('|')
  const noun = plural(item.split(' · ')[0].toLowerCase(), rows.length)
  return booth ? `${rows.length} ${noun} at the ${booth} booth` : `${rows.length} ${noun}`
}

export interface BoothTotal {
  booth: string
  cents: number
  count: number
}

/** Where on the floor the money came in: paid merch by booth, most first. */
export function boothRanking(payments: Payment[]): BoothTotal[] {
  const totals = new Map<string, BoothTotal>()
  for (const payment of payments) {
    if (payment.source !== 'merch' || payment.status !== 'paid') continue
    const booth = payment.where || 'No booth'
    const total = totals.get(booth) ?? { booth, cents: 0, count: 0 }
    total.cents += payment.amountCents
    total.count += 1
    totals.set(booth, total)
  }
  return [...totals.values()].sort((a, b) => b.cents - a.cents || a.booth.localeCompare(b.booth))
}

/** A Nessie failure in words an operator or attendee can act on. */
export function plainFailure(failure: string): string {
  const raw = failure.trim()
  if (!raw) return 'The bank turned it down without a reason.'
  if (/insufficient|not enough|funds|balance/i.test(raw)) return "There wasn't enough in the band's wallet."
  if (/timeout|timed out|unavailable|5\d\d/i.test(raw)) return "The bank didn't answer in time."
  if (/merchant/i.test(raw)) return "The bank couldn't find the booth's merchant account."
  if (/account|customer|not found|404/i.test(raw)) return "The bank couldn't find the band's wallet account."
  return plain(raw)
}

export interface Step {
  key: string
  title: string
  detail?: string
  quote?: string
  at: number | null
  state: 'done' | 'waiting' | 'stopped'
}

export function chargeTimeline(charge: Charge, status: DisplayStatus, caps: Map<string, number> = new Map()): Step[] {
  const steps: Step[] = []
  const named = [charge.namedByName, charge.namedByRole && `(${charge.namedByRole})`].filter(Boolean).join(' ')
  steps.push({ key: 'named', title: named ? `Named by ${named}` : 'Band named', detail: charge.note || undefined, at: charge.createdAt, state: 'done' })
  if (charge.checks.length) {
    steps.push({
      key: 'checks',
      title: charge.checksPassed ? `${charge.checks.length} ${plural('check', charge.checks.length)} passed` : 'A check did not pass',
      detail: charge.checks.join(' · '),
      at: null,
      state: charge.checksPassed ? 'done' : 'stopped',
    })
  }
  const clauses = charge.clauseIds.map((id) => (caps.has(id) ? `${id} (cap ${formatCents(caps.get(id)!)})` : id)).join(', ')
  steps.push({
    key: 'recommended',
    title: charge.recommendation ? `Recommended: ${charge.recommendation}` : `Recommended ${formatCents(charge.amountCents)}`,
    detail: [charge.recommendationReason, clauses && `Clauses ${clauses}`].filter(Boolean).join(' · ') || undefined,
    at: null,
    state: 'done',
  })
  if (charge.disputeText) steps.push({ key: 'disputed', title: 'Disputed by the attendee', quote: charge.disputeText, at: null, state: status === 'disputed' ? 'waiting' : 'done' })
  if (status === 'waived' || charge.waiveReason) {
    steps.push({ key: 'waived', title: charge.approvedByName ? `Waived by ${charge.approvedByName}` : 'Waived', detail: charge.waiveReason || undefined, at: charge.decidedAt, state: 'stopped' })
  } else if (charge.approvedByName || charge.decidedAt) {
    steps.push({ key: 'approved', title: charge.approvedByName ? `Approved by ${charge.approvedByName}` : 'Approved', at: charge.decidedAt, state: 'done' })
  } else if (status === 'decision' || status === 'disputed') {
    steps.push({ key: 'decide', title: 'Waiting for a decision', at: null, state: 'waiting' })
  }
  if (charge.paidAt || status === 'paid' || status === 'refunded') {
    steps.push({ key: 'paid', title: 'Paid from the band’s wallet', detail: charge.paymentReference ? `Reference ${charge.paymentReference}` : undefined, at: charge.paidAt, state: 'done' })
  } else if (status === 'pending') {
    steps.push({ key: 'paying', title: 'Sent to the bank', at: null, state: 'waiting' })
  } else if (status === 'failed') {
    steps.push({ key: 'failed', title: 'The bank did not take the payment', at: null, state: 'stopped' })
  }
  if (charge.insurerCents > 0) steps.push({ key: 'insurer', title: `Insurer’s share ${formatCents(charge.insurerCents)}`, detail: charge.claimId && charge.claimId !== '0' ? `Claim ${charge.claimId}` : undefined, at: null, state: 'done' })
  if (charge.refundCents > 0) steps.push({ key: 'refund', title: `Refunded ${formatCents(charge.refundCents)}`, at: null, state: 'done' })
  return steps
}

export function merchTimeline(order: MerchOrder, status: DisplayStatus): Step[] {
  const sent = status !== 'pending' || Boolean(order.nessiePurchaseId)
  const steps: Step[] = [
    { key: 'ordered', title: 'Ordered', detail: order.line || undefined, at: order.createdAt, state: 'done' },
    { key: 'sent', title: 'Sent to the bank', at: null, state: sent ? 'done' : 'waiting' },
  ]
  if (status === 'paid' || status === 'refunded') steps.push({ key: 'settled', title: 'Settled', detail: order.nessiePurchaseId ? `Reference ${order.nessiePurchaseId}` : undefined, at: order.updatedAt, state: 'done' })
  else if (status === 'failed') steps.push({ key: 'failed', title: 'Failed', detail: plainFailure(order.failure), at: order.updatedAt, state: 'stopped' })
  else if (status === 'pending') steps.push({ key: 'settle', title: 'Waiting for the bank to settle it', at: null, state: 'waiting' })
  if (status === 'refunded') steps.push({ key: 'refunded', title: `Refunded ${formatCents(order.amountCents)}`, at: null, state: 'done' })
  return steps
}

/** The attendee's charges, with the same display statuses as the desk. */
export function myChargeStatus(charge: MyCharge): DisplayStatus {
  return chargeStatus(charge.status, false)
}

export function canDispute(status: DisplayStatus): boolean {
  return status === 'decision' || status === 'pending' || status === 'paid' || status === 'other'
}

const APPAREL = /tee|t-shirt|shirt|hoodie|crew|sweat|jacket|jersey|top|apparel/i

export function needsSize(kind: string, title = ''): boolean {
  return APPAREL.test(kind) || APPAREL.test(title)
}

export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const

export interface WalletSummary {
  paidCents: number
  waiting: number
  disputed: number
  failed: number
}

export function walletSummary(activity: Payment[], charges: MyCharge[]): WalletSummary {
  const statuses = charges.map(myChargeStatus)
  return {
    paidCents: activity.filter((payment) => payment.status === 'paid').reduce((sum, payment) => sum + Math.abs(payment.amountCents), 0),
    waiting: statuses.filter((status) => status === 'decision' || status === 'pending').length,
    disputed: statuses.filter((status) => status === 'disputed').length,
    failed: activity.filter((payment) => payment.status === 'failed').length,
  }
}

export function walletFinding(summary: WalletSummary): string {
  const parts: string[] = []
  if (summary.waiting) parts.push(`${summary.waiting === 1 ? 'One charge is' : `${summary.waiting} charges are`} waiting on the venue`)
  if (summary.disputed) parts.push(`${summary.disputed === 1 ? 'one dispute is' : `${summary.disputed} disputes are`} with the venue`)
  if (summary.failed) parts.push(`${summary.failed === 1 ? 'one order' : `${summary.failed} orders`} didn’t go through`)
  if (!parts.length) return 'Nothing looks wrong.'
  const sentence = joinParts(parts)
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}
