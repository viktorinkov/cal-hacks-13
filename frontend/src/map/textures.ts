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
 * A standing person in the shape of a lowercase i: a small soft ball above a rounded stem.
 * A gap keeps the dot a circle. Drawn at double size so the curves stay smooth when scaled.
 * Fills stay light so the crowd tint colors them. Anchored at the bottom.
 */
export function personTexture(): Texture {
  const w = 104
  const h = 200
  const [cv, g] = canvas(w, h)
  const edge = 2.4
  // Between the large dot and the pinhead: a bit narrower than the stem, sitting just above it.
  const body = { x: 34, y: 72, w: 36, h: 112, r: 16 }
  const head = { x: 52, y: 44, r: 17 }

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

  g.fillStyle = '#4a4e56'
  stem(edge)
  dot(edge)

  const barrel = g.createLinearGradient(body.x, 0, body.x + body.w, 0)
  barrel.addColorStop(0, '#d2d2d2')
  barrel.addColorStop(0.45, '#f7f7f7')
  barrel.addColorStop(1, '#cccccc')
  g.fillStyle = barrel
  stem(0)

  const ball = g.createRadialGradient(head.x - 4, head.y - 5, 1, head.x + 1, head.y + 2, head.r)
  ball.addColorStop(0, '#ffffff')
  ball.addColorStop(0.42, '#f4f4f4')
  ball.addColorStop(0.78, '#d8d8d8')
  ball.addColorStop(1, '#c2c2c2')
  g.fillStyle = ball
  dot(0)

  return Texture.from(cv)
}

/**
 * A comet for a walking trail. Bright at the right-hand head, thin and gone by the left.
 * The head is the anchor, so rotated along the step the tail hangs behind the feet.
 */
export function trailTexture(): Texture {
  const w = 128
  const h = 32
  const [cv, g] = canvas(w, h)
  const mid = h / 2
  const tail = g.createLinearGradient(w * 0.9, mid, 0, mid)
  tail.addColorStop(0, 'rgba(255,255,255,1)')
  tail.addColorStop(0.14, 'rgba(255,255,255,0.75)')
  tail.addColorStop(0.42, 'rgba(255,255,255,0.22)')
  tail.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = tail
  g.beginPath()
  g.moveTo(w * 0.9, mid)
  g.quadraticCurveTo(w * 0.5, h * 0.26, 2, mid)
  g.quadraticCurveTo(w * 0.5, h * 0.74, w * 0.9, mid)
  g.fill()
  const head = g.createRadialGradient(w * 0.86, mid, 0, w * 0.86, mid, h * 0.3)
  head.addColorStop(0, 'rgba(255,255,255,1)')
  head.addColorStop(0.45, 'rgba(255,255,255,0.65)')
  head.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = head
  g.beginPath()
  g.arc(w * 0.86, mid, h * 0.3, 0, Math.PI * 2)
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
