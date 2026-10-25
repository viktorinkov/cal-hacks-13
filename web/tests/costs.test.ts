import { expect, test } from 'bun:test';
import { claimLine, margin, merchBooks, rollUp } from '../src/costs';
import type { BoardMerchOrder, Claim, LedgerEntry, MerchTemplate } from '../src/module_bindings/types';

const claim = { id: 1n, status: { tag: 'Settled' }, coverKind: 'property', costCents: 240000n, payoutCents: 240000n, venueCostCents: 50000n } as Claim;
const entry = (journal: string, account: string, debitCents: bigint, creditCents: bigint) => ({ claimId: 1n, journal, account, debitCents, creditCents }) as LedgerEntry;
const paidClaim = [
  entry('J1 reserve', 'claims_expense', 240000n, 0n), entry('J1 reserve', 'claims_reserve', 0n, 240000n),
  entry('J2 receivable', 'insurer_receivable', 190000n, 0n), entry('J2 receivable', 'claims_expense', 0n, 190000n),
  entry('J3 claimant payment', 'claims_reserve', 240000n, 0n), entry('J3 claimant payment', 'cash', 0n, 240000n),
];
const charge = [
  entry('J5 charge', 'attendee_receivable', 240000n, 0n),
  entry('J5 charge', 'insurer_payable', 0n, 190000n), entry('J5 charge', 'recoveries', 0n, 50000n),
];

test('charge approval is outstanding until the attendee pays; collection keeps only the venue share', () => {
  const before = claimLine(claim, [...paidClaim, ...charge], []);
  expect(before.recovered).toBe(50000n);
  expect(before.chargesOutstanding).toBe(240000n);
  expect(before.recoveryCollected).toBe(0n);
  const after = claimLine(claim, [...paidClaim, ...charge,
    entry('J6 charge payment', 'cash', 240000n, 0n), entry('J6 charge payment', 'attendee_receivable', 0n, 240000n)], []);
  expect(after.chargesCollected).toBe(240000n);
  expect(after.chargesOutstanding).toBe(0n);
  expect(after.recoveryCollected).toBe(50000n);
  expect(after.venueCost).toBe(50000n);
});

test('a waived charge removes the expected recovery without inventing a collection', () => {
  const line = claimLine(claim, [...paidClaim, ...charge,
    entry('J5r charge waived', 'attendee_receivable', 0n, 240000n),
    entry('J5r charge waived', 'insurer_payable', 190000n, 0n), entry('J5r charge waived', 'recoveries', 50000n, 0n)], []);
  expect(line.recovered).toBe(0n);
  expect(line.chargesOutstanding).toBe(0n);
  expect(line.recoveryCollected).toBe(0n);
});

test('final insurer short payment closes the receivable and raises the venue cost', () => {
  const line = claimLine({ ...claim, status: { tag: 'Reconciled' } }, [...paidClaim,
    entry('J4 reconciliation', 'cash', 180000n, 0n), entry('J4 reconciliation', 'insurer_receivable', 0n, 190000n),
    entry('J4 reconciliation', 'claims_expense', 10000n, 0n)], []);
  expect(line.insurerOwes).toBe(0n);
  expect(line.insurerPaid).toBe(180000n);
  expect(line.shortPaid).toBe(10000n);
  expect(line.venueCost).toBe(60000n);
});

test('paid sponsor and plain orders produce revenue without claims and preserve cents across booths', () => {
  const templates = [
    { id: 1n, kind: 'mug', boothIds: [3n, 2n, 1n] },
    { id: 2n, kind: 'poster', boothIds: [] },
  ] as MerchTemplate[];
  const orders = [
    { templateId: 1n, amountCents: 1801n, status: 'paid' },
    { templateId: 2n, amountCents: 1500n, status: 'paid' },
    { templateId: 1n, amountCents: 1801n, status: 'paying' },
    { templateId: 1n, amountCents: 1801n, status: 'failed' },
  ] as BoardMerchOrder[];
  const books = merchBooks(orders, templates);
  expect(books.total).toEqual({ orders: 2, sales: 3301n, print: 800n, fee: 180n, owed: 1121n });
  expect([...books.booths.values()].reduce((s, b) => s + b.owed, 0n)).toBe(1121n);
  expect(margin(books.total)).toBe(1380n);
  const empty = rollUp([], [], []).total;
  expect(empty.venueCost - empty.recovered - margin(books.total)).toBe(-1380n);
});
