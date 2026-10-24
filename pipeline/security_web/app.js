import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const STATES = ['idle', 'crowded', 'guiding out', 'SOS', 'near an SOS', 'paying', 'paid', 'connecting', 'identify',
  'off', 'finding', 'found'];
const STATE_COLOUR = [0xa9c1d9, 0xffb020, 0xff6a3d, 0xff3b3b, 0x4c8dff, 0xb07cff, 0x3ddc84, 0xff6ad5, 0xffffff,
  0x4b5664, 0x2dd4bf, 0x2dd4bf];
const F_SOS = 1, F_FALL = 2;
const BAND_Y = 1.0;
const RED = 0xff3b3b, ACCENT = 0x4cc9f0, AMBER = 0xffb020;

const $ = (id) => document.getElementById(id);
const main = $('main');
const view = $('world-view');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06080b);
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
view.prepend(renderer.domElement);
const labels = new CSS2DRenderer();
labels.domElement.className = 'labels';
view.appendChild(labels.domElement);
const cam = new THREE.PerspectiveCamera(50, 1, 0.05, 2000);
const controls = new OrbitControls(cam, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
scene.add(new THREE.AmbientLight(0xffffff, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(6, 20, 9);
scene.add(sun);

let S = null;
let plan = null;
let camPose = null;
let fly = null;
let lastState = null;
let backHome = null;
const home = { target: new THREE.Vector3(), pos: new THREE.Vector3(12, 14, 16) };
const bands = new Map();
const incidents = new Map();
const focused = new Set();
const quietPool = [];

function tag(text, cls) {
  const el = document.createElement('div');
  el.className = 'tag' + (cls ? ' ' + cls : '');
  el.textContent = text;
  return new CSS2DObject(el);
}

function floorRing(colour, opacity) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.93, 1.0, 72),
    new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}

function rod(radius, colour, opacity = 1) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: colour, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }));
  m.visible = false;
  return m;
}

function between(mesh, a, b) {
  const d = new THREE.Vector3().subVectors(b, a);
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.scale.set(1, Math.max(1e-3, d.length()), 1);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  mesh.visible = true;
}

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  labels.setSize(w, h);
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);

function addPlan() {
  const mpp = S.plan.metres_per_px;
  const [ox, oy] = S.plan.origin;
  const [w, h] = S.plan.size;
  const tex = new THREE.TextureLoader().load(S.plan.url);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, opacity: { value: 1.0 }, inkOnly: { value: S.splat ? 1.0 : 0.0 } },
    transparent: true,
    depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D map; uniform float opacity; uniform float inkOnly; varying vec2 vUv;
      void main() {
        vec3 c = texture2D(map, vUv).rgb;
        float ink = clamp(1.0 - dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
        vec3 col = mix(vec3(0.05, 0.065, 0.085), vec3(0.6, 0.78, 0.93), ink);
        float a = mix(0.92, ink * 0.85, inkOnly);
        gl_FragColor = vec4(col, a * opacity);
      }`,
  });
  plan = new THREE.Mesh(new THREE.PlaneGeometry(w * mpp, h * mpp), mat);
  plan.rotation.x = -Math.PI / 2;
  plan.position.set((w / 2 - ox) * mpp, S.splat ? 0.02 : 0, (h / 2 - oy) * mpp);
  plan.renderOrder = 1;
  plan.visible = !S.splat;
  scene.add(plan);
  $('plan-toggle').classList.toggle('on', plan.visible);
}

function addAnchor(a) {
  const g = new THREE.Group();
  g.position.set(a.x, 0, a.z);
  if (a.kind === 'station') {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.2, 12),
      new THREE.MeshStandardMaterial({ color: 0x2c3846, roughness: 0.6 }));
    pole.position.y = 0.6;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), new THREE.MeshBasicMaterial({ color: ACCENT }));
    head.position.y = 1.25;
    const base = floorRing(ACCENT, 0.55);
    base.scale.setScalar(0.38);
    base.position.y = 0.03;
    const t = tag(String(a.id), 'station');
    t.position.y = 1.55;
    g.add(pole, head, base, t);
  } else {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.2), new THREE.MeshBasicMaterial({ color: 0xe6edf5 }));
    box.position.y = 1.0;
    const t = tag('gateway', 'gateway');
    t.position.y = 1.3;
    g.add(box, t);
  }
  scene.add(g);
}

function addCamera(c) {
  const p = c.pose;
  const K = p.K, R = p.R;
  const [w, h] = p.size;
  const C = new THREE.Vector3(...p.centre);
  const ray = (u, v) => {
    const x = (u - K[0][2]) / K[0][0], y = (v - K[1][2]) / K[1][1];
    return new THREE.Vector3(R[0][0] * x + R[1][0] * y + R[2][0], R[0][1] * x + R[1][1] * y + R[2][1],
      R[0][2] * x + R[1][2] * y + R[2][2]).normalize();
  };
  const forward = new THREE.Vector3(...R[2]);
  camPose = { C, forward, fov: THREE.MathUtils.radToDeg(2 * Math.atan(h / 2 / K[1][1])) };
  const corners = [[0, 0], [w, 0], [w, h], [0, h]].map(([u, v]) => ray(u, v));
  const L = 1.4;
  const ends = corners.map((d) => C.clone().addScaledVector(d, L));
  const pts = [];
  for (let i = 0; i < 4; i++) pts.push(C, ends[i], ends[i], ends[(i + 1) % 4]);
  scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: ACCENT })));
  const border = [];
  const N = 32;
  for (let i = 0; i < N; i++) border.push([w * i / N, 0]);
  for (let i = 0; i < N; i++) border.push([w, h * i / N]);
  for (let i = 0; i < N; i++) border.push([w - w * i / N, h]);
  for (let i = 0; i < N; i++) border.push([0, h - h * i / N]);
  const foot = border.map(([u, v]) => {
    const d = ray(u, v);
    let q;
    if (d.y < -1e-3) {
      q = C.clone().addScaledVector(d, Math.min(-C.y / d.y, 60));
    } else {
      const flat = new THREE.Vector3(d.x, 0, d.z).normalize();
      q = C.clone().addScaledVector(flat, 60);
    }
    return new THREE.Vector3(q.x, 0.012, q.z);
  });
  const mid = foot.reduce((s, v) => s.add(v), new THREE.Vector3()).multiplyScalar(1 / foot.length);
  const pos = [];
  for (let i = 0; i < foot.length; i++) {
    const a = foot[i], b = foot[(i + 1) % foot.length];
    pos.push(mid.x, mid.y, mid.z, a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const fillGeo = new THREE.BufferGeometry();
  fillGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  scene.add(new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.07,
    side: THREE.DoubleSide, depthWrite: false })));
  scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(foot),
    new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.4 })));
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.34), new THREE.MeshStandardMaterial({ color: 0xdbe3ec }));
  const right = new THREE.Vector3(...R[0]);
  const up = new THREE.Vector3(...R[1]).negate();
  body.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward.clone().negate()));
  body.position.copy(C);
  const t = tag(`camera ${c.name}`, 'camera');
  t.position.copy(C).add(new THREE.Vector3(0, 0.4, 0));
  scene.add(body, t);
  $('camview').hidden = false;
}

async function addSplat() {
  const note = $('world-note');
  const count = `${(S.splat.splats / 1e6).toFixed(1)} M splats`;
  note.textContent = `loading ${count}`;
  try {
    const { SparkRenderer, SplatMesh } = await import('@sparkjsdev/spark');
    scene.add(new SparkRenderer({ renderer }));
    const mesh = new SplatMesh({ url: S.splat.url, fileType: 'splat' });
    scene.add(mesh);
    await mesh.initialized;
    note.textContent = count;
  } catch (e) {
    note.textContent = `the splat did not load (${e.message}); showing the plan`;
    if (plan) {
      plan.visible = true;
      plan.material.uniforms.inkOnly.value = 0.0;
    }
  }
}

function setHome() {
  const box = new THREE.Box3();
  for (const a of S.anchors) box.expandByPoint(new THREE.Vector3(a.x, 0, a.z));
  if (box.isEmpty() && S.splat) {
    box.expandByPoint(new THREE.Vector3(S.splat.bounds[0][0], 0, S.splat.bounds[0][2]));
    box.expandByPoint(new THREE.Vector3(S.splat.bounds[1][0], 0, S.splat.bounds[1][2]));
  }
  if (box.isEmpty() && S.plan.metres_per_px) {
    const m = S.plan.metres_per_px, [ox, oy] = S.plan.origin, [w, h] = S.plan.size;
    box.expandByPoint(new THREE.Vector3(-ox * m, 0, -oy * m));
    box.expandByPoint(new THREE.Vector3((w - ox) * m, 0, (h - oy) * m));
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(-6, 0, -6), new THREE.Vector3(6, 0, 6));
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const r = Math.max(size.x, size.z, 6) * 0.5;
  home.target.set(c.x, 0, c.z);
  home.pos.set(c.x - r * 0.1, r * 1.15 + 3, c.z + r * 1.45 + 2.5);
  cam.position.copy(home.pos);
  controls.target.copy(home.target);
  controls.update();
}

function flyTo(target, pos, fov = 50, seconds = 1.3) {
  fly = { t0: performance.now(), ms: seconds * 1000, t: [controls.target.clone(), target.clone()],
    p: [cam.position.clone(), pos.clone()], f: [cam.fov, fov] };
}

function focus(p) {
  const dir = cam.position.clone().sub(controls.target).setY(0);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  dir.normalize();
  flyTo(p.clone().setY(0.5), p.clone().addScaledVector(dir, 7.5).setY(6));
}

function overview() {
  flyTo(home.target, home.pos);
}

function cameraView() {
  if (!camPose) return;
  flyTo(camPose.C.clone().addScaledVector(camPose.forward, 6), camPose.C.clone().addScaledVector(camPose.forward, 0.05),
    camPose.fov);
}

controls.addEventListener('start', () => {
  fly = null;
  if (Math.abs(cam.fov - 50) > 0.5) {
    cam.fov = 50;
    cam.updateProjectionMatrix();
  }
});

function makeBand(b) {
  const group = new THREE.Group();
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), new THREE.MeshBasicMaterial({ color: STATE_COLOUR[0] }));
  const label = tag(String(b.id), 'band');
  label.position.y = 0.32;
  group.add(dot, label);
  const stem = rod(0.008, 0x8fa3b8, 0.35);
  const ring = floorRing(STATE_COLOUR[0], 0.28);
  group.position.set(b.x, BAND_Y, b.z);
  scene.add(group, stem, ring);
  return { group, dot, label, stem, ring, target: new THREE.Vector3(b.x, BAND_Y, b.z) };
}

function updateBands(list) {
  const live = new Set();
  for (const b of list) {
    if (b.x == null) continue;
    live.add(b.id);
    let o = bands.get(b.id);
    if (!o) {
      o = makeBand(b);
      bands.set(b.id, o);
    }
    o.target.set(b.x, BAND_Y, b.z);
    const sos = (b.flags & (F_SOS | F_FALL)) !== 0;
    const colour = sos ? RED : (STATE_COLOUR[b.state] ?? STATE_COLOUR[0]);
    o.dot.material.color.setHex(colour);
    o.ring.material.color.setHex(colour);
    o.ring.scale.setScalar(Math.max(0.25, b.r || 0.5));
    o.label.element.title = `band ${b.id}: ${STATES[b.state] || 'state ' + b.state}${b.zone ? ', near station ' + b.zone : ''}`;
  }
  for (const [id, o] of bands) {
    if (!live.has(id)) {
      scene.remove(o.group, o.stem, o.ring);
      bands.delete(id);
    }
  }
}

function makeIncident() {
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 9, 40, 1, true), new THREE.ShaderMaterial({
    uniforms: { strobe: { value: 1.0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: 'varying float vUp; void main() { vUp = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float strobe; varying float vUp;
      void main() { gl_FragColor = vec4(1.0, 0.23, 0.23, pow(1.0 - vUp, 2.2) * (0.15 + 0.55 * strobe)); }`,
  }));
  const glow = new THREE.Mesh(new THREE.CircleGeometry(1.1, 48),
    new THREE.MeshBasicMaterial({ color: RED, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending,
      depthWrite: false }));
  glow.rotation.x = -Math.PI / 2;
  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 16), new THREE.MeshBasicMaterial({ color: RED }));
  const line = rod(0.022, RED, 0.9);
  const radio = floorRing(AMBER, 0.75);
  const label = tag('SOS', 'sos');
  for (const m of [beam, glow, hit, radio]) m.visible = false;
  scene.add(beam, glow, hit, line, radio, label);
  return { beam, glow, hit, line, radio, label, where: null };
}

function updateIncidents(list) {
  const live = new Set();
  for (const inc of list) {
    live.add(inc.band);
    let o = incidents.get(inc.band);
    if (!o) {
      o = makeIncident();
      incidents.set(inc.band, o);
    }
    const seen = inc.hit && inc.visible;
    const where = inc.hit ? new THREE.Vector3(...inc.hit)
      : inc.radio ? new THREE.Vector3(inc.radio.x, BAND_Y, inc.radio.z) : null;
    o.where = where;
    for (const m of [o.beam, o.glow]) m.visible = !!where;
    if (where) {
      o.beam.position.set(where.x, 4.5, where.z);
      o.glow.position.set(where.x, 0.035, where.z);
      o.label.position.set(where.x, where.y + 1.1, where.z);
    }
    o.label.visible = !!where;
    o.label.element.textContent = `${inc.fall ? 'FALL' : 'SOS'} band ${inc.band}`;
    o.hit.visible = !!seen;
    if (seen) o.hit.position.copy(where);
    if (seen && camPose) between(o.line, camPose.C, where);
    else o.line.visible = false;
    o.radio.visible = !!inc.radio;
    if (inc.radio) {
      o.radio.position.set(inc.radio.x, 0.045, inc.radio.z);
      o.radio.scale.setScalar(Math.max(0.3, inc.radio.r));
    }
    if (where && !focused.has(inc.band)) {
      focused.add(inc.band);
      focus(where);
    }
  }
  let ended = false;
  for (const [band, o] of incidents) {
    if (!live.has(band)) {
      scene.remove(o.beam, o.glow, o.hit, o.line, o.radio, o.label);
      incidents.delete(band);
      focused.delete(band);
      ended = true;
    }
  }
  if (ended && !incidents.size) {
    clearTimeout(backHome);
    backHome = setTimeout(() => { if (!incidents.size && !fly) overview(); }, 3000);
  }
}

function updateQuiet(list) {
  const hits = list.filter((q) => q.hit);
  while (quietPool.length < hits.length) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
    const t = tag('red flash, no SOS', 'quiet');
    scene.add(m, t);
    quietPool.push({ m, t });
  }
  quietPool.forEach((q, i) => {
    const h = hits[i];
    q.m.visible = q.t.visible = !!h;
    if (h) {
      q.m.position.set(...h.hit);
      q.t.position.set(h.hit[0], h.hit[1] + 0.5, h.hit[2]);
    }
  });
}

function clockText(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function renderIncidents(list, st) {
  const box = $('incidents');
  if (!list.length) {
    const placed = st.bands.filter((b) => b.x != null).length;
    box.innerHTML = `<div class="empty">No SOS. ${st.bands.length} band${st.bands.length === 1 ? '' : 's'} on the radio, ${placed} placed on the map.</div>`;
    return;
  }
  box.replaceChildren(...list.map((inc) => {
    const el = document.createElement('div');
    el.className = 'inc' + (inc.ack ? ' ack' : '');
    const what = inc.label.includes(': ') ? inc.label.slice(inc.label.indexOf(': ') + 2) : inc.label;
    const cls = inc.visible ? 'seen' : inc.radio ? 'radio' : '';
    const located = inc.located != null ? ` · found by the camera in ${inc.located.toFixed(1)} s` : '';
    el.innerHTML = `<h3>${inc.fall ? 'FALL' : 'SOS'} · band ${inc.band}</h3><button type="button">Show</button>
      <div class="meta">${inc.zone ? 'near station ' + inc.zone + ' · ' : ''}${clockText(inc.age)} ago${located}</div>
      <div class="what ${cls}"></div>`;
    el.querySelector('.what').textContent = what;
    el.querySelector('button').addEventListener('click', () => {
      const o = incidents.get(inc.band);
      if (o && o.where) focus(o.where);
    });
    return el;
  }));
}

function renderStatus(st, online) {
  const chips = st ? st.status.map((s) => [s.text.split(':')[0], s.text, s.level]) : [];
  chips.push(['page', online ? 'connected to security.py' : 'security.py is not answering', online ? 'ok' : 'bad']);
  $('status').replaceChildren(...chips.map(([label, title, level]) => {
    const el = document.createElement('span');
    el.className = `chip ${level}`;
    el.title = title;
    el.innerHTML = '<i></i>';
    el.append(label);
    return el;
  }));
}

function applyState(st) {
  lastState = st;
  updateBands(st.bands);
  updateIncidents(st.incidents);
  updateQuiet(st.quiet);
  renderIncidents(st.incidents, st);
  renderStatus(st, true);
  const open = st.incidents.filter((i) => !i.ack);
  $('alarm').hidden = !open.length;
  main.classList.toggle('alarmed', open.length > 0);
  if (open.length) {
    $('alarm-text').textContent = open.map((i) => `${i.fall ? 'FALL' : 'SOS'} band ${i.band}`
      + (i.zone ? ` near station ${i.zone}` : '')).join(' · ');
  }
}

async function poll() {
  try {
    const r = await fetch('/state', { cache: 'no-store' });
    applyState(await r.json());
  } catch {
    renderStatus(lastState, false);
  }
  setTimeout(poll, 250);
}

function ack() {
  fetch('/ack', { method: 'POST' }).catch(() => {});
}

function setMode(mode) {
  main.classList.remove('both', 'world', 'live');
  main.classList.add(mode);
}

function togglePlan() {
  if (!plan) return;
  plan.visible = !plan.visible;
  $('plan-toggle').classList.toggle('on', plan.visible);
}

function toggleLit() {
  const lit = $('lit');
  lit.hidden = !lit.hidden;
  $('lit-toggle').classList.toggle('on', !lit.hidden);
}

function startFeed() {
  const feed = $('feed');
  const note = $('feed-note');
  feed.onload = () => { note.hidden = true; };
  feed.onerror = () => {
    note.hidden = false;
    setTimeout(() => { feed.src = '/live.mjpg?' + Date.now(); }, 2000);
  };
  feed.src = '/live.mjpg';
}

const clock = new THREE.Clock();
function animate() {
  const dt = Math.min(0.1, clock.getDelta());
  const t = clock.elapsedTime;
  if (fly) {
    const k = Math.min(1, (performance.now() - fly.t0) / fly.ms);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    controls.target.lerpVectors(fly.t[0], fly.t[1], e);
    cam.position.lerpVectors(fly.p[0], fly.p[1], e);
    cam.fov = fly.f[0] + (fly.f[1] - fly.f[0]) * e;
    cam.updateProjectionMatrix();
    if (k >= 1) fly = null;
  }
  const follow = 1 - Math.exp(-dt * 5);
  for (const o of bands.values()) {
    o.group.position.lerp(o.target, follow);
    const p = o.group.position;
    o.ring.position.set(p.x, 0.025, p.z);
    between(o.stem, new THREE.Vector3(p.x, 0.02, p.z), new THREE.Vector3(p.x, p.y - 0.12, p.z));
  }
  const strobe = (t * 4) % 1 < 0.5 ? 1 : 0.25;
  for (const o of incidents.values()) {
    o.beam.material.uniforms.strobe.value = strobe;
    o.glow.material.opacity = 0.1 + 0.3 * strobe;
    o.glow.scale.setScalar(0.85 + 0.25 * Math.sin(t * 3));
  }
  controls.update();
  renderer.render(scene, cam);
  labels.render(scene, cam);
}

function tick() {
  $('clock').textContent = new Date().toLocaleTimeString([], { hour12: false });
}

async function start() {
  S = await (await fetch('/scene.json')).json();
  $('venue').textContent = S.venue;
  $('cam-title').textContent = S.camera ? `Camera ${S.camera.name}` : 'Camera';
  if (S.camera) {
    $('lit').src = S.camera.lit;
    $('lit-toggle').hidden = false;
  }
  if (S.plan.metres_per_px) addPlan();
  else $('world-note').textContent = 'no plan scale yet: run security.py anchors';
  for (const a of S.anchors) addAnchor(a);
  if (S.camera && S.camera.pose) addCamera(S.camera);
  resize();
  setHome();
  renderer.setAnimationLoop(animate);
  startFeed();
  poll();
  tick();
  setInterval(tick, 1000);
  if (S.splat) await addSplat();
  else if (S.plan.metres_per_px) $('world-note').textContent = 'the plan as the floor: no splat yet (pipeline/splat.py)';
}

$('ack').addEventListener('click', ack);
$('overview').addEventListener('click', overview);
$('camview').addEventListener('click', cameraView);
$('plan-toggle').addEventListener('click', togglePlan);
$('lit-toggle').addEventListener('click', toggleLit);
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === '1') setMode('world');
  else if (k === '2') setMode('live');
  else if (k === '3') setMode('both');
  else if (k === 'a') ack();
  else if (k === 'o') overview();
  else if (k === 'c') cameraView();
  else if (k === 'p') togglePlan();
  else if (k === 'l') toggleLit();
});

start();
