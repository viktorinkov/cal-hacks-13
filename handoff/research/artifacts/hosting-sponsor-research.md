# BandIt hosting sponsor research

Saved from https://claude.ai/artifact/Fct3AwyQ2P88RFjZKBDdpS, last updated 2026-10-24.

The page has 5 tabs: Overview, Microsoft, Annapurna Labs, Vultr (MLH), Tab 1. Each tab is one section below.

## Tab: Overview

Tab last updated 2026-10-24.

### Summary

Host BandIt on Vultr and enter Microsoft's "Built for the Real World" track anyway. Microsoft's track does not need Azure: the Devpost prize text never mentions it, Microsoft's Slack offers Azure credits only as a resource, and none of the three recent Microsoft prize winners used Azure. Vultr keeps the Microsoft entry, adds the MLH Vultr prize, and its setup is already written.

| Rank | Plan | Prizes it can win | Why |
| --- | --- | --- | --- |
| 1 | Vultr hosting, Microsoft track entered | Microsoft: $3,800 and a Surface laptop each; MLH: M5Stack Tab5 | Both prizes from one deployment; `vik-deploy` already targets Vultr; $100 MLH credits |
| 2 | Azure hosting, Microsoft track entered | Microsoft only | A talking point with Microsoft's judges, but past winners show it is not needed; needs a school-email signup and has region limits |
| 3 | AWS, through Annapurna Labs | none published | Annapurna cares about AI on its chips, and its Slack shows no prize, credits or hardware |

BandIt wins Microsoft's track on its safety and claims story, which runs the same on any server.

### Sponsor tiers

Only three CalHacks 13.0 sponsors sell general-purpose servers: Microsoft (Azure), Annapurna Labs (through AWS) and Runpod. Vultr is not a CalHacks sponsor; it is an MLH prize partner. Tiers are from the [CalHacks 13.0 Devpost](https://cal-hacks-13-0.devpost.com/).

| Tier | Sponsors | Compute that could host BandIt |
| --- | --- | --- |
| Anchor | Annapurna Labs, Anthropic, Hyphenate, SpacetimeDB | Annapurna Labs (AWS, Trainium). SpacetimeDB Maincloud hosts the module only |
| Golden Bear | Fetch.ai, Microsoft, Supercell, Visa | Microsoft (Azure VMs). Fetch.ai Agentverse hosts Python agents only |
| Silver | AfterQuery, Apify, Armadin, Bitdeer, Bright Data, Cartesia, Convex, Creao AI, Elastic, Factory AI, Meta | None for VMs. Apify runs scraper Actors, Convex runs TypeScript functions, Elastic hosts Elasticsearch, Bitdeer's CalHacks credits are model API only |
| Bronze | a16z, Atlassian, Canva, Capital One, Citadel, Coinbase, Council Health, CRS Credit, D.E. Shaw Group, Decagon, Engramme AI, Figma, Greptile, Jane Street, Listen Labs, Moonpay, Moss, Notability, Runpod, Savvy, Scale AI, Y Combinator | Runpod (container pods) |
| MLH prize partner | Vultr, Tiger Data, Snowflake, Gemini, Solana, GoDaddy Registry | Vultr (VMs) |

### Sponsor tabs

Each candidate host has its own tab with the sponsor's exact ask, recent winners of its prize or the closest one, a system design for each, and BandIt's fit: [Microsoft](#tab-microsoft-microsoft-built-for-the-real-world), [Annapurna Labs](#tab-annapurna-labs-annapurna-labs-trainium-and-inferentia) and [Vultr (MLH)](#tab-vultr-mlh-vultr-mlh-best-use-of-vultr).

### Track scorecard

Microsoft's track is the best fit: the biggest prize of the three, and BandIt already does what its judges reward. Fit is scored out of 5 against each sponsor's exact ask, using only features in the README.

| Track | Prize | What the judges reward | BandIt fit | Effect on our other tracks |
| --- | --- | --- | --- | --- |
| [Microsoft] 1st Place Built for the Real World | $3,800, a Surface laptop each, FDE talk and mentorship | Slack: a "production-minded AI agent", judged on customer understanding, measurable usefulness, path to production, responsible design and end-to-end functionality (with Azure for Students) | **5 of 5.** Crowd-crush guidance for venues and a claims agent with a scorecard, both already designed; the claims agent sits in finance, a domain Microsoft names | Helps: the same story serves CalHacks' Social Impact prize, and the Hyphenate scorecard is the measurable outcome |
| [Microsoft] 2nd Place Customer Impact Award | FDE talk and mentorship, no cash | Same judges | **5 of 5**, same entry | Same |
| [MLH] Best Use of Vultr | M5Stack Tab5 | One Vultr server doing real backend work, said plainly | **4 of 5.** BandIt's services on one VM match the winners, but it only shows if we host there | None |
| Annapurna Labs | None published this year (12.0: "Best Use of Annapurna", value TBD) | Slack: no prize, no credits, recruiting and a workshop only. Last year: measured model speed on its chips | **1 of 5.** Only by moving the camera detector onto Inferentia, if chips are handed out | None; its timing could feed Elastic |

SpacetimeDB and Bright Data have no prize on the Devpost list. SpacetimeDB's blog promises "a special prize for the most impressive use of Spacetime" ([SpacetimeDB](https://spacetimedb.com/blog/spacetime-at-calhacks)).

### Hosting that follows

BandIt runs on one Vultr server and enters Microsoft's track on its merits.

1. **Vultr:** one Cloud Compute VM with the `vik-deploy` systemd and Caddy setup, paid by the $100 MLH gift code. Viktor does the signup click himself.
2. **Microsoft's track:** entered with the five Slack criteria mapped on the Microsoft tab. The agents run in `bandit-workers` on the Vultr server, so the agent is in production either way.
3. **Azure is dropped:** it would add a talking point, not a prize, and costs a second signup.
4. **Annapurna stays open:** if its Saturday 3 to 4 PM workshop hands out Inferentia chips, moving the camera detector onto one is Leo's call, separate from hosting.

Sponsor asks come from Devpost and the CalHacks 13.0 Slack, read Oct 24. The Elastic, Anthropic and SpacetimeDB channels had posted no track details yet.

### Runpod and the other sponsors

No other sponsor is a real hosting candidate. Runpod is the only other one that rents servers, and it has no prize track.

| Sponsor | Tier | What it hosts | Why it is out |
| --- | --- | --- | --- |
| Runpod | Bronze | GPU and CPU container pods | No prize track and no published CalHacks credits. Pods are containers behind a Cloudflare proxy that "enforces a maximum connection time of 100 seconds" ([Runpod docs](https://docs.runpod.io/pods/configuration/expose-ports)) |
| SpacetimeDB | Anchor | Maincloud runs the `band1t` module | Already hosts our database; it cannot run the Rust services or Chromium |
| Elastic | Silver | Elastic Cloud Serverless | Already hosts our Elastic project; not a general server |
| Fetch.ai | Golden Bear | Agentverse runs agents | Agents only, not our Rust services |
| Convex | Silver | TypeScript backend functions | Not a server for Rust binaries |
| Apify, Bright Data | Silver | Scraper runs and remote browsers | Scraping platforms, not app hosting |
| Bitdeer AI | Silver | AI cloud | CalHacks credits are "API credits" for Model Studio only ([Bitdeer](https://www.bitdeer.ai/en/blog/bitdeer-ai-starter-pack-for-cal-hacks-13-0/)) |
| Anthropic, Hyphenate, Visa, Supercell, Meta and the rest | various | nothing | No compute |

### Technical fit

Azure, Vultr and AWS all run BandIt the same way: one Debian VM with the systemd and Caddy setup already on `vik-deploy`. Runpod fits only partly.

BandIt needs one Linux machine with a shared disk, the three always-on Rust services (`bandit-api`, `bandit-workers`, `bandit-indexer`), `bandit-api` able to start `bandit-claims`, headless Chromium for the record renderer, a public HTTPS port, and outbound WebSockets to Maincloud.

| Host | Machine | Fit | Credits | Catch |
| --- | --- | --- | --- | --- |
| Azure | Debian 12 VM, a B-series v2 size such as B2als_v2 | Full | $100, no card, school email ([Microsoft](https://learn.microsoft.com/en-us/azure/education-hub/about-azure-for-students)) | About five allowed regions per student subscription ([Q&A](https://learn.microsoft.com/answers/a/12227361)); open ports 80 and 443 |
| Vultr | Cloud Compute VM | Full; setup written for it (`vik-deploy`) | $100 MLH gift code ([MLH](https://www.mlh.com/partners/vultr)) | None found |
| AWS (the Annapurna parent) | EC2 VM | Full | $100 at signup plus $100 earned, 6 months ([AWS](https://aws.amazon.com/about-aws/whats-new/2025/07/aws-free-tier-credits-month-free-plan/)); no card for most ([AWS FAQ](https://aws.amazon.com/free/free-tier-faqs/)) | A plain EC2 server shows nothing of Annapurna's chips |
| Runpod | Container pod | Partial | none published | No systemd; 100-second proxy limit ([Runpod](https://docs.runpod.io/pods/configuration/expose-ports)) |

### Sources

- CalHacks 13.0: [Devpost](https://cal-hacks-13-0.devpost.com/), [calhacks.io](https://www.calhacks.io/), and the CalHacks 13.0 Slack (#spons-microsoft, #cohost-annapurna-labs), read Oct 24
- CalHacks 12.0: [Devpost](https://cal-hacks-12-0.devpost.com/), [live site prizes](https://live.calhacks.io/prizes), [live site resources](https://live.calhacks.io/resources)
- Microsoft: [Frontier Company launch](https://blogs.microsoft.com/blog/2026/07/02/microsoft-frontier-company-ai-engineering-that-amplifies-and-protects-your-intelligence/), [Directions on Microsoft](https://www.directionsonmicrosoft.com/microsoft-launches-its-own-forward-deployed-engineering-unit-the-frontier-company/?type=All), [Azure for Students](https://learn.microsoft.com/en-us/azure/education-hub/about-azure-for-students), [offer terms](https://azure.microsoft.com/pricing/offers/ms-azr-0170p), [student region limits](https://learn.microsoft.com/answers/a/12227361)
- Microsoft prize winners: [ShellHacks 2026](https://shellhacks-2026.devpost.com/), [Repro](https://devpost.com/software/repro-h6gq70), [Spitball](https://devpost.com/software/spitball), [CADVision](https://devpost.com/software/cadvision)
- Vultr: [MLH credits](https://www.mlh.com/partners/vultr), [dump](https://devpost.com/software/dump-imwsvx) and [DubHacks '26](https://dubhacks-2026.devpost.com/), [PledgeCheck](https://devpost.com/software/pledgecheck-qrusc1) and [HackGT 13](https://hackgt13.devpost.com/), [Triviality](https://devpost.com/software/rbc-buddies) and [its GitHub](https://github.com/iwis19/Triviality)
- Annapurna Labs and AWS: [UC Berkeley AI Hackathon 2026](https://ai-hackathon-2026.devpost.com/), [Paper Cuts](https://devpost.com/software/paper-cuts), [BrailleAI](https://devpost.com/software/brailleai-a-two-way-voice-for-the-deafblind), [NYU lab](https://github.com/yahavb/trainium-agent-labs), [Trainium Frontier](https://trainium-frontier.devpost.com/), [Build on Trainium](https://aws.amazon.com/ai/machine-learning/trainium/research/), [EC2 quotas](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-quotas.html), [AWS free plan](https://aws.amazon.com/about-aws/whats-new/2025/07/aws-free-tier-credits-month-free-plan/), [AWS FAQ](https://aws.amazon.com/free/free-tier-faqs/)
- Others: [Runpod ports](https://docs.runpod.io/pods/configuration/expose-ports), [Bitdeer starter pack](https://www.bitdeer.ai/en/blog/bitdeer-ai-starter-pack-for-cal-hacks-13-0/), [SpacetimeDB at CalHacks](https://spacetimedb.com/blog/spacetime-at-calhacks)
- BandIt: README, and Architecture.md and Vision.md in system-design-v2

## Tab: Microsoft (Microsoft: Built for the Real World)

### The track

Microsoft asks for a project that is built for the real world, judged by its forward-deployed engineers. The Devpost prize text never mentions Azure, but Microsoft's Slack challenge points to Azure for Students under end-to-end functionality. Source: [CalHacks 13.0 Devpost](https://cal-hacks-13-0.devpost.com/).

| Prize | Cash | Also |
| --- | --- | --- |
| [Microsoft] 1st Place Built for the Real World | $3,800 | "A Microsoft Surface laptop for each member of the winning team"; "Present your project remotely at a Microsoft Delta/Frontier Co. FDE team tech talk"; "1:1 mentorship with senior FDEs from Delta/Frontier Co team" |
| [Microsoft] 2nd Place Microsoft Customer Impact Award | $0 | "Present your project remotely at a Microsoft Delta/Frontier Co. FDE team tech talk"; "1:1 mentorship with senior FDEs from the Microsoft Delta team" |

- **Who judges:** Microsoft's Frontier Company, its forward-deployed engineering unit launched July 2, 2026, which helps customers "design, deploy, and run their AI systems" ([Directions on Microsoft](https://www.directionsonmicrosoft.com/microsoft-launches-its-own-forward-deployed-engineering-unit-the-frontier-company/?type=All)).
- **What that rewards:** a system that runs for a real customer, end to end, rather than a prototype. The track is new: Microsoft had no prize at [CalHacks 12.0](https://cal-hacks-12-0.devpost.com/).
- **Credits:** Azure for Students gives "$100 in Azure credits, with no credit card required", verified with a school email ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/education-hub/about-azure-for-students)). Student subscriptions deploy only to about five assigned regions ([Microsoft Q&A](https://learn.microsoft.com/answers/a/12227361)).

**The ask in Slack** (#spons-microsoft, pinned challenge, read Oct 24): "Build a production-minded AI agent that solves a meaningful problem in finance, productivity, healthcare, or another high-impact domain." Microsoft lists what it looks for:

1. Customer Understanding
2. Measurable usefulness
3. Path from prototype to production
4. Responsible design
5. End-to-end functionality, followed by "here is Azure Credits you can sign up for: Azure for Students"

The channel also posted job links for Microsoft Delta forward-deployed engineers.

### Closest past prize: ShellHacks 2026

No other hackathon has run Microsoft's FDE track yet. The closest is the "Microsoft" prize at [ShellHacks 2026](https://shellhacks-2026.devpost.com/) (Sep 25 to 27, 2026): $250 and Microsoft swag for 3 winners, for an AI-powered experience that fixes something difficult or missing. Its rule: "Your core experience cannot be a chatbot or depend on a chat window." None of its three winners used Azure or any Microsoft service.

The only Microsoft-sponsored winner found that used Azure is [TerpWallet AI](https://devpost.com/software/terpwallet-ai) at [Bitcamp 2026](https://bitcamp-2026.devpost.com/), which won "TerpAI Ultimate Agent Showdown - Cloudforce/Microsoft". That prize required building on UMD's TerpAI, and the agent is "a custom TerpAI agent I built on UMD's Cloudforce/Microsoft Azure platform, running GPT-5.2". It also used Capital One's Nessie API for bank data, as BandIt does.

### Winner 1: Repro, ShellHacks 2026

[Repro](https://devpost.com/software/repro-h6gq70) won "Microsoft" at ShellHacks 2026.

- **What it did:** it points AI agents at a codebase. Scanners find issues, each one is confirmed by re-running it in a sandbox, Gemini proposes a fix, and the fix becomes a pull request only after it passes tests and a second "Challenger" model's counter-tests. A person does the merge.
- **How it used Microsoft:** not at all. Its Built With list is Gemini, Google Cloud, MongoDB Atlas, Docker and GitHub tooling.

**Diagram: Repro · a fix reaches a pull request only after it is verified**

What it shows: Repro only opens a pull request after the fix is verified.

Text in the diagram, in drawing order:

- Repro only opens a pull request after the fix is verified
- ShellHacks 2026, winner of the Microsoft prize; no Microsoft services used
- Each run
- Dashboard, CLI or MCP
- where a user starts a run
- Control plane
- Fastify and tRPC
- MongoDB Atlas
- run store
- Ingest
- clones one pinned commit
- Detect
- scanners plus sandbox repro
- Diagnose
- Gemini groups by root cause
- Repair
- Gemini edits in a sandbox
- Verify
- tests and counter-tests
- Pull request
- a person merges it
- passes

**Why it won:** the presentation ends in a real, verified fix, not a chat. The page shows its failure handling with numbers: its check flagged 2 cheating patches out of 18.

### Winner 2: Spitball, ShellHacks 2026

[Spitball](https://devpost.com/software/spitball) won "Microsoft" at ShellHacks 2026.

- **What it did:** you paste a GitHub repo URL and it becomes an interactive mind map of next steps, each citing the files it touches. Gemini writes the code change for a chosen node, one click opens a pull request, and when the PR merges into `main` the node turns green.
- **How it used Microsoft:** it runs as an extension "locally inside Visual Studio Code". The web app is hosted on DigitalOcean App Platform with MongoDB Atlas, not Azure.

**Diagram: Spitball · idea, code change, pull request, merge**

What it shows: Spitball turns a repo into a map of next steps and ships them as pull requests.

Text in the diagram, in drawing order:

- Spitball turns a repo into a map of next steps and ships them as PRs
- ShellHacks 2026, winner of the Microsoft prize; hosted on DigitalOcean, not Azure
- Repo URL
- pasted by the user
- GitHub REST API
- file tree, key files
- Gemini
- plans next steps
- Mind map
- each idea cites files
- Gemini
- writes the change
- Diff and PR
- opened in one click
- Watches main
- merge turns it green
- Runs as a VS Code extension and as Next.js on DigitalOcean App Platform, with MongoDB Atlas
- pick a node

**Why it won:** it closes the whole loop from idea to merged code, and its interface is a graph rather than a chat. Mentors pushed the team off two earlier ideas for not adding "enough new value".

### Winner 3: CADVision, ShellHacks 2026

[CADVision](https://devpost.com/software/cadvision) won "Microsoft" at ShellHacks 2026.

- **What it did:** it turns a SolidWorks assembly into a 3D and VR design review in Unity on Meta Quest, with multiplayer for team reviews. A voice AI called CADEN answers design questions from the exported metadata and can show, hide or isolate parts in the scene.
- **How it used Microsoft:** not at all. Its Built With list is C#, ElevenLabs, Gemini API, Meta Quest, SolidWorks and Unity.

**Diagram: CADVision · CAD export, VR review and a voice AI with tools**

What it shows: CADVision lets engineers ask a voice AI about a CAD model in VR.

Text in the diagram, in drawing order:

- CADVision lets engineers ask a voice AI about a CAD model in VR
- ShellHacks 2026, winner of the Microsoft prize; no Microsoft services used
- SolidWorks add-in
- C#, walks the assembly
- materials, mass, mates
- Exported files
- model.glb
- metadata.json
- Unity on Meta Quest
- 3D and VR design review
- multiplayer sessions
- ElevenLabs
- speech to text
- spoken replies
- CADEN voice AI
- Gemini with tools
- shows, hides, isolates parts
- CADEN’s tools
- part lookup, mate tracing
- checks for unmated parts
- voice questions
- calls

**Why it won:** it solves a real engineering problem, explaining an assembly to people who don't use CAD, and the AI is one part of a spatial experience rather than a chat window. CADEN keeps answers tied to the CAD data and says when the data is incomplete.

### What this means for BandIt

BandIt fits this track without new features, and hosting on Vultr does not hurt it: no recent Microsoft prize winner used Azure.

- **What Microsoft judges rewarded:** AI that completes a real task inside a product rather than a chat, with failure handling shown (Repro's 2 of 18 cheating patches caught). None of the three winners ran on Azure.
- **What the CalHacks judges do:** Frontier Company engineers "co-design, co-innovate, deploy" AI at customers and improve it "based on measurable business outcomes" ([Microsoft](https://blogs.microsoft.com/blog/2026/07/02/microsoft-frontier-company-ai-engineering-that-amplifies-and-protects-your-intelligence/)).
- **Where BandIt already fits:** crowd-crush guidance, the SOS light circle and medic dispersion solve a real venue problem, and the Hyphenate claims agent decides money and proves it with a scorecard from planted claims. Both are in the README and in the "Social impact and real-world tracks" row of Architecture.md.
- **What Azure adds:** a talking point with the FDE judges, not a requirement. BandIt hosts on Vultr instead and also enters the MLH Vultr prize.
- **Other tracks:** no conflict. The same safety story serves CalHacks' "Best People-First Social Impact Hack", and the Hyphenate scorecard doubles as the measurable outcome.

| Microsoft's criterion | Where BandIt already shows it |
| --- | --- |
| Customer Understanding | Venue staff, medics and insurers each get their own view: the ops dashboard, medic access to the medical card, the claims agent |
| Measurable usefulness | Bands alert locally within a second; the claims agent's scorecard comes from planted claims |
| Path from prototype to production | A live deployment on one server, the same shape a venue would run |
| Responsible design | Code decides safety, money, coverage and access; Claude never identifies faces |
| End-to-end functionality | Band, SpacetimeDB, dashboard and claim payout, all live at a public URL |

**Where the agent runs:** Microsoft asks for an agent in production, not a website, and BandIt's server already hosts the agent. BandIt's Claude jobs, the claims agent among them, run inside `bandit-workers` on the same machine as `bandit-api` (Anthropic-Agent.md), so the agent loop runs on that server and calls Claude's API. Serving Claude itself through Microsoft Foundry is out on Azure for Students: Microsoft lists "student, free trial, or startup credit–based accounts" as not supported for Claude ([Microsoft Learn](https://learn.microsoft.com/en-my/Azure/foundry/foundry-models/how-to/use-foundry-models-claude)).

## Tab: Annapurna Labs (Annapurna Labs: Trainium and Inferentia)

### What Annapurna asks and offers

Annapurna Labs is a top-tier CalHacks 13.0 sponsor but has published no prize, no challenge and no credits for this year. It is Amazon's chip team (Trainium and Inferentia), so its interest is AI models on its chips, not app hosting.

- **This year:** the [Devpost](https://cal-hacks-13-0.devpost.com/) names it only as a presenting sponsor, "presented by Anthropic, Annapurna Labs, SpacetimeDB, and Hyphenate". On [calhacks.io](https://www.calhacks.io/) its logo links to [AWS Trainium](https://aws.amazon.com/ai/machine-learning/trainium).
- **Last year (CalHacks 12.0):** a "Best Use of Annapurna" prize with value TBD ([live site](https://live.calhacks.io/prizes)) and a [starter pack](https://live.calhacks.io/resources). Its challenge: "Transform a basic language model into an efficient AI system using open-source implementations of popular models." It had three tracks, each judged on numbers: Model Performance Optimization (latency in ms), System Architecture & Integration ("deployment reliability, API response times (ms)", and "implement logging with ELK stack (Elasticsearch, Logstash, Kibana)"), and Hardware-Aware AI Optimization & Deployment (hardware use in %, throughput). It offered no hardware or credits.
- **Hardware access on your own:** AWS's default quota for both "Running On-Demand Inf instances" and "Running On-Demand Trn instances" is 0, so launching one needs a quota increase first ([AWS](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-quotas.html)).
- **Credits:** Build on Trainium funds academic research proposals, not hackathons ([AWS](https://aws.amazon.com/ai/machine-learning/trainium/research/)).

**The ask in Slack** (#cohost-annapurna-labs, read Oct 24): no prize track and no credits. The posts are a Sponsor Booth 12 schedule, an engineer-led technical workshop on Saturday 3 to 4 PM, a networking event on Saturday 6 to 8 PM, and talent-community signups for Annapurna and Amazon roles. This year Annapurna is recruiting, not judging.

### Winner 1: Paper Cuts, UC Berkeley AI Hackathon 2026

No winner of an Annapurna prize has been published: CalHacks 12.0's "Best Use of Annapurna" lists none, the NYU lab shows no placements, and the AWS Trainium Frontier finalists are not out yet. The closest are winners of other prizes that used Annapurna chips, both from the [UC Berkeley AI Hackathon 2026](https://ai-hackathon-2026.devpost.com/), which the CalHacks team runs with "support from Annapurna Labs".

[Paper Cuts](https://devpost.com/software/paper-cuts) won "GRAND PRIZE - Ddoski's Playground Track", "Finalist" and "Best UI/UX".

- **What it did:** players draw a shape on an iPad or in a browser. The system recognizes it, turns it into a game sprite, gives it gameplay mechanics, and drops it into a live match that players control from their phones.
- **How it used Annapurna:** "We trained Caecae on AWS Trainium (trn1) accelerators, but were unable to compile/serve the model on them." They "ran out of Trainium access" and used hosted inference for the live game.

**Diagram: Paper Cuts · from a drawing to a live game sprite**

What it shows: Paper Cuts trained its sprite model on Trainium but served it elsewhere.

Text in the diagram, in drawing order:

- Paper Cuts trained its sprite model on Trainium but served it elsewhere
- UC Berkeley AI Hackathon 2026, Grand Prize in Ddoski’s Playground; not an Annapurna prize
- Drawing canvas
- iPad or browser
- FastAPI backend
- receives each drawing
- Recognition
- CNN, vision model, Redis
- Caecae sprite model
- trained on Trainium (trn1)
- Background removal
- rembg and BiRefNet
- Mechanics model
- LoRA, adds gameplay
- Live match
- the sprite joins the game
- Node.js relay
- WebSockets
- Players’ phones
- control the match

**Why it won:** a polished creative game that works end to end. Trainium was a supporting part, and the team says getting it to compile "was a real fight".

### Winner 2: BrailleAI, UC Berkeley AI Hackathon 2026

[BrailleAI](https://devpost.com/software/brailleai-a-two-way-voice-for-the-deafblind) won "Best Use of Orkes" and lists "annapurna" in its Built With.

- **What it did:** a two-way voice for DeafBlind people. The user types Braille by touch and the device speaks it aloud; spoken replies are transcribed, summarized and raised as Braille dots.
- **How it used Annapurna:** it ran "a neuron model trained on AWS Annapurna (Trainium/Inferentia) silicon from the workshop", with the core AI on the device itself. The page doesn't say which model.

**Diagram: BrailleAI · speech in, Braille out, with an on-device model**

What it shows: BrailleAI ran a model trained on Annapurna chips inside its device.

Text in the diagram, in drawing order:

- BrailleAI ran a model trained on Annapurna chips inside its device
- UC Berkeley AI Hackathon 2026, winner of Best Use of Orkes; not an Annapurna prize
- On the device
- ESP32-S3
- microphone and speaker
- Raspberry Pi on QNX
- face recognition
- Braille cells
- servo-raised dots, touch input
- On-device model
- trained on Annapurna chips at the workshop
- Speech to text
- Deepgram and Whisper
- Claude
- tone, summary, tutoring
- speech
- reply as Braille

**Why it won:** a strong accessibility hardware hack. The Annapurna part came from a sponsor workshop, which is the likely way hackers get chip access at a CalHacks event.

### Reference 3: NYU x Annapurna Labs hackathon

Annapurna's own recent hackathon shows what it asks for when it writes the challenge, though no winners are published. The [reference lab](https://github.com/yahavb/trainium-agent-labs) asks teams to build an agent loop around a small model: the model attempts a problem, a checker grades the attempt, and the grade and the reason feed the next attempt.

- **What Annapurna provided:** each participant controls a Trainium chip "for the day", serving Qwen3-8B through vLLM-Neuron. Two example problems: a heat-rod PDE (solved) and an NKI kernel agent (unsolved).
- **What it asked for:** a checker that names the specific error, a ledger of failed attempts, and results as a rate over repeated runs, not one best run.
- **Setup cost:** the first start takes about 5 minutes (a container pull, about 16 GB of weights, compiling), and the pre-installed vLLM-Neuron 0.21 cannot serve Qwen3-8B, so the lab uses a 0.24 container.

**Diagram: Hack the Chip · the loop Annapurna asked teams to build**

What it shows: A small model on Trainium improves by checking its own attempts.

Text in the diagram, in drawing order:

- A small model on Trainium improves by checking its own attempts
- NYU x Annapurna Labs hackathon, reference lab; no winners published
- Problem
- a PDE, or an NKI kernel
- Qwen3-8B on Trainium
- own chip, vLLM-Neuron
- Attempt
- an answer or a kernel
- Checker
- grades it, names the error
- Failure ledger
- feeds the next attempt
- Report
- success rate over N runs
- retry with feedback

**What it shows:** Annapurna rewards measured model work on its chips (latency, throughput, success rates), with hardware handed out on the day.

### What this means for BandIt

Annapurna is not a hosting choice for BandIt, and today there is no prize to aim at. Hosting BandIt on a plain AWS server would show nothing of Annapurna's chips.

- **The one honest angle:** BandIt's camera detector (YOLO person and pose models, today on ONNX Runtime in `bandit-vision`, per Vision.md) could run on an Inferentia chip, with latency and frames per second measured before and after. That matches the numbers Annapurna judged last year. It changes how vision runs, not what BandIt does, and Vision.md is Leo's to decide.
- **What blocks it:** no published prize or hardware this year, AWS quotas for Inf and Trn instances start at 0, and the NYU lab shows a first model start of about 5 minutes plus version workarounds. Paper Cuts lost its chip access mid-hackathon.
- **When it becomes worth it:** only if the Annapurna workshop hands out chips or announces a prize, as the NYU event and the Berkeley AI Hackathon workshop did.
- **Other tracks:** no conflict, and timing on Inferentia could stream into Elastic, which last year's Annapurna pack asked for ("logging with ELK stack").

## Tab: Vultr (MLH) (Vultr: MLH Best Use of Vultr)

### The track

Vultr asks for a project that runs on Vultr's cloud. It is an MLH prize, not a CalHacks sponsor: Vultr is missing from the sponsor lists on [calhacks.io](https://www.calhacks.io/) and [Devpost](https://cal-hacks-13-0.devpost.com/).

| Prize | Cash | Also |
| --- | --- | --- |
| [MLH] Best Use of Vultr | none | M5Stack Official Tab5, 1 winner |

- **The ask, verbatim:** "Vultr empowers hackers to bring their high-performance projects to life instantly; providing everything from the speed of one-click deployment and scalable cloud compute, to specialized Vultr Cloud GPUs that can power AI-driven applications. Sign up for a Vultr account today and claim your free cloud credits! Take your next hack to the cloud with Vultr for a chance to win some awesome prizes for you and your team!" ([Devpost](https://cal-hacks-13-0.devpost.com/))
- **Who judges:** MLH, the same prize at many hackathons, not a Vultr engineering team.
- **Credits:** MLH gives a promo code: "Enter the Promo into the Gift Code field in the Billing section of your account dashboard for $100 in credits" ([MLH](https://www.mlh.com/partners/vultr)).

### Winner 1: dump, DubHacks '26

[dump](https://devpost.com/software/dump-imwsvx) won "[MLH] Best Use of Vultr" at DubHacks '26 (Oct 17 to 18, 2026), for the same M5Stack Tab5 that CalHacks offers ([DubHacks](https://dubhacks-2026.devpost.com/)). It also won "VEYZL: First Place".

- **What it did:** a browser app, with no install and no account, that collects an event's photos and videos. Guests sign in with a selfie and filter photos by their own face. One search covers objects, text in images and words spoken in videos, and each event room deletes itself after 24, 48 or 72 hours.
- **How it used Vultr:** "Vultr hosts our production backend on a single server running a Docker Compose stack". That one server runs the website, the upload worker, face matching and transcription.

**Diagram: dump · one Vultr server runs the site, the worker and the models**

What it shows: dump runs its whole backend on one Vultr server.

Text in the diagram, in drawing order:

- dump runs its whole backend on one Vultr server
- DubHacks 2026, winner of MLH Best Use of Vultr
- Vultr server, Docker Compose
- Outside services
- Guest’s phone
- selfie sign-in
- Caddy
- HTTPS, uploads up to 150 MB
- Website (Next.js)
- the app guests open
- Upload worker
- strips metadata, flags duplicates
- Face match and speech-to-text
- InsightFace and faster-whisper, private
- MongoDB
- expiring event data
- Cloudflare R2
- photos and videos
- TigerData
- activity logs
- Perceptron
- captions and tags

**Why it won:** the whole live product ran on Vultr, including its own AI models, at its own domain. The team says it integrated seven named platforms "into one coherent product".

### Winner 2: PledgeCheck, HackGT 13

[PledgeCheck](https://devpost.com/software/pledgecheck-qrusc1) won "MLH: Best use of Vultr" at HackGT 13 (Sep 25 to 27, 2026).

- **What it did:** it checks at-home pregnancy tests for the iPLEDGE program. The patient photographs the test with a one-time challenge code written on it, two independent readers check the photo, and the dermatologist approves or rejects it in one tap. Every action goes into an audit log anchored on Solana.
- **How it used Vultr:** "Our image service runs on Vultr": a Python and OpenCV service that is the second, non-AI reader and blocks reused photos by comparing image hashes. The app itself runs on Vercel.

**Diagram: PledgeCheck · the Vultr server is the second reader**

What it shows: PledgeCheck runs its second, non-AI reader on Vultr.

Text in the diagram, in drawing order:

- PledgeCheck runs its second, non-AI reader on Vultr
- HackGT 13, winner of MLH Best use of Vultr
- Two independent readers
- Patient’s phone
- test photo with a challenge code
- Next.js app
- on Vercel
- Supabase Postgres
- each clinic sees its own
- Solana devnet
- anchors the audit log
- Reader 1: Grok vision
- AI reads the test
- Reader 2: OpenCV on Vultr
- Python service, no AI
- blocks reused photos by image hash
- Dermatologist
- approves or rejects in one tap
- disagreements flagged

**Why it won:** the Vultr piece is the core of the safety design, a second reader that does not depend on AI, and the product is live at its own domain.

### Winner 3: Triviality, Hack the North 2026

[Triviality](https://devpost.com/software/rbc-buddies) won "MLH: Best Use of Vultr" at Hack the North 2026 (Sep 18 to 20, 2026; [gallery](https://hackthenorth2026.devpost.com/project-gallery?page=3), [GitHub](https://github.com/iwis19/Triviality)).

- **What it did:** a workspace where a team of AI agents researches math problems. A coordinator runs three researchers, a challenger and a proof writer, and each proof is checked by the Lean 4 proof checker. The team reports finding a counterexample with a Lean certificate.
- **How it used Vultr:** "We used Vultr to host our mathematical experiment worker and Lean runner." The searches run on Vultr "to reduce forced LLM computations", and the Lean checker "runs on a Vultr-hosted VM".

**Diagram: Triviality · searches and proof checks run on Vultr**

What it shows: Triviality sends its heavy math to a Vultr VM.

Text in the diagram, in drawing order:

- Triviality sends its heavy math to a Vultr VM
- Hack the North 2026, winner of MLH Best Use of Vultr
- Agent team in Python
- Vultr VM
- Research atlas
- 3D map, hosted on Vercel
- Node.js worker
- jobs via a Redis queue
- MongoDB
- stores the research
- Coordinator
- runs the team
- 3 researchers
- reads papers via OpenAlex
- Challenger
- hunts counterexamples
- Proof writer
- drafts Lean proofs
- Experiment worker
- exact-arithmetic searches
- Lean runner
- Lean 4 checks each proof
- search
- check

**Why it won:** Vultr does real computation, searching for counterexamples and checking proofs, instead of only serving a website. Users don't need to install Lean themselves.

### What this means for BandIt

BandIt fits this prize closely and hosts here, so it enters this prize alongside Microsoft's track. The prize is small and Vultr is not a CalHacks sponsor.

- **The winning pattern:** one Vultr server doing real backend work (AI models on CPU, OpenCV, a proof checker), said plainly in the write-up, live on its own domain. None of the three used Vultr's GPUs.
- **BandIt matches it:** `bandit-api`, `bandit-workers`, `bandit-indexer` and the Chromium record renderer on one Vultr VM is the dump shape, and the setup is already written on `vik-deploy`.
- **What it is worth:** an M5Stack Tab5 and no cash, judged by MLH rather than by a Vultr team.
- **Other tracks:** no conflict. Hosting is invisible to the SpacetimeDB, Elastic, Hyphenate, Nessie and Meta judges.

## Tab: Tab 1

(This tab is empty.)
