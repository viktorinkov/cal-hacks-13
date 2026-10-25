import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { formatCents } from '@/cover/money'
import { cn } from '@/lib/utils'
import { bandLabel } from '@/payments/model'
import { useSession } from '@/stdb/session'
import {
  ADDRESS_LIMIT,
  BOOTH_FEE_PERCENT,
  PRINT_CENTS,
  TEE_SIZES,
  buyAsAttendee,
  isOps,
  marginOf,
  merchSales,
  picksFor,
  rerunShoppingAgent,
  stamp,
  takesSize,
  useSettlement,
  type AttendeeWallet,
  type MerchPick,
  type MerchTemplateRow,
  type SalesLine,
} from '@/stdb/settlementOps'

const field = 'w-full min-w-0 rounded-[4px] border border-line-strong bg-ground px-3 text-[14px] text-ink outline-none'
const action = 'h-11 self-start text-[14px] text-ink hover:text-champagne disabled:text-ink-muted'
const th = 'py-2 pr-4 text-left align-bottom text-[13px] font-normal text-ink-dim'
const td = 'py-2.5 pr-4 align-top text-[14px] text-ink'
const money = 'py-2.5 pr-4 align-top text-right font-mono text-[13px] tabular-nums text-ink'
const SHOWN = 8

function reasonOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-[13px] text-ink-dim">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Thumb({ src, alt }: { src: string; alt: string }) {
  if (!src) return <span className="block h-12 w-12 bg-raised" aria-hidden />
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block h-12 w-12 overflow-hidden bg-raised">
      <img src={src} alt={alt} className="h-full w-full object-cover" />
    </a>
  )
}

function statusTone(status: string): string {
  if (status === 'paid') return 'text-ink'
  if (status === 'failed') return 'text-signal'
  return 'text-ink-dim'
}

/** Orders with their shipping, the templates, sales, the shopping agent's picks, and buying as an attendee. */
export function MerchExtras() {
  const owner = useSession((s) => s.owner)
  const roles = useSession((s) => s.roles)
  const ops = isOps({ owner, roles })
  return (
    <div className="mt-12 flex flex-col gap-12">
      {ops && <BuyAs />}
      <Picks ops={ops} />
      <Orders ops={ops} />
      <Sales />
      <Templates />
    </div>
  )
}

function BuyAs() {
  const wallets = useSettlement((s) => s.wallets)
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState('')
  const wallet = wallets.find((item) => item.nodeId === chosen)
  const found = useMemo(() => {
    const words = query.trim().toLowerCase()
    const digits = words.replace(/^band\s*/, '')
    const hits = words
      ? wallets.filter((item) => item.name.toLowerCase().includes(words) || (/^\d+$/.test(digits) && item.bandId === Number(digits)))
      : wallets
    return hits.slice(0, SHOWN)
  }, [wallets, query])

  return (
    <Section title="Buy as an attendee">
      <p className="text-[14px] text-ink-dim">Pick an attendee to buy from their wallet, during or after the event.</p>
      {wallets.length === 0 ? (
        <p className="mt-3 text-[14px] text-ink-dim">Nobody has a wallet yet. Attendees connect one at band setup.</p>
      ) : (
        <>
          <input
            aria-label="Find an attendee"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or band number"
            className={cn(field, 'mt-3 h-11 max-w-[24rem]')}
          />
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
            {found.map((item) => (
              <li key={item.nodeId}>
                <button
                  type="button"
                  aria-pressed={item.nodeId === chosen}
                  onClick={() => setChosen(item.nodeId)}
                  className={cn('h-9 text-left hover:text-champagne', item.nodeId === chosen ? 'text-champagne' : 'text-ink')}
                >
                  {`${item.name} · ${item.bandId ? bandLabel(item.bandId) : 'no band'} · ${formatCents(item.balanceCents)}`}
                </button>
              </li>
            ))}
          </ul>
          {found.length === 0 && <p className="mt-2 text-[14px] text-ink-dim">Nobody with a wallet matches that.</p>}
          {wallet && <Shopper key={wallet.nodeId} wallet={wallet} />}
        </>
      )}
    </Section>
  )
}

function Step({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-[13px] text-ink-dim">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function Shopper({ wallet }: { wallet: AttendeeWallet }) {
  const allPicks = useSettlement((s) => s.picks)
  const photos = useSettlement((s) => s.photos)
  const templates = useSettlement((s) => s.templates)
  const orders = useSettlement((s) => s.orders)
  const shipping = useSettlement((s) => s.shipping)
  const people = useSettlement((s) => s.wallets)
  const picks = useMemo(() => picksFor(wallet.nodeId, wallet.name, allPicks, photos, templates), [wallet.nodeId, wallet.name, allPicks, photos, templates])
  const mine = orders.filter((order) => order.nodeId === wallet.nodeId)
  const lastAddress = mine.map((order) => shipping[order.id]).find(Boolean) ?? ''
  const photoIds = new Set(picks.map((pick) => pick.photoId))
  const used = photos.filter((photo) => photoIds.has(photo.id))
  const byTemplate = new Map(templates.map((template) => [template.id, template]))

  return (
    <div className="desk-card mt-6 grid gap-8 px-5 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Step title={`1. ${wallet.name}'s photo`}>
        {used.length === 0 ? (
          <p className="text-[14px] text-ink-dim">None picked yet.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {used.map((photo) => (
              <li key={photo.id} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3">
                <Thumb src={photo.url} alt={photo.caption || 'Event photo'} />
                <div className="min-w-0 text-[14px] text-ink">
                  <p>{photo.caption || 'Event photo'}</p>
                  <p className="text-[13px] text-ink-dim">{`${photo.zoneName}, ${stamp(photo.takenAt)}${photo.read ? `, ${photo.peopleCount} people counted` : ''}`}</p>
                  <p className="text-[13px] text-ink-dim">
                    {`With ${photo.nodeIds.filter((id) => id !== wallet.nodeId).map((id) => people.find((item) => item.nodeId === id)?.name ?? 'no name yet').join(', ') || 'nobody else tagged'}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Step>

      <Step title="2. Their wallet">
        <p className="font-display text-[28px] leading-none tabular-nums text-ink">{formatCents(wallet.balanceCents)}</p>
        <p className="mt-2 text-[13px] text-ink-dim">{`Capital One account ${wallet.accountId.slice(0, 8)}`}</p>
      </Step>

      <Step title="3. Their merch" className="md:col-span-2">
        {picks.length === 0 ? (
          <p className="text-[14px] text-ink-dim">Merch appears once a photo includes this attendee.</p>
        ) : (
          <ul className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {picks.map((pick) => {
              const template = byTemplate.get(pick.templateId)
              if (!template) return null
              return (
                <li key={`${pick.id}-${pick.photoId}`}>
                  <PickForm pick={pick} template={template} wallet={wallet} address={lastAddress} />
                </li>
              )
            })}
          </ul>
        )}
      </Step>

      <Step title="4. Paid on Nessie" className="md:col-span-2">
        {mine.length === 0 ? (
          <p className="text-[14px] text-ink-dim">No orders yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {mine.map((order) => (
              <li key={order.id} className="py-2.5 text-[14px] text-ink first:pt-0">
                <p>
                  {`#${order.id} ${order.title}${order.size ? ` (${order.size})` : ''}, ${formatCents(order.amountCents)}: `}
                  <span className={statusTone(order.status)}>{order.status}</span>
                </p>
                {order.nessiePurchaseId && (
                  <p className="text-[13px] text-ink-dim">
                    Nessie purchase <code className="font-mono">{order.nessiePurchaseId}</code>
                  </p>
                )}
                {shipping[order.id] && <p className="whitespace-pre-line text-[13px] text-ink-dim">{`Ship to: ${shipping[order.id]}`}</p>}
                {order.failure && <p className="text-[13px] text-ink-dim">{order.failure}</p>}
              </li>
            ))}
          </ul>
        )}
      </Step>
    </div>
  )
}

function PickForm({ pick, template, wallet, address }: { pick: MerchPick; template: MerchTemplateRow; wallet: AttendeeWallet; address: string }) {
  const busy = useSettlement((s) => s.busy)
  const sized = takesSize(template.kind)
  const [size, setSize] = useState('M')
  const [shippingAddress, setShippingAddress] = useState(address)
  const [problem, setProblem] = useState('')
  const [sent, setSent] = useState(false)
  const short = wallet.balanceCents < template.priceCents
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setProblem('')
    setSent(false)
    void buyAsAttendee({ nodeId: wallet.nodeId, templateId: pick.templateId, photoId: pick.photoId, size: sized ? size : '', shippingAddress })
      .then(() => setSent(true))
      .catch((error: unknown) => setProblem(reasonOf(error, 'The order was not placed.')))
  }
  return (
    <form aria-label={`Buy ${template.title} as ${wallet.name}`} onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-[3rem_3rem_minmax(0,1fr)] gap-3">
        <Thumb src={template.imageUrl} alt={template.title} />
        <Thumb src={pick.photoUrl} alt="Their photo" />
        <div className="min-w-0">
          <p className="text-[14px] text-ink">{`${pick.rank}. ${template.title}`}</p>
          <p className="font-mono text-[13px] text-ink">{formatCents(template.priceCents)}</p>
        </div>
      </div>
      {pick.reason && <p className="text-[13px] leading-5 text-ink-dim">{pick.reason}</p>}
      <p className="text-[13px] leading-5 text-ink-dim">{pick.line ? `"${pick.line}"` : 'The printed line is added from friends tagged in the photo.'}</p>
      {sized && (
        <label className="text-[13px] text-ink-dim">
          Size
          <select value={size} onChange={(event) => setSize(event.target.value)} className={cn(field, 'mt-1 h-11')}>
            {TEE_SIZES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="text-[13px] text-ink-dim">
        Shipping address
        <textarea
          value={shippingAddress}
          required
          maxLength={ADDRESS_LIMIT}
          rows={4}
          onChange={(event) => setShippingAddress(event.target.value)}
          placeholder="Recipient name, street, city, region, postal code, country"
          className={cn(field, 'mt-1 py-2 leading-5')}
        />
      </label>
      <button type="submit" disabled={busy || short} className={action}>
        {`Buy as ${wallet.name}`}
      </button>
      {short && <p className="text-[13px] text-ink-dim">{`Their wallet holds ${formatCents(wallet.balanceCents)}, less than the price.`}</p>}
      {sent && !problem && <p className="text-[13px] text-ink-dim">Ordered. It shows under Paid on Nessie once the purchase goes through.</p>}
      {problem && <p className="text-[13px] text-signal">{problem}</p>}
    </form>
  )
}

function Picks({ ops }: { ops: boolean }) {
  const picks = useSettlement((s) => s.picks)
  const templates = useSettlement((s) => s.templates)
  const ended = useSession((s) => s.eventEnded)
  const busy = useSettlement((s) => s.busy)
  const [problem, setProblem] = useState('')
  const byTemplate = new Map(templates.map((template) => [template.id, template]))
  const people = new Set(picks.map((pick) => pick.attendeeName)).size
  const rerun = () => {
    setProblem('')
    void rerunShoppingAgent().catch((error: unknown) => setProblem(reasonOf(error, 'The shopping agent did not start.')))
  }
  return (
    <Section title={`Shopping agent picks (${people} ${people === 1 ? 'attendee' : 'attendees'})`}>
      {picks.length === 0 && (
        <p className="text-[14px] text-ink-dim">{ended ? 'Picking now. Each attendee in a photo gets three picks.' : 'The shopping agent picks for everyone in a photo once the event ends.'}</p>
      )}
      {ops && ended && (
        <button type="button" disabled={busy} onClick={rerun} className={cn(action, picks.length === 0 && 'mt-2')}>
          Run the shopping agent again
        </button>
      )}
      {problem && <p className="text-[13px] text-signal">{problem}</p>}
      {picks.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Attendee</th>
                <th className={th}>#</th>
                <th className={th}>Product</th>
                <th className={th}>Photo</th>
                <th className={th}>Printed line</th>
                <th className={th}>Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {picks.map((pick) => {
                const template = byTemplate.get(pick.templateId)
                return (
                  <tr key={pick.id}>
                    <td className={td}>{pick.attendeeName || 'no name yet'}</td>
                    <td className={cn(td, 'tabular-nums')}>{pick.rank}</td>
                    <td className={td}>
                      {template ? (
                        <span className="flex items-center gap-3">
                          <Thumb src={template.imageUrl} alt={template.title} />
                          <span className="min-w-0">{template.title}</span>
                        </span>
                      ) : (
                        `Template ${pick.templateId}`
                      )}
                    </td>
                    <td className={td}>
                      <Thumb src={pick.photoUrl} alt="Photo" />
                    </td>
                    <td className={cn(td, !pick.line && 'text-ink-dim')}>{pick.line || 'none'}</td>
                    <td className={cn(td, 'text-[13px] leading-5 text-ink-dim')}>{pick.reason}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

function Orders({ ops }: { ops: boolean }) {
  const orders = useSettlement((s) => s.orders)
  const shipping = useSettlement((s) => s.shipping)
  const paid = orders.filter((order) => order.status === 'paid')
  const takings = paid.reduce((sum, order) => sum + order.amountCents, 0)
  return (
    <Section title={`Orders: ${orders.length}, of which ${paid.length} paid for ${formatCents(takings)}`}>
      {!ops ? (
        <p className="text-[14px] text-ink-dim">Orders show for the organizer.</p>
      ) : orders.length === 0 ? (
        <p className="text-[14px] text-ink-dim">No orders yet. Attendees can buy merch during and after the event.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse">
            <thead>
              <tr className="border-b border-line">
                {['Order', 'Attendee', 'Item', 'Photo', 'Printed line', 'Size'].map((label) => (
                  <th key={label} className={th}>
                    {label}
                  </th>
                ))}
                <th className={cn(th, 'text-right')}>Amount</th>
                {['Status', 'Shipping address', 'Nessie purchase', 'Ordered'].map((label) => (
                  <th key={label} className={th}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className={cn(td, 'font-mono text-[13px]')}>{`#${order.id}`}</td>
                  <td className={td}>{order.attendeeName || 'no name yet'}</td>
                  <td className={td}>{order.title}</td>
                  <td className={td}>{order.photoUrl ? <Thumb src={order.photoUrl} alt="Photo" /> : null}</td>
                  <td className={cn(td, !order.line && 'text-ink-dim')}>{order.line || '—'}</td>
                  <td className={cn(td, !order.size && 'text-ink-dim')}>{order.size || '—'}</td>
                  <td className={money}>{formatCents(order.amountCents)}</td>
                  <td className={td}>
                    <span className={statusTone(order.status)}>{order.status}</span>
                    {order.failure && <span className="block text-[13px] text-ink-dim">{order.failure}</span>}
                  </td>
                  <td className={cn(td, 'max-w-[16rem] whitespace-pre-line text-[13px] leading-5', !shipping[order.id] && 'text-ink-dim')}>{shipping[order.id] || 'Not provided'}</td>
                  <td className={td}>
                    {order.nessiePurchaseId ? <code className="font-mono text-[13px]">{order.nessiePurchaseId}</code> : <span className="text-ink-dim">not yet</span>}
                  </td>
                  <td className={cn(td, 'whitespace-nowrap text-[13px] text-ink-dim')}>{stamp(order.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

function SalesCells({ line, heading = false, booth = false }: { line: SalesLine; heading?: boolean; booth?: boolean }) {
  const cell = cn(money, heading && 'text-ink')
  return (
    <>
      <td className={cn(td, 'tabular-nums', heading && 'font-medium')}>{line.orders}</td>
      <td className={cell}>{formatCents(line.sales)}</td>
      <td className={cell}>{formatCents(line.print)}</td>
      {booth && <td className={cell}>{formatCents(line.fee)}</td>}
      <td className={cell}>{formatCents(line.owed)}</td>
      {!booth && <td className={cell}>{formatCents(marginOf(line))}</td>}
    </>
  )
}

function Sales() {
  const orders = useSettlement((s) => s.orders)
  const templates = useSettlement((s) => s.templates)
  const booths = useSettlement((s) => s.booths)
  const { products, booths: byBooth, total } = useMemo(() => merchSales(orders, templates), [orders, templates])
  const productRows = [...products.values()].sort((a, b) => a.template.title.localeCompare(b.template.title))
  const boothName = (id: string) => booths[id] || `Booth ${id}`
  const boothRows = [...byBooth.entries()].sort(([a], [b]) => boothName(a).localeCompare(boothName(b)))
  const boothTotal = boothRows.reduce<SalesLine>(
    (sum, [, line]) => ({ orders: sum.orders + line.orders, sales: sum.sales + line.sales, print: sum.print + line.print, fee: sum.fee + line.fee, owed: sum.owed + line.owed }),
    { orders: 0, sales: 0, print: 0, fee: 0, owed: 0 },
  )
  const head = (labels: string[]) => (
    <tr className="border-b border-line">
      {labels.map((label, index) => (
        <th key={label} className={cn(th, index > 1 && 'text-right')}>
          {label}
        </th>
      ))}
    </tr>
  )

  return (
    <Section title="Sales">
      {total.orders === 0 ? (
        <p className="text-[14px] text-ink-dim">No paid orders yet. Sales appear here when a purchase completes.</p>
      ) : (
        <div className="grid gap-10 xl:grid-cols-2">
          <div className="overflow-x-auto">
            <p className="text-[13px] text-ink-dim">By product</p>
            <table className="mt-2 w-full min-w-[560px] border-collapse">
              <thead>{head(['Product', 'Orders', 'Sales', 'Print cost', 'Owed to booths', 'Margin'])}</thead>
              <tbody className="divide-y divide-line">
                {productRows.map(({ template, line }) => (
                  <tr key={template.id}>
                    <td className={td}>{template.title || template.name}</td>
                    <SalesCells line={line} />
                  </tr>
                ))}
                <tr className="border-t border-line-strong">
                  <td className={cn(td, 'font-medium')}>Total</td>
                  <SalesCells line={total} heading />
                </tr>
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <p className="text-[13px] text-ink-dim">By sponsor booth</p>
            {boothRows.length === 0 ? (
              <p className="mt-2 text-[14px] text-ink-dim">No paid orders for sponsor merch yet.</p>
            ) : (
              <table className="mt-2 w-full min-w-[560px] border-collapse">
                <thead>{head(['Booth', 'Orders', 'Sales', 'Print cost', 'Fee', 'Owed to booth'])}</thead>
                <tbody className="divide-y divide-line">
                  {boothRows.map(([id, line]) => (
                    <tr key={id}>
                      <td className={td}>{boothName(id)}</td>
                      <SalesCells line={line} booth />
                    </tr>
                  ))}
                  <tr className="border-t border-line-strong">
                    <td className={cn(td, 'font-medium')}>Total</td>
                    <SalesCells line={boothTotal} heading booth />
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
      <p className="mt-4 max-w-[72ch] text-[13px] leading-5 text-ink-muted">
        {`Paid orders only. Printing costs ${formatCents(PRINT_CENTS.tee)} a tee, ${formatCents(PRINT_CENTS.mug)} a mug and ${formatCents(PRINT_CENTS.poster)} a poster. A sponsor booth is owed its sales less printing and a ${BOOTH_FEE_PERCENT}% fee, split evenly when a piece carries more than one booth.`}
      </p>
    </Section>
  )
}

function Templates() {
  const templates = useSettlement((s) => s.templates)
  const booths = useSettlement((s) => s.booths)
  return (
    <Section title={`Templates (${templates.length})`}>
      {templates.length === 0 ? (
        <p className="text-[14px] text-ink-dim">None loaded yet. The merch setup loads them after the event import.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>Image</th>
                <th className={th}>Title</th>
                <th className={th}>Kind</th>
                <th className={cn(th, 'text-right')}>Price</th>
                <th className={th}>Photo area</th>
                <th className={th}>Sponsor booths</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {templates.map((template) => (
                <tr key={template.id}>
                  <td className={td}>
                    <Thumb src={template.imageUrl} alt={template.title} />
                  </td>
                  <td className={td}>
                    {template.title}
                    <span className="block text-[13px] text-ink-dim">{template.name}</span>
                  </td>
                  <td className={td}>{template.kind}</td>
                  <td className={money}>{formatCents(template.priceCents)}</td>
                  <td className={cn(td, 'font-mono text-[13px] tabular-nums')}>{`${template.photoW}×${template.photoH} at ${template.photoX},${template.photoY}`}</td>
                  <td className={cn(td, !template.boothIds.length && 'text-ink-dim')}>
                    {template.boothIds.length ? template.boothIds.map((id) => booths[id] || `Booth ${id}`).join(', ') : 'plain'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}
