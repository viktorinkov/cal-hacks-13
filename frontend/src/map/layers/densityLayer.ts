/**
 * Density from simulated positions: a density field on 0.5 m cells, an amber heat glow on 1 m cells
 * smoothed over a few metres so it follows masses of people and never single people, and
 * translucent columns rising where a zone the backend marks caution or critical is actually
 * packed. Also derives the flow field (mean walking direction on a 4 m grid) from the same frame.
 */
import { Container, Graphics, Matrix, Sprite, Texture } from 'pixi.js'
import type { CongestionStatus, Venue } from '@/contracts/domain'
import type { ElevationAt } from '@/lib/elevation'
import { bbox, pointInPolygon } from '@/lib/geometry'
import { px } from '@/lib/tokens'
import { CONGESTION_TINT, HEAT_GATHER, heatColor, shade } from '../palette'
import { groundMatrix, project, depthOf, type Camera, type ScreenPoint } from '../projection'

const CELL = 0.5
/** The glow is smoothed over metres, so it is computed on cells twice as wide, a quarter the work. */
const HCELL = 2 * CELL
const COL = 2 // column cell, metres
const FLOW = 4 // flow cell, metres
// box-blur radii in cells, three passes each: the density field (σ ≈ 1.7 m on 0.5 m cells), then
// the glow's tight core (σ ≈ 2.4 m) and wide bloom (σ ≈ 4.5 m) on 1 m cells
const FIELD_R = 3
const CORE_R = 2
const BLOOM_R = 4
/** Smallest walkable share a density is divided by, so the glow beyond a wall is not blown up. */
const AREA_MIN = 0.35
/** Walkable share below which the glow fades out. */
const EDGE_FADE = 0.55
/** Sections where a crowd is expected, so the glow there starts earlier. */
const GATHER_SECTIONS = new Set<string>(['plaza', 'food'])
/** Metres either side of a gate that count as its queue. */
const GATE_REACH = 8

function segmentDistance(x: number, y: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / (vx * vx + vy * vy || 1)))
  return Math.hypot(x - a.x - t * vx, y - a.y - t * vy)
}

export interface Column {
  x: number
  y: number
  /** Floor height the column stands on. */
  z: number
  density: number
  status: CongestionStatus
}

export interface FlowArrow {
  x: number
  y: number
  vx: number
  vy: number
  n: number
}

interface Surface {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  image: ImageData
  /** The glow, one texel per 1 m cell. */
  texture: Texture
  /** People per m², smoothed about 1.7 m. Columns and picking read this. */
  field: Float32Array
  /**
   * The walkable share of each neighbourhood, at each scale the density is smoothed at. Density is
   * people over walkable area, so a packed passage between two walls is not diluted by the walls.
   */
  area: Float32Array
  /** Cells inside this surface's zones. */
  walk: Uint8Array
  // the glow, on 1 m cells
  core: Float32Array
  bloom: Float32Array
  areaCore: Float32Array
  areaBloom: Float32Array
  /** 1 where a crowd is expected, feathered over a few metres; the glow there counts `HEAT_GATHER` times. */
  gather: Float32Array
  hwalk: Uint8Array
  /** Glow only on `walk` (a raised deck), or anywhere people are (the floor). */
  clip: boolean
  /** No zones on this surface: unless someone stands on it, there is nothing to work out. */
  empty: boolean
  /** The texture shows something, so an empty surface has to clear it once. */
  lit: boolean
}

/**
 * One heat texture drawn twice: a plain tint so the amber stays saturated over the painted floor,
 * then the same light added on top so it reads as glowing rather than painted.
 */
function glowOf(texture: Texture): Container {
  const tint = new Sprite(texture)
  tint.alpha = 0.7
  const light = new Sprite(texture)
  light.blendMode = 'add'
  light.alpha = 0.6
  const c = new Container()
  c.addChild(tint, light)
  return c
}

export class DensityLayer {
  /** Glow on the ground. */
  readonly heat: Container
  /** Glow on the raised stands, drawn at deck height after the stands themselves. */
  readonly heatUpper: Container
  readonly columns = new Graphics()
  readonly flow = new Graphics()
  private readonly gw: number
  private readonly gh: number
  private readonly hw: number
  private readonly hh: number
  private readonly ground: Surface
  private readonly upper: Surface
  private readonly upperZ: number
  private readonly tmp: Float32Array
  private readonly htmp: Float32Array
  private readonly venue: Venue
  private readonly elevation: ElevationAt
  private cols: Column[] = []
  private arrows: FlowArrow[] = []
  private readonly zoneBoxes: { id: string; x0: number; y0: number; x1: number; y1: number; z: number }[]

  constructor(venue: Venue, elevation: ElevationAt) {
    this.venue = venue
    this.elevation = elevation
    this.gw = Math.ceil(venue.width / CELL)
    this.gh = Math.ceil(venue.height / CELL)
    this.hw = Math.ceil(this.gw / 2)
    this.hh = Math.ceil(this.gh / 2)
    this.tmp = new Float32Array(this.gw * this.gh)
    this.htmp = new Float32Array(this.hw * this.hh)
    // the floor glows wherever people are; a raised stand only on its own deck
    this.ground = this.surface((z) => !(z.elevationM ?? 0), false)
    this.upper = this.surface((z) => (z.elevationM ?? 0) > 0, true)
    this.ground.gather.set(this.gatherMask())
    this.upperZ = Math.max(0, ...venue.zones.map((z) => z.elevationM ?? 0))
    this.heat = glowOf(this.ground.texture)
    this.heatUpper = glowOf(this.upper.texture)
    this.zoneBoxes = venue.zones.map((z) => {
      const b = bbox(z.polygon)
      return { id: z.zoneId, x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h, z: z.elevationM ?? 0 }
    })
  }

  private surface(include: (z: Venue['zones'][number]) => boolean, clip: boolean): Surface {
    const { gw, gh, hw, hh } = this
    const canvas = document.createElement('canvas')
    canvas.width = hw
    canvas.height = hh
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas unavailable')
    const walk = new Uint8Array(gw * gh)
    const hwalk = new Uint8Array(hw * hh)
    const zones = this.venue.zones.filter(include).map((z) => ({ z, b: bbox(z.polygon) }))
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const x = (gx + 0.5) * CELL
        const y = (gy + 0.5) * CELL
        const inside = zones.some(({ z, b }) => x >= b.x && y >= b.y && x <= b.x + b.w && y <= b.y + b.h && pointInPolygon(x, y, z.polygon))
        if (!inside) continue
        walk[gy * gw + gx] = 1
        hwalk[(gy >> 1) * hw + (gx >> 1)] = 1
      }
    }
    const fine = () => new Float32Array(gw * gh)
    const coarse = () => new Float32Array(hw * hh)
    return {
      canvas,
      ctx,
      image: ctx.createImageData(hw, hh),
      texture: Texture.from(canvas),
      field: fine(),
      area: fine(),
      walk,
      core: coarse(),
      bloom: coarse(),
      areaCore: coarse(),
      areaBloom: coarse(),
      gather: coarse(),
      hwalk,
      clip,
      empty: zones.length === 0,
      lit: false,
    }
  }

  /** Ground cells at an entrance plaza, at food and drink, or beside a gate, feathered so the glow has no hard edge. */
  private gatherMask(): Float32Array {
    const { hw, hh } = this
    const out = new Float32Array(hw * hh)
    const zones = this.venue.zones.filter((z) => GATHER_SECTIONS.has(z.section) && !(z.elevationM ?? 0)).map((z) => ({ z, b: bbox(z.polygon) }))
    const gates = this.venue.exits.filter((e) => e.kind === 'gate')
    for (let hy = 0; hy < hh; hy++) {
      for (let hx = 0; hx < hw; hx++) {
        const x = (hx + 0.5) * HCELL
        const y = (hy + 0.5) * HCELL
        const atGate = gates.some((e) => segmentDistance(x, y, e.segment[0], e.segment[1]) < GATE_REACH)
        const inZone = zones.some(({ z, b }) => x >= b.x && y >= b.y && x <= b.x + b.w && y <= b.y + b.h && pointInPolygon(x, y, z.polygon))
        if (atGate || inZone) out[hy * hw + hx] = 1
      }
    }
    this.smooth(out, BLOOM_R, hw, hh, this.htmp)
    return out
  }

  /** Rebuild the fields from positions (every 0.5 s). */
  refresh(positions: Float32Array, count: number, velocities: Float32Array | null, zoneStatus: (zoneId: string) => CongestionStatus): void {
    const { gw, gh, hw, hh } = this
    const people = new Map<Surface, number>([
      [this.ground, 0],
      [this.upper, 0],
    ])
    for (const surf of [this.ground, this.upper]) {
      surf.field.fill(0)
      surf.area.set(surf.walk)
    }
    const perPerson = 1 / (CELL * CELL)
    for (let i = 0; i < count; i++) {
      const x = positions[2 * i]
      const y = positions[2 * i + 1]
      const gx = Math.floor(x / CELL)
      const gy = Math.floor(y / CELL)
      if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) continue
      const target = this.elevation(x, y) > 0.5 ? this.upper : this.ground
      target.field[gy * gw + gx] += perPerson
      // wherever someone stands is walkable, even where the plan has no zone
      target.area[gy * gw + gx] = 1
      people.set(target, people.get(target)! + 1)
    }
    for (const surf of [this.ground, this.upper]) {
      if (surf.empty && !people.get(surf)) {
        if (surf.lit) {
          surf.image.data.fill(0)
          surf.ctx.putImageData(surf.image, 0, 0)
          surf.texture.source.update()
          surf.lit = false
        }
        continue
      }
      // the glow starts from the unsmoothed counts, gathered onto 1 m cells
      surf.core.fill(0)
      surf.areaCore.fill(0)
      for (let gy = 0; gy < gh; gy++) {
        for (let gx = 0; gx < gw; gx++) {
          const h = (gy >> 1) * hw + (gx >> 1)
          surf.core[h] += surf.field[gy * gw + gx] / 4
          surf.areaCore[h] += surf.area[gy * gw + gx] / 4
        }
      }
      surf.bloom.set(surf.core)
      surf.areaBloom.set(surf.areaCore)
      this.smooth(surf.field, FIELD_R, gw, gh, this.tmp)
      this.smooth(surf.area, FIELD_R, gw, gh, this.tmp)
      this.smooth(surf.core, CORE_R, hw, hh, this.htmp)
      this.smooth(surf.areaCore, CORE_R, hw, hh, this.htmp)
      this.smooth(surf.bloom, BLOOM_R, hw, hh, this.htmp)
      this.smooth(surf.areaBloom, BLOOM_R, hw, hh, this.htmp)
      for (let k = 0; k < gw * gh; k++) surf.field[k] /= Math.max(AREA_MIN, surf.area[k])
      const data = surf.image.data
      for (let k = 0; k < hw * hh; k++) {
        if (surf.clip && !surf.hwalk[k]) {
          data[4 * k + 3] = 0
          continue
        }
        const boost = 1 + (HEAT_GATHER - 1) * surf.gather[k]
        const [c, a] = heatColor(
          (boost * surf.bloom[k]) / Math.max(AREA_MIN, surf.areaBloom[k]),
          (boost * surf.core[k]) / Math.max(AREA_MIN, surf.areaCore[k]),
        )
        // fade out where the floor ends, so the glow does not spill over the outer walls
        const edge = Math.min(1, surf.areaCore[k] / EDGE_FADE)
        data[4 * k] = (c >> 16) & 0xff
        data[4 * k + 1] = (c >> 8) & 0xff
        data[4 * k + 2] = c & 0xff
        data[4 * k + 3] = Math.round(a * edge * 255)
      }
      surf.ctx.putImageData(surf.image, 0, 0)
      surf.texture.source.update()
      surf.lit = true
    }

    // columns where the backend says a zone is under pressure
    const cols: Column[] = []
    const step = COL / CELL
    for (const z of this.zoneBoxes) {
      const status = zoneStatus(z.id)
      if (status !== 'caution' && status !== 'critical') continue
      const field = z.z > 0 ? this.upper.field : this.ground.field
      for (let y = z.y0; y < z.y1 - 0.01; y += COL) {
        for (let x = z.x0; x < z.x1 - 0.01; x += COL) {
          let sum = 0
          let n = 0
          const gx0 = Math.floor(x / CELL)
          const gy0 = Math.floor(y / CELL)
          for (let j = 0; j < step; j++) {
            for (let i = 0; i < step; i++) {
              const gx = gx0 + i
              const gy = gy0 + j
              if (gx >= gw || gy >= gh) continue
              sum += field[gy * gw + gx]
              n++
            }
          }
          const d = n ? sum / n : 0
          if (d >= 2.2) cols.push({ x: x + COL / 2, y: y + COL / 2, z: z.z, density: d, status })
        }
      }
    }
    this.cols = cols

    // flow
    const arrows: FlowArrow[] = []
    if (velocities && velocities.length >= count * 2) {
      const fw = Math.ceil(this.venue.width / FLOW)
      const fh = Math.ceil(this.venue.height / FLOW)
      const sx = new Float32Array(fw * fh)
      const sy = new Float32Array(fw * fh)
      const sn = new Uint16Array(fw * fh)
      for (let i = 0; i < count; i++) {
        const cx = Math.floor(positions[2 * i] / FLOW)
        const cy = Math.floor(positions[2 * i + 1] / FLOW)
        if (cx < 0 || cy < 0 || cx >= fw || cy >= fh) continue
        const c = cy * fw + cx
        sx[c] += velocities[2 * i]
        sy[c] += velocities[2 * i + 1]
        sn[c]++
      }
      for (let c = 0; c < fw * fh; c++) {
        if (sn[c] < 3) continue
        const vx = sx[c] / sn[c]
        const vy = sy[c] / sn[c]
        if (Math.hypot(vx, vy) < 0.22) continue
        arrows.push({ x: (c % fw) * FLOW + FLOW / 2, y: Math.floor(c / fw) * FLOW + FLOW / 2, vx, vy, n: sn[c] })
      }
    }
    this.arrows = arrows
  }

  /** People per m² at a ground point, from the last refresh. */
  densityAt(x: number, y: number): number {
    const gx = Math.floor(x / CELL)
    const gy = Math.floor(y / CELL)
    if (gx < 0 || gy < 0 || gx >= this.gw || gy >= this.gh) return 0
    return this.ground.field[gy * this.gw + gx]
  }

  place(cam: Camera, showHeat: boolean, showFlow: boolean): void {
    this.heat.visible = showHeat
    this.heatUpper.visible = showHeat && this.upperZ > 0
    if (showHeat) {
      const [a, b, c, d, tx, ty] = groundMatrix(cam)
      const m = new Matrix(a, b, c, d, tx, ty)
      m.append(new Matrix(HCELL, 0, 0, HCELL, 0, 0))
      this.heat.setFromMatrix(m)
      // the same plane lifted to deck height: an orthographic lift is a straight screen offset
      const up = m.clone()
      up.ty -= this.upperZ * cam.scale * Math.sin(cam.tilt)
      this.heatUpper.setFromMatrix(up)
    }
    this.drawColumns(cam, showHeat)
    this.drawFlow(cam, showFlow)
  }

  private drawColumns(cam: Camera, show: boolean): void {
    const g = this.columns
    g.clear()
    if (!show || !this.cols.length) return
    const half = COL / 2 - 0.18
    const sorted = [...this.cols].sort((p, q) => depthOf(cam, p.x, p.y, 0) - depthOf(cam, q.x, q.y, 0))
    const pt: ScreenPoint = { x: 0, y: 0, depth: 0 }
    const sy = Math.sin(cam.yaw)
    const cy = Math.cos(cam.yaw)
    for (const col of sorted) {
      const h = Math.min(7, col.density * 1.1)
      const z0 = col.z
      const color = col.status === 'critical' ? px.red : CONGESTION_TINT
      const corners = [
        [col.x - half, col.y - half],
        [col.x + half, col.y - half],
        [col.x + half, col.y + half],
        [col.x - half, col.y + half],
      ]
      if (cam.tilt > 0.02) {
        for (let i = 0; i < 4; i++) {
          const [ax, ay] = corners[i]
          const [bx, by] = corners[(i + 1) % 4]
          const nx = by - ay
          const ny = -(bx - ax)
          if (sy * nx + cy * ny <= 0) continue
          const flat: number[] = []
          for (const [x, y, z] of [
            [ax, ay, z0],
            [bx, by, z0],
            [bx, by, z0 + h],
            [ax, ay, z0 + h],
          ]) {
            project(cam, x, y, z, pt)
            flat.push(pt.x, pt.y)
          }
          g.poly(flat, true).fill({ color: shade(color, 0.7), alpha: 0.28 })
        }
      }
      const top: number[] = []
      for (const [x, y] of corners) {
        project(cam, x, y, z0 + h, pt)
        top.push(pt.x, pt.y)
      }
      g.poly(top, true).fill({ color, alpha: 0.45 }).stroke({ width: 1, color, alpha: 0.9 })
    }
  }

  private drawFlow(cam: Camera, show: boolean): void {
    const g = this.flow
    g.clear()
    if (!show) return
    const a: ScreenPoint = { x: 0, y: 0, depth: 0 }
    const b: ScreenPoint = { x: 0, y: 0, depth: 0 }
    for (const ar of this.arrows) {
      const sp = Math.hypot(ar.vx, ar.vy)
      const len = Math.min(3.2, 1.2 + sp * 1.6)
      const ux = ar.vx / sp
      const uy = ar.vy / sp
      const x0 = ar.x - ux * len * 0.5
      const y0 = ar.y - uy * len * 0.5
      const x1 = ar.x + ux * len * 0.5
      const y1 = ar.y + uy * len * 0.5
      project(cam, x0, y0, 0.05, a)
      project(cam, x1, y1, 0.05, b)
      g.moveTo(a.x, a.y).lineTo(b.x, b.y)
      const hx = -uy * 0.45
      const hy = ux * 0.45
      const p1 = project(cam, x1 - ux * 0.7 + hx, y1 - uy * 0.7 + hy, 0.05, { x: 0, y: 0, depth: 0 })
      const p2 = project(cam, x1 - ux * 0.7 - hx, y1 - uy * 0.7 - hy, 0.05, { x: 0, y: 0, depth: 0 })
      g.moveTo(p1.x, p1.y).lineTo(b.x, b.y).lineTo(p2.x, p2.y)
    }
    g.stroke({ width: 1.4, color: 0xffffff, alpha: 0.55, cap: 'round', join: 'round' })
  }

  /** Three box-blur passes of radius r on a gw × gh grid: close to a Gaussian, in time independent of r. */
  private smooth(f: Float32Array, r: number, gw: number, gh: number, tmp: Float32Array): void {
    for (let pass = 0; pass < 3; pass++) this.blur(f, tmp, r, gw, gh)
  }

  /** One separable box blur with a running sum; edges clamp. */
  private blur(f: Float32Array, tmp: Float32Array, r: number, gw: number, gh: number): void {
    const n = 2 * r + 1
    for (let j = 0; j < gh; j++) {
      const row = j * gw
      let s = 0
      for (let k = -r; k <= r; k++) s += f[row + Math.min(gw - 1, Math.max(0, k))]
      for (let i = 0; i < gw; i++) {
        tmp[row + i] = s / n
        s += f[row + Math.min(gw - 1, i + r + 1)] - f[row + Math.max(0, i - r)]
      }
    }
    for (let i = 0; i < gw; i++) {
      let s = 0
      for (let k = -r; k <= r; k++) s += tmp[Math.min(gh - 1, Math.max(0, k)) * gw + i]
      for (let j = 0; j < gh; j++) {
        f[j * gw + i] = s / n
        s += tmp[Math.min(gh - 1, j + r + 1) * gw + i] - tmp[Math.max(0, j - r) * gw + i]
      }
    }
  }

  destroy(): void {
    this.ground.texture.destroy(true)
    this.upper.texture.destroy(true)
  }
}
