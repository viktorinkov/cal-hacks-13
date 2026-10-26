import { useMemo, useState } from 'react'
import { MerchThumb } from '@/components/payments/MerchThumb'
import { formatCents } from '@/cover/money'
import { bandCode } from '@/lib/bandCode'
import { usePayments } from '@/payments/store'
import { useCatalog, type Photo } from '@/stdb/catalog'
import { DeskFrame, Figure, when } from './DeskFrame'

type Filter = 'all' | 'online' | 'alerts'

/** Photographs and merch the host already made for one wearer. */
function BandNight({ nodeId, name }: { nodeId: string; name: string }) {
  const photos = useCatalog((s) => s.photos)
  const picks = usePayments((s) => s.desk.picks)
  const theirs = useMemo(
    () => photos.filter((photo) => nodeId && photo.nodeIds.includes(nodeId)),
    [photos, nodeId],
  )
  const merch = useMemo(
    () => picks.filter((pick) => pick.nodeId === nodeId).sort((a, b) => a.rank - b.rank).slice(0, 3),
    [picks, nodeId],
  )
  const who = name || 'this band'
  return (
    <div className="grid gap-8 py-4 md:grid-cols-2">
      <section aria-label={`Photographs of ${who}`}>
        <h2 className="text-[13px] text-ink-dim">Photographs</h2>
        {theirs.length ? (
          <ul className="mt-3 grid grid-cols-2 gap-3">
            {theirs.map((photo) => <BandPhoto key={photo.id} photo={photo} />)}
          </ul>
        ) : (
          <p className="mt-2 text-[14px] text-ink-dim">No photograph includes {who} yet.</p>
        )}
      </section>
      <section aria-label={`Merch for ${who}`}>
        <h2 className="text-[13px] text-ink-dim">Merch</h2>
        {merch.length ? (
          <ul className="mt-3 grid gap-3">
            {merch.map((pick) => (
              <li key={pick.key} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3">
                <MerchThumb kind={pick.kind} title={pick.title} imageUrl={pick.imageUrl} photoUrl={pick.photoUrl} area={pick.area} decorative />
                <div className="min-w-0">
                  <p className="truncate text-[14px] text-ink">{pick.title || 'Piece'} <span className="tabular-nums text-ink-dim">{pick.priceCents ? formatCents(pick.priceCents) : ''}</span></p>
                  <p className="mt-1 line-clamp-2 text-[13px] text-ink-dim">{pick.reason || pick.line || 'Printed with a photograph of them.'}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[14px] text-ink-dim">No piece has been picked for {who} yet.</p>
        )}
      </section>
    </div>
  )
}

function BandPhoto({ photo }: { photo: Photo }) {
  const line = [photo.caption || photo.people[0] || 'Untitled', photo.zoneName, when(photo.takenAt)].filter(Boolean).join(' · ')
  return (
    <li>
      <span className="block aspect-[4/5] overflow-hidden bg-raised">
        {photo.url && <img src={photo.url} alt={photo.caption || 'Event photograph'} className="h-full w-full object-cover" />}
      </span>
      <span className="mt-1.5 block truncate text-[13px] text-ink-dim">{line}</span>
    </li>
  )
}

/** Every wristband the database is hearing, with the person who claimed it when we know them. */
export function BandsPage() {
  const bands = useCatalog((s) => s.bands)
  const attendees = useCatalog((s) => s.attendees)
  const zones = useCatalog((s) => s.zones)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const wearer = useMemo(() => {
    const names = new Map<number, { name: string; nodeId: string }>()
    for (const person of attendees) {
      if (person.bandId > 0) names.set(person.bandId, { name: person.displayName, nodeId: person.nodeId })
    }
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
        const name = wearer.get(band.id)?.name ?? ''
        return `${band.id} ${bandCode(band.id)} ${name} ${zoneName.get(band.zone) ?? ''}`.toLowerCase().includes(q)
      })
      .sort((a, b) => Number(b.sos || b.fall) - Number(a.sos || a.fall) || Number(b.online) - Number(a.online) || a.id - b.id)
  }, [bands, filter, query, wearer, zoneName])

  return (
    <DeskFrame
      motif="bands"
      figures={
        <>
          <Figure lead label="Online" value={online.toLocaleString('en-US')} note={`of ${bands.length.toLocaleString('en-US')}`} />
          <Figure label="Alerts" value={String(alerts)} note="SOS or fall" />
          <Figure label="Named" value={String([...wearer.values()].filter((person) => person.name).length)} note="matched to an attendee" />
          <Figure label="Offline" value={(bands.length - online).toLocaleString('en-US')} note="not currently online" />
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
      <ul className="mt-6">
        {shown.slice(0, 400).map((band) => {
          const person = wearer.get(band.id)
          const open = openId === band.id
          return (
            <li key={band.id}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : band.id)}
                className="desk-row grid w-full grid-cols-[7rem_minmax(0,1fr)_minmax(0,8rem)_5.5rem] items-baseline gap-3 text-left"
              >
                <span className="font-mono text-[13px] text-ink">{bandCode(band.id)}</span>
                <span className="min-w-0 truncate text-[14px] text-ink">{person?.name || 'Unclaimed'}</span>
                <span className="truncate text-[13px] text-ink-dim">{zoneName.get(band.zone) || (band.zone ? `Station ${band.zone}` : 'No zone')}</span>
                <span className={band.sos || band.fall ? 'text-[13px] text-signal' : band.online ? 'text-[13px] text-teal' : 'text-[13px] text-ink-muted'}>
                  {band.fall ? 'Fall' : band.sos ? 'SOS' : band.online ? 'Online' : 'Offline'}
                </span>
              </button>
              {open && (
                <div className="mx-3 mb-2 rounded-[20px] bg-raised px-4">
                  {person?.nodeId
                    ? <BandNight nodeId={person.nodeId} name={person.name} />
                    : <p className="py-4 text-[14px] text-ink-dim">No one has claimed this band, so there are no photographs or merch for it.</p>}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {shown.length > 400 && <p className="mt-4 text-[13px] text-ink-muted">Showing the first 400 of {shown.length.toLocaleString('en-US')}. Narrow the list to see the rest.</p>}
      {shown.length === 0 && <p className="mt-6 text-[15px] text-ink-dim">{bands.length === 0 ? 'No band data yet.' : 'Nothing matches.'}</p>}
      {shown.some((band) => band.lastSeen) && <p className="mt-6 text-[13px] text-ink-muted">Last heard {when(Math.max(...shown.map((band) => band.lastSeen)))}.</p>}
    </DeskFrame>
  )
}
