# README happy path against vik-e2e (8f12ea0)

Built = on vik-e2e, with where. Missing = README asks for it and nothing on vik-e2e does it. Leo = band hardware, firmware or vision.

## Joining

| README step | State | Where |
|---|---|---|
| You get a BandIt band when you join | Leo | the band itself; test bands 90-99 stand in for it |
| Create an account by tapping the band (NFC) | Built, sign-in not configured | tap link `/t/BANDIT-nn` in `web/src/pages/t.ts`, `claim_band` and the press in `social/onboarding.rs` and `social/tick.rs`. The NFC sticker is Leo's. SpacetimeAuth email sign-in is coded in `web/src/lib.ts`, but the running services have no `SPACETIMEAUTH_CLIENT_ID`, so there is no account: the identity lives in the browser |
| Connect your social media | Built | typed Instagram, Facebook and Threads handles, `socialsStep` in `t.ts`, `set_social_handle` |
| Medical history and insurance | Built | two PDF uploads, Claude reads them into the medical card, "Looks right" confirms (`documentStep`, `cardStep` in `t.ts`, `spacetimedb/server/src/medical`, `bandit-workers` medical job) |
| (brief) Wallet connect | Built | `walletStep` in `t.ts`, `connect_wallet` in `wallet/mod.rs`, `wallet_open` job on Nessie |

## Safety

| README step | State | Where |
|---|---|---|
| Bands locate themselves among other bands by radio | Leo | firmware neighbour counts and station markers; band1t ingest stores them |
| Combined with the venue cameras into a space-time map | Leo | vision; the band side is the `zone_visit` and `encounter` tables |
| Track high-risk crowd-crush areas | Built | host portal Live tab, per-zone neighbours and level (`live()` in `organizer.ts`) |
| A fall makes the bands around vibrate and flash red | Leo (on the band), Built (server) | light circle is firmware; `watch_bands` in `safety/mod.rs` opens the fall incident with its witnesses; Bands tab "Fall here" |
| The band points people along the best dispersion route | Leo | a band goes GUIDE in its exit colour at red density in firmware; route choice is part of Leo's space-time work |
| Fire or low visibility: LEDs guide people to the nearest exit | Built | Live tab "Low visibility" button, `set_low_vis` broadcasts `lowvis`; the band behaviour is firmware |
| A paramedic is coming in: bands show how to disperse | Leo | medic-approach guidance is Leo's; `assign_medic` marks the incident responding |
| Disperse high-risk areas before accidents happen | Leo | same as the dispersion route above |

## Insurance

| README step | State | Where |
|---|---|---|
| Reconcile accidents early with the insurer | Built | resolve with a cost note opens the claim; Claude reads the clinic PDF, Elastic validates, Claude reviews, code routes; approve, learned rule, ledger, Nessie payout (`insurance/`, `hyphenate-core`, `claims-elastic`, `bandit-workers`, Claims tab) |
| Cameras catch property damage (a broken speaker) | Built as a scripted run, Leo (camera) | Bands tab "Speaker breaks in ..." opens a property claim; real camera detection is vision |

## Social

| README step | State | Where |
|---|---|---|
| Find who you hung out with after the event | Built | encounters from band1t's `encounter` in `social/tick.rs` (what counts as "met" is Leo's), recap people list ranked by Elastic through `/api/recap` |
| See which booths you hung out at, and when | Built | recap "Where you were" space-time view and booth list (`recap.ts`) |
| A link with your space-time history, top booths and people's socials | Built | the tap link turns into the recap after "Event ended" (`end_event` in `web.rs`) |
| Photographers' photos tag the exact people in them | Built (zone and time), Leo (photo features) | `/photo` page, `register_photo` tags the bands in that zone (`social/photos.rs`) |
| Share photos and tag people on social media | Built | recap Share button with @handles in the caption (`recap.ts`) |

## Shopping

| README step | State | Where |
|---|---|---|
| Personalised merch with you and your people, from where you hung out | Built | `my_merch_suggestions` ranks templates by booth minutes with a confirmed photo (`merch/mod.rs`), mockup in `recap.ts` |
| Buy what you like at the end | Built | Buy on the recap, `buy_merch`, `merch_purchase` job on Nessie |
| "Reimagine shopping using agents" | Question | no agent picks or buys the merch; ranking is code by booth minutes |
