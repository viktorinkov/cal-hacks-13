import { useMemo, useState, type FormEvent } from 'react'
import { bandCode } from '@/lib/bandCode'
import { bandLabel } from '@/payments/model'
import { WEARER_LIMIT, placeRunBand, placeableBands, unplaceRunBand, useRun, wearerMatches, type Wearer } from '@/stdb/runOps'
import { Refusal, Section, field, link, pill } from './parts'

function WearerPicker({ wearer, onWearer }: { wearer: Wearer | null; onWearer: (next: Wearer | null) => void }) {
  const attendees = useRun((s) => s.attendees)
  const [query, setQuery] = useState('')
  const matches = useMemo(() => wearerMatches(attendees, query), [attendees, query])
  const typed = query.trim()
  const canAdd = typed !== '' && !matches.some((person) => person.displayName.toLowerCase() === typed.toLowerCase())

  if (wearer) {
    return (
      <p className="text-[14px] leading-6 text-ink">
        <span className="text-ink-dim">Who wears it: </span>
        <span className="font-semibold">{wearer.name}</span>
        {wearer.nodeId === '0' && <span className="text-ink-dim"> (new attendee)</span>}{' '}
        <button
          type="button"
          className={link}
          onClick={() => {
            setQuery('')
            onWearer(null)
          }}
        >
          Change
        </button>
      </p>
    )
  }
  return (
    <div>
      <label className="text-[13px] text-ink-dim">
        Who wears it
        <input
          type="search"
          value={query}
          maxLength={60}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search attendees by name, e.g. yours"
          className={`${field} mt-1 w-full`}
        />
      </label>
      <ul aria-label="Attendees who could wear it" className="mt-2 grid gap-1">
        {matches.slice(0, WEARER_LIMIT).map((person) => (
          <li key={person.nodeId}>
            <button type="button" className="text-left text-[14px] text-ink hover:text-champagne" onClick={() => onWearer({ nodeId: person.nodeId, name: person.displayName })}>
              {person.displayName || 'Unnamed'}
              <span className="text-[13px] text-ink-dim">{`${person.bandId ? `, band ${bandCode(person.bandId)}` : ''}${person.organization ? `, ${person.organization}` : ''}`}</span>
            </button>
          </li>
        ))}
        {canAdd && (
          <li>
            <button type="button" className="text-left text-[14px] text-ink hover:text-champagne" onClick={() => onWearer({ nodeId: '0', name: typed })}>
              {`Add ${typed} as a new attendee`}
            </button>
          </li>
        )}
      </ul>
    </div>
  )
}

function PlaceForm({ now }: { now: number }) {
  const bands = useRun((s) => s.bands)
  const placed = useRun((s) => s.placed)
  const zones = useRun((s) => s.zones)
  const busy = useRun((s) => s.busy)
  const choices = useMemo(() => placeableBands(bands, placed, now), [bands, placed, now])
  const [picked, setPicked] = useState<number | null>(null)
  const [wearer, setWearer] = useState<Wearer | null>(null)
  const [x, setX] = useState('')
  const [y, setY] = useState('')
  const [near, setNear] = useState('')
  const bandId = picked != null && choices.includes(picked) ? picked : (choices[0] ?? 0)

  const startFrom = (zoneId: string) => {
    setNear(zoneId)
    const zone = zones.find((item) => item.id === zoneId)
    if (!zone) return
    setX(zone.xM.toFixed(1))
    setY(zone.yM.toFixed(1))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const done = await placeRunBand({ bandId, xM: x.trim() === '' ? Number.NaN : Number(x), yM: y.trim() === '' ? Number.NaN : Number(y), wearer })
    if (done) setWearer(null)
  }

  return (
    <form onSubmit={(event) => void submit(event)} aria-label="Put a band on the map" className="desk-card grid gap-5 p-5">
      <div className="grid gap-4 md:grid-cols-[10rem_minmax(0,1fr)]">
        <label className="text-[13px] text-ink-dim">
          Band
          <select value={bandId || ''} onChange={(event) => setPicked(Number(event.target.value))} className={`${field} mt-1 w-full font-mono`}>
            {choices.map((id) => (
              <option key={id} value={id}>{bandCode(id)}</option>
            ))}
          </select>
        </label>
        <WearerPicker wearer={wearer} onWearer={setWearer} />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-[minmax(0,1fr)_8rem_8rem_auto] md:items-end">
        <label className="col-span-2 text-[13px] text-ink-dim md:col-span-1">
          Start from a zone
          <select value={near} onChange={(event) => startFrom(event.target.value)} disabled={zones.length === 0} className={`${field} mt-1 w-full`}>
            <option value="">Type X and Y yourself</option>
            {zones.map((zone) => (
              <option key={zone.id} value={zone.id}>{zone.name || `Station ${zone.stationId}`}</option>
            ))}
          </select>
        </label>
        <label className="text-[13px] text-ink-dim">
          X, metres
          <input type="number" inputMode="decimal" step="0.1" value={x} onChange={(event) => setX(event.target.value)} className={`${field} mt-1 w-full tabular-nums`} />
        </label>
        <label className="text-[13px] text-ink-dim">
          Y, metres
          <input type="number" inputMode="decimal" step="0.1" value={y} onChange={(event) => setY(event.target.value)} className={`${field} mt-1 w-full tabular-nums`} />
        </label>
        <button type="submit" disabled={busy != null || !bandId} className={`${pill} col-span-2 justify-self-start md:col-span-1`}>
          {busy === 'place' ? 'Placing…' : `Place band ${bandCode(bandId)}`}
        </button>
      </div>
      <Refusal keys={['place']} />
    </form>
  )
}

/** Our real bands among the crowd: the test bands and any of ours online, at a spot on the floor. */
export function BandPlacement({ now, ops }: { now: number; ops: boolean }) {
  const placed = useRun((s) => s.placed)
  const busy = useRun((s) => s.busy)
  return (
    <Section id="run-place-heading" title="Put one of our real bands on the map">
      {ops ? <PlaceForm now={now} /> : <p className="text-[14px] text-ink-dim">Only organizers can put bands on the map.</p>}
      {placed.length > 0 && (
        <>
          <h3 className="mt-8 text-[13px] text-ink-dim">On the map · {placed.length}</h3>
          <ul aria-label="Bands on the map" className="mt-3 divide-y divide-line">
            {placed.map((row) => (
              <li key={row.bandId} className="desk-row flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
                <p className="min-w-0 text-[14px] text-ink">
                  <span className="font-mono">{bandLabel(row.bandId)}</span>
                  {row.label && <span>{` (${row.label})`}</span>}
                  <span className="tabular-nums text-ink-dim">{` at ${row.xM.toFixed(1)}, ${row.yM.toFixed(1)} m`}</span>
                </p>
                {ops && (
                  <button type="button" aria-label={`Remove band ${bandCode(row.bandId)} from the map`} disabled={busy != null} className={link} onClick={() => void unplaceRunBand(row.bandId)}>
                    {busy === `unplace:${row.bandId}` ? 'Removing…' : 'Remove'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {ops && <Refusal keys={['unplace:']} className="mt-3" />}
    </Section>
  )
}
