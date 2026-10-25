# Merchandise image flow — code check

Checked against `origin/vik-e2e` at `219d48e079651fc5851e32cf0cb172eebededa57` on 2026-10-25. Read-only audit; no purchase or model calls made.

## Safe visual story

**Your event photo + a design from the booths you visited + a short printed line → your product preview → choose size, enter shipping, buy.**

Suggested caption: “Your photos and the booths you visited become personal shirts, mugs and posters. See the preview, then choose what to buy.”

The visual should begin with an already matched event photo. A separate social/photo visual explains how that photo reaches the attendee.

## Evidence

| Claim | Current source |
|---|---|
| Catalog designs exist before the event. Gemini was used through computer use to make those assets; it is not a live image API in the product. | Approved decision: `HANDOFF.md:139–141` and `HANDOFF.md:169`. Runtime template data: `assets/merch/templates.json:1–32`; loader: `spacetimedb/server/src/merch/mod.rs:160–200`. |
| Template artwork is served as a static image with a known photo rectangle. | `spacetimedb/server/src/merch/mod.rs:47–71, 175–189`; `scripts/merch-setup:7–18`. |
| Recommendations use one attendee's booth visits, encounters, photo captions and tags, plus the catalog. | `spacetimedb/server/src/merch/mod.rs:485–576`. The payload contains photo IDs/captions rather than photo pixels. |
| The shopping agent selects up to three distinct products, a tagged photo, a short printed line, and a reason. | `crates/bandit-workers/src/shop.rs:23–37, 44–65, 73–105`. Product count is capped by catalog size. |
| This is an Elastic model task. | `crates/bandit-workers/src/shop.rs:113–124`. The module's opening comment still says Claude and is stale. |
| Only photos tagged to that attendee are offered and accepted. | Payload: `spacetimedb/server/src/merch/mod.rs:532–552`; stored picks: `579–615`; checkout: `248–257`. |
| Names in recommendation inputs are limited to people met who are marked findable. | `spacetimedb/server/src/merch/mod.rs:521–541`. The worker prompt limits printed names to those listed in that photo. |
| The browser creates the visible preview by drawing the template, cropping the real photo into it, and adding the printed line. It can also tick visited booths on the booth-crawl poster. | `web/src/recap.ts:291–355`. No green placeholder should remain in the finished visual. |
| Attendee sees a preview, price and reason, selects a shirt size if relevant, supplies a full shipping address, then clicks Buy. | `web/src/recap.ts:381–416`. Checkout validates address length, tagged photo, wallet and balance: `spacetimedb/server/src/merch/mod.rs:237–296`. |
| The order records the selected design, photo, line, size and price; the shipping address is stored separately. A worker records the Nessie purchase. | `spacetimedb/server/src/merch/mod.rs:90–121, 262–296`; `crates/bandit-workers/src/merch.rs:27–46`. Do not imply a verified print-and-mail integration or completed physical delivery. |
| Shopping works during the event and in the recap. | `web/src/pages/t.ts:486–508`; `web/src/recap.ts:381–418`. |
| Agent recommendations start on departure or event end, for claimed attendees with tagged photos. Before they arrive, code already ranks templates and composes personal previews. | `spacetimedb/server/src/merch/mod.rs:436–472, 646–771`. Do not imply every personalized preview waits until departure. |

## Important boundaries

- The agent suggests; it does not buy. The checkout button initiates a purchase. There is also a privileged organizer “buy as attendee” reducer, so “only the attendee can ever initiate an order” would be too broad.
- The printed line is selected by the recommendation, or derived from friends in the photo when no matching pick exists (`merch/mod.rs:262–269`). The current UI does not offer free-form line editing.
- The code uses photo tags, not a new identity check at purchase. Phrase eligibility as “your event photo,” not “verified face recognition.”
- Shipping is a recorded address and order detail. These files do not prove manufacturing or carrier dispatch.

## Existing mismatches to flag, not draw

1. `HANDOFF.md:140` says the organizer does not rerun the shopping agent. Current code still exposes the ops-only “Run the shopping agent again” button (`web/src/pages/organizer.ts:1399`) and reducer (`spacetimedb/server/src/merch/mod.rs:474–482`). This is an implementation gap against the approved decision, not a reason to add organizer reruns to the visual.
2. `handoff/research/sponsors/merch-image-api.md` is obsolete exploratory research proposing live Gemini rendering and a Rust render pipeline. Current approved handoff and browser composition supersede it. Do not use that research page to claim a Gemini API integration.
3. The opening comment of `spacetimedb/server/src/merch/mod.rs` still names Claude, while the executing worker calls `ctx.elastic_model()`. This is a stale code comment.
