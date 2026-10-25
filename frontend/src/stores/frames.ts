/**
 * High-frequency spatial data lives here, outside React and outside Zustand: the renderer reads it
 * every animation frame, nothing else subscribes. Holds the last four frames so positions can be
 * interpolated smoothly between 10 Hz simulation updates.
 */
import { create } from 'zustand'
import type { EntityFrame } from '@/contracts/domain'

const KEEP = 4

export class FrameBuffer {
  private frames: EntityFrame[] = []
  private arrivals: number[] = []
  /** Backend milliseconds per wall millisecond, estimated from arrivals (speed-up, pause). */
  rate = 1
  version = 0

  push(frame: EntityFrame, arrivedAt = performance.now()): void {
    const last = this.frames[this.frames.length - 1]
    if (last && frame.t <= last.t && frame.seq <= last.seq) return
    // A different population (reset, new source) cannot be interpolated against the old one.
    if (last && (last.count !== frame.count || last.source !== frame.source)) {
      this.frames = []
      this.arrivals = []
    }
    if (last && this.arrivals.length) {
      const dtWall = arrivedAt - this.arrivals[this.arrivals.length - 1]
      const dtData = frame.t - last.t
      if (dtWall > 5 && dtData > 0) this.rate = this.rate * 0.8 + Math.min(8, dtData / dtWall) * 0.2
    }
    this.frames.push(frame)
    this.arrivals.push(arrivedAt)
    if (this.frames.length > KEEP) {
      this.frames.shift()
      this.arrivals.shift()
    }
    this.version++
  }

  clear(): void {
    this.frames = []
    this.arrivals = []
    this.version++
  }

  latest(): EntityFrame | undefined {
    return this.frames[this.frames.length - 1]
  }

  /** Wall-clock arrival of the newest frame. */
  lastArrival(): number | null {
    return this.arrivals.length ? this.arrivals[this.arrivals.length - 1] : null
  }

  /**
   * Write interpolated positions for wall time `now` into `out` (length >= 2 * count). Renders one
   * frame interval behind the newest data and blends with Catmull-Rom weights, so 10 Hz samples
   * become smooth walking. Returns the number of entities written.
   */
  sample(now: number, out: Float32Array): number {
    const f = this.frames
    const n = f.length
    if (!n) return 0
    const latest = f[n - 1]
    if (n === 1) {
      out.set(latest.positions.subarray(0, latest.count * 2))
      return latest.count
    }
    const interval = latest.t - f[n - 2].t || 100
    const sinceArrival = (now - this.arrivals[n - 1]) * this.rate
    const t = Math.min(latest.t, latest.t - interval + sinceArrival)
    let k = n - 2
    while (k > 0 && f[k].t > t) k--
    const a = f[k]
    const b = f[k + 1]
    const span = b.t - a.t || 1
    const u = Math.max(0, Math.min(1, (t - a.t) / span))
    const p0 = (k > 0 ? f[k - 1] : a).positions
    const p1 = a.positions
    const p2 = b.positions
    const p3 = (k + 2 < n ? f[k + 2] : b).positions
    const u2 = u * u
    const u3 = u2 * u
    const w0 = -0.5 * u3 + u2 - 0.5 * u
    const w1 = 1.5 * u3 - 2.5 * u2 + 1
    const w2 = -1.5 * u3 + 2 * u2 + 0.5 * u
    const w3 = 0.5 * u3 - 0.5 * u2
    const len = b.count * 2
    for (let i = 0; i < len; i++) {
      const x1 = p1[i]
      const x2 = p2[i]
      // a jump (reset, teleport) is not smoothed
      if (Math.abs(x2 - x1) > 3) out[i] = x2
      else out[i] = w0 * p0[i] + w1 * x1 + w2 * x2 + w3 * p3[i]
    }
    return b.count
  }
}

export const frames = new FrameBuffer()
export const baselineFrames = new FrameBuffer()

/** Counts the renderer derives from simulated positions, published to React four times a second. */
interface MapStats {
  nearIncident: number
  onCorridor: number
  fps: number
  set(patch: Partial<Omit<MapStats, 'set'>>): void
}

export const useMapStats = create<MapStats>()((set) => ({
  nearIncident: 0,
  onCorridor: 0,
  fps: 0,
  set: (patch) => set(patch),
}))
