import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  PMREMGenerator,
  PerspectiveCamera,
  PointLight,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  Shape,
  ShapeGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { RGB } from './show'

/* Model units: the face plate is 1 tall. The face looks down +z with its long side up y, the woven strap
   loops behind it in the y-z plane and closes in a slider bead below, and the turntable's axis runs up
   through the middle of the whole band. */

const CASE = { w: 0.7, h: 1.02, r: 0.13, top: 0.21 }
const PLATE = { w: 0.684, h: 1.004, r: 0.122, top: 0.246 }
/* The lights sit under the frosted plate in a circle towards its top end, round a grey button. */
const RING = { y: 0.16, r: 0.245, button: 0.173 }
const STRAP = { width: 0.2, half: 0.006 }
/* Model units per repeat of the woven pattern. */
const MOTIF = 0.24
const BEAD = { y: -0.815, z: -0.3 }
const PIVOT = 0.25
const LIFT = 0.24
const REST_YAW = -30
const ELEVATION = 0.2
const ROLL = -0.08

export interface BandFrame {
  /** Turntable angle, degrees. */
  turn: number
  /** Pointer tilt, degrees. */
  tiltX: number
  tiltY: number
  /** The follow spot, 0 (dark) to 1. */
  lit: number
  /** The show lights, 0 to 1. */
  on: number
  palette: readonly RGB[]
  kick: number
  /** Stage pixels; on is 0 or 1. */
  pointer: { x: number; y: number; on: number }
  levels: ArrayLike<number>
  colours: readonly RGB[]
}

export interface BandFace {
  x: number
  y: number
  r: number
  /** 1 facing the crowd, 0 edge-on, below 0 facing away. */
  facing: number
}

export interface Band3D {
  readonly canvas: HTMLCanvasElement
  /** Put the turntable's axis at a stage point, at so many pixels per model unit. */
  place(x: number, y: number, unit: number): void
  frame(f: BandFrame): void
  face(): BandFace
  /** A screen direction (degrees clockwise from east) as an angle on the face, or null edge-on. */
  aimLocal(screenDeg: number): number | null
  destroy(): void
}

const rad = (d: number) => (d * Math.PI) / 180
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/* ---------- The case and plate ---------- */

function roundedRect(w: number, h: number, r: number) {
  const s = new Shape()
  const x = w / 2
  const y = h / 2
  s.moveTo(-x + r, -y)
  s.lineTo(x - r, -y)
  s.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false)
  s.lineTo(x, y - r)
  s.absarc(x - r, y - r, r, 0, Math.PI / 2, false)
  s.lineTo(-x + r, y)
  s.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false)
  s.lineTo(-x, -y + r)
  s.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false)
  return s
}

/* Points round a rounded rectangle, anticlockwise, each with its outward normal. */
function outline(w: number, h: number, r: number, steps: number) {
  const pts: { p: Vector2; n: Vector2 }[] = []
  const corners: [number, number, number][] = [
    [w / 2 - r, -h / 2 + r, -90],
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, 90],
    [-w / 2 + r, -h / 2 + r, 180],
  ]
  for (const [cx, cy, a0] of corners) {
    for (let k = 0; k <= steps; k++) {
      const a = rad(a0 + (90 * k) / steps)
      const n = new Vector2(Math.cos(a), Math.sin(a))
      pts.push({ p: new Vector2(cx + r * n.x, cy + r * n.y), n })
    }
  }
  return pts
}

/* A rounded-rectangle block from z0 to z1 with its edges rounded over by b, normals smooth round the
   edges and flat on the two faces. */
function roundedSlab(w: number, h: number, r: number, z0: number, z1: number, b: number, steps = 14) {
  const cw = w - 2 * b
  const ch = h - 2 * b
  const cr = Math.max(0.002, r - b)
  const ring = outline(cw, ch, cr, steps)
  const prof: { o: number; z: number; no: number; nz: number }[] = []
  const bs = 6
  for (let k = 0; k <= bs; k++) {
    const a = rad(-90 + (90 * k) / bs)
    prof.push({ o: b * Math.cos(a), z: z0 + b + b * Math.sin(a), no: Math.cos(a), nz: Math.sin(a) })
  }
  for (let k = 0; k <= bs; k++) {
    const a = rad((90 * k) / bs)
    prof.push({ o: b * Math.cos(a), z: z1 - b + b * Math.sin(a), no: Math.cos(a), nz: Math.sin(a) })
  }
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  ring.forEach(({ p, n }, i) => {
    for (const q of prof) {
      pos.push(p.x + n.x * q.o, p.y + n.y * q.o, q.z)
      nor.push(n.x * q.no, n.y * q.no, q.nz)
      uv.push(i / ring.length, q.z)
    }
  })
  const P = prof.length
  const index: number[] = []
  for (let i = 0; i < ring.length; i++) {
    const i2 = (i + 1) % ring.length
    for (let j = 0; j < P - 1; j++) {
      const a = i * P + j
      const bb = i * P + j + 1
      const c = i2 * P + j + 1
      const d = i2 * P + j
      index.push(a, d, c, a, c, bb)
    }
  }
  const wall = new BufferGeometry()
  wall.setAttribute('position', new Float32BufferAttribute(pos, 3))
  wall.setAttribute('normal', new Float32BufferAttribute(nor, 3))
  wall.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  wall.setIndex(index)
  const top = new ShapeGeometry(roundedRect(cw, ch, cr), steps)
  top.translate(0, 0, z1)
  const bottom = new ShapeGeometry(roundedRect(cw, ch, cr), steps)
  bottom.rotateX(Math.PI)
  bottom.translate(0, 0, z0)
  return mergeGeometries([wall, top, bottom])!
}

function lathe(profile: [number, number][], segments = 96) {
  const g = new LatheGeometry(
    profile.map(([r, h]) => new Vector2(r, h)),
    segments,
  )
  g.rotateX(Math.PI / 2)
  return g
}

/* The ring's angles were measured off a photograph; the device spaces its lights evenly. */
function evenly(angles: readonly number[]) {
  const n = angles.length
  const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180
  const dir = Math.sign(angles.slice(1).reduce((s, a, i) => s + wrap(a - angles[i]), 0)) || 1
  const step = (dir * 360) / n
  let sx = 0
  let sy = 0
  angles.forEach((a, i) => {
    sx += Math.cos(rad(a - i * step))
    sy += Math.sin(rad(a - i * step))
  })
  const base = (Math.atan2(sy, sx) * 180) / Math.PI
  return angles.map((_, i) => base + i * step)
}

/* ---------- The strap ---------- */

/* A flat strap with rounded edges, as a closed outline across its width and thickness. */
function stadium(width: number, half: number, flat = 6, arc = 6): [number, number][] {
  const pts: [number, number][] = []
  const x0 = width / 2 - half
  for (let k = 0; k < flat; k++) pts.push([-x0 + (2 * x0 * k) / flat, half])
  for (let k = 0; k < arc; k++) {
    const a = Math.PI / 2 - (Math.PI * k) / arc
    pts.push([x0 + half * Math.cos(a), half * Math.sin(a)])
  }
  for (let k = 0; k < flat; k++) pts.push([x0 - (2 * x0 * k) / flat, -half])
  for (let k = 0; k < arc; k++) {
    const a = -Math.PI / 2 - (Math.PI * k) / arc
    pts.push([-x0 + half * Math.cos(a), half * Math.sin(a)])
  }
  return pts
}

interface Ribbon {
  points: Vector3[]
  closed: boolean
  /** Turn of the strap about its own length, radians, along 0 to 1. */
  twist?: (t: number) => number
  width?: (t: number) => number
  half: number
  /** Repeats of the woven pattern per model unit of length. */
  motif: number
  /** Also write uv1 with the pattern, and uv running 0 to 1 down the length (for the frayed end). */
  tail?: boolean
}

/* Sweeps the strap's section along a path in the y-z plane. */
function ribbonGeometry(r: Ribbon) {
  const pts = r.points
  const n = pts.length
  const s: number[] = [0]
  for (let i = 1; i < n; i++) s.push(s[i - 1] + pts[i].distanceTo(pts[i - 1]))
  const total = s[n - 1]
  const pos: number[] = []
  const uv: number[] = []
  const uv1: number[] = []
  const tangent = new Vector3()
  const across = new Vector3()
  const normal = new Vector3()
  let per = 0
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const prev = r.closed && i === 0 ? pts[n - 2] : pts[Math.max(0, i - 1)]
    const next = r.closed && i === n - 1 ? pts[1] : pts[Math.min(n - 1, i + 1)]
    tangent.subVectors(next, prev).normalize()
    across.set(1, 0, 0)
    if (r.twist) across.applyAxisAngle(tangent, r.twist(t))
    across.addScaledVector(tangent, -across.dot(tangent)).normalize()
    normal.crossVectors(across, tangent).normalize()
    const w = r.width ? r.width(t) : STRAP.width
    const section = stadium(w, r.half)
    per = section.length
    for (const [ax, an] of section) {
      const p = pts[i]
      pos.push(p.x + across.x * ax + normal.x * an, p.y + across.y * ax + normal.y * an, p.z + across.z * ax + normal.z * an)
      const v = ax / w + 0.5
      if (r.tail) {
        uv.push(s[i] / total, v)
        uv1.push(s[i] * r.motif, v)
      } else {
        uv.push(s[i] * r.motif, v)
      }
    }
  }
  const index: number[] = []
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < per; j++) {
      const a = i * per + j
      const b = (i + 1) * per + j
      const c = (i + 1) * per + ((j + 1) % per)
      const d = i * per + ((j + 1) % per)
      index.push(a, d, b, b, d, c)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  if (r.tail) g.setAttribute('uv1', new Float32BufferAttribute(uv1, 2))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

const yz = (pts: [number, number, number?][]) => pts.map(([y, z, x = 0]) => new Vector3(x, y, z))

/* Under the face, up over the top of the wrist, round the back and down to the bead, where the
   two ends pass through together. */
const LOOP = yz([
  [0, -0.007],
  [0.3, -0.007],
  [0.5, -0.012],
  [0.625, -0.07],
  [0.69, -0.2],
  [0.685, -0.38],
  [0.6, -0.54],
  [0.42, -0.66],
  [0.14, -0.72],
  [-0.16, -0.7],
  [-0.4, -0.6],
  [-0.6, -0.47],
  [-0.76, -0.3],
  [-0.62, -0.13],
  [-0.52, -0.025],
  [-0.3, -0.007],
])

const TAILS = [
  {
    points: yz([
      [-0.83, -0.29],
      [-0.92, -0.285, 0.006],
      [-1.01, -0.272, 0.016],
      [-1.1, -0.256, 0.03],
      [-1.18, -0.245, 0.042],
    ]),
    twist: 0.42,
  },
  {
    points: yz([
      [-0.83, -0.312],
      [-0.91, -0.322, -0.004],
      [-0.99, -0.34, -0.014],
      [-1.08, -0.364, -0.028],
    ]),
    twist: -0.32,
  },
]

/* A woven festival strap: a pale jacquard figure mirrored across a dark spine, on charcoal. */
function weave() {
  const W = 512
  const H = Math.round((W * STRAP.width) / MOTIF)
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const x = c.getContext('2d')!
  x.fillStyle = '#1c1e24'
  x.fillRect(0, 0, W, H)
  const pale = '#b9bbc2'
  x.fillStyle = pale
  for (const flip of [1, -1]) {
    x.save()
    x.translate(0, H / 2)
    x.scale(1, flip)
    x.beginPath()
    x.moveTo(W * 0.03, -H * 0.07)
    x.bezierCurveTo(W * 0.2, -H * 0.1, W * 0.28, -H * 0.42, W * 0.5, -H * 0.4)
    x.bezierCurveTo(W * 0.38, -H * 0.31, W * 0.3, -H * 0.17, W * 0.47, -H * 0.08)
    x.bezierCurveTo(W * 0.3, -H * 0.06, W * 0.17, -H * 0.05, W * 0.03, -H * 0.07)
    x.fill()
    x.beginPath()
    x.moveTo(W * 0.55, -H * 0.08)
    x.bezierCurveTo(W * 0.68, -H * 0.12, W * 0.72, -H * 0.38, W * 0.9, -H * 0.35)
    x.bezierCurveTo(W * 0.83, -H * 0.27, W * 0.78, -H * 0.13, W * 0.97, -H * 0.07)
    x.closePath()
    x.fill()
    for (const [u, v, r] of [
      [0.6, 0.31, 0.02],
      [0.67, 0.42, 0.014],
      [0.22, 0.4, 0.016],
      [0.97, 0.38, 0.014],
    ]) {
      x.beginPath()
      x.arc(W * u, -H * v, W * r, 0, Math.PI * 2)
      x.fill()
    }
    x.restore()
  }
  x.fillStyle = '#0a0a0d'
  x.fillRect(0, H * 0.455, W, H * 0.09)
  x.fillStyle = pale
  for (let k = 0; k < 4; k++) {
    const cx = (W * (k + 0.5)) / 4
    const d = H * 0.035
    x.beginPath()
    x.moveTo(cx - d * 1.6, H / 2)
    x.lineTo(cx, H / 2 - d)
    x.lineTo(cx + d * 1.6, H / 2)
    x.lineTo(cx, H / 2 + d)
    x.closePath()
    x.fill()
  }
  x.fillStyle = '#101115'
  x.fillRect(0, 0, W, H * 0.05)
  x.fillRect(0, H * 0.95, W, H * 0.05)
  x.fillStyle = 'rgba(0,0,0,0.18)'
  for (let i = 0; i < W; i += 4) x.fillRect(i, 0, 1.5, H)
  x.fillStyle = 'rgba(255,255,255,0.05)'
  for (let j = 0; j < H; j += 4) x.fillRect(0, j, W, 1.5)
  const map = new CanvasTexture(c)
  map.colorSpace = SRGBColorSpace
  map.wrapS = RepeatWrapping
  map.anisotropy = 8

  /* The weave's relief: alternating over-and-under threads. */
  const b = document.createElement('canvas')
  b.width = b.height = 64
  const y = b.getContext('2d')!
  y.fillStyle = '#808080'
  y.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const across = (i + j) % 2 === 0
      const g = across ? y.createLinearGradient(0, j * 8, 0, j * 8 + 8) : y.createLinearGradient(i * 8, 0, i * 8 + 8, 0)
      g.addColorStop(0, '#3a3a3a')
      g.addColorStop(0.5, '#e0e0e0')
      g.addColorStop(1, '#3a3a3a')
      y.fillStyle = g
      y.fillRect(i * 8, j * 8, 8, 8)
    }
  }
  const bump = new CanvasTexture(b)
  bump.wrapS = bump.wrapT = RepeatWrapping
  const cell = 0.016
  bump.repeat.set(MOTIF / cell / 8, STRAP.width / cell / 8)
  return { map, bump }
}

/* The cut end of each tail: the weft is gone, so the warp threads run out to ragged lengths. */
function frayTexture() {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const x = c.getContext('2d')!
  x.fillStyle = '#000'
  x.fillRect(0, 0, 256, 64)
  x.fillStyle = '#fff'
  x.fillRect(0, 0, 256 * 0.8, 64)
  const threads = 26
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  for (let k = 0; k < threads; k++) {
    const y0 = (64 * k) / threads
    const end = 256 * (0.83 + rand() * 0.16)
    x.fillRect(0, y0, end, (64 / threads) * 0.72)
  }
  return new CanvasTexture(c)
}

function glowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const x = c.getContext('2d')!
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.3, 'rgba(255,255,255,0.4)')
  g.addColorStop(0.65, 'rgba(255,255,255,0.08)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = g
  x.fillRect(0, 0, 128, 128)
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  return tex
}

export function createBand(canvas: HTMLCanvasElement, angles: readonly number[]): Band3D | null {
  let renderer: WebGLRenderer
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' })
  } catch {
    return null
  }
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = 1

  const scene = new Scene()
  const pmrem = new PMREMGenerator(renderer)
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  scene.environment = env

  const camera = new PerspectiveCamera(24, 1, 0.1, 60)

  /* ---------- Materials ---------- */

  const { map, bump } = weave()
  const woven = {
    roughness: 0.88,
    metalness: 0,
    bumpScale: 0.9,
    sheen: 0.8,
    sheenRoughness: 0.7,
    sheenColor: new Color('#a9adbb'),
    envMapIntensity: 0.25,
  }
  const strap = new MeshPhysicalMaterial({ ...woven, map, bumpMap: bump })
  const tailMap = map.clone()
  tailMap.channel = 1
  tailMap.needsUpdate = true
  const tailBump = bump.clone()
  tailBump.channel = 1
  tailBump.needsUpdate = true
  const tail = new MeshPhysicalMaterial({
    ...woven,
    map: tailMap,
    bumpMap: tailBump,
    alphaMap: frayTexture(),
    alphaTest: 0.5,
    side: DoubleSide,
  })

  /* Printed black plastic, matte. */
  const shell = new MeshStandardMaterial({ color: '#161618', roughness: 0.72, metalness: 0, envMapIntensity: 0.3 })
  const button = new MeshStandardMaterial({ color: '#8b8c8f', roughness: 0.5, metalness: 0, envMapIntensity: 0.3 })
  const port = new MeshStandardMaterial({ color: '#040405', roughness: 0.9 })
  const tongue = new MeshStandardMaterial({ color: '#55565a', roughness: 0.4, metalness: 0.6 })
  const bead = new MeshPhysicalMaterial({ color: '#101012', roughness: 0.42, clearcoat: 0.2, clearcoatRoughness: 0.5, envMapIntensity: 0.3 })

  /* The frosted plate: each light shows through it as a soft spot that merges with its neighbours
     into one ring, and where the light is strong it swamps the plate's own white. */
  const leds = evenly(angles).map((a) => new Vector2(RING.r * Math.cos(rad(a)), RING.y - RING.r * Math.sin(rad(a))))
  const ledColour = leds.map(() => new Color(0, 0, 0))
  const n = leds.length
  const plate = new MeshStandardMaterial({ color: '#cdccc6', roughness: 0.55, metalness: 0, envMapIntensity: 0.35 })
  plate.onBeforeCompile = (shader) => {
    shader.uniforms.uLedPos = { value: leds }
    shader.uniforms.uLedCol = { value: ledColour }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPlate;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPlate = position.xy;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vPlate;
uniform vec2 uLedPos[${n}];
uniform vec3 uLedCol[${n}];`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 ledGlow = vec3(0.0);
for (int i = 0; i < ${n}; i++) {
  vec2 d = vPlate - uLedPos[i];
  float q = dot(d, d);
  ledGlow += uLedCol[i] * (1.3 * exp(-q * 800.0) + 1.5 * exp(-q * 150.0) + 0.35 * exp(-q * 30.0));
}
diffuseColor.rgb *= 1.0 - 0.88 * clamp(max(ledGlow.r, max(ledGlow.g, ledGlow.b)) / 1.2, 0.0, 1.0);`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += ledGlow;')
  }

  /* ---------- The band ---------- */

  const band = new Group()
  band.position.set(0, LIFT, PIVOT)
  band.rotation.z = ROLL

  const loop = new CatmullRomCurve3(LOOP, true, 'centripetal')
  const loopLength = loop.getLength()
  band.add(
    new Mesh(
      ribbonGeometry({
        points: loop.getSpacedPoints(420),
        closed: true,
        half: STRAP.half,
        motif: Math.round(loopLength / MOTIF) / loopLength,
      }),
      strap,
    ),
  )
  for (const t of TAILS) {
    const curve = new CatmullRomCurve3(t.points, false, 'centripetal')
    band.add(
      new Mesh(
        ribbonGeometry({
          points: curve.getSpacedPoints(60),
          closed: false,
          half: 0.005,
          twist: (u) => t.twist * u * u,
          width: (u) => STRAP.width * (1 + 0.12 * smooth(0.72, 1, u)),
          motif: 1 / MOTIF,
          tail: true,
        }),
        tail,
      ),
    )
  }
  const beadGeo = roundedSlab(0.27, 0.11, 0.05, -0.065, 0.065, 0.028, 10)
  beadGeo.rotateX(Math.PI / 2)
  const beadMesh = new Mesh(beadGeo, bead)
  beadMesh.position.set(0, BEAD.y, BEAD.z)
  band.add(beadMesh)

  const pod = new Group()
  band.add(pod)
  pod.add(new Mesh(roundedSlab(CASE.w, CASE.h, CASE.r, 0, CASE.top, 0.018), shell))
  pod.add(new Mesh(roundedSlab(PLATE.w, PLATE.h, PLATE.r, CASE.top, PLATE.top, 0.012), plate))
  const buttonMesh = new Mesh(
    lathe([
      [RING.button + 0.0005, PLATE.top - 0.003],
      [RING.button, PLATE.top],
      [RING.button - 0.002, PLATE.top + 0.0025],
      [RING.button - 0.006, PLATE.top + 0.0035],
      [0, PLATE.top + 0.0035],
    ]),
    button,
  )
  buttonMesh.position.y = RING.y
  pod.add(buttonMesh)

  /* The charging port, in the end that faces the elbow. */
  const portGeo = new ShapeGeometry(roundedRect(0.1, 0.034, 0.017), 8)
  portGeo.rotateX(Math.PI / 2)
  const portMesh = new Mesh(portGeo, port)
  portMesh.position.set(0, -CASE.h / 2 - 0.0008, CASE.top * 0.5)
  pod.add(portMesh)
  const tongueGeo = new ShapeGeometry(roundedRect(0.066, 0.009, 0.0045), 4)
  tongueGeo.rotateX(Math.PI / 2)
  const tongueMesh = new Mesh(tongueGeo, tongue)
  tongueMesh.position.set(0, -CASE.h / 2 - 0.0012, CASE.top * 0.5)
  pod.add(tongueMesh)

  /* A little bloom off each light, as a camera sees it. */
  const glowMap = glowTexture()
  const blooms = leds.map((p) => {
    const glow = new Sprite(
      new SpriteMaterial({ map: glowMap, color: '#ffffff', blending: AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, opacity: 0 }),
    )
    glow.position.set(p.x, p.y, PLATE.top + 0.012)
    glow.scale.setScalar(0.2)
    pod.add(glow)
    return glow
  })

  const turntable = new Group()
  turntable.add(band)
  const rig = new Group()
  rig.add(turntable)
  scene.add(rig)

  /* ---------- Lights ---------- */

  const key = new DirectionalLight('#fff4e6', 0)
  key.position.set(0.8, 4.2, 3.6)
  scene.add(key)
  const fill = new HemisphereLight('#8a93a8', '#0b0b0c', 0)
  scene.add(fill)
  const rimL = new DirectionalLight('#ffffff', 0)
  rimL.position.set(-4, 1.6, -3.2)
  scene.add(rimL)
  const rimR = new DirectionalLight('#ffffff', 0)
  rimR.position.set(4, 1.1, -3.4)
  scene.add(rimR)
  const hand = new PointLight('#e3ecff', 0, 0, 2)
  scene.add(hand)
  const spill = new PointLight('#ffffff', 0, 0, 2)
  spill.position.set(0, RING.y, PLATE.top + 0.35)
  pod.add(spill)

  /* ---------- Placement ---------- */

  const box = { left: 0, top: 0, w: 1, h: 1, unit: 100 }
  const SPAN = { w: 3, h: 2.7 }

  function place(x: number, y: number, unit: number) {
    box.unit = unit
    box.w = Math.round(unit * SPAN.w)
    box.h = Math.round(unit * SPAN.h)
    box.left = Math.round(x - box.w / 2)
    box.top = Math.round(y - box.h / 2)
    canvas.style.left = `${box.left}px`
    canvas.style.top = `${box.top}px`
    canvas.style.width = `${box.w}px`
    canvas.style.height = `${box.h}px`
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(box.w, box.h, false)
    camera.aspect = box.w / box.h
    camera.position.set(0, 0, SPAN.h / 2 / Math.tan(rad(camera.fov / 2)))
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
  }

  /* ---------- Frame ---------- */

  const c3 = new Color()
  const v = new Vector3()

  function frame(f: BandFrame) {
    rig.rotation.x = ELEVATION + rad(f.tiltX) * 0.6
    rig.rotation.y = rad(f.tiltY) * 0.6
    turntable.rotation.y = rad(REST_YAW + f.turn)

    const lit = f.lit
    /* Near black until the follow spot finds it: the white plate would otherwise show through the title. */
    scene.environmentIntensity = 0.03 + 0.97 * lit
    key.intensity = 0.02 + 3.1 * lit
    fill.intensity = 0.015 + 0.5 * lit
    const pal = f.palette
    rimL.color.setRGB(pal[0][0], pal[0][1], pal[0][2], SRGBColorSpace)
    rimR.color.setRGB(pal[1][0], pal[1][1], pal[1][2], SRGBColorSpace)
    rimL.intensity = f.on * (1.1 + 2.4 * f.kick)
    rimR.intensity = f.on * (0.9 + 2.0 * f.kick)

    hand.position.set((f.pointer.x - box.left - box.w / 2) / box.unit, -(f.pointer.y - box.top - box.h / 2) / box.unit, 1.7)
    hand.intensity += (f.pointer.on * lit * 5 - hand.intensity) * 0.12

    scene.updateMatrixWorld()
    const show = smooth(0.02, 0.35, faceFacing())
    let total = 0
    c3.setRGB(0, 0, 0)
    ledColour.forEach((col, i) => {
      /* Squared, so a faint level stays faint and only the lit arc reads as light. */
      const l = Math.min(1, f.levels[i] ?? 0)
      const l2 = l * l
      const c = f.colours[i]
      col.setRGB(c[0], c[1], c[2], SRGBColorSpace)
      blooms[i].material.color.copy(col)
      blooms[i].material.opacity = Math.min(1, l2 * 0.6) * show
      c3.r += col.r * l2
      c3.g += col.g * l2
      c3.b += col.b * l2
      col.multiplyScalar(l2)
      total += l2
    })
    if (total > 0.01) spill.color.setRGB(c3.r / total, c3.g / total, c3.b / total)
    spill.intensity = total * 0.012

    renderer.render(scene, camera)
  }

  function faceFacing() {
    const centre = pod.localToWorld(v.set(0, RING.y, PLATE.top)).clone()
    const tip = pod.localToWorld(v.set(0, RING.y, PLATE.top + 1)).clone()
    const normal = tip.sub(centre).normalize()
    const toCam = camera.position.clone().sub(centre).normalize()
    return normal.dot(toCam)
  }

  function toStage(p: Vector3) {
    const q = p.clone().project(camera)
    return { x: box.left + ((q.x + 1) / 2) * box.w, y: box.top + ((1 - q.y) / 2) * box.h }
  }

  /* The ring's centre, and a radius wide enough for the follow spot to take in the whole band. */
  function face(): BandFace {
    const centre = pod.localToWorld(v.set(0, RING.y, PLATE.top)).clone()
    const at = toStage(centre)
    const edge = toStage(centre.clone().add(new Vector3(0.62, 0, 0)))
    return { x: at.x, y: at.y, r: Math.abs(edge.x - at.x), facing: faceFacing() }
  }

  function aimLocal(screenDeg: number) {
    const o = toStage(pod.localToWorld(new Vector3(0, RING.y, PLATE.top)))
    const ex = toStage(pod.localToWorld(new Vector3(0.3, RING.y, PLATE.top)))
    const ey = toStage(pod.localToWorld(new Vector3(0, RING.y + 0.3, PLATE.top)))
    const sx = { x: ex.x - o.x, y: ex.y - o.y }
    const sy = { x: ey.x - o.x, y: ey.y - o.y }
    const det = sx.x * sy.y - sx.y * sy.x
    if (Math.abs(det) < 0.08 * Math.hypot(sx.x, sx.y) * Math.hypot(sy.x, sy.y)) return null
    const dx = Math.cos(rad(screenDeg))
    const dy = Math.sin(rad(screenDeg))
    const a = (dx * sy.y - dy * sy.x) / det
    const b = (sx.x * dy - sx.y * dx) / det
    return (Math.atan2(-b, a) * 180) / Math.PI
  }

  return {
    canvas,
    place,
    frame,
    face,
    aimLocal,
    destroy() {
      renderer.dispose()
      env.dispose()
    },
  }
}
