import { useEffect, useRef, useState } from 'react'
import { IncidentPanel } from '@/components/incidents/IncidentPanel'
import { DemoDock } from '@/components/simulation/DemoDock'
import { HallDemoDock } from './HallDemoDock'
import { PurchaseFeed } from './PurchaseFeed'
import { useIncidentFocus } from '@/hooks/useIncidentFocus'
import { VenueMap } from '@/map/VenueMap'
import { useUi } from '@/stores/ui'
import { useWorld } from '@/stores/world'
import { ConnectionBanner } from './ConnectionBanner'
import { MapToolbar } from './MapToolbar'
import { OnStageStrip } from './OnStageStrip'
import { PressureTimeline } from './PressureTimeline'
import { SourceStatus } from './SourceStatus'
import { SidePanel } from './SidePanel'
import { StatusHeader } from './StatusHeader'

/** Report how much of the screen a panel covers, so the map fits and focuses into the open area. */
function useInset(side: 'left' | 'right' | 'top' | 'bottom', ref: React.RefObject<HTMLElement | null>, active = true) {
  const setInsets = useUi((s) => s.setInsets)
  useEffect(() => {
    const el = ref.current
    if (!el || !active) {
      setInsets({ [side]: side === 'right' ? 24 : 0 })
      return
    }
    const measure = () => {
      const r = el.getBoundingClientRect()
      const value =
        side === 'left' ? r.right + 16 : side === 'right' ? window.innerWidth - r.left + 16 : side === 'top' ? r.bottom + 8 : window.innerHeight - r.top + 8
      setInsets({ [side]: Math.max(0, Math.round(value)) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [ref, side, active, setInsets])
}

/**
 * The command centre: the map fills the screen; words and controls float over its edges and leave
 * the middle to the venue.
 */
export function CommandCenter() {
  const mode = useWorld((s) => s.mode)
  const venueId = useWorld((s) => s.venue?.venueId)
  const sideOpen = useUi((s) => s.sidePanelOpen)
  const incidentShown = useWorld((s) => Object.values(s.incidents).length > 0)
  const announcement = useIncidentFocus()
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const [rowHeight, setRowHeight] = useState(600)
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
  // the open panel (or, folded, the toolbar at the left edge) bounds the open map area
  useInset('left', sideOpen ? leftRef : toolbarRef)
  useInset('right', rightRef, incidentShown || venueId === 'calhacks')
  useInset('top', topRef)
  useInset('bottom', bottomRef)

  return (
    <div className="relative h-full w-full overflow-clip bg-ground">
      <VenueMap />

      {/* scrims so text over the map stays readable; neutral, not decorative */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[520px] bg-[linear-gradient(90deg,rgba(10,10,11,0.88),rgba(10,10,11,0.5)_60%,rgba(10,10,11,0))]" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(0deg,rgba(10,10,11,0.92),rgba(10,10,11,0))]" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[linear-gradient(180deg,rgba(10,10,11,0.75),rgba(10,10,11,0))]" />
      {mode !== 'live' && <div aria-hidden className="nc-sim-bar pointer-events-none absolute inset-x-0 top-0 h-[3px] opacity-80" />}

      <div className="pointer-events-none absolute inset-0 grid grid-cols-[auto_1fr_auto] grid-rows-[auto_minmax(0,1fr)_auto] gap-x-4 gap-y-4 px-6 pb-5 pt-7 2xl:px-10">
        <div ref={topRef} className="col-span-3 row-start-1 grid grid-cols-[minmax(240px,360px)_minmax(0,1fr)_auto] items-start gap-4 2xl:grid-cols-[380px_1fr_auto]">
          <StatusHeader />
          <div className="flex min-w-0 flex-col items-center gap-3 pt-1">
            <OnStageStrip />
            <ConnectionBanner />
          </div>
          <SourceStatus />
        </div>

        <div ref={rowRef} className="col-span-2 col-start-1 row-start-2 flex min-h-0 items-stretch gap-3">
          <div ref={toolbarRef} className="flex flex-none items-center">
            <MapToolbar />
          </div>
          <div ref={leftRef} className="flex min-h-0 items-end">
            <SidePanel maxHeight={rowHeight} />
          </div>
        </div>

        {/* the incident sits in the bottom right corner and grows upward */}
        <div ref={rightRef} className="col-start-3 row-span-2 row-start-2 flex min-h-0 flex-col items-end justify-end gap-3">
          {incidentShown && <IncidentPanel />}
          <HallDemoDock />
        </div>

        <div ref={bottomRef} className="col-span-2 col-start-1 row-start-3 flex min-w-0 items-end gap-4">
          <DemoDock />
          <PressureTimeline />
          <PurchaseFeed />
        </div>
      </div>

      <div className="sr-only" aria-live="assertive">
        {announcement}
      </div>
    </div>
  )
}
