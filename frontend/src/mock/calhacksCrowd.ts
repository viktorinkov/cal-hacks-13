/**
 * People on the CalHacks floor. Until the database has a crowd, the hall is filled locally.
 * Once it does, those rows seed who is here: a capped sample, placed from their coordinates
 * when those land on this plan, then walked on the client. Later position ticks do not
 * rebuild them, and they are not drawn as wristband icons.
 * They are not the concert simulator.
 */
import { EntityKind, type EntityFrame, type VenueZone } from '@/contracts/domain'
import { bbox, newProjectResult, Path, pointInPolygon, type ProjectResult } from '@/lib/geometry'
import { frames } from '@/stores/frames'
import { useWorld } from '@/stores/world'
import { MAP_PEOPLE, sampleCast, setCastRoster, type CastBand } from '@/stdb/cast'
import { DEMO_LANE, demoIsActive, demoRoute, HARDWARE_ID_MAX, useDemoRing } from '@/booth/demoRing'
import { onStair } from '@/booth/hallRoute'
import { bandsOnFloor, useHallDemo } from '@/booth/hallDemo'
import { buyerName, duePurchase, followBuyers, openingClock, pickPiece, placePurchase, type ShopClock } from '@/payments/floorShop'
import { calhacksTables, calhacksVenue, type TableSpot } from './calhacks'
import { palaceSponsors } from './palaceTrace'
import { Rng } from './sim/rng'

/** Simulated attendees on the floor. A smaller page of them carries the live band ids. */
const COUNT = 1000
const DT = 0.1
const WALK = ['theater', 'food', 'entrance', 'sponsor', 'broadway', 'atrium', 'mezzanine']

/** Matches EntityFrame.pose: walking, standing, seated. */
const WALKING = 0
const STANDING = 1
const SEATED = 2

interface Person {
  x: number
  y: number
  vx: number
  vy: number
  speed: number
  gx: number
  gy: number
  zone: number
  pose: number
  /** Polyline through the gaps between tables. Absent for people wandering an open room. */
  lane: Anchor[] | null
  laneIndex: number
  laneDir: number
  /** Sim time, in ms, until this person moves again. */
  holdUntil: number
  /** People sharing an id are walking to the same chat, or already talking. 0 means alone. */
  group: number
  /** If they are waiting on a friend, give up and leave after this sim time. */
  meetBy: number
  /** Band this character is standing in for. 0 means the page has not assigned one. */
  bandId: number
  /** Already bought this run. Each person buys once. */
  bought: boolean
  /** Walking to a sponsor booth to pay. */
  errand: { x: number; y: number; since: number } | null
}

interface Anchor {
  x: number
  y: number
  zone: number
}

export interface CrowdSpot {
  x: number
  y: number
  zoneId: string
}

const rooms = WALK.map((id) => calhacksVenue.zones.find((zone) => zone.zoneId === id)).filter((zone): zone is VenueZone => !!zone)

function spotIn(zone: VenueZone, rng: Rng): { x: number; y: number } {
  const box = bbox(zone.polygon)
  for (let attempt = 0; attempt < 16; attempt++) {
    const x = rng.range(box.x, box.x + box.w)
    const y = rng.range(box.y, box.y + box.h)
    if (pointInPolygon(x, y, zone.polygon)) return { x, y }
  }
  return zone.labelAt
}

/** Mezzanine sits over the atrium, so it wins when a point is in both. */
function zoneAt(x: number, y: number): number {
  const mezz = rooms.findIndex((room) => room.zoneId === 'mezzanine')
  if (mezz >= 0 && pointInPolygon(x, y, rooms[mezz].polygon)) return mezz
  for (let i = 0; i < rooms.length; i++) {
    if (i !== mezz && pointInPolygon(x, y, rooms[i].polygon)) return i
  }
  return -1
}

/**
 * Closed floor is furniture, rooms, and walls. Chairs are the only seatable band. Everything else
 * inside a room polygon is a walking path, including the aisles between table rows.
 */
type FloorKind = 'seat' | 'closed'

interface Footprint {
  poly: { x: number; y: number }[]
  minX: number
  minY: number
  maxX: number
  maxY: number
  kind: FloorKind
}

const CELL = 8
const floorGrid = new Map<string, Footprint[]>()

function addFootprint(poly: { x: number; y: number }[], kind: FloorKind): void {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of poly) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  const foot: Footprint = { poly, minX, minY, maxX, maxY, kind }
  const x0 = Math.floor(minX / CELL)
  const x1 = Math.floor(maxX / CELL)
  const y0 = Math.floor(minY / CELL)
  const y1 = Math.floor(maxY / CELL)
  for (let gx = x0; gx <= x1; gx++) {
    for (let gy = y0; gy <= y1; gy++) {
      const key = `${gx},${gy}`
      const list = floorGrid.get(key) ?? []
      list.push(foot)
      floorGrid.set(key, list)
    }
  }
}

for (const structure of calhacksVenue.structures) {
  if (structure.name === 'Chairs') addFootprint(structure.footprint, 'seat')
  else if (structure.name === 'Table' || structure.blocksMovement || structure.kind === 'block' || structure.kind === 'stage' || structure.kind === 'speaker') {
    addFootprint(structure.footprint, 'closed')
  }
}

/** Walkway, chair, blocked furniture, or outside the hall. */
export function floorUse(x: number, y: number): 'walk' | 'seat' | 'closed' | 'out' {
  if (zoneAt(x, y) < 0) return 'out'
  const list = floorGrid.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`)
  let seat = false
  if (list) {
    for (const foot of list) {
      if (x < foot.minX || x > foot.maxX || y < foot.minY || y > foot.maxY) continue
      if (!pointInPolygon(x, y, foot.poly)) continue
      if (foot.kind === 'closed') return 'closed'
      seat = true
    }
  }
  return seat ? 'seat' : 'walk'
}

function walkable(x: number, y: number): boolean {
  return floorUse(x, y) === 'walk' && !onStair(x, y)
}

/** Points on the chair band, inset from the table ends so nobody sits in the aisle. */
function chairs(table: TableSpot): { x: number; y: number }[] {
  const across = table.d / 2 + 0.28
  const reach = Math.max(0, table.w * 0.34)
  const alongs = reach > 0.35 ? [-reach, reach] : [0]
  const spots: { x: number; y: number }[] = []
  for (const side of [-1, 1]) {
    for (const along of alongs) {
      const x = table.x + table.tx * along + table.nx * side * across
      const y = table.y + table.ty * along + table.ny * side * across
      if (floorUse(x, y) === 'seat') spots.push({ x, y })
    }
  }
  return spots
}

/** A standing spot in the aisle just outside the chairs, never on a seat or a table. */
function ends(table: TableSpot): { x: number; y: number }[] {
  const spots: { x: number; y: number }[] = []
  for (const side of [-1, 1]) {
    for (const extra of [0.7, 1.05]) {
      const x = table.x + table.nx * side * (table.d / 2 + extra)
      const y = table.y + table.ny * side * (table.d / 2 + extra)
      if (walkable(x, y)) {
        spots.push({ x, y })
        break
      }
    }
  }
  return spots
}

function anchors(points: { x: number; y: number }[]): Anchor[] {
  const kept: Anchor[] = []
  for (const point of points) {
    const zone = zoneAt(point.x, point.y)
    if (zone >= 0) kept.push({ x: point.x, y: point.y, zone })
  }
  return kept
}

interface Lane {
  points: Anchor[]
}

function kept(x: number, y: number): Anchor | null {
  const zone = zoneAt(x, y)
  return zone >= 0 ? { x, y, zone } : null
}

/** Gap columns through the tables, plus a path along the outer side of each block. */
function buildLanes(): Lane[] {
  const grouped = new Map<number, TableSpot[]>()
  for (const table of calhacksTables) {
    if (table.kind !== 'long') continue
    const list = grouped.get(table.row) ?? []
    list.push(table)
    grouped.set(table.row, list)
  }
  const rows = [...grouped.values()]
    .map((tables) => {
      const ref = tables[0]
      tables.sort((a, b) => a.x * ref.tx + a.y * ref.ty - (b.x * ref.tx + b.y * ref.ty))
      const mid = tables[Math.floor(tables.length / 2)]
      return { tables, zone: zoneAt(mid.x, mid.y) }
    })
    .filter((row) => row.zone >= 0)

  const byZone = new Map<number, typeof rows>()
  for (const row of rows) {
    const list = byZone.get(row.zone) ?? []
    list.push(row)
    byZone.set(row.zone, list)
  }

  const lanes: Lane[] = []
  for (const block of byZone.values()) {
    block.sort((a, b) => a.tables[0].y - b.tables[0].y)
    const span = Math.min(...block.map((row) => row.tables.length))
    for (let gap = 0; gap < span - 1; gap++) {
      const points: Anchor[] = []
      for (const row of block) {
        const a = row.tables[gap]
        const b = row.tables[gap + 1]
        const point = kept((a.x + a.tx * 2.8 + b.x - b.tx * 2.8) / 2, (a.y + a.ty * 2.8 + b.y - b.ty * 2.8) / 2)
        if (point && point.zone === row.zone && walkable(point.x, point.y)) points.push(point)
      }
      if (points.length >= 2) lanes.push({ points })
    }
    const edges = block.length === 1 ? [block[0], block[0]] : [block[0], block[block.length - 1]]
    edges.forEach((row, edge) => {
      const neighbor = block.length === 1 ? null : edge === 0 ? block[1] : block[block.length - 2]
      const ref = row.tables[0]
      let sign = edge === 0 ? -1 : 1
      if (neighbor) {
        const mx = row.tables.reduce((sum, table) => sum + table.x, 0) / row.tables.length
        const my = row.tables.reduce((sum, table) => sum + table.y, 0) / row.tables.length
        const ox = neighbor.tables.reduce((sum, table) => sum + table.x, 0) / neighbor.tables.length
        const oy = neighbor.tables.reduce((sum, table) => sum + table.y, 0) / neighbor.tables.length
        sign = ref.nx * (ox - mx) + ref.ny * (oy - my) > 0 ? -1 : 1
      }
      const points: Anchor[] = []
      for (const table of row.tables) {
        let point: Anchor | null = null
        for (const extra of [0.7, 1.05, 1.45]) {
          const candidate = kept(table.x + table.nx * sign * (table.d / 2 + extra), table.y + table.ny * sign * (table.d / 2 + extra))
          if (candidate && candidate.zone === row.zone && walkable(candidate.x, candidate.y)) {
            point = candidate
            break
          }
        }
        if (point) points.push(point)
      }
      if (points.length >= 2) lanes.push({ points })
    })
  }
  return lanes
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const copy = items.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    const swap = copy[i]
    copy[i] = copy[j]
    copy[j] = swap
  }
  return copy
}

export interface CrowdSeed extends CastBand {
  online?: boolean
  xM?: number | null
  yM?: number | null
  hasPosition?: boolean
}

export class CalhacksCrowd {
  people: Person[]
  private readonly rng: Rng
  /** Ids of the database sample currently on the floor. Empty while the crowd is still local. */
  private seedKey = ''
  private readonly lanes: Lane[]
  private seq = 0
  private t = 0
  private nextGroup = 1
  private readonly byBand = new Map<number, Person>()
  readonly counts: Record<string, number> = {}
  /** The test ring. Local people are walked out of it. */
  private keep: { x: number; y: number; r: number } | null = null
  /** Cleared walk from the entrance, revealed from the door toward the ring. */
  private lane: Path | null = null
  /** Floor height at each point of the lane. A person on another floor does not step aside for it. */
  private laneZ: number[] | null = null
  private laneReveal = 0
  private readonly hit: ProjectResult = newProjectResult()
  /** Purchases at sponsor booths. Off until the hall is actually running, so tests stay still. */
  private shopping = false
  private shop: ShopClock = openingClock()
  private shopOrigin = 0
  private boothStands: { name: string; x: number; y: number }[] | null = null

  /** The hall starts buying at sponsor booths. */
  enableShopping(): void {
    this.shopping = true
  }

  /** True once the people on the floor were taken from database rows. */
  seeded(): boolean {
    return this.seedKey !== ''
  }

  /**
   * Replace the local crowd with a capped sample of database people.
   * The same ids are a no-op, including when only their coordinates changed,
   * so a live position tick cannot rebuild the hall. An empty pool empties the
   * floor: the map never draws people the database does not have.
   */
  adopt(bands: CrowdSeed[], limit = MAP_PEOPLE): boolean {
    const pool = bands.filter((band) => band.id > HARDWARE_ID_MAX)
    const chosen = sampleCast(pool, limit)
    const key = chosen.length ? chosen.map((band) => band.id).join(',') : '__empty__'
    if (key === this.seedKey) return false
    this.seedKey = key
    this.people = this.peopleFrom(chosen)
    this.byBand.clear()
    for (const person of this.people) if (person.bandId) this.byBand.set(person.bandId, person)
    this.conversations()
    this.tally()
    this.seq += 1
    return true
  }

  character(bandId: number): { x: number; y: number } | null {
    const person = this.byBand.get(bandId)
    return person ? { x: person.x, y: person.y } : null
  }

  constructor(count = COUNT, seed = 13) {
    this.rng = new Rng(seed)
    const seats = shuffle(anchors(calhacksTables.flatMap(chairs)), this.rng)
    const standing = shuffle(anchors(calhacksTables.flatMap(ends)), this.rng)
    this.lanes = buildLanes()
    const nSit = Math.min(seats.length, Math.round(count * 0.56))
    const nStand = Math.min(standing.length, Math.round(count * 0.16))
    const people: Person[] = []
    for (const seat of seats.slice(0, nSit)) people.push(this.still(seat, SEATED))
    for (const spot of standing.slice(0, nStand)) people.push(this.still(spot, STANDING))
    while (people.length < count) people.push(this.walker())
    this.people = people
    this.conversations()
    this.tally()
  }

  /** Keep the ring empty, and while a hardware SOS is up, clear the entrance path as it draws in. */
  setDemo(circle: { x: number; y: number; r: number } | null, points: { x: number; y: number }[] | null, z: number[] | null = null): void {
    this.keep = circle
    if (!points || points.length < 2) {
      this.lane = null
      this.laneZ = null
      this.laneReveal = 0
      return
    }
    const same =
      this.lane != null &&
      this.lane.points.length === points.length &&
      points.every((point, i) => Math.hypot(point.x - this.lane!.points[i]!.x, point.y - this.lane!.points[i]!.y) < 0.25)
    if (!same) {
      this.lane = new Path(points)
      this.laneZ = z
      this.laneReveal = 0
    }
  }

  /** How far the cleared path has been drawn, in metres. The map uses the same number for its arrows. */
  revealed(): number {
    return this.laneReveal
  }

  spots(): CrowdSpot[] {
    return this.people.map((person) => ({ x: person.x, y: person.y, zoneId: rooms[person.zone]?.zoneId ?? 'atrium' }))
  }

  step(): void {
    this.t += DT * 1000
    if (this.lane) this.laneReveal = Math.min(this.lane.length, this.laneReveal + 4)
    this.shopTick()
    for (const person of this.people) {
      if (person.errand && this.t - person.errand.since > 12000) {
        person.errand = null
        this.depart(person)
        continue
      }
      if (this.yieldLane(person)) continue
      if (this.leaveRing(person)) continue
      if (person.pose === SEATED) {
        person.vx = 0
        person.vy = 0
        continue
      }
      if (person.holdUntil > this.t) {
        person.vx = 0
        person.vy = 0
        person.pose = STANDING
        continue
      }
      if (person.pose === STANDING) {
        if (person.group) {
          if (this.groupTogether(person)) {
            for (const mate of this.people) if (mate.group === person.group) this.depart(mate)
          } else this.waitForGroup(person)
        } else if (Math.hypot(person.gx - person.x, person.gy - person.y) > 1.3) person.pose = WALKING
        else this.depart(person)
        if (person.pose !== WALKING) continue
      }
      // A brief stop in the aisle, then they carry on toward the same place.
      if (person.group === 0 && this.rng.next() < 0.007) {
        person.holdUntil = this.t + this.rng.range(700, 2600)
        person.pose = STANDING
        person.vx = 0
        person.vy = 0
        continue
      }
      const room = rooms[person.zone]
      if (!room) continue
      const dx = person.gx - person.x
      const dy = person.gy - person.y
      const dist = Math.hypot(dx, dy)
      if (dist < (person.lane ? 0.45 : 1.1)) {
        this.arrive(person)
        continue
      }
      const pace = person.speed * Math.max(0.22, Math.min(1, dist / 1.8))
      person.vx = (dx / dist) * pace
      person.vy = (dy / dist) * pace
      const nx = person.x + person.vx * DT
      const ny = person.y + person.vy * DT
      if (pointInPolygon(nx, ny, room.polygon) && this.openSpot(nx, ny, person.zone)) {
        person.x = nx
        person.y = ny
      } else if (person.errand) {
        person.vx = 0
        person.vy = 0
      } else {
        this.retarget(person)
        person.vx = 0
        person.vy = 0
      }
    }
    this.tally()
    this.syncPurchaseMarks()
    this.seq += 1
  }

  frame(): EntityFrame {
    const count = this.people.length
    const positions = new Float32Array(count * 2)
    const velocities = new Float32Array(count * 2)
    const kinds = new Uint8Array(count)
    const pose = new Uint8Array(count)
    const heights = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const person = this.people[i]
      positions[2 * i] = person.x
      positions[2 * i + 1] = person.y
      velocities[2 * i] = person.vx
      velocities[2 * i + 1] = person.vy
      kinds[i] = EntityKind.SimAttendee
      pose[i] = person.pose
      heights[i] = rooms[person.zone]?.elevationM ?? 0
    }
    return { seq: this.seq, t: this.t, source: 'simulation', count, positions, velocities, kinds, pose, heights }
  }

  /** One person per database row. A coordinate on this plan is the start; anything else is placed locally. */
  private peopleFrom(seeds: CrowdSeed[]): Person[] {
    const seats = shuffle(anchors(calhacksTables.flatMap(chairs)), this.rng)
    const standing = shuffle(anchors(calhacksTables.flatMap(ends)), this.rng)
    const nSit = Math.min(seats.length, Math.round(seeds.length * 0.56))
    const nStand = Math.min(standing.length, Math.round(seeds.length * 0.16))
    const people: Person[] = []
    let sit = 0
    let stand = 0
    for (const seed of seeds) {
      const known = this.planted(seed)
      const person = known ?? (sit < nSit ? this.still(seats[sit++]!, SEATED) : stand < nStand ? this.still(standing[stand++]!, STANDING) : this.walker())
      person.bandId = seed.id
      people.push(person)
    }
    return people
  }

  /** The database coordinate, when it is a place someone can actually stand or sit on this plan. */
  private planted(seed: CrowdSeed): Person | null {
    if (!seed.hasPosition || seed.xM == null || seed.yM == null) return null
    const zone = zoneAt(seed.xM, seed.yM)
    if (zone < 0) return null
    const use = floorUse(seed.xM, seed.yM)
    if (use !== 'walk' && use !== 'seat') return null
    const person = this.still({ x: seed.xM, y: seed.yM, zone }, use === 'seat' ? SEATED : WALKING)
    if (use === 'walk') {
      person.speed = this.rng.range(0.35, 1.55)
      person.pose = WALKING
      this.retarget(person)
    }
    return person
  }

  private still(at: Anchor, pose: number): Person {
    return {
      x: at.x,
      y: at.y,
      vx: 0,
      vy: 0,
      speed: 0,
      gx: at.x,
      gy: at.y,
      zone: at.zone,
      pose,
      lane: null,
      laneIndex: 0,
      laneDir: 1,
      holdUntil: pose === STANDING ? this.rng.range(5000, 14000) : 0,
      group: 0,
      meetBy: 0,
      bandId: 0,
      bought: false,
      errand: null,
    }
  }

  private walkerOn(lane: Anchor[], at: Anchor): Person {
    const person: Person = {
      x: at.x,
      y: at.y,
      vx: 0,
      vy: 0,
      speed: this.rng.range(0.35, 1.55),
      gx: at.x,
      gy: at.y,
      zone: at.zone,
      pose: WALKING,
      lane,
      laneIndex: Math.max(0, lane.indexOf(at)),
      laneDir: this.rng.next() < 0.5 ? -1 : 1,
      holdUntil: 0,
      group: 0,
      meetBy: 0,
      bandId: 0,
      bought: false,
      errand: null,
    }
    this.retarget(person)
    return person
  }

  private walker(): Person {
    if (this.lanes.length > 0 && this.rng.next() < 0.72) {
      const lane = this.lanes[this.rng.int(this.lanes.length)].points
      return this.walkerOn(lane, lane[this.rng.int(lane.length)])
    }
    const open = ['sponsor', 'entrance', 'food', 'theater']
      .map((id) => rooms.findIndex((room) => room.zoneId === id))
      .filter((index) => index >= 0)
    const zone = open[this.rng.int(open.length)] ?? this.pickZone()
    let at = spotIn(rooms[zone], this.rng)
    for (let attempt = 0; attempt < 24 && !walkable(at.x, at.y); attempt++) at = spotIn(rooms[zone], this.rng)
    if (!walkable(at.x, at.y) && this.lanes.length > 0) {
      const lane = this.lanes[this.rng.int(this.lanes.length)].points
      const onPath = lane[this.rng.int(lane.length)]
      return this.walkerOn(lane, onPath)
    }
    const person: Person = {
      x: at.x,
      y: at.y,
      vx: 0,
      vy: 0,
      speed: this.rng.range(0.35, 1.55),
      gx: at.x,
      gy: at.y,
      zone,
      pose: WALKING,
      lane: null,
      laneIndex: 0,
      laneDir: 1,
      holdUntil: 0,
      group: 0,
      meetBy: 0,
      bandId: 0,
      bought: false,
      errand: null,
    }
    this.retarget(person)
    return person
  }

  private pickZone(weight = rooms.map((zone) => zone.areaM2), total = weight.reduce((sum, n) => sum + n, 0) || 1): number {
    let mark = this.rng.next() * total
    for (let i = 0; i < weight.length; i++) {
      mark -= weight[i]
      if (mark <= 0) return i
    }
    return 0
  }

  private openSpot(x: number, y: number, zone = zoneAt(x, y)): boolean {
    return walkable(x, y) && !this.insideRing(x, y) && !this.insideLane(x, y, zone)
  }

  private insideRing(x: number, y: number): boolean {
    const circle = this.keep
    if (!circle) return false
    return Math.hypot(x - circle.x, y - circle.y) < circle.r + 0.35
  }

  /** Height of the cleared path at a distance along it. */
  private pathZ(along: number): number {
    const lane = this.lane
    const z = this.laneZ
    if (!lane || !z || z.length !== lane.points.length) return 0
    const cum = lane.cumulative
    const t = Math.max(0, Math.min(lane.length, along))
    let k = 0
    while (k < cum.length - 2 && cum[k + 1]! < t) k++
    const span = (cum[k + 1] ?? t) - (cum[k] ?? 0) || 1
    const f = (t - (cum[k] ?? 0)) / span
    const z0 = z[k] ?? 0
    const z1 = z[Math.min(k + 1, z.length - 1)] ?? z0
    return z0 + (z1 - z0) * f
  }

  private floorOf(zone: number): number {
    return rooms[zone]?.elevationM ?? 0
  }

  /**
   * Somewhere this person can put a foot: their own floor, not a stair and not off the railing.
   * Furniture inside the ring does not count, because that spot is being cleared.
   */
  private foot(x: number, y: number, person: Person, ignoreFurniture: boolean): boolean {
    if (onStair(x, y)) return false
    const room = rooms[person.zone]
    if (!room || !pointInPolygon(x, y, room.polygon)) return false
    if (ignoreFurniture) return true
    const use = floorUse(x, y)
    return use === 'walk' || use === 'seat'
  }

  private insideLane(x: number, y: number, zone: number): boolean {
    const lane = this.lane
    if (!lane || this.laneReveal <= 0) return false
    lane.project(x, y, this.hit)
    if (this.hit.distance >= DEMO_LANE || this.hit.along > this.laneReveal + 0.4) return false
    return Math.abs(this.pathZ(this.hit.along) - this.floorOf(zone)) < 1.5
  }

  /** Step sideways off the path. The arrow on the map points the same way. */
  private yieldLane(person: Person): boolean {
    const lane = this.lane
    if (!lane || this.laneReveal <= 0) return false
    if (!this.insideLane(person.x, person.y, person.zone)) return false
    const pace = 1.35
    let nx = this.hit.nx
    let ny = this.hit.ny
    let tx = person.x + nx * pace * DT
    let ty = person.y + ny * pace * DT
    if (!this.foot(tx, ty, person, false)) {
      nx = -nx
      ny = -ny
      tx = person.x + nx * pace * DT
      ty = person.y + ny * pace * DT
    }
    if (!this.foot(tx, ty, person, false)) return false
    person.x = tx
    person.y = ty
    person.vx = nx * pace
    person.vy = ny * pace
    person.pose = WALKING
    person.holdUntil = 0
    person.lane = null
    return true
  }

  /**
   * Step straight out of the test ring. The ring is the hardware spot, so a table
   * under it does not count as a wall — people on those chairs get up and leave.
   */
  private leaveRing(person: Person): boolean {
    const circle = this.keep
    if (!circle || !this.insideRing(person.x, person.y)) return false
    const dx = person.x - circle.x
    const dy = person.y - circle.y
    const dist = Math.hypot(dx, dy)
    let nx = dist > 0.05 ? dx / dist : Math.cos((person.bandId || 1) * 0.7)
    let ny = dist > 0.05 ? dy / dist : Math.sin((person.bandId || 1) * 0.7)
    const pace = 1.6
    let tx = person.x + nx * pace * DT
    let ty = person.y + ny * pace * DT
    if (!this.foot(tx, ty, person, this.insideRing(tx, ty))) {
      const sx = -ny
      const sy = nx
      nx = sx
      ny = sy
      tx = person.x + nx * pace * DT
      ty = person.y + ny * pace * DT
      if (!this.foot(tx, ty, person, this.insideRing(tx, ty))) return false
    }
    person.x = tx
    person.y = ty
    person.vx = nx * pace
    person.vy = ny * pace
    person.pose = WALKING
    person.holdUntil = 0
    person.lane = null
    if (this.insideRing(person.gx, person.gy)) {
      person.gx = person.x
      person.gy = person.y
    }
    return true
  }

  private retarget(person: Person): void {
    if (person.errand) {
      person.gx = person.errand.x
      person.gy = person.errand.y
      person.lane = null
      const sponsor = rooms.findIndex((room) => room.zoneId === 'sponsor')
      if (sponsor >= 0) person.zone = sponsor
      return
    }
    const lane = person.lane
    if (lane && lane.length > 0) {
      let next = person.laneIndex + person.laneDir
      if (next < 0 || next >= lane.length) {
        person.laneDir *= -1
        next = person.laneIndex + person.laneDir
      }
      if (next < 0 || next >= lane.length) next = person.laneIndex
      person.laneIndex = next
      const at = lane[next]
      person.gx = at.x
      person.gy = at.y
      person.zone = at.zone
      return
    }
    const room = rooms[person.zone]
    if (!room) return
    let at = spotIn(room, this.rng)
    for (let attempt = 0; attempt < 24 && !this.openSpot(at.x, at.y, person.zone); attempt++) at = spotIn(room, this.rng)
    if (!this.openSpot(at.x, at.y, person.zone)) return
    person.gx = at.x
    person.gy = at.y
  }

  /** Pair people who are already standing, and send a few walkers to meet before they talk. */
  private conversations(): void {
    const standing = this.people.filter((person) => person.pose === STANDING)
    const used = new Set<Person>()
    for (const person of standing) {
      if (used.has(person)) continue
      let nearest: Person | null = null
      let nearestDist = 2.6
      for (const other of standing) {
        if (other === person || used.has(other) || other.zone !== person.zone) continue
        const dist = Math.hypot(other.x - person.x, other.y - person.y)
        if (dist < nearestDist) {
          nearest = other
          nearestDist = dist
        }
      }
      if (!nearest) continue
      this.drawTogether(person, nearest)
      if (Math.hypot(nearest.x - person.x, nearest.y - person.y) > 1.15) continue
      const until = this.rng.range(8000, 18000)
      const id = this.nextGroup++
      for (const member of [person, nearest]) {
        member.group = id
        member.pose = STANDING
        member.holdUntil = until
        member.lane = null
        member.vx = 0
        member.vy = 0
      }
      used.add(person)
      used.add(nearest)
    }

    const walking = this.people.filter((person) => person.pose === WALKING && person.group === 0)
    const taken = new Set<Person>()
    const meetups = Math.round(walking.length * 0.22)
    let formed = 0
    for (const leader of walking) {
      if (formed >= meetups) break
      if (taken.has(leader)) continue
      const nearby = walking.filter((person) => !taken.has(person) && person !== leader && person.zone === leader.zone)
      if (nearby.length === 0) continue
      const size = this.rng.next() < 0.34 && nearby.length >= 2 ? 3 : 2
      const members = [leader, ...nearby.slice(0, size - 1)]
      const spot = this.meetSpot(leader)
      if (!spot) continue
      const id = this.nextGroup++
      members.forEach((member, index) => {
        const at = index === 0 ? spot : (this.beside(spot, index) ?? spot)
        member.gx = at.x
        member.gy = at.y
        member.lane = null
        member.group = id
        member.holdUntil = 0
        member.meetBy = 0
        member.speed = this.rng.range(0.4, 1.35)
        taken.add(member)
      })
      formed += 1
    }
  }

  /** Slide the second person onto a walkable spot beside the first so the pair reads as a chat. */
  private drawTogether(a: Person, b: Person): void {
    const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const x = a.x + ((b.x - a.x) / dist) * 0.62
    const y = a.y + ((b.y - a.y) / dist) * 0.62
    const room = rooms[a.zone]
    if (!room || !pointInPolygon(x, y, room.polygon) || !walkable(x, y)) return
    b.x = x
    b.y = y
    b.gx = x
    b.gy = y
    a.gx = a.x
    a.gy = a.y
  }

  private meetSpot(person: Person): Anchor | null {
    const room = rooms[person.zone]
    if (!room) return null
    let at = spotIn(room, this.rng)
    for (let attempt = 0; attempt < 24 && !walkable(at.x, at.y); attempt++) at = spotIn(room, this.rng)
    if (!walkable(at.x, at.y)) return null
    return { x: at.x, y: at.y, zone: person.zone }
  }

  private beside(spot: Anchor, index: number): Anchor | null {
    const angle = (index * 2.2) % (Math.PI * 2)
    const x = spot.x + Math.cos(angle) * 0.7
    const y = spot.y + Math.sin(angle) * 0.7
    const room = rooms[spot.zone]
    if (!room || !pointInPolygon(x, y, room.polygon) || !walkable(x, y)) return null
    return { x, y, zone: spot.zone }
  }

  /** Reached a waypoint. Linger, or wait until the rest of the group arrives and then talk. */
  private arrive(person: Person): void {
    person.vx = 0
    person.vy = 0
    person.pose = STANDING
    if (person.errand) {
      person.errand = null
      person.holdUntil = this.t + this.rng.range(4000, 8000)
      return
    }
    if (person.group) {
      if (this.groupTogether(person)) this.startChat(person)
      else this.waitForGroup(person)
      return
    }
    const dwell = this.rng.next() < 0.18 ? this.rng.range(4000, 9000) : this.rng.range(500, 2800)
    person.holdUntil = this.t + dwell
  }

  private groupTogether(person: Person): boolean {
    return this.people
      .filter((other) => other.group === person.group)
      .every((other) => Math.hypot(other.x - other.gx, other.y - other.gy) < 0.95)
  }

  private startChat(person: Person): void {
    const until = this.t + this.rng.range(6000, 15000)
    for (const mate of this.people) {
      if (mate.group !== person.group) continue
      mate.pose = STANDING
      mate.vx = 0
      mate.vy = 0
      mate.holdUntil = until
      mate.meetBy = 0
    }
  }

  private waitForGroup(person: Person): void {
    if (!person.meetBy) person.meetBy = this.t + 14000
    if (this.t > person.meetBy) {
      person.group = 0
      this.depart(person)
      return
    }
    person.pose = STANDING
    person.holdUntil = this.t + 400
    person.vx = 0
    person.vy = 0
  }

  /** Conversation or pause is over. Pick a fresh pace and a new place in the same room. */
  private depart(person: Person): void {
    person.group = 0
    person.meetBy = 0
    person.holdUntil = 0
    person.pose = WALKING
    person.speed = this.rng.range(0.32, 1.6)
    if (person.lane && this.rng.next() < 0.4) person.lane = null
    this.retarget(person)
  }

  /** One purchase at a time, from someone already on sponsor row, at the booth nearest them. */
  private shopTick(): void {
    if (!this.shopping) return
    const zone = rooms.findIndex((room) => room.zoneId === 'sponsor')
    const room = rooms[zone]
    if (!room) return
    const booths = this.sponsorBooths(room)
    if (!booths.length) return
    const here: { person: Person; index: number }[] = []
    const free: { person: Person; index: number }[] = []
    for (let index = 0; index < this.people.length; index++) {
      const person = this.people[index]!
      if (person.bought || person.errand || person.pose === SEATED) continue
      free.push({ person, index })
      if (person.zone === zone) here.push({ person, index })
    }
    const open = here.length ? here : free
    if (!this.shopOrigin) this.shopOrigin = Date.now()
    const step = duePurchase(this.shop, Math.max(this.t, Date.now() - this.shopOrigin), this.people.length, open.length > 0)
    this.shop = step
    if (!step.buy) return
    const chosen = open[this.rng.int(open.length)]
    if (!chosen) return
    let booth = booths[0]!
    let best = Infinity
    for (const candidate of booths) {
      const dist = Math.hypot(candidate.x - chosen.person.x, candidate.y - chosen.person.y)
      if (dist < best) {
        best = dist
        booth = candidate
      }
    }
    const stand = this.standBeside(booth, room) ?? { x: chosen.person.x, y: chosen.person.y }
    const piece = pickPiece(this.rng, booth.name)
    const { person, index } = chosen
    const onRow = person.zone === zone && pointInPolygon(person.x, person.y, room.polygon)
    placePurchase({
      who: index,
      name: buyerName(index),
      bandId: person.bandId || 100 + index,
      booth: booth.name,
      piece,
      x: onRow ? person.x : stand.x,
      y: onRow ? person.y : stand.y,
      fail: this.rng.next() < 0.025,
    })
    person.bought = true
    person.group = 0
    person.meetBy = 0
    person.lane = null
    person.zone = zone
    person.gx = stand.x
    person.gy = stand.y
    if (onRow && Math.hypot(person.x - stand.x, person.y - stand.y) > 1.4) {
      person.holdUntil = 0
      person.pose = WALKING
      person.speed = Math.max(person.speed, 0.85)
      person.errand = { x: stand.x, y: stand.y, since: this.t }
      return
    }
    person.x = stand.x
    person.y = stand.y
    person.vx = 0
    person.vy = 0
    person.pose = STANDING
    person.holdUntil = this.t + this.rng.range(4000, 8000)
    person.errand = null
  }

  private sponsorBooths(room: VenueZone): { name: string; x: number; y: number }[] {
    if (this.boothStands) return this.boothStands
    const inside = palaceSponsors.filter((booth) => !booth.mezz && pointInPolygon(booth.x, booth.y, room.polygon))
    const list = (inside.length ? inside : palaceSponsors.filter((booth) => !booth.mezz)).map((booth) => ({
      name: booth.name,
      x: booth.x,
      y: booth.y,
    }))
    this.boothStands = list
    return list
  }

  private standBeside(booth: { x: number; y: number }, room: VenueZone): { x: number; y: number } | null {
    for (let ring = 0; ring < 8; ring++) {
      const dist = 0.7 + ring * 0.4
      for (let turn = 0; turn < 8; turn++) {
        const angle = (turn / 8) * Math.PI * 2 + ring
        const x = booth.x + Math.cos(angle) * dist
        const y = booth.y + Math.sin(angle) * dist
        if (pointInPolygon(x, y, room.polygon) && walkable(x, y)) return { x, y }
      }
    }
    return null
  }

  private syncPurchaseMarks(): void {
    if (!this.shopping) return
    const spots: { who: number; x: number; y: number }[] = []
    for (let index = 0; index < this.people.length; index++) {
      const person = this.people[index]!
      if (!person.bought) continue
      spots.push({ who: index, x: person.x, y: person.y })
    }
    if (spots.length) followBuyers(spots)
  }

  private tally(): void {
    for (const id of WALK) this.counts[id] = 0
    for (const person of this.people) {
      const id = rooms[person.zone]?.zoneId
      if (id) this.counts[id] += 1
    }
  }
}

let crowd: CalhacksCrowd | null = null
let timer: ReturnType<typeof setInterval> | null = null
let publishedAt = 0

export function crowdOccupancy(): Record<string, number> | null {
  return crowd ? { ...crowd.counts } : null
}

export function crowdSize(): number {
  return crowd?.people.length ?? 0
}

export function crowdIsSeeded(): boolean {
  return crowd?.seeded() ?? false
}

/** How far the test path has opened. The map draws its arrows to the same point. */
export function demoReveal(): number {
  return crowd?.revealed() ?? 0
}

/** Seed the hall from database people. The same ids leave everyone where they already are. */
export function bindCrowdCast(bands: CrowdSeed[]): void {
  if (!crowd) return
  // The pickable roster is exactly the sample the floor draws, so a click can only land on a person who is rendered.
  setCastRoster(sampleCast(bands.filter((band) => band.id > HARDWARE_ID_MAX)))
  if (crowd.adopt(bands)) frames.push(crowd.frame())
}

/** Where the character for this band is standing, if this page is drawing them. */
export function characterAt(bandId: number): { x: number; y: number } | null {
  return crowd?.character(bandId) ?? null
}

type CrowdHold = { crowd: CalhacksCrowd; timer: ReturnType<typeof setInterval> | null; owner: () => void }

function crowdHold(): { current?: CrowdHold } {
  const slot = globalThis as typeof globalThis & { __banditCrowd?: { current?: CrowdHold } }
  if (!slot.__banditCrowd) slot.__banditCrowd = {}
  return slot.__banditCrowd
}

export function startCalhacksCrowd(): void {
  if (import.meta.env.MODE === 'test') return
  const slot = crowdHold()
  if (slot.current?.owner === startCalhacksCrowd) {
    crowd = slot.current.crowd
    timer = slot.current.timer
    crowd.enableShopping()
    return
  }
  if (slot.current?.timer) clearInterval(slot.current.timer)
  // The floor starts empty; database crowd rows seed it through bindCrowdCast.
  crowd = slot.current?.crowd ?? new CalhacksCrowd(0)
  crowd.enableShopping()
  frames.push(crowd.frame())
  timer = setInterval(() => {
    if (!crowd) return
    const ring = useDemoRing.getState()
    const alerting = demoIsActive(bandsOnFloor(), Object.values(useWorld.getState().incidents))
    const route = alerting && useHallDemo.getState().pathOpen ? demoRoute(ring) : null
    crowd.setDemo(ring, route ? route.points : null, route ? route.z : null)
    crowd.step()
    frames.push(crowd.frame())
    const now = Date.now()
    if (now - publishedAt < 1000) return
    publishedAt = now
    publishCounts()
  }, DT * 1000)
  slot.current = { crowd, timer, owner: startCalhacksCrowd }
}

export function stopCalhacksCrowd(): void {
  const slot = crowdHold()
  if (slot.current?.timer) clearInterval(slot.current.timer)
  slot.current = undefined
  if (timer) clearInterval(timer)
  timer = null
  crowd = null
  publishedAt = 0
  setCastRoster([])
}

function publishCounts(): void {
  if (!crowd) return
  const counts = crowd.counts
  const seeded = crowd.seeded()
  useWorld.setState((state) => {
    if (state.venue?.venueId !== 'calhacks') return state
    const zones = { ...state.zones }
    for (const zone of calhacksVenue.zones) {
      const current = zones[zone.zoneId]
      if (!current) continue
      const count = counts[zone.zoneId] ?? 0
      const area = zone.areaM2 || 1
      const density = count / area
      const line = zone.section === 'front' ? 3.8 : 3.1
      const packed = zone.section === 'front' ? 4.8 : 4.1
      zones[zone.zoneId] = {
        ...current,
        occupancyEstimate: count,
        estimatedDensity: density,
        peakDensity: Math.max(current.peakDensity ?? 0, density),
        congestionStatus: density >= packed ? 'critical' : density >= line ? 'caution' : 'normal',
        source: seeded ? 'estimated' : 'simulation',
        updatedAt: Date.now(),
      }
    }
    return { zones, mode: seeded ? 'live' : state.mode === 'live' ? 'hybrid' : state.mode }
  })
}
