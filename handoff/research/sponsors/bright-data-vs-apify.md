# Bright Data vs Apify: a hackathon view (CalHacks 13.0)

*Researched Oct 24, 2026. Pricing is left out because you already have credits for both. The submission deadline is **Sun Oct 25, 9:00 AM PDT**.*

## TL;DR

- **They overlap on outcomes, not on what they are.** Both can take you from "I need data from site X or Google" to JSON or Markdown in your app or agent, through an API, SDK or MCP server. Underneath they are different products. Bright Data is **infrastructure and data**: a proxy network, anti-bot unblocking, official scrapers and datasets. Apify is a **platform for running code**: about 27k community scrapers ("Actors"), hosting for your own scrapers and agents, plus scheduling and storage.
- **At CalHacks 13.0 only Apify pays out.** It has $5,400 in prizes: Best use of Apify ($2,000, $1,000, $800, $400, $400) and Best Actor ($400). Bright Data is a Silver Sponsor with **no prize listed**, unlike Cal Hacks 12.0, where it ran a "Best Use of Bright Data" track.
- **Can you use both? Yes.** Past winners routinely stack 2–3 sponsor tools. For venues and merch: use Apify for venues (Google Maps) and merch (e-commerce), and Bright Data for ticketing sites. See the sections below.
- **Recommendation:** build the core on Apify, and **publish one custom Actor** so you also qualify for Best Actor. Keep Bright Data as a reliability layer: its MCP or Web Unlocker for any site that blocks Apify, or its proxies plugged into your Actor.

## What each one actually is

**Bright Data** started as a proxy network (formerly Luminati): 400M+ residential IPs plus mobile, ISP and datacenter IPs. On top of that it sells:
- **Web Unlocker API**: send it a URL and it returns the page, handling CAPTCHAs, fingerprinting and retries for you.
- **SERP API**: Google, Bing and other search results as JSON.
- **Browser API**: a remote, unblocking Chrome you drive with Playwright, Puppeteer or Selenium.
- **Web Scraper API**: "thousands" of official, maintained scrapers for big sites (Amazon, LinkedIn, Instagram, TikTok, Google Maps, ChatGPT, and others).
- **Scraper Studio**: an AI agent that builds a custom scraper from a prompt in about 10 minutes.
- **Dataset Marketplace**: pre-collected data for 250+ domains.
- **Web MCP server** for AI agents.

**Apify** is a serverless platform where every scraper or automation is an "Actor", meaning a Docker container with typed input and output. It offers:
- **Apify Store**: about 27k public Actors, some maintained by Apify and most by the community.
- **Hosting for your own code**: Node or Python, starting from templates for scrapers, browser automation, and AI agents (LangChain, CrewAI, LlamaIndex, Mastra, PydanticAI, Smolagents, MCP).
- **Standby mode**, which turns an Actor into a warm HTTP API.
- **Platform plumbing**: datasets and key-value storage, scheduling, webhooks, and Apify Proxy.
- **Crawlee**, its open-source crawling library.
- **An MCP server** that turns *any* Actor into a tool your agent can call.

## Overlap map

| Capability | Bright Data | Apify | Overlap |
|---|---|---|---|
| Ready-made scrapers for big sites | Web Scraper API: official, maintained, code is closed | Store Actors: many options per site, quality varies, open about how they work | **High** |
| Long-tail or niche sites | Scraper Studio AI builds one in ~10 min | Probably a Store Actor already exists; if not, write one with Crawlee | **High** |
| Google and other search results | SERP API | Google Search Actors, RAG Web Browser | **High** |
| URL to Markdown for LLMs | MCP `scrape_as_markdown`, Web Unlocker | RAG Web Browser, Web Fetch Actor | **High** |
| MCP server for agents | `mcp.brightdata.com`, 32 tools in groups (scrapers, browser, advanced_scraping, geo) | `mcp.apify.com`, which can search the Store and call any Actor at runtime | **High** |
| Agent framework integrations | LangChain, LlamaIndex, CrewAI, Dify, Haystack and 25+ more; n8n, Zapier | LangChain/LangGraph, LlamaIndex, OpenAI Agents SDK, Vercel AI SDK, Google ADK, CrewAI, Mastra, Agno, Bedrock and more; Pinecone, Qdrant, Milvus | **High** |
| Remote headless browser | Browser API (CDP endpoint, solves CAPTCHAs automatically) | Runs Playwright or Puppeteer *inside* your Actor; no separate browser product | Partial |
| Anti-bot unblocking | Best in class; this is the core business | Proxy rotation and browser fingerprinting inside Actors; adequate for most sites | Partial (Bright Data stronger) |
| Proxy network | Huge, with city, carrier and ASN targeting | Smaller: Apify Proxy (datacenter, residential, SERP), or bring your own | Partial |
| Pre-collected datasets | Dataset Marketplace (instant, no scraping) | None; you collect data fresh | **Bright Data only** |
| Host *your own* code or agent | No; only scrapers built in Scraper Studio | Yes. Any Node or Python app, run as a batch job or a warm API | **Apify only** |
| Publish and monetize what you build | No | Yes: publish to the Store with pay-per-event billing | **Apify only** |
| Scheduling, storage, webhooks | Basic, for its own scrapers | A complete platform | Mostly Apify |
| Agent pays for itself in crypto (x402) | Not found | Yes: buy prepaid Apify tokens with USDC on Base | **Apify only** |

## Hackathon-specific comparison

| What matters this weekend | Bright Data | Apify | Edge |
|---|---|---|---|
| **Prize at CalHacks 13.0** | None listed | $5,400 across 6 prizes, including Best Actor | Apify |
| **Signup to first data** | Minutes. One API key, then call `POST /datasets/v3/scrape`, or use `pip install brightdata-sdk` / `npm i @brightdata/sdk` | Minutes. Run a Store Actor from the console, or call `run-sync-get-dataset-items` | Tie |
| **Account friction** | **KYC gates a lot**: residential proxies, logins or password entry in Browser API, sites that disallow scraping in robots.txt, government sites, and some other domain categories. KYC requires a company email (free email providers are rejected on the spot) and a person reviews it within 48 hours | None found | **Apify** |
| **Latency for live judging** | Sync Scraper API takes seconds for one input; after 60 s it returns 202 and you have to poll | A normal Actor run has container startup time. Standby Actors are warm. RAG Web Browser takes about 16–30 s per search | Bright Data slightly ahead |
| **Reliability on hard sites (LinkedIn, Amazon, ticketing)** | Highest. Official scrapers and the Unlocker are its core business | Depends on which Actor you pick. Check success rate, users and the "under maintenance" flag | Bright Data |
| **Plug into a Claude or GPT agent** | Add MCP URL plus token. Free tier exposes 2 tools (`search_engine`, `scrape_as_markdown`) | Add MCP URL (OAuth or token). The agent can *discover and run* any of about 27k Actors | **Apify** for breadth |
| **"Technical complexity" judging score** | Using an API alone looks thin. It shows well inside a bigger pipeline | Building and publishing your own Actor or hosted agent shows real engineering | Apify |
| **Ship custom logic** | Scraper Studio, limited to one data shape per scraper; code is generated and edited in its IDE | Full code. `apify create`, `apify run`, `apify push`, with templates for TS, JS and Python | **Apify** |
| **Instant bulk data (no scraping)** | Dataset Marketplace, with free previews | None | **Bright Data** |
| **Past hackathon track record** | 5+ "Best Use of Bright Data MCP" winners; Cal Hacks 12.0 3rd Overall used it | Travabelle won "Best use of Apify" (city data for walking tours) | See the past-winners section below |
| **Stacks with other CalHacks prizes** | Fits any agent track as its web-access tool | Same, **plus x402 support that lines up with the Coinbase x402 track** | Apify |

## Gotchas

**Bright Data**
- Without KYC, many things fail outright. Browser API navigation throws `brob` on pages that robots.txt disallows. Password typing is disabled. Residential proxies are off. KYC can't even start in Playground or Trial mode. Plan as if you will **not** get KYC this weekend.
- A sync scrape that runs past 60 s returns HTTP 202 and a `snapshot_id`. Code the polling fallback, or live judging can hang.
- Prebuilt scraper code can't be viewed or changed. LinkedIn posts are capped at about 10 per profile. Instagram media URLs expire after 24 hours.
- The free MCP tier (Rapid mode) exposes only 2 tools. The ~60-tool Pro mode is a paid upgrade, so check whether your credits cover it.

**Apify**
- Store quality varies. Pick Actors that are Apify-maintained or that have high users, a success rate near 100%, and recent updates. Avoid any marked "under maintenance".
- A normal run starts a container, so for a snappy UI use Standby Actors or pre-fetch and cache results.
- The free-tier OpenRouter Actor "may be blocked by anti-fraud protections". Credits should avoid that.
- The criteria for **Best Actor** aren't published on Devpost. Ask at the Apify booth or on Discord whether the Actor must be **public in the Store** and what they judge it on, such as usefulness, README quality, or input schema.

## Can you use both? Yes, and past winners did it this way

**Verdict:** using both is fine. Stacking sponsor tools is how most multi-prize winners got there. The risk is in the framing, not in the stack: judges for "Best use of Apify" want Apify to be the heart of the product, not one of five logos. So give each tool a clear, distinct job, and make Apify's job the one you show judges.

**Evidence from past hackathons:**

| Project (hackathon) | Data tool used | What it did | Prizes won |
|---|---|---|---|
| **Travabelle** (MCP AI Agents Hackathon) | Apify | Personalized walking tours from live city data. *This is the closest match to a venues project* | **Best use of Apify**, Best Use of MiniMax Agents |
| **LangBridge AI** (MCP AWS Enterprise Agents) | Bright Data MCP | Scrapes reviews, Reddit and marketplace data per country, then writes localized ad copy | Best Use of Bright Data MCP, Best Use of MiniMax, **Top 5 Overall** |
| **Chex** (A2A Agents Hackathon) | Bright Data MCP (plus Firecrawl) | Mental-health agents that look up therapists and resources in real time | 3 prizes: Arcade, Mastra, Bright Data |
| **Arnold** (MCP AWS Enterprise Agents) | Bright Data | Personal trainer app | Best Use of NLX, Best Use of Bright Data MCP |
| **Info-Ninja** (MCP AI Agents Hackathon) | Bright Data MCP | Multi-agent competitor intelligence and SWOT reports | Best Use of Bright Data MCP |
| **Auto_Sec** (MCP AI Agents Hackathon) | Bright Data MCP | Scouts CVE databases and auto-opens patch PRs | Best Use of Bright Data MCP, Horizon3.ai |
| **Project No Cap** (**Cal Hacks 12.0**) | Bright Data | Real-time fact-checking and bias detection | **3rd Overall** |
| **NurseNora** (AWS MCP Agents Hackathon) | Apify plus Clarifai | Nursing assistant drawing on Healthline content | Linkup, MiniMax Audio, n8n prizes (not an Apify prize) |
| **Viberr** (MCP AI Agents Hackathon) | Apify; tried Bright Data and ran out of time | Pricing marketplace for vibe-coded projects | None |

**Patterns:**
1. **Winners stack two or three sponsor prizes.** Several of those hackathons *required* at least 3 sponsor tools. At CalHacks 13.0, Devpost doesn't limit how many prizes one project can win (check `/rules` to confirm).
2. **I found no project that won both an Apify prize and a Bright Data prize.** That's likely because the two rarely ran tracks at the same event. It isn't evidence that judges penalize using both.
3. **Bright Data winners used it as an agent's web-access tool (MCP).** Apify winners used it as the live data source behind the product.
4. **The cautionary tale:** Viberr spent time wiring in a second scraping tool, ran out of time, and won nothing. With about 38 hours left, wire up Bright Data only for a specific site that Apify fails on.

## Your project: venues and merchandise

| Data you need | Apify option | Bright Data option | Pick |
|---|---|---|---|
| **Venues** (name, address, coordinates, rating, reviews, photos, hours) | **Google Maps Scraper** (`compass/crawler-google-places`): 663k users, rated 4.7. Takes a search term plus location, returns places with reviews and photos | Google Maps Scraper API (sync, official) | **Apify.** It's the most-used Actor in the Store and the core of a "Best use of Apify" story |
| **Events at venues** (dates, lineup, face-value prices) | Several community Ticketmaster Actors. The one checked has 1 user and no ratings, so treat community ticketing Actors as risky | **Official scrapers for Ticketmaster, StubHub and Eventbrite**, plus a Ticketmaster MCP with seat maps and inventory. Self-healing when the site changes | **Bright Data.** Ticketing sites are heavily protected, which is exactly where Bright Data is strongest |
| | *Also consider the **official Ticketmaster Discovery API**: free key, 5,000 calls per day, events, venues and attractions. It's the most reliable for judging and can sit behind an Apify Actor* | | |
| **Merchandise** (Amazon, eBay, Walmart, Etsy, Shopify stores) | **E-commerce Scraping Tool** (`apify/e-commerce-scraping-tool`): Apify-maintained, 16k users. Supports Amazon, Walmart, eBay, Etsy, Target, and any Shopify or WooCommerce store. Returns price, variants, stock and reviews | Official Amazon, Etsy and eBay scrapers | **Apify** |
| **Your own glue** (match venues to events to merch) | **Publish it as your own Actor**, which qualifies you for *Best Actor* | — | Apify |

**Suggested architecture:**
- **Apify:** Google Maps Actor for venues, plus the E-commerce Actor for merch.
- **Your own published Actor** joins the two (for example "venue to upcoming events to related merch") and runs as a **Standby** API for the frontend.
- **Bright Data:** the Ticketmaster or StubHub scraper (or the Discovery API) feeds event data into that Actor.
- **Pitch:** "Apify is the platform; Bright Data unlocks ticketing sites."

## Using both: the wiring

- **Bright Data proxies inside an Apify Actor:** in `proxyConfiguration` (or "Own proxies" in the UI), use `http://USER:PASS@HOST:PORT`. Without KYC, use ISP or datacenter zones, and use a SERP zone for Google. Bright Data documents this setup officially.
- **Both MCP servers in one agent:** Apify for breadth and actions, Bright Data's `scrape_as_markdown` as the fallback when a site blocks you.
- **Framing for judges:** keep Apify as the product's core so the project counts as a *Best use of Apify*. Present Bright Data as plumbing.

## Project patterns that fit "Best use of Apify" plus "Best Actor"

1. **Agent with live web skills:** a Claude or GPT agent on `mcp.apify.com` that discovers and chains Actors at runtime (for example Google Maps, then reviews, then a summary). Publish the glue as your own Actor.
2. **New Actor for a gap in the Store:** a scraper or API for a site or data source with no good Actor, run as a Standby Actor and used by your app's UI.
3. **Agent that pays for its own data:** an agent that buys Apify tokens via x402 on Base, so you can also submit to the **Coinbase x402** track.
4. **Monitoring pipeline:** a scheduled Actor that pushes to a webhook, feeding alerts or a dashboard. This shows off platform features judges can see (schedules, datasets, webhooks).

## Sources

- [CalHacks 13.0 Devpost (prizes, judging, deadline)](https://cal-hacks-13-0.devpost.com/)
- [Cal Hacks 12.0 Devpost (Bright Data track)](https://cal-hacks-12-0.devpost.com/)
- Bright Data docs: [products](https://docs.brightdata.com/products.md), [quickstart](https://docs.brightdata.com/quickstart), [sync vs async](https://docs.brightdata.com/concepts/sync-vs-async), [Scraper API FAQs](https://docs.brightdata.com/products/scrapers/scrapers-library/faqs), [Browser API intro](https://docs.brightdata.com/products/scraping-browser/introduction), [Browser API KYC and access](https://docs.brightdata.com/products/scraping-browser/kyc-and-access), [general FAQs (KYC)](https://docs.brightdata.com/general/faqs), [MCP overview](https://docs.brightdata.com/products/mcp-server/overview), [remote MCP advanced](https://docs.brightdata.com/products/mcp-server/remote/advanced.md), [MCP free tier](https://brightdata.com/blog/ai/web-mcp-free-tier), [Scraper Studio AI agent](https://docs.brightdata.com/products/scraper-studio/ai-agent), [integrations](https://docs.brightdata.com/integrations/introduction), [Bright Data with Apify](https://docs.brightdata.com/integrations/apify.md)
- Apify docs: [AI integrations](https://docs.apify.com/integrations/ai), [agents](https://docs.apify.com/agents), [MCP server repo](https://github.com/apify/apify-mcp-server), [develop AI agents](https://docs.apify.com/actors/development/quick-start/develop-ai-agents), [CLI quick start](https://docs.apify.com/cli/docs/quick-start.md), [Standby](https://blog.apify.com/actor-standby-mode/), [RAG Web Browser](https://apify.com/apify/rag-web-browser), [how the Store works](https://docs.apify.com/academy/actor-marketing-playbook/store-basics/how-store-works), [x402](https://docs.apify.com/platform/integrations/x402)
- Past winners: [Travabelle](https://devpost.com/software/travabelle), [LangBridge AI](https://devpost.com/software/langbridge-ai), [Chex](https://devpost.com/software/chex-i6kdzr), [Arnold](https://devpost.com/software/arnold-rf8x9q), [Info-Ninja](https://devpost.com/software/info-ninja), [Project No Cap](https://devpost.com/software/project-no-cap), [NurseNora](https://devpost.com/software/nursenora), [Viberr](https://devpost.com/software/viberr); hackathon pages: [MCP AI Agents](https://mcp-ai-agents-hackathon.devpost.com/), [AWS MCP Agents](https://aws-mcp-agents-hackathon.devpost.com/), [MCP and A2A](https://mcp-and-a2a-hackathon.devpost.com/)
- Venues and merch: [Apify Google Maps Scraper](https://apify.com/compass/crawler-google-places), [Apify E-commerce Scraping Tool](https://apify.com/apify/e-commerce-scraping-tool), [Apify Ticketmaster Actor (checked)](https://apify.com/automation-lab/ticketmaster-events-scraper), [Bright Data Ticketmaster scraper](https://brightdata.com/products/web-scraper/ticket-scraper/ticketmaster), [Bright Data Ticketmaster MCP](https://brightdata.com/ai/mcp-server/ticketmaster), [Bright Data StubHub](https://brightdata.com/products/web-scraper/ticket-scraper/stubhub), [Bright Data Eventbrite](https://brightdata.com/products/web-scraper/eventbrite), [Ticketmaster Discovery API](https://developer.ticketmaster.com/products-and-docs/apis/getting-started/)
- Hackathon examples: [Auto_Sec (Bright Data MCP winner)](https://devpost.com/software/auto_sec-bright-data-llama-index-redis), [Nurse Nora (Apify blog)](https://blog.apify.com/petros-hong-hackathon-to-community/), [Bright Data Scrape-Verse hackathon](https://www.wemakedevs.org/hackathons/scrape-verse)
- Store size (about 27k Actors, third-party): [vantaige.io](https://vantaige.io/ai-tool/apify)
