export type RGB = [number, number, number]

export const BPM = 124

export const ROSE: RGB = [1, 0.42, 0.64]
export const ICE: RGB = [0.36, 0.7, 1]
export const MINT: RGB = [0.34, 0.95, 0.72]
export const PEACH: RGB = [1, 0.68, 0.38]
export const LED_GREEN: RGB = [0.36, 0.95, 0.47]
export const ALERT_RED: RGB = [1, 0.11, 0.09]
export const WHITE: RGB = [1, 0.97, 0.93]
export const COOL_WHITE: RGB = [0.82, 0.92, 1]

const WHEEL: RGB[] = [ROSE, ICE, MINT, PEACH]

let origin = performance.now()

/** Restarts the count so the next downbeat lands now (the drop when the lights come on). */
export function dropAt(now: number) {
  origin = now
}

export function beatAt(now: number) {
  return ((now - origin) / 1000) * (BPM / 60)
}

/** Sharp attack, quick decay: 1 on the beat, near 0 just before the next. */
export function kick(beat: number) {
  const phase = beat - Math.floor(beat)
  return Math.exp(-phase * 5)
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Four light colours for this bar; they turn one step each bar and cross over on its last half beat. */
export function palette(beat: number): RGB[] {
  const bar = Math.floor(beat / 4)
  const inBar = beat - bar * 4
  const t = smooth(3.5, 4, inBar)
  const out: RGB[] = []
  for (let k = 0; k < 4; k++) out.push(mix(wheel(bar + k), wheel(bar + k + 1), t))
  return out
}

export function wheel(i: number): RGB {
  return WHEEL[((i % 4) + 4) % 4]
}
