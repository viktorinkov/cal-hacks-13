import { afterEach, describe, expect, it, vi } from 'vitest'
import { pointInPolygon } from '@/lib/geometry'
import { calhacksTables, calhacksVenue } from '@/mock/calhacks'
import {
  CalhacksCrowd,
  bindCrowdCast,
  characterAt,
  floorUse,
  startCalhacksCrowd,
  stopCalhacksCrowd,
  type CrowdSeed,
} from '@/mock/calhacksCrowd'
import { pickPerson } from '@/map/personPicking'
import { castRoster } from '@/stdb/cast'

describe('calhacks crowd', () => {
  it('keeps the fake attendees inside the room they are walking', () => {
    const crowd = new CalhacksCrowd(120, 7)
    const before = crowd.frame()
    for (let step = 0; step < 40; step++) crowd.step()
    const after = crowd.frame()
    for (const spot of crowd.spots()) {
      const zone = calhacksVenue.zones.find((item) => item.zoneId === spot.zoneId)
      expect(zone).toBeTruthy()
      expect(pointInPolygon(spot.x, spot.y, zone!.polygon)).toBe(true)
    }
    const total = Object.values(crowd.counts).reduce((sum, n) => sum + n, 0)
    expect(total).toBe(120)
    expect(after.source).toBe('simulation')

    const pose = before.pose!
    let seated = 0
    let standing = 0
    let walking = 0
    let seatedAtTable = 0
    let furthestWalk = 0
    for (let i = 0; i < before.count; i++) {
      const dx = after.positions[2 * i] - before.positions[2 * i]
      const dy = after.positions[2 * i + 1] - before.positions[2 * i + 1]
      const moved = Math.hypot(dx, dy)
      if (pose[i] === 2) {
        seated += 1
        expect(moved).toBeLessThan(0.05)
        const x = before.positions[2 * i]
        const y = before.positions[2 * i + 1]
        expect(floorUse(x, y)).toBe('seat')
        if (calhacksTables.some((table) => Math.hypot(table.x - x, table.y - y) < 2.3)) seatedAtTable += 1
      } else if (pose[i] === 1) {
        standing += 1
        expect(moved).toBeLessThan(0.05)
        expect(floorUse(before.positions[2 * i], before.positions[2 * i + 1])).toBe('walk')
      } else {
        walking += 1
        furthestWalk = Math.max(furthestWalk, moved)
        expect(floorUse(after.positions[2 * i], after.positions[2 * i + 1])).toBe('walk')
      }
    }
    expect(seated).toBeGreaterThan(walking)
    expect(standing).toBeGreaterThan(0)
    expect(walking).toBeGreaterThan(0)
    expect(seatedAtTable).toBe(seated)
    expect(furthestWalk).toBeGreaterThan(1)
  })

  it('stops and starts, and lets a group talk before walking off', () => {
    const crowd = new CalhacksCrowd(200, 11)
    const walking = crowd.people.filter((person) => person.pose === 0)
    const paces = new Set(walking.map((person) => person.speed.toFixed(2)))
    expect(paces.size).toBeGreaterThan(4)

    const chatting = crowd.people.filter((person) => person.group > 0 && person.pose === 1)
    expect(chatting.length).toBeGreaterThan(1)
    const partner = crowd.people.find(
      (person) => person !== chatting[0] && person.group === chatting[0].group && Math.hypot(person.x - chatting[0].x, person.y - chatting[0].y) < 1.2,
    )
    expect(partner).toBeTruthy()

    let sawStillAndMoving = false
    for (let step = 0; step < 25; step++) {
      crowd.step()
      let moving = 0
      let still = 0
      for (const person of crowd.people) {
        if (person.pose === 2) continue
        if (Math.hypot(person.vx, person.vy) > 0.05) moving += 1
        else still += 1
      }
      if (moving > 0 && still > 0) sawStillAndMoving = true
    }
    expect(sawStillAndMoving).toBe(true)

    const origins = chatting.map((person) => ({ person, x: person.x, y: person.y }))
    for (let step = 0; step < 220; step++) crowd.step()
    const left = origins.filter(({ person, x, y }) => Math.hypot(person.x - x, person.y - y) > 1.2)
    expect(left.length).toBeGreaterThan(0)
    for (const person of crowd.people) {
      if (person.pose === 2) continue
      expect(floorUse(person.x, person.y)).toBe('walk')
    }
  })

  it('seeds people from database rows and leaves them walking when only coordinates change', () => {
    const crowd = new CalhacksCrowd(30, 5)
    const seeds: CrowdSeed[] = Array.from({ length: 20 }, (_, index) => ({
      id: 200 + index,
      sos: index === 3,
      fall: false,
      online: true,
      hasPosition: false,
    }))
    expect(crowd.adopt(seeds, 8)).toBe(true)
    expect(crowd.people).toHaveLength(8)
    expect(crowd.people.map((person) => person.bandId)).toContain(203)
    expect(crowd.people.every((person) => person.bandId > 99)).toBe(true)
    for (let step = 0; step < 5; step++) crowd.step()
    const walking = crowd.people.find((person) => person.pose === 0)
    expect(walking).toBeTruthy()
    const x = walking!.x
    const y = walking!.y
    expect(crowd.adopt(seeds.map((seed) => ({ ...seed, xM: 3, yM: 9, hasPosition: true })), 8)).toBe(false)
    const same = crowd.people.find((person) => person.bandId === walking!.bandId)
    expect(same?.x).toBe(x)
    expect(same?.y).toBe(y)
    // Hardware bands are not crowd people; an empty pool empties the floor.
    expect(crowd.adopt([{ id: 7, sos: false, fall: false, online: true }], 8)).toBe(true)
    expect(crowd.people).toHaveLength(0)

    const quiet = new CalhacksCrowd(12, 2)
    expect(quiet.adopt([{ id: 440, sos: false, fall: false, online: false }], 8)).toBe(true)
    expect(quiet.people.map((person) => person.bandId)).toEqual([440])
  })
})

describe('the pickable roster', () => {
  afterEach(() => {
    stopCalhacksCrowd()
    vi.unstubAllEnvs()
  })

  it('holds exactly the drawn crowd people, and empties when the floor does', () => {
    vi.stubEnv('MODE', 'development')
    startCalhacksCrowd()
    // The floor starts empty: no roster means no click can land on an invented person.
    expect(castRoster()).toEqual([])

    const seeds: CrowdSeed[] = [
      { id: 7, sos: false, fall: false, online: true },
      { id: 200, sos: false, fall: false, online: true },
      { id: 201, sos: true, fall: false, online: true },
      { id: 300, sos: false, fall: false, online: true },
    ]
    bindCrowdCast(seeds)
    const roster = castRoster().map((band) => band.id)
    expect(roster).not.toContain(7)
    expect(roster).toEqual(expect.arrayContaining([200, 201, 300]))
    for (const id of roster) expect(characterAt(id)).toBeTruthy()

    // A click on a drawn character picks a real roster person.
    const at = characterAt(roster[0]!)!
    const picked = pickPerson(at, castRoster(), characterAt, (point) => point)
    expect(picked).not.toBeNull()
    expect(roster).toContain(picked)

    // No database rows: the roster is empty and nothing is clickable.
    bindCrowdCast([])
    expect(castRoster()).toEqual([])
    expect(pickPerson(at, castRoster(), characterAt, (point) => point)).toBeNull()

    stopCalhacksCrowd()
    expect(castRoster()).toEqual([])
  })
})