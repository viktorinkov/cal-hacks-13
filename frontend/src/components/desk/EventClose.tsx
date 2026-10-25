import { clock } from '@/recap/night'
import { errorFor, reopenEventRun, useRun } from '@/stdb/runOps'
import { useSession } from '@/stdb/session'

const pill = 'h-11 rounded-full border border-line-strong px-4 text-[13px] text-ink hover:text-champagne disabled:border-line disabled:text-ink-muted disabled:hover:text-ink-muted'

/** The event's end state: a card with the recap note and the controls that reopen it. */
export function EventClose() {
  const ended = useSession((s) => s.eventEnded)
  const endedAt = useSession((s) => s.eventEndedAt)
  const canEnd = useSession((s) => s.owner || s.roles.includes('ops'))
  const busy = useRun((s) => s.busy)
  const refusal = useRun((s) => errorFor(s.error, 'reopen'))
  const when = endedAt ? clock(endedAt) : ''

  if (!ended) return null
  return (
    <section aria-label="Event ended" className="desk-card mt-4 flex flex-wrap items-center justify-between gap-x-8 gap-y-4 p-5">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">The event ended{when ? ` at ${when}` : ''}</h2>
        <p className="mt-1 text-[13px] leading-5 text-ink-dim">Every band’s page shows the recap.</p>
        {refusal && <p role="alert" className="mt-2 text-[13px] text-signal">{refusal}</p>}
      </div>
      {canEnd && (
        <button type="button" disabled={busy != null} onClick={() => void reopenEventRun()} className={pill}>
          {busy === 'reopen' ? 'Reopening…' : 'Reopen the event'}
        </button>
      )}
    </section>
  )
}
