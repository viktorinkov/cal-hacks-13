/**
 * The origin shift the traced Palace plan was built with. Palace model space is metres, Y up.
 * Plan space is X east and Y south, the same axes as the map.
 */
export const PALACE_OX = 50.84 + 8
export const PALACE_OY = 106.57 + 8

/** A Palace model point (metres, y up) in plan space. */
export function palaceToPlan(x: number, y: number, z: number): { x: number; y: number; h: number } {
  return { x: -z + PALACE_OX, y: x + PALACE_OY, h: y }
}

/** A plan point as the floor grid sees it: model x, model z. */
export function planToFloor(point: { x: number; y: number }): [number, number] {
  return [point.y - PALACE_OY, PALACE_OX - point.x]
}

/** A floor-grid point (model x, model z) back in plan space. */
export function floorToPlan([x, z]: [number, number]): { x: number; y: number } {
  return { x: -z + PALACE_OX, y: x + PALACE_OY }
}
