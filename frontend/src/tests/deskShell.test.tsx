import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeskShell } from '@/components/desk/DeskShell'
import { DeskFrame } from '@/components/desk/DeskFrame'
import { RouteProvider, useRoute } from '@/cover/route'
import { useSession } from '@/stdb/session'
import { signOut } from '@/stdb/auth'

vi.mock('@/stdb/auth', async (original) => ({ ...await original<typeof import('@/stdb/auth')>(), signOut: vi.fn().mockResolvedValue(undefined) }))
const initial = useSession.getState()
function account(email: string) {
  return `head.${btoa(JSON.stringify({ email, exp: Date.now() / 1000 + 3600 }))}.signature`
}
function Pages() {
  const { path } = useRoute()
  return <DeskFrame motif="venue" title={path}><p>Page content</p></DeskFrame>
}
function setup(path = '/organizer') {
  window.history.replaceState(null, '', path)
  return render(<RouteProvider><DeskShell><Pages /></DeskShell></RouteProvider>)
}
afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
  useSession.setState(initial, true)
  window.history.replaceState(null, '', '/')
  vi.clearAllMocks()
})

describe('shared desk header', () => {
  it('keeps one header and the same navigation in place when changing screens', async () => {
    useSession.setState({ owner: true, phase: 'live' })
    setup()
    const header = screen.getByRole('banner')
    const nav = screen.getByRole('navigation', { name: 'Desk' })
    const before = within(nav).getAllByRole('button').map((item) => item.textContent)
    const user = userEvent.setup()
    for (const label of ['Payments', 'Cameras', 'Staff', 'View as', 'Live']) {
      await user.click(within(nav).getByRole('button', { name: label }))
      expect(screen.getByRole('banner')).toBe(header)
      expect(screen.getAllByRole('navigation', { name: 'Desk' })).toHaveLength(1)
      expect(within(nav).getAllByRole('button').map((item) => item.textContent)).toEqual(before)
      expect(within(nav).getByRole('button', { name: label })).toHaveAttribute('aria-current', 'page')
    }
  })

  it('uses the authenticated email ahead of a stale staff label and provides sign out', async () => {
    localStorage.setItem('bandit-id-token', account('v_minchev@ucsb.edu'))
    useSession.setState({ roleLabel: 'Leo P.', phase: 'live' })
    setup('/costs')
    expect(screen.getByLabelText('Signed in as v_minchev@ucsb.edu')).toBeInTheDocument()
    expect(screen.queryByText('Leo P.')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('does not invent an account name from a role label when no account is signed in', () => {
    useSession.setState({ roleLabel: 'Leo P.', phase: 'live' })
    setup()
    expect(screen.queryByText('Leo P.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it('reflects the next account instead of retaining the previous operator', () => {
    localStorage.setItem('bandit-id-token', account('first@example.com'))
    setup()
    expect(screen.getByLabelText('Signed in as first@example.com')).toBeInTheDocument()
    localStorage.setItem('bandit-id-token', account('second@example.com'))
    act(() => useSession.setState({ actors: [] }))
    expect(screen.queryByLabelText('Signed in as first@example.com')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Signed in as second@example.com')).toBeInTheDocument()
  })

  it.each(['/register', '/wallet', '/photo', `/view-as?view=${'a'.repeat(64)}&screen=claims`])('leaves personal or embedded page %s without an organizer header', (path) => {
    setup(path)
    expect(screen.queryByRole('navigation', { name: 'Desk' })).not.toBeInTheDocument()
    expect(screen.getByText('Page content')).toBeInTheDocument()
  })
})
