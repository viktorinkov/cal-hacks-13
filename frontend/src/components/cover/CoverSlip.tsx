import { clockShort } from '@/lib/format'
import { formatCents } from '@/cover/money'
import type { Registration } from '@/cover/registry'

/** The band itself: a strap and the one LED. */
export function BandMark() {
  return (
    <svg width="88" height="28" viewBox="0 0 88 28" aria-hidden="true">
      <rect x="1.5" y="7" width="85" height="14" rx="7" fill="#151518" stroke="#cfd0d4" strokeWidth="1.5" />
      <circle cx="44" cy="14" r="2.5" fill="#dcc79f" />
    </svg>
  )
}

function shippingLine(registration: Registration) {
  const place = [registration.city, registration.region, registration.postalCode].filter(Boolean).join(' ')
  return [registration.street, registration.unit, place, registration.country].filter(Boolean).join(', ')
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-ink-dim">{label}</dt>
      <dd className="text-ink">{value || 'Not given'}</dd>
    </>
  )
}

/** What the aid station and the bar see when the band is tapped. */
export function CoverSlip({ registration, bandLabel }: { registration: Registration | null; bandLabel: string }) {
  if (!registration) {
    return (
      <div data-ui className="bg-raised px-5 py-5">
        <BandMark />
        <p className="mt-4 text-[13px] text-ink-dim">Band {bandLabel}</p>
        <p className="mt-2 text-[16px] leading-6 text-ink">Nothing is stored on this band.</p>
      </div>
    )
  }

  return (
    <div data-ui className="bg-raised px-5 py-5">
      <BandMark />
      <p className="mt-4 text-[13px] text-ink-dim">
        Band {bandLabel} · {registration.name}
      </p>
      <p className="mt-5 text-[13px] text-ink-dim">Allergies</p>
      <p className="mt-1 font-display text-[32px] leading-none text-ink">{registration.allergies || 'Not given'}</p>
      <dl className="mt-6 grid grid-cols-[7.25rem_minmax(0,1fr)] gap-y-2 text-[14px] leading-5">
        <Fact label="Blood" value={registration.bloodType} />
        <Fact label="Conditions" value={registration.conditions} />
        <Fact label="Medications" value={registration.medications} />
        <Fact label="Emergency" value={[registration.emergencyName, registration.emergencyPhone].filter(Boolean).join(', ')} />
        {registration.street && <Fact label="Ships to" value={shippingLine(registration)} />}
        <Fact label="Carrier" value={registration.carrier} />
        <Fact label="Member" value={registration.memberId} />
      </dl>
      <p className="mt-6 text-[13px] text-ink-dim">Card on the band</p>
      <p className="mt-1 text-[16px] tabular-nums text-ink">
        {registration.cardBrand} ···· {registration.last4}
      </p>
      <p className="mt-1 text-[13px] text-ink-dim">Exp {registration.exp}</p>
      {registration.lastChargeCents != null && registration.lastChargeAt != null && (
        <p className="mt-2 text-[13px] text-ink-dim">
          Last tap {formatCents(registration.lastChargeCents)} at {clockShort(registration.lastChargeAt)}
        </p>
      )}
    </div>
  )
}
