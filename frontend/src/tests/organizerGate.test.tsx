import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrganizerGate } from '@/components/organizer/OrganizerGate'
import { beginSignIn, staffSignedIn } from '@/stdb/auth'
import { loadHostConfig, type HostConfig } from '@/stdb/host'
import { useSession } from '@/stdb/session'

vi.mock('@/stdb/auth', () => ({
  beginSignIn: vi.fn(),
  finishSignIn: vi.fn(),
  staffSignedIn: vi.fn(),
}))

vi.mock('@/stdb/host', () => ({ loadHostConfig: vi.fn() }))

const initialSession = useSession.getState()
const host: HostConfig = {
  authClientId: 'event-sign-in',
  database: 'event',
  spacetimeUrl: 'https://maincloud.spacetimedb.com',
  kibanaUrl: '',
  testMode: false,
}
const readyRoles = { 'SELECT * FROM my_roles': 'open', 'SELECT * FROM my_owner': 'open' } as const

function renderGate(path = '/organizer') {
  window.history.replaceState(null, '', path)
  return render(<OrganizerGate><p>Event desk</p></OrganizerGate>)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(loadHostConfig).mockResolvedValue(host)
  vi.mocked(staffSignedIn).mockReturnValue(true)
  vi.mocked(beginSignIn).mockResolvedValue(undefined)
  useSession.setState({ staff: false, owner: false, staffQueries: {} })
})

afterEach(() => {
  cleanup()
  useSession.setState(initialSession, true)
  window.history.replaceState(null, '', '/')
})

describe('organizer access', () => {
  it('requires email sign-in before offering organizer enrollment', async () => {
    vi.mocked(staffSignedIn).mockReturnValue(false)
    useSession.setState({ staffQueries: readyRoles })
    const user = userEvent.setup()
    renderGate()

    await user.click(await screen.findByRole('button', { name: 'Sign in with email' }))

    expect(beginSignIn).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('link', { name: 'Continue as organizer' })).not.toBeInTheDocument()
    expect(screen.queryByText('Event desk')).not.toBeInTheDocument()
  })

  it('waits for both role queries, then lets a signed-in attendee choose organizer access', async () => {
    renderGate()
    await screen.findByText('Event desk')
    expect(screen.queryByRole('link', { name: 'Continue as organizer' })).not.toBeInTheDocument()

    act(() => useSession.setState({ staffQueries: { 'SELECT * FROM my_roles': 'open' } }))
    expect(screen.queryByRole('link', { name: 'Continue as organizer' })).not.toBeInTheDocument()

    act(() => useSession.setState({ staffQueries: readyRoles }))
    expect(screen.getByRole('link', { name: 'Continue as organizer' })).toHaveAttribute('href', '/organizer-access?next=%2Forganizer')
    expect(screen.queryByText('Event desk')).not.toBeInTheDocument()
    expect(beginSignIn).not.toHaveBeenCalled()
  })

  it.each([
    ['staff member', false],
    ['owner', true],
  ])('keeps an existing %s in the desk', async (_label, owner) => {
    useSession.setState({ staff: true, owner, staffQueries: readyRoles })
    renderGate()

    expect(await screen.findByText('Event desk')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Continue as organizer' })).not.toBeInTheDocument()
    expect(beginSignIn).not.toHaveBeenCalled()
  })

  it('does not interpret a refused role query as an account with no role', async () => {
    useSession.setState({ staffQueries: { 'SELECT * FROM my_roles': 'refused', 'SELECT * FROM my_owner': 'open' } })
    renderGate()

    await screen.findByText('Event desk')
    expect(screen.queryByRole('link', { name: 'Continue as organizer' })).not.toBeInTheDocument()
  })

  it('keeps the existing test-identity path out of email enrollment', async () => {
    vi.mocked(staffSignedIn).mockReturnValue(false)
    useSession.setState({ staffQueries: readyRoles })
    renderGate('/organizer?as=ops')

    expect(await screen.findByText('Event desk')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in with email' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Continue as organizer' })).not.toBeInTheDocument()
  })

  it('preserves access on a local host without configured email sign-in', async () => {
    vi.mocked(loadHostConfig).mockResolvedValue({ ...host, authClientId: '' })
    useSession.setState({ staffQueries: readyRoles })
    renderGate()

    expect(await screen.findByText('Event desk')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Continue as organizer' })).not.toBeInTheDocument()
  })
})
