import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { DeskTabs } from '@/components/desk/DeskTabs'
import { RouteProvider } from '@/cover/route'
import { useSession } from '@/stdb/session'

const initialSession = useSession.getState()

afterEach(() => {
  cleanup()
  useSession.setState(initialSession, true)
  window.history.replaceState(null, '', '/')
})

describe('owner desk navigation', () => {
  it('opens Staff and View as from the desk and identifies the active page', async () => {
    const user = userEvent.setup()
    useSession.setState({ owner: true, phase: 'live' })
    window.history.replaceState(null, '', '/organizer')
    render(<RouteProvider><DeskTabs /></RouteProvider>)
    const desk = within(screen.getByRole('navigation', { name: 'Desk' }))

    await user.click(desk.getByRole('button', { name: 'Staff' }))
    expect(window.location.pathname).toBe('/staff')
    expect(document.title).toBe('Staff · BandIt')
    expect(desk.getByRole('button', { name: 'Staff' })).toHaveAttribute('aria-current', 'page')

    await user.click(desk.getByRole('button', { name: 'View as' }))
    expect(window.location.pathname).toBe('/view-as')
    expect(document.title).toBe('View as · BandIt')
    expect(desk.getByRole('button', { name: 'View as' })).toHaveAttribute('aria-current', 'page')
    expect(desk.getByRole('button', { name: 'Staff' })).not.toHaveAttribute('aria-current')
  })

  it.each(['ops', 'medic', 'photographer'])('keeps owner actions out of the %s navigation', (role) => {
    useSession.setState({ owner: false, roles: [role], phase: 'live' })
    render(<RouteProvider><DeskTabs /></RouteProvider>)
    expect(screen.queryByRole('button', { name: 'Staff' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View as' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Live' })).toBeInTheDocument()
  })
})
