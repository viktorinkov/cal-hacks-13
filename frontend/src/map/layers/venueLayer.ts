/**
 * The built venue: the floor slab, painted zones and markings, and every structure extruded with
 * simple directional shading and a soft cast shadow. Static, so it is redrawn only when the camera
 * moves. The LED wall and truss are drawn separately because they animate.
 */
import { Container, Graphics } from 'pixi.js'
import type { Stair, Structure, Vec2, Venue } from '@/contracts/domain'
import { bbox } from '@/lib/geometry'
import { px } from '@/lib/tokens'
import { convexHull, projectPoly, screen } from '../draw'
import { mapPalette, mix, sectionColor, shade, structureColor } from '../palette'
import { depthOf, project, type Camera, type ScreenPoint } from '../projection'

interface Face {
  a: Vec2
  b: Vec2
  nx: number
  ny: number
}

interface Solid {
  s: Structure
  color: number
  centroid: Vec2
  faces: Face[]
  alpha: number
}

const SLAB_DEPTH = 0.6
/** Direction shadows fall, metres of offset per metre of height. */
const SHADOW = { x: 0.42, y: 0.5 }
/** Light from the north-west. */
const LIGHT = normalize({ x: -0.75, y: -0.6 })

function normalize(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.y) || 1
  return { x: v.x / l, y: v.y / l }
}

function solidOf(s: Structure): Solid {
  const pts = s.footprint
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length
  const faces: Face[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    let nx = b.y - a.y
    let ny = -(b.x - a.x)
    const l = Math.hypot(nx, ny) || 1
    nx /= l
    ny /= l
    const mx = (a.x + b.x) / 2 - cx
    const my = (a.y + b.y) / 2 - cy
    if (nx * mx + ny * my < 0) {
      nx = -nx
      ny = -ny
    }
    faces.push({ a, b, nx, ny })
  }
  const alpha = s.kind === 'barrier' || s.kind === 'fence' ? 0.85 : 1
  return { s, color: structureColor[s.kind], centroid: { x: cx, y: cy }, faces, alpha }
}

export class VenueLayer {
  readonly ground = new Graphics()
  readonly shadows = new Graphics()
  /**
   * One Graphics per structure, in back-to-front order for the current camera. The engine puts the
   * people standing behind structure k before solids[k] and everyone else after it.
   */
  readonly solids: Graphics[]
  /** Back-edge depth of solids[k], ascending. Valid after draw(). */
  boundaries = new Float64Array(0)
  readonly root = new Container()
  /**
   * The far edge of solids[k] as seen by the camera, as a chain of (across, depth) points: a
   * person is behind the structure only if, at their own position across the screen, they are
   * farther away than that edge. A single depth per structure is not enough once the view is
   * rotated, because a long wall's far edge is slanted.
   */
  private occluders: { r0: number; r1: number; xs: number[]; ys: number[] }[] = []
  private bins: number[][] = []
  private binR0 = 0
  private binW = 1
  private tilted = true
  private readonly venue: Venue
  private readonly list: Solid[]

  private readonly stairs: Stair[]

  constructor(venue: Venue) {
    this.venue = venue
    this.list = venue.structures.map(solidOf)
    this.stairs = venue.stairs ?? []
    this.solids = Array.from({ length: this.list.length + this.stairs.length }, () => new Graphics())
    this.boundaries = new Float64Array(this.solids.length)
    this.root.addChild(this.ground, this.shadows)
  }

  get count(): number {
    return this.solids.length
  }

  /**
   * Draw the floor and every structure. Structures are sorted by their back edge; a person whose
   * feet are behind that edge is drawn before the structure (hidden by it), anyone else after it.
   */
  draw(cam: Camera, opts: { grid: boolean; structures: boolean; floor?: boolean }): void {
    if (opts.floor === false) this.ground.clear()
    else this.drawGround(cam, opts.grid)
    this.shadows.clear()
    for (const g of this.solids) g.clear()
    if (!opts.structures) {
      // nothing to hide behind: every person lands after the last (empty) structure
      this.boundaries.fill(-Infinity)
      this.occluders = []
      this.bins = []
      return
    }
    this.drawShadows(cam)
    this.drawSolids(cam)
  }

  // ---------------------------------------------------------------- ground

  private drawGround(cam: Camera, grid: boolean): void {
    const g = this.ground
    const v = this.venue
    g.clear()
    const W = v.width
    const H = v.height
    const tilted = cam.tilt > 0.02

    if (grid) {
      for (let x = -40; x <= W + 40; x += 5) {
        const a = screen(cam, x, -30, -SLAB_DEPTH)
        const b = screen(cam, x, H + 30, -SLAB_DEPTH)
        g.moveTo(a.x, a.y).lineTo(b.x, b.y)
      }
      for (let y = -30; y <= H + 30; y += 5) {
        const a = screen(cam, -40, y, -SLAB_DEPTH)
        const b = screen(cam, W + 40, y, -SLAB_DEPTH)
        g.moveTo(a.x, a.y).lineTo(b.x, b.y)
      }
      g.stroke({ width: 1, color: mapPalette.voidGrid, alpha: 0.035 })
    }

    // slab sides, then top
    const corners: Vec2[] = [
      { x: 0, y: 0 },
      { x: W, y: 0 },
      { x: W, y: H },
      { x: 0, y: H },
    ]
    if (tilted) {
      // soft contact shadow under the slab
      const sh = corners.map((c) => ({ x: c.x + SHADOW.x * 1.5, y: c.y + SHADOW.y * 1.5 }))
      g.poly(projectPoly(cam, sh, -SLAB_DEPTH), true).fill({ color: mapPalette.shadow, alpha: 0.45 })
      for (let i = 0; i < 4; i++) {
        const a = corners[i]
        const b = corners[(i + 1) % 4]
        const nx = b.y - a.y
        const ny = -(b.x - a.x)
        // outward normal for a clockwise-on-screen rectangle
        const ry = Math.sin(cam.yaw) * nx + Math.cos(cam.yaw) * ny
        if (ry <= 0) continue
        const lit = 0.75 + 0.35 * Math.max(0, normalize({ x: nx, y: ny }).x * LIGHT.x + normalize({ x: nx, y: ny }).y * LIGHT.y)
        const quad = [a, b].map((p) => screen(cam, p.x, p.y, 0))
        const low = [b, a].map((p) => screen(cam, p.x, p.y, -SLAB_DEPTH))
        g.poly([quad[0].x, quad[0].y, quad[1].x, quad[1].y, low[0].x, low[0].y, low[1].x, low[1].y], true).fill({
          color: shade(mapPalette.slabSide, lit),
        })
      }
    }
    g.poly(projectPoly(cam, corners, 0), true).fill({ color: mapPalette.slabTop })

    // backstage and facilities: darker, hatched
    for (const o of v.obstacles) {
      if (o.kind !== 'backstage' && o.kind !== 'facility') continue
      g.poly(projectPoly(cam, o.polygon, 0), true).fill({ color: mapPalette.backstage })
      this.hatch(g, cam, o.polygon, 1.6)
    }
    g.stroke({ width: 1, color: mapPalette.hatch, alpha: 0.7 })

    // zones: a pastel wash per section, passages paved lighter
    for (const z of v.zones) {
      const base = z.section === 'passage' ? mapPalette.paving : mix(mapPalette.slabTop, sectionColor[z.section], 0.2)
      g.poly(projectPoly(cam, z.polygon, 0), true).fill({ color: base })
    }
    for (const z of v.zones) {
      g.poly(projectPoly(cam, z.polygon, 0), true).stroke({ width: 1, color: mapPalette.zoneLine, alpha: 0.1 })
    }

    // the closed centre passage
    for (const w of v.walkways) {
      if (w.status !== 'closed') continue
      g.poly(projectPoly(cam, w.polygon, 0), true).fill({ color: mapPalette.backstage })
    }

    // painted venue grid
    if (grid) {
      for (let x = 5; x < W; x += 5) {
        const a = screen(cam, x, 0, 0)
        const b = screen(cam, x, H, 0)
        g.moveTo(a.x, a.y).lineTo(b.x, b.y)
      }
      for (let y = 5; y < H; y += 5) {
        const a = screen(cam, 0, y, 0)
        const b = screen(cam, W, y, 0)
        g.moveTo(a.x, a.y).lineTo(b.x, b.y)
      }
      g.stroke({ width: 1, color: 0xffffff, alpha: 0.04 })
    }

    // exits and gates: bright thresholds on the perimeter
    for (const e of v.exits) {
      const a = screen(cam, e.segment[0].x, e.segment[0].y, 0)
      const b = screen(cam, e.segment[1].x, e.segment[1].y, 0)
      g.moveTo(a.x, a.y).lineTo(b.x, b.y)
    }
    g.stroke({ width: 3, color: px.sectionWing, alpha: 0.9, cap: 'round' })

    // venue edge
    g.poly(projectPoly(cam, corners, 0), true).stroke({ width: 1, color: 0xffffff, alpha: 0.22 })
  }

  private hatch(g: Graphics, cam: Camera, poly: Vec2[], step: number): void {
    const b = bbox(poly)
    const a: ScreenPoint = { x: 0, y: 0, depth: 0 }
    const c: ScreenPoint = { x: 0, y: 0, depth: 0 }
    // 45° lines clipped to the box
    for (let k = -b.h; k < b.w; k += step) {
      let x0 = b.x + k
      let y0 = b.y
      let x1 = b.x + k + b.h
      let y1 = b.y + b.h
      if (x0 < b.x) {
        y0 += b.x - x0
        x0 = b.x
      }
      if (x1 > b.x + b.w) {
        y1 -= x1 - (b.x + b.w)
        x1 = b.x + b.w
      }
      project(cam, x0, y0, 0, a)
      project(cam, x1, y1, 0, c)
      g.moveTo(a.x, a.y).lineTo(c.x, c.y)
    }
  }

  // ---------------------------------------------------------------- structures

  private drawShadows(cam: Camera): void {
    if (cam.tilt < 0.02) return
    const g = this.shadows
    for (const sol of this.list) {
      const h = sol.s.heightM
      if (h < 0.4) continue
      const pts: [number, number][] = []
      for (const p of sol.s.footprint) {
        pts.push([p.x, p.y], [p.x + SHADOW.x * h, p.y + SHADOW.y * h])
      }
      const hull = convexHull(pts)
      const flat: number[] = []
      const sp: ScreenPoint = { x: 0, y: 0, depth: 0 }
      for (const [x, y] of hull) {
        project(cam, x, y, 0, sp)
        flat.push(sp.x, sp.y)
      }
      g.poly(flat, true).fill({ color: mapPalette.shadow, alpha: Math.min(0.32, 0.12 + h * 0.03) })
    }
  }

  private drawSolids(cam: Camera): void {
    const tilted = cam.tilt > 0.02
    type Item = { sol: Solid | null; stair: Stair | null; back: number; mid: number }
    const keyed: Item[] = [
      ...this.list.map((sol) => ({
        sol,
        stair: null,
        back: Math.min(...sol.s.footprint.map((q) => depthOf(cam, q.x, q.y, 0))),
        mid: depthOf(cam, sol.centroid.x, sol.centroid.y, sol.s.baseM + sol.s.heightM / 2),
      })),
      ...this.stairs.map((st) => ({
        sol: null,
        stair: st,
        back: Math.min(...st.polygon.map((q) => depthOf(cam, q.x, q.y, 0))),
        mid: depthOf(cam, (st.bottom.x + st.top.x) / 2, (st.bottom.y + st.top.y) / 2, st.topElevationM / 2),
      })),
    ]
    keyed.sort((a, b) => a.back - b.back || a.mid - b.mid)
    const sy = Math.sin(cam.yaw)
    const cy = Math.cos(cam.yaw)
    const p: ScreenPoint = { x: 0, y: 0, depth: 0 }
    this.buildOccluders(
      cam,
      keyed.map((it) => (it.stair ? it.stair.polygon : it.sol!.s.footprint)),
    )
    keyed.forEach(({ sol, stair, back }, k) => {
      this.boundaries[k] = tilted ? back : -Infinity
      const g = this.solids[k]
      if (stair) {
        this.drawStair(g, cam, stair, tilted)
        return
      }
      if (!sol) return
      const { s } = sol
      const top = s.baseM + s.heightM
      if (tilted) {
        const visible = sol.faces
          .filter((f) => sy * f.nx + cy * f.ny > 0.001)
          .sort((f1, f2) => depthOf(cam, (f1.a.x + f1.b.x) / 2, (f1.a.y + f1.b.y) / 2, 0) - depthOf(cam, (f2.a.x + f2.b.x) / 2, (f2.a.y + f2.b.y) / 2, 0))
        for (const f of visible) {
          const lit = 0.58 + 0.34 * Math.max(0, f.nx * LIGHT.x + f.ny * LIGHT.y)
          const flat: number[] = []
          project(cam, f.a.x, f.a.y, s.baseM, p)
          flat.push(p.x, p.y)
          project(cam, f.b.x, f.b.y, s.baseM, p)
          flat.push(p.x, p.y)
          project(cam, f.b.x, f.b.y, top, p)
          flat.push(p.x, p.y)
          project(cam, f.a.x, f.a.y, top, p)
          flat.push(p.x, p.y)
          g.poly(flat, true).fill({ color: shade(sol.color, lit), alpha: sol.alpha })
        }
      }
      const roof = projectPoly(cam, s.footprint, top)
      g.poly(roof, true).fill({ color: shade(sol.color, 1.04), alpha: sol.alpha })
      g.poly(roof, true).stroke({ width: 1, color: 0xffffff, alpha: s.kind === 'speaker' || s.kind === 'stage' ? 0.12 : 0.22 })
      if (s.kind === 'tent' && s.name === 'First Aid') this.cross(g, cam, s, top)
      if (s.kind === 'tier') this.terrace(g, cam, s, top)
    })
  }

  /**
   * Which crowd bucket a person belongs in: after every structure they stand in front of, at their
   * own position across the screen. `rx` and `ry` are the person's across and depth coordinates
   * relative to the camera centre, as the projection computes them.
   */
  bucketOf(rx: number, ry: number): number {
    if (!this.tilted || !this.occluders.length) return this.solids.length
    const bin = this.bins[Math.max(0, Math.min(this.bins.length - 1, Math.floor((rx - this.binR0) / this.binW)))]
    if (!bin) return 0
    let bucket = 0
    for (const k of bin) {
      const o = this.occluders[k]
      if (rx < o.r0 || rx > o.r1 || k + 1 <= bucket) continue
      // depth of the far edge at this rx
      let j = 0
      while (j < o.xs.length - 2 && o.xs[j + 1] < rx) j++
      const span = o.xs[j + 1] - o.xs[j] || 1
      const back = o.ys[j] + ((o.ys[j + 1] - o.ys[j]) * (rx - o.xs[j])) / span
      if (ry > back) bucket = k + 1
    }
    return bucket
  }

  private buildOccluders(cam: Camera, footprints: Vec2[][]): void {
    this.tilted = cam.tilt > 0.02
    const c = Math.cos(cam.yaw)
    const s = Math.sin(cam.yaw)
    this.occluders = footprints.map((poly) => {
      const pts = poly.map((q) => {
        const dx = q.x - cam.cx
        const dy = q.y - cam.cy
        return [c * dx - s * dy, s * dx + c * dy] as [number, number]
      })
      // the far chain: the lower hull in (across, depth)
      pts.sort((a, b) => a[0] - b[0] || a[1] - b[1])
      const chain: [number, number][] = []
      for (const pt of pts) {
        while (chain.length >= 2) {
          const o = chain[chain.length - 2]
          const a = chain[chain.length - 1]
          if ((a[0] - o[0]) * (pt[1] - o[1]) - (a[1] - o[1]) * (pt[0] - o[0]) <= 0) chain.pop()
          else break
        }
        chain.push(pt)
      }
      if (chain.length === 1) chain.push([chain[0][0] + 1e-3, chain[0][1]])
      return { r0: chain[0][0], r1: chain[chain.length - 1][0], xs: chain.map((q) => q[0]), ys: chain.map((q) => q[1]) }
    })
    // bin structures by their across extent so each person only tests the ones in line with them
    const r0 = Math.min(...this.occluders.map((o) => o.r0))
    const r1 = Math.max(...this.occluders.map((o) => o.r1))
    const n = 96
    this.binR0 = r0
    this.binW = Math.max(1e-3, (r1 - r0) / n)
    this.bins = Array.from({ length: n }, () => [])
    this.occluders.forEach((o, k) => {
      const a = Math.max(0, Math.floor((o.r0 - r0) / this.binW))
      const b = Math.min(n - 1, Math.floor((o.r1 - r0) / this.binW))
      for (let i = a; i <= b; i++) this.bins[i].push(k)
    })
  }

  /** Standing terrace: shallow steps across the deck, parallel to its open edge. */
  private terrace(g: Graphics, cam: Camera, s: Structure, z: number): void {
    const b = bbox(s.footprint)
    const a: ScreenPoint = { x: 0, y: 0, depth: 0 }
    const c: ScreenPoint = { x: 0, y: 0, depth: 0 }
    for (let x = b.x + 1.2; x < b.x + b.w - 0.4; x += 1.2) {
      project(cam, x, b.y + 0.2, z, a)
      project(cam, x, b.y + b.h - 0.2, z, c)
      g.moveTo(a.x, a.y).lineTo(c.x, c.y)
    }
    g.stroke({ width: 1, color: 0x000000, alpha: 0.16 })
  }

  /** A flight of steps from the ground up to a stand, with a solid stringer on its open side. */
  private drawStair(g: Graphics, cam: Camera, st: Stair, tilted: boolean): void {
    const N = 12
    const H = st.topElevationM
    const dx = st.top.x - st.bottom.x
    const dy = st.top.y - st.bottom.y
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len
    const uy = dy / len
    // half-width across the stair
    const b = bbox(st.polygon)
    const half = (Math.abs(ux) > Math.abs(uy) ? b.h : b.w) / 2
    const nx = -uy * half
    const ny = ux * half
    const base = { x: st.bottom.x, y: st.bottom.y }
    const at = (f: number, side: number, z: number) => project(cam, base.x + dx * f + nx * side, base.y + dy * f + ny * side, z)
    const color = structureColor.tier
    if (tilted) {
      // the stringer on whichever side faces the viewer
      const sideSign = Math.sin(cam.yaw) * nx + Math.cos(cam.yaw) * ny > 0 ? 1 : -1
      const p0 = at(0, sideSign, 0)
      const p1 = at(1, sideSign, 0)
      const p2 = at(1, sideSign, H)
      g.poly([p0.x, p0.y, p1.x, p1.y, p2.x, p2.y], true).fill({ color: shade(color, 0.72) })
    }
    // risers face down the stair; draw from the top step to the bottom so lower steps overlap
    const risersVisible = Math.sin(cam.yaw) * -ux + Math.cos(cam.yaw) * -uy > 0
    for (let k = N - 1; k >= 0; k--) {
      const f0 = k / N
      const f1 = (k + 1) / N
      const z1 = ((k + 1) / N) * H
      const z0 = (k / N) * H
      if (tilted && risersVisible) {
        const r0 = at(f0, -1, z0)
        const r1 = at(f0, 1, z0)
        const r2 = at(f0, 1, z1)
        const r3 = at(f0, -1, z1)
        g.poly([r0.x, r0.y, r1.x, r1.y, r2.x, r2.y, r3.x, r3.y], true).fill({ color: shade(color, 0.8) })
      }
      const t0 = at(f0, -1, z1)
      const t1 = at(f0, 1, z1)
      const t2 = at(f1, 1, z1)
      const t3 = at(f1, -1, z1)
      g.poly([t0.x, t0.y, t1.x, t1.y, t2.x, t2.y, t3.x, t3.y], true).fill({ color: shade(color, k % 2 ? 1.06 : 0.98) })
    }
    // handrails
    for (const side of [-1, 1]) {
      const h0 = at(0, side, 1)
      const h1 = at(1, side, H + 1)
      g.moveTo(h0.x, h0.y).lineTo(h1.x, h1.y)
    }
    g.stroke({ width: 1.2, color: structureColor.rail, alpha: 0.85 })
  }

  private cross(g: Graphics, cam: Camera, s: Structure, z: number): void {
    const b = bbox(s.footprint)
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    const arm = Math.min(b.w, b.h) * 0.32
    const t = arm * 0.36
    const bar = (x: number, y: number, w: number, h: number) =>
      g.poly(projectPoly(cam, [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], z), true).fill({ color: px.red })
    bar(cx - arm, cy - t / 2, arm * 2, t)
    bar(cx - t / 2, cy - arm, t, arm * 2)
  }
}
