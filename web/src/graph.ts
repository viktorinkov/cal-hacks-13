// The event graph for the big screen, in 3D: people, booths, companies and the event photos. Links come live
// from the anonymous `event_graph` view; each photo and the people in it come from the staff view
// `board_photos`, so a memory floats among the people it caught together. People stay anonymous here.
// Clusters colour by kind, by memories (communities over time together, booth visits and shared photos) or
// by company. A new link or photo flashes as it arrives, and a click shows what a node links to.

import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph';
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import * as THREE from 'three';
import { date, h } from './lib';
import type { DbConnection } from './module_bindings';
import type { BoardPhoto } from './module_bindings/types';

type Kind = 'person' | 'booth' | 'company' | 'photo';
type Mode = 'kind' | 'memories' | 'company';
type GNode = {
  id: string; kind: Kind; label: string; born: number; photo?: BoardPhoto;
  x?: number; y?: number; z?: number; fx?: number; fy?: number; fz?: number;
};
type GLink = { id: string; kind: string; source: string | GNode; target: string | GNode; weight: number; born: number };

const KIND_COLOURS: Record<Kind, string> = { person: '#c3c8d0', booth: '#4c8dff', company: '#f5a623', photo: '#ffffff' };
const NODE_VALS: Record<Kind, number> = { person: 1, booth: 6, company: 16, photo: 1 };
const LINK_COLOURS: Record<string, string> = { met: '#ff5c8a', visited: '#6f9bff', works_at: '#3ecf8e', exhibits: '#f5c26b', in_photo: '#c77dff' };
const LINK_NAMES: Record<string, string> = { met: 'met (minutes together)', visited: 'visited booth', works_at: 'works at', exhibits: 'exhibits', in_photo: 'in the photo' };
const LINK_LENGTHS: Record<string, number> = { met: 14, visited: 34, works_at: 26, exhibits: 20, in_photo: 16 };
/** Colours for the biggest clusters; smaller clusters are grey. */
const PALETTE = ['#e6194b', '#3cb44b', '#ffe119', '#42d4f4', '#f58231', '#911eb4', '#4363d8', '#f032e6', '#bfef45', '#fabed4'];
const SMALL = '#5c6370';
const DIM = '#262b35';
const BACKGROUND = '#0b1020';
/** A link or photo that just arrived stays highlighted this long. */
const FRESH_MS = 6000;
/** The live rows are read this often; the layout takes new links at most every STRUCTURE_MS, new photos at once. */
const FLUSH_MS = 1500;
const STRUCTURE_MS = 5000;
/** After new nodes arrive the old ones hold still this long, so only the newcomers find their place. */
const PIN_MS = 2500;
const PHOTO_SIZE = 36;
const ROTATE_AFTER_MS = 15000;

let fg: ForceGraph3DInstance | undefined;
let conn: DbConnection;
let box: HTMLElement;
let bar: HTMLElement;
let legend: HTMLElement;
let card: HTMLElement;
let mode: Mode = 'kind';
let showPhotos = true;
let nodes = new Map<string, GNode>();
let links = new Map<string, GLink>();
let adjacent = new Map<string, GLink[]>();
/** The cluster of each node in the current mode, and each cluster's colour and legend line. */
const groups = new Map<string, string>();
const groupColours = new Map<string, string>();
let groupLegend: [string, string][] = [];
let selected: GNode | undefined;
let near = new Set<string>();
let dirty = true;
let photosChanged = false;
let lastStructure = 0;
let unpin: ReturnType<typeof setTimeout> | undefined;
let lastTouch = 0;
let paused = false;
/** Photo pictures and company names, by node, so a redraw or a selection can reach them. */
const sprites = new Map<string, THREE.Sprite>();
const names = new Map<string, THREE.Sprite>();

const end = (x: string | GNode) => (typeof x === 'string' ? x : x.id);
const other = (l: GLink, id: string) => (end(l.source) === id ? end(l.target) : end(l.source));
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const jitter = () => Math.random() * 10 - 5;

function label(kind: string, id: bigint): string {
  if (kind === 'booth') return conn.db.booth.id.find(id)?.name ?? 'booth';
  if (kind === 'company') return conn.db.organization.id.find(id)?.name ?? 'company';
  return '';
}

// --- Rows to nodes and links --------------------------------------------------------------------

/** Rebuilds the nodes and links from the subscribed rows, keeping each node's object and position. */
function rebuild() {
  const now = performance.now();
  const born = nodes.size ? now : 0;
  const nextNodes = new Map<string, GNode>();
  const nextLinks = new Map<string, GLink>();
  const node = (kind: Kind, id: bigint, nearKey?: string) => {
    const key = `${kind}:${id}`;
    let n = nextNodes.get(key) ?? nodes.get(key);
    if (!n) {
      // A new node starts next to the node it links to, so the layout does not jump.
      const at = nearKey ? nextNodes.get(nearKey) ?? nodes.get(nearKey) : undefined;
      n = { id: key, kind, label: label(kind, id), born };
      if (at?.x !== undefined) Object.assign(n, { x: at.x + jitter(), y: at.y! + jitter(), z: at.z! + jitter() });
    }
    nextNodes.set(key, n);
    return key;
  };
  const link = (id: string, kind: string, from: string, to: string, weight: number) => {
    const l = links.get(id) ?? { id, kind, source: from, target: to, weight, born };
    l.weight = weight;
    nextLinks.set(id, l);
  };
  for (const l of conn.db.eventGraph.iter()) {
    const to = `${l.toKind}:${l.toId}`;
    const from = node(l.fromKind as Kind, l.fromId, to);
    node(l.toKind as Kind, l.toId, from);
    link(String(l.id), l.kind, from, to, l.weight);
  }
  if (showPhotos) {
    for (const p of conn.db.boardPhotos.iter()) {
      if (!p.nodeIds.length) continue;
      const key = node('photo', p.id, `person:${p.nodeIds[0]}`);
      nextNodes.get(key)!.photo = p;
      for (const id of p.nodeIds) link(`photo:${p.id}:${id}`, 'in_photo', key, node('person', id, key), 1);
    }
  }
  const changed = nextNodes.size !== nodes.size || nextLinks.size !== links.size
    || [...nextLinks.keys()].some(k => !links.has(k)) || [...nextNodes.keys()].some(k => !nodes.has(k));
  if (!changed) return;
  if (born && !photosChanged && now - lastStructure < STRUCTURE_MS) { dirty = true; return; }
  const old = nodes;
  nodes = nextNodes;
  links = nextLinks;
  lastStructure = now;
  photosChanged = false;
  adjacent = new Map();
  for (const l of links.values()) {
    for (const id of [end(l.source), end(l.target)]) {
      if (!adjacent.has(id)) adjacent.set(id, []);
      adjacent.get(id)!.push(l);
    }
  }
  if (selected && !nodes.has(selected.id)) selected = undefined;
  if (selected) near = new Set([selected.id, ...(adjacent.get(selected.id) ?? []).map(l => other(l, selected!.id))]);
  // The old nodes hold still while the newcomers settle next to them.
  if (born) {
    for (const n of old.values()) if (nodes.has(n.id) && n.x !== undefined) Object.assign(n, { fx: n.x, fy: n.y, fz: n.z });
    clearTimeout(unpin);
    unpin = setTimeout(() => { for (const n of nodes.values()) n.fx = n.fy = n.fz = undefined; }, PIN_MS);
  }
  cluster();
  fg!.graphData({ nodes: [...nodes.values()], links: [...links.values()] });
  restyle();
  const arrived = [...links.values()].filter(l => l.born === now);
  if (arrived.length) setTimeout(() => arrived.slice(0, 300).forEach(l => fg?.emitParticle(l)), 400);
  for (const n of nodes.values()) if (n.born === now && n.kind === 'photo') grow(sprites.get(n.id));
}

// --- Clusters ---------------------------------------------------------------------------------

/** A fixed random generator, so the same links give the same clusters each time. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Groups the nodes for the current mode and gives the biggest groups a colour that stays with them. */
function cluster() {
  groups.clear();
  const named = new Map<string, string>();
  if (mode === 'company') {
    for (const l of links.values()) if (l.kind === 'works_at' || l.kind === 'exhibits') groups.set(end(l.source), end(l.target));
    for (const n of nodes.values()) if (n.kind === 'company') { groups.set(n.id, n.id); named.set(n.id, n.label); }
  } else if (mode === 'memories') {
    const g = new Graph({ type: 'undirected' });
    for (const l of links.values()) {
      if (l.kind !== 'met' && l.kind !== 'visited' && l.kind !== 'in_photo') continue;
      const [a, b] = [end(l.source), end(l.target)];
      g.mergeNode(a);
      g.mergeNode(b);
      // A shared photo counts like half an hour together.
      const w = l.kind === 'in_photo' ? 30 : Math.max(1, l.weight);
      g.updateEdge(a, b, e => ({ weight: (e.weight ?? 0) + w }));
    }
    if (g.size) {
      const parts = louvain(g, { getEdgeWeight: 'weight', rng: seeded(13) });
      // Each community is named after the booth its people spent the most minutes at, which also keeps its colour.
      const best = new Map<number, [string, number]>();
      for (const l of links.values()) {
        if (l.kind !== 'visited') continue;
        const booth = end(l.target);
        const c = parts[end(l.source)];
        if (c !== parts[booth]) continue;
        const b = best.get(c);
        if (!b || l.weight > b[1]) best.set(c, [booth, l.weight]);
      }
      for (const [id, c] of Object.entries(parts)) {
        const anchor = best.get(c)?.[0] ?? `group:${c}`;
        groups.set(id, anchor);
        if (!named.has(anchor)) named.set(anchor, nodes.get(anchor)?.label ? `around ${nodes.get(anchor)!.label}` : 'a group');
      }
    }
  }
  const people = new Map<string, number>();
  for (const [id, g] of groups) if (id.startsWith('person:')) people.set(g, (people.get(g) ?? 0) + 1);
  const ranked = [...people.entries()].sort((a, b) => b[1] - a[1]).slice(0, PALETTE.length);
  const keep = new Set(ranked.map(([g]) => g));
  for (const g of [...groupColours.keys()]) if (!keep.has(g)) groupColours.delete(g);
  for (const [g] of ranked) {
    if (groupColours.has(g)) continue;
    const used = new Set(groupColours.values());
    groupColours.set(g, PALETTE.find(c => !used.has(c)) ?? SMALL);
  }
  groupLegend = ranked.map(([g, count]) => [groupColours.get(g)!, `${named.get(g) ?? 'a group'} (${count} ${count === 1 ? 'person' : 'people'})`]);
}

// --- Drawing ----------------------------------------------------------------------------------

function nodeColour(n: GNode): string {
  if (selected && !near.has(n.id)) return DIM;
  if (mode === 'kind') return KIND_COLOURS[n.kind];
  const g = groups.get(n.id);
  return (g && groupColours.get(g)) || (n.kind === 'person' ? SMALL : KIND_COLOURS[n.kind]);
}

const touches = (l: GLink) => !!selected && (end(l.source) === selected.id || end(l.target) === selected.id);
const fresh = (l: GLink, now: number) => l.born > 0 && now - l.born < FRESH_MS;

/** Applies the colours, widths and particles again, after a mode, selection or freshness change. */
function restyle() {
  if (!fg) return;
  const now = performance.now();
  fg.nodeColor(n => nodeColour(n as GNode))
    .linkColor(l => {
      const k = l as GLink;
      if (selected) return touches(k) ? LINK_COLOURS[k.kind] : DIM;
      return fresh(k, now) ? '#ffffff' : LINK_COLOURS[k.kind] ?? '#888';
    })
    .linkWidth(l => (fresh(l as GLink, now) ? 1.2 : touches(l as GLink) ? 0.6 : 0))
    .linkDirectionalParticles(l => (touches(l as GLink) ? 3 : 0));
  for (const [id, s] of [...sprites, ...names]) s.material.opacity = !selected || near.has(id) ? 1 : 0.12;
  drawLegend();
  drawCard();
}

/** A photo as a framed picture that always faces the camera. */
function photoSprite(url: string): THREE.Sprite {
  const material = new THREE.SpriteMaterial({ color: '#ffffff', transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(PHOTO_SIZE * 4 / 3, PHOTO_SIZE, 1);
  const img = new Image();
  img.onload = () => {
    const side = 256, pad = 10;
    const wide = img.width >= img.height;
    const w = wide ? side : Math.round(side * img.width / img.height);
    const hgt = wide ? Math.round(side * img.height / img.width) : side;
    const c = document.createElement('canvas');
    c.width = w + 2 * pad;
    c.height = hgt + 2 * pad;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, pad, pad, w, hgt);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    material.map = texture;
    material.needsUpdate = true;
    const full = sprite.userData.full = [PHOTO_SIZE * c.width / c.height, PHOTO_SIZE];
    if (!sprite.userData.growing) sprite.scale.set(full[0], full[1], 1);
  };
  img.src = url;
  return sprite;
}

/** A photo that just arrived grows into place. */
function grow(sprite: THREE.Sprite | undefined) {
  if (!sprite) return;
  const start = performance.now();
  sprite.userData.growing = true;
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / 900);
    const k = 1 - Math.pow(1 - t, 3);
    const [w, hgt] = sprite.userData.full ?? [PHOTO_SIZE * 4 / 3, PHOTO_SIZE];
    sprite.scale.set(w * k * (1 + 0.3 * Math.sin(t * Math.PI)), hgt * k * (1 + 0.3 * Math.sin(t * Math.PI)), 1);
    if (t < 1) requestAnimationFrame(step);
    else sprite.userData.growing = false;
  };
  step();
}

/** A company's name, floating above its node. */
function nameSprite(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = '600 40px -apple-system, "Segoe UI", sans-serif';
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(text).width) + 12;
  c.height = 52;
  ctx.font = font;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 6, 27);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  s.scale.set(8 * c.width / c.height, 8, 1);
  s.position.y = 18;
  return s;
}

function nodeObject(n: GNode): THREE.Object3D | null {
  if (n.kind === 'photo') {
    if (!sprites.has(n.id)) sprites.set(n.id, photoSprite(n.photo!.url));
    return sprites.get(n.id)!;
  }
  if (n.kind !== 'company' || !n.label) return null;
  if (!names.has(n.id)) names.set(n.id, nameSprite(n.label));
  return names.get(n.id)!;
}

/** What a node is and what it links to, for the tooltip and the card. */
function describe(n: GNode): string {
  const mine = adjacent.get(n.id) ?? [];
  const count = (kind: string) => mine.filter(l => l.kind === kind).length;
  if (n.kind === 'photo' && n.photo) {
    const p = n.photo;
    return `<img src="${esc(p.url)}" alt=""><b>${esc(p.caption || 'Event photo')}</b><br>${esc(p.zoneName)}, ${esc(date(p.takenAt))}<br>${p.nodeIds.length} ${p.nodeIds.length === 1 ? 'person' : 'people'} in it`;
  }
  if (n.kind === 'person') {
    const company = mine.find(l => l.kind === 'works_at');
    const at = company ? ` at ${esc(nodes.get(end(company.target))?.label ?? 'a company')}` : '';
    return `<b>Someone${at}</b><br>met ${count('met')} people, visited ${count('visited')} booths, in ${count('in_photo')} photos`;
  }
  if (n.kind === 'booth') return `<b>${esc(n.label)}</b><br>booth, ${count('visited')} visitors`;
  return `<b>${esc(n.label)}</b><br>company, ${count('works_at')} people work here, ${count('exhibits')} booths`;
}

function drawCard() {
  card.innerHTML = selected ? describe(selected) : '';
  card.style.display = selected ? '' : 'none';
}

function drawLegend() {
  const kinds = mode === 'kind'
    ? (Object.keys(KIND_COLOURS) as Kind[]).map(k => h('span', {}, h('i', { class: k === 'photo' ? 'dot photo' : 'dot', style: `background:${KIND_COLOURS[k]}` }), k))
    : groupLegend.map(([c, text]) => h('span', {}, h('i', { class: 'dot', style: `background:${c}` }), text));
  const lines = Object.entries(LINK_COLOURS).map(([kind, c]) => h('span', {}, h('i', { style: `background:${c}` }), LINK_NAMES[kind]));
  legend.replaceChildren(
    h('div', {}, mode === 'memories' && !groupLegend.length ? 'No memories yet.' : kinds),
    h('div', {}, lines));
}

function drawBar() {
  const button = (m: Mode, text: string) =>
    h('button', { class: m === mode ? 'on' : '', onclick: () => { mode = m; cluster(); restyle(); drawBar(); } }, text);
  bar.replaceChildren(
    'Colour by ', button('kind', 'Kind'), button('memories', 'Memories'), button('company', 'Company'), ' ',
    h('label', { class: 'check inline' }, h('input', { type: 'checkbox', checked: showPhotos,
      onchange: (e: Event) => { showPhotos = (e.target as HTMLInputElement).checked; photosChanged = true; rebuild(); } }), 'Photos'),
    h('button', { onclick: () => fit() }, 'Fit'),
    h('button', { onclick: () => box.requestFullscreen?.() }, 'Full screen'));
}

/** Turns the camera on the middle of the graph, close enough that the crowd fills the view. */
function fit(ms = 800) {
  const placed = [...nodes.values()].filter(n => n.x !== undefined);
  if (!fg || !placed.length) return;
  const c = { x: 0, y: 0, z: 0 };
  for (const n of placed) { c.x += n.x! / placed.length; c.y += n.y! / placed.length; c.z += n.z! / placed.length; }
  // The few nodes furthest out may sit outside the view.
  const far = placed.map(n => Math.hypot(n.x! - c.x, n.y! - c.y, n.z! - c.z)).sort((a, b) => a - b);
  const r = far[Math.floor(far.length * 0.95)] || 50;
  const camera = fg.camera() as THREE.PerspectiveCamera;
  const half = Math.min(camera.fov, camera.fov * camera.aspect) / 2 * Math.PI / 180;
  const at = fg.cameraPosition();
  const dir = new THREE.Vector3(at.x - c.x, at.y - c.y, at.z - c.z).normalize();
  const d = r / Math.sin(half);
  fg.cameraPosition({ x: c.x + dir.x * d, y: c.y + dir.y * d, z: c.z + dir.z * d }, c, ms);
}

/** Selects a node: the camera flies to it, its links light up and everything else dims. */
function select(n: GNode | undefined) {
  selected = n;
  near = new Set(n ? [n.id, ...(adjacent.get(n.id) ?? []).map(l => other(l, n.id))] : []);
  lastTouch = performance.now();
  if (n && fg && n.x !== undefined) {
    const distance = n.kind === 'photo' ? 90 : 110;
    const r = Math.hypot(n.x, n.y!, n.z!) || 1;
    const k = 1 + distance / r;
    fg.cameraPosition({ x: n.x * k, y: n.y! * k, z: n.z! * k }, { x: n.x, y: n.y!, z: n.z! }, 1200);
  }
  restyle();
}

function setup(c: DbConnection) {
  conn = c;
  box = h('div', { class: 'graph' });
  card = h('div', { class: 'graph-card' });
  bar = h('p', { class: 'graph-bar' });
  legend = h('div', { class: 'legend' });
  fg = new ForceGraph3D(box, { controlType: 'orbit' })
    .backgroundColor(BACKGROUND)
    .showNavInfo(false)
    .nodeId('id')
    .nodeVal(n => NODE_VALS[(n as GNode).kind])
    .nodeRelSize(4)
    .nodeResolution(8)
    .nodeOpacity(0.95)
    .nodeLabel(n => `<div class="graph-tip">${describe(n as GNode)}</div>`)
    .nodeThreeObject(n => nodeObject(n as GNode) as THREE.Object3D)
    .nodeThreeObjectExtend(n => (n as GNode).kind !== 'photo')
    .linkOpacity(0.2)
    .linkDirectionalParticleWidth(1.8)
    .linkDirectionalParticleSpeed(0.008)
    .linkDirectionalParticleColor(l => (LINK_COLOURS[(l as GLink).kind] ?? '#fff'))
    .d3AlphaDecay(0.03)
    .d3VelocityDecay(0.45)
    .cooldownTime(12000)
    .onNodeClick(n => select(n === selected ? undefined : (n as GNode)))
    .onBackgroundClick(() => select(undefined));
  (fg.d3Force('link') as any)?.distance((l: GLink) => LINK_LENGTHS[l.kind] ?? 30);
  (fg.d3Force('charge') as any)?.strength(-45).distanceMax(500);
  box.append(card);
  const controls = fg.controls() as { autoRotate: boolean; autoRotateSpeed: number };
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;
  for (const e of ['pointerdown', 'wheel']) box.addEventListener(e, () => { lastTouch = performance.now(); controls.autoRotate = false; });
  new ResizeObserver(() => { if (box.clientWidth) fg?.width(box.clientWidth).height(box.clientHeight); }).observe(box);
  let fitted = false;
  fg.onEngineStop(() => { if (!fitted) { fitted = true; if (!selected) fit(); } });
  const mark = () => { dirty = true; };
  conn.db.eventGraph.onInsert(mark);
  conn.db.eventGraph.onUpdate(mark);
  conn.db.eventGraph.onDelete(mark);
  const photo = () => { dirty = true; photosChanged = true; };
  conn.db.boardPhotos.onInsert(photo);
  conn.db.boardPhotos.onDelete(photo);
  setInterval(() => {
    // The drawing stops while another tab is open.
    if (!box.isConnected) { if (!paused) { fg?.pauseAnimation(); paused = true; } return; }
    if (paused) { fg?.resumeAnimation(); paused = false; }
    const now = performance.now();
    if (dirty) { dirty = false; rebuild(); }
    if ([...links.values()].some(l => l.born > 0 && now - l.born < FRESH_MS + FLUSH_MS && now - l.born >= FRESH_MS)) restyle();
    if (!selected && now - lastTouch > ROTATE_AFTER_MS) controls.autoRotate = true;
  }, FLUSH_MS);
  drawBar();
  rebuild();
  restyle();
}

/** The Event graph tab. The drawing keeps its elements across the portal's redraws. */
export function graphTab(c: DbConnection) {
  if (!fg) setup(c);
  const count = (kind: Kind) => [...nodes.values()].filter(n => n.kind === kind).length;
  return h('section', {},
    h('h3', {}, 'Event graph'),
    h('p', { class: 'muted' }, `Live from SpacetimeDB: ${count('person')} people, ${count('booth')} booths, ${count('company')} companies, ${count('photo')} photos, ${links.size} links. People are anonymous on this screen. Drag to turn, scroll to zoom, click anything to see what it links to.`),
    bar, box, legend);
}

/** Opens a photo in the graph: the camera flies to it and the people in it light up. */
export function showPhotoInGraph(photoId: bigint, tries = 10) {
  const n = nodes.get(`photo:${photoId}`);
  // A graph opened just now has no positions yet; the camera waits for the first layout ticks.
  if (n?.x === undefined && tries > 0) setTimeout(() => showPhotoInGraph(photoId, tries - 1), 300);
  else if (n) select(n);
}
