/**
 * Hover inspection: a small card beside the pointer naming what is under it, with its numbers and
 * where they come from.
 */
import { useServerNow } from '@/hooks/useServerNow'
import { count, density } from '@/lib/format'
import { bandStatus, congestionText, displayCongestion, incidentTitle, locationSourceText, zoneSourceTag } from '@/lib/status'
import { isLive, useConnection } from '@/stores/connection'
import { useUi } from '@/stores/ui'
import { useWorld } from '@/stores/world'
import { SourceChip } from '@/components/dashboard/SourceChip'

export function MapHover() {
  const hover = useUi((s) => s.hover)
  const venue = useWorld((s) => s.venue)
  const zones = useWorld((s) => s.zones)
  const devices = useWorld((s) => s.devices)
  const incidents = useWorld((s) => s.incidents)
  const commands = useWorld((s) => s.commands)
  const linkUp = useConnection(isLive)
  const now = useServerNow(2)
  if (!hover || !venue) return null

  let body: React.ReactNode = null
  if (hover.kind === 'zone') {
    const z = venue.zones.find((x) => x.zoneId === hover.id)
    const st = zones[hover.id]
    const status = displayCongestion(st, now, linkUp)
    if (!z) return null
    body = (
      <>
        <div className="flex items-center justify-between gap-6">
          <span className="text-[13px] font-medium text-ink">{z.name}</span>
          <SourceChip tag={zoneSourceTag(st)} />
        </div>
        <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-[12px]">
          <dt className="text-ink-muted">People</dt>
          <dd className="text-right tabular-nums text-ink">{count(st?.occupancyEstimate)}</dd>
          <dt className="text-ink-muted">Peak per m²</dt>
          <dd className="text-right tabular-nums text-ink">{density(st?.peakDensity)}</dd>
          <dt className="text-ink-muted">Status</dt>
          <dd className="text-right text-ink">{congestionText[status]}</dd>
        </dl>
      </>
    )
  } else if (hover.kind === 'device') {
    const d = devices[hover.id]
    if (!d) return null
    const st = bandStatus(d, Object.values(commands), now)
    body = (
      <>
        <div className="flex items-center justify-between gap-6">
          <span className="font-mono text-[13px] font-medium text-ink">band-{d.label}</span>
          <span className="text-[11px] text-ink-muted">{d.hardwareVariant === 'full' ? 'Full: LED, button, vibration' : 'Lite: LED, button'}</span>
        </div>
        <p className="mt-1.5 text-[12px] text-ink">{st.text}</p>
        <p className="mt-0.5 text-[12px] text-ink-muted">
          {d.wearerLabel ?? 'Unassigned'} · {locationSourceText(d)}
        </p>
      </>
    )
  } else if (hover.kind === 'incident') {
    const i = incidents[hover.id]
    if (!i) return null
    body = (
      <>
        <span className="font-mono text-[11px] text-champagne">{i.displayId}</span>
        <p className="text-[13px] font-medium text-ink">{incidentTitle(i)}</p>
        <p className="text-[12px] text-ink-muted">Click to open it</p>
      </>
    )
  }
  if (!body) return null
  return (
    <div
      role="tooltip"
      className="nc-panel pointer-events-none absolute z-20 min-w-48 px-3 py-2.5"
      style={{ left: hover.x + 16, top: hover.y + 16 }}
    >
      {body}
    </div>
  )
}
