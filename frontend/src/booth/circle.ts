import { create } from 'zustand'

/** A round live patch on the simulated concert floor. Metres, same frame as the venue. */
export interface BoothCircle {
  x: number
  y: number
  r: number
  editing: boolean
}

const KEY = 'bandit-live-booth'
const VENUE_W = 100
const VENUE_H = 64

export const DEFAULT_BOOTH: BoothCircle = { x: 78, y: 58, r: 5, editing: false }

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function read(): BoothCircle {
  if (typeof window === 'undefined') return { ...DEFAULT_BOOTH }
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_BOOTH }
    const parsed = JSON.parse(raw) as Partial<BoothCircle>
    return {
      x: clamp(Number(parsed.x) || DEFAULT_BOOTH.x, 2, VENUE_W - 2),
      y: clamp(Number(parsed.y) || DEFAULT_BOOTH.y, 2, VENUE_H - 2),
      r: clamp(Number(parsed.r) || DEFAULT_BOOTH.r, 2.5, 12),
      editing: false,
    }
  } catch {
    return { ...DEFAULT_BOOTH }
  }
}

function write(circle: BoothCircle) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(KEY, JSON.stringify({ x: circle.x, y: circle.y, r: circle.r }))
}

export const useBooth = create<BoothCircle>()(() => read())

export function moveBooth(x: number, y: number): void {
  useBooth.setState({
    x: clamp(x, 2, VENUE_W - 2),
    y: clamp(y, 2, VENUE_H - 2),
  })
}

export function resizeBooth(r: number): void {
  useBooth.setState({ r: clamp(r, 2.5, 12) })
}

export function setBoothEditing(editing: boolean): void {
  useBooth.setState({ editing })
}

export function saveBooth(): void {
  write(useBooth.getState())
}

/**
 * Centre moves the circle, the rim resizes it.
 * The grab is at least ~18px on screen, so a fitted view of the hall is still draggable.
 * `pxPerM` is the camera's pixels per metre. When the circle is only a few dozen pixels
 * across, the whole disc moves and the rim is not a separate handle.
 */
export function boothHandle(x: number, y: number, circle: Pick<BoothCircle, 'x' | 'y' | 'r'>, pxPerM = 8): 'move' | 'resize' | null {
  const d = Math.hypot(x - circle.x, y - circle.y)
  const slop = Math.max(1.4, 18 / Math.max(pxPerM, 0.5))
  const rimIsSeparate = circle.r * pxPerM > 64
  if (rimIsSeparate && Math.abs(d - circle.r) <= slop && d > circle.r * 0.42) return 'resize'
  if (d <= circle.r + slop) return 'move'
  return null
}
