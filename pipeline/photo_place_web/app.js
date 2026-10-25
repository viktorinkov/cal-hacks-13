import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

const $ = (id) => document.getElementById(id);
const [sceneInfo, data] = await Promise.all([
  fetch('/scene.json').then((r) => r.json()),
  fetch('/places.json').then((r) => r.json()),
]);
const photos = data.photos;
const A = data.align;
const det = A.matrix[0][0] * A.matrix[1][1] - A.matrix[0][1] * A.matrix[1][0];
const inv = [[A.matrix[1][1] / det, -A.matrix[0][1] / det], [-A.matrix[1][0] / det, A.matrix[0][0] / det]];
const metre = 1 / A.scale;
const toScan = (x, z) => {
  const a = x - A.shift[0], b = z - A.shift[1];
  return [inv[0][0] * a + inv[0][1] * b, inv[1][0] * a + inv[1][1] * b];
};
const ROLE = { 'in photo': 'photo', photographer: 'shooter', maybe: 'maybe', 'not in view': 'off' };
const COLOUR = { photo: 0x5be37d, shooter: 0xffb547, maybe: 0xe9d758, off: 0x59626e };

const world = $('world');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
world.appendChild(renderer.domElement);
const labels = new CSS2DRenderer();
Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
world.appendChild(labels.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d10);
const cam = new THREE.PerspectiveCamera(55, 1, 0.05, 2000);
const controls = new OrbitControls(cam, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
scene.add(new SparkRenderer({ renderer }));
function addScan(url, visible) {
  const mesh = new SplatMesh({ url });
  mesh.matrixAutoUpdate = false;
  mesh.matrix.fromArray(sceneInfo.matrix);
  mesh.visible = visible;
  scene.add(mesh);
  return mesh;
}
const roofless = sceneInfo.cut ? addScan(sceneInfo.cut, true) : null;
const fullScan = addScan(sceneInfo.splat, !roofless);
(roofless || fullScan).initialized.then(() => { $('status').textContent = ''; });
function showScan(full) {
  fullScan.visible = full || !roofless;
  if (roofless) roofless.visible = !full;
}

const textures = new THREE.TextureLoader();
const pickable = [];
const cams = photos.map((p, i) => {
  const g = new THREE.Group();
  g.matrixAutoUpdate = false;
  g.matrix.set(...p.c2w.flat());
  const d = 1.6 * metre, [w, h] = p.size, f = p.focal_px;
  const hx = d * w / 2 / f, hy = d * h / 2 / f;
  const tex = textures.load(`/photo/${p.id}.jpg`);
  tex.colorSpace = THREE.SRGBColorSpace;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2 * hx, 2 * hy),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, opacity: p.confident ? 0.95 : 0.5 }));
  plane.position.z = -d;
  plane.userData.index = i;
  pickable.push(plane);
  const c = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x, y]) => new THREE.Vector3(x, y, -d));
  const o = new THREE.Vector3();
  const pts = [o, c[0], o, c[1], o, c[2], o, c[3], c[0], c[1], c[1], c[2], c[2], c[3], c[3], c[0]];
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: p.confident ? 0x4cc9f0 : 0x8794a3, transparent: true, opacity: 0.9 }));
  g.add(plane, lines);
  g.updateMatrixWorld(true);
  scene.add(g);
  return { g, plane, lines, tex };
});

const landmarkLabels = [];
for (const l of data.landmarks) {
  if (l.kind === 'table') continue;
  const [x, z] = toScan(l.x, l.z);
  const el = document.createElement('div');
  el.className = `label ${l.kind}`;
  el.textContent = l.name;
  const o = new CSS2DObject(el);
  o.position.set(x, (l.kind === 'area' ? 4.5 : 2.3) * metre, z);
  scene.add(o);
  landmarkLabels.push(o);
}

let bandLayer = null;
function showBands(p) {
  if (bandLayer) {
    bandLayer.traverse((o) => { if (o.element) o.element.remove(); });
    scene.remove(bandLayer);
  }
  bandLayer = new THREE.Group();
  const camPos = new THREE.Vector3().setFromMatrixPosition(cams[photos.indexOf(p)].g.matrix);
  for (const b of p.bands) {
    const role = ROLE[b.role];
    const [x, z] = toScan(b.x, b.z);
    const atCamera = Math.hypot(x - camPos.x, z - camPos.z) < 2 * metre;
    const colour = COLOUR[role];
    const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.3, b.r) * metre * 0.9, Math.max(0.3, b.r) * metre, 48),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: role === 'off' ? 0.25 : 0.6, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.03 * metre, z);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.22 * metre, 16, 12), new THREE.MeshBasicMaterial({ color: colour }));
    dot.position.set(x, 1.2 * metre, z);
    const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0, z), dot.position.clone()]),
      new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.5 }));
    for (const o of [ring, dot, stem]) o.userData.nearCamera = atCamera;
    bandLayer.add(ring, dot, stem);
    if (role === 'photo' || role === 'shooter') {
      const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([camPos, dot.position.clone()]),
        new THREE.LineDashedMaterial({ color: colour, dashSize: 0.3 * metre, gapSize: 0.2 * metre }));
      ray.computeLineDistances();
      const el = document.createElement('div');
      el.className = `label band ${role}`;
      el.textContent = `band ${b.band}${role === 'shooter' ? ' · took it' : ''}`;
      const tag = new CSS2DObject(el);
      tag.position.set(x, 1.7 * metre, z);
      ring.userData.pulse = true;
      ray.userData.nearCamera = true;
      tag.userData.nearCamera = atCamera;
      bandLayer.add(ray, tag);
    }
  }
  const floor = viewFloor(p);
  floor.userData.nearCamera = true;
  bandLayer.add(floor);
  scene.add(bandLayer);
}

function lensLayers(inLens) {
  if (bandLayer) bandLayer.children.forEach((o) => { if (o.userData.nearCamera) o.visible = !inLens; });
}

function viewFloor(p) {
  const m = new THREE.Matrix4().set(...p.c2w.flat());
  const o = new THREE.Vector3().setFromMatrixPosition(m);
  const [w, h] = p.size, f = p.focal_px, far = 15 * metre;
  const pts = [];
  for (const [u, v] of [[0, h], [w, h], [w, h * 0.42], [0, h * 0.42]]) {
    const dir = new THREE.Vector3((u - w / 2) / f, -(v - h / 2) / f, -1).applyMatrix4(new THREE.Matrix4().extractRotation(m)).normalize();
    let t = dir.y < -1e-3 ? -o.y / dir.y : far;
    t = Math.min(t, far / Math.max(0.2, Math.hypot(dir.x, dir.z)));
    const q = o.clone().addScaledVector(dir, t);
    pts.push(new THREE.Vector2(q.x, q.z));
  }
  const shape = new THREE.Shape([new THREE.Vector2(o.x, o.z), ...pts]);
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false }));
  mesh.rotation.x = Math.PI / 2;
  mesh.position.y = 0.02 * metre;
  return mesh;
}

let flight = null;
let lensPhoto = null;
function flyTo(pos, quat, fov, ms = 1600, done) {
  flight = { t0: performance.now(), ms, p0: cam.position.clone(), p1: pos, q0: cam.quaternion.clone(), q1: quat,
    f0: cam.fov, f1: fov, done };
  controls.enabled = false;
}
function poseOf(p) {
  const m = new THREE.Matrix4().set(...p.c2w.flat());
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), s = new THREE.Vector3();
  m.decompose(pos, quat, s);
  return { pos, quat };
}
function lookQuat(from, to) {
  const m = new THREE.Matrix4().lookAt(from, to, new THREE.Vector3(0, 1, 0));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
function lensRect(p) {
  const W = world.clientWidth, H = world.clientHeight, a = p.size[0] / p.size[1];
  let w = W * 0.92, h = w / a;
  if (h > H * 0.86) { h = H * 0.86; w = h * a; }
  return { x: (W - w) / 2, y: (H - h) / 2 + 10, w, h, W, H };
}
function lensFov(p) {
  const r = lensRect(p);
  return 2 * Math.atan(Math.tan(Math.atan(p.size[1] / 2 / p.focal_px)) * r.H / r.h) * 180 / Math.PI;
}
function aroundPhoto(p) {
  const { pos, quat } = poseOf(p);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat).setY(0).normalize();
  const target = pos.clone().addScaledVector(fwd, 7 * metre).setY(0.6 * metre);
  const eye = pos.clone().addScaledVector(fwd, -9 * metre).setY(pos.y + 7 * metre);
  return { eye, target };
}

let selected = -1;
function select(i, fly = true) {
  leaveLens();
  selected = i;
  const p = photos[i];
  cams.forEach((c, k) => { c.lines.material.color.set(k === i ? 0xffffff : (photos[k].confident ? 0x4cc9f0 : 0x8794a3)); });
  document.querySelectorAll('#list li').forEach((li, k) => li.classList.toggle('sel', k === i));
  showBands(p);
  $('through').disabled = false;
  $('detail').hidden = false;
  $('detail-photo').src = `/photo/${p.id}.jpg`;
  $('detail-where').textContent = sentence(p.where);
  const facts = [
    ['Taken', p.taken ? new Date(p.taken).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'no time in the file'],
    ['Spot', `${p.venue.x.toFixed(1)} m east, ${p.venue.z.toFixed(1)} m south, lens ${p.venue.height_m.toFixed(1)} m up`],
    ['Facing', `${compass(p.venue.heading_deg)}, lens ${p.hfov_deg.toFixed(0)}° wide`],
    ['Match', `${p.inliers} features agree, ${p.error_px} px off${p.confident ? '' : ' (unsure)'}`],
  ];
  $('detail-facts').replaceChildren(...facts.flatMap(([k, v]) => [el('dt', k), el('dd', v)]));
  $('detail-shows').replaceChildren(...(p.shows.length ? p.shows : p.near).slice(0, 8)
    .map((s) => el('li', s.name, el('span', `${s.m.toFixed(0)} m`))));
  const send = p.bands.filter((b) => b.role === 'in photo' || b.role === 'photographer');
  const maybe = p.bands.filter((b) => b.role === 'maybe');
  $('detail-send').replaceChildren(...send.concat(maybe).map((b) => {
    const li = el('li', `band ${b.band} · ${b.role === 'photographer' ? 'took it' : `${b.m.toFixed(0)} m`}`);
    li.className = ROLE[b.role];
    return li;
  }));
  if (!send.length && !maybe.length) $('detail-send').replaceChildren(el('li', 'no band in view'));
  $('detail-note').textContent = p.test_bands
    ? 'The band positions around this photo are seeded test wearers, not radio data.'
    : `${p.bands.length} bands were on the floor at that moment.`;
  if (fly) {
    const { eye, target } = aroundPhoto(p);
    flyTo(eye, lookQuat(eye, target), 55, 1500, () => { controls.target.copy(target); });
  }
}

function enterLens() {
  if (selected < 0) return;
  const p = photos[selected];
  const { pos, quat } = poseOf(p);
  lensPhoto = p;
  cams.forEach((c) => { c.g.visible = false; });
  lensLayers(true);
  showScan(true);
  flyTo(pos, quat, lensFov(p), 1800, () => {
    placeLens();
    $('lens').hidden = false;
    $('blend-wrap').hidden = false;
    fadePhoto(0, 1, 700, () => fadePhoto(1, 0, 900));
  });
  $('lens-photo').src = `/photo/${p.id}.jpg`;
  $('lens-photo').style.opacity = 0;
  $('through').classList.add('on');
}
function leaveLens() {
  if (!lensPhoto) return;
  lensPhoto = null;
  $('lens').hidden = true;
  $('blend-wrap').hidden = true;
  $('through').classList.remove('on');
  cams.forEach((c) => { c.g.visible = true; });
  lensLayers(false);
  showScan(false);
  controls.enabled = true;
}
function placeLens() {
  if (!lensPhoto) return;
  const r = lensRect(lensPhoto);
  Object.assign($('lens').style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  cam.fov = lensFov(lensPhoto);
  cam.updateProjectionMatrix();
}
let fade = null;
function fadePhoto(a, b, ms, done) {
  fade = { t0: performance.now(), a, b, ms, done };
}
$('blend').addEventListener('input', (e) => { fade = null; $('lens-photo').style.opacity = e.target.value / 100; });
$('through').addEventListener('click', () => (lensPhoto ? select(selected) : enterLens()));
$('overview').addEventListener('click', () => { leaveLens(); home(); });
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { leaveLens(); if (selected >= 0) select(selected); }
  if (e.key === 'ArrowRight' && photos.length) select((selected + 1) % photos.length);
  if (e.key === 'ArrowLeft' && photos.length) select((selected - 1 + photos.length) % photos.length);
  if (e.key === ' ' && selected >= 0) { e.preventDefault(); lensPhoto ? select(selected) : enterLens(); }
});

const ray = new THREE.Raycaster();
renderer.domElement.addEventListener('click', (e) => {
  if (lensPhoto || flight) return;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), cam);
  const hit = ray.intersectObjects(pickable, false)[0];
  if (hit) select(hit.object.userData.index);
});

function el(tag, text, child) {
  const e = document.createElement(tag);
  e.textContent = text;
  if (child) e.append(' ', child);
  return e;
}
function sentence(s) { return s.charAt(0).toUpperCase() + s.slice(1) + '.'; }
function compass(heading) {
  const bearing = (heading + 90 + 360) % 360;
  return `${['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(bearing / 45) % 8]} (${bearing.toFixed(0)}°)`;
}

$('count').textContent = `${photos.length} placed`;
$('list').replaceChildren(...photos.map((p, i) => {
  const li = document.createElement('li');
  if (!p.confident) li.classList.add('unsure');
  const img = document.createElement('img');
  img.src = `/photo/${p.id}.jpg`;
  img.loading = 'lazy';
  const send = p.bands.filter((b) => b.role === 'in photo').length;
  const cap = document.createElement('div');
  cap.innerHTML = `<b>${p.id}</b> · ${send ? `${send} to send` : 'nobody in view'}`;
  li.append(img, cap);
  li.addEventListener('click', () => select(i));
  return li;
}));

function home() {
  const box = new THREE.Box3();
  for (const c of cams) box.expandByPoint(new THREE.Vector3().setFromMatrixPosition(c.g.matrix));
  if (box.isEmpty()) box.set(new THREE.Vector3(-40, 0, -30), new THREE.Vector3(40, 0, 30));
  const c = box.getCenter(new THREE.Vector3()).setY(0);
  const size = box.getSize(new THREE.Vector3());
  const r = Math.max(Math.hypot(size.x, size.z) * 0.55, 30 * metre);
  const across = new THREE.Vector3(-size.z, 0, size.x).normalize();
  const eye = c.clone().addScaledVector(across, r * 0.7).setY(r * 0.85);
  flyTo(eye, lookQuat(eye, c), 55, 1400, () => controls.target.copy(c));
}

function resize() {
  const w = world.clientWidth, h = world.clientHeight;
  renderer.setSize(w, h, false);
  labels.setSize(w, h);
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
  placeLens();
}
addEventListener('resize', resize);
resize();
cam.position.set(0, 60, 80);
controls.target.set(0, 0, 0);
home();

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
renderer.setAnimationLoop((now) => {
  if (flight) {
    const t = Math.min(1, (now - flight.t0) / flight.ms), k = ease(t);
    cam.position.lerpVectors(flight.p0, flight.p1, k);
    cam.quaternion.slerpQuaternions(flight.q0, flight.q1, k);
    cam.fov = flight.f0 + (flight.f1 - flight.f0) * k;
    cam.updateProjectionMatrix();
    if (t >= 1) {
      const done = flight.done;
      flight = null;
      if (!lensPhoto) controls.enabled = true;
      if (done) done();
    }
  } else if (!lensPhoto) {
    controls.update();
  }
  if (fade) {
    const t = Math.min(1, (now - fade.t0) / fade.ms), v = fade.a + (fade.b - fade.a) * ease(t);
    $('lens-photo').style.opacity = v;
    $('blend').value = Math.round(v * 100);
    if (t >= 1) { const done = fade.done; fade = null; if (done) done(); }
  }
  const pulse = 0.55 + 0.35 * Math.sin(now / 260);
  if (bandLayer) bandLayer.traverse((o) => { if (o.userData.pulse) o.material.opacity = pulse; });
  for (const o of landmarkLabels) {
    const d = o.position.distanceTo(cam.position) / metre;
    o.visible = !lensPhoto && d < (o.element.classList.contains('area') ? 140 : 70);
  }
  renderer.render(scene, cam);
  labels.render(scene, cam);
});

window.photoPlaces = { select, enterLens, leaveLens, home, photos };
if (photos.length) setTimeout(() => select(0, false), 300);
