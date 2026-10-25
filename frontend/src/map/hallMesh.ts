/**
 * The CalHacks hall, drawn from the merged venue GLB (`web/venue/venue.glb` on the venue-GLB
 * branch). That export kept the meshes and dropped the object names, so the plan coordinates and
 * the labels still come from the Palace app. Palace space is metres, Y up. Plan space matches the
 * rest of the map: X east, Y south, Z up.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { MODEL_MARGIN } from '@/venue/chosenModel'
import type { Camera } from './projection'

/** Same origin shift the traced plan was built with, so meshes and labels share one floor. */
const OX = 50.84 + 8
const OY = 106.57 + 8

/** The Palace's ceilings start above this height; its mezzanine tabletops at about 5.6 m stay. */
const PALACE_ROOF_M = 7.6
/** For any other venue, flat surfaces above this share of its height are roofs and slabs. */
const ROOF_SHARE = 0.45

/** What the hall draws: the Palace with its traced plan, or a chosen venue fitted by its box. */
export interface HallSource {
  url: string
  venueId: string
  fit: 'palace' | 'bounds'
}

export const PALACE_HALL: HallSource = { url: '/venue/venue.glb', venueId: 'calhacks', fit: 'palace' }

/** A Palace model point (metres, y up) in plan space: x east, y south, h up. */
export function palacePoint(x: number, y: number, z: number): { x: number; y: number; h: number } {
  return { x: -z + OX, y: x + OY, h: y }
}

/**
 * Any other venue's model point in plan space. Its exports are metres with y up, x east and z south,
 * so the box's low corner lands at the margin and its floor at height 0.
 */
export function boundsPoint(x: number, y: number, z: number, min: { x: number; y: number; z: number }): { x: number; y: number; h: number } {
  return { x: x - min.x + MODEL_MARGIN, y: z - min.z + MODEL_MARGIN, h: y - min.y }
}

interface Portrait {
  src: string
  name: string
  /** Point on the photo the square is built around, 0–1. */
  focus?: { x: number; y: number }
}

/**
 * Square portraits with a name under each, for one of the screens beside the stage.
 * The mesh UVs put v = 1 at the top of the board, and a canvas texture keeps that with the default flip.
 */
function stagePortraits(people: Portrait[]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1780
  canvas.height = 1000
  const ctx = canvas.getContext('2d')!
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  const loaded: (HTMLImageElement | null)[] = people.map(() => null)
  const paint = () => {
    ctx.fillStyle = '#f4f6f8'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const marginX = 96
    const marginTop = 44
    const nameBand = 156
    const gap = 64
    const size = Math.min((canvas.width - marginX * 2 - gap) / 2, canvas.height - marginTop - nameBand - 28)
    const pair = size * 2 + gap
    const x0 = (canvas.width - pair) / 2
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#1c1d20'
    ctx.font = '92px "Instrument Serif", Georgia, serif'
    people.forEach((person, i) => {
      const x = x0 + i * (size + gap)
      const img = loaded[i]
      if (img) {
        const { sx, sy, side } = squareOf(img, person.focus)
        ctx.drawImage(img, sx, sy, side, side, x, marginTop, size, size)
      }
      ctx.fillText(person.name, x + size / 2, marginTop + size + nameBand / 2)
    })
    tex.needsUpdate = true
  }
  let pending = people.length
  people.forEach((person, i) => {
    const img = new Image()
    img.onload = () => {
      loaded[i] = img
      if (--pending === 0) paint()
    }
    img.src = person.src
  })
  void document.fonts?.ready.then(() => {
    if (pending === 0) paint()
  })
  paint()
  return tex
}

/** A square cut from the photo, centered on `focus` so a tall frame still lands on the face. */
function squareOf(img: HTMLImageElement, focus = { x: 0.5, y: 0.42 }): { sx: number; sy: number; side: number } {
  const w = img.naturalWidth
  const h = img.naturalHeight
  const square = Math.abs(w - h) / Math.max(w, h) < 0.04
  const side = square ? Math.min(w, h) : Math.round(Math.min(w, h) * 0.72)
  const sx = Math.max(0, Math.min(w - side, focus.x * w - side / 2))
  const sy = Math.max(0, Math.min(h - side, focus.y * h - side / 2))
  return { sx, sy, side }
}

function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
}

const LEFT_BOARD: Portrait[] = [
  { src: asset('/venue/people/viktor.png'), name: 'Viktor' },
  { src: asset('/venue/people/leo.png'), name: 'Leo' },
]

const RIGHT_BOARD: Portrait[] = [
  { src: asset('/venue/people/luke.png'), name: 'Luke' },
  { src: asset('/venue/people/edward.jpg'), name: 'Edward', focus: { x: 0.36, y: 0.34 } },
]

/** Drop only the high flat ceilings. Mezzanine tabletops sit around 5.6 m and have to stay. */
function withoutRoofs(index: THREE.BufferAttribute | null, position: Float32Array, roofM = PALACE_ROOF_M): number[] {
  const count = index ? index.count : position.length / 3
  const kept: number[] = []
  const at = (i: number) => {
    const v = index ? index.getX(i) : i
    return [position[v * 3], position[v * 3 + 1], position[v * 3 + 2], v] as const
  }
  for (let t = 0; t < count; t += 3) {
    const a = at(t)
    const b = at(t + 1)
    const c = at(t + 2)
    const ux = b[0] - a[0]
    const uy = b[1] - a[1]
    const uz = b[2] - a[2]
    const vx = c[0] - a[0]
    const vy = c[1] - a[1]
    const vz = c[2] - a[2]
    const ny = uz * vx - ux * vz
    const len = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx) || 1
    const avgY = (a[1] + b[1] + c[1]) / 3
    if (avgY > roofM && Math.abs(ny) / len > 0.65) continue
    kept.push(a[3], b[3], c[3])
  }
  return kept
}

/** The mezzanine flights are one white mesh, with a tread about every 0.2 m. */
function isStairRun(name: string, position: Float32Array): boolean {
  if (name !== 'standard-ffffff') return false
  const bands = new Set<number>()
  for (let i = 1; i < position.length; i += 3) {
    const y = position[i]
    if (y < 0.15 || y > 5) continue
    bands.add(Math.round(y * 5))
  }
  return bands.size >= 8
}

/**
 * One line across each tread. The mesh is flat white, so the short edges of every box turn into a
 * hatch; the long lip of the step is what reads as a stair.
 */
function stairOutline(geom: THREE.BufferGeometry): THREE.LineSegments {
  const edges = new THREE.EdgesGeometry(mergeVertices(geom.clone(), 1e-3), 20)
  const src = edges.getAttribute('position')
  const kept: number[] = []
  for (let i = 0; i < src.count; i += 2) {
    const dy = Math.abs(src.getY(i) - src.getY(i + 1))
    const span = Math.hypot(src.getX(i) - src.getX(i + 1), src.getZ(i) - src.getZ(i + 1))
    if (dy > 0.05 || span < 1.1) continue
    kept.push(src.getX(i), src.getY(i), src.getZ(i), src.getX(i + 1), src.getY(i + 1), src.getZ(i + 1))
  }
  edges.dispose()
  const lines = new THREE.BufferGeometry()
  lines.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3))
  const line = new THREE.LineSegments(
    lines,
    new THREE.LineBasicMaterial({
      color: 0x24262b,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }),
  )
  line.renderOrder = 2
  return line
}

export class HallMesh {
  readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000)
  private readonly onReady: () => void
  readonly source: HallSource
  private ready = false
  private width = 1
  private height = 1

  constructor(host: HTMLElement, onReady: () => void, source: HallSource = PALACE_HALL) {
    this.onReady = onReady
    this.source = source
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
    this.canvas = this.renderer.domElement
    this.canvas.style.position = 'absolute'
    this.canvas.style.inset = '0'
    this.canvas.style.pointerEvents = 'none'
    this.canvas.setAttribute('aria-hidden', 'true')
    // Under the map's own canvas, so a hall swapped in later never covers the zones and the crowd.
    host.insertBefore(this.canvas, host.firstChild)
    this.camera.matrixAutoUpdate = false
    this.camera.matrixWorldAutoUpdate = false
    void this.load()
  }

  /** True once the hall is on screen for this venue. */
  showing(venueId: string | undefined): boolean {
    return this.ready && venueId === this.source.venueId
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.renderer.setSize(this.width, this.height)
  }

  render(cam: Camera): void {
    if (!this.ready) return
    this.sync(cam)
    this.renderer.render(this.scene, this.camera)
  }

  destroy(): void {
    this.ready = false
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh && !(obj as THREE.Line).isLine) return
      mesh.geometry.dispose()
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of mats) material.dispose()
    })
    this.renderer.dispose()
    this.canvas.remove()
  }

  private async load(): Promise<void> {
    try {
      const palace = this.source.fit === 'palace'
      const gltf = await new GLTFLoader().loadAsync(palace ? asset(this.source.url) : this.source.url)
      if (!this.canvas.isConnected) return
      this.scene.add(palace ? this.bake(gltf.scene) : this.bakeBounds(gltf.scene))
      this.ready = true
      this.onReady()
    } catch (err) {
      console.warn('venue model failed to load', err)
    }
  }

  /** Move each mesh from Palace axes into plan metres and leave it under an identity transform. */
  private bake(root: THREE.Object3D): THREE.Group {
    root.updateMatrixWorld(true)
    const group = new THREE.Group()
    const v = new THREE.Vector3()
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      const geom = mesh.geometry.clone()
      const pos = geom.getAttribute('position')
      const next = new Float32Array(pos.count * 3)
      let palaceZ = 0
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
        palaceZ += v.z
        const p = palacePoint(v.x, v.y, v.z)
        next[i * 3] = p.x
        next[i * 3 + 1] = p.h
        next[i * 3 + 2] = p.y
      }
      // The two pale screens flank the stage. The loader renames the second, so match the
      // original node name. Higher palace Z is the audience's left.
      const boardName = String(mesh.userData?.name ?? mesh.name ?? '')
      const flank = boardName.startsWith('standard-f4f6f8')
      const portraits = flank ? stagePortraits(palaceZ / pos.count > -8 ? LEFT_BOARD : RIGHT_BOARD) : null
      geom.setAttribute('position', new THREE.BufferAttribute(next, 3))
      geom.setIndex(withoutRoofs(geom.getIndex(), next))
      geom.deleteAttribute('normal')
      geom.computeVertexNormals()
      geom.computeBoundingSphere()
      const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const made = source.map((material) => {
        const colored = material as THREE.MeshStandardMaterial
        const hasMap = Boolean(colored.map)
        const color = colored.color instanceof THREE.Color ? colored.color.clone() : new THREE.Color(0xffffff)
        // The export names this wood mesh after its paint. Recolor it to the concert's stage pastel.
        if (mesh.name === 'standard-b97f4b') color.set(0xb8a6ff)
        else if (hasMap) color.set(0xffffff)
        else if (color.r + color.g + color.b < 0.45) {
          color.r = 0.24 + color.r * 0.35
          color.g = 0.25 + color.g * 0.35
          color.b = 0.28 + color.b * 0.35
        }
        const basic = new THREE.MeshBasicMaterial({
          color: portraits ? 0xffffff : color,
          map: portraits ?? colored.map ?? null,
          transparent: !portraits && hasMap && colored.transparent,
          depthWrite: true,
          side: THREE.DoubleSide,
        })
        if (basic.map) basic.map.colorSpace = THREE.SRGBColorSpace
        return basic
      })
      group.add(new THREE.Mesh(geom, made.length === 1 ? made[0] : made))
      if (isStairRun(boardName, next)) group.add(stairOutline(geom))
    })
    return group
  }

  /**
   * Any other venue: no traced plan, so the model is placed by its own box, its roofs and upper slabs
   * are dropped so the floor shows from above, and its colours are kept with the Palace's lift for
   * near-black paint.
   */
  private bakeBounds(root: THREE.Object3D): THREE.Group {
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)
    const roofM = Math.max(2.6, (box.max.y - box.min.y) * ROOF_SHARE)
    const group = new THREE.Group()
    const v = new THREE.Vector3()
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      const geom = mesh.geometry.clone()
      const pos = geom.getAttribute('position')
      const next = new Float32Array(pos.count * 3)
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
        const p = boundsPoint(v.x, v.y, v.z, box.min)
        next[i * 3] = p.x
        next[i * 3 + 1] = p.h
        next[i * 3 + 2] = p.y
      }
      geom.setAttribute('position', new THREE.BufferAttribute(next, 3))
      geom.setIndex(withoutRoofs(geom.getIndex(), next, roofM))
      geom.deleteAttribute('normal')
      geom.computeVertexNormals()
      geom.computeBoundingSphere()
      const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const made = source.map((material) => {
        const colored = material as THREE.MeshStandardMaterial
        const hasMap = Boolean(colored.map)
        const color = colored.color instanceof THREE.Color ? colored.color.clone() : new THREE.Color(0xffffff)
        if (hasMap) color.set(0xffffff)
        else if (color.r + color.g + color.b < 0.45) {
          color.r = 0.24 + color.r * 0.35
          color.g = 0.25 + color.g * 0.35
          color.b = 0.28 + color.b * 0.35
        }
        const basic = new THREE.MeshBasicMaterial({
          color,
          map: colored.map ?? null,
          transparent: hasMap && colored.transparent,
          depthWrite: true,
          side: THREE.DoubleSide,
        })
        if (basic.map) basic.map.colorSpace = THREE.SRGBColorSpace
        return basic
      })
      group.add(new THREE.Mesh(geom, made.length === 1 ? made[0] : made))
    })
    return group
  }

  /**
   * Match the map's orthographic camera. Plan X is world X, height is world Y, plan Y (south) is
   * world Z. Screen Y grows downward.
   */
  private sync(cam: Camera): void {
    const yaw = cam.yaw
    const tilt = cam.tilt
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    const ct = Math.cos(tilt)
    const st = Math.sin(tilt)
    const { cx, cy } = cam
    // Camera sits above the floor and looks down, matching the map: taller points move up the
    // screen and toward the camera. The previous Z row pointed the other way and showed undersides.
    const depthBias = 800
    const view = new THREE.Matrix4().set(
      c, 0, -s, -c * cx + s * cy,
      -ct * s, st, -ct * c, ct * (s * cx + c * cy),
      st * s, ct, st * c, -st * (s * cx + c * cy) - depthBias,
      0, 0, 0, 1,
    )
    this.camera.matrixWorldInverse.copy(view)
    this.camera.matrixWorld.copy(view).invert()

    const spanX = this.width / cam.scale
    const spanY = this.height / cam.scale
    const sumX = -spanX * ((2 * cam.ax) / this.width - 1)
    const sumY = (2 * cam.ay - this.height) / cam.scale
    const left = (sumX - spanX) / 2
    const right = (sumX + spanX) / 2
    const bottom = (sumY - spanY) / 2
    const top = (sumY + spanY) / 2
    this.camera.projectionMatrix.makeOrthographic(left, right, top, bottom, 1, 4000)
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert()
  }
}
