import { describe, expect, it } from 'vitest'
import { FIXTURE_BAND, FIXTURE_DESK, FIXTURE_WALLET } from '@/payments/fixture'
import {
  annotateBin, applyFilter, binsOf, chargeStatus, deskPayments, figuresOf, filterCounts, merchStatus, parseBand, paymentFromCharge,
  paymentFromOrder, pinnedWallet, plainFailure, searchPayments, STATUS_ORDER, walletActivity, type Filter,
} from '@/payments/model'
import { readCharge, readMerchOrder } from '@/payments/rows'

const at = (iso: string) => ({ toDate: () => new Date(iso) })
const context = { people: new Map(), templates: new Map(), booths: new Map() }

describe('payment rows', () => {
  it('reads bigint cents and SDK timestamps into a merch payment', () => {
    const order = readMerchOrder({
      id: 12n, attendeeName: 'Ada Osei', nodeId: 3n, templateId: 4n, photoId: 5n, title: 'Visa tee', size: 'M',
      amountCents: 2_500n, status: 'paid', failure: '', nessiePurchaseId: 'np-9', createdAt: at('2026-10-25T05:00:00Z'),
      updatedAt: { tag: 'some', value: at('2026-10-25T05:02:00Z') }, line: '', photoUrl: '',
    })
    const payment = paymentFromOrder(order, context)
    expect(payment).toMatchObject({ id: 'merch:12', amountCents: 2_500, status: 'paid', label: 'Paid', what: 'Visa tee · M', reference: 'np-9' })
    expect(payment.settledAt).toBe(Date.parse('2026-10-25T05:02:00Z'))
  })

  it('keeps an unknown status as its own neutral row with its raw text', () => {
    const charge = readCharge({ id: 4n, amountCents: 6_000n, status: 'escalated_to_insurer', createdAt: at('2026-10-25T05:00:00Z') })
    const payment = paymentFromCharge(charge)
    expect(payment.status).toBe('other')
    expect(payment.label).toBe('Escalated to insurer')
    expect(payment.amountCents).toBe(6_000)
  })

  it('maps the status strings it knows, and moves a decided charge out of the decision queue', () => {
    expect(chargeStatus('recommended', false)).toBe('decision')
    expect(chargeStatus('recommended', true)).toBe('pending')
    expect(chargeStatus('Payment-Failed', false)).toBe('failed')
    expect(chargeStatus('waived', true)).toBe('waived')
    expect(merchStatus('queued', '')).toBe('pending')
    expect(merchStatus('queued', 'nessie 503: service unavailable')).toBe('failed')
    expect(merchStatus('refunded', 'old failure')).toBe('refunded')
  })

  it('turns Nessie failures into words', () => {
    expect(plainFailure('nessie 503: service unavailable')).toBe("The bank didn't answer in time.")
    expect(plainFailure('nessie 404: merchant not found')).toBe("The bank couldn't find the booth's merchant account.")
    expect(plainFailure('insufficient funds')).toBe("There wasn't enough in the band's wallet.")
  })
})

describe('the desk figures', () => {
  const payments = deskPayments(FIXTURE_DESK)
  const figures = figuresOf(payments, FIXTURE_DESK.wallets)
  const sum = (filter: Filter) => applyFilter(payments, filter).reduce((total, payment) => total + payment.amountCents, 0)

  it('equal the sums of the rows under each figure’s filter', () => {
    expect(figures.throughCents).toBe(sum('paid'))
    expect(figures.paidCount).toBe(applyFilter(payments, 'paid').length)
    expect(figures.decisionCount).toBe(applyFilter(payments, 'decision').length)
    expect(figures.failedCount).toBe(applyFilter(payments, 'failed').length)
    expect(figures.failedCents).toBe(sum('failed'))
    expect(figures.walletsOpen).toBe(FIXTURE_DESK.wallets.length)
  })

  it('has filter counts that add up to All', () => {
    const counts = filterCounts(payments)
    const parts = [...STATUS_ORDER, 'other' as const].reduce((total, status) => total + counts[status], 0)
    expect(parts).toBe(counts.all)
    expect(counts.all).toBe(payments.length)
  })

  it('names the biggest quarter-hour from its own rows', () => {
    const bins = binsOf(payments, FIXTURE_DESK.night)
    const biggest = bins.reduce((best, bin) => (bin.cents > best.cents ? bin : best))
    expect(annotateBin(biggest)).toMatch(/^\d+ tees at the Anthropic booth$/)
    expect(bins.reduce((total, bin) => total + bin.cents, 0)).toBe(figures.throughCents)
  })
})

describe('band search', () => {
  const payments = deskPayments(FIXTURE_DESK)

  it('reads a band number however it is typed', () => {
    for (const query of ['07', '7', 'band 7', 'Band 07', '#7']) expect(parseBand(query)).toBe(7)
    expect(parseBand('68f006eca7')).toBeNull()
    expect(parseBand('300')).toBeNull()
  })

  it('finds only that band’s payments and pins its wallet', () => {
    const found = searchPayments(payments, '07')
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((payment) => payment.bandId === FIXTURE_BAND)).toBe(true)
    const pinned = pinnedWallet(FIXTURE_DESK, 'band 7')
    expect(pinned?.bandId).toBe(FIXTURE_BAND)
    expect(pinned?.wallet?.balanceCents).toBe(6_000)
  })
})

describe('the wallet activity', () => {
  it('lists each movement once, even when an entry and an order share a bank id', () => {
    const activity = walletActivity(FIXTURE_WALLET)
    const references = activity.map((payment) => payment.reference).filter(Boolean)
    expect(new Set(references).size).toBe(references.length)
    expect(activity.some((payment) => payment.source === 'wallet' && payment.amountCents > 0)).toBe(true)
  })
})
