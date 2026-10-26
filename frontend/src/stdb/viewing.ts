import type { ViewablePerson } from './deskOps'

/** A View As frame always uses a fresh identity, never the owner's browser credentials. */
export function isViewing(search = window.location.search): boolean {
  return new URLSearchParams(search).has('view')
}

export function viewedIdentity(search = window.location.search): string {
  const value = new URLSearchParams(search).get('view') ?? ''
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error('This View As link is invalid.')
  return value.toLowerCase()
}

export type AuthorizeViewer = (viewer: string, target: string, source: Window) => Promise<void>
export type ViewerHost = Window & { banditAuthorizeViewer?: AuthorizeViewer }

export async function bindViewer(viewer: string, target: string): Promise<void> {
  if (window.parent === window) throw new Error('Open this page from the owner’s View As tab.')
  const authorize = (window.parent as ViewerHost).banditAuthorizeViewer
  if (!authorize) throw new Error('The owner’s View As page is no longer open.')
  await authorize(viewer, target, window)
}

/** The only viewer reducer opens a session for read-only recap/search API requests. */
export function protectViewerReducers(reducers: object): void {
  const calls = reducers as Record<string, unknown>
  for (const name of Object.keys(calls)) {
    if (name !== 'openApiSession' && typeof calls[name] === 'function') {
      calls[name] = () => Promise.reject(new Error('View As is read-only.'))
    }
  }
}

export function personScreens(person: ViewablePerson): [string, string][] {
  if (person.role === 'attendee') return [['now', 'Their band page now'], ['card', 'Medical card'], ['recap', 'Recap'], ['wallet', 'Wallet and merch']]
  if (person.role === 'photographer') return [['photo', 'Photo page']]
  return [['claims', 'Organizer portal']]
}

export function personViewUrl(person: ViewablePerson, screen: string): string {
  const query = new URLSearchParams({ view: person.hex, screen, bandId: String(person.bandId) })
  if (person.bandId) query.set('band', `band-${String(person.bandId).padStart(2, '0')}`)
  return `/view-as?${query}`
}
