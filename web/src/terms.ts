// Hover definitions for the finance terms on the Settlements and Costs tabs. After each redraw, every
// term in the tab's text is wrapped in an <abbr> whose title is one plain sentence, in the words
// Hyphenate's track uses. Free text such as an attendee's statement only matches the phrases below,
// so words with an everyday meaning (balance, credit, recovery) are matched only where they are a label.

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
  [/^cash$|(?<=[DC]r )cash\b/, 'Asset account: the venue\'s money, paid out to claimants and received from the insurer.'],

  // The claims' journals.
  [/\bJ1r(?: reserve reversal)?\b/, 'Journal entry that releases a reserve when its claim is refused.'],
  [/\bJ1(?: reserve)?\b/, 'Journal entry that sets the payout aside when the claim opens: the accrual.'],
  [/\bJ2(?: receivable)?\b/, 'Journal entry that books the insurer\'s share as owed to the venue.'],
  [/\bJ3(?: claimant payment)?\b/, 'Journal entry for the payment run: the payout leaves the venue\'s cash.'],
  [/\bJ4(?: reconciliation)?\b/, 'Journal entry for cash application: the insurer\'s payment is matched to what it owed.'],
  [/\bJ5r(?: charge waived)?\b/, 'Journal entry that cancels a charge the organizer waived or the attendee disputed.'],
  [/\bJ5(?: charge)?\b/, 'Journal entry that books an approved charge as owed by the person responsible.'],
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
  [/\bnot covered\b/i, 'The part of the bill the policy does not pay, left to the attendee or their health plan.'],
  [/^cost$/i, 'What the incident cost before any cover: the bill or the repair cost.'],

  // Merch and the booths.
  [/\bnet cost\b/i, 'What the claims cost the venue, less its part of the charges and the merch margin.'],
  [/\bprint cost\b/i, 'What the print shop bills to make the products: the cost of goods sold.'],
  [/\b(?:merch )?margin\b/i, 'What the event keeps from merch after the print cost and what it owes the booths.'],
  [/^sales$/i, 'What attendees paid for the products from their wallets.', 'th'],
  [/^fee$/i, 'The event\'s 10% of the booth\'s sales, for running the shop.', 'th'],
  [/\bowed to booth\b/i, 'What the event pays the booth: its sales less the print cost and the event\'s fee.'],
  [/^booths$/i, 'What the event owes the sponsor booths for the products that name them.', 'th'],
  [/^loss$/i, 'What the incidents at the booth\'s table cost before anyone paid.', 'th'],
  [/^charged$/i, 'What the people responsible were charged, once the organizer approved it.', 'th'],
  [/^recovered$/i, 'The venue\'s part of the charges: up to what it carried itself on its own equipment.', 'th'],

  // Insurance.
  [/\bdeductibles?\b/i, 'The part of each covered loss the venue pays itself before the insurer pays.'],
  [/\bper[- ]claim limit\b|\bup to \$[\d,]+(?:\.\d\d)? a claim\b/i, 'The most the policy pays on any one claim.'],
  [/\baggregate(?: limit)?\b|\$[\d,]+(?:\.\d\d)? left\b/i, 'The most the policy pays across all claims at the event, and what is left of it.'],
  [/\bmedical payments(?: cover)?\b/i, 'Cover that pays an injured attendee\'s medical bills, whoever was at fault.'],
  [/\bproperty cover\b/i, 'Cover that pays to repair or replace the venue\'s own equipment.'],
  [/\bfirst notice of loss\b/i, 'The first report of a claim, sent to the insurer.'],
  [/\bclaimants?\b/i, 'The person a claim pays.'],
  [/\bpayouts?\b/i, 'What the venue pays the claimant, or the repair vendor, on a claim.'],
  [/\breserves?\b|^reserved\b/i, 'Money set aside for a payout the venue expects to make.'],
  [/\bstill to pay\b/i, 'Reserves accrued and not paid yet.'],
  [/\brecovery letters?\b/i, 'A letter asking whoever damaged the venue\'s equipment to pay for the repair.'],
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
  [/^attendees$/i, 'What Medical claims did not cover, left to attendees or their health plans.', 'th'],
  [/^unpaid$/i, 'Reserves accrued and not paid out yet.', 'th'],
  [/\breconcil(?:ed|iation|e)\b/i, 'Matched the insurer\'s payment to what it owed and posted any difference.'],
  [/^settled\b/i, 'Paid out to the claimant; the insurer may still owe its share.'],
  [/\bsettlements?\b/i, 'Paying a claim and recording who pays what on it.'],
  [/\bcopays?\b/i, 'The fixed amount the attendee\'s own plan leaves them to pay for a visit.'],
  [/\brule ceiling\b|^ceiling\b|\bauthority\b/i, 'The most a learned rule lets the venue pay without asking a person.'],
  [/\blearned (?:payment )?rules?\b/i, 'A standing approval: claims of this kind up to its ceiling are paid without asking.'],
  [/\bapprovers?\b/i, 'The person who signs off a payment; never the one who asked for it.'],
];

/** Text in these is never wrapped: controls and anything already defined. */
const SKIP = 'abbr, button, input, option, select, textarea, script, style';

/** The same terms, searchable from any place in a text: ^ and $ still mean the whole text. */
const SEARCH = TERMS.map(([re, title, where]) => [new RegExp(re.source, `${re.flags}g`), title, where] as const);

function wrap(text: Text) {
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
    parts.push(s.slice(at, best.from), h('abbr', { title: best.title }, s.slice(best.from, best.to)));
    at = best.to;
  }
  if (parts.length) text.replaceWith(...parts, s.slice(at));
}

/** Wraps every finance term under `root` in an <abbr> that defines it on hover. */
export function defineTerms(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.parentElement?.closest(SKIP)) texts.push(n as Text);
  }
  texts.forEach(wrap);
}
