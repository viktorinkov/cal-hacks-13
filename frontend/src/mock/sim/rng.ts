/**
 * Small seeded PRNG (mulberry32). The simulator never touches Math.random or the wall clock, so the
 * same seed always produces the same crowd.
 */
export class Rng {
  state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next()
  }

  int(n: number): number {
    return Math.floor(this.next() * n)
  }

  /** Exponentially distributed value with the given mean. */
  exp(mean: number): number {
    return -Math.log(1 - this.next()) * mean
  }

  gauss(): number {
    const u = 1 - this.next()
    const v = this.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  clone(): Rng {
    const r = new Rng(0)
    r.state = this.state
    return r
  }
}
