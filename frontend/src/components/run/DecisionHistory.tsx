import { useMemo, useState } from 'react'
import { DECISION_LIMIT, clock, focusIncident, markerKind, shownDecisions, useRun } from '@/stdb/runOps'
import { ApproveClaim } from './RunIncidents'
import { Section, link } from './parts'

/** Who decided what and why, newest first: for one incident, or for the whole run. */
export function DecisionHistory({ ops }: { ops: boolean }) {
  const decisions = useRun((s) => s.decisions)
  const claims = useRun((s) => s.claims)
  const markers = useRun((s) => s.markers)
  const focus = useRun((s) => s.focus)
  const [query, setQuery] = useState('')
  const claimById = useMemo(() => new Map(claims.map((claim) => [claim.id, claim])), [claims])
  const { rows, total } = useMemo(() => shownDecisions(decisions, focus, query), [decisions, focus, query])
  const marker = focus == null ? undefined : markers.find((row) => row.incidentId === focus)
  const title = focus == null
    ? 'Decision history'
    : `Decision history of incident #${focus}${marker ? `: ${markerKind(marker.kind)}${marker.person ? `, ${marker.person}` : ''}` : ''}`
  // The Approve button sits on the newest decision of each routed claim, once.
  const offered = new Set<string>()

  return (
    <Section id="run-decisions-heading" title={title}>
      {focus != null && (
        <button type="button" className={`${link} mb-4`} onClick={() => focusIncident(null)}>
          Show all decisions
        </button>
      )}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          aria-label="Search decisions"
          className="w-full max-w-xs border-b border-line bg-transparent py-1 text-[14px] text-ink outline-none placeholder:text-ink-muted"
        />
        {query.trim() && <span className="text-[13px] text-ink-muted">{total} found</span>}
      </div>
      {decisions.length === 0 ? (
        <p className="mt-4 text-[15px] text-ink-dim">Nothing decided yet.</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-[15px] text-ink-dim">{query.trim() ? 'No decision matches.' : 'Nothing decided on this incident yet.'}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {rows.map((row) => {
            const claim = row.claimId ? claimById.get(row.claimId) : undefined
            const approve = ops && claim?.status === 'routed' && !offered.has(claim.id)
            if (approve && claim) offered.add(claim.id)
            return (
              <li key={row.id} className="desk-row grid gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[4.5rem_minmax(0,9rem)_minmax(0,1fr)] md:items-baseline">
                <div className="text-[13px] tabular-nums text-ink-dim">
                  <p>{clock(row.at)}</p>
                  {row.incidentId && (
                    <button type="button" className={link} aria-label={`Show the decisions of incident ${row.incidentId}`} onClick={() => focusIncident(row.incidentId)}>
                      #{row.incidentId}
                    </button>
                  )}
                </div>
                <p className="min-w-0 text-[13px] text-ink">{row.who === row.actor ? row.who : `${row.who} (${row.actor})`}</p>
                <div className="min-w-0 text-[14px] leading-6 text-ink">
                  <p>{row.what}</p>
                  {row.why && <p className="text-[13px] leading-5 text-ink-dim">{row.why}</p>}
                  {approve && claim && <ApproveClaim claim={claim} />}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {total > rows.length && <p className="mt-4 text-[13px] text-ink-muted">Showing the latest {DECISION_LIMIT} of {total.toLocaleString('en-US')}.</p>}
    </Section>
  )
}
