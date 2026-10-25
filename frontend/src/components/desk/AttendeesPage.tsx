import { useMemo, useState } from 'react'
import { useCatalog } from '@/stdb/catalog'
import { leaveEarly, releaseBand, useSession } from '@/stdb/session'
import { DeskFrame, Figure, when } from './DeskFrame'

/** The host's attendee list: who claimed a band, where they work, and whether the band can go back. */
export function AttendeesPage() {
  const attendees = useCatalog((s) => s.attendees)
  const guests = useCatalog((s) => s.guests)
  const departures = useCatalog((s) => s.departures)
  const eventEnded = useCatalog((s) => s.eventEnded)
  const staff = useSession((s) => s.staff)
  const owner = useSession((s) => s.owner)
  const roles = useSession((s) => s.roles)
  const actionError = useSession((s) => s.actionError)
  const ops = owner || roles.includes('ops')
  const [query, setQuery] = useState('')
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [leavingId, setLeavingId] = useState<string | null>(null)
  const left = useMemo(() => new Map(departures.map((row) => [row.nodeId, row])), [departures])
  const people = useMemo(() => attendees.filter((person) => !person.simulated), [attendees])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = [...attendees].sort((a, b) => Number(a.simulated) - Number(b.simulated) || a.displayName.localeCompare(b.displayName))
    if (!q) return rows
    return rows.filter((person) => `${person.displayName} ${person.organization} ${person.bandId}`.toLowerCase().includes(q))
  }, [attendees, query])
  const imported = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = [...guests].sort((a, b) => a.displayName.localeCompare(b.displayName))
    if (!q) return rows
    return rows.filter((person) => `${person.displayName} ${person.organization} ${person.title} ${person.role}`.toLowerCase().includes(q))
  }, [guests, query])
  return (
    <DeskFrame
      motif="attendees"
      figures={
        <>
          <Figure lead label="Joined" value={people.length.toLocaleString('en-US')} note="claimed a place" />
          <Figure label="Imported" value={guests.length.toLocaleString('en-US')} note="from the event list" />
          <Figure label="With a band" value={attendees.filter((person) => person.bandId > 0).length.toLocaleString('en-US')} note="wearing one now" />
          <Figure label="Findable" value={attendees.filter((person) => person.findable).length.toLocaleString('en-US')} note="allowed others to find them" />
        </>
      }
    >
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Name, company, or band"
        aria-label="Find an attendee"
        className="w-full max-w-sm border-b border-line bg-transparent py-1 text-[14px] text-ink outline-none placeholder:text-ink-muted"
      />
      {actionError && <p className="mt-4 text-[14px] text-signal">{actionError}</p>}
      <ul className="mt-6 divide-y divide-line">
        {shown.map((person) => (
          <li key={person.nodeId || `${person.bandId}-${person.displayName}`} className="desk-row grid gap-2 py-3 md:grid-cols-[minmax(0,1.4fr)_6rem_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-baseline">
            <div className="min-w-0">
              <p className="truncate text-[15px] text-ink">{person.displayName || 'No name yet'}</p>
              <p className="mt-1 truncate text-[13px] text-ink-dim">
                {person.organization || 'No company'}
                {person.simulated ? ' · test' : ''}
                {person.handles.length ? ` · ${person.handles.map((item) => item.handle).join(', ')}` : ''}
              </p>
            </div>
            <p className="font-mono text-[13px] text-ink">{person.bandId > 0 ? person.bandId : '—'}</p>
            <p className="text-[13px] text-ink-dim">{left.get(person.nodeId)?.leftAt ? `Left${left.get(person.nodeId)?.door ? ` by ${left.get(person.nodeId)?.door}` : ''}` : left.get(person.nodeId) ? 'Walking out' : person.findable ? 'Findable' : 'Not findable'}</p>
            <p className="text-[13px] text-ink-muted">{when(person.createdAt)}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
            {ops && person.nodeId && !eventEnded && !left.has(person.nodeId) && (
              leavingId === person.nodeId ? (
                <>
                  <button type="button" className="text-ink hover:text-champagne" onClick={() => void leaveEarly(person.nodeId).then(() => setLeavingId(null)).catch(() => setLeavingId(null))}>
                    Send them home
                  </button>
                  <button type="button" className="text-ink-muted hover:text-ink" onClick={() => setLeavingId(null)}>
                    Stay
                  </button>
                </>
              ) : (
                <button type="button" className="text-ink-dim hover:text-ink" onClick={() => setLeavingId(person.nodeId)}>
                  Leave early
                </button>
              )
            )}
            {staff && person.bandId > 0 && (
              confirmId === person.bandId ? (
                <>
                  <button type="button" className="text-ink hover:text-champagne" onClick={() => void releaseBand(person.bandId).then(() => setConfirmId(null))}>
                    Take it back
                  </button>
                  <button type="button" className="text-ink-muted hover:text-ink" onClick={() => setConfirmId(null)}>
                    Leave it
                  </button>
                </>
              ) : (
                <button type="button" className="text-ink-dim hover:text-ink" onClick={() => setConfirmId(person.bandId)}>
                  Take the band back
                </button>
              )
            )}
            </div>
          </li>
        ))}
      </ul>
      {shown.length === 0 && query && <p className="mt-6 text-[15px] text-ink-dim">No one who joined matches.</p>}
      {imported.length > 0 && (
        <section className="mt-12">
          <h2 className="text-[13px] text-ink-dim">Imported</h2>
          <ul className="mt-3 divide-y divide-line">
            {imported.slice(0, 400).map((person) => (
              <li key={person.id} className="desk-row grid gap-1 py-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-baseline">
                <p className="truncate text-[15px] text-ink">{person.displayName || 'No name yet'}</p>
                <p className="truncate text-[13px] text-ink-dim">{person.title || person.role || 'No title'}</p>
                <p className="truncate text-[13px] text-ink-muted">{person.organization || 'No company'}</p>
              </li>
            ))}
          </ul>
          {imported.length > 400 && <p className="mt-4 text-[13px] text-ink-muted">Showing the first 400 of {imported.length.toLocaleString('en-US')}.</p>}
        </section>
      )}
    </DeskFrame>
  )
}
