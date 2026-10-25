# BandIt: Bright Data scraping plan

Saved from https://claude.ai/artifact/JjjuKxqqHF6L1M7VYFWRye, last updated 2026-10-24.

## TL;DR

Scrape the event's lists, the companies, the venue and the floor plan. Each exhibitor, speaker, sponsor and artist gets a prefilled profile, which they claim by tapping their band. People add their own socials during onboarding.

- **People:** pull names, roles and bios from the event's exhibitor and speaker pages with `scrape_as_markdown` + `extract`. Enrich their companies with the LinkedIn company and Crunchbase scrapers. Socials come from the person at onboarding.
- **Venue:** the Google Maps scraper for the place record, `scrape_as_markdown` on the venue's own site for halls, entrances and rules, and OpenStreetMap (free, not Bright Data) for the building outline.
- **Booth map:** if the floor plan is interactive (ExpoFP, Map Your Show, a2z, Swapcard), capture the JSON or SVG it loads through the Browser API. A vector PDF parses with PyMuPDF. A raster image needs OpenCV plus OCR, with Claude vision reading the legend and checking the result.
- **Load:** every scraper writes raw records into Elastic. An Elastic Agent Builder agent cleans and links companies, booths, people, schedule and zones into one checked bundle. The Rust ingest service loads that bundle into SpacetimeDB through `import_event`.
- **Bright Data vs Elastic:** Bright Data owns every step that touches the web, Elastic owns every step after raw records land, and SpacetimeDB owns anything live.

**Diagram: data pipeline · 4 sources, 1 bundle, 1 claim path**

What it shows: Raw scrape lands in Elastic; its agent hands SpacetimeDB a checked bundle.

Text in the diagram, in drawing order:

- Raw scrape lands in Elastic; its agent hands SpacetimeDB a checked bundle
- Source
- Bright Data tool
- Store
- Event pages
- exhibitor and speaker lists
- Web MCP
- scrape_as_markdown + extract
- Company pages
- LinkedIn, Crunchbase
- Web Scraper API
- company profile scrapers
- Venue
- Google Maps, venue site
- Maps scraper + extract
- place record, halls, rules
- Floor plan
- interactive map, PDF, image
- Browser API or local parse
- JSON/SVG, PyMuPDF, OpenCV+OCR
- Elastic
- raw scrape indices
- one per source
- Elastic Agent Builder
- cleans and links
- raw records
- Checked bundle
- companies, booths, people,
- schedule, zones
- Rust ingest service
- calls import_event
- upserts, admin only
- SpacetimeDB
- public and private tables
- Band tap + onboarding
- claims profile, adds socials

Raw scrapes land in Elastic, where an Agent Builder agent links them into one checked bundle for the Rust ingest service. Tapping the band claims the prefilled profile, and the person adds their own socials at onboarding. Separately, a one-way indexer copies photos, visits, encounters and booths from SpacetimeDB back into Elastic for attendee search over photos and memories, ranked by meaning with vectors. That path is outside scraping.

## Which Bright Data product for each target

Four Bright Data products cover everything: the Web MCP for pages, the Web Scraper API for Google Maps and company data, the Browser API for interactive maps, and Scraper Studio for repeat runs..

| Target | Fields | Bright Data product | Notes |
| --- | --- | --- | --- |
| Exhibitor, speaker, sponsor, artist lists | name, org, role, booth number, session times, bio, logo, website | Web MCP [`scrape_as_markdown`](https://docs.brightdata.com/products/mcp-server/tools) then `extract` (AI to JSON with your prompt); `scrape_batch` for up to 10 pages at once | For hundreds of detail pages, build a [Scraper Studio](https://docs.brightdata.com/products/scraper-studio/ai-agent) "Discovery + PDP" scraper from a prompt in about 10 minutes |
| Exhibitor companies | logo, description, HQ, size, company socials | Web Scraper API: LinkedIn company profile, Crunchbase company | Key them by website domain |
| Venue place record | address, lat/lng, hours, phone, website, rating, photos | Web Scraper API [Google Maps collect by URL](https://docs.brightdata.com/api-reference/scrapers/search-engines-apis/google-maps-collect-by-url) (`gd_m8ebnr0q2qlklc02fz`) | Find the Maps URL first with the SERP API or `search_engine` |
| Venue details | halls, capacity, entrances, accessibility, bag policy, first aid | `scrape_as_markdown` + `extract` on the venue site and event FAQ |  |
| Interactive floor plan | booth shapes and ids | [Browser API](https://docs.brightdata.com/products/scraping-browser/introduction) (Playwright over CDP) to capture the JSON or SVG the map loads | MCP `scraping_browser_network_requests` finds the data URL by hand first |
| Floor plan PDF or image | the file | `scrape_as_html` or a plain download | Parsing runs locally (see the booth map section) |

Turn on the `advanced_scraping`, `browser` and `scrapers` tool groups on the remote MCP URL. By default only `search_engine`, `scrape_as_markdown` and `discover` are on. Most event sites don't block bots, so a plain `fetch` often works there; Bright Data earns its keep on Google Maps, LinkedIn and Cloudflare-protected directories.

## Bright Data vs Elastic: who owns each step

Bright Data owns every step that touches the outside web. Elastic owns every step after the raw records land, and SpacetimeDB owns anything live or exact. They overlap in five places, marked below, and each one should have a single owner.

| Step | Owner | Why not the other |
| --- | --- | --- |
| Find source URLs (exhibitors, speakers, schedule, floor plan) | Bright Data `search_engine` | Elastic has no web search |
| Fetch pages | Bright Data Web Unlocker or MCP **(overlap)** | Elastic's [Open Crawler](https://github.com/elastic/crawler) crawls static HTML on a cron, but its docs mention no JavaScript rendering, proxies or CAPTCHA handling. Use it only for a plain static site you want crawled whole |
| Interactive floor plan data | Bright Data Browser API | Nothing in Elastic runs a browser |
| Google Maps, LinkedIn company, Crunchbase | Bright Data Web Scraper API, or MCP `search_dataset` on its pre-collected company datasets | Elastic would have to scrape these sites itself |
| Turn one page into JSON | Bright Data `extract` **(overlap)** | Elastic could do it with the agent or a Workflow `ai.prompt` step, but only by storing raw HTML and running an LLM pass per page. Extract at scrape time so Elastic gets JSON |
| PDF or image floor plan to booth geometry | Your local script (PyMuPDF, OpenCV) | Elastic's [attachment processor](https://www.elastic.co/docs/reference/ingest-processor/attachment) extracts PDF text but no positions, and Bright Data only downloads the file |
| Land raw records | Elastic, one index per source | Bright Data [delivers](https://docs.brightdata.com/products/scrapers/scrapers-library/delivery-options.md) to webhooks, S3, GCS, Azure, Snowflake, Pub/Sub and SFTP, not Elasticsearch. A small webhook handler bulk-indexes into Elastic |
| Exact joins (booth number to company, session to stage) | Elastic ES\|QL LOOKUP JOIN (GA since 9.1) | Deterministic and cheap, so keep the agent out of exact matches ([docs](https://www.elastic.co/search-labs/blog/esql-elasticsearch-8-19-9-1)) |
| Fuzzy linking (same person or company spelled two ways) | Elastic Agent Builder agent | Bright Data doesn't know your event |
| Fill gaps (a booth with no company website) | Elastic agent calling Bright Data's MCP **(overlap)** | Agent Builder supports [MCP tools](https://www.elastic.co/docs/explore-analyze/ai-features/agent-builder/tools/custom-tools), so the agent can look things up. Cap it at a few calls per run |
| Re-scrape on a schedule | Elastic [Workflows](https://www.elastic.co/search-labs/blog/elastic-workflows-automation) **(overlap)** | Bright Data's Scraper Studio can schedule too, but a Workflow can call Bright Data over HTTP, index the result and invoke the agent in one place. It is a tech preview in 9.3. For the judging run, one script run is enough |

Once the bundle is checked, Bright Data and Elastic's cleanup job are done. The Rust ingest service loads SpacetimeDB, which owns positions, claims and visits. Elastic gets only the one-way copy back, for meaning-based search over photos and memories.

**Best uses of Bright Data for BandIt, in order**

1. The Google Maps venue record: structured fields from one call.
2. Unblocked fetch plus `extract` on exhibitor, speaker and schedule pages.
3. The Browser API to capture the interactive floor plan's JSON.
4. Company enrichment from the LinkedIn company and Crunchbase scrapers.
5. Its MCP as the Elastic agent's gap-filler.

Skip Scraper Studio unless a directory has hundreds of detail pages, and skip proxies entirely.

## People pipeline

Build one unclaimed profile for each person the event lists publicly, using only the event's own pages. People add their socials during onboarding.

1. **Ask the organizer first.** Most registration tools (Luma, Eventbrite, Sched, Swapcard) export speakers and exhibitors as CSV. The export includes emails, which help match people at claim time.
2. **Find the public pages.** Run `search_engine` on `"<event name>" exhibitors`, `speakers`, `sponsors`, `lineup` and `schedule`. Trade shows usually host directories on Map Your Show, a2z, ExpoFP, Swapcard or Expocad. Speakers and schedules are often on Sched.
3. **Scrape and structure.** Run `scrape_as_markdown` on the listing, then `extract` with the prompt below, then `scrape_batch` the detail pages 10 at a time. On hosted directories, look for the JSON the page loads first (same trick as the floor plan). It is cleaner than HTML.
4. **Enrich organizations.** Run the LinkedIn company and Crunchbase company scrapers on each exhibitor and sponsor. Treat a band or act as an organization and keep the official links the lineup page publishes.
5. **Write raw to Elastic.** Index each record as scraped, with `source_url` and `fetched_at`, one index per source. Don't clean or dedupe here; the Elastic agent links people, organizations, booths and sessions later.

Per person, keep what the event page shows: name, role, title, organization, session or booth, bio, headshot, and any links the event lists.

```text
Return JSON {"people":[{"name","role":"speaker|exhibitor|sponsor|artist","title","organization","bio","headshot_url","session_or_booth","listed_links":[]}],
"organizations":[{"name","website","booth_numbers":[],"logo_url","description","category"}],
"sessions":[{"title","starts_at","ends_at","stage","speakers":[]}]}.
Include only what is on this page. Use null for anything missing. Do not guess.
```

## Venue pipeline

The place record comes from Google Maps, and the safety details BandIt needs (exits, first aid, capacity) come from the venue's own pages and the floor plan.

| Field | Source | How |
| --- | --- | --- |
| Name, address, lat/lng, `place_id`, phone, website, hours, rating, photos | Google Maps | `search_engine` for the Maps URL, then the [Google Maps collect-by-URL scraper](https://docs.brightdata.com/api-reference/scrapers/search-engines-apis/google-maps-collect-by-url) |
| Halls, levels, capacity, accessible entrances, bag policy, restrooms, first aid | Venue site (plan your visit, accessibility, maps pages) and the event FAQ | `scrape_as_markdown` + `extract` |
| Building outline, entrances, indoor rooms where mapped | OpenStreetMap | Overpass query for the building, `entrance=*` nodes and [Simple Indoor Tagging](https://wiki.openstreetmap.org/wiki/Simple_Indoor_Tagging) (`indoor=room`, `level=*`). Free, not Bright Data |
| Emergency exits, info desks, stages | The event floor plan | Parsed with the booths (next section). Venues rarely publish evacuation plans, so mark exits by hand for the judging run if the plan lacks them |

Exits matter most for BandIt. Each exit becomes a `zone` row that the exit stations (ids 101 to 105 in the hardware protocol) map to, so the bands can show the right exit color.

## Booth map: floor plan to booth positions

Try three routes in order of accuracy: the interactive map's own data, then a vector PDF, then a raster image. All three end in the same `booth` rows, each with a label, a polygon in meters, a hall and a level.

**1. Interactive map (exact).** Plans on ExpoFP, Map Your Show, a2z, Swapcard and Expocad load booth geometry as JSON or SVG. Open the page once in the Browser API and save every JSON or SVG response. Then pick the one that contains known booth numbers. After that, fetch that URL directly and skip the browser. The Browser API allows one `goto` per session and closes sessions after 30 minutes, so use one session per map.

```js
const browser = await chromium.connectOverCDP(`wss://${AUTH}@brd.superproxy.io:9222`);
const page = await browser.newPage();
const hits = [];
page.on('response', async r => {
  if (/json|svg/.test(r.headers()['content-type'] ?? '')) hits.push({ url: r.url(), body: await r.text() });
});
await page.goto(FLOOR_PLAN_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForTimeout(8_000);
const plan = hits.find(h => h.body.includes(KNOWN_BOOTH)); // e.g. '1215'
```

**2. Vector PDF (near exact).** PyMuPDF gives every word with its bounding box (`get_text("words")`) and every vector shape with its bounds (`get_drawings()`, where `"re"` items are rectangles). A booth is the smallest closed shape that contains a booth-number word. Words outside any shape are legend or hall labels.

```python
import fitz, re
page = fitz.open(PDF)[0]
labels = [w for w in page.get_text("words") if re.fullmatch(r"[A-Z]?\d{2,4}[A-Z]?", w[4])]
shapes = [d["rect"] for d in page.get_drawings() if d["closePath"] or any(i[0] == "re" for i in d["items"])]
for x0, y0, x1, y1, text, *_ in labels:
    c = fitz.Point((x0 + x1) / 2, (y0 + y1) / 2)
    box = min((r for r in shapes if c in r), key=lambda r: r.width * r.height, default=None)
```

**3. Raster image or scanned PDF (approximate).** Use OpenCV to find booth outlines: threshold, `findContours`, then `approxPolyDP`, keeping four-corner shapes of booth size. OCR the booth numbers with Tesseract or PaddleOCR, which return pixel boxes, and match them to outlines as above. Use Claude vision for what OCR can't do: read the legend, hall names, exits and scale bar, then check an overlay of the detected booths and list misses. Its coordinates are less precise than OCR boxes, so don't use it as the only locator.

**Normalize, whatever the route.**

- Convert plan units to meters with the scale bar or a known size. A standard US inline booth is 10 ft × 10 ft (3.05 m).
- Flip the y axis, since PDF and image y grows downward.
- Leave joining to the Elastic agent: it matches booths to organizations by booth number and flags booths with no match.
- Assign each booth to its nearest station zone. Skip lat/lng unless you need it; three control points matched to the OpenStreetMap outline give an affine transform if you do.
- Fix leftovers by hand in an admin view. The judging run needs one clean hall, not a perfect parser.

## Claim and onboarding

The band tap opens the web app on the prefilled profile. The person confirms "Is this you?", fixes anything wrong, and enters their own social handles (LinkedIn, Instagram, TikTok, X). Match them by the organizer's email export when you have it, otherwise by name at band pickup.

## Output schema for SpacetimeDB

The Elastic agent produces one checked bundle per event, and the Rust ingest service passes it to one `import_event` reducer, which upserts it into ten tables. Emails live in a private table. The names here are a proposal, so match them to the SpacetimeDB design doc.

| Table | Key | Main fields | Visible to clients |
| --- | --- | --- | --- |
| `event` | slug | name, venueId, startsAt, endsAt | Yes |
| `venue` | Google `place_id` | name, address, lat, lng, phone, website, hours, capacity | Yes |
| `hall` | slug | venueId, name, level, widthM, depthM, planUrl | Yes |
| `zone` | station id (101 to 105) | hallId, kind (exit, entrance, stage, first aid, info), label, x, y, exitColor | Yes |
| `organization` | website domain | name, logoUrl, description, category, linkedinUrl, crunchbaseUrl | Yes |
| `booth` | event + label | eventId, hallId, label, organizationId, polygon, zoneId | Yes |
| `session` | event + title + start | eventId, title, startsAt, endsAt, zoneId, speakerIds | Yes |
| `person` | hash of event, name, org | displayName, roles, title, organizationId, bio, headshotUrl, claim, owner | Yes, event-published fields only |
| `claim_contact` | personId | email from the organizer export | No |
| `social_link` | personId + platform | handle, url, entered by the person at onboarding | Yes |

Every scraped row also carries `sourceUrl` and `fetchedAt`. Keep the raw HTML and JSON responses on disk so you can re-parse without scraping again. Positions are meters from the hall's top-left corner.

```ts
import { schema, table, t } from 'spacetimedb/server';

const Point = t.object('Point', { x: t.f64(), y: t.f64() });
const Claim = t.enum('Claim', { Unclaimed: t.unit(), Claimed: t.unit() });

const booth = table({ name: 'booth', public: true }, {
  id: t.string().primaryKey(),            // `${eventId}:${label}`
  eventId: t.string().index('btree'),
  hallId: t.string(),
  label: t.string(),                      // "1215"
  organizationId: t.option(t.string()),   // website domain
  polygon: t.array(Point),
  zoneId: t.option(t.u32()),              // nearest station
});

const person = table({ name: 'person', public: true }, {
  id: t.string().primaryKey(),
  eventId: t.string().index('btree'),
  displayName: t.string(),
  roles: t.array(t.string()),             // speaker | exhibitor | sponsor | artist
  title: t.option(t.string()),
  organizationId: t.option(t.string()),
  bio: t.option(t.string()),
  headshotUrl: t.option(t.string()),
  claim: Claim,
  owner: t.option(t.identity()),          // set when the band is tapped and claimed
  sourceUrl: t.string(),
});

const claim_contact = table({ name: 'claim_contact' }, {  // no public flag = private
  personId: t.string().primaryKey(),
  email: t.string(),
});

const spacetimedb = schema({ booth, person, claim_contact /* , event, venue, hall, zone, organization, social_link */ });
export default spacetimedb;

export const import_event = spacetimedb.reducer({ bundle: t.string() }, (ctx, { bundle }) => {
  const b = JSON.parse(bundle);           // check ctx.sender is the admin first
  for (const row of b.booths) {
    if (ctx.db.booth.id.find(row.id)) ctx.db.booth.id.update(row);
    else ctx.db.booth.insert(row);
  }
  // same upsert for venue, halls, zones, organizations, people
});
```

The Rust ingest service calls it over the [HTTP API](https://spacetimedb.com/docs/http/database), where the body is a JSON array of the reducer's arguments. Upserts make re-runs safe. Split the bundle by table if it gets large. The curl below makes the same call by hand, for testing.

```bash
curl -X POST "$STDB_HOST/v1/database/bandit/call/import_event" \
  -H "Authorization: Bearer $SPACETIME_TOKEN" \
  --data "$(jq -c '[tojson]' bundle.json)"
```

## Build order and gotchas

Scrape the pitch's event once, save the bundle, and run the pitch from SpacetimeDB rather than scraping live.

1. Pick one event that has a public exhibitor list and an interactive or PDF floor plan.
2. Scrape exhibitors, speakers and the schedule into Elastic, headed for `organization` and `person` rows.
3. Parse the floor plan into `booth` rows and join them to organizations by booth number.
4. Pull the venue from Google Maps, then mark exits and stations as `zone` rows.
5. Write `import_event`, then have the Rust ingest service load the Elastic agent's checked bundle.
6. Build the claim and onboarding flow: band tap, "Is this you?", then the person adds their socials.

**Gotchas**

- **Blocked pages:** if the Browser API refuses a page, run Playwright locally instead. Event sites rarely have bot protection.
- **Browser API sessions:** one `goto` per session, closed after 5 minutes idle or 30 minutes total.
- **Sync Scraper API:** a request that runs past 60 s returns HTTP 202 and a `snapshot_id`, so code the polling path.
- **`extract` can invent values.** Tell it to return null for missing fields, and never accept a booth number that isn't on the page.
- **Multi-page PDFs:** each page is usually one hall, so parse page by page.
- **Option columns:** JSON gives `null`, while the TypeScript module's option fields may expect `undefined`. Normalize in the loader.

## Sources

- Bright Data: [MCP tools and groups](https://docs.brightdata.com/products/mcp-server/tools), [Browser API intro](https://docs.brightdata.com/products/scraping-browser/introduction), [Browser API reference (sessions, CDP)](https://cdn.jsdelivr.net/npm/@brightdata/opencode-brightdata@1.0.0/skills/bright-data-best-practices/references/browser-api.md), [Google Maps collect by URL](https://docs.brightdata.com/api-reference/scrapers/search-engines-apis/google-maps-collect-by-url), [Scraper Studio AI agent](https://docs.brightdata.com/products/scraper-studio/ai-agent), [general FAQs](https://docs.brightdata.com/general/faqs)
- Earlier project research: bright-data-vs-apify.md
- Floor plans: [PyMuPDF drawings](https://pymupdf.readthedocs.io/en/latest/recipes-drawing-and-graphics.html), [Esri: floor plan features from PDF](https://doc.esri.com/en/arcgis-pro/latest/tool-reference/indoors/extract-floor-plan-features-from-pdf.html), [OSM Simple Indoor Tagging](https://wiki.openstreetmap.org/wiki/Simple_Indoor_Tagging), [ExpoFP exhibitor scraper fields](https://apify.com/jamkon/expofp-exhibitor-scraper.md)
- SpacetimeDB: [tables](https://spacetimedb.com/docs/tables), [column types](https://spacetimedb.com/docs/tables/column-types), [reducers](https://spacetimedb.com/docs/functions/reducers), [HTTP API](https://spacetimedb.com/docs/http/database)
- Social linking: [LinkedIn OIDC](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2), [Instagram Basic Display end](https://developers.facebook.com/blog/post/2024/09/04/update-on-instagram-basic-display-api), [TikTok scopes](https://www.getphyllo.com/post/tiktok-api-scopes)
