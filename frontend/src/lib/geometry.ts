import type { Polygon, Polyline, Vec2 } from '@/contracts/domain'

export function rect(x: number, y: number, w: number, h: number): Polygon {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
}

export function polygonArea(poly: Polygon): number {
  let a = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y)
  }
  return Math.abs(a / 2)
}

export function bbox(poly: Polygon): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of poly) {
    if (p.x < x0) x0 = p.x
    if (p.y < y0) y0 = p.y
    if (p.x > x1) x1 = p.x
    if (p.y > y1) y1 = p.y
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function pointInPolygon(x: number, y: number, poly: Polygon): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function polylineLength(line: Polyline): number {
  let len = 0
  for (let i = 1; i < line.length; i++) len += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y)
  return len
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * A polyline with precomputed cumulative lengths, for projecting points onto a corridor and walking
 * along it. Used by the renderer and the mock simulator alike.
 */
export class Path {
  readonly points: Polyline
  readonly cumulative: number[]
  readonly length: number

  constructor(points: Polyline) {
    this.points = points
    this.cumulative = [0]
    for (let i = 1; i < points.length; i++) {
      this.cumulative.push(this.cumulative[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y))
    }
    this.length = this.cumulative[this.cumulative.length - 1]
  }

  /** Point and unit tangent at distance `s` along the path. */
  at(s: number): { x: number; y: number; ux: number; uy: number } {
    const pts = this.points
    const cum = this.cumulative
    const t = Math.max(0, Math.min(this.length, s))
    let k = 0
    while (k < cum.length - 2 && cum[k + 1] < t) k++
    const segLen = cum[k + 1] - cum[k] || 1
    const f = (t - cum[k]) / segLen
    const p = pts[k]
    const q = pts[k + 1]
    return { x: p.x + f * (q.x - p.x), y: p.y + f * (q.y - p.y), ux: (q.x - p.x) / segLen, uy: (q.y - p.y) / segLen }
  }

  /**
   * Distance from (x, y) to the path, distance along the path of the closest point, and the unit
   * vector pointing from the path toward the point (the side the point is already on).
   */
  project(x: number, y: number, out: ProjectResult): ProjectResult {
    const pts = this.points
    let best = Infinity
    for (let k = 0; k < pts.length - 1; k++) {
      const ax = pts[k].x
      const ay = pts[k].y
      const dx = pts[k + 1].x - ax
      const dy = pts[k + 1].y - ay
      const l2 = dx * dx + dy * dy || 1
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2))
      const rx = x - ax - t * dx
      const ry = y - ay - t * dy
      const d = Math.hypot(rx, ry)
      if (d < best) {
        best = d
        out.distance = d
        out.along = this.cumulative[k] + t * Math.sqrt(l2)
        if (d > 0.05) {
          out.nx = rx / d
          out.ny = ry / d
        } else {
          const l = Math.sqrt(l2)
          out.nx = -dy / l
          out.ny = dx / l
        }
      }
    }
    return out
  }
}

export interface ProjectResult {
  distance: number
  along: number
  nx: number
  ny: number
}

export function newProjectResult(): ProjectResult {
  return { distance: 0, along: 0, nx: 0, ny: 0 }
}
