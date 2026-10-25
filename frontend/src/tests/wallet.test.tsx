import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WalletPage } from '@/components/wallet/WalletPage'
import { RouteProvider } from '@/cover/route'
import { FIXTURE_WALLET } from '@/payments/fixture'
import { EMPTY_WALLET, type WalletData } from '@/payments/rows'
import { usePayments } from '@/payments/store'
import { rememberBand } from '@/cover/tapLink'
import { seedSession, useSession } from '@/stdb/session'

const initialSession = useSession.getState()
const disputeCharge = vi.fn<(id: string, text: string) => Promise<void>>()
const buyMerch = vi.fn<(templateId: string, photoId: string, size: string) => Promise<void>>()
const connectWallet = vi.fn<() => Promise<void>>()
const claimBand = vi.fn<(token: string) => Promise<void>>()
const rerunShoppingAgent = vi.fn<() => Promise<void>>()
// The buy sheet ships an order, so it goes through the attendee module rather than the session.
const { buyMerchWithShipping } = vi.hoisted(() => ({
  buyMerchWithShipping: vi.fn<(templateId: string, photoId: string, size: string, address: string) => Promise<boolean>>(),
}))
vi.mock('@/stdb/attendeeOps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/stdb/attendeeOps')>()),
  buyMerchWithShipping,
}))

const allReady = { walletEntriesReady: true, chargesReady: true, suggestionsReady: true, merchOrdersReady: true, photosReady: true }
const myBand = { bandId: 7, status: 'claimed', expiresAt: null }

function renderWallet(path = '/wallet') {
  window.history.replaceState(null, '', path)
  return render(<RouteProvider><WalletPage /></RouteProvider>)
}

function withWallet(wallet: WalletData) {
  usePayments.setState({ wallet })
}

beforeEach(() => {
  vi.resetAllMocks()
  sessionStorage.clear()
  for (const action of [disputeCharge, buyMerch, connectWallet, rerunShoppingAgent, claimBand]) action.mockResolvedValue(undefined)
  buyMerchWithShipping.mockResolvedValue(true)
  seedSession([], { myBand, myBandReady: true, wallet: { accountId: 'acct-0007', balanceCents: 6_000 }, ...allReady })
  useSession.setState({ disputeCharge, buyMerch, connectWallet, rerunShoppingAgent, claimBand })
  withWallet(FIXTURE_WALLET)
})

afterEach(() => {
  cleanup()
  useSession.setState(initialSession, true)
  usePayments.setState({ wallet: EMPTY_WALLET })
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('the wallet', () => {
  it('shows the balance as the largest figure, beside the strap', () => {
    renderWallet()
    const hero = screen.getByLabelText('Band 07 wallet')
    expect(within(hero).getByText('$60.00')).toHaveClass('wallet-balance')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('$40.00 paid.')
  })

  it('says the wallet is opening before my_wallet arrives, never $0.00', () => {
    seedSession([], { myBand, myBandReady: true, wallet: null, ...allReady })
    renderWallet()
    expect(screen.getByText('Your wallet is opening.')).toBeInTheDocument()
    expect(screen.queryByText('$0.00')).toBeNull()
  })

  it('shows why the wallet didn’t open and tries again', async () => {
    const user = userEvent.setup()
    seedSession([], { myBand, myBandReady: true, wallet: null, walletError: 'Nessie refused the customer.', ...allReady })
    useSession.setState({ connectWallet })
    renderWallet()
    expect(screen.getByText('Nessie refused the customer.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(connectWallet).toHaveBeenCalledTimes(1)
  })

  it('says plainly when there is nothing yet', () => {
    withWallet(EMPTY_WALLET)
    renderWallet()
    expect(screen.getByText('Nothing has been charged to your band.')).toBeInTheDocument()
    expect(screen.getByText('Nothing has moved through your wallet yet.')).toBeInTheDocument()
    expect(screen.getByText('No suggestions yet.')).toBeInTheDocument()
    expect(screen.getByText('No photograph of you yet.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('No payments yet.')
  })

  it('shows a view’s refusal where that view would be', () => {
    seedSession([], { myBand, myBandReady: true, wallet: null, ...allReady, walletViewErrors: { my_charges: 'Not allowed.' } })
    renderWallet()
    expect(screen.getByText(/This can’t load right now\. Not allowed\./)).toBeInTheDocument()
  })

  it('asks the phone to read a band when this identity has none', () => {
    seedSession([], { myBand: null, myBandReady: true })
    renderWallet()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hold your phone to your band.')
    expect(claimBand).not.toHaveBeenCalled()
  })

  it('connects the wallet to the band the phone opened', async () => {
    seedSession([], { myBand: null, myBandReady: true, wallet: null })
    useSession.setState({ claimBand, connectWallet })
    renderWallet('/wallet?band=band-12')
    expect(screen.getByLabelText('Band 12 wallet')).toBeInTheDocument()
    await waitFor(() => expect(claimBand).toHaveBeenCalledWith('BANDIT-12'))
    await waitFor(() => expect(connectWallet).toHaveBeenCalled())
  })

  it('opens the account when this phone already holds that band', async () => {
    seedSession([], { myBand: { bandId: 12, status: 'waiting_for_press', expiresAt: null }, myBandReady: true, wallet: null })
    useSession.setState({ claimBand, connectWallet })
    renderWallet('/wallet?band=band-12')
    expect(screen.getByLabelText('Band 12 wallet')).toBeInTheDocument()
    await waitFor(() => expect(connectWallet).toHaveBeenCalled())
    expect(claimBand).not.toHaveBeenCalled()
  })

  it('uses the band the phone opened earlier', async () => {
    rememberBand(8)
    seedSession([], { myBand: null, myBandReady: true, wallet: null })
    useSession.setState({ claimBand, connectWallet })
    renderWallet('/wallet')
    expect(screen.getByLabelText('Band 08 wallet')).toBeInTheDocument()
    await waitFor(() => expect(claimBand).toHaveBeenCalledWith('BANDIT-08'))
  })

  it('sends a dispute with its text, and not without one', async () => {
    const user = userEvent.setup()
    useSession.setState({ disputeCharge })
    renderWallet()
    await user.click(screen.getByRole('button', { name: 'This isn’t right' }))
    await user.click(screen.getByRole('button', { name: 'Send to the venue' }))
    expect(screen.getByText('Say what isn’t right.')).toBeInTheDocument()
    expect(disputeCharge).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('What isn’t right?'), 'I was at the stage then.')
    await user.click(screen.getByRole('button', { name: 'Send to the venue' }))
    expect(disputeCharge).toHaveBeenCalledWith(FIXTURE_WALLET.charges[0].id, 'I was at the stage then.')
  })

  it('shows photographs the band is in', () => {
    withWallet({
      ...FIXTURE_WALLET,
      photos: [{ id: '9', url: '/blobs/stage', takenAt: Date.parse('2026-10-25T04:12:00Z'), zoneName: 'Stage', caption: 'Opening', people: ['Jonah Chen'] }],
    })
    renderWallet()
    const section = screen.getByRole('region', { name: 'Photographs of you' })
    expect(within(section).getByRole('img', { name: 'Opening' })).toHaveAttribute('src', '/blobs/stage')
    expect(within(section).getByText(/Stage · .* · With Jonah Chen/)).toBeInTheDocument()
  })

  it('buys a tee in the chosen size and ships it to the typed address', async () => {
    const user = userEvent.setup()
    renderWallet()
    const tee = FIXTURE_WALLET.suggestions.find((pick) => /tee/i.test(pick.title))!
    const card = screen.getAllByRole('listitem').find((item) => item.textContent?.includes(tee.title) && item.classList.contains('wallet-pick'))!
    await user.click(within(card).getByRole('button', { name: 'Buy with my band' }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByLabelText('M')).toBeChecked()
    await user.click(within(sheet).getByLabelText('L'))
    await user.type(within(sheet).getByLabelText('Shipping address'), 'Alex Guest, 1 Main St, Berkeley')
    await user.click(within(sheet).getByRole('button', { name: /^Buy for/ }))
    expect(buyMerchWithShipping).toHaveBeenCalledWith(tee.templateId, tee.photoId, 'L', 'Alex Guest, 1 Main St, Berkeley')
    expect(buyMerch).not.toHaveBeenCalled()
  })

  it('buys a poster with no size', async () => {
    const user = userEvent.setup()
    renderWallet()
    const poster = FIXTURE_WALLET.suggestions.find((pick) => /poster/i.test(pick.title))!
    const card = screen.getAllByRole('listitem').find((item) => item.textContent?.includes(poster.title) && item.classList.contains('wallet-pick'))!
    await user.click(within(card).getByRole('button', { name: 'Buy with my band' }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).queryByText('Size')).toBeNull()
    await user.type(within(sheet).getByLabelText('Shipping address'), 'Alex Guest, 1 Main St, Berkeley')
    await user.click(within(sheet).getByRole('button', { name: /^Buy for/ }))
    expect(buyMerchWithShipping).toHaveBeenCalledWith(poster.templateId, poster.photoId, '', 'Alex Guest, 1 Main St, Berkeley')
  })

  it('takes no card number anywhere', async () => {
    const user = userEvent.setup()
    renderWallet()
    await user.click(screen.getByRole('button', { name: 'This isn’t right' }))
    await user.click(screen.getAllByRole('button', { name: 'Buy with my band' })[0])
    for (const input of document.querySelectorAll('input, textarea, select')) {
      expect(input.getAttribute('autocomplete') ?? '').not.toMatch(/^cc-/)
      expect(input.getAttribute('inputmode') ?? '').not.toBe('numeric')
      expect(`${input.getAttribute('name') ?? ''} ${input.id} ${input.getAttribute('placeholder') ?? ''}`).not.toMatch(/card|cvc|cvv|expir/i)
    }
  })
})
