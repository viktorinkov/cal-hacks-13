import { describe, expect, it } from 'vitest'
import { readCatalog } from '@/stdb/catalog'

function table(rows: Record<string, unknown>[]) {
  return { iter: () => rows }
}

describe('desk catalog', () => {
  it('reads attendees, merch, and graph links in the desk shape', () => {
    const catalog = readCatalog({
      boardAttendees: table([
        { nodeId: 1n, displayName: 'Maya Chen', bandId: 91, findable: true, simulated: false, organization: 'Northwind', handles: [{ platform: 'x', handle: '@maya' }], createdAt: { toDate: () => new Date(0) } },
      ]),
      merchTemplate: table([{ id: 4n, name: 'tee', title: 'BandIt tee', kind: 'shirt', priceCents: 2800n, imageUrl: '/blobs/tee' }]),
      eventGraph: table([{ id: 9n, kind: 'met', fromKind: 'person', fromId: 1n, toKind: 'booth', toId: 2n, weight: 3 }]),
      booth: table([{ id: 2n, name: 'Northwind' }]),
    })
    expect(catalog.attendees[0]).toMatchObject({ displayName: 'Maya Chen', bandId: 91, organization: 'Northwind' })
    expect(catalog.attendees[0].handles).toEqual([{ platform: 'x', handle: '@maya' }])
    expect(catalog.merch[0]).toMatchObject({ title: 'BandIt tee', priceCents: 2800 })
    expect(catalog.links[0]).toMatchObject({ kind: 'met', toKind: 'booth', toId: '2' })
    expect(catalog.booths[0].name).toBe('Northwind')
  })

  it('reads proposed rules, precedents, and whether the night has ended', () => {
    const catalog = readCatalog({
      boardRuleProposals: table([{
        id: 3n, incidentKind: 'fall', coverKind: 'medical_payments', status: 'proposed',
        ceilingCents: 18000n, limitCents: 50000n, claimIds: [14n, 15n], rule: 'Falls up to $180',
        summary: 'Three similar approvals', decidedByName: '', reason: '', ruleVersion: 0,
        createdAt: { toDate: () => new Date(1_000) },
      }]),
      boardOrganizerPrecedents: table([{
        id: 1n, claimId: 14n, incidentKind: 'fall', coverKind: 'medical_payments', decision: 'approve',
        payoutCents: 18000n, claimantName: 'Maya Chen', zoneName: 'Pit', complications: '', reason: '',
        decidedByName: 'Ops', proposalId: 0n, decidedAt: { toDate: () => new Date(2_000) },
      }]),
      settings: table([{ lowVis: true }]),
      eventState: table([{ ended: true, endedAt: { tag: 'some', value: { toDate: () => new Date(3_000) } } }]),
      departure: table([{ nodeId: 9n, name: 'Lee', bandId: 93, door: 'Public Entrance', askedAt: { toDate: () => new Date(4_000) }, leftAt: { tag: 'none' }, by: 'Ops' }]),
    })
    expect(catalog.proposals[0]).toMatchObject({ id: '3', status: 'proposed', ceilingCents: 18000, claimIds: ['14', '15'] })
    expect(catalog.precedents[0]).toMatchObject({ claimId: '14', claimantName: 'Maya Chen', payoutCents: 18000 })
    expect(catalog.lowVis).toBe(true)
    expect(catalog.eventEnded).toBe(true)
    expect(catalog.eventEndedAt).toBe(3_000)
    expect(catalog.departures[0]).toMatchObject({ nodeId: '9', door: 'Public Entrance', leftAt: 0 })
  })

  it('prefers the organizer photo board and names the people in each frame', () => {
    const catalog = readCatalog({
      boardAttendees: table([
        { nodeId: 7n, displayName: 'Maya Chen', bandId: 4, findable: true, simulated: false, organization: '', handles: [], createdAt: { toDate: () => new Date(0) } },
      ]),
      boardPhotos: table([
        { id: 2n, url: '/blobs/late', takenAt: { toDate: () => new Date(2_000) }, zoneName: 'Pit', caption: 'Encore', nodeIds: [7n], peopleCount: 1, read: true },
        { id: 1n, url: '/blobs/early', takenAt: { toDate: () => new Date(1_000) }, zoneName: 'Gate', caption: '', nodeIds: [], peopleCount: 0, read: false },
      ]),
      socialPhotos: table([
        { id: 9n, url: '/blobs/other', takenAt: { toDate: () => new Date(3_000) }, zoneId: 1n, caption: 'Ignored' },
      ]),
    })
    expect(catalog.photos.map((photo) => photo.id)).toEqual(['2', '1'])
    expect(catalog.photos[0]).toMatchObject({ caption: 'Encore', zoneName: 'Pit', people: ['Maya Chen'], nodeIds: ['7'] })
  })

  it('leaves the sponsor-row illustration out of the album', () => {
    const catalog = readCatalog({
      boardPhotos: table([
        { id: 3n, url: '/assets/photos/sponsor-row.jpg', takenAt: { toDate: () => new Date(3_000) }, zoneName: 'Sponsor row', caption: 'Friends at the event', nodeIds: [], peopleCount: 3, read: false },
        { id: 4n, url: '/blobs/57ffcb4537f3a613394b721542274643dc36758944c1a5bd64d487169be8238a', takenAt: { toDate: () => new Date(4_000) }, zoneName: 'Sponsor row', caption: 'Sponsor row crew', nodeIds: [], peopleCount: 0, read: true },
        { id: 2n, url: '/blobs/hall', takenAt: { toDate: () => new Date(2_000) }, zoneName: 'Hacking floor', caption: 'The hall', nodeIds: [], peopleCount: 0, read: true },
      ]),
    })
    expect(catalog.photos.map((photo) => photo.id)).toEqual(['2'])
  })
})
