import type { SectionKind, StructureKind } from '@/contracts/domain'
import { px } from '@/lib/tokens'

/**
 * The map is a lit slate model of the venue sitting on the Nocturne ground: not black, so the
 * structures read in three dimensions and the signal colours still carry.
 */
export const mapPalette = {
  void: 0x15171b,
  voidGrid: 0xffffff,
  slabTop: 0x3c414b,
  slabSide: 0x23262d,
  paving: 0x4a505b,
  backstage: 0x2c2f36,
  hatch: 0x464b55,
  zoneLine: 0xd9dbe0,
  /** Light blue. The figure texture is white, so this tint is the color people read as. */
  person: 0x6eafff,
  personNear: px.red,
  personLane: px.aside,
  responder: px.green,
  ghost: 0xb8a6ff,
  observed: px.ink,
  shadow: 0x05060a,
}

export const sectionColor: Record<SectionKind, number> = {
  front: px.sectionFront,
  floor: px.sectionFloor,
  wing: px.sectionWing,
  concourse: px.sectionConcourse,
  plaza: px.sectionPlaza,
  food: px.sectionFood,
  passage: px.sectionPassage,
}

export const structureColor: Record<StructureKind, number> = {
  stage: 0x3a3b42,
  speaker: 0x2b2c31,
  tower: 0x60636c,
  tent: 0xe6e3dc,
  bar: 0xbdb5a6,
  counter: 0xbdb5a6,
  truck: 0xd8cdb9,
  table: 0x8d9098,
  wall: 0x9ca0a9,
  barrier: 0xc3c7cf,
  fence: 0x80858f,
  container: 0x5a5f69,
  block: 0xcac7c0,
  pole: 0x8d9199,
  tier: 0x8a8f99,
  rail: 0xc8ccd4,
}

/** Multiply an RGB colour by `k` (0..1+). */
export function shade(color: number, k: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * k))
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * k))
  const b = Math.min(255, Math.round((color & 0xff) * k))
  return (r << 16) | (g << 8) | b
}

/** Linear blend from a to b. */
export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff
  const ag = (a >> 8) & 0xff
  const ab = a & 0xff
  const r = Math.round(ar + (((b >> 16) & 0xff) - ar) * t)
  const g = Math.round(ag + (((b >> 8) & 0xff) - ag) * t)
  const bl = Math.round(ab + ((b & 0xff) - ab) * t)
  return (r << 16) | (g << 8) | bl
}

/** Pixi particles take colour as BGR plus alpha in the top byte. */
export function particleColor(rgb: number, alpha: number): number {
  const bgr = ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff)
  return bgr + (((alpha * 255) | 0) << 24)
}

/**
 * Reddish amber for a gathering that is not an emergency. SOS red is #ff3b30, with almost no gold
 * in it. These keep a much stronger green channel, so the glow stays copper even at its reddest.
 */
export const CONGESTION_TINT = 0xf09a62

/** Density heat. Bloom is ember, the core fades to pale peach, and neither matches the SOS red. */
export const HEAT = { bloom: 0xff5524, warm: 0xff8640, core: 0xffc9a0 }

/** People per m², smoothed over a few metres, where each part of the glow starts and is full. */
export const HEAT_BLOOM = [0.3, 1.4] as const
export const HEAT_CORE = [1.2, 2.6] as const

const smooth = (v: number, [lo, hi]: readonly [number, number]) => {
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}

/**
 * Reddish-amber heat for one cell, from density smoothed wide (`bloom`, about 4 m) and tight (`core`, about
 * 2 m). A lone person never lights up; a mass of people glows, and a packed one burns pale.
 * Returns [colour, alpha], not premultiplied.
 */
export function heatColor(bloom: number, core: number): [number, number] {
  // the bloom rises early so a modest gathering still reads; the core waits for real pressure
  const b = 0.38 * smooth(bloom, HEAT_BLOOM) ** 0.7
  const t = smooth(core, HEAT_CORE)
  const c = 0.66 * t
  const a = Math.min(1, b + c)
  if (a <= 0.004) return [HEAT.bloom, 0]
  const coreColor = mix(HEAT.warm, HEAT.core, t)
  return [mix(HEAT.bloom, coreColor, c / (b + c)), a]
}
