/**
 * Elastic's order for the recap. SpacetimeDB says who is eligible.
 * GET /api/recap ranks people and booths. GET /api/friends searches the same night in the caller's words.
 */

import type { Interest, Similar } from './copy'

export interface RankedPerson {
  nodeId: string
  name: string
  photoUrl: string
  handles: { platform: string; handle: string }[]
  minutes: number
  metZone: string
  metAt: number
  interests: Interest[]
  photosTogether: number
  similar: Similar | null
}

export interface RankedPlace {
  zoneName: string
  startedAt: number
  minutes: number
}

export interface RankedNear {
  nodeId: string
  name: string
  photoUrl: string
  handles: { platform: string; handle: string }[]
  minutes: number
  places: RankedPlace[]
  interests: Interest[]
  similar: Similar | null
}

export interface RankedBooth {
  name: string
  zoneName: string
  minutes: number
}

export interface RankedRecap {
  displayName: string
  ranked: boolean
  people: RankedPerson[]
  alsoThere: RankedNear[]
  booths: RankedBooth[]
}

export interface FriendPlace {
  name: string
  startedAt: number
  minutes: number
  kind: string
}

export interface FriendHit {
  nodeId: string
  name: string
  photoUrl: string
  handles: { platform: string; handle: string }[]
  minutes: number
  reason: string
  places: FriendPlace[]
}

export interface FriendSearch {
  query: string
  semanticRanked: boolean
  candidateCount: number
  searchedCount: number
  people: FriendHit[]
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? n : 0
}

function when(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function handles(value: unknown): { platform: string; handle: string }[] {
  const row = record(value)
  if (!row) return []
  return Object.entries(row).flatMap(([platform, handle]) => (typeof handle === 'string' && handle ? [{ platform, handle }] : []))
}

function interests(value: unknown): Interest[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const row = record(item)
    if (!row || !str(row.name)) return []
    return [{ name: str(row.name), minutes: num(row.minutes), yourMinutes: num(row.your_minutes), shared: row.shared === true }]
  })
}

function similar(value: unknown): Similar | null {
  const row = record(value)
  if (!row || (!str(row.your_booth) && !str(row.their_booth))) return null
  return { yourBooth: str(row.your_booth), theirBooth: str(row.their_booth), topic: str(row.topic) }
}

export function parseRecap(value: unknown): RankedRecap | null {
  const row = record(value)
  if (!row || !Array.isArray(row.suggested_people) || !Array.isArray(row.also_there) || !Array.isArray(row.suggested_booths)) return null
  return {
    displayName: str(row.display_name),
    ranked: row.suggestions_ranked === true,
    people: row.suggested_people.flatMap((item) => {
      const person = record(item)
      if (!person || !str(person.name)) return []
      return [{
        nodeId: String(num(person.node_id) || str(person.node_id)),
        name: str(person.name),
        photoUrl: str(person.photo_url),
        handles: handles(person.handles),
        minutes: num(person.minutes),
        metZone: str(person.met_zone_name),
        metAt: when(person.met_at),
        interests: interests(person.interests),
        photosTogether: num(person.photos_together),
        similar: similar(person.similar),
      }]
    }),
    alsoThere: row.also_there.flatMap((item) => {
      const person = record(item)
      if (!person || !str(person.name)) return []
      const places = Array.isArray(person.places) ? person.places.flatMap((place) => {
        const at = record(place)
        if (!at || !str(at.zone_name)) return []
        return [{ zoneName: str(at.zone_name), startedAt: when(at.started_at), minutes: num(at.minutes) }]
      }) : []
      return [{
        nodeId: String(num(person.node_id) || str(person.node_id)),
        name: str(person.name),
        photoUrl: str(person.photo_url),
        handles: handles(person.handles),
        minutes: num(person.minutes),
        places,
        interests: interests(person.interests),
        similar: similar(person.similar),
      }]
    }),
    booths: row.suggested_booths.flatMap((item) => {
      const booth = record(item)
      if (!booth || !str(booth.name)) return []
      return [{ name: str(booth.name), zoneName: str(booth.zone_name), minutes: num(booth.minutes) }]
    }),
  }
}

export function parseFriends(value: unknown): FriendSearch | null {
  const row = record(value)
  if (!row || !Array.isArray(row.people)) return null
  return {
    query: str(row.query),
    semanticRanked: row.semantic_ranked === true,
    candidateCount: num(row.candidate_count),
    searchedCount: num(row.searched_count),
    people: row.people.flatMap((item) => {
      const person = record(item)
      if (!person || !str(person.name)) return []
      const places = Array.isArray(person.places) ? person.places.flatMap((place) => {
        const at = record(place)
        if (!at || !str(at.name)) return []
        return [{ name: str(at.name), startedAt: when(at.started_at), minutes: num(at.minutes), kind: str(at.kind) }]
      }) : []
      return [{
        nodeId: String(num(person.node_id) || str(person.node_id)),
        name: str(person.name),
        photoUrl: str(person.photo_url),
        handles: handles(person.handles),
        minutes: num(person.minutes),
        reason: str(person.reason),
        places,
      }]
    }),
  }
}

function errorText(data: unknown): string {
  const row = record(data)
  return typeof row?.error === 'string' && row.error ? row.error : 'The ranking didn’t answer.'
}

export async function loadRecap(token: string, signal?: AbortSignal): Promise<RankedRecap> {
  const response = await fetch('/api/recap', { headers: { 'x-bandit-session': token }, signal })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error(errorText(data))
  const ranked = parseRecap(data)
  if (!ranked) throw new Error('The ranking came back in a shape this page can’t read.')
  return ranked
}

export async function searchFriends(token: string, query: string, signal?: AbortSignal): Promise<FriendSearch> {
  const response = await fetch(`/api/friends?q=${encodeURIComponent(query)}`, { headers: { 'x-bandit-session': token }, signal })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new Error(errorText(data))
  const found = parseFriends(data)
  if (!found) throw new Error('The search came back in a shape this page can’t read.')
  return found
}
