import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { DeskTabs } from '@/components/desk/DeskTabs'
import { NightControls } from '@/components/dashboard/NightControls'
import { useVenuePlan, type VenuePlan } from '@/map/venuePlan'
import { useOperatorName } from '@/stdb/operatorName'
import { selectVenuePlan } from '@/services/runtime'
import { useServerNow } from '@/hooks/useServerNow'
import { clock, elapsed } from '@/lib/format'
import { headline } from '@/lib/status'
import { cn } from '@/lib/utils'
import { isLive, useConnection } from '@/stores/connection'
import { useWorld } from '@/stores/world'

const toneBar: Record<string, string> = {
  critical: 'bg-signal',
  caution: 'bg-caution',
  help: 'bg-help',
  ok: 'bg-teal',
  muted: 'bg-ink-muted',
  neutral: 'bg-ink-muted',
  sim: 'bg-section-front',
}

/** The screen's one question, answered in a sentence: does anyone need help, and is it reaching them? */
export function StatusHeader() {
  const venue = useWorld((s) => s.venue)
  const incidents = useWorld((s) => s.incidents)
  const commands = useWorld((s) => s.commands)
  const zones = useWorld((s) => s.zones)
  const mode = useWorld((s) => s.mode)
  const lastEventAt = useWorld((s) => s.lastEventAt)
  const simulatedBands = useWorld((s) => s.scenario?.simulatedBands)
  const connection = useConnection((s) => s.connection)
  const linkUp = useConnection(isLive)
  const now = useServerNow(2)
  const tz = venue?.timeZone

  const operator = useOperatorName()

  const h = useMemo(() => {
    const zoneList = Object.values(zones)
    return headline({
      incidents: Object.values(incidents),
      commands: Object.values(commands),
      zones: zoneList,
      zoneNames: Object.fromEntries((venue?.zones ?? []).map((z) => [z.zoneId, z.name])),
      zoneSections: Object.fromEntries((venue?.zones ?? []).map((z) => [z.zoneId, z.section])),
      people: zoneList.reduce((a, z) => a + (z.occupancyEstimate ?? 0), 0),
      simulated: mode !== 'live',
      connection,
      linkUp,
      lastDataAt: clock(lastEventAt, tz),
      now,
      simulatedBands,
      venueId: venue?.venueId,
    })
    // `now` only matters for the post-resolution window; 2 Hz is plenty
  }, [incidents, commands, zones, venue, mode, connection, linkUp, lastEventAt, tz, now, simulatedBands])

  const open = Object.values(incidents)
    .filter((i) => i.status !== 'resolved')
    .sort((a, b) => a.reportedAt - b.reportedAt)[0]

  return (
    <header className="pointer-events-auto flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-[30px] leading-none tracking-[-0.01em] text-ink">BandIt</span>
          <VenueSelect />
          {operator && <span className="text-[13px] text-ink-muted">· operator {operator}</span>}
        </div>
        <DeskTabs />
        <NightControls />
      </div>
      <div className="flex gap-4">
        <span aria-hidden className={cn('mt-2 w-[3px] flex-none rounded-full', toneBar[h.tone])} />
        <div className="flex min-w-0 flex-col gap-2.5">
          <h1 className="font-display text-[clamp(34px,2.6vw,56px)] leading-[0.98] tracking-[-0.015em] text-ink" aria-live="polite">
            {h.title}
          </h1>
          <p className="max-w-[34ch] text-[15px] leading-[1.5] text-ink-dim">{h.sentence}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 pl-[19px] font-mono text-[12.5px] text-ink-dim">
        <span className="tabular-nums" aria-label="Venue time">
          {clock(now, tz)}
        </span>
        {open && (
          <span className="inline-flex h-[22px] items-center gap-1.5 rounded-[2px] px-2 text-champagne shadow-[inset_0_0_0_1px_rgba(220,199,159,0.4)]">
            <span aria-hidden className="size-[5px] rounded-full bg-champagne animate-breath" />
            {open.displayId} open {elapsed(now - open.reportedAt)}
          </span>
        )}
      </div>
    </header>
  )
}

const PLANS: { id: VenuePlan; label: string }[] = [
  { id: 'calhacks', label: 'CalHacks 13.0' },
  { id: 'simulation', label: 'Simulation' },
]

function VenueSelect() {
  const plan = useVenuePlan((s) => s.plan)
  const [menu, setMenu] = useState(false)
  const label = PLANS.find((item) => item.id === plan)?.label ?? 'Venue'
  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={menu}
        aria-label="Venue"
        onClick={() => setMenu((value) => !value)}
        className="inline-flex h-7 items-center gap-1.5 rounded-[3px] px-1.5 text-[13px] text-ink-dim hover:text-ink"
      >
        {label}
        <ChevronDown aria-hidden className={cn('size-3.5 transition-transform', menu && 'rotate-180')} />
      </button>
      {menu && (
        <ul role="listbox" aria-label="Venues" className="nc-panel absolute left-0 top-8 z-20 flex min-w-44 flex-col p-1">
          {PLANS.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={item.id === plan}
                onClick={() => {
                  selectVenuePlan(item.id)
                  setMenu(false)
                }}
                className={cn(
                  'flex w-full items-center rounded-[2px] px-2.5 py-1.5 text-left text-[13px] hover:bg-white/5',
                  item.id === plan ? 'text-ink' : 'text-ink-dim',
                )}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
