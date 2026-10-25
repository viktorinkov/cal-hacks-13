# End-to-end run

One branch (`vik-e2e`) with the pipeline, insurance, social and merch work and the plain web pages, for testing the whole happy path. Vision and the band hardware are not part of it.

## Start

Scanned PDFs use Poppler's `pdftoppm` to render page images for the Evidence Engine. Install it before starting local workers:

```sh
brew install poppler
```

The Debian deployment installs `poppler-utils` and checks `pdftoppm` before restarting workers.

`scripts/run` does it all in one command: it sets up the database the first time, starts the services and opens the host portal and band 94's tap link (Maincloud by default, `E2E_TARGET=local` for the private server). The pieces:

```sh
scripts/e2e-server     # local only: a private SpacetimeDB on 127.0.0.1:3097 (leave it running)
scripts/e2e-publish    # build the module and publish it
scripts/e2e-setup      # load the event, merch templates, insurance actors, roles, crowd
scripts/e2e-services   # bandit-api with the pages, bandit-indexer, bandit-workers
```

`E2E_TARGET=maincloud` points the scripts at the live database `bandit-calhacks13-sp82j` instead. On Maincloud, publish keeps the data and does not import the event (the pipeline loads the real CalHacks bundle). `BANDIT_TEST_MODE=1` (the default in `e2e-services`) turns on the "play as" switcher, the buttons for bands 90 to 99 and the test medical records.

Pages, on http://127.0.0.1:8097:

| Page | Who | What |
|---|---|---|
| `/t/<band code>` (`/t/BANDIT-0n` on the first tags) | attendee | the band's tap link: sign in, claim by press, name, socials, medical history and insurance PDFs, "is this you?", the Capital One wallet, then a thank-you; after "Event ended", the recap |
| `/organizer-access` | anyone with email sign-in | choose organizer access for this account; no email whitelist, no owner grant |
| `/organizer` | host and staff | live zones and alerts, low visibility, attendees, incidents, medical cards and claims, learned rules, Kibana links, the Bands tab, "Event ended" |
| `/photo` | photographer | add a photo taken in a zone; the people whose bands were there are tagged |
| `/friends` | registered attendee | search for someone they met by remembered name, place or moment; reuses their existing attendee identity and shows the recorded evidence |

## Organizer access

Open `https://band1t.vip/organizer`, sign in with email, then select **Continue as organizer**. An account already signed in as an attendee uses the same button. The plain portal at `/portal` has the same enrollment path. Opening `/organizer-access` starts it directly.

Enrollment grants only `ops` to the signed-in caller. Repeating it preserves existing roles and owners. Attendee sign-in alone does not enroll the attendee. Anonymous identities and tokens outside the email sign-in issuer cannot enroll. Other staff roles, owner controls, claim approvals and payments keep their existing checks.

## Happy path to test

1. Open `/t/AJMN-676X` (test band 94, no radio needed) and press "Press the band for me". Fill the name, keep findable on, add Instagram. Upload the medical history and the insurance card ("Use a test record" gives synthetic ones); Claude reads them into the medical card, which you confirm with "Looks right". Connect the Capital One wallet ($200 on Nessie). The page ends on a thank-you.
2. Host portal, Bands tab (`/organizer?as=ops#bands`): walk the band between zones; the Live tab shows it on the venue map among the crowd of 1,000 and the people per zone change.
3. `/photo?as=photographer`: add a photo in the zone the band is in.
4. Bands tab: "Fall here" on your own band (94-99), so the claim you run by hand never collides with the story's attendees. The incident opens with two bands around you.
5. `/organizer?as=medic`, Claims: take the incident, tap the band for your medical card, add a note with a cost, resolve it. The claim opens; file "Event first aid, wrist sprain" as the test record, which is made out to you with an invoice number of its own. Claude reads it, Elastic validates it, Claude reviews it, and code routes it.
6. `/organizer?as=ops` (the organizer, after the event): open the claim, approve with "learn" checked. Rule v1 appears and the payout lands in your wallet.
7. The insurance story with every route (a claim learned, a similar one settling by itself under the rule, a fake refused, a mass occurrence the organizer decides claim by claim): `target/debug/bandit-claims story --no-pause` after `. scripts/e2e-env`. It borrows bands 94-98 as witnesses.
8. `/organizer?as=ops`: "Event ended". Every open tap link switches to the recap: where you were and when, the people and booths you spent time with (ranked by Elastic), photos with who is in them and Share, merch with your photo, Buy from the wallet.

`scripts/e2e-sql "<query>"` runs SQL as the database owner. Logs are in `.dev/e2e-<target>/logs`.

## Populate the finance dashboard

Starting the event from the dev portal also schedules purchases by generated attendees. The first attempt is after 30 seconds, then purchases by about 30% of the crowd are spread over the run: about 300 shoppers with 1,000 people. Each shopper buys once per run. The run opens only the selected shoppers' wallets and uses normal photo tags, shipping checkout and payment workers. Costs updates as orders become paid; Pause stops new orders while payments already processing can finish. Starting another run preserves earlier sales.

After the event's test attendees have visited Sponsor row and their wallets have opened, run:

```sh
scripts/finance-setup
```

This reuses the Sponsor row crew illustration, tags it from the recorded band visits, buys four products for $76 through the normal wallet workers, and records one settled property claim's insurer receipt. Each order has the public venue address marked “test order, do not ship.” It preserves the event's state and existing claims. Rerunning reuses the same photo, orders and receipt. The default target is Maincloud and the upload host is `https://dev.band1t.vip`.

To prepare the photo before publishing a module change, run:

```sh
scripts/finance-setup --prepare-only
```
