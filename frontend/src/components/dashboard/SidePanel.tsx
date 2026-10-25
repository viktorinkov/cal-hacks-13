import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { ComparisonCard } from '@/components/simulation/ComparisonCard'
import { Button } from '@/components/ui/button'
import { density } from '@/lib/format'
import { useUi } from '@/stores/ui'
import { useWorld } from '@/stores/world'
import { BandsPanel } from './BandsPanel'
import { ZoneInspector } from './ZoneInspector'

interface Size {
  w: number
  h: number
  /** Share of the height the top card gets, 0..1. */
  split: number
}

const KEY = 'bandit.sidePanel'
const DEFAULT: Size = { w: 300, h: 600, split: 0.48 }
const LIMITS = { wMin: 240, wMax: 560, hMin: 280, splitMin: 0.2, splitMax: 0.8 }

function load(): Size {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return DEFAULT
    const v = JSON.parse(raw) as Partial<Size>
    return { w: v.w ?? DEFAULT.w, h: v.h ?? DEFAULT.h, split: v.split ?? DEFAULT.split }
  } catch {
    return DEFAULT
  }
}

function save(s: Size) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // private window or storage blocked: the size just is not remembered
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Drag `onMove(dx, dy)` from a pointer down until release. */
function useDrag(onMove: (dx: number, dy: number) => void, onEnd: () => void) {
  return useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      e.preventDefault()
      const el = e.currentTarget
      el.setPointerCapture(e.pointerId)
      let x = e.clientX
      let y = e.clientY
      const move = (ev: PointerEvent) => {
        onMove(ev.clientX - x, ev.clientY - y)
        x = ev.clientX
        y = ev.clientY
      }
      const up = () => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', up)
        onEnd()
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
    },
    [onMove, onEnd],
  )
}

/**
 * Zones (or the with/without comparison) and the bands list, bottom left. Starts as a small box;
 * opened, it can be resized from its top-right corner and the divider between the two cards.
 */
export function SidePanel({ maxHeight }: { maxHeight: number }) {
  const open = useUi((s) => s.sidePanelOpen)
  const setOpen = useUi((s) => s.setSidePanelOpen)
  const cmp = useWorld((s) => s.scenario?.comparison)
  const zones = useWorld((s) => s.zones)
  const venue = useWorld((s) => s.venue)
  const devices = useWorld((s) => s.devices)
  const [size, setSize] = useState<Size>(load)
  const sizeRef = useRef(size)
  useEffect(() => {
    sizeRef.current = size
  }, [size])

  const h = clamp(size.h, LIMITS.hMin, Math.max(LIMITS.hMin, maxHeight))

  const persist = useCallback(() => save(sizeRef.current), [])
  const resizeCorner = useDrag(
    useCallback((dx: number, dy: number) => {
      setSize((s) => ({ ...s, w: clamp(s.w + dx, LIMITS.wMin, LIMITS.wMax), h: clamp(s.h - dy, LIMITS.hMin, 2000) }))
    }, []),
    persist,
  )
  const resizeSplit = useDrag(
    useCallback(
      (_dx: number, dy: number) => {
        setSize((s) => ({ ...s, split: clamp(s.split + dy / Math.max(1, h), LIMITS.splitMin, LIMITS.splitMax) }))
      },
      [h],
    ),
    persist,
  )

  useEffect(() => save(size), [size])

  const cornerKeys = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 12
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
    if (!d) return
    e.preventDefault()
    setSize((s) => ({ ...s, w: clamp(s.w + d[0], LIMITS.wMin, LIMITS.wMax), h: clamp(s.h + d[1], LIMITS.hMin, 2000) }))
  }
  const splitKeys = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowUp' ? -0.04 : e.key === 'ArrowDown' ? 0.04 : 0
    if (!d) return
    e.preventDefault()
    setSize((s) => ({ ...s, split: clamp(s.split + d, LIMITS.splitMin, LIMITS.splitMax) }))
  }

  if (!open) {
    const busiest = Object.values(zones).sort((a, b) => (b.peakDensity ?? 0) - (a.peakDensity ?? 0))[0]
    const busiestName = venue?.zones.find((z) => z.zoneId === busiest?.zoneId)?.name
    const bands = Object.values(devices).filter((d) => d.hardwareVariant === 'full' || d.hardwareVariant === 'light')
    const online = bands.filter((d) => d.connectionStatus !== 'disconnected').length
    return (
      <section aria-labelledby="side-h" className="nc-panel pointer-events-auto flex w-[236px] flex-col gap-1.5 self-end p-3">
        <h2 id="side-h" className="text-[12.5px] font-medium text-ink">
          {cmp ? 'With the bands, and without' : 'Zones and bands'}
        </h2>
        <p className="text-[12px] leading-snug text-ink-dim">
          {cmp
            ? `Medic ${cmp.arrivalWithGuidanceS !== null ? `${Math.round(cmp.arrivalWithGuidanceS)} s` : '…'} with bands, ${cmp.arrivalBaselineS !== null ? `${Math.round(cmp.arrivalBaselineS)} s` : '…'} without · sim`
            : `${busiestName ?? 'No zone data'}${busiest ? ` busiest, ${density(busiest.peakDensity)}/m²` : ''} · ${online} of ${bands.length} bands online`}
        </p>
        <Button variant="outline" aria-expanded={false} className="mt-0.5 h-8 justify-between bg-transparent text-[12.5px]" onClick={() => setOpen(true)}>
          Open <ChevronUp className="size-4" />
        </Button>
      </section>
    )
  }

  return (
    <section aria-label={cmp ? 'Comparison and bands' : 'Zones and bands'} className="pointer-events-auto relative flex flex-col self-end" style={{ width: size.w, height: h }}>
      <div className="mb-2 flex items-center justify-between pl-1">
        <span className="text-[12px] font-medium text-ink-dim">{cmp ? 'Comparison and bands' : 'Zones and bands'}</span>
        <button
          type="button"
          aria-label="Hide this panel"
          aria-expanded
          onClick={() => setOpen(false)}
          className="nc-panel grid size-7 place-items-center text-ink-dim hover:text-ink"
        >
          <ChevronDown className="size-4" />
        </button>
      </div>
      <div className="nc-scroll min-h-0 overflow-y-auto" style={{ flex: `0 0 ${Math.round(size.split * 100)}%` }}>
        {cmp ? <ComparisonCard /> : <ZoneInspector />}
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the two cards"
        aria-valuemin={20}
        aria-valuemax={80}
        aria-valuenow={Math.round(size.split * 100)}
        tabIndex={0}
        onPointerDown={resizeSplit}
        onKeyDown={splitKeys}
        className="group flex h-3 flex-none cursor-row-resize items-center justify-center outline-none"
      >
        <span className="h-[3px] w-10 rounded-full bg-line-strong transition-colors group-hover:bg-champagne group-focus-visible:bg-champagne" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <BandsPanel />
      </div>
      <div
        role="separator"
        aria-label="Resize the panel. Arrow keys change width and height."
        tabIndex={0}
        onPointerDown={resizeCorner}
        onKeyDown={cornerKeys}
        className="absolute -right-2 -top-2 grid size-5 cursor-nesw-resize place-items-center rounded-full outline-none focus-visible:ring-1 focus-visible:ring-champagne"
      >
        <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" className="text-ink-muted">
          <path d="M1 1h8v8M4 1h5v5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </div>
    </section>
  )
}
