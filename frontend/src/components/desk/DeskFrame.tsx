import type { ReactNode } from 'react'
import { OPERATOR } from '@/mock/MockBackend'
import { cn } from '@/lib/utils'
import { DeskTabs } from './DeskTabs'

export function DeskFrame({ title, sentence, figures, children }: { title?: string; sentence?: string; figures?: ReactNode; children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto bg-ground text-ink">
      <div className="mx-auto w-full max-w-[1360px] px-5 py-6 md:px-10 md:py-8">
        <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-display text-[30px] leading-none text-ink">BandIt</span>
            <DeskTabs />
          </div>
          <span className="text-[13px] text-ink-muted">· operator {OPERATOR}</span>
        </header>
        {(title || sentence) && (
          <div className="mt-8 max-w-[40rem]">
            {title && <h1 className="font-display text-[32px] leading-[1.05] tracking-[-0.02em] text-ink md:text-[40px]">{title}</h1>}
            {sentence && <p className={cn('max-w-[52ch] text-[15px] leading-6 text-ink-dim', title && 'mt-3')}>{sentence}</p>}
          </div>
        )}
        {figures && <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-4 md:gap-0 md:divide-x md:divide-line">{figures}</div>}
        <div className="mt-10">{children}</div>
      </div>
    </div>
  )
}

export function Figure({ label, value, note, lead = false, chip }: { label: string; value: ReactNode; note: string; lead?: boolean; chip?: ReactNode }) {
  return (
    <div className="md:px-6 md:first:pl-0 md:last:pr-0">
      <p className={cn('text-[13px] text-ink-dim', chip && 'flex items-center gap-2')}>{label}{chip}</p>
      <p className={cn('mt-1 flex h-9 items-end tabular-nums leading-none text-ink', lead ? 'text-[32px]' : 'text-[22px]')}>{value}</p>
      <p className="mt-2 text-[13px] text-ink-dim">{note}</p>
    </div>
  )
}

export function when(ms: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
