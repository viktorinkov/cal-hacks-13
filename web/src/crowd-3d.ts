// The crowd in the venue's 3D view on the Live tab: every band is one instance of one mesh, walking to the
// spot the module last wrote for it instead of jumping. The colour is the band's ring as the Hardware doc's
// light states give it: green calm, amber busy, red very busy, a red strobe on SOS or a fall, and a blue
// pulse in the light circle around them. Someone who fell lies on the floor. Bands 1 to 99, our hardware and
// test bands, are blue as on the Organizer Portal's map, and a little bigger so they are easy to find.

import * as THREE from 'three';
import { present } from './venue-map';
import type { Band } from './module_bindings/types';

const MAX_BANDS = 2200;
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
const SOS_COLOUR = col('#ff1030');
const OFF_COLOUR = col('#3a0a10');
const CIRCLE_COLOUR = col('#2f6bff');
const OURS_COLOUR = col('#3d8bff');

type Walker = {
  band: Band;
  shown: boolean;
  x: number; z: number;
  fromX: number; fromZ: number; toX: number; toZ: number;
  at: number; ms: number;
  /** Metres per millisecond, steady per band. */
  speed: number;
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
  private walkers = new Map<number, Walker>();
  private list: Walker[] = [];
  /** The walker drawn in each instance this frame, for picking. */
  private slots: Walker[] = [];

  constructor(scene: THREE.Object3D) {
    const body = new THREE.CapsuleGeometry(RADIUS_M, LENGTH_M, 3, 10);
    const material = new THREE.MeshLambertMaterial({ color: '#ffffff', toneMapped: false });
    this.bodies = new THREE.InstancedMesh(body, material, MAX_BANDS);
    this.bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bodies.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BANDS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.bodies.frustumCulled = false;
    this.bodies.count = 0;
    scene.add(this.bodies);

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

  /** The band drawn in an instance, after a pick. */
  bandAt(instance: number): Band | undefined {
    return this.slots[instance]?.band;
  }

  /** Moves every band one frame along its walk and writes the instances. */
  frame(now: number) {
    const m = this.bodies.instanceMatrix.array as Float32Array;
    const c = this.bodies.instanceColor!.array as Float32Array;
    // The SOS strobe: 125 ms on, 125 ms off. The light circle: a blue pulse over 1 s.
    const strobe = Math.floor(now / 125) % 2 === 0;
    const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin((now / 1000) * Math.PI * 2));
    let n = 0;
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
      if (!w.shown || n >= MAX_BANDS) continue;
      const down = isDown(b);
      const s = ours ? PRESENTER_SCALE : 1;
      const o = n * 16;
      if (b.fall) {
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
      let colour = ours ? OURS_COLOUR : STATE_COLOURS[Math.min(b.state, 2)];
      if (down) colour = strobe ? SOS_COLOUR : OFF_COLOUR;
      const k = n * 3;
      if (b.state === CIRCLE && !down) {
        c[k] = CIRCLE_COLOUR.r * pulse; c[k + 1] = CIRCLE_COLOUR.g * pulse; c[k + 2] = CIRCLE_COLOUR.b * pulse;
      } else {
        c[k] = colour.r; c[k + 1] = colour.g; c[k + 2] = colour.b;
      }
      this.slots[n] = w;
      n++;
    }
    this.slots.length = n;
    this.bodies.count = n;
    this.bodies.instanceMatrix.needsUpdate = true;
    this.bodies.instanceColor!.needsUpdate = true;
    // A pick recomputes the bounds from the moved instances.
    this.bodies.boundingSphere = null;
    this.bodies.boundingBox = null;
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
