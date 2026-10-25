import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { formatCents } from '@/cover/money'
import { annotateBin, BIN_MINUTES, clock, type Bin } from '@/payments/model'

/** Round ticks (1, 2, 2.5 or 5 × 10^n) whose top sits above the largest value, as charts.js draws them. */
function niceTicks(max: number, count = 4): number[] {
  const top = max > 0 ? max : 1
  const raw = top / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  let hi = Math.ceil(top / step) * step
  if (hi <= top) hi += step
  const out: number[] = []
  for (let v = 0; v <= hi + step / 2; v += step) out.push(Number(v.toFixed(6)))
  return out
}

function useWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth || fallback)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, fallback])
  return width
}

const LEFT = 52
const LANE = 22
const PLOT = 128
const AXIS = 24

/** Paid money per quarter-hour. One series, one hue, the biggest bin named from its own rows. */
export function NightChart({ bins }: { bins: Bin[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useWidth(ref, 760)
  const height = LANE + PLOT + AXIS
  const plotW = Math.max(120, width - LEFT - 2)
  if (!bins.length) {
    return (
      <div ref={ref} className="relative" style={{ height }}>
        <svg width={width} height={height} aria-hidden="true">
          <line x1={LEFT} x2={LEFT + plotW} y1={LANE + PLOT + 0.5} y2={LANE + PLOT + 0.5} stroke="var(--nc-line-strong)" />
        </svg>
        <p className="absolute left-[52px] top-[60px] text-[13px] text-ink-dim">Nothing has been paid yet tonight.</p>
      </div>
    )
  }
  const max = Math.max(...bins.map((bin) => bin.cents))
  const ticks = niceTicks(max / 100)
  const topCents = ticks[ticks.length - 1] * 100
  const y = (cents: number) => LANE + PLOT - (cents / topCents) * PLOT
  const slot = plotW / bins.length
  const barW = Math.max(1.5, slot - (slot > 10 ? 3 : 1))
  const biggest = bins.reduce((best, bin, index) => (bin.cents > bins[best].cents ? index : best), 0)
  const note = annotateBin(bins[biggest])
  const noteX = LEFT + biggest * slot + slot / 2
  const noteW = note.length * 6.6
  const anchor = noteX + noteW / 2 > width ? 'end' : noteX - noteW / 2 < LEFT ? 'start' : 'middle'
  const hourly = slot * (60 / BIN_MINUTES) >= 48 ? 1 : 2
  const labels = bins
    .map((bin, index) => ({ index, at: bin.start }))
    .filter(({ at }) => new Date(at).getMinutes() === 0 && new Date(at).getHours() % hourly === 0)
  const span = `${clock(bins[0].start)} to ${clock(bins[bins.length - 1].start + BIN_MINUTES * 60_000)}`
  const summary = `Paid money per ${BIN_MINUTES} minutes from ${span}. The biggest quarter-hour began at ${clock(bins[biggest].start)} with ${formatCents(bins[biggest].cents)}: ${note}.`

  return (
    <div ref={ref} className="w-full">
      <svg width={width} height={height} role="img" aria-label={summary} className="block overflow-visible">
        {ticks.map((tick) => (
          <g key={tick}>
            {tick > 0 && <line x1={LEFT} x2={LEFT + plotW} y1={Math.round(y(tick * 100)) + 0.5} y2={Math.round(y(tick * 100)) + 0.5} stroke="var(--nc-line)" />}
            <text x={LEFT - 10} y={y(tick * 100) + 4} textAnchor="end" className="fill-ink-muted text-[12px] tabular-nums">
              {formatCents(tick * 100).replace(/\.00$/, '')}
            </text>
          </g>
        ))}
        {bins.map((bin, index) => bin.cents > 0 && (
          <rect key={bin.start} x={LEFT + index * slot + (slot - barW) / 2} y={y(bin.cents)} width={barW} height={LANE + PLOT - y(bin.cents)} fill="var(--nc-teal)">
            <title>{`${clock(bin.start)}–${clock(bin.start + BIN_MINUTES * 60_000)} · ${formatCents(bin.cents)} · ${bin.count} paid`}</title>
          </rect>
        ))}
        <line x1={LEFT} x2={LEFT + plotW} y1={LANE + PLOT + 0.5} y2={LANE + PLOT + 0.5} stroke="var(--nc-line-strong)" />
        <line x1={Math.round(noteX) + 0.5} x2={Math.round(noteX) + 0.5} y1={LANE - 6} y2={y(bins[biggest].cents) - 3} stroke="var(--nc-ink-dim)" />
        <text x={noteX + (anchor === 'start' ? -2 : anchor === 'end' ? 2 : 0)} y={LANE - 10} textAnchor={anchor} className="fill-ink text-[12px]">{note}</text>
        {labels.map(({ index, at }) => (
          <text key={at} x={LEFT + index * slot} y={LANE + PLOT + 17} textAnchor={index === 0 ? 'start' : 'middle'} className="fill-ink-muted text-[12px] tabular-nums">
            {clock(at)}
          </text>
        ))}
      </svg>
    </div>
  )
}
