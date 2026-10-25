import type { ReactNode } from 'react'
import { useOperatorName } from '@/stdb/operatorName'
import { cn } from '@/lib/utils'
import { DeskTabs } from './DeskTabs'
import { EventClose } from './EventClose'

const MARK = {
  run: 'Run',
  payments: 'Till',
  venue: 'Plot',
  attendees: 'Door',
  bands: 'Bands',
  testbands: 'Test',
  photos: 'Pit',
  merch: 'Tags',
  graph: 'Meet',
  costs: 'Rider',
  kibana: 'Logs',
  rules: 'Rules',
  staff: 'Crew',
  viewas: 'As',
} as const

export type DeskMotif = keyof typeof MARK

export function DeskFrame({ motif, title, sentence, figures, children }: { motif: DeskMotif; title?: string; sentence?: string; figures?: ReactNode; children: ReactNode }) {
  const operator = useOperatorName()
  return (
    <div data-motif={motif} className="desk-night h-full overflow-y-auto bg-ground text-ink">
      <div className="mx-auto w-full max-w-[1360px] px-5 py-6 md:px-10 md:py-8">
        <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-display text-[30px] leading-none text-ink">BandIt</span>
            <DeskTabs />
          </div>
          {operator && <span className="text-[13px] text-ink-muted">· operator {operator}</span>}
        </header>
        <EventClose />
        {(title || sentence) && (
          <div className="desk-head mt-8">
            <p className="desk-mark" aria-hidden="true">{MARK[motif]}</p>
            {title && <h1 className="font-display tracking-[-0.02em] text-ink">{title}</h1>}
            {sentence && <p className={cn('max-w-[52ch] text-[15px] leading-6 text-ink-dim', title && 'mt-3')}>{sentence}</p>}
          </div>
        )}
        {figures && <div className="desk-figures mt-8 grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-4">{figures}</div>}
        <div className="desk-body mt-10">{children}</div>
      </div>
    </div>
  )
}

export function Figure({ label, value, note, lead = false, chip }: { label: string; value: ReactNode; note: string; lead?: boolean; chip?: ReactNode }) {
  return (
    <div className="md:px-6 md:first:pl-0 md:last:pr-0">
      <p className={cn('text-[13px] text-ink-dim', chip && 'flex flex-wrap items-center gap-x-2 gap-y-1')}>{chip ? <span className="whitespace-nowrap">{label}</span> : label}{chip}</p>
      <p className={cn('mt-1 flex h-9 items-end tabular-nums leading-none text-ink', lead ? 'text-[32px]' : 'text-[22px]')}>{value}</p>
      <p className="mt-2 text-[13px] text-ink-dim">{note}</p>
    </div>
  )
}

export function when(ms: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
