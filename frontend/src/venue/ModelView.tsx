import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LoaderCircle, RotateCw } from 'lucide-react'
import type { Mesh } from 'three'
import { Button } from '@/components/ui/button'
import { megabytes } from './runs'

type Load =
  | { phase: 'idle' }
  | { phase: 'loading'; loaded: number; total: number }
  | { phase: 'ready' }
  | { phase: 'error'; message: string }

/** What is left of the model's height when the roof is cut away, so the floor shows from above. */
const CUT_SHARE = 0.45

interface Props {
  src: string | null
  /** False while a replay has not reached the saved model yet: the file loads, the frame waits. */
  shown?: boolean
  /** The expected file size, for the progress bar before the server says. */
  bytes?: number
  cut: boolean
  /** Shown in the frame before there is a model to show. */
  empty: ReactNode
  label: string
}

/**
 * A venue's saved model, turned slowly on its own until someone drags it. Three.js loads only when
 * there is a model to show, and the frame stops drawing while it is off screen.
 */
export function ModelView({ src, shown = true, bytes = 0, cut, empty, label }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const setCut = useRef<(on: boolean) => void>(() => {})
  const cutNow = useRef(cut)
  const shownNow = useRef(shown)
  const wakeNow = useRef<() => void>(() => {})
  const [load, setLoad] = useState<Load>({ phase: 'idle' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    cutNow.current = cut
    setCut.current(cut)
  }, [cut])

  useEffect(() => {
    shownNow.current = shown
    wakeNow.current()
  }, [shown])

  useEffect(() => {
    const el = host.current
    if (!src || !el || import.meta.env.MODE === 'test') {
      setLoad({ phase: 'idle' })
      return
    }
    let disposed = false
    let cleanup = () => {}
    setLoad({ phase: 'loading', loaded: 0, total: bytes })
    void (async () => {
      try {
        const THREE = await import('three')
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
        const { OrbitControls } = await import('three/addons/controls/OrbitControls.js')
        if (disposed) return
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.localClippingEnabled = true
        renderer.setClearColor(0x000000, 0)
        const canvas = renderer.domElement
        canvas.style.display = 'block'
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        el.appendChild(canvas)

        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 6000)
        scene.add(new THREE.HemisphereLight(0xf4f2ec, 0x1c1c20, 1.9))
        const sun = new THREE.DirectionalLight(0xffffff, 1.6)
        scene.add(sun)
        const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6)

        const gltf = await new GLTFLoader().loadAsync(src, (event) => {
          if (!disposed) setLoad({ phase: 'loading', loaded: event.loaded, total: event.total || bytes })
        })
        if (disposed) {
          renderer.dispose()
          canvas.remove()
          return
        }
        const model = gltf.scene
        model.traverse((obj) => {
          const mesh = obj as Mesh
          if (!mesh.isMesh) return
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const material of mats) {
            material.side = THREE.DoubleSide
            material.clippingPlanes = [plane]
          }
        })
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        model.position.set(-center.x, -box.min.y, -center.z)
        scene.add(model)
        const cutAt = size.y * CUT_SHARE
        setCut.current = (on) => {
          plane.constant = on ? cutAt : 1e6
        }
        setCut.current(cutNow.current)

        const reach = Math.max(size.x, size.z)
        const yaw = THREE.MathUtils.degToRad(-32)
        const pitch = THREE.MathUtils.degToRad(42)
        const distance = reach * 1.18
        camera.position.set(Math.sin(yaw) * Math.cos(pitch) * distance, Math.sin(pitch) * distance, Math.cos(yaw) * Math.cos(pitch) * distance)
        sun.position.set(reach * 0.6, reach * 1.2, reach * 0.4)
        const controls = new OrbitControls(camera, canvas)
        controls.target.set(0, size.y * 0.15, 0)
        controls.enableDamping = true
        controls.dampingFactor = 0.08
        controls.minDistance = reach * 0.2
        controls.maxDistance = reach * 3
        controls.maxPolarAngle = THREE.MathUtils.degToRad(86)
        const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
        controls.autoRotate = !still
        controls.autoRotateSpeed = 0.45
        controls.addEventListener('start', () => {
          controls.autoRotate = false
        })

        const fit = () => {
          const width = Math.max(1, el.clientWidth)
          const height = Math.max(1, el.clientHeight)
          renderer.setSize(width, height, false)
          camera.aspect = width / height
          camera.updateProjectionMatrix()
        }
        fit()
        const resize = new ResizeObserver(fit)
        resize.observe(el)

        let frame = 0
        let inView = true
        const draw = () => {
          frame = 0
          if (!inView || document.hidden || !shownNow.current) return
          controls.update()
          renderer.render(scene, camera)
          frame = requestAnimationFrame(draw)
        }
        const wake = () => {
          if (!frame && inView && !document.hidden && shownNow.current) frame = requestAnimationFrame(draw)
        }
        const seen = new IntersectionObserver(([entry]) => {
          inView = entry?.isIntersecting ?? true
          wake()
        })
        seen.observe(el)
        document.addEventListener('visibilitychange', wake)
        wakeNow.current = wake
        wake()
        setLoad({ phase: 'ready' })

        cleanup = () => {
          cancelAnimationFrame(frame)
          resize.disconnect()
          seen.disconnect()
          document.removeEventListener('visibilitychange', wake)
          controls.dispose()
          model.traverse((obj) => {
            const mesh = obj as Mesh
            if (!mesh.isMesh) return
            mesh.geometry.dispose()
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
            for (const material of mats) {
              for (const value of Object.values(material)) {
                if (value instanceof THREE.Texture) value.dispose()
              }
              material.dispose()
            }
          })
          renderer.dispose()
          canvas.remove()
          setCut.current = () => {}
          wakeNow.current = () => {}
        }
      } catch (error) {
        if (disposed) return
        console.warn('venue preview failed', error)
        setLoad({ phase: 'error', message: error instanceof Error ? error.message : 'The file could not be read.' })
      }
    })()
    return () => {
      disposed = true
      cleanup()
    }
  }, [src, bytes, attempt])

  const share = load.phase === 'loading' && load.total > 0 ? Math.min(1, load.loaded / load.total) : 0
  const waiting = !src || !shown

  return (
    <div className="relative aspect-[16/9] w-full overflow-hidden rounded-[3px] bg-ground lg:aspect-auto lg:min-h-[22rem] lg:flex-1" role="img" aria-label={label}>
      <div ref={host} className={waiting ? 'invisible absolute inset-0' : 'absolute inset-0 cursor-grab active:cursor-grabbing'} />
      {waiting && <div className="absolute inset-0 grid place-items-center p-6 text-center">{empty}</div>}
      {!waiting && load.phase === 'loading' && (
        <div className="absolute inset-x-0 bottom-0 p-5" role="status">
          <p className="flex items-center gap-2 text-[13px] text-ink-dim">
            <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Loading the model
            {load.total > 0 && <span className="tabular-nums text-ink-muted">{`${megabytes(load.loaded)} of ${megabytes(load.total)}`}</span>}
          </p>
          <div className="mt-2 h-0.5 w-full bg-line">
            <div className="h-full bg-ink-dim" style={{ width: `${share * 100}%` }} />
          </div>
        </div>
      )}
      {!waiting && load.phase === 'error' && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div>
            <p className="text-[14px] text-ink">Couldn't load the model.</p>
            <p className="mt-1 text-[13px] text-ink-dim">{load.message}</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
              <RotateCw /> Try again
            </Button>
          </div>
        </div>
      )}
      {!waiting && load.phase === 'ready' && (
        <p className="pointer-events-none absolute bottom-3 left-4 text-[12px] text-ink-muted">Drag to turn, scroll to zoom</p>
      )}
    </div>
  )
}
