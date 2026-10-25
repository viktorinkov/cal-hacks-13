import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ClaimFiling } from '@/components/claims/ClaimFiling'
import { StaffPage } from '@/components/desk/StaffPage'
import { ViewAsPage } from '@/components/desk/ViewAsPage'
import { RouteProvider } from '@/cover/route'
import { isModuleIncident } from '@/services/operatorCommands'
import { useDesk } from '@/stdb/deskOps'
import { seedSession, useSession } from '@/stdb/session'

afterEach(() => {
  cleanup()
  useSession.setState({ phase: 'idle', owner: false, roles: [], claims: [] })
  useDesk.setState({
    staff: [],
    injuries: [],
    filed: [],
    error: null,
    busy: false,
  })
})

describe('module incidents', () => {
  it('keeps the provisional ids on the old API and sends live ids to the module', () => {
    expect(isModuleIncident('inc-0001')).toBe(false)
    expect(isModuleIncident('14')).toBe(true)
    expect(isModuleIncident('live-4')).toBe(true)
  })
})

describe('staff page', () => {
  it('stays closed unless the caller is the owner', () => {
    useSession.setState({ owner: false, phase: 'live' })
    render(
      <RouteProvider>
        <StaffPage />
      </RouteProvider>,
    )
    expect(screen.getByText('Only the owner can add or remove staff.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument()
  })

  it('asks to add a medic by email', async () => {
    const user = userEvent.setup()
    seedSession([])
    render(
      <RouteProvider>
        <StaffPage />
      </RouteProvider>,
    )
    await user.type(screen.getByLabelText('Name'), 'Nia')
    await user.type(screen.getByLabelText('Email'), 'nia@band1t.vip')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText(/not connected/i)).toBeInTheDocument()
  })
})

describe('claim filing', () => {
  it('offers a payout retry and a recovery letter from the claim row', async () => {
    seedSession([])
    useDesk.setState({
      filed: [{
        id: '15',
        incidentId: '9',
        incidentKind: 'property',
        coverKind: 'property',
        status: 'Paying',
        statusNote: 'The payout failed at the bank.',
        claimantName: 'The venue',
        fnolHash: '',
        summaryHash: '',
        determinationHash: '',
        recoveryHash: '',
      }],
    })
    render(<ClaimFiling claimId="15" />)
    expect(screen.getByRole('button', { name: 'Retry the payout' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry the payout' }))
    expect(await screen.findByText(/not connected/i)).toBeInTheDocument()
  })
})

describe('view as is owner only', () => {
  it('does not offer a person to anyone else', () => {
    useSession.setState({ owner: false, phase: 'live' })
    render(
      <RouteProvider>
        <ViewAsPage />
      </RouteProvider>,
    )
    expect(screen.getByText('Only the owner can view the event as someone else.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Find a person')).not.toBeInTheDocument()
  })
})
