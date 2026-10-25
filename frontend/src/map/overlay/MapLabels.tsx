/**
 * Words on the map. React renders them; the engine moves each one to its projected world point
 * every frame, so text stays crisp and selectable and never re-renders with the crowd.
 */
import { memo, useCallback, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import type { CongestionStatus, SectionKind } from '@/contracts/domain'
import { cn } from '@/lib/utils'
import { displayCongestion } from '@/lib/status'
import { isLive, useConnection } from '@/stores/connection'
import { useMapStats } from '@/stores/frames'
import { useUi } from '@/stores/ui'
import { useWorld } from '@/stores/world'
import { useServerNow } from '@/hooks/useServerNow'
import { useBooth } from '@/booth/circle'
import { calhacksMarks } from '@/mock/calhacks'
import { useSession } from '@/stdb/session'
import type { MapEngine } from '../MapEngine'
import { BAND_Z, BEACON_TOP } from '../layers/marksLayer'

type Resolve = () => { x: number; y: number; z: number } | null

function Anchored({
  engine,
  id,
  resolve,
  minScale,
  className,
  children,
}: {
  engine: MapEngine
  id: string
  resolve: Resolve
  minScale?: number
  className?: string
  children: ReactNode
}) {
  const resolveRef = useRef(resolve)
  useLayoutEffect(() => {
    resolveRef.current = resolve
  })
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      engine.registerAnchor(id, el ? { el, resolve: () => resolveRef.current(), minScale } : null)
    },
    [engine, id, minScale],
  )
  return (
    <div ref={ref} className="nc-label" style={{ visibility: 'hidden' }}>
      <div className={className}>{children}</div>
    </div>
  )
}

const sectionSwatch: Record<SectionKind, string> = {
  front: 'bg-section-front',
  floor: 'bg-section-floor',
  wing: 'bg-section-wing',
  concourse: 'bg-section-concourse',
  plaza: 'bg-section-plaza',
  food: 'bg-section-food',
  passage: 'bg-silver',
}

const statusDot: Record<CongestionStatus | 'stale', string> = {
  normal: 'bg-teal',
  caution: 'bg-caution',
  critical: 'bg-signal animate-blink',
  unknown: 'bg-ink-muted',
  stale: 'bg-ink-muted',
}

function ZoneLabels({ engine }: { engine: MapEngine }) {
  const venue = useWorld((s) => s.venue)
  const zones = useWorld((s) => s.zones)
  const linkUp = useConnection(isLive)
  const show = useUi((s) => s.layers.labels)
  const now = useServerNow(1)
  if (!venue || !show) return null
  return (
    <>
      {venue.zones.map((z) => {
        const status = displayCongestion(zones[z.zoneId], now, linkUp)
        const loud = status === 'caution' || status === 'critical'
        const passage = z.section === 'passage'
        return (
          <Anchored
            key={z.zoneId}
            engine={engine}
            id={`zone:${z.zoneId}`}
            resolve={() =>
              passage ? { x: z.labelAt.x + 7.5, y: z.labelAt.y, z: 3.4 } : { x: z.labelAt.x, y: z.labelAt.y, z: (z.elevationM ?? 0) + 0.3 }
            }
            minScale={passage ? 5 : 4}
            className={cn(
              '-translate-x-1/2 -translate-y-1/2 inline-flex h-6 items-center gap-1.5 rounded-[3px] px-2 text-[12px] font-medium shadow-[0_6px_16px_rgba(0,0,0,0.35)]',
              loud ? 'bg-[rgba(14,14,16,0.92)] text-ink ring-1 ring-line-strong' : 'bg-[rgba(14,14,16,0.72)] text-ink-dim ring-1 ring-line',
            )}
          >
            <span aria-hidden className={cn('size-2 rounded-[2px] opacity-80', sectionSwatch[z.section])} />
            {z.name}
            <span aria-hidden className={cn('size-1.5 rounded-full', statusDot[status])} />
            {loud && <span className={cn('text-[11px]', status === 'critical' ? 'text-signal' : 'text-caution')}>{zones[z.zoneId]?.peakDensity?.toFixed(1)}/m²</span>}
          </Anchored>
        )
      })}
    </>
  )
}

const POIS: { id: string; text: string; x: number; y: number; z: number; tone?: 'stage' | 'aid' | 'exit' | 'plain'; minScale?: number }[] = [
  { id: 'stage', text: 'Main Stage', x: 50, y: 3.6, z: 9.6, tone: 'stage' },
  { id: 'foh', text: 'FOH', x: 50, y: 33.5, z: 3.6, minScale: 7 },
  { id: 'aid', text: 'First Aid', x: 5, y: 58, z: 3.8, tone: 'aid' },
  { id: 'bar-wn', text: 'Bar', x: 1.05, y: 13.5, z: 4.9, minScale: 9 },
  { id: 'bar-ws', text: 'Bar', x: 1.05, y: 31.5, z: 4.9, minScale: 9 },
  { id: 'bar-en', text: 'Bar', x: 98.95, y: 13.5, z: 4.9, minScale: 9 },
  { id: 'bar-es', text: 'Bar', x: 98.95, y: 31.5, z: 4.9, minScale: 9 },
  { id: 'merch', text: 'Merch', x: 95, y: 56, z: 3.4, minScale: 7 },
  { id: 'wc', text: 'Toilets', x: 86.5, y: 61.2, z: 3, minScale: 8 },
  { id: 'food', text: 'Food trucks', x: 48.4, y: 61.7, z: 3.4, minScale: 8 },
  { id: 'gate-a', text: 'Gate A', x: 24, y: 64.6, z: 0, tone: 'exit' },
  { id: 'gate-b', text: 'Gate B', x: 76, y: 64.6, z: 0, tone: 'exit' },
  { id: 'exit-w', text: 'Exit', x: -1.6, y: 23, z: 0, tone: 'exit' },
  { id: 'exit-e', text: 'Exit', x: 101.6, y: 23, z: 0, tone: 'exit' },
  { id: 'cp', text: 'Centre Passage closed', x: 50, y: 41.5, z: 1.4, minScale: 7 },
]

function CalhacksLabels({ engine }: { engine: MapEngine }) {
  const venue = useWorld((s) => s.venue)
  const show = useUi((s) => s.layers.labels)
  if (!show || venue?.venueId !== 'calhacks') return null
  return (
    <>
      {calhacksMarks.map((mark) => (
        <Anchored
          key={mark.id}
          engine={engine}
          id={`booth:${mark.id}`}
          resolve={() => ({ x: mark.x, y: mark.y, z: mark.z })}
          minScale={mark.minScale}
          className="-translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full bg-[rgba(14,18,28,0.9)] px-1.5 py-0.5 text-[10px] font-medium text-ink ring-1 ring-white/15"
        >
          {mark.name}
        </Anchored>
      ))}
    </>
  )
}

function PoiLabels({ engine }: { engine: MapEngine }) {
  const show = useUi((s) => s.layers.labels)
  const cameras = useUi((s) => s.layers.cameras)
  const venue = useWorld((s) => s.venue)
  if (!show || !venue || venue.venueId !== 'main-stage') return null
  return (
    <>
      {POIS.map((p) => (
        <Anchored
          key={p.id}
          engine={engine}
          id={`poi:${p.id}`}
          resolve={() => ({ x: p.x, y: p.y, z: p.z })}
          minScale={p.minScale}
          className={cn(
            '-translate-x-1/2 -translate-y-full nc-halo-text',
            p.tone === 'stage' && 'font-display text-[22px] leading-none text-ink',
            p.tone === 'aid' && 'inline-flex items-center gap-1 text-[12px] font-medium text-ink',
            p.tone === 'exit' && 'translate-y-0 text-[11px] font-medium text-section-wing',
            (!p.tone || p.tone === 'plain') && 'text-[11px] text-ink-dim',
          )}
        >
          {p.tone === 'aid' && <Plus aria-hidden className="size-3 text-signal" strokeWidth={3} />}
          {p.text}
        </Anchored>
      ))}
      {cameras &&
        venue.cameraLocations.map((c) => (
          <Anchored
            key={c.cameraId}
            engine={engine}
            id={`cam:${c.cameraId}`}
            resolve={() => ({ x: c.position.x, y: c.position.y, z: c.mountHeightM })}
            className="translate-x-2 -translate-y-1/2 font-mono text-[11px] text-section-front nc-halo-text"
          >
            {c.cameraId}
          </Anchored>
        ))}
    </>
  )
}

function BandLabels({ engine }: { engine: MapEngine }) {
  const devices = useWorld((s) => s.devices)
  const venueId = useWorld((s) => s.venue?.venueId)
  const show = useUi((s) => s.layers.bands)
  const selected = useUi((s) => (s.selection.kind === 'device' ? s.selection.id : null))
  if (!show || venueId === 'calhacks') return null
  return (
    <>
      {Object.values(devices)
        .filter((d) => d.location)
        .map((d) => (
          <Anchored
            key={d.deviceId}
            engine={engine}
            id={`band:${d.deviceId}`}
            resolve={() => {
              const at = engine.deviceAt(d.deviceId)
              return at ? { x: at.x, y: at.y, z: BAND_Z + engine.elevationAt(at.x, at.y) } : null
            }}
            className={cn(
              'translate-x-[17px] -translate-y-1/2 rounded-[2px] px-1 font-mono text-[11px] font-medium nc-halo-text',
              selected === d.deviceId ? 'bg-ink text-ground' : 'text-ink',
            )}
          >
            {d.label}
          </Anchored>
        ))}
    </>
  )
}

function IncidentTags({ engine }: { engine: MapEngine }) {
  const incidents = useWorld((s) => s.incidents)
  const devices = useWorld((s) => s.devices)
  const venue = useWorld((s) => s.venue)
  const near = useMapStats((s) => s.nearIncident)
  const simulated = venue?.venueId === 'main-stage'
  const open = Object.values(incidents).filter((i) => i.status !== 'resolved' && i.location)
  return (
    <>
      {open.map((inc) => {
        const dev = inc.reportedByDeviceId ? devices[inc.reportedByDeviceId] : undefined
        const kind = inc.source === 'manual_sos' ? 'SOS' : inc.source === 'imu_suspicion' ? 'Possible fall' : 'Alert'
        return (
          <Anchored
            key={inc.incidentId}
            engine={engine}
            id={`inc:${inc.incidentId}`}
            resolve={() => (inc.location ? { x: inc.location.x, y: inc.location.y, z: BEACON_TOP } : null)}
            className="translate-x-3 -translate-y-1/2"
          >
            <span className="flex flex-col gap-0.5 rounded-[3px] bg-[rgba(14,14,16,0.92)] px-2.5 py-1.5 shadow-[inset_0_0_0_1px_rgba(255,59,48,0.6),0_10px_30px_rgba(0,0,0,0.5)]">
              <span className="text-[12px] font-semibold text-ink">
                {kind}
                {dev ? <span className="font-mono font-normal text-ink-dim"> · band-{dev.label}</span> : null}
              </span>
              {simulated && (
                <span className="text-[11px] text-ink-dim">
                  {near} within 4 m <span className="font-mono text-ink-muted">sim</span>
                </span>
              )}
            </span>
          </Anchored>
        )
      })}
    </>
  )
}

function RouteTags({ engine }: { engine: MapEngine }) {
  const commands = useWorld((s) => s.commands)
  const venue = useWorld((s) => s.venue)
  const onPath = useMapStats((s) => s.onCorridor)
  const crowd = useWorld((s) => s.scenario?.simulatedBands)
  const booth = useBooth()
  if (!venue) return null
  const shown = Object.values(commands).filter((c) => c.approvalStatus === 'pending_approval' || c.approvalStatus === 'approved')
  return (
    <>
      {shown.map((c) => {
        const corridor = venue.responderCorridors.find((x) => x.corridorId === c.corridorId)
        const path = corridor?.path ?? (c.corridorId === 'COR-BOOTH' ? [{ x: 10.3, y: 56 }, { x: booth.x, y: booth.y }] : null)
        const lengthM = corridor?.lengthM ?? (path ? Math.round(Math.hypot(booth.x - 10.3, booth.y - 56)) : 0)
        if (!path) return null
        const mid = path[Math.floor(path.length / 2)]
        const preview = c.approvalStatus === 'pending_approval'
        const bands = crowd?.commandId === c.commandId ? crowd : null
        return (
          <Anchored
            key={c.commandId}
            engine={engine}
            id={`route:${c.commandId}`}
            resolve={() => ({ x: mid.x, y: mid.y, z: 0.2 })}
            // left of the path: the medic's own tag sits to the right of the medic as they pass
            className="-translate-x-[calc(100%+1rem)] -translate-y-1/2"
          >
            <span className="flex flex-col gap-0.5 rounded-[3px] bg-[rgba(14,14,16,0.88)] px-2.5 py-1.5 shadow-[inset_0_0_0_1px_rgba(220,199,159,0.45)]">
              <span className="text-[12px] font-medium text-ink">
                Path for First Aid · {lengthM} m
              </span>
              <span className="text-[11px] text-ink-dim">
                {preview ? (
                  <>
                    Preview, not sent{bands && <> · ~{bands.signalled} bands in reach <span className="font-mono text-ink-muted">sim</span></>}
                  </>
                ) : (
                  <>
                    {bands ? `${bands.signalled} bands told to move · ` : ''}
                    {onPath} still on the path <span className="font-mono text-ink-muted">sim</span>
                  </>
                )}
              </span>
            </span>
          </Anchored>
        )
      })}
    </>
  )
}

function BoothTag({ engine }: { engine: MapEngine }) {
  const venueId = useWorld((s) => s.venue?.venueId)
  const booth = useBooth()
  const phase = useSession((s) => s.phase)
  if (venueId !== 'main-stage') return null
  const live = phase === 'live'
  const lost = phase === 'error'
  return (
    <Anchored engine={engine} id="live-booth" resolve={() => ({ x: booth.x, y: booth.y, z: 1.2 })} className="-translate-x-1/2 -translate-y-full">
      <span
        className={cn(
          'block rounded-[3px] px-2 py-1 text-[12px] font-medium shadow-[inset_0_0_0_1px_rgba(143,192,155,0.7)]',
          live ? 'bg-[rgba(14,22,18,0.9)] text-[#c9ead4]' : 'bg-[rgba(20,20,22,0.9)] text-ink-muted',
        )}
      >
        {lost ? 'Connection lost' : live ? 'LIVE · booth' : 'Booth'}
        {booth.editing && <span className="ml-1.5 font-mono text-[10px] text-champagne">drag</span>}
      </span>
    </Anchored>
  )
}

function ResponderTag({ engine }: { engine: MapEngine }) {
  const responding = useWorld((s) => Object.values(s.incidents).some((i) => i.status === 'responding'))
  if (!responding) return null
  return (
    <Anchored
      engine={engine}
      id="responder"
      resolve={() => {
        const at = engine.responderAt()
        return at ? { x: at.x, y: at.y, z: 2.4 } : null
      }}
      className="translate-x-3 -translate-y-full nc-halo-text"
    >
      <span className="block text-[12px] font-medium text-help">M-1 R. Patel</span>
      <span className="block text-[11px] text-ink-dim">
        Medic, radio Ch 5 · <span className="font-mono">sim</span>
      </span>
    </Anchored>
  )
}

export const MapLabels = memo(function MapLabels({ engine }: { engine: MapEngine }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <PoiLabels engine={engine} />
      <CalhacksLabels engine={engine} />
      <ZoneLabels engine={engine} />
      <BoothTag engine={engine} />
      <RouteTags engine={engine} />
      <BandLabels engine={engine} />
      <ResponderTag engine={engine} />
      <IncidentTags engine={engine} />
    </div>
  )
})
