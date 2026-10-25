/**
 * The floor draws one capped set of people. The band table can hold every id; the map asks for a
 * stable sample so a full roster never becomes a sprite per row, and so a position tick does not
 * reshuffle who is on screen.
 */

/** Wristband markers the side panel still pages through. The hall itself uses `MAP_PEOPLE`. */
export const MAP_CAST = 24
/** People the hall will draw. Everyone else stays in the database. */
export const MAP_PEOPLE = 1000
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

/**
 * Alerts stay. The rest is an even spread of the roster, and the same ids always come back,
 * so the map can seed once and then walk those people locally.
 */
export function sampleCast(bands: CastBand[], limit = MAP_PEOPLE): CastBand[] {
  const alerts = bands.filter((band) => band.sos || band.fall).sort((a, b) => a.id - b.id)
  const pinned = alerts.slice(0, limit)
  const room = limit - pinned.length
  if (room <= 0) return pinned
  const pinnedIds = new Set(pinned.map((band) => band.id))
  const calm = bands.filter((band) => !pinnedIds.has(band.id)).sort((a, b) => a.id - b.id)
  if (calm.length <= room) return [...pinned, ...calm]
  const step = calm.length / room
  const window: CastBand[] = []
  for (let i = 0; i < room; i++) window.push(calm[Math.floor(i * step)]!)
  return [...pinned, ...window]
}

export function currentCast(): CastBand[] {
  return sampleCast(roster)
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
