/**
 * The attendee's night, read from the views the tap page already has.
 * `event_state` says the host ended it. `my_departure.leftAt` says this band walked out.
 * Either one flips the band's page to the recap.
 */

import { idOf, millis, num, text } from '@/payments/rows'

export interface Handle {
  platform: string
  handle: string
}

export interface RecapPerson {
  nodeId: string
  name: string
  photoUrl: string
  handles: Handle[]
}

export interface RecapVisit {
  id: string
  zoneName: string
  booths: string[]
  startedAt: number
  endedAt: number | null
  minutes: number
}

export interface RecapEncounter {
  id: string
  zoneName: string
  startedAt: number
  lastSeenAt: number
  minutes: number
  person: RecapPerson
}

export interface RecapShared {
  id: string
  zoneName: string
  booths: string[]
  startedAt: number
  minutes: number
  person: RecapPerson
}

export interface RecapPhoto {
  id: string
  url: string
  takenAt: number
  zoneName: string
  caption: string
  people: RecapPerson[]
}

export interface RecapDeparture {
  name: string
  bandId: number
  door: string
  leftAt: number | null
}

export interface NightTables {
  eventEnded: boolean
  eventEndedAt: number | null
  eventName: string
  visits: RecapVisit[]
  encounters: RecapEncounter[]
  handles: Handle[]
  sharedVisits: RecapShared[]
  photos: RecapPhoto[]
  departure: RecapDeparture | null
}

export interface Stay {
  zoneName: string
  start: number
  end: number
}

type Row = Record<string, unknown>

function rowsOf(table: unknown): Row[] {
  if (!table || typeof table !== 'object' || !('iter' in table)) return []
  const iter = (table as { iter: unknown }).iter
  if (typeof iter !== 'function') return []
  return [...(iter.call(table) as Iterable<Row>)]
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => (typeof item === 'string' ? item : text((item as { name?: unknown })?.name))).filter(Boolean)
}

function handlesOf(value: unknown): Handle[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as { platform?: unknown; handle?: unknown }
    const platform = text(row.platform)
    const handle = text(row.handle)
    return platform || handle ? [{ platform, handle }] : []
  })
}

function personOf(value: unknown): RecapPerson | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Row
  const name = text(row.name)
  if (!name) return null
  return { nodeId: idOf(row.nodeId), name, photoUrl: text(row.photoUrl), handles: handlesOf(row.handles) }
}

export function nightIsOver(ended: boolean, leftAt: number | null | undefined): boolean {
  return ended || leftAt != null
}

/** The floor row and this band's departure have both answered, so the page can choose signup or the recap. */
export function nightKnown(eventReady: boolean, departureReady: boolean, departureError: string | undefined): boolean {
  return eventReady && (departureReady || Boolean(departureError))
}

/** When this band's night stops: they walked out, else the host ended it, else now. */
export function nightClose(endedAt: number | null, leftAt: number | null | undefined, now = Date.now()): number {
  if (leftAt != null) return leftAt
  if (endedAt != null) return endedAt
  return now
}

export function clock(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function readNight(db: Record<string, unknown>): NightTables {
  const event = rowsOf(db.eventState)[0]
  const venue = rowsOf(db.venue)[0]
  const left = rowsOf(db.myDeparture)[0]
  return {
    eventEnded: event?.ended === true,
    eventEndedAt: millis(event?.endedAt),
    eventName: text(venue?.name),
    visits: rowsOf(db.myVisits).map((row) => ({
      id: idOf(row.zoneVisitId),
      zoneName: text(row.zoneName),
      booths: strings(row.booths),
      startedAt: millis(row.startedAt) ?? 0,
      endedAt: millis(row.endedAt),
      minutes: num(row.minutes),
    })),
    encounters: rowsOf(db.myEncounters).flatMap((row) => {
      const person = personOf(row.person)
      if (!person) return []
      return [{
        id: idOf(row.id),
        zoneName: text(row.zoneName),
        startedAt: millis(row.startedAt) ?? 0,
        lastSeenAt: millis(row.lastSeenAt) ?? 0,
        minutes: num(row.minutes),
        person,
      }]
    }),
    handles: rowsOf(db.myHandles).flatMap((row) => {
      const platform = text(row.platform)
      const handle = text(row.handle)
      return platform || handle ? [{ platform, handle }] : []
    }),
    sharedVisits: rowsOf(db.mySharedVisits).flatMap((row) => {
      const person = personOf(row.person)
      if (!person) return []
      return [{
        id: idOf(row.id),
        zoneName: text(row.zoneName),
        booths: strings(row.booths),
        startedAt: millis(row.startedAt) ?? 0,
        minutes: num(row.overlapMinutes),
        person,
      }]
    }),
    photos: rowsOf(db.myPhotos).map((row) => ({
      id: idOf(row.photoId) || idOf(row.id),
      url: text(row.url),
      takenAt: millis(row.takenAt) ?? 0,
      zoneName: text(row.zoneName),
      caption: text(row.caption),
      people: Array.isArray(row.people) ? row.people.flatMap((item) => { const person = personOf(item); return person ? [person] : [] }) : [],
    })),
    departure: left ? { name: text(left.name), bandId: num(left.bandId), door: text(left.door), leftAt: millis(left.leftAt) } : null,
  }
}

/** Back-to-back stays in the same zone, under a minute apart, read as one bar. */
export function staysUntil(visits: RecapVisit[], close: number): Stay[] {
  const open = visits
    .filter((visit) => visit.startedAt > 0 && visit.startedAt < close)
    .sort((a, b) => a.startedAt - b.startedAt)
  const stays: Stay[] = []
  for (const visit of open) {
    const end = Math.min(close, visit.endedAt ?? close)
    const last = stays[stays.length - 1]
    if (last && last.zoneName === visit.zoneName && visit.startedAt - last.end < 60_000) last.end = Math.max(last.end, end)
    else stays.push({ zoneName: visit.zoneName, start: visit.startedAt, end })
  }
  return stays
}

export interface MetDot {
  name: string
  zoneName: string
  at: number
}

export function metUntil(encounters: RecapEncounter[], close: number): MetDot[] {
  return encounters
    .filter((row) => row.startedAt > 0 && row.startedAt < close)
    .map((row) => ({ name: row.person.name, zoneName: row.zoneName, at: row.startedAt }))
}

export interface FallbackPerson {
  nodeId: string
  name: string
  photoUrl: string
  handles: Handle[]
  minutes: number
  zoneName: string
  metAt: number
}

/** One row per person, most minutes first. The meeting place is the earliest encounter. */
export function peopleFromEncounters(rows: RecapEncounter[], close: number): FallbackPerson[] {
  const byId = new Map<string, FallbackPerson>()
  for (const row of rows) {
    if (row.startedAt >= close) continue
    const key = row.person.nodeId || row.person.name
    const current = byId.get(key)
    if (!current) {
      byId.set(key, {
        nodeId: row.person.nodeId,
        name: row.person.name,
        photoUrl: row.person.photoUrl,
        handles: row.person.handles,
        minutes: row.minutes,
        zoneName: row.zoneName,
        metAt: row.startedAt,
      })
      continue
    }
    current.minutes += row.minutes
    if (row.startedAt > 0 && (current.metAt === 0 || row.startedAt < current.metAt)) {
      current.metAt = row.startedAt
      current.zoneName = row.zoneName
    }
    if (!current.photoUrl && row.person.photoUrl) current.photoUrl = row.person.photoUrl
    if (!current.handles.length && row.person.handles.length) current.handles = row.person.handles
  }
  return [...byId.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name))
}

export interface FallbackPlace {
  zoneName: string
  startedAt: number
  minutes: number
}

export interface FallbackNear {
  nodeId: string
  name: string
  photoUrl: string
  handles: Handle[]
  minutes: number
  places: FallbackPlace[]
  booths: string[]
}

/** People you shared a place with and never met. Most overlap first. */
export function nearFromShared(rows: RecapShared[], metIds: Set<string>, close: number): FallbackNear[] {
  const byId = new Map<string, FallbackNear>()
  for (const row of rows) {
    if (row.startedAt >= close) continue
    const key = row.person.nodeId || row.person.name
    if (metIds.has(key)) continue
    const current = byId.get(key)
    const place = { zoneName: row.zoneName, startedAt: row.startedAt, minutes: row.minutes }
    if (!current) {
      byId.set(key, {
        nodeId: row.person.nodeId,
        name: row.person.name,
        photoUrl: row.person.photoUrl,
        handles: row.person.handles,
        minutes: row.minutes,
        places: [place],
        booths: [...row.booths],
      })
      continue
    }
    current.minutes += row.minutes
    current.places.push(place)
    for (const booth of row.booths) if (!current.booths.includes(booth)) current.booths.push(booth)
  }
  for (const person of byId.values()) person.places.sort((a, b) => b.minutes - a.minutes || a.startedAt - b.startedAt)
  return [...byId.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name))
}

export interface FallbackBooth {
  name: string
  zoneName: string
  minutes: number
}

export function boothsFromVisits(visits: RecapVisit[], close: number): FallbackBooth[] {
  const booths = new Map<string, FallbackBooth>()
  for (const visit of visits) {
    if (visit.startedAt >= close) continue
    for (const name of visit.booths) {
      const current = booths.get(name)
      if (!current) booths.set(name, { name, zoneName: visit.zoneName, minutes: visit.minutes })
      else current.minutes += visit.minutes
    }
  }
  return [...booths.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name))
}
