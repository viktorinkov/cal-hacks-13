import { useMemo } from 'react'
import { formatCents } from '@/cover/money'
import { approveRunClaim, chargeLine, clock, focusIncident, markerKind, useRun, type RunClaim, type RunMarker, type RunSummary } from '@/stdb/runOps'
import { Refusal, Section, link } from './parts'

/** Approve a claim routed to the organizer, at the payout and pack on screen. */
export function ApproveClaim({ claim }: { claim: RunClaim }) {
  const busy = useRun((s) => s.busy)
  const key = `approve:${claim.id}`
  return (
    <button type="button" aria-label={`Approve claim ${claim.id}`} disabled={busy != null} className={link} onClick={() => void approveRunClaim(claim)}>
      {busy === key ? 'Approving…' : 'Approve'}
    </button>
  )
}

function statusOf(marker: RunMarker): string {
  return marker.status === 'responding' && marker.medic ? `${marker.medic} responding` : marker.status
}

function claimOf(marker: RunMarker): string {
  if (!marker.claimId) return ''
  return `claim ${marker.claimStatus}${marker.payoutCents && marker.claimStatus !== 'refused' ? `, ${formatCents(marker.payoutCents)}` : ''}`
}

/** This run's incidents, newest first, with the claim and any charge each one led to. */
export function RunIncidents({ summary, ops }: { summary: RunSummary; ops: boolean }) {
  const claims = useRun((s) => s.claims)
  const charges = useRun((s) => s.charges)
  const focus = useRun((s) => s.focus)
  const claimById = useMemo(() => new Map(claims.map((claim) => [claim.id, claim])), [claims])
  const chargeByIncident = useMemo(() => new Map(charges.map((charge) => [charge.incidentId, charge])), [charges])
  const { incidents } = summary

  return (
    <Section id="run-incidents-heading" title={`Incidents · ${incidents.length}`}>
      <Refusal keys={['approve:']} className="mb-4" />
      {incidents.length === 0 ? (
        <p className="text-[15px] text-ink-dim">{summary.phase !== 'idle' ? 'None yet. The first one happens about a minute after the doors open.' : 'None.'}</p>
      ) : (
        <ul className="divide-y divide-line">
          {incidents.map((marker) => {
            const claim = claimById.get(marker.claimId)
            const charge = chargeLine(chargeByIncident.get(marker.incidentId))
            const where = [marker.person, marker.place].filter(Boolean).join(marker.person ? ' at ' : '')
            const shown = focus === marker.incidentId
            return (
              <li key={marker.incidentId} className="desk-row grid gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto] md:items-baseline">
                <div className="min-w-0">
                  <p className="text-[15px] text-ink">
                    <span className="tabular-nums text-ink-dim">{clock(marker.openedAt)}</span> #{marker.incidentId} {markerKind(marker.kind)}
                  </p>
                  {where && <p className="mt-1 truncate text-[13px] text-ink-dim">{where}</p>}
                </div>
                <div className="min-w-0 text-[13px] leading-5 text-ink-dim">
                  <p className="text-ink">{statusOf(marker)}</p>
                  {marker.claimId && <p>{claimOf(marker)}</p>}
                  {charge && <p>{charge}</p>}
                  {ops && claim?.status === 'routed' && <ApproveClaim claim={claim} />}
                </div>
                <button type="button" aria-pressed={shown} className={`${link} justify-self-start`} onClick={() => focusIncident(shown ? null : marker.incidentId)}>
                  {shown ? 'Showing its decisions' : 'Show its decisions'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
