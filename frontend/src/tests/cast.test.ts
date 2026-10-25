import { describe, expect, it } from 'vitest'
import { castPageOf, MAP_CAST, MAP_PEOPLE, sampleCast, type CastBand } from '@/stdb/cast'

function band(id: number, flags: Partial<Pick<CastBand, 'sos' | 'fall'>> = {}): CastBand {
  return { id, sos: false, fall: false, ...flags }
}

describe('map cast', () => {
  it('keeps the page inside the render cap and puts alerts first', () => {
    const bands = [band(4), band(1, { sos: true }), band(9), band(2, { fall: true }), band(7)]
    const page = castPageOf(bands, 0, 3)
    expect(page.map((item) => item.id)).toEqual([1, 2, 4])
    expect(page.length).toBeLessThanOrEqual(MAP_CAST)
  })

  it('steps through the calm ids without repeating a page', () => {
    const bands = Array.from({ length: 10 }, (_, index) => band(index + 1))
    const first = castPageOf(bands, 0, 4).map((item) => item.id)
    const second = castPageOf(bands, 1, 4).map((item) => item.id)
    expect(first).toEqual([1, 2, 3, 4])
    expect(second).toEqual([5, 6, 7, 8])
    expect(first.some((id) => second.includes(id))).toBe(false)
  })

  it('wraps the window once the roster has been shown', () => {
    const bands = Array.from({ length: 6 }, (_, index) => band(index + 1))
    expect(castPageOf(bands, 3, 4).map((item) => item.id)).toEqual([1, 2, 3, 4])
  })

  it('keeps a stable spread under the render cap, with alerts kept', () => {
    const bands = [band(50, { sos: true }), ...Array.from({ length: 40 }, (_, index) => band(100 + index))]
    const first = sampleCast(bands, 10).map((item) => item.id)
    const shuffled = sampleCast([...bands].reverse(), 10).map((item) => item.id)
    expect(first).toHaveLength(10)
    expect(first[0]).toBe(50)
    expect(first).toEqual(shuffled)
    expect(new Set(first).size).toBe(10)
    expect(sampleCast(bands).length).toBeLessThanOrEqual(MAP_PEOPLE)
  })
})
