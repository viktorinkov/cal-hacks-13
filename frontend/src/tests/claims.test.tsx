import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaimsDesk } from '@/components/claims/ClaimsDesk'
import { boardHeadline, boardSummary, type BoardClaim } from '@/cover/liveClaims'
import { RouteProvider } from '@/cover/route'
import {
  CLAIMS,
  NIGHT_DEDUCTIBLE_CENTS,
  claimsHeadline,
  settleClaim,
  summarize,
} from '@/cover/claims'
import { formatCents, parseDollars } from '@/cover/money'
import { clearRegistrations, getRegistration, saveRegistration } from '@/cover/registry'
import { useClaims } from '@/cover/store'
import { seedSession, useSession } from '@/stdb/session'

beforeEach(() => {
  useClaims.getState().reset()
  clearRegistrations()
})

afterEach(() => {
  cleanup()
  useClaims.getState().reset()
  clearRegistrations()
})

describe('claim totals', () => {
  it('sums the night from the rows', () => {
    const summary = summarize(CLAIMS)
    expect(summary.detections).toBe(5)
    expect(summary.waiting).toBe(2)
    expect(summary.damageCents).toBe(215_500)
    expect(summary.unfiledCents).toBe(39_000)
    expect(summary.filedCents).toBe(93_000)
    expect(summary.filedCount).toBe(1)
    expect(summary.closedCount).toBe(2)
    expect(formatCents(summary.damageCents)).toBe('$2,155.00')
    expect(formatCents(summary.filedCents)).toBe('$930.00')
    expect(formatCents(0)).toBe('$0.00')
    expect(claimsHeadline(summary).title).toBe('Two still need a person.')
    expect(claimsHeadline(summary).sentence).toBe('$390.00 is still unfiled. $930.00 is already with Northline.')
  })

  it('pays damage minus the deductible only when a band is named and the rider covers it', () => {
    for (const claim of CLAIMS) {
      expect(claim.deductibleCents).toBe(NIGHT_DEDUCTIBLE_CENTS)
      const covered = claim.status === 'filed' || claim.status === 'needs_person'
      expect(claim.payableCents).toBe(covered ? Math.max(0, claim.damageCents - claim.deductibleCents) : 0)
    }
    expect(new Set(CLAIMS.map((claim) => claim.camera))).toEqual(new Set(['CAM-01', 'CAM-02']))
  })

  it('moves the unfiled payable onto Northline when a person confirms the band', () => {
    const open = CLAIMS.find((claim) => claim.id === 'CLM-14')!
    const filed = settleClaim(open)
    expect(filed.status).toBe('filed')
    expect(filed.payableCents).toBe(open.payableCents)
    expect(filed.damageCents).toBe(open.damageCents)
    const next = CLAIMS.map((claim) => (claim.id === open.id ? filed : claim))
    const summary = summarize(next)
    expect(summary.waiting).toBe(1)
    expect(summary.unfiledCents).toBe(0)
    expect(summary.filedCents).toBe(132_000)
    expect(formatCents(summary.filedCents)).toBe('$1,320.00')
    expect(summary.damageCents).toBe(215_500)
  })
})

describe('registrations', () => {
  it('keeps typed saved details ahead of the sample without persisting medical fields', () => {
    expect(getRegistration('band-05')?.allergies).toBe('Penicillin')
    const current = getRegistration('band-05')!
    saveRegistration({ ...current, name: 'New guest', allergies: 'Shellfish' })
    expect(getRegistration('band-05')?.name).toBe('New guest')
    expect(getRegistration('band-05')?.allergies).toBe('')
    expect(getRegistration('band-01')).toBeNull()
  })

  it('parses a tap amount into cents', () => {
    expect(parseDollars('14')).toBe(1400)
    expect(parseDollars('14.50')).toBe(1450)
    expect(parseDollars('0')).toBeNull()
    expect(parseDollars('14.999')).toBeNull()
  })
})

function boardClaim(partial: Pick<BoardClaim, 'id' | 'status' | 'payoutCents' | 'costCents'> & Partial<BoardClaim>): BoardClaim {
  return {
    incidentKind: 'Barrier rail bent',
    zoneName: 'West Passage',
    claimantName: 'Judge D',
    bandId: 5,
    statusNote: 'Waiting for a person.',
    recoverableCents: partial.payoutCents,
    venueCostCents: 0,
    packHash: 'abc',
    openedAt: '21:18',
    routedToName: 'Ops',
    routedToRole: 'ops',
    routedTo: '',
    corroboration: '',
    checks: [],
    facts: [],
    ...partial,
  }
}

describe('live board', () => {
  afterEach(() => {
    useSession.setState({ phase: 'idle', claims: [], staff: false, owner: false, actionError: null })
  })

  it('sums routed claims as unfiled and settled claims as filed', () => {
    const claims = [
      boardClaim({ id: '14', status: 'Routed', payoutCents: 39_000, costCents: 64_000 }),
      boardClaim({ id: '15', status: 'Settled', payoutCents: 93_000, costCents: 118_000, incidentKind: 'Speaker cabinet down' }),
    ]
    const summary = boardSummary(claims)
    expect(summary.waiting).toBe(1)
    expect(summary.unfiledCents).toBe(39_000)
    expect(summary.filedCents).toBe(93_000)
    expect(summary.damageCents).toBe(182_000)
    expect(boardHeadline(summary, 'Northline').title).toBe('One still needs a person.')
    expect(boardHeadline(summary, 'Northline').sentence).toBe('$390.00 is still unfiled. $930.00 is already with Northline.')
  })

  it('approves the routed claim on the desk', async () => {
    const user = userEvent.setup()
    seedSession([
      boardClaim({ id: '14', status: 'Routed', payoutCents: 39_000, costCents: 64_000 }),
      boardClaim({ id: '15', status: 'Settled', payoutCents: 93_000, costCents: 118_000, incidentKind: 'Speaker cabinet down' }),
    ])
    render(
      <RouteProvider>
        <ClaimsDesk />
      </RouteProvider>,
    )
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('One still needs a person.')
    await user.click(screen.getByRole('button', { name: 'Approve $390.00' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The board is clear.')
    expect(screen.getByText('$1,320.00')).toBeInTheDocument()
  })
})
