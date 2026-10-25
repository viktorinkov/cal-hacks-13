import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import { color } from '@/lib/tokens'
import type { PlacedPhoto, Scan } from './photoPlaces'

export interface Lens {
  x: number
  y: number
  w: number
  h: number
}

export interface PhotoScan {
  attach(container: HTMLElement): void
  detach(): void
  setPhotos(photos: PlacedPhoto[]): void
  hover(id: string | null): void
  open(id: string | null): void
  fit(): void
  on(handlers: Partial<Handlers>): void
}

interface Handlers {
  ready: () => void
  pick: (id: string) => void
  hover: (id: string | null, at: { x: number; y: number } | null) => void
  lens: (lens: Lens | null) => void
}

const SURE = new THREE.Color(color.champagne)
const UNSURE = new THREE.Color(color.inkMuted)
const LIT = new THREE.Color(color.ink)
const FLIGHT_MS = 1500
const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const ease = (t: number) => (t === 1 ? 1 : 1 - 2 ** (-10 * t))

export function photoScan(scan: Scan): PhotoScan {
  const metre = scan.metre
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.domElement.style.display = 'block'
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(color.ground)
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 2000)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.09
  controls.maxPolarAngle = Math.PI * 0.47
  scene.add(new SparkRenderer({ renderer }))

  const handlers: Handlers = { ready: () => {}, pick: () => {}, hover: () => {}, lens: () => {} }
  const hall = new SplatMesh({ url: scan.roofless })
  const whole = new SplatMesh({ url: scan.full })
  for (const mesh of [hall, whole]) {
    mesh.matrixAutoUpdate = false
    mesh.matrix.fromArray(scan.matrix)
    scene.add(mesh)
  }
  whole.visible = false
  let wholeReady = false
  hall.initialized.then(() => handlers.ready())
  whole.initialized.then(() => {
    wholeReady = true
    if (opened) {
      whole.visible = true
      hall.visible = false
    }
  })

  const textures = new THREE.TextureLoader()
  const cameras = new Map<string, { photo: PlacedPhoto; group: THREE.Group; plane: THREE.Mesh; lines: THREE.LineSegments; marks: THREE.Group }>()
  let photos: PlacedPhoto[] = []
  let hovered: string | null = null
  let opened: PlacedPhoto | null = null
  let bands: THREE.Group | null = null
  let container: HTMLElement | null = null
  let attached = false
  let flight: { t0: number; ms: number; p: [THREE.Vector3, THREE.Vector3]; q: [THREE.Quaternion, THREE.Quaternion]; f: [number, number]; done?: () => void } | null = null
  const home = { eye: new THREE.Vector3(0, 60, 80), target: new THREE.Vector3() }

  function poseOf(photo: PlacedPhoto) {
    const m = new THREE.Matrix4().set(...(photo.c2w.flat() as [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]))
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    m.decompose(pos, quat, new THREE.Vector3())
    return { m, pos, quat }
  }

  function frustum(photo: PlacedPhoto) {
    const { m } = poseOf(photo)
    const group = new THREE.Group()
    group.matrixAutoUpdate = false
    group.matrix.copy(m)
    const d = 2.6 * metre
    const [w, h] = photo.size
    const hx = (d * w) / 2 / photo.focal
    const hy = (d * h) / 2 / photo.focal
    const tex = textures.load(photo.thumb)
    tex.colorSpace = THREE.SRGBColorSpace
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * hx, 2 * hy),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, opacity: photo.sure ? 0.92 : 0.45 }),
    )
    plane.position.z = -d
    plane.userData.id = photo.id
    const o = new THREE.Vector3()
    const c = [
      [-hx, -hy],
      [hx, -hy],
      [hx, hy],
      [-hx, hy],
    ].map(([x, y]) => new THREE.Vector3(x, y, -d))
    const lines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([o, c[0], o, c[1], o, c[2], o, c[3], c[0], c[1], c[1], c[2], c[2], c[3], c[3], c[0]]),
      new THREE.LineBasicMaterial({ color: photo.sure ? SURE : UNSURE, transparent: true, opacity: photo.sure ? 0.85 : 0.5 }),
    )
    group.add(plane, lines)
    group.updateMatrixWorld(true)
    const { pos } = poseOf(photo)
    const tone = photo.sure ? SURE : UNSURE
    const drop = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([pos, new THREE.Vector3(pos.x, 0, pos.z)]),
      new THREE.LineBasicMaterial({ color: tone, transparent: true, opacity: 0.45 }),
    )
    const spot = new THREE.Mesh(
      new THREE.CircleGeometry(0.28 * metre, 32),
      new THREE.MeshBasicMaterial({ color: tone, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    )
    spot.rotation.x = -Math.PI / 2
    spot.position.set(pos.x, 0.04 * metre, pos.z)
    const marks = new THREE.Group()
    marks.add(drop, spot)
    return { photo, group, plane, lines, marks }
  }

  function paint() {
    for (const [id, item] of cameras) {
      const lit = id === hovered
      ;(item.lines.material as THREE.LineBasicMaterial).color.copy(lit ? LIT : item.photo.sure ? SURE : UNSURE)
      ;(item.lines.material as THREE.LineBasicMaterial).opacity = lit ? 1 : item.photo.sure ? 0.85 : 0.5
      ;(item.plane.material as THREE.MeshBasicMaterial).opacity = lit ? 1 : item.photo.sure ? 0.92 : 0.45
    }
  }

  function fitHome() {
    const box = new THREE.Box3()
    for (const p of photos) box.expandByPoint(poseOf(p).pos)
    if (box.isEmpty()) box.set(new THREE.Vector3(-40, 0, -30), new THREE.Vector3(40, 0, 30))
    const centre = box.getCenter(new THREE.Vector3()).setY(0)
    const size = box.getSize(new THREE.Vector3())
    const r = Math.max(Math.hypot(size.x, size.z) * 0.5, 28 * metre)
    const across = new THREE.Vector3(-size.z, 0, size.x)
    if (across.lengthSq() < 1e-6) across.set(0, 0, 1)
    across.normalize()
    home.target.copy(centre).addScaledVector(across, -r * 0.16)
    home.eye.copy(home.target).addScaledVector(across, r * 0.42).setY(r * 1.05)
  }

  function look(from: THREE.Vector3, to: THREE.Vector3) {
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(from, to, new THREE.Vector3(0, 1, 0)))
  }

  function fly(pos: THREE.Vector3, quat: THREE.Quaternion, fov: number, done?: () => void) {
    controls.enabled = false
    if (still()) {
      camera.position.copy(pos)
      camera.quaternion.copy(quat)
      camera.fov = fov
      camera.updateProjectionMatrix()
      done?.()
      if (!opened) controls.enabled = true
      return
    }
    flight = { t0: performance.now(), ms: FLIGHT_MS, p: [camera.position.clone(), pos], q: [camera.quaternion.clone(), quat], f: [camera.fov, fov], done }
  }

  function lensRect(photo: PlacedPhoto): Lens {
    const W = container?.clientWidth ?? 1
    const H = container?.clientHeight ?? 1
    const wide = W >= 1000
    const box = wide ? { x: 316, y: 24, w: W - 340, h: H - 48 } : { x: 12, y: 56, w: W - 24, h: H * 0.5 }
    const aspect = photo.size[0] / photo.size[1]
    let w = box.w
    let h = w / aspect
    if (h > box.h) {
      h = box.h
      w = h * aspect
    }
    return { x: box.x + (box.w - w) / 2, y: wide ? box.y + (box.h - h) / 2 : box.y, w, h }
  }

  function aim(photo: PlacedPhoto) {
    const W = container?.clientWidth ?? 1
    const H = container?.clientHeight ?? 1
    const r = lensRect(photo)
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    const fullW = 2 * Math.max(cx, W - cx)
    const fullH = 2 * Math.max(cy, H - cy)
    camera.setViewOffset(fullW, fullH, fullW / 2 - cx, fullH / 2 - cy, W, H)
    camera.aspect = fullW / fullH
    const half = Math.atan(photo.size[1] / 2 / photo.focal)
    return (2 * Math.atan(Math.tan(half) * (fullH / r.h)) * 180) / Math.PI
  }

  function showBands(photo: PlacedPhoto | null) {
    if (bands) {
      scene.remove(bands)
      bands.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose()
          ;(o.material as THREE.Material).dispose()
        }
      })
      bands = null
    }
    if (!photo || !photo.sure) return
    bands = new THREE.Group()
    const at = poseOf(photo).pos
    for (const b of photo.bands) {
      const [x, z] = b.xz
      if (b.role !== 'in photo' || Math.hypot(x - at.x, z - at.z) < 2 * metre) continue
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.16 * metre, 16, 12), new THREE.MeshBasicMaterial({ color: color.champagne }))
      dot.position.set(x, 1.25 * metre, z)
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(Math.max(0.35, b.r) * 0.92, Math.max(0.35, b.r), 48),
        new THREE.MeshBasicMaterial({ color: color.champagne, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.set(x, 0.03 * metre, z)
      bands.add(dot, ring)
    }
    scene.add(bands)
  }

  function resize() {
    if (!container) return
    const w = container.clientWidth
    const h = container.clientHeight
    renderer.setSize(w, h, false)
    if (opened) camera.fov = aim(opened)
    else camera.aspect = w / Math.max(1, h)
    camera.updateProjectionMatrix()
    if (opened && !flight) handlers.lens(lensRect(opened))
  }
  const observer = new ResizeObserver(resize)

  const ray = new THREE.Raycaster()
  let down: { x: number; y: number } | null = null
  function hit(e: PointerEvent): string | null {
    const r = renderer.domElement.getBoundingClientRect()
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera)
    const planes = [...cameras.values()].map((c) => c.plane)
    return (ray.intersectObjects(planes, false)[0]?.object.userData.id as string | undefined) ?? null
  }
  function onMove(e: PointerEvent) {
    if (opened || flight || e.buttons) return
    const id = hit(e)
    if (id !== hovered) {
      hovered = id
      paint()
      renderer.domElement.style.cursor = id ? 'pointer' : ''
    }
    const r = renderer.domElement.getBoundingClientRect()
    handlers.hover(id, id ? { x: e.clientX - r.left, y: e.clientY - r.top } : null)
  }
  function onDown(e: PointerEvent) {
    down = { x: e.clientX, y: e.clientY }
  }
  function onUp(e: PointerEvent) {
    if (!down || opened || flight) return
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
    down = null
    if (moved > 4) return
    const id = hit(e)
    if (id) handlers.pick(id)
  }
  function onLeave() {
    if (hovered && !opened) {
      hovered = null
      paint()
      handlers.hover(null, null)
    }
  }

  function frame(now: number) {
    if (flight) {
      const t = Math.min(1, (now - flight.t0) / flight.ms)
      const k = ease(t)
      camera.position.lerpVectors(flight.p[0], flight.p[1], k)
      camera.quaternion.slerpQuaternions(flight.q[0], flight.q[1], k)
      camera.fov = flight.f[0] + (flight.f[1] - flight.f[0]) * k
      camera.updateProjectionMatrix()
      if (t >= 1) {
        const done = flight.done
        flight = null
        if (!opened) controls.enabled = true
        done?.()
      }
    } else if (!opened) {
      controls.update()
    }
    renderer.render(scene, camera)
  }

  return {
    attach(el) {
      container = el
      attached = true
      el.appendChild(renderer.domElement)
      observer.observe(el)
      resize()
      camera.position.copy(home.eye)
      controls.target.copy(home.target)
      controls.update()
      renderer.domElement.addEventListener('pointermove', onMove)
      renderer.domElement.addEventListener('pointerdown', onDown)
      renderer.domElement.addEventListener('pointerup', onUp)
      renderer.domElement.addEventListener('pointerleave', onLeave)
      renderer.setAnimationLoop(frame)
    },
    detach() {
      attached = false
      renderer.setAnimationLoop(null)
      observer.disconnect()
      renderer.domElement.remove()
      controls.dispose()
      showBands(null)
      for (const item of cameras.values()) {
        item.plane.geometry.dispose()
        ;(item.plane.material as THREE.MeshBasicMaterial).map?.dispose()
        ;(item.plane.material as THREE.Material).dispose()
        item.lines.geometry.dispose()
        ;(item.lines.material as THREE.Material).dispose()
        item.marks.traverse((o) => {
          if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
            o.geometry.dispose()
            ;(o.material as THREE.Material).dispose()
          }
        })
      }
      hall.dispose()
      whole.dispose()
      renderer.dispose()
    },
    setPhotos(next) {
      if (next.length === photos.length && next.every((p, i) => p.id === photos[i].id && p.c2w === photos[i].c2w)) return
      photos = next
      for (const item of cameras.values()) scene.remove(item.group, item.marks)
      cameras.clear()
      for (const p of next) {
        const item = frustum(p)
        item.group.visible = item.marks.visible = !opened
        cameras.set(p.id, item)
        scene.add(item.group, item.marks)
      }
      fitHome()
      if (attached && !opened) {
        camera.position.copy(home.eye)
        controls.target.copy(home.target)
        controls.update()
      }
    },
    hover(id) {
      if (opened) return
      hovered = id
      paint()
    },
    open(id) {
      const photo = id ? photos.find((p) => p.id === id) ?? null : null
      if (!photo) {
        if (!opened) return
        opened = null
        handlers.lens(null)
        camera.clearViewOffset()
        camera.aspect = (container?.clientWidth ?? 1) / Math.max(1, container?.clientHeight ?? 1)
        camera.updateProjectionMatrix()
        showBands(null)
        whole.visible = false
        hall.visible = true
        for (const item of cameras.values()) item.group.visible = item.marks.visible = true
        fly(home.eye.clone(), look(home.eye, home.target), 50, () => controls.target.copy(home.target))
        return
      }
      opened = photo
      hovered = null
      paint()
      handlers.hover(null, null)
      handlers.lens(null)
      for (const item of cameras.values()) item.group.visible = item.marks.visible = false
      hall.visible = !wholeReady
      whole.visible = wholeReady
      showBands(photo)
      const { pos, quat } = poseOf(photo)
      fly(pos, quat, aim(photo), () => {
        if (opened === photo) handlers.lens(lensRect(photo))
      })
    },
    fit() {
      if (opened) return
      fly(home.eye.clone(), look(home.eye, home.target), 50, () => controls.target.copy(home.target))
    },
    on(next) {
      Object.assign(handlers, next)
    },
  }
}
