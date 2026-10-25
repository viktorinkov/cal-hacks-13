# Merch

Merch turns an attendee's own night into something they can hold. Before the event the team makes six merch templates by hand: for Cal Hacks 13.0, a plain t-shirt, mug and poster, and three that name sponsors. Each template image has a marked photo area.

When the event ends, a shopping agent (Claude, through the `merch_picks` job in `bandit-workers`) picks three templates for each attendee who is in a photo: the products of the booths they spent time at, each with one of their photos, the ones with the people they met first, and a short line printed under it such as "with Jordan & Maya". Until it answers, the view ranks templates by the minutes at their booths. The tap page places the photo straight into the photo area, prints the line and ticks the booth crawl poster's box for each sponsor booth the attendee visited. One tap buys it from the attendee's BandIt wallet.

No image is generated during the event and nothing is rendered on any server. Any event loads its own templates; Cal Hacks 13.0 is the first event it runs at. The whole feature is optional and far from the safety loop.

## Role in the system

Responsibilities:

- Hold the templates (`merch_template`, loaded from `assets/merch/templates.json` with `load_merch_templates`), the orders (`merch_order`) and the Capital One Nessie merchant that BandIt merch is sold as (`merch_shop`).
- Ask the shopping agent for each attendee's three picks when their night ends, at the event's end or when they leave early (`merch_picks` jobs, answered with `submit_merch_picks`), and suggest template and photo pairs through the view `my_merch_suggestions`.
- Take an order and its payment in one call, `buy_merch`, and finish it with `settle_merch_order` once the purchase is on Capital One Nessie.
- Show the organizer the templates and every order on the organizer portal's Merch tab, through the view `board_merch_orders` ([Organizer-Portal](../5-apps/Organizer-Portal.md)).

Non-responsibilities:

- It generates no images during the event. The team makes the template images before the event, and the tap page places the photo into them.
- It renders nothing on any server and stores no merged image.
- It does not derive visits or tag photos; [Social](Social.md) does.
- It does not open wallets or call the Capital One Nessie API; [Capital-One-Nessie](../7-integrations/Capital-One-Nessie.md) does. Nothing is sold at the venue.
- It does not print or ship. The flow ends at a paid order.

## Interfaces

| Direction | Who | What flows | Transport |
|---|---|---|---|
| In | Project setup (role `ops` or `ingest`), after the event import | every template in `assets/merch/templates.json`, through `load_merch_templates` | SDK, before the event |
| In | Tap page, on the recap | `buy_merch` (template id, photo id, size) | SpacetimeDB TypeScript SDK |
| In | [Social](Social.md) tables | `visit` (minutes per booth), `photo` (zone and time), `photo_tag` (the caller's tags) | Module tables, read by the view and the reducer |
| In | Core tables | `booth`, `blob_ref`, `job`, `event_state`; Bright-Data.md: `organization`, to match sponsor names | Module tables |
| In | [Capital-One-Nessie](../7-integrations/Capital-One-Nessie.md) | the caller's wallet (`claimant_account`) and its spendable balance (`wallet_entry`) | Module tables, read by `buy_merch` |
| Out | Tap page, on the recap | The public table `merch_template`; the views `my_merch_suggestions` and `my_merch_orders` | Subscription |
| Out | Tap page, through `bandit-api` | The template images, as static files served with the page; the photo from its `photo.url`, `/blobs/<sha256>`, served by `GET /blobs/{hash}` (access class `shared`) | HTTPS ([Rust-Backend](../3-services/Rust-Backend.md)) |
| Out | Organizer portal, Merch tab | The public table `merch_template`; the view `board_merch_orders`, which returns rows only to the module owner and `ops`: one row per order with its id, the attendee's display name, the template id and title, the size, the amount in cents, the status, the failure, the Capital One Nessie purchase id and when it was ordered | Subscription |
| Out | `bandit-workers`: the shopping agent | The job `merch_picks`, one per attendee in a photo, from `end_event` and `rerun_shopping_agent` (role `ops`): the attendee's places and minutes at booths, the people they met, their photos with the people in each, and every product with its sponsors | `job` table |
| In | `bandit-workers` (role `worker`) | `submit_merch_picks` with the job id, up to three picks (template id, photo id, line, reason) and the model call | Reducer |
| Out | Organizer portal, Merch tab | The view `board_merch_picks`, for staff: each attendee's picks with the photo, the line and the reason | Subscription |
| Out | `bandit-workers` ([Capital-One-Nessie](../7-integrations/Capital-One-Nessie.md)) | The job `merch_purchase`: order id, account id, merchant id (empty before the first purchase), amount in cents, memo | `job` table |
| In | `bandit-workers` (role `worker`) | `settle_merch_order` with the job id, the merchant id and the purchase id | Reducer |

## Design

### Templates

Before the event the team makes six template images by hand. They live in `assets/merch/` with `templates.json`. For each image file, `templates.json` gives its `title`, `kind`, `sponsors` (organisation names; empty for a plain template), `width`, `height` and `photo_area` (`x`, `y`, `w`, `h` in pixels).

The photo area is painted pure green (`#00FF00`) in each image, so it is easy to see while drawing, and the attendee's photo always covers it completely. The images ship with the tap page's static files.

After the event import, the setup calls `load_merch_templates` (roles `ops`, `ingest`) once, with every template in the file. The reducer sets the price from the kind.

It matches each sponsor name to the imported `organization` rows and stores the booths of those organisations as the template's `booth_ids`. It refuses a sponsor with no booth, so it runs after the import. It upserts by the image file name, so loading the file again changes nothing.

The six templates for Cal Hacks 13.0:

| Image | Title | `kind` | Sponsors |
|---|---|---|---|
| `tee.png` | Cal Hacks 13.0 tee | `tee` | none |
| `mug.png` | Cal Hacks 13.0 mug | `mug` | none |
| `poster.png` | Cal Hacks 13.0 poster | `poster` | none |
| `tee_spacetimedb.png` | SpacetimeDB tee | `tee` | SpacetimeDB |
| `mug_elastic.png` | Elastic mug | `mug` | Elastic |
| `poster_booth_crawl.png` | Booth crawl poster | `poster` | SpacetimeDB, Elastic, Bright Data, Capital One, Hyphenate, Anthropic |

Prices go by kind: a tee is 2500 cents, a mug 1800 and a poster 1500. A tee comes in S, M, L and XL; a mug and a poster in one size.

| `merch_template` field | Meaning |
|---|---|
| `id` | Assigned by SpacetimeDB |
| `name` | The image's file name, unique; the loader upserts by it |
| `title` | Display name |
| `kind` | `tee`, `mug`, `poster` |
| `price_cents` | Integer cents, USD, set from the kind |
| `image_url` | Where the tap page's static files serve the image: `/assets/merch/<name>` |
| `width`, `height` | The image's size in pixels |
| `photo_x`, `photo_y`, `photo_w`, `photo_h` | The green photo area, in the image's pixels |
| `booth_ids` | The booths of the sponsors the template names; empty for a plain template |
| `updated_at` | The last load |

`merch_template` is a public table: it holds no personal data, and the tap page needs it to draw the preview.

### Suggestions

The question this diagram answers: which template and photo pairs reach the attendee, and in what order.

```mermaid
flowchart TD
    PH["the caller's tagged photos"] --> PICK["for each template: the best photo, taken at its booths, else the newest"]
    T["merch_template rows"] --> PICK
    PICK --> RANK["rank: minutes at the template's booths, then photo at those booths, then plain before sponsor, then newest photo"]
    V["the caller's visit minutes"] --> RANK
    RANK --> TOP["my_merch_suggestions: top 3"]
    classDef stdb fill:#E8EAF6,stroke:#283593,color:#1A1A1A
    class PH,PICK,T,RANK,V,TOP stdb
```

`my_merch_suggestions` is a per-caller view. It starts from the photos where the caller has a `photo_tag`. Photo tags exist only for `findable` attendees whose band was in the photo's zone ([Social](Social.md)), so the buyer is always in the photo.

For each template the view picks the caller's best photo: one taken in the zone of one of the template's booths, else the newest. Then it ranks the templates:

1. The caller's minutes at the template's booths, summed over their `visit` rows there. A plain template has no booth and counts 0.
2. Then templates whose photo was taken at those booths.
3. Then plain templates before sponsor templates, so an attendee who never stopped at a sponsor booth sees the plain tee, mug and poster first.
4. Then the newest photo.

The view returns the top 3. Each row holds what the tap page needs to draw it: the rank, the template's id, title, kind, price, image address, size and photo area, and the photo id and its `url` (`/blobs/<sha256>`). The minutes only rank; the recap does not show them.

A typical first suggestion: the photo taken at the Elastic booth where the attendee spent 40 minutes, on `mug_elastic.png`.

Each row also carries the line printed under the photo (the people the caller met who are in it, "with A & B"), the people the caller met in the photo, and `ticks`: the template's sponsors whose booths the caller visited, which the tap page ticks on the booth crawl poster from the `checks` boxes in `templates.json`.

### The shopping agent

When the organizer presses "Event ended", `end_event` enqueues one `merch_picks` job for each non-crowd attendee with a photo tag who has not left yet. An attendee who leaves early gets their job the moment they walk out (`departure.left_at` is set, [Tap-Page](../5-apps/Tap-Page.md)), so their picks are ready while the event goes on without them. The payload is the attendee's night as the bands measured it: the zones and minutes, the booths in each zone, the people they met and for how long, each photo with its zone, its caption, the people the bands put in it and which of those they met, and every template with its sponsors and price.

`bandit-workers` sends it to Claude, which picks three different templates, a photo for each and a line of at most 36 characters, with one sentence on why. The worker checks every template and photo id against the payload and asks once more with the problems listed when an answer is wrong. `submit_merch_picks` checks them again (a known template, once each, a photo the attendee is tagged in) and stores them in `merch_pick`.

Once an attendee has picks, `my_merch_suggestions` returns those, in Claude's order, with the reason shown as "Picked for you". `buy_merch` copies the pick's line onto the order. The organizer's Merch tab shows every attendee's picks and can run the agent again.

### The preview

The merch section, "Make it merch", is the bottom of the recap, after the space-time view and the social part ([Tap-Page](../5-apps/Tap-Page.md)). From top to bottom it holds the wallet balance from `my_wallet` ([Capital-One-Nessie](../7-integrations/Capital-One-Nessie.md)), the suggestions, "Your orders" and the "Wallet activity" table.

For each suggestion the tap page draws the template image and places the photo over the green photo area, scaled to cover the area and centred, so whatever spills over the edges is cropped and no green shows. The page scales the photo area by the drawn size over `width` and `height`. The photo comes from its `url` in the blob store, through `GET /blobs/{hash}`.

No server renders anything; an order stores the template and the photo, which is all a printer would need.

### From photo to order

The question this diagram answers: what happens between a suggestion on the recap and a paid order.

```mermaid
sequenceDiagram
    participant AT as Tap page, the recap
    participant M as band1t module
    participant W as bandit-workers (Capital-One-Nessie.md)
    participant N as Capital One Nessie API
    AT->>M: subscribe my_merch_suggestions, my_wallet
    M-->>AT: top 3 template and photo pairs, the balance
    AT->>AT: place the photo in the photo area
    AT->>M: buy_merch, template, photo, size
    M->>M: event ended, own tag, wallet covers the price, merch_order paying, job merch_purchase
    W->>M: claim_job merch_purchase
    W->>N: first purchase only: create the merchant BandIt merch
    W->>N: purchase from the attendee's wallet
    W->>M: settle_merch_order, merchant id, purchase id
    M->>M: merch_shop once, wallet_entry purchase, order paid
    M-->>AT: my_merch_orders shows paid, my_wallet the new balance
```

1. **Suggest.** The recap subscribes to `my_merch_suggestions` and shows the three previews, each with its price, below the wallet balance from `my_wallet` at the top of the section. While `my_wallet` has no row, the top reads "Connect your Capital One wallet at band setup to buy merch." and every "Buy" button is disabled ([Capital-One-Nessie](../7-integrations/Capital-One-Nessie.md)).
2. **Buy.** The attendee picks one and, for a tee, a size, and taps "Buy". In one transaction, `buy_merch` checks that the event has ended for the caller (`event_state.ended` is set, or the caller's `departure.left_at` is, otherwise "merch opens in your recap once you leave or the event ends"), that the size fits the kind, that the caller is tagged in the photo, that the caller has a wallet (`claimant_account`), and that the wallet's spendable balance covers the price.

   It then writes a `merch_order` in status `paying`, with the template's price as `amount_cents`, and enqueues `merch_purchase`. From then on the order's amount is held: the spendable balance leaves it out, so a second tap cannot spend the same money.
3. **Settle.** `bandit-workers` records the purchase on the attendee's wallet in Capital One Nessie and calls `settle_merch_order` ([Capital-One-Nessie](../7-integrations/Capital-One-Nessie.md)). The reducer rejects a stale lease, stores the merchant in `merch_shop` if it is not there yet, adds a `purchase` entry of minus the amount to `wallet_entry`, and sets the order `paid` with the Capital One Nessie purchase id.

There is no separate confirm step. The tap on "Buy" is the attendee's confirmation, and the SpacetimeDB SpacetimeAuth sign-in proves who is buying on any device.

| `merch_order` field | Meaning |
|---|---|
| `id` | Assigned by SpacetimeDB |
| `attendee` | Who ordered: the caller's identity |
| `template_id`, `photo_id` | What: the template and the photo placed in its photo area |
| `size` | S, M, L or XL for a `tee`; empty otherwise |
| `amount_cents` | The template's `price_cents`, copied by the reducer |
| `status` | `paying`, `paid`, `failed` |
| `failure` | Why the purchase failed, from the dead job |
| `nessie_purchase_id` | The Capital One Nessie purchase, once paid |
| `created_at`, `updated_at` | Timing |

`merch_shop` has one row, id 0, with `nessie_merchant_id`: the Capital One Nessie merchant "BandIt merch". `buy_merch` copies the id into the job. It is empty until the first purchase creates the merchant.

### Order status

The question this diagram answers: which states an order passes through.

```mermaid
stateDiagram-v2
    [*] --> paying : buy_merch, job merch_purchase
    paying --> paid : settle_merch_order
    paying --> failed : merch_purchase dead after 3 attempts
    paid --> [*]
    failed --> [*]
```

When the `merch_purchase` job fails 3 times, the order becomes `failed` with the job's error, and its held amount is free again. The attendee can tap "Buy" again, which makes a new order. There is no cancel and no refund.

### The Merch tab

The organizer portal's Merch tab shows the loaded templates, each with its image, title, kind, price, photo area and sponsor booths, and, for `ops`, every order from `board_merch_orders`, newest first, with the totals paid ([Organizer-Portal](../5-apps/Organizer-Portal.md)). It has no controls: the attendee buys from the recap, and the worker settles the order.

## Failure modes and fallbacks

| Failure | Effect | Design answer |
|---|---|---|
| No photo qualifies: no tag yet | The merch section is empty | The section says merch appears once a photographer takes a photo of the attendee |
| The attendee has no wallet, or it is still opening | `buy_merch` refuses with "your BandIt wallet is still opening" | No order and no Capital One Nessie API call; the top of the merch section shows "Connect your Capital One wallet at band setup to buy merch." and "Buy" stays disabled until `my_wallet` has a row |
| Balance too low | `buy_merch` refuses with "not enough money in your BandIt wallet" | No order and no Capital One Nessie API call |
| The Capital One Nessie API is unreachable | The order stays `paying` | The job retries, and a retry reuses a purchase with the same memo, so it never buys twice; after 3 attempts the order is `failed`, the money is free again, and the attendee can buy again |
| Two quick taps | Two orders | Each order holds its amount at once, so the wallet never spends more than it holds |

## Dependencies

**Depends on**

- [Social](Social.md): `visit`, `photo`, `photo_tag` and the tag rule. Merch cannot run without it.
- [Capital-One-Nessie](../7-integrations/Capital-One-Nessie.md): the wallet (`claimant_account`, `wallet_entry`), its spendable balance, and the `merch_purchase` work in `bandit-workers`. Merch cannot run without it, because every order is paid from the wallet.
- [SpacetimeDB](../2-data/SpacetimeDB.md): `booth`, `blob_ref`, `job`, `event_state`.
- Bright-Data.md: the imported `organization` rows that sponsor names match. Without it, load only the plain templates.
- [Rust-Backend](../3-services/Rust-Backend.md): `bandit-api` serves the template images with the tap page and the photos through `GET /blobs/{hash}`.
- [Tap-Page](../5-apps/Tap-Page.md): the merch section at the bottom of the recap, the preview and the "Buy" button, all run as the signed-in attendee.
- [Organizer-Portal](../5-apps/Organizer-Portal.md): the Merch tab, which shows the templates and orders.

**Used by**

- [Tap-Page](../5-apps/Tap-Page.md): the merch section of the recap.
- [Capital-One-Nessie](../7-integrations/Capital-One-Nessie.md): merch is the one purchase the wallet carries; orders still `paying` are left out of the spendable balance.

**If you delete this file**

- Remove the tables `merch_template`, `merch_order` and `merch_shop`, the reducers `load_merch_templates`, `buy_merch` and `settle_merch_order`, and the views `my_merch_suggestions`, `my_merch_orders` and `board_merch_orders` from [SpacetimeDB](../2-data/SpacetimeDB.md); `assets/merch/` from the tap page's static files; and the template load from the setup.
- Remove the `merch_purchase` job and the Merch lines from [Capital-One-Nessie](../7-integrations/Capital-One-Nessie.md) and [Rust-Backend](../3-services/Rust-Backend.md); the wallet then holds only the opening and claim payouts. Remove the Merch tab and the Merch.md lines from [Organizer-Portal](../5-apps/Organizer-Portal.md). Remove the merch section of the recap from [Tap-Page](../5-apps/Tap-Page.md); the wallet balance and "Wallet activity" then show on their own at the end of the recap ([Capital-One-Nessie](../7-integrations/Capital-One-Nessie.md)).
- Remove the Merch.md step 8 in [Flows](../1-overview/Flows.md), the prize row in [Architecture](../1-overview/Architecture.md), the Merch.md rows in [Requirements](../1-overview/Requirements.md) and [Decisions](../1-overview/Decisions.md), the Merch lines in [Bright-Data](../7-integrations/Bright-Data.md), and the Merch row and node in [README](../README.md).

## Decisions

| Decision | Why |
|---|---|
| A few templates are made by hand before the event, each with a marked photo area; the product has no image API and generates no images | A hackathon needs only a few images, so nothing can fail or stall during the event; any event loads its own templates |
| The photo area is painted pure green (`#00FF00`) in each image, and its rectangle is written in `templates.json` | The team sees the area while drawing, and the page needs only a rectangle, with no image analysis |
| The attendee's own photo goes straight into the photo area, scaled to cover it, drawn by the tap page | No server renders or stores anything; an order keeps the template and the photo |
| Suggestions are the view `my_merch_suggestions`: the shopping agent's three picks once it has answered, else ranked by the caller's minutes at the template's booths, then by a photo taken at those booths, then plain templates before sponsor ones; top 3 | The agent reads the whole night (booths, minutes, the people in each photo) and writes the printed line; the ranking keeps the shop working before it answers or without it |
| The shopping agent runs once for each attendee, when their night ends: when they leave early, else when the event ends; code checks every id it returns | Nobody shops during the event, and a pick can only name a real product and a photo the attendee is in |
| A sponsor template names its sponsors in `templates.json`; the loader matches them to the imported organisations and stores their booths | The team knows sponsor names, not row ids, and the booth crawl poster names six sponsors at once; merch from the booth the attendee spent time at is the Visa shopping story |
| A photo can be bought only by someone tagged in it; there is no merch consent switch | Tags exist only for `findable` attendees whose band was in the photo's zone, so the buyer is always in the photo |
| Sizes and prices go by kind: a `tee` costs 2500 cents and comes in S, M, L and XL; a `mug` costs 1800 and a `poster` 1500, in one size | No size list to keep, and the same kind costs the same with or without a sponsor |
| One item per order, with no quantity | An attendee buys one thing at a time; a second item is a second order |
| Orders reach the organizer portal only through `board_merch_orders`, for the owner and `ops` | an order names the attendee who placed it, so only the organizer sees the list |
| Checkout is one tap: `buy_merch` checks the wallet, writes the order and holds its amount in one transaction, and a worker records the purchase on Capital One Nessie afterwards | No confirm screen and no payment row; the module's own balance makes the check exact, and a second tap cannot spend the same money |
| Merch is bought only from the recap after the event, by the signed-in attendee; no counter and no band press | Nothing is paid at the venue, and the SpacetimeDB SpacetimeAuth sign-in proves who is buying on any device |
| A failed purchase fails the order and frees its money; there is no cancel and no refund | Buying again is a new order, and the flow ends at a paid order |
| Printing and shipping are out of scope | The flow ends at a paid order |
| Merch is deleted together with Social.md or Capital-One-Nessie.md | Every suggestion starts from a visit and a photo, and every order is paid from the wallet |
