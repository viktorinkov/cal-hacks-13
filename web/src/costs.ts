// The Costs tab: the event's costs so far from the incidents it covered, summed from the claims' double-entry
// journals, so every number agrees with the Settlements tab and nothing keeps totals of its own. Each claim's
// cover picks its cost center. J1 reserve is the accrual, J3 the payment run, J2 and J4 cash application.

import { date, h, money } from './lib';
import type { DbConnection } from './module_bindings';
import type { Claim, LedgerEntry, MedicalRecord } from './module_bindings/types';

const COST_CENTERS: Record<string, string> = { medical_payments: 'Medical', property: 'Venue', personal_property: 'Belongings' };

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
};

const zero = (): Line => ({
  claims: 0, billed: 0n, accrued: 0n, paid: 0n, insurerOwes: 0n, insurerPaid: 0n, venueCost: 0n, notCovered: 0n,
  deductibles: 0n, shortPaid: 0n, unrecovered: 0n,
});

function add(a: Line, b: Line): Line {
  const out = zero();
  for (const k of Object.keys(out) as (keyof Line)[]) (out as any)[k] = (a[k] as any) + (b[k] as any);
  return out;
}

export function costCenter(c: Claim): string {
  return COST_CENTERS[c.coverKind] ?? c.coverKind;
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
  return {
    claims: 1,
    billed: bill,
    accrued: -balance('claims_reserve'),
    paid: sum('J3', 'cash', 'creditCents'),
    insurerOwes: balance('insurer_receivable'),
    insurerPaid: sum('J4', 'cash', 'debitCents'),
    venueCost,
    notCovered: c.status.tag === 'Refused' ? bill : decided && bill > c.payoutCents ? bill - c.payoutCents : 0n,
    deductibles,
    shortPaid,
    unrecovered: venueCost - deductibles - shortPaid,
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

const AMOUNT_HEADS = ['Billed', 'Accrued', 'Paid', 'Insurer owes', 'Insurer paid', 'Venue', 'Not covered'];

function status(c: Claim) {
  return c.status.tag.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/** One journal entry's lines on one row: "Dr account $x, Cr account $y". */
function entryLines(lines: LedgerEntry[]) {
  return lines.map(l => l.debitCents ? `Dr ${l.account} ${money(l.debitCents)}` : `Cr ${l.account} ${money(l.creditCents)}`).join(', ');
}

export function costsTab(conn: DbConnection, openClaim: (id: bigint) => void) {
  const claims = [...conn.db.claimsBoard.iter()].sort((a, b) => Number(a.id - b.id));
  if (!claims.length) return h('section', {}, h('h3', {}, 'Costs'), h('p', { class: 'muted' }, 'No claims yet.'));
  const ledger = [...conn.db.boardLedger.iter()];
  const { lines, centers, total } = rollUp(claims, ledger, [...conn.db.boardRecords.iter()]);
  const tb = trialBalance(ledger);
  const journals = new Map<bigint, LedgerEntry[]>();
  for (const l of [...ledger].sort((a, b) => Number(a.id - b.id))) journals.set(l.journalId, [...(journals.get(l.journalId) ?? []), l]);
  const entries = [...journals.values()].sort((a, b) => Number(b[0].journalId - a[0].journalId));
  const venueUncovered = centers.get('Venue')?.notCovered ?? 0n;
  return [
    h('section', {},
      h('h3', {}, 'Cost centers'),
      scroll(h('table', {},
        h('tr', {}, h('th', {}, 'Cost center'), h('th', {}, 'Claims'), AMOUNT_HEADS.map(x => h('th', {}, x))),
        [...centers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, l]) => h('tr', {}, h('td', {}, name), h('td', {}, l.claims), amounts(l))),
        h('tr', {}, h('th', {}, 'Total'), h('th', {}, total.claims), amounts(total, 'th'))))),
    h('section', {},
      h('h3', {}, 'Who pays'),
      scroll(h('table', {},
        h('tr', {}, h('th', {}, 'Venue'), h('th', {}, 'Deductibles'), h('th', {}, 'Short payments'), h('th', {}, 'Not recovered yet'), h('th', {}, 'Insurer'), h('th', {}, 'Attendees'), h('th', {}, 'Unpaid')),
        h('tr', {}, td(total.venueCost + venueUncovered), td(total.deductibles), td(total.shortPaid), td(total.unrecovered),
          td(total.insurerPaid + total.insurerOwes), td((centers.get('Medical')?.notCovered ?? 0n) + (centers.get('Belongings')?.notCovered ?? 0n)), td(total.accrued))))),
    h('section', {},
      h('h3', {}, `Claims (${claims.length})`),
      scroll(h('table', {},
        h('tr', {}, h('th', {}, 'Claim'), h('th', {}, 'Cost center'), h('th', {}, 'Claimant'), h('th', {}, 'Billed'), h('th', {}, 'Paid'), h('th', {}, 'Insurer'), h('th', {}, 'Venue'), h('th', {}, 'Not covered'), h('th', {}, 'Status')),
        lines.map(({ claim: c, line }) => h('tr', {},
          h('td', {}, h('button', { class: 'link', onclick: () => openClaim(c.id) }, `#${c.id}`)),
          h('td', {}, costCenter(c)), h('td', {}, c.claimantName || (c.coverKind === 'property' ? 'the venue' : '')),
          td(line.billed), td(line.paid), td(line.insurerPaid + line.insurerOwes), td(line.venueCost), td(line.notCovered), h('td', {}, status(c))))))),
    ledger.length > 0 && h('section', {},
      h('h3', {}, 'Trial balance'),
      scroll(h('table', {},
        h('tr', {}, h('th', {}, 'Account'), h('th', {}, 'Debits'), h('th', {}, 'Credits'), h('th', {}, 'Balance')),
        tb.rows.map(([account, a]) => h('tr', {}, h('td', {}, account), td(a.debit), td(a.credit), td(a.debit - a.credit))),
        h('tr', {}, h('th', {}, 'Total'), h('th', {}, money(tb.debit)), h('th', {}, money(tb.credit)),
          h('th', { class: tb.balanced ? 'pass' : 'fail' }, tb.balanced ? 'Balanced' : `Off by ${money(tb.debit - tb.credit)}`))))),
    ledger.length > 0 && h('section', {},
      h('h3', {}, `Journal (${entries.length})`),
      scroll(h('table', {},
        h('tr', {}, h('th', {}, 'Entry'), h('th', {}, 'Claim'), h('th', {}, 'Lines'), h('th', {}, 'Posted')),
        entries.map(e => h('tr', {},
          h('td', {}, `${e[0].journalId} ${e[0].journal}`),
          h('td', {}, h('button', { class: 'link', onclick: () => openClaim(e[0].claimId) }, `#${e[0].claimId}`)),
          h('td', {}, entryLines(e)), h('td', { class: 'muted' }, date(e[0].postedAt))))))),
  ];
}
