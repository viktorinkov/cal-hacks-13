// The Venue tab of the organizer portal. The organizer types the event's name, and a worker finds the
// event's site, its venue and any public 3D map of it, then saves the venue's model; each step shows here
// as it happens. The organizer picks the venue the portal shows. The Cal Hacks 13.0 model at the Palace of
// Fine Arts ships with the app and is the default.

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

/** The view and the picker live across redraws, so the model stays loaded and an open dropdown stays open. */
let view: HTMLElement | undefined;
let viewNote: HTMLElement;
let loadedUrl = '';
let load: (url: string) => void;

function makeView() {
  view = h('div', { class: 'venue-3d' });
  viewNote = h('p', { class: 'muted' });
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  view.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#c8effd');
  scene.add(new THREE.HemisphereLight('#ffffff', '#a7abb2', 1.6));
  const sun = new THREE.DirectionalLight('#fff8ee', 2.6);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.5, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  let model: THREE.Object3D | undefined;
  let asked = 0;

  load = (url: string) => {
    loadedUrl = url;
    const mine = ++asked;
    viewNote.textContent = 'Loading the model…';
    new GLTFLoader().loadAsync(url).then(gltf => {
      if (mine !== asked) return;
      if (model) scene.remove(model);
      model = gltf.scene;
      scene.add(model);
      // Frame the model whatever its size: the camera, its range and the sun scale with it.
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length() || 1;
      camera.near = size / 1000;
      camera.far = size * 10;
      camera.position.copy(center).add(new THREE.Vector3(0, 0.6, 0.75).multiplyScalar(size));
      camera.updateProjectionMatrix();
      sun.position.copy(center).add(new THREE.Vector3(-0.2, 0.45, 0.3).multiplyScalar(size));
      controls.target.copy(center);
      controls.update();
      viewNote.textContent = 'Drag to turn, scroll to zoom.';
    }).catch(e => {
      if (mine === asked) viewNote.textContent = `The model did not load: ${e?.message ?? e}`;
    });
  };

  // Draws only while the tab shows the view.
  renderer.setAnimationLoop(() => {
    if (!view!.isConnected) return;
    const w = view!.clientWidth;
    const hgt = Math.round(w * 9 / 16);
    if (w && (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) || camera.aspect !== w / hgt)) {
      renderer.setSize(w, hgt);
      camera.aspect = w / hgt;
      camera.updateProjectionMatrix();
    }
    controls.update();
    renderer.render(scene, camera);
  });
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
  const id = chosenId();
  const s = id === DEFAULT_SETUP ? undefined : conn.db.venueSetup.id.find(id);
  const url = s?.modelUrl || DEFAULT.modelUrl;
  if (url !== loadedUrl) load(url);
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
  updatePicker(canSetUp);
  const runs = [...conn.db.venueSetup.iter()].sort((a, b) => Number(b.id - a.id));
  return [
    shown(),
    startForm(canSetUp),
    runs.length > 0 && h('section', {}, h('h3', {}, `Setups (${runs.length})`), runs.map(run)),
  ];
}
