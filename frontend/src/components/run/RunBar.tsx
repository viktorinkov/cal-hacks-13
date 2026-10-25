import { useRoute } from '@/cover/route'
import { useWallClock } from '@/hooks/useWallClock'
import { endRun, evacuateRun, pauseRun, resumeRun, useOps, useRun, useRunSummary } from '@/stdb/runOps'
import { useSession } from '@/stdb/session'
import { Refusal, TwoStep, pill } from './parts'

/**
 * The live run's strip on every page: where the run stands, and pause, evacuate or end it
 * without leaving the view. The rest of the controls stay on the run page.
 */
export function RunBar() {
  const now = useWallClock(1)
  const summary = useRunSummary(now)
  const ops = useOps()
  const ended = useSession((s) => s.eventEnded)
  const busy = useRun((s) => s.busy)
  const { go } = useRoute()
  if (ended) return null
  if (!summary.live) {
    if (!ops) return null
    return (
      <div className="desk-card mt-4 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 px-5 py-3">
        <p className="text-[13px] text-ink-dim">No event run.</p>
        <button type="button" className={pill} onClick={() => go('/run')}>Start the event</button>
      </div>
    )
  }
  return (
    <div aria-label="Event run" className="desk-card mt-4 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 px-5 py-3">
      <p className="text-[13px] leading-5 text-ink">
        <span className="text-ink-dim">{summary.line}</span>
        {` · ${summary.people.toLocaleString('en-US')} of ${summary.crowd.toLocaleString('en-US')} inside`}
        {summary.open > 0 ? ` · ${summary.open} incident${summary.open === 1 ? '' : 's'} open` : ''}
      </p>
      {!ops ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {summary.paused ? (
            <button type="button" disabled={busy != null} className={pill} onClick={() => void resumeRun()}>
              {busy === 'resume' ? 'Resuming…' : 'Resume'}
            </button>
          ) : (
            <button type="button" disabled={busy != null} className={pill} onClick={() => void pauseRun()}>
              {busy === 'pause' ? 'Pausing…' : 'Pause'}
            </button>
          )}
          {summary.phase === 'running' && (summary.evacuating ? (
            <button type="button" disabled={busy != null} className={pill} onClick={() => void evacuateRun(false)}>
              {busy === 'evacuate' ? 'Calling it off…' : 'Call off the evacuation'}
            </button>
          ) : (
            <TwoStep
              label="Evacuate"
              question="Evacuate? Everyone walks out by the nearest door, and nobody comes back in until you call it off."
              confirm="Evacuate now"
              working="Evacuating…"
              cancel="Keep everyone in"
              busy={busy === 'evacuate'}
              disabled={busy != null}
              onConfirm={() => evacuateRun(true)}
            />
          ))}
          {summary.phase === 'running' && (
            <TwoStep
              label="End the run"
              question="End the run? The doors close, everyone walks out, and then every tap link switches to the recap."
              confirm="End it"
              working="Ending…"
              cancel="Keep it open"
              busy={busy === 'end'}
              disabled={busy != null}
              onConfirm={endRun}
            />
          )}
        </div>
      )}
      {ops && <Refusal keys={['pause', 'resume', 'evacuate', 'end']} className="basis-full" />}
    </div>
  )
}
