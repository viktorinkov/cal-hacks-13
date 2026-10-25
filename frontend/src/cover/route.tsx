import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isViewing } from '@/stdb/viewing'
import { bandIdFromSearch, rememberBand, tapTarget } from './tapLink'

export interface RouteApi {
  path: string
  search: string
  go: (to: string) => void
}

const RouteContext = createContext<RouteApi | null>(null)

function normalize(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname || '/'
}

export function currentPath() {
  return normalize(window.location.pathname)
}

/** Where the page landed, with a tag link swapped for its sign-up page so Back never returns to it. */
function arrival() {
  const tap = tapTarget(window.location.pathname)
  if (tap) window.history.replaceState(null, '', tap)
  const bandId = bandIdFromSearch(window.location.search)
  if (!isViewing() && bandId != null) rememberBand(bandId)
  return { path: currentPath(), search: window.location.search }
}

const TITLES: Record<string, string> = {
  '/': 'BandIt Command Center',
  '/organizer': 'Organizer · BandIt',
  '/callback': 'Sign in · BandIt',
  '/payments': 'Payments · BandIt',
  '/wallet': 'Wallet · BandIt',
  '/venue': 'Venue · BandIt',
  '/attendees': 'Attendees · BandIt',
  '/staff': 'Staff · BandIt',
  '/view-as': 'View as · BandIt',
  '/bands': 'Bands · BandIt',
  '/cameras': 'Cameras · BandIt',
  '/photos': 'Photos · BandIt',
  '/photo': 'Frames · BandIt',
  '/merch': 'Merch · BandIt',
  '/graph': 'Event graph · BandIt',
  '/claims': 'Settlements · BandIt',
  '/rules': 'Rules · BandIt',
  '/costs': 'Costs · BandIt',
  '/run': 'Run · BandIt',
  '/test-bands': 'Test bands · BandIt',
  '/kibana': 'Kibana · BandIt',
  '/join': 'BandIt',
  '/register': 'Register a band · BandIt',
}

export function RouteProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(arrival)
  const { path, search } = location

  useEffect(() => {
    const sync = () => setLocation({ path: currentPath(), search: window.location.search })
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  useEffect(() => {
    document.title = TITLES[path] ?? 'BandIt'
  }, [path])

  const go = useCallback((to: string) => {
    const url = new URL(to, window.location.origin)
    const next = normalize(url.pathname)
    const search = url.search || window.location.search
    if (next === currentPath() && search === window.location.search) return
    window.history.pushState(null, '', `${next}${search}`)
    setLocation({ path: next, search })
  }, [])

  const value = useMemo(() => ({ path, search, go }), [path, search, go])
  return <RouteContext.Provider value={value}>{children}</RouteContext.Provider>
}

export function useRoute(): RouteApi {
  const context = useContext(RouteContext)
  const fallback = useMemo<RouteApi>(
    () => ({
      path: typeof window === 'undefined' ? '/' : currentPath(),
      search: typeof window === 'undefined' ? '' : window.location.search,
      go: (to: string) => {
        window.history.pushState(null, '', to)
        window.dispatchEvent(new PopStateEvent('popstate'))
      },
    }),
    [],
  )
  return context ?? fallback
}
