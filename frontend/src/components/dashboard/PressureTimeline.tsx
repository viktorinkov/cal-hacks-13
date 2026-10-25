import { useMemo } from 'react'
import type { CongestionStatus } from '@/contracts/domain'
import { useServerNow } from '@/hooks/useServerNow'
import { clockShort } from '@/lib/format'
import { cn } from '@/lib/utils'
import { isLive, useConnection } from '@/stores/connection'
import { useWorld } from '@/stores/world'

const WINDOW_MS = 8 * 60_000
const BUCKET_MS = 4000
const SCALE = 5 // people per m² at full height

const fill: Record<CongestionStatus, string> = {
  normal: 'bg-[#4b5a58]',
  caution: 'bg-caution',
  critical: 'bg-signal',
  unknown: 'bg-ink-muted/40',
}

const RANK: Record<CongestionStatus, number> = { normal: 0, unknown: 1, caution: 2, critical: 3 }

/**
 * Venue-wide crowd pressure over the last minutes: each bar is the worst zone in a four-second
 * window, coloured by the backend's status for it. Incidents are marked where they were reported.
 */
export function PressureTimeline() {
  const history = useWorld((s) => s.history)
  const incidents = useWorld((s) => s.incidents)
  const mode = useWorld((s) => s.mode)
  const tz = useWorld((s) => s.venue?.timeZone)
  const linkUp = useConnection(isLive)
  const now = useServerNow(1)
  const start = now - WINDOW_MS
  const n = WINDOW_MS / BUCKET_MS

  const buckets = useMemo(() => {
    const out: ({ peak: number; status: CongestionStatus } | null)[] = Array.from({ length: n }, () => null)
    for (const s of history) {
      const k = Math.floor((s.t - start) / BUCKET_MS)
      if (k < 0 || k >= n) continue
      const b = out[k]
      if (!b || RANK[s.status] > RANK[b.status] || (s.status === b.status && s.peakDensity > b.peak)) out[k] = { peak: s.peakDensity, status: s.status }
    }
    return out
  }, [history, start, n])

  const marks = Object.values(incidents).filter((i) => i.reportedAt >= start && i.reportedAt <= now)
  const ticks = [0, 2, 4, 6, 8].map((m) => now - (8 - m) * 60_000)

  return (
    <section aria-label="Crowd pressure, last 8 minutes" className="pointer-events-auto flex min-w-0 flex-1 items-end gap-4">
      <div className="hidden flex-none flex-col gap-0.5 pb-[18px] lg:flex">
        <span className="text-[12px] font-medium text-ink">Crowd pressure</span>
        <span className="text-[11px] text-ink-muted">Worst zone, last 8 min</span>
      </div>
      <div className="relative min-w-0 flex-1">
        <div className={cn('relative flex h-11 items-end gap-px', !linkUp && 'opacity-40 grayscale')}>
          {buckets.map((b, k) => (
            <span
              key={k}
              className={cn('flex-1 rounded-t-[1px]', b ? fill[b.status] : 'bg-[rgba(207,208,212,0.06)]')}
              style={{ height: b ? `${Math.max(8, Math.min(100, (b.peak / SCALE) * 100))}%` : '8%' }}
            />
          ))}
          {marks.map((i) => (
            <span
              key={i.incidentId}
              title={`${i.displayId} reported ${clockShort(i.reportedAt, tz)}`}
              className="absolute -top-2.5 size-[7px] -translate-x-1/2 rotate-45 bg-champagne"
              style={{ left: `${((i.reportedAt - start) / WINDOW_MS) * 100}%` }}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10.5px] text-ink-muted" aria-hidden>
          {ticks.map((t, k) => (
            <span key={k}>{k === ticks.length - 1 ? 'now' : clockShort(t, tz)}</span>
          ))}
        </div>
      </div>
      <span
        className={cn(
          'mb-[18px] inline-flex h-6 flex-none items-center gap-1.5 rounded-[2px] px-2 text-[11.5px] font-medium',
          !linkUp ? 'text-ink-muted shadow-[inset_0_0_0_1px_var(--nc-line)]' : mode === 'live' ? 'text-teal shadow-[inset_0_0_0_1px_rgba(111,183,173,0.5)]' : 'text-[#d9d0ff] shadow-[inset_0_0_0_1px_rgba(184,166,255,0.5)]',
        )}
      >
        <span aria-hidden className={cn('size-[6px] rounded-full', !linkUp ? 'bg-ink-muted' : mode === 'live' ? 'bg-teal animate-breath' : 'nc-sim-stripes')} />
        {!linkUp ? 'Paused' : mode === 'live' ? 'Live' : 'Simulated'}
      </span>
    </section>
  )
}
