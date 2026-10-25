import type { Vec2 } from '@/contracts/domain'
import type { MapEngine } from './MapEngine'

/**
 * Imperative camera handle for controls outside the map. The VenueMap attaches its engine on mount;
 * calls before that are ignored.
 */
let engine: MapEngine | null = null

export const mapController = {
  attach(e: MapEngine) {
    engine = e
  },
  detach(e: MapEngine) {
    if (engine === e) engine = null
  },
  get engine(): MapEngine | null {
    return engine
  },
  fit: () => engine?.fit(true),
  focus: (p: Vec2, scale?: number) => engine?.focus(p, scale),
  focusIncident: (id: string) => engine?.focusIncident(id) ?? false,
  frame: (points: Vec2[], maxScale?: number) => engine?.frame(points, maxScale),
  zoom: (factor: number) => engine?.zoom(factor),
  rotate: (deg: number) => engine?.rotate(deg),
  resetView: () => engine?.resetView(),
}
