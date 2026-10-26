import { afterEach, describe, expect, it, vi } from 'vitest'
import { Rng } from '@/mock/sim/rng'
import {
  FIRST_MS,
  RUN_MS,
  buyerName,
  duePurchase,
  openingClock,
  pickPiece,
  resetFloorShop,
  shopGapMs,
  shopTarget,
  withFloorPurchases,
} from '@/payments/floorShop'
import { EMPTY_DESK } from '@/payments/rows'

afterEach(() => {
  resetFloorShop()
  vi.useRealTimers()
})

describe('floor purchases', () => {
  it('buys for 30% of the crowd, starting at 30 seconds, on the live run’s gap', () => {
    expect(shopTarget(1000)).toBe(300)
    expect(shopGapMs(300)).toBe(2000)
    let clock = openingClock()
    let bought = 0
    let first = -1
    const crowd = 1000
    for (let now = 0; now <= RUN_MS; now += 100) {
      const step = duePurchase(clock, now, crowd, true)
      clock = step
      if (!step.buy) continue
      if (first < 0) first = now
      bought += 1
    }
    expect(first).toBe(FIRST_MS)
    expect(bought).toBe(300)
    expect(clock.selected).toBe(300)
  })

  it('waits for someone on sponsor row instead of buying an empty hall', () => {
    const step = duePurchase({ nextAt: FIRST_MS, selected: 0, target: 0 }, FIRST_MS, 1000, false)
    expect(step.buy).toBe(false)
    expect(step.selected).toBe(0)
    expect(step.nextAt).toBeGreaterThan(FIRST_MS)
  })

  it('names a buyer and prices a tee, mug or poster from that booth', () => {
    expect(buyerName(0)).toBe('Maya Chen')
    const rng = new Rng(4)
    const piece = pickPiece(rng, 'Visa')
    expect(piece.title.startsWith('Visa ')).toBe(true)
    expect([2500, 1800, 1500]).toContain(piece.amountCents)
    expect(piece.kind === 'tee' ? piece.size : '').toBe(piece.size)
  })

  it('puts floor orders on the desk beside anything the host already sent', () => {
    const desk = withFloorPurchases(
      {
        ...EMPTY_DESK,
        orders: [{ ...order('host'), id: 'host' }],
        night: { startsAt: 10, endsAt: 20 },
      },
      {
        orders: [{ ...order('floor'), createdAt: 5, updatedAt: 40 }],
        people: [{ nodeId: 'crowd-100', name: 'Maya Chen', bandId: 100 }],
        templates: [],
        booths: [{ id: 'booth:visa', name: 'Visa' }],
      },
    )
    expect(desk.orders.map((item) => item.id)).toEqual(['floor', 'host'])
    expect(desk.night).toEqual({ startsAt: 5, endsAt: 40 })
    expect(desk.people[0]?.name).toBe('Maya Chen')
    expect(desk.booths[0]?.name).toBe('Visa')
  })

})

function order(id: string) {
  return {
    id,
    attendeeName: '',
    nodeId: '',
    templateId: '',
    photoId: '',
    title: '',
    size: '',
    amountCents: 2500,
    status: 'paid',
    failure: '',
    nessiePurchaseId: '',
    createdAt: 15,
    updatedAt: 15,
    line: '',
    photoUrl: '',
  }
}
