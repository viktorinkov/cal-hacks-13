import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export interface RouteApi {
  path: string
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

const TITLES: Record<string, string> = {
  '/': 'BandIt Command Center',
  '/organizer': 'Organizer · BandIt',
  '/callback': 'Sign in · BandIt',
  '/attendees': 'Attendees · BandIt',
  '/bands': 'Bands · BandIt',
  '/photos': 'Photos · BandIt',
  '/merch': 'Merch · BandIt',
  '/graph': 'Event graph · BandIt',
  '/claims': 'Settlements · BandIt',
  '/costs': 'Costs · BandIt',
  '/join': 'BandIt',
  '/register': 'Register a band · BandIt',
}

export function RouteProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(currentPath)

  useEffect(() => {
    const sync = () => setPath(currentPath())
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
    setPath(next)
  }, [])

  const value = useMemo(() => ({ path, go }), [path, go])
  return <RouteContext.Provider value={value}>{children}</RouteContext.Provider>
}

export function useRoute(): RouteApi {
  const context = useContext(RouteContext)
  const fallback = useMemo<RouteApi>(
    () => ({
      path: typeof window === 'undefined' ? '/' : currentPath(),
      go: (to: string) => {
        window.history.pushState(null, '', to)
        window.dispatchEvent(new PopStateEvent('popstate'))
      },
    }),
    [],
  )
  return context ?? fallback
}
