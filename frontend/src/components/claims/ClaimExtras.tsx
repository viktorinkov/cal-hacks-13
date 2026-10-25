import { useEffect, useState, type FormEvent } from 'react'
import { formatCents } from '@/cover/money'
import { bandLabel } from '@/payments/model'
import { useSession } from '@/stdb/session'
import {
  NONE,
  isOps,
  nameResponsibleBand,
  recordInsurerPayment,
  useSettlement,
  waitingLine,
  watchClaimClauses,
  whoPays,
  type SettleClaim,
} from '@/stdb/settlementOps'
import { ClaimEvidence } from './ClaimEvidence'

const field = 'h-11 w-full min-w-0 rounded-[4px] border border-line-strong bg-ground px-3 text-[14px] text-ink outline-none'
const action = 'h-11 self-start text-[14px] text-ink hover:text-champagne disabled:text-ink-muted'

function reasonOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/**
 * The settlement half of a claim: who pays what, the insurer's payment, who broke the venue's
 * equipment, and the evidence behind the decision. Sits inside the claim docket; the letters
 * are listed by ClaimFiling underneath it.
 */
export function ClaimExtras({ claimId }: { claimId: string }) {
  const claim = useSettlement((s) => s.claims[claimId])
  const clinic = useSettlement((s) => s.clinicReports[claimId])
  const ledger = useSettlement((s) => s.ledger[claimId] ?? NONE)
  const policies = useSettlement((s) => s.policies)
  const owner = useSession((s) => s.owner)
  const roles = useSession((s) => s.roles)
  const ops = isOps({ owner, roles })

  useEffect(() => {
    watchClaimClauses(claimId)
  }, [claimId])

  if (!claim) return null

  const waiting = waitingLine(claim, clinic != null, ledger)
  const rows = whoPays(claim, policies[claim.policyId])

  return (
    <div className="mt-8 flex flex-col gap-7 border-t border-line pt-6" data-claim-extras={claim.id}>
      {(waiting || rows.length > 0) && (
        <section aria-label="Who pays what">
          <h3 className="text-[13px] text-ink-dim">Who pays what</h3>
          {waiting && <p className="mt-2 text-[14px] leading-6 text-ink">{waiting}</p>}
          {rows.length > 0 && (
            <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-[14px]">
              {rows.map(([label, cents]) => (
                <div key={label} className="contents">
                  <dt className="text-ink-dim">{label}</dt>
                  <dd className="text-right tabular-nums text-ink">{formatCents(cents)}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}

      {ops && claim.status === 'settled' && <InsurerPayment key={claim.id} claim={claim} />}

      {claim.coverKind === 'property' && <WhoDidIt claim={claim} ops={ops} />}

      <ClaimEvidence claimId={claim.id} />
    </div>
  )
}

function InsurerPayment({ claim }: { claim: SettleClaim }) {
  const busy = useSettlement((s) => s.busy)
  const [amount, setAmount] = useState((claim.recoverableCents / 100).toFixed(2))
  const [reference, setReference] = useState('')
  const [problem, setProblem] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setProblem('')
    void recordInsurerPayment(claim.id, amount, reference).catch((error: unknown) => {
      setProblem(reasonOf(error, 'The payment was not recorded.'))
    })
  }
  return (
    <form aria-label="Record the insurer's payment" onSubmit={submit} className="flex flex-col gap-3">
      <h3 className="text-[13px] text-ink-dim">Record the insurer&apos;s payment</h3>
      <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <label className="text-[13px] text-ink-dim">
          Amount in dollars
          <input value={amount} required inputMode="decimal" onChange={(event) => setAmount(event.target.value)} className={`${field} mt-1 tabular-nums`} />
        </label>
        <label className="text-[13px] text-ink-dim">
          Reference
          <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Cheque or transfer reference" className={`${field} mt-1`} />
        </label>
      </div>
      <button type="submit" disabled={busy} className={action}>
        Record the payment
      </button>
      {problem && <p className="text-[13px] text-signal">{problem}</p>}
    </form>
  )
}

function WhoDidIt({ claim, ops }: { claim: SettleClaim; ops: boolean }) {
  const charge = useSettlement((s) => s.charges[claim.incidentId])
  const busy = useSettlement((s) => s.busy)
  const [band, setBand] = useState('')
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState('')
  const open = !charge || charge.status === 'proposed'
  if (!charge && !ops) return null
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setProblem('')
    void nameResponsibleBand(claim.incidentId, band, note)
      .then(() => {
        setBand('')
        setNote('')
      })
      .catch((error: unknown) => setProblem(reasonOf(error, 'The band was not named.')))
  }
  return (
    <section aria-label="Who did it" className="flex flex-col gap-3">
      <h3 className="text-[13px] text-ink-dim">Who did it</h3>
      {charge && (
        <p className="text-[14px] leading-6 text-ink">
          {`Named ${charge.attendeeName || 'an attendee'}, ${bandLabel(charge.bandId)}, by ${charge.namedByName || 'staff'}: the charge is ${charge.status}.`}
        </p>
      )}
      {ops && open && (
        <form aria-label="Name the band responsible" onSubmit={submit} className="flex flex-col gap-3">
          <input
            aria-label="Band of who did it"
            value={band}
            required
            onChange={(event) => setBand(event.target.value)}
            placeholder="Band number of who did it, e.g. 07"
            className={field}
          />
          <input aria-label="What you saw" value={note} onChange={(event) => setNote(event.target.value)} placeholder="What you saw" className={field} />
          <button type="submit" disabled={busy} className={action}>
            {charge ? 'Name someone else' : 'Name who did it'}
          </button>
          {problem && <p className="text-[13px] text-signal">{problem}</p>}
        </form>
      )}
    </section>
  )
}
