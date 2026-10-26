import { useMemo, useState, type KeyboardEvent } from 'react'
import { formatCents } from '@/cover/money'
import { clearError, KEYS, latestHealthLookup, lookUpPlan, useAttendee, type PlanLookup as Lookup } from '@/stdb/attendeeOps'
import './attendee.css'

function LookupStatus({ lookup }: { lookup: Lookup }) {
  if (lookup.status === 'searching') {
    return <p role="status" className="wallet-note">Looking up your plan…</p>
  }
  if (lookup.status === 'found') {
    const name = `${lookup.printedInsurer || lookup.insurer} ${lookup.printedPlan || lookup.plan}`.trim()
    const money = [
      lookup.limitCents > 0 && `Limit ${formatCents(lookup.limitCents)}`,
      lookup.deductibleCents > 0 && `deductible ${formatCents(lookup.deductibleCents)}`,
    ].filter(Boolean).join(' · ')
    return (
      <div role="status" className="mt-2 text-[14px] leading-6 text-ink">
        <p>
          <span className="font-medium">Plan found: </span>
          {name}{lookup.planYear ? ` (${lookup.planYear})` : ''}{' '}
          {lookup.sourceUrl && <a href={lookup.sourceUrl} target="_blank" rel="noreferrer" className="text-champagne underline underline-offset-4">read it</a>}
        </p>
        {money && <p className="mt-1 text-[13px] text-[var(--signup-muted)]">{money}</p>}
        {lookup.matchedChunk && (
          <blockquote className="attendee-quote">Page {lookup.matchedChunk.page}: “{lookup.matchedChunk.text}”</blockquote>
        )}
      </div>
    )
  }
  return (
    <div role="status" className="mt-2">
      <p className="text-[14px] leading-6 text-caution">We couldn’t find your plan’s documents online. Upload your insurance card instead.</p>
      {lookup.note && <p className="attendee-hint">{lookup.note}</p>}
    </div>
  )
}

/**
 * "Name your plan instead": the insurer, the plan and the state, looked up online in place of an
 * insurance card. Not a <form>, so it can sit inside the sign-up form's documents step.
 * `bare` leaves out the panel, for a step that already draws one.
 */
export function PlanLookup({ disabled = false, bare = false }: { disabled?: boolean; bare?: boolean }) {
  const lookups = useAttendee((s) => s.planLookups)
  const pending = useAttendee((s) => Boolean(s.pending[KEYS.planLookup]))
  const error = useAttendee((s) => s.errors[KEYS.planLookup])
  const latest = useMemo(() => latestHealthLookup(lookups), [lookups])
  // null follows the newest lookup, so a retry starts from what was asked last time.
  const [insurer, setInsurer] = useState<string | null>(null)
  const [plan, setPlan] = useState<string | null>(null)
  const [state, setState] = useState<string | null>(null)
  const shown = {
    insurer: insurer ?? latest?.insurer ?? '',
    plan: plan ?? latest?.plan ?? '',
    state: state ?? latest?.state ?? '',
  }
  const blocked = disabled || pending

  const submit = async () => {
    if (blocked) return
    await lookUpPlan(shown.insurer, shown.plan, shown.state)
  }
  const onEnter = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return
    event.preventDefault()
    void submit()
  }
  const edit = (set: (value: string | null) => void) => (value: string) => {
    set(value)
    clearError(KEYS.planLookup)
  }

  return (
    <section aria-labelledby="attendee-plan" className={bare ? 'attendee-section mt-6' : 'attendee-section'}>
      {bare
        ? <h3 id="attendee-plan" className="text-[14px] font-medium text-ink">Name your plan instead</h3>
        : <h2 id="attendee-plan">Name your plan instead</h2>}
      <p className="attendee-lead">No card to upload? We look up your plan’s documents online.</p>
      {latest && <LookupStatus lookup={latest} />}
      <div role="group" aria-label="Your health plan" onKeyDown={onEnter} className={bare ? 'mt-4' : 'attendee-panel'}>
        <div className="attendee-fields is-three">
          <div>
            <label htmlFor="plan-insurer" className="attendee-label">Insurer</label>
            <input id="plan-insurer" name="insurer" value={shown.insurer} placeholder="Blue Shield of California" disabled={disabled} onChange={(event) => edit(setInsurer)(event.target.value)} className="signup-input" />
          </div>
          <div>
            <label htmlFor="plan-plan" className="attendee-label">Plan</label>
            <input id="plan-plan" name="plan" value={shown.plan} placeholder="Silver 70 PPO" disabled={disabled} onChange={(event) => edit(setPlan)(event.target.value)} className="signup-input" />
          </div>
          <div>
            <label htmlFor="plan-state" className="attendee-label">Plan state</label>
            <input id="plan-state" name="state" value={shown.state} placeholder="CA" maxLength={2} autoCapitalize="characters" disabled={disabled} onChange={(event) => edit(setState)(event.target.value.toUpperCase())} className="signup-input" />
          </div>
        </div>
        {error && <p role="alert" className="attendee-error">{error}</p>}
        <div className="attendee-actions">
          <button type="button" onClick={() => void submit()} disabled={blocked} className="attendee-quiet">
            {pending ? 'Looking it up…' : 'Look it up'}
          </button>
        </div>
      </div>
    </section>
  )
}
