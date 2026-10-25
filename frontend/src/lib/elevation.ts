import type { Venue } from '@/contracts/domain'
import { pointInPolygon } from './geometry'

/**
 * Height of the walking surface at a ground point: a stand's deck, partway up a stair, or the
 * ground. People and bands are drawn at this height; the crowd model never puts anyone on a deck
 * unless they climbed the stairs.
 */
export type ElevationAt = (x: number, y: number) => number

export function createElevation(venue: Venue): ElevationAt {
  const decks = (venue.platforms ?? []).map((p) => ({ polygon: p.polygon, h: p.elevationM }))
  const stairs = (venue.stairs ?? []).map((s) => {
    const len = Math.hypot(s.top.x - s.bottom.x, s.top.y - s.bottom.y) || 1
    return {
      polygon: s.polygon,
      bx: s.bottom.x,
      by: s.bottom.y,
      ux: (s.top.x - s.bottom.x) / len,
      uy: (s.top.y - s.bottom.y) / len,
      len,
      h: s.topElevationM,
    }
  })
  if (!decks.length && !stairs.length) return () => 0
  return (x, y) => {
    for (const d of decks) if (pointInPolygon(x, y, d.polygon)) return d.h
    for (const s of stairs) {
      if (!pointInPolygon(x, y, s.polygon)) continue
      const along = ((x - s.bx) * s.ux + (y - s.by) * s.uy) / s.len
      return Math.max(0, Math.min(1, along)) * s.h
    }
    return 0
  }
}
