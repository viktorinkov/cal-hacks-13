import { RotateCw, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWallClock } from '@/hooks/useWallClock'
import { clock } from '@/lib/format'
import { getSync } from '@/services/runtime'
import { useConnection } from '@/stores/connection'
import { useWorld } from '@/stores/world'

/**
 * Degraded state. When the link drops, the map keeps the last picture but greys it out, and this
 * says plainly that it is not live. Never silently shows old data as current.
 */
export function ConnectionBanner() {
  const connection = useConnection((s) => s.connection)
  const sync = useConnection((s) => s.sync)
  const syncError = useConnection((s) => s.syncError)
  const lastEventAt = useWorld((s) => s.lastEventAt)
  const tz = useWorld((s) => s.venue?.timeZone)
  const ready = useWorld((s) => s.ready)
  const wall = useWallClock(1)

  if (sync === 'error' && !ready) return null // the full-screen error owns this case
  const down = connection.phase === 'reconnecting' || connection.phase === 'closed'
  if (!down && sync !== 'resyncing' && sync !== 'error') return null

  const retryIn = connection.nextRetryAt ? Math.max(0, Math.round((connection.nextRetryAt - wall) / 1000)) : null
  return (
    <div
      role="alert"
      className="pointer-events-auto flex items-center gap-3 rounded-[3px] bg-[rgba(30,22,10,0.95)] px-3.5 py-2 text-[13px] text-ink shadow-[inset_0_0_0_1px_rgba(240,180,76,0.55),0_16px_40px_rgba(0,0,0,0.5)]"
    >
      <WifiOff aria-hidden className="size-4 text-caution" />
      {sync === 'resyncing' && !down ? (
        <span>Back online. Reloading the full picture from the backend…</span>
      ) : sync === 'error' ? (
        <span>Could not reload state: {syncError}</span>
      ) : (
        <span>
          Not live. Showing data from <span className="font-mono">{clock(lastEventAt, tz)}</span>.{' '}
          <span className="text-ink-dim">
            Reconnecting{connection.attempt ? `, attempt ${connection.attempt}` : ''}
            {retryIn !== null ? `, next in ${retryIn} s` : ''}. Commands are paused.
          </span>
        </span>
      )}
      {sync === 'error' && (
        <Button size="sm" variant="outline" onClick={() => void getSync()?.resync()}>
          <RotateCw /> Retry
        </Button>
      )}
    </div>
  )
}
