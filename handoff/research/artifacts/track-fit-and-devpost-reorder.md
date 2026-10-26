# BandIt track fit and Devpost reorder

Saved from https://claude.ai/artifact/LU4m539T1hxFRzFAS8Jn2B, last updated 2026-10-25.

## Short answer

Mostly yes. Meta and the Cal Hacks People-First Social Impact track fit BandIt's story better than Hyphenate, and Best Hardware Hack fits as well as People-First. Visa fits too, but shopping is the thinnest part of the build, so it is the third story, not the lead.

I partly disagree on Hyphenate. On paper it is one of our best-matched tracks, since each of its four judging questions has a concrete answer in BandIt. Its brief even names "a music festival" as a company to build for.

It still goes lower, and I agree with that. Finance is one of four parts of BandIt, and Hyphenate's judges will compare us with projects that are finance from end to end. Microsoft's track fits our claims agent better, so it moves above Hyphenate.

On spreading too thin: opting in to a track costs nothing, but the Devpost story and the 3-minute video can carry only one thread. That thread is people at a crowded event: kept safe, connected to who they met, then remembered in merch, with the claim as the last beat.

So we opt in to every track below and cut the page instead. The sponsor sections follow the story too: the Cal Hacks tracks first, then SpacetimeDB, then Elastic and Bright Data, which set up the event before the doors open. Every other sponsor section keeps its quote whole and shortens our own text.

## Reordered Devpost outline

The page tells one story: kept safe, connected, remembered in merch, then paid. This is checked against your devpost.md of 04:59 UTC. Sponsor quotes stay whole, and every change below is to our own text. Word counts are our own text only: they leave out sponsor quotes, the criteria restated from Hyphenate's brief, headings and images, and the page has 12,521 such words today.

1. **Inspiration.** Keep Astroworld as the opening, and add one closing sentence that the same band also remembers who you met. Fix "National Safety Consul" to "Council", "15,6M" to "15.6M" and "We build" to "We built".
2. **What it does.** Reorder its lead sentence to match: it keeps people safe, connects the people who met, turns the night into merch, then works out who pays after an incident.

   1. Accidents stays first and unchanged, at 1,068 words. It carries People-First and Hardware.
   2. Social moves up from third to second, unchanged, at 890 words. It carries Meta.
   3. Shopping moves up from fourth to third, at 468 words. Add the booth payout here: an $18 mug pays its booth $11.20.
   4. Insurance moves from second to fourth and drops from 1,505 to about 900 words, keeping six subsections: "The venue's policy, read at setup", "Filing a claim", "Evidence from every source", "When the report does not match", "When a person decides" and "Your own plan, found for you".
   5. In Insurance, fold "When the policy leaves a gap" into "When a person decides", so the organizer's review sits in one place. Cut "The Evidence Engine and the insurance Decision Engine", which How we built it repeats.
   6. Also in Insurance, cut "What the insurer gets", "Damage to the venue", "Theft and breakage" and "Who pays what, on screen" to one sentence each.
3. **How we built it.** Move "Vision and the security view" up to follow "The bands", so the safety path reads in order. In "How the insurance Decision Engine decides", cut the precedent and journal paragraphs to one sentence each, which takes it from 737 to about 550 words.
4. **System design.** In "Case by case", move "An accident claim" after "Buying merch and getting paid", to match What it does. "Medic routing" stays after the medical card.
5. **Sponsor tracks**, in this order. Every prompt quote stays whole.

   1. Cal Hacks tracks, a new short section that goes first, since the story opens with safety: one line each for People-First, Hardware and Technically Advanced. There is no prompt to quote.
   2. SpacetimeDB, unchanged: every band and screen shares its live world.
   3. Elastic, unchanged, right after SpacetimeDB, since its Agent Builder agents organize the scraped event and read the venue's policy before the doors open.
   4. Bright Data, unchanged, right after Elastic, since its scrape feeds Elastic's organizer agent. Lead with the plan lookup at every sign-up: each new attendee who names their plan starts a live search for its public PDF. Then add the live venue setup, which the Devpost does not mention yet: an organizer types an event's name on the Venue setup tab, and Bright Data finds its venue, pages and 3D map.
   5. Meta, moved up from last, at 828 words with "How BandIt connects people". Its "AI." paragraph should lead with what "Ranking by meaning" already says: Elastic orders the people you met and the people you missed by shared interests. Claude's photo count comes second.
   6. Visa, moved up from ninth. Add the booth payout under Commerce Impact, and under Trust add that each pick shows its one-sentence reason.
   7. Capital One, unchanged, moved up to follow Visa, since the wallet pays for the merch.
   8. Microsoft, first of the claims tracks, because its brief fits the claims agent better than Hyphenate's. Bring the scorecard sentence in instead of pointing at the Hyphenate section, and add one line on the path to production: the pilot with a venue and its insurer from What's next.
   9. Anthropic. Name the community: concertgoers in packed general-admission crowds, starting with Cal Hacks 13.0. Add the scorecard as the impact measure, and the team's own line on the problem.
   10. Hyphenate, moved down from second. Keep its quotes whole and shorten our own text from 698 to about 300 words: the seats line plus one short paragraph per judging question. Drop the Time paragraph and the Costs tab paragraph, which repeat What it does.
   11. Vultr, unchanged.
6. **Accomplishments.** Reorder to: the Live tab, safety without internet, leaving connected, the night end to end, then "Every dollar has an answer" and the precedents line.
7. **Challenges, What we learned, What's next, Built with, Try it out** and the closing section stay as they are.

## Where Elastic and SpacetimeDB can shine more

Your Elastic design doc (`System Design/7-integrations/Elastic.md` on vik-e2e) draws the line: "SpacetimeDB owns live and exact state, The Evidence Engine validates and organizes data and ranks it by meaning, and the Anthropic Claude API makes the judgments." I checked every Claude job in `bandit-workers` against it. Four kinds of work Claude does today are reading, counting or ranking, not judgments, and an Elastic agent fits them better. The workshop deck says why: Agent Builder is "An agent that lives next to your data", and an ES|QL tool is "Your query, with blanks the agent fills in. Guardrails for analytics."

### Jobs an Elastic agent should take from Claude

Best first:

1. **The hospital report.** Claude reads it today (`claim_record_extract`). Elastic.md gives it to the Evidence Engine, which should "read every insurance document, each a PDF: the venue's policy, the attendee's own policy, the attendee's insurance card and the hospital report". The code's `bandit-read-document` takes only `venue_policy`, `health_plan` and `attendee_policy`. With a `hospital_report` kind, every fact a claim rests on, from the policy or the report, comes back with a quote and page that code finds word for word. Elastic.md already sets the privacy rule: filed under its SHA-256 with no name, read only with the workers' key, on no dashboard, and deleted once the claim is decided.
2. **Rule proposals.** Today the module hands Claude the approved claims of one kind, and Claude finds what they share (`rule_proposal`). Those claims already sit in `bandit-claims` with their diagnosis and service codes, corroboration, outcome and payout. An Agent Builder agent with one ES|QL tool can count the approved claims by incident kind, cover and diagnosis, take the highest payout, and write the rule sentence. Code still checks the three precedents and the ceiling, and only the organizer approves. This turns the organizer's own approvals into a rule. It does not compare a new claim with past ones, which you ruled out at 01:46.
3. **Checking a fetched plan or policy form.** Claude reads each PDF that Bright Data fetches to confirm the insurer, plan and year (`plan_check`) or the form number (`venue_policy_check`), and then `bandit-read-document` reads the same PDF again. The document reader can return those printed fields with their pages in its one schema-checked step, and code compares them with what was typed, as it does now. The cost: a workflow run is slower than one quick Claude call, so a wrong PDF takes longer to pass over.
4. **Picking from search results.** Claude picks the plan's document among Bright Data's results (`plan_find`, `venue_policy_find`), and the event site, venue and pages to read (`venue_find`, `venue_map`). Ordering results against what was typed is the deck's "a reranker reads the top hits and reorders them". Picking the venue out of scraped pages is the work `bandit-organizer` already does. The Claude design doc (`Anthropic-Claude-API.md`) even lists the decision "No `scrape_extract` use case", because "The Elastic Workflow `bandit-organize` is the one place facts are merged across sources". This is the largest change, since `venue_setup` runs live from one name.

If time is short, do the first two. Each gives an Elastic agent a job Claude holds today, and Kibana shows every step.

What stays with Claude:

- The claim decision (`claim_review`), with its own tools. It is the judgment.
- The medical history (`medical_extract`). Elastic.md says the Evidence Engine never receives "the medical history on a medical card". The insurance card shares that job and its schema, so it can stay too.
- Pictures: the photo counts, the floor plan, the security camera frames, and writing out a scanned PDF word for word. Elastic.md says it never receives photo images.
- Writing: the notice of loss, the recovery letter, the hospital reports for the scripted claims run, and the merch picks with their printed line.

This helps the Anthropic track too. Its point 3 is "One thing done well". With the reading, counting and ranking moved to Elastic, Claude's section can lead with one thing: it decides claims.

### Elastic, without moving a job

- **Hybrid + rerank.** The clause search and the recap are semantic only today (`clause_search.rs:81`, `search.rs:153`). Only the `bandit.candidates` tool uses `FORK` + `FUSE`. The deck: "Run both, fuse with RRF, then a reranker reads the top hits and reorders them. This is what you ship." Policies need exact words too, such as a form number like CG 00 01, or "employee".
- **"In any language."** That is the second criterion, and the deck says Jina is "Multilingual out of the box". One plan PDF in Spanish, found by an English query, shows it.
- **Claude through Agent Builder.** Define `search_policy` and `read_clause` as Agent Builder tools, and have the worker call them through Agent Builder's MCP endpoint (the deck's `$KIBANA_URL/api/agent_builder/mcp`): "Every tool is auto-exposed to Claude Code, Cursor, or your app." Every clause search Claude makes then shows in Agent Builder too.

### SpacetimeDB

The prompt asks for "instant sync between users/agents/systems", and names "AI agent coordination" and "AI systems coordinating in a persistent world state".

- **Name every system on the job queue.** The Devpost says "the Claude agents in our Rust workers". The same `worker_jobs` view also runs Elastic's jobs (`claim_verify`, `document_read`), Bright Data's (`venue_setup`, `plan_lookup`, `venue_policy_lookup`) and Nessie's (`wallet_open`, `merch_purchase`, `charge_payment`, `claim_payout`). `claim_job` leases each job to one worker for 60 s, a long call extends the lease, `job_reaper` puts an expired lease back in the queue or buries the job after its last try, and only the lease holder can finish it. That is four outside systems coordinating in one world state.
- **Show an agent's work syncing live.** Each step of Claude's investigation reaches the module through `report_claim_step`, and every organizer screen shows it as it happens. The Devpost says this only under Anthropic. One line under SpacetimeDB makes it "instant sync between users/agents".
- **Put a number on "instant".** We have no measured time yet. The only figure is `watch_bands` running every 500 ms. Until a time from an SOS press to the incident on the medic's phone is measured with the Live tab's crowd of 1,000 running, the Devpost keeps a TODO note in its place.

Sources: the job headers in `crates/bandit-workers/src/`, `DOCUMENT_KINDS` in `crates/bandit-insurance/src/policy.rs`, the `bandit-claims` mapping in `crates/claims-elastic/src/lib.rs`, the leases in `spacetimedb/server/src/jobs/mod.rs`, and the two design docs, all on vik-e2e at commit 1182892; the deck is `slides/deck.html` in Elastic's paper-scout repo.

## Fit at a glance

The rows follow the order the story introduces each track: safety, the live world, the event's setup, meeting people, merch, then the claim. The Devpost's sponsor sections use the same order. Prizes are from the Devpost prize list and the Hive prize cards.

| Track | Prize | Fit | Our weakest criterion |
| --- | --- | --- | --- |
| Cal Hacks: Best People-First Social Impact Hack | Apple Watch SE 3 each, 1 winner | Strong | No written criteria anywhere |
| Cal Hacks: Best Hardware Hack | Bambu Lab 3D printer each, 1 winner | Strong | No written criteria anywhere |
| Cal Hacks: Most Technically Advanced Hack | NuPhy Air60 HE each, 1 winner | Strong | No written criteria anywhere |
| SpacetimeDB: Best Use of Spacetime | $2,048, $1,024, $512 | Strong | None found; it is the backbone of every part |
| Elastic: Best use of the Elastic Agent Builder on a Serverless Instance | Meta Quest 3S (1st), Bose QuietComfort (2nd) | Strong | Hive still says "Coming soon!", so the only rubric is Elastic's workshop deck |
| Bright Data: Best Agent/App Using Public Web Data | $1,500 credits + $500 Amazon card (1st), $1,000 + $350, $500 + $250 | Good | "run live in the demo": the event scrape runs before doors open; what runs live is the plan lookup at every sign-up and the venue setup |
| Meta/Facebook: Bringing People Closer Together with AI | Round 2 at Meta's Menlo Park campus with travel paid, swag bag; $0 cash, 1 winner | Strong | "how essential and well-integrated AI is": the bands, not AI, decide who met |
| Visa: Best use of Reimagining Shopping | $5,000, 1 winner | Good | User Experience and Commerce Impact, 40 to 45% together: the shop is three picks and a Buy button, with no measured sales lift |
| Capital One: Best Use of Nessie | $300 Giftogram each, 1 winner | Good | None found; a small prize |
| Microsoft: Built for the Real World | $3,800 and a Surface laptop each (1st) | Good | "Path from prototype to production": our section does not answer it yet; the venue and insurer pilot from What's next can |
| Anthropic: Claude for Public Benefit | $5,000 in Claude credits, 1 year of Claude Max 20x, office hours | Medium | The community is settled (concertgoers), but our section doesn't name it yet. Point 3 rewards one thing done well |
| Hyphenate: The Hyphenated Enterprise | $8,000, $5,000, $3,000; faster interviews for the top 5 | Good | Story: finance is one of four parts, and the brief wants a video that "opens with your moment" |
| MLH: Best Use of Vultr | M5Stack Tab5, 1 winner | Medium | We use one plain server, no Vultr-specific feature |

## Track by track

Each track quotes its criteria word for word, then lists the BandIt features from devpost.md that meet them.

### SpacetimeDB: strong

Criteria, from the Hive card:

> We’d love to see projects where Spacetime is the core real-time backend, especially anything with live shared state, multiplayer interaction, or instant sync between users/agents/systems.
>
> The main thing we’d want is for Spacetime to be meaningfully used, not just added on the side.

- One module on SpacetimeDB Maincloud holds every band, zone, incident, claim, wallet and the people graph: 93 tables, 114 reducers, 65 views and 6 timers.
- The bands' bridge, the staff screens, every attendee's phone and the Claude workers all share that module, with no app server in between.
- The workers pick up jobs from the view `worker_jobs` and report back through reducers, which answers "AI systems coordinating in a persistent world state".
- A timer in the module walks a crowd of 1,000 and stages incidents on the Live tab.

### Elastic: strong

Criteria, from Elastic's workshop deck, since Hive still says "Coming soon!":

> Build a project that turns complex, messy data into useful insights, answers, or actions. 01 Elasticsearch: Creative, meaningful use of search 02 Jina embeddings: Search by meaning, in any language 03 Agent Builder + Workflows: Agents that answer and act 04 Cloud Serverless: Zero ops, free for the weekend
>
> Hit all four and you've hit every judging criterion.

- Search: the Evidence Engine finds the policy clauses that bear on each claim by meaning, and each recap ranks its people and booths by shared interests.
- Jina: every `semantic_text` field uses `.jina-embeddings-v5-text-small`.
- Agent Builder and Workflows: `bandit-organize` merges 245 scraped records with ES|QL `LOOKUP JOIN` and the `bandit-organizer` agent. `bandit-read-document` reads every insurance policy PDF, each term with its quote and page.
- Serverless: every index, workflow and agent runs on Elastic Cloud Serverless.

### Cal Hacks People-First, Hardware and Technically Advanced: strong

These tracks have no written criteria. The Devpost lists "Cal Hacks Best People-First Social Impact Hack" with "Apple Watch SE 3 for each member of the team", and its Hive card, "Best People-First Hack", has an empty description. Best Hardware Hack and Most Technically Advanced Hack are the same.

The only written rubric is the Devpost's general Judging Criteria, for example:

> Application: Projects should have a feasible real-world use. Could someone realistically adopt this, and would it deliver a clear benefit? Strong submissions identify who they help, what problem they solve, and why people would actually use them.

- People-First: the crowd level on every wrist before anyone falls, exit guidance in smoke, and the light circle around a fallen attendee with no internet. Then the medic's alert, the medical card, and a camera that finds the band's flash, never a face. The Devpost already opens with Astroworld.
- Hardware: ESP32-C3 bands with a 12-LED ring, SOS button, NFC tag, motion sensor and vibration motor, plus station markers at the exits and a USB gateway, all on ESP-NOW.
- Technically Advanced: firmware, one live database whose views enforce access, two engines, a vision pipeline and a double-entry ledger.

On entering, Wallace wrote in #0-ask-directors on 2026-10-22: "everyone is automatically eligible for the main tracks, please make sure that you have followed the judging criteria for the sponsor tracks in order to sign up for them".

### Meta: strong, with one weak criterion

Criteria, from the Hive card and the hacker guide:

> Projects will be judged on how meaningfully they strengthen human connection, how essential and well-integrated AI is, originality, and the strength of the working demo.

- Human connection: two people count as met after 180 seconds close together, and the recap links their Instagram, Facebook and Threads. Each person card shows where you met, your minutes and photos together, and one Share tags everyone in a photo.
- AI: Elastic ranks the people you met and "Also there with you" by shared interests. Claude counts the people in each photo so the right number get tagged, and the shopping agent prints friends' names on merch.
- Originality: nobody swaps numbers or scans a code, and interests come from the booths where you spent your minutes.
- Working product: our real bands and a crowd of 1,000 meet on band1t.vip, and the Event graph shows every meeting live.

Weak spot: AI does not make the connection, it ranks and tags it. The Meta section should open its AI paragraph with what AI decides for you: who you see first, and who you are told you missed.

### Visa: good

Criteria, from the Hive card:

> Innovation (25%) – How creative does the solution reimagine the shopping experience? User Experience (25%) – Does the experience feel intuitive, useful, and seamless? Technical Execution (20%) - How effectively has the team implemented AI and supporting technologies? Commerce Impact (15%) - Can the solution improve customer engagement, conversion, loyalty, or merchant outcomes? Trust & Responsibility (15%) - Does the solution address privacy, transparency, security, and responsible use of AI?

Visa's starter pack weights User Experience and Commerce Impact at 20% each and says "Adding a chatbot alone is not enough." Its idea list includes "Social shopping recommendations" and "Merchant engagement platforms".

- Innovation: every product is made from your own night, your photo with the friends in it, and it is sold only after the event.
- User Experience: three picks wait at the bottom of the recap, and buying takes one tap from the wallet.
- Technical Execution: the Claude shopping agent picks each product, photo and printed line, and code checks every id twice.
- Commerce Impact: a sponsor's merch goes to the people who spent time at its booth. Each booth is owed its sales less print cost and the event's fee, so an $18 mug pays its booth $11.20.
- Trust: each pick carries a one-sentence reason, only findable people appear, and `buy_merch` refuses what the wallet cannot cover.

Weak spot: a project that is only shopping will go deeper on User Experience and Commerce Impact. We have no measured sales lift, and the shop is a small part of the build.

### Anthropic: medium

Criteria, from the Hive card (the doubled quotation marks are in the source):

> 1. A named community. ""Students"" is too broad. ""Transfer students at Berkeley trying to find housing"" is the right register.
> 2. A real problem. You have lived it, or you talked to someone who has.
> 3. It works. One thing done well and usable on Monday beats a broad demo.
> 4. Thoughtful use of Claude. Claude does something that matters to the solution, and you know where it could go wrong for the people using it.

Arinze Obiezue's post in #cohost-anthropic on 2026-10-23 adds: "It should also be clear how you plan to measure its impact on your target community".

- Claude decides every insurance claim with tools, reads medical PDFs into the medical card, counts the people in photos and picks merch.
- Where it could go wrong is handled in code: a refusal on judgment alone goes to a person, code sets every amount, and a decision citing a fact outside the evidence is sent back.

Weak spot: our Anthropic section answers point 4 only. It doesn't yet name the community, which is settled as concertgoers below, or an impact measure. Point 3 also rewards one thing done well, and BandIt is four things, with Claude kept off the safety path by design. Moving Claude's reading and ranking jobs to Elastic, as Where Elastic and SpacetimeDB can shine more suggests, lets the section lead with one thing: Claude decides claims.

"People who go to public venues" is too broad: it is nearly everyone, like "Students". Name the community by circumstance and need: concertgoers in packed general-admission crowds, starting with the hackers at Cal Hacks 13.0.

Then tie Claude to what it does for them: it reads their medical PDFs into the card a medic sees when they cannot speak, and it settles their injury claim the same night. Measure impact with the scorecard: time from incident to payout, claims paid with no person, and dollars wrongly paid.

Point 2 needs one line from the team on who has been in a crowd like that, or talked to someone who was.

### Bright Data: good

Criteria, from the Hive card:

> Judges will look for products where Bright Data is essential to the core experience; if live public web data were removed, the product would no longer work.
>
> Strong submissions solve a clear, real-world problem for a specific user, run live in the demo, handle real web conditions like blocks, slow responses, and empty results, and turn raw data into clean, useful output.

- The Bright Data Web MCP turns the event site, Devpost, LinkedIn, Crunchbase and Google Maps into 245 records from 6 sources. They become every booth, recap booth and sponsor product.
- The Web Unlocker, SERP and Browser APIs produced the 3D venue the crowd walks on.
- On the tap page, the plan lookup searches the web for the attendee's own policy PDF, live.

Weak spot: the event scrape runs before doors open. Two things run live: the plan lookup, which every new attendee starts at band setup by naming their plan, and the venue setup on the organizer portal's Venue setup tab, which builds any event's venue from its name with the Web MCP, the Web Unlocker API and the Browser API (`venue_setup` on vik-e2e). The Devpost names only the plan lookup.

### Hyphenate: good on its rubric, weak on story

Criteria, from the Hive card and Hyphenate's track brief:

> 1. Is it real enough? Realistic data, a messy problem, and proof that it works.
> 2. Would you hire it? For which seats, and would it earn them: limited access, a clean record of its work, and knowing when to ask?
> 3. Did we see something new? A company, problem or approach we haven't seen made autonomous before.
> 4. The moment. When it catches what others missed, recovers from something going wrong, or defends a decision when questioned.

The brief also says: "Be as imaginative as you like about who the company is (a Formula 1 team, a music festival, a three-person startup, a colony on Mars) and strict about how it works underneath."

- Real enough: the scorecard plants genuine and fake claims with an answer key, which is the brief's own "planted errors with an answer key".
- Would you hire it: Claude cannot change an amount, pays alone only inside a rule the organizer approved, and every step lands in the decision history.
- Something new: injury claims at a live event, settled the same night from wristband evidence.
- The moment: a claim passes every code check, but its hospital report says the ankle was hurt at home, so Claude sends it to the organizer.

Why it goes lower anyway: the brief says "Pick a company and one corner of its finance team", and its judges will see teams whose whole project is that corner. It also asks for "A demo video that opens with your moment", while our story opens with the fall.

### Microsoft, Capital One and Vultr

- Microsoft, Built for the Real World, from the Hive card: "Build a production-minded AI agent that solves a meaningful problem in finance, productivity, healthcare, or another high-impact domain", judged on "Customer understanding", "Measurable usefulness", "Path from prototype to production", "responsible design" and "end to end functionality". The insurance Decision Engine fits, but our section borrows the scorecard from the Hyphenate section and says nothing on the path to production.
- Capital One, Best Use of Nessie, from the Hive card: "Completeness, Creativity, Complexity". One wallet takes the $200 opening deposit, merch purchases, charges and insurance payouts, with BandIt's own exact ledger beside the sandbox.
- MLH, Best Use of Vultr: the prize text says "Take your next hack to the cloud with Vultr". One Vultr server runs the site, the API and the workers, which qualifies, but nothing in it is special to Vultr.

## Sources and gaps

- [Cal Hacks 13.0 Devpost](https://cal-hacks-13-0.devpost.com/): prize list and Judging Criteria, from the copy saved 2026-10-25 01:01 UTC (`var/research/raw/devpost-home.txt`) and the repo snapshot of 2026-10-24 08:28 UTC.
- [Hive prizes](https://hive.hackberkeley.org/prizes): every track card, from the feed copy saved 01:08 UTC, which Hive marks as updated 2026-10-24 22:13 UTC (`var/research/raw/hive-prizes.json`).
- [Cal Hacks hacker guide](https://docs.google.com/document/d/1RQrueC9wm5u8uxtWSC2gadIchp05hVayhGUrIjxT9dE): the Cal Hacks prize table, copy saved 01:10 UTC.
- [Hyphenate track brief](https://docs.google.com/document/d/1u4iN8R97ILY3kfHTPKC82zdutHrGx4ze5eCAP-J92w4) and [Visa starter pack](https://docs.google.com/document/d/1Lgtd0f8mHZy_nWabtz751AkSW5Oj-z1XMhzAwddtfOA), copies saved 01:10 UTC.
- [Elastic workshop deck](https://github.com/jdarmada/calhacks-paper-scout), `slides/deck.html`, copy saved 01:11 UTC.
- [Sponsor-Tracks.md](https://github.com/viktorinkov/cal-hacks-13/blob/vik-e2e/System%20Design/1-overview/Sponsor-Tracks.md) on vik-e2e, and devpost.md and README.md on Viktor's Mac (devpost.md as saved at 04:33 UTC, and its 04:59 UTC version for the outline and the word counts).
- Slack quotes (Wallace, Arinze Obiezue, Ryan Swift) come from the project's research notes, `research/sponsor-tracks.md`, read in Chrome on 2026-10-25 between 01:00 and 01:20 UTC. I did not open Slack myself.

Blocked: I could not reload Devpost or Hive live. The cloud container and the Mac's sandbox shell both got a 403 from the network proxy, and this thread has no Chrome tool, so anything posted after 01:14 UTC is not covered.

Not found in any source: written criteria for the Cal Hacks tracks, Meta's Round 2 Official Rules, and whether one project can win more than one prize. On how many tracks to enter, Ryan Swift wrote: "As far as I know, there is not a limit. But only apply to what you qualify for to help judging run smoothly".
