# Prompt for the coding agent: Payments, for the desk and for the band

## Context

On BandIt the wristband is the wallet. Tapping it at sign-up claims the band (`claim_band`) and opens a
wallet account in the Capital One Nessie sandbox (`connect_wallet` → a worker job → `record_wallet`).
Money already moves through that wallet:

- **Merch.** The shopping agent picks pieces for each attendee from the night's photos
  (`my_merch_suggestions`), the attendee or a staff member buys one (`buy_merch`, `buy_merch_as`), and
  a worker settles it with Nessie (`settle_merch_order`).
- **Damage charges.** After an incident, staff name the band responsible (`name_responsible_band`). The
  backend checks the venue policy, recommends an amount (`board_charges`), and staff approve or waive
  it; the attendee can dispute it.
- **Claims.** Insurance payouts and their journals (`board_ledger`), already shown on Costs and decided
  on Settlements.

No screen shows any of this as payments. Merch lists the case, Costs lists claim journals, and charges
and wallets appear nowhere. Build **Payments**, one of the main desk tabs, and the **wallet** an
attendee opens on their phone.

"Stripe-level" is the bar for the craft. It does **not** mean the Stripe SDK. Aim for one stream of
payments, statuses you can trust, a detail view that shows its timeline, every total adding up, and
each action one click from where it's needed. Money moves only through the reducers listed below.

## 0. Run the taste skill first

The skill is in `.claude/skills/design-taste-frontend` (`<skill>` below). Invoke it with the Skill tool
(`design-taste-frontend`). Both screens are **app screens**, so read `<skill>/references/app-screens.md`
in full and follow its run. The page run in `SKILL.md` doesn't apply. Run the commands from the repo
root and keep `.taste-skill/` out of commits.

1. **Inventory (§2.1).** Write `.taste-skill/payments/notes.md` with the objects and fields below,
   their units and magnitudes, and who uses each screen:
   - Magnitudes: about 1,500 people on the floor, a few hundred wallets, merch at $25–$60, damage
     charges capped by `board_fee_schedule`.
   - People: an operator on a laptop through a long shift, and an attendee on their phone for a few
     seconds at a time.
   - Jobs: decide a charge, find a band's money, see what failed; for the attendee, check, dispute
     or buy.
2. **One question and one finding per screen (§2.2):**
   - Desk: *"Is money coming in through the bands tonight, and what needs me?"* The finding comes from
     the data, e.g. "2 charges are waiting for a decision and 1 merch order failed at the bank."
   - Wallet: *"What has my band paid for tonight, and is anything wrong?"*
3. **Deal a style for each screen**, keeping BandIt's palette and type:

   ```bash
   node <skill>/scripts/draw.mjs --app --kind commerce --brief "BandIt organizer payments desk: wristband wallets, merch orders and damage charges at a live event" --screens overview,list,detail --theme dark --keep palette,type --options 3
   node <skill>/scripts/draw.mjs --app --kind wallet --brief "BandIt attendee wallet on the phone: what my wristband paid for tonight" --screens wallet,detail --theme dark --keep palette,type --options 3
   ```

   Both deal `data-terminal` and `true-black-flat`. Choose **`data-terminal` for the desk**: its move
   is a 1px accent line exactly as wide as its label on every selection, which `DeskTabs` already does
   with the champagne underline. Choose **`true-black-flat` for the wallet**: its move is lightness
   steps for elevation and the primary button shown by inversion, which the sign-up's `.signup-primary`
   already does. If you choose differently, write one line on why. Then deal each sheet with
   `--style <id>` and no `--options`.
4. **Map the sheet onto Nocturne.** Use the tokens in `src/index.css` (`ground`, `panel`, `raised`,
   `ink`, `ink-dim`, `line`, `champagne`, `teal`, `caution`). Don't add a palette. Fonts stay Geist,
   with Instrument Serif in the `DeskFrame` title. Put amounts in Geist with `tabular-nums`, right
   aligned. Use monospace only for IDs: Nessie ids, payment references, evidence-pack hashes,
   truncated to about 8 characters with a copy button. (Merch and Costs set money in mono; leave those
   pages alone.)
5. **The face and the signature element (§2.3).** Write them down before any markup. Suggested:
   - Desk: everything is keyed by **Band NN**, as on the strap. The signature element is **where on
     the floor the money came in**: a ranked booth list with 2px proportional bars. Match orders to
     booths through `merch_template.booth_ids` and take the names from `booth`.
   - Wallet: **the strap is the card**. Reuse the sign-up's `.signup-strap` glyph with the band number
     beside the balance. There's no card picture anywhere.
6. **Gate, look, fix (§2.7).** Run `lint.mjs --app` on the new files. Run `inspect.mjs --app` on
   `http://localhost:5173/payments?fixture=payments` and `http://localhost:5173/wallet?fixture=payments`;
   start the dev server with the `bandit-frontend` config in `.claude/launch.json`.
   - Fix every FAIL.
   - The shared `DeskFrame` title is 40px serif, and the inspector may flag it as a landing-page
     title. Keep it so the tabs match. `--allow` that one rule and say why in the report.
   - Read every screenshot at 1440, 768 and 390.
   - Answer the seven questions in §2.7 in the notes file.
   - Fix the worst three problems, then look again. Three rounds at most.

## 1. The data that already exists

Check each of these in `src/stdb/module_bindings/` before using it.

**Desk (staff views):** `board_wallets` (node_id, account_id, balance_cents), `board_charges` (amount,
pack_hash, checks, recommendation and reason, clause_ids, status, dispute_text, approved_by_name,
waive_reason, payment_reference, insurer_cents, refund_cents, created/decided/paid times, named_by
name and role), `board_merch_orders` (attendee_name, node_id, title, size, amount, status, failure,
nessie_purchase_id, photo_url, line), `board_merch_picks`, `board_fee_schedule`, `board_ledger`, and
`board_attendees` for names and band ids by node_id.

Desk reducers:
- `approve_charge({ chargeId, amountSeenCents, packHashSeen })`
- `waive_charge({ chargeId, reason })`
- `buy_merch_as({ nodeId, templateId, photoId, size })`
- `retry_claim_payout({ claimId })` stays on Settlements; link to it from the detail view.

**Wallet (attendee views):** `my_wallet`, `my_wallet_entries` (kind, signed amount_cents, memo,
nessie_id), `my_charges` (incident_kind, zone_name, amount, status, why, clause, dispute_text,
paid_at), `my_merch_orders`, `my_merch_suggestions` (photo crop, line, reason, friends), and `my_band`.

Wallet reducers: `dispute_charge({ chargeId, text })`, `buy_merch({ templateId, photoId, size })`,
`rerun_shopping_agent({})` and `connect_wallet({})`.

**Subscriptions (`src/stdb/session.ts`):**
- Add the `board_*` views to `STAFF_QUERIES`. They go through the existing one-query-at-a-time loop
  with its 4 s timeout.
- Add `my_wallet_entries`, `my_charges` and `my_merch_suggestions` to `subscribeAttendeeViews`, each
  as its own subscription with its own ready flag. Wallet views "never complete on their own" when
  bundled. `my_merch_orders` is subscribed today only with a staff token; attendees need it too.
- Add the reducer calls as session actions next to `confirmMedicalCard` and `connectWallet`, wrapped
  in `call()`. Components never call reducers directly.

**The model.** Put pure, tested functions in `src/payments/` that turn rows into one `Payment` type:
- Fields: id, source (`merch` | `charge` | `wallet`), attendee name, band id, amount in cents, display
  status, raw status, created, settled, reference, what it was, failure.
- Cents arrive as `bigint`. Convert them as `catalog.ts`'s `num()` does, show them with `formatCents`,
  and never hold dollars as floats.
- **Status strings aren't documented in this repo.** The backend module isn't here. Map the values
  you know to the display states: *Needs a decision, Pending, Paid, Failed, Disputed, Waived,
  Refunded*. Show any other value as a neutral pill with its raw text. List the full mapping in your
  report.

**The fixture.** Put it in `src/payments/fixture.ts`, loaded only with `?fixture=payments`, so the
taste inspector and the tests have data without a staff sign-in.
- Use believable names, and keep the items in line with the Merch tab.
- Compute totals from the rows. Assertions in the unit tests prove that they add up.
- Every fixture figure carries the striped `SourceChip tag="sim"`, as the README's safety rules
  require.
- Never mix fixture rows with live rows.

## 2. The desk: `/payments`

- Add `{ to: '/payments', label: 'Payments' }` to `DeskTabs` **second, right after Map**. Settlements
  and Costs stay last. Add the route to `Pages` in `App.tsx`. On band1t.vip it sits behind
  `OrganizerGate` like every other desk page.
- Build `src/components/desk/PaymentsPage.tsx` on `DeskFrame` and `Figure`:
  - The title is the night's total as a sentence ("$4,212.50 through the bands tonight.").
  - The line under it is the finding.
- **Four figures, type only:**
  - Through the bands: paid merch plus paid charges, with refunds shown in its note.
  - Needs a decision: a count.
  - Failed: the count and the amount.
  - Wallets open.
  - Each figure is a sum over the same rows the table shows. The night is the event's own window,
    not a rolling 24 h.
- **Needs you** comes before the long table: charges waiting for a decision and failed orders, each
  row with its action.
- **Money over the night:**
  - A small SVG bar chart in 15-minute bins, drawn to app-screens §6: one hue, a few faint gridlines,
    no legend for a single series. Port `<skill>/assets/charts.js` or write your own.
  - Annotate the biggest bin from the data ("14 hoodies at the Cal booth"). Give it two-thirds of the
    width, with the booth list beside it.
- **The payments table** is the core:
  - Columns: amount (right aligned), status pill, what it was, who (name and Band NN), booth or zone,
    when, and the reference (mono, copy button).
  - Filters: a segmented row of All plus each display status, each with its count; the counts sum to
    All.
  - Search by name, band number or reference. Searching a band number pins that band's wallet
    (balance, account id) above the results.
  - Newest first. Cap or virtualise past a few hundred rows.
  - Rows take keyboard focus, and Enter opens the detail.
  - Table rules follow §7: 1px row rules, 12px sentence-case headers, no zebra stripes.
- **Detail**, as a side sheet on desktop and full screen on the phone, using `components/ui/dialog`:
  - The amount large, and the status.
  - A timeline built from the row:
    - Charges: named by {name} ({role}), the checks, the recommendation with its reason and clauses,
      then approved by, disputed with the attendee's words, or waived with the reason, then paid with
      the reference, then the insurer's share and any refund.
    - Merch: ordered, sent to the bank, then settled or failed with the reason in plain words.
  - The attendee, their band and their wallet balance.
  - The merch photo (`photo_url`) or the incident kind and zone, with the fee-schedule cap.
- **Actions** wait for the backend, as `operatorCommands.ts` does: a pending state on the button, a
  toast on the result, and no optimistic change to any amount.
  - **Approve** shows the exact amount and the evidence-pack hash. It sends `approve_charge` with the
    values that were on screen, because that's the backend's guard against approving a figure that
    changed. If it's refused, show the reducer's message and the new figure, and ask again.
  - **Waive** needs a written reason.
  - A failed merch order has no retry reducer. Show the failure, and add no control that fakes one.

## 3. The wallet: `/wallet`, phone first

- Add `/wallet` to the attendee pages in `App.tsx`'s `Shell` (next to `/join` and `/register`) so
  band1t.vip doesn't gate it.
- On `/register`, when the tapped band is already this identity's, add "Open your wallet". Add the
  same link to the sign-up's done screen. Leave `tapTarget` alone.
- Build it in the sign-up's visual language (`RegisterPage.css`: 20px panels, `.signup-strap`, the ink
  pill primary, 44px targets). Skip the concert lights; this is an app screen.
- **Top:** the strap with "Band 07", the balance as the largest figure, and the account id (mono,
  copy).
  - Before `my_wallet` arrives: "Your wallet is opening." Don't block anything on it.
  - On `walletError`: the message and a "Try again" button that calls `connectWallet`.
- **Charges on my band:** what happened, where, why and the clause, in plain words. "This isn't right"
  opens a text box that sends `dispute_charge`, and the row then shows *Disputed*.
- **Activity:** wallet entries and merch orders, newest first, with signed amounts ("-$32.00") and a
  status. Tap a row for its detail: the photo, the time, the reference and the steps.
- **Picks for you:** the agent's suggestions with their photo crop and the friends in it.
  - "Buy with my band" opens a confirm sheet with the price, the size (required for apparel) and
    "charged to your band's wallet". It then calls `buy_merch`, and the order shows as *Pending* until
    the worker settles it.
  - "Pick again" calls `rerun_shopping_agent`.
- With no band for this identity, show the sign-up's "Tap your band" screen instead.

## 4. Status, colour and copy

- Pills are pale tints with text in the same hue: *Paid* teal, *Pending* neutral, *Failed* and
  *Disputed* caution, *Waived* and *Refunded* neutral, *Needs a decision* champagne. The champagne is
  the desk's one accent, kept for that pill and the primary action.
- **Never `signal` red, never `help` green, and never a band pattern colour.** On this product red
  means an SOS or a fall, and an operator must never read a payment as an emergency.
- Zero is "$0.00", a missing value is "—", and an amount that hasn't arrived is a loading line, never
  "$0.00".
- Every block has its own state for not arrived, empty, refused ("This sign-in can't see payments",
  from `staffError`) and error.
- The copy uses the product's own words: band, wallet, charge, merch, booth. Write in sentence case.
  No deltas unless they name their baseline.

## Don't touch / constraints

- **Payments never signal a band.** No `haptic`, `send_command` or LED pattern from either screen.
  Vibration and light on the band are reserved for safety guidance.
- Don't hand-edit `src/stdb/module_bindings/` (generated). Report the backend gaps instead of building
  around them:
  - No reducer charges a band at a booth, so tap-to-pay at the counter doesn't exist yet.
  - Merch orders have no refund or retry.
  - Booths and the organizer get no payouts.
- No card number, CVC or payment SDK. Nessie is a sandbox: never say a figure is real money.
- Never log names, amounts or row contents to the console. Logging the set of status values is fine.
- `App.tsx`, `DeskTabs.tsx` and `session.ts` often carry uncommitted edits from parallel work. Read
  `git diff` first, make small additive edits, and don't reformat.
- Don't restyle other tabs.
- Keep `npm test`, `npm run typecheck` and `npm run lint` passing. Add tests for:
  - row → `Payment` mapping, including an unknown status and bigint cents;
  - figures equal to the sum of the rows shown under each filter, and filter counts summing to All;
  - search by band number pinning that wallet;
  - `approve_charge` sent with exactly the amount and hash rendered, and a refusal shown in place;
  - waive refusing an empty reason;
  - wallet states (not arrived, empty, error), a dispute sending its text, buy requiring a size;
  - no input on either page that could take a card number;
  - `DeskTabs` listing Payments second.

## Done when

- **Desk.** `/payments?fixture=payments` at 1440 shows every block's header and first rows on the
  first screen. The figures reconcile with the table under every filter, and the detail shows the
  charge timeline. Approve and waive call their reducers with the right arguments.
- **Live.** Signed in as staff on the live host, the same page fills from the `board_*` views.
- **Wallet.** `/wallet?fixture=payments` at 390 shows the strap and balance, the charges and
  activity, and the picks, with no horizontal scroll. Dispute and buy go through their reducers.
- **Taste skill.** `lint.mjs --app` and `inspect.mjs --app` show 0 FAIL on both routes at 1440, 768
  and 390, apart from the one allowed rule. Every screenshot has been read and the critique is written
  in `.taste-skill/payments/notes.md`.
- **Console.** No console errors.
- **Report:**
  - the styles and seeds dealt, the face, the signature element, and each screen's question;
  - the allowed rule and why;
  - the status mapping;
  - the backend gaps;
  - the fixture data to replace.
