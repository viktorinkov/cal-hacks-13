import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ViewAsPage } from '@/components/desk/ViewAsPage'
import { personViewUrl } from '@/stdb/viewing'
import { ViewedScreen } from '@/components/desk/ViewedScreen'
import { useDesk, type ViewablePerson } from '@/stdb/deskOps'
import { seedSession, useSession } from '@/stdb/session'
import { useAttendee } from '@/stdb/attendeeOps'
import { RouteProvider } from '@/cover/route'
import { signedInPerson } from '@/stdb/operatorName'
import { getSavedRegistration } from '@/cover/registry'

const initial = useSession.getState()
const attendeeInitial = useAttendee.getState()
const person: ViewablePerson = { key: 'attendee-a', identity: {}, hex: 'a'.repeat(64), name: 'Nia', role: 'attendee', bandId: 1200, crowd: true }
beforeEach(() => {
  window.history.replaceState(null, '', '/view-as')
  seedSession([], { owner: true, myBandReady: true, eventReady: true, departureReady: true })
  useDesk.setState({ people: [person] })
})
afterEach(() => {
  cleanup()
  useSession.setState(initial, true)
  useAttendee.setState(attendeeInitial, true)
  useDesk.setState({ people: [] })
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('full View As screens', () => {
  it('opens the selected identity, changes screens and discards the old frame when switching people', async () => {
    useDesk.setState({ people: [person, { ...person, key: 'medic-c', hex: 'c'.repeat(64), name: 'Ari', role: 'medic', bandId: 7 }] })
    render(<RouteProvider><ViewAsPage /></RouteProvider>)
    await userEvent.click(screen.getByRole('button', { name: /Nia/ }))
    const first = screen.getByTitle('Nia — Their band page now')
    expect(first).toHaveAttribute('src', personViewUrl(person, 'now'))
    await userEvent.click(screen.getByRole('button', { name: 'Medical card' }))
    expect(screen.getByTitle('Nia — Medical card').getAttribute('src')).toContain('screen=card')
    await userEvent.click(screen.getByRole('button', { name: /Ari/ }))
    expect(screen.queryByTitle('Nia — Medical card')).toBeNull()
    expect(screen.getByTitle('Ari — Organizer portal').getAttribute('src')).toContain('view=' + 'c'.repeat(64))
    await userEvent.click(screen.getByRole('button', { name: 'Hide their page' }))
    expect(screen.queryByTitle('Ari — Organizer portal')).toBeNull()
  })

  it('shows actual medical fields with disabled controls rather than a descriptive placeholder', () => {
    window.history.replaceState(null, '', personViewUrl(person, 'card'))
    useSession.setState({ owner: false, medicalCardReady: true, medicalCard: { bandId: 1200, name: 'Nia', bloodType: 'O+', allergies: 'Penicillin', conditions: '', medications: '', emergencyContact: 'Ari', insurer: 'Venue plan', plan: '', memberId: '', groupNumber: '', status: 'ready' } })
    render(<RouteProvider><ViewedScreen /></RouteProvider>)
    expect(screen.getByText('Penicillin')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'This is right' })).toBeDisabled()
  })

  it('shows a crowd band outside the predefined list without claiming it or reading the owner draft', () => {
    window.history.replaceState(null, '', personViewUrl(person, 'now'))
    localStorage.setItem('bandit.cover', JSON.stringify([{ bandId: 'band-1200', name: 'Owner draft', email: 'owner@example.test' }]))
    const claimBand = vi.fn().mockResolvedValue(undefined)
    useSession.setState({ owner: false, myBand: null, claimBand })
    useAttendee.setState({ attendee: { identity: person.hex, nodeId: '1200', displayName: 'Nia', photoUrl: '', findable: true, personId: '', organizationId: '', crowd: true } })
    render(<RouteProvider><ViewedScreen /></RouteProvider>)
    expect(screen.getByRole('form', { name: 'Register band 1200' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Nia')
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    expect(claimBand).not.toHaveBeenCalled()
    expect(getSavedRegistration('band-1200')).toBeNull()
    expect(signedInPerson()).toEqual({ name: '', email: '' })
  })

  it('does not use the owner’s remembered band for a crowd wallet', () => {
    sessionStorage.setItem('bandit-band', '7')
    window.history.replaceState(null, '', personViewUrl(person, 'wallet'))
    useSession.setState({ owner: false, myBand: null, wallet: { accountId: 'target-account', balanceCents: 20000 } })
    render(<RouteProvider><ViewedScreen /></RouteProvider>)
    expect(screen.getByLabelText('Band PDEV-9BGH wallet')).toBeInTheDocument()
    expect(screen.queryByLabelText('Band QY1G-XHXT wallet')).toBeNull()
  })

  it('keeps a departed crowd attendee’s wallet and merch visible', () => {
    window.history.replaceState(null, '', personViewUrl(person, 'wallet'))
    useSession.setState({ owner: false, eventEnded: true, myBand: null, wallet: { accountId: 'target-account', balanceCents: 20000 } })
    render(<RouteProvider><ViewedScreen /></RouteProvider>)
    expect(screen.getByLabelText('Band PDEV-9BGH wallet')).toBeInTheDocument()
  })

  it('opens a photographer’s saved frames with upload controls disabled', () => {
    window.history.replaceState(null, '', personViewUrl({ ...person, role: 'photographer' }, 'photo'))
    render(<RouteProvider><ViewedScreen /></RouteProvider>)
    expect(screen.getByRole('tab', { name: 'On the desk' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Add frames' })).toBeDisabled()
  })

  it('does not open a wallet automatically while inspecting an attendee', () => {
    const physical = { ...person, bandId: 7 }
    window.history.replaceState(null, '', personViewUrl(physical, 'wallet'))
    const claimBand = vi.fn().mockResolvedValue(undefined)
    const connectWallet = vi.fn().mockResolvedValue(undefined)
    useSession.setState({ owner: false, myBand: null, wallet: null, claimBand, connectWallet })
    render(<RouteProvider><ViewedScreen /></RouteProvider>)
    expect(claimBand).not.toHaveBeenCalled()
    expect(connectWallet).not.toHaveBeenCalled()
  })
})
