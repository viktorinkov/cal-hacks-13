import { useState } from 'react'
import { useAction } from '@/components/payments/action'
import { clock } from '@/recap/night'
import { isLive, useRun } from '@/stdb/runOps'
import { endEvent, reopenEvent, useSession } from '@/stdb/session'

/** The host's end_event. That reducer is what flips every band's page to the recap. */
export function EventClose() {
  const ended = useSession((s) => s.eventEnded)
  const endedAt = useSession((s) => s.eventEndedAt)
  const canEnd = useSession((s) => s.owner || s.roles.includes('ops'))
  const runLive = useRun((s) => isLive(s.run))
  const { busy, error, run } = useAction()
  const [ask, setAsk] = useState(false)
  const when = endedAt ? clock(endedAt) : ''

  if (ended) {
    return (
      <p className="mt-4 text-[13px] leading-5 text-ink-dim">
        The event ended{when ? ` at ${when}` : ''}. Every band’s page shows the recap.
        {canEnd && (
          <>
            {' '}
            <button type="button" disabled={busy != null} onClick={() => void run('reopen', reopenEvent, { success: 'The event is open again.', failure: 'The event stayed ended' })} className="text-ink underline underline-offset-4">
              {busy === 'reopen' ? 'Reopening…' : 'Reopen the event'}
            </button>
          </>
        )}
        {error?.key === 'reopen' && <span className="mt-1 block text-signal">{error.message}</span>}
      </p>
    )
  }
  // During an event run, the Run desk's own end closes the doors first.
  if (!canEnd || runLive) return null
  if (!ask) {
    return (
      <p className="mt-4 text-[13px] leading-5 text-ink-dim">
        <button type="button" onClick={() => setAsk(true)} className="text-ink underline underline-offset-4">End the event</button>
        {' '}without a run. Every band’s page switches to the recap.
      </p>
    )
  }
  return (
    <p className="mt-4 text-[13px] leading-5 text-ink-dim">
      End the event? Every open band page switches to the recap.
      {' '}
      <button type="button" disabled={busy != null} onClick={() => void run('end', endEvent, { success: 'The night ended. Every band opens the recap.', failure: 'The event didn’t end' })} className="text-ink underline underline-offset-4">
        {busy === 'end' ? 'Ending…' : 'End it'}
      </button>
      {' '}
      <button type="button" disabled={busy != null} onClick={() => setAsk(false)} className="text-ink-muted underline underline-offset-4">Keep it going</button>
      {error?.key === 'end' && <span className="mt-1 block text-signal">{error.message}</span>}
    </p>
  )
}
