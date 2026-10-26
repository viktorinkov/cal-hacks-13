import { useState, type ReactNode } from 'react'
import { useRoute } from '@/cover/route'
import { signOut, staffSignedIn } from '@/stdb/auth'
import { useOperatorName } from '@/stdb/operatorName'
import { isViewing } from '@/stdb/viewing'
import { DeskTabs } from './DeskTabs'

const PERSONAL_PAGES = new Set(['/join', '/register', '/wallet', '/photo'])

/** One persistent header for every organizer page. Personal pages retain their own navigation. */
export function DeskShell({ children }: { children: ReactNode }) {
  const { path, go } = useRoute()
  const operator = useOperatorName()
  const [leaving, setLeaving] = useState(false)
  const signedIn = staffSignedIn() || new URLSearchParams(window.location.search).has('as')
  if (PERSONAL_PAGES.has(path) || isViewing()) return children

  return (
    <div className="flex h-full min-h-0 flex-col bg-ground text-ink">
      <header data-desk-header className="relative z-40 flex shrink-0 items-center gap-4 border-b border-line bg-ground px-4 py-3 md:gap-6 md:px-6">
        <button type="button" onClick={() => go(window.location.hostname === 'band1t.vip' ? '/organizer' : '/')} aria-label="Band1t map" className="shrink-0 font-display text-[30px] leading-none tracking-[-0.01em] text-ink">
          Band1t
        </button>
        <DeskTabs />
        {signedIn && <div className="flex shrink-0 items-center gap-3">
          {operator && <span title={operator} aria-label={`Signed in as ${operator}`} className="hidden max-w-[12rem] truncate text-[13px] text-ink-muted lg:block">{operator}</span>}
          <button type="button" disabled={leaving} onClick={() => { setLeaving(true); void signOut() }} className="whitespace-nowrap text-[13px] text-ink-dim hover:text-ink disabled:opacity-50">{leaving ? 'Signing out…' : 'Sign out'}</button>
        </div>}
      </header>
      <div data-desk-content className="min-h-0 flex-1">{children}</div>
    </div>
  )
}
