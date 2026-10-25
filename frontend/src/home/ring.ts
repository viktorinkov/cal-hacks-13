import geo from './assets/ring.json'
import { ALERT_RED, COOL_WHITE, LED_GREEN, WHITE, beatAt, kick, mix, palette, type RGB } from './show'

export type RingMode = 'off' | 'boot' | 'compass' | 'breathe' | 'alert' | 'away' | 'exit' | 'lane'

const COUNT = geo.count
const GAP = 2.2

type Pt = [number, number]
const ring = { inner: geo.inner as Pt[], outer: geo.outer as Pt[] }

function along(points: Pt[], deg: number): Pt {
  const a = (((deg % 360) + 360) % 360) / geo.step
  const i0 = Math.floor(a) % points.length
  const i1 = (i0 + 1) % points.length
  const f = a - Math.floor(a)
  return [points[i0][0] + (points[i1][0] - points[i0][0]) * f, points[i0][1] + (points[i1][1] - points[i0][1]) * f]
}

function between(deg: number, t: number): Pt {
  const a = along(ring.inner, deg)
  const b = along(ring.outer, deg)
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

function segment(i: number, from: number, to: number, inset: number) {
  const a0 = geo.phase + i * geo.pitch + inset
  const a1 = geo.phase + (i + 1) * geo.pitch - inset
  const path = new Path2D()
  const steps = 12
  for (let k = 0; k <= steps; k++) {
    const [x, y] = between(a0 + ((a1 - a0) * k) / steps, to)
    if (k === 0) path.moveTo(x, y)
    else path.lineTo(x, y)
  }
  for (let k = steps; k >= 0; k--) {
    const [x, y] = between(a0 + ((a1 - a0) * k) / steps, from)
    path.lineTo(x, y)
  }
  path.closePath()
  return path
}

const SHAPES = Array.from({ length: COUNT }, (_, i) => segment(i, 0.02, 0.98, GAP))
const CORES = Array.from({ length: COUNT }, (_, i) => segment(i, 0.3, 0.72, GAP + 4))

/** Direction of each light from the centre of the face, in the photo, degrees clockwise from east. */
export const ANGLES = Array.from({ length: COUNT }, (_, i) => {
  const [x, y] = between(geo.phase + (i + 0.5) * geo.pitch, 0.5)
  return (Math.atan2(y - geo.center[1], x - geo.center[0]) * 180) / Math.PI
})

const angDist = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180)
const gauss = (x: number) => Math.exp(-x * x)

/** Three quick flashes a second, the pattern every band near a fall shows. */
export function sos(age: number) {
  const f = age - Math.floor(age)
  return f < 0.09 || (f > 0.18 && f < 0.27) || (f > 0.36 && f < 0.45) ? 1 : 0
}

const css = (c: RGB, a: number) =>
  `rgba(${Math.round(Math.min(1, c[0]) * 255)},${Math.round(Math.min(1, c[1]) * 255)},${Math.round(Math.min(1, c[2]) * 255)},${Math.max(0, Math.min(1, a)).toFixed(3)})`

export interface RingOptions {
  /** Glow radius as a share of the canvas width. */
  glow?: number
  /** Called on the first flash of each SOS group, for a buzz. */
  onBuzz?: () => void
}

export class Ring {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private level = new Float32Array(COUNT)
  private colour: RGB[] = Array.from({ length: COUNT }, () => WHITE)
  private last = 0
  private lastBuzz = -1
  private glow: number
  private onBuzz?: () => void
  mode: RingMode = 'off'
  private modeAt = 0
  private after: { mode: RingMode; at: number } | null = null
  /** Where the arc points, in screen degrees clockwise from east. */
  aim = -50
  /** The photo's own rotation on screen, so screen directions can be turned into the ring's. */
  rotation = 0
  /** How hard the band is being spun; lights a chase that runs round the ring. */
  spin = 0
  private spinPhase = 0
  /** How strongly the ring follows the show's beat (0 to 1). */
  beatGlow = 0
  calm = false
  /** Work out the lights without drawing them, for a model that lights its own segments. */
  headless = false

  get levels(): ArrayLike<number> {
    return this.level
  }

  get colours(): readonly RGB[] {
    return this.colour
  }

  constructor(canvas: HTMLCanvasElement, opts: RingOptions = {}) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d context')
    this.ctx = ctx
    this.glow = opts.glow ?? 0.045
    this.onBuzz = opts.onBuzz
    this.resize()
  }

  resize() {
    const r = this.canvas.getBoundingClientRect()
    const w = this.canvas.offsetWidth || r.width
    const h = this.canvas.offsetHeight || r.height
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.max(1, Math.round(w * dpr))
    this.canvas.height = Math.max(1, Math.round(h * dpr))
  }

  set(mode: RingMode, now = performance.now(), then?: { mode: RingMode; after: number }) {
    this.mode = mode
    this.modeAt = now
    this.lastBuzz = -1
    this.after = then ? { mode: then.mode, at: now + then.after } : null
  }

  frame(now: number) {
    if (this.after && now >= this.after.at) {
      const next = this.after.mode
      this.after = null
      this.set(next, now)
    }
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1
    this.last = now
    const age = (now - this.modeAt) / 1000
    const beat = this.calm ? 0.5 : beatAt(now)
    const target = new Float32Array(COUNT)
    const colour: RGB[] = Array.from({ length: COUNT }, () => WHITE)
    const local = (screen: number) => screen - this.rotation

    switch (this.mode) {
      case 'off':
        break
      case 'boot': {
        for (let i = 0; i < COUNT; i++) {
          const order = (((ANGLES[i] + 90) % 360) + 360) % 360
          const on = age * 1000 > (order / 360) * 520
          target[i] = on ? Math.max(0.25, 1 - Math.max(0, age - 0.6) * 1.4) : 0
          colour[i] = WHITE
        }
        break
      }
      case 'compass':
      case 'away': {
        const aim = local(this.aim)
        const width = this.mode === 'away' ? 40 : 50
        for (let i = 0; i < COUNT; i++) {
          const w = Math.max(0, 1 - angDist(ANGLES[i], aim) / width)
          target[i] = Math.pow(w, 1.25)
          colour[i] = LED_GREEN
        }
        break
      }
      case 'breathe': {
        const b = this.calm ? 0.3 : 0.24 + 0.14 * Math.sin(age * 1.7)
        for (let i = 0; i < COUNT; i++) {
          target[i] = b
          colour[i] = WHITE
        }
        break
      }
      case 'alert': {
        const on = this.calm ? 1 : sos(age)
        const group = Math.floor(age)
        if (!this.calm && group !== this.lastBuzz) {
          this.lastBuzz = group
          this.onBuzz?.()
        }
        for (let i = 0; i < COUNT; i++) {
          target[i] = on
          colour[i] = ALERT_RED
        }
        break
      }
      case 'exit': {
        const aim = local(this.aim)
        const u = this.calm ? 0.7 : (age / 1.05) % 1
        const spread = 180 * (1 - u)
        for (let i = 0; i < COUNT; i++) {
          const d = angDist(ANGLES[i], aim)
          const head = gauss((d - spread) / 22)
          const hold = gauss(d / 26) * 0.9
          target[i] = Math.max(head, hold)
          colour[i] = LED_GREEN
        }
        break
      }
      case 'lane': {
        const aim = local(this.aim)
        const b = this.calm ? 1 : 0.8 + 0.2 * Math.sin(age * 7)
        for (let i = 0; i < COUNT; i++) {
          const d = Math.min(angDist(ANGLES[i], aim + 90), angDist(ANGLES[i], aim - 90))
          target[i] = Math.max(0, 1 - d / 42) * b
          colour[i] = COOL_WHITE
        }
        break
      }
    }

    if (this.beatGlow > 0 && !this.calm && (this.mode === 'compass' || this.mode === 'breathe')) {
      const pal = palette(beat)
      const k = kick(beat) * this.beatGlow
      for (let i = 0; i < COUNT; i++) {
        const g = k * (0.22 + 0.2 * ((i + Math.floor(beat)) % 3 === 0 ? 1 : 0))
        if (g > target[i]) {
          colour[i] = mix(colour[i], pal[i % 4], Math.min(1, (g - target[i]) * 3))
          target[i] = g
        }
      }
    }

    if (this.spin > 0.02 && this.mode === 'compass') {
      this.spinPhase += this.spin * dt * 900
      for (let i = 0; i < COUNT; i++) {
        const g = this.spin * gauss(angDist(ANGLES[i], this.spinPhase) / 38)
        if (g > target[i] * 0.8) {
          colour[i] = mix(colour[i], WHITE, Math.min(1, g * 1.5))
          target[i] = Math.max(target[i], g)
        }
      }
    }

    for (let i = 0; i < COUNT; i++) {
      const up = target[i] > this.level[i]
      const rate = this.mode === 'alert' ? 40 : up ? 16 : 7
      this.level[i] += (target[i] - this.level[i]) * (1 - Math.exp(-dt * rate))
      this.colour[i] = target[i] > 0.01 ? mix(this.colour[i], colour[i], 1 - Math.exp(-dt * 14)) : this.colour[i]
    }
    if (!this.headless) this.draw()
  }

  private draw() {
    const { ctx, canvas } = this
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const sx = canvas.width / geo.width
    const sy = canvas.height / geo.height
    ctx.setTransform(sx, 0, 0, sy, 0, 0)
    const blur = canvas.width * this.glow
    for (let i = 0; i < COUNT; i++) {
      const l = this.level[i]
      if (l < 0.01) continue
      const c = this.colour[i]
      ctx.globalCompositeOperation = 'source-over'
      ctx.shadowColor = css(c, Math.min(1, l * 1.1))
      ctx.shadowBlur = blur * (0.5 + 0.5 * l)
      ctx.fillStyle = css(mix(c, WHITE, 0.12), 0.94 * Math.min(1, l * 1.15))
      ctx.fill(SHAPES[i])
      ctx.shadowBlur = 0
      ctx.globalCompositeOperation = 'lighter'
      ctx.fillStyle = css(WHITE, 0.4 * l)
      ctx.fill(CORES[i])
    }
    ctx.globalCompositeOperation = 'source-over'
  }
}

/** Screen position of the face's centre inside an element laid out with the photo's proportions. */
export function faceIn(rect: { left: number; top: number; width: number; height: number }) {
  return {
    x: rect.left + rect.width * (geo.center[0] / geo.width),
    y: rect.top + rect.height * (geo.center[1] / geo.height),
    r: rect.width * 0.29,
  }
}
