import { useEffect, useRef } from 'react'

const COLORS = ['#f4bfd7', '#b7d9f5', '#bfe6d5', '#ffd2b3', '#d5c5f5']

/** Decorative light only: native pointer events never rerender the registration form. */
export function ConcertLights({ enabled }: { enabled: boolean }) {
  const lights = useRef<HTMLDivElement>(null)
  const color = useRef(0)

  useEffect(() => {
    const layer = lights.current
    const page = layer?.parentElement
    const wash = layer?.querySelector<HTMLElement>('.concert-cursor-wash')
    if (!page || !layer || !wash || !enabled) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let lastBeat = 0
    let lastX = 0
    let lastY = 0
    let x = window.innerWidth * 0.75
    let y = Math.min(window.innerHeight * 0.3, 300)
    let pulse: Animation | undefined

    const position = () => {
      frame = 0
      layer.style.setProperty('--light-x', `${x}px`)
      layer.style.setProperty('--light-y', `${y}px`)
    }
    const beat = (animate: boolean) => {
      color.current = (color.current + 1) % COLORS.length
      page.style.setProperty('--concert-color', COLORS[color.current])
      lastBeat = performance.now()
      lastX = x
      lastY = y
      pulse?.cancel()
      if (animate && !reduced.matches) {
        pulse = wash.animate?.([
          { opacity: 0.6, transform: 'scale(.94)' },
          { opacity: 1, transform: 'scale(1.08)', offset: 0.3 },
          { opacity: 0.6, transform: 'scale(1)' },
        ], { duration: 850, easing: 'cubic-bezier(.22,1,.36,1)' })
      }
    }
    const move = (event: PointerEvent) => {
      if (reduced.matches || event.pointerType === 'touch') return
      x = event.clientX
      y = event.clientY
      if (!frame) frame = requestAnimationFrame(position)
      // A new color on a deliberate sweep, rather than flickering on every pixel.
      if (performance.now() - lastBeat > 650 && Math.hypot(x - lastX, y - lastY) > 90) beat(false)
    }
    const click = (event: MouseEvent) => {
      if (!reduced.matches && event.detail > 0) {
        x = event.clientX
        y = event.clientY
        cancelAnimationFrame(frame)
        position()
      }
      beat(true)
    }
    const quiet = () => {
      if (!reduced.matches) return
      cancelAnimationFrame(frame)
      frame = 0
      pulse?.cancel()
    }
    position()
    page.addEventListener('pointermove', move, { passive: true })
    page.addEventListener('click', click, { passive: true })
    reduced.addEventListener('change', quiet)
    return () => {
      cancelAnimationFrame(frame)
      pulse?.cancel()
      page.removeEventListener('pointermove', move)
      page.removeEventListener('click', click)
      reduced.removeEventListener('change', quiet)
    }
  }, [enabled])

  return (
    <div ref={lights} className="concert-lights" aria-hidden="true">
      <div className="concert-beam concert-beam-left" />
      <div className="concert-beam concert-beam-right" />
      <div className="concert-cursor"><div className="concert-cursor-wash" /></div>
    </div>
  )
}
