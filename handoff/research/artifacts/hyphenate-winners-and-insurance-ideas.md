# Hyphenate Track Winners and Insurance Ideas

Saved from https://claude.ai/artifact/M2eACTqGADyTXnbtyttuhn, last updated 2026-10-24.

BandIt's best Hyphenate pitch is an autonomous incident-to-claim agent. It turns band and camera data into a verified evidence pack, settles small venue claims under learned policy, and sends the rest to a named adjuster. That is the pattern all three winners below share: code checks the facts, the model explains, and a human approves anything material.

No hackathon has finished a track under the Hyphenate name yet, because CalHacks 13.0 is the first since Maximor renamed itself Hyphenate (Oct 2026). The closest record is Maximor's own hackathon, [Syndicate by Maximor](https://syndicate-by-maximor.devpost.com/) (Sep 5–6, 2026), Track 2: Autonomous Office of the CFO. All three projects here won that track. I picked them for their similarity to BandIt: sensor data as evidence, claim letters, and evidence gathered from many sources.

| Project | Track 2 award | What it does | Why it is close to BandIt |
| --- | --- | --- | --- |
| [Reckon](https://devpost.com/software/reckon) | 1st place ($1,000 cash + credits) | Screens payments for duplicates and drafts claim letters for recovery | Triage of a flood of alerts into a few claims a human signs |
| [ShortPay](https://devpost.com/software/to-be-decided-g0ucje) | Winner (credits) | Uses IoT dock timestamps to dispute overbilled freight before payment | Sensor data is the evidence that settles a money dispute |
| [Tieout](https://devpost.com/software/tieout) | Winner (credits) | Investigates broken invoices across the ERP, email and a vendor portal, then learns a rule from one approval | Builds a provenance-stamped evidence pack from several sources |

The 2nd-place cash winner, [PPV Memory](https://devpost.com/software/invoice-processing-8bl14n), is a simpler version of Tieout's learn-from-one-approval idea, so I left it out.

## The Hyphenate track

Hyphenate wants agents that run a real finance workflow end to end and hand people only the judgment calls. [Hyphenate](https://hyphenate.ai/) (formerly [Maximor](https://hackernoon.com/maximor-rebrands-as-hyphenate-after-86x-revenue-growth-across-five-finance-functions)) layers agents on an existing ERP across five functions: order-to-cash, treasury, procure-to-pay, GL accounting and reporting. Its pitch is "audit-ready autonomy": agents learn policy, do the routine work, escalate exceptions and log every step. Its site never mentions insurance, so BandIt has to frame insurance as a finance workflow.

|  | CalHacks 13.0 | Syndicate by Maximor (Sep 2026) |
| --- | --- | --- |
| Track | The Hyphenated Enterprise: Autonomous Systems for Finance | Track 2: Autonomous Office of the CFO |
| Brief | None beyond the title | "Automate a real accounting, finance, or treasury workflow end to end, including exceptions and human review" |
| Prizes | $8,000 / $5,000 / $3,000, and the top 5 teams get fast-tracked interviews | $1,000 / $500 cash, plus credits for about 20 winners per track |
| Judging | General CalHacks criteria: Application, Intentionality, Functionality, Creativity, Technical Complexity | AO usage 25%, Technical execution 25%, Track fit and real-world value 25%, "Demo" 15%, Innovation 10% |
| Required tooling | None listed | Agent Orchestrator (AO) for the whole build |

Sources: [CalHacks 13.0 Devpost](https://cal-hacks-13-0.devpost.com/), [Syndicate by Maximor](https://syndicate-by-maximor.devpost.com/). AO (Agent Orchestrator) is the multi-agent coding tool Syndicate required. CalHacks lists no such requirement, so treat Syndicate's rubric as a hint at what Hyphenate's judges value, not as the CalHacks rules.

## Winner 1: Reckon (Track 2, 1st place)

[Reckon](https://devpost.com/software/reckon) won because it attacked the alert queue, not detection. It cut 1,279 duplicate-payment suspects down to a short list a four-person team can work, and drafts a claim letter for each confirmed one. Tanay Vasishtha built it solo ([GitHub](https://github.com/tanayvasishtha/Reckon)).

**Problem.** Improper payments are large: the US GAO counts $186B across federal programs for FY2025. Tools that test 100% of transactions flood finance teams with false alarms, and a cited 2024 study found auditors acted on red flags less often when testing everything (48%) than when sampling (65%).

**How it works.** Six of its seven stages are plain Python. The model only does stage 5.

1. Collapse 20,000 ledger rows into 3,425 real payments.
2. Canonicalise vendor names, so four spellings of W.W. Grainger count as one vendor (F1 0.983).
3. Group payments into hash buckets to find 1,279 candidate pairs without comparing everything.
4. Deterministic rules dismiss pairs a lookup can prove innocent.
5. The model is told to find the *innocent* explanation: a recurring invoice, a progress draw ("2 of 4"), or line items that sum to the total. A fast model handles volume, and anything under 0.7 confidence escalates to a stronger model.
6. Survivors go to a named approver in the department that owns the payment, with the evidence chain attached.
7. A confirmed finding produces a claim letter, a journal entry and an audit trail. Nothing posts automatically.

**Results (planted test set: 40 real duplicates, 60 decoys).**

| Metric | Rules only | Rules + model |
| --- | --- | --- |
| Precision | 0.400 | 0.718 |
| Recall | 1.000 | 0.700 |
| Dollars wrongly flagged | $76,093.78 | $0 |

**Why it likely won.** It used real public ledgers (6.47M rows from Checkbook L.A.) and published its weak spot: recurring-cadence decoys, where it missed 6 of 10. Every model call is recorded and replayed, so the presentation runs offline. The claim letter is worded as a query, not an accusation. It was built with 35 AO sessions and 347 tests, starting from a written standards file and a locked data spec.

**For BandIt.** A crowd venue throws off many incident signals and few real claims. Copy the funnel: rules dismiss the obvious non-events, a model looks for the innocent explanation (the person stood up, the speaker was moved on purpose), and only survivors reach an adjuster as a drafted claim.

## Winner 2: ShortPay (Track 2 winner)

[ShortPay](https://devpost.com/software/to-be-decided-g0ucje) is the closest match to BandIt: it treats IoT sensor data as the evidence that settles a money dispute. It audits a carrier's freight surcharges against dock sensor timestamps *before* the bill is paid, then drafts a short-pay and a dispute packet ([GitHub](https://github.com/DevloperHS/ShortPay), [write-up](https://gist.github.com/DevloperHS/dbec4a1e1b12c0958b67013b8fcee8a4), [video](https://www.youtube.com/embed/Mq-8E-dkaQQ)).

**Problem.** Accounts payable teams spot-check freight invoices or pay contingency auditors to claw money back afterwards. The write-up cites a vendor estimate that 3–7% leaks through extra charges such as liftgate fees, detention past free time and duplicate bills.

**How it works.** For each shipment it joins four sources: the contract rate sheet, the facility record (does it have a dock?), the IoT dock log (arrival and departure) and the carrier invoice.

1. The LLM only extracts what was billed into a validated record. Its prompt forbids it to calculate a payable, a dispute or a decision.
2. A pure function computes what should have been billed, in integer cents. Detention is the dock dwell time minus free time, and liftgate is $0 when the site has a dock.
3. Any billed line above the expected amount becomes a dispute line.
4. Disputes of $50 or less auto-close, but only if every rule that fired was already approved on that carrier lane. Everything else goes to a review board.
5. The controller approves a math grid. If the amount on screen is stale, the approval fails closed.
6. Each approval records which rules fired, so later small disputes on that lane close without a person.

**Hero case.** A FedEx Freight shipment billed $1,120.00. The truck sat 93 minutes against 30 free, which allows one hour of detention at $75, and the site has a dock, so liftgate is not owed. Authorized: $925.00. Dispute: $195.00, with the dock receipt attached.

**Why it likely won.** It fits Hyphenate's loop exactly: learn a policy, auto-close small items, escalate large ones. It keeps the model off the money path and hashes each evidence pack with SHA-256 so an auditor can verify any figure later. It reported 37 passing tests and openly listed its gaps: in-memory storage, no auth, a fake ERP.

**For BandIt.** Swap dock timestamps for band and camera data. Bluetooth position, a fall spike and camera frames become the facts, and a policy decides what the venue owes. ShortPay's write-up never says how far it trusts the sensor data. BandIt can win that point by showing how it checks one sensor against another (band against camera).

## Winner 3: Tieout (Track 2 winner)

[Tieout](https://devpost.com/software/tieout) shows how to build an evidence pack from scattered sources and turn one human approval into a reusable rule. It works only on broken invoices and gathers proof from the ERP, the vendor's email thread and a vendor portal with no API ([GitHub](https://github.com/rohit-jsfreaky/tieout), [live app](https://tieout-zeta.vercel.app)).

**Problem.** The write-up cites industry figures: invoices that need rework are about 12.5% of the ledger, take 45–60 minutes each, and eat 60–70% of an AP team's time. The decision is rarely hard. Collecting the evidence is.

**How it works.**

1. **Investigate.** It runs a three-way match (purchase order, goods receipt, invoice), then reads the email thread and signs into the vendor portal with a real browser (Playwright) to pull the delivery note.
2. **Evidence pack.** Every fact records its source, a URL to fetch it again, when it was read, whether code or the model read it, and a screenshot for portal facts.
3. **Decide once.** A human approves, which creates a policy stamped with their name and date.
4. **Clear automatically.** The next matching case from that supplier clears with no human and cites the rule and its approver.
5. **Refuse.** When the evidence doesn't line up, or confidence is under 0.70, Tieout declines and shows everywhere it looked.

**Guardrails.** An authority matrix caps approvals: AP clerk £1,000, controller £10,000, CFO unlimited. A learned rule inherits its approver's ceiling, so a controller can't create a rule that later clears a larger invoice alone. The model may suggest a tolerance, but code clamps it, and contradicting decisions create a new rule version instead of overwriting.

**Why it likely won.** Refusing to decide is treated as a valid outcome, which builds trust with finance judges. Five cold runs gave byte-identical output, there are 56 offline tests, and the presentation runs with no model key. It was built as 11 AO sessions, one per phase, each in its own git branch.

**For BandIt.** An insurance claim needs the same pack: band position, camera frames, the venue's incident log and the attendee's policy details, each fact stamped with its source and time. Copy the authority matrix too: a floor manager settles small claims, the venue's risk manager mid-size ones, and the insurer's adjuster anything bigger.

## What the winners have in common

All three let code decide money, let the model only read or explain, and let a named human approve what code can't settle.

| Pattern | Reckon | ShortPay | Tieout |
| --- | --- | --- | --- |
| What the model does | Looks for innocent explanations of suspect pairs | Extracts billed facts only | Extracts facts from email, drafts rationales and candidate rules |
| What code decides | Blocking, rules, final routing | Every cent of payable and dispute | Three-way match, confidence checklist, rule limits |
| Evidence | Evidence chain per finding | Four joined sources, SHA-256 hash per pack | Per-fact source, timestamp, reader and screenshot |
| Human step | Named approver in the owning department | Controller approves a math grid; stale screens fail closed | Authority matrix by amount |
| Learning | None (fixed pipeline) | Approved rules auto-close small disputes on that lane | One approval becomes a versioned, clamped rule |
| Output | Claim letter, journal entry, audit trail | Short-pay and dispute packet | Cleared invoice citing rule and approver, or a refusal |
| Proof | Planted test set, precision 0.40 → 0.72 | 37 tests, cent-exact hero case | 56 tests, byte-identical cold runs |
| Runs offline | Yes (recorded model calls) | Yes (fixtures) | Yes (no model key needed) |

Two more habits show up in all three write-ups. Each one names its own limits plainly, and each backs its claim with exact numbers rather than a vague dashboard.

## What BandIt can do with insurance

Build an incident-to-claim agent: it turns each accident the bands catch into a verified claim, settles small ones under policy, and reconciles insurer payouts in the books. This is the README's "reconcile accidents early with insurance companies" line turned into a finance workflow Hyphenate recognises. Hyphenate's site never mentions insurance, so the pitch has to show the money moving: a claim reserve, a receivable from the insurer, a payment to the claimant, and a reconciliation when the insurer pays.

| Rank | Idea | Finance workflow | Borrowed from | Hyphenate fit | Effort in 36 h |
| --- | --- | --- | --- | --- | --- |
| 1 | **Incident-to-claim agent.** A fall, injury or broken speaker becomes an evidence pack and a drafted claim. Small claims settle under policy, and larger ones go to the right person. | Reserves (GL), insurer receivable (order-to-cash), claimant payment (procure-to-pay) | All three | High | Medium |
| 2 | **Claim check before paying.** When someone files a claim, check it against band and camera data: was that person there, and did the bands record a fall? Look for the innocent explanation first. | Payables control | Reckon | High | Low (a feature of idea 1) |
| 3 | **Damage cost recovery.** Camera and band data tie a broken speaker to a time, a place and the people nearby, and the agent drafts a recovery letter to the responsible vendor or their insurer. | Receivables and recovery | Reckon, ShortPay | Medium | Low (a feature of idea 1) |
| 4 | **Risk data for premiums.** Send crowd-risk and near-miss data to the underwriter to price the venue's liability cover. | Reporting and insights | None | Low | Low, but not agentic |

**Recommendation:** build idea 1 and show ideas 2 and 3 as steps inside it. Idea 4 makes a good closing line in the pitch, not a feature.

**Diagram: incident-to-claim flow · 3 outcomes, 1 learning loop**

What it shows: Code settles small claims; a named person approves the rest.

Text in the diagram, in drawing order:

- Code settles small claims; a named person approves the rest
- learned rule
- Incident signal
- Band fall spike, crowd
- risk, camera frame
- Evidence pack
- Each fact: source, time,
- reader; pack is hashed
- Policy check in code
- Coverage, limit, amount;
- routes the claim
- Refuse
- Band and camera disagree;
- show what was checked
- Auto-settle
- Small claim under a rule
- a person approved before
- Person approves
- By amount: floor manager,
- risk manager, adjuster
- Approval becomes a rule
- Book and notify
- Claim reserve and insurer receivable;
- first notice of loss or claim letter
- Reconcile the payout
- Match the insurer's payment to the
- open claim, then close it

Every incident takes one of three routes. Each human approval feeds back as a rule, so the next similar claim settles on its own.

### The pitch moment

Build toward one moment: a judge approves one claim, and the next one pays itself, citing that judge's name. That is Hyphenate's loop (learn a policy from one approval, then run without people) shown live, the same proof Tieout and ShortPay used. It replaces the current hero case, which starts from a rule approved the day before.

1. **The fall.** A teammate wearing band 7 falls near Stage B. Nearby bands pulse, and the medic logs the treatment and uploads the synthetic urgent-care PDF.
2. **Bill review.** Claude reads the PDF into service lines. Code pays most lines, reduces one to the fee-schedule cap and excludes one that isn't on the schedule. Show billed and paid side by side.
3. **Claude's review.** Claude explains why the wrist sprain follows from a fall onto an outstretched hand, citing the band, witness and medic facts.
4. **The first claim routes.** No rule exists yet, so the claim goes to the risk manager. A judge plays the risk manager and approves the amounts on screen.
5. **Money moves.** The ledger posts the reserve, the insurer receivable and the payment. The Nessie deposit lands in the attendee's app, and the insurer notice is drafted. A rule is created, capped at the approver's limit.
6. **The payoff.** The scripted run plants a second, similar fall. It settles in seconds: "Settled under rule v1, approved by (judge) 2 minutes ago."
7. **The refusal.** A planted fake whose witness bands sit in another zone is refused, and the screen lists every check it made.

Fallback: if the live approval fails, a pre-seeded rule v1 keeps step 6 working.

**What to copy from the winners.**

- Code computes coverage, limits and amounts. The model only reads incident notes and the attendee's medical PDF into a validated record, and drafts letters, as in ShortPay.
- Stamp every fact with its source (band, camera, staff log), its time and whether code or the model read it, then hash the pack (Tieout, ShortPay).
- Use an authority matrix by amount (for example floor manager, then venue risk manager, then insurer adjuster) and let a learned rule inherit its approver's limit (Tieout).
- Refuse when band and camera disagree, and show what was checked (Tieout).
- Word recovery letters as a query, not an accusation (Reckon).
- Measure it on planted incidents: real falls plus decoys such as someone sitting down or dropping their phone. Report precision, recall and dollars wrongly settled (Reckon).

**Risks.** Watching attendees to assign blame for damage can read as surveillance, so pitch idea 3 at vendors and staff first. Judges will ask which policy pays. Answer in one line: the venue's general liability policy, through its no-fault medical-payments cover (for example $5,000 per person) for injuries and its property cover for equipment.

### Metrics to show

Show one scorecard from the accuracy run, led by the number Hyphenate itself sells: straight-through processing (it quotes 98% for one customer's cash transactions). The straight-through rate rising round by round, while dollars wrongly paid stay at $0, is the single picture that proves the agent learns safely.

| Metric | Definition | Target | Borrowed from |
| --- | --- | --- | --- |
| Straight-through rate, by round | Genuine claims settled with no person ÷ all genuine claims, for rounds 1, 2 and 3 of planted claims | Rises each round as rules are learned | Hyphenate, Loop |
| Dollars wrongly paid | Total paid on planted fakes | $0 | Reckon |
| Auto-settle precision and recall | On the planted set, naming the weakest fake type | Precision 1.0; report recall honestly | Reckon |
| Bill-review savings | Billed minus paid, from excluded and reduced lines | Report in dollars and % | ShortPay |
| Incident to payout | Median time from the medic resolving the incident to the Nessie deposit | Seconds | Tieout |
| Human touches per claim | Approvals needed ÷ claims, per round | Falls each round | Tieout |

For context in the pitch, industry estimates put claims leakage (money paid that shouldn't have been) at 5–10% of all claims paid ([Hyland brief](https://www.hyland.com/-/media/Project/Hyland/HylandV2DotCom/pdfs/nuxeo_insurance_brief_claims-leakage.pdf?sc_lang=en), source not named there).

### Edge cases worth showing judges

Each case proves a different guardrail. Show two live and the rest in a short scripted stress-test run.

| Planted case | What judges see | Guardrail it proves | In the code today |
| --- | --- | --- | --- |
| The medical record says the injury happened at home | Claude flags causation and the claim goes to a person | Claude's judgment can stop money but never change an amount | Built (has a test) |
| Witness bands sit in a different zone | Refused, with both zones shown | Code checks the evidence | Built |
| The amount changes while the approver is looking | The approval fails as stale | Approvals fail closed | Built |
| The same bill is filed again as a new scan | Caught as a duplicate | Duplicate control | Only identical files are caught (see gaps) |
| The injured person is venue staff | Refused: employees fall under workers' comp, not medical payments | A real policy exclusion | Missing |

### Gaps in the current design

1. **Duplicates beyond the same file.** The check today only catches an identical PDF. Also match the provider plus invoice number, and the patient plus service date plus total, across claims. Duplicate payments were Reckon's whole thesis.
2. **Staff injuries.** Medical-payments cover excludes the venue's own employees ([Thimble](https://help.thimble.com/hc/en-us/articles/4401822311699-CGL-My-General-Liability-coverage-includes-5-000-in-medical-expenses-What-does-this-mean)). Refuse a claim when the injured band belongs to a staff role, and give that reason.
3. **Mass incidents.** A crowd crush could open dozens of claims at once and drain the event's aggregate limit through auto-settle. When one incident has 3 or more injured, turn auto-settle off for its claims, send them all to the adjuster, and file one notice that lists everyone injured.
4. **Notice format.** Draft the insurer notice in the layout of ACORD 3, the industry's standard general liability notice of occurrence ([example form](https://www.cmregent.com/wp-content/uploads/2018/11/ACORD_Notice_of_Occ_Claim.pdf)). Its sections include the injured party, what they were doing, witnesses, the medical expense limit and damaged property with an estimate. BandIt already holds every one of those facts.
5. **Learn live.** Switch the hero case from a pre-seeded rule to the judge's own approval, as in the pitch moment above.

## Sources

- [CalHacks 13.0 on Devpost](https://cal-hacks-13-0.devpost.com/): Hyphenate track and prizes
- [Syndicate by Maximor](https://syndicate-by-maximor.devpost.com/): tracks, judging rubric, prizes
- [Syndicate project gallery](https://syndicate-by-maximor.devpost.com/project-gallery): winner list
- [Hyphenate](https://hyphenate.ai/): products and messaging
- [Maximor rebrands as Hyphenate (HackerNoon)](https://hackernoon.com/maximor-rebrands-as-hyphenate-after-86x-revenue-growth-across-five-finance-functions)
- [Reckon on Devpost](https://devpost.com/software/reckon)
- [ShortPay on Devpost](https://devpost.com/software/to-be-decided-g0ucje) and [ShortPay write-up](https://gist.github.com/DevloperHS/dbec4a1e1b12c0958b67013b8fcee8a4)
- [Tieout on Devpost](https://devpost.com/software/tieout)
- [PPV Memory on Devpost](https://devpost.com/software/invoice-processing-8bl14n)
- BandIt README in the `viktorinkov/cal-hacks-13` repo
