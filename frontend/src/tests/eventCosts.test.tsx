import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CostsPage } from '@/components/desk/CostsPage'
import { claimCosts, eventCosts } from '@/cover/eventCosts'
import { useCatalog } from '@/stdb/catalog'
import { useSettlement, type ClaimRecord, type LedgerEntry, type MerchTemplateRow, type SettleClaim, type SettleOrder } from '@/stdb/settlementOps'

const claim = (extra: Partial<SettleClaim> = {}): SettleClaim => ({ id: '1', coverKind: 'property', status: 'settled', costCents: 120_000, payoutCents: 100_000, venueCostCents: 20_000, claimantName: '', ...extra } as SettleClaim)
const entry = (journal: string, account: string, debitCents: number, creditCents: number): LedgerEntry => ({ id: `${journal}-${account}`, journalId: journal, journal, account, debitCents, creditCents, memo: '', postedAt: 0 })
const base = [
  entry('J1 reserve', 'claims_expense', 100_000, 0), entry('J1 reserve', 'claims_reserve', 0, 100_000),
  entry('J2 recovery', 'claims_expense', 0, 80_000), entry('J2 recovery', 'insurer_receivable', 80_000, 0),
  entry('J3 payout', 'cash', 0, 100_000), entry('J3 payout', 'claims_reserve', 100_000, 0),
]
const charge = [entry('J5 charge', 'attendee_receivable', 120_000, 0), entry('J5 charge', 'insurer_payable', 0, 80_000), entry('J5 charge', 'recoveries', 0, 40_000)]
const collection = [entry('J6 paid', 'cash', 120_000, 0), entry('J6 paid', 'attendee_receivable', 0, 120_000)]
const template = (id: string, kind: string, boothIds: string[]): MerchTemplateRow => ({ id, kind, boothIds } as MerchTemplateRow)
const order = (id: string, templateId: string, amountCents: number, status = 'paid'): SettleOrder => ({ id, templateId, amountCents, status } as SettleOrder)
const summary = (ledger: LedgerEntry[], extra: Partial<Parameters<typeof eventCosts>[0]> = {}) => eventCosts({ claims: [claim()], ledger: { '1': ledger }, records: {}, orders: [], templates: [], ...extra })

afterEach(() => {
  cleanup()
  useSettlement.setState({ claims: {}, ledger: {}, extractedRecords: {}, orders: [], templates: [], error: null })
  useCatalog.setState({ ledger: [], bills: [] })
})

describe('event cost accounting', () => {
  it('includes uncovered property cost and credits an approved charge exactly once', () => {
    expect(summary(base).netCost).toBe(40_000)
    const approved = summary([...base, ...charge])
    expect(approved.netCost).toBe(0)
    expect(approved.total).toMatchObject({ recoveryCredit: 40_000, attendeePaid: 0, attendeeOwes: 120_000 })
    const paid = summary([...base, ...charge, ...collection])
    expect(paid.netCost).toBe(approved.netCost)
    expect(paid.total).toMatchObject({ attendeePaid: 120_000, attendeeOwes: 0, recoveryCredit: 40_000 })
  })

  it('closes the full insurer receivable and counts a receipt difference once', () => {
    const short = summary([...base, entry('J4 receipt', 'cash', 70_000, 0), entry('J4 receipt', 'insurer_receivable', 0, 80_000), entry('J4 receipt', 'claims_expense', 10_000, 0)])
    expect(short.total).toMatchObject({ insurerPaid: 70_000, insurerOwes: 0, shortPaid: 10_000, venueCost: 30_000 })
    expect(short.netCost).toBe(50_000)
    const over = summary([...base, entry('J4 receipt', 'cash', 85_000, 0), entry('J4 receipt', 'insurer_receivable', 0, 80_000), entry('J4 receipt', 'claims_expense', 0, 5_000)])
    expect(over.netCost).toBe(35_000)
    expect(over.total.shortPaid).toBe(-5_000)
  })

  it('reverses disputed recovery before reapproval without duplicating it', () => {
    const reversal = [entry('J5r reversed', 'attendee_receivable', 0, 120_000), entry('J5r reversed', 'recoveries', 40_000, 0), entry('J5r reversed', 'insurer_payable', 80_000, 0)]
    const disputed = summary([...base, ...charge, ...reversal])
    expect(disputed.netCost).toBe(40_000)
    expect(disputed.total).toMatchObject({ recoveryCredit: 0, attendeeOwes: 0, charged: 0 })
    const reapproved = summary([...base, ...charge, ...reversal, ...charge])
    expect(reapproved.total).toMatchObject({ recoveryCredit: 40_000, attendeeOwes: 120_000, charged: 120_000 })
    expect(reapproved.netCost).toBe(0)
  })

  it('adds refused property loss but keeps medical amounts outside venue payout separate', () => {
    const reversal = [entry('J1 reserve', 'claims_expense', 100_000, 0), entry('J1r refusal', 'claims_expense', 0, 100_000)]
    expect(summary(reversal, { claims: [claim({ status: 'refused' })] }).netCost).toBe(120_000)
    const medical = claim({ coverKind: 'medical_payments', costCents: 89_500, payoutCents: 5_500, venueCostCents: 0 })
    const medicalLedger = [entry('J1 reserve', 'claims_expense', 5_500, 0), entry('J2 recovery', 'claims_expense', 0, 5_500)]
    const result = summary(medicalLedger, { claims: [medical] })
    expect(result.total.notCovered).toBe(84_000)
    expect(result.uncoveredProperty).toBe(0)
    expect(result.netCost).toBe(0)
    expect(summary([], { claims: [claim({ coverKind: 'medical_payments', status: 'refused' })] }).netCost).toBe(0)
    expect(summary([], { claims: [claim({ status: 'reviewing' })] }).uncoveredProperty).toBe(0)
  })

  it('uses paid merchandise earnings, including a negative net cost before any claims', () => {
    const result = summary([], {
      claims: [],
      templates: [template('1', 'tee', ['5']), template('2', 'mug', [])],
      orders: [order('1', '1', 3_000), order('2', '2', 2_000), order('3', '1', 3_000, 'paying')],
    })
    expect(result.merch).toMatchObject({ orders: 2, sales: 5_000, print: 1_300, owed: 1_900 })
    expect(result.merchEarnings).toBe(1_800)
    expect(result.netCost).toBe(-1_800)
  })

  it('uses an extracted medical bill and falls back to recorded claim cost', () => {
    const extracted = { status: 'extracted', billedCents: 160_000 } as ClaimRecord
    expect(claimCosts(claim(), base, extracted).billed).toBe(160_000)
    expect(claimCosts(claim(), base, { ...extracted, status: 'pending' }).billed).toBe(120_000)
    expect(claimCosts(claim(), base).billed).toBe(120_000)
  })
})

it('shows booked recovery separately from received money, alongside existing ledger details', () => {
  useSettlement.setState({ claims: { '1': claim() }, ledger: { '1': [...base, ...charge] } })
  useCatalog.setState({ ledger: [{ ...base[0], claimId: '1' }] })
  render(<CostsPage />)
  expect(screen.getByRole('heading', { name: 'Event operating costs' })).toBeInTheDocument()
  expect(screen.getByText('venue share of approved charges')).toBeInTheDocument()
  const payments = screen.getByRole('region', { name: 'Payments and amounts owed' })
  const chargeRow = within(payments).getByRole('row', { name: 'Attendee charges $0.00 $1,200.00' })
  expect(chargeRow).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Ledger' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Product and booth sales' })).toHaveAttribute('href', '/merch')
})
