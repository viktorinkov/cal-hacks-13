import { useWallClock } from '@/hooks/useWallClock'
import { clock } from '@/recap/night'
import { EventExtras, LiveControls, RUN_KEYS, RunStatus, StartForm } from '@/components/run/RunControls'
import { Refusal, pill } from '@/components/run/parts'
import { useCatalog } from '@/stdb/catalog'
import { errorFor, reopenEventRun, useOps, useRun, useRunSummary } from '@/stdb/runOps'
import { useSession } from '@/stdb/session'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <dt className="text-[13px] text-ink-dim">{label}</dt>
      <dd className="text-[14px] leading-5 text-ink tabular-nums">{value}</dd>
    </div>
  )
}

/** The event's end state: the night's numbers and the full controls to reopen it or run again. */
export function EventClose() {
  const ended = useSession((s) => s.eventEnded)
  const endedAt = useSession((s) => s.eventEndedAt)
  const eventName = useSession((s) => s.eventName)
  const ops = useOps()
  const busy = useRun((s) => s.busy)
  const refusal = useRun((s) => errorFor(s.error, 'reopen'))
  const now = useWallClock(1)
  const summary = useRunSummary(now)
  const attendees = useCatalog((s) => s.attendees)
  const bands = useCatalog((s) => s.bands)
  const zones = useCatalog((s) => s.zones)
  const booths = useCatalog((s) => s.booths)
  const when = endedAt ? clock(endedAt) : ''

  if (!ended) return null
  return (
    <section aria-label="Event ended" className="desk-card mt-4 grid gap-8 p-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{eventName ? `${eventName} ended` : 'The event ended'}{when ? ` at ${when}` : ''}</h2>
        <p className="mt-1 text-[13px] leading-5 text-ink-dim">Every band’s page shows the recap.</p>
        <dl aria-label="Venue" className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-[9.5rem_minmax(0,1fr)]">
          <Stat label="People" value={summary.people.toLocaleString('en-US')} />
          <Stat label="Attendees" value={attendees.length.toLocaleString('en-US')} />
          <Stat label="Bands" value={bands.length.toLocaleString('en-US')} />
          <Stat label="Zones" value={zones.length.toLocaleString('en-US')} />
          <Stat label="Booths" value={booths.length.toLocaleString('en-US')} />
        </dl>
        <div className="mt-5">
          <RunStatus summary={summary} />
        </div>
        {refusal && <p role="alert" className="mt-4 text-[13px] text-signal">{refusal}</p>}
      </div>
      <div className="min-w-0">
        {!ops ? (
          <p className="text-[14px] leading-6 text-ink-dim">Only organizers can reopen or control the event.</p>
        ) : (
          <div className="grid gap-6">
            <button type="button" disabled={busy != null} onClick={() => void reopenEventRun()} className={`${pill} justify-self-start`}>
              {busy === 'reopen' ? 'Reopening…' : 'Reopen the event'}
            </button>
            {summary.live && <LiveControls summary={summary} />}
            <StartForm />
            <EventExtras summary={summary} />
          </div>
        )}
        {ops && <Refusal keys={RUN_KEYS} className="mt-4" />}
      </div>
    </section>
  )
}
