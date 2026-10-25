import { useMemo, useState } from 'react'
import { BandTapDialog } from '@/components/cover/BandTapDialog'
import { LedGlyph } from '@/components/interventions/LedGlyph'
import { useServerNow } from '@/hooks/useServerNow'
import { clockShort } from '@/lib/format'
import { bandStatus, type Tone } from '@/lib/status'
import { cn } from '@/lib/utils'
import { mapController } from '@/map/controller'
import { characterAt } from '@/mock/calhacksCrowd'
import { useUi } from '@/stores/ui'
import { useWorld } from '@/stores/world'

const toneText: Record<Tone, string> = {
  neutral: 'text-ink-dim',
  ok: 'text-ink-dim',
  caution: 'text-caution',
  critical: 'text-signal',
  help: 'text-help',
  muted: 'text-ink-muted',
  sim: 'text-[#cfc4ff]',
}

/** The band roster. On CalHacks only the current page has a character on the floor. */
export function BandsPanel() {
  const devices = useWorld((s) => s.devices)
  const commands = useWorld((s) => s.commands)
  const venue = useWorld((s) => s.venue)
  const selection = useUi((s) => s.selection)
  const select = useUi((s) => s.select)
  const now = useServerNow(1)

  const [tapId, setTapId] = useState<string | null>(null)
  const list = useMemo(
    () => Object.values(devices).filter((d) => d.hardwareVariant === 'full' || d.hardwareVariant === 'light').sort((a, b) => a.label.localeCompare(b.label)),
    [devices],
  )
  const selectedDevice = selection.kind === 'device' ? list.find((d) => d.deviceId === selection.id) : undefined
  const cmds = Object.values(commands)
  const full = list.filter((d) => d.hardwareVariant === 'full').length
  const zoneName = (id?: string) => venue?.zones.find((z) => z.zoneId === id)?.name

  return (
    <section aria-labelledby="bands-h" className="nc-panel pointer-events-auto flex min-h-0 flex-col px-4 py-4">
      <div className="flex items-baseline justify-between">
        <h2 id="bands-h" className="text-[13px] font-medium text-ink">
          Bands
        </h2>
        <span className="text-[11.5px] text-ink-muted">
          {full} full · {list.length - full} lite
        </span>
      </div>
      {selectedDevice && (
        <button type="button" onClick={() => setTapId(selectedDevice.deviceId)} className="mt-1 self-start text-[13px] text-ink hover:text-champagne">
          Tap band {selectedDevice.label}
        </button>
      )}
      <ul className="nc-scroll mt-1.5 flex min-h-0 flex-col overflow-y-auto">
        {list.map((d) => {
          const st = bandStatus(d, cmds, now)
          const selected = selection.kind === 'device' && selection.id === d.deviceId
          return (
            <li key={d.deviceId}>
              <button
                type="button"
                onClick={() => {
                  select({ kind: 'device', id: d.deviceId })
                  const onFloor = venue?.venueId === 'calhacks' ? characterAt(bandNumber(d.deviceId)) : null
                  if (onFloor) mapController.focus(onFloor, 22)
                  else if (d.location) mapController.focus(d.location, 18)
                }}
                aria-pressed={selected}
                className={cn(
                  'grid w-full grid-cols-[24px_2.75rem_minmax(0,1fr)_minmax(0,6.5rem)] items-center gap-2 rounded-[3px] px-1.5 py-[3px] text-left transition-colors hover:bg-[rgba(236,235,230,0.04)]',
                  selected && 'bg-[rgba(236,235,230,0.07)]',
                )}
              >
                <LedGlyph pattern={st.pattern} pending={st.pending} failed={st.failed} size={20} />
                <span className="font-mono text-[12px] font-medium text-ink">{d.label}</span>
                <span
                  className="flex min-w-0 items-baseline gap-1.5 text-[12.5px] text-ink"
                  title={
                    d.connectionStatus === 'disconnected'
                      ? `Last heard ${clockShort(d.lastSeenAt, venue?.timeZone)}, no position`
                      : d.location
                        ? (zoneName(d.zoneId) ?? 'On site')
                        : 'Position unknown'
                  }
                >
                  <span className="min-w-0 truncate">{d.wearerLabel ?? 'Unassigned'}</span>
                  <span className="shrink-0 font-mono text-[10.5px] text-ink-muted">{d.hardwareVariant === 'full' ? 'full' : 'lite'}</span>
                  {(d.connectionStatus === 'disconnected' || d.location) && (
                    <span className="shrink-0 text-[11.5px] text-ink-muted">
                      {d.connectionStatus === 'disconnected' ? `heard ${clockShort(d.lastSeenAt, venue?.timeZone)}` : (zoneName(d.zoneId) ?? '')}
                    </span>
                  )}
                </span>
                <span className={cn('truncate text-right text-[12px]', d.location || onFloor(d.deviceId, venue?.venueId) ? toneText[st.tone] : 'text-ink-muted')} title={st.text}>
                  {onFloor(d.deviceId, venue?.venueId) ? 'on the floor' : d.location ? st.text : 'position unknown'}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {tapId && <BandTapDialog deviceId={tapId} onClose={() => setTapId(null)} />}
    </section>
  )
}

function bandNumber(deviceId: string): number {
  const n = Number(deviceId.slice(deviceId.lastIndexOf('-') + 1))
  return Number.isFinite(n) ? n : -1
}

function onFloor(deviceId: string, venueId: string | undefined): boolean {
  return venueId === 'calhacks' && characterAt(bandNumber(deviceId)) != null
}
