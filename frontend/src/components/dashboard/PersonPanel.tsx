import { useState } from 'react'
import { X } from 'lucide-react'
import { BandTapDialog } from '@/components/cover/BandTapDialog'
import { InjuryForm } from '@/components/claims/ClaimFiling'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useRoute } from '@/cover/route'
import { personActionUnavailable, stagePersonAction, type CrowdAction } from '@/stdb/personActions'
import { useRun } from '@/stdb/runOps'
import { useSession } from '@/stdb/session'
import { bandCode } from '@/lib/bandCode'
import { useDesk } from '@/stdb/deskOps'
import { useUi } from '@/stores/ui'
import { useWorld } from '@/stores/world'

/** Selecting a person on the map keeps their actions beside that person. */
export function PersonPanel() {
  const selection = useUi((state) => state.selection)
  const bandId = selection.kind === 'device' && /^band-\d+$/.test(selection.id) ? Number(selection.id.slice(5)) : 0
  return bandId ? <SelectedPerson key={bandId} bandId={bandId} /> : null
}

function SelectedPerson({ bandId }: { bandId: number }) {
  const run = useRun()
  const owner = useSession((state) => state.owner)
  const roles = useSession((state) => state.roles)
  const claimsByBand = useSession((state) => state.claims)
  const injuries = useDesk((state) => state.injuries)
  const select = useUi((state) => state.select)
  const device = useWorld((state) => state.devices[`band-${bandId}`] ?? state.devices[`band-${String(bandId).padStart(2, '0')}`])
  const { go, search } = useRoute()
  const [tap, setTap] = useState(false)
  const [filing, setFiling] = useState(false)
  const [busy, setBusy] = useState<CrowdAction | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const person = run.attendees.find((item) => item.bandId === bandId)
  const name = person?.displayName || device?.wearerLabel || `Band ${bandCode(bandId)}`
  const band = run.bands.find((item) => item.id === bandId)
  const place = run.zones.find((zone) => zone.stationId === band?.zone)?.name
  const canOperate = owner || roles.includes('ops')
  const canFile = canOperate || roles.includes('medic')
  const unfiled = person ? injuries.filter((injury) => injury.bandId === bandId && injury.wearerName === person.displayName) : []
  const reason = person ? personActionUnavailable(person, run) : ''
  const planIds = new Set(run.plans.filter((plan) => plan.culpritBand === bandId).map((plan) => plan.incidentId))
  const incident = run.incidents.find((item) => item.subjectBand === bandId || planIds.has(item.id))
  const ownIncidentIds = new Set([...planIds, ...run.markers.filter((marker) => marker.bandId === bandId).map((marker) => marker.incidentId)])
  const claim = incident
    ? run.claims.find((item) => item.incidentId === incident.id)
    : [...run.claims].reverse().find((item) => ownIncidentIds.has(item.incidentId))
      ?? [...claimsByBand].reverse().find((item) => item.bandId === bandId)

  async function act(action: CrowdAction) {
    setBusy(action)
    setMessage('')
    setError('')
    try {
      await stagePersonAction(bandId, action)
      setMessage(action === 'injury' ? 'Injury started. Follow the incident as staff respond.' : 'Theft started. Follow the incident as staff investigate.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The action did not start.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label={`Selected person: ${name}`} className="nc-panel pointer-events-auto w-[320px] max-w-[calc(100vw-3rem)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-medium text-ink">{name}</h2>
          <p className="mt-1 text-[12px] text-ink-dim">Band {bandCode(bandId)}{place ? ` · ${place}` : ''}</p>
        </div>
        <button type="button" aria-label="Close person panel" className="p-1 text-ink-muted hover:text-ink" onClick={() => select({ kind: 'none' })}><X size={16} /></button>
      </div>
      {person?.crowd && canOperate && (
        <div className="mt-4">
          <h3 className="text-[13px] font-medium text-ink">Choose this bot&apos;s action</h3>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" disabled={!!reason || busy != null} onClick={() => void act('injury')} className="rounded-[4px] border border-line-strong px-3 py-2 text-[13px] text-ink disabled:text-ink-muted">{busy === 'injury' ? 'Starting…' : 'Gets injured'}</button>
            <button type="button" disabled={!!reason || busy != null} onClick={() => void act('theft')} className="rounded-[4px] border border-line-strong px-3 py-2 text-[13px] text-ink disabled:text-ink-muted">{busy === 'theft' ? 'Starting…' : 'Steals equipment'}</button>
          </div>
          {reason && <p className="mt-2 text-[12px] leading-5 text-ink-dim">{reason}</p>}
        </div>
      )}
      {!person && <p className="mt-3 text-[13px] text-ink-dim">No attendee is linked to this band.</p>}
      {message && <p role="status" className="mt-3 text-[13px] leading-5 text-ink-dim">{message}</p>}
      {error && <p role="alert" className="mt-3 text-[13px] text-signal">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-ink">
        {person && <button type="button" onClick={() => setTap(true)}>Open band</button>}
        {canFile && unfiled.length > 0 && <button type="button" onClick={() => setFiling(true)}>File injury claim</button>}
        {incident && <button type="button" onClick={() => { select({ kind: 'incident', id: incident.id }); useUi.getState().setIncidentOpen(true) }}>View incident</button>}
        {claim && <button type="button" onClick={() => { const query = new URLSearchParams(search); query.set('claim', claim.id); go(`/claims?${query}`) }}>View settlement</button>}
      </div>
      {tap && <BandTapDialog deviceId={`band-${bandId}`} bandNumber={bandId} onClose={() => setTap(false)} />}
      {filing && <Dialog open onOpenChange={setFiling}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-popover text-ink sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>File a claim for {name}</DialogTitle>
            <DialogDescription>Choose the resolved injury and record what happened.</DialogDescription>
          </DialogHeader>
          {unfiled.map((injury) => <div key={injury.incidentId}>
            <p className="text-[14px] text-ink">{injury.kind === 'sos' ? 'SOS' : 'Fall'} · {injury.zoneName} · {new Date(injury.openedAt).toLocaleString()}</p>
            <InjuryForm incidentId={injury.incidentId} kind={injury.kind} zone={injury.zoneName} name={injury.wearerName} onFiled={() => { setFiling(false); setMessage('Claim filed. Its settlement will appear here as the record arrives.') }} />
          </div>)}
          {unfiled.length === 0 && <p className="text-[14px] text-ink-dim">This injury is no longer waiting for a claim.</p>}
        </DialogContent>
      </Dialog>}
    </section>
  )
}
