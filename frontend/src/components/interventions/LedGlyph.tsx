import type { LedPattern } from '@/contracts/domain'
import { cn } from '@/lib/utils'

const N = 12

/** Which of the 12 ring pixels are lit for a pattern, and in what colour. */
function lit(pattern: LedPattern, k: number): string | null {
  switch (pattern) {
    case 'ready':
      return k === 0 ? 'var(--nc-teal)' : null
    case 'sos':
    case 'steady_red':
      return 'var(--nc-red)'
    case 'step_aside':
      return (k >= 2 && k <= 4) || (k >= 8 && k <= 10) ? 'var(--nc-amber)' : null
    case 'help_coming':
      return k === 0 || k === 4 || k === 8 ? 'var(--nc-green)' : null
    default:
      return null
  }
}

const motion: Partial<Record<LedPattern, string>> = {
  ready: 'animate-breath',
  sos: 'animate-flash',
  step_aside: 'animate-blink',
}

/**
 * The band's 12-pixel LED ring as the firmware draws each pattern. `pending` shows the pattern
 * dashed: it is what the band will show once it confirms, not what it shows now.
 */
export function LedGlyph({
  pattern,
  size = 22,
  pending = false,
  failed = false,
  className,
  label,
}: {
  pattern: LedPattern
  size?: number
  pending?: boolean
  failed?: boolean
  className?: string
  label?: string
}) {
  const r = size / 2 - 3
  const c = size / 2
  const dot = Math.max(1.2, size / 14)
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('flex-none', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx={c} cy={c} r={r + dot + 1} fill="#0c0d10" stroke={failed ? 'var(--nc-red)' : 'rgba(207,208,212,0.18)'} strokeWidth={failed ? 1.2 : 1} strokeDasharray={pending ? '2 2' : undefined} />
      {Array.from({ length: N }, (_, k) => {
        const a = -Math.PI / 2 + (k / N) * Math.PI * 2
        const color = lit(pattern, k)
        const x = c + Math.cos(a) * r
        const y = c + Math.sin(a) * r
        if (!color) return <circle key={k} cx={x} cy={y} r={dot * 0.8} fill="#2a2b30" />
        if (pending) return <circle key={k} cx={x} cy={y} r={dot * 0.85} fill="none" stroke={color} strokeWidth={0.9} />
        return <circle key={k} cx={x} cy={y} r={dot} fill={color} className={motion[pattern]} />
      })}
    </svg>
  )
}
