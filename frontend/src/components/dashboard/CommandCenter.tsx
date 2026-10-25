import { useEffect, useRef, useState } from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { IncidentPanel } from '@/components/incidents/IncidentPanel'
import { PurchaseFeed } from './PurchaseFeed'
import { PersonPanel } from './PersonPanel'
import { useIncidentFocus } from '@/hooks/useIncidentFocus'
import { VenueMap } from '@/map/VenueMap'
import { useUi } from '@/stores/ui'
import { useWorld } from '@/stores/world'
import { ConnectionBanner } from './ConnectionBanner'
import { MapToolbar } from './MapToolbar'
import { OnStageStrip } from './OnStageStrip'
import { RunBar } from '@/components/run/RunBar'
import { PressureTimeline } from './PressureTimeline'
import { SidePanel } from './SidePanel'
import { StatusHeader } from './StatusHeader'
import { panelInset } from './panelInsets'

/** Report how much of the screen a panel covers, so the map fits and focuses into the open area. */
function useInset(side: 'left' | 'right' | 'top' | 'bottom', ref: React.RefObject<HTMLElement | null>, viewportRef: React.RefObject<HTMLElement | null>, active = true) {
  const setInsets = useUi((s) => s.setInsets)
  useEffect(() => {
    const el = ref.current
    const viewport = viewportRef.current
    if (!el || !viewport || !active) {
      setInsets({ [side]: 0 })
      return
    }
    const measure = () => {
      setInsets({ [side]: panelInset(side, el.getBoundingClientRect(), viewport.getBoundingClientRect()) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    ro.observe(viewport)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      setInsets({ [side]: 0 })
    }
  }, [ref, viewportRef, side, active, setInsets])
}

/**
 * The command centre: the map fills the screen; words and controls float over its edges and leave
 * the middle to the venue.
 */
export function CommandCenter() {
  const mode = useWorld((s) => s.mode)
  const incidentShown = useWorld((s) => Object.values(s.incidents).length > 0)
  const selection = useUi((s) => s.selection)
  const setSidePanelOpen = useUi((s) => s.setSidePanelOpen)
  const announcement = useIncidentFocus()
  const viewportRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const [rowHeight, setRowHeight] = useState(600)
  const [controlsOpen, setControlsOpen] = useState(() => window.innerWidth >= 900)
  useEffect(() => {
    if (selection.kind !== 'none') setControlsOpen(true)
    if (selection.kind === 'zone') setSidePanelOpen(true)
  }, [selection, setSidePanelOpen])
  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setRowHeight(el.clientHeight))
    ro.observe(el)
    setRowHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [])
  const topRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  useInset('left', toolbarRef, viewportRef)
  useInset('right', rightRef, viewportRef)
  useInset('top', topRef, viewportRef)
  useInset('bottom', bottomRef, viewportRef)

  return (
    <div ref={viewportRef} className="relative h-full w-full overflow-clip bg-ground">
      <VenueMap />

      {/* scrims so text over the map stays readable; neutral, not decorative */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[520px] bg-[linear-gradient(90deg,rgba(10,10,11,0.88),rgba(10,10,11,0.5)_60%,rgba(10,10,11,0))]" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(0deg,rgba(10,10,11,0.92),rgba(10,10,11,0))]" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[linear-gradient(180deg,rgba(10,10,11,0.75),rgba(10,10,11,0))]" />
      {mode !== 'live' && <div aria-hidden className="nc-sim-bar pointer-events-none absolute inset-x-0 top-0 h-[3px] opacity-80" />}

      <div className="pointer-events-none absolute inset-0 grid grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 px-3 pb-3 pt-4 lg:px-6 lg:pb-5">
        <div ref={topRef} className="col-span-3 row-start-1 grid grid-cols-[minmax(240px,360px)_minmax(0,1fr)] items-start gap-4 2xl:grid-cols-[380px_1fr]">
          <StatusHeader />
          <div className="flex min-w-0 flex-col items-center gap-3 pt-1">
            <OnStageStrip />
            <ConnectionBanner />
          </div>
        </div>

        <div ref={rowRef} className="col-span-2 col-start-1 row-start-2 flex min-h-0 items-stretch">
          <div ref={toolbarRef} className="flex flex-none items-center">
            <MapToolbar />
          </div>
        </div>

        <div ref={rightRef} className={`col-start-3 row-span-2 row-start-2 flex min-h-0 flex-col items-end gap-2 ${controlsOpen ? 'w-[min(22.5rem,calc(100vw-6rem))]' : 'w-10'}`}>
          <button
            type="button"
            className="nc-panel pointer-events-auto flex h-10 shrink-0 items-center justify-center gap-2 px-3 text-[13px] text-ink-dim hover:text-ink"
            aria-label={controlsOpen ? 'Hide controls' : 'Show controls'}
            aria-expanded={controlsOpen}
            aria-controls="map-controls"
            onClick={() => setControlsOpen(!controlsOpen)}
          >
            {controlsOpen ? <><span>Controls</span><PanelRightClose className="size-4" /></> : <PanelRightOpen className="size-4" />}
          </button>
          <aside id="map-controls" aria-label="Map controls" hidden={!controlsOpen} className="nc-scroll pointer-events-auto min-h-0 w-full overflow-x-hidden overflow-y-auto overscroll-contain rounded-[4px]">
            <div className="flex min-w-0 flex-col gap-3 pb-1 [&>*]:max-w-full [&>*]:shrink-0">
              <RunBar />
              <PersonPanel />
              {incidentShown && <IncidentPanel />}
              <SidePanel maxHeight={Math.max(280, rowHeight - 60)} docked />
            </div>
          </aside>
        </div>

        <div ref={bottomRef} className="col-span-2 col-start-1 row-start-3 flex min-w-0 items-end gap-4">
          <PressureTimeline />
        </div>
      </div>
      <PurchaseFeed />

      <div className="sr-only" aria-live="assertive">
        {announcement}
      </div>
    </div>
  )
}
