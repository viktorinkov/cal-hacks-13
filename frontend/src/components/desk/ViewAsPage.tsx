import { useState } from 'react'
import { hideView, viewAsPerson, useDesk, type ViewablePerson } from '@/stdb/deskOps'
import { useSession } from '@/stdb/session'
import { DeskFrame } from './DeskFrame'

function screens(person: ViewablePerson): [string, string][] {
  if (person.role === 'attendee') return [['now', 'Their band page now'], ['card', 'Medical card'], ['recap', 'Recap and merch']]
  if (person.role === 'photographer') return [['now', 'Photo page']]
  return [['claims', 'Organizer portal']]
}

function Frame({ person, screen }: { person: ViewablePerson; screen: string }) {
  const night = useDesk((s) => s.viewerNight)
  if (person.role === 'attendee' && person.bandId === 0) {
    return <p className="text-[15px] text-ink">{`${person.name || 'They'} wear no band right now, so there is no band page to show.`}</p>
  }
  if (screen === 'recap' || (person.role === 'attendee' && screen === 'now')) {
    return (
      <div className="pointer-events-none flex flex-col gap-6" aria-label="Their page">
        <section>
          <h3 className="text-[15px] font-semibold text-ink">Where they were</h3>
          {night.visits.length === 0 ? <p className="mt-2 text-[14px] text-ink-dim">No visits yet.</p> : (
            <ul className="mt-2 flex flex-col gap-1 text-[14px] text-ink">
              {night.visits.map((visit) => (
                <li key={visit.id}>{`${visit.zoneName || 'A zone'}${visit.booths.length ? ` · ${visit.booths.join(', ')}` : ''} · ${Math.round(visit.minutes)} min`}</li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3 className="text-[15px] font-semibold text-ink">People they spent time with</h3>
          {night.encounters.length === 0 ? <p className="mt-2 text-[14px] text-ink-dim">No encounters yet.</p> : (
            <ul className="mt-2 flex flex-col gap-1 text-[14px] text-ink">
              {night.encounters.map((encounter) => (
                <li key={encounter.id}>{`${encounter.person.name} · ${encounter.zoneName} · ${Math.round(encounter.minutes)} min`}</li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h3 className="text-[15px] font-semibold text-ink">Photos</h3>
          {night.photos.length === 0 ? <p className="mt-2 text-[14px] text-ink-dim">No photos yet.</p> : (
            <ul className="mt-2 flex flex-col gap-2">
              {night.photos.map((photo) => (
                <li key={photo.id} className="text-[14px] text-ink">
                  {photo.caption || 'Event photo'}
                  {photo.people.length ? ` · ${photo.people.map((person) => person.name).join(', ')}` : ''}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    )
  }
  if (screen === 'card') {
    return <p className="text-[15px] text-ink">{`${person.name || 'They'} carry band ${person.bandId || 'none'}. A medic reads the medical card from the incident on the map.`}</p>
  }
  if (person.role === 'photographer') {
    return <p className="text-[15px] text-ink">{`${person.name || 'This photographer'} files frames on the photo page.`}</p>
  }
  return <p className="text-[15px] text-ink">{`${person.name || 'This person'} sees the organizer portal as ${person.role === 'medic' ? 'a medic' : 'an organizer'}.`}</p>
}

/** Owner-only. A fresh identity is pointed at the person, and their pages are read-only. */
export function ViewAsPage() {
  const owner = useSession((s) => s.owner)
  const people = useDesk((s) => s.people)
  const viewedKey = useDesk((s) => s.viewedKey)
  const error = useDesk((s) => s.error)
  const busy = useDesk((s) => s.busy)
  const [query, setQuery] = useState('')
  const [screen, setScreen] = useState('')
  const needle = query.trim().toLowerCase()
  const matches = people.filter((person) => !needle || `${person.name} ${person.role} ${person.bandId}`.toLowerCase().includes(needle)).slice(0, 12)
  const viewed = people.find((person) => person.key === viewedKey)

  const pick = (person: ViewablePerson) => {
    const next = screens(person)[0]?.[0] ?? ''
    setScreen(next)
    void viewAsPerson(person).catch(() => setScreen(''))
  }

  return (
    <DeskFrame motif="viewas" title="View as" sentence="See the pages a person sees, live with their data. Nothing on their page can be pressed.">
      {!owner ? (
        <p className="text-[15px] text-ink">Only the owner can view the event as someone else.</p>
      ) : (
        <>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, role, or band"
            aria-label="Find a person"
            className="w-full max-w-sm border-b border-line bg-transparent py-1 text-[14px] text-ink outline-none placeholder:text-ink-muted"
          />
          <ul className="mt-3 flex max-w-lg flex-col" aria-label="People">
            {matches.map((person) => (
              <li key={person.key}>
                <button type="button" onClick={() => pick(person)} className="flex w-full items-baseline justify-between gap-4 py-2 text-left text-[14px] hover:text-champagne">
                  <span className="text-ink">{person.name || 'No name yet'}</span>
                  <span className="text-[13px] text-ink-dim">{`${person.role}${person.bandId ? ` · band ${person.bandId}` : ''}${person.crowd ? ' · crowd' : ''}`}</span>
                </button>
              </li>
            ))}
          </ul>
          {error && <p className="mt-4 text-[14px] text-signal">{error}</p>}
          {viewed && (
            <section className="mt-8 border-t border-line pt-6">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
                <h2 className="text-[18px] font-semibold text-ink">{viewed.name || 'No name yet'}</h2>
                {screens(viewed).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setScreen(id)} className={screen === id ? 'text-[13px] text-ink' : 'text-[13px] text-ink-muted hover:text-ink'}>
                    {label}
                  </button>
                ))}
                <button type="button" className="text-[13px] text-ink-dim hover:text-ink" onClick={() => { hideView(); setScreen('') }}>Hide their page</button>
              </div>
              <div className="mt-5" aria-busy={busy}>
                {screen && <Frame person={viewed} screen={screen} />}
              </div>
            </section>
          )}
        </>
      )}
    </DeskFrame>
  )
}
