import { useMemo, type ReactNode } from 'react'
import { formatCents } from '@/cover/money'
import { cn } from '@/lib/utils'
import { NONE, buildTrail, stamp, useSettlement } from '@/stdb/settlementOps'

function Fold({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <details className="group border-t border-line py-3">
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 text-[13px] text-ink-dim hover:text-champagne [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{title}</span>
        <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
          {count != null && <span>{count}</span>}
          <span aria-hidden className="inline-block transition-transform group-open:rotate-45">+</span>
        </span>
      </summary>
      <div className="mt-3 text-[14px] leading-6 text-ink">{children}</div>
    </details>
  )
}

function Blob({ hash, label }: { hash: string; label: string }) {
  return (
    <a href={`/blobs/${hash}`} target="_blank" rel="noreferrer" className="text-[14px] text-ink hover:text-champagne">
      {label}
    </a>
  )
}

/** The evidence behind a claim, each part folded so the docket stays short. */
export function ClaimEvidence({ claimId }: { claimId: string }) {
  const claim = useSettlement((s) => s.claims[claimId])
  const review = useSettlement((s) => s.reviews[claimId])
  const record = useSettlement((s) => s.records[claimId])
  const clinic = useSettlement((s) => s.clinicReports[claimId])
  const approvals = useSettlement((s) => s.approvals[claimId] ?? NONE)
  const clauses = useSettlement((s) => s.clauses[claimId] ?? NONE)
  const decisions = useSettlement((s) => s.decisions[claimId] ?? NONE)
  const facts = useSettlement((s) => s.facts[claimId] ?? NONE)
  const checks = useSettlement((s) => s.checks[claimId] ?? NONE)
  const lines = useSettlement((s) => s.lines[claimId] ?? NONE)
  const ledger = useSettlement((s) => s.ledger[claimId] ?? NONE)
  const rules = useSettlement((s) => s.rules)
  const zones = useSettlement((s) => s.zones)
  const bandNames = useSettlement((s) => s.bandNames)

  const trail = useMemo(
    () => (claim ? buildTrail({ claim, facts, checks, decisions, review, approvals, clinic, record, ledger, rules, zones, bandNames }) : []),
    [claim, facts, checks, decisions, review, approvals, clinic, record, ledger, rules, zones, bandNames],
  )

  if (!claim) return null

  const verdict = review ? review.verdict.replace('_', ' ') : ''
  const rule = claim.settlementRuleId ? rules[claim.settlementRuleId] : undefined
  const read = record?.status === 'extracted'
  const recordLabel = clinic ? 'Open the report' : 'Open the PDF'

  return (
    <section aria-label="Evidence" className="flex flex-col">
      <h3 className="text-[13px] text-ink-dim">Evidence</h3>
      {claim.statement && <p className="mt-2 text-[14px] leading-6 text-ink">{`In their words: "${claim.statement}"`}</p>}
      {verdict && <p className="mt-2 text-[14px] leading-6 text-ink">{`Decision Engine recommendation: ${verdict}.`}</p>}

      <div className="mt-3 flex flex-col">
        {review && (
          <Fold title={`Decision Engine recommendation: ${verdict}`}>
            <p>{review.summary}</p>
            {review.causation && <p className="mt-2">{`Causation: ${review.causation}`}</p>}
            {review.concerns.length > 0 && (
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                {review.concerns.map((concern) => (
                  <li key={concern}>{concern}</li>
                ))}
              </ul>
            )}
            {review.innocentExplanations.length > 0 && <p className="mt-2">{`Innocent readings: ${review.innocentExplanations.join('; ')}`}</p>}
            {review.missingEvidence.length > 0 && <p className="mt-2">{`Missing: ${review.missingEvidence.join('; ')}`}</p>}
            {review.citedFactIds.length > 0 && (
              <p className="mt-2 text-[13px] text-ink-dim">{`Rests on facts ${review.citedFactIds.map((id) => `[${id}]`).join(' ')}`}</p>
            )}
            {review.rejected.length > 0 && <p className="mt-2 text-signal">{`Code set the recommendation aside: ${review.rejected.join('; ')}`}</p>}
          </Fold>
        )}

        {(clinic || record) && (
          <Fold title={read ? 'Hospital report, read by the Evidence Engine' : 'Hospital report'}>
            {clinic?.status === 'requested' && <p>{`Hospital report requested at ${stamp(clinic.requestedAt, claim.openedAt)}.`}</p>}
            {clinic?.status === 'received' && (
              <p>
                {`Hospital report from ${clinic.providerName}, visit ${clinic.visitDate}. `}
                {clinic.fileHash && <Blob hash={clinic.fileHash} label="Open the report" />}
              </p>
            )}
            {clinic?.status === 'failed' && <p className="text-signal">{`The hospital report failed: ${clinic.problems.join('; ')}`}</p>}
            {record && !read && (
              <p className={cn(clinic && 'mt-2')}>
                {record.status === 'reading' ? 'The Evidence Engine is reading the report.' : `The report could not be read: ${record.dropped.join('; ')}`}{' '}
                {record.fileHash && record.fileHash !== clinic?.fileHash && <Blob hash={record.fileHash} label={recordLabel} />}
              </p>
            )}
            {record && read && (
              <div className={cn('flex flex-col gap-2', clinic && 'mt-2')}>
                <p>
                  {`${record.documentKind} for ${record.patientName} from ${record.providerName} on ${record.dateOfService}, invoice ${record.invoiceNumber}. Billed ${formatCents(record.billedCents)}, covered ${formatCents(record.coveredCents)}.`}
                </p>
                {record.reasonForVisit && <p>{`Reason: ${record.reasonForVisit}. ${record.history}`}</p>}
                {record.diagnoses.length > 0 && <p>{`Diagnoses: ${record.diagnoses.join('; ')}`}</p>}
                {record.dropped.length > 0 && <p className="text-ink-dim">{`Dropped: ${record.dropped.join('; ')}`}</p>}
                {record.fileHash && record.fileHash !== clinic?.fileHash && <Blob hash={record.fileHash} label={recordLabel} />}
              </div>
            )}
          </Fold>
        )}

        {lines.length > 0 && (
          <Fold title="Billed lines" count={lines.length}>
            <ul className="divide-y divide-line">
              {lines.map((line) => (
                <li key={line.id} className="py-2 first:pt-0">
                  <p>
                    <span className="font-mono text-[13px]">{line.code}</span> {line.description}
                  </p>
                  <p className="text-[13px] tabular-nums text-ink-dim">
                    {`Billed ${formatCents(line.billedCents)} · allowed ${formatCents(line.allowedCents)} · covered ${formatCents(line.coveredCents)}`}
                  </p>
                  <p className={cn('text-[13px]', line.outcome === 'excluded' ? 'text-signal' : 'text-ink-dim')}>
                    {`${line.outcome}${line.reason ? `: ${line.reason}` : ''}`}
                  </p>
                </li>
              ))}
            </ul>
          </Fold>
        )}

        {clauses.length > 0 && (
          <Fold title="Policy clauses that bear on it (Elastic)" count={clauses.length}>
            <ul className="divide-y divide-line">
              {clauses.map((clause) => (
                <li key={clause.id} className="py-2 first:pt-0">
                  <p className="text-[13px] text-ink-dim">
                    {`${clause.policy === 'attendee' ? "The attendee's own" : "The venue's"} · ${clause.section.replace(/_/g, ' ')} · page ${clause.page}`}
                  </p>
                  <p>{`"${clause.text}"`}</p>
                  <p className="text-[13px] text-ink-muted">{`${clause.clauseId} · match ${clause.score.toFixed(2)}`}</p>
                </li>
              ))}
            </ul>
          </Fold>
        )}

        {facts.length > 0 && (
          <Fold title="Evidence facts" count={facts.length}>
            <ul className="flex flex-col gap-1.5">
              {facts.map((fact) => (
                <li key={fact.id} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2">
                  <span className="font-mono text-[13px] text-ink-dim">{`[${fact.seq}]`}</span>
                  <span className="min-w-0 break-words">
                    {`${fact.key}: ${fact.value}`}
                    <span className="block text-[13px] text-ink-muted">{`${fact.source}, ${fact.reader}`}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Fold>
        )}

        {(approvals.length > 0 || decisions.length > 0) && (
          <Fold title="Decisions" count={approvals.length + decisions.length}>
            {approvals.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {approvals.map((approval) => (
                  <li key={approval.id}>
                    <span className="text-[13px] text-ink-dim">{stamp(approval.decidedAt)}</span>{' '}
                    {`${approval.approverName} (${approval.approverRole}) ${approval.decision} at ${formatCents(approval.amountSeenCents)}${approval.reason ? `: ${approval.reason}` : ''}`}
                  </li>
                ))}
              </ul>
            )}
            {decisions.length > 0 && (
              <ul className={cn('flex flex-col gap-1.5', approvals.length > 0 && 'mt-3 border-t border-line pt-3')}>
                {decisions.map((decision) => (
                  <li key={decision.id}>
                    <span className="text-[13px] text-ink-dim">{stamp(decision.at)}</span>{' '}
                    {`${decision.actor}${decision.who && decision.who !== decision.actor ? ` (${decision.who})` : ''}: ${decision.what}${decision.why ? `: ${decision.why}` : ''}`}
                  </li>
                ))}
              </ul>
            )}
          </Fold>
        )}

        {ledger.length > 0 && (
          <Fold title="Ledger" count={ledger.length}>
            <ul className="divide-y divide-line">
              {ledger.map((entry) => (
                <li key={entry.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-1.5 first:pt-0">
                  <span className="min-w-0">
                    <span className="font-mono text-[13px]">{entry.journal}</span> {entry.account}
                    {entry.memo && <span className="block text-[13px] text-ink-muted">{entry.memo}</span>}
                  </span>
                  <span className="text-right font-mono text-[13px] tabular-nums">
                    {entry.debitCents ? `Dr ${formatCents(entry.debitCents)}` : `Cr ${formatCents(entry.creditCents)}`}
                  </span>
                </li>
              ))}
            </ul>
          </Fold>
        )}

        <Fold title="How the evidence was gathered and weighed" count={trail.length}>
          {trail.length === 0 ? (
            <p className="text-ink-dim">Nothing gathered yet.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {trail.map((step, index) => (
                <li key={`${step.at}-${index}`} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
                  <span className="text-[13px] tabular-nums text-ink-dim">{stamp(step.at, claim.openedAt)}</span>
                  <span className="min-w-0 break-words">
                    <span className="text-ink-dim">{step.source}</span> {step.text}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Fold>
      </div>

      <p className="border-t border-line pt-3 text-[13px] leading-5 text-ink-muted">
        {`Evidence pack v${claim.packVersion}${claim.packHash ? `, sha ${claim.packHash.slice(0, 12)}` : ''} · corroboration ${claim.corroboration || 'n/a'} · decided by ${claim.decidedBy || 'nobody yet'}${rule ? ` under rule v${rule.version} from ${rule.approverName}` : ''}${claim.payoutReference ? ` · ${claim.payoutReference}` : ''}`}
      </p>
    </section>
  )
}
