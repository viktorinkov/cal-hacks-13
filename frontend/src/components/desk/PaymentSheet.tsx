import { useState, type FormEvent, type ReactNode } from 'react'
import { SourceChip } from '@/components/dashboard/SourceChip'
import { useAction } from '@/components/payments/action'
import { CopyId, StatusPill } from '@/components/payments/bits'
import { MerchThumb } from '@/components/payments/MerchThumb'
import { Sheet, Timeline } from '@/components/payments/Sheet'
import { formatCents } from '@/cover/money'
import { useRoute } from '@/cover/route'
import { cn } from '@/lib/utils'
import { bandLabel, chargeTimeline, clock, merchTimeline, MISSING, needsSize, plain, SIZES, type Payment, type Step } from '@/payments/model'
import { usePaymentActions } from '@/payments/live'
import type { Charge, DeskData, MerchOrder, MerchPick } from '@/payments/rows'

const PRIMARY = 'h-10 rounded-[4px] bg-champagne px-4 text-[14px] font-medium text-ground hover:bg-champagne-hover disabled:cursor-not-allowed disabled:opacity-60'
const QUIET = 'h-10 rounded-[4px] border border-line-strong px-4 text-[14px] text-ink hover:bg-ink/[0.05] disabled:cursor-not-allowed disabled:opacity-60'
const FIELD = 'rounded-[4px] border border-line-strong bg-raised text-[14px] text-ink outline-none focus-visible:border-champagne'

function steps(list: Step[]) {
  return list.map((step) => ({ ...step, at: clock(step.at), warn: step.key === 'failed' || (step.key === 'checks' && step.state === 'stopped') }))
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[8rem_minmax(0,1fr)] text-[14px]">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="border-t border-line py-2 pr-4 text-ink-dim">{term}</dt>
          <dd className={cn('min-w-0 border-t border-line py-2', value === MISSING ? 'text-ink-muted' : 'text-ink')}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7 first:mt-0">
      <h3 className="mb-2 text-[12px] text-ink-muted">{title}</h3>
      {children}
    </section>
  )
}

/** Approve sends exactly the amount and pack hash this sheet showed; if the host refuses, the reason stays here. */
function ChargeDecision({ charge, band }: { charge: Charge; band: string }) {
  const actions = usePaymentActions()
  const { busy, error, run } = useAction()
  const [seen, setSeen] = useState(() => ({ amount: charge.amountCents, hash: charge.packHash }))
  const [waiving, setWaiving] = useState(false)
  const [reason, setReason] = useState('')
  const [missing, setMissing] = useState(false)
  const changed = charge.amountCents !== seen.amount || charge.packHash !== seen.hash

  const approve = () => run('approve', () => actions.approveCharge(charge.id, seen.amount, seen.hash), {
    success: `Approved ${formatCents(seen.amount)} for ${band}`,
    failure: 'The charge wasn’t approved',
  })
  const waive = (event: FormEvent) => {
    event.preventDefault()
    if (!reason.trim()) {
      setMissing(true)
      return
    }
    setMissing(false)
    void run('waive', () => actions.waiveCharge(charge.id, reason), { success: `Waived the charge on ${band}`, failure: 'The charge wasn’t waived' })
  }

  return (
    <div>
      {(error || changed) && (
        <div role="alert" className="mb-3 rounded-[4px] bg-caution/10 px-3 py-2 text-[13px] text-ink">
          {error && <p>{error.message}</p>}
          {changed && (
            <p className={cn(error && 'mt-1')}>
              It’s now <span className="tabular-nums">{formatCents(charge.amountCents)}</span>, not <span className="tabular-nums">{formatCents(seen.amount)}</span>.{' '}
              <button type="button" onClick={() => setSeen({ amount: charge.amountCents, hash: charge.packHash })} className="text-champagne underline underline-offset-2">
                Review the new amount
              </button>
            </p>
          )}
        </div>
      )}
      {waiving ? (
        <form onSubmit={waive} noValidate>
          <label htmlFor="waive-reason" className="text-[13px] text-ink-dim">Why it’s waived</label>
          <textarea
            id="waive-reason"
            value={reason}
            onChange={(event) => { setReason(event.target.value); setMissing(false) }}
            rows={3}
            aria-invalid={missing}
            aria-describedby={missing ? 'waive-missing' : undefined}
            className={cn(FIELD, 'mt-1.5 block w-full resize-none px-3 py-2')}
          />
          {missing && <p id="waive-missing" className="mt-1.5 text-[13px] text-caution">Write why the charge is waived.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="submit" disabled={busy != null} className={QUIET}>{busy === 'waive' ? 'Waiving…' : 'Waive charge'}</button>
            <button type="button" disabled={busy != null} onClick={() => setWaiving(false)} className="h-10 px-3 text-[14px] text-ink-dim hover:text-ink">Back</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy != null} onClick={() => void approve()} className={PRIMARY}>
            {busy === 'approve' ? 'Approving…' : <>Approve <span className="tabular-nums">{formatCents(seen.amount)}</span></>}
          </button>
          <button type="button" disabled={busy != null} onClick={() => setWaiving(true)} className={QUIET}>Waive…</button>
          <span className="text-[12px] text-ink-muted">Paid from {band}’s wallet · Nessie sandbox</span>
        </div>
      )}
    </div>
  )
}

function ChargeDetail({ payment, charge, desk }: { payment: Payment; charge: Charge; desk: DeskData }) {
  const { go } = useRoute()
  const caps = new Map(desk.fees.map((fee) => [fee.code, fee.capCents]))
  const fees = charge.clauseIds.map((id) => desk.fees.find((fee) => fee.code === id)).filter((fee) => fee != null)
  const incident = desk.incidents.find((item) => item.id === charge.incidentId)
  const hasClaim = charge.claimId !== '' && charge.claimId !== '0'
  return (
    <>
      <Block title="What happened">
        <Facts rows={[
          ['Incident', incident ? `${plain(incident.kind)} · #${incident.id}` : `#${charge.incidentId}`],
          ['Zone', incident?.zoneName || MISSING],
          ['Named by', [charge.namedByName, charge.namedByRole].filter(Boolean).join(', ') || MISSING],
          ...fees.map((fee): [string, ReactNode] => [fee.code, (
            <span key={fee.code} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-ink-dim">{fee.description}</span>
              <span className="tabular-nums">cap {formatCents(fee.capCents)}</span>
            </span>
          )]),
        ]} />
        {fees.length > 0 && charge.amountCents > Math.max(...fees.map((fee) => fee.capCents)) && (
          <p className="mt-2 text-[13px] text-caution">The charge is above every cap it cites.</p>
        )}
      </Block>
      <Block title="Timeline">
        <Timeline steps={steps(chargeTimeline(charge, payment.status, caps))} />
      </Block>
      {hasClaim && (
        <Block title="Claim">
          <p className="text-[14px] text-ink-dim">
            This charge is part of claim {charge.claimId}. The insurer’s share is settled there.{' '}
            <button type="button" onClick={() => go('/claims')} className="text-champagne underline underline-offset-2">Open Settlements</button>
          </p>
        </Block>
      )}
    </>
  )
}

function OrderDetail({ payment, order, desk }: { payment: Payment; order: MerchOrder; desk: DeskData }) {
  const template = desk.templates.find((item) => item.id === order.templateId)
  return (
    <>
      <Block title="The piece">
        <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-4">
          <MerchThumb kind={template?.kind ?? ''} title={payment.what} imageUrl={template?.imageUrl ?? ''} photoUrl={order.photoUrl} area={template?.area ?? { width: 0, height: 0, x: 0, y: 0, w: 0, h: 0 }} />
          <Facts rows={[
            ['Booth', payment.where || MISSING],
            ['Size', order.size || MISSING],
            ['Photo', order.photoId ? `#${order.photoId}` : MISSING],
          ]} />
        </div>
      </Block>
      {payment.status === 'failed' && (
        <Block title="Why it failed">
          <div className="rounded-[4px] bg-caution/10 px-3 py-2.5 text-[14px] text-ink">
            <p>{payment.failure}</p>
            <p className="mt-1 text-[13px] text-ink-dim">The desk can’t retry a merch payment. The attendee can buy it again from their wallet.</p>
          </div>
        </Block>
      )}
      <Block title="Timeline">
        <Timeline steps={steps(merchTimeline(order, payment.status))} />
      </Block>
    </>
  )
}

function Detail({ payment, desk, sim }: { payment: Payment; desk: DeskData; sim: boolean }) {
  const charge = payment.source === 'charge' ? desk.charges.find((item) => item.id === payment.rowId) : undefined
  const order = payment.source === 'merch' ? desk.orders.find((item) => item.id === payment.rowId) : undefined
  const wallet = payment.nodeId ? desk.wallets.find((item) => item.nodeId === payment.nodeId) : undefined
  const band = bandLabel(payment.bandId)
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[28px] leading-none tabular-nums text-ink">{formatCents(payment.amountCents)}</p>
        <StatusPill status={payment.status} label={payment.label} />
        {sim && <SourceChip tag="sim" />}
      </div>
      <p className="mt-2 text-[13px] text-ink-dim">
        {payment.source === 'charge' ? 'Named' : 'Ordered'} at <span className="tabular-nums">{clock(payment.createdAt)}</span>
        {payment.settledAt ? <> · settled at <span className="tabular-nums">{clock(payment.settledAt)}</span></> : null}
      </p>
      <Block title="Attendee">
        <Facts rows={[
          ['Band', <span key="band" className="tabular-nums">{band}</span>],
          ['Name', payment.attendeeName || MISSING],
          ['Wallet', wallet ? <span key="wallet" className="tabular-nums">{formatCents(wallet.balanceCents)}</span> : 'No wallet open'],
          ['Account', wallet ? <CopyId key="account" value={wallet.accountId} label="Account id" chars={10} /> : MISSING],
          ['Reference', <CopyId key="reference" value={payment.reference} label="Reference" chars={12} />],
        ]} />
      </Block>
      {charge && <ChargeDetail payment={payment} charge={charge} desk={desk} />}
      {order && <OrderDetail payment={payment} order={order} desk={desk} />}
      {!charge && !order && <p className="mt-6 text-[13px] text-ink-dim">This row has left the desk.</p>}
    </>
  )
}

export function PaymentSheet({ payment, desk, sim, onClose }: { payment: Payment | null; desk: DeskData; sim: boolean; onClose: () => void }) {
  const [last, setLast] = useState<Payment | null>(payment)
  if (payment && payment !== last) setLast(payment)
  const shown = payment ?? last
  if (!shown) return null
  const charge = shown.source === 'charge' ? desk.charges.find((item) => item.id === shown.rowId) : undefined
  const deciding = charge && (shown.status === 'decision' || shown.status === 'disputed')
  const band = bandLabel(shown.bandId)
  return (
    <Sheet
      open={Boolean(payment)}
      onClose={onClose}
      title={shown.what}
      description={`${band}${shown.attendeeName ? ` · ${shown.attendeeName}` : ''}`}
      footer={deciding ? <ChargeDecision key={charge.id} charge={charge} band={band} /> : undefined}
    >
      <Detail key={shown.id} payment={shown} desk={desk} sim={sim} />
    </Sheet>
  )
}

/** One of the agent's picks, bought for this band at the desk. Apparel needs a size first. */
export function BuyForBand({ pick, nodeId, band, disabled }: { pick: MerchPick; nodeId: string; band: string; disabled: boolean }) {
  const actions = usePaymentActions()
  const { busy, error, run } = useAction()
  const [confirming, setConfirming] = useState(false)
  const [size, setSize] = useState('')
  const sized = needsSize(pick.kind, pick.title)
  const buy = async () => {
    const ok = await run('buy', () => actions.buyMerchAs(nodeId, pick.templateId, pick.photoId, sized ? size : ''), {
      success: `${pick.title} ordered for ${band}`,
      failure: 'The order wasn’t placed',
    })
    if (ok) setConfirming(false)
  }
  return (
    <li className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-line py-2 first:border-t-0">
      <MerchThumb kind={pick.kind} title={pick.title} imageUrl={pick.imageUrl} photoUrl={pick.photoUrl} area={pick.area} decorative />
      <div className="min-w-0">
        <p className="truncate text-[14px] text-ink">{pick.title} <span className="tabular-nums text-ink-dim">{formatCents(pick.priceCents)}</span></p>
        <p className="truncate text-[12px] text-ink-muted">{pick.reason || pick.line || 'Picked from tonight’s photos'}</p>
        {error && <p className="mt-0.5 text-[12px] text-caution">{error.message}</p>}
      </div>
      {confirming ? (
        <div className="col-span-3 flex flex-wrap items-center gap-2 pl-[3.75rem]">
          {sized && (
            <label className="flex items-center gap-2 text-[13px] text-ink-dim">
              Size
              <select value={size} onChange={(event) => setSize(event.target.value)} className={cn(FIELD, 'h-9 px-2')}>
                <option value="">Choose</option>
                {SIZES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          )}
          <button type="button" disabled={busy != null || (sized && !size)} onClick={() => void buy()} className="h-9 rounded-[4px] bg-champagne px-3 text-[13px] font-medium text-ground hover:bg-champagne-hover disabled:cursor-not-allowed disabled:opacity-60">
            {busy ? 'Ordering…' : <>Charge {band} <span className="tabular-nums">{formatCents(pick.priceCents)}</span></>}
          </button>
          <button type="button" disabled={busy != null} onClick={() => setConfirming(false)} className="h-9 px-2 text-[13px] text-ink-dim hover:text-ink">Cancel</button>
        </div>
      ) : (
        <button type="button" disabled={disabled} onClick={() => setConfirming(true)} className="h-8 whitespace-nowrap rounded-[4px] border border-line-strong px-3 text-[13px] text-ink hover:bg-ink/[0.05] disabled:opacity-50">
          Buy for {band}
        </button>
      )}
    </li>
  )
}
