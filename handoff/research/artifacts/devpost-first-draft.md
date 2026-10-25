# BandIt Devpost

Saved from https://claude.ai/artifact/AcYeWKkabHsDToBQi1GRCF, last updated 2026-10-24.

## Tagline and links

**Tagline:** The only band you need at a public event. It keeps the crowd safe, settles accident claims on its own, and turns your night into a recap of the people you met.

**Try it out**

| What | Link |
| --- | --- |
| Live site | [band1t.vip](https://band1t.vip) |
| Organizer portal | [band1t.vip/organizer](https://band1t.vip/organizer) |
| A band's tap link | [band1t.vip/t/BANDIT-01](https://band1t.vip/t/BANDIT-01) |
| Photographer upload | [band1t.vip/photo](https://band1t.vip/photo) |
| Code | [github.com/viktorinkov/cal-hacks-13](https://github.com/viktorinkov/cal-hacks-13) |
| System design board | [Excalidraw](https://excalidraw.com/#json=MkGRkUgvLvTxJ7IX9tnoP,pIpsDpCWIJw_rmvxFNvK1w) |

## Inspiration

In the US in 2024, 44,500 people died and 15.6 million were hurt in preventable accidents in public places, and falls alone caused about 15,000 of those deaths ([National Safety Council](https://injuryfacts.nsc.org/home-and-community/deaths-in-public-places/introduction/)). At a concert or a festival, a fall is worse: the person on the ground can be crushed by the crowd before anyone notices.

The same crowd is also where the good things happen. You meet someone great at a show and forget to get their Instagram. You spend an hour at a booth you loved and can't remember its name. You want the merch, but your hands are already full.

We wanted one band that does all of it: it keeps the people around you safe, it gets the venue's insurance paid without weeks of paperwork, and after the event it gives you back the night.

## What it does

Every attendee gets a BandIt band at the door. Tapping it with a phone (NFC) opens the band's page, and the night runs in three parts.

**Joining.** You sign in with your email, press the band's button to make it yours, and add your name and socials. BandIt asks "is this you?" against public profiles it scraped for the event. You upload your medical history and insurance card as PDFs, and Claude turns them into a medical card that you confirm. Last, you connect a Capital One wallet with $200 to spend.

**During the event.** Each band hears the bands around it by radio and shows how crowded its spot is on its LED ring. Station markers split the venue into zones, so the organizer portal shows how many people are in each zone, live. When someone falls or presses SOS, every band around them flashes red and vibrates so people step back instead of closing in. An incident opens for the medic, who taps the person's band to see their medical card, and only while the incident is open. In a fire or smoke, one button turns on low visibility and every band guides its wearer to the nearest exit by colour.

**Insurance, after the incident.** When the medic resolves an incident, a claim opens on its own. Claude reads the clinic record, Elastic validates it and finds similar past claims, Claude checks whether the story holds up, and code decides coverage and the amount from a fee schedule. A claim that code can't settle goes to the organizer, who decides it. Approving with "learn" turns the decision into a rule, so the next similar claim settles in seconds without anyone. The payout lands in the attendee's Capital One wallet. A fake claim is refused with every failed check listed, and a broken speaker becomes a property claim with a recovery letter.

**After the event.** When the organizer presses "Event ended", every band's page turns into that person's recap:

- where you were and when, zone by zone
- the people you spent time with, with their socials, ranked by how much you have in common
- the booths you spent time at, ranked the same way
- the event photographer's photos you're in, already tagged with who is in them, ready to share
- merch made with your own photo from the booths you loved, bought with one tap from your wallet

The organizer also gets the Event graph: a live map of the whole event, with anonymous people linked to the people they met, the booths they visited and the companies behind them.

## How we built it

Each part does what it is best at. SpacetimeDB holds everything live and exact, Elastic organizes data and ranks it by meaning, Claude reads documents and writes the judgment calls, and code decides money, coverage and safety.

**The bands.** Each band is a Seeed XIAO ESP32-C3 with a 12-LED WS2812B ring, an SOS button, an NTAG215 NFC sticker and a LiPo battery. Some also carry an MPU-6050 for fall detection and a coin vibration motor. Bands beacon ten times a second over ESP-NOW and count their neighbours, so the crowd colour and the SOS light circle work on the band itself, even with no internet. Station markers mark the zones, and a USB gateway passes every packet to a Rust bridge that writes it to SpacetimeDB.

**SpacetimeDB is the live world.** One Rust module on Maincloud holds the bands, zones, incidents, medical cards, claims, wallets and the people graph. A fall is one reducer call that opens the incident, records the bands in the light circle and schedules its escalation in a single transaction. Scheduled reducers turn raw band reports into zone state and into a space-time history of who was where and when. Every screen subscribes to its own slice, so the organizer portal, the medic's phone and the attendee's page update the moment something commits. Sign-in is SpacetimeAuth, and views keyed on the caller enforce access in the database, such as "a medic sees a medical card only during an open incident".

**Bright Data and Elastic build the event.** Before doors open, our Rust tool `bandit-ingest` uses the Bright Data Web MCP to scrape the Cal Hacks site and Devpost pages and to run the LinkedIn, Crunchbase and Google Maps scrapers for every sponsor: 245 records from 6 sources. Elastic organizes them: ES|QL `LOOKUP JOIN` steps match booths and domains, and an Agent Builder agent run by an Elastic Workflow merges the same company spelled three ways into one organization, with a reason for each merge. Rust checks the result and loads it into SpacetimeDB in one `import_event` transaction. Kibana dashboards show each import run and the event's sponsors and prizes.

**Elastic ranks the recap.** SpacetimeDB decides exactly who and what goes on your recap, and Elastic decides the order. A one-way indexer copies findable attendees and booths into `semantic_text` fields, and the recap ranks the people you met and the booths you visited by how close they are to what you were into.

**The claims agent.** Our Rust workers take claim jobs from a queue in SpacetimeDB. Claude Opus 5.5 reads the clinic record PDF into structured facts with a JSON schema, a de-identified copy of the claim goes through an Elastic ingest pipeline that validates it and ranks similar past claims, and Claude reviews whether the injury matches the incident. Code then applies the fee schedule, the coverage and any learned rule, and routes the claim. Claude also writes the notice of loss in the ACORD 3 layout and the recovery letter. Every model call is recorded, and the model never decides an amount.

**Capital One Nessie is the wallet.** Each attendee gets a Nessie customer and account with $200. Merch orders are Nessie purchases at the BandIt merch merchant, and claim payouts are Nessie deposits. SpacetimeDB keeps the exact balance.

**The web pages and hosting.** The attendee page, the organizer portal and the photographer page are TypeScript on SpacetimeDB's TypeScript SDK, built with Bun. The Event graph is drawn with Sigma.js from a live SpacetimeDB view. The Rust API, workers and indexer run under systemd on a Vultr server in Silicon Valley, behind Caddy for HTTPS.

## Sponsor tracks

**SpacetimeDB.** The whole live event is one module on Maincloud. Reducers are the only write path, so an SOS incident, its light circle and its escalation commit together. Scheduled reducers compute zone state and the space-time history. The bridge, every Rust service and every web page share one generated schema and get each change pushed to them. Sign-in comes from SpacetimeAuth, and per-caller views keep medical cards and claims private inside the database.

**Elastic.** Elastic does the work SpacetimeDB can't: meaning. An Agent Builder agent in an Elastic Workflow resolves messy scraped records into one clean bundle, ES|QL `LOOKUP JOIN` matches booths and domains, `semantic_text` ranks each attendee's recap, and an ingest pipeline validates every claim and ranks it against 30 past claims. Kibana shows the import runs, the event's sponsors and prizes, and the claims evidence.

**Hyphenate: Autonomous Systems for Finance.** A claims agent that learns while it runs. A fall becomes a claim with no forms. Code cuts an urgent-care bill from $1,308 to $895 with a fee schedule. The organizer approves the first claim with "learn", which writes rule v1, and the next similar claim ($180) settles on its own in seconds. A rule is only ever made by a human approval and is versioned, never overwritten. Approvals made on stale numbers fail closed, every journal is double-entry, each evidence pack has a hash an auditor can recompute, and a scorecard plants genuine and fake claims to measure straight-through rate, dollars wrongly paid, precision and recall.

**Bright Data.** Without the scraped web data there is no event in BandIt: the organizations, booths, prizes, schedule and venue all come from the Bright Data Web MCP (`scrape_as_markdown` on the Cal Hacks and Devpost pages, plus the LinkedIn company, Crunchbase and Google Maps scrapers). Those records become the booths on your recap, the companies on the Event graph, the merch suggestions and the "is this you?" profile match. We only scrape public pages.

**Capital One: best use of Nessie.** Every attendee has a Nessie account with $200. Merch is a one-tap Nessie purchase from the recap, and insurance payouts are Nessie deposits into the same account, so the wallet shows the whole night in money.

**MLH: best use of Vultr.** The live site, the API, the claims workers and the Elastic indexer all run on one Vultr server in Silicon Valley, set up by one script with systemd and Caddy.

**Microsoft: Built for the Real World.** The claims agent is production-minded by design. Its customer is the event organizer, who today waits weeks on paperwork for small injury claims. Its usefulness is measured by the scorecard. Its design is responsible: the model only reads and writes words while code decides money, a de-identified copy is all Elastic ever sees, a medic sees a medical card only during an open incident, and every model call is recorded for audit. It runs end to end on the live site.

**Anthropic.** Claude Opus 5.5 does every reading and judgment job: it turns medical history and insurance PDFs into a medical card, reads clinic records into facts with structured outputs, reviews whether an injury fits the incident, and writes the notice of loss and the recovery letter. Code checks each answer and asks again when one breaks a rule.

## Challenges we ran into

- **Counting time together.** Our first version counted minutes together six times too high for anyone standing in a busy zone, so the recap said you spent 50 minutes with someone you passed. We had to rework how time together is counted.
- **Messy web data.** The same sponsor shows up under different names on the Cal Hacks site, Devpost, LinkedIn and Crunchbase. Exact joins in ES|QL caught most of it, and the Elastic agent handled the rest with a reason for every merge.
- **Letting an AI near money.** We wanted Claude's judgment without letting it pick a payout. We drew a hard line: Claude reads and writes words, code decides coverage and amounts, and an approval made on numbers that changed since fails closed.
- **Duplicate checks that worked too well.** Two people filing the same clinic record tripped our own duplicate detection, so every record is now made out to the claimant with its own invoice number.
- **Building Rust on a small server.** The first build on the 4 GB Vultr server ran out of memory, so the setup script adds swap and builds without debug info.

## Accomplishments that we're proud of

- **The whole night runs end to end on the live site.** Tap a band, set it up, walk it between zones, fall, get treated, get paid into your wallet, end the event, open your recap and buy a mug with your own photo on it.
- **A claims agent that learns from one decision.** After the organizer approves one fall claim with "learn", the next similar claim settles by itself in seconds, and a fake one is refused with the failed check named.
- **Real data, not fixtures.** The event in BandIt is Cal Hacks 13.0 itself: 245 records scraped through Bright Data, organized by Elastic and loaded into SpacetimeDB in one transaction.
- **Safety that doesn't need the internet.** Crowd colours, SOS and the light circle run on the bands, so they keep working if the server, the Wi-Fi or the cloud goes down.
- **A system design we can build from.** Every component has its own design doc, and every optional feature can be deleted without breaking the safety core.

## What we learned

- **Two databases, two jobs.** SpacetimeDB is the right home for anything live and exact: who is where, who may see what, what was paid. Elastic is the right home for meaning: messy text, fuzzy matches and "what is closest to what you like". Keeping live state out of Elastic and ranking out of SpacetimeDB made both simpler.
- **Logic in the database pays off.** With reducers and subscriptions, there is no app server between a band's SOS flag and the medic's screen, and no screen can disagree with another.
- **AI is most useful next to rules, not instead of them.** Claude is great at reading a clinic record or spotting that an injury happened at home. Code is better at money. The learned rules are where the two meet: a person decides once, and code repeats that decision exactly.

## What's next for BandIt

- **Venue cameras.** The design already has the interface for camera head counts, person-down alerts that confirm a fall, and property events like a falling speaker, so cameras and bands become the two-step system from our original idea.
- **More bands.** A real venue needs hundreds of bands, so the next step is a crowd test far beyond our nine.
- **A real insurer on the other end.** The notice of loss and the evidence packs are built to be sent, so the next step is a pilot with a venue and its insurer.

## Built with and team

**Built with:** rust, spacetimedb, spacetimeauth, typescript, bun, elasticsearch, elastic-agent-builder, kibana, bright-data, claude, anthropic, capital-one-nessie, vultr, caddy, esp32, esp-now, arduino, nfc, sigma.js, graphology

**Team**

- **Viktor Minchev:** everything outside the frontend: the SpacetimeDB module, the Rust services, the claims agent, the Bright Data and Elastic pipeline, Nessie and the Vultr deploy
- **Eddie:** the frontend and visuals
- **Leo:** vision
