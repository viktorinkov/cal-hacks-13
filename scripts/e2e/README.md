# End-to-end run

One branch (`vik-e2e`) with the pipeline, insurance, social and merch work and the plain web pages, for testing the whole happy path. Vision and the band hardware are not part of it.

## Start

`scripts/run` does it all in one command: it sets up the database the first time, starts the services and opens the host portal and band 94's tap link (Maincloud by default, `E2E_TARGET=local` for the private server). The pieces:

```sh
scripts/e2e-server     # local only: a private SpacetimeDB on 127.0.0.1:3097 (leave it running)
scripts/e2e-publish    # build the module and publish it
scripts/e2e-setup      # load the event, merch templates, insurance actors, roles, crowd
scripts/e2e-services   # bandit-api with the pages, bandit-indexer, bandit-workers
```

`E2E_TARGET=maincloud` points the scripts at the live database `bandit-calhacks13-sp82j` instead. On Maincloud, publish keeps the data and does not import the event (the pipeline loads the real CalHacks bundle). `BANDIT_SIMULATE=1` (the default in `e2e-services`) turns on the "play as" switcher, the simulated band press and the sample medical records.

Pages, on http://127.0.0.1:8097:

| Page | Who | What |
|---|---|---|
| `/t/BANDIT-0n` | attendee | the band's tap link: sign in, claim by press, name, socials, medical history and insurance PDFs, "is this you?", the Capital One wallet, then a thank-you; after "Event ended", the recap |
| `/organizer` | host and staff | live zones and alerts, low visibility, attendees, incidents, medical cards and claims, learned rules, import runs, Kibana, the Simulate tab, "Event ended" |
| `/photo` | photographer | add a photo taken in a zone; the people whose bands were there are tagged |

## Happy path to test

1. Open `/t/BANDIT-94` (a simulated band) and press "Press the band for me". Fill the name, keep findable on, add Instagram. Upload the medical history and the insurance card ("Use the sample PDF" gives synthetic ones); Claude reads them into the medical card, which you confirm with "Looks right". Connect the Capital One wallet ($200 on Nessie). The page ends on a thank-you.
2. Host portal, Simulate tab (`/organizer?as=ops#simulate`): walk the band between zones; the Live tab shows the people per zone change.
3. `/photo?as=photographer`: add a photo in the zone the band is in.
4. Simulate tab: "Fall here" on your own band (94-99), so the claim you run by hand never collides with the story's attendees. The incident opens with two bands around you.
5. `/organizer?as=medic`, Claims: take the incident, tap the band for your medical card, add a note with a cost, resolve it. The claim opens; file "Event first aid, wrist sprain" as the sample record, which is made out to you with an invoice number of its own. Claude reads it, Elastic validates it, Claude reviews it, and code routes it.
6. `/organizer?as=sam`: open the claim, approve with "learn" checked. Rule v1 appears and the payout lands in your wallet.
7. The insurance story with every route (a claim learned, a similar one settling by itself under the rule, a fake refused, a mass occurrence going to the adjuster): `target/debug/bandit-claims story --no-pause` after `. scripts/e2e-env`. It borrows simulated bands 94-98 as witnesses.
8. `/organizer?as=ops`: "Event ended". Every open tap link switches to the recap: where you were and when, the people and booths you spent time with (ranked by Elastic), photos with who is in them and Share, merch with your photo, Buy from the wallet.

`scripts/e2e-sql "<query>"` runs SQL as the database owner. Logs are in `.dev/e2e-<target>/logs`.
