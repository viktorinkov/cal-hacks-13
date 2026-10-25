import { useLayoutEffect, useRef, useState } from 'react'
import { Identity } from 'spacetimedb'
import { useDesk, type ViewablePerson } from '@/stdb/deskOps'
import { linkReducers } from '@/stdb/link'
import { useSession } from '@/stdb/session'
import { isViewing, type ViewerHost } from '@/stdb/viewing'
import { DeskFrame } from './DeskFrame'
import { ViewedScreen } from './ViewedScreen'

export function personScreens(person: ViewablePerson): [string, string][] {
  if (person.role === 'attendee') return [['now', 'Their band page now'], ['card', 'Medical card'], ['recap', 'Recap'], ['wallet', 'Wallet and merch']]
  if (person.role === 'photographer') return [['photo', 'Photo page']]
  return [['claims', 'Organizer portal']]
}

export function personViewUrl(person: ViewablePerson, screen: string): string {
  const query = new URLSearchParams({ view: person.hex, screen, bandId: String(person.bandId) })
  if (person.bandId) query.set('band', `band-${String(person.bandId).padStart(2, '0')}`)
  return `/view-as?${query}`
}

type ViewReducers = { viewAs(args: { viewer: Identity; target: Identity }): Promise<unknown> }

function OwnerView() {
  const owner = useSession((s) => s.owner)
  const people = useDesk((s) => s.people)
  const [query, setQuery] = useState('')
  const [key, setKey] = useState('')
  const [screen, setScreen] = useState('')
  const frame = useRef<HTMLIFrameElement>(null)
  const viewed = people.find((person) => person.key === key)
  const target = viewed?.hex ?? ''
  const needle = query.trim().toLowerCase()
  const matches = people.filter((person) => !needle || `${person.name} ${person.role} ${person.bandId}`.toLowerCase().includes(needle)).slice(0, 12)

  useLayoutEffect(() => {
    const host = window as ViewerHost
    const authorize = async (viewer: string, person: string, source: Window) => {
      if (!useSession.getState().owner || !target || person !== target || source !== frame.current?.contentWindow) throw new Error('This viewing request is no longer selected by the owner.')
      if (!/^[0-9a-f]{64}$/i.test(viewer)) throw new Error('The viewer identity is invalid.')
      await linkReducers<ViewReducers>().viewAs({ viewer: Identity.fromString(viewer), target: Identity.fromString(target) })
    }
    if (owner) host.banditAuthorizeViewer = authorize
    return () => { if (host.banditAuthorizeViewer === authorize) delete host.banditAuthorizeViewer }
  }, [owner, target, screen])

  return <DeskFrame motif="viewas" title="View as" sentence="See a person’s pages with their live data. The view is read-only.">
    {!owner ? <p className="text-[15px] text-ink">Only the owner can view the event as someone else.</p> : <>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, role, or band" aria-label="Find a person" className="w-full max-w-sm border-b border-line bg-transparent py-1 text-[14px] text-ink outline-none placeholder:text-ink-muted" />
      <ul className="mt-3 flex max-w-lg flex-col" aria-label="People">
        {matches.map((person) => <li key={person.key}><button type="button" onClick={() => { setKey(person.key); setScreen(personScreens(person)[0][0]) }} className="flex w-full items-baseline justify-between gap-4 py-2 text-left text-[14px] hover:text-champagne">
          <span className="text-ink">{person.name || 'No name yet'}</span><span className="text-[13px] text-ink-dim">{`${person.role}${person.bandId ? ` · band ${person.bandId}` : ''}${person.crowd ? ' · crowd' : ''}`}</span>
        </button></li>)}
      </ul>
      {viewed && <section className="mt-8 border-t border-line pt-6">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2"><h2 className="text-[18px] font-semibold text-ink">{viewed.name || 'No name yet'}</h2>
          {personScreens(viewed).map(([id, label]) => <button key={id} type="button" onClick={() => setScreen(id)} className={screen === id ? 'text-[13px] text-ink' : 'text-[13px] text-ink-muted hover:text-ink'}>{label}</button>)}
          <button type="button" className="text-[13px] text-ink-dim hover:text-ink" onClick={() => { setKey(''); setScreen('') }}>Hide their page</button>
        </div>
        {viewed.role === 'attendee' && !viewed.bandId && screen === 'now' ? <p className="mt-5 text-[15px]">They wear no band right now.</p> : <iframe key={`${key}:${screen}`} ref={frame} title={`${viewed.name || 'Their'} — ${personScreens(viewed).find(([id]) => id === screen)?.[1] ?? 'page'}`} src={personViewUrl(viewed, screen)} className="mt-5 h-[800px] w-full border border-line bg-ground" />}
      </section>}
    </>}
  </DeskFrame>
}

export function ViewAsPage() { return isViewing() ? <ViewedScreen /> : <OwnerView /> }
