# Venue 3D model: source and Bright Data chain

Checked 2026-10-24. Every request below was made through Bright Data and logged with its status, size and sha256.

## Devpost citation

The 3D venue model comes from the official Cal Hacks 13.0 venue map (hive.hackberkeley.org/venue-map, Hackathons at Berkeley), which builds the hall in three.js from the Palace of Fine Arts floor plans published by its operator, Non Plus Ultra. We used Bright Data's Web Unlocker, SERP search and Browser API to trace those sources and export the live scene to a glTF model.

## What the model is

`web/venue/venue.glb` (12,218,964 bytes, sha256 `3b87850261863911a1f24a9c9cc4873381257e2fbcce3bc13613492c52abca60`), PR #24 into vik-e2e. A copy is `venue.glb` next to this file. It is not a scan. The official Cal Hacks venue map builds the hall in three.js r186 from the organizers' floor plans, and Bright Data's Browser API exported that live scene to glTF binary.

- glTF 2.0 binary, generator THREE.GLTFExporter r186
- One mesh per material in world coordinates: 106 nodes, 106 meshes, 106 materials, 15 PNG textures, 115,389 triangles, no lights and no instancing
- Table numbers included: the site picks each table's number from an atlas in a shader, so the export bakes each table's cell into its UVs (304 number quads)
- Extensions: KHR_materials_unlit, KHR_materials_emissive_strength
- Bounding box x −106.92…107.01, y −0.41…16.12, z −45.51…51.18 (meters, y up)
- `hive/locations.json` (on Viktor's Mac under `var/venue-3d/brightdata/`) places all 374 named locations in this frame

It matches the earlier Chrome export of the same scene: same counts, bounds and triangle count, and renders differ on under 0.5% of pixels. `renders/brightdata-close.png` and `renders/chrome-export-*.png` show both.

## Chain of requests

WU = Web Unlocker API (POST api.brightdata.com/request, zone `bandit_web_unlocker`, raw unless noted). MCP = Bright Data MCP server. BA = Browser API over CDP (zone `mcp_browser`). Status is the target's `x-brd-status-code`.

1. WU https://hive.hackberkeley.org/venue-map: 200, 453,551 bytes, sha256 `65ca821c…a635ac699`. Official Cal Hacks 13.0 page (Vercel team hackathons-at-berkeley). Embeds https://palace-interior.vercel.app/?view=3d&embed=1 ("3D venue map") and server-renders 374 locations with ids and normalized x/y.
   - Markdown of the same URL: 200, 15,281 bytes. "374 locations across all floors".
2. WU https://auth.hackberkeley.org/storage/v1/object/public/ai-4.0-map-images/maps/main-floor-1792698781410.png: 200, 2,438,585 bytes. The organizers' main-floor map in their own storage bucket, byte-identical to palace-interior's `/venue-map-main-floor.png`.
   - WU `…/maps/mezzanine-1792663357117.png`: 200, 805,217 bytes. Byte-identical to `/venue-map-mezzanine.png`.
3. WU https://palace-interior.vercel.app/: 200, 499 bytes. Vite app "Palace of Fine Arts · Cal Hacks 13".
4. WU `/assets/livePins-CVXzDC99.js`: 200, 253,110 bytes. The layout data: walls, rooms, doors, entrances, hacker and sponsor tables, stage, labels, and the plan-to-scene transform (0.0875 scene units per plan pixel).
5. WU `/assets/App-DvOrdjh9.js`: 200, 998,963 bytes. three.js r186 and react-three-fiber. It extrudes the layout. No .glb, .gltf, .splat, .ply or .spz is referenced.
6. WU the 2 plan JPGs, 2 map PNGs and the backdrop: 200 each. The plans carry a Palace of Fine Arts / Non Plus Ultra title block ("3601 LYON ST.") with the Cal Hacks sponsor table key drawn on.
7. All 13 Bright Data copies match the earlier direct download in `pipeline/data/venue/palace-interior/` by sha256.
8. WU robots.txt, sitemap.xml, manifest.json, README.md, package.json and the three .js.map files: all 404. No source maps, repo or author credit is published.
9. MCP `scraping_browser_navigate` + `scraping_browser_network_requests`: 11 requests. The live-pin call to the organizers' `get_map_screen_data` RPC is built with a quoted base URL and returns 404, so live pins never load on the site.
10. MCP `search_engine` for the Palace of Fine Arts event floor plan: finds the operator's master floor plan (row 11).
11. WU https://palaceoffinearts.com/wp-content/uploads/sites/4/2025/04/PFA-Master-Floorplan.pdf: 200, 8,655,141 bytes. The operator's first-floor plan, managed by Non Plus Ultra. Same outline and room names as the Cal Hacks plans. The Cal Hacks images are an annotated copy of the operator's event drawing, not this exact page.
12. BA `pipeline/venue_model.py` on https://palace-interior.vercel.app/: one CDP session, 17.2 s. An init script stands in for the three.js devtools hook and catches the Scene. Inside Bright Data's browser, the scene is flattened to one mesh per material with the table numbers baked in, GLTFExporter r186 exports it, and the GLB comes back in 3 MB base64 slices.

Not called: the organizers' `get_map_screen_data` RPC directly.

## Rerun

`python3 pipeline/venue_model.py --assets` with `BRIGHTDATA_CUSTOMER_ID`, `BRIGHTDATA_BROWSER_ZONE` and `BRIGHTDATA_BROWSER_PASSWORD` in `.env`.
