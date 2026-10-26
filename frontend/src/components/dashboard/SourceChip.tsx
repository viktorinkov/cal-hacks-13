import { cn } from '@/lib/utils'
import { sourceTagText, type SourceTag } from '@/lib/status'

/**
 * Where a number came from. Locally generated values carry the striped mark so they can never be
 * mistaken for live measurements, even in a screenshot.
 */
export function SourceChip({ tag, className }: { tag: SourceTag; className?: string }) {
  const sim = tag === 'sim'
  return (
    <span
      className={cn(
        'inline-flex h-[18px] flex-none items-center gap-1 rounded-[2px] px-1.5 font-mono text-[10.5px] leading-none text-ink-muted shadow-[inset_0_0_0_1px_var(--nc-line)]',
        sim && 'text-[#cfc4ff]',
        className,
      )}
      title={sim ? 'Generated locally, not measured' : undefined}
    >
      {sim && <span aria-hidden className="nc-sim-stripes inline-block h-2 w-2 rounded-[1px]" />}
      {sourceTagText[tag]}
    </span>
  )
}
