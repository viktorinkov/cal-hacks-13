import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaymentsPage } from '@/components/desk/PaymentsPage'
import { DeskTabs } from '@/components/desk/DeskTabs'
import { formatCents } from '@/cover/money'
import { RouteProvider } from '@/cover/route'
import { FIXTURE_BAND, FIXTURE_DESK } from '@/payments/fixture'
import { applyFilter, deskPayments } from '@/payments/model'
import { EMPTY_DESK } from '@/payments/rows'
import { DESK_VIEWS, usePayments } from '@/payments/store'
import { seedSession, useSession } from '@/stdb/session'

const initialSession = useSession.getState()
const approveCharge = vi.fn<(id: string, cents: number, hash: string) => Promise<void>>()
const waiveCharge = vi.fn<(id: string, reason: string) => Promise<void>>()
const buyMerchAs = vi.fn<(nodeId: string, templateId: string, photoId: string, size: string) => Promise<void>>()

const openViews = Object.fromEntries(Object.values(DESK_VIEWS).map((query) => [query, 'open' as const]))
const bandSeven = FIXTURE_DESK.charges.find((charge) => charge.bandId === FIXTURE_BAND && charge.status === 'recommended')!

function renderDesk(path = '/payments') {
  window.history.replaceState(null, '', path)
  return render(<RouteProvider><PaymentsPage /></RouteProvider>)
}

beforeEach(() => {
  vi.resetAllMocks()
  approveCharge.mockResolvedValue(undefined)
  waiveCharge.mockResolvedValue(undefined)
  buyMerchAs.mockResolvedValue(undefined)
  seedSession([], { staffRequested: true, staffQueries: openViews })
  useSession.setState({ approveCharge, waiveCharge, buyMerchAs })
  usePayments.setState({ desk: FIXTURE_DESK })
})

afterEach(() => {
  cleanup()
  useSession.setState(initialSession, true)
  usePayments.setState({ desk: EMPTY_DESK })
  window.history.replaceState(null, '', '/')
})

describe('the payments desk', () => {
  it('shows figures that are the sums of the rows under their filters', () => {
    renderDesk()
    const payments = deskPayments(FIXTURE_DESK)
    const paid = applyFilter(payments, 'paid').reduce((sum, payment) => sum + payment.amountCents, 0)
    expect(screen.getByText('Through the bands')).toBeInTheDocument()
    expect(screen.getByText(formatCents(paid))).toBeInTheDocument()
    const filters = within(screen.getByRole('group', { name: 'Filter by status' })).getAllByRole('button')
    const counts = filters.map((button) => Number(button.textContent?.match(/(\d+)$/)?.[1]))
    expect(counts.slice(1).reduce((sum, count) => sum + count, 0)).toBe(counts[0])
    expect(counts[0]).toBe(payments.length)
  })

  it('pins a band’s wallet when its number is searched', async () => {
    const user = userEvent.setup()
    renderDesk()
    await user.type(screen.getByRole('searchbox'), '07')
    const card = screen.getByLabelText('Band 07 wallet')
    expect(card).toHaveTextContent('$60.00')
    const rows = within(screen.getByRole('table')).getAllByRole('row').filter((row) => row.tabIndex === 0)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row).toHaveTextContent('Band 07')
  })

  it('approves with exactly the amount and pack hash it showed', async () => {
    const user = userEvent.setup()
    renderDesk()
    await user.click(screen.getByRole('button', { name: 'Review charge' }))
    const sheet = await screen.findByRole('dialog')
    await user.click(within(sheet).getByRole('button', { name: `Approve ${formatCents(bandSeven.amountCents)}` }))
    expect(approveCharge).toHaveBeenCalledWith(bandSeven.id, bandSeven.amountCents, bandSeven.packHash)
  })

  it('keeps a refusal in place, with the new amount', async () => {
    const user = userEvent.setup()
    approveCharge.mockImplementation(async () => {
      usePayments.setState((state) => ({
        desk: { ...state.desk, charges: state.desk.charges.map((charge) => (charge.id === bandSeven.id ? { ...charge, amountCents: 5_000, packHash: 'new' } : charge)) },
      }))
      throw new Error('The evidence pack changed since you opened it.')
    })
    renderDesk()
    await user.click(screen.getByRole('button', { name: 'Review charge' }))
    const sheet = await screen.findByRole('dialog')
    await user.click(within(sheet).getByRole('button', { name: 'Approve $45.00' }))
    const alert = await within(sheet).findByRole('alert')
    expect(alert).toHaveTextContent('The evidence pack changed since you opened it.')
    expect(alert).toHaveTextContent('It’s now $50.00, not $45.00.')
    await user.click(within(alert).getByRole('button', { name: 'Review the new amount' }))
    await user.click(within(sheet).getByRole('button', { name: 'Approve $50.00' }))
    expect(approveCharge).toHaveBeenLastCalledWith(bandSeven.id, 5_000, 'new')
  })

  it('will not waive without a reason', async () => {
    const user = userEvent.setup()
    renderDesk()
    await user.click(screen.getByRole('button', { name: 'Review charge' }))
    const sheet = await screen.findByRole('dialog')
    await user.click(within(sheet).getByRole('button', { name: 'Waive…' }))
    await user.click(within(sheet).getByRole('button', { name: 'Waive charge' }))
    expect(within(sheet).getByText('Write why the charge is waived.')).toBeInTheDocument()
    expect(waiveCharge).not.toHaveBeenCalled()
    await user.type(within(sheet).getByLabelText('Why it’s waived'), 'The booth withdrew it.')
    await user.click(within(sheet).getByRole('button', { name: 'Waive charge' }))
    expect(waiveCharge).toHaveBeenCalledWith(bandSeven.id, 'The booth withdrew it.')
  })

  it('says when this sign-in can’t see payments', () => {
    seedSession([], { staffRequested: false })
    renderDesk()
    expect(screen.getAllByText(/This sign-in can’t see payments/).length).toBeGreaterThan(0)
  })

  it('waits for the host before showing any figure', () => {
    seedSession([], { staffRequested: true, staffQueries: {} })
    usePayments.setState({ desk: EMPTY_DESK })
    renderDesk()
    expect(screen.queryByText('$0.00')).toBeNull()
    expect(screen.getAllByText('Loading payments…').length).toBeGreaterThan(0)
  })

  it('labels every figure as sample data in fixture mode', () => {
    usePayments.setState({ desk: EMPTY_DESK })
    renderDesk('/payments?fixture=payments')
    expect(screen.getAllByText('sim').length).toBeGreaterThanOrEqual(4)
    expect(screen.getByText('Through the bands')).toBeInTheDocument()
  })

  it('takes no card number', async () => {
    const user = userEvent.setup()
    renderDesk()
    await user.type(screen.getByRole('searchbox'), '07')
    await act(async () => { await user.click(screen.getAllByRole('button', { name: 'Buy for Band 07' })[0]) })
    for (const input of document.querySelectorAll('input, textarea')) {
      expect(input.getAttribute('autocomplete') ?? '').not.toMatch(/^cc-/)
      expect(`${input.getAttribute('name') ?? ''} ${input.id} ${input.getAttribute('placeholder') ?? ''}`).not.toMatch(/card|cvc|cvv|expir/i)
    }
  })
})

describe('the desk tabs', () => {
  it('list Payments after Settlements and Proposed rules', () => {
    render(<RouteProvider><DeskTabs /></RouteProvider>)
    const tabs = within(screen.getByRole('navigation', { name: 'Desk' })).getAllByRole('button').map((button) => button.textContent)
    expect(tabs.slice(0, 5)).toEqual(['Live', 'Attendees', 'Settlements', 'Proposed rules', 'Payments'])
  })
})

describe('payments never signal a band', () => {
  it('has no haptic, command or LED call in its code', () => {
    const sources = {
      ...import.meta.glob('../payments/*.ts', { query: '?raw', import: 'default', eager: true }),
      ...import.meta.glob('../components/payments/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
      ...import.meta.glob('../components/wallet/*.tsx', { query: '?raw', import: 'default', eager: true }),
      ...import.meta.glob(['../components/desk/PaymentsPage.tsx', '../components/desk/PaymentSheet.tsx'], { query: '?raw', import: 'default', eager: true }),
    } as Record<string, string>
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(10)
    for (const [file, source] of Object.entries(sources)) {
      expect(source, file).not.toMatch(/haptic|sendCommand|send_command|setLed|ledPattern/i)
    }
  })
})

describe('waiting on the host', () => {
  it('shows the decision as pending until the host answers', async () => {
    let resolve!: () => void
    approveCharge.mockImplementation(() => new Promise<void>((done) => { resolve = done }))
    const user = userEvent.setup()
    renderDesk()
    await user.click(screen.getByRole('button', { name: 'Review charge' }))
    const sheet = await screen.findByRole('dialog')
    await user.click(within(sheet).getByRole('button', { name: 'Approve $45.00' }))
    expect(within(sheet).getByRole('button', { name: 'Approving…' })).toBeDisabled()
    expect(within(sheet).getByText('$45.00')).toBeInTheDocument()
    await act(async () => resolve())
    await waitFor(() => expect(within(sheet).queryByRole('button', { name: 'Approving…' })).toBeNull())
  })
})
