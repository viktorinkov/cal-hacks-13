import { loadHostConfig } from './host'

const AUTH = 'https://auth.spacetimedb.com/oidc'
const ID_TOKEN = 'bandit-id-token'
const PENDING = 'bandit-oidc'

interface PendingSignIn {
  verifier: string
  state: string
  back: string
}

function bytes(size: number): Uint8Array {
  const out = new Uint8Array(size)
  crypto.getRandomValues(out)
  return out
}

function base64url(data: Uint8Array): string {
  let text = ''
  for (const byte of data) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A staff id token that has not expired. The token itself is never logged. */
export function staffSignedIn(): boolean {
  const token = window.localStorage.getItem(ID_TOKEN)
  if (!token) return false
  const part = token.split('.')[1]
  if (!part) return false
  try {
    const payload = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown }
    return typeof payload.exp === 'number' && payload.exp * 1000 > Date.now() + 60_000
  } catch {
    return false
  }
}

export function redirectUri(): string {
  return `${window.location.origin}/callback`
}

/** Send the browser to the same email sign-in the organizer portal uses. */
export async function beginSignIn(): Promise<void> {
  const host = await loadHostConfig()
  if (!host.authClientId) throw new Error('This host has no staff sign-in.')
  const verifier = base64url(bytes(32))
  const state = base64url(bytes(32))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  const pending: PendingSignIn = { verifier, state, back: `${window.location.pathname}${window.location.search}` }
  window.sessionStorage.setItem(PENDING, JSON.stringify(pending))
  const query = new URLSearchParams({
    client_id: host.authClientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: base64url(digest),
    code_challenge_method: 'S256',
    state,
  })
  window.location.assign(`${AUTH}/auth?${query}`)
}

/** Finish the redirect from the email sign-in and keep the id token for the database connection. */
export async function finishSignIn(): Promise<string> {
  const host = await loadHostConfig()
  const query = new URLSearchParams(window.location.search)
  const pending = JSON.parse(window.sessionStorage.getItem(PENDING) ?? '{}') as Partial<PendingSignIn>
  const code = query.get('code')
  if (!code || !pending.verifier || query.get('state') !== pending.state) throw new Error('Sign-in did not complete.')
  const res = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: host.authClientId,
      code_verifier: pending.verifier,
    }),
  })
  const body: unknown = await res.json().catch(() => null)
  const row = body && typeof body === 'object' ? (body as { id_token?: unknown; error_description?: unknown; error?: unknown }) : {}
  if (typeof row.id_token !== 'string' || !row.id_token) {
    const reason = typeof row.error_description === 'string' ? row.error_description : typeof row.error === 'string' ? row.error : 'Sign-in did not complete.'
    throw new Error(reason)
  }
  window.localStorage.setItem(ID_TOKEN, row.id_token)
  window.sessionStorage.removeItem(PENDING)
  const back = pending.back ?? ''
  return back.startsWith('/') && !back.startsWith('//') ? back : '/organizer'
}
