import { describe, expect, it } from 'vitest'
import { Path } from '@/lib/geometry'
import { CrowdSim } from '@/mock/sim/crowd'
import { venue } from '@/mock/venue'

function make(seed = 2026): CrowdSim {
  return new CrowdSim({ seed, count: 600, venue, anchors: [{ x: 31.4, y: 12.4 }], compliance: 0.75 })
}

function hash(sim: CrowdSim): number {
  let h = 0
  for (let i = 0; i < sim.n; i++) h = (h * 31 + Math.round(sim.x[i] * 1000) + Math.round(sim.y[i] * 1000) * 7) | 0
  return h
}

describe('crowd simulation', () => {
  it('is deterministic for a seed', () => {
    const a = make()
    const b = make()
    for (let k = 0; k < 120; k++) {
      a.step()
      b.step()
    }
    expect(hash(a)).toBe(hash(b))
  })

  it('diverges for a different seed', () => {
    const a = make(1)
    const b = make(2)
    for (let k = 0; k < 20; k++) {
      a.step()
      b.step()
    }
    expect(hash(a)).not.toBe(hash(b))
  })

  it('clones exactly, so a baseline and an intervention start from the same state', () => {
    const a = make()
    for (let k = 0; k < 50; k++) a.step()
    const b = a.clone()
    for (let k = 0; k < 50; k++) {
      a.step()
      b.step()
    }
    expect(hash(a)).toBe(hash(b))
  })

  it('keeps everyone inside the venue and out of the walls', () => {
    const sim = make()
    sim.startSurge(30)
    for (let k = 0; k < 300; k++) sim.step()
    for (let i = 0; i < sim.n; i++) {
      expect(sim.x[i]).toBeGreaterThanOrEqual(0)
      expect(sim.x[i]).toBeLessThanOrEqual(venue.width)
      expect(sim.y[i]).toBeGreaterThanOrEqual(0)
      expect(sim.y[i]).toBeLessThanOrEqual(venue.height)
      // nobody stands inside the passage wall except in an open passage
      const inWallBand = sim.y[i] > 40.3 && sim.y[i] < 42.7
      if (inWallBand) {
        const inPassage = (sim.x[i] > 20.2 && sim.x[i] < 24.8) || (sim.x[i] > 71.7 && sim.x[i] < 80.3)
        expect(inPassage).toBe(true)
      }
    }
  })

  it('a responder reaches the incident faster when guidance clears the corridor', () => {
    const corridor = venue.responderCorridors.find((c) => c.corridorId === 'COR-FL-W')!
    const path = new Path(corridor.path)
    const target = { x: 31.4, y: 12.4 }
    const sim = new CrowdSim({ seed: 7, count: 1400, venue, anchors: [target], compliance: 0.8 })
    for (let k = 0; k < 100; k++) sim.step()
    sim.setIncident(target, 0)
    for (let k = 0; k < 30; k++) sim.step()
    const baseline = sim.clone()
    sim.setGuidance(path, target)
    sim.dispatchResponder(path, target)
    baseline.dispatchResponder(path, target)
    for (let k = 0; k < 900 && (sim.responder.arrivedAt < 0 || baseline.responder.arrivedAt < 0); k++) {
      sim.step()
      baseline.step()
    }
    expect(sim.responder.arrivedAt).toBeGreaterThan(0)
    expect(baseline.responder.arrivedAt).toBeGreaterThan(0)
    expect(sim.responder.arrivedAt).toBeLessThanOrEqual(baseline.responder.arrivedAt)
  })
})
