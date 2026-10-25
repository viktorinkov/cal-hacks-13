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
})
