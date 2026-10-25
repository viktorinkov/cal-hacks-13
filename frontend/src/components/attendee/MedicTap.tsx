import { useEffect, useRef } from 'react'
import { useRoute } from '@/cover/route'
import { bandDigits, clock } from '@/payments/model'
import {
  assignMedic, KEYS, medicCardFor, requestMedicalCard, useAttendee, useMedicOnBand, type MedicCard, type OpenIncident,
} from '@/stdb/attendeeOps'
import './attendee.css'

const KIND_LABEL: Record<string, string> = { sos: 'SOS', fall: 'Fall' }

function CardFacts({ row, band }: { row: MedicCard; band: string }) {
  const card = row.card
  const heading = `Medical card: ${row.name || 'the wearer'}, band ${band}`
  if (!card) {
    return (
      <div className="mt-6">
        <h3 className="text-[15px] font-medium text-ink">{heading}</h3>
        <p className="mt-2 text-[14px] text-ink-dim">No medical card on file.</p>
      </div>
    )
  }
  const insurance = card.insurer
    ? [`${card.insurer} ${card.plan}`.trim(), card.memberId && `member ${card.memberId}`, card.groupNumber && `group ${card.groupNumber}`, card.insurerPhone].filter(Boolean).join(', ')
    : ''
  const facts: [string, string][] = [
    ['Blood type', card.bloodType && card.bloodType !== 'unknown' ? card.bloodType : ''],
    ['Allergies', card.allergies.join('; ')],
    ['Conditions', card.conditions.join('; ')],
    ['Medications', card.medications.join('; ')],
    ['Emergency contact', card.emergencyContact],
    ['Insurance', insurance],
  ]
  const shown = facts.filter(([, value]) => value)
  return (
    <div className="mt-6">
      <h3 className="text-[15px] font-medium text-ink">
        {heading}{card.status !== 'confirmed' ? ' (not yet confirmed by the wearer)' : ''}
      </h3>
      {shown.length > 0 ? (
        <dl className="signup-facts">
          {shown.map(([label, value]) => <div key={label}><dt className="text-ink-dim">{label}</dt><dd>{value}</dd></div>)}
        </dl>
      ) : <p className="mt-2 text-[14px] text-ink-dim">The card is empty.</p>}
      {card.notes && <p className="attendee-quote">{card.notes}</p>}
    </div>
  )
}

function Assignment({ incident, bandId }: { incident: OpenIncident; bandId: number }) {
  const me = useAttendee((s) => s.me)
  const key = KEYS.assign(incident.id)
  const pending = useAttendee((s) => Boolean(s.pending[key]))
  const error = useAttendee((s) => s.errors[key])
  const take = async () => {
    if (!(await assignMedic(incident.id))) return
    const state = useAttendee.getState()
    if (!medicCardFor(state.medicCards, bandId, incident.id)) void requestMedicalCard(bandId)
  }
  if (incident.assignedMedic && incident.assignedMedic === me) return <p role="status" className="mt-3 text-[14px] text-teal">You have it.</p>
  if (incident.assignedMedic) return <p className="mt-3 text-[14px] text-ink-dim">Another medic has it.</p>
  if (incident.status !== 'open') return null
  return (
    <div className="mt-3">
      <button type="button" disabled={pending} onClick={() => void take()} className="signup-primary text-[14px]">{pending ? 'Taking it…' : 'Take it'}</button>
      {error && <p role="alert" className="attendee-error">{error}</p>}
    </div>
  )
}

/**
 * What a signed-in medic sees on a band's page while that band has an open SOS or fall: the
 * incident, a button to take it, and the wearer's medical card. Nothing for anyone else, and nothing
 * once the incident is resolved, so the card is only on screen during the incident.
 */
export function MedicTap({ bandId }: { bandId: number }) {
  const { go } = useRoute()
  const { show, incident } = useMedicOnBand(bandId)
  const cards = useAttendee((s) => s.medicCards)
  const request = useAttendee((s) => s.cardRequests[bandId])
  const asking = useAttendee((s) => Boolean(s.pending[KEYS.card(bandId)]))
  const asked = useRef<string | null>(null)
  const incidentId = incident?.id ?? null

  useEffect(() => {
    if (!show || !incidentId || asked.current === incidentId) return
    asked.current = incidentId
    void requestMedicalCard(bandId)
  }, [show, incidentId, bandId])

  if (!show || !incident) return null
  const band = bandDigits(bandId)
  const card = medicCardFor(cards, bandId, incident.id)
  const opened = clock(incident.openedAt)
  const refused = request?.state === 'refused' ? request.message : ''
  return (
    <section aria-labelledby="attendee-medic" className="attendee-medic">
      <h2 id="attendee-medic" className="text-[18px] font-medium text-ink">Medic view: band {band}</h2>
      <p className="mt-2 text-[14px] leading-6 text-ink">
        {KIND_LABEL[incident.kind] ?? incident.kind} incident {incident.id}, {incident.status}{opened ? `, opened ${opened}` : ''}{incident.openedBy ? ` by ${incident.openedBy}` : ''}.
      </p>
      <Assignment incident={incident} bandId={bandId} />
      {card ? <CardFacts row={card} band={band} />
        : refused ? (
          <div className="mt-6">
            <p role="alert" className="text-[14px] leading-6 text-caution">{/nobody wears/i.test(refused) ? `Nobody wears band ${band}.` : refused}</p>
            <button type="button" disabled={asking} onClick={() => void requestMedicalCard(bandId)} className="attendee-link">{asking ? 'Asking…' : 'Tap again'}</button>
          </div>
        ) : <p role="status" className="mt-6 text-[14px] text-ink-dim">Opening the medical card…</p>}
      <button type="button" onClick={() => go('/')} className="attendee-link mt-4 block">Notes, cost and resolve on the incident desk</button>
    </section>
  )
}
