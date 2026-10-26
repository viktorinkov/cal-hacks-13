/**
 * People on the CalHacks floor. Every drawn person is a crowd band the database reports as
 * inside and placed: the hall walks each one toward the position its band row carries, so a
 * backend tick moves real people and a departure takes them off the floor. Nobody is drawn
 * without a row behind them.
 */
import { EntityKind, type EntityFrame } from '@/contracts/domain'
import { Path } from '@/lib/geometry'
import { frames } from '@/stores/frames'
import { MAP_PEOPLE, sampleCast, setCastRoster, type CastBand } from '@/stdb/cast'
import { HARDWARE_ID_MAX, useDemoRing } from '@/booth/demoRing'
import { floorRooms, zoneAt } from './floorUse'

const DT = 0.1

/** Matches EntityFrame.pose: walking, standing, seated. */
const WALKING = 0
const STANDING = 1

interface Person {
  x: number
  y: number
  vx: number
  vy: number
  /** The band row's latest reported position — the only thing a person walks toward. */
  gx: number
  gy: number
  zone: number
  pose: number
  /** The crowd band this character stands in for. Always set; nobody is drawn without a row. */
  bandId: number
}

export interface CrowdSpot {
  x: number
  y: number
  zoneId: string
}

const rooms = floorRooms

export interface CrowdSeed extends CastBand {
  online?: boolean
  xM?: number | null
  yM?: number | null
  hasPosition?: boolean
}

/** The band rows that say this person is inside the venue right now. */
function drawn(band: CrowdSeed): boolean {
  return band.id > HARDWARE_ID_MAX && band.online === true && band.hasPosition === true && band.xM != null && band.yM != null
}

export class CalhacksCrowd {
  people: Person[] = []
  private seedKey = ''
  private seq = 0
  private readonly byBand = new Map<number, Person>()
  readonly counts: Record<string, number> = {}
  /** Cleared walk from the entrance, revealed from the door toward the ring. */
  private lane: Path | null = null
  private laneReveal = 0

  /** True while the floor holds database people. */
  seeded(): boolean {
    return this.people.length > 0
  }

  /**
   * Reconcile the floor with the band rows. People the backend reports inside stay drawn and
   * walk to their reported position; everyone else leaves the floor. An empty pool empties
   * the hall — the map never draws a person the database does not have.
   */
  adopt(bands: CrowdSeed[], limit = MAP_PEOPLE): boolean {
    const inside = bands.filter(drawn)
    const chosen = sampleCast(inside, limit) as CrowdSeed[]
    const key = chosen.length ? chosen.map((band) => band.id).join(',') : '__empty__'
    const spot = new Map(inside.map((band) => [band.id, band] as const))
    let changed = false
    if (key !== this.seedKey) {
      const keep = new Set(chosen.map((band) => band.id))
      this.people = this.people.filter((person) => keep.has(person.bandId))
      const have = new Set(this.people.map((person) => person.bandId))
      for (const seed of chosen) {
        if (have.has(seed.id)) continue
        const zone = zoneAt(seed.xM!, seed.yM!)
        this.people.push({ x: seed.xM!, y: seed.yM!, vx: 0, vy: 0, gx: seed.xM!, gy: seed.yM!, zone: Math.max(0, zone), pose: STANDING, bandId: seed.id })
      }
      this.byBand.clear()
      for (const person of this.people) this.byBand.set(person.bandId, person)
      this.seedKey = key
      changed = true
    }
    for (const person of this.people) {
      const band = spot.get(person.bandId)
      if (!band || band.xM == null || band.yM == null) continue
      if (Math.abs(band.xM - person.gx) < 0.05 && Math.abs(band.yM - person.gy) < 0.05) continue
      person.gx = band.xM
      person.gy = band.yM
      const zone = zoneAt(band.xM, band.yM)
      if (zone >= 0) person.zone = zone
      // A jump too far to walk is a reseed or a teleport: snap instead of gliding across the hall.
      if (Math.hypot(band.xM - person.x, band.yM - person.y) > 10) {
        person.x = band.xM
        person.y = band.yM
        person.vx = 0
        person.vy = 0
      }
      changed = true
    }
    this.tally()
    if (changed) this.seq += 1
    return changed
  }

  character(bandId: number): { x: number; y: number } | null {
    const person = this.byBand.get(bandId)
    return person ? { x: person.x, y: person.y } : null
  }

  /** Keep the ring path the responders' arrows follow. It does not move people. */
  setDemo(_circle: { x: number; y: number; r: number } | null, points: { x: number; y: number }[] | null, _z: number[] | null = null): void {
    if (!points || points.length < 2) {
      this.lane = null
      this.laneReveal = 0
      return
    }
    const same =
      this.lane != null &&
      this.lane.points.length === points.length &&
      points.every((point, i) => Math.hypot(point.x - this.lane!.points[i]!.x, point.y - this.lane!.points[i]!.y) < 0.25)
    if (!same) {
      this.lane = new Path(points)
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

  /** Walk everyone toward the position their band row reports. Nothing else moves them. */
  step(): void {
    if (this.lane) this.laneReveal = Math.min(this.lane.length, this.laneReveal + 4)
    for (const person of this.people) {
      const dx = person.gx - person.x
      const dy = person.gy - person.y
      const dist = Math.hypot(dx, dy)
      if (dist < 0.05) {
        person.vx = 0
        person.vy = 0
        person.pose = STANDING
        continue
      }
      // Close in on the reported spot: fast from far away, gentle on the last metre.
      const pace = Math.min(2.5, dist / 0.9)
      person.vx = (dx / dist) * pace
      person.vy = (dy / dist) * pace
      person.x += person.vx * DT
      person.y += person.vy * DT
      person.pose = WALKING
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
    const heights = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const person = this.people[i]!
      positions[2 * i] = person.x
      positions[2 * i + 1] = person.y
      velocities[2 * i] = person.vx
      velocities[2 * i + 1] = person.vy
      kinds[i] = EntityKind.SimAttendee
      pose[i] = person.pose
      heights[i] = rooms[person.zone]?.elevationM ?? 0
    }
    return { seq: this.seq, t: 0, source: 'simulation', count, positions, velocities, kinds, pose, heights }
  }

  private tally(): void {
    for (const room of rooms) this.counts[room.zoneId] = 0
    for (const person of this.people) {
      const id = rooms[person.zone]?.zoneId
      if (id) this.counts[id] += 1
    }
  }
}

let crowd: CalhacksCrowd | null = null
let timer: ReturnType<typeof setInterval> | null = null

export function crowdSize(): number {
  return crowd?.people.length ?? 0
}

/** How far the test path has opened. The map draws its arrows to the same point. */
export function demoReveal(): number {
  return crowd?.revealed() ?? 0
}

/** Keep the drawn floor in step with the band rows. */
export function bindCrowdCast(bands: CrowdSeed[]): void {
  if (!crowd) return
  // The pickable roster is exactly the crowd the floor draws, so a click can only land on a person who is rendered.
  setCastRoster(sampleCast(bands.filter(drawn)))
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
    return
  }
  if (slot.current?.timer) clearInterval(slot.current.timer)
  // The floor starts empty; band rows fill it through bindCrowdCast.
  crowd = slot.current?.crowd ?? new CalhacksCrowd()
  frames.push(crowd.frame())
  timer = setInterval(() => {
    if (!crowd) return
    const ring = useDemoRing.getState()
    crowd.setDemo(ring, null)
    crowd.step()
    frames.push(crowd.frame())
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
  setCastRoster([])
}
