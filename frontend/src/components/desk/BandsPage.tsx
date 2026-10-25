import { useMemo, useState } from 'react'
import { useCatalog } from '@/stdb/catalog'
import { DeskFrame, Figure, when } from './DeskFrame'

type Filter = 'all' | 'online' | 'alerts'

/** Every wristband the database is hearing, with the person who claimed it when we know them. */
export function BandsPage() {
  const bands = useCatalog((s) => s.bands)
  const attendees = useCatalog((s) => s.attendees)
  const zones = useCatalog((s) => s.zones)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const wearer = useMemo(() => {
    const names = new Map<number, string>()
    for (const person of attendees) if (person.bandId > 0 && person.displayName) names.set(person.bandId, person.displayName)
    return names
  }, [attendees])
  const zoneName = useMemo(() => {
    const names = new Map<number, string>()
    for (const zone of zones) names.set(zone.stationId, zone.name)
    return names
  }, [zones])
  const online = bands.filter((band) => band.online).length
  const alerts = bands.filter((band) => band.sos || band.fall).length
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...bands]
      .filter((band) => (filter === 'online' ? band.online : filter === 'alerts' ? band.sos || band.fall : true))
      .filter((band) => {
        if (!q) return true
        const name = wearer.get(band.id) ?? ''
        return `${band.id} ${name} ${zoneName.get(band.zone) ?? ''}`.toLowerCase().includes(q)
      })
      .sort((a, b) => Number(b.sos || b.fall) - Number(a.sos || a.fall) || Number(b.online) - Number(a.online) || a.id - b.id)
  }, [bands, filter, query, wearer, zoneName])

  return (
    <DeskFrame
      title={alerts ? `${alerts} band${alerts === 1 ? '' : 's'} asking for help.` : `${online.toLocaleString('en-US')} bands online.`}
      sentence="The roster from the live database. A band stays on the list even when this map is not drawing a pin for it."
      figures={
        <>
          <Figure lead label="Online" value={online.toLocaleString('en-US')} note={`of ${bands.length.toLocaleString('en-US')}`} />
          <Figure label="Alerts" value={String(alerts)} note="SOS or fall" />
          <Figure label="Named" value={String(wearer.size)} note="matched to an attendee" />
          <Figure label="Quiet" value={(bands.length - online).toLocaleString('en-US')} note="not currently online" />
        </>
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex gap-4 text-[13px]">
          {(
            [
              ['all', 'All'],
              ['online', 'Online'],
              ['alerts', 'Alerts'],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setFilter(key)} className={filter === key ? 'text-ink' : 'text-ink-muted hover:text-ink'}>
              <span className="relative">
                {label}
                {filter === key && <span aria-hidden className="absolute -bottom-1 left-0 right-0 h-px bg-champagne" />}
              </span>
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Band, name, or zone"
          aria-label="Find a band"
          className="w-full max-w-xs border-b border-line bg-transparent py-1 text-[14px] text-ink outline-none placeholder:text-ink-muted"
        />
      </div>
      <ul className="mt-6 divide-y divide-line">
        {shown.slice(0, 400).map((band) => (
          <li key={band.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,8rem)_5.5rem] items-baseline gap-3 py-2.5">
            <span className="font-mono text-[13px] text-ink">{band.id}</span>
            <span className="min-w-0 truncate text-[14px] text-ink">{wearer.get(band.id) || 'No name yet'}</span>
            <span className="truncate text-[13px] text-ink-dim">{zoneName.get(band.zone) || (band.zone ? `Station ${band.zone}` : 'No zone')}</span>
            <span className={band.sos || band.fall ? 'text-[13px] text-signal' : band.online ? 'text-[13px] text-teal' : 'text-[13px] text-ink-muted'}>
              {band.fall ? 'Fall' : band.sos ? 'SOS' : band.online ? 'Online' : 'Quiet'}
            </span>
          </li>
        ))}
      </ul>
      {shown.length > 400 && <p className="mt-4 text-[13px] text-ink-muted">Showing the first 400 of {shown.length.toLocaleString('en-US')}. Narrow the list to see the rest.</p>}
      {shown.length === 0 && <p className="mt-6 text-[15px] text-ink-dim">{bands.length === 0 ? 'The band table has not arrived yet.' : 'Nothing matches.'}</p>}
      {shown.some((band) => band.lastSeen) && <p className="mt-6 text-[13px] text-ink-muted">Last heard {when(Math.max(...shown.map((band) => band.lastSeen)))}.</p>}
    </DeskFrame>
  )
}
