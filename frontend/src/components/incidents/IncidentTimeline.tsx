import type { Incident, TimelineSource } from '@/contracts/domain'
import { clock } from '@/lib/format'
import { cn } from '@/lib/utils'

const sourceText: Record<TimelineSource, string> = {
  radio: 'radio',
  camera: 'camera',
  operator: 'operator',
  device: 'band',
  system: 'system',
}

const sourceColor: Record<TimelineSource, string> = {
  radio: 'bg-teal',
  camera: 'bg-section-front',
  operator: 'bg-champagne',
  device: 'bg-ink',
  system: 'bg-ink-muted',
}

/** Evidence in the order it arrived, each line tagged with where it came from. */
export function IncidentTimeline({ incident, tz }: { incident: Incident; tz?: string }) {
  const items = [...incident.timeline].sort((a, b) => a.at - b.at)
  return (
    <ol className="flex flex-col" aria-label="Timeline">
      {items.map((e, k) => (
        <li key={`${e.at}-${k}`} className="grid grid-cols-[64px_10px_1fr] items-baseline gap-2 py-[3px]">
          <span className="font-mono text-[11.5px] tabular-nums text-ink-muted">{clock(e.at, tz)}</span>
          <span aria-hidden className={cn('size-[5px] translate-y-[-1px] rounded-full', sourceColor[e.source])} />
          <span className="text-[13px] leading-snug text-ink-dim">
            {e.text}
            <span className="sr-only"> ({sourceText[e.source]})</span>
          </span>
        </li>
      ))}
    </ol>
  )
}
