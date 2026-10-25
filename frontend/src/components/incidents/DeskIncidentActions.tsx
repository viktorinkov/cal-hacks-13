import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { Incident } from '@/contracts/domain'
import { Button } from '@/components/ui/button'
import { formatCents } from '@/cover/money'
import { acknowledgeIncident, noteIncidentPath, pendingKey, resolveIncident } from '@/services/operatorCommands'
import { useDesk } from '@/stdb/deskOps'
import { useSession } from '@/stdb/session'
import { useUi } from '@/stores/ui'

function bandNumber(incident: Incident): number | null {
  const live = /^live-(\d+)$/.exec(incident.incidentId)
  if (live) return Number(live[1])
  const device = incident.reportedByDeviceId?.match(/^band-(\d+)$/)
  return device ? Number(device[1]) : null
}

/** Acknowledge, path, and resolve for an incident the module already owns. */
export function DeskIncidentActions({ incident }: { incident: Incident }) {
  const pending = useUi((s) => s.pending)
  const requestCard = useSession((s) => s.requestCard)
  const sessionCards = useSession((s) => s.cards)
  const incidents = useDesk((s) => s.incidents)
  const notes = useDesk((s) => s.notes)
  const cards = useDesk((s) => s.cards)
  const error = useDesk((s) => s.error)
  const [note, setNote] = useState('')
  const [cost, setCost] = useState('')
  const bandId = bandNumber(incident)
  const row = incidents.find((item) => item.id === incident.incidentId) ?? (bandId == null ? undefined : incidents.find((item) => item.bandId === bandId && !item.resolved))
  const taken = row?.status === 'responding' || incident.status === 'responding' || incident.status === 'acknowledged'
  const ownNotes = notes.filter((item) => item.incidentId === (row?.id ?? incident.incidentId))
  const card = cards.find((item) => item.incidentId === row?.id) ?? cards.find((item) => bandId != null && item.bandId === bandId) ?? null
  const sessionCard = sessionCards.find((item) => bandId != null && item.bandId === bandId)
  const shown = card ?? (sessionCard ? { ...sessionCard, confirmed: sessionCard.status === 'confirmed', incidentId: row?.id ?? '' } : null)
  const busy = (key: string) => !!pending[key]

  return (
    <div className="flex flex-col gap-3">
      {shown ? (
        <div className="flex flex-col gap-1 text-[13px] leading-5 text-ink">
          <p className="font-medium">
            {`Medical card: ${shown.name || 'the wearer'}${bandId ? `, band ${bandId}` : ''}${shown.confirmed ? '' : ' (not yet confirmed by the wearer)'}`}
          </p>
          <p className="text-ink-dim">
            {[shown.bloodType && `Blood ${shown.bloodType}`, shown.allergies && `Allergies ${shown.allergies}`, shown.conditions && shown.conditions, shown.medications && shown.medications, shown.emergencyContact && `Emergency ${shown.emergencyContact}`, shown.insurer && shown.insurer]
              .filter(Boolean)
              .join(' · ') || 'No medical card on file.'}
          </p>
          {shown.notes && <p className="text-ink-dim">{shown.notes}</p>}
        </div>
      ) : (
        bandId != null && bandId <= 255 && (
          <button type="button" className="self-start text-[13px] text-ink hover:text-champagne" onClick={() => void requestCard(bandId)}>
            {`Tap band ${bandId} for the medical card`}
          </button>
        )
      )}
      {ownNotes.length > 0 && (
        <ul className="flex flex-col gap-1 text-[13px] text-ink-dim">
          {ownNotes.map((item) => (
            <li key={item.id}>{`${item.authorRole}: ${item.text}${item.costCents == null ? '' : ` (${formatCents(item.costCents)})`}`}</li>
          ))}
        </ul>
      )}
      {!taken && (
        <Button
          size="lg"
          className="h-11 text-[14px] font-semibold hover:bg-champagne-hover"
          disabled={busy(pendingKey.ack(incident.incidentId))}
          onClick={() => void acknowledgeIncident(incident.incidentId)}
        >
          {busy(pendingKey.ack(incident.incidentId)) ? (
            <>
              <Loader2 className="animate-spin" /> Waiting for the backend…
            </>
          ) : (
            'Acknowledge'
          )}
        </Button>
      )}
      {taken && incident.status !== 'resolved' && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void noteIncidentPath(incident.incidentId, note, cost).then((ok) => {
              if (ok) {
                setNote('')
                setCost('')
              }
            })
          }}
        >
          <input
            aria-label="Treatment note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Treatment note"
            className="h-10 rounded-[4px] border border-line-strong bg-transparent px-3 text-[14px] text-ink outline-none"
          />
          <input
            aria-label="Cost in dollars"
            value={cost}
            inputMode="decimal"
            onChange={(event) => setCost(event.target.value)}
            placeholder="Cost in dollars (optional)"
            className="h-10 rounded-[4px] border border-line-strong bg-transparent px-3 text-[14px] text-ink outline-none"
          />
          <Button type="submit" size="lg" className="h-11 text-[14px] font-semibold hover:bg-champagne-hover" disabled={busy(pendingKey.preview(incident.incidentId))}>
            {busy(pendingKey.preview(incident.incidentId)) ? 'Waiting for the backend…' : 'Path'}
          </Button>
        </form>
      )}
      {incident.status !== 'resolved' && (
        <Button
          variant="outline"
          className="h-10 bg-transparent text-[14px]"
          disabled={busy(pendingKey.resolve(incident.incidentId))}
          onClick={() => void resolveIncident(incident.incidentId, 'assisted_on_scene')}
        >
          {busy(pendingKey.resolve(incident.incidentId)) ? 'Resolving…' : 'Resolve'}
        </Button>
      )}
      {error && <p className="text-[12px] text-signal">{error}</p>}
    </div>
  )
}
