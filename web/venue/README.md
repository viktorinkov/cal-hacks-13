# Venue model

`venue.glb` is the Palace of Fine Arts hall laid out for Cal Hacks 13: floors, walls, rooms, the mezzanine, hacker and sponsor tables, chairs and table numbers.
It is exported through Bright Data's Browser API by `pipeline/venue_model.py` from the Cal Hacks venue map (hive.hackberkeley.org/venue-map, which embeds palace-interior.vercel.app), with three r186. Units are meters, y is up.
Rerun it with `python3 pipeline/venue_model.py --assets`.
Load it with three.js: `const gltf = await new GLTFLoader().loadAsync('venue.glb'); scene.add(gltf.scene);` It has no lights, so add your own.
`index.html` previews it with OrbitControls. Serve this folder over HTTP and open the page.
