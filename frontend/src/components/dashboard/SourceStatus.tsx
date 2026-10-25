import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { SourceStatus as Source } from '@/contracts/domain'
import { useWallClock } from '@/hooks/useWallClock'
import { ago } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useVenuePlan } from '@/map/venuePlan'
import { isLive, useConnection } from '@/stores/connection'
import { useWorld } from '@/stores/world'

const dot: Record<Source['status'], string> = {
  ok: 'bg-teal',
  degraded: 'bg-caution',
  down: 'bg-signal',
  unknown: 'bg-ink-muted',
}

/**
 * Mode and feed health. The mode chip is always visible; the feed list folds behind one button
 * whose dot summarises it, and opens on its own when something is wrong with the link.
 */
export function SourceStatus() {
  const [open, setOpen] = useState(false)
  const mode = useWorld((s) => s.mode)
  const plan = useVenuePlan((s) => s.plan)
  const sources = useWorld((s) => s.sources)
  const devices = useWorld((s) => s.devices)
  const connection = useConnection((s) => s.connection)
  const linkUp = useConnection(isLive)
  const lastDataAt = useConnection((s) => s.lastDataAt)
  const wall = useWallClock(1)

  const bands = Object.values(devices).filter((d) => d.hardwareVariant === 'full' || d.hardwareVariant === 'light')
  const online = bands.filter((d) => d.connectionStatus === 'connected' || d.connectionStatus === 'delayed').length
  const list = Object.values(sources).filter((s) => s.kind !== 'backend')
  // an unassigned band in its case is not a fault; a worn band dropping off is
  const assignedOffline = bands.filter((d) => d.wearerLabel && d.connectionStatus === 'disconnected').length

  const linkText =
    connection.phase === 'open'
      ? 'Connected'
      : connection.phase === 'reconnecting'
        ? `Reconnecting${connection.attempt ? ` · try ${connection.attempt}` : ''}`
        : connection.phase === 'connecting'
          ? 'Connecting'
          : 'Offline'

  const worst: Source['status'] = !linkUp
    ? 'down'
    : list.some((x) => x.status === 'down')
      ? 'down'
      : list.some((x) => x.status === 'degraded') || assignedOffline > 0
        ? 'degraded'
        : 'ok'

  return (
    <div className="pointer-events-auto relative flex items-start gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="feeds"
        onClick={() => setOpen(!open)}
        className="nc-panel inline-flex h-7 items-center gap-2 px-2.5 text-[12px] text-ink-dim hover:text-ink"
      >
        <span aria-hidden className={cn('size-[7px] rounded-full', dot[worst], worst !== 'ok' && 'animate-blink')} />
        Feeds
        <ChevronDown aria-hidden className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      <ModeChip mode={mode} />
      {open && (
        <ul id="feeds" className="nc-panel absolute right-0 top-9 z-10 flex min-w-64 flex-col gap-2 p-3 text-[12px] text-ink-dim" aria-label="Feeds">
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn('size-[6px] rounded-full', linkUp ? 'bg-teal' : connection.phase === 'reconnecting' ? 'bg-caution animate-blink' : 'bg-signal')} />
            {plan === 'simulation' ? 'Mock backend' : 'Backend'} · {linkText}
            {!linkUp && lastDataAt ? <span className="text-ink-muted"> · data {ago(wall - lastDataAt)}</span> : null}
          </li>
          {sources.spacetimedb && (
            <li className="inline-flex items-center gap-1.5" title={sources.spacetimedb.detail}>
              <span aria-hidden className={cn('size-[6px] rounded-full', dot[sources.spacetimedb.status])} />
              {sources.spacetimedb.label}
              {sources.spacetimedb.detail && <span className="text-ink-muted"> · {sources.spacetimedb.detail}</span>}
            </li>
          )}
          {list.map((x) => (
            <li key={x.sourceId} className="inline-flex items-center gap-1.5" title={x.detail}>
              <span aria-hidden className={cn('size-[6px] rounded-full', linkUp ? dot[x.status] : 'bg-ink-muted')} />
              {x.label}
              {x.isSimulated && <span className="font-mono text-[10.5px] text-[#cfc4ff]">sim</span>}
              {x.detail && x.status !== 'ok' && <span className="text-ink-muted"> · {x.detail}</span>}
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn('size-[6px] rounded-full', online === bands.length ? 'bg-teal' : 'bg-caution')} />
            {online} of {bands.length} bands online
          </li>
        </ul>
      )}
    </div>
  )
}

function ModeChip({ mode }: { mode: 'simulation' | 'live' | 'hybrid' }) {
  const plan = useVenuePlan((s) => s.plan)
  if (plan === 'calhacks' && mode === 'simulation') return null
  if (mode === 'live') {
    return (
      <span className="inline-flex h-7 items-center gap-2 rounded-[3px] bg-[rgba(111,183,173,0.12)] px-2.5 text-[12px] font-semibold text-teal shadow-[inset_0_0_0_1px_rgba(111,183,173,0.5)]">
        <span aria-hidden className="size-[7px] rounded-full bg-teal animate-breath" />
        Live
      </span>
    )
  }
  return (
    <span
      className="inline-flex h-7 items-center gap-2 overflow-hidden whitespace-nowrap rounded-[3px] bg-[rgba(184,166,255,0.1)] pr-2.5 text-[12px] font-semibold text-[#d9d0ff] shadow-[inset_0_0_0_1px_rgba(184,166,255,0.55)]"
      title={mode === 'hybrid' ? 'Bands and incidents are live; the crowd is simulated' : 'Everything on this screen is simulated'}
    >
      <span aria-hidden className="nc-sim-bar h-full w-3" />
      {mode === 'hybrid' ? 'Live bands · simulated crowd' : 'Simulation'}
    </span>
  )
}
