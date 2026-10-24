# End-to-end run

One branch (`vik-e2e`) with the pipeline, insurance, social and merch work and the plain web pages, for testing the whole happy path. Vision and the band hardware are not part of it.

## Start

```sh
scripts/e2e-server     # local only: a private SpacetimeDB on 127.0.0.1:3097 (leave it running)
scripts/e2e-setup      # publish, load the event, merch templates, insurance actors, roles, crowd
scripts/e2e-services   # bandit-api with the pages, bandit-indexer, bandit-workers
```

`E2E_TARGET=maincloud` points all three scripts at the live database `bandit-calhacks13-sp82j` instead. On Maincloud, setup publishes without wiping data and does not import the event (the pipeline loads the real CalHacks bundle). `BANDIT_DEMO=1` (the default in `e2e-services`) turns on the "play as" switcher, the demo band press and the demo medical records.

Pages, on http://127.0.0.1:8097:

| Page | Who | What |
|---|---|---|
| `/t/BANDIT-0n` | attendee | the band's tap link: sign in, claim by press, name, socials, "is this you?", then the live view, wallet and claims; after "Event ended", the recap |
| `/organizer` | host and staff | live zones and alerts, attendees, incidents and claims, learned rules, import runs, Kibana, "Event ended" |
| `/photo` | photographer | add a photo taken in a zone; the people whose bands were there are tagged |

## Happy path to test

1. Open `/t/BANDIT-94` (a demo band) and press "Demo: press the band for me". Fill the name, findable on, Instagram, then "This is me" if a profile matches. The wallet shows $200 from Capital One Nessie.
2. Walk the band with the demo buttons (Sponsor row, then Main stage). The host portal's Live tab shows the people per zone change live.
3. `/photo?as=photographer`: add a photo in the zone the band is in.
4. A fall: `. scripts/e2e-env && target/debug/bandit-claims fall --band 91 --witnesses 90,92` (Maya Chen at Main stage).
5. `/organizer?as=medic`, Claims: take the incident, add a note with a cost, resolve it. The claim opens; file "Event first aid, wrist sprain" as the demo record. Claude reads it, Elastic validates it, Claude reviews it, and code routes it.
6. `/organizer?as=sam`: open the claim, approve with "learn" checked. Rule v1 appears and $180 lands in Maya's wallet (`/t/BANDIT-91?as=maya`).
7. A second fall settles by itself under rule v1: `bandit-claims fall --band 92 --witnesses 90,93`, then the medic steps again.
8. `/organizer?as=ops`: "Event ended". Every open tap link switches to the recap: where you were and when, the people and booths you spent time with (ranked by Elastic), photos with who is in them and Share, merch with your photo, Buy through Nessie.

`scripts/e2e-sql "<query>"` runs SQL as the database owner. Logs are in `.dev/e2e-<target>/logs`.
