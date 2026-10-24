# Venue model

`venue.glb` is the Palace of Fine Arts hall laid out for Cal Hacks 13: floors, walls, rooms, the mezzanine, hacker and sponsor tables, chairs and table numbers.
It comes from the three.js floor plan scene at palace-interior.vercel.app, exported with three r186. Units are meters, y is up.
Load it with three.js: `const gltf = await new GLTFLoader().loadAsync('venue.glb'); scene.add(gltf.scene);` It has no lights, so add your own.
`index.html` previews it with OrbitControls. Serve this folder over HTTP and open the page.
