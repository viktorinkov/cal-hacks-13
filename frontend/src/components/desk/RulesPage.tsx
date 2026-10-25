import { useState, type FormEvent, type ReactNode } from 'react'
import { formatCents } from '@/cover/money'
import { useRoute } from '@/cover/route'
import { useCatalog, type PaymentRule, type Precedent, type RuleProposal } from '@/stdb/catalog'
import { approveProposal, rejectProposal, useSession } from '@/stdb/session'
import { approveRule } from '@/stdb/settlementOps'
import { DeskFrame, Figure, when } from './DeskFrame'

const KIND: Record<string, string> = {
  fall: 'Falls',
  sos: 'SOS calls',
  property: 'Broken equipment',
  theft: 'Thefts from the venue',
}

const COVER: Record<string, string> = {
  medical_payments: 'medical payments',
  property: 'property',
}

const OPEN = new Set(['proposed', 'scope_proposed', 'proposing'])

function shape(incidentKind: string, coverKind: string): string {
  const kind = KIND[incidentKind] ?? incidentKind.replaceAll('_', ' ')
  const cover = COVER[coverKind] ?? coverKind.replaceAll('_', ' ')
  return `${kind} under ${cover} cover`
}

function outcome(proposal: RuleProposal): string {
  if (proposal.status === 'scope_approved') return `scope reviewed and approved by ${proposal.decidedByName} as rule v${proposal.ruleVersion}`
  if (proposal.status === 'approved') return `approved by ${proposal.decidedByName} as rule v${proposal.ruleVersion}`
  if (proposal.status === 'rejected') return `rejected by ${proposal.decidedByName}: ${proposal.reason}`
  if (proposal.status === 'declined') return 'no rule proposed'
  if (proposal.status === 'scope_review') return 'Needs scope review'
  return proposal.status.replaceAll('_', ' ')
}

function ruleStatus(rule: PaymentRule): string {
  if (rule.status === 'review_required') return 'Needs scope review; automatic payments withheld'
  return rule.status.replaceAll('_', ' ')
}

/** The organizer's proposed payment rules, the rules already in force, and the decisions they came from. */
export function RulesPage() {
  const proposals = useCatalog((s) => s.proposals)
  const rules = useCatalog((s) => s.paymentRules)
  const precedents = useCatalog((s) => s.precedents)
  const policy = useCatalog((s) => s.policy)
  const actionError = useSession((s) => s.actionError)
  const owner = useSession((s) => s.owner)
  const roles = useSession((s) => s.roles)
  const canDecide = owner || roles.includes('ops')
  const waiting = proposals.filter((proposal) => OPEN.has(proposal.status)).sort((a, b) => Number(a.id) - Number(b.id))
  const earlier = proposals.filter((proposal) => !OPEN.has(proposal.status)).sort((a, b) => b.createdAt - a.createdAt)
  const orderedRules = [...rules].sort((a, b) => b.version - a.version)
  const orderedPrecedents = [...precedents].sort((a, b) => b.decidedAt - a.decidedAt)

  return (
    <DeskFrame
      motif="rules"
      figures={
        <>
          <Figure lead label="Waiting" value={String(waiting.length)} note="proposed rules" />
          <Figure label="In force" value={String(orderedRules.length)} note="payment rules" />
          <Figure label="Precedents" value={String(orderedPrecedents.length)} note="organizer decisions" />
          <Figure label="Injuries paid" value={policy ? formatCents(policy.medicalUsedCents) : '—'} note={policy ? policy.insurerName || 'the insurer' : 'policy not loaded'} />
        </>
      }
    >
      {actionError && <p className="text-[14px] text-signal">{actionError}</p>}
      <Section title={`Proposed rules · ${waiting.length}`}>
        {waiting.length === 0 ? (
          <p className="text-[15px] text-ink-dim">None right now. A rule is proposed after enough similar claims are approved.</p>
        ) : (
          <ul className="divide-y divide-line">
            {waiting.map((proposal) => (
              <ProposalRow key={proposal.id} proposal={proposal} canDecide={canDecide} />
            ))}
          </ul>
        )}
      </Section>
      <Section title="Payment rules">
        {orderedRules.length === 0 ? (
          <p className="text-[15px] text-ink-dim">None yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {orderedRules.map((rule) => (
              <li key={rule.id} className="desk-row grid gap-1 py-3 md:grid-cols-[minmax(0,1.4fr)_8rem_minmax(0,1fr)] md:items-baseline">
                <div className="min-w-0">
                  <p className="text-[15px] text-ink">v{rule.version} · {shape(rule.incidentKind, rule.coverKind)}</p>
                  <p className="mt-1 text-[13px] text-ink-dim">{rule.approverName}{rule.approverRole ? ` (${rule.approverRole})` : ''} · {when(rule.createdAt)}</p>
                </div>
                <p className="font-mono text-[13px] text-ink">{formatCents(rule.ceilingCents)}{rule.requiresCorroborated ? ' · corroborated' : ''}</p>
                <p className="text-[13px] text-ink-muted">{ruleStatus(rule)}</p>
              </li>
            ))}
          </ul>
        )}
        {policy && (
          <p className="mt-4 text-[13px] text-ink-muted">
            Venue policy {policy.policyNumber || 'on file'} with {policy.insurerName || 'the insurer'}: {formatCents(policy.medicalUsedCents)} for injuries and {formatCents(policy.propertyUsedCents)} for equipment.
          </p>
        )}
      </Section>
      <Section title={`Precedents · ${orderedPrecedents.length}`}>
        {orderedPrecedents.length === 0 ? (
          <p className="text-[15px] text-ink-dim">None yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {orderedPrecedents.map((precedent) => (
              <PrecedentRow key={precedent.id} precedent={precedent} />
            ))}
          </ul>
        )}
      </Section>
      {earlier.length > 0 && (
        <Section title="Earlier proposals">
          <ul className="divide-y divide-line">
            {earlier.map((proposal) => (
              <li key={proposal.id} className="desk-row grid gap-1 py-3 md:grid-cols-[minmax(0,1.4fr)_8rem_minmax(0,1fr)]">
                <div className="min-w-0">
                  <p className="text-[15px] text-ink">#{proposal.id} · {shape(proposal.incidentKind, proposal.coverKind)}</p>
                  <p className="mt-1 text-[13px] text-ink-dim">{proposal.rule || proposal.summary}</p>
                </div>
                <p className="font-mono text-[13px] text-ink">{proposal.ceilingCents ? formatCents(proposal.ceilingCents) : ''}</p>
                <p className="text-[13px] text-ink-muted">{outcome(proposal)}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </DeskFrame>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-12 first:mt-0">
      <h2 className="text-[13px] text-ink-dim">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function ProposalRow({ proposal, canDecide }: { proposal: RuleProposal; canDecide: boolean }) {
  const { go } = useRoute()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [missing, setMissing] = useState(false)
  const scopeReview = proposal.status === 'scope_proposed'
  const ready = proposal.status === 'proposed' || scopeReview
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
    } catch {
      // The session stores the refusal.
    } finally {
      setBusy(false)
    }
  }
  const reject = (event: FormEvent) => {
    event.preventDefault()
    if (!reason.trim()) {
      setMissing(true)
      return
    }
    void run(() => rejectProposal(proposal.id, reason))
  }
  return (
    <li className="desk-row grid gap-3 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[15px] text-ink">#{proposal.id} · {shape(proposal.incidentKind, proposal.coverKind)}</p>
        <p className="text-[13px] text-ink-muted">{when(proposal.createdAt)}</p>
      </div>
      <p className="text-[14px] leading-6 text-ink">{proposal.status === 'proposing' ? 'Being written.' : proposal.rule || 'No scope yet.'}</p>
      {proposal.summary && <p className="text-[13px] leading-5 text-ink-dim">{proposal.summary}</p>}
      <p className="text-[13px] text-ink-dim">
        Ceiling {proposal.ceilingCents ? formatCents(proposal.ceilingCents) : '—'}
        {proposal.limitCents ? ` · policy limit ${formatCents(proposal.limitCents)}` : ''}
        {proposal.claimIds.length > 0 && (
          <>
            {' · '}
            {proposal.claimIds.map((id, index) => (
              <button key={id} type="button" className="text-ink hover:text-champagne" onClick={() => go('/claims')}>
                {index > 0 ? `, #${id}` : `#${id}`}
              </button>
            ))}
          </>
        )}
      </p>
      {ready && canDecide && proposal.status === 'proposed' && (
        <div className="flex flex-col gap-3">
          <button type="button" disabled={busy} className="h-11 self-start text-[14px] text-ink" onClick={() => void run(() => approveProposal(proposal.id, proposal.ceilingCents))}>
            {busy ? 'Sending…' : `Approve this scope: up to ${formatCents(proposal.ceilingCents)}`}
          </button>
          <form onSubmit={reject} className="flex flex-wrap items-center gap-3">
            <input
              aria-label={`Reason for rejecting proposal ${proposal.id}`}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
                if (event.target.value.trim()) setMissing(false)
              }}
              placeholder="Reason for rejecting"
              className="h-11 min-w-0 flex-1 rounded-[4px] border border-line-strong bg-ground px-3 text-[14px] text-ink outline-none"
            />
            <button type="submit" disabled={busy} className="h-11 text-[14px] text-ink">
              Reject
            </button>
          </form>
          {missing && <p className="text-[13px] text-signal">A rejection needs a reason.</p>}
        </div>
      )}
      {ready && canDecide && scopeReview && (
        <div className="flex flex-col gap-3">
          <p className="text-[14px] leading-6 text-ink">Scope to approve: {proposal.rule}</p>
          <p className="text-[13px] leading-5 text-ink-dim">Diagnosis and treatment in the rationale do not narrow this scope.</p>
          <button type="button" disabled={busy} className="h-11 self-start text-[14px] text-ink" onClick={() => void run(() => approveRule(proposal))}>
            {busy ? 'Sending…' : `Review and approve scope: up to ${formatCents(proposal.ceilingCents)}`}
          </button>
          <form onSubmit={reject} className="flex flex-wrap items-center gap-3">
            <input
              aria-label={`Reason for rejecting proposal ${proposal.id}`}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
                if (event.target.value.trim()) setMissing(false)
              }}
              placeholder="Reason for rejecting"
              className="h-11 min-w-0 flex-1 rounded-[4px] border border-line-strong bg-ground px-3 text-[14px] text-ink outline-none"
            />
            <button type="submit" disabled={busy} className="h-11 text-[14px] text-ink">
              Reject
            </button>
          </form>
          {missing && <p className="text-[13px] text-signal">A rejection needs a reason.</p>}
        </div>
      )}
    </li>
  )
}

function PrecedentRow({ precedent }: { precedent: Precedent }) {
  const { go } = useRoute()
  return (
    <li className="desk-row grid gap-1 py-3 md:grid-cols-[4.5rem_minmax(0,1.2fr)_8rem_minmax(0,1fr)] md:items-baseline">
      <button type="button" className="text-left font-mono text-[13px] text-ink hover:text-champagne" onClick={() => go('/claims')}>
        #{precedent.claimId}
      </button>
      <div className="min-w-0">
        <p className="truncate text-[15px] text-ink">{precedent.claimantName || 'the venue'}</p>
        <p className="mt-1 truncate text-[13px] text-ink-dim">{shape(precedent.incidentKind, precedent.coverKind)}{precedent.zoneName ? ` · ${precedent.zoneName}` : ''}</p>
      </div>
      <p className="font-mono text-[13px] text-ink">{precedent.decision === 'approve' ? formatCents(precedent.payoutCents) : 'Refused'}</p>
      <p className="text-[13px] text-ink-muted">{precedent.decidedByName} · {when(precedent.decidedAt)}{precedent.reason ? ` · ${precedent.reason}` : ''}</p>
    </li>
  )
}
