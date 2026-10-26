import '@fontsource-variable/epilogue/wght.css'
import './home.css'
import type { Band3D } from './band3d'
import { fitTitle, prepareTitle, runIntro } from './intro'
import { ANGLES, Ring, faceIn } from './ring'
import { ALERT_RED, beatAt, dropAt, kick, palette } from './show'
import { createStage, type Stage } from './stage'

const root = document.documentElement
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches

const one = <T extends Element>(sel: string, from: ParentNode = document) => from.querySelector<T>(sel)!
const all = <T extends Element>(sel: string, from: ParentNode = document) => [...from.querySelectorAll<T>(sel)]
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const deg = (rad: number) => (rad * 180) / Math.PI
const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x, 0, 1), 3)

const stageEl = one<HTMLElement>('[data-stage]')
const act = one<HTMLElement>('[data-act]')
const tilt = one<HTMLElement>('[data-act-tilt]')
const spinner = one<HTMLElement>('[data-act-spin]')
const shades = all<HTMLImageElement>('[data-act-shade]')
const title = one<HTMLElement>('[data-title]')
const hint = one<HTMLButtonElement>('[data-hint]')
const backCanvas = one<HTMLCanvasElement>('[data-ring-back]')
const backCtx = backCanvas.getContext('2d')

/* The band leans this far in its own plane while the turntable spins it. */
const POSE = -6
spinner.style.setProperty('--pose', `${POSE}deg`)

/* ---------- The stage and the headliner's ring ---------- */

let stage: Stage | null = null
try {
  stage = createStage(one<HTMLCanvasElement>('[data-gl]'))
} catch {
  stage = null
}
if (stage) {
  root.classList.add('has-gl')
  stage.calm = calm
}

const heroRing = new Ring(one<HTMLCanvasElement>('[data-ring]', act), { glow: 0.05 })
heroRing.calm = calm
heroRing.rotation = POSE

const view = { w: 0, h: 0, horizon: 0, face: { x: 0, y: 0, r: 100 } }
let turnPx = 900

/* The modelled band replaces the photograph once three.js has loaded; the photograph stays as the
   fallback without WebGL. */
let band: Band3D | null = null
const pointerNow = { x: 0, y: 0, on: 0 }

function placeBand() {
  if (!band) return
  const unit = Math.min(view.h * 0.3, view.w * 0.5)
  band.place(view.w / 2, view.h * (view.w < 600 ? 0.58 : 0.675), unit)
}

async function loadBand() {
  const canvas = document.createElement('canvas')
  try {
    const { createBand } = await import('./band3d')
    canvas.className = 'band-3d'
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', one<HTMLImageElement>('.act-band').alt)
    stageEl.insertBefore(canvas, act)
    const made = createBand(canvas, ANGLES)
    if (!made) throw new Error('no WebGL')
    band = made
    heroRing.headless = true
    heroRing.rotation = 0
    placeBand()
    if (calm) drawStill()
    requestAnimationFrame(() => root.classList.add('has-3d'))
  } catch {
    band = null
    canvas.remove()
    root.classList.add('no-3d')
  }
}

function measure() {
  stage?.resize()
  heroRing.resize()
  backCanvas.width = heroRing.canvas.width
  backCanvas.height = heroRing.canvas.height
  turnPx = Math.max(640, window.innerHeight * 1.1)
  const sr = stageEl.getBoundingClientRect()
  const ar = act.getBoundingClientRect()
  view.w = sr.width
  view.h = sr.height
  view.face = faceIn({ left: ar.left - sr.left, top: ar.top - sr.top, width: ar.width, height: ar.height })
  view.horizon = sr.height * (sr.width < 600 ? 0.6 : 0.64)
  stage?.setFace(view.face.x, view.face.y, view.face.r)
  stage?.setHorizon(view.horizon)
  placeBand()
  fitTitle(title)
  if (calm) drawStill()
}

/* Dark copies of the cut-out stacked between its two faces: the band's thickness when it turns edge-on. */
function buildEdge() {
  const band = one<HTMLImageElement>('.act-band')
  const back = one<HTMLElement>('.act-back')
  const count = 7
  for (let i = 1; i <= count; i++) {
    const slice = band.cloneNode() as HTMLImageElement
    slice.className = 'act-edge'
    slice.alt = ''
    slice.removeAttribute('fetchpriority')
    slice.style.setProperty('--z', `calc(var(--half) * ${((2 * i) / (count + 1) - 1).toFixed(3)})`)
    spinner.insertBefore(slice, back)
  }
}

let shadeNow = -1
function setShade(v: number) {
  if (Math.abs(v - shadeNow) < 0.001) return
  shadeNow = v
  shades.forEach((el) => (el.style.opacity = String(v)))
}

/* Levels over time: the spotlight strikes with a flicker, then the show lights come up on the drop. */
let strikeAt = -1
const FLICKER: [number, number][] = [
  [0, 0],
  [50, 0.95],
  [100, 0.08],
  [170, 0.7],
  [220, 0.15],
  [360, 1],
]
function flicker(ms: number) {
  if (ms <= 0) return 0
  for (let i = 1; i < FLICKER.length; i++) {
    const [t1, v1] = FLICKER[i]
    const [t0, v0] = FLICKER[i - 1]
    if (ms <= t1) return v0 + ((v1 - v0) * (ms - t0)) / (t1 - t0)
  }
  return 1
}

function strike(now: number) {
  strikeAt = now
  dropAt(now + 520)
  window.setTimeout(() => heroRing.set('boot', performance.now(), { mode: 'compass', after: 900 }), 260)
}

/* ---------- Pointer: a light in the haze, ripples, the ring's arc, a fall on click ---------- */

let pointerSeen = false
let fallEnds = 0
/* Where the arc should point on screen; the loop turns it into the ring's own angle. */
let aimScreen = -50
const tiltNow = { x: 0, y: 0 }
const tiltTo = { x: 0, y: 0 }
const lastRipple = { x: -999, y: -999, t: 0 }

function local(e: { clientX: number; clientY: number }) {
  const sr = stageEl.getBoundingClientRect()
  return { x: e.clientX - sr.left, y: e.clientY - sr.top }
}

function aimAt(x: number, y: number) {
  return deg(Math.atan2(y - view.face.y, x - view.face.x))
}

stageEl.addEventListener('pointermove', (e) => {
  const { x, y } = local(e)
  pointerSeen = true
  pointerNow.x = x
  pointerNow.y = y
  pointerNow.on = 1
  stage?.pointer(x, y, true)
  if (heroRing.mode === 'compass') aimScreen = aimAt(x, y)
  tiltTo.x = clamp((y - view.face.y) / view.h, -0.6, 0.6) * -14
  tiltTo.y = clamp((x - view.face.x) / view.w, -0.6, 0.6) * 16
  if (calm || strikeAt < 0) return
  const now = performance.now()
  const moved = Math.hypot(x - lastRipple.x, y - lastRipple.y)
  if (moved > 46 || (moved > 8 && now - lastRipple.t > 140)) {
    stage?.ripple(x, y, e.pointerType === 'touch' ? 1.4 : 1)
    lastRipple.x = x
    lastRipple.y = y
    lastRipple.t = now
  }
})

stageEl.addEventListener('pointerleave', () => {
  pointerNow.on = 0
  stage?.pointer(0, 0, false)
  tiltTo.x = 0
  tiltTo.y = 0
})

function fallAt(x: number, y: number) {
  const now = performance.now()
  const span = view.h - view.horizon
  const fy = clamp(y, view.horizon + span * 0.18, view.h - span * 0.14)
  if (!calm) {
    stage?.fall(x, fy)
    stage?.ripple(x, fy, 2.4, ALERT_RED)
  }
  aimScreen = aimAt(x, fy) + 180
  heroRing.set('alert', now, { mode: 'away', after: 2600 })
  fallEnds = now + 6400
  if (!calm) {
    const shaken: HTMLElement = band?.canvas ?? act
    shaken.animate(
      [{ translate: '0 0' }, { translate: '-7px 0' }, { translate: '7px 0' }, { translate: '-4px 0' }, { translate: '0 0' }],
      { duration: 360, easing: 'linear', composite: 'add' },
    )
  }
}

stageEl.addEventListener('click', (e) => {
  if ((e.target as Element).closest('a, button')) return
  const { x, y } = local(e)
  fallAt(x, y)
})

hint.addEventListener('click', () => {
  const x = view.w * (0.2 + Math.random() * 0.6)
  const y = view.horizon + (view.h - view.horizon) * (0.35 + Math.random() * 0.3)
  fallAt(x, y)
})

/* ---------- Scroll: the turntable ---------- */

/* The band turns by how far the page scrolls, never by where it is, so the track can loop: heading into
   either end it jumps back to the middle and nothing on screen moves. */
let scrollY0 = 0
let spinTo = 0
let spinNow = 0
let scrolledAt = 0

function trackMid() {
  return Math.round((root.scrollHeight - window.innerHeight) / 2)
}

function onScroll() {
  const y = window.scrollY
  const v = y - scrollY0
  spinTo += (v / turnPx) * 360
  scrollY0 = y
  scrolledAt = performance.now()
  const max = root.scrollHeight - window.innerHeight
  const edge = window.innerHeight * 1.2
  const step = Math.abs(v) < window.innerHeight * 0.5
  if (step && max > edge * 4 && ((v < 0 && y < edge) || (v > 0 && y > max - edge))) {
    window.scrollTo({ top: trackMid(), behavior: 'instant' })
    scrollY0 = window.scrollY
  }
}

function copyBack(turn: number) {
  if (!backCtx || Math.cos((turn * Math.PI) / 180) > 0.2) return
  backCtx.clearRect(0, 0, backCanvas.width, backCanvas.height)
  backCtx.drawImage(heroRing.canvas, 0, 0)
}

/* ---------- The frame loop ---------- */

let last = performance.now()
function loop(now: number) {
  requestAnimationFrame(loop)
  if (document.hidden) return
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now

  /* Once the scrolling stops, the turntable coasts round to the nearest side facing the crowd. */
  if (now - scrolledAt > 500) {
    const rest = Math.round(spinTo / 180) * 180
    spinTo += (rest - spinTo) * (1 - Math.exp(-dt * 2.5))
  }
  spinNow += (spinTo - spinNow) * (1 - Math.exp(-dt * 6))
  if (Math.abs(spinNow) > 36000) {
    const whole = 360 * Math.trunc(spinNow / 360)
    spinNow -= whole
    spinTo -= whole
  }
  const energy = clamp(Math.abs(spinTo - spinNow) / 140, 0, 1)

  if (strikeAt >= 0) {
    const since = now - strikeAt
    if (stage) {
      stage.levels.spot = flicker(since)
      stage.levels.on = easeOut((since - 520) / 1100)
      stage.levels.boost = energy * 0.6
    }
    setShade(1 - flicker(since))
  }
  if (heroRing.mode === 'away' && now > fallEnds) heroRing.set('compass', now)
  if (!pointerSeen && heroRing.mode === 'compass') aimScreen = -60 + Math.sin(now / 2400) * 70
  tiltNow.x += (tiltTo.x - tiltNow.x) * (1 - Math.exp(-dt * 4))
  tiltNow.y += (tiltTo.y - tiltNow.y) * (1 - Math.exp(-dt * 4))

  const rock = strikeAt >= 0 ? Math.sin(now / 2600) * 7 : 0
  const turn = spinNow + rock
  heroRing.spin = energy
  heroRing.beatGlow = stage ? stage.levels.on : 1

  if (band) {
    const local = band.aimLocal(aimScreen)
    if (local !== null) heroRing.aim = local
    heroRing.frame(now)
    showBand(now, turn, strikeAt >= 0 ? flicker(now - strikeAt) : 0, stage ? stage.levels.on : 1)
    stage?.frame(now)
    return
  }

  spinner.style.transform = `rotateY(${turn.toFixed(2)}deg)`
  tilt.style.transform = `rotateX(${tiltNow.x.toFixed(2)}deg) rotateY(${tiltNow.y.toFixed(2)}deg)`
  /* Seen from behind the ring is mirrored left to right, so its arc has to be aimed mirrored too. */
  const fromBehind = Math.cos(((turn + tiltNow.y) * Math.PI) / 180) < 0
  heroRing.aim = fromBehind ? 180 - aimScreen : aimScreen
  stage?.frame(now)
  heroRing.frame(now)
  copyBack(turn + tiltNow.y)
}

/* Draws the model and points the follow spot at its face, wherever the turntable has carried it. */
function showBand(now: number, turn: number, lit: number, on: number) {
  if (!band) return
  const beat = beatAt(now)
  band.frame({
    turn,
    tiltX: tiltNow.x,
    tiltY: tiltNow.y,
    lit,
    on,
    palette: palette(beat),
    kick: calm ? 0 : kick(beat),
    pointer: pointerNow,
    levels: heroRing.levels,
    colours: heroRing.colours,
  })
  const f = band.face()
  view.face = { x: f.x, y: f.y, r: f.r }
  stage?.setFace(f.x, f.y, f.r * (0.6 + 0.4 * Math.max(0, f.facing)))
}

function drawStill() {
  const now = performance.now()
  if (heroRing.mode === 'off') heroRing.set('compass', now)
  if (band) {
    heroRing.aim = band.aimLocal(-50) ?? -50
    heroRing.frame(now)
    showBand(now, 0, 1, 0.8)
  } else {
    spinner.style.transform = ''
    heroRing.aim = -50
    heroRing.frame(now)
  }
  if (stage) {
    stage.levels.on = 0.8
    stage.levels.spot = 1
    stage.frame(now)
  }
}

/* ---------- Start ---------- */

async function start() {
  const fontReady = document.fonts?.load('900 100px "Epilogue Variable"').catch(() => null)
  await Promise.race([fontReady, new Promise((r) => setTimeout(r, 900))])
  const chars = prepareTitle(title)
  const skipIntro = calm || window.scrollY > 40 || !root.classList.contains('intro')
  measure()
  window.addEventListener('resize', () => requestAnimationFrame(measure))
  void loadBand()

  if (!calm) {
    buildEdge()
    scrollY0 = window.scrollY
    window.addEventListener('scroll', onScroll, { passive: true })
  }

  if (skipIntro) {
    root.classList.remove('intro')
    root.classList.add('no-intro')
    title.classList.add('is-ready')
    setShade(0)
    if (calm) {
      drawStill()
      return
    }
    strike(performance.now() - 400)
    requestAnimationFrame(loop)
    return
  }

  setShade(1)
  requestAnimationFrame(loop)
  await runIntro(title, chars, {
    onKey: () => stage?.key(),
    onRise: () => root.classList.remove('intro'),
    onStrike: () => strike(performance.now()),
    onDone: () => {},
  })
}

start()
