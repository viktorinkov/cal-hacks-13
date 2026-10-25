import { useMemo, useState, type FormEvent } from 'react'
import { Waves } from 'lucide-react'
import { SourceChip } from '@/components/dashboard/SourceChip'
import { useAction } from '@/components/payments/action'
import { CopyId, StatusPill } from '@/components/payments/bits'
import { MerchThumb } from '@/components/payments/MerchThumb'
import { Sheet, Timeline } from '@/components/payments/Sheet'
import { formatCents } from '@/cover/money'
import { useRoute } from '@/cover/route'
import { cn } from '@/lib/utils'
import { FIXTURE_BAND } from '@/payments/fixture'
import {
  bandDigits, bandLabel, canDispute, clock, merchTimeline, myChargeStatus, needsSize, plain, SIZES, STATUS_LABEL, walletActivity, walletFinding, walletSummary,
  type DisplayStatus, type Payment,
} from '@/payments/model'
import { usePaymentActions, usePaymentsFixture, useWalletData } from '@/payments/live'
import type { MerchPick, MyCharge, WalletData } from '@/payments/rows'
import { useSession } from '@/stdb/session'
import '../join/RegisterPage.css'
import './WalletPage.css'

type ViewState = { state: 'ready' | 'loading' | 'error'; message: string }

function useViewStates(fixture: boolean) {
  const errors = useSession((s) => s.walletViewErrors)
  const entries = useSession((s) => s.walletEntriesReady)
  const charges = useSession((s) => s.chargesReady)
  const suggestions = useSession((s) => s.suggestionsReady)
  const orders = useSession((s) => s.merchOrdersReady)
  const of = (ready: boolean, ...views: string[]): ViewState => {
    if (fixture) return { state: 'ready', message: '' }
    const error = views.map((view) => errors[view]).find(Boolean)
    if (error) return { state: 'error', message: error }
    return { state: ready ? 'ready' : 'loading', message: '' }
  }
  return {
    charges: of(charges, 'my_charges'),
    activity: of(entries && orders, 'my_wallet_entries', 'my_merch_orders'),
    picks: of(suggestions, 'my_merch_suggestions'),
  }
}

const statusLabel = (status: DisplayStatus, raw: string) => (status === 'other' ? plain(raw) || 'Unknown' : STATUS_LABEL[status])

function signed(cents: number): string {
  if (cents < 0) return `−${formatCents(-cents)}`
  return `+${formatCents(cents)}`
}

/** What the attendee's wallet saw: purchases out, refunds and the opening deposit in. */
function movement(payment: Payment): { text: string; quiet: boolean; note: string } {
  if (payment.source === 'merch') {
    if (payment.status === 'failed') return { text: formatCents(payment.amountCents), quiet: true, note: 'Not charged' }
    if (payment.status === 'refunded') return { text: signed(payment.amountCents), quiet: false, note: '' }
    return { text: signed(-payment.amountCents), quiet: false, note: '' }
  }
  return { text: signed(payment.amountCents), quiet: false, note: '' }
}

function Note({ view, loading, empty }: { view: ViewState; loading: string; empty: string }) {
  if (view.state === 'loading') return <p role="status" className="wallet-note">{loading}</p>
  if (view.state === 'error') return <p className="wallet-note">This can’t load right now. {view.message}</p>
  return <p className="wallet-note">{empty}</p>
}

function ChargeRow({ charge }: { charge: MyCharge }) {
  const actions = usePaymentActions()
  const { busy, error, run } = useAction()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [missing, setMissing] = useState(false)
  const status = myChargeStatus(charge)
  const label = status === 'decision' ? 'Waiting on the venue' : statusLabel(status, charge.status)
  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim()) {
      setMissing(true)
      return
    }
    const ok = await run('dispute', () => actions.disputeCharge(charge.id, text), { success: 'Sent. The venue will look at it.', failure: 'Your note wasn’t sent' })
    if (ok) setOpen(false)
  }
  const what = [plain(charge.incidentKind), charge.zoneName].filter(Boolean).join(' · ') || 'Charge'
  return (
    <li className="wallet-row">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-ink">{what}</p>
          <p className="mt-1 text-[13px] text-[var(--signup-muted)]">
            <span className="tabular-nums">{clock(charge.happenedAt)}</span>{charge.clause ? ` · ${charge.clause}` : ''}
          </p>
        </div>
        <div className="flex flex-none flex-col items-end gap-1.5">
          <span className="text-[15px] font-medium tabular-nums text-ink">{formatCents(charge.amountCents)}</span>
          <StatusPill status={status === 'decision' ? 'pending' : status} label={label} />
        </div>
      </div>
      {charge.why && <p className="mt-2 text-[14px] leading-6 text-ink-dim">{charge.why}</p>}
      {charge.disputeText && (
        <blockquote className="mt-3 border-l border-[var(--signup-control)] pl-3 text-[14px] leading-6 text-ink-dim">
          You wrote: “{charge.disputeText}”
        </blockquote>
      )}
      {open ? (
        <form onSubmit={(event) => void send(event)} noValidate className="mt-3">
          <label htmlFor={`dispute-${charge.id}`} className="block text-[14px] font-medium text-ink">What isn’t right?</label>
          <textarea
            id={`dispute-${charge.id}`}
            value={text}
            rows={3}
            onChange={(event) => { setText(event.target.value); setMissing(false) }}
            aria-invalid={missing || undefined}
            aria-describedby={missing ? `dispute-${charge.id}-missing` : undefined}
            className="signup-input wallet-textarea mt-2"
          />
          {missing && <p id={`dispute-${charge.id}-missing`} className="mt-1.5 text-[13px] text-caution">Say what isn’t right.</p>}
          {error && <p className="mt-1.5 text-[13px] text-caution">{error.message}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy != null} className="signup-primary text-[14px]">{busy ? 'Sending…' : 'Send to the venue'}</button>
            <button type="button" disabled={busy != null} onClick={() => setOpen(false)} className="min-h-11 px-2 text-[14px] text-ink-dim hover:text-ink">Cancel</button>
          </div>
        </form>
      ) : canDispute(status) && !charge.disputeText ? (
        <button type="button" onClick={() => setOpen(true)} className="mt-2 min-h-11 text-[14px] text-champagne underline underline-offset-4">This isn’t right</button>
      ) : null}
    </li>
  )
}

function ActivityRow({ payment, onOpen }: { payment: Payment; onOpen: () => void }) {
  const move = movement(payment)
  const showPill = payment.status !== 'paid' && payment.status !== 'other'
  return (
    <li className="wallet-row is-button">
      <button type="button" onClick={onOpen} className="flex min-h-14 w-full items-center justify-between gap-4 py-3 text-left">
        <span className="min-w-0">
          <span className="block truncate text-[15px] text-ink">{payment.what}</span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-[var(--signup-muted)]">
            <span className="tabular-nums">{clock(payment.createdAt)}</span>
            {showPill && <StatusPill status={payment.status} label={payment.label} />}
          </span>
        </span>
        <span className="flex flex-none flex-col items-end">
          <span className={cn('text-[15px] tabular-nums', move.quiet ? 'text-ink-muted line-through' : 'text-ink')}>{move.text}</span>
          {move.note && <span className="text-[12px] text-[var(--signup-muted)]">{move.note}</span>}
        </span>
      </button>
    </li>
  )
}

function ActivitySheet({ payment, data, onClose }: { payment: Payment | null; data: WalletData; onClose: () => void }) {
  const [last, setLast] = useState<Payment | null>(payment)
  if (payment && payment !== last) setLast(payment)
  const shown = payment ?? last
  if (!shown) return null
  const order = shown.source === 'merch' ? data.orders.find((item) => item.id === shown.rowId) : undefined
  const template = order ? data.templates.find((item) => item.id === order.templateId) : undefined
  const move = movement(shown)
  return (
    <Sheet open={Boolean(payment)} onClose={onClose} title={shown.what} description={`${clock(shown.createdAt)} · ${move.note || shown.label}`} className="bg-[#151518]">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[28px] font-medium leading-none tabular-nums text-ink">{move.text}</p>
        <StatusPill status={shown.status} label={shown.label} />
      </div>
      {order && (
        <div className="mt-6 grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-4">
          <MerchThumb kind={template?.kind ?? ''} title={shown.what} imageUrl={template?.imageUrl ?? ''} photoUrl={order.photoUrl} area={template?.area ?? { width: 0, height: 0, x: 0, y: 0, w: 0, h: 0 }} />
          <div className="text-[14px] leading-6 text-ink-dim">
            {order.line && <p>{order.line}</p>}
            {shown.status === 'failed' && <p className="mt-2 text-ink">{shown.failure} Your band wasn’t charged.</p>}
          </div>
        </div>
      )}
      {order && (
        <section className="mt-7">
          <h3 className="mb-3 text-[13px] text-[var(--signup-muted,#b4b4bc)]">What happened</h3>
          <Timeline steps={merchTimeline(order, shown.status).map((step) => ({ ...step, at: clock(step.at), warn: step.key === 'failed' }))} />
        </section>
      )}
      <div className="mt-7 flex items-center justify-between gap-3 border-t border-line pt-3 text-[13px] text-ink-dim">
        <span>Bank reference</span>
        <CopyId value={shown.reference} label="Reference" chars={12} large />
      </div>
    </Sheet>
  )
}

function BuySheet({ pick, band, onClose }: { pick: MerchPick | null; band: string; onClose: () => void }) {
  const actions = usePaymentActions()
  const { busy, error, run } = useAction()
  const [size, setSize] = useState('')
  const [missing, setMissing] = useState(false)
  const [last, setLast] = useState<MerchPick | null>(pick)
  if (pick && pick !== last) {
    setLast(pick)
    setSize('')
    setMissing(false)
  }
  const shown = pick ?? last
  if (!shown) return null
  const sized = needsSize(shown.kind, shown.title)
  const buy = async (event: FormEvent) => {
    event.preventDefault()
    if (sized && !size) {
      setMissing(true)
      return
    }
    const ok = await run('buy', () => actions.buyMerch(shown.templateId, shown.photoId, sized ? size : ''), {
      success: 'Ordered. It stays pending until the bank settles it.',
      failure: 'The order wasn’t placed',
    })
    if (ok) onClose()
  }
  return (
    <Sheet open={Boolean(pick)} onClose={onClose} title={shown.title} description={`Charged to your band’s wallet · ${band}`} className="bg-[#151518]">
      <form id="buy-form" onSubmit={(event) => void buy(event)} noValidate>
        <MerchThumb kind={shown.kind} title={shown.title} imageUrl={shown.imageUrl} photoUrl={shown.photoUrl} area={shown.area} className="mx-auto w-full max-w-[16rem]" />
        {shown.line && <p className="mt-4 text-[14px] leading-6 text-ink-dim">{shown.line}</p>}
        {sized && (
          <fieldset className="mt-6" aria-describedby={missing ? 'size-missing' : undefined}>
            <legend className="text-[14px] font-medium text-ink">Size</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {SIZES.map((item) => (
                <label key={item} className="wallet-size">
                  <input type="radio" name="size" value={item} checked={size === item} onChange={() => { setSize(item); setMissing(false) }} className="sr-only" />
                  <span>{item}</span>
                </label>
              ))}
            </div>
            {missing && <p id="size-missing" className="mt-2 text-[13px] text-caution">Choose a size.</p>}
          </fieldset>
        )}
        {error && <p role="alert" className="mt-4 text-[13px] text-caution">{error.message}</p>}
        <div className="mt-6 flex items-baseline justify-between gap-3 border-t border-line pt-4 text-[14px]">
          <span className="text-ink-dim">From your band’s wallet</span>
          <span className="text-[18px] font-medium tabular-nums text-ink">{formatCents(shown.priceCents)}</span>
        </div>
        <button type="submit" disabled={busy != null} className="wallet-primary mt-5 w-full">
          {busy ? 'Ordering…' : <>Buy for <span className="tabular-nums">{formatCents(shown.priceCents)}</span></>}
        </button>
        <p className="mt-3 text-center text-[12px] text-ink-muted">Nessie sandbox wallet. No card is used.</p>
      </form>
    </Sheet>
  )
}

function PickCard({ pick, onBuy }: { pick: MerchPick; onBuy: () => void }) {
  const friends = pick.friends.filter(Boolean)
  return (
    <li className="wallet-pick">
      <MerchThumb kind={pick.kind} title={pick.title} imageUrl={pick.imageUrl} photoUrl={pick.photoUrl} area={pick.area} decorative />
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-[15px] font-medium text-ink">{pick.title}</p>
          <span className="flex-none text-[15px] tabular-nums text-ink">{formatCents(pick.priceCents)}</span>
        </div>
        <p className="mt-1 text-[13px] leading-5 text-[var(--signup-muted)]">{pick.reason || pick.line || 'From tonight’s photos of you.'}</p>
        {friends.length > 0 && <p className="mt-1 truncate text-[13px] text-[var(--signup-muted)]">With {friends.length > 2 ? `${friends.slice(0, 2).join(', ')} and ${friends.length - 2} more` : friends.join(' and ')}</p>}
        <button type="button" onClick={onBuy} className="signup-primary mt-3 text-[14px]">Buy with my band</button>
      </div>
    </li>
  )
}

function Balance({ fixture }: { fixture: boolean }) {
  const { view } = useWalletData()
  const walletError = useSession((s) => s.walletError)
  const actions = usePaymentActions()
  const { busy, run } = useAction()
  if (view) {
    return (
      <>
        <p className="text-[13px] text-[var(--signup-muted)]">Balance</p>
        <p className="wallet-balance">{formatCents(view.balanceCents)}</p>
        <div className="mt-1 flex items-center gap-2 text-[13px] text-[var(--signup-muted)]">
          Account <CopyId value={view.accountId} label="Account id" chars={10} large />
        </div>
      </>
    )
  }
  if (!fixture && walletError) {
    return (
      <div role="alert">
        <p className="text-[15px] font-medium text-ink">Your wallet didn’t open.</p>
        <p className="mt-1 text-[13px] leading-5 text-[var(--signup-muted)]">{walletError}</p>
        <button type="button" disabled={busy != null} onClick={() => void run('connect', actions.connectWallet, { success: 'Your wallet is opening.', failure: 'Your wallet still didn’t open' })} className="signup-primary mt-3 text-[14px]">
          {busy ? 'Trying…' : 'Try again'}
        </button>
      </div>
    )
  }
  return (
    <div role="status">
      <p className="text-[15px] font-medium text-ink">Your wallet is opening.</p>
      <p className="mt-1 text-[13px] leading-5 text-[var(--signup-muted)]">It opens with your band. Your balance shows here when the bank answers.</p>
    </div>
  )
}

function TapYourBand() {
  return (
    <div className="signup-tap">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[var(--signup-raised)]"><Waves size={30} strokeWidth={1.25} className="text-champagne" aria-hidden="true" /></div>
      <h1 className="signup-title mt-8">Tap your band to see your wallet.</h1>
      <p className="mt-5 text-[16px] leading-7 text-ink-dim">Your wallet belongs to the band you registered. Tap it with this phone and the wallet opens here.</p>
    </div>
  )
}

function Wallet({ bandId, fixture }: { bandId: number; fixture: boolean }) {
  const { data } = useWalletData()
  const views = useViewStates(fixture)
  const actions = usePaymentActions()
  const pickAgain = useAction()
  const [openId, setOpenId] = useState<string | null>(null)
  const [buying, setBuying] = useState<MerchPick | null>(null)
  const band = bandLabel(bandId)
  const activity = useMemo(() => walletActivity(data), [data])
  const summary = walletSummary(activity, data.charges)
  const charges = [...data.charges].sort((a, b) => b.happenedAt - a.happenedAt)
  const picks = [...data.suggestions].sort((a, b) => a.rank - b.rank).slice(0, 3)
  const ready = views.activity.state === 'ready' && views.charges.state === 'ready'
  const open = openId ? activity.find((payment) => payment.id === openId) ?? null : null

  return (
    <main className="wallet-main">
      <div className="signup-intro">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="signup-title">
            {ready ? (summary.paidCents ? `${formatCents(summary.paidCents)} paid tonight.` : 'Nothing paid yet tonight.') : 'Your band’s wallet.'}
          </h1>
          {fixture && <SourceChip tag="sim" />}
        </div>
        <p>{ready ? walletFinding(summary) : 'Checking what’s on your band…'}</p>
      </div>

      <section aria-label={`${band} wallet`} className="wallet-hero">
        <div className="signup-strap" aria-hidden="true"><span>{bandDigits(bandId)}</span><i /></div>
        <div className="min-w-0"><Balance fixture={fixture} /></div>
        <div className="wallet-hero-aside">
          <p className="text-[15px] font-medium text-ink">{band}</p>
          <p className="mt-1 text-[13px] leading-5 text-[var(--signup-muted)]">Pay at booths and the merch desk with your band. A Nessie sandbox account, not a card.</p>
        </div>
      </section>

      <div className="wallet-grid">
        <div className="min-w-0">
          <section aria-labelledby="wallet-charges" className="wallet-section">
            <h2 id="wallet-charges">Charges on your band</h2>
            {views.charges.state === 'ready' && charges.length ? (
              <ul className="mt-2">{charges.map((charge) => <ChargeRow key={charge.id} charge={charge} />)}</ul>
            ) : (
              <Note view={views.charges} loading="Checking for charges on your band…" empty="Nothing has been charged to your band." />
            )}
          </section>
          <section aria-labelledby="wallet-activity" className="wallet-section">
            <h2 id="wallet-activity">Activity</h2>
            {views.activity.state === 'ready' && activity.length ? (
              <ul className="mt-2">{activity.map((payment) => <ActivityRow key={payment.id} payment={payment} onOpen={() => setOpenId(payment.id)} />)}</ul>
            ) : (
              <Note view={views.activity} loading="Loading your activity…" empty="Nothing has moved through your wallet yet." />
            )}
          </section>
        </div>
        <section aria-labelledby="wallet-picks" className="wallet-section min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="wallet-picks">Picks for you</h2>
            <button
              type="button"
              disabled={pickAgain.busy != null}
              onClick={() => void pickAgain.run('again', actions.rerunShoppingAgent, { success: 'New picks are on their way.', failure: 'No new picks this time' })}
              className="min-h-11 text-[14px] text-ink-dim hover:text-ink"
            >
              {pickAgain.busy ? 'Picking…' : 'Pick again'}
            </button>
          </div>
          <p className="text-[13px] text-[var(--signup-muted)]">From tonight’s photos of you, printed on the piece.</p>
          {views.picks.state === 'ready' && picks.length ? (
            <ul className="mt-3 grid gap-3">{picks.map((pick) => <PickCard key={pick.key} pick={pick} onBuy={() => setBuying(pick)} />)}</ul>
          ) : (
            <Note view={views.picks} loading="Looking through tonight’s photos…" empty="No picks yet. They come from tonight’s photos of you." />
          )}
        </section>
      </div>
      <ActivitySheet payment={open} data={data} onClose={() => setOpenId(null)} />
      <BuySheet pick={buying} band={band} onClose={() => setBuying(null)} />
    </main>
  )
}

/** The attendee's wallet: what the band paid tonight, what's charged to it, and picks to buy with it. */
export function WalletPage() {
  const fixture = usePaymentsFixture()
  const { go } = useRoute()
  const phase = useSession((s) => s.phase)
  const error = useSession((s) => s.error)
  const myBand = useSession((s) => s.myBand)
  const myBandReady = useSession((s) => s.myBandReady)
  const bandId = fixture ? FIXTURE_BAND : myBand?.status === 'claimed' ? myBand.bandId : null
  const label = bandId == null ? '' : bandDigits(bandId)

  let body
  if (bandId != null) body = <Wallet bandId={bandId} fixture={fixture} />
  else if (phase === 'error') body = <div className="signup-tap"><h1 className="signup-title">Your wallet can’t load right now.</h1><p className="mt-5 text-[16px] leading-7 text-ink-dim">{error ?? 'The host didn’t answer.'}</p></div>
  else if (phase !== 'live' || !myBandReady) body = <div className="signup-tap" role="status"><h1 className="signup-title">Opening your wallet…</h1><p className="mt-5 text-[16px] leading-7 text-ink-dim">Checking which band is yours.</p></div>
  else body = <TapYourBand />

  return (
    <div data-page data-lights="off" data-motif="pass" className="desk-night signup-page h-full overflow-y-auto bg-ground text-ink">
      <div className="signup-shell">
        <header className="signup-header">
          <button type="button" onClick={() => go('/join')} className="font-display text-[30px] leading-none text-ink">BandIt</button>
          <nav aria-label="Wallet" className="signup-nav">
            {label && <button type="button" onClick={() => go(`/register?band=band-${label}`)} className="text-ink-dim hover:text-ink">Your band</button>}
            <button type="button" onClick={() => go('/join')} className="text-ink-dim hover:text-ink">The night</button>
          </nav>
        </header>
        {body}
      </div>
    </div>
  )
}
