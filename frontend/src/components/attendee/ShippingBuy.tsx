import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { formatCents } from '@/cover/money'
import { getSavedRegistration } from '@/cover/registry'
import { fixtureActions, usePaymentsFixture, useWalletData } from '@/payments/live'
import { bandDigits, needsSize } from '@/payments/model'
import type { MerchPick } from '@/payments/rows'
import { addressLines, buyMerchWithShipping, clearError, KEYS, TEE_SIZES, track, useAttendee } from '@/stdb/attendeeOps'
import './attendee.css'

function savedAddress(bandId: number | null | undefined): string {
  if (bandId == null) return ''
  return addressLines(getSavedRegistration(`band-${bandDigits(bandId)}`))
}

/**
 * Buy a pick from the wallet and say where to ship it. A tee asks for a size. The address starts from
 * the one saved at sign-up on this phone, when there is one. Used in place of the plain buy.
 */
export function ShippingBuy({ pick, bandId, onDone }: { pick: MerchPick; bandId?: number | null; onDone?: () => void }) {
  const fixture = usePaymentsFixture()
  const { view } = useWalletData()
  const key = KEYS.buy(pick.templateId, pick.photoId)
  const pending = useAttendee((s) => Boolean(s.pending[key]))
  const error = useAttendee((s) => s.errors[key])
  const sized = pick.kind === 'tee' || needsSize(pick.kind)
  const [size, setSize] = useState<string>('M')
  const [address, setAddress] = useState(() => savedAddress(bandId))
  const idOf = (name: string) => `${name}-${pick.templateId}-${pick.photoId}`
  const noWallet = !view

  const buy = async (event: FormEvent) => {
    event.preventDefault()
    if (pending || noWallet) return
    const chosen = sized ? size : ''
    // The sample wallet never reaches the host. An empty address is refused the same way on both.
    const ok = fixture && address.trim()
      ? await track(key, () => fixtureActions.buyMerch(pick.templateId, pick.photoId, chosen))
      : await buyMerchWithShipping(pick.templateId, pick.photoId, chosen, address)
    if (!ok) return
    toast.success('Ordered. It stays pending until the bank settles it.')
    onDone?.()
  }

  return (
    <form onSubmit={(event) => void buy(event)} noValidate aria-label={`Buy ${pick.title}`} className="mt-6">
      {sized && (
        <fieldset>
          <legend className="text-[14px] font-medium text-ink">Size</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {TEE_SIZES.map((item) => (
              <label key={item} className="wallet-size">
                <input type="radio" name={idOf('size')} value={item} checked={size === item} onChange={() => setSize(item)} className="sr-only" />
                <span>{item}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className={sized ? 'mt-6' : undefined}>
        <label htmlFor={idOf('shipping')} className="attendee-label">Shipping address</label>
        <textarea
          id={idOf('shipping')}
          name="shipping-address"
          rows={4}
          maxLength={1000}
          required
          value={address}
          autoComplete="shipping street-address"
          placeholder={'Recipient name\nStreet address and apartment\nCity, state, postal code\nCountry'}
          aria-describedby={idOf('shipping-help')}
          aria-invalid={error ? true : undefined}
          onChange={(event) => { setAddress(event.target.value); clearError(key) }}
          className="signup-input wallet-textarea"
        />
        <p id={idOf('shipping-help')} className="attendee-hint">The recipient and the full mailing address.</p>
      </div>
      {error && <p role="alert" className="attendee-error">{error}</p>}
      <div className="mt-6 flex items-baseline justify-between gap-3 border-t border-line pt-4 text-[14px]">
        <span className="text-ink-dim">From your band’s wallet</span>
        <span className="text-[18px] font-medium tabular-nums text-ink">{formatCents(pick.priceCents)}</span>
      </div>
      <button type="submit" disabled={pending || noWallet} className="wallet-primary mt-5 w-full">
        {pending ? 'Ordering…' : <>Buy for <span className="tabular-nums">{formatCents(pick.priceCents)}</span></>}
      </button>
      <p className="mt-3 text-center text-[12px] text-ink-muted">
        {noWallet ? 'Your wallet opens with your band. You can buy once it does.' : 'Nessie sandbox wallet. No card is used.'}
      </p>
    </form>
  )
}

/** Where a merch order ships, from my_merch_shipping. */
export function OrderShipping({ orderId }: { orderId: string }) {
  const address = useAttendee((s) => s.shipping[orderId])
  return (
    <section className="mt-6">
      <h3 className="mb-2 text-[13px] text-[var(--signup-muted,#b4b4bc)]">Ship to</h3>
      <p className={address ? 'attendee-address text-[14px] leading-6 text-ink' : 'text-[14px] text-ink-dim'}>{address || 'Shipping address not recorded.'}</p>
    </section>
  )
}
