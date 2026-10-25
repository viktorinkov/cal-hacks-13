// The Costs tab: the event's costs so far from the incidents it covered, summed from the claims' double-entry
// journals, so every number agrees with the Settlements tab and nothing keeps totals of its own. Each claim's
// cover picks its cost center. J1 reserve is the accrual, J3 the payment run, J2 and J4 cash application, J5
// and J6 a charge to the person responsible. Merch comes from the paid orders, the merch subledger: each
// sponsor booth is owed its products' sales less the print cost and the event's fee.

import { date, h, money } from './lib';
import { searchable } from './table-search';
import type { DbConnection } from './module_bindings';
import type { BoardMerchOrder, Claim, IncidentMarker, LedgerEntry, MedicalRecord, MerchTemplate, VenueSpot } from './module_bindings/types';

/** Injuries are Medical; the venue's equipment broken or stolen is Venue, both on the venue's property policy. */
const COST_CENTERS: Record<string, string> = { medical_payments: 'Medical', property: 'Venue', personal_property: 'Attendee property' };

/** One claim's or one cost center's amounts, in cents. */
export type Line = {
  claims: number;
  billed: bigint;
  accrued: bigint;
  paid: bigint;
  insurerOwes: bigint;
  insurerPaid: bigint;
  venueCost: bigint;
  notCovered: bigint;
  /** The venue's cost split: the deductibles, the insurer's short payments (J4) and reserves with no J2 yet. */
  deductibles: bigint;
  shortPaid: bigint;
  unrecovered: bigint;
  /** What the person responsible was charged (J5 less J5r), and the venue's part of it: the `recoveries` share of a
   * charge on its own equipment, broken or stolen. J5 credits the insurer's share to `insurer_payable` and the rest,
   * the venue's deductible, to `recoveries`. */
  charged: bigint;
  recovered: bigint;
  chargesCollected: bigint;
  chargesOutstanding: bigint;
  recoveryCollected: bigint;
};

const zero = (): Line => ({
  claims: 0, billed: 0n, accrued: 0n, paid: 0n, insurerOwes: 0n, insurerPaid: 0n, venueCost: 0n, notCovered: 0n,
  deductibles: 0n, shortPaid: 0n, unrecovered: 0n, charged: 0n, recovered: 0n,
  chargesCollected: 0n, chargesOutstanding: 0n, recoveryCollected: 0n,
});

function add(a: Line, b: Line): Line {
  const out = zero();
  for (const k of Object.keys(out) as (keyof Line)[]) (out as any)[k] = (a[k] as any) + (b[k] as any);
  return out;
}

export function costCenter(c: Claim): string {
  return COST_CENTERS[c.coverKind] ?? c.coverKind.replace(/_/g, ' ');
}

/** What the bill asked: the hospital report's billed total, else the claim's cost (the logged repair cost). */
function billed(c: Claim, records: MedicalRecord[]): bigint {
  const r = records.filter(r => r.claimId === c.id && r.status === 'extracted').sort((a, b) => Number(a.id - b.id)).pop();
  return r ? r.billedCents : c.costCents;
}

/** One claim's amounts from its journal lines. */
export function claimLine(c: Claim, ledger: LedgerEntry[], records: MedicalRecord[]): Line {
  const lines = ledger.filter(l => l.claimId === c.id);
  const balance = (account: string) => lines.filter(l => l.account === account).reduce((s, l) => s + l.debitCents - l.creditCents, 0n);
  const sum = (journal: string, account: string, side: 'debitCents' | 'creditCents') =>
    lines.filter(l => l.journal.startsWith(journal) && l.account === account).reduce((s, l) => s + l[side], 0n);
  const bill = billed(c, records);
  const decided = ['Paying', 'Settled', 'Reconciled'].includes(c.status.tag);
  const shortPaid = sum('J4', 'claims_expense', 'debitCents') - sum('J4', 'claims_expense', 'creditCents');
  const venueCost = balance('claims_expense');
  // Approval posts J2, which leaves the deductible on the venue's books.
  const deductibles = decided ? c.venueCostCents : 0n;
  const notCovered = c.status.tag === 'Refused' ? bill : decided && bill > c.payoutCents ? bill - c.payoutCents : 0n;
  const charged = sum('J5 ', 'attendee_receivable', 'debitCents') - sum('J5r', 'attendee_receivable', 'creditCents');
  const chargesCollected = sum('J6', 'cash', 'debitCents');
  const recovered = c.coverKind === 'property' ? -balance('recoveries') : 0n;
  // Charge payments are in full. Approval books a recovery; J6 is the proof it was collected.
  const insurerShare = -balance('insurer_payable');
  const collectedShare = chargesCollected > insurerShare ? chargesCollected - insurerShare : 0n;
  return {
    claims: 1,
    billed: bill,
    accrued: -balance('claims_reserve'),
    paid: sum('J3', 'cash', 'creditCents'),
    insurerOwes: balance('insurer_receivable'),
    insurerPaid: sum('J4', 'cash', 'debitCents'),
    venueCost,
    notCovered,
    deductibles,
    shortPaid,
    unrecovered: venueCost - deductibles - shortPaid,
    charged,
    recovered,
    chargesCollected,
    chargesOutstanding: balance('attendee_receivable'),
    recoveryCollected: collectedShare < recovered ? collectedShare : recovered,
  };
}

/** Every claim's line, and the sum per cost center. */
export function rollUp(claims: Claim[], ledger: LedgerEntry[], records: MedicalRecord[]) {
  const lines = claims.map(c => ({ claim: c, line: claimLine(c, ledger, records) }));
  const centers = new Map<string, Line>();
  for (const { claim, line } of lines) centers.set(costCenter(claim), add(centers.get(costCenter(claim)) ?? zero(), line));
  const total = [...centers.values()].reduce(add, zero());
  return { lines, centers, total };
}

/** What the print shop bills for each kind of product, in cents. */
const PRINT_COST: Record<string, bigint> = { tee: 800n, mug: 500n, poster: 300n };
/** The event's fee on a sponsor product's sales, in percent. */
const EVENT_FEE_PERCENT = 10n;

/** One product's or one booth's merch, in cents: the sales, the print cost, the event's fee and what the booths are owed. */
export type Merch = { orders: number; sales: bigint; print: bigint; fee: bigint; owed: bigint };

const noMerch = (): Merch => ({ orders: 0, sales: 0n, print: 0n, fee: 0n, owed: 0n });

function addMerch(m: Merch, n: Merch) {
  m.orders += n.orders;
  m.sales += n.sales;
  m.print += n.print;
  m.fee += n.fee;
  m.owed += n.owed;
}

/** Splits an amount evenly over `n` booths; the cents left over go to the first. */
function shares(cents: bigint, n: number): bigint[] {
  const each = cents / BigInt(n);
  return Array.from({ length: n }, (_, i) => (i === 0 ? cents - each * BigInt(n - 1) : each));
}

/** What the event keeps: the sales less the print cost and what it owes the booths. */
export const margin = (m: Merch) => m.sales - m.print - m.owed;

/** The paid orders by product and by sponsor booth. A plain product owes no booth and pays no fee, so the event
 * keeps its sales less the print cost. A product that names several sponsors splits evenly between their booths. */
export function merchBooks(orders: BoardMerchOrder[], templates: MerchTemplate[]) {
  const products = new Map<bigint, { template: MerchTemplate; merch: Merch }>();
  const booths = new Map<bigint, Merch>();
  const total = noMerch();
  for (const o of orders.filter(o => o.status === 'paid')) {
    const t = templates.find(t => t.id === o.templateId);
    if (!t) continue;
    const ids = [...t.boothIds].sort((a, b) => Number(a - b));
    const sales = o.amountCents;
    const print = PRINT_COST[t.kind] ?? 0n;
    const fee = ids.length ? (sales * EVENT_FEE_PERCENT) / 100n : 0n;
    const order = { orders: 1, sales, print, fee, owed: ids.length ? sales - print - fee : 0n };
    const product = products.get(t.id) ?? { template: t, merch: noMerch() };
    addMerch(product.merch, order);
    addMerch(total, order);
    products.set(t.id, product);
    if (!ids.length) continue;
    const [s, p, f] = [shares(sales, ids.length), shares(print, ids.length), shares(fee, ids.length)];
    ids.forEach((id, i) => {
      const b = booths.get(id) ?? noMerch();
      addMerch(b, { orders: 1, sales: s[i], print: p[i], fee: f[i], owed: s[i] - p[i] - f[i] });
      booths.set(id, b);
    });
  }
  return { products, booths, total };
}

/** The booth at the spot nearest to where an incident happened, when that spot is its sponsor table; the Live tab
 * names the incident's place from the same spot. 0 when it is no sponsor table. */
export function boothAt(m: IncidentMarker, spots: VenueSpot[]): bigint {
  let best: VenueSpot | undefined;
  let far = Infinity;
  for (const s of spots.filter(s => s.kind !== 'area')) {
    const d = (s.xM - m.xM) ** 2 + (s.yM - m.yM) ** 2;
    if (d < far) [best, far] = [s, d];
  }
  return best?.kind === 'sponsor_table' ? best.boothId : 0n;
}

/** Debits, credits and the balance of every account, over every journal. */
export function trialBalance(ledger: LedgerEntry[]) {
  const accounts = new Map<string, { debit: bigint; credit: bigint }>();
  for (const l of ledger) {
    const a = accounts.get(l.account) ?? { debit: 0n, credit: 0n };
    accounts.set(l.account, { debit: a.debit + l.debitCents, credit: a.credit + l.creditCents });
  }
  const rows = [...accounts.entries()].sort(([a], [b]) => a.localeCompare(b));
  const debit = rows.reduce((s, [, a]) => s + a.debit, 0n);
  const credit = rows.reduce((s, [, a]) => s + a.credit, 0n);
  return { rows, debit, credit, balanced: debit === credit };
}

const td = (cents: bigint, tag = 'td') => h(tag, {}, money(cents));
const scroll = (table: HTMLElement) => h('div', { style: 'overflow-x: auto' }, table);

function amounts(l: Line, tag = 'td') {
  return [l.billed, l.accrued, l.paid, l.insurerOwes, l.insurerPaid, l.venueCost, l.notCovered].map(x => td(x, tag));
}

const AMOUNT_HEADS = ['Billed', 'Accrued', 'Paid', 'Insurer owes', 'Insurer paid', 'Venue', 'Outside venue cover'];

function status(c: Claim) {
  return c.status.tag.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/** One journal entry's lines on one row: "Dr account $x, Cr account $y". */
function entryLines(lines: LedgerEntry[]) {
  return lines.map(l => l.debitCents ? `Dr ${l.account} ${money(l.debitCents)}` : `Cr ${l.account} ${money(l.creditCents)}`).join(', ');
}

/** The merch sold, per product, and the booth settlement: what the event owes each sponsor booth, with the
 * incidents at its table, their loss and what the people responsible were charged. */
function merchSections(conn: DbConnection, lines: { claim: Claim; line: Line }[]) {
  const { products, booths, total } = merchBooks([...conn.db.boardMerchOrders.iter()], [...conn.db.merchTemplate.iter()]);
  const spots = [...conn.db.venueSpot.iter()];
  const byClaim = new Map(lines.map(l => [l.claim.id, l.line]));
  const losses = new Map<bigint, { incidents: number; loss: bigint; charged: bigint }>();
  for (const m of conn.db.incidentMarker.iter()) {
    const booth = boothAt(m, spots);
    if (!booth) continue;
    const at = losses.get(booth) ?? { incidents: 0, loss: 0n, charged: 0n };
    const line = byClaim.get(m.claimId);
    losses.set(booth, { incidents: at.incidents + 1, loss: at.loss + (line?.billed ?? 0n), charged: at.charged + (line?.charged ?? 0n) });
  }
  const ids = [...new Set([...booths.keys(), ...losses.keys()])];
  const name = (id: bigint) => conn.db.booth.id.find(id)?.name ?? `booth ${id}`;
  const rows = ids.map(id => ({ id, merch: booths.get(id) ?? noMerch(), at: losses.get(id) ?? { incidents: 0, loss: 0n, charged: 0n } }))
    .sort((a, b) => name(a.id).localeCompare(name(b.id)));
  const sum = (f: (r: (typeof rows)[number]) => bigint) => rows.reduce((s, r) => s + f(r), 0n);
  const boothCells = (sales: bigint, print: bigint, fee: bigint, owed: bigint, incidents: number, loss: bigint, charged: bigint, tag = 'td') =>
    [td(sales, tag), td(print, tag), td(fee, tag), td(owed, tag), h(tag, {}, incidents), td(loss, tag), td(charged, tag)];
  const merchCells = (m: Merch, tag = 'td') => [h(tag, {}, m.orders), td(m.sales, tag), td(m.print, tag), td(m.owed, tag), td(margin(m), tag)];
  return {
    merch: products.size > 0 && h('section', {},
      h('h3', {}, 'Merch'),
      scroll(h('table', {},
        h('tr', {}, h('th', {}, 'Product'), h('th', {}, 'Orders'), h('th', {}, 'Sales'), h('th', {}, 'Print cost'), h('th', {}, 'Booths'), h('th', {}, 'Margin')),
        [...products.values()].sort((a, b) => a.template.title.localeCompare(b.template.title))
          .map(({ template: t, merch: m }) => h('tr', {}, h('td', {}, t.title), merchCells(m))),
        h('tr', {}, h('th', {}, 'Total'), merchCells(total, 'th'))))),
    booths: rows.length > 0 && h('section', {},
      h('h3', {}, 'Booths'),
      searchable('cost-booths', scroll(h('table', {},
        h('tr', {}, h('th', {}, 'Booth'), ['Sales', 'Print cost', 'Fee', 'Owed to booth', 'Incidents', 'Loss', 'Charged'].map(x => h('th', {}, x))),
        rows.map(r => h('tr', {}, h('td', {}, name(r.id)), boothCells(r.merch.sales, r.merch.print, r.merch.fee, r.merch.owed, r.at.incidents, r.at.loss, r.at.charged))),
        h('tr', {}, h('th', {}, 'Total'), boothCells(sum(r => r.merch.sales), sum(r => r.merch.print), sum(r => r.merch.fee), sum(r => r.merch.owed),
          rows.reduce((s, r) => s + r.at.incidents, 0), sum(r => r.at.loss), sum(r => r.at.charged), 'th')))))),
    margin: margin(total),
    total,
  };
}

type FinanceActions = {
  openClaim: (id: bigint) => void;
  openTab: (tab: 'claims' | 'merch' | 'live') => void;
  canManage: boolean;
};

export function costsTab(conn: DbConnection, actions: FinanceActions) {
  const { openClaim, openTab, canManage } = actions;
  const claims = [...conn.db.claimsBoard.iter()].sort((a, b) => Number(a.id - b.id));
  const ledger = [...conn.db.boardLedger.iter()];
  const { lines, centers, total } = rollUp(claims, ledger, [...conn.db.boardRecords.iter()]);
  const { merch, booths, margin: merchMargin, total: sales } = merchSections(conn, lines);
  const tb = trialBalance(ledger);
  const journals = new Map<bigint, LedgerEntry[]>();
  for (const l of [...ledger].sort((a, b) => Number(a.id - b.id))) journals.set(l.journalId, [...(journals.get(l.journalId) ?? []), l]);
  const entries = [...journals.values()].sort((a, b) => Number(b[0].journalId - a[0].journalId));
  const venueClaims = total.venueCost + (centers.get('Venue')?.notCovered ?? 0n);
  const review = claims.filter(c => c.status.tag === 'Routed');
  const insurer = lines.filter(({ claim, line }) => claim.status.tag === 'Settled' && line.insurerOwes > 0n);
  const failed = claims.filter(c => c.status.tag === 'Paying' && /payout failed/i.test(c.statusNote));
  const charges = [...conn.db.boardCharges.iter()].filter(c => c.status === 'proposed' || c.status === 'disputed');
  const orders = [...conn.db.boardMerchOrders.iter()];
  const pendingOrders = orders.filter(o => o.status === 'paying');
  const failedOrders = orders.filter(o => o.status === 'failed');
  const link = (text: string, go: () => void) => h('button', { type: 'button', onclick: go }, text);
  const attention = [
    ...review.map(c => ({ item: `Claim #${c.id}`, waiting: 'Approval', amount: c.payoutCents, action: 'Review claim', go: () => openClaim(c.id) })),
    ...failed.map(c => ({ item: `Claim #${c.id}`, waiting: 'Payout failed', amount: c.payoutCents, action: 'Review payout', go: () => openClaim(c.id) })),
    ...insurer.map(({ claim, line }) => ({ item: `Claim #${claim.id}`, waiting: 'Insurer payment', amount: line.insurerOwes, action: 'Record payment', go: () => openClaim(claim.id) })),
    ...charges.map(c => ({ item: `Charge #${c.id}`, waiting: c.status === 'disputed' ? 'Dispute' : 'Charge approval', amount: c.amountCents, action: 'Review charge', go: () => openTab('claims') })),
    ...pendingOrders.map(o => ({ item: `Order #${o.id}`, waiting: 'Purchase processing', amount: o.amountCents, action: 'View order', go: () => openTab('merch') })),
    ...failedOrders.map(o => ({ item: `Order #${o.id}`, waiting: 'Purchase failed', amount: o.amountCents, action: 'Review order', go: () => openTab('merch') })),
  ];
  return [
    h('section', {},
      h('h3', {}, 'Costs and revenue'),
      h('p', { class: 'muted' }, 'Hover, focus, or tap an underlined term for its definition.'),
      h('p', {}, link('Open settlements', () => openTab('claims')), ' ',
        link(canManage ? 'Buy as an attendee' : 'View merch orders', () => openTab('merch')), ' ',
        link('Live controls', () => openTab('live')))),
    h('section', {},
      h('h3', {}, 'Revenue'),
      scroll(h('table', {},
        h('tr', {}, ['Paid orders', 'Gross sales', 'Print cost', 'Owed to booths', 'Event earnings'].map(x => h('th', {}, x))),
        h('tr', {}, h('td', {}, sales.orders), td(sales.sales), td(sales.print), td(sales.owed), td(merchMargin, 'th')))),
      !sales.orders && h('p', { class: 'muted' }, 'No paid orders yet. Sales appear here when a purchase completes.')),
    h('section', {},
      h('h3', {}, 'Net cost'),
      scroll(h('table', {},
        h('tr', {}, h('th', {}, 'Claims cost'), h('th', {}, 'Approved recoveries'), h('th', {}, 'Event earnings'), h('th', {}, 'Net cost')),
        h('tr', {}, td(venueClaims), td(total.recovered), td(merchMargin), td(venueClaims - total.recovered - merchMargin, 'th'))))),
    h('section', {},
      h('h3', {}, 'Payments'),
      scroll(h('table', {},
        h('tr', {}, ['Claim payments', 'Insurer received', 'Insurer outstanding', 'Charges collected', 'Charges outstanding', 'Venue recoveries collected'].map(x => h('th', {}, x))),
        h('tr', {}, [total.paid, total.insurerPaid, total.insurerOwes, total.chargesCollected, total.chargesOutstanding, total.recoveryCollected].map(x => td(x)))))),
    h('section', {},
      h('h3', {}, `Needs attention (${attention.length})`),
      !attention.length && h('p', { class: 'muted' }, 'No payments or decisions waiting.'),
      attention.length > 0 && searchable('finance-attention', h('div', { style: 'max-height: 22rem; overflow: auto' }, h('table', {},
        h('tr', {}, ['Item', 'Waiting for', 'Amount', 'Action'].map(x => h('th', {}, x))),
        attention.map(a => h('tr', {}, h('td', {}, a.item), h('td', {}, a.waiting), td(a.amount), h('td', {}, link(a.action, a.go)))))))),
    h('section', {},
      h('h3', {}, 'Cost centers'),
      scroll(h('table', {},
        h('tr', {}, h('th', {}, 'Cost center'), h('th', {}, 'Claims'), AMOUNT_HEADS.map(x => h('th', {}, x))),
        [...centers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, l]) => h('tr', {}, h('td', {}, name), h('td', {}, l.claims), amounts(l))),
        h('tr', {}, h('th', {}, 'Total'), h('th', {}, total.claims), amounts(total, 'th'))))),
    h('section', {},
      h('h3', {}, 'Who pays'),
      scroll(h('table', {},
        h('tr', {}, ['Venue', 'Deductibles', 'Short payments', 'Not recovered yet', 'Insurer', 'Attendee / plan', 'Charged', 'Unpaid'].map(x => h('th', {}, x))),
        h('tr', {}, td(venueClaims), td(total.deductibles), td(total.shortPaid), td(total.unrecovered),
          td(total.insurerPaid + total.insurerOwes), td(total.notCovered - (centers.get('Venue')?.notCovered ?? 0n)),
          td(total.charged), td(total.accrued))))),
    merch,
    booths,
    h('section', {},
      h('h3', {}, `Claims (${claims.length})`),
      searchable('cost-claims', scroll(h('table', {},
        h('tr', {}, ['Claim', 'Cost center', 'Claimant', 'Billed', 'Paid', 'Insurer', 'Venue', 'Outside venue cover', 'Charged', 'Status'].map(x => h('th', {}, x))),
        lines.map(({ claim: c, line }) => h('tr', {},
          h('td', {}, h('button', { class: 'link', onclick: () => openClaim(c.id) }, `#${c.id}`)),
          h('td', {}, costCenter(c)), h('td', {}, c.claimantName || (c.coverKind === 'property' ? 'the venue' : '')),
          td(line.billed), td(line.paid), td(line.insurerPaid + line.insurerOwes), td(line.venueCost), td(line.notCovered), td(line.charged),
          h('td', {}, status(c)))))))),
    ledger.length > 0 && h('details', { ontoggle: (e: Event) => { ledgerOpen = (e.currentTarget as HTMLDetailsElement).open; }, open: ledgerOpen || undefined },
      h('summary', {}, 'Ledger details'),
      h('section', {},
      h('h3', {}, 'Trial balance'),
      scroll(h('table', {},
        h('tr', {}, h('th', {}, 'Account'), h('th', {}, 'Debits'), h('th', {}, 'Credits'), h('th', {}, 'Balance')),
        tb.rows.map(([account, a]) => h('tr', {}, h('td', {}, account), td(a.debit), td(a.credit), td(a.debit - a.credit))),
        h('tr', {}, h('th', {}, 'Total'), h('th', {}, money(tb.debit)), h('th', {}, money(tb.credit)),
          h('th', { class: tb.balanced ? 'pass' : 'fail' }, tb.balanced ? 'Balanced' : `Off by ${money(tb.debit - tb.credit)}`))))),
    h('section', {},
      h('h3', {}, `Journal (${entries.length})`),
      searchable('journal', scroll(h('table', {},
        h('tr', {}, h('th', {}, 'Entry'), h('th', {}, 'Claim'), h('th', {}, 'Lines'), h('th', {}, 'Posted')),
        entries.map(e => h('tr', {},
          h('td', {}, `${e[0].journalId} ${e[0].journal}`),
          h('td', {}, h('button', { class: 'link', onclick: () => openClaim(e[0].claimId) }, `#${e[0].claimId}`)),
          h('td', {}, entryLines(e)), h('td', { class: 'muted' }, date(e[0].postedAt))))))))),
  ];
}

let ledgerOpen = false;
