/**
 * World ↔ screen transforms for the venue map.
 *
 * The map is an axonometric (orthographic) view: the venue is rotated by `yaw` around the vertical
 * axis, then tilted by `tilt` toward the viewer. Tilt 0 is the flat plan. Because the projection is
 * orthographic, the ground plane maps to the screen by a single affine matrix, so ground textures
 * (trails, density) can be drawn with one transform and picking is an exact inverse.
 *
 * World units are metres (x east, y south, z up). Screen units are CSS pixels.
 */

export interface Camera {
  /** World point that sits on the screen anchor. */
  cx: number
  cy: number
  /** Pixels per metre. */
  scale: number
  /** Rotation around the vertical axis, radians. */
  yaw: number
  /** 0 = plan view; larger tilts the floor away from the viewer. Radians. */
  tilt: number
  /** Screen anchor, CSS px. */
  ax: number
  ay: number
}

export interface ScreenPoint {
  x: number
  y: number
  /** Larger is nearer the viewer; use for painter's ordering. */
  depth: number
}

/** Pixels per metre. Low enough that Fit can frame the full CalHacks hall in a split view. */
export const MIN_SCALE = 1.5
export const MAX_SCALE = 70
export const MAX_TILT = (62 * Math.PI) / 180
export const DEFAULT_TILT = (50 * Math.PI) / 180
export const DEFAULT_YAW = (-12 * Math.PI) / 180

export function project(cam: Camera, x: number, y: number, z: number, out: ScreenPoint = { x: 0, y: 0, depth: 0 }): ScreenPoint {
  const dx = x - cam.cx
  const dy = y - cam.cy
  const cy = Math.cos(cam.yaw)
  const sy = Math.sin(cam.yaw)
  const ct = Math.cos(cam.tilt)
  const st = Math.sin(cam.tilt)
  const rx = cy * dx - sy * dy
  const ry = sy * dx + cy * dy
  out.x = cam.ax + cam.scale * rx
  out.y = cam.ay + cam.scale * (ry * ct - z * st)
  out.depth = ry * st + z * ct
  return out
}

/** Screen point back onto the ground plane (z = 0). */
export function unproject(cam: Camera, sx: number, sy: number): { x: number; y: number } {
  const rx = (sx - cam.ax) / cam.scale
  const ry = (sy - cam.ay) / (cam.scale * Math.max(0.05, Math.cos(cam.tilt)))
  const c = Math.cos(cam.yaw)
  const s = Math.sin(cam.yaw)
  return { x: cam.cx + c * rx + s * ry, y: cam.cy - s * rx + c * ry }
}

/** Depth key for a world point, matching ScreenPoint.depth. */
export function depthOf(cam: Camera, x: number, y: number, z: number): number {
  const ry = Math.sin(cam.yaw) * (x - cam.cx) + Math.cos(cam.yaw) * (y - cam.cy)
  return ry * Math.sin(cam.tilt) + z * Math.cos(cam.tilt)
}

/** Affine matrix (a, b, c, d, tx, ty) taking ground metres to screen px: x' = a x + c y + tx. */
export function groundMatrix(cam: Camera): [number, number, number, number, number, number] {
  const s = cam.scale
  const cy = Math.cos(cam.yaw)
  const sy = Math.sin(cam.yaw)
  const ct = Math.cos(cam.tilt)
  const a = s * cy
  const c = -s * sy
  const b = s * ct * sy
  const d = s * ct * cy
  return [a, b, c, d, cam.ax - a * cam.cx - c * cam.cy, cam.ay - b * cam.cx - d * cam.cy]
}

/** Zoom by `factor` keeping the ground point under (mx, my) fixed. */
export function zoomAt(cam: Camera, factor: number, mx: number, my: number): Camera {
  const before = unproject(cam, mx, my)
  const next = { ...cam, scale: clamp(cam.scale * factor, MIN_SCALE, MAX_SCALE) }
  const after = unproject(next, mx, my)
  next.cx += before.x - after.x
  next.cy += before.y - after.y
  return next
}

/** Pan so the ground point under (x0, y0) moves to (x1, y1). */
export function panBy(cam: Camera, x0: number, y0: number, x1: number, y1: number): Camera {
  const a = unproject(cam, x0, y0)
  const b = unproject(cam, x1, y1)
  return { ...cam, cx: cam.cx - (b.x - a.x), cy: cam.cy - (b.y - a.y) }
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Camera that fits the world box [0, w] x [0, h] (and anything up to `topZ` metres tall) inside the
 * screen rectangle `area`, at the given yaw and tilt.
 */
export function fitCamera(worldW: number, worldH: number, topZ: number, yaw: number, tilt: number, area: Rect, margin = 0.94): Camera {
  const probe: Camera = { cx: worldW / 2, cy: worldH / 2, scale: 1, yaw, tilt, ax: 0, ay: 0 }
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const p: ScreenPoint = { x: 0, y: 0, depth: 0 }
  for (const [x, y] of [
    [0, 0],
    [worldW, 0],
    [worldW, worldH],
    [0, worldH],
  ]) {
    for (const z of [0, topZ]) {
      project(probe, x, y, z, p)
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
    }
  }
  const scale = clamp(Math.min(area.w / (maxX - minX), area.h / (maxY - minY)) * margin, MIN_SCALE, MAX_SCALE)
  return {
    cx: worldW / 2,
    cy: worldH / 2,
    scale,
    yaw,
    tilt,
    ax: area.x + area.w / 2 - (scale * (minX + maxX)) / 2,
    ay: area.y + area.h / 2 - (scale * (minY + maxY)) / 2,
  }
}

/** Camera centred on a ground point inside `area`. */
export function focusCamera(x: number, y: number, scale: number, yaw: number, tilt: number, area: Rect): Camera {
  return { cx: x, cy: y, scale: clamp(scale, MIN_SCALE, MAX_SCALE), yaw, tilt, ax: area.x + area.w / 2, ay: area.y + area.h * 0.56 }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Shortest signed angle from a to b. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/** Ease `cam` toward `target` by fraction k (0..1). Returns true while still moving. */
export function easeCamera(cam: Camera, target: Camera, k: number): boolean {
  let moving = false
  const step = (key: 'cx' | 'cy' | 'scale' | 'tilt' | 'ax' | 'ay', eps: number) => {
    const d = target[key] - cam[key]
    if (Math.abs(d) > eps) {
      cam[key] += d * k
      moving = true
    } else cam[key] = target[key]
  }
  step('cx', 1e-3)
  step('cy', 1e-3)
  step('scale', 1e-3)
  step('tilt', 1e-4)
  step('ax', 0.05)
  step('ay', 0.05)
  const dy = angleDelta(cam.yaw, target.yaw)
  if (Math.abs(dy) > 1e-4) {
    cam.yaw += dy * k
    moving = true
  } else cam.yaw = target.yaw
  return moving
}
