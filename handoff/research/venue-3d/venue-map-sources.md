# Cal Hacks 13.0 venue map: where it lives and how to get it

Checked 2026-10-24. Every link below was opened and checked.

## Where the 3D map comes from

- The 3D view in the mana.space t-shirt delivery app is an embed of **https://palace-interior.vercel.app/** (page title "Palace of Fine Arts · Cal Hacks 13").
- The official Cal Hacks page **https://hive.hackberkeley.org/venue-map** ("Venue map · Cal Hacks 13.0") embeds the same scene (`https://palace-interior.vercel.app/?view=3d&embed=1`), with 2D and 3D tabs and a searchable list of **374 locations across all floors**. Each location carries its floor ("main floor" or "Mezzanine"). The list comes back in a plain page fetch, with no sign-in.
- palace-interior has no model file. It draws the scene with three.js over 2D plan images. The data is in `assets/livePins-*.js` (114 hacker table blocks, 67 sponsor tables, 80 labels, in plan pixels). The images are `plan-main-floor.jpg`, `plan-mezzanine.jpg`, `venue-map-main-floor.png`, `venue-map-mezzanine.png` and `backdrop-calhacks13.png`. The other thread saved all 14 files on Viktor's Mac in `pipeline/data/venue/palace-interior/`.
- Its live pins call the organizers' Supabase RPC `auth.hackberkeley.org/rest/v1/rpc/get_map_screen_data`. The hive site is on the Vercel team "hackathons-at-berkeley", so the map is most likely organizer-made. Its author isn't named anywhere public.
- Mana (Crescent Park Computing Company) is a listed Cal Hacks 13.0 sponsor. It is a platform where an agent builds and hosts small apps for you, not a mapping company. Its own 2D pin map image sits behind a 3-hour signed Firebase Storage link that is issued per viewer.

## Other sources found

| Source | What it is | Coverage | Get it |
| --- | --- | --- | --- |
| https://live.calhacks.io/ | Cal Hacks 12.0 live site (Oct 24-26, 2025, same venue) | 2025 event layout. Images: `/_next/image?url=%2Ffloor%201%20updated.jpg&w=3840&q=75`, `/overvie%201.svg`, `/VENUE%20MAP%20CLEAN%202%201.svg` | Public GET. The SVGs are vector. |
| https://docs.google.com/document/d/1hUP32KVmNlEIQtwdseI-kiUl2lKQmtKm9zpJ6VZsiPw/mobilebasic | 12.0 Hacker Guide | Main Floor, Mezzanine and Area images from 2025, 650 px wide | Public |
| https://palaceoffinearts.com/wp-content/uploads/sites/4/2025/04/PFA-Master-Floorplan.pdf | Venue master floor plan (2025) | Empty venue: first floor, mezzanine, parking, with door sizes, ceiling heights and power ratings | Direct PDF |
| https://palaceoffinearts.com/wp-content/uploads/sites/4/2024/09/Palace-of-Fine-Arts-Floor-Plan.pdf | Venue floor plan (2024) | First floor, mezzanine, parking | Direct PDF |
| https://my.matterport.com/show/?m=ozYMY8PADUi | Matterport 3D tour, "Palace Of Fine Arts - Matterport 3D Showcase" | The page doesn't say whether it covers the hall interior | Viewer only. Matterport sells the export as MatterPak (OBJ mesh, point cloud). |
| https://tourmkr.com/F13VvEFzXc | 360° photo tour, linked from palaceoffinearts.com/tour | Entrance, Broadway 1-3, Mezzanine, Atrium, Breakout Rooms 1-4 and 6 | Viewer only |
| https://sketchfab.com/3d-models/palace-of-fine-arts-san-francisco-ca-a5e91dea48804b6c901d64483eb25b81 | 3D mesh by Azad Balabanian, 711k triangles | Exterior only (dome, colonnade, lagoon) | Downloadable, CC BY 4.0 |
| Hackathons @ Berkeley app (iOS id6761351929, Android `io.calhacks.hive`) | Official companion app. Its store listing says "Venue maps and linked event locations". | 13.0 | Not inspected |

No Polycam, Luma or Sketchfab scan of the hall interior turned up. Cal Hacks 11.0 (2024) was at the Metreon, so its maps don't apply.

## Getting it through Bright Data next time

The current import (`crates/bandit-ingest`) talks to Bright Data's hosted MCP server with `BRIGHTDATA_API_TOKEN`. It calls only `scrape_as_markdown` (Web Unlocker) for each `pages[]` entry in `events/calhacks-13/sources.json`, plus the LinkedIn and Crunchbase datasets.

1. **Location list (no new code).** Add `{"source": "venue_map", "kind": "venue_map", "url": "https://hive.hackberkeley.org/venue-map"}` to `pages[]`. The page is server-rendered, so `scrape_as_markdown` returns all 374 named locations with their floors. This is public, live web data, which fits the Bright Data track rules (as quoted in other teams' copies of the hacker guide; the original guide wasn't checked). Cost: Web Unlocker is $1.5 per 1,000 requests.
2. **Plan images and pin coordinates.** palace-interior is a single-page app, so it needs Bright Data's Browser API. `scraping_browser_navigate` followed by `scraping_browser_network_requests` lists the asset URLs. The asset names are hashed (for example `livePins-CVXzDC99.js`) and change on each deploy, so they have to be found again on every run. Then save each file. Two gaps first: the repo's MCP client keeps only text results, so images need a binary save path (base64, or a short Playwright script on a Browser API zone with its own credentials env var), and no MCP tool returns response bodies. Cost: Browser API is $8/GB pay-as-you-go.
3. **Not through Bright Data:** Mana's pin map. It needs a signed-in viewer, Mana's terms ban scraping, and the Bright Data track wants public data with no login.
