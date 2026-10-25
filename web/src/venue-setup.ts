// The Venue tab of the organizer portal. The organizer types the event's name, and a worker finds the
// event's site, its venue and any public 3D map of it, then saves the venue's model; each step shows here
// as it happens. The organizer picks the venue the portal shows. The Cal Hacks 13.0 model at the Palace of
// Fine Arts ships with the app and is the default. The Live tab shows the same 3D view with the hall cut open
// and the crowd in it.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { act, date, field, h, time } from './lib';
import type { DbConnection } from './module_bindings';
import type { VenueSetup } from './module_bindings/types';

/** Setup 0: the venue that ships with the app. */
const DEFAULT_SETUP = 0n;
const DEFAULT = {
  label: 'Cal Hacks 13.0 at the Palace of Fine Arts',
  venueName: 'Palace of Fine Arts',
  address: '3601 Lyon St, San Francisco, CA 94123',
  mapUrl: 'https://hive.hackberkeley.org/venue-map',
  modelUrl: '/venue/venue.glb',
  stats: '106 meshes, 115,389 triangles, 214 × 17 × 97 m',
};

const STATUS: Record<string, string> = { running: 'Working', ready: 'Ready', 'no model': 'No 3D model found', failed: 'Failed' };

let conn: DbConnection;

// --- The 3D view ------------------------------------------------------------------------------

/** On the Live tab everything above this height is cut away, so the mezzanine (its underside is at 4.25 m) and the roof do not hide the crowd. */
const CUT_M = 4.1;
/** The whole-hall view looks down at this angle from the south, with the hall this far inside the canvas. */
const OVERVIEW_PITCH = THREE.MathUtils.degToRad(56);
const FIT_MARGIN_PX = 16;
/** A flight to a spot ends at most this far from it, looking down at this angle. */
const CLOSE_M = 58;
const CLOSE_PITCH = THREE.MathUtils.degToRad(48);
const FLIGHT_MS = 1300;

/** The view and the picker live across redraws, so the model stays loaded and an open dropdown stays open. */
let view: HTMLElement | undefined;
let viewNote: HTMLElement;
let loadedUrl = '';
let load: (url: string) => void;
let renderer: THREE.WebGLRenderer;
let camera: THREE.PerspectiveCamera;
let model: THREE.Object3D | undefined;
let controls: OrbitControls;
/** A camera flight under way, from where the camera was to where it goes. */
let flight: { fromPos: THREE.Vector3; fromTarget: THREE.Vector3; toPos: THREE.Vector3; toTarget: THREE.Vector3; at: number } | undefined;
/** True until someone moves the camera or it flies to a spot: the whole-hall view then follows the canvas's size. */
let home = true;
/** What the Live tab adds: the crowd and the incidents, shown only there. */
const liveLayer = new THREE.Group();
const frames: ((now: number) => void)[] = [];

function makeView() {
  view = h('div', { class: 'venue-3d' });
  viewNote = h('p', { class: 'muted' });
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  view.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#c8effd');
  scene.add(new THREE.HemisphereLight('#ffffff', '#a7abb2', 1.6));
  const sun = new THREE.DirectionalLight('#fff8ee', 2.6);
  scene.add(sun);
  liveLayer.visible = false;
  scene.add(liveLayer);
  camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.5, 2000);
  controls = new OrbitControls(camera, renderer.domElement);
  // Any touch of the controls ends a flight where it is.
  controls.addEventListener('start', () => { flight = undefined; home = false; });
  let asked = 0;

  load = (url: string) => {
    loadedUrl = url;
    const mine = ++asked;
    viewNote.textContent = 'Loading the model…';
    new GLTFLoader().loadAsync(url).then(gltf => {
      if (mine !== asked) return;
      if (model) scene.remove(model);
      model = gltf.scene;
      // Cut open, the walls show their inner faces from above.
      model.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.side = THREE.DoubleSide;
      });
      scene.add(model);
      // Frame the model whatever its size: the camera, its range and the sun scale with it.
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length() || 1;
      camera.near = size / 1000;
      camera.far = size * 10;
      camera.updateProjectionMatrix();
      sun.position.copy(center).add(new THREE.Vector3(-0.2, 0.45, 0.3).multiplyScalar(size));
      overview(false);
      viewNote.textContent = 'Drag to turn, scroll to zoom.';
    }).catch(e => {
      if (mine === asked) viewNote.textContent = `The model did not load: ${e?.message ?? e}`;
    });
  };

  // Draws only while the tab shows the view.
  renderer.setAnimationLoop(() => {
    if (!view!.isConnected) return;
    const w = view!.clientWidth;
    // On the Live tab the venue fills most of the window's height, so it is easy to explore.
    const hgt = liveLayer.visible ? Math.max(360, Math.round(innerHeight * 0.8)) : Math.round(w * 9 / 16);
    if (w && (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) || camera.aspect !== w / hgt)) {
      renderer.setSize(w, hgt);
      camera.aspect = w / hgt;
      camera.updateProjectionMatrix();
      if (home) overview(false);
    }
    if (flight) {
      const f = flight;
      const t = Math.min(1, (performance.now() - f.at) / FLIGHT_MS);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      camera.position.lerpVectors(f.fromPos, f.toPos, e);
      controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
      if (t >= 1) flight = undefined;
    }
    controls.update();
    const now = performance.now();
    for (const f of frames) f(now);
    renderer.render(scene, camera);
  });
}

/** The shared 3D view as the Live tab uses it: cut open at `CUT_M`, with its layer for the crowd shown. */
export type LiveView = {
  view: HTMLElement;
  note: HTMLElement;
  layer: THREE.Group;
  canvas: HTMLCanvasElement;
  /** Runs every frame while the view shows. */
  onFrame(f: (now: number) => void): void;
  /** The point of the floor under a click, in model metres (x east, z south), if it is inside the hall. */
  floorAt(e: MouseEvent): { x: number; z: number } | undefined;
  /** The ray from the camera through the pointer, for picking what is under it. */
  rayAt(e: MouseEvent): THREE.Ray;
  /** Flies the camera to look down at a spot of the floor from close by, from the side it looks from now. */
  lookAt(x: number, z: number): void;
  /** Flies the camera back to the whole hall. */
  overview(): void;
};

function showLive(on: boolean) {
  const cut = liveLayer.visible !== on;
  liveLayer.visible = on;
  renderer.clippingPlanes = on ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), CUT_M)] : [];
  // Cut open, the hall is lower, so the whole-hall view comes closer.
  if (cut && home) overview(false);
}

/** Where the model's box lands on the canvas from a camera at `pos` looking at `target`: its bounds in CSS pixels. */
function bounds(corners: THREE.Vector3[], pos: THREE.Vector3, target: THREE.Vector3, w: number, hgt: number) {
  camera.position.copy(pos);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  const v = new THREE.Vector3();
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of corners) {
    v.copy(p).project(camera);
    const x = ((v.x + 1) / 2) * w;
    const y = ((1 - v.y) / 2) * hgt;
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
  }
  return b;
}

/** The whole hall from the south, as large as it fits in the canvas. */
function overview(fly = true) {
  home = true;
  if (!model) return;
  const box = new THREE.Box3().setFromObject(model);
  if (liveLayer.visible) box.max.y = Math.min(box.max.y, CUT_M);
  const corners = [box.min.x, box.max.x].flatMap(x => [box.min.y, box.max.y].flatMap(y => [box.min.z, box.max.z].map(z => new THREE.Vector3(x, y, z))));
  const w = renderer.domElement.clientWidth || 800;
  const hgt = renderer.domElement.clientHeight || 450;
  const dir = new THREE.Vector3(0, Math.sin(OVERVIEW_PITCH), Math.cos(OVERVIEW_PITCH));
  const target = box.getCenter(new THREE.Vector3()).setY(box.min.y);
  const saved = { pos: camera.position.clone(), target: controls.target.clone() };
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  let d = size;
  // Find the distance that fits, then move the target so the hall sits in the middle; twice, as the move changes the fit.
  for (let round = 0; round < 3; round++) {
    let lo = size / 50;
    let hi = size * 8;
    for (let i = 0; i < 24; i++) {
      d = (lo + hi) / 2;
      const [l, t, r, b] = bounds(corners, target.clone().addScaledVector(dir, d), target, w, hgt);
      if (l >= FIT_MARGIN_PX && t >= FIT_MARGIN_PX && r <= w - FIT_MARGIN_PX && b <= hgt - FIT_MARGIN_PX) hi = d;
      else lo = d;
    }
    d = hi;
    const [l, t, r, b] = bounds(corners, target.clone().addScaledVector(dir, d), target, w, hgt);
    const metresPerPx = (2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / hgt;
    target.x += ((l + r) / 2 - w / 2) * metresPerPx;
    target.z += (((t + b) / 2 - hgt / 2) * metresPerPx) / Math.sin(OVERVIEW_PITCH);
  }
  camera.position.copy(saved.pos);
  camera.lookAt(saved.target);
  go(target.clone().addScaledVector(dir, d), target, fly);
}

function lookAt(x: number, z: number) {
  home = false;
  const target = new THREE.Vector3(x, 0, z);
  const from = camera.position.clone().sub(controls.target);
  // Close by already, the camera keeps its distance and only turns to the spot.
  const distance = Math.min(CLOSE_M, from.length());
  from.y = 0;
  if (from.lengthSq() < 1) from.set(0, 0, 1);
  from.normalize().multiplyScalar(Math.cos(CLOSE_PITCH) * distance);
  from.y = Math.sin(CLOSE_PITCH) * distance;
  go(target.clone().add(from), target, true);
}

function go(pos: THREE.Vector3, target: THREE.Vector3, fly: boolean) {
  if (!fly) {
    flight = undefined;
    camera.position.copy(pos);
    controls.target.copy(target);
    controls.update();
    return;
  }
  flight = { fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: pos, toTarget: target, at: performance.now() };
}

function rayAt(e: MouseEvent): THREE.Ray {
  const r = renderer.domElement.getBoundingClientRect();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  return ray.ray;
}

function floorAt(e: MouseEvent) {
  const p = rayAt(e).intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  if (!p || !model) return undefined;
  const box = new THREE.Box3().setFromObject(model);
  return p.x >= box.min.x && p.x <= box.max.x && p.z >= box.min.z && p.z <= box.max.z ? { x: p.x, z: p.z } : undefined;
}

export function venueView(c: DbConnection): LiveView {
  conn = c;
  if (!view) makeView();
  if (chosenUrl() !== loadedUrl) load(chosenUrl());
  showLive(true);
  return { view: view!, note: viewNote, layer: liveLayer, canvas: renderer.domElement, onFrame: f => frames.push(f), floorAt, rayAt, lookAt, overview: () => overview() };
}

// --- The picker -------------------------------------------------------------------------------

let picker: HTMLSelectElement | undefined;
let pickerKey = '';

function label(s: VenueSetup) {
  return s.venueName ? `${s.eventName} at ${s.venueName}` : s.eventName;
}

function chosenId(): bigint {
  return conn.db.chosenVenue.id.find(0)?.setupId ?? DEFAULT_SETUP;
}

function chosen(): VenueSetup | undefined {
  const id = chosenId();
  return id === DEFAULT_SETUP ? undefined : conn.db.venueSetup.id.find(id) ?? undefined;
}

function chosenUrl(): string {
  return chosen()?.modelUrl || DEFAULT.modelUrl;
}

/** Ready setups, newest first. */
function ready(): VenueSetup[] {
  return [...conn.db.venueSetup.iter()].filter(s => s.status === 'ready').sort((a, b) => Number(b.id - a.id));
}

function updatePicker(canChoose: boolean) {
  if (!picker) {
    picker = h('select', { onchange: () => act(() => conn.reducers.chooseVenue({ setupId: BigInt(picker!.value) })) }) as HTMLSelectElement;
  }
  const options: [bigint, string][] = [[DEFAULT_SETUP, DEFAULT.label], ...ready().map(s => [s.id, label(s)] as [bigint, string])];
  const chosen = chosenId();
  const key = `${chosen}|${canChoose}|${options.map(([id, l]) => `${id}:${l}`).join(',')}`;
  // An open dropdown keeps its options until it closes.
  if (key === pickerKey || document.activeElement === picker) return;
  pickerKey = key;
  picker.disabled = !canChoose;
  picker.replaceChildren(...options.map(([id, l]) => h('option', { value: String(id), selected: id === chosen }, l)));
  picker.value = String(chosen);
}

// --- The tab ----------------------------------------------------------------------------------

function link(url: string, text = url) {
  return h('a', { href: url, target: '_blank', rel: 'noreferrer' }, text);
}

function shown() {
  const s = chosen();
  if (chosenUrl() !== loadedUrl) load(chosenUrl());
  const size = s && `${s.sizeX.toFixed(0)} × ${s.sizeY.toFixed(0)} × ${s.sizeZ.toFixed(0)} m`;
  return h('section', {},
    h('h3', {}, 'Venue'),
    h('label', {}, 'Shown venue ', picker),
    s
      ? h('p', {}, h('b', {}, s.venueName || s.eventName), s.address && `, ${s.address}`, '. ',
        `${s.meshes.toLocaleString()} meshes, ${s.triangles.toLocaleString()} triangles, ${s.places ? `${s.places.toLocaleString()} named parts, ` : ''}${size}. From `, link(s.mapUrl), '.')
      : h('p', {}, h('b', {}, DEFAULT.venueName), `, ${DEFAULT.address}. ${DEFAULT.stats}. From `, link(DEFAULT.mapUrl), '.'),
    view, viewNote);
}

function startForm(canStart: boolean) {
  const start = (e: Event) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const eventName = field(form, 'event_name');
    act(async () => {
      await conn.reducers.startVenueSetup({ eventName });
      (form.querySelector('[name=event_name]') as HTMLInputElement).value = '';
    });
  };
  return h('section', {},
    h('h3', {}, 'Set up a venue'),
    h('p', { class: 'muted' }, "Type your event's name. We find its website, the venue and its public 3D map or floor plans, and save the venue's 3D model. Each step shows below as it happens."),
    canStart
      ? h('form', { onsubmit: start },
        h('input', { name: 'event_name', placeholder: 'Cal Hacks 13.0', maxlength: 200, required: true }), ' ',
        h('button', {}, 'Find the venue'))
      : h('p', { class: 'muted' }, 'The organizer sets up the venue.'));
}

function run(s: VenueSetup) {
  const steps = [...conn.db.venueSetupStep.iter()].filter(st => st.setupId === s.id).sort((a, b) => Number(a.id - b.id));
  const status = STATUS[s.status] ?? s.status;
  const cls = s.status === 'ready' ? 'pass' : s.status === 'failed' ? 'fail' : '';
  return h('section', {},
    h('h4', {}, s.eventName, ' ', h('span', { class: cls }, `· ${status}`)),
    (s.venueName || s.eventSite) && h('p', {},
      s.venueName && [h('b', {}, s.venueName), s.address && `, ${s.address}`, '. '],
      s.eventSite && ['Event site: ', link(s.eventSite), '. '],
      s.mapUrl && ['3D map: ', link(s.mapUrl), '.']),
    s.floorPlans.length > 0 && h('p', {}, 'Floor plans: ', s.floorPlans.map((u, i) => [i > 0 && ', ', link(u)])),
    s.sources.length > 0 && h('details', {}, h('summary', {}, `Pages used (${s.sources.length})`),
      h('ul', {}, s.sources.map(f => h('li', {}, `${f.label}: `, link(f.value))))),
    s.error && h('p', { class: 'fail' }, s.error),
    h('ol', {}, steps.map(st => h('li', {}, h('span', { class: 'muted' }, time(st.at)), ' ', h('b', {}, st.step), st.detail && `: ${st.detail}`))),
    h('p', { class: 'muted' }, `Started ${date(s.createdAt)}`));
}

export function venueSetupTab(c: DbConnection, canSetUp: boolean) {
  conn = c;
  if (!view) makeView();
  showLive(false);
  updatePicker(canSetUp);
  const runs = [...conn.db.venueSetup.iter()].sort((a, b) => Number(b.id - a.id));
  return [
    shown(),
    startForm(canSetUp),
    runs.length > 0 && h('section', {}, h('h3', {}, `Setups (${runs.length})`), runs.map(run)),
  ];
}
