import { clock } from '@/payments/model'
import type { MyCharge } from '@/payments/rows'
import { canPayCharge, chargeStatusLine, KEYS, payCharge, useAttendee } from '@/stdb/attendeeOps'
import './attendee.css'

/**
 * What a charge on the band waits for, and the pay button when it waits on the attendee. Only an
 * approved charge can be paid, and nothing leaves the wallet until they press it. The dispute form
 * stays where it is.
 */
export function ChargePay({ charge }: { charge: Pick<MyCharge, 'id' | 'status' | 'paidAt'> }) {
  const key = KEYS.pay(charge.id)
  const pending = useAttendee((s) => Boolean(s.pending[key]))
  const error = useAttendee((s) => s.errors[key])
  const line = chargeStatusLine(charge.status, clock(charge.paidAt))
  if (!line && !error) return null
  return (
    <div className="mt-2">
      {line && <p className="text-[14px] font-medium leading-6 text-ink">{line}</p>}
      {canPayCharge(charge.status) && (
        <button type="button" disabled={pending} onClick={() => void payCharge(charge.id)} className="signup-primary mt-2 text-[14px]">
          {pending ? 'Paying…' : 'Pay from wallet'}
        </button>
      )}
      {error && <p role="alert" className="attendee-error">{error}</p>}
    </div>
  )
}
