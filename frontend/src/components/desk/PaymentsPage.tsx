import { useMemo, useState, type KeyboardEvent } from 'react'
import { Search } from 'lucide-react'
import { SourceChip } from '@/components/dashboard/SourceChip'
import { CopyId, Pending, StatusPill } from '@/components/payments/bits'
import { NightChart } from '@/components/payments/NightChart'
import { formatCents } from '@/cover/money'
import { cn } from '@/lib/utils'
import {
  applyFilter, bandLabel, binsOf, boothRanking, clock, deskPayments, figuresOf, filterCounts, MISSING, pinnedWallet, searchPayments,
  STATUS_LABEL, STATUS_ORDER, type Filter, type Payment, type PinnedWallet,
} from '@/payments/model'
import { useFloorShop } from '@/payments/floorShop'
import { useDeskData, usePaymentsFixture } from '@/payments/live'
import type { DeskData } from '@/payments/rows'
import { DESK_VIEWS } from '@/payments/store'
import { useSession } from '@/stdb/session'
import { DeskFrame, Figure } from './DeskFrame'
import { BuyForBand, PaymentSheet } from './PaymentSheet'

type BlockState = 'ready' | 'loading' | 'refused' | 'error'

const PAGE = 100
const NEEDS_CAP = 4

function useBlockStates(fixture: boolean, floorOrders: number): { payments: BlockState; wallets: BlockState; partial: string } {
  const phase = useSession((s) => s.phase)
  const requested = useSession((s) => s.staffRequested)
  const queries = useSession((s) => s.staffQueries)
  if (fixture) return { payments: 'ready', wallets: 'ready', partial: '' }
  if (phase === 'error') return { payments: 'error', wallets: 'error', partial: '' }
  if (phase !== 'live') return { payments: 'loading', wallets: 'loading', partial: '' }
  if (!requested) return { payments: 'refused', wallets: 'refused', partial: '' }
  const of = (query: string): BlockState => (queries[query] === 'open' ? 'ready' : queries[query] === 'refused' ? 'refused' : 'loading')
  const charges = of(DESK_VIEWS.charges)
  const orders = of(DESK_VIEWS.orders)
  const host: BlockState = charges === 'refused' && orders === 'refused' ? 'refused' : charges === 'loading' || orders === 'loading' ? 'loading' : 'ready'
  const payments: BlockState = host === 'ready' || floorOrders > 0 ? 'ready' : host
  const partial = payments === 'ready' && charges === 'refused' ? 'Charges aren’t visible to this sign-in.' : payments === 'ready' && orders === 'refused' ? 'Merch orders aren’t visible to this sign-in.' : ''
  return { payments, wallets: of(DESK_VIEWS.wallets), partial }
}

function BlockNote({ state, empty }: { state: BlockState; empty: string }) {
  const error = useSession((s) => s.error)
  const staffError = useSession((s) => s.staffError)
  if (state === 'loading') return <p role="status" className="py-3 text-[13px] text-ink-dim">Loading payments…</p>
  if (state === 'refused') return <p className="py-3 text-[13px] text-ink-dim">This sign-in can’t see payments.{staffError ? ` ${staffError}` : ''}</p>
  if (state === 'error') return <p className="py-3 text-[13px] text-ink-dim">Couldn’t reach the host.{error ? ` ${error}` : ''}</p>
  return <p className="py-3 text-[13px] text-ink-dim">{empty}</p>
}

function SectionHead({ title, aside, sim, id }: { title: string; aside?: string; sim: boolean; id: string }) {
  return (
    <div className="flex min-h-6 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 id={id} className="flex items-center gap-2 text-[14px] font-medium text-ink">{title}{sim && <SourceChip tag="sim" />}</h2>
      {aside && <span className="text-[12px] text-ink-muted">{aside}</span>}
    </div>
  )
}

function Who({ payment }: { payment: Payment }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="flex-none tabular-nums text-ink">{bandLabel(payment.bandId)}</span>
      <span className={cn('truncate', payment.attendeeName ? 'text-ink-dim' : 'text-ink-muted')}>{payment.attendeeName || MISSING}</span>
    </span>
  )
}

function openOnEnter(open: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open()
    }
  }
}

function NeedsYou({ rows, state, sim, onOpen }: { rows: Payment[]; state: BlockState; sim: boolean; onOpen: (id: string) => void }) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, NEEDS_CAP)
  return (
    <section aria-labelledby="needs-you">
      <SectionHead id="needs-you" title={state === 'ready' ? `Needs you · ${rows.length}` : 'Needs you'} aside="Charges to decide, disputes and failed payments, oldest first" sim={sim} />
      {state !== 'ready' || !rows.length ? (
        <BlockNote state={state} empty="No payments need review." />
      ) : (
        <ul className="mt-2">
          {shown.map((payment) => (
            <li key={payment.id} className="desk-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-3 lg:h-12 lg:grid-cols-[9.5rem_6.5rem_minmax(0,1fr)_minmax(0,14rem)_3.5rem_7.5rem] lg:py-0">
              <span className="col-start-1 row-start-1 truncate text-[14px] text-ink lg:col-start-3">
                {payment.what}{payment.status === 'failed' && payment.failure && <span className="text-ink-dim"> · {payment.failure}</span>}
              </span>
              <span className="col-start-2 row-start-1 text-right tabular-nums text-[14px] text-ink">{formatCents(payment.amountCents)}</span>
              <span className="col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px] lg:contents">
                <span className="lg:col-start-1 lg:row-start-1"><StatusPill status={payment.status} label={payment.label} /></span>
                <span className="min-w-0 lg:col-start-4 lg:row-start-1 lg:text-[14px]"><Who payment={payment} /></span>
                <span className="tabular-nums text-ink-dim lg:col-start-5 lg:row-start-1 lg:text-right">{clock(payment.createdAt)}</span>
              </span>
              <span className="col-start-2 row-start-2 flex justify-end lg:col-start-6 lg:row-start-1">
                <button type="button" onClick={() => onOpen(payment.id)} className="h-11 whitespace-nowrap rounded-[4px] border border-line-strong px-3 text-[13px] text-ink hover:bg-ink/[0.05] lg:h-8">
                  {payment.status === 'decision' ? 'Review charge' : payment.status === 'disputed' ? 'Review dispute' : 'See why'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > NEEDS_CAP && (
        <button type="button" onClick={() => setAll((value) => !value)} className="mt-1 h-9 text-[13px] text-ink-dim hover:text-ink">
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  )
}

function Booths({ payments, state, sim }: { payments: Payment[]; state: BlockState; sim: boolean }) {
  const ranking = boothRanking(payments)
  const shown = ranking.slice(0, 4)
  const rest = ranking.slice(4)
  const total = ranking.reduce((sum, booth) => sum + booth.cents, 0)
  const top = shown[0]?.cents || 1
  return (
    <section aria-labelledby="by-booth" className="min-w-0">
      <SectionHead id="by-booth" title="Where it came in" aside={state === 'ready' && ranking.length ? `${formatCents(total)} paid merch` : undefined} sim={sim} />
      {state !== 'ready' || !ranking.length ? (
        <BlockNote state={state} empty="No paid merch orders." />
      ) : (
        <ol className="mt-2">
          {shown.map((booth, index) => (
            <li key={booth.booth} className="border-t border-line py-2">
              <div className="flex items-baseline justify-between gap-3 text-[14px]">
                <span className="truncate text-ink">{booth.booth}</span>
                <span className="flex-none tabular-nums text-ink">{formatCents(booth.cents)}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <span aria-hidden className={cn('h-[2px] rounded-full', index === 0 ? 'bg-ink' : 'bg-ink-muted/60')} style={{ width: `${Math.max(2, (booth.cents / top) * 78)}%` }} />
                <span className="flex-none text-[12px] tabular-nums text-ink-muted">{booth.count} sold</span>
              </div>
            </li>
          ))}
          {rest.length > 0 && (
            <li className="flex items-baseline justify-between gap-3 border-t border-line py-2 text-[13px] text-ink-dim">
              <span>{rest.length} more {rest.length === 1 ? 'booth' : 'booths'}</span>
              <span className="tabular-nums">{formatCents(rest.reduce((sum, booth) => sum + booth.cents, 0))}</span>
            </li>
          )}
        </ol>
      )}
    </section>
  )
}

function WalletCard({ pinned, desk, payments, sim }: { pinned: PinnedWallet; desk: DeskData; payments: Payment[]; sim: boolean }) {
  const band = bandLabel(pinned.bandId)
  const paid = payments.filter((payment) => payment.bandId === pinned.bandId && payment.status === 'paid').reduce((sum, payment) => sum + payment.amountCents, 0)
  const picks = desk.picks.filter((pick) => pick.nodeId && pick.nodeId === pinned.nodeId).sort((a, b) => a.rank - b.rank).slice(0, 3)
  if (!pinned.nodeId) {
    return <div className="mt-3 rounded-[6px] bg-panel px-4 py-3 text-[13px] text-ink-dim">No one is registered to {band.toLowerCase()}.</div>
  }
  return (
    <div aria-label={`${band} wallet`} className="desk-card mt-3 grid gap-x-8 gap-y-4 px-4 py-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[13px] text-ink-dim">{band} wallet{sim && <SourceChip tag="sim" />}</p>
        {pinned.wallet ? (
          <>
            <p className="mt-1 text-[24px] leading-tight tabular-nums text-ink">{formatCents(pinned.wallet.balanceCents)}</p>
            <p className="mt-1 truncate text-[13px] text-ink-dim">{pinned.name} · {formatCents(paid)} paid</p>
            <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-muted">Account <CopyId value={pinned.wallet.accountId} label="Account id" /></div>
          </>
        ) : (
          <p className="mt-1 text-[14px] text-ink-dim">{pinned.name} has no wallet open yet.</p>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-[13px] text-ink-dim">The shopping agent’s picks for {pinned.name.split(' ')[0] || band}</p>
        {picks.length ? (
          <ul className="mt-1">
            {picks.map((pick) => <BuyForBand key={pick.key} pick={pick} nodeId={pinned.nodeId} band={band} disabled={!pinned.wallet} />)}
          </ul>
        ) : (
          <p className="mt-1 text-[13px] text-ink-muted">No picks for this band yet.</p>
        )}
      </div>
    </div>
  )
}

function PaymentsTable({ payments, desk, state, partial, sim, onOpen, openId }: {
  payments: Payment[]; desk: DeskData; state: BlockState; partial: string; sim: boolean; onOpen: (id: string) => void; openId: string | null
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const searched = useMemo(() => searchPayments(payments, query), [payments, query])
  const counts = filterCounts(searched)
  const rows = applyFilter(searched, filter)
  const shown = rows.slice(0, limit)
  const pinned = pinnedWallet(desk, query)
  const filters: Filter[] = ['all', ...STATUS_ORDER, ...(counts.other ? (['other'] as const) : [])]
  const labelOf = (item: Filter) => (item === 'all' ? 'All' : item === 'other' ? 'Other' : STATUS_LABEL[item])
  const choose = (item: Filter) => {
    setFilter(item)
    setLimit(PAGE)
  }

  return (
    <section aria-labelledby="payments-table">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h2 id="payments-table" className="flex items-center gap-2 text-[14px] font-medium text-ink">
          Payments{state === 'ready' && <span className="font-normal tabular-nums text-ink-muted">{payments.length}</span>}{sim && <SourceChip tag="sim" />}
        </h2>
        <label className="relative flex h-9 w-full items-center sm:w-[19rem]">
          <span className="sr-only">Search by name, band number or reference</span>
          <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 text-ink-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setLimit(PAGE) }}
            placeholder="Name, band number or reference"
            autoComplete="off"
            className="h-9 w-full rounded-[4px] border border-line-strong bg-panel pl-9 pr-3 text-[14px] text-ink outline-none placeholder:text-ink-muted focus-visible:border-champagne"
          />
        </label>
      </div>
      {pinned && <WalletCard pinned={pinned} desk={desk} payments={payments} sim={sim} />}
      {partial && <p className="mt-2 text-[13px] text-ink-dim">{partial}</p>}
      <div role="group" aria-label="Filter by status" className="nc-scroll mt-3 flex gap-5 overflow-x-auto border-b border-line">
        {filters.map((item) => {
          const on = filter === item
          return (
            <button key={item} type="button" aria-pressed={on} onClick={() => choose(item)} className="relative flex h-9 flex-none items-center gap-1.5 text-[13px]">
              <span className={on ? 'text-ink' : 'text-ink-muted hover:text-ink'}>{labelOf(item)}</span>
              <span className="tabular-nums text-ink-muted">{state === 'ready' ? counts[item] : MISSING}</span>
              {on && <span aria-hidden className="absolute bottom-0 left-0 right-0 h-px bg-champagne" />}
            </button>
          )
        })}
      </div>
      {state !== 'ready' ? (
        <BlockNote state={state} empty="" />
      ) : (
        <table className="block w-full border-collapse text-[14px] lg:table lg:table-fixed">
          <thead className="hidden lg:table-header-group">
            <tr className="text-left text-[12px] text-ink-muted">
              <th scope="col" className="h-9 w-[7.5rem] pr-8 text-right font-normal">Amount</th>
              <th scope="col" className="w-[9rem] font-normal">Status</th>
              <th scope="col" className="font-normal">What</th>
              <th scope="col" className="w-[13rem] font-normal">Who</th>
              <th scope="col" className="hidden w-[10rem] font-normal xl:table-cell">Booth or zone</th>
              <th scope="col" className="w-[4.5rem] pr-6 text-right font-normal">When</th>
              <th scope="col" className="w-[8.5rem] font-normal">Reference</th>
            </tr>
          </thead>
          <tbody className="block lg:table-row-group">
            {shown.map((payment) => (
              <tr
                key={payment.id}
                tabIndex={0}
                aria-label={`${payment.what}, ${formatCents(payment.amountCents)}, ${payment.label}, ${bandLabel(payment.bandId)}`}
                onClick={() => onOpen(payment.id)}
                onKeyDown={openOnEnter(() => onOpen(payment.id))}
                data-open={openId === payment.id ? '' : undefined}
                className={cn(
                  'desk-row flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1.5 py-3 focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-champagne lg:table-row lg:py-0',
                  openId === payment.id && 'bg-ink/[0.05]',
                )}
              >
                <td className="order-2 w-[6.5rem] text-right tabular-nums text-ink lg:order-none lg:h-11 lg:w-auto lg:pr-8">{formatCents(payment.amountCents)}</td>
                <td className="order-3 lg:order-none"><StatusPill status={payment.status} label={payment.label} /></td>
                <td className="order-1 min-w-0 flex-1 basis-[calc(100%-7.5rem)] truncate text-ink lg:order-none lg:pr-4">
                  {payment.what}{payment.where && <span className="text-ink-muted xl:hidden"> · {payment.where}</span>}
                </td>
                <td className="order-4 min-w-0 max-w-[62%] text-[13px] lg:order-none lg:max-w-none lg:pr-4 lg:text-[14px]"><Who payment={payment} /></td>
                <td className={cn('hidden truncate xl:table-cell xl:pr-4', payment.where ? 'text-ink-dim' : 'text-ink-muted')}>{payment.where || MISSING}</td>
                <td className="order-5 text-[13px] tabular-nums text-ink-dim lg:order-none lg:pr-6 lg:text-right">{clock(payment.createdAt)}</td>
                <td className="hidden lg:table-cell"><CopyId value={payment.reference} label="Reference" /></td>
              </tr>
            ))}
            {!shown.length && (
              <tr className="block border-t border-line lg:table-row">
                <td colSpan={7} className="block py-3 text-[13px] text-ink-dim lg:table-cell">
                  {query ? `No payments match “${query.trim()}”${filter === 'all' ? '' : ` under ${labelOf(filter).toLowerCase()}`}.` : filter === 'all' ? 'No payments yet.' : 'No payments in this view.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {state === 'ready' && rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-[13px] text-ink-dim">
          <span className="tabular-nums">Showing 1–{shown.length} of {rows.length}</span>
          {rows.length > shown.length && (
            <button type="button" onClick={() => setLimit((value) => value + PAGE)} className="h-9 rounded-[4px] border border-line-strong px-3 text-ink hover:bg-ink/[0.05]">
              Show {Math.min(PAGE, rows.length - shown.length)} more
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/** Payments: every merch order and charge through the bands tonight, and what needs a person. */
export function PaymentsPage() {
  const fixture = usePaymentsFixture()
  const desk = useDeskData()
  const floorOrders = useFloorShop((s) => s.orders.length)
  const states = useBlockStates(fixture, floorOrders)
  const [openId, setOpenId] = useState<string | null>(null)
  const payments = useMemo(() => deskPayments(desk), [desk])
  const figures = figuresOf(payments, desk.wallets)
  const bins = useMemo(() => binsOf(payments, desk.night), [payments, desk.night])
  const needs = payments.filter((payment) => payment.status === 'decision' || payment.status === 'disputed' || payment.status === 'failed').sort((a, b) => a.createdAt - b.createdAt)
  const open = openId ? payments.find((payment) => payment.id === openId) ?? null : null
  const ready = states.payments === 'ready'
  const registered = desk.people.filter((person) => person.bandId != null).length
  const chip = fixture ? <SourceChip tag="sim" /> : undefined
  const value = (text: string, state: BlockState = states.payments) => (state === 'ready' ? text : state === 'loading' ? <Pending /> : <span className="text-ink-muted">{MISSING}</span>)

  return (
    <DeskFrame
      motif="payments"
      figures={
        <>
          <Figure lead label="Through the bands" chip={chip} value={value(formatCents(figures.throughCents))}
            note={ready ? `${figures.paidCount} paid · ${figures.refundCents ? `${formatCents(figures.refundCents)} refunded` : 'no refunds'}` : 'paid merch and charges'} />
          <Figure label="Needs a decision" chip={chip} value={value(String(figures.decisionCount))}
            note={ready ? `${figures.decisionCount === 1 ? 'charge' : 'charges'} waiting${figures.disputedCount ? ` · ${figures.disputedCount} disputed` : ''}` : 'charges'} />
          <Figure label="Failed" chip={chip} value={value(String(figures.failedCount))}
            note={ready ? (figures.failedCount ? `${formatCents(figures.failedCents)} didn’t go through` : 'Nothing failed') : 'payments'} />
          <Figure label="Wallets open" chip={chip} value={value(String(figures.walletsOpen), states.wallets)}
            note={states.wallets === 'ready' ? `of ${registered} registered attendees` : 'attendee accounts'} />
        </>
      }
    >
      <div className="grid grid-cols-1 gap-9">
        <NeedsYou rows={needs} state={states.payments} sim={fixture} onOpen={setOpenId} />
        <div className="grid grid-cols-1 gap-x-10 gap-y-9 lg:grid-cols-3">
          <section aria-labelledby="over-the-night" className="min-w-0 lg:col-span-2">
            <SectionHead id="over-the-night" title="Payments over time" aside="Paid, per 15 minutes" sim={fixture} />
            <div className="mt-2">{ready ? <NightChart bins={bins} /> : <BlockNote state={states.payments} empty="" />}</div>
          </section>
          <Booths payments={payments} state={states.payments} sim={fixture} />
        </div>
        <PaymentsTable payments={payments} desk={desk} state={states.payments} partial={states.partial} sim={fixture} onOpen={setOpenId} openId={openId} />
      </div>
      <PaymentSheet payment={open} desk={desk} sim={fixture} onClose={() => setOpenId(null)} />
    </DeskFrame>
  )
}
