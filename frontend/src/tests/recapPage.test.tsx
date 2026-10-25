import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RegisterPage } from '@/components/join/RegisterPage'
import { Recap } from '@/components/recap/Recap'
import { WalletPage } from '@/components/wallet/WalletPage'
import { RouteProvider } from '@/cover/route'
import type { RankedRecap } from '@/recap/api'
import { FIXTURE_WALLET } from '@/payments/fixture'
import { usePayments } from '@/payments/store'
import type { RecapEncounter, RecapVisit } from '@/recap/night'
import { seedSession, useSession } from '@/stdb/session'

const initialSession = useSession.getState()
const at = (hour: number, minute: number) => Date.parse(`2026-10-24T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`)

const visit: RecapVisit = {
  id: '1', zoneName: 'Stage', booths: ['Visa'], startedAt: at(20, 0), endedAt: at(21, 0), minutes: 60,
}
const met: RecapEncounter = {
  id: '2', zoneName: 'Stage', startedAt: at(20, 12), lastSeenAt: at(20, 40), minutes: 25,
  person: { nodeId: '9', name: 'Bo Lin', photoUrl: '', handles: [{ platform: 'instagram', handle: 'bolin' }] },
}

const ready = {
  visitsReady: true, encountersReady: true, handlesReady: true, sharedVisitsReady: true, departureReady: true, photosReady: true,
  eventName: 'CalHacks', eventEnded: true, eventEndedAt: at(23, 0),
  visits: [visit], encounters: [met], handles: [{ platform: 'threads', handle: 'ada' }],
  recapPhotos: [{ id: '3', url: '/blobs/encore', takenAt: at(20, 30), zoneName: 'Stage', caption: 'Encore', people: [met.person] }],
}

function page(node: React.ReactNode, path: string) {
  window.history.replaceState(null, '', path)
  return render(<RouteProvider>{node}</RouteProvider>)
}

beforeEach(() => {
  seedSession([], { myBand: { bandId: 7, status: 'claimed', expiresAt: null }, myBandReady: true, wallet: { accountId: 'acct-0007', balanceCents: 6_000 }, walletEntriesReady: true, chargesReady: true, suggestionsReady: true, merchOrdersReady: true, ...ready })
  usePayments.setState({ wallet: FIXTURE_WALLET })
})

afterEach(() => {
  cleanup()
  useSession.setState(initialSession, true)
  window.history.replaceState(null, '', '/')
})

describe('the band page after the night', () => {
  it('keeps the wallet as the night, then flips it to the recap', async () => {
    seedSession([], { myBand: { bandId: 7, status: 'claimed', expiresAt: null }, myBandReady: true, wallet: { accountId: 'acct-0007', balanceCents: 6_000 }, eventEnded: false, departure: null })
    page(<WalletPage />, '/wallet')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/paid tonight|wallet/i)
    expect(screen.queryByRole('heading', { name: 'Where you were' })).toBeNull()
    cleanup()

    seedSession([], { myBand: { bandId: 7, status: 'claimed', expiresAt: null }, myBandReady: true, wallet: { accountId: 'acct-0007', balanceCents: 6_000 }, walletEntriesReady: true, chargesReady: true, suggestionsReady: true, merchOrdersReady: true, ...ready })
    page(<WalletPage />, '/wallet')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your CalHacks.')
    expect(await screen.findByText('The ranking didn’t answer. This is the night your band recorded.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Where you were' })).toBeInTheDocument()
    expect(screen.getAllByText('Bo Lin').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Instagram @bolin' })[0]).toHaveAttribute('href', 'https://instagram.com/bolin')
    expect(screen.getByRole('region', { name: 'Booths you spent time at' })).toHaveTextContent('Visa')
    expect(screen.getByText('Encore')).toBeInTheDocument()
    expect(screen.getByText('Threads @ada')).toBeInTheDocument()
    expect(screen.getByText('The night ended at', { exact: false })).toBeInTheDocument()
    expect(screen.getByLabelText('Band QY1G-XHXT wallet')).toBeInTheDocument()
  })

  it('keeps signup off a band until the night is known, then opens the recap', () => {
    seedSession([], { eventReady: false, departureReady: false, eventEnded: true, eventName: 'CalHacks', myBand: null, myBandReady: true })
    page(<RegisterPage />, '/register?band=band-07')
    expect(screen.getByRole('heading', { name: 'Opening your band…' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Register your band.' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Your CalHacks.' })).toBeNull()
    act(() => { useSession.setState({ eventReady: true, departureReady: true }) })
    expect(screen.getByRole('heading', { name: 'Your CalHacks.' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Register your band.' })).toBeNull()
  })

  it('replaces registration on that band once the night is over', async () => {
    page(<RegisterPage />, '/register?band=band-07')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your CalHacks.')
    expect(screen.queryByRole('heading', { name: 'Register your band.' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open your wallet' })).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open your wallet' }))
    expect(window.location.pathname).toBe('/wallet')
  })

  it('uses Elastic’s order when the ranking answers, and searches friends', async () => {
    const user = userEvent.setup()
    const ranked: RankedRecap = {
      displayName: 'Ada Poe',
      ranked: true,
      people: [{
        nodeId: '4', name: 'Ada Poe', photoUrl: '', handles: [{ platform: 'instagram', handle: 'ada' }],
        minutes: 18, metZone: 'Expo', metAt: at(21, 5), photosTogether: 1,
        interests: [{ name: 'Elastic', minutes: 10, yourMinutes: 14, shared: true }],
        similar: null,
      }],
      alsoThere: [],
      booths: [{ name: 'Elastic', zoneName: 'Expo', minutes: 14 }],
    }
    page(
      <Recap
        session={async () => 'token'}
        load={async () => ranked}
        search={async () => ({ query: 'meta', semanticRanked: true, candidateCount: 1, searchedCount: 1, people: [{ nodeId: '4', name: 'Ada Poe', photoUrl: '', handles: [], minutes: 18, reason: 'You were both at the Meta booth', places: [] }] })}
      />,
      '/wallet',
    )
    expect(await screen.findByText('Thanks for coming, Ada Poe. Here is your night.')).toBeInTheDocument()
    expect(screen.getByText(/You both hung out at the Elastic booth/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('What do you remember?'), 'the person at the Meta booth')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('You were both at the Meta booth')).toBeInTheDocument()
  })
})
