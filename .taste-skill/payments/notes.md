# Payments — notes (app-screen run, references/app-screens.md)

## 2.1 Inventory

Objects and fields (from `src/stdb/module_bindings/`, cents arrive as bigint):

- **Merch order** (`board_merch_orders`, `my_merch_orders`): id, attendee_name, node_id, template_id → title,
  size, amount_cents (u64), status (text), failure (text), nessie_purchase_id, photo_url, line, created_at.
  Booth comes from `merch_template.booth_ids[0]` → `booth.name`. Live case (checked on the Merch tab):
  50 pieces, posters $15.00, mugs $18.00, tees $25.00, one per sponsor booth plus Cal Hacks 13.0 pieces.
  The brief guessed $25–$60; the fixture follows the live case instead.
- **Damage charge** (`board_charges`, `my_charges`): id, incident_id, claim_id, attendee_name, band_id,
  named_by name and role, note, amount_cents (u64), pack_hash, checks[], checks_passed, recommendation and
  reason, clause_ids[], status, dispute_text, approved_by_name, waive_reason, payment_reference,
  insurer_cents, refund_cents, created / decided / paid / updated times. Capped by
  `board_fee_schedule.cap_cents` (code, description). A handful a night: 5–15.
- **Wallet** (`board_wallets`, `my_wallet`): node_id, account_id (Nessie), balance_cents (i64). A few
  hundred open (fixture: 212 of 240 registered bands).
- **Wallet entry** (`my_wallet_entries`): kind, signed amount_cents (i64), memo, nessie_id, created_at.
- **Agent pick** (`board_merch_picks`, `my_merch_suggestions`): rank, template, photo (url and crop),
  line, reason, friends[].
- **People**: `board_attendees` (node_id → display name, band id). Band ids are 1–255, shown as Band NN.

Magnitudes: one night (the venue's `starts_at`–`ends_at`, otherwise the span of the rows). About 150–250 merch
orders at $15–$25, so $3k–$5k through the bands; 5–15 charges at $40–$250; failures a few percent.

People: an **operator** on a laptop through a long shift (the desk, read every few minutes, dense), and an
**attendee** on their phone for a few seconds at a time (the wallet, thumb, glance).

Jobs: desk — decide a charge (approve the exact figure, or waive with a reason), find a band's money (search
Band 07 → its wallet and payments), see what failed. Wallet — check what was paid, dispute a charge, buy a pick.
Most frequent desk job: decide a charge. Most frequent wallet job: check.

Product's own things: the BandIt wordmark and desk tabs; Band NN on the strap; sponsor booths on the floor;
the night's photos on the merch; Nessie account ids; evidence-pack hashes.

## 2.2 Questions and findings

- **Desk:** "Is money coming in through the bands tonight, and what needs me?"
  Finding, built from the rows: e.g. "2 charges are waiting for a decision, 1 is disputed and 1 merch order
  failed at the bank." When nothing needs anyone: "Nothing needs you. The last payment settled at 23:41."
  Blocks, each answering the next question:
  1. Figures — how much, how many need me, what failed, how many wallets.
  2. Needs you — which ones, with the action on the row.
  3. Money over the night — when it came in (15-minute bins, biggest bin annotated).
  4. By booth (signature) — where on the floor it came in.
  5. Payments — every payment, filter, search, detail.
- **Wallet:** "What has my band paid for tonight, and is anything wrong?"
  Finding: "$40.00 paid tonight. One charge is waiting on the venue and one order didn't go through." /
  "Nothing looks wrong."
  Blocks: strap + balance; charges on my band; activity; picks for you.

## 2.3 Style, face, signature

- Desk: **data-terminal** (seed 1881144183). Its move is a 1px accent line exactly as wide as its label on
  every selection; `DeskTabs` already does this with the champagne underline, and the status filter row uses
  the same line. Shell: the dealt icon rail is replaced by the shared `DeskFrame` header (wordmark and tabs),
  so Payments matches the other desk tabs.
- Wallet: **true-black-flat** (seed 1650972381). Elevation by lightness steps, the primary by inversion (the
  sign-up's `.signup-primary` ink pill). The dealt "4 action tiles" are left out: the wallet has no
  account-level action (no top-up, send or tap-to-pay reducer exists); its actions sit on the charge and
  pick rows.
- Palette and type kept: Nocturne tokens (ground, panel, raised, ink, ink-dim, line, champagne, teal,
  caution), Geist with tabular figures, Instrument Serif only in the DeskFrame title. Mono only for ids.

**Desk face:** everything is keyed by **Band NN**, as on the strap: every row's who-cell, the search
("07", "band 7"), the pinned wallet. Shows on the first screen in Needs you and the table.
**Desk signature:** **where on the floor the money came in** — a ranked booth list with 2px proportional bars
(grey, the top booth in ink), beside the night chart. Paid merch matched to booths through
`merch_template.booth_ids`.
**Desk data hue:** teal on the paid bars of the night chart — the same hue as the Paid pill, so the chart's
one colour means what it means everywhere else. Champagne stays on the Needs a decision pill and Approve.

**Wallet face:** **the strap is the card** — the sign-up's `.signup-strap` glyph with the band number,
beside the balance. No card picture anywhere.
**Wallet signature:** the agent's picks shown as the piece with the night's photo printed into its print area
(template image + photo crop rectangle from `my_merch_suggestions`).

## 2.7 Rounds

All runs against the fixture (`?fixture=payments`), at 1440, 768 and 390. The desk runs with
`--allow app-title-size`: the 40px Instrument Serif title is `DeskFrame`'s, shared by every desk tab, and
restyling it here would restyle the other tabs.

- **Desk r1** (`desk-r1`): FAIL `edge-text` at 768 (Needs you buttons 4px from the right edge) and page
  overflow at 768 and 390. Cause: implicit grid columns can't shrink below an item's min-content, and the
  chart drew at its 760px fallback before it measured. Fix: `grid-cols-1` on the block grids, the Needs you
  and table column layouts moved to `lg`, the booth column to `xl`, the chart measures in a layout effect.
  Also seen: "Damage charge · damage" (kind repeated); the model now drops a kind of "damage".
- **Desk r2** (`desk-r2`): 0 FAIL, 1 WARN `heavy-borders` (defended below).
- **Wallet r1** (`wallet-r1`): 0 FAIL, WARN `mixed-font-headline` (the mono sim chip sat inside the h1).
  Fix: the chip sits beside the h1, outside it. Pick titles were read twice by screen readers (thumb label
  plus title); the thumb is now decorative there.
- **Lint pass** (`lint.mjs --app`, 14 files): the inset-shadow outlines on buttons, inputs, the sheet edge
  and the row focus became real 1px borders and an outline; the one mono span (ids) is marked; the band
  number's zero-pad lives in one model helper (`bandDigits`); missing values print one shared `MISSING`
  dash; the failure reason in Needs you reads "Visa tee · L · The bank didn't answer in time." in dim, not
  after an em dash. Result: 0 FAIL, 0 WARN.
- **Desk r3** (`desk-r3`): 0 FAIL, 1 WARN `heavy-borders` (defended). Seen at 768: "Through the bands" and
  "Needs a decision" broke onto two lines around the sim chip; the chip now wraps below a whole label.
- **Wallet r2** (`wallet-r2`): 0 FAIL, 0 WARN.

Defended WARN, `heavy-borders` on the desk: the probe forces the border colour's alpha to 1, so it reads
`--nc-line` (rgba(207,208,212,0.14)) as #cdcdd5. Composited on the ground it is about #252527, about 1.35:1,
inside the 1.2–1.5:1 the rule asks for on a dark screen. Every desk tab uses the same token.

The inspector photographs only the first screen of the desk (DeskFrame scrolls inside its own
container), so the lower blocks were checked in the browser at 1440, 768 and 390: the payments table, the
decision sheet (charge 1, Band 07, $45.00) and a failed order's sheet (Meta mug, Band 89). 0 elements past
the viewport at 390. No uncaught exceptions on either route (inspector), and no `console.error` or
`console.warn` through approve, buy (tee, M) and dispute (hooked in the tab).

## The check, answered (desk-r3, wallet-r2)

1. **Biggest thing answers the question.** Desk: the h1 "$4,310.00 through the bands tonight." answers
   "is money coming in", and the sentence under it ("2 charges are waiting for a decision, 1 is disputed
   and 3 merch orders failed at the bank.") answers "what needs me"; the largest figure is the same
   $4,310.00. Wallet: "$40.00 paid tonight." is the h1, the $60.00 balance beside the strap is the
   biggest figure, and the sentence names the waiting charge and the failed order.
2. **Shared edges.** Desk: figures, Needs you, chart + booths and the table share DeskFrame's left and
   right edges at every width; chart (2/3) and booths (1/3) end on the same right edge. No dead strip.
   Wallet: hero card spans the column; charges + activity (left) and picks (right) share the hero's edges;
   one column under 900px.
3. **Colour.** Only on status pills (teal paid, caution failed and disputed, champagne decision), the teal
   chart bars, and the one primary (champagne Approve on the desk, the ink pill on the wallet). The face
   (Band NN) shows on the first screen in Needs you; the wallet's strap is the first thing in the hero.
4. **Numbers.** Booths: 686 + 429 + 418 + 383 + 2,024 = $3,940.00, the "paid merch" aside. Failed:
   25 + 25 + 18 = $68.00, three rows. Needs you · 6 = 2 decisions + 1 disputed + 3 failed. Filter counts sum
   to All 181 (tested). Band 07's wallet reads $60.00 on the desk sheet, the pinned card and the wallet
   ($100.00 deposit − $15.00 poster − $25.00 tee; the pending mug is not yet counted). Band 07's charge is
   $45.00 on both screens. All amounts tabular and right-aligned.
5. **Zeros and dashes.** A block still loading shows a bar, never $0.00 (tested); a missing reference,
   size or zone is a grey dash. Count badges: "Needs you · 6" sits on the queue that needs action; filter
   counts sit on their own label.
6. **Chart.** One series, no legend needed; the biggest bin is annotated in words ("16 tees at the
   Anthropic booth"); hour labels sit under their ticks; the annotation clears the $1,000 gridline.
7. **Phone.** DeskTabs wrap into three short rows (shared shell, not mine to fold); Needs you rows stack
   the item, then pill, band and time, with a 44px button; the table becomes stacked rows; the sheet takes
   the full width. Wallet: one column, strap and balance first, 44px targets.

## Critique (critique.md shape; the page caps for pictures, motion and the live thing don't apply)

ROUND 3
Seen in one second: desk, "$4,310.00 through the bands tonight." and a short list of six things to act on;
wallet, the strap with 07 next to $60.00.
Idea (one sentence): the band is the account, so every row is keyed by Band NN and the wallet's card is
the strap itself.
Live thing: n/a (app screen); rows arrive from SpacetimeDB.
Layout words by section: desk title=statement / figures=row / needs you=list / night=chart / booths=ranked
list / payments=table; wallet hero=card / charges=list / activity=list / picks=cards.
Scores: desk design 7.5 · usability 8 · creativity 7 · content 8 → 7.6; wallet design 7.5 · usability 8 ·
creativity 7.5 · content 8 → 7.7.
Caps applied: none (0 FAIL; the one mono use is ids).
Top three problems (most visible first):
1. Wallet picks show the drawn piece with an empty print area (wallet-r2 desktop-page-01): there are no
   event photos in the fixture, so the signature only lands once `photo_url` is live. Fix: real photo URLs.
2. Fixture mode puts a striped sim chip on every figure and section head (desk-r3 desktop-fold). That's
   what the brief asks for and it vanishes on live data; it does add noise to the first screen.
3. On the phone the status filters scroll sideways past "Paid 170" (checked in the browser at 390); the
   cut-off filter shows there's more, but Failed and Disputed need a swipe. Fix if it bites: put the
   counts that need action first on narrow screens.
