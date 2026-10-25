// The Costs tab: the event's costs so far from the incidents it covered, summed from the claims' double-entry
// journals, so every number agrees with the Settlements tab and nothing keeps totals of its own. Each claim's
// cover picks its cost center. J1 reserve is the accrual, J3 the payment run, J2 and J4 cash application.

import { date, h, money } from './lib';
import type { DbConnection } from './module_bindings';
import type { Claim, LedgerEntry, MedicalRecord } from './module_bindings/types';

const COST_CENTERS: Record<string, string> = { medical_payments: 'Medical', property: 'Venue' };

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

function amounts(l: Line, tag = 'td') {
  return [l.billed, l.accrued, l.paid, l.insurerOwes, l.insurerPaid, l.venueCost, l.notCovered].map(x => td(x, tag));
}

const AMOUNT_HEADS = ['Billed', 'Accrued (J1)', 'Paid (J3)', 'Insurer owes (J2)', 'Insurer paid (J4)', "Venue's cost", 'Not covered'];

export function costsTab(conn: DbConnection, openClaim: (id: bigint) => void) {
  const claims = [...conn.db.claimsBoard.iter()].sort((a, b) => Number(a.id - b.id));
  const ledger = [...conn.db.boardLedger.iter()];
  const { lines, centers, total } = rollUp(claims, ledger, [...conn.db.boardRecords.iter()]);
  const tb = trialBalance(ledger);
  const journals = new Map<bigint, LedgerEntry[]>();
  for (const l of [...ledger].sort((a, b) => Number(a.id - b.id))) journals.set(l.journalId, [...(journals.get(l.journalId) ?? []), l]);
  const entries = [...journals.values()].sort((a, b) => Number(b[0].journalId - a[0].journalId));
  return [
    h('section', {},
      h('h3', {}, 'Costs so far by cost center'),
      !claims.length && h('p', { class: 'muted' }, 'No claims yet.'),
      claims.length > 0 && h('table', {},
        h('tr', {}, h('th', {}, 'Cost center'), h('th', {}, 'Claims'), AMOUNT_HEADS.map(x => h('th', {}, x))),
        [...centers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, l]) => h('tr', {}, h('td', {}, name), h('td', {}, l.claims), amounts(l))),
        h('tr', {}, h('th', {}, 'Total'), h('th', {}, total.claims), amounts(total, 'th')))),
    claims.length > 0 && h('section', {},
      h('h3', {}, 'Who pays what'),
      h('table', {},
        h('tr', {}, h('td', {}, 'The venue'), td(total.venueCost),
          h('td', { class: 'muted' }, `deductibles ${money(total.deductibles)}, insurer short payments ${money(total.shortPaid)}, reserves with no recovery posted yet ${money(total.unrecovered)}`)),
        h('tr', {}, h('td', {}, "The venue's insurer"), td(total.insurerPaid + total.insurerOwes),
          h('td', { class: 'muted' }, `paid back ${money(total.insurerPaid)}, still owes ${money(total.insurerOwes)}`)),
        h('tr', {}, h('td', {}, 'Attendees or their health plans'), td(centers.get('Medical')?.notCovered ?? 0n), h('td', { class: 'muted' }, 'not covered on Medical claims')),
        h('tr', {}, h('td', {}, 'Still to pay'), td(total.accrued), h('td', { class: 'muted' }, 'accrued reserves not paid yet')))),
    claims.length > 0 && h('section', {},
      h('h3', {}, 'Cost lines'),
      h('table', {},
        h('tr', {}, h('th', {}, 'Claim'), h('th', {}, 'Cost center'), h('th', {}, 'Claimant'), h('th', {}, 'What'), AMOUNT_HEADS.map(x => h('th', {}, x)), h('th', {}, 'Status')),
        lines.map(({ claim: c, line }) => h('tr', {},
          h('td', {}, h('button', { class: 'link', onclick: () => openClaim(c.id) }, `#${c.id}`)),
          h('td', {}, costCenter(c)), h('td', {}, c.claimantName || '(none)'), h('td', {}, `${c.incidentKind} in ${c.zoneName}`),
          amounts(line), h('td', {}, c.status.tag.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()))))),
    h('section', {},
      h('h3', {}, 'Journal'),
      h('h4', {}, 'Trial balance'),
      h('table', {},
        h('tr', {}, h('th', {}, 'Account'), h('th', {}, 'Debits'), h('th', {}, 'Credits'), h('th', {}, 'Balance')),
        tb.rows.map(([account, a]) => h('tr', {}, h('td', {}, account), td(a.debit), td(a.credit), td(a.debit - a.credit))),
        h('tr', {}, h('th', {}, 'Total'), h('th', {}, money(tb.debit)), h('th', {}, money(tb.credit)),
          h('th', { class: tb.balanced ? 'pass' : 'fail' }, tb.balanced ? 'Balanced' : `Off by ${money(tb.debit - tb.credit)}`))),
      h('h4', {}, `Journal entries (${entries.length})`),
      !entries.length && h('p', { class: 'muted' }, 'None posted yet.'),
      entries.length > 0 && h('table', {},
        h('tr', {}, h('th', {}, 'Entry'), h('th', {}, 'Claim'), h('th', {}, 'Account'), h('th', {}, 'Debit'), h('th', {}, 'Credit'), h('th', {}, 'Memo'), h('th', {}, 'Posted')),
        entries.flatMap(lines => lines.map((l, i) => h('tr', {},
          h('td', {}, i === 0 ? `${l.journalId} ${l.journal}` : ''),
          h('td', {}, i === 0 ? h('button', { class: 'link', onclick: () => openClaim(l.claimId) }, `#${l.claimId}`) : ''),
          h('td', {}, l.account), h('td', {}, l.debitCents ? money(l.debitCents) : ''), h('td', {}, l.creditCents ? money(l.creditCents) : ''),
          h('td', { class: 'muted' }, l.memo), h('td', { class: 'muted' }, i === 0 ? `${date(l.postedAt)} by ${l.postedBy}` : '')))))),
  ];
}
