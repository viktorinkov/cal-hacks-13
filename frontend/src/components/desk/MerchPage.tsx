import { formatCents } from '@/cover/money'
import { useCatalog } from '@/stdb/catalog'
import { useSession } from '@/stdb/session'
import { DeskFrame, Figure, when } from './DeskFrame'
import { MerchExtras } from './MerchExtras'

/** The merch case: pieces for sale, and the orders this desk can see. */
export function MerchPage() {
  const merch = useCatalog((s) => s.merch)
  const orders = useCatalog((s) => s.orders)
  const ops = useSession((s) => s.owner || s.roles.includes('ops'))
  const name = new Map(merch.map((piece) => [piece.id, piece.title || piece.name]))
  const sold = orders.reduce((sum, order) => sum + order.amountCents, 0)

  return (
    <DeskFrame
      title={merch.length ? `${merch.length} pieces in the case.` : 'The merch case is empty.'}
      sentence="What the event is selling, with the price kept in cents. Orders shown here are the ones this sign-in can see."
      figures={
        <>
          <Figure lead label="Pieces" value={String(merch.length)} note="in the case" />
          <Figure label="Orders" value={String(orders.length)} note="visible to this desk" />
          <Figure label="Taken" value={formatCents(sold)} note="across those orders" />
          <Figure label="Waiting" value={String(orders.filter((order) => order.status && order.status !== 'paid' && order.status !== 'complete').length)} note="not finished" />
        </>
      }
    >
      {merch.length === 0 ? (
        <p className="text-[15px] text-ink-dim">No merch has arrived from the live host yet.</p>
      ) : (
        <ul className="grid gap-8 md:grid-cols-2">
          {merch.map((piece) => (
            <li key={piece.id} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-4">
              <span className="block aspect-square overflow-hidden bg-raised">
                {piece.imageUrl && <img src={piece.imageUrl} alt="" className="h-full w-full object-cover" />}
              </span>
              <div className="min-w-0">
                <p className="font-display text-[28px] leading-none text-ink">{piece.title || piece.name}</p>
                <p className="mt-2 text-[13px] text-ink-dim">{piece.kind || piece.name}</p>
                <p className="mt-3 font-mono text-[14px] text-ink">{formatCents(piece.priceCents)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {/* The organizer gets the full orders table, with shipping, in MerchExtras. */}
      {!ops && orders.length > 0 && (
        <section className="mt-12">
          <h2 className="text-[13px] text-ink-dim">Orders</h2>
          <ul className="mt-3 divide-y divide-line">
            {orders.map((order) => (
              <li key={order.id} className="grid grid-cols-[minmax(0,1fr)_5rem_6.5rem_6rem] items-baseline gap-3 py-2.5">
                <span className="truncate text-[14px] text-ink">{name.get(order.templateId) || `Piece ${order.templateId}`}</span>
                <span className="text-[13px] text-ink-dim">{order.size}</span>
                <span className="font-mono text-[13px] text-ink">{formatCents(order.amountCents)}</span>
                <span className="text-[13px] text-ink-muted">{order.failure || order.status || when(order.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <MerchExtras />
    </DeskFrame>
  )
}
