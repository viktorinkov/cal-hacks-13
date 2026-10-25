import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { errorFor, useRun } from '@/stdb/runOps'

export const pill = 'h-11 rounded-full border border-line-strong px-4 text-[13px] text-ink hover:text-champagne disabled:border-line disabled:text-ink-muted disabled:hover:text-ink-muted'
export const field = 'h-11 rounded-[4px] border border-line-strong bg-ground px-3 text-[14px] text-ink outline-none placeholder:text-ink-muted'
export const link = 'text-[13px] text-ink hover:text-champagne disabled:text-ink-muted'

export function Section({ id, title, aside, children, className }: { id: string; title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn('mt-14 first:mt-0', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 id={id} className="font-display text-[26px] leading-none text-ink">{title}</h2>
        {aside}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

/** The refusal of one of these actions, from the run store. A key ending in ':' matches a family. */
export function Refusal({ keys, className }: { keys: string[]; className?: string }) {
  const message = useRun((s) => errorFor(s.error, ...keys))
  if (!message) return null
  return <p role="alert" className={cn('text-[14px] text-signal', className)}>{message}</p>
}

/** A control that asks once before it acts, in place, as the Live tab's night controls do. */
export function TwoStep({
  label,
  question,
  confirm,
  working,
  cancel,
  busy,
  disabled,
  onConfirm,
}: {
  label: string
  question: string
  confirm: string
  working: string
  cancel: string
  busy: boolean
  disabled?: boolean
  onConfirm: () => Promise<boolean>
}) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <button type="button" disabled={disabled} className={pill} onClick={() => setAsking(true)}>
        {label}
      </button>
    )
  }
  return (
    <div role="group" aria-label={label} className="flex basis-full flex-wrap items-center gap-x-4 gap-y-2">
      <p className="text-[14px] leading-6 text-ink">{question}</p>
      <button type="button" disabled={busy || disabled} className={pill} onClick={() => void onConfirm().then((done) => done && setAsking(false))}>
        {busy ? working : confirm}
      </button>
      <button type="button" className="text-[13px] text-ink-muted hover:text-ink" onClick={() => setAsking(false)}>
        {cancel}
      </button>
    </div>
  )
}
