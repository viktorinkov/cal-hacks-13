// The crowd on the 3D floor: every band the page shows is one instance of one mesh, walking to the spot the
// module last wrote for it instead of jumping. The colour is the band's light: calm, busy, very busy, the
// light circle pulsing around someone down, and the person down lying flat in bright red with a pulsing ring.
// Bands 1 to 99 are the presenters' real bands: bigger, blue, with a ring and their name above them.

import * as THREE from 'three';
import { bandCode } from '../band-code';
import { present } from '../venue-map';
import { drawTag, dropTag, tagSprite } from './labels';
import type { Band } from './rows';

const MAX_BANDS = 2200;
const MAX_RINGS = 256;
const FIRST_CROWD_BAND = 100;
const RADIUS_M = 0.3;
const LENGTH_M = 0.9;
const HALF_HEIGHT_M = RADIUS_M + LENGTH_M / 2;
const PRESENTER_SCALE = 1.6;
/** People walk at 2.5 to 5 m/s; a long walk is sped up to take at most this long. */
const WALK_MIN_MS = 250;
const WALK_MAX_MS = 4500;
/** Light states: 3 is SOS or down, 4 the light circle around someone down. */
const DOWN = 3;
const CIRCLE = 4;

const col = (hex: string) => new THREE.Color(hex);
const STATE_COLOURS = [col('#2fd27a'), col('#ffb020'), col('#ff5a2a')];
const DOWN_COLOUR = col('#ff1030');
const CIRCLE_A = col('#ff2a3d');
const CIRCLE_B = col('#ffffff');
const PRESENTER_COLOUR = col('#3d8bff');
export const CROWD_LEGEND: [string, string][] = [
  ['#2fd27a', 'calm'], ['#ffb020', 'busy'], ['#ff5a2a', 'very busy'], ['#ff2a3d', 'light circle'],
  ['#ff1030', 'down'], ['#3d8bff', 'our bands'],
];

type Walker = {
  band: Band;
  shown: boolean;
  x: number; z: number;
  fromX: number; fromZ: number; toX: number; toZ: number;
  at: number; ms: number;
  /** Metres per millisecond, steady per band. */
  speed: number;
  tag?: THREE.Sprite;
};

/** The band's light is down: it fell or pressed SOS. */
export function isDown(b: Band): boolean {
  return b.state === DOWN || b.sos || b.fall;
}

/** True for the presenters' bands, 1 to 99. */
export function isOurs(id: number): boolean {
  return id > 0 && id < FIRST_CROWD_BAND;
}

export class Crowd {
  readonly bodies: THREE.InstancedMesh;
  readonly rings: THREE.InstancedMesh;
  private walkers = new Map<number, Walker>();
  private list: Walker[] = [];
  /** The walker drawn in each instance this frame, for picking. */
  private slots: Walker[] = [];
  private names = new Map<number, string>();
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const body = new THREE.CapsuleGeometry(RADIUS_M, LENGTH_M, 3, 10);
    const material = new THREE.MeshLambertMaterial({ color: '#ffffff', toneMapped: false });
    this.bodies = new THREE.InstancedMesh(body, material, MAX_BANDS);
    this.bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bodies.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BANDS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.bodies.frustumCulled = false;
    this.bodies.count = 0;
    scene.add(this.bodies);

    const ring = new THREE.RingGeometry(0.75, 1, 40).rotateX(-Math.PI / 2);
    // Added light, so a ring fades out by dimming its colour.
    const ringMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    this.rings = new THREE.InstancedMesh(ring, ringMaterial, MAX_RINGS);
    this.rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RINGS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.rings.frustumCulled = false;
    this.rings.renderOrder = 2;
    this.rings.count = 0;
    scene.add(this.rings);
  }

  /** A band row arrived or changed: it walks to its new spot. */
  upsert(b: Band, now = performance.now()) {
    const shown = present(b) && !(b.xM === 0 && b.yM === 0);
    const w = this.walkers.get(b.id);
    if (!w) {
      const n: Walker = { band: b, shown, x: b.xM, z: b.yM, fromX: b.xM, fromZ: b.yM, toX: b.xM, toZ: b.yM, at: now, ms: 0, speed: (2.5 + 2.5 * hash(b.id)) / 1000 };
      this.walkers.set(b.id, n);
      this.list.push(n);
      return;
    }
    const wasShown = w.shown;
    w.band = b;
    w.shown = shown;
    if (w.toX === b.xM && w.toZ === b.yM) return;
    if (!wasShown) {
      // Someone who just arrived stands where they are; nobody saw them walk.
      Object.assign(w, { x: b.xM, z: b.yM, fromX: b.xM, fromZ: b.yM, toX: b.xM, toZ: b.yM, ms: 0 });
      return;
    }
    const d = Math.hypot(b.xM - w.x, b.yM - w.z);
    Object.assign(w, { fromX: w.x, fromZ: w.z, toX: b.xM, toZ: b.yM, at: now, ms: Math.min(WALK_MAX_MS, Math.max(WALK_MIN_MS, d / w.speed)) });
  }

  remove(id: number) {
    const w = this.walkers.get(id);
    if (!w) return;
    this.walkers.delete(id);
    this.list.splice(this.list.indexOf(w), 1);
    if (w.tag) dropTag(w.tag);
  }

  /** The presenters' names from `band_place`, shown above their bands. */
  setNames(names: Map<number, string>) {
    this.names = names;
    for (const w of this.list) if (w.tag) this.drawName(w);
  }

  /** Bands 1 to 99 drop off the floor 5 s after their last report, so they are checked again each second. */
  recheck() {
    const now = Date.now();
    for (const w of this.list) {
      if (!isOurs(w.band.id)) continue;
      w.shown = present(w.band, now) && !(w.band.xM === 0 && w.band.yM === 0);
    }
  }

  /** Where a band stands now, if it is on the floor. */
  where(id: number): { x: number; z: number } | undefined {
    const w = this.walkers.get(id);
    return w?.shown ? { x: w.x, z: w.z } : undefined;
  }

  /** How many crowd bands and how many of our bands are on the floor. */
  counts(): { crowd: number; ours: number } {
    let crowd = 0;
    let ours = 0;
    for (const w of this.list) if (w.shown) isOurs(w.band.id) ? ours++ : crowd++;
    return { crowd, ours };
  }

  /** The names above our bands on the floor. */
  tags(): THREE.Sprite[] {
    const out: THREE.Sprite[] = [];
    for (const w of this.list) if (w.tag?.visible) out.push(w.tag);
    return out;
  }

  /** The band drawn in an instance, after a pick. */
  bandAt(instance: number): Band | undefined {
    return this.slots[instance]?.band;
  }

  private drawName(w: Walker) {
    const name = this.names.get(w.band.id);
    drawTag(w.tag!, {
      lines: name ? [{ text: name, px: 13, bold: true, color: '#ffffff' }, { text: bandCode(w.band.id), px: 10, color: '#cfe0ff' }] : [{ text: bandCode(w.band.id), px: 12, bold: true, color: '#ffffff' }],
      background: 'rgba(29, 92, 220, 0.92)',
    });
  }

  /** Moves every band one frame along its walk and writes the instances. */
  frame(now: number) {
    const m = this.bodies.instanceMatrix.array as Float32Array;
    const c = this.bodies.instanceColor!.array as Float32Array;
    const rm = this.rings.instanceMatrix.array as Float32Array;
    const rc = this.rings.instanceColor!.array as Float32Array;
    const seconds = now / 1000;
    const flash = 0.5 + 0.5 * Math.sin(seconds * Math.PI * 3);
    const ripple = (seconds * 0.8) % 1;
    let n = 0;
    let r = 0;
    for (const w of this.list) {
      if (w.ms) {
        const t = Math.min(1, (now - w.at) / w.ms);
        const e = t * t * (3 - 2 * t);
        w.x = w.fromX + (w.toX - w.fromX) * e;
        w.z = w.fromZ + (w.toZ - w.fromZ) * e;
        if (t >= 1) w.ms = 0;
      }
      const b = w.band;
      const ours = isOurs(b.id);
      if (ours) this.nameTag(w);
      if (!w.shown || n >= MAX_BANDS) continue;
      const down = isDown(b);
      const s = ours ? PRESENTER_SCALE : 1;
      const o = n * 16;
      if (down) {
        // Lying on the floor: the capsule turned onto its side.
        m[o] = 0; m[o + 1] = s; m[o + 2] = 0; m[o + 3] = 0;
        m[o + 4] = -s; m[o + 5] = 0; m[o + 6] = 0; m[o + 7] = 0;
        m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = s; m[o + 11] = 0;
        m[o + 12] = w.x; m[o + 13] = RADIUS_M * s + 0.02; m[o + 14] = w.z; m[o + 15] = 1;
      } else {
        m[o] = s; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0;
        m[o + 4] = 0; m[o + 5] = s; m[o + 6] = 0; m[o + 7] = 0;
        m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = s; m[o + 11] = 0;
        m[o + 12] = w.x; m[o + 13] = HALF_HEIGHT_M * s + 0.04; m[o + 14] = w.z; m[o + 15] = 1;
      }
      let colour = ours ? PRESENTER_COLOUR : STATE_COLOURS[Math.min(b.state, 2)];
      if (down) colour = DOWN_COLOUR;
      const k = n * 3;
      if (b.state === CIRCLE && !down) {
        c[k] = CIRCLE_A.r + (CIRCLE_B.r - CIRCLE_A.r) * flash;
        c[k + 1] = CIRCLE_A.g + (CIRCLE_B.g - CIRCLE_A.g) * flash;
        c[k + 2] = CIRCLE_A.b + (CIRCLE_B.b - CIRCLE_A.b) * flash;
      } else {
        c[k] = colour.r; c[k + 1] = colour.g; c[k + 2] = colour.b;
      }
      this.slots[n] = w;
      n++;
      if ((down || ours) && r < MAX_RINGS) {
        // The down band's ring ripples outwards; ours stands steady under it.
        const rs = down ? 1 + 1.4 * ripple : 1.3;
        const ro = r * 16;
        rm[ro] = rs; rm[ro + 1] = 0; rm[ro + 2] = 0; rm[ro + 3] = 0;
        rm[ro + 4] = 0; rm[ro + 5] = 1; rm[ro + 6] = 0; rm[ro + 7] = 0;
        rm[ro + 8] = 0; rm[ro + 9] = 0; rm[ro + 10] = rs; rm[ro + 11] = 0;
        rm[ro + 12] = w.x; rm[ro + 13] = 0.06; rm[ro + 14] = w.z; rm[ro + 15] = 1;
        const rc0 = down ? DOWN_COLOUR : PRESENTER_COLOUR;
        const fade = down ? 1 - ripple : 1;
        rc[r * 3] = rc0.r * fade; rc[r * 3 + 1] = rc0.g * fade; rc[r * 3 + 2] = rc0.b * fade;
        r++;
      }
    }
    this.slots.length = n;
    this.bodies.count = n;
    this.rings.count = r;
    this.bodies.instanceMatrix.needsUpdate = true;
    this.bodies.instanceColor!.needsUpdate = true;
    this.rings.instanceMatrix.needsUpdate = true;
    this.rings.instanceColor!.needsUpdate = true;
    // A pick recomputes the bounds from the moved instances.
    this.bodies.boundingSphere = null;
    this.bodies.boundingBox = null;
  }

  /** Our band's name floats above it while it is on the floor. */
  private nameTag(w: Walker) {
    if (!w.shown) {
      if (w.tag) w.tag.visible = false;
      return;
    }
    if (!w.tag) {
      w.tag = tagSprite({ lines: [{ text: '', px: 12, color: '#fff' }] }, 12);
      this.drawName(w);
      this.scene.add(w.tag);
    }
    w.tag.visible = true;
    w.tag.position.set(w.x, isDown(w.band) ? 1.4 : 3.3, w.z);
  }
}

/** A steady number from 0 to 1 for a band, so each walks at its own pace. */
function hash(id: number): number {
  let x = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
