import { marginOf, merchSales, type ClaimRecord, type LedgerEntry, type MerchTemplateRow, type SettleClaim, type SettleOrder } from '@/stdb/settlementOps'

export interface ClaimCosts {
  billed: number
  unpaidPayout: number
  paid: number
  insurerOwes: number
  insurerPaid: number
  venueCost: number
  notCovered: number
  deductibles: number
  shortPaid: number
  unrecovered: number
  charged: number
  recoveryCredit: number
  attendeePaid: number
  attendeeOwes: number
}

const blank = (): ClaimCosts => ({ billed: 0, unpaidPayout: 0, paid: 0, insurerOwes: 0, insurerPaid: 0, venueCost: 0, notCovered: 0, deductibles: 0, shortPaid: 0, unrecovered: 0, charged: 0, recoveryCredit: 0, attendeePaid: 0, attendeeOwes: 0 })

export function costCenter(claim: Pick<SettleClaim, 'coverKind'>): string {
  return claim.coverKind === 'medical_payments' ? 'Medical' : claim.coverKind === 'property' ? 'Venue property' : claim.coverKind
}

/** Account balances determine booked cost. Cash receipts are shown separately. */
export function claimCosts(claim: SettleClaim, ledger: readonly LedgerEntry[], record?: ClaimRecord): ClaimCosts {
  const balance = (account: string) => ledger.filter((line) => line.account === account).reduce((sum, line) => sum + line.debitCents - line.creditCents, 0)
  const sum = (journal: string, account: string, side: 'debitCents' | 'creditCents') => ledger.filter((line) => line.journal.startsWith(journal) && line.account === account).reduce((total, line) => total + line[side], 0)
  const billed = record?.status === 'extracted' ? record.billedCents : claim.costCents
  const decided = ['paying', 'settled', 'reconciled'].includes(claim.status)
  const shortPaid = sum('J4', 'claims_expense', 'debitCents') - sum('J4', 'claims_expense', 'creditCents')
  const venueCost = balance('claims_expense')
  const deductibles = decided ? claim.venueCostCents : 0
  return {
    billed,
    unpaidPayout: -balance('claims_reserve'),
    paid: sum('J3', 'cash', 'creditCents'),
    insurerOwes: balance('insurer_receivable'),
    insurerPaid: sum('J4', 'cash', 'debitCents'),
    venueCost,
    notCovered: claim.status === 'refused' ? billed : decided ? Math.max(billed - claim.payoutCents, 0) : 0,
    deductibles,
    shortPaid,
    unrecovered: venueCost - deductibles - shortPaid,
    charged: sum('J5 ', 'attendee_receivable', 'debitCents') - sum('J5r', 'attendee_receivable', 'creditCents'),
    recoveryCredit: claim.coverKind === 'property' ? -balance('recoveries') : 0,
    attendeePaid: sum('J6', 'cash', 'debitCents'),
    attendeeOwes: balance('attendee_receivable'),
  }
}

function add(target: ClaimCosts, part: ClaimCosts) {
  for (const key of Object.keys(target) as (keyof ClaimCosts)[]) target[key] += part[key]
}

export function eventCosts(input: {
  claims: readonly SettleClaim[]
  ledger: Readonly<Record<string, readonly LedgerEntry[]>>
  records: Readonly<Record<string, ClaimRecord>>
  orders: readonly SettleOrder[]
  templates: readonly MerchTemplateRow[]
}) {
  const lines = input.claims.map((claim) => ({ claim, line: claimCosts(claim, input.ledger[claim.id] ?? [], input.records[claim.id]) }))
  const centers = new Map<string, { claims: number; line: ClaimCosts }>()
  const total = blank()
  for (const { claim, line } of lines) {
    const name = costCenter(claim)
    const center = centers.get(name) ?? { claims: 0, line: blank() }
    center.claims += 1
    add(center.line, line)
    centers.set(name, center)
    add(total, line)
  }
  const merch = merchSales(input.orders, input.templates).total
  const merchEarnings = marginOf(merch)
  const uncoveredProperty = centers.get('Venue property')?.line.notCovered ?? 0
  const venueClaims = total.venueCost + uncoveredProperty
  return { lines, centers, total, merch, merchEarnings, uncoveredProperty, venueClaims, netCost: venueClaims - total.recoveryCredit - merchEarnings }
}
