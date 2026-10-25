import type { Graphics } from 'pixi.js'
import type { Vec2 } from '@/contracts/domain'
import type { Path } from '@/lib/geometry'
import { project, type Camera, type ScreenPoint } from './projection'

const tmp: ScreenPoint = { x: 0, y: 0, depth: 0 }

/**
 * Project a world polygon at height z to a new flat [x0, y0, x1, y1, ...] screen array. Always a
 * fresh array: Pixi's Graphics keeps a reference to the points until it renders.
 */
export function projectPoly(cam: Camera, pts: Vec2[], z: number): number[] {
  const out: number[] = []
  for (const p of pts) {
    project(cam, p.x, p.y, z, tmp)
    out.push(tmp.x, tmp.y)
  }
  return out
}

export function screen(cam: Camera, x: number, y: number, z = 0): ScreenPoint {
  return project(cam, x, y, z, { x: 0, y: 0, depth: 0 })
}

/** Dashes along a world-space path between distances `from` and `to` (metres), at height z. */
export function dashedPath(
  g: Graphics,
  cam: Camera,
  path: Path,
  from: number,
  to: number,
  z: number,
  dash: number,
  gap: number,
  offset = 0,
): void {
  const period = dash + gap
  let s = from + (((offset % period) + period) % period) - period
  const a: ScreenPoint = { x: 0, y: 0, depth: 0 }
  const b: ScreenPoint = { x: 0, y: 0, depth: 0 }
  for (; s < to; s += period) {
    const s0 = Math.max(from, s)
    const s1 = Math.min(to, s + dash)
    if (s1 <= s0) continue
    const p = path.at(s0)
    const q = path.at(s1)
    project(cam, p.x, p.y, z, a)
    project(cam, q.x, q.y, z, b)
    g.moveTo(a.x, a.y).lineTo(b.x, b.y)
  }
}

/** Dashes that follow a path whose floor height changes, such as a stair. */
export function dashedPathZ(
  g: Graphics,
  cam: Camera,
  path: Path,
  from: number,
  to: number,
  zAt: (s: number) => number,
  dash: number,
  gap: number,
  offset = 0,
): void {
  const period = dash + gap
  let s = from + (((offset % period) + period) % period) - period
  const a: ScreenPoint = { x: 0, y: 0, depth: 0 }
  const b: ScreenPoint = { x: 0, y: 0, depth: 0 }
  for (; s < to; s += period) {
    const s0 = Math.max(from, s)
    const s1 = Math.min(to, s + dash)
    if (s1 <= s0) continue
    const p = path.at(s0)
    const q = path.at(s1)
    project(cam, p.x, p.y, zAt(s0), a)
    project(cam, q.x, q.y, zAt(s1), b)
    g.moveTo(a.x, a.y).lineTo(b.x, b.y)
  }
}

/** Solid polyline along a path from 0 to `to` metres. */
export function pathLine(g: Graphics, cam: Camera, path: Path, to: number, z: number): void {
  const pts = path.points
  const a = project(cam, pts[0].x, pts[0].y, z, { x: 0, y: 0, depth: 0 })
  g.moveTo(a.x, a.y)
  for (let k = 1; k < pts.length; k++) {
    if (path.cumulative[k] > to) {
      const e = path.at(to)
      project(cam, e.x, e.y, z, a)
      g.lineTo(a.x, a.y)
      return
    }
    project(cam, pts[k].x, pts[k].y, z, a)
    g.lineTo(a.x, a.y)
  }
}

/** The same line, with each vertex at its own floor height so a stair climbs instead of cutting through. */
export function pathLineZ(g: Graphics, cam: Camera, path: Path, to: number, zAt: (s: number) => number): void {
  const end = Math.min(path.length, Math.max(0, to))
  const step = 1.1
  const a = { x: 0, y: 0, depth: 0 }
  const p0 = path.at(0)
  project(cam, p0.x, p0.y, zAt(0), a)
  g.moveTo(a.x, a.y)
  for (let s = step; s < end; s += step) {
    const p = path.at(s)
    project(cam, p.x, p.y, zAt(s), a)
    g.lineTo(a.x, a.y)
  }
  const p1 = path.at(end)
  project(cam, p1.x, p1.y, zAt(end), a)
  g.lineTo(a.x, a.y)
}

/** Dashed ellipse for a ground circle of radius r metres, drawn as projected segments. */
export function groundCircle(g: Graphics, cam: Camera, cx: number, cy: number, r: number, segments: number, dashFrac = 1, rotation = 0, z = 0): void {
  const a: ScreenPoint = { x: 0, y: 0, depth: 0 }
  const b: ScreenPoint = { x: 0, y: 0, depth: 0 }
  for (let k = 0; k < segments; k++) {
    const t0 = rotation + (k / segments) * Math.PI * 2
    const t1 = t0 + (Math.PI * 2 * dashFrac) / segments
    project(cam, cx + Math.cos(t0) * r, cy + Math.sin(t0) * r, z, a)
    if (dashFrac >= 1 && k > 0) {
      g.lineTo(a.x, a.y)
    } else {
      g.moveTo(a.x, a.y)
    }
    const steps = dashFrac >= 1 ? 1 : 3
    for (let j = 1; j <= steps; j++) {
      const t = t0 + ((t1 - t0) * j) / steps
      project(cam, cx + Math.cos(t) * r, cy + Math.sin(t) * r, z, b)
      g.lineTo(b.x, b.y)
    }
  }
}

/** Filled ground disc. */
export function groundDisc(g: Graphics, cam: Camera, cx: number, cy: number, r: number, segments = 40, z = 0): number[] {
  const out: number[] = []
  const a: ScreenPoint = { x: 0, y: 0, depth: 0 }
  for (let k = 0; k < segments; k++) {
    const t = (k / segments) * Math.PI * 2
    project(cam, cx + Math.cos(t) * r, cy + Math.sin(t) * r, z, a)
    out.push(a.x, a.y)
  }
  g.poly(out, true)
  return out
}

/** Andrew's monotone chain on [x, y] pairs. */
export function convexHull(points: [number, number][]): [number, number][] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  upper.pop()
  lower.pop()
  return lower.concat(upper)
}
