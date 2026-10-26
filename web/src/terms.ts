// Finance definitions on the Settlements and Costs tabs. Terms open immediately on hover and focus;
// clicking keeps the definition open until another click or Escape. The tooltip lives outside the
// redrawn app. Words with an everyday meaning are matched only where they are a label.

import { h } from './lib';

/** Earlier entries win where two match at the same place, so longer phrases come first. A selector,
 * when given, is where the term counts: "Venue" is a column of amounts in a header, a cost center in a row. */
const TERMS: [RegExp, string, string?][] = [
  // The accounts the claims post to, and the ones the costs tab adds next to them.
  [/\bclaims_expense\b/, 'Expense account: what claims cost the venue once the insurer\'s share is taken off.'],
  [/\bclaims_reserve\b/, 'Liability account: payouts the venue expects to make and has not paid yet.'],
  [/\binsurer_receivable\b/, 'Asset account: what the insurer owes the venue and has not paid back yet.'],
  [/\boperating_expense\b/, 'Expense account for the event\'s running costs, split by cost center.'],
  [/\baccounts_payable\b/, 'Liability account: vendor bills the venue has approved and not paid yet.'],
  [/\baccrued_liabilities\b/, 'Liability account: work done for the event that no bill covers yet.'],
  [/\bmerch_revenue\b/, 'Revenue account: what merch sales brought in.'],
  [/\battendee_receivable\b/, 'Asset account: what the people responsible were charged and have not paid yet.'],
  [/\binsurer_payable\b/, 'Liability account: the insurer\'s share of a charge, which repays what it paid on the claim.'],
  [/^cash$|(?<=[DC]r )cash\b/, 'Asset account: the venue\'s money, paid out to claimants and received from the insurer.'],

  // The claims' journals.
  [/\bJ1r(?: reserve reversal)?\b/, 'Journal entry that releases a reserve when its claim is refused.'],
  [/\bJ1(?: reserve)?\b/, 'Journal entry that sets the payout aside when the claim opens: the accrual.'],
  [/\bJ2(?: receivable)?\b/, 'Journal entry that books the insurer\'s share as owed to the venue.'],
  [/\bJ3(?: claimant payment)?\b/, 'Journal entry for the payment run: the payout leaves the venue\'s cash.'],
  [/\bJ4(?: reconciliation)?\b/, 'Journal entry for cash application: the insurer\'s payment is matched to what it owed.'],
  [/\bJ5r(?: charge waived)?\b/, 'Journal entry that cancels a charge the organizer waived or the attendee disputed.'],
  [/\bJ5(?: charge)?\b/, 'Journal entry that books an approved charge as owed by the person responsible: the insurer\'s share and the deductible.'],
  [/\bJ6(?: charge payment)?\b/, 'Journal entry for cash application: the person responsible paid their charge from their wallet.'],

  // Bookkeeping.
  [/\btrial balance\b/i, 'Every account\'s total debits and credits; the two totals must match.'],
  [/\bjournal entr(?:y|ies)\b/i, 'A dated posting that moves an amount between accounts, with equal debits and credits.'],
  [/\bgeneral ledger\b|\bGL account\b/i, 'The venue\'s accounts and every amount posted to them.'],
  [/\bchart of accounts\b/i, 'The list of accounts the venue posts to.'],
  [/\bsubledger\b/i, 'A detailed list, such as every vendor bill, whose total ties to one ledger account.'],
  [/^journals?\b/i, 'The journal entries, in the order they were posted.'],
  [/\bledger\b/i, 'Every journal entry, kept by account.'],
  [/^debits?$/i, 'The left side of an entry: it raises an asset or expense and lowers a liability.'],
  [/\bDr(?= (?:[a-z_]+ )?\$)/, 'Debit, the left side of an entry: it raises an asset or expense and lowers a liability.'],
  [/^credits?$/i, 'The right side of an entry: it lowers an asset or expense and raises a liability.'],
  [/\bCr(?= (?:[a-z_]+ )?\$)/, 'Credit, the right side of an entry: it lowers an asset or expense and raises a liability.'],
  [/^account$/i, 'A ledger account that amounts are posted to.', 'th'],
  [/^entry$/i, 'One journal entry: amounts moved between accounts, with equal debits and credits.', 'th'],
  [/^lines$/i, 'The entry\'s debits (Dr) and credits (Cr), account by account.', 'th'],
  [/^balance$/i, 'The account\'s debits minus its credits.'],
  [/^balanced$/i, 'Total debits equal total credits, so the books add up.'],
  [/^off by\b/i, 'Total debits and credits differ by this much, so something was posted wrong.'],
  [/\bposted\b/i, 'Written to the ledger as a journal entry.'],
  [/\bcost centers?\b/i, 'The part of the event a cost is charged to, such as Medical or Venue.'],
  [/\bmateriality(?: threshold)?\b/i, 'The size of difference small enough to accept without a person looking at it.'],
  [/\bevent close\b/i, 'The organizer\'s sign-off that the event\'s books are complete and reconciled.'],
  [/\bsegregation of duties\b/i, 'The person who requests a payment is never the one who approves it.'],
  [/\bprecedents?\b/i, 'An earlier decision by the organizer on a claim of the same kind, kept as the evidence a rule rests on.'],
  [/\bpolicy limit\b/i, 'The most the venue\'s insurance policy pays on one claim.'],
  [/\bcontroller\b/i, 'The person who keeps the event\'s books and signs them off.'],

  // Costs and bills.
  [/\baccounts payable\b/i, 'Vendor bills the venue has approved and not paid yet.'],
  [/\baccru(?:als?|ed)\b/i, 'Recorded as a cost when it happens, before any money is paid.'],
  [/\bcash application\b/i, 'Matching money received to what was owed, here the insurer\'s payment to its receivable.'],
  [/\bpayment run\b/i, 'The batch of approved payments the venue sends out.'],
  [/\bbudget\b/i, 'What the event planned to spend.'],
  [/^actuals?\b|\bagainst actuals?\b/i, 'What was actually spent: accrued plus billed.'],
  [/\bvariance\b/i, 'The difference between the budget and the actual cost.'],
  [/\bbills?\b|^Bills?$/, 'What a vendor or clinic charges the venue for its work.'],
  [/\bbilled\b/i, 'What the clinic or vendor charged, before any price check.'],
  [/\binvoice\b/i, 'The clinic\'s bill for the visit.'],
  [/\bfee schedule\b/i, 'The policy\'s list of the most it pays for each medical service.'],
  [/^allowed$/i, 'The most the fee schedule pays for this service.'],
  [/^covered$/i, 'Paid by the venue\'s policy, after the fee schedule\'s caps and exclusions.'],
  [/\bcovered(?= \$)/i, 'The part of the bill the venue\'s policy pays, after the fee schedule\'s caps and exclusions.'],
  [/^reduced\b/i, 'Paid only up to the fee schedule\'s cap for this service.'],
  [/^excluded\b/i, 'Not paid: the policy does not cover this service.'],
  [/\bnot covered\b|\boutside venue cover\b/i, 'The part of a decided claim\'s bill outside its venue payout. Medical costs may be paid by the attendee\'s own health plan; property costs stay with the venue.'],
  [/^cost$/i, 'What the incident cost before any cover: the bill or the repair cost.'],

  // Merch and the booths.
  [/\bnet cost\b/i, 'Claims cost less approved venue recoveries and event earnings from merch. A negative amount means earnings and recoveries exceed those costs; this is not the event\'s cash balance.'],
  [/\bpaid orders\b/i, 'Merch orders whose wallet payment completed. Pending and failed orders do not count.'],
  [/\bgross sales\b/i, 'The total charged for paid merch orders, before printing and the booth shares. Pending and failed orders do not count.'],
  [/\bevent (?:revenue|earnings)\b/i, 'Paid merch sales less the estimated print costs and booth shares: the amount the event keeps.'],
  [/^revenue$/i, 'Money from paid merch orders. Gross sales include printing and booth shares; event revenue is the amount the event keeps.'],
  [/\b(?:expected|approved) recoveries\b/i, 'The venue\'s share of approved property charges, including amounts the responsible attendees have not paid yet.'],
  [/\bcollected recoveries\b|\bvenue recoveries collected\b/i, 'The venue\'s share of property charges that responsible attendees have paid. The insurer\'s share is excluded.'],
  [/\bclaims cost\b/i, 'The claim amounts the venue carries after the insurer\'s recorded share, plus uncovered property losses. Reserved payouts not yet paid are included.'],
  [/\buncovered property\b/i, 'The repair costs and stolen-item values left outside the venue\'s claim payouts.'],
  [/\bcash paid\b|\bclaim payments\b/i, 'Claim payouts recorded as paid to attendees and repair vendors. This excludes reserved payouts still waiting for payment.'],
  [/\binsurer received\b/i, 'Payments received from the insurer and recorded against what it owed for claims.'],
  [/\binsurer outstanding\b/i, 'The insurer\'s recorded share of claims that has not been received yet.'],
  [/\bcharges collected\b/i, 'Payments received from responsible attendees for approved property charges, including the venue\'s share and the insurer\'s share.'],
  [/\bcharges outstanding\b/i, 'Approved property charges that responsible attendees have not paid yet.'],
  [/\bbooth share\b/i, 'Paid sponsor-product sales less the estimated print cost and the event\'s 10% fee. This amount is owed to the booths; it is not a recorded transfer to them.'],
  [/\bprint cost\b/i, 'An estimate per paid item: $8 for a T-shirt, $5 for a mug and $3 for a poster. No printing payment is recorded here.'],
  [/\b(?:merch )?margin\b/i, 'What the event keeps from merch after the print cost and what it owes the booths.'],
  [/^sales$/i, 'What attendees paid for the products from their wallets.', 'th'],
  [/^fee$/i, 'The event\'s 10% of the booth\'s sales, for running the shop.', 'th'],
  [/\bowed to booths?\b/i, 'What the event owes the booths: their sales less the estimated print cost and the event\'s fee. No transfer to the booths is recorded here.'],
  [/^booths$/i, 'What the event owes the sponsor booths for the products that name them.', 'th'],
  [/^loss$/i, 'What the incidents at the booth\'s table cost before anyone paid.', 'th'],
  [/^charged$/i, 'What the people responsible were charged: it repays the insurer\'s share, and the deductible goes to the venue.', 'th'],
  [/^recovered$/i, 'The venue\'s part of the charges: the deductible it carried on its own equipment, broken or stolen.', 'th'],

  // Insurance.
  [/\bdeductibles?\b/i, 'The part of each covered loss the venue pays itself before the insurer pays.'],
  [/\bper[- ]claim limit\b|\bup to \$[\d,]+(?:\.\d\d)? a claim\b/i, 'The most the policy pays on any one claim.'],
  [/\baggregate(?: limit)?\b|\$[\d,]+(?:\.\d\d)? left\b/i, 'The most the policy pays across all claims at the event, and what is left of it.'],
  [/\bmedical payments(?: cover)?\b/i, 'Cover that pays an injured attendee\'s medical bills, whoever was at fault.'],
  [/\bproperty cover\b/i, 'The venue\'s property policy: it pays to repair the venue\'s own equipment, or replace what was stolen from it, above its deductible.'],
  [/\bfirst notice of loss\b/i, 'The first report of a claim, sent to the insurer.'],
  [/\bclaimants?\b/i, 'The person a claim pays.'],
  [/\bpayouts?\b/i, 'What the venue pays the claimant, or the repair vendor, on a claim.'],
  [/\breserves?\b|^reserved\b/i, 'Money set aside for a payout the venue expects to make.'],
  [/\bstill to pay\b/i, 'Reserves accrued and not paid yet.'],
  [/\brecovery letters?\b/i, 'A letter asking whoever damaged or took the venue\'s equipment to pay for it.'],
  [/\brecoverable\b|\bpays back\b/i, 'The insurer\'s share of the payout, which it pays back to the venue under the policy.'],
  [/\brecover(?:y|ies)(?= posted)|^recover(?:y|ies)$|\brecoveries\b/i, 'Money the venue gets back from its insurer, or from whoever caused the loss.'],
  [/\bnot recovered\b/i, 'Reserved payouts whose insurer share is not booked as owed yet.'],
  [/\breceivables?\b|\binsurer owes\b|\bstill owes\b/i, 'Money owed to the venue, here by the insurer, and not paid yet.'],
  [/\b(?:insurer )?short pa(?:y|ys|id|yments?)\b|\bshort-paid\b|\b(?:insurer )?paid less than recoverable\b/i, 'When the insurer pays less than it owes; the venue carries the difference.'],
  [/\b(?:insurer )?paid more than recoverable\b/i, 'When the insurer pays more than it owes; the venue\'s cost drops by the difference.'],
  [/\binsurer paid\b|\bpaid back\b/i, 'What the insurer has paid back so far.'],
  [/\bpaid out\b|^paid\b/i, 'Paid to the claimant or the repair vendor.'],
  [/\bvenue'?s cost\b|\bvenue carries\b/i, 'What the claim costs the venue after the insurer\'s share: its deductible and any short payment.'],
  [/^venue$/i, 'What the claims cost the venue itself, after the insurer\'s share.', 'th'],
  [/^insurer$/i, 'What the venue\'s insurer pays back on the claims, paid and still owed.', 'th'],
  [/^attendees$|^attendee \/ plan$/i, 'Medical costs outside the venue payout, payable by the attendee\'s health plan and the attendee. This does not mean the attendee personally owes the whole amount.', 'th'],
  [/^unpaid$/i, 'Reserves accrued and not paid out yet.', 'th'],
  [/\breconcil(?:ed|iation|e)\b/i, 'Matched the insurer\'s payment to what it owed and posted any difference.'],
  [/^settled\b/i, 'Paid out to the claimant; the insurer may still owe its share.'],
  [/\bsettlements?\b/i, 'Paying a claim and recording who pays what on it.'],
  [/\bcopays?\b/i, 'The fixed amount the attendee\'s own plan leaves them to pay for a visit.'],
  [/\brule ceiling\b|^ceiling\b|\bauthority\b/i, 'The most an approved rule lets the venue pay without asking a person.'],
  [/\bpayment rules?\b/i, 'A standing approval: claims of this kind up to its ceiling are paid without asking.'],
  [/\bapprovers?\b/i, 'The person who signs off a payment; never the one who asked for it.'],
];

/** Text in these is never wrapped: controls and anything already defined. */
const SKIP = 'abbr, a, button, input, option, select, summary, textarea, script, style';

/** The same terms, searchable from any place in a text: ^ and $ still mean the whole text. */
const SEARCH = TERMS.map(([re, title, where]) => [new RegExp(re.source, `${re.flags}g`), title, where] as const);

let tooltip: HTMLElement | undefined;
let active: HTMLElement | undefined;
let hovered: HTMLElement | undefined;
let focused: HTMLElement | undefined;
let pinned = false;
let overTooltip = false;
let scope = '';
let closeTimer: ReturnType<typeof setTimeout> | undefined;

function closeDefinition() {
  active?.removeAttribute('aria-describedby');
  active?.setAttribute('aria-expanded', 'false');
  active = undefined;
  pinned = false;
  overTooltip = false;
  if (tooltip) tooltip.hidden = true;
}

function positionDefinition() {
  if (!active || !tooltip) return;
  const box = active.getBoundingClientRect();
  if (!active.isConnected || box.bottom < 0 || box.top > innerHeight) return closeDefinition();
  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;
  tooltip.style.left = `${Math.max(8, Math.min(box.left, innerWidth - width - 8))}px`;
  tooltip.style.top = `${Math.max(8, box.bottom + height + 6 > innerHeight ? box.top - height - 6 : box.bottom + 6)}px`;
}

function closeWhenIdle() {
  clearTimeout(closeTimer);
  // Keep the definition visible while the pointer crosses the gap to its text.
  closeTimer = setTimeout(() => {
    if (!pinned && !overTooltip && active !== hovered && active !== focused) closeDefinition();
  }, 120);
}

function showDefinition(term: HTMLElement, context: string) {
  clearTimeout(closeTimer);
  if (active !== term) closeDefinition();
  active = term;
  scope = context;
  tooltip!.replaceChildren(h('b', {}, `${term.textContent}: `), term.dataset.definition!);
  tooltip!.hidden = false;
  term.setAttribute('aria-describedby', tooltip!.id);
  term.setAttribute('aria-expanded', 'true');
  positionDefinition();
}

function definition(label: string, text: string, context: string) {
  const term = h('button', { type: 'button', class: 'finance-term', 'data-definition': text, 'aria-expanded': 'false' }, label);
  term.addEventListener('pointerenter', () => { hovered = term; if (!pinned) showDefinition(term, context); });
  term.addEventListener('pointerleave', () => { if (hovered === term) hovered = undefined; closeWhenIdle(); });
  term.addEventListener('focus', () => { focused = term; showDefinition(term, context); });
  term.addEventListener('blur', () => { focused = undefined; pinned = false; closeWhenIdle(); });
  term.addEventListener('click', () => {
    if (active === term && pinned) closeDefinition();
    else { showDefinition(term, context); pinned = true; }
  });
  return term;
}

/** Holds the page steady while a definition is read, and releases it when changing tabs. */
export function readingDefinition(context: string): boolean {
  if (active && (scope !== context || !active.isConnected)) closeDefinition();
  return !!active;
}

function wrap(text: Text, context: string) {
  const s = text.data;
  const parts: (string | HTMLElement)[] = [];
  let at = 0;
  for (;;) {
    let best: { from: number; to: number; title: string } | undefined;
    for (const [re, title, where] of SEARCH) {
      if (where && !text.parentElement?.closest(where)) continue;
      re.lastIndex = at;
      const m = re.exec(s);
      if (m && m[0] && (!best || m.index < best.from)) best = { from: m.index, to: m.index + m[0].length, title };
    }
    if (!best) break;
    parts.push(s.slice(at, best.from), definition(s.slice(best.from, best.to), best.title, context));
    at = best.to;
  }
  if (parts.length) text.replaceWith(...parts, s.slice(at));
}

/** Adds visible, keyboard-accessible definitions without nesting controls or wrapping twice. */
export function defineTerms(root: HTMLElement, context = '') {
  if (!tooltip) {
    tooltip = h('div', { id: 'finance-definition', class: 'finance-definition', role: 'tooltip', hidden: true });
    tooltip.addEventListener('pointerenter', () => { overTooltip = true; clearTimeout(closeTimer); });
    tooltip.addEventListener('pointerleave', () => { overTooltip = false; closeWhenIdle(); });
    document.body.append(tooltip);
    document.addEventListener('pointerdown', e => {
      if (active && !active.contains(e.target as Node) && !tooltip!.contains(e.target as Node)) closeDefinition();
    }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDefinition(); });
    window.addEventListener('resize', positionDefinition);
    document.addEventListener('scroll', positionDefinition, true);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.parentElement?.closest(SKIP)) texts.push(n as Text);
  }
  texts.forEach(text => wrap(text, context));
}
