import type { Vec2 } from '@/contracts/domain'

/** Shared with the renderer so picking stays aligned at overview and close zoom. */
export function personWidthPx(scale: number): number {
  const detail = Math.max(0, Math.min(1, (scale - 10) / 8))
  return 2.6 + (Math.min(34, 0.58 * scale) - 2.6) * detail
}

/** Pick the closest drawn person, never a location for a band absent from the floor. */
export function pickPerson(point: Vec2, bands: readonly { id: number }[], position: (id: number) => Vec2 | null, project: (at: Vec2) => Vec2, radius = 14): number | null {
  let selected: number | null = null
  let nearest = radius
  for (const band of bands) {
    const at = position(band.id)
    if (!at) continue
    const screen = project(at)
    const distance = Math.hypot(point.x - screen.x, point.y - screen.y)
    if (distance < nearest) {
      nearest = distance
      selected = band.id
    }
  }
  return selected
}
