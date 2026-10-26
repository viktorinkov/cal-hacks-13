import { describe, expect, it } from 'vitest'
import { parseFriends, parseRecap } from '@/recap/api'
import { mins, whyLine } from '@/recap/copy'
import {
  boothsFromVisits, nearFromShared, nightClose, nightIsOver, nightKnown, peopleFromEncounters, readNight, staysUntil,
  type RecapEncounter, type RecapShared, type RecapVisit,
} from '@/recap/night'

const at = (hour: number, minute: number) => Date.parse(`2026-10-24T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`)

function visit(zoneName: string, start: number, end: number, booths: string[] = []): RecapVisit {
  return { id: `${zoneName}-${start}`, zoneName, booths, startedAt: start, endedAt: end, minutes: (end - start) / 60000 }
}

describe('the night', () => {
  it('is over when the host ends it, or when this band has left', () => {
    expect(nightIsOver(false, null)).toBe(false)
    expect(nightIsOver(true, null)).toBe(true)
    expect(nightIsOver(false, at(22, 10))).toBe(true)
    expect(nightClose(at(23, 0), at(22, 10))).toBe(at(22, 10))
    expect(nightClose(at(23, 0), null)).toBe(at(23, 0))
    expect(nightKnown(false, true, undefined)).toBe(false)
    expect(nightKnown(true, false, undefined)).toBe(false)
    expect(nightKnown(true, false, 'refused')).toBe(true)
    expect(nightKnown(true, true, undefined)).toBe(true)
  })

  it('joins back-to-back stays in the same zone and stops at the close', () => {
    const close = at(23, 0)
    const stays = staysUntil([
      visit('Stage', at(20, 0), at(20, 20)),
      visit('Stage', at(20, 20), at(21, 0), ['Visa']),
      visit('Expo', at(21, 5), at(23, 40)),
    ], close)
    expect(stays.map((stay) => stay.zoneName)).toEqual(['Stage', 'Expo'])
    expect(stays[0]).toMatchObject({ start: at(20, 0), end: at(21, 0) })
    expect(stays[1].end).toBe(close)
  })

  it('keeps the people you met apart from the people you only stood near', () => {
    const close = at(23, 0)
    const met: RecapEncounter = {
      id: '1', zoneName: 'Stage', startedAt: at(20, 10), lastSeenAt: at(20, 40), minutes: 25,
      person: { nodeId: '9', name: 'Bo Lin', photoUrl: '', handles: [{ platform: 'instagram', handle: 'bolin' }] },
    }
    const shared: RecapShared[] = [
      { id: '2', zoneName: 'Stage', booths: ['Visa'], startedAt: at(20, 10), minutes: 12, person: met.person },
      { id: '3', zoneName: 'Expo', booths: ['Elastic'], startedAt: at(21, 0), minutes: 8, person: { nodeId: '4', name: 'Ada Poe', photoUrl: '', handles: [] } },
    ]
    const people = peopleFromEncounters([met], close)
    const near = nearFromShared(shared, new Set(people.map((person) => person.nodeId)), close)
    expect(people.map((person) => person.name)).toEqual(['Bo Lin'])
    expect(near.map((person) => person.name)).toEqual(['Ada Poe'])
    expect(boothsFromVisits([visit('Stage', at(20, 0), at(21, 0), ['Visa'])], close)).toEqual([{ name: 'Visa', zoneName: 'Stage', minutes: 60 }])
  })

  it('reads the subscribed views', () => {
    const stamp = (ms: number) => ({ toDate: () => new Date(ms) })
    const table = (rows: Record<string, unknown>[]) => ({ iter: () => rows.values() })
    const night = readNight({
      eventState: table([{ ended: true, endedAt: { tag: 'some', value: stamp(at(23, 0)) } }]),
      venue: table([{ name: 'CalHacks' }]),
      myVisits: table([{ zoneVisitId: 1n, zoneName: 'Stage', booths: ['Visa'], startedAt: stamp(at(20, 0)), endedAt: { tag: 'some', value: stamp(at(21, 0)) }, minutes: 60 }]),
      myEncounters: table([{ id: 2n, zoneName: 'Stage', startedAt: stamp(at(20, 10)), lastSeenAt: stamp(at(20, 40)), minutes: 25, person: { name: 'Bo Lin', nodeId: 9n, photoUrl: '', handles: [{ platform: 'instagram', handle: 'bolin' }] } }]),
      myHandles: table([{ platform: 'threads', handle: 'me' }]),
      mySharedVisits: table([]),
      myPhotos: table([{ photoId: 3n, url: '/blobs/a', takenAt: stamp(at(20, 30)), zoneName: 'Stage', caption: 'Encore', people: [{ name: 'Bo Lin', nodeId: 9n, photoUrl: '', handles: [] }] }]),
      myDeparture: table([{ name: 'Ada', bandId: 7, door: 'Public Entrance', leftAt: { tag: 'some', value: stamp(at(22, 15)) } }]),
    })
    expect(night.eventEnded).toBe(true)
    expect(night.eventName).toBe('CalHacks')
    expect(night.visits[0]).toMatchObject({ zoneName: 'Stage', booths: ['Visa'], startedAt: at(20, 0) })
    expect(night.encounters[0].person).toMatchObject({ name: 'Bo Lin', handles: [{ platform: 'instagram', handle: 'bolin' }] })
    expect(night.handles).toEqual([{ platform: 'threads', handle: 'me' }])
    expect(night.photos[0]).toMatchObject({ caption: 'Encore', people: [{ name: 'Bo Lin' }] })
    expect(night.departure).toMatchObject({ door: 'Public Entrance', leftAt: at(22, 15) })
  })
})

describe('the ranking', () => {
  it('says why a person is on the recap', () => {
    const line = whyLine({
      name: 'Bo Lin',
      interests: [{ name: 'Visa booth', minutes: 8, yourMinutes: 12, shared: true }],
      similar: null,
    }, false, false)
    expect(line).toBe(`You both hung out at the Visa booth (${mins(12)} you, ${mins(8)} Bo)`)
  })

  it('reads Elastic’s recap and friend search', () => {
    const ranked = parseRecap({
      display_name: 'Ada',
      suggestions_ranked: true,
      suggested_people: [{
        node_id: 9, name: 'Bo Lin', photo_url: '', handles: { instagram: 'bolin' }, minutes: 25,
        met_zone_name: 'Stage', met_at: '2026-10-24T20:10:00', interests: [], photos_together: 2, similar: null,
      }],
      also_there: [],
      suggested_booths: [{ booth_id: 3, name: 'Visa', zone_name: 'Stage', minutes: 40 }],
    })
    expect(ranked).toMatchObject({
      displayName: 'Ada',
      ranked: true,
      people: [{ name: 'Bo Lin', handles: [{ platform: 'instagram', handle: 'bolin' }], photosTogether: 2 }],
      booths: [{ name: 'Visa', zoneName: 'Stage' }],
    })
    expect(parseFriends({
      query: 'meta', semantic_ranked: false, candidate_count: 2, searched_count: 1,
      people: [{ node_id: 4, name: 'Ada Poe', photo_url: '', handles: {}, minutes: 8, reason: 'You were both at the Meta booth', places: [{ name: 'Meta', started_at: '2026-10-24T21:00:00', minutes: 8, kind: 'shared_booth' }] }],
    })?.people[0]).toMatchObject({ name: 'Ada Poe', reason: 'You were both at the Meta booth', places: [{ kind: 'shared_booth' }] })
    expect(parseRecap({ people: [] })).toBeNull()
  })
})
