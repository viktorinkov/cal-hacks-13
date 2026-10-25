import { useState } from 'react'
import { KEYS, leaveEvent, useAttendee } from '@/stdb/attendeeOps'
import { useSession } from '@/stdb/session'
import './attendee.css'

/**
 * Leave before the doors close. It asks once, then stops the band; the page turns into the recap
 * when the departure row lands. Hidden once the night is over for this band.
 */
export function LeaveEvent() {
  const attendee = useAttendee((s) => s.attendee)
  const pending = useAttendee((s) => Boolean(s.pending[KEYS.leave]))
  const error = useAttendee((s) => s.errors[KEYS.leave])
  const ended = useSession((s) => s.eventEnded)
  const left = useSession((s) => Boolean(s.departure?.leftAt))
  const [asking, setAsking] = useState(false)
  if (!attendee || ended || left) return null
  const leave = async () => {
    if (await leaveEvent()) setAsking(false)
  }
  return (
    <section aria-labelledby="attendee-leave" className="attendee-section wallet-section mt-10">
      <h2 id="attendee-leave">Leaving early?</h2>
      <p className="attendee-lead">Keep your band on. After the event, tap it again for your recap: where you went, who you spent time with, and your photos.</p>
      {asking ? (
        <div role="group" aria-label="Leave the event" className="attendee-panel">
          <p className="text-[15px] font-medium text-ink">Leave the event now? Your band stops and your recap opens.</p>
          <div className="attendee-actions">
            <button type="button" disabled={pending} onClick={() => void leave()} className="signup-primary text-[14px]">{pending ? 'Leaving…' : 'Leave now'}</button>
            <button type="button" disabled={pending} onClick={() => setAsking(false)} className="min-h-11 px-2 text-[14px] text-ink-dim hover:text-ink">Stay</button>
          </div>
          {error && <p role="alert" className="attendee-error">{error}</p>}
        </div>
      ) : (
        <div className="attendee-actions">
          <button type="button" onClick={() => setAsking(true)} className="attendee-quiet">Leave the event</button>
        </div>
      )}
    </section>
  )
}
