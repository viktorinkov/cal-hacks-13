import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaimExtras } from '@/components/claims/ClaimExtras'
import { MerchExtras } from '@/components/desk/MerchExtras'
import { attachLink, dropLink } from '@/stdb/link'
import type { DbConnection } from '@/stdb/module_bindings'
import { useSession } from '@/stdb/session'
import {
  SETTLEMENT_QUERIES,
  approveRule,
  buildTrail,
  merchSales,
  nameResponsibleBand,
  parseBandNumber,
  recordInsurerPayment,
  useSettlement,
  watchClaimClauses,
} from '@/stdb/settlementOps'

type Row = Record<string, unknown>

const at = (ms: number) => ({ toDate: () => new Date(ms) })

function table(rows: Row[]) {
  return { iter: () => rows.values(), onInsert: () => {}, onDelete: () => {}, onUpdate: () => {} }
}

function fakeConnection(tables: Record<string, Row[]>) {
  const reducers = {
    recordInsurerPayment: vi.fn(async () => undefined),
    nameResponsibleBand: vi.fn(async () => undefined),
    approveRuleScopeReview: vi.fn(async () => undefined),
    approveRuleProposal: vi.fn(async () => undefined),
    rerunShoppingAgent: vi.fn(async () => undefined),
    buyMerchAsWithShipping: vi.fn(async () => undefined),
  }
  const subscribed: string[] = []
  const subscriptionBuilder = () => {
    let applied: (() => void) | undefined
    const builder = {
      onApplied(callback: () => void) {
        applied = callback
        return builder
      },
      onError() {
        return builder
      },
      subscribe(query: string) {
        subscribed.push(query)
        applied?.()
        return {}
      },
    }
    return builder
  }
  const db = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, table(rows)]))
  const conn = { db, reducers, subscriptionBuilder } as unknown as DbConnection
  return { conn, reducers, subscribed }
}

function claimRow(extra: Row = {}): Row {
  return {
    id: 15n,
    incidentId: 9n,
    incidentKind: 'fall',
    coverKind: 'medical',
    claimantName: 'Ada Park',
    bandId: 7,
    zoneName: 'Main stage',
    policyId: 1n,
    status: { tag: 'Settled' },
    statusNote: 'Paid out.',
    packVersion: 2,
    packHash: 'abcdef0123456789',
    corroboration: 'corroborated',
    costCents: 15000n,
    payoutCents: 15000n,
    recoverableCents: 12000n,
    venueCostCents: 3000n,
    reviewVerdict: 'approve',
    decidedBy: 'approver',
    settlementRuleId: 0n,
    settlementRuleVersion: 0,
    routedToName: '',
    refusalReason: '',
    payoutReference: 'NESSIE-1',
    fnolHash: 'fnolhash',
    summaryHash: 'summaryhash',
    determinationHash: '',
    recoveryHash: '',
    openedAt: at(Date.parse('2026-10-25T03:00:00Z')),
    decidedAt: at(Date.parse('2026-10-25T03:20:00Z')),
    settledAt: at(Date.parse('2026-10-25T03:21:00Z')),
    reconciledAt: undefined,
    updatedAt: at(Date.parse('2026-10-25T03:21:00Z')),
    statement: 'I slipped near the stage.',
    ...extra,
  }
}

function review(id: bigint, packVersion: number, verdict: string): Row {
  return {
    id,
    claimId: 15n,
    packVersion,
    verdict,
    causation: '',
    summary: `Review ${id}`,
    concerns: [],
    innocentExplanations: [],
    missingEvidence: [],
    citedFactIds: [1, 2],
    rejected: [],
    modelCallId: 0n,
    createdAt: at(Date.parse('2026-10-25T03:10:00Z')),
  }
}

function clause(id: bigint, packVersion: number, score: number): Row {
  return { id, claimId: 15n, packVersion, clauseId: `C-${id}`, policy: 'venue', section: 'medical_payments', page: 4, text: `Clause ${id}`, score }
}

function claimTables(extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    claimsBoard: [claimRow()],
    boardReviews: [review(1n, 1, 'refuse'), review(2n, 2, 'approve'), review(3n, 1, 'needs_more')],
    claimClauses: [clause(1n, 1, 0.9), clause(2n, 2, 0.4), clause(3n, 2, 0.8)],
    boardFacts: [
      { id: 1n, claimId: 15n, packVersion: 1, seq: 1, source: 'staff_note', key: 'note', value: 'old pack', observedAt: at(1), readAt: at(1), reader: 'code', reference: 'a' },
      { id: 2n, claimId: 15n, packVersion: 2, seq: 1, source: 'staff_note', key: 'note', value: 'Ice on the wrist', observedAt: at(Date.parse('2026-10-25T03:05:00Z')), readAt: at(1), reader: 'code', reference: 'b' },
    ],
    boardPolicies: [{ id: 1n, insurerName: 'Harbor Mutual', policyNumber: 'HM-42' }],
    boardLedger: [],
    ...extra,
  }
}

afterEach(() => {
  cleanup()
  dropLink()
  useSession.setState({ phase: 'idle', owner: false, roles: [], actionError: null, eventEnded: false })
  useSettlement.setState({ error: null, busy: false })
})

describe('settlement store', () => {
  it('reads the rows, keeping the newest pack version of reviews and clauses', () => {
    const { conn, subscribed } = fakeConnection(claimTables({
      boardMerchShipping: [{ orderId: 5n, shippingAddress: 'Ada Park\n1 Main St' }],
      boardAttendees: [{ nodeId: 7n, displayName: 'Ada Park', bandId: 7 }],
      boardWallets: [
        { nodeId: 7n, accountId: 'acct-1234567890', balanceCents: 5000n },
        { nodeId: 99n, accountId: 'acct-orphan', balanceCents: 100n },
      ],
    }))
    attachLink(conn)
    const state = useSettlement.getState()

    expect(state.claims['15']).toMatchObject({ status: 'settled', recoverableCents: 12000, packVersion: 2, statement: 'I slipped near the stage.' })
    expect(state.reviews['15']).toMatchObject({ id: '2', packVersion: 2, verdict: 'approve', citedFactIds: [1, 2] })
    expect(state.clauses['15'].map((row) => row.id)).toEqual(['3', '2'])
    expect(state.facts['15'].map((row) => row.value)).toEqual(['Ice on the wrist'])
    expect(state.shipping['5']).toBe('Ada Park\n1 Main St')
    expect(state.wallets).toEqual([{ nodeId: '7', name: 'Ada Park', bandId: 7, accountId: 'acct-1234567890', balanceCents: 5000 }])
    for (const query of SETTLEMENT_QUERIES) expect(subscribed).toContain(query)

    watchClaimClauses('15')
    watchClaimClauses('15')
    expect(subscribed.filter((query) => query === 'SELECT * FROM claim_clauses(15)')).toHaveLength(1)
  })

  it('keeps the latest extracted bill for costs while a newer record is pending', () => {
    attachLink(fakeConnection(claimTables({
      boardRecords: [
        { id: 1n, claimId: 15n, status: 'extracted', billedCents: 10000n },
        { id: 2n, claimId: 15n, status: 'extracted', billedCents: 12000n },
        { id: 3n, claimId: 15n, status: 'pending', billedCents: 0n },
      ],
    })).conn)
    expect(useSettlement.getState().records['15']).toMatchObject({ id: '3', status: 'pending' })
    expect(useSettlement.getState().extractedRecords['15']).toMatchObject({ id: '2', billedCents: 12000 })
    dropLink()
    expect(useSettlement.getState().extractedRecords).toEqual({})
  })

  it('clears the store when the socket closes', () => {
    attachLink(fakeConnection(claimTables()).conn)
    expect(useSettlement.getState().claims['15']).toBeDefined()
    dropLink()
    expect(useSettlement.getState().claims).toEqual({})
  })

  it('builds the evidence trail in time order', () => {
    attachLink(fakeConnection(claimTables()).conn)
    const s = useSettlement.getState()
    const trail = buildTrail({
      claim: s.claims['15'],
      facts: s.facts['15'],
      checks: [],
      decisions: [],
      review: s.reviews['15'],
      approvals: [],
      clinic: undefined,
      record: undefined,
      ledger: [],
      rules: {},
      zones: {},
      bandNames: {},
    })
    expect(trail.map((step) => step.source)).toEqual(['Claim', 'Staff note', 'Decision Engine', 'Ledger'])
    expect(trail[0].text).toBe('Ada Park filed the claim: "I slipped near the stage."')
    expect(trail[3].text).toBe('Settled (NESSIE-1)')
  })
})

describe('settlement actions', () => {
  it('sends the insurer payment in cents from a dollar string', async () => {
    const { conn, reducers } = fakeConnection(claimTables())
    attachLink(conn)
    await recordInsurerPayment('15', '180.5', ' CHQ-1 ')
    expect(reducers.recordInsurerPayment).toHaveBeenCalledWith({ claimId: 15n, amountCents: 18050n, reference: 'CHQ-1' })
    await expect(recordInsurerPayment('15', 'abc', '')).rejects.toThrow('The amount is in dollars, for example 180.00.')
    expect(reducers.recordInsurerPayment).toHaveBeenCalledTimes(1)
  })

  it('records the payment from the docket at the recoverable amount', async () => {
    const user = userEvent.setup()
    const { conn, reducers } = fakeConnection(claimTables())
    attachLink(conn)
    useSession.setState({ phase: 'live', owner: false, roles: ['ops'] })
    render(<ClaimExtras claimId="15" />)
    const form = screen.getByRole('form', { name: "Record the insurer's payment" })
    expect(within(form).getByLabelText('Amount in dollars')).toHaveValue('120.00')
    await user.type(within(form).getByLabelText('Reference'), 'WIRE-9')
    await user.click(within(form).getByRole('button', { name: 'Record the payment' }))
    expect(reducers.recordInsurerPayment).toHaveBeenCalledWith({ claimId: 15n, amountCents: 12000n, reference: 'WIRE-9' })
    expect(screen.getByText('Paid out. Waiting for the insurer to pay $120.00 back.')).toBeInTheDocument()
    expect(screen.getByText('Insurer pays back: Harbor Mutual, policy HM-42, medical cover')).toBeInTheDocument()
  })

  it('names the band responsible by its number', async () => {
    const { conn, reducers } = fakeConnection(claimTables())
    attachLink(conn)
    expect(parseBandNumber('Band 07')).toBe(7)
    expect(parseBandNumber('BANDIT-12')).toBe(12)
    expect(parseBandNumber('seven')).toBeNull()
    await nameResponsibleBand('9', '07', ' knocked the speaker ')
    expect(reducers.nameResponsibleBand).toHaveBeenCalledWith({ incidentId: 9n, bandId: 7, note: 'knocked the speaker' })
    await expect(nameResponsibleBand('9', 'seven', '')).rejects.toThrow('seven is not a band number. A band number looks like 07.')
  })

  it('approves a scope review with the rule text and other proposals plainly', async () => {
    const { conn, reducers } = fakeConnection({})
    attachLink(conn)
    await approveRule({ id: '4', status: 'scope_proposed', ceilingCents: 50000, rule: 'Falls at the main stage up to $500.' })
    expect(reducers.approveRuleScopeReview).toHaveBeenCalledWith({ proposalId: 4n, ceilingSeenCents: 50000n, scopeSeen: 'Falls at the main stage up to $500.' })
    expect(reducers.approveRuleProposal).not.toHaveBeenCalled()
    await approveRule({ id: '5', status: 'proposed', ceilingCents: 20000, rule: 'SOS calls.' })
    expect(reducers.approveRuleProposal).toHaveBeenCalledWith({ proposalId: 5n, ceilingSeenCents: 20000n })
  })

  it('puts a refused rule approval where the rules page shows it', async () => {
    const { conn, reducers } = fakeConnection({})
    reducers.approveRuleProposal.mockRejectedValueOnce(new Error('The ceiling changed.'))
    attachLink(conn)
    await expect(approveRule({ id: '5', status: 'proposed', ceilingCents: 20000, rule: '' })).rejects.toThrow('The ceiling changed.')
    expect(useSession.getState().actionError).toBe('The ceiling changed.')
  })
})

function merchTables(): Record<string, Row[]> {
  return {
    boardAttendees: [{ nodeId: 7n, displayName: 'Ada', bandId: 7 }, { nodeId: 8n, displayName: 'Ben', bandId: 8 }],
    boardWallets: [
      { nodeId: 7n, accountId: 'acct-ada-000000', balanceCents: 5000n },
      { nodeId: 8n, accountId: 'acct-ben-000000', balanceCents: 500n },
    ],
    merchTemplate: [
      { id: 3n, name: 'tee', title: 'Night tee', kind: 'tee', priceCents: 2800n, imageUrl: '/blobs/tee', width: 1000, height: 1000, photoX: 100, photoY: 100, photoW: 400, photoH: 300, boothIds: [] },
      { id: 4n, name: 'mug', title: 'Sponsor mug', kind: 'mug', priceCents: 1500n, imageUrl: '/blobs/mug', width: 800, height: 600, photoX: 0, photoY: 0, photoW: 200, photoH: 200, boothIds: [2n] },
    ],
    boardMerchPicks: [
      { id: 1n, nodeId: 7n, attendeeName: 'Ada', rank: 1, templateId: 3n, photoId: 9n, photoUrl: '/blobs/photo', line: 'Ada and Ben', reason: 'She was front row.', createdAt: at(1) },
      { id: 2n, nodeId: 8n, attendeeName: 'Ben', rank: 1, templateId: 3n, photoId: 9n, photoUrl: '/blobs/photo', line: '', reason: 'Same photo.', createdAt: at(1) },
    ],
    boardPhotos: [{ id: 9n, url: '/blobs/photo', takenAt: at(2), zoneName: 'Pit', caption: 'Encore', nodeIds: [7n, 8n], peopleCount: 2, read: true }],
    boardMerchOrders: [
      { id: 5n, nodeId: 7n, attendeeName: 'Ada', templateId: 4n, title: 'Sponsor mug', size: '', amountCents: 1500n, status: 'paid', failure: '', nessiePurchaseId: 'np-77', createdAt: at(3), line: '', photoUrl: '' },
    ],
    boardMerchShipping: [{ orderId: 5n, shippingAddress: 'Ada\n1 Main St, Oakland' }],
    booth: [{ id: 2n, name: 'Acme booth' }],
  }
}

describe('merch desk', () => {
  it('buys as an attendee with the shipping address', async () => {
    const user = userEvent.setup()
    const { conn, reducers } = fakeConnection(merchTables())
    attachLink(conn)
    useSession.setState({ phase: 'live', owner: true, roles: [], eventEnded: true })
    render(<MerchExtras />)

    await user.click(screen.getByRole('button', { name: /^Ada · Band 07/ }))
    const form = screen.getByRole('form', { name: 'Buy Night tee as Ada' })
    expect(within(form).getByLabelText('Size')).toHaveValue('M')
    const address = within(form).getByLabelText('Shipping address')
    expect(address).toHaveValue('Ada\n1 Main St, Oakland')
    expect(address).toHaveAttribute('maxlength', '1000')
    await user.clear(address)
    await user.type(address, 'Ada Park, 2 Pier Rd, Oakland, CA 94607, US')
    await user.selectOptions(within(form).getByLabelText('Size'), 'L')
    await user.click(within(form).getByRole('button', { name: 'Buy as Ada' }))
    expect(reducers.buyMerchAsWithShipping).toHaveBeenCalledWith({
      nodeId: 7n,
      templateId: 3n,
      photoId: 9n,
      size: 'L',
      shippingAddress: 'Ada Park, 2 Pier Rd, Oakland, CA 94607, US',
    })

    await user.click(screen.getByRole('button', { name: /^Ben · Band 08/ }))
    expect(screen.getByRole('button', { name: 'Buy as Ben' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Run the shopping agent again' }))
    expect(reducers.rerunShoppingAgent).toHaveBeenCalledWith({})
    expect(screen.getByText('np-77')).toBeInTheDocument()
    expect(screen.getAllByText('Acme booth').length).toBeGreaterThan(0)
  })

  it('splits paid sales between the product and its sponsor booth', () => {
    attachLink(fakeConnection(merchTables()).conn)
    const { orders, templates } = useSettlement.getState()
    const { products, booths, total } = merchSales(orders, templates)
    expect(products.get('4')?.line).toEqual({ orders: 1, sales: 1500, print: 500, fee: 150, owed: 850 })
    expect(booths.get('2')).toEqual({ orders: 1, sales: 1500, print: 500, fee: 150, owed: 850 })
    expect(total.sales).toBe(1500)
  })
})

describe('without the ops role', () => {
  it('shows no settlement or merch forms', () => {
    attachLink(fakeConnection({ ...claimTables({ claimsBoard: [claimRow({ coverKind: 'property', incidentKind: 'property' })] }), ...merchTables() }).conn)
    useSession.setState({ phase: 'live', owner: false, roles: ['medic'], eventEnded: true })
    render(
      <>
        <ClaimExtras claimId="15" />
        <MerchExtras />
      </>,
    )
    expect(screen.getByText('Who pays what')).toBeInTheDocument()
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record the payment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Name who did it' })).not.toBeInTheDocument()
    expect(screen.queryByText('Letters')).not.toBeInTheDocument()
    expect(screen.queryByText('Buy as an attendee')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run the shopping agent again' })).not.toBeInTheDocument()
    expect(screen.getByText('Orders show for the organizer.')).toBeInTheDocument()
    expect(screen.queryByText('np-77')).not.toBeInTheDocument()
  })
})
