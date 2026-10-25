import { useMemo } from 'react'
import { useRoute } from '@/cover/route'
import { bandDigits } from '@/payments/model'
import { alertKind, clock, isOnline, useRun } from '@/stdb/runOps'
import { Section, link } from './parts'

/** SOS presses and falls on bands at the event, and the incidents still open. */
export function RunAlerts({ now }: { now: number }) {
  const { go } = useRoute()
  const bands = useRun((s) => s.bands)
  const zones = useRun((s) => s.zones)
  const attendees = useRun((s) => s.attendees)
  const incidents = useRun((s) => s.incidents)
  const wearers = useMemo(() => new Map(attendees.filter((person) => person.bandId).map((person) => [person.bandId, person.displayName])), [attendees])
  const zoneByStation = useMemo(() => new Map(zones.map((zone) => [zone.stationId, zone.name])), [zones])
  const zoneById = useMemo(() => new Map(zones.map((zone) => [zone.id, zone.name])), [zones])
  const calls = bands.filter((band) => (band.sos || band.fall) && isOnline(band, now))
  const who = (bandId: number) => (wearers.has(bandId) ? ` (${wearers.get(bandId) || 'no name yet'})` : '')

  return (
    <Section id="run-alerts-heading" title="Alerts">
      {calls.length === 0 && incidents.length === 0 ? (
        <p className="text-[15px] text-ink-dim">No SOS, fall or open incident right now.</p>
      ) : (
        <ul className="divide-y divide-line">
          {calls.map((band) => (
            <li key={`band-${band.id}`} className="desk-row px-4 py-3 text-[14px] leading-6 text-ink">
              <span className="font-semibold text-signal">{band.fall ? 'Fall' : 'SOS'}</span>
              {` on band ${bandDigits(band.id)}${who(band.id)} in ${zoneByStation.get(band.zone) ?? 'no zone'}: the bands around it show the light circle.`}
            </li>
          ))}
          {incidents.map((incident) => (
            <li key={`incident-${incident.id}`} className="desk-row flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
              <p className="min-w-0 text-[14px] leading-6 text-ink">
                {`Incident ${incident.id}: ${alertKind(incident.kind)} in ${zoneById.get(incident.zoneId) ?? 'no zone'}, ${incident.subjectBand ? `band ${bandDigits(incident.subjectBand)}${who(incident.subjectBand)}` : 'no band'}, ${incident.status}, opened ${clock(incident.openedAt)}`}
              </p>
              <button type="button" className={link} onClick={() => go('/claims')}>
                Open in Settlements
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
