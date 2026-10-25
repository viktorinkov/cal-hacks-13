# Who pays whom when an attendee is hurt

Saved from https://claude.ai/artifact/TxT4goi1WpqP8RDcZRCjSm, last updated 2026-10-25.

## Short answer

Yes, the insurers pay, not the venue. BandIt settles one flow: the venue's insurer paying the injured attendee, through the event's claims desk, which pays from a claims fund the insurer refills. The attendee's own plan (UC SHIP) pays what the venue's cover leaves, under its own terms, and BandIt is not part of that.

The injury model mostly makes sense, but the docs leave out who is on each side. They never say that BandIt acts for the venue's insurer, who paid the clinic, or where the rest of the bill goes: Jordan gets $895 of his $1,308 bill, and the other $413 and his health plan simply vanish. If a booth or another person caused an injury, the insurers that paid should recover from that party's insurer, and nothing says so.

Three parts do not make sense. The speaker is paid from a liability policy, which never covers the venue's own equipment. On the charges branch the venue keeps both the insurer's $1,900 and the attendee's $2,400 for one $2,400 speaker, and BandIt fronts theft claims it has no way to collect from the attendee's insurer. Five changes fix it (the last section).

**Update, later on Oct 25:** vik-e2e has since fixed the speaker (the property policy pays, and a charge repays the insurer's share through `insurer_payable`). The Bright Data plan lookup now brings in the attendee's real plan terms (copays, deductible, coinsurance), so the health plan's share can be computed instead of vanishing; the amounts code does not use them yet. What still does not fit a venue platform is the venue paying for belongings from its own fund.

## How it works in reality

An injury sets off up to three separate money flows. The venue's medical payments cover and the attendee's health plan split the bill, and the insurers that paid recover from whoever caused it. No dollar is paid twice.

| Party | Role on an injury | Pays | Is paid |
| --- | --- | --- | --- |
| Attendee (injured) | the person with the medical cost | the copay, deductible or coinsurance their plan leaves them | the venue's medical payments cover pays back what they paid |
| On-site medic | event staff | nothing | the event pays them as staff; first aid is not billed to the attendee |
| Clinic or hospital | treats and bills | nothing | the health plan's allowed amount plus the attendee's copay |
| Attendee's health plan (UC SHIP, Berkeley SHIP) | the attendee's own insurance; second to the venue's medical payments cover when that pays first | its allowed amount to the clinic | recovers what it paid from the party at fault, when there is one |
| Venue or organizer | the insured under the venue's policy | only a deductible or self-insured retention, when its policy has one | nothing |
| Venue's insurer, liability policy | medical payments cover: no fault, small limit; liability cover: only when the venue was negligent | the attendee's remaining medical cost; damages on a liability claim | recovers from the party at fault |
| Sponsor booth | an exhibitor with its own liability policy, primary over the venue's | its insurer pays when its booth caused the injury | nothing |
| Person at fault (another attendee) | caused the injury | their own liability insurance, usually renters or homeowners | nothing |
| BandIt | the event's claims desk | the medical payments payout, from a claims fund | the venue's insurer refills the fund |

The order, for one injury:

1. The medic treats on site. That is an event cost, never billed to the attendee.
2. The clinic bills whoever the attendee names. Usually that is their health plan: the plan pays its allowed amount and the attendee pays the copay. An attendee who pays at the counter is out of pocket for the whole bill instead.
3. The venue's medical payments cover pays without fault, for costs incurred and reported within one year, usually up to $5,000 a person. It pays back what the attendee is out of pocket, and it excludes the venue's own staff, whom workers' compensation covers.
4. The health plan pays what is left. UC SHIP says it is secondary to other insurance, so when the venue's cover pays first, the plan only covers the rest of the bill under its own terms.
5. Only if the venue was negligent and the attendee wants more (pain, lost wages) does the venue's liability cover pay damages. What medical payments already paid is credited against it.
6. If a booth or another person caused the injury, the health plan and the venue's insurer each recover what they paid from that party's insurer. This is subrogation. Exhibitor agreements make the booth's policy primary and name the venue as an additional insured.

Event accident policies for participants, a separate product, are written as excess: they pay only what the participant's own health plan leaves unpaid. That is what BandIt's `excess` term describes.

## How BandIt models it today

BandIt keeps the venue's books. Every claim is a venue expense paid from venue cash (J1, J3), and the venue's insurer pays it back (J2, J4). The amount is the clinic's bill priced by the fee schedule, capped by the limits, and paid to the claimant: `payout = min(cost, per-claim limit, aggregate left)`, `recoverable = payout - deductible` (`crates/bandit-insurance/src/coverage.rs`). Read on vik-e2e at `b92b6db`; rows 5 and 6 are on the charges branch (`claude/project-thread-og64w9`, not merged yet).

| # | What BandIt does | Why it is wrong or unclear |
| --- | --- | --- |
| 1 | Pays Jordan $895, the priced urgent-care bill, into his wallet | Right only if Jordan paid the clinic himself, and the docs never say who paid. The other $413 of the bill and his health plan then go nowhere. If the clinic billed his card, $895 is money he never spent. |
| 2 | "The venue's policy says which pays first": `other_insurance` is `primary` or `excess` | Sound in substance: medical payments cover pays first without fault, and UC SHIP says it is secondary to other insurance. But `compute_amounts` ignores the term, the `excess` case (pay only the card's copay) is design only, and the card on file changes no amount. |
| 3 | The venue pays every claim from its cash, then bills its insurer | Unclear, not wrong. An insurer normally pays the claimant directly. A desk that pays first and is refilled is a claims administrator with settlement authority from the insurer. The docs never say BandIt is that. |
| 4 | The speaker is paid by "property cover under the venue's general liability policy" | A liability policy excludes property the insured owns, rents or occupies. The speaker sits on a property or equipment policy, often in the same package policy. |
| 5 | Speaker: the insurer pays $1,900 (J2, J4), the venue carries $500, and the attendee is charged the whole $2,400 into venue `recoveries` (J5, J6) | The venue takes in $4,300 for a $2,400 loss. The Costs tab shows only $500 as Recovered, but no journal pays the $1,900 to the insurer, so the books keep it. Once the insurer has paid, recovering its $1,900 is the insurer's right. |
| 6 | Theft and breakage: BandIt pays the attendee at once, "then collects that payout from the attendee's insurer, the same way it collects from the venue's"; the Costs tab books it under a venue cost center, Belongings | The venue has no contract with the attendee's renters insurer and cannot bill it. That insurer pays its own customer directly, and the loss never belongs on the venue's books. |
| 7 | An injury charges nobody | Right for the attendee, but when a booth's display or another attendee caused it, that party's insurer owes the money, and nothing in BandIt says so. |

Also, `Insurance.md` on vik-e2e links `Incident-Types.md`, which exists only on the charges branch.

What holds up: the evidence pack, the fee schedule as the bill check, the limits and aggregate, the staff exclusion (it is the real workers' compensation rule), the guard and the double-entry ledger itself. The fixes are about who the money goes to, not how a claim is decided.

## A model that makes sense

Keep the injury flow, say who stands on each side of it, and fix the speaker and belongings flows so that each dollar of a loss is paid once, to whoever is out of pocket.

**The statement, for the agent's brief and the top of Insurance.md:**

> BandIt is the event's claims desk. The venue's insurer lets it settle claims under the venue's policy: BandIt pays from a claims fund, and the insurer refills it. For each claim BandIt settles what the loss is, who has already paid part of it, and who owes the rest. It pays each dollar of a loss once, to whoever is out of pocket, and never keeps money another payer is owed.

| Incident | Who is out of pocket | Pays first | Pays the rest | Where BandIt's money goes | Recovered from |
| --- | --- | --- | --- | --- | --- |
| Injury (`fall`, `sos`) | the attendee, who paid the clinic | the venue's medical payments cover: the bill priced by the fee schedule, up to the limits | the attendee's own plan, under its own terms, outside BandIt | the attendee's wallet; the insurer refills the fund in full (no deductible) | nobody is charged; when a booth or another attendee caused it, both insurers recover from that party's insurer |
| Equipment (`property`) | the venue, which pays the repair vendor | the venue's property policy, above the deductible | the venue: the $500 deductible | the repair vendor; the insurer refills all but the deductible | the attendee staff named pays the whole loss once: the deductible back to the venue, the rest passed to the insurer |
| Belongings (`theft`, `breakage`) | the attendee who lost the item | the attendee's own policy, less its deductible | the attendee: their deductible | nothing from the fund; BandIt files the claim with the attendee's insurer, whose payment lands in their wallet | the attendee staff named repays the owner's deductible first, then the owner's insurer |

When the venue's policy writes its medical payments cover as `excess`, the order flips: the plan pays first and BandIt pays only the copay on the card.

**Worked through:**

- Jordan paid the urgent care $1,308 at the counter. BandIt pays him $895, the venue's insurer refills $895, and the determination letter names his plan for the other $413.
- The speaker: BandIt pays the vendor $2,400 and the insurer refills $1,900. The attendee staff named pays $2,400: $500 goes back to the venue and $1,900 to the insurer. Both end even.

**Diagram: who pays whom · an injury and the speaker**

What it shows: Each dollar of a loss is paid once, to whoever is out of pocket.

Text in the diagram, in drawing order:

- Each dollar of a loss is paid once, to whoever is out of pocket
- Solid arrows: money BandIt moves. Dashed: money that moves outside BandIt.
- Injury: Jordan's $1,308 urgent-care bill
- Clinic
- Attendee (paid at the counter)
- BandIt claims fund (the venue's money)
- Venue's insurer (medical payments)
- Health plan (UC SHIP, on the card)
- At-fault insurer (if someone caused it)
- pays the bill, $1,308
- pays $895
- refills $895
- pays its share of the $413
- recovers what it paid
- recovers what the plan paid
- Speaker: a $2,400 repair, and staff named who broke it
- Repair vendor
- BandIt claims fund (the venue's money)
- Venue's insurer (property policy)
- Attendee at fault (named by staff)
- pays $2,400
- refills $1,900
- returns $1,900
- pays the $2,400 charge
- keeps $500, its deductible back

The venue's fund ends even on both: the insurer refills the injury in full, and on the speaker the attendee's $2,400 splits into the venue's $500 and the insurer's $1,900.

**The changes:**

1. Docs and the agent's brief: add the statement above, and say in the scripted run and the live run that the attendee paid the clinic and kept the receipt.
2. Rename "property cover under the venue's general liability policy" to the venue's property policy. The venue's PDF can stay one package policy with a liability part and a property part.
3. Ledger: add `insurer_payable`, a liability for recoveries owed to the insurer. On a property charge, J5 credits `recoveries` up to the venue's share and `insurer_payable` the rest, and a new J7 pays `insurer_payable` to the insurer. The Costs tab then reads Recovered straight from the ledger instead of capping it in the browser.
4. Belongings: no venue journals and no Belongings cost center. The claim becomes a filing with the attendee's insurer, which the run plays the way it plays Northwind Mutual. This drops the instant payout from the venue's fund, so it is your call.
5. Injury amounts: when the venue's cover is `excess`, pay the card's copay; otherwise name the plan for the rest of the bill in the letter. On an injury a booth or another attendee caused, `request_recovery_letter` goes to that party's insurer, as it does for the speaker.

## Sources and what was not checked

The real-world points come from web search results. The container's network blocks the UC health sites, so no page below was opened in full.

- Medical payments cover, no fault, one year, $5,000 typical, staff excluded, credited against a liability award: [open-exam-prep, CGL Coverage C](https://open-exam-prep.com/study-guides/va-property-casualty/national-pc-cgl-1/pcnat-10-coverage-b-c), [CISR module on Coverage C](https://www.riskeducation.org/learn/pluginfile.php/276822/mod_page/content/1/56%20-%204.1%20Section%20One%20Coverage%20C%20-%20Medical%20Payments.pdf)
- UC SHIP is secondary to other insurance except Medi-Cal and TriCare: [UC San Diego UC SHIP FAQ](https://shwadmin.ucsd.edu/uc-ship/faq.html); Berkeley's own plan is issued by Wellfleet: [Berkeley SHIP certificate 2023-24](https://uhs.berkeley.edu/sites/default/files/ship_wf_coc_2023-24.pdf)
- How a health plan recovers from the party at fault: [US Department of Labor, healthcare subrogation](https://www.dol.gov/sites/dolgov/files/ebsa/researchers/analysis/health-and-welfare/trends-and-practices-in-healthcare-subrogation.pdf)
- Participant accident policies are excess over the participant's own plan: [NHRA participant accident FAQ](https://nhra.com/participant-accident-claimants-faq)
- A liability policy excludes property the insured owns, rents or occupies: [PropertyCasualty360](https://propertycasualty360.com/fcs/2008/07/24/rented-or-occupied-property-covered-under-cgl-form)
- Exhibitors' policies are primary and name the venue as additional insured: [GES exhibitor insurance](https://ordering.ges.com/022600448/download/ExhibitorLiabilityInsurance)
- The insured's deductible and the insurer's recovery: [Reed Smith, made whole and deductibles](https://www.reedsmith.com/our-insights/blogs/the-policyholder-perspective/102lp8w/the-made-whole-doctrine-and-deductibles/)
- BandIt today: `System Design/6-features/Insurance.md`, `System Design/5-apps/Organizer-Portal.md`, `crates/bandit-insurance/src/coverage.rs` and `ledger.rs` on vik-e2e; `charges.rs`, `ledger.rs`, `web/src/costs.ts` and `Incident-Types.md` on `claude/project-thread-og64w9`; `research/hyphenate-costs.md` and `research/hyphenate-workshop/taught-rules.md`.

Not checked:

- The subrogation and coordination clauses of the UC SHIP and Berkeley SHIP certificates, and whether they count a venue's medical payments cover as other insurance.
- That medical payments cover ignores the attendee's other insurance comes from the standard liability form as I know it; I could not open the form here.
- A claims desk that pays from a fund the insurer refills is how a third-party claims administrator works; that is general knowledge, not from a source above.
