# Bright Data venue map report

Checked 2026-10-24. Every request went through the project's Bright Data account: Web Unlocker (zone `bandit_web_unlocker`), the Bright Data MCP server, and the Browser API over CDP (zone `mcp_browser`). In total that was 55 Web Unlocker requests (2 failed in transit), 18 MCP calls and 2 Browser API sessions. The raw outputs (97 files, 66 MB) are on Viktor's Mac under `var/venue-3d/brightdata/`, with every request in `log.md`.

## Result: the 3D venue model was obtained through Bright Data

- Bright Data's Browser API exported the official Cal Hacks venue map's live three.js scene to a GLB: 12,218,964 bytes, glTF 2.0, 106 meshes, 115,389 triangles, 304 table-number quads, 15 textures, meters, no lights.
- `pipeline/venue_model.py` builds it in about 17 seconds. The file is committed as `web/venue/venue.glb` in PR #24 into vik-e2e.
- It matches the earlier Chrome export of the same scene, with the same counts, bounding box and triangles. The renders agree.
- Source chain: hive.hackberkeley.org/venue-map → palace-interior.vercel.app → the layout data in its JS bundle and the organizers' map images → the Palace of Fine Arts floor plans published by Non Plus Ultra. `SOURCE.md` has every link with sizes and hashes, plus the Devpost citation.
- No source has a scan of the exhibition hall's interior (splat, PLY or GLB). The only 3D captures of the Palace show the exterior (Matterport and Sketchfab, below).

## By source

| Source | Bright Data result | What it has |
| --- | --- | --- |
| hive.hackberkeley.org/venue-map | 200, raw and markdown | Official Cal Hacks 13.0 venue map. Embeds palace-interior.vercel.app and lists 374 locations, now in `hive/locations.json` with floor, category, ids and positions in the GLB's frame. It's in the import's sources too. |
| auth.hackberkeley.org map images (organizers' storage) | 200 | Main floor and mezzanine maps, byte-identical to palace-interior's map images. |
| palace-interior.vercel.app and its 13 files | 200 each | The 3D map. All 13 files match the earlier direct download by sha256. robots, sitemap, package.json and source maps are 404, so no repo or author is published. |
| Browser API via `pipeline/venue_model.py` | Done in 17.2 s | The GLB above. |
| mana.space order page | 200, app shell only | The page is an empty app shell; the pin map needs sign-in and robots.txt disallows /home/. Stopped there. |
| calhacks.io | 200 | The venue section is only the address and a Google Maps link. |
| live.calhacks.io (Cal Hacks 12.0) | 200 | Three map images of last year's layout. |
| palaceoffinearts.com | 200 | The master floor plan PDF (8.7 MB), the base of the Cal Hacks plans, and a venue presentation PDF. `/info/` timed out. |
| palaceoffinearts.com/tour | 200 | A TourMkr 360° photo tour, not a 3D model. |
| Matterport model ozYMY8PADUi | 200 | Exterior only: colonnade, rotunda, landscape and pond. |
| Sketchfab a5e91dea48804b6c901d64483eb25b81 | 200 | Rotunda exterior by Azad Balabanian. Its download needs a signed-in account, so it wasn't fetched. |
| Bright Data search (8 queries) | 200 | Found the venue floor plan PDF. Nothing turned up for palace-interior or for a scan of the interior. |

## What failed and why

- Not attempted: the organizers' live-pin RPC (`get_map_screen_data`). The site's own call to it is broken anyway: it returns 404, so live pins never load on the map.
- Bright Data errors: palaceoffinearts.com/info/ (502 navigation timeout), palace-interior package.json (502 on the first try), the mana.space screenshot (connection reset), and a venue deck PDF (timed out once, then fetched).
- Sign-in or robots: the mana.space pin map and the Sketchfab download. No captcha came up.

## Rerun

`python3 pipeline/venue_model.py --assets` writes a fresh `web/venue/venue.glb`. It needs `BRIGHTDATA_CUSTOMER_ID`, `BRIGHTDATA_BROWSER_ZONE` and `BRIGHTDATA_BROWSER_PASSWORD` in `.env` (already added) and Playwright, which is installed in `var/venv` on Viktor's Mac.
