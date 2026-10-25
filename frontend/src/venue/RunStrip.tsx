import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '@/lib/utils'
import { STAGE_TOOLS, clock, type Run, type RunFrame, type Stage, type StageSpan, type Tool } from './runs'

/** Short enough for the strip; the steps list names each tool in full. */
const TOOL_SHORT: Record<Tool, string> = {
  search: 'SERP API',
  unlocker: 'Web Unlocker',
  browser: 'Browser API',
  claude: 'Claude',
}

interface Props {
  run: Run
  frame: RunFrame
  spans: StageSpan[]
  active: Stage | null
  /** Replays can be scrubbed; a live run cannot be moved. */
  onSeek?: (t: number) => void
}

/**
 * The run's time as Search, Read and Capture, each as long as it really took, with the model saved
 * at the end. The stage the run is in carries the accent. For a replay it is also the scrubber.
 */
export function RunStrip({ run, frame, spans, active, onSeek }: Props) {
  const cells = useRef<(HTMLDivElement | null)[]>([])
  const dragging = useRef(false)
  const saved = run.steps.find((step) => step.stage === 'save')
  const reachedEnd = frame.finished && Boolean(saved) && frame.status === 'ready'

  const seekAt = (x: number) => {
    if (!onSeek) return
    for (let i = 0; i < spans.length; i++) {
      const box = cells.current[i]?.getBoundingClientRect()
      if (!box) continue
      if (x < box.left && i === 0) return onSeek(0)
      if (x >= box.left && x <= box.right) {
        const share = (x - box.left) / Math.max(1, box.width)
        return onSeek(spans[i].from + share * (spans[i].to - spans[i].from))
      }
    }
    onSeek(run.duration)
  }

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (!onSeek) return
    dragging.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    seekAt(event.clientX)
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) seekAt(event.clientX)
  }
  const up = () => {
    dragging.current = false
  }
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onSeek) return
    const step = event.shiftKey ? 30_000 : 5_000
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') onSeek(Math.min(run.duration, frame.t + step))
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') onSeek(Math.max(0, frame.t - step))
    else if (event.key === 'Home') onSeek(0)
    else if (event.key === 'End') onSeek(run.duration)
    else return
    event.preventDefault()
  }

  const scrub = onSeek
    ? {
        role: 'slider' as const,
        tabIndex: 0,
        'aria-label': 'Replay position',
        'aria-valuemin': 0,
        'aria-valuemax': Math.round(run.duration / 1000),
        'aria-valuenow': Math.round(frame.t / 1000),
        'aria-valuetext': `${clock(frame.t)} of ${clock(run.duration)}`,
        onPointerDown: down,
        onPointerMove: move,
        onPointerUp: up,
        onPointerCancel: up,
        onKeyDown: key,
      }
    : {}

  return (
    <div
      {...scrub}
      className={cn(
        'flex touch-none select-none gap-1 rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-champagne/60 focus-visible:ring-offset-4 focus-visible:ring-offset-ground',
        onSeek && 'cursor-ew-resize',
      )}
    >
      {spans.map((span, i) => {
        const length = Math.max(1, span.to - span.from)
        const fill = Math.min(1, Math.max(0, (frame.t - span.from) / length))
        const on = span.stage === active
        const tools = STAGE_TOOLS[span.stage].map((tool) => TOOL_SHORT[tool]).join(' · ')
        const taken = frame.t >= span.to ? span.to - span.from : Math.max(0, frame.t - span.from)
        return (
          <div
            key={span.stage}
            ref={(el) => {
              cells.current[i] = el
            }}
            className="min-w-[5rem] sm:min-w-[7.5rem]"
            style={{ flexGrow: length, flexBasis: 0 }}
          >
            <div className="relative h-2 bg-line">
              <div className={cn('absolute inset-y-0 left-0', on ? 'bg-champagne' : 'bg-silver/45')} style={{ width: `${fill * 100}%` }} />
              {span.steps
                .filter((step) => step.offset > span.from && step.offset <= frame.t)
                .map((step) => (
                  <span
                    key={step.id}
                    aria-hidden
                    className="absolute inset-y-0 w-px bg-ground"
                    style={{ left: `${((step.offset - span.from) / length) * 100}%` }}
                  />
                ))}
            </div>
            <div className="mt-2.5 flex items-baseline justify-between gap-2 pr-2">
              <span className={cn('text-[13px] font-medium', span.reached ? 'text-ink' : 'text-ink-muted')}>{span.label}</span>
              <span className="text-[12px] tabular-nums text-ink-dim">{span.reached ? clock(taken) : '–'}</span>
            </div>
            <p className="mt-0.5 truncate pr-2 text-[12px] text-ink-muted">{tools}</p>
          </div>
        )
      })}
      <div className="w-[4.5rem] shrink-0 sm:w-[6.5rem]">
        <div className="flex h-2 items-center">
          <span aria-hidden className={cn('h-2 w-2', reachedEnd ? 'bg-ink' : 'bg-line')} />
        </div>
        <p className={cn('mt-2.5 text-[13px] font-medium', reachedEnd ? 'text-ink' : 'text-ink-muted')}>Save</p>
        <p className="mt-0.5 truncate text-[12px] tabular-nums text-ink-muted">{reachedEnd && saved ? `Done at ${clock(saved.offset)}` : 'Model stored'}</p>
      </div>
    </div>
  )
}
