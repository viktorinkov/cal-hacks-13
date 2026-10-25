import { useSession } from './session'
import { isViewing } from './viewing'

function claimsOf(token: string): Record<string, unknown> {
  const part = token.split('.')[1]
  if (!part) return {}
  try {
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>
  } catch {
    return {}
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** The name on the email sign-in, or the email when the token has no name. */
export function signedInPerson(): { name: string; email: string } {
  if (typeof window === 'undefined' || isViewing()) return { name: '', email: '' }
  const token = window.localStorage.getItem('bandit-id-token')
  if (!token) return { name: '', email: '' }
  const claims = claimsOf(token)
  const exp = claims.exp
  if (typeof exp === 'number' && exp * 1000 <= Date.now() + 60_000) return { name: '', email: '' }
  const named = text(claims.name)
  const given = [text(claims.given_name), text(claims.family_name)].filter(Boolean).join(' ')
  const name = named && !named.includes('@') ? named : given
  return { name, email: text(claims.email) }
}

/** Who this desk is signed in as: the test identity, the email account, or the staff name. */
export function useOperatorName(): string {
  const actors = useSession((s) => s.actors)
  const roleLabel = useSession((s) => s.roleLabel)
  if (isViewing()) return roleLabel
  const played = typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('as') ?? '')
  const actor = played ? actors.find((item) => item.name === played) : undefined
  if (actor?.label) return actor.label
  const person = signedInPerson()
  return person.name || roleLabel || person.email
}
