import { Texture } from 'pixi.js'

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const g = cv.getContext('2d')
  if (!g) throw new Error('2D canvas unavailable')
  return [cv, g]
}

/**
 * A standing person, shaped like an i: a short narrow stem with a sphere on top.
 * Fills stay light so the crowd tint colors them. The head carries the bright spot;
 * the stem stays a shade darker so it does not read as a white block. The outline is
 * painted first and the fills cover the join, so the stroke follows the outer
 * silhouette and does not cut across the neck. Anchored at the bottom.
 */
export function personTexture(): Texture {
  const w = 56
  const h = 48
  const [cv, g] = canvas(w, h)
  const edge = 1.6
  const body = { x: 23, y: 27, w: 10, h: 16, r: 3 }
  const head = { x: 28, y: 16, r: 13 }

  const capsule = (extra: number) => {
    g.beginPath()
    g.roundRect(body.x - extra, body.y - extra, body.w + extra * 2, body.h + extra * 2, body.r + extra)
    g.fill()
  }
  const sphere = (extra: number) => {
    g.beginPath()
    g.arc(head.x, head.y, head.r + extra, 0, Math.PI * 2)
    g.fill()
  }

  g.fillStyle = '#24262b'
  capsule(edge)
  sphere(edge)

  const barrel = g.createLinearGradient(body.x, 0, body.x + body.w, 0)
  barrel.addColorStop(0, '#b4b4b4')
  barrel.addColorStop(0.38, '#d8d8d8')
  barrel.addColorStop(1, '#a6a6a6')
  g.fillStyle = barrel
  capsule(0)

  const ball = g.createRadialGradient(head.x - 3, head.y - 5, 1, head.x + 1, head.y + 2, head.r)
  ball.addColorStop(0, '#ffffff')
  ball.addColorStop(0.38, '#f2f2f2')
  ball.addColorStop(0.72, '#c0c0c0')
  ball.addColorStop(1, '#8e8e8e')
  g.fillStyle = ball
  sphere(0)

  return Texture.from(cv)
}

export function dotTexture(size = 16, radius = 6): Texture {
  const [cv, g] = canvas(size, size)
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, radius)
  gr.addColorStop(0, 'rgba(255,255,255,1)')
  gr.addColorStop(0.7, 'rgba(255,255,255,1)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr
  g.beginPath()
  g.arc(size / 2, size / 2, radius, 0, Math.PI * 2)
  g.fill()
  return Texture.from(cv)
}

export function ringTexture(size = 24): Texture {
  const [cv, g] = canvas(size, size)
  g.strokeStyle = 'rgba(255,255,255,1)'
  g.lineWidth = 2.5
  g.beginPath()
  g.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2)
  g.stroke()
  return Texture.from(cv)
}

export function haloTexture(rgb: [number, number, number]): Texture {
  const [cv, g] = canvas(256, 256)
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  const [r, gg, b] = rgb
  ;[
    [0, 0.34],
    [0.25, 0.24],
    [0.5, 0.11],
    [0.75, 0.04],
    [1, 0],
  ].forEach(([o, a]) => gr.addColorStop(o, `rgba(${r},${gg},${b},${a})`))
  g.fillStyle = gr
  g.fillRect(0, 0, 256, 256)
  return Texture.from(cv)
}
