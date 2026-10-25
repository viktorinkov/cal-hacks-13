/**
 * The show: an upright LED wall cycling pastel colour, the lighting truss, and soft beams sweeping
 * the pit. All of it drops to a dim white wash while an incident is open, the way a production
 * team would bring the house lights up.
 */
import { Graphics } from 'pixi.js'
import type { Stage } from '@/contracts/domain'
import { px } from '@/lib/tokens'
import { project, type Camera, type ScreenPoint } from '../projection'

const BEAM_COLORS = [px.sectionFront, px.sectionFood, px.sectionFloor, px.sectionWing, px.sectionConcourse, 0xffffff]

/**
 * Moving heads. Each sweeps its light pool over the crowd on a slow Lissajous path, so the floor
 * always has a few soft pools drifting across it.
 */
interface MovingHead {
  x: number
  y: number
  z: number
  /** Centre, reach and speed of the sweep, in metres and radians per second. */
  cx: number
  cy: number
  ax: number
  ay: number
  wx: number
  wy: number
  phase: number
  radius: number
}

function lerpColor(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 0xff) + ((((b >> 16) & 0xff) - ((a >> 16) & 0xff)) * t)
  const g = ((a >> 8) & 0xff) + ((((b >> 8) & 0xff) - ((a >> 8) & 0xff)) * t)
  const bl = (a & 0xff) + (((b & 0xff) - (a & 0xff)) * t)
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl)
}

function hsl(h: number, s: number, l: number): number {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255)
}

export class StageLayer {
  readonly beams = new Graphics()
  readonly wall = new Graphics()
  private readonly stage: Stage | undefined
  private level = 1
  private readonly a: ScreenPoint = { x: 0, y: 0, depth: 0 }
  private readonly b: ScreenPoint = { x: 0, y: 0, depth: 0 }
  private readonly c: ScreenPoint = { x: 0, y: 0, depth: 0 }
  private readonly d: ScreenPoint = { x: 0, y: 0, depth: 0 }

  private drawBeams(cam: Camera, t: number, _trussH: number): void {
    const g = this.beams
    const s = cam.scale
    const ct = Math.cos(cam.tilt)
    // a soft pulse on every other beat, so the room breathes with the music without strobing
    const beat = 0.9 + 0.1 * Math.max(0, Math.sin(t * Math.PI * 2 * 1.03)) ** 3
    this.heads.forEach((h, k) => {
      const px = h.cx + h.ax * Math.sin(t * h.wx + h.phase)
      const py = h.cy + h.ay * Math.sin(t * h.wy + h.phase * 0.7)
      // colour drifts through the palette, each head out of step with the others
      const ci = (t * 0.03 + k * 0.37) % BEAM_COLORS.length
      const c0 = BEAM_COLORS[Math.floor(ci)]
      const c1 = BEAM_COLORS[(Math.floor(ci) + 1) % BEAM_COLORS.length]
      const f = ci - Math.floor(ci)
      const color = lerpColor(c0, c1, f)
      const src = project(cam, h.x, h.y, h.z, this.a)
      const pool = project(cam, px, py, 0, this.b)
      const ex = pool.x - src.x
      const ey = pool.y - src.y
      const el = Math.hypot(ex, ey) || 1
      const nx = -ey / el
      const ny = ex / el
      const r = h.radius * s
      const rs = 0.25 * s
      const alpha = 0.1 * this.level * beat
      g.poly([src.x + nx * rs, src.y + ny * rs, pool.x + nx * r, pool.y + ny * r * ct, pool.x - nx * r, pool.y - ny * r * ct, src.x - nx * rs, src.y - ny * rs], true).fill({
        color,
        alpha,
      })
      g.ellipse(pool.x, pool.y, r * 1.35, r * 1.35 * ct).fill({ color, alpha: alpha * 1.1 })
      g.ellipse(pool.x, pool.y, r, r * ct).fill({ color, alpha: alpha * 2.4 })
      g.ellipse(pool.x, pool.y, r * 0.5, r * 0.5 * ct).fill({ color: 0xffffff, alpha: alpha * 1.2 })
      g.circle(src.x, src.y, Math.max(1.5, 0.2 * s)).fill({ color, alpha: 0.9 * this.level })
    })
  }

  private readonly heads: MovingHead[]

  constructor(stage: Stage | undefined, towers: { x: number; y: number; z: number }[] = []) {
    this.stage = stage
    this.beams.blendMode = 'add'
    const truss = stage?.truss ?? []
    const H = (stage?.trussHeightM ?? 9) - 0.4
    this.heads = [
      // front truss: wide sweeps across the whole floor
      ...truss.map((p, k) => ({
        x: p.x,
        y: p.y,
        z: H,
        cx: 50 + (p.x - 50) * 0.5,
        cy: 21,
        ax: 26,
        ay: 11,
        wx: 0.1 + k * 0.016,
        wy: 0.13 + k * 0.012,
        phase: k * 1.7,
        radius: 3.4,
      })),
      // towers out in the crowd: tighter pools on their own side
      ...towers.map((tw, k) => ({
        x: tw.x,
        y: tw.y,
        z: tw.z,
        cx: tw.x + (tw.x < 50 ? 8 : -8),
        cy: tw.y - 6,
        ax: 10,
        ay: 7,
        wx: 0.17 + k * 0.022,
        wy: 0.12 + k * 0.018,
        phase: 2.4 + k * 2.1,
        radius: 2.6,
      })),
    ]
  }

  draw(cam: Camera, time: number, dt: number, incident: boolean, animate: boolean, show: boolean): void {
    const st = this.stage
    this.wall.clear()
    this.beams.clear()
    if (!st || !show) return
    this.level += ((incident ? 0.3 : 1) - this.level) * Math.min(1, dt * 2)
    const t = animate ? time : 0
    const { a, b, c, d } = this

    // LED wall: panels between its bottom and top edge
    if (st.ledWall) {
      const { from, to, bottomM, topM } = st.ledWall
      const n = 24
      for (let k = 0; k < n; k++) {
        const f0 = k / n
        const f1 = (k + 0.94) / n
        const x0 = from.x + (to.x - from.x) * f0
        const y0 = from.y + (to.y - from.y) * f0
        const x1 = from.x + (to.x - from.x) * f1
        const y1 = from.y + (to.y - from.y) * f1
        const hue = 0.58 + 0.38 * (0.5 + 0.5 * Math.sin(t * 0.18 + f0 * 4.2))
        const lum = 0.42 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.8 + k * 0.55))
        const color = incident ? 0xf2f1ec : hsl(hue % 1, 0.75, 0.72)
        project(cam, x0, y0, bottomM, a)
        project(cam, x1, y1, bottomM, b)
        project(cam, x1, y1, topM, c)
        project(cam, x0, y0, topM, d)
        this.wall.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y], true).fill({ color, alpha: (0.35 + lum * 0.65) * this.level })
      }
      // frame
      project(cam, from.x, from.y, bottomM, a)
      project(cam, to.x, to.y, bottomM, b)
      project(cam, to.x, to.y, topM, c)
      project(cam, from.x, from.y, topM, d)
      this.wall.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y], true).stroke({ width: 1, color: 0x1a1a1e, alpha: 0.9 })
    }

    // truss: two towers and a front beam
    const H = st.trussHeightM
    const left = st.truss[0]
    const right = st.truss[st.truss.length - 1]
    if (left && right) {
      const lx = left.x - 4.5
      const rx = right.x + 4.5
      const fy = left.y + 0.2
      const by = st.polygon[0]?.y ?? 0.6
      for (const [x, y] of [
        [lx, fy],
        [rx, fy],
        [lx, by + 0.4],
        [rx, by + 0.4],
      ]) {
        project(cam, x, y, 0, a)
        project(cam, x, y, H, b)
        this.wall.moveTo(a.x, a.y).lineTo(b.x, b.y)
      }
      for (const [x0, y0, x1, y1] of [
        [lx, fy, rx, fy],
        [lx, by + 0.4, rx, by + 0.4],
        [lx, fy, lx, by + 0.4],
        [rx, fy, rx, by + 0.4],
      ]) {
        project(cam, x0, y0, H, a)
        project(cam, x1, y1, H, b)
        this.wall.moveTo(a.x, a.y).lineTo(b.x, b.y)
      }
      this.wall.stroke({ width: Math.max(1, cam.scale * 0.08), color: 0xc9ccd3, alpha: 0.75 })
    }

    if (cam.tilt < 0.05) return
    this.drawBeams(cam, t, H)
  }
}
