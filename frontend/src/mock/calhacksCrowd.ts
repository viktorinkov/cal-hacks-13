/**
 * Simulated attendees on the CalHacks floor. The crowd fills the hall. Only the current page of
 * band ids is bound onto characters, so the roster never becomes a sprite per wristband.
 * They are not the concert simulator.
 */
import { EntityKind, type EntityFrame, type VenueZone } from '@/contracts/domain'
import { bbox, pointInPolygon } from '@/lib/geometry'
import { frames } from '@/stores/frames'
import { useWorld } from '@/stores/world'
import { currentCast, setCastRoster, turnCastPage, type CastBand } from '@/stdb/cast'
import { calhacksTables, calhacksVenue, type TableSpot } from './calhacks'
import { Rng } from './sim/rng'

/** Simulated attendees on the floor. A smaller page of them carries the live band ids. */
const COUNT = 1500
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
  return floorUse(x, y) === 'walk'
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

export class CalhacksCrowd {
  readonly people: Person[]
  private readonly rng: Rng
  private readonly lanes: Lane[]
  private seq = 0
  private t = 0
  private nextGroup = 1
  private readonly byBand = new Map<number, Person>()
  readonly counts: Record<string, number> = {}

  /** Point the characters at this page of band ids. Positions stay where the people already are. */
  assign(ids: number[]): void {
    this.byBand.clear()
    for (let i = 0; i < this.people.length; i++) {
      const id = ids[i] ?? 0
      this.people[i]!.bandId = id
      if (id) this.byBand.set(id, this.people[i]!)
    }
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

  spots(): CrowdSpot[] {
    return this.people.map((person) => ({ x: person.x, y: person.y, zoneId: rooms[person.zone]?.zoneId ?? 'atrium' }))
  }

  step(): void {
    this.t += DT * 1000
    for (const person of this.people) {
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
      if (pointInPolygon(nx, ny, room.polygon) && walkable(nx, ny)) {
        person.x = nx
        person.y = ny
      } else {
        this.retarget(person)
        person.vx = 0
        person.vy = 0
      }
    }
    this.tally()
    this.seq += 1
  }

  frame(): EntityFrame {
    const count = this.people.length
    const positions = new Float32Array(count * 2)
    const velocities = new Float32Array(count * 2)
    const kinds = new Uint8Array(count)
    const pose = new Uint8Array(count)
    for (let i = 0; i < count; i++) {
      const person = this.people[i]
      positions[2 * i] = person.x
      positions[2 * i + 1] = person.y
      velocities[2 * i] = person.vx
      velocities[2 * i + 1] = person.vy
      kinds[i] = EntityKind.SimAttendee
      pose[i] = person.pose
    }
    return { seq: this.seq, t: this.t, source: 'simulation', count, positions, velocities, kinds, pose }
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

  private retarget(person: Person): void {
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
    for (let attempt = 0; attempt < 24 && !walkable(at.x, at.y); attempt++) at = spotIn(room, this.rng)
    if (!walkable(at.x, at.y)) return
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

/** Starts the wanderers once. Safe to call on every CalHacks snapshot. */
/** Remember the roster and point the characters at the current page. */
export function bindCrowdCast(bands: CastBand[]): void {
  setCastRoster(bands)
  applyCast()
}

/** Where the character for this band is standing, if this page is drawing them. */
export function characterAt(bandId: number): { x: number; y: number } | null {
  return crowd?.character(bandId) ?? null
}

function applyCast(): void {
  if (!crowd) return
  crowd.assign(currentCast().map((band) => band.id))
}

export function startCalhacksCrowd(): void {
  if (crowd || import.meta.env.MODE === 'test') return
  crowd = new CalhacksCrowd()
  applyCast()
  frames.push(crowd.frame())
  timer = setInterval(() => {
    if (!crowd) return
    crowd.step()
    frames.push(crowd.frame())
    const now = Date.now()
    if (turnCastPage(now)) applyCast()
    if (now - publishedAt < 1000) return
    publishedAt = now
    publishCounts()
  }, DT * 1000)
}

export function stopCalhacksCrowd(): void {
  if (timer) clearInterval(timer)
  timer = null
  crowd = null
  publishedAt = 0
}

function publishCounts(): void {
  if (!crowd) return
  const counts = crowd.counts
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
        source: 'simulation',
        updatedAt: Date.now(),
      }
    }
    return { zones, mode: state.mode === 'live' ? 'hybrid' : state.mode }
  })
}
