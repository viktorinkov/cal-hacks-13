/**
 * Simulated people as standing figures in one ParticleContainer, depth-sorted each frame so nearer
 * people overlap farther ones, plus movement trails inked into a ground-space render texture.
 * Observed people (camera tracks) and the same-seed baseline are separate containers with their own
 * marks, so a simulated person can never be drawn as an observed one.
 */
import { Container, Matrix, Particle, ParticleContainer, RenderTexture, Sprite, Graphics, type Renderer, type Texture } from 'pixi.js'
import { EntityKind, type Vec2, type Venue } from '@/contracts/domain'
import type { ElevationAt } from '@/lib/elevation'
import { mapPalette, particleColor } from '../palette'
import { groundMatrix, project, type Camera, type ScreenPoint } from '../projection'
import { personTexture, ringTexture, trailTexture } from '../textures'
import { personWidthPx } from '../personPicking'

export const CLASS_NONE = 0
export const CLASS_LANE = 1
export const CLASS_NEAR = 2

/** Pixels per metre on the trail sheet. The sheet has to stay under the GPU texture limit (the floor is ~228 m). */
const TRAIL_PPM = 12
const TRAIL_PAD = 3
/** Slower than this, m/s, and a person is standing: they leave no trail. */
const TRAIL_MIN_SPEED = 0.3
/** Length and width of one comet, in metres on the floor. The bright head leads. */
const TRAIL_LEN = 2.1
const TRAIL_WIDE = 0.46
/** White ink per stamp. The texture carries the taper from head to tail. */
const TRAIL_INK = 0.9
const TRAIL_INK_MARKED = 1
/** Fraction of the previous frame kept. A short ghost, then nothing — no path left on the floor. */
const TRAIL_KEEP = 0.36
/** Metres to set the bright head back from the feet. */
const TRAIL_BACK = 0.05
/** The sheet itself. */
const TRAIL_ALPHA = 1
/** Structures lower than this, in metres, never hide a trail: tables, booths, the stage lip. */
const COVER_MIN_HEIGHT = 2

/** Raised geometry that hides the floor beneath and behind it: a footprint and the height of its top at each corner. */
export interface Cover {
  points: Vec2[]
  tops: number[]
}

/**
 * The decks, the stair flights (rising from the floor to the deck) and the tall walls and rooms. The 3D
 * hall is drawn under the map's canvas, so the trails are cut out wherever one of these stands in the way.
 */
export function raisedCovers(venue: Venue): Cover[] {
  const covers: Cover[] = []
  for (const deck of venue.platforms ?? []) covers.push({ points: deck.polygon, tops: deck.polygon.map(() => deck.elevationM) })
  for (const flight of venue.stairs ?? []) {
    const vx = flight.top.x - flight.bottom.x
    const vy = flight.top.y - flight.bottom.y
    const len2 = vx * vx + vy * vy || 1
    const along = (q: Vec2) => Math.max(0, Math.min(1, ((q.x - flight.bottom.x) * vx + (q.y - flight.bottom.y) * vy) / len2))
    covers.push({ points: flight.polygon, tops: flight.polygon.map((q) => along(q) * flight.topElevationM) })
  }
  for (const st of venue.structures) {
    const top = st.baseM + st.heightM
    if (top >= COVER_MIN_HEIGHT) covers.push({ points: st.footprint, tops: st.footprint.map(() => top) })
  }
  return covers
}

export class CrowdLayer {
  /** One container per depth slice, interleaved with structures for occlusion. */
  readonly slices: ParticleContainer[]
  readonly ghosts: ParticleContainer
  readonly trails: Sprite
  /** The raised geometry's outline on screen. The trails are masked out inside it; add it to the scene beside them. */
  readonly cover = new Graphics()
  private readonly covers: Cover[]
  private readonly personTex: Texture
  private readonly trailTex: Texture
  private readonly ringTex: Texture
  private readonly pools: Particle[][]
  private readonly ghostPool: Particle[] = []
  private readonly inkPool: Particle[] = []
  private readonly ink: ParticleContainer
  private readonly inkRoot = new Container()
  /** Two ground sheets. Each frame the older one is copied, dimmed, onto the other, then the new steps are stamped. */
  private readonly sheets: [RenderTexture, RenderTexture]
  private readonly fadeSprite: Sprite
  private front = 0
  private keys = new Float64Array(0)
  private wipe = true
  private inkPrev = new Float32Array(0)
  private inkT = 0
  private readonly worldW: number
  private readonly worldH: number

  private readonly elevation: ElevationAt

  constructor(worldW: number, worldH: number, sliceCount: number, elevation: ElevationAt, covers: Cover[] = []) {
    this.elevation = elevation
    this.covers = covers
    this.worldW = worldW
    this.worldH = worldH
    this.personTex = personTexture()
    this.trailTex = trailTexture()
    this.ringTex = ringTexture(24)
    this.slices = Array.from({ length: sliceCount }, () => new ParticleContainer({ dynamicProperties: { position: true, color: true, vertex: true } }))
    this.pools = this.slices.map(() => [])
    this.ghosts = new ParticleContainer({ dynamicProperties: { position: true, color: true, vertex: true } })
    this.ink = new ParticleContainer({ dynamicProperties: { position: true, color: true, vertex: true, rotation: true } })
    this.inkRoot.addChild(this.ink)
    const sheet = () =>
      RenderTexture.create({
        width: Math.ceil((worldW + TRAIL_PAD * 2) * TRAIL_PPM),
        height: Math.ceil((worldH + TRAIL_PAD * 2) * TRAIL_PPM),
        resolution: 1,
      })
    this.sheets = [sheet(), sheet()]
    this.fadeSprite = new Sprite(this.sheets[0])
    this.trails = new Sprite(this.sheets[0])
    this.trails.alpha = TRAIL_ALPHA
    if (covers.length) this.trails.setMask({ mask: this.cover, inverse: true })
  }

  private ensure(pool: Particle[], container: ParticleContainer, n: number, texture: Texture): void {
    while (pool.length < n) {
      const person = texture === this.personTex
      const p = new Particle({
        texture,
        // The comet's bright head sits at 86% across the texture, so that point stays on the feet.
        anchorX: person ? 0.5 : texture === this.trailTex ? 0.86 : 0.5,
        anchorY: person ? 1 : 0.5,
      })
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
    this.drawCover(cam)
  }

  /** Each cover as a solid from the floor to its top: the floor beneath it and behind it is out of sight. */
  private drawCover(cam: Camera): void {
    const g = this.cover
    g.clear()
    const pt: ScreenPoint = { x: 0, y: 0, depth: 0 }
    const sides = cam.tilt > 0.02
    for (const { points, tops } of this.covers) {
      const n = points.length
      const base: number[] = []
      const roof: number[] = []
      for (let i = 0; i < n; i++) {
        project(cam, points[i].x, points[i].y, 0, pt)
        base.push(pt.x, pt.y)
        project(cam, points[i].x, points[i].y, tops[i], pt)
        roof.push(pt.x, pt.y)
      }
      g.poly(base, true).fill(0xffffff)
      if (!sides) continue
      g.poly(roof, true).fill(0xffffff)
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n
        g.poly([base[2 * i], base[2 * i + 1], base[2 * j], base[2 * j + 1], roof[2 * j], roof[2 * j + 1], roof[2 * i], roof[2 * i + 1]], true).fill(0xffffff)
      }
    }
  }

  update(opts: {
    renderer: Renderer
    cam: Camera
    positions: Float32Array
    count: number
    kinds: Uint8Array | undefined
    /** 0 walking, 1 standing, 2 seated. */
    poses?: Uint8Array
    /** Floor under each person. When set, a balcony does not lift the people walking beneath it. */
    heights?: Float32Array
    classes: Uint8Array
    showPeople: boolean
    showTrails: boolean
    stale: boolean
    inking: boolean
    /** The bucket a person at (across, depth) belongs in: after every structure they are in front of. */
    bucketOf: (rx: number, ry: number) => number
  }): void {
    const { cam, positions, count, kinds, poses, classes, stale, bucketOf } = opts
    const heights = opts.heights && opts.heights.length === count ? opts.heights : null
    this.ensure(this.inkPool, this.ink, count, this.trailTex)
    for (const c of this.slices) c.visible = opts.showPeople
    const used = new Array<number>(this.slices.length).fill(0)

    const cy = Math.cos(cam.yaw)
    const sy = Math.sin(cam.yaw)
    const ct = Math.cos(cam.tilt)
    const st = Math.sin(cam.tilt)
    const s = cam.scale
    // level of detail: dots at overview zoom, standing figures once a person is big enough to read.
    // Close in, the figure grows until the dot of the i is a real circle.
    const d = personWidthPx(s)
    const unit = d / this.personTex.width

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
      const z = (heights ? heights[i]! : this.elevation(x, y)) + (seated ? 0.42 : 0)
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
      for (const sheet of this.sheets) {
        opts.renderer.render({ container: this.inkRoot, target: sheet, clear: true, clearColor: [0, 0, 0, 0] })
      }
      this.front = 0
      this.trails.texture = this.sheets[0]
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
        const vx = x - this.inkPrev[2 * i]
        const vy = y - this.inkPrev[2 * i + 1]
        const step = Math.hypot(vx, vy)
        const moved = known && step > minStep
        this.inkPrev[2 * i] = x
        this.inkPrev[2 * i + 1] = y
        // trails are floor marks; nobody inks the ground from a deck
        if (!moved || (heights ? heights[i]! : this.elevation(x, y)) > 0.3) {
          q.color = 0
          continue
        }
        if (poses && poses[i] !== 0) {
          q.color = 0
          continue
        }
        // Comet behind the feet: long along the step, narrow across it, bright end toward the person.
        const len = step || 1
        q.x = (x - (vx / len) * TRAIL_BACK + TRAIL_PAD) * TRAIL_PPM
        q.y = (y - (vy / len) * TRAIL_BACK + TRAIL_PAD) * TRAIL_PPM
        q.rotation = Math.atan2(vy, vx)
        q.scaleX = (TRAIL_LEN * TRAIL_PPM) / this.trailTex.width
        q.scaleY = (TRAIL_WIDE * TRAIL_PPM) / this.trailTex.height
        const cls = classes[i]
        q.color = particleColor(0xffffff, cls ? TRAIL_INK_MARKED : TRAIL_INK)
      }
      for (let i = count; i < this.inkPool.length; i++) this.inkPool[i].color = 0
      // Copy the previous sheet onto the other one, dimmed, then stamp the new step on top.
      // That is the fade: the bright end stays by the feet and the tail dies in about a second.
      const src = this.sheets[this.front]
      const dst = this.sheets[1 - this.front]
      this.fadeSprite.texture = src
      this.fadeSprite.alpha = TRAIL_KEEP
      opts.renderer.render({ container: this.fadeSprite, target: dst, clear: true, clearColor: [0, 0, 0, 0] })
      opts.renderer.render({ container: this.inkRoot, target: dst, clear: false })
      this.front = 1 - this.front
      this.trails.texture = dst
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
    this.cover.destroy()
    this.fadeSprite.destroy()
    this.sheets[0].destroy(true)
    this.sheets[1].destroy(true)
    this.personTex.destroy(true)
    this.trailTex.destroy(true)
    this.ringTex.destroy(true)
  }

  get bounds(): { w: number; h: number } {
    return { w: this.worldW, h: this.worldH }
  }
}
