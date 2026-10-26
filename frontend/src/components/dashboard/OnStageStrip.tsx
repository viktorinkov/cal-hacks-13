import { useServerNow } from '@/hooks/useServerNow'
import { clockShort, duration } from '@/lib/format'
import { useWorld } from '@/stores/world'

/** What is on stage now. Crowd behaviour follows the set list, so the operator keeps it in view. */
export function OnStageStrip() {
  const venue = useWorld((s) => s.venue)
  const incidentOpen = useWorld((s) => Object.values(s.incidents).some((i) => i.status !== 'resolved'))
  const now = useServerNow(0.2)
  const slot = venue?.schedule.find((s) => now >= s.startsAt && now < s.endsAt)
  if (!venue || !slot) return null
  const progress = (now - slot.startsAt) / (slot.endsAt - slot.startsAt)
  return (
    <div className="pointer-events-auto nc-panel hidden h-9 items-center gap-3.5 whitespace-nowrap px-3.5 xl:flex" aria-label="On stage now">
      <span aria-hidden className="flex h-3.5 items-end gap-[2px]">
        {['bg-section-front', 'bg-section-food', 'bg-section-floor', 'bg-section-wing'].map((c, i) => (
          <span
            key={c}
            className={`w-[3px] origin-bottom rounded-[1px] ${c}`}
            style={{
              height: incidentOpen ? 4 : 14,
              animation: incidentOpen ? undefined : `nc-eq ${0.45 + i * 0.08}s ease-in-out ${i * 0.1}s infinite alternate`,
            }}
          />
        ))}
      </span>
      <span className="font-display text-[19px] leading-none text-ink">{slot.title}</span>
      <span className="hidden font-mono text-[11.5px] text-ink-dim xl:inline">
        {clockShort(slot.startsAt, venue.timeZone)} to {clockShort(slot.endsAt, venue.timeZone)}
      </span>
      <span className="relative hidden h-[2px] w-24 rounded-full bg-line-strong lg:inline-block" aria-hidden>
        <span className="absolute inset-y-0 left-0 rounded-full bg-champagne" style={{ width: `${Math.round(progress * 100)}%` }} />
      </span>
      <span className="text-[11.5px] text-ink-muted">{duration(slot.endsAt - now)} left</span>
    </div>
  )
}
