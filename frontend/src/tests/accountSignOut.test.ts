import { afterEach, describe, expect, it } from 'vitest'
import { clearSignInCredentials, staffSignedIn } from '@/stdb/auth'
import { signedInPerson } from '@/stdb/operatorName'

function token(claims: Record<string, unknown>) { return `head.${btoa(JSON.stringify(claims))}.signature` }
afterEach(() => { localStorage.clear(); sessionStorage.clear() })

describe('account details and sign out', () => {
  it('clears this app account, active database token and personal draft data only', () => {
    localStorage.setItem('bandit-id-token', token({ email: 'first@example.com', exp: Date.now() / 1000 + 3600 }))
    for (const key of ['bandit-token:event', 'bandit-token', 'bandit.cover']) localStorage.setItem(key, 'private')
    localStorage.setItem('bandit-token:other-event', 'other')
    localStorage.setItem('unrelated-setting', 'keep')
    sessionStorage.setItem('bandit-oidc', 'pending')
    sessionStorage.setItem('bandit-band', '7')
    sessionStorage.setItem('unrelated-session', 'keep')
    expect(staffSignedIn()).toBe(true)
    clearSignInCredentials('event')
    expect(staffSignedIn()).toBe(false)
    expect(signedInPerson()).toEqual({ name: '', email: '' })
    for (const key of ['bandit-id-token', 'bandit-token:event', 'bandit-token', 'bandit.cover']) expect(localStorage.getItem(key)).toBeNull()
    expect(sessionStorage.getItem('bandit-oidc')).toBeNull()
    expect(sessionStorage.getItem('bandit-band')).toBeNull()
    expect(localStorage.getItem('bandit-token:other-event')).toBe('other')
    expect(localStorage.getItem('unrelated-setting')).toBe('keep')
    expect(sessionStorage.getItem('unrelated-session')).toBe('keep')
  })

  it.each([{ email: 'old@example.com', exp: 1 }, { email: 'unknown@example.com' }])('does not label an expired or incomplete token as a signed-in account', (claims) => {
    localStorage.setItem('bandit-id-token', token(claims))
    expect(signedInPerson()).toEqual({ name: '', email: '' })
  })
})
