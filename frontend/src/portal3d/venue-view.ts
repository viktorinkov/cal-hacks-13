// The venue's shared 3D view, ported from the portal: the GLB hall cut open at the mezzanine, orbit
// controls, camera flights, and the layer the crowd, incidents, zone circles and floor names live on.

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { h } from './dom'
import { VenueNames, type Spot } from './venue-names'
import type { DbConnection } from '@/stdb/module_bindings'

/** The model that ships with the app when no other venue is chosen. */
const DEFAULT_MODEL = '/venue/venue.glb'

/** On the map everything of the model above this height is cut away, so the mezzanine (its underside is at
 * 4.25 m) and the roof do not hide the crowd. Only the model is cut, so the incidents' beams rise above it. */
const CUT_M = 4.1
const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e9)
const OVERVIEW_PITCH = THREE.MathUtils.degToRad(56)
const FIT_MARGIN_PX = 16
const CLOSE_M = 58
const CLOSE_PITCH = THREE.MathUtils.degToRad(48)
const FLIGHT_MS = 1300

let conn: DbConnection
let view: HTMLElement | undefined
let viewNote: HTMLElement
let loadedUrl = ''
let shownUrl = ''
let load: (url: string) => void
let renderer: THREE.WebGLRenderer
let camera: THREE.PerspectiveCamera
let model: THREE.Object3D | undefined
let controls: OrbitControls
let flight: { fromPos: THREE.Vector3; fromTarget: THREE.Vector3; toPos: THREE.Vector3; toTarget: THREE.Vector3; at: number } | undefined
let home = true
const liveLayer = new THREE.Group()
const frames: ((now: number) => void)[] = []
const names = new VenueNames()
let spotsAsked = false
let coloursAt = -Infinity
let disposed = false

/** The colour an exit marker glows: what its station marker reports, else its zone's exit colour, else blue. */
function exitColour(station: number): number {
  return conn.db.station.id.find(station)?.exitColour || [...conn.db.zone.iter()].find((z) => z.stationId === station)?.exitColour || 1
}

function makeView() {
  view = h('div', { style: 'position:absolute;inset:0;width:100%;height:100%' })
  viewNote = h('p', { style: 'position:absolute;left:12px;bottom:8px;margin:0;font:12px/1.4 system-ui;color:#445' })
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.localClippingEnabled = true
  view.append(renderer.domElement, names.box, viewNote)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#0a0a0b')
  scene.add(new THREE.HemisphereLight('#ffffff', '#a7abb2', 1.6))
  const sun = new THREE.DirectionalLight('#fff8ee', 2.6)
  scene.add(sun)
  liveLayer.visible = true
  liveLayer.add(names.markers)
  scene.add(liveLayer)
  camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.5, 2000)
  controls = new OrbitControls(camera, renderer.domElement)
  controls.addEventListener('start', () => { flight = undefined; home = false })
  let asked = 0

  load = (url: string) => {
    loadedUrl = url
    const mine = ++asked
    viewNote.textContent = 'Loading the model…'
    new GLTFLoader().loadAsync(url).then((gltf) => {
      if (mine !== asked) return
      if (model) scene.remove(model)
      model = gltf.scene
      model.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          m.side = THREE.DoubleSide
          m.clippingPlanes = [cut]
        }
      })
      scene.add(model)
      shownUrl = url
      const box = new THREE.Box3().setFromObject(model)
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3()).length() || 1
      camera.near = size / 1000
      camera.far = size * 10
      camera.updateProjectionMatrix()
      sun.position.copy(center).add(new THREE.Vector3(-0.2, 0.45, 0.3).multiplyScalar(size))
      overview(false)
      viewNote.textContent = 'Drag to turn, scroll to zoom.'
    }).catch((e: unknown) => {
      if (mine === asked) viewNote.textContent = `The model did not load: ${e instanceof Error ? e.message : e}`
    })
  }

  renderer.setAnimationLoop(() => {
    if (disposed || !view!.isConnected) return
    const w = view!.clientWidth
    const hgt = view!.clientHeight || Math.round(w * 9 / 16)
    if (w && (renderer.domElement.width !== Math.floor(w * renderer.getPixelRatio()) || camera.aspect !== w / hgt)) {
      renderer.setSize(w, hgt)
      camera.aspect = w / hgt
      camera.updateProjectionMatrix()
      if (home) overview(false)
    }
    if (flight) {
      const f = flight
      const t = Math.min(1, (performance.now() - f.at) / FLIGHT_MS)
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      camera.position.lerpVectors(f.fromPos, f.toPos, e)
      controls.target.lerpVectors(f.fromTarget, f.toTarget, e)
      if (t >= 1) flight = undefined
    }
    controls.update()
    const now = performance.now()
    for (const f of frames) f(now)
    if (now - coloursAt > 1000) {
      coloursAt = now
      names.setExitColours(exitColour)
    }
    names.draw(camera, controls.target, shownUrl === chosenUrl(), true)
    renderer.render(scene, camera)
  })
}

export type LiveView = {
  view: HTMLElement
  note: HTMLElement
  layer: THREE.Group
  canvas: HTMLCanvasElement
  camera: THREE.PerspectiveCamera
  names: VenueNames
  onFrame(f: (now: number) => void): void
  floorAt(e: MouseEvent): { x: number; z: number } | undefined
  rayAt(e: MouseEvent): THREE.Ray
  lookAt(x: number, z: number): void
  overview(): void
}

function bounds(corners: THREE.Vector3[], pos: THREE.Vector3, target: THREE.Vector3, w: number, hgt: number) {
  camera.position.copy(pos)
  camera.lookAt(target)
  camera.updateMatrixWorld()
  const v = new THREE.Vector3()
  const b = [Infinity, Infinity, -Infinity, -Infinity]
  for (const p of corners) {
    v.copy(p).project(camera)
    const x = ((v.x + 1) / 2) * w
    const y = ((1 - v.y) / 2) * hgt
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y)
  }
  return b
}

function overview(fly = true) {
  home = true
  if (!model) return
  const box = new THREE.Box3().setFromObject(model)
  box.max.y = Math.min(box.max.y, CUT_M)
  const corners = [box.min.x, box.max.x].flatMap((x) => [box.min.y, box.max.y].flatMap((y) => [box.min.z, box.max.z].map((z) => new THREE.Vector3(x, y, z))))
  const w = renderer.domElement.clientWidth || 800
  const hgt = renderer.domElement.clientHeight || 450
  const dir = new THREE.Vector3(0, Math.sin(OVERVIEW_PITCH), Math.cos(OVERVIEW_PITCH))
  const target = box.getCenter(new THREE.Vector3()).setY(box.min.y)
  const saved = { pos: camera.position.clone(), target: controls.target.clone() }
  const size = box.getSize(new THREE.Vector3()).length() || 1
  let d = size
  for (let round = 0; round < 3; round++) {
    let lo = size / 50
    let hi = size * 8
    for (let i = 0; i < 24; i++) {
      d = (lo + hi) / 2
      const [l, t, r, b] = bounds(corners, target.clone().addScaledVector(dir, d), target, w, hgt)
      if (l >= FIT_MARGIN_PX && t >= FIT_MARGIN_PX && r <= w - FIT_MARGIN_PX && b <= hgt - FIT_MARGIN_PX) hi = d
      else lo = d
    }
    d = hi
    const [l, t, r, b] = bounds(corners, target.clone().addScaledVector(dir, d), target, w, hgt)
    const metresPerPx = (2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / hgt
    target.x += ((l + r) / 2 - w / 2) * metresPerPx
    target.z += (((t + b) / 2 - hgt / 2) * metresPerPx) / Math.sin(OVERVIEW_PITCH)
  }
  camera.position.copy(saved.pos)
  camera.lookAt(saved.target)
  go(target.clone().addScaledVector(dir, d), target, fly)
}

function lookAt(x: number, z: number) {
  home = false
  const target = new THREE.Vector3(x, 0, z)
  const from = camera.position.clone().sub(controls.target)
  const distance = Math.min(CLOSE_M, from.length())
  from.y = 0
  if (from.lengthSq() < 1) from.set(0, 0, 1)
  from.normalize().multiplyScalar(Math.cos(CLOSE_PITCH) * distance)
  from.y = Math.sin(CLOSE_PITCH) * distance
  go(target.clone().add(from), target, true)
}

function go(pos: THREE.Vector3, target: THREE.Vector3, fly: boolean) {
  if (!fly) {
    flight = undefined
    camera.position.copy(pos)
    controls.target.copy(target)
    controls.update()
    return
  }
  flight = { fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: pos, toTarget: target, at: performance.now() }
}

function rayAt(e: MouseEvent): THREE.Ray {
  const r = renderer.domElement.getBoundingClientRect()
  const ray = new THREE.Raycaster()
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera)
  return ray.ray
}

function floorAt(e: MouseEvent) {
  const p = rayAt(e).intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())
  if (!p || !model) return undefined
  const box = new THREE.Box3().setFromObject(model)
  return p.x >= box.min.x && p.x <= box.max.x && p.z >= box.min.z && p.z <= box.max.z ? { x: p.x, z: p.z } : undefined
}

/** The chosen venue's model, or the shipped one. */
function chosenUrl(): string {
  const id = conn.db.chosenVenue.id.find(0)?.setupId ?? 0n
  const row = id === 0n ? undefined : conn.db.venueSetup.id.find(id)
  return row?.modelUrl || DEFAULT_MODEL
}

/** The floor's named spots: the `venue_spot` rows, or the venue's spots file when there are none. */
async function spots(): Promise<Spot[]> {
  const rows = [...conn.db.venueSpot.iter()]
  if (rows.length) return rows.map((s) => ({ kind: s.kind, name: s.name, x: s.xM, z: s.yM, station: s.stationId }))
  try {
    const file: Spot[] = await (await fetch('/venue/spots.json')).json()
    return file.map((s) => ({ kind: s.kind, name: s.name, x: s.x, z: s.z, station: 0 }))
  } catch {
    return []
  }
}

/** Start (or reuse) the shared view, cut open with the live layer on. */
export function venueView(c: DbConnection): LiveView {
  conn = c
  disposed = false
  if (!view) makeView()
  if (chosenUrl() !== loadedUrl) load(chosenUrl())
  liveLayer.visible = true
  cut.constant = CUT_M
  if (!spotsAsked) {
    spotsAsked = true
    spots().then((s) => { names.setSpots(s); coloursAt = -Infinity })
  }
  return { view: view!, note: viewNote, layer: liveLayer, canvas: renderer.domElement, camera, names, onFrame: (f) => frames.push(f), floorAt, rayAt, lookAt, overview: () => overview() }
}

/** React unmounts the container: keep the view for the next mount, but stop drawing. */
export function suspendVenue(): void {
  disposed = true
}
