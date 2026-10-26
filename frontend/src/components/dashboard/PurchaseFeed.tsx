import { formatCents } from '@/cover/money'
import { useRoute } from '@/cover/route'
import { useFloorShop } from '@/payments/floorShop'
import { useWorld } from '@/stores/world'

const STATUS: Record<string, string> = {
  paying: 'paying',
  paid: 'paid',
  failed: 'didn’t go through',
}

/** Purchases the people on the floor just made, newest first. */
export function PurchaseFeed() {
  const venueId = useWorld((s) => s.venue?.venueId)
  const orders = useFloorShop((s) => s.orders)
  const { go } = useRoute()
  if (venueId !== 'calhacks' || orders.length === 0) return null
  const recent = orders.slice(-5).reverse()
  const paid = orders.filter((order) => order.status === 'paid')
  const taken = paid.reduce((sum, order) => sum + order.amountCents, 0)
  const latest = recent[0]
  return (
    <aside className="pointer-events-auto w-[17.5rem] max-w-full rounded-[4px] bg-[rgba(14,14,16,0.9)] px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[12px] text-ink-muted">Payments</h2>
        <span className="tabular-nums text-[12px] text-ink-dim">{formatCents(taken)} paid</span>
      </div>
      <ul className="mt-1.5">
        {recent.map((order) => (
          <li key={order.id} className="flex items-baseline justify-between gap-3 py-1 text-[13px]">
            <span className="min-w-0 truncate text-ink">
              {order.attendeeName}
              <span className="text-ink-dim"> · {order.title}</span>
            </span>
            <span className="flex-none tabular-nums text-ink">{formatCents(order.amountCents)}</span>
          </li>
        ))}
      </ul>
      {latest && (
        <p className="sr-only" aria-live="polite">
          {latest.attendeeName} {STATUS[latest.status] ?? latest.status} {formatCents(latest.amountCents)} for {latest.title}.
        </p>
      )}
      <button type="button" onClick={() => go('/payments')} className="mt-1 text-[12px] text-ink-dim hover:text-ink">
        Open payments
      </button>
    </aside>
  )
}
