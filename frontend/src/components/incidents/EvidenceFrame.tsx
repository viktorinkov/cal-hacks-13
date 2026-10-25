import { useEffect, useRef } from 'react'
import { CameraOff } from 'lucide-react'
import type { CameraObservation } from '@/contracts/domain'
import { clock } from '@/lib/format'
import { cn } from '@/lib/utils'

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

function rng(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Draws the simulated camera's still: a night crowd under stage light, the box the detector
 * reported, and the flash it matched. It is a stand-in for the CV team's evidence image and is
 * labelled as simulated on the frame itself.
 */
function drawSimulatedFrame(cv: HTMLCanvasElement, obs: CameraObservation, t: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = cv.clientWidth || 360
  const h = cv.clientHeight || 200
  cv.width = Math.round(w * dpr)
  cv.height = Math.round(h * dpr)
  const g = cv.getContext('2d')
  if (!g) return
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  const r = rng(hash(obs.detectionId))
  // night ground
  const bg = g.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, '#0d0b1c')
  bg.addColorStop(1, '#1a1730')
  g.fillStyle = bg
  g.fillRect(0, 0, w, h)
  // stage light cones
  for (let k = 0; k < 4; k++) {
    const x = w * (0.12 + k * 0.26) + (r() - 0.5) * 30
    const cone = g.createLinearGradient(x, 0, x, h)
    cone.addColorStop(0, 'rgba(150,130,255,0.22)')
    cone.addColorStop(1, 'rgba(150,130,255,0)')
    g.fillStyle = cone
    g.beginPath()
    g.moveTo(x - 6, 0)
    g.lineTo(x + 6, 0)
    g.lineTo(x + 70, h)
    g.lineTo(x - 70, h)
    g.closePath()
    g.fill()
  }
  // heads, perspective: smaller and denser toward the back
  for (let i = 0; i < 900; i++) {
    const y = Math.pow(r(), 0.7) * h
    const x = r() * w
    const s = 0.6 + (y / h) * 2.2
    g.fillStyle = `rgba(${170 + r() * 40},${165 + r() * 40},${190 + r() * 30},${0.25 + (y / h) * 0.35})`
    g.beginPath()
    g.arc(x, y, s, 0, Math.PI * 2)
    g.fill()
  }
  const bb = obs.boundingBox
  const flash = (x: number, y: number) => {
    const on = obs.kind === 'sos_flash' ? Math.floor((t % 1000) / 100) % 2 === 0 && t % 1000 < 500 : true
    const glow = g.createRadialGradient(x, y, 0, x, y, 16)
    glow.addColorStop(0, on ? 'rgba(255,70,60,0.95)' : 'rgba(255,70,60,0.25)')
    glow.addColorStop(1, 'rgba(255,70,60,0)')
    g.fillStyle = glow
    g.beginPath()
    g.arc(x, y, 16, 0, Math.PI * 2)
    g.fill()
  }
  g.font = '600 11px "Geist Mono Variable", ui-monospace, monospace'
  if (obs.status === 'detected' && bb) {
    const x = bb.x * w
    const y = bb.y * h
    const bw = bb.w * w
    const bh = bb.h * h
    if (obs.kind === 'sos_flash') flash(x + bw / 2, y + bh / 2)
    g.strokeStyle = '#ff5a4f'
    g.lineWidth = 1.5
    g.strokeRect(x, y, bw, bh)
    g.fillStyle = '#ff5a4f'
    g.fillText(`${obs.kind === 'sos_flash' ? 'SOS FLASH' : 'FALL?'} ${obs.confidence?.toFixed(2) ?? ''}`, x, y - 6)
  } else if (obs.status === 'ambiguous' && bb) {
    const x = bb.x * w
    const y = bb.y * h
    const bw = bb.w * w
    const bh = bb.h * h
    flash(x + bw * 0.2, y + bh * 0.5)
    flash(x + bw * 0.8, y + bh * 0.4)
    g.setLineDash([4, 3])
    g.strokeStyle = '#f0b44c'
    g.lineWidth = 1.2
    g.strokeRect(x, y, bw, bh)
    g.setLineDash([])
    g.fillStyle = '#f0b44c'
    g.fillText('2 CANDIDATES', x, y - 6)
  }
  // caption bar
  g.fillStyle = 'rgba(8,8,10,0.82)'
  g.fillRect(0, h - 22, w, 22)
  g.fillStyle = '#ecebe6'
  g.font = '400 11px "Geist Mono Variable", ui-monospace, monospace'
  g.fillText(`${obs.cameraId}  ${clock(obs.timestamp)}  exposure 1/250`, 8, h - 7)
}

export function EvidenceFrame({ obs, compact = false }: { obs: CameraObservation | undefined; compact?: boolean }) {
  const h = compact ? 'h-[112px]' : 'h-[190px]'
  const empty = compact ? 'h-[84px]' : 'h-[150px]'
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv || !obs || obs.evidenceUrl || !obs.isSimulated) return
    if (obs.status !== 'detected' && obs.status !== 'ambiguous') return
    let raf = 0
    const loop = () => {
      drawSimulatedFrame(cv, obs, performance.now())
      if (obs.kind === 'sos_flash' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [obs])

  if (!obs) {
    return (
      <div className={cn('grid place-items-center rounded-[2px] bg-[#0c0c0f] text-[12px] text-ink-muted shadow-[inset_0_0_0_1px_var(--nc-line)]', empty)}>
        No camera covers this spot
      </div>
    )
  }
  if (obs.status === 'not_visible') {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-2 rounded-[2px] bg-[#0c0c0f] text-center text-[12px] text-ink-muted shadow-[inset_0_0_0_1px_var(--nc-line)]', empty)}>
        <CameraOff aria-hidden className="size-5" />
        <span>
          Not in {obs.cameraId}&rsquo;s view.
          <br />
          No frame to show.
        </span>
      </div>
    )
  }
  if (obs.status === 'pending') {
    return (
      <div className={cn('relative overflow-hidden rounded-[2px] bg-[#0d0b1c] shadow-[inset_0_0_0_1px_var(--nc-line)]', h)}>
        <span aria-hidden className="absolute inset-x-0 h-1/3 animate-scan bg-gradient-to-b from-transparent via-[rgba(184,166,255,0.18)] to-transparent" />
        <span className="absolute inset-0 grid place-items-center text-[12px] text-ink-dim">{obs.cameraId} is looking for the flash…</span>
      </div>
    )
  }
  if (!obs.evidenceUrl && !obs.isSimulated) {
    // a live detection without an image: say so rather than draw anything
    return (
      <div className="grid h-[112px] place-items-center rounded-[2px] bg-[#0c0c0f] text-center text-[12px] text-ink-muted shadow-[inset_0_0_0_1px_var(--nc-line)]">
        No frame from the camera service
      </div>
    )
  }
  return (
    <figure className="relative m-0">
      {obs.evidenceUrl ? (
        <img
          src={obs.evidenceUrl}
          alt={`${obs.cameraId} frame at ${clock(obs.timestamp)}`}
          className={cn('block w-full rounded-[2px] object-cover', h)}
        />
      ) : (
        <canvas
          ref={ref}
          role="img"
          aria-label={`Simulated ${obs.cameraId} frame at ${clock(obs.timestamp)}, ${obs.status === 'detected' ? 'detection box drawn' : 'two candidates, not matched'}`}
          className={cn('block w-full rounded-[2px]', h)}
        />
      )}
      {obs.isSimulated && (
        <figcaption
          className={cn(
            'absolute right-2 top-2 inline-flex h-5 items-center gap-1.5 overflow-hidden rounded-[2px] bg-[rgba(10,10,11,0.85)] pr-2 font-mono text-[10.5px] text-[#d9d0ff]',
          )}
        >
          <span aria-hidden className="nc-sim-bar h-full w-2" />
          Simulated frame
        </figcaption>
      )}
    </figure>
  )
}
