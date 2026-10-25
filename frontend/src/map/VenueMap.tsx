import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { mapController } from './controller'
import { MapEngine } from './MapEngine'
import { MapHover } from './overlay/MapHover'
import { MapLabels } from './overlay/MapLabels'

/**
 * The venue map. Owns a MapEngine (PixiJS) for its lifetime and renders the DOM label layer the
 * engine positions every frame. Safe under Strict Mode: the first engine is destroyed before its
 * async init finishes, so only one canvas ever attaches.
 */
export function VenueMap() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [engine, setEngine] = useState<MapEngine | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

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
      {engine && <MapLabels engine={engine} />}
      {engine && <MapHover />}
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
