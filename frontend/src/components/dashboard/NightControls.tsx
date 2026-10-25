import { useState } from 'react'
import { useCatalog } from '@/stdb/catalog'
import { endEvent, reopenEvent, setLowVisibility, useSession } from '@/stdb/session'

/** The Live tab's two night controls: exit guidance, and ending the event. Ops only. */
export function NightControls() {
  const phase = useSession((s) => s.phase)
  const owner = useSession((s) => s.owner)
  const roles = useSession((s) => s.roles)
  const actionError = useSession((s) => s.actionError)
  const lowVis = useCatalog((s) => s.lowVis)
  const ended = useCatalog((s) => s.eventEnded)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [busy, setBusy] = useState<'vis' | 'end' | null>(null)
  const ops = phase === 'live' && (owner || roles.includes('ops'))
  if (!ops) return null

  const run = async (key: 'vis' | 'end', work: () => Promise<void>) => {
    setBusy(key)
    try {
      await work()
      setConfirmEnd(false)
    } catch {
      // The session stores the refusal.
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        {lowVis ? (
          <button type="button" disabled={busy != null} className="text-ink hover:text-champagne" onClick={() => void run('vis', () => setLowVisibility(false))}>
            {busy === 'vis' ? 'Turning it off…' : 'Low visibility is on. Turn it off'}
          </button>
        ) : (
          <button type="button" disabled={busy != null} className="text-ink-dim hover:text-ink" onClick={() => void run('vis', () => setLowVisibility(true))}>
            {busy === 'vis' ? 'Turning it on…' : 'Low visibility: guide everyone to the exits'}
          </button>
        )}
        {ended ? (
          <button type="button" disabled={busy != null} className="text-ink hover:text-champagne" onClick={() => void run('end', () => reopenEvent())}>
            {busy === 'end' ? 'Reopening…' : 'Reopen the event'}
          </button>
        ) : confirmEnd ? (
          <>
            <button type="button" disabled={busy != null} className="text-ink hover:text-champagne" onClick={() => void run('end', () => endEvent())}>
              {busy === 'end' ? 'Ending…' : 'End it. Every tap link switches to the recap'}
            </button>
            <button type="button" className="text-ink-muted hover:text-ink" onClick={() => setConfirmEnd(false)}>
              Keep it open
            </button>
          </>
        ) : (
          <button type="button" disabled={busy != null} className="text-ink-dim hover:text-ink" onClick={() => setConfirmEnd(true)}>
            End the event
          </button>
        )}
      </div>
      {actionError && <p className="text-[13px] text-signal">{actionError}</p>}
    </div>
  )
}
