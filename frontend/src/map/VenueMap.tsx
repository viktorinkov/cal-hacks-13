import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useRoute } from '@/cover/route'
import { useVenueSetup } from '@/stdb/venueSetup'
import { useUi } from '@/stores/ui'
import { useWorld } from '@/stores/world'
import { chosenModelOf, useChosenSetup, type ChosenModel } from '@/venue/chosenModel'
import { mapController } from './controller'
import { MapEngine } from './MapEngine'
import { MapHover } from './overlay/MapHover'
import { MapLabels } from './overlay/MapLabels'

/** Says why the map holds a building and nothing on it. */
function ModelOnlyNote({ model }: { model: ChosenModel }) {
  const { go } = useRoute()
  const insets = useUi((s) => s.insets)
  return (
    // Above the command center's scrims, in the open map area beside its panels.
    <div role="status" className="absolute z-10 max-w-[22rem] rounded-[4px] border border-line bg-panel px-4 py-3" style={{ left: insets.left + 16, top: insets.top + 16 }}>
      <p className="text-[13px] font-medium text-ink">3D model only</p>
      <p className="mt-1 text-[13px] leading-5 text-ink-dim">
        {`${model.venueName} for ${model.eventName}. Its zones, bands and crowd are not set up yet, so the map shows the building alone.`}
      </p>
      <button type="button" onClick={() => go('/venue')} className="mt-2 text-[13px] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink">
        Venue setup
      </button>
    </div>
  )
}

/**
 * The venue map. Owns a MapEngine (PixiJS) for its lifetime and renders the DOM label layer the
 * engine positions every frame. Safe under Strict Mode: the first engine is destroyed before its
 * async init finishes, so only one canvas ever attaches.
 */
export function VenueMap() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [engine, setEngine] = useState<MapEngine | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const chosenId = useVenueSetup((s) => s.chosenId)
  const chosenSetup = useChosenSetup()
  const floorId = useWorld((s) => s.venue?.venueId)
  // The same rule the engine applies: only the event floor is replaced by a chosen venue.
  const model = floorId === 'calhacks' ? chosenModelOf(chosenId, chosenSetup) : null

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const e = new MapEngine()
    let cancelled = false
    e.mount(host)
      .then(() => {
        if (cancelled) return
        mapController.attach(e)
        setEngine(e)
      })
      .catch((err: unknown) => {
        if (!cancelled) setFailed(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
      mapController.detach(e)
      e.destroy()
      setEngine(null)
    }
  }, [])

  const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (engine?.handleKey(ev.nativeEvent)) ev.preventDefault()
  }

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#15171b]">
      <div
        ref={hostRef}
        role="application"
        tabIndex={0}
        aria-label="Venue map. Drag to pan, scroll to zoom, right-drag or shift-drag to rotate and tilt. Arrow keys pan, plus and minus zoom, Q and E rotate, 0 fits the venue."
        onKeyDown={onKeyDown}
        className="absolute inset-0 cursor-grab outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-champagne/60 active:cursor-grabbing"
      />
      {engine && !model && <MapLabels engine={engine} />}
      {engine && !model && <MapHover />}
      {engine && model && <ModelOnlyNote model={model} />}
      {failed && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="nc-panel max-w-sm p-6 text-sm text-ink-dim">
            <p className="font-medium text-ink">The map could not start.</p>
            <p className="mt-2">WebGL is unavailable in this browser ({failed}). Incidents and bands still work from the panels.</p>
          </div>
        </div>
      )}
    </div>
  )
}
