// The Venue tab of the organizer portal. The organizer types the event's name, and a worker finds the
// event's site, its venue and any public 3D map of it, then saves the venue's model; each step shows here
// as it happens. The organizer picks the venue the portal shows. The Cal Hacks 13.0 model at the Palace of
// Fine Arts ships with the app and is the default. The Live tab shows the same 3D view with the hall cut open
// and the crowd in it. The organizer also uploads the venue's insurance policy here, or names its two forms and
// types its declarations so the forms are found online: each term read from it shows with its quote and page,
// or as typed, and once confirmed it sets the claims' limits.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { act, date, field, h, money, time } from './lib';
import type { DbConnection } from './module_bindings';
import type { PolicyDocument, PolicyTerm, VenuePolicyLookup, VenueSetup } from './module_bindings/types';
import { VenueNames, type Spot } from './venue-names';

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

/** On the Live tab everything of the model above this height is cut away, so the mezzanine (its underside is at
 * 4.25 m) and the roof do not hide the crowd. Only the model is cut, so the incidents' beams rise above it. */
const CUT_M = 4.1;
/** The cut, far above the model off the Live tab. */
const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e9);
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
/** The model in the view once it has loaded, so the floor's names show only over the model they belong to. */
let shownUrl = '';
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
/** The Live tab's view height in pixels once the bar under it is dragged; until then most of the window's height. */
let liveHeight = 0;
/** The Live tab's names on the floor and tags over our bands. */
const names = new VenueNames();
let spotsAsked = false;
let coloursAt = -Infinity;

/** The colour an exit marker glows: what its station marker reports, else its zone's exit colour, else blue. */
function exitColour(station: number): number {
  return conn.db.station.id.find(station)?.exitColour || [...conn.db.zone.iter()].find(z => z.stationId === station)?.exitColour || 1;
}

function makeView() {
  view = h('div', { class: 'venue-3d' });
  viewNote = h('p', { class: 'muted' });
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.localClippingEnabled = true;
  view.append(renderer.domElement, names.box);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#c8effd');
  scene.add(new THREE.HemisphereLight('#ffffff', '#a7abb2', 1.6));
  const sun = new THREE.DirectionalLight('#fff8ee', 2.6);
  scene.add(sun);
  liveLayer.visible = false;
  liveLayer.add(names.markers);
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
        if (!mesh.isMesh) return;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          m.side = THREE.DoubleSide;
          m.clippingPlanes = [cut];
        }
      });
      scene.add(model);
      shownUrl = url;
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
    const hgt = liveLayer.visible ? liveHeight || Math.max(360, Math.round(innerHeight * 0.8)) : Math.round(w * 9 / 16);
    // three floors the canvas size; a rounded one never matched at 1.5× on an odd width and resized it every frame.
    if (w && (renderer.domElement.width !== Math.floor(w * renderer.getPixelRatio()) || camera.aspect !== w / hgt)) {
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
    if (liveLayer.visible && now - coloursAt > 1000) {
      coloursAt = now;
      names.setExitColours(exitColour);
    }
    // The spots are the default model's, so another venue's model shows only our bands' tags.
    names.draw(camera, controls.target, liveLayer.visible && shownUrl === DEFAULT.modelUrl, liveLayer.visible);
    renderer.render(scene, camera);
  });
}

/** The shared 3D view as the Live tab uses it: cut open at `CUT_M`, with its layer for the crowd shown. */
export type LiveView = {
  view: HTMLElement;
  note: HTMLElement;
  layer: THREE.Group;
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  /** The names on the floor and the tags over our bands. */
  names: VenueNames;
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
  const changed = liveLayer.visible !== on;
  liveLayer.visible = on;
  cut.constant = on ? CUT_M : 1e9;
  // Cut open, the hall is lower, so the whole-hall view comes closer.
  if (changed && home) overview(false);
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

/** Sets the Live tab's view height, in pixels. */
export function setLiveHeight(px: number) {
  liveHeight = px;
}

export function venueView(c: DbConnection): LiveView {
  conn = c;
  if (!view) makeView();
  if (chosenUrl() !== loadedUrl) load(chosenUrl());
  showLive(true);
  if (!spotsAsked) {
    spotsAsked = true;
    spots().then(s => { names.setSpots(s); coloursAt = -Infinity; });
  }
  return { view: view!, note: viewNote, layer: liveLayer, canvas: renderer.domElement, camera, names, onFrame: f => frames.push(f), floorAt, rayAt, lookAt, overview: () => overview() };
}

/** The floor's named spots: the `venue_spot` rows, or the venue's spots file when there are none. */
async function spots(): Promise<Spot[]> {
  const rows = [...conn.db.venueSpot.iter()];
  if (rows.length) return rows.map(s => ({ kind: s.kind, name: s.name, x: s.xM, z: s.yM, station: s.stationId }));
  try {
    const file: Spot[] = await (await fetch('/venue/spots.json')).json();
    return file.map(s => ({ kind: s.kind, name: s.name, x: s.x, z: s.z, station: 0 }));
  } catch {
    return [];
  }
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

// --- The insurance policy ---------------------------------------------------------------------

const DOC_STATUS: Record<string, string> = { reading: 'Reading', read: 'Read, waiting for you to confirm', confirmed: 'In use for the event', failed: 'Failed' };

const TERM_WORDS: Record<string, string> = {
  insurer_name: 'Insurer',
  policy_number: 'Policy number',
  fnol_contact: 'Claims reporting contact',
  period_start: 'Policy period starts',
  period_end: 'Policy period ends',
  other_insurance: 'Other insurance',
  per_claim_limit: 'Per-claim limit',
  aggregate_limit: 'Aggregate limit',
  deductible: 'Deductible',
  minimum_payout: 'Minimum payout',
  service_window_days: 'Service window',
};

const EXCLUSION_WORDS: Record<string, string> = {
  staff: 'Employees and volunteers of the venue',
  pre_existing: 'An injury that began before the event',
  off_premises: 'An injury away from the premises',
  care_custody_control: "Property in the venue's care, custody or control",
  other: 'Other exclusion',
};

const OTHER_INSURANCE_WORDS: Record<string, string> = {
  primary: "primary: the venue's policy pays first",
  excess: "excess: the venue's policy pays what the attendee's own insurance leaves",
};

/** A fee cap's read value is the description the policy printed, then the cap. */
function feeRead(t: PolicyTerm): [string, string] {
  const at = t.readValue.lastIndexOf(' ');
  return at < 0 ? ['', t.readValue] : [t.readValue.slice(0, at), t.readValue.slice(at + 1)];
}

function termLabel(t: PolicyTerm) {
  if (t.name === 'exclusion') return EXCLUSION_WORDS[t.code] ?? t.code;
  if (t.name === 'fee_cap') return `${t.code} ${feeRead(t)[0]}`.trim();
  return TERM_WORDS[t.name] ?? t.name;
}

const TERM_GROUPS: [string, (t: PolicyTerm) => boolean][] = [
  ['Policy', t => !t.coverKind && t.name !== 'exclusion'],
  ['Medical payments', t => t.coverKind === 'medical_payments' && t.name !== 'fee_cap'],
  ['Property', t => t.coverKind === 'property'],
  ['Schedule of benefits', t => t.name === 'fee_cap'],
  ['Exclusions', t => t.name === 'exclusion'],
];

/** The venue's policy documents, newest first. */
function policyDocs(): PolicyDocument[] {
  return [...conn.db.boardPolicyDocuments.iter()].filter(d => d.kind === 'venue_policy').sort((a, b) => Number(b.id - a.id));
}

async function uploadPolicy(form: HTMLFormElement) {
  const input = form.querySelector('input[type=file]') as HTMLInputElement;
  const bytes = await input.files?.[0]?.arrayBuffer();
  if (!bytes) throw new Error('choose the policy PDF');
  const res = await fetch('/api/blobs?purpose=policy', { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: bytes });
  const blob = await res.json();
  if (!res.ok) throw new Error(blob.error);
  await conn.reducers.submitPolicyDocument({ fileHash: blob.hash, pageCount: blob.pages });
  input.value = '';
}

/** How the policy PDF came in: uploaded, or found online from its forms. */
function cameIn(d: PolicyDocument) {
  return d.source === 'policy_lookup' ? `found online ${date(d.uploadedAt)}` : `uploaded ${date(d.uploadedAt)}`;
}

const LOOKUP_STATUS: Record<string, string> = { searching: 'Searching', found: 'Found', not_found: 'Not found', wrong_form: 'Wrong form', failed: 'Failed' };

const dollars = (f: HTMLFormElement, name: string) => BigInt(Math.round(Number(field(f, name) || 0) * 100));

async function lookUpPolicy(form: HTMLFormElement) {
  await conn.reducers.lookUpVenuePolicy({
    insurer: field(form, 'insurer'),
    state: field(form, 'state'),
    liabilityForm: field(form, 'liability_form'),
    propertyForm: field(form, 'property_form'),
    declarations: {
      policyNumber: field(form, 'policy_number'),
      fnolContact: field(form, 'fnol_contact'),
      periodStart: field(form, 'period_start'),
      periodEnd: field(form, 'period_end'),
      medicalLimitCents: dollars(form, 'medical_limit'),
      medicalAggregateCents: dollars(form, 'medical_aggregate'),
      propertyLimitCents: dollars(form, 'property_limit'),
      propertyDeductibleCents: dollars(form, 'property_deductible'),
    },
  });
}

function lookupForm() {
  const input = (name: string, label: string, attrs: Record<string, unknown> = {}) =>
    h('tr', {}, h('th', {}, label), h('td', {}, h('input', { name, required: true, ...attrs })));
  return h('form', { onsubmit: (e: Event) => { e.preventDefault(); act(() => lookUpPolicy(e.target as HTMLFormElement)); } },
    h('table', {},
      input('insurer', 'Insurer', { placeholder: 'Harborline Casualty', maxlength: 80 }),
      input('state', "Venue's state", { placeholder: 'CA', maxlength: 2, size: 2 }),
      input('liability_form', 'Liability form number', { placeholder: 'CG 00 01 04 13', maxlength: 24 }),
      input('property_form', 'Property form number', { placeholder: 'CP 00 10 10 12', maxlength: 24 }),
      h('tr', {}, h('th', { colspan: 2 }, 'From the declarations page')),
      input('policy_number', 'Policy number', { placeholder: 'HCP-2026-7781', maxlength: 60 }),
      input('period_start', 'Policy period starts', { type: 'date' }),
      input('period_end', 'Policy period ends', { type: 'date' }),
      input('fnol_contact', 'Report claims to', { placeholder: 'claims@harborline.example', maxlength: 120 }),
      input('medical_limit', 'Medical expense limit, any one person ($)', { type: 'number', min: 1, step: '0.01', placeholder: '10000' }),
      input('medical_aggregate', 'General aggregate limit ($)', { type: 'number', min: 1, step: '0.01', placeholder: '2000000' }),
      input('property_limit', 'Property limit of insurance ($)', { type: 'number', min: 1, step: '0.01', placeholder: '250000' }),
      input('property_deductible', 'Property deductible ($)', { type: 'number', min: 0, step: '0.01', placeholder: '1000' })),
    h('button', {}, 'Find the policy online'));
}

function lookupRow(l: VenuePolicyLookup) {
  const cls = l.status === 'found' ? 'pass' : l.status === 'searching' ? '' : 'fail';
  const nothing = l.status === 'not_found' || l.status === 'wrong_form';
  return h('li', {},
    h('b', {}, `${l.insurer}, ${l.liabilityForm} and ${l.propertyForm}`), `, policy ${l.policyNumber}, asked ${date(l.createdAt)} `,
    h('span', { class: cls }, `· ${LOOKUP_STATUS[l.status] ?? l.status}`),
    l.forms.length > 0 && h('ul', {}, l.forms.map(f => h('li', {},
      `${f.part === 'liability' ? 'Liability' : 'Property'} form `, h('b', {}, f.formNumber), f.title && ` ${f.title}`,
      `, pages ${f.firstPage} to ${f.firstPage + f.pageCount - 1}, from `, link(f.url)))),
    nothing && h('p', { class: 'fail' }, "We couldn't find the policy's forms online. Upload the policy instead."),
    l.note && h('p', { class: 'muted' }, l.note));
}

function policyDoc(d: PolicyDocument) {
  const cls = d.status === 'confirmed' ? 'pass' : d.status === 'failed' ? 'fail' : '';
  return h('li', {},
    h('a', { href: `/blobs/${d.fileHash}`, target: '_blank', rel: 'noreferrer' }, `Policy PDF, ${d.pageCount} pages`),
    `, ${cameIn(d)} `, h('span', { class: cls }, `· ${DOC_STATUS[d.status] ?? d.status}`),
    d.status !== 'reading' && d.status !== 'failed' && `. ${d.clauseCount} clauses checked word for word on their pages`,
    d.confirmedAt && `. Confirmed ${date(d.confirmedAt)}`,
    d.error && h('p', { class: 'fail' }, d.error),
    d.dropped.length > 0 && h('details', {}, h('summary', {}, `Dropped (${d.dropped.length})`), h('ul', {}, d.dropped.map(x => h('li', {}, x)))));
}

function termRow(t: PolicyTerm) {
  const cls = t.status === 'read' || t.status === 'typed' ? 'pass' : t.status === 'flagged' ? 'fail' : 'muted';
  return h('tr', {},
    h('td', {}, termLabel(t)),
    h('td', {}, t.shown),
    h('td', {}, t.name === 'fee_cap' ? feeRead(t)[1] : t.readValue),
    h('td', { class: 'muted' }, t.quote),
    h('td', {}, t.page || ''),
    h('td', { class: cls }, t.status),
    h('td', {}, t.problem));
}

function termsTable(d: PolicyDocument) {
  const terms = [...conn.db.boardPolicyTerms.iter()].filter(t => t.documentId === d.id).sort((a, b) => Number(a.id - b.id));
  const flagged = terms.filter(t => t.status === 'flagged').length;
  return [
    h('h4', {}, `Terms read from the policy ${cameIn(d)}`),
    h('p', { class: 'muted' }, `${terms.length} terms, ${flagged} flagged. "read": read from the policy and checked. "flagged": a check failed, so the default stays. "default": the policy does not state it. "typed": you typed it from the declarations page.`),
    h('table', {},
      h('tr', {}, ['Term', 'In effect', 'Read from the policy', 'Quote', 'Page', 'Status', 'Problem'].map(c => h('th', {}, c))),
      TERM_GROUPS.map(([group, inGroup]) => {
        const rows = terms.filter(inGroup);
        return rows.length > 0 && [h('tr', {}, h('th', { colspan: 7 }, group)), rows.map(termRow)];
      })),
    d.status === 'read' && h('p', {}, h('button', { onclick: () => act(() => conn.reducers.confirmPolicyTerms({ documentId: d.id })) }, 'Use these terms for the event')),
  ];
}

/** The policy claims take now: the newest confirmed venue policy's, else the newest policy row. */
function inEffect() {
  const confirmed = policyDocs().filter(d => d.status === 'confirmed' && d.confirmedAt)
    .sort((a, b) => Number(b.confirmedAt!.microsSinceUnixEpoch - a.confirmedAt!.microsSinceUnixEpoch))[0];
  const policies = [...conn.db.boardPolicies.iter()];
  const p = policies.find(x => confirmed && x.id === confirmed.policyId) ?? policies.sort((a, b) => Number(b.id - a.id))[0];
  if (!p) return h('p', { class: 'muted' }, 'No policy in effect yet.');
  const day = (ms: number) => new Date(ms).toLocaleDateString('en-CA');
  // The period's end is stored as the midnight after its last day.
  const period = p.periodChecked
    ? `${day(p.periodStart.toDate().getTime())} to ${day(p.periodEnd.toDate().getTime() - 1)}`
    : 'not stated, so not checked';
  const covers = [...conn.db.boardCovers.iter()].filter(c => c.policyId === p.id).sort((a, b) => a.coverKind.localeCompare(b.coverKind));
  const codes = [...conn.db.boardFeeSchedule.iter()].filter(l => l.policyId === p.id).length;
  return [
    h('h4', {}, 'In effect now'),
    h('p', {}, h('b', {}, `Policy ${p.policyNumber}`), ` with ${p.insurerName}. Period ${period}. Other insurance: ${OTHER_INSURANCE_WORDS[p.otherInsurance] ?? p.otherInsurance}.`,
      ` Claims reported to ${p.fnolContact}.`, p.staffExcluded && ' Employees and volunteers are excluded.'),
    h('table', {},
      h('tr', {}, ['Cover', 'Per-claim limit', 'Aggregate limit', 'Deductible', 'Minimum payout', 'Service window'].map(c => h('th', {}, c))),
      covers.map(c => h('tr', {},
        h('td', {}, c.coverKind === 'medical_payments' ? 'Medical payments' : c.coverKind === 'property' ? 'Property' : c.coverKind),
        h('td', {}, money(c.perClaimLimitCents)), h('td', {}, money(c.aggregateLimitCents)), h('td', {}, money(c.deductibleCents)),
        h('td', {}, money(c.minimumPayoutCents)), h('td', {}, c.serviceWindowDays ? `${c.serviceWindowDays} days` : 'none')))),
    h('p', {}, 'Schedule of benefits: ', codes ? `${codes} codes from the policy` : 'default schedule, 21 codes', '.'),
  ];
}

/** Shown to the organizer only. */
function policySection() {
  const docs = policyDocs();
  const lookups = [...conn.db.boardVenuePolicyLookups.iter()].sort((a, b) => Number(b.id - a.id));
  const shownDoc = docs.find(d => d.status === 'read' || d.status === 'confirmed');
  return h('section', {},
    h('h3', {}, 'Insurance policy'),
    h('p', { class: 'muted' }, "Upload the venue's insurance policy PDF. Each term is read from the policy with its quote and page, then checked. Until you confirm the terms, claims use the defaults."),
    h('form', { onsubmit: (e: Event) => { e.preventDefault(); act(() => uploadPolicy(e.target as HTMLFormElement)); } },
      h('input', { type: 'file', name: 'policy-pdf', accept: 'application/pdf' }), ' ',
      h('button', {}, 'Upload and read')),
    h('h4', {}, 'Or find the policy online'),
    h('p', { class: 'muted' }, "No PDF at hand? Name the insurer and the two forms listed on the declarations page, the liability form and the property form, and type the declarations. We find both forms online and read them like an upload, with your numbers in place of the ones only the declarations print."),
    lookupForm(),
    lookups.length > 0 && [h('h4', {}, `Looked up (${lookups.length})`), h('ul', {}, lookups.map(lookupRow))],
    docs.length > 0 && [h('h4', {}, `Policy PDFs (${docs.length})`), h('ul', {}, docs.map(policyDoc))],
    shownDoc && termsTable(shownDoc),
    inEffect());
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
    canSetUp && policySection(),
    runs.length > 0 && h('section', {}, h('h3', {}, `Setups (${runs.length})`), runs.map(run)),
  ];
}
