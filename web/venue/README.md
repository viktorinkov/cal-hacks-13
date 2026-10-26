# Venue model

`venue.glb` is the Palace of Fine Arts hall laid out for Cal Hacks 13: floors, walls, rooms, the mezzanine, hacker and sponsor tables, chairs and table numbers.
It is exported through Bright Data's Browser API by `pipeline/venue_model.py` from the Cal Hacks venue map (hive.hackberkeley.org/venue-map, which embeds palace-interior.vercel.app), with three r186. Units are meters, y is up.
Rerun it with `python3 pipeline/venue_model.py --assets`.
Load it with three.js: `const gltf = await new GLTFLoader().loadAsync('venue.glb'); scene.add(gltf.scene);` It has no lights, so add your own.
`index.html` previews it with OrbitControls. Serve this folder over HTTP and open the page.

Any other venue: the organizer types the event's name on the portal's Venue setup tab. bandit-workers searches for the event through Bright Data, Claude picks the event site, the venue and its public 3D map among the results and their links, and `pipeline/venue_model.py --url <page or .glb/.gltf link> --out <dir>` exports the model (a three.js or Babylon scene, or a glTF file the page loads or links). This model stays the default in the tab's venue dropdown.
