import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RouteProvider, useRoute } from '@/cover/route'
import { tapTarget } from '@/cover/tapLink'

function Where() {
  const { path, search } = useRoute()
  return <p>{`${path}${search}`}</p>
}

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('band tag links', () => {
  it('sends a tag link to that band’s sign-up page', () => {
    expect(tapTarget('/t/BANDIT-01')).toBe('/register?band=band-01')
    expect(tapTarget('/t/bandit-7')).toBe('/register?band=band-07')
    expect(tapTarget('/t/BANDIT-09/')).toBe('/register?band=band-09')
  })

  it('leaves every other address alone', () => {
    expect(tapTarget('/register')).toBeNull()
    expect(tapTarget('/t/')).toBeNull()
    expect(tapTarget('/t/BANDIT-')).toBeNull()
    expect(tapTarget('/t/BANDIT-01/extra')).toBeNull()
  })

  it('opens the sign-up page when the app loads on a tag link', () => {
    window.history.replaceState(null, '', '/t/BANDIT-03')
    render(
      <RouteProvider>
        <Where />
      </RouteProvider>,
    )
    expect(screen.getByText('/register?band=band-03')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/register')
    expect(window.location.search).toBe('?band=band-03')
  })
})
