import { useMemo, useState } from 'react'
import { claimPerson, KEYS, profileCandidates, useAttendee, type EventPerson, type Organization } from '@/stdb/attendeeOps'
import './attendee.css'

function detailOf(person: EventPerson, organizations: Organization[]): string {
  const org = organizations.find((item) => item.id === person.organizationId)?.name ?? ''
  const where = [person.title, org].filter(Boolean).join(', ')
  const kind = person.kind.replace(/_/g, ' ').trim()
  return [where, kind && `(${kind})`].filter(Boolean).join(' ')
}

function Candidate({ person, organizations }: { person: EventPerson; organizations: Organization[] }) {
  const key = KEYS.claimPerson(person.id)
  const pending = useAttendee((s) => Boolean(s.pending[key]))
  const busy = useAttendee((s) => Object.keys(s.pending).some((item) => item.startsWith('claim-person:')))
  const error = useAttendee((s) => s.errors[key])
  const detail = detailOf(person, organizations)
  return (
    <li className="wallet-row">
      <div className="attendee-person">
        {person.headshotUrl ? <img src={person.headshotUrl} alt="" className="attendee-face" /> : <span aria-hidden="true" className="attendee-face" />}
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-ink">{person.displayName}</p>
          {detail && <p className="mt-0.5 text-[13px] leading-5 text-[var(--signup-muted)]">{detail}</p>}
        </div>
        <button type="button" disabled={busy} onClick={() => void claimPerson(person.id)} className="attendee-quiet" aria-label={`This is me: ${person.displayName}`}>
          {pending ? 'Linking…' : 'This is me'}
        </button>
      </div>
      {error && <p role="alert" className="attendee-error">{error}</p>}
    </li>
  )
}

/**
 * "Are you one of these?" People from the event pages whose names match the attendee's, until the
 * attendee picks one or says none. Once linked it says which page is theirs.
 */
export function ProfileMatch() {
  const attendee = useAttendee((s) => s.attendee)
  const people = useAttendee((s) => s.people)
  const organizations = useAttendee((s) => s.organizations)
  const claimed = useAttendee((s) => s.claimedPeople)
  const [dismissed, setDismissed] = useState(false)
  const candidates = useMemo(() => profileCandidates(attendee, people, claimed), [attendee, people, claimed])

  if (!attendee) return null
  if (attendee.personId !== '0') {
    const linked = people.find((person) => person.id === attendee.personId)
    if (!linked) return null
    const detail = detailOf(linked, organizations)
    return (
      <section aria-labelledby="attendee-profile" className="attendee-section">
        <h2 id="attendee-profile">Your event page</h2>
        <p className="attendee-lead">You are {linked.displayName}{detail ? `, ${detail}` : ''} on the event pages.</p>
      </section>
    )
  }
  if (dismissed || !candidates.length) return null
  return (
    <section aria-labelledby="attendee-profile" className="attendee-section">
      <h2 id="attendee-profile">Are you one of these?</h2>
      <p className="attendee-lead">From the event pages.</p>
      <ul className="attendee-panel">
        {candidates.map((person) => <Candidate key={person.id} person={person} organizations={organizations} />)}
      </ul>
      <button type="button" onClick={() => setDismissed(true)} className="attendee-link mt-1">None of these</button>
    </section>
  )
}
