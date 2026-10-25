import { useMemo } from 'react'
import { eventCosts, costCenter } from '@/cover/eventCosts'
import { useSettlement } from '@/stdb/settlementOps'
import { formatCents } from '@/cover/money'
import { useCatalog } from '@/stdb/catalog'
import { DeskFrame, Figure, when } from './DeskFrame'

function plain(value: string): string {
  const text = value.replaceAll('_', ' ').trim()
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Event costs from the claim journals and paid merchandise orders. */
export function CostsPage() {
  const claims = useSettlement((s) => s.claims)
  const claimLedger = useSettlement((s) => s.ledger)
  const records = useSettlement((s) => s.extractedRecords)
  const orders = useSettlement((s) => s.orders)
  const templates = useSettlement((s) => s.templates)
  const error = useSettlement((s) => s.error)
  const costs = useMemo(() => eventCosts({ claims: Object.values(claims), ledger: claimLedger, records, orders, templates }), [claims, claimLedger, records, orders, templates])
  const ledger = useCatalog((s) => s.ledger)
  const bills = useCatalog((s) => s.bills)
  const debits = ledger.reduce((sum, line) => sum + line.debitCents, 0)
  const credits = ledger.reduce((sum, line) => sum + line.creditCents, 0)
  const billed = bills.reduce((sum, line) => sum + line.billedCents, 0)
  const covered = bills.reduce((sum, line) => sum + line.coveredCents, 0)
  const empty = ledger.length === 0 && bills.length === 0 && costs.lines.length === 0 && costs.merch.orders === 0

  return (
    <DeskFrame
      motif="costs"
      title="Event operating costs"
      figures={
        <>
          <Figure lead label="Net cost so far" value={formatCents(costs.netCost)} note="after credits and merch earnings" />
          <Figure label="Venue claim costs" value={formatCents(costs.venueClaims)} note="including uncovered property loss" />
          <Figure label="Recovery credits" value={formatCents(costs.total.recoveryCredit)} note="venue share of approved charges" />
          <Figure label="Merch earnings" value={formatCents(costs.merchEarnings)} note="after printing and booth shares" />
        </>
      }
    >
      {error && <p role="alert" className="mb-6 text-[14px] text-rust">{error}</p>}
      {empty ? (
        <p className="text-[15px] text-ink-dim">No claims or paid orders yet.</p>
      ) : (
        <>
          <p className="max-w-[72ch] text-[14px] leading-6 text-ink-dim">Net cost uses booked claim expenses and recovery credits. Payments received and amounts still owed are shown separately below.</p>
          <div className="mt-8 grid gap-10 lg:grid-cols-2">
            <section aria-labelledby="venue-cost-heading">
              <h2 id="venue-cost-heading" className="text-[15px] text-ink">Venue claim costs</h2>
              <dl className="mt-3 divide-y divide-line">
                <Amount label="Deductibles" value={costs.total.deductibles} />
                <Amount label="Insurer receipt adjustments" value={costs.total.shortPaid} />
                <Amount label="Other booked claim expense" value={costs.total.unrecovered} />
                <Amount label="Uncovered property loss" value={costs.uncoveredProperty} />
                <Amount label="Venue claim costs" value={costs.venueClaims} strong />
              </dl>
            </section>
            <section aria-labelledby="merch-earnings-heading">
              <h2 id="merch-earnings-heading" className="text-[15px] text-ink">Merchandise earnings</h2>
              <dl className="mt-3 divide-y divide-line">
                <Amount label={`Paid sales (${costs.merch.orders} ${costs.merch.orders === 1 ? 'order' : 'orders'})`} value={costs.merch.sales} />
                <Amount label="Printing cost" value={costs.merch.print} />
                <Amount label="Owed to sponsor booths" value={costs.merch.owed} />
                <Amount label="Event earnings" value={costs.merchEarnings} strong />
              </dl>
              <a href="/merch" className="mt-3 inline-block text-[13px] text-ink underline underline-offset-4">Product and booth sales</a>
            </section>
          </div>
          <section className="mt-10" aria-labelledby="cash-heading">
            <h2 id="cash-heading" className="text-[15px] text-ink">Payments and amounts owed</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-[14px]">
                <thead className="border-b border-line text-[13px] text-ink-dim"><tr><th className="py-2 font-normal">Source</th><th className="text-right font-normal">Received</th><th className="text-right font-normal">Outstanding</th></tr></thead>
                <tbody className="divide-y divide-line">
                  <tr><th className="py-3 font-normal">Venue insurer</th><Money value={costs.total.insurerPaid} /><Money value={costs.total.insurerOwes} /></tr>
                  <tr><th className="py-3 font-normal">Attendee charges</th><Money value={costs.total.attendeePaid} /><Money value={costs.total.attendeeOwes} /></tr>
                </tbody>
              </table>
            </div>
            <dl className="mt-3 divide-y divide-line">
              <Amount label="Claim payouts recorded" value={costs.total.paid} />
              <Amount label="Claim payouts outstanding" value={costs.total.unpaidPayout} />
            </dl>
          </section>
          {costs.lines.length > 0 && <>
            <section className="mt-10" aria-labelledby="cost-centers-heading">
              <h2 id="cost-centers-heading" className="text-[15px] text-ink">Cost centers</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-[14px]">
                  <thead className="border-b border-line text-[13px] text-ink-dim"><tr>{['Cost center', 'Claims', 'Billed', 'Venue expense', 'Outside venue payout', 'Recovery credits'].map((label, i) => <th key={label} className={`py-2 font-normal ${i ? 'text-right' : ''}`}>{label}</th>)}</tr></thead>
                  <tbody className="divide-y divide-line">{[...costs.centers].map(([name, center]) => <tr key={name}><th className="py-3 font-normal">{plain(name)}</th><td className="text-right font-mono">{center.claims}</td><Money value={center.line.billed} /><Money value={center.line.venueCost} /><Money value={center.line.notCovered} /><Money value={center.line.recoveryCredit} /></tr>)}</tbody>
                </table>
              </div>
            </section>
            <section className="mt-10" aria-labelledby="claim-costs-heading">
              <h2 id="claim-costs-heading" className="text-[15px] text-ink">Claim costs</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[850px] text-left text-[14px]">
                  <thead className="border-b border-line text-[13px] text-ink-dim"><tr>{['Claim', 'Cost center', 'Claimant', 'Billed', 'Payout recorded', 'Insurer received', 'Insurer owes', 'Venue expense', 'Status'].map((label, i) => <th key={label} className={`py-2 pr-4 font-normal ${i >= 3 && i < 8 ? 'text-right' : ''}`}>{label}</th>)}</tr></thead>
                  <tbody className="divide-y divide-line">{costs.lines.map(({ claim, line }) => <tr key={claim.id}><th className="py-3 pr-4 font-normal">#{claim.id}</th><td className="pr-4">{costCenter(claim)}</td><td className="pr-4">{claim.claimantName || 'The venue'}</td><Money value={line.billed} /><Money value={line.paid} /><Money value={line.insurerPaid} /><Money value={line.insurerOwes} /><Money value={line.venueCost} /><td>{plain(claim.status)}</td></tr>)}</tbody>
                </table>
              </div>
            </section>
          </>}
          <section className="mt-10" aria-labelledby="ledger-totals-heading">
            <h2 id="ledger-totals-heading" className="text-[15px] text-ink">Ledger and billed totals</h2>
            <div className="mt-4 grid grid-cols-2 gap-5 md:grid-cols-4">
              <Figure label="Debits" value={formatCents(debits)} note="posted" />
              <Figure label="Credits" value={formatCents(credits)} note={debits === credits ? 'ledger balanced' : `difference ${formatCents(debits - credits)}`} />
              <Figure label="Billed" value={formatCents(billed)} note={`${bills.length} service lines`} />
              <Figure label="Covered" value={formatCents(covered)} note="of those service lines" />
            </div>
          </section>
          {ledger.length > 0 && (
            <section className="mt-10">
              <h2 className="text-[13px] text-ink-dim">Ledger</h2>
              <ul className="mt-3 divide-y divide-line">
                {ledger.map((line) => (
                  <li key={line.id} className="desk-row grid gap-1 py-3 md:grid-cols-[minmax(7.5rem,12rem)_minmax(0,1fr)_7rem_7rem] md:items-baseline">
                    <span className="text-[13px] leading-5 text-ink-dim">{plain(line.journal) || 'Entry'}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] text-ink">{plain(line.account) || line.memo || `Claim ${line.claimId}`}</span>
                      <span className="mt-1 block truncate text-[13px] text-ink-muted">{[line.memo, when(line.postedAt)].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="font-mono text-[13px] text-ink">{line.debitCents ? formatCents(line.debitCents) : ''}</span>
                    <span className="font-mono text-[13px] text-ink-dim">{line.creditCents ? formatCents(line.creditCents) : ''}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {bills.length > 0 && (
            <section className="mt-12">
              <h2 className="text-[13px] text-ink-dim">Billed lines</h2>
              <ul className="mt-3 divide-y divide-line">
                {bills.map((line) => (
                  <li key={line.id} className="desk-row grid gap-1 py-3 md:grid-cols-[minmax(0,1fr)_7rem_7rem_6rem]">
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] text-ink">{plain(line.description) || `Claim ${line.claimId}`}</span>
                      <span className="mt-1 block text-[13px] text-ink-muted">Claim {line.claimId}</span>
                    </span>
                    <span className="font-mono text-[13px] text-ink">{formatCents(line.billedCents)}</span>
                    <span className="font-mono text-[13px] text-ink-dim">{formatCents(line.coveredCents)}</span>
                    <span className="text-[13px] text-ink-muted">{plain(line.outcome)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </DeskFrame>
  )
}

function Amount({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return <div className={`flex justify-between gap-4 py-3 text-[14px] ${strong ? 'font-medium text-ink' : 'text-ink-dim'}`}><dt>{label}</dt><dd className="font-mono tabular-nums text-ink">{formatCents(value)}</dd></div>
}

function Money({ value }: { value: number }) {
  return <td className="py-3 pr-4 text-right font-mono text-[13px] tabular-nums">{formatCents(value)}</td>
}
