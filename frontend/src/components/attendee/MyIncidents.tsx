import { useMemo, useState, type FormEvent } from 'react'
import { formatCents } from '@/cover/money'
import { clock } from '@/payments/model'
import {
  canFileClaim, claimStatusLine, clearError, fileClaim, incidentWords, KEYS, useAttendee, type MyClaim, type MyIncident,
} from '@/stdb/attendeeOps'
import './attendee.css'

function where(zoneName: string): string {
  return zoneName ? ` at the ${zoneName}` : ''
}

function FileClaim({ incident }: { incident: MyIncident }) {
  const key = KEYS.fileClaim(incident.incidentId)
  const pending = useAttendee((s) => Boolean(s.pending[key]))
  const error = useAttendee((s) => s.errors[key])
  const [statement, setStatement] = useState('')
  const at = clock(incident.openedAt)
  const id = `statement-${incident.incidentId}`
  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (await fileClaim(incident.incidentId, statement)) setStatement('')
  }
  return (
    <li className="wallet-row">
      <form onSubmit={(event) => void send(event)} noValidate aria-label={`Ask the venue to pay for ${incidentWords(incident.kind)}`}>
        <p className="text-[14px] leading-6 text-ink">
          Your band flagged {incidentWords(incident.kind)}{where(incident.zoneName)}{at ? ` at ${at}` : ''}. If you were hurt, tell us what happened and the venue pays your treatment into your wallet.
        </p>
        <label htmlFor={id} className="attendee-label mt-3">What happened</label>
        <textarea
          id={id}
          name={id}
          rows={4}
          value={statement}
          placeholder="Tell us what happened…"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => { setStatement(event.target.value); clearError(key) }}
          className="signup-input wallet-textarea"
        />
        {error && <p id={`${id}-error`} role="alert" className="attendee-error">{error}</p>}
        <div className="attendee-actions">
          <button type="submit" disabled={pending} className="signup-primary text-[14px]">{pending ? 'Sending…' : 'Ask the venue to pay'}</button>
        </div>
      </form>
    </li>
  )
}

function ClaimRow({ claim }: { claim: MyClaim }) {
  const filed = clock(claim.openedAt)
  return (
    <li className="wallet-row">
      <p className="text-[15px] font-medium text-ink">{claimStatusLine(claim.status, claim.payoutCents, formatCents)}</p>
      <p className="mt-1 text-[13px] leading-5 text-[var(--signup-muted)]">
        Claim {claim.id}, for {incidentWords(claim.incidentKind, 'an injury')}{where(claim.zoneName)}{filed ? `, filed ${filed}` : ''}.
      </p>
      {claim.statement && <blockquote className="attendee-quote">You said: “{claim.statement}”</blockquote>}
    </li>
  )
}

/**
 * The attendee's incidents and claims. A closed fall or SOS without a claim gets a form that asks the
 * venue to pay; an open one says staff have it; each claim says where it stands.
 */
export function MyIncidents() {
  const incidents = useAttendee((s) => s.incidents)
  const claims = useAttendee((s) => s.claims)
  const fileable = useMemo(() => incidents.filter((incident) => canFileClaim(incident, claims)), [incidents, claims])
  const open = useMemo(() => incidents.filter((incident) => !incident.resolved && (incident.kind === 'sos' || incident.kind === 'fall')), [incidents])
  if (!fileable.length && !open.length && !claims.length) return null
  return (
    <>
      {(fileable.length > 0 || open.length > 0) && (
        <section aria-labelledby="attendee-hurt" className="attendee-section wallet-section mt-10">
          <h2 id="attendee-hurt">Hurt at the event?</h2>
          <ul className="mt-2">
            {open.map((incident) => {
              const at = clock(incident.openedAt)
              return (
                <li key={incident.incidentId} className="wallet-row">
                  <p role="status" className="text-[14px] leading-6 text-ink">
                    Your band flagged {incidentWords(incident.kind)}{where(incident.zoneName)}{at ? ` at ${at}` : ''}. Staff are on it. Once it is closed you can ask the venue to pay.
                  </p>
                </li>
              )
            })}
            {fileable.map((incident) => <FileClaim key={incident.incidentId} incident={incident} />)}
          </ul>
        </section>
      )}
      {claims.length > 0 && (
        <section aria-labelledby="attendee-claims" className="attendee-section wallet-section mt-10">
          <h2 id="attendee-claims">{claims.length > 1 ? 'Your claims' : 'Your claim'}</h2>
          <ul className="mt-2">{claims.map((claim) => <ClaimRow key={claim.id} claim={claim} />)}</ul>
        </section>
      )}
    </>
  )
}
