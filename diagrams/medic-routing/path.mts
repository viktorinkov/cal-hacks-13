import { readFileSync } from 'node:fs';
import { Floor } from '../../web/src/floor-path.ts';
const root = new URL('../../web/venue/', import.meta.url).pathname;
const f = new Floor(JSON.parse(readFileSync(root + 'floor.json', 'utf8')));
const spots = JSON.parse(readFileSync(root + 'spots.json', 'utf8'));
const doors = spots.filter((s: any) => s.kind === 'exit' || s.kind === 'entrance');
const name = process.argv[2] ?? 'Table 51';
const t = spots.find((s: any) => s.name === name);
const to: [number, number] = [t.x, t.z];
let best: any, d = Infinity;
for (const s of doors) { const e = Math.hypot(s.x - to[0], s.z - to[1]); if (e < d) { d = e; best = s; } }
const door: [number, number] = [best.x, best.z];
const way = f.path(f.snap(door), f.snap(to));
let len = 0; for (let i = 1; i < way.length; i++) len += Math.hypot(way[i][0]-way[i-1][0], way[i][1]-way[i-1][1]);
console.log(JSON.stringify({ name, to, snapped: f.snap(to), door: best, straight: d, clear: f.clear(f.snap(door), f.snap(to)), way, len }));
