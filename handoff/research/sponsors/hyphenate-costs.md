# Hyphenate fit for the event costs tab

Read 2026-10-25. Sources: the full Hyphenate track doc (read through Google Drive), `research/sponsor-tracks.md`, System Design `Insurance.md` and `Capital-One-Nessie.md`, and web search results for hyphenate.ai. The container's network blocks hyphenate.ai itself, so the product wording below comes from search-result summaries of its pages, not from the pages directly.

## What Hyphenate does

Hyphenate (Maximor until its rebrand on 2026-10-01, New York, $9M seed led by Foundation Capital) sells "autonomous finance": agents that sit on top of a company's existing ERP and own finance work through to the outcome. It covers five areas of the office of the CFO: order-to-cash, treasury, GL accounting and close, procure-to-pay, and reporting and insights.

Their pitch is that only real exceptions reach a person. They claim 98% of the work they touch runs on its own and about 2% of transactions escalate to a person before posting.

The product wording that matters for costs:

- **Procure-to-pay:** vendor bills are read and coded when they arrive, accrued automatically, and complex bills are split by department or class. Only exceptions reach a person.
- **GL accounting and close:** a close checklist whose rows can each run an agent.
- **Treasury:** cash application, transaction matching and bank reconciliations.

## What the track asks for costs

The workflows in the track doc that fit operational costs, quoted:

> **Accounts Payable.** Bills arrive in every format, approvals stall, and a vendor's bank details change the day before a large payment.

> **Accruals.** Costs for work done but not yet billed get estimated, confirmed with vendors, and reversed when the bill finally arrives.

> **FP&A.** Budgets, forecasts and budget against actuals, with every variance traced to what drove it, plus margin and pricing analysis the business can act on.

> **Close & Consolidation.** Reconciliations, flux, controls and sign-offs that finalize a month, subsidiaries that roll up cleanly, and auditors' requests answered with evidence from the books.

Their "Key concepts" list is the vocabulary judges will expect used correctly: double-entry bookkeeping, general ledger, chart of accounts, journal entry, subledger, system of record, reconciliation, period close, materiality, internal controls, segregation of duties, audit trail, controller.

## Recommendation: the tab is the event's procure-to-pay and close

The costs tab is the event's books for the organizer, who acts as the controller. It reads the same double-entry `ledger_entry` journals the claims already post, so every number on it agrees with the Claims tab. It never keeps a second set of totals.

Seats line for the Devpost, extending the current one: the claims adjuster, the claims payments clerk and the event's accounts payable clerk, with the organizer as the one approver.

Views, in order:

1. **Costs to date by cost center.** One row per cost center (Venue, Staffing, Production, Bands and gateways, Insurance, Platform). Columns: Budget, Accrued, Billed, Paid, Actual (accrued plus billed), Variance. Each variance links to the bills and journals that drove it.
2. **Bills.** The accounts payable subledger: vendor, cost center, GL account, amount, status (received, coded, approved, paid), requested by, approved by. The requester can never be the approver.
3. **Accruals.** Work done but not yet billed, such as medic hours or the speaker repair before the vendor's bill. Each accrual reverses when its bill arrives.
4. **Journal.** Every posted journal entry, with its reason, who posted it and the claim or bill it traces to. The claims journals J1 to J4 appear here unchanged.
5. **Event close.** A checklist the organizer signs off: every bill matched and coded, every accrual reversed or confirmed, the insurer receivable reconciled (J4), wallet payouts matched to the bank records, and differences under the materiality threshold accepted by code. Differences above it go to the organizer.

Chart of accounts to add next to the four claims accounts: `operating_expense` per cost center, `accounts_payable` (liability), `accrued_liabilities` (liability). Merch takings, if shown, go to `merch_revenue`, so the tab can show the net event cost.

## Terms to use

| Use | Instead of |
|---|---|
| bill (what a vendor sends the venue) | invoice (that is what the venue sends its customers) |
| cost center | category |
| accrued, billed, paid | pending, done |
| budget against actual, variance | over or under |
| journal entry, posted | transaction, logged |
| reconciled | matched, checked |
| approver, requester | user, admin |
| event close | finalize |
| materiality threshold | tolerance |

## How claims map onto the tab

- **J1 reserve** is an accrual: a cost for something that happened and is not yet paid. It shows as Accrued under Insurance.
- **Bill review** ($1,308 cut to $895 by the fee schedule) is accounts payable: the urgent-care bill is a bill, and the fee schedule is the price check before approval.
- **J3 claimant payment** to the attendee's wallet is the payment run, shown as Paid.
- **J2 insurer receivable and J4 reconciliation** are cash application: the insurer's payment is matched to the receivable, and a short payment (the $10 one) posts its difference. The Insurance row shows payouts minus recoveries.
- **The property claim** ($2,400 speaker repair) is one cost under Production, with the insurer recovery as its offset. It is counted once, never under both Production and Insurance.
- **Learned rules** are an approval policy: the organizer's approval with "learn" sets a standing limit for that claim shape. The medic files and the organizer approves, which is segregation of duties. A stale approval failing closed is an internal control.

## A moment for the costs tab

Hyphenate's first "hard part" is sources that disagree. The strongest fit for BandIt is a per-head bill checked against the exact count from the bands: the contract gives a rate per attendee, the bill states a headcount, and the bands know exactly how many people checked in. When the bill is higher, the agent holds it, shows the three numbers side by side and sends it to the organizer instead of paying it. This is a recommendation for the build thread; the README does not have it yet.

## Sources

- Hyphenate track doc: https://docs.google.com/document/d/1u4iN8R97ILY3kfHTPKC82zdutHrGx4ze5eCAP-J92w4/edit
- https://hyphenate.ai/platform, https://hyphenate.ai/gl-accounting, https://hyphenate.ai/treasury, https://hyphenate.ai/cfo (through search summaries)
- https://hyphenate.ai/press/maximor-rebrand-hyphenate
- https://thenextweb.com/news/maximor-rebrands-hyphenate-86x-growth-autonomous-finance
- https://agilebrandguide.com/maximor-rebrands-as-hyphenate-after-86x-yoy-growth-expanding-across-the-office-of-the-cfo/
