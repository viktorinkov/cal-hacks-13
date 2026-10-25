import type { MouseEvent } from 'react'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { MISSING, type DisplayStatus } from '@/payments/model'

const TONE: Record<DisplayStatus, string> = {
  decision: 'bg-champagne/15 text-champagne',
  paid: 'bg-teal/15 text-teal',
  failed: 'bg-caution/15 text-caution',
  disputed: 'bg-caution/15 text-caution',
  pending: 'bg-ink/[0.08] text-ink-dim',
  waived: 'bg-ink/[0.08] text-ink-dim',
  refunded: 'bg-ink/[0.08] text-ink-dim',
  other: 'bg-ink/[0.08] text-ink-dim',
}

/** Pale tint, same-hue text. Never red: on this product red means an SOS or a fall. */
export function StatusPill({ status, label, className }: { status: DisplayStatus; label: string; className?: string }) {
  return (
    <span data-status={status} className={cn('inline-flex h-5 flex-none items-center whitespace-nowrap rounded-full px-2 text-[12px] font-medium leading-none', TONE[status], className)}>
      {label}
    </span>
  )
}

/** An id in mono, cut to about 8 characters, with a copy button 12px after it. */
export function CopyId({ value, label, chars = 8, large = false, className }: { value: string; label: string; chars?: number; large?: boolean; className?: string }) {
  if (!value) return <span className={cn('text-ink-muted', className)}>{MISSING}</span>
  const short = value.length > chars + 1 ? `${value.slice(0, chars)}…` : value
  const copy = (event: MouseEvent) => {
    event.stopPropagation()
    if (!navigator.clipboard) return
    void navigator.clipboard.writeText(value).then(() => toast.success(`${label} copied`), () => toast.error(`Couldn’t copy the ${label.toLowerCase()}`))
  }
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      <span className="truncate font-mono text-[13px] text-ink-dim" title={value}>{short}</span>{/* taste-skill-ignore: ids are the one mono use */}
      <button
        type="button"
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={copy}
        onKeyDown={(event) => event.stopPropagation()}
        className={cn('grid flex-none place-items-center rounded-[3px] text-ink-muted hover:bg-ink/[0.06] hover:text-ink', large ? 'size-11' : 'size-6')}
      >
        <Copy size={12} aria-hidden="true" />
      </button>
    </span>
  )
}

/** A value that hasn't arrived: a flat bar at the value's size, never $0.00. */
export function Pending({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return <span role="status" aria-label={label} className={cn('inline-block h-[0.9em] w-20 rounded-[2px] bg-ink/[0.08] align-middle', className)} />
}
