import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CalhacksCrowd,
  bindCrowdCast,
  characterAt,
  startCalhacksCrowd,
  stopCalhacksCrowd,
  type CrowdSeed,
} from '@/mock/calhacksCrowd'
import { pickPerson } from '@/map/personPicking'
import { castRoster } from '@/stdb/cast'

const inside = (id: number, xM = 10, yM = 12): CrowdSeed => ({ id, sos: false, fall: false, online: true, hasPosition: true, xM, yM })

describe('calhacks crowd', () => {
  it('draws only the crowd bands the backend reports inside and placed', () => {
    const crowd = new CalhacksCrowd()
    const seeds: CrowdSeed[] = [
      inside(200, 12, 14),
      inside(201, 18, 20),
      { ...inside(202), online: false },
      { ...inside(203), hasPosition: false, xM: null, yM: null },
      inside(7, 5, 5), // hardware band: never a crowd person
    ]
    expect(crowd.adopt(seeds)).toBe(true)
    expect(crowd.people.map((person) => person.bandId)).toEqual([200, 201])
    expect(crowd.character(200)).toEqual({ x: 12, y: 14 })
    expect(crowd.character(202)).toBeNull()
  })

  it('walks a drawn person to the position their band row reports', () => {
    const crowd = new CalhacksCrowd()
    crowd.adopt([inside(300, 10, 10)])
    const person = crowd.people[0]!
    // The same spot on the next tick is a no-op.
    expect(crowd.adopt([inside(300, 10, 10)])).toBe(false)
    // A backend move retargets the walk.
    expect(crowd.adopt([inside(300, 14, 10)])).toBe(true)
    expect(person.gx).toBe(14)
    const before = person.x
    for (let i = 0; i < 10; i++) crowd.step()
    expect(person.x).toBeGreaterThan(before)
    for (let i = 0; i < 200; i++) crowd.step()
    expect(person.x).toBeCloseTo(14, 1)
  })

  it('drops people the backend no longer reports inside', () => {
    const crowd = new CalhacksCrowd()
    crowd.adopt([inside(400, 10, 10), inside(401, 20, 20)])
    expect(crowd.adopt([{ ...inside(400, 10, 10), online: false }, inside(401, 20, 20)])).toBe(true)
    expect(crowd.people.map((person) => person.bandId)).toEqual([401])
    expect(crowd.adopt([])).toBe(true)
    expect(crowd.people).toHaveLength(0)
  })

  it('snaps a reseeded position instead of gliding across the hall', () => {
    const crowd = new CalhacksCrowd()
    crowd.adopt([inside(500, 10, 10)])
    const person = crowd.people[0]!
    crowd.adopt([inside(500, 60, 40)])
    expect(person.x).toBe(60)
    expect(person.y).toBe(40)
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
      inside(7, 5, 5),
      inside(200, 10, 10),
      inside(201, 20, 20),
      inside(300, 30, 30),
      { ...inside(301, 40, 40), online: false },
    ]
    bindCrowdCast(seeds)
    const roster = castRoster().map((band) => band.id)
    expect(roster).not.toContain(7)
    expect(roster).not.toContain(301)
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
