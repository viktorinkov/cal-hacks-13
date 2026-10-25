import { cn } from '@/lib/utils'
import { useRoute } from '@/cover/route'
import { useSession } from '@/stdb/session'

const ITEMS: { to: string; label: string; on: (path: string) => boolean; ownerOnly?: boolean }[] = [
  { to: '/', label: 'Map', on: (path: string) => path === '/' || path === '/organizer' },
  { to: '/payments', label: 'Payments', on: (path: string) => path === '/payments' },
  { to: '/cameras', label: 'Cameras', on: (path: string) => path === '/cameras' },
  { to: '/run', label: 'Run', on: (path: string) => path === '/run' },
  { to: '/venue', label: 'Venue', on: (path: string) => path === '/venue' },
  { to: '/attendees', label: 'Attendees', on: (path: string) => path === '/attendees' },
  { to: '/staff', label: 'Staff', on: (path: string) => path === '/staff', ownerOnly: true },
  { to: '/view-as', label: 'View as', on: (path: string) => path === '/view-as', ownerOnly: true },
  { to: '/bands', label: 'Bands', on: (path: string) => path === '/bands' },
  { to: '/test-bands', label: 'Test bands', on: (path: string) => path === '/test-bands' },
  { to: '/photos', label: 'Photos', on: (path: string) => path === '/photos' },
  { to: '/merch', label: 'Merch', on: (path: string) => path === '/merch' },
  { to: '/graph', label: 'Event graph', on: (path: string) => path === '/graph' },
  { to: '/claims', label: 'Settlements', on: (path: string) => path === '/claims' },
  { to: '/rules', label: 'Rules', on: (path: string) => path === '/rules' },
  { to: '/costs', label: 'Costs', on: (path: string) => path === '/costs' },
  { to: '/kibana', label: 'Kibana', on: (path: string) => path === '/kibana' },
]

/** The desks. Settlements and costs stay at the end. */
export function DeskTabs() {
  const { path, go } = useRoute()
  const owner = useSession((s) => s.owner)
  return (
    <nav aria-label="Desk" className="flex min-w-0 max-w-full flex-wrap items-center gap-x-4 gap-y-2">
      {ITEMS.filter((item) => !item.ownerOnly || owner).map((item) => {
        const on = item.on(path)
        const liveHost = window.location.hostname === 'band1t.vip'
        const target = item.to === '/' && (path === '/organizer' || liveHost) ? '/organizer' : item.to
        return (
          <button key={item.label} type="button" aria-current={on ? 'page' : undefined} onClick={() => go(target)} className="py-1 text-[13px] leading-none">
            <span className={cn('relative whitespace-nowrap', on ? 'text-ink' : 'text-ink-muted hover:text-ink')}>
              {item.label}
              {on && <span aria-hidden className="absolute -bottom-1.5 left-0 right-0 h-px bg-champagne" />}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
