/**
 * The floor draws one page of characters. The band table can hold every id; the map asks for a page
 * so a full roster never becomes a full set of sprites. A database view can replace `castPageOf`
 * with the same page: alerts first, then a window of the rest.
 */

export const MAP_CAST = 24
export const CAST_PAGE_MS = 45_000

export interface CastBand {
  id: number
  sos: boolean
  fall: boolean
}

let roster: CastBand[] = []
let page = 0
let turnedAt = 0

export function setCastRoster(bands: CastBand[]): void {
  roster = bands
}

export function castRoster(): CastBand[] {
  return roster
}

/** Alerts stay on the page. The calm ids rotate so each band gets a turn on the floor. */
export function castPageOf(bands: CastBand[], pageIndex: number, limit = MAP_CAST): CastBand[] {
  const alerts = bands.filter((band) => band.sos || band.fall).sort((a, b) => a.id - b.id)
  const calm = bands.filter((band) => !band.sos && !band.fall).sort((a, b) => a.id - b.id)
  const pinned = alerts.slice(0, limit)
  const room = limit - pinned.length
  if (room <= 0 || calm.length === 0) return pinned
  const start = (Math.abs(pageIndex) * room) % calm.length
  const window: CastBand[] = []
  for (let i = 0; i < room && i < calm.length; i++) window.push(calm[(start + i) % calm.length]!)
  return [...pinned, ...window]
}

export function currentCast(): CastBand[] {
  return castPageOf(roster, page)
}

/** Advance the window when the roster is larger than the floor can draw. */
export function turnCastPage(now: number): boolean {
  if (roster.length <= MAP_CAST) return false
  if (turnedAt === 0) {
    turnedAt = now
    return false
  }
  if (now - turnedAt < CAST_PAGE_MS) return false
  page += 1
  turnedAt = now
  return true
}
