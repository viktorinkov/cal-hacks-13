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

/** The band's card: who wears it and where merch ships. */
export function CoverSlip({ registration, bandLabel }: { registration: Registration | null; bandLabel: string }) {
  if (!registration) {
    return (
      <div data-ui className="bg-raised px-5 py-5">
        <BandMark />
        <p className="mt-4 text-[13px] text-ink-dim">Band {bandLabel}</p>
        <p className="mt-2 text-[16px] leading-6 text-ink">Nothing is saved for this band on this phone.</p>
      </div>
    )
  }

  const ships = shippingLine(registration)
  return (
    <div data-ui className="bg-raised px-5 py-5">
      <BandMark />
      <p className="mt-4 text-[13px] text-ink-dim">
        Band {bandLabel} · {registration.name}
      </p>
      {ships && (
        <>
          <p className="mt-5 text-[13px] text-ink-dim">Ships to</p>
          <p className="mt-1 text-[15px] leading-6 text-ink">{ships}</p>
        </>
      )}
    </div>
  )
}
