import { useState, type FormEvent } from 'react'
import { formatCents } from '@/cover/money'
import {
  RUN_DEFAULTS,
  RUN_LIMITS,
  clock,
  endEventRun,
  endRun,
  evacuateRun,
  pauseRun,
  restartCrowd,
  resumeRun,
  setRunLowVis,
  startRun,
  stopCrowdNow,
  wakeCrowd,
  useRun,
  type RunSummary,
} from '@/stdb/runOps'
import { useSession } from '@/stdb/session'
import { Refusal, Section, TwoStep, field, pill } from './parts'

export const RUN_KEYS = ['start', 'pause', 'resume', 'evacuate', 'end', 'end-event', 'reopen', 'crowd', 'lowvis']

/** The run's state, word for word as the dev portal's run table. */
export function RunStatus({ summary }: { summary: RunSummary }) {
  const run = useRun((s) => s.run)
  const rows: [string, string][] = []
  if (!run || summary.phase === 'idle') {
    rows.push(['Event run', 'Not started'], ['People', summary.people.toLocaleString('en-US')])
  } else {
    const { claims, purchases, charges } = summary
    rows.push(
      ['Event run', `${summary.line}: started ${clock(run.startedAt)}, ends ${clock(run.endsAt)}, ${run.pace}× speed`],
      ['People', `${summary.people.toLocaleString('en-US')} of ${run.crowd.toLocaleString('en-US')}`],
      ['Incidents', `${summary.incidents.length}, ${summary.open} open${summary.nextIn != null ? `, next in ${summary.nextIn} s` : ''}`],
      ['Claims', `${claims.paid} paid, ${claims.waiting} waiting for the organizer, ${claims.refused} refused`],
      ['Purchases this run', `${purchases.paying} processing, ${purchases.paid} paid (${formatCents(purchases.salesCents)} sales), ${purchases.failed} failed`],
    )
    if (charges.named > 0) {
      rows.push(['Charges', `${charges.named} named: ${charges.waiting} waiting for the organizer, ${charges.toPay} to pay, ${charges.paid} paid, ${charges.waived} waived`])
    }
    rows.push(['Seed', run.seed])
  }
  return (
    <dl aria-label="Event run status" className="grid gap-x-6 gap-y-3 sm:grid-cols-[9.5rem_minmax(0,1fr)]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-[13px] text-ink-dim">{label}</dt>
          <dd className="text-[14px] leading-5 text-ink tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function StartForm() {
  const busy = useRun((s) => s.busy)
  const [crowd, setCrowd] = useState(String(RUN_DEFAULTS.crowd))
  const [minutes, setMinutes] = useState(String(RUN_DEFAULTS.minutes))
  const [pace, setPace] = useState(String(RUN_DEFAULTS.pace))
  const [seed, setSeed] = useState('')
  const [fresh, setFresh] = useState(true)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    let parsed = 0n
    try {
      parsed = seed.trim() === '' ? 0n : BigInt(seed.trim())
    } catch {
      return
    }
    void startRun({ crowd: Number(crowd), minutes: Number(minutes), pace: Number(pace), fresh, seed: parsed })
  }
  return (
    <form onSubmit={submit} aria-label="Start the event" className="grid gap-4">
      <div className="grid grid-cols-3 gap-3">
        <label className="text-[13px] text-ink-dim">
          People
          <input type="number" inputMode="numeric" min={RUN_LIMITS.crowd[0]} max={RUN_LIMITS.crowd[1]} value={crowd} onChange={(event) => setCrowd(event.target.value)} className={`${field} mt-1 w-full tabular-nums`} />
        </label>
        <label className="text-[13px] text-ink-dim">
          Minutes
          <input type="number" inputMode="numeric" min={RUN_LIMITS.minutes[0]} max={RUN_LIMITS.minutes[1]} value={minutes} onChange={(event) => setMinutes(event.target.value)} className={`${field} mt-1 w-full tabular-nums`} />
        </label>
        <label className="text-[13px] text-ink-dim">
          Speed
          <span className="mt-1 flex items-center gap-2">
            <input type="number" inputMode="numeric" min={RUN_LIMITS.pace[0]} max={RUN_LIMITS.pace[1]} value={pace} onChange={(event) => setPace(event.target.value)} className={`${field} w-full min-w-0 tabular-nums`} />
            <span aria-hidden className="text-[14px] text-ink">×</span>
          </span>
        </label>
      </div>
      <label className="text-[13px] text-ink-dim">
        Seed
        <input type="number" inputMode="numeric" min={0} placeholder="New" value={seed} onChange={(event) => setSeed(event.target.value)} className={`${field} mt-1 w-full tabular-nums`} />
        <span className="mt-1 block text-[13px] leading-5 text-ink-dim">Blank picks a new one; a seed replays the same night.</span>
      </label>
      <label className="flex items-start gap-3 text-[14px] text-ink">
        <input type="checkbox" checked={fresh} onChange={(event) => setFresh(event.target.checked)} className="mt-1 size-4 shrink-0 accent-[var(--color-champagne)]" />
        <span>
          Start fresh
          <span className="mt-1 block text-[13px] leading-5 text-ink-dim">Clears the decision history and the precedents and retires the payment rules, so the rules are proposed again.</span>
        </span>
      </label>
      <button type="submit" disabled={busy != null} className={`${pill} justify-self-start`}>
        {busy === 'start' ? 'Starting…' : 'Start the event'}
      </button>
    </form>
  )
}

export function LiveControls({ summary }: { summary: RunSummary }) {
  const busy = useRun((s) => s.busy)
  const lowVis = useRun((s) => s.lowVis)
  const running = summary.phase === 'running'
  return (
    <div className="flex flex-wrap items-center gap-3">
      {summary.paused ? (
        <button type="button" disabled={busy != null} className={pill} onClick={() => void resumeRun()}>
          {busy === 'resume' ? 'Resuming…' : 'Resume'}
        </button>
      ) : (
        <button type="button" disabled={busy != null} className={pill} onClick={() => void pauseRun()}>
          {busy === 'pause' ? 'Pausing…' : 'Pause'}
        </button>
      )}
      {running && (summary.evacuating ? (
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
      {running && (
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
      <button type="button" disabled={busy != null} aria-pressed={lowVis} className={pill} onClick={() => void setRunLowVis(!lowVis)}>
        {busy === 'lowvis' ? 'Switching…' : lowVis ? 'Bring the lights up' : 'Dim the hall'}
      </button>
    </div>
  )
}

/** The crowd's backend ticker, and the event's own end when no run is live. */
export function EventExtras({ summary }: { summary: RunSummary }) {
  const busy = useRun((s) => s.busy)
  const ended = useSession((s) => s.eventEnded)
  const crowd = summary.crowd || RUN_DEFAULTS.crowd
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={busy != null} className={pill} onClick={() => void wakeCrowd()}>
        {busy === 'crowd' ? 'Working…' : 'Resume the crowd'}
      </button>
      <TwoStep
        label="Restart the crowd"
        question="Restart the crowd? Everyone is reseeded: new spots, new teams."
        confirm="Restart it"
        working="Restarting…"
        cancel="Keep this crowd"
        busy={busy === 'crowd'}
        disabled={busy != null}
        onConfirm={() => restartCrowd(crowd)}
      />
      <TwoStep
        label="Stop the crowd"
        question="Stop the crowd? Everyone freezes where they stand until you resume it."
        confirm="Stop it"
        working="Stopping…"
        cancel="Keep it moving"
        busy={busy === 'crowd'}
        disabled={busy != null}
        onConfirm={stopCrowdNow}
      />
      {!ended && (
        <TwoStep
          label="End the event"
          question="End the event? Every band's page switches to the recap."
          confirm="End it"
          working="Ending…"
          cancel="Keep it open"
          busy={busy === 'end-event'}
          disabled={busy != null}
          onConfirm={endEventRun}
        />
      )}
    </div>
  )
}

/** The run table and, for organizers, the controls: start, pause, evacuate, end. */
export function RunControls({ summary, ops }: { summary: RunSummary; ops: boolean }) {
  const ended = useSession((s) => s.eventEnded)
  if (ended) return null
  return (
    <Section id="run-heading" title="Event run">
      <div className="desk-card grid gap-8 p-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <RunStatus summary={summary} />
        <div className="min-w-0">
          {!ops ? (
            <p className="text-[14px] leading-6 text-ink-dim">Only organizers can start, pause, evacuate or end the run.</p>
          ) : (
            <div className="grid gap-6">
              {summary.live ? <LiveControls summary={summary} /> : <StartForm />}
              <EventExtras summary={summary} />
            </div>
          )}
          {ops && <Refusal keys={RUN_KEYS} className="mt-4" />}
        </div>
      </div>
    </Section>
  )
}
