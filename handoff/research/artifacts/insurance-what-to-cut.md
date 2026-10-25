# Insurance: what to cut, and why

Saved from https://claude.ai/artifact/RgRoWYpkiKa6qudoF1Ez7P, last updated 2026-10-25.

## The cut list

Cut five things. Everything else BandIt built for Hyphenate's track holds up for a platform the venue pays for. All file references are to vik-e2e at `0326f9c`. Where an outside policy form is the ground, it was opened in Chrome on your Mac and is cited by page in the next section.

| # | Cut | What it becomes | Ground |
| --- | --- | --- | --- |
| 1 | The venue paying for an attendee's stolen or broken belonging from its own fund, then "collecting it from their insurer", and the Belongings cost center on the Costs tab | BandIt builds the claim and its evidence for the attendee's own insurer, which pays them; nothing posts to the venue's books. Charges to the person named stay as they are | The renters form's Loss Payment condition pays the policyholder (HO 00 04, p.12); the venue is not a party to it |
| 2 | The `excess` branch of the venue's medical payments cover, and the planned "policies disagree on who pays" complication | The venue's medical payments cover always pays first; the determination letter names the attendee's plan for the rest of the bill | The liability form's Other Insurance condition names only Coverages A and B, not medical payments (CG 00 01, p.12); the Summary of Benefits has no coordination section (CMS instructions, p.2); and the amounts code never used the term |
| 3 | "Owed to the booths" and the 10% event fee on sponsor merch | Merch margin is the price less the print cost; a sponsor's logo on a mug is part of its sponsorship | Judgment, not a source: the payout is computed only in the browser and nothing pays a booth |
| 4 | The incidents column on the booth settlement | Incidents stay on the Claims and Live tabs | It shows a loss next to a booth with no money flowing from it |
| 5 | Two stale rows in the Hyphenate table of Sponsor-Tracks.md: the stolen laptop "paid by BandIt", and the speaker charge "paid to the venue's insurer" alone | The laptop follows cut 1; the speaker charge pays the insurer $1,900 and the venue its $500 deductible | The ledger already splits the charge that way |

Already fixed on vik-e2e, so no longer on the list: the speaker is paid by the venue's property policy, and a charge for it repays the insurer's share instead of the venue keeping it twice.

## Why each cut

### 1. Belongings paid from the venue's fund

What the docs say now. Incident-Types.md line 24: "A `theft` or `breakage` claim pays from it: the item's value up to the per-claim limit, less the deductible, which the attendee carries. BandIt pays it into the attendee's wallet and collects it from their insurer." Organizer-Portal.md line 315 then books it on the venue's ledger, in the Belongings cost center.

Why it does not hold. The venue's money pays out, and the venue's ledger expects it back from an insurer the venue has no contract with. A renters or home policy is a contract between the attendee and their insurer:

- The [ISO HO 00 04 renters form](https://www.maine.gov/pfr/insurance/sites/maine.gov.pfr.insurance/files/inline-files/ho00-04-05-11-homeowners4-contents-broad-form.pdf), Section I Conditions, J. Loss Payment, p.12: the insurer adjusts the loss with its policyholder and pays them, unless another person is named in the policy or is legally entitled to payment. Payment is due 60 days after proof of loss and an agreement, judgment or appraisal.
- The same form, F. Subrogation, p.19: the insurer may require an assignment of rights of recovery to the extent it paid. That is what the charge to the person named already does: it repays the owner's insurer.

What stays. The plan lookup, the reading of the attendee's policy, the evidence pack and the charge to the person named all still work. Only the source of the payout changes: the attendee's insurer, not the venue's fund.

### 2. The `excess` branch and "policies disagree on who pays"

What the docs say now. Insurance.md line 9: "The attendee's own health plan is the other insurance, and the venue's policy says which pays first." Line 122 plans a complication when "the two other-insurance clauses do not settle which pays first". The term defaults to `primary` (line 267), and `compute_amounts` in `crates/bandit-insurance/src/coverage.rs` line 65 never reads it.

Why it does not hold. A standard liability policy's medical payments cover is not tied to the attendee's other insurance:

- The [ISO CG 00 01 general liability form](https://www.argogroup.com/wp-content/uploads/2019/11/CG-00-01-04-13-Form.pdf.pdf), Section IV, 4. Other Insurance, p.12, applies to "a loss we cover under Coverages A or B of this Coverage Part". Medical payments is Coverage C, which the condition does not name.
- Coverage C itself, p.8, pays medical expenses for an accident on the insured's premises regardless of fault, up to its limit, for expenses incurred and reported within one year.

And the plan document the Bright Data lookup finds is a Summary of Benefits and Coverage, whose sections are fixed by the federal template:

- The [CMS instructions for the group Summary of Benefits and Coverage](https://www.cms.gov/files/document/group-instructions-060723.pdf) (January 2021), p.2, fix the sections and their order: "The Excluded Services and Other Covered Services section must immediately follow the chart that starts on page 2. The Excluded Services and Other Covered Services section must be followed by the Your Rights to Continue Coverage section, the Your Grievance and Appeals Rights section, the Minimum Essential Coverage/Minimum Value Standard section, the Language Access Services (if applicable), and the Coverage Examples section, in that order."
- None of those sections covers coordination of benefits, and the guide's text has no "coordination", "subrogation" or "other insurance".

So the venue's medical payments cover has no other-insurance clause, and the plan document the lookup finds prints none either: the complication could never fire on real documents. A plan's full certificate does coordinate benefits. The [Berkeley SHIP certificate 2023-24](https://web.archive.org/web/20240710132645/https://uhs.berkeley.edu/sites/default/files/ship_wf_coc_2023-24.pdf), p.83, counts medical benefits under auto policies as a "Plan" and leaves out accident-only and school accident cover, as read there; it does not name a venue's medical payments cover. Its "Third Party Refund", also p.83, lets the plan recover from a negligent third party, which matches "recovered from the party at fault". The plan lookup keeps a clear job: the letter names the plan, and the plan's copays show the attendee what they would pay on the rest.

### 3. "Owed to the booths" and the event fee

What the code does. `web/src/costs.ts` line 99 sets `EVENT_FEE_PERCENT = 10n`, and line 136 computes `owed: sales - print - fee` for every sponsor product. It is computed only in the browser: no journal posts it and no Capital One payment pays a booth.

Why cut it. This is judgment, not a source. The model makes the sponsor the seller of its own branded mug, earning $11.20 of an $18 sale from attendees. At a hackathon, sponsors pay the event to be there and give their branding away. A payable that never gets paid also leaves the Costs tab with a number nobody settles.

### 4. Incidents on the booth settlement

What the docs say now. Organizer-Portal.md line 345: the Booths table shows "the incidents at its table with their loss and what the people responsible were charged". No journal charges a booth for an incident at its table. A loss beside a booth's payout reads as if the booth owes it.

### 5. Stale rows in Sponsor-Tracks.md

Line 94 says the stolen laptop is paid by "BandIt, from the owner's own policy", and line 93 sends the whole speaker charge to "the venue's insurer, which paid the repair". The ledger already does better: `charge_approved` in `crates/bandit-insurance/src/ledger.rs` line 108 credits `insurer_payable` with the insurer's share and `recoveries` with the rest, so the $2,400 charge splits into $1,900 for the insurer and $500 for the venue.

## What stays

What stays is the venue's own money, the venue's own policy and the venue's own books. The venue pays BandIt for the platform and the bands; claims money never touches that, and BandIt pays nothing from its own pocket.

| Stays | Why it fits a platform the venue pays for | Where it is |
| --- | --- | --- |
| Injury claims, paid from the venue's claims account under its medical payments cover, refilled by the venue's insurer | the venue's own policy and the venue's own account; BandIt is the software that runs the desk. Coverage C pays regardless of fault and excludes the venue's own people (CG 00 01, p.8), which is the staff refusal BandIt already makes | Insurance.md; journals J1 to J4 in `crates/bandit-insurance/src/ledger.rs` |
| Broken venue equipment under its property policy, and the charge to the attendee named | the venue's own loss, on the property policy because the liability form excludes property the insured owns, rents or occupies (CG 00 01, exclusion 2.j(1), p.4); the charge now repays the insurer's $1,900 and the venue's $500 | `charge_approved`, `ledger.rs` line 108 |
| The double-entry ledger and the Costs tab, without the Belongings and booth payout parts | the venue's books, which BandIt keeps for it; a journal that does not balance is refused | `Journal::is_balanced`, `ledger.rs` |
| Organizer precedents and Claude's proposed rules, approved only by the organizer | this is Hyphenate's own pattern, from its CalHacks workshop deck: "Every correction becomes precedent", and `propose_policy` waits on `needs_approval · human_controller` | the deck text in project files, `research/hyphenate-workshop/deck-text.txt` lines 249 to 276 |
| The plan lookup through Bright Data | real plan wording as evidence, and the plan named in the letter | Bright-Data.md, "Plan lookup from a plan's name" |
| Merch sold from the attendee's wallet | the event sells and keeps the margin | Merch.md |

Two things to state plainly in the docs rather than cut: BandIt runs the venue's claims desk and pays from the venue's claims account, which the insurer refills. And in the scripted and live runs, the attendee paid the clinic at the counter, which is why the payout goes to their wallet.

## Sources

Opened and quoted here, all on vik-e2e at `0326f9c`:

- `System Design/6-features/Insurance.md` lines 9, 122, 267; `System Design/6-features/Incident-Types.md` line 24
- `System Design/5-apps/Organizer-Portal.md` lines 315 and 345; `System Design/1-overview/Sponsor-Tracks.md` lines 93 and 94
- `crates/bandit-insurance/src/coverage.rs` line 65; `crates/bandit-insurance/src/ledger.rs` line 108; `web/src/costs.ts` lines 99 and 136
- Hyphenate's workshop deck, `research/hyphenate-workshop/deck-text.txt` in project files

Outside sources, opened in Chrome on your Mac, because the cloud container's network refuses these hosts:

- [ISO CG 00 01 04 13, commercial general liability form](https://www.argogroup.com/wp-content/uploads/2019/11/CG-00-01-04-13-Form.pdf.pdf): Coverage C and its exclusions p.8, Other Insurance p.12, exclusion 2.j(1) p.4
- [ISO HO 00 04 05 11, renters form](https://www.maine.gov/pfr/insurance/sites/maine.gov.pfr.insurance/files/inline-files/ho00-04-05-11-homeowners4-contents-broad-form.pdf): Loss Payment p.12, Subrogation p.19
- [CMS instructions for the group Summary of Benefits and Coverage, January 2021](https://www.cms.gov/files/document/group-instructions-060723.pdf): required sections p.2
- [Berkeley SHIP certificate 2023-24, archived](https://web.archive.org/web/20240710132645/https://uhs.berkeley.edu/sites/default/files/ship_wf_coc_2023-24.pdf): Third Party Refund and Coordination of Benefits p.83
- [UC SHIP FAQ, UC San Diego](https://shwadmin.ucsd.edu/uc-ship/faq.html): UC SHIP is secondary to other insurance, except Medi-Cal and TriCare

The ISO forms and the certificate are copyrighted, so they appear here as short quotes and page cites.

Cut 3 rests on judgment, not on a source, and says so.
