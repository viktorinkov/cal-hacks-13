/**
 * Deterministic crowd simulator for the mock backend.
 *
 * A compact social-force model: each simulated attendee walks toward a goal, keeps distance from
 * neighbours and walls, routes between the floor and the concourse through the open passages and
 * up and down the stairs to the raised side stands, and dwells (dances) at its goal. Fixed 0.1 s steps and a seeded PRNG make every run reproducible, and
 * `clone()` forks an identical copy so a baseline can run beside an intervention on the same seed.
 *
 * This stands in for the crowd-modelling team's simulator. It is not a safety model and its numbers
 * are always labelled as simulated in the interface.
 */
import type { Vec2, Venue } from '@/contracts/domain'
import { Path, bbox, newProjectResult } from '@/lib/geometry'
import { Rng } from './rng'

export const SIM_DT = 0.1

const State = {
  Walk: 0,
  Dwell: 1,
  Onlooker: 2,
  Down: 3,
  Anchored: 4,
} as const

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

interface ZoneBox extends Box {
  id: string
  section: string
  area: number
  /** 0 ground, 1 raised stand. */
  level: number
  /** Index into `stands` for raised zones, -1 on the ground. */
  stand: number
}

interface StairRoute {
  stand: number
  rect: Box
  /** On the ground, just off the foot of the stair. */
  bx: number
  by: number
  /** Halfway up: where a person changes level. */
  mx: number
  my: number
  /** On the deck, a step in from the top. */
  tx: number
  ty: number
}

const MAX_WP = 7
const OB_CELL = 4
/** Half width of the lane guidance clears, and how far people keep back from the person, metres. */
const LANE_HALF = 2.4
const KEEP_BACK = 5
/** Bands this far beyond the lane or ring also get the signal, so people about to step in move first. */
const SIGNAL_MARGIN = 1

interface Passage {
  cx: number
  half: number
}

export interface GuidanceField {
  path: Path
  /** How far along the corridor the cleared lane has been revealed, in metres. */
  reveal: number
  laneHalfWidth: number
  keepBackFrom: Vec2 | null
  keepBackRadius: number
  /** Passages the corridor runs through; people who follow their band use another one. */
  blockedPassages: number[]
}

export interface ZoneSample {
  count: number
  density: number
  peak: number
  flowIn: number
  flowOut: number
}

const PASSAGE_Y_TOP = 40
const PASSAGE_Y_BOTTOM = 43
const SPLIT_Y = 41.5

// the front of the floor is where everyone wants to be during a headline set: few leave it, so
// with its long dwell it holds about half the crowd
const NORMAL_WEIGHTS: Record<string, number> = {
  FL: 0.1, FR: 0.1, ML: 0.12, MR: 0.12, WW: 0.01, EW: 0.01, CW: 0.08, CE: 0.08, GA: 0.04, FC: 0.06, GB: 0.04,
  WN: 0.025, WS: 0.025, EN: 0.025, ES: 0.025,
}
const SURGE_WEIGHTS: Record<string, number> = {
  FL: 0.3, FR: 0.1, ML: 0.32, MR: 0.08, WW: 0.02, EW: 0.01, CW: 0.03, CE: 0.02, GA: 0.01, FC: 0.01, GB: 0.01,
  WN: 0.03, WS: 0.03, EN: 0.01, ES: 0.01,
}
const DWELL_MEAN: Record<string, number> = { front: 300, floor: 120, wing: 50, concourse: 55, plaza: 35, food: 80, passage: 2 }

/** The stage front, x from and to, and the barricade line people press against. */
const PIT_X0 = 28.5
const PIT_X1 = 71.5
const PIT_Y = 8.1
/** How hard someone standing in front of the stage leans toward it, m/s². */
const PIT_PRESS = 0.32

export interface CrowdOptions {
  seed: number
  count: number
  venue: Venue
  /** Fixed positions for the attendees who wear physical bands; they keep to a small area. */
  anchors: Vec2[]
  compliance: number
}

export class CrowdSim {
  readonly n: number
  readonly venueW: number
  readonly venueH: number
  x: Float64Array
  y: Float64Array
  vx: Float64Array
  vy: Float64Array
  nvx: Float64Array
  nvy: Float64Array
  v0: Float32Array
  gx: Float64Array
  gy: Float64Array
  ax0: Float64Array
  ay0: Float64Array
  /** 0 on the ground, 1 on a raised stand (stair users switch halfway up). */
  level: Uint8Array
  /** Route waypoints: positions, and the level to switch to on arrival (-1 none). */
  wpX: Float32Array
  wpY: Float32Array
  wpSet: Int8Array
  wpN: Uint8Array
  wpI: Uint8Array
  /** Passage the current route goes through, and the waypoint index of its entry. */
  passOf: Int8Array
  passAt: Int8Array
  goalLevel: Uint8Array
  goalStand: Int8Array
  state: Uint8Array
  timer: Float32Array
  zoneIdx: Int8Array
  comply: Uint8Array
  /** 1 once this attendee's band has been told to step aside or keep back, for the current guidance. */
  signalled: Uint8Array
  rng: Rng
  t = 0
  weights: Record<string, number> = NORMAL_WEIGHTS
  surgeUntil = -1
  field: GuidanceField | null = null
  incident: Vec2 | null = null
  responder = { active: false, path: null as Path | null, s: 0, x: 0, y: 0, vx: 0, vy: 0, target: null as Vec2 | null, arrivedAt: -1, dispatchedAt: -1 }
  /** Live booth. Simulated people are pushed out of it; the medic can still walk in. */
  private keepOut: { x: number; y: number; r: number } | null = null

  // static geometry
  private readonly zones: ZoneBox[]
  /** Obstacles per level: ground structures, and what stands on the decks. */
  private readonly obstacles: Box[][]
  private readonly passages: Passage[]
  /** Deck rectangles, indexed by stand. */
  private readonly stands: Box[]
  private readonly stairs: StairRoute[]
  /** Where people on a stand may be: the decks and the stairs. */
  private readonly upper: Box[]
  // spatial grid, 1 m cells
  private readonly gw: number
  private readonly gh: number
  private readonly cellStart: Int32Array
  private readonly cellCursor: Int32Array
  private readonly cellOf: Int32Array
  private readonly order: Int32Array
  private readonly occ: [Int16Array, Int16Array]
  /** Obstacles near each 4 m cell, per level, so each person only checks what is close. */
  private readonly nearObstacles: Box[][][]
  // flow counters, 60 one-second buckets per zone
  private readonly flowIn: Uint16Array
  private readonly flowOut: Uint16Array
  private lastBucket = 0

  constructor(opts: CrowdOptions) {
    const { venue } = opts
    this.n = opts.count
    this.venueW = venue.width
    this.venueH = venue.height
    this.rng = new Rng(opts.seed)
    const n = this.n
    this.x = new Float64Array(n)
    this.y = new Float64Array(n)
    this.vx = new Float64Array(n)
    this.vy = new Float64Array(n)
    this.nvx = new Float64Array(n)
    this.nvy = new Float64Array(n)
    this.v0 = new Float32Array(n)
    this.gx = new Float64Array(n)
    this.gy = new Float64Array(n)
    this.ax0 = new Float64Array(n)
    this.ay0 = new Float64Array(n)
    this.level = new Uint8Array(n)
    this.wpX = new Float32Array(n * MAX_WP)
    this.wpY = new Float32Array(n * MAX_WP)
    this.wpSet = new Int8Array(n * MAX_WP).fill(-1)
    this.wpN = new Uint8Array(n)
    this.wpI = new Uint8Array(n)
    this.passOf = new Int8Array(n).fill(-1)
    this.passAt = new Int8Array(n).fill(-1)
    this.goalLevel = new Uint8Array(n)
    this.goalStand = new Int8Array(n).fill(-1)
    this.state = new Uint8Array(n)
    this.timer = new Float32Array(n)
    this.zoneIdx = new Int8Array(n).fill(-1)
    this.comply = new Uint8Array(n)
    this.signalled = new Uint8Array(n)

    const toBox = (poly: Vec2[]): Box => {
      const b = bbox(poly)
      return { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h }
    }
    const platforms = venue.platforms ?? []
    this.stands = platforms.map((pl) => toBox(pl.polygon))
    this.zones = venue.zones.map((z) => {
      const b = toBox(z.polygon)
      const stand = (z.elevationM ?? 0) > 0 ? platforms.findIndex((pl) => pl.zoneId === z.zoneId) : -1
      return { id: z.zoneId, section: z.section, area: z.areaM2, ...b, level: stand >= 0 ? 1 : 0, stand }
    })
    const moving = venue.structures.filter((st) => st.blocksMovement)
    this.obstacles = [
      [...venue.obstacles.map((o) => toBox(o.polygon)), ...moving.filter((st) => st.baseM < 1).map((st) => toBox(st.footprint))],
      moving.filter((st) => st.baseM >= 1).map((st) => toBox(st.footprint)),
    ]
    this.stairs = (venue.stairs ?? []).map((st) => {
      const len = Math.hypot(st.top.x - st.bottom.x, st.top.y - st.bottom.y) || 1
      const ux = (st.top.x - st.bottom.x) / len
      const uy = (st.top.y - st.bottom.y) / len
      return {
        stand: platforms.findIndex((pl) => pl.platformId === st.platformId),
        rect: toBox(st.polygon),
        bx: st.bottom.x - ux * 0.8,
        by: st.bottom.y - uy * 0.8,
        mx: (st.bottom.x + st.top.x) / 2,
        my: (st.bottom.y + st.top.y) / 2,
        tx: st.top.x + ux * 1.1,
        ty: st.top.y + uy * 1.1,
      }
    })
    this.upper = [...this.stands, ...this.stairs.map((st) => st.rect)]
    this.passages = venue.walkways
      .filter((w) => w.status === 'open')
      .map((w) => {
        const b = bbox(w.polygon)
        return { cx: b.x + b.w / 2, half: b.w / 2 }
      })

    this.gw = Math.ceil(venue.width)
    this.gh = Math.ceil(venue.height)
    this.cellStart = new Int32Array(this.gw * this.gh + 1)
    this.cellCursor = new Int32Array(this.gw * this.gh)
    this.cellOf = new Int32Array(n)
    this.order = new Int32Array(n)
    this.occ = [new Int16Array(this.gw * this.gh), new Int16Array(this.gw * this.gh)]
    const ow = Math.ceil(venue.width / OB_CELL)
    const oh = Math.ceil(venue.height / OB_CELL)
    this.nearObstacles = this.obstacles.map((list) => {
      const cells: Box[][] = Array.from({ length: ow * oh }, () => [])
      for (const b of list) {
        for (let cy = Math.max(0, Math.floor((b.y0 - 1) / OB_CELL)); cy <= Math.min(oh - 1, Math.floor((b.y1 + 1) / OB_CELL)); cy++) {
          for (let cx = Math.max(0, Math.floor((b.x0 - 1) / OB_CELL)); cx <= Math.min(ow - 1, Math.floor((b.x1 + 1) / OB_CELL)); cx++) {
            cells[cy * ow + cx].push(b)
          }
        }
      }
      return cells
    })
    this.flowIn = new Uint16Array(this.zones.length * 60)
    this.flowOut = new Uint16Array(this.zones.length * 60)

    const rng = this.rng
    for (let i = 0; i < n; i++) {
      this.v0[i] = Math.min(1.45, Math.max(0.65, 1.02 + 0.17 * rng.gauss()))
      this.comply[i] = rng.next() < opts.compliance ? 1 : 0
      if (i < opts.anchors.length) {
        const a = opts.anchors[i]
        this.x[i] = this.ax0[i] = this.gx[i] = a.x
        this.y[i] = this.ay0[i] = this.gy[i] = a.y
        this.state[i] = State.Anchored
        continue
      }
      const z = this.pickZone(true)
      this.samplePoint(z, i)
      this.x[i] = this.gx[i]
      this.y[i] = this.gy[i]
      this.level[i] = this.zones[z].level
      this.state[i] = State.Dwell
      this.timer[i] = rng.range(0, this.dwellMean(z))
    }
    for (let i = 0; i < n; i++) this.zoneIdx[i] = this.zoneAt(this.x[i], this.y[i], this.level[i])
  }

  /** Deep copy, including the PRNG state, so both copies evolve identically until they diverge. */
  clone(): CrowdSim {
    const c = Object.create(CrowdSim.prototype) as CrowdSim
    const src = this as unknown as Record<string, unknown>
    const dst = c as unknown as Record<string, unknown>
    for (const key of Object.keys(src)) {
      const v = src[key]
      if (ArrayBuffer.isView(v)) dst[key] = (v as Float64Array).slice()
      else if (v instanceof Rng) dst[key] = v.clone()
      else dst[key] = v
    }
    c.responder = { ...this.responder }
    c.field = this.field ? { ...this.field } : null
    return c
  }

  // ------------------------------------------------------------ controls

  startSurge(durationS: number): void {
    this.weights = SURGE_WEIGHTS
    this.surgeUntil = this.t + durationS
    const rng = this.rng
    for (let i = 0; i < this.n; i++) {
      if (this.state[i] !== State.Walk && this.state[i] !== State.Dwell) continue
      if (this.y[i] < SPLIT_Y || this.level[i] !== 0) continue
      if (rng.next() < 0.62) {
        const pick = rng.next()
        const zid = pick < 0.5 ? 'FL' : pick < 0.88 ? 'ML' : 'WW'
        this.setGoal(i, this.zones.findIndex((z) => z.id === zid))
      }
    }
  }

  /** Someone is down at `at`. Nearby attendees drift in to look, which is the risk guidance addresses. */
  setIncident(at: Vec2 | null, downAgent: number | null): void {
    const rng = this.rng
    if (!at) {
      for (let i = 0; i < this.n; i++) {
        if (this.state[i] === State.Onlooker) {
          this.state[i] = State.Dwell
          this.timer[i] = rng.range(2, 8)
          this.gx[i] = this.x[i]
          this.gy[i] = this.y[i]
        } else if (this.state[i] === State.Down) {
          this.state[i] = State.Anchored
        }
      }
      this.incident = null
      return
    }
    this.incident = { ...at }
    if (downAgent !== null) {
      this.state[downAgent] = State.Down
      this.vx[downAgent] = this.vy[downAgent] = 0
    }
    for (let i = 0; i < this.n; i++) {
      if (this.state[i] === State.Down || this.state[i] === State.Anchored || this.level[i] !== 0) continue
      const d = Math.hypot(this.x[i] - at.x, this.y[i] - at.y)
      if (d < 7.5 && rng.next() < 0.5) {
        this.state[i] = State.Onlooker
        this.placeOnRing(i, at, rng.range(0.9, 2.1))
      }
    }
  }

  setGuidance(path: Path | null, keepBackFrom: Vec2 | null): void {
    if (!path) {
      // the count stays readable after guidance ends; the next guidance starts it again
      this.field = null
      return
    }
    this.signalled.fill(0)
    const pr = newProjectResult()
    const blockedPassages: number[] = []
    this.passages.forEach((ps, k) => {
      path.project(ps.cx, SPLIT_Y, pr)
      if (pr.distance < ps.half + 1) blockedPassages.push(k)
    })
    this.field = { path, reveal: 0, laneHalfWidth: LANE_HALF, keepBackFrom, keepBackRadius: KEEP_BACK, blockedPassages }
    const rng = this.rng
    for (let i = 0; i < this.n; i++) {
      if (!this.comply[i]) continue
      if (keepBackFrom && this.state[i] === State.Onlooker) this.placeOnRing(i, keepBackFrom, rng.range(5.2, 6.4))
      // still heading for a passage the corridor uses: take another one
      if (this.state[i] === State.Walk && this.passOf[i] >= 0 && blockedPassages.includes(this.passOf[i]) && this.wpI[i] <= this.passAt[i]) {
        this.route(i)
      }
    }
  }

  dispatchResponder(path: Path, target: Vec2): void {
    const r = this.responder
    const start = path.at(0)
    r.active = true
    r.path = path
    r.s = 0
    r.x = start.x
    r.y = start.y
    r.vx = r.vy = 0
    r.target = { ...target }
    r.arrivedAt = -1
    r.dispatchedAt = this.t
  }

  clearResponder(): void {
    this.responder.active = false
    this.responder.path = null
  }

  // ------------------------------------------------------------ queries

  /** Simulated people within `r` metres of `at`. */
  countNear(at: Vec2, r: number): number {
    let c = 0
    const r2 = r * r
    for (let i = 0; i < this.n; i++) {
      if (this.state[i] === State.Down || this.level[i] !== 0) continue
      const dx = this.x[i] - at.x
      const dy = this.y[i] - at.y
      if (dx * dx + dy * dy <= r2) c++
    }
    return c
  }

  /**
   * Bands guidance has signalled so far: everyone who has been in the revealed lane or near the
   * person since it started, and how many of them follow it.
   */
  signalledCount(): { signalled: number; following: number } {
    let signalled = 0
    let following = 0
    for (let i = 0; i < this.n; i++) {
      if (!this.signalled[i]) continue
      signalled++
      if (this.comply[i]) following++
    }
    return { signalled, following }
  }

  /** Simulated bands a path would signal now: people in its lane or near the person. */
  countInGuidanceArea(path: Path, keepBackFrom: Vec2 | null, laneHalfWidth = LANE_HALF + SIGNAL_MARGIN): number {
    const pr = newProjectResult()
    const r = KEEP_BACK + SIGNAL_MARGIN
    let c = 0
    for (let i = 0; i < this.n; i++) {
      if (this.state[i] === State.Down || this.state[i] === State.Anchored || this.level[i] !== 0) continue
      if (keepBackFrom && Math.hypot(this.x[i] - keepBackFrom.x, this.y[i] - keepBackFrom.y) <= r) c++
      else if (path.project(this.x[i], this.y[i], pr).distance <= laneHalfWidth) c++
    }
    return c
  }

  /** Simulated people within `half` metres of the corridor centreline. */
  countOnPath(path: Path, half: number): number {
    const pr = newProjectResult()
    let c = 0
    for (let i = 0; i < this.n; i++) {
      if (this.state[i] === State.Down || this.level[i] !== 0) continue
      path.project(this.x[i], this.y[i], pr)
      if (pr.distance <= half) c++
    }
    return c
  }

  zoneSamples(): Map<string, ZoneSample> {
    const out = new Map<string, ZoneSample>()
    const counts = new Array<number>(this.zones.length).fill(0)
    for (let i = 0; i < this.n; i++) {
      const z = this.zoneIdx[i]
      if (z >= 0) counts[z]++
    }
    // Peak: 3 x 3 m moving average over the 1 m occupancy grid of the zone's own level.
    const gw = this.gw
    this.zones.forEach((z, k) => {
      const grid = this.occ[z.level]
      const occ = (cx: number, cy: number): number => (cx < 0 || cy < 0 || cx >= gw || cy >= this.gh ? 0 : grid[cy * gw + cx])
      let peak = 0
      for (let cy = Math.floor(z.y0); cy < Math.ceil(z.y1); cy++) {
        for (let cx = Math.floor(z.x0); cx < Math.ceil(z.x1); cx++) {
          let s = 0
          for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) s += occ(cx + ox, cy + oy)
          if (s > peak) peak = s
        }
      }
      let fi = 0
      let fo = 0
      for (let b = 0; b < 60; b++) {
        fi += this.flowIn[k * 60 + b]
        fo += this.flowOut[k * 60 + b]
      }
      out.set(z.id, { count: counts[k], density: counts[k] / z.area, peak: peak / 9, flowIn: fi, flowOut: fo })
    })
    return out
  }

  /** Keep simulated attendees out of the live booth. Pass null to clear it. */
  setKeepOut(circle: { x: number; y: number; r: number } | null): void {
    this.keepOut = circle
  }

  zoneIdAt(x: number, y: number, level = 0): string | undefined {
    const k = this.zoneAt(x, y, level)
    return k >= 0 ? this.zones[k].id : undefined
  }

  // ------------------------------------------------------------ step

  step(dt = SIM_DT): void {
    this.buildGrid()
    const n = this.n
    const { x, y, vx, vy, nvx, nvy, state } = this
    const cs = this.cellStart
    const ord = this.order
    const gw = this.gw
    const gh = this.gh
    const level = this.level
    const field = this.field
    const proj = newProjectResult()
    const resp = this.responder
    const t = this.t

    if (this.surgeUntil >= 0 && t > this.surgeUntil) {
      this.weights = NORMAL_WEIGHTS
      this.surgeUntil = -1
    }
    if (field) field.reveal = Math.min(field.path.length, field.reveal + 40 * dt)

    for (let i = 0; i < n; i++) {
      const st = state[i]
      if (st === State.Down) {
        nvx[i] = nvy[i] = 0
        continue
      }
      // ---- target and desired speed
      let tx: number
      let ty: number
      let vd = this.v0[i]
      let press = 0
      if (st === State.Walk) {
        if (this.wpI[i] < this.wpN[i]) {
          const k = i * MAX_WP + this.wpI[i]
          tx = this.wpX[k]
          ty = this.wpY[k]
          if (Math.hypot(x[i] - tx, y[i] - ty) < (this.wpSet[k] >= 0 ? 0.6 : 1.1)) {
            if (this.wpSet[k] >= 0) this.level[i] = this.wpSet[k]
            this.wpI[i]++
          }
        } else {
          tx = this.gx[i]
          ty = this.gy[i]
          if (Math.hypot(x[i] - tx, y[i] - ty) < 0.7) {
            state[i] = State.Dwell
            const z = this.zoneIdx[i]
            this.timer[i] = this.rng.exp(z >= 0 ? this.dwellMean(z) : 20)
          }
        }
      } else if (st === State.Dwell || st === State.Onlooker) {
        if (st === State.Dwell) {
          this.timer[i] -= dt
          if (this.timer[i] <= 0) this.setGoal(i, this.pickZone())
        }
        tx = this.gx[i] + 0.28 * Math.sin(t * 1.3 + i)
        ty = this.gy[i] + 0.22 * Math.cos(t * 1.1 + i * 0.7)
        vd = 0.32
        // in front of the stage everyone leans in, and the rows behind push the rows ahead
        if (st === State.Dwell && level[i] === 0 && x[i] > PIT_X0 && x[i] < PIT_X1 && this.gy[i] < PIT_Y + 7) press = PIT_PRESS
      } else {
        // anchored band wearer: slow loop around their spot
        tx = this.ax0[i] + 1.1 * Math.sin(t * 0.21 + i * 1.7)
        ty = this.ay0[i] + 0.8 * Math.cos(t * 0.17 + i)
        vd = 0.35
      }

      let dx = tx - x[i]
      let dy = ty - y[i]
      let d = Math.hypot(dx, dy) || 1e-6
      const arrive = Math.min(1, d / 0.8)
      let ax = ((dx / d) * vd * arrive - vx[i]) / 0.5
      let ay = ((dy / d) * vd * arrive - vy[i]) / 0.5 - press

      // ---- neighbours
      const cx = Math.min(gw - 1, Math.max(0, Math.floor(x[i])))
      const cy = Math.min(gh - 1, Math.max(0, Math.floor(y[i])))
      for (let oy = -1; oy <= 1; oy++) {
        const yy = cy + oy
        if (yy < 0 || yy >= gh) continue
        for (let ox = -1; ox <= 1; ox++) {
          const xx = cx + ox
          if (xx < 0 || xx >= gw) continue
          const c = yy * gw + xx
          for (let k = cs[c]; k < cs[c + 1]; k++) {
            const j = ord[k]
            if (j === i || level[j] !== level[i]) continue
            dx = x[i] - x[j]
            dy = y[i] - y[j]
            const d2 = dx * dx + dy * dy
            if (d2 > 1.21) continue
            d = Math.sqrt(d2)
            if (d < 1e-4) {
              dx = Math.cos(i)
              dy = Math.sin(i)
              d = 1
            }
            const f = 2.1 * Math.exp((0.42 - d) / 0.26)
            ax += (f * dx) / d
            ay += (f * dy) / d
          }
        }
      }

      // ---- walls and structures on this person's level
      const obstacles = this.obstaclesNear(level[i], x[i], y[i])
      for (let o = 0; o < obstacles.length; o++) {
        const b = obstacles[o]
        const qx = x[i] < b.x0 ? b.x0 : x[i] > b.x1 ? b.x1 : x[i]
        const qy = y[i] < b.y0 ? b.y0 : y[i] > b.y1 ? b.y1 : y[i]
        dx = x[i] - qx
        dy = y[i] - qy
        d = Math.hypot(dx, dy)
        if (d > 0 && d < 0.9) {
          const f = 5 * Math.exp((0.2 - d) / 0.18)
          ax += (f * dx) / d
          ay += (f * dy) / d
        }
      }
      if (x[i] < 0.9) ax += 5 * Math.exp((0.2 - x[i]) / 0.18)
      if (x[i] > this.venueW - 0.9) ax -= 5 * Math.exp((0.2 - (this.venueW - x[i])) / 0.18)
      if (y[i] > this.venueH - 0.9) ay -= 5 * Math.exp((0.2 - (this.venueH - y[i])) / 0.18)

      // ---- guidance: bands in the lane or near the person are signalled; people who follow theirs
      // clear the lane and keep back from the person
      if (field && st !== State.Anchored && level[i] === 0 && !this.comply[i] && !this.signalled[i]) {
        field.path.project(x[i], y[i], proj)
        const nearPerson = field.keepBackFrom && Math.hypot(x[i] - field.keepBackFrom.x, y[i] - field.keepBackFrom.y) < field.keepBackRadius + SIGNAL_MARGIN
        if (nearPerson || (proj.distance < field.laneHalfWidth + SIGNAL_MARGIN && proj.along <= field.reveal)) this.signalled[i] = 1
      }
      if (field && this.comply[i] && st !== State.Anchored && level[i] === 0) {
        const settled = st === State.Dwell || st === State.Onlooker
        if (field.keepBackFrom) {
          dx = x[i] - field.keepBackFrom.x
          dy = y[i] - field.keepBackFrom.y
          d = Math.hypot(dx, dy) || 1e-3
          if (d < field.keepBackRadius + SIGNAL_MARGIN) this.signalled[i] = 1
          if (d < field.keepBackRadius) {
            const f = 3.2 * (field.keepBackRadius - d)
            ax += (f * dx) / d
            ay += (f * dy) / d
            if (settled) {
              this.gx[i] = field.keepBackFrom.x + (dx / d) * (field.keepBackRadius + 0.6)
              this.gy[i] = field.keepBackFrom.y + (dy / d) * (field.keepBackRadius + 0.6)
            }
          }
        }
        field.path.project(x[i], y[i], proj)
        if (proj.distance < field.laneHalfWidth + SIGNAL_MARGIN && proj.along <= field.reveal) this.signalled[i] = 1
        if (proj.distance < field.laneHalfWidth && proj.along <= field.reveal) {
          const f = 3.6 * (field.laneHalfWidth - proj.distance)
          ax += f * proj.nx
          ay += f * proj.ny
          if (settled) {
            const out = field.laneHalfWidth + 0.7 - proj.distance
            const ngx = x[i] + proj.nx * out
            const ngy = y[i] + proj.ny * out
            if (!this.insideObstacle(ngx, ngy, 0.4, 0)) {
              this.gx[i] = ngx
              this.gy[i] = ngy
            }
          }
        }
      }
      if (resp.active && level[i] === 0) {
        dx = x[i] - resp.x
        dy = y[i] - resp.y
        d = Math.hypot(dx, dy) || 1e-3
        if (d < 1.6) {
          const f = 4 * (1.6 - d)
          ax += (f * dx) / d
          ay += (f * dy) / d
        }
      }

      // ---- integrate velocity (Jacobi: positions update after every agent has been evaluated)
      const am = Math.hypot(ax, ay)
      if (am > 8) {
        ax *= 8 / am
        ay *= 8 / am
      }
      let nx = vx[i] + ax * dt
      let ny = vy[i] + ay * dt
      const vmax = Math.max(0.7, 1.6 * this.v0[i])
      const sp = Math.hypot(nx, ny)
      if (sp > vmax) {
        nx *= vmax / sp
        ny *= vmax / sp
      }
      nvx[i] = nx
      nvy[i] = ny
    }

    for (let i = 0; i < n; i++) {
      vx[i] = nvx[i]
      vy[i] = nvy[i]
      x[i] += vx[i] * dt
      y[i] += vy[i] * dt
      this.resolvePenetration(i)
    }

    this.stepResponder(dt)
    this.t += dt
    this.updateZones()
  }

  // ------------------------------------------------------------ internals

  private stepResponder(dt: number): void {
    const r = this.responder
    if (!r.active || !r.path || !r.target) return
    if (r.arrivedAt >= 0) return
    const path = r.path
    const look = r.s < path.length ? path.at(r.s + 0.9) : { x: r.target.x, y: r.target.y }
    const blocking = this.countWithin(look.x, look.y, 1.0)
    const speed = 1.9 * Math.min(1, Math.max(0.12, 1 - 0.24 * blocking))
    const px = r.x
    const py = r.y
    if (r.s < path.length) {
      r.s = Math.min(path.length, r.s + speed * dt)
      const p = path.at(r.s)
      r.x = p.x
      r.y = p.y
    } else {
      const dx = r.target.x - r.x
      const dy = r.target.y - r.y
      const d = Math.hypot(dx, dy)
      if (d < 1.1) {
        r.arrivedAt = this.t
      } else {
        r.x += (dx / d) * speed * dt
        r.y += (dy / d) * speed * dt
      }
    }
    r.vx = (r.x - px) / dt
    r.vy = (r.y - py) / dt
  }

  private countWithin(px: number, py: number, rad: number): number {
    const gw = this.gw
    const cs = this.cellStart
    const cx = Math.floor(px)
    const cy = Math.floor(py)
    const r2 = rad * rad
    let c = 0
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const xx = cx + ox
        const yy = cy + oy
        if (xx < 0 || yy < 0 || xx >= gw || yy >= this.gh) continue
        const cell = yy * gw + xx
        for (let k = cs[cell]; k < cs[cell + 1]; k++) {
          const j = this.order[k]
          if (this.level[j] !== 0) continue
          const dx = this.x[j] - px
          const dy = this.y[j] - py
          if (dx * dx + dy * dy < r2) c++
        }
      }
    }
    return c
  }

  private buildGrid(): void {
    const n = this.n
    const gw = this.gw
    const gh = this.gh
    const cs = this.cellStart
    cs.fill(0)
    this.occ[0].fill(0)
    this.occ[1].fill(0)
    for (let i = 0; i < n; i++) {
      const cx = Math.min(gw - 1, Math.max(0, Math.floor(this.x[i])))
      const cy = Math.min(gh - 1, Math.max(0, Math.floor(this.y[i])))
      const c = cy * gw + cx
      this.cellOf[i] = c
      cs[c + 1]++
      this.occ[this.level[i]][c]++
    }
    for (let c = 0; c < gw * gh; c++) cs[c + 1] += cs[c]
    this.cellCursor.set(cs.subarray(0, gw * gh))
    for (let i = 0; i < n; i++) this.order[this.cellCursor[this.cellOf[i]]++] = i
  }

  private resolvePenetration(i: number): void {
    const m = 0.22
    if (this.x[i] < m) this.x[i] = m
    if (this.y[i] < m) this.y[i] = m
    if (this.x[i] > this.venueW - m) this.x[i] = this.venueW - m
    if (this.y[i] > this.venueH - m) this.y[i] = this.venueH - m
    for (const b of this.obstaclesNear(this.level[i], this.x[i], this.y[i])) {
      const px = this.x[i]
      const py = this.y[i]
      if (px <= b.x0 - m || px >= b.x1 + m || py <= b.y0 - m || py >= b.y1 + m) continue
      // push out through the nearest face
      const dl = px - (b.x0 - m)
      const dr = b.x1 + m - px
      const dt = py - (b.y0 - m)
      const db = b.y1 + m - py
      const min = Math.min(dl, dr, dt, db)
      if (min === dl) this.x[i] = b.x0 - m
      else if (min === dr) this.x[i] = b.x1 + m
      else if (min === dt) this.y[i] = b.y0 - m
      else this.y[i] = b.y1 + m
    }
    if (this.level[i] === 1) this.keepOnDeck(i)
    this.pushOutOfBooth(i)
  }

  private inBooth(x: number, y: number, margin = 0): boolean {
    const circle = this.keepOut
    if (!circle) return false
    return Math.hypot(x - circle.x, y - circle.y) < circle.r + margin
  }

  private pushOutOfBooth(i: number): void {
    const circle = this.keepOut
    if (!circle || this.state[i] === State.Anchored) return
    const dx = this.x[i] - circle.x
    const dy = this.y[i] - circle.y
    const d = Math.hypot(dx, dy)
    const limit = circle.r + 0.3
    if (d >= limit) return
    const angle = d > 1e-4 ? Math.atan2(dy, dx) : i * 0.77
    this.x[i] = circle.x + Math.cos(angle) * limit
    this.y[i] = circle.y + Math.sin(angle) * limit
  }

  private obstaclesNear(level: number, x: number, y: number): Box[] {
    const ow = Math.ceil(this.venueW / OB_CELL)
    const oh = Math.ceil(this.venueH / OB_CELL)
    const cx = Math.max(0, Math.min(ow - 1, Math.floor(x / OB_CELL)))
    const cy = Math.max(0, Math.min(oh - 1, Math.floor(y / OB_CELL)))
    return this.nearObstacles[level][cy * ow + cx]
  }

  /** People on a stand stay on its deck or its stairs; the railing has no gaps elsewhere. */
  private keepOnDeck(i: number): void {
    const px = this.x[i]
    const py = this.y[i]
    let best = Infinity
    let bx = px
    let by = py
    for (const b of this.upper) {
      const qx = px < b.x0 + 0.05 ? b.x0 + 0.05 : px > b.x1 - 0.05 ? b.x1 - 0.05 : px
      const qy = py < b.y0 + 0.05 ? b.y0 + 0.05 : py > b.y1 - 0.05 ? b.y1 - 0.05 : py
      const d = (qx - px) ** 2 + (qy - py) ** 2
      if (d === 0) return
      if (d < best) {
        best = d
        bx = qx
        by = qy
      }
    }
    this.x[i] = bx
    this.y[i] = by
  }

  private updateZones(): void {
    const bucket = Math.floor(this.t) % 60
    if (bucket !== this.lastBucket) {
      for (let k = 0; k < this.zones.length; k++) {
        this.flowIn[k * 60 + bucket] = 0
        this.flowOut[k * 60 + bucket] = 0
      }
      this.lastBucket = bucket
    }
    for (let i = 0; i < this.n; i++) {
      const z = this.zoneAt(this.x[i], this.y[i], this.level[i])
      const prev = this.zoneIdx[i]
      if (z !== prev) {
        if (prev >= 0) this.flowOut[prev * 60 + bucket]++
        if (z >= 0) this.flowIn[z * 60 + bucket]++
        this.zoneIdx[i] = z
      }
    }
  }

  private zoneAt(x: number, y: number, level: number): number {
    const zs = this.zones
    for (let k = 0; k < zs.length; k++) {
      const z = zs[k]
      if (z.level === level && x >= z.x0 && x < z.x1 && y >= z.y0 && y < z.y1) return k
    }
    return -1
  }

  private dwellMean(zoneIndex: number): number {
    const z = this.zones[zoneIndex]
    return z.level === 1 ? 110 : (DWELL_MEAN[z.section] ?? 30)
  }

  /**
   * A zone to go to next, by how often people choose it. With `settled`, by how many are in it at
   * any moment instead (choice times dwell), so the crowd starts as it will stay.
   */
  private pickZone(settled = false): number {
    const w = (k: number) => (this.weights[this.zones[k].id] ?? 0) * (settled ? this.dwellMean(k) : 1)
    let total = 0
    for (let k = 0; k < this.zones.length; k++) total += w(k)
    let r = this.rng.next() * total
    for (let k = 0; k < this.zones.length; k++) {
      r -= w(k)
      if (r <= 0) return k
    }
    return 0
  }

  private samplePoint(zoneIndex: number, i: number): void {
    const z = this.zones[zoneIndex]
    const rng = this.rng
    for (let tries = 0; tries < 12; tries++) {
      let gx = rng.range(z.x0 + 0.7, z.x1 - 0.7)
      let gy = rng.range(z.y0 + 0.7, z.y1 - 0.7)
      if (z.section === 'front') {
        // most of the front wants the rail: a deep, tight band right under the stage
        const x0 = Math.max(z.x0 + 0.7, PIT_X0)
        const x1 = Math.min(z.x1 - 0.7, PIT_X1)
        if (x1 > x0 && rng.next() < 0.78) {
          gx = rng.range(x0, x1)
          gy = PIT_Y + 0.2 + 5.2 * Math.pow(rng.next(), 2.3)
        } else {
          gy = z.y0 + 1.0 + (z.y1 - z.y0 - 1.6) * Math.pow(rng.next(), 1.6)
        }
      }
      if (!this.insideObstacle(gx, gy, 0.6, z.level)) {
        this.gx[i] = gx
        this.gy[i] = gy
        return
      }
    }
    this.gx[i] = (z.x0 + z.x1) / 2
    this.gy[i] = (z.y0 + z.y1) / 2
  }

  private setGoal(i: number, zoneIndex: number): void {
    if (zoneIndex < 0) return
    this.samplePoint(zoneIndex, i)
    this.goalLevel[i] = this.zones[zoneIndex].level
    this.goalStand[i] = this.zones[zoneIndex].stand
    this.state[i] = State.Walk
    this.route(i)
  }

  /**
   * Waypoints from where person i is to their goal: down the stairs if they are on a stand and
   * the goal is elsewhere, through a passage if the goal is on the other side of the wall, and up
   * the stairs if the goal is on a stand.
   */
  private route(i: number): void {
    const base = i * MAX_WP
    let n = 0
    const push = (x: number, y: number, set = -1) => {
      if (n >= MAX_WP) return
      this.wpX[base + n] = x
      this.wpY[base + n] = y
      this.wpSet[base + n] = set
      n++
    }
    let cx = this.x[i]
    let cy = this.y[i]
    const lvl = this.level[i]
    const goalLevel = this.goalLevel[i]
    const goalStand = this.goalStand[i]
    this.passOf[i] = -1
    this.passAt[i] = -1
    let onGround = lvl === 0
    if (lvl === 1) {
      const here = this.standAt(cx, cy)
      if (goalLevel === 0 || goalStand !== here) {
        const st = this.nearestStair(here, cx, cy)
        if (st) {
          push(st.tx, st.ty)
          push(st.mx, st.my, 0)
          push(st.bx, st.by)
          cx = st.bx
          cy = st.by
          onGround = true
        }
      }
    }
    if (onGround) {
      const up = goalLevel === 1 ? this.nearestStair(goalStand, this.gx[i], this.gy[i]) : null
      const tx = up ? up.bx : this.gx[i]
      const ty = up ? up.by : this.gy[i]
      if (cy < SPLIT_Y !== ty < SPLIT_Y && this.passages.length) {
        const k = this.bestPassage(cx, tx, this.field && this.comply[i] ? this.field.blockedPassages : [])
        const ps = this.passages[k]
        const lane = ps.cx + (((i * 7919) % 1000) / 1000 - 0.5) * 2 * (ps.half - 0.6)
        const down = cy < SPLIT_Y
        this.passOf[i] = k
        this.passAt[i] = n
        push(lane, down ? PASSAGE_Y_TOP - 1.4 : PASSAGE_Y_BOTTOM + 1.4)
        push(lane, down ? PASSAGE_Y_BOTTOM + 1.6 : PASSAGE_Y_TOP - 1.6)
      }
      if (up) {
        push(up.bx, up.by)
        push(up.mx, up.my, 1)
        push(up.tx, up.ty)
      }
    }
    this.wpN[i] = n
    this.wpI[i] = 0
  }

  private standAt(x: number, y: number): number {
    let best = -1
    let bd = Infinity
    this.stands.forEach((b, k) => {
      const qx = Math.max(b.x0, Math.min(b.x1, x))
      const qy = Math.max(b.y0, Math.min(b.y1, y))
      const d = Math.hypot(qx - x, qy - y)
      if (d < bd) {
        bd = d
        best = k
      }
    })
    return best
  }

  private nearestStair(stand: number, x: number, y: number): StairRoute | null {
    let best: StairRoute | null = null
    let bd = Infinity
    for (const st of this.stairs) {
      if (st.stand !== stand) continue
      const d = Math.hypot(st.tx - x, st.ty - y)
      if (d < bd) {
        bd = d
        best = st
      }
    }
    return best
  }

  private bestPassage(fromX: number, toX: number, avoid: number[]): number {
    let best = -1
    let bestCost = Infinity
    this.passages.forEach((ps, k) => {
      if (avoid.includes(k) && avoid.length < this.passages.length) return
      const cost = Math.abs(fromX - ps.cx) + Math.abs(toX - ps.cx)
      if (cost < bestCost) {
        bestCost = cost
        best = k
      }
    })
    return Math.max(0, best)
  }

  private placeOnRing(i: number, at: Vec2, radius: number): void {
    const a = Math.atan2(this.y[i] - at.y, this.x[i] - at.x) + this.rng.range(-0.4, 0.4)
    let gx = at.x + Math.cos(a) * radius
    let gy = at.y + Math.sin(a) * radius
    if (this.insideObstacle(gx, gy, 0.4, 0)) {
      gx = this.x[i]
      gy = this.y[i]
    }
    this.gx[i] = gx
    this.gy[i] = gy
  }

  private insideObstacle(px: number, py: number, margin: number, level: number): boolean {
    const inBox = (b: Box) => px > b.x0 - margin && px < b.x1 + margin && py > b.y0 - margin && py < b.y1 + margin
    for (const b of this.obstacles[level]) if (inBox(b)) return true
    if (this.inBooth(px, py, margin)) return true
    // nobody settles on a stair
    if (level === 0) for (const st of this.stairs) if (inBox(st.rect)) return true
    return px < margin || py < margin || px > this.venueW - margin || py > this.venueH - margin
  }
}
