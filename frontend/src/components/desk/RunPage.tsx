import { BandPlacement } from '@/components/run/BandPlacement'
import { DecisionHistory } from '@/components/run/DecisionHistory'
import { RunAlerts } from '@/components/run/RunAlerts'
import { RunControls } from '@/components/run/RunControls'
import { RunIncidents } from '@/components/run/RunIncidents'
import { RunZones } from '@/components/run/RunZones'
import { formatCents } from '@/cover/money'
import { useWallClock } from '@/hooks/useWallClock'
import { useOps, useRun, useRunSummary } from '@/stdb/runOps'
import { DeskFrame, Figure } from './DeskFrame'

const TABLE_NAMES: Record<string, string> = {
  'SELECT * FROM live_run': 'the run',
  'SELECT * FROM live_pause': 'the pause',
  'SELECT * FROM live_evacuation': 'the evacuation',
  'SELECT * FROM incident_marker': 'the incidents',
  'SELECT * FROM decision': 'the decisions',
  'SELECT * FROM station': 'the stations',
  'SELECT * FROM gateway': 'the gateway',
  'SELECT * FROM band_place': 'the placed bands',
}

/** The event run: start it, follow its incidents, claims and decisions, and put our real bands on the floor. */
export function RunPage() {
  const now = useWallClock(1)
  const summary = useRunSummary(now)
  const ops = useOps()
  const linked = useRun((s) => s.linked)
  const refusals = useRun((s) => s.refusals)
  const refused = Object.keys(refusals).map((query) => TABLE_NAMES[query] ?? query)
  const idle = summary.phase === 'idle'

  return (
    <DeskFrame
      motif="run"
      title="Event run"
      figures={
        <>
          <Figure lead label="People" value={summary.people.toLocaleString('en-US')} note={idle ? 'bands in the crowd now' : `of ${summary.crowd.toLocaleString('en-US')} expected`} />
          <Figure label="Incidents" value={String(summary.incidents.length)} note={summary.nextIn != null ? `${summary.open} open, next in ${summary.nextIn} s` : `${summary.open} open`} />
          <Figure label="Waiting" value={String(summary.claims.waiting)} note="claims for the organizer" />
          <Figure label="Sales" value={formatCents(summary.purchases.salesCents)} note={`${summary.purchases.paid} paid this run`} />
        </>
      }
    >
      {!linked && <p className="text-[14px] text-ink-dim">Loading the event…</p>}
      <RunControls summary={summary} ops={ops} />
      <RunAlerts now={now} />
      <div className="mt-14 grid gap-x-10 gap-y-14 xl:grid-cols-2">
        <div className="min-w-0">
          <RunIncidents summary={summary} ops={ops} />
        </div>
        <div className="min-w-0">
          <DecisionHistory ops={ops} />
        </div>
      </div>
      <RunZones now={now} ops={ops} />
      <BandPlacement now={now} ops={ops} />
      {refused.length > 0 && <p className="mt-12 text-[13px] text-ink-muted">This account cannot access {refused.join(', ')}.</p>}
    </DeskFrame>
  )
}
