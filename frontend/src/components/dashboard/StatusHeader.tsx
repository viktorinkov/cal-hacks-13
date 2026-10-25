import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { DeskTabs } from '@/components/desk/DeskTabs'
import { useVenuePlan, type VenuePlan } from '@/map/venuePlan'
import { OPERATOR } from '@/mock/MockBackend'
import { selectVenuePlan } from '@/services/runtime'
import { useServerNow } from '@/hooks/useServerNow'
import { clock, elapsed } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useWorld } from '@/stores/world'

export function StatusHeader() {
  const venue = useWorld((s) => s.venue)
  const incidents = useWorld((s) => s.incidents)
  const now = useServerNow(2)
  const tz = venue?.timeZone

  const open = Object.values(incidents)
    .filter((i) => i.status !== 'resolved')
    .sort((a, b) => a.reportedAt - b.reportedAt)[0]

  return (
    <header className="pointer-events-auto flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-[30px] leading-none tracking-[-0.01em] text-ink">BandIt</span>
          <VenueSelect />
          <span className="text-[13px] text-ink-muted">· operator {OPERATOR}</span>
        </div>
        <DeskTabs />
      </div>
      <div className="flex items-center gap-3 font-mono text-[12.5px] text-ink-dim">
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
