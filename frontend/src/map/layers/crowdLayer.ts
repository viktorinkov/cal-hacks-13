/**
 * Simulated people as standing figures in one ParticleContainer, depth-sorted each frame so nearer
 * people overlap farther ones, plus movement trails inked into a ground-space render texture.
 * Observed people (camera tracks) and the same-seed baseline are separate containers with their own
 * marks, so a simulated person can never be drawn as an observed one.
 */
import { Container, Matrix, Particle, ParticleContainer, RenderTexture, Sprite, Graphics, type Renderer, type Texture } from 'pixi.js'
import { EntityKind } from '@/contracts/domain'
import type { ElevationAt } from '@/lib/elevation'
import { mapPalette, particleColor } from '../palette'
import { groundMatrix, type Camera } from '../projection'
import { dotTexture, personTexture, ringTexture } from '../textures'

export const CLASS_NONE = 0
export const CLASS_LANE = 1
export const CLASS_NEAR = 2

const TRAIL_PPM = 10
const TRAIL_PAD = 3
/** Slower than this, m/s, and a person is standing: they leave no trail. */
const TRAIL_MIN_SPEED = 0.3

export class CrowdLayer {
  /** One container per depth slice, interleaved with structures for occlusion. */
  readonly slices: ParticleContainer[]
  readonly ghosts: ParticleContainer
  readonly trails: Sprite
  private readonly personTex: Texture
  private readonly dotTex: Texture
  private readonly ringTex: Texture
  private readonly pools: Particle[][]
  private readonly ghostPool: Particle[] = []
  private readonly inkPool: Particle[] = []
  private readonly ink: ParticleContainer
  private readonly inkRoot = new Container()
  private readonly eraseRoot = new Container()
  private readonly rt: RenderTexture
  private keys = new Float64Array(0)
  private frame = 0
  private wipe = true
  private inkPrev = new Float32Array(0)
  private inkT = 0
  private readonly worldW: number
  private readonly worldH: number

  private readonly elevation: ElevationAt

  constructor(worldW: number, worldH: number, sliceCount: number, elevation: ElevationAt) {
    this.elevation = elevation
    this.worldW = worldW
    this.worldH = worldH
    this.personTex = personTexture()
    this.dotTex = dotTexture(16, 6)
    this.ringTex = ringTexture(24)
    this.slices = Array.from({ length: sliceCount }, () => new ParticleContainer({ dynamicProperties: { position: true, color: true, vertex: true } }))
    this.pools = this.slices.map(() => [])
    this.ghosts = new ParticleContainer({ dynamicProperties: { position: true, color: true, vertex: true } })
    this.ink = new ParticleContainer({ dynamicProperties: { position: true, color: true, vertex: false } })
    this.inkRoot.addChild(this.ink)
    this.rt = RenderTexture.create({
      width: Math.ceil((worldW + TRAIL_PAD * 2) * TRAIL_PPM),
      height: Math.ceil((worldH + TRAIL_PAD * 2) * TRAIL_PPM),
      resolution: 1,
    })
    const erase = new Graphics().rect(0, 0, this.rt.width, this.rt.height).fill({ color: 0x000000, alpha: 0.08 })
    erase.blendMode = 'erase'
    this.eraseRoot.addChild(erase)
    this.trails = new Sprite(this.rt)
  }

  private ensure(pool: Particle[], container: ParticleContainer, n: number, texture: Texture): void {
    while (pool.length < n) {
      const p = new Particle({ texture, anchorX: 0.5, anchorY: texture === this.personTex ? 1 : 0.5 })
      p.alpha = 0
      pool.push(p)
      container.addParticle(p)
    }
  }

  resetTrails(): void {
    this.wipe = true
  }

  /** Place the trail texture on the ground plane. */
  placeTrails(cam: Camera, visible: boolean): void {
    this.trails.visible = visible
    if (!visible) return
    const [a, b, c, d, tx, ty] = groundMatrix(cam)
    const m = new Matrix(a, b, c, d, tx, ty)
    m.append(new Matrix(1 / TRAIL_PPM, 0, 0, 1 / TRAIL_PPM, -TRAIL_PAD, -TRAIL_PAD))
    this.trails.setFromMatrix(m)
  }

  update(opts: {
    renderer: Renderer
    cam: Camera
    positions: Float32Array
    count: number
    kinds: Uint8Array | undefined
    /** 0 walking, 1 standing, 2 seated. */
    poses?: Uint8Array
    classes: Uint8Array
    showPeople: boolean
    showTrails: boolean
    stale: boolean
    inking: boolean
    /** The bucket a person at (across, depth) belongs in: after every structure they are in front of. */
    bucketOf: (rx: number, ry: number) => number
  }): void {
    const { cam, positions, count, kinds, poses, classes, stale, bucketOf } = opts
    this.ensure(this.inkPool, this.ink, count, this.dotTex)
    for (const c of this.slices) c.visible = opts.showPeople
    const used = new Array<number>(this.slices.length).fill(0)

    const cy = Math.cos(cam.yaw)
    const sy = Math.sin(cam.yaw)
    const ct = Math.cos(cam.tilt)
    const st = Math.sin(cam.tilt)
    const s = cam.scale
    // level of detail: dots at overview zoom, standing figures once a person is big enough to read.
    // `d` is the old circle's width. The head is the widest part of the i, and it stays that wide.
    const lod = Math.max(0, Math.min(1, (s - 10) / 8))
    const span = Math.min(15, 0.42 * s)
    const d = 2.6 + (span - 2.6) * lod
    const unit = (d * 27) / 32 / 30.8

    // depth sort: far first. Key packs quantised depth and index into one float.
    if (this.keys.length < count) this.keys = new Float64Array(count * 2)
    const keys = this.keys.subarray(0, count)
    for (let i = 0; i < count; i++) {
      const ry = sy * (positions[2 * i] - cam.cx) + cy * (positions[2 * i + 1] - cam.cy)
      keys[i] = Math.floor((ry + 2000) * 64) * 8192 + i
    }
    keys.sort()

    for (let k = 0; k < count; k++) {
      const i = keys[k] % 8192
      const x = positions[2 * i]
      const y = positions[2 * i + 1]
      const dx = x - cam.cx
      const dy = y - cam.cy
      const ry = sy * dx + cy * dy
      // people on a stand or a stair stand on it, and sort with it
      const seated = poses?.[i] === 2
      // Chair rails are about 0.46 m tall. Sitters are drawn on the seat, not on the floor beside it.
      const z = this.elevation(x, y) + (seated ? 0.42 : 0)
      const slice = Math.min(this.slices.length - 1, bucketOf(cy * dx - sy * dy, ry))
      const pool = this.pools[slice]
      if (pool.length <= used[slice]) this.ensure(pool, this.slices[slice], used[slice] + 64, this.personTex)
      const p = pool[used[slice]++]
      p.x = cam.ax + s * (cy * dx - sy * dy)
      p.y = cam.ay + s * (ry * ct - z * st)
      const kind = kinds ? kinds[i] : EntityKind.SimAttendee
      const cls = classes[i]
      let color = mapPalette.person
      let alpha = 0.94
      let scale = 1
      if (kind === EntityKind.SimResponder) {
        color = mapPalette.responder
        alpha = 1
        scale = 1.35
      } else if (cls === CLASS_NEAR) {
        color = mapPalette.personNear
        alpha = 1
        scale = 1.12
      } else if (cls === CLASS_LANE) {
        color = mapPalette.personLane
        alpha = 1
        scale = 1.05
      }
      if (stale) {
        color = 0x8a8c92
        alpha = 0.35
      }
      const seatedScale = seated ? 0.82 : 1
      p.scaleX = unit * scale * seatedScale
      p.scaleY = unit * scale * seatedScale
      p.color = particleColor(color, alpha)
    }
    this.pools.forEach((pool, k) => {
      for (let j = used[k]; j < pool.length; j++) pool[j].color = 0
    })

    // trails, in ground space
    if (this.wipe) {
      opts.renderer.render({ container: this.inkRoot, target: this.rt, clear: true, clearColor: [0, 0, 0, 0] })
      this.wipe = false
    }
    if (opts.showTrails && opts.inking && count > 0) {
      // speed since the last stamp: only walkers ink, so nobody standing gets a lit disc under them
      const now = performance.now()
      const dtS = (now - this.inkT) / 1000
      const known = this.inkPrev.length === count * 2 && dtS > 0 && dtS < 0.5
      if (this.inkPrev.length !== count * 2) this.inkPrev = new Float32Array(count * 2)
      const minStep = TRAIL_MIN_SPEED * dtS
      for (let i = 0; i < count; i++) {
        const q = this.inkPool[i]
        const x = positions[2 * i]
        const y = positions[2 * i + 1]
        const moved = known && Math.hypot(x - this.inkPrev[2 * i], y - this.inkPrev[2 * i + 1]) > minStep
        this.inkPrev[2 * i] = x
        this.inkPrev[2 * i + 1] = y
        // trails are floor marks; nobody inks the ground from a deck
        if (!moved || this.elevation(x, y) > 0.3) {
          q.color = 0
          continue
        }
        if (poses && poses[i] !== 0) {
          q.color = 0
          continue
        }
        q.x = (positions[2 * i] + TRAIL_PAD) * TRAIL_PPM
        q.y = (positions[2 * i + 1] + TRAIL_PAD) * TRAIL_PPM
        q.scaleX = q.scaleY = 0.26
        const cls = classes[i]
        const color = cls === CLASS_NEAR ? mapPalette.personNear : cls === CLASS_LANE ? mapPalette.personLane : mapPalette.person
        q.color = particleColor(color, cls ? 0.09 : 0.035)
      }
      for (let i = count; i < this.inkPool.length; i++) this.inkPool[i].color = 0
      // a faint stamp every other frame and a slow erase: walkers leave streaks that fade
      const f = this.frame++
      if (f % 6 === 0) opts.renderer.render({ container: this.eraseRoot, target: this.rt, clear: false })
      if (f % 2 === 0) opts.renderer.render({ container: this.inkRoot, target: this.rt, clear: false })
      this.inkT = now
    }
  }

  /** The same-seed run without guidance, drawn as faint lavender rings. */
  updateGhosts(cam: Camera, positions: Float32Array | null, count: number, visible: boolean): void {
    this.ghosts.visible = visible && !!positions
    if (!positions || !visible) return
    this.ensure(this.ghostPool, this.ghosts, count, this.ringTex)
    const s = cam.scale
    const size = Math.min(14, Math.max(3, 0.5 * s)) / 24
    const cy = Math.cos(cam.yaw)
    const sy = Math.sin(cam.yaw)
    const ct = Math.cos(cam.tilt)
    for (let i = 0; i < count; i++) {
      const p = this.ghostPool[i]
      const dx = positions[2 * i] - cam.cx
      const dy = positions[2 * i + 1] - cam.cy
      const z = this.elevation(positions[2 * i], positions[2 * i + 1])
      p.x = cam.ax + s * (cy * dx - sy * dy)
      p.y = cam.ay + s * ((sy * dx + cy * dy) * ct - z * Math.sin(cam.tilt))
      p.scaleX = p.scaleY = size
      p.color = particleColor(mapPalette.ghost, 0.5)
    }
    for (let i = count; i < this.ghostPool.length; i++) this.ghostPool[i].color = 0
  }

  destroy(): void {
    this.rt.destroy(true)
    this.personTex.destroy(true)
    this.dotTex.destroy(true)
    this.ringTex.destroy(true)
  }

  get bounds(): { w: number; h: number } {
    return { w: this.worldW, h: this.worldH }
  }
}
