import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RouteProvider, useRoute } from '@/cover/route'
import { rememberedBand, tapTarget } from '@/cover/tapLink'

function Where() {
  const { path, search } = useRoute()
  return <p>{`${path}${search}`}</p>
}

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('band tag links', () => {
  it('sends a tag link to that band’s sign-up page', () => {
    expect(tapTarget('/t/BANDIT-01')).toBe('/register?band=BANDIT-01')
    expect(tapTarget('/t/K3QX-9A7M')).toBe('/register?band=K3QX-9A7M')
    expect(tapTarget('/t/BANDIT-09/')).toBe('/register?band=BANDIT-09')
  })

  it('leaves every other address alone', () => {
    expect(tapTarget('/register')).toBeNull()
    expect(tapTarget('/t/')).toBeNull()
    expect(tapTarget('/t/x')).toBeNull()
    expect(tapTarget('/t/BANDIT-01/extra')).toBeNull()
  })

  it('opens the sign-up page when the app loads on a tag link', () => {
    window.history.replaceState(null, '', '/t/BANDIT-03')
    render(
      <RouteProvider>
        <Where />
      </RouteProvider>,
    )
    expect(screen.getByText('/register?band=BANDIT-03')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/register')
    expect(window.location.search).toBe('?band=BANDIT-03')
    expect(rememberedBand()).toBe(3)
  })
})
