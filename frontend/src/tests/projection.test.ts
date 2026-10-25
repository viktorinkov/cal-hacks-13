import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TILT,
  DEFAULT_YAW,
  fitCamera,
  groundMatrix,
  panBy,
  project,
  unproject,
  zoomAt,
  type Camera,
} from '@/map/projection'

const cam: Camera = { cx: 50, cy: 32, scale: 12, yaw: DEFAULT_YAW, tilt: DEFAULT_TILT, ax: 900, ay: 500 }

describe('map projection', () => {
  it('round-trips ground points through the screen', () => {
    for (const [x, y] of [
      [0, 0],
      [100, 64],
      [31.4, 12.4],
      [72.5, 41],
    ]) {
      const p = project(cam, x, y, 0)
      const w = unproject(cam, p.x, p.y)
      expect(w.x).toBeCloseTo(x, 6)
      expect(w.y).toBeCloseTo(y, 6)
    }
  })

  it('maps the camera centre to the screen anchor', () => {
    const p = project(cam, cam.cx, cam.cy, 0)
    expect(p.x).toBeCloseTo(cam.ax)
    expect(p.y).toBeCloseTo(cam.ay)
  })

  it('draws taller things higher on screen when tilted, and not at all in plan view', () => {
    const ground = project(cam, 40, 20, 0)
    const top = project(cam, 40, 20, 8)
    expect(top.y).toBeLessThan(ground.y)
    expect(top.depth).toBeGreaterThan(ground.depth)
    const plan = { ...cam, tilt: 0 }
    expect(project(plan, 40, 20, 8).y).toBeCloseTo(project(plan, 40, 20, 0).y)
  })

  it('agrees with the ground affine matrix used for textures', () => {
    const [a, b, c, d, tx, ty] = groundMatrix(cam)
    for (const [x, y] of [
      [3, 4],
      [88, 61],
    ]) {
      const p = project(cam, x, y, 0)
      expect(a * x + c * y + tx).toBeCloseTo(p.x, 6)
      expect(b * x + d * y + ty).toBeCloseTo(p.y, 6)
    }
  })

  it('keeps the point under the cursor fixed while zooming', () => {
    const before = unproject(cam, 640, 300)
    const z = zoomAt(cam, 1.7, 640, 300)
    const after = unproject(z, 640, 300)
    expect(z.scale).toBeCloseTo(cam.scale * 1.7)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('pans the grabbed ground point to the pointer', () => {
    const grabbed = unproject(cam, 500, 400)
    const moved = panBy(cam, 500, 400, 560, 430)
    const now = unproject(moved, 560, 430)
    expect(now.x).toBeCloseTo(grabbed.x, 6)
    expect(now.y).toBeCloseTo(grabbed.y, 6)
  })

  it('fits the whole venue inside the open screen area', () => {
    const area = { x: 380, y: 90, w: 980, h: 700 }
    const fit = fitCamera(100, 64, 10, DEFAULT_YAW, DEFAULT_TILT, area)
    for (const [x, y] of [
      [0, 0],
      [100, 0],
      [100, 64],
      [0, 64],
    ]) {
      const p = project(fit, x, y, 0)
      expect(p.x).toBeGreaterThanOrEqual(area.x - 0.5)
      expect(p.x).toBeLessThanOrEqual(area.x + area.w + 0.5)
      expect(p.y).toBeGreaterThanOrEqual(area.y - 0.5)
      expect(p.y).toBeLessThanOrEqual(area.y + area.h + 0.5)
    }
  })
})
