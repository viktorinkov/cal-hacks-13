import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useRoute } from '@/cover/route'
import {
  loadRecap, searchFriends,
  type FriendHit, type FriendSearch, type RankedBooth, type RankedNear, type RankedPerson, type RankedRecap,
} from '@/recap/api'
import {
  howYouMet, mins, placeWords, shareCaption, socialLink, whyLine,
  type Interest,
} from '@/recap/copy'
import {
  boothsFromVisits, clock, metUntil, nearFromShared, nightClose, peopleFromEncounters, staysUntil,
  type FallbackBooth, type FallbackNear, type FallbackPerson, type Handle, type MetDot, type RecapPhoto, type Stay,
} from '@/recap/night'
import { attendeeApiSession, useSession } from '@/stdb/session'
import './Recap.css'

type Load = typeof loadRecap
type Search = typeof searchFriends
type SessionToken = typeof attendeeApiSession

function Face({ name, photoUrl }: { name: string; photoUrl: string }) {
  if (photoUrl) return <img src={photoUrl} alt="" className="recap-face" />
  return <span className="recap-face recap-initial" aria-hidden="true">{(name.slice(0, 1) || '?').toUpperCase()}</span>
}

function Socials({ handles }: { handles: Handle[] }) {
  if (!handles.length) return <span className="text-[13px] text-[var(--signup-muted)]">No socials shared</span>
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {handles.map((item) => {
        const link = socialLink(item.platform, item.handle)
        return link.href ? (
          <a key={`${item.platform}:${item.handle}`} href={link.href} target="_blank" rel="noreferrer" className="text-[13px] text-champagne underline-offset-4 hover:underline">{link.label}</a>
        ) : (
          <span key={`${item.platform}:${item.handle}`} className="text-[13px] text-ink-dim">{link.label}</span>
        )
      })}
    </span>
  )
}

function Interests({ interests, name }: { interests: Interest[]; name: string }) {
  if (!interests.length) return null
  return (
    <ul className="recap-interests" aria-label={`Booths ${name} stood at`}>
      <li className="text-[12px] text-[var(--signup-muted)]" aria-hidden="true">
        <span>Booth</span><span>{name.split(' ')[0]}</span><span>You</span>
      </li>
      {interests.map((item) => (
        <li key={item.name} className={item.shared ? 'is-shared' : undefined}>
          <span className="min-w-0 truncate">{item.name}</span>
          <span className="tabular-nums">{mins(item.minutes)}</span>
          <span className="tabular-nums">{item.yourMinutes > 0 ? mins(item.yourMinutes) : ''}</span>
        </li>
      ))}
    </ul>
  )
}

function Where({ stays, met, close }: { stays: Stay[]; met: MetDot[]; close: number }) {
  const zones = [...new Set([...stays.map((stay) => stay.zoneName), ...met.map((dot) => dot.zoneName)].filter(Boolean))]
  if (!stays.length || !zones.length) return null
  const t0 = Math.min(...stays.map((stay) => stay.start), ...(met.length ? met.map((dot) => dot.at) : stays.map((stay) => stay.start)))
  const t1 = Math.max(...stays.map((stay) => stay.end), ...(met.length ? met.map((dot) => Math.min(close, dot.at)) : [t0 + 1]))
  const width = 640
  const left = 8
  const right = 8
  const row = 46
  const height = zones.length * row + 28
  const x = (t: number) => left + ((t - t0) / Math.max(1, t1 - t0)) * (width - left - right)
  return (
    <>
      <svg viewBox={`0 0 ${width} ${height}`} className="recap-chart" role="img" aria-label="Where your band was, and when you met someone">
        {zones.map((zone, index) => (
          <g key={zone}>
            <text x={left} y={index * row + 14}>{zone}</text>
            <line x1={left} x2={width - right} y1={index * row + 31} y2={index * row + 31} className="grid" />
          </g>
        ))}
        {stays.map((stay) => {
          const y = Math.max(0, zones.indexOf(stay.zoneName)) * row + 20
          const start = x(stay.start)
          const end = x(stay.end)
          return <rect key={`${stay.zoneName}-${stay.start}`} x={start} y={y} width={Math.max(3, end - start)} height={22} rx={4} className="stay"><title>{`${stay.zoneName}: ${clock(stay.start)} to ${clock(stay.end)}`}</title></rect>
        })}
        {met.map((dot) => {
          const index = Math.max(0, zones.indexOf(dot.zoneName))
          return <circle key={`${dot.name}-${dot.at}`} cx={x(dot.at)} cy={index * row + 31} r={6} className="met"><title>{`Met ${dot.name} at ${clock(dot.at)}`}</title></circle>
        })}
        <text x={left} y={height - 6} className="tick">{clock(t0)}</text>
        <text x={width - right} y={height - 6} textAnchor="end" className="tick">{clock(t1)}</text>
      </svg>
      <p className="wallet-note">Bars are where your band was. Dots are when you met someone.</p>
      <ul className="mt-2">
        {stays.map((stay) => (
          <li key={`${stay.zoneName}-${stay.start}`} className="wallet-row text-[14px] text-ink">
            <span className="tabular-nums">{clock(stay.start)} to {clock(stay.end)}</span>
            {' '}<span className="font-medium">{stay.zoneName || 'Somewhere in the venue'}</span>
            <span className="text-[var(--signup-muted)]"> · {mins((stay.end - stay.start) / 60000)}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

function PersonRow({ name, photoUrl, reason, detail, handles, children }: {
  name: string
  photoUrl: string
  reason: string | null
  detail: string
  handles: Handle[]
  children?: ReactNode
}) {
  return (
    <li className="wallet-row">
      <div className="recap-person">
        <Face name={name} photoUrl={photoUrl} />
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-ink">{name}</p>
          {reason && <p className="mt-1 text-[14px] leading-6 text-ink-dim">{reason}</p>}
          {detail && <p className="mt-1 text-[13px] leading-5 text-[var(--signup-muted)]">{detail}</p>}
          {children}
          <div className="mt-2"><Socials handles={handles} /></div>
        </div>
      </div>
    </li>
  )
}

function RankedPeople({ people }: { people: RankedPerson[] }) {
  return (
    <ul>
      {people.map((person) => {
        const place = person.metZone ? `You spent ${mins(person.minutes)} together at ${person.metZone}` : false
        const reason = whyLine(person, false, place)
        const said = Boolean(place) && reason === place
        return (
          <PersonRow key={person.nodeId || person.name} name={person.name} photoUrl={person.photoUrl} reason={reason} detail={howYouMet(person, said)} handles={person.handles}>
            <Interests interests={person.interests} name={person.name} />
          </PersonRow>
        )
      })}
    </ul>
  )
}

function RecordedPeople({ people }: { people: FallbackPerson[] }) {
  return (
    <ul>
      {people.map((person) => {
        const place = person.zoneName ? `You spent ${mins(person.minutes)} together at ${person.zoneName}` : false
        return (
          <PersonRow
            key={person.nodeId || person.name}
            name={person.name}
            photoUrl={person.photoUrl}
            reason={place || null}
            detail={howYouMet({ minutes: person.minutes, metAt: person.metAt, metZone: person.zoneName, interests: [], photosTogether: 0 }, Boolean(place))}
            handles={person.handles}
          />
        )
      })}
    </ul>
  )
}

function RankedNearList({ people }: { people: RankedNear[] }) {
  return (
    <ul>
      {people.map((person) => {
        const first = person.places[0]
        const place = first ? `You were both at ${placeWords(first.zoneName, first.startedAt, first.minutes)} but never met` : false
        const reason = whyLine(person, true, place)
        const shared = person.interests.filter((item) => item.shared).length
        const rest = person.places.slice(reason === place ? 1 : 0).map((item) => `At ${placeWords(item.zoneName, item.startedAt, item.minutes)}`)
        const facts = [...rest, shared > 0 ? `${shared} shared interest${shared > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')
        const into = person.interests.slice(0, 5)
        return (
          <PersonRow key={person.nodeId || person.name} name={person.name} photoUrl={person.photoUrl} reason={reason} detail={facts} handles={person.handles}>
            {into.length > 0 && (
              <p className="mt-2 text-[13px] leading-5 text-ink-dim">
                Into: {into.map((item, index) => (
                  <span key={item.name}>{index > 0 && ', '}{item.shared ? <strong>{item.name} {mins(item.minutes)}</strong> : `${item.name} ${mins(item.minutes)}`}</span>
                ))}
              </p>
            )}
          </PersonRow>
        )
      })}
    </ul>
  )
}

function RecordedNear({ people }: { people: FallbackNear[] }) {
  return (
    <ul>
      {people.map((person) => {
        const first = person.places[0]
        const place = first ? `You were both at ${placeWords(first.zoneName, first.startedAt, first.minutes)} but never met` : null
        const more = person.places.slice(1).map((item) => `At ${placeWords(item.zoneName, item.startedAt, item.minutes)}`).join(' · ')
        return (
          <PersonRow key={person.nodeId || person.name} name={person.name} photoUrl={person.photoUrl} reason={place} detail={more} handles={person.handles}>
            {person.booths.length > 0 && <p className="mt-2 text-[13px] leading-5 text-ink-dim">Into: {person.booths.slice(0, 5).join(', ')}</p>}
          </PersonRow>
        )
      })}
    </ul>
  )
}

function BoothList({ booths }: { booths: { name: string; zoneName: string; minutes: number }[] }) {
  return (
    <ul>
      {booths.map((booth) => (
        <li key={booth.name} className="wallet-row text-[15px] text-ink">
          <span className="font-medium">{booth.name}</span>
          {booth.zoneName && <span className="text-[var(--signup-muted)]"> · {booth.zoneName}</span>}
          {booth.minutes > 0 && <span className="text-[var(--signup-muted)]"> · {mins(booth.minutes)}</span>}
        </li>
      ))}
    </ul>
  )
}

function noteFor(ready: boolean, error: string | undefined, loading: string, empty: string): string | null {
  if (error) return `This can’t load right now. ${error}`
  if (!ready) return loading
  return empty
}

function Photos({ photos, event }: { photos: RecapPhoto[]; event: string }) {
  const [copied, setCopied] = useState('')
  const share = async (photo: RecapPhoto) => {
    const tags = photo.people.flatMap((person) => person.handles.filter((item) => item.platform === 'instagram').map((item) => `@${item.handle.replace(/^@/, '')}`))
    const text = shareCaption(photo.caption, event, tags)
    try {
      const blob = await (await fetch(photo.url)).blob()
      const file = new File([blob], `bandit-photo-${photo.id || 'frame'}.jpg`, { type: blob.type || 'image/jpeg' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text })
        return
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopied(photo.id)
    } catch {
      setCopied('')
    }
  }
  return (
    <ul className="wallet-photos">
      {photos.map((photo) => (
        <li key={photo.id || photo.url} className="recap-photo">
          <figure>
            {photo.url && <img src={photo.url} alt={photo.caption || 'A photograph of you'} />}
            <figcaption className="text-[14px] text-ink">
              <span className="block font-medium">{photo.caption || photo.zoneName || 'Untitled'}</span>
              <span className="mt-1 block text-[13px] text-[var(--signup-muted)]">{[photo.zoneName, clock(photo.takenAt)].filter(Boolean).join(' · ')}</span>
              <span className="mt-2 block text-[13px] text-ink-dim">{photo.people.length ? 'You with:' : 'Just you'}</span>
              {photo.people.length > 0 && (
                <ul className="mt-1">
                  {photo.people.map((person) => (
                    <li key={person.nodeId || person.name} className="mt-1">
                      <span className="text-ink">{person.name}</span>{' '}
                      <Socials handles={person.handles} />
                    </li>
                  ))}
                </ul>
              )}
              {photo.url && (
                <button type="button" onClick={() => void share(photo)} className="mt-2 min-h-11 text-[14px] text-champagne underline-offset-4 hover:underline">
                  {copied === photo.id ? 'Caption copied' : 'Share'}
                </button>
              )}
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  )
}

function placeKind(kind: string): string {
  if (kind === 'encounter_zone') return 'First recorded encounter'
  if (kind === 'shared_booth') return 'Shared booth visit'
  return 'Shared area visit'
}

function FriendResults({ found }: { found: FriendSearch }) {
  return (
    <div>
      {!found.semanticRanked && <p className="wallet-note">Showing matches from recorded names and places. Broader matching is temporarily unavailable.</p>}
      {found.searchedCount < found.candidateCount && <p className="wallet-note">Add a place or name to narrow these matches.</p>}
      {found.people.length > 0 && (
        <ul>
          {found.people.map((person) => <FriendCard key={person.nodeId || person.name} person={person} />)}
        </ul>
      )}
    </div>
  )
}

function FriendCard({ person }: { person: FriendHit }) {
  return (
    <li className="wallet-row">
      <div className="recap-person">
        <Face name={person.name} photoUrl={person.photoUrl} />
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-ink">{person.name}</p>
          {person.reason && <p className="mt-1 text-[14px] leading-6 text-ink-dim">{person.reason}</p>}
          {person.minutes > 0 && <p className="mt-1 text-[13px] text-[var(--signup-muted)]">{mins(person.minutes)} together across your recorded encounters</p>}
          {person.places.length > 0 && (
            <ul className="mt-2">
              {person.places.map((place) => (
                <li key={`${place.kind}-${place.name}-${place.startedAt}`} className="text-[13px] leading-5 text-ink-dim">
                  {placeKind(place.kind)}: {place.name}
                  {place.startedAt > 0 && ` · ${clock(place.startedAt)}`}
                  {place.kind !== 'encounter_zone' && place.minutes > 0 && ` · ${mins(place.minutes)} overlap`}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2"><Socials handles={person.handles} /></div>
        </div>
      </div>
    </li>
  )
}

function FindSomeone({ enabled, known, session, search }: { enabled: boolean; known: boolean; session: SessionToken; search: Search }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<FriendSearch | null>(null)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const text = query.trim()
    if (!text || !enabled) return
    setBusy(true)
    setStatus('Searching your recorded connections…')
    setFound(null)
    try {
      const token = await session()
      const next = await search(token, text)
      setFound(next)
      setStatus(next.people.length
        ? `Closest recorded connections for “${next.query}” (${next.people.length}).`
        : `No recorded connections matched “${next.query}”. Try a name or a place you remember.`)
    } catch {
      setStatus('Search could not finish. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-labelledby="recap-find" className="wallet-section">
      <h2 id="recap-find">Find someone you met</h2>
      <p className="text-[13px] text-[var(--signup-muted)]">Search your recorded connections by name and place.</p>
      {!known && <p className="wallet-note">No connections are recorded for you yet. They appear here after your band records time with someone.</p>}
      <form role="search" aria-label="Find someone you met" onSubmit={(event) => void submit(event)} className="recap-search">
        <label className="sr-only" htmlFor="recap-friend-query">What do you remember?</label>
        <input id="recap-friend-query" type="search" value={query} maxLength={500} required disabled={!enabled || busy} placeholder="The person I met at the Meta booth" onChange={(event) => setQuery(event.target.value)} className="signup-input" />
        <button type="submit" disabled={!enabled || busy} className="wallet-primary">{busy ? 'Searching…' : 'Search'}</button>
        <button type="button" className="min-h-11 px-2 text-[14px] text-ink-dim" onClick={() => { setQuery(''); setStatus(''); setFound(null) }}>Clear</button>
      </form>
      {status && <p role="status" className="wallet-note">{status}</p>}
      {found && <FriendResults found={found} />}
    </section>
  )
}

function useRanked(over: boolean, key: string, session: SessionToken, load: Load) {
  const [ranked, setRanked] = useState<RankedRecap | null>(null)
  const [note, setNote] = useState('')
  useEffect(() => {
    if (!over) return
    let cancelled = false
    let timer = 0
    const run = () => {
      session()
        .then((token) => load(token))
        .then((next) => {
          if (cancelled) return
          setRanked(next)
          setNote(next.ranked ? '' : 'Ordered by the time you spent. Broader matching is temporarily unavailable.')
        })
        .catch(() => {
          if (cancelled) return
          setNote('The ranking didn’t answer. This is the night your band recorded.')
          if (import.meta.env.MODE !== 'test') timer = window.setTimeout(run, 5000)
        })
    }
    run()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [over, key, session, load])
  return { ranked, note }
}

/** The page a band opens once the night is over: where you were, who you spent it with, and the frames you are in. */
export function Recap({
  showWalletLink = false,
  session = attendeeApiSession,
  load = loadRecap,
  search = searchFriends,
}: {
  showWalletLink?: boolean
  session?: SessionToken
  load?: Load
  search?: Search
}) {
  const { go } = useRoute()
  const eventName = useSession((s) => s.eventName)
  const eventEndedAt = useSession((s) => s.eventEndedAt)
  const visits = useSession((s) => s.visits)
  const encounters = useSession((s) => s.encounters)
  const handles = useSession((s) => s.handles)
  const sharedVisits = useSession((s) => s.sharedVisits)
  const photos = useSession((s) => s.recapPhotos)
  const departure = useSession((s) => s.departure)
  const visitsReady = useSession((s) => s.visitsReady)
  const encountersReady = useSession((s) => s.encountersReady)
  const sharedReady = useSession((s) => s.sharedVisitsReady)
  const photosReady = useSession((s) => s.photosReady)
  const errors = useSession((s) => s.recapViewErrors)
  const walletErrors = useSession((s) => s.walletViewErrors)
  const phase = useSession((s) => s.phase)
  const close = nightClose(eventEndedAt, departure?.leftAt)
  const { ranked, note } = useRanked(phase === 'live', String(departure?.leftAt ?? eventEndedAt ?? 0), session, load)
  const event = eventName || 'the night'
  const title = eventName ? `Your ${eventName}.` : 'Your night.'
  const thanks = ranked?.displayName || departure?.name
  const stays = useMemo(() => staysUntil(visits, close), [visits, close])
  const met = useMemo(() => metUntil(encounters, close), [encounters, close])
  const recordedPeople = useMemo(() => peopleFromEncounters(encounters, close), [encounters, close])
  const recordedNear = useMemo(() => nearFromShared(sharedVisits, new Set(recordedPeople.map((person) => person.nodeId || person.name)), close), [sharedVisits, recordedPeople, close])
  const recordedBooths = useMemo(() => boothsFromVisits(visits, close), [visits, close])
  const people = ranked ? ranked.people : recordedPeople
  const near = ranked ? ranked.alsoThere : recordedNear
  const booths: (RankedBooth | FallbackBooth)[] = ranked ? ranked.booths : recordedBooths
  const left = departure?.leftAt
    ? `You left at ${clock(departure.leftAt)}${departure.door ? ` by the ${departure.door}` : ''}.`
    : departure?.door
      ? `You’re walking out by the ${departure.door}.`
      : eventEndedAt
        ? `The night ended at ${clock(eventEndedAt)}.`
        : ''

  const peopleNote = ranked ? null : noteFor(encountersReady, errors.my_encounters, 'Looking up who you spent time with…', 'Nobody stayed close to you long enough to count.')
  const nearNote = ranked ? null : noteFor(sharedReady, errors.my_shared_visits, 'Looking up who else was there…', 'Nobody else was in the same place as you for long.')
  const boothNote = ranked ? null : noteFor(visitsReady, errors.my_visits, 'Looking up the booths…', 'No booth visits.')
  const whereNote = noteFor(visitsReady, errors.my_visits, 'Looking up where your band was…', 'No stays recorded for your band.')
  const photoNote = noteFor(photosReady, errors.my_photos || walletErrors.my_photos, 'Looking for photographs of you…', 'No photos of you yet.')

  return (
    <div className="recap">
      <div className="signup-intro">
        <h1 className="signup-title">{title}</h1>
        <p>Thanks for coming{thanks ? `, ${thanks}` : ''}. Here is your night.</p>
      </div>
      {left && <p className="mt-4 text-[15px] leading-6 text-ink-dim">{left}</p>}
      {handles.length > 0 && (
        <p className="mt-3 text-[14px] text-ink-dim">You shared <Socials handles={handles} /></p>
      )}
      {note && <p className="wallet-note">{note}</p>}

      <section aria-labelledby="recap-where" className="wallet-section mt-10">
        <h2 id="recap-where">Where you were</h2>
        {stays.length ? <Where stays={stays} met={met} close={close} /> : whereNote && <p className="wallet-note">{whereNote}</p>}
      </section>

      <FindSomeone enabled={phase === 'live'} known={encounters.length > 0 || (ranked?.people.length ?? 0) > 0} session={session} search={search} />

      <section aria-labelledby="recap-people" className="wallet-section">
        <h2 id="recap-people">People you spent time with</h2>
        {people.length ? (ranked ? <RankedPeople people={ranked.people} /> : <RecordedPeople people={recordedPeople} />) : <p className="wallet-note">{peopleNote ?? 'Nobody stayed close to you long enough to count.'}</p>}
      </section>

      <section aria-labelledby="recap-near" className="wallet-section">
        <h2 id="recap-near">Also there with you</h2>
        {near.length ? (ranked ? <RankedNearList people={ranked.alsoThere} /> : <RecordedNear people={recordedNear} />) : <p className="wallet-note">{nearNote ?? 'Nobody else was in the same place as you for long.'}</p>}
      </section>

      <section aria-labelledby="recap-booths" className="wallet-section">
        <h2 id="recap-booths">Booths you spent time at</h2>
        {booths.length ? <BoothList booths={booths} /> : <p className="wallet-note">{boothNote ?? 'No booth visits.'}</p>}
      </section>

      <section aria-labelledby="recap-photos" className="wallet-section">
        <h2 id="recap-photos">Your photos</h2>
        <p className="text-[13px] text-[var(--signup-muted)]">Frames you are in, and the socials of the people beside you.</p>
        {photos.length ? <Photos photos={photos} event={event} /> : photoNote && <p className="wallet-note">{photoNote}</p>}
      </section>

      {showWalletLink && (
        <p className="mt-8">
          <button type="button" onClick={() => go('/wallet')} className="wallet-primary">Open your wallet</button>
        </p>
      )}
    </div>
  )
}
