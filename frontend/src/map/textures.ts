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
 * A standing person in the shape of a lowercase i: a round dot above a narrower straight stem.
 * A gap keeps the dot a circle instead of the cap of a column. Fills stay light so the crowd
 * tint colors them, and the dot is shaded so it reads as a ball. Anchored at the bottom.
 */
export function personTexture(): Texture {
  const w = 52
  const h = 100
  const [cv, g] = canvas(w, h)
  const edge = 2.2
  // The dot is wider than the stem. The stem's corners stay tight so the sides are straight.
  const body = { x: 16, y: 40, w: 20, h: 52, r: 3 }
  const head = { x: 26, y: 16, r: 13 }

  const stem = (extra: number) => {
    g.beginPath()
    g.roundRect(body.x - extra, body.y - extra, body.w + extra * 2, body.h + extra * 2, body.r + extra)
    g.fill()
  }
  const dot = (extra: number) => {
    g.beginPath()
    g.arc(head.x, head.y, head.r + extra, 0, Math.PI * 2)
    g.fill()
  }

  g.fillStyle = '#24262b'
  stem(edge)
  dot(edge)

  const barrel = g.createLinearGradient(body.x, 0, body.x + body.w, 0)
  barrel.addColorStop(0, '#b4b4b4')
  barrel.addColorStop(0.42, '#e6e6e6')
  barrel.addColorStop(1, '#a8a8a8')
  g.fillStyle = barrel
  stem(0)

  const ball = g.createRadialGradient(head.x - 4, head.y - 5, 1, head.x + 1, head.y + 2, head.r)
  ball.addColorStop(0, '#ffffff')
  ball.addColorStop(0.34, '#f3f3f3')
  ball.addColorStop(0.68, '#c4c4c4')
  ball.addColorStop(1, '#8a8a8a')
  g.fillStyle = ball
  dot(0)

  return Texture.from(cv)
}

/**
 * A soft white puff for a walking trail. No solid core, so overlapping steps stay a wisp
 * instead of a painted stripe. The crowd tints this white.
 */
export function trailTexture(size = 32): Texture {
  const [cv, g] = canvas(size, size)
  const c = size / 2
  const gr = g.createRadialGradient(c, c, 0, c, c, c)
  gr.addColorStop(0, 'rgba(255,255,255,0.55)')
  gr.addColorStop(0.28, 'rgba(255,255,255,0.22)')
  gr.addColorStop(0.62, 'rgba(255,255,255,0.06)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr
  g.fillRect(0, 0, size, size)
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
