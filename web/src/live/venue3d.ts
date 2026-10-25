// The venue's 3D floor for the live page: the Palace of Fine Arts model with the preview's lights, an oblique
// overview of the whole curved hall, camera flights to an incident, names on the floor from the venue's spots,
// and picking: what is under the pointer, and which spot of the floor it is.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fitTags, tagSprite } from './labels';

/** A spot of `spots.json` or the `venue_spot` table, in model metres (x east, z south). */
export type Spot = { kind: string; name: string; x: number; z: number };

/** Everything above this height is cut away, so the mezzanine (its underside is at 4.25 m) and the theatre roof do not hide the crowd under them. */
export const CUT_M = 4.1;
const BACKGROUND = '#0e1522';
/** The overview looks down at this angle from the south, over the hall's centre. */
const OVERVIEW_PITCH = THREE.MathUtils.degToRad(56);
const OVERVIEW_TARGET = new THREE.Vector3(0, 0, 4);
/** The overview keeps the hall this far inside the free part of the canvas, in CSS pixels. */
const FIT_MARGIN_PX = 16;
/** A flight to an incident ends this far from it, looking down at this angle. */
const CLOSE_M = 58;
const CLOSE_PITCH = THREE.MathUtils.degToRad(48);
const FLIGHT_MS = 1300;
/** Stacked tags keep this gap between them, and climb at most this many places. */
const STACK_GAP_PX = 3;
const MAX_LIFT = 8;
/** The hall's outline before the model loads: its bounding box at the floor and at the cut. */
const BOX_OUTLINE = [-107, 107].flatMap(x => [-45, 51].flatMap(z => [0, CUT_M].map(y => new THREE.Vector3(x, y, z))));

type Flight = { fromPos: THREE.Vector3; fromTarget: THREE.Vector3; toPos: THREE.Vector3; toTarget: THREE.Vector3; at: number };

export class Venue {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  model?: THREE.Object3D;
  private box: HTMLElement;
  private flight?: Flight;
  private insets = { top: 0, right: 0 };
  private frames: ((now: number) => void)[] = [];
  private ray = new THREE.Raycaster();
  /** True until someone moves the camera or it flies somewhere: the overview then follows the window's size. */
  private home = true;
  /** The floor's names, most important first, and when their overlaps were last sorted out. */
  private names: THREE.Sprite[] = [];
  private tidiedAt = 0;
  private stacked: () => THREE.Sprite[] = () => [];
  /** Points around the hall that the overview keeps on screen. */
  private outline = BOX_OUTLINE;

  constructor(box: HTMLElement) {
    this.box = box;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.localClippingEnabled = true;
    box.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(BACKGROUND);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#a7abb2', 1.6));
    const sun = new THREE.DirectionalLight('#fff8ee', 2.6);
    sun.position.set(-40, 90, 60);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 2000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
    this.controls.minDistance = 8;
    this.controls.maxDistance = 600;
    this.controls.screenSpacePanning = false;
    // Any touch of the controls ends a flight where it is.
    this.controls.addEventListener('start', () => { this.flight = undefined; this.home = false; });

    addEventListener('resize', () => this.resize());
    this.resize();
    this.overview(false);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Loads the venue model and cuts it at `CUT_M`. */
  async load(url: string) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const cut = [new THREE.Plane(new THREE.Vector3(0, -1, 0), CUT_M)];
    gltf.scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        m.clippingPlanes = cut;
        // The cut opens the walls: their inner faces show from above.
        m.side = THREE.DoubleSide;
      }
    });
    this.scene.add(gltf.scene);
    this.model = gltf.scene;
    gltf.scene.updateMatrixWorld(true);
    this.outline = floorOutline(gltf.scene) ?? BOX_OUTLINE;
    if (this.home) this.overview(false);
  }

  /** Space the page's panels cover, so the hall centres in what is left. */
  setInsets(top: number, right: number) {
    if (top === this.insets.top && right === this.insets.right) return;
    this.insets = { top, right };
    this.resize();
  }

  /** Runs every frame before the venue draws. */
  onFrame(f: (now: number) => void) {
    this.frames.push(f);
  }

  private resize() {
    const w = this.box.clientWidth || innerWidth;
    const h = this.box.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // The projection's centre moves into the free part of the canvas.
    this.camera.setViewOffset(w, h, this.insets.right / 2, -this.insets.top / 2, w, h);
    this.camera.updateProjectionMatrix();
    fitTags(this.camera, h);
    if (this.home) this.overview(false);
  }

  /** The canvas left free by the panels, in CSS pixels: left, top, right, bottom. */
  private free(): [number, number, number, number] {
    const w = this.box.clientWidth || innerWidth;
    const h = this.box.clientHeight || innerHeight;
    return [FIT_MARGIN_PX, this.insets.top + FIT_MARGIN_PX, w - this.insets.right - FIT_MARGIN_PX, h - FIT_MARGIN_PX];
  }

  /** Where the hall's outline lands on screen from a camera at `pos` looking at `target`: its bounds in CSS pixels. */
  private bounds(pos: THREE.Vector3, target: THREE.Vector3): [number, number, number, number] {
    const w = this.box.clientWidth || innerWidth;
    const h = this.box.clientHeight || innerHeight;
    const cam = this.camera;
    cam.position.copy(pos);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    const v = new THREE.Vector3();
    const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of this.outline) {
      v.copy(p).project(cam);
      const x = ((v.x + 1) / 2) * w;
      const y = ((1 - v.y) / 2) * h;
      b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
    }
    return b;
  }

  /** The whole hall from the south, as large as it fits beside the panels. */
  overview(fly = true) {
    this.home = true;
    const dir = new THREE.Vector3(0, Math.sin(OVERVIEW_PITCH), Math.cos(OVERVIEW_PITCH));
    const target = OVERVIEW_TARGET.clone();
    const [fl, ft, fr, fb] = this.free();
    const saved = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    let d = 300;
    // Twice: find the distance that fits, then move the target so the hall sits in the middle of the free space.
    for (let round = 0; round < 3; round++) {
      let lo = 20;
      let hi = 1500;
      for (let i = 0; i < 24; i++) {
        d = (lo + hi) / 2;
        const [l, t, r, b] = this.bounds(target.clone().addScaledVector(dir, d), target);
        if (l >= fl && t >= ft && r <= fr && b <= fb) hi = d;
        else lo = d;
      }
      d = hi;
      const [l, t, r, b] = this.bounds(target.clone().addScaledVector(dir, d), target);
      const metresPerPx = (2 * d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / (this.box.clientHeight || innerHeight);
      target.x += ((l + r) / 2 - (fl + fr) / 2) * metresPerPx;
      target.z += (((t + b) / 2 - (ft + fb) / 2) * metresPerPx) / Math.sin(OVERVIEW_PITCH);
    }
    this.camera.position.copy(saved.pos);
    this.camera.lookAt(saved.target);
    this.go(target.clone().addScaledVector(dir, d), target, fly);
  }

  /** Flies to a spot on the floor, keeping the direction the camera looks from. */
  flyTo(x: number, z: number) {
    this.home = false;
    const target = new THREE.Vector3(x, 0, z);
    const from = this.camera.position.clone().sub(this.controls.target);
    from.y = 0;
    if (from.lengthSq() < 1) from.set(0, 0, 1);
    from.normalize().multiplyScalar(Math.cos(CLOSE_PITCH) * CLOSE_M);
    from.y = Math.sin(CLOSE_PITCH) * CLOSE_M;
    this.go(target.clone().add(from), target, true);
  }

  private go(pos: THREE.Vector3, target: THREE.Vector3, fly: boolean) {
    if (!fly) {
      this.flight = undefined;
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.flight = { fromPos: this.camera.position.clone(), fromTarget: this.controls.target.clone(), toPos: pos, toTarget: target, at: performance.now() };
  }

  private frame() {
    const now = performance.now();
    if (this.flight) {
      const f = this.flight;
      const t = Math.min(1, (now - f.at) / FLIGHT_MS);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.camera.position.lerpVectors(f.fromPos, f.toPos, e);
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
      if (t >= 1) this.flight = undefined;
    }
    this.controls.update();
    for (const f of this.frames) f(now);
    if (now - this.tidiedAt > 200) this.tidy(now);
    this.renderer.render(this.scene, this.camera);
  }

  /** The tags that stack instead of covering each other, most important first. */
  setStacked(tags: () => THREE.Sprite[]) {
    this.stacked = tags;
  }

  /**
   * Sorts out the tags as the camera sees them now: a stacked tag that would cover one placed before it moves up
   * above it, and a floor name that would cover anything is hidden.
   */
  private tidy(now: number) {
    this.tidiedAt = now;
    const w = this.box.clientWidth || innerWidth;
    const h = this.box.clientHeight || innerHeight;
    const placed: [number, number, number, number][] = [];
    const v = new THREE.Vector3();
    const covers = (a: [number, number, number, number]) => placed.some(o => a[0] < o[2] && a[2] > o[0] && a[1] < o[3] && a[3] > o[1]);
    const rect = (s: THREE.Sprite, lift: number): [number, number, number, number] | undefined => {
      s.getWorldPosition(v).project(this.camera);
      if (v.z > 1) return undefined;
      const [pw, ph] = (s.userData.px as [number, number]).map(n => n * (s.userData.zoom ?? 1));
      const x = ((v.x + 1) / 2) * w;
      const y = ((1 - v.y) / 2) * h - lift * (ph + STACK_GAP_PX);
      return [x - pw / 2 - 2, y - ph - 1, x + pw / 2 + 2, y + 1];
    };
    const [fl, , fr] = this.free();
    for (const s of this.stacked()) {
      if (!s.visible || s.parent?.visible === false) continue;
      const base = rect(s, 0);
      if (!base) continue;
      // A tag at the edge of the free canvas slides back inside it.
      const shift = base[0] < fl ? fl - base[0] : base[2] > fr ? fr - base[2] : 0;
      const at = (lift: number) => {
        const r = rect(s, lift)!;
        return [r[0] + shift, r[1], r[2] + shift, r[3]] as [number, number, number, number];
      };
      let lift = 0;
      let r = at(0);
      while (lift < MAX_LIFT && covers(r)) r = at(++lift);
      const [pw, ph] = s.userData.px as [number, number];
      const zoom = s.userData.zoom ?? 1;
      s.center.set(0.5 - shift / (pw * zoom), -lift * (1 + STACK_GAP_PX / (ph * zoom)));
      placed.push(r);
    }
    for (const s of this.names) {
      const r = rect(s, 0);
      const free = !!r && !covers([r[0] - 4, r[1] - 1, r[2] + 4, r[3] + 1]);
      s.visible = free;
      if (free) placed.push(r!);
    }
  }

  private aim(clientX: number, clientY: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
  }

  /** What of `objects` is under the pointer, nearest first. */
  pick(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Intersection[] {
    this.aim(clientX, clientY);
    return this.ray.intersectObjects(objects, true);
  }

  /** The spot of the venue floor under the pointer: the first surface below the cut that faces up. */
  floorAt(clientX: number, clientY: number): { x: number; z: number } | undefined {
    if (!this.model) return undefined;
    this.aim(clientX, clientY);
    const hit = this.ray.intersectObject(this.model, true).find(i => i.point.y < CUT_M - 0.05 && (i.face?.normal.y ?? 0) > 0.5);
    return hit ? { x: hit.point.x, z: hit.point.z } : undefined;
  }

  /** Names on the floor: the areas, the named places and the doors, each name once. */
  addFloorNames(spots: Spot[]) {
    const group = new THREE.Group();
    const named: Spot[] = [];
    const add = (s: Spot) => {
      if (named.some(n => n.name === s.name && Math.hypot(n.x - s.x, n.z - s.z) < 25)) return;
      named.push(s);
    };
    spots.filter(s => s.kind === 'area').forEach(add);
    spots.filter(s => s.kind === 'place').forEach(add);
    spots.filter(s => s.kind === 'exit').forEach(add);
    for (const s of named) {
      const area = s.kind === 'area';
      const tag = tagSprite({
        lines: [{ text: area ? s.name.toUpperCase() : s.name, px: area ? 13 : 11, bold: area, color: area ? 'rgba(235, 241, 250, 0.82)' : s.kind === 'exit' ? 'rgba(130, 220, 255, 0.85)' : 'rgba(205, 213, 225, 0.72)' }],
      }, 1);
      tag.position.set(s.x, area ? 3.2 : 2.6, s.z);
      group.add(tag);
      this.names.push(tag);
    }
    this.scene.add(group);
    return group;
  }
}

/** The corners of the venue's floor slab, the widest flat mesh of the model, at the floor and at the cut. */
function floorOutline(model: THREE.Object3D): THREE.Vector3[] | undefined {
  let best: THREE.Mesh | undefined;
  let area = 0;
  model.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    g.computeBoundingBox();
    const b = g.boundingBox!;
    const a = (b.max.x - b.min.x) * (b.max.z - b.min.z);
    if (b.max.y - b.min.y < 0.6 && a > area) { area = a; best = mesh; }
  });
  if (!best) return undefined;
  const pos = best.geometry.getAttribute('position');
  const step = Math.max(1, Math.floor(pos.count / 400));
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i += step) {
    const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(best.matrixWorld);
    out.push(new THREE.Vector3(p.x, 0, p.z), new THREE.Vector3(p.x, CUT_M, p.z));
  }
  return out;
}
