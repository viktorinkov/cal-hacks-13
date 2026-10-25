// The crowd in the venue's 3D view on the Live tab: every band is one instance of one mesh. Someone of the crowd
// on their way follows their walk from the module, corner by corner along the aisles at its steady speed; anyone
// else walks to the spot the module last wrote for them instead of jumping. The colour is the band's ring as the
// Hardware doc's light states give it: green calm, amber busy, red very busy, a red strobe on SOS or a fall, and
// a blue pulse in the light circle around them. Someone who fell lies on the floor. Bands 1 to 99, our hardware
// and test bands, are blue as on the Organizer Portal's map, and a little bigger so they are easy to find.

import * as THREE from 'three';
import { present } from './venue-map';
import type { Band, CrowdWalk } from './module_bindings/types';

const MAX_BANDS = 2200;
const FIRST_CROWD_BAND = 100;
const RADIUS_M = 0.3;
const LENGTH_M = 0.9;
const HALF_HEIGHT_M = RADIUS_M + LENGTH_M / 2;
const PRESENTER_SCALE = 1.6;
/** Anyone not on a walk from the module walks to their new spot at 1.1 to 1.5 m/s, as the crowd does, taking
 * at least this long. Farther than JUMP_M they stand at the new spot at once: a straight line that long would
 * cross the hall's walls or leave the building, and walking it quickly would be a sprint. */
const WALK_MIN_MS = 250;
const JUMP_M = 8;
/** Light states: 3 is SOS or down, 4 the light circle around someone down. */
const DOWN = 3;
const CIRCLE = 4;

const col = (hex: string) => new THREE.Color(hex);
const STATE_COLOURS = [col('#2fd27a'), col('#ffb020'), col('#ff5a2a')];
const SOS_COLOUR = col('#ff1030');
const OFF_COLOUR = col('#3a0a10');
const CIRCLE_COLOUR = col('#2f6bff');
const OURS_COLOUR = col('#3d8bff');

/** A walk from the module: its corners, how far along the way each corner is, and its start and end. */
type Way = {
  xs: number[]; zs: number[];
  /** Metres from the start to each corner. */
  along: number[];
  /** In the module's clock, ms since the epoch. */
  start: number; end: number;
  /** Metres per millisecond. */
  speed: number;
};

type Walker = {
  band: Band;
  shown: boolean;
  x: number; z: number;
  fromX: number; fromZ: number; toX: number; toZ: number;
  at: number; ms: number;
  /** Metres per millisecond, steady per band. */
  speed: number;
  way?: Way;
  /** On its way at the last frame. */
  walking: boolean;
};

const millis = (t: { microsSinceUnixEpoch: bigint }) => Number(t.microsSinceUnixEpoch / 1000n);

/** Where a walk is `m` metres from its start. */
function along(way: Way, m: number): [number, number] {
  const n = way.xs.length;
  if (m <= 0 || n < 2) return [way.xs[0], way.zs[0]];
  for (let i = 1; i < n; i++) {
    if (m > way.along[i]) continue;
    const t = (m - way.along[i - 1]) / Math.max(1e-6, way.along[i] - way.along[i - 1]);
    return [way.xs[i - 1] + (way.xs[i] - way.xs[i - 1]) * t, way.zs[i - 1] + (way.zs[i] - way.zs[i - 1]) * t];
  }
  return [way.xs[n - 1], way.zs[n - 1]];
}

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
  private ways = new Map<number, Way>();
  /** The module's clock is this page's plus this, in ms: from the freshest band report of the last seconds. */
  private skew = 0;
  private skewAt = -Infinity;
  /** While the run is paused: when it paused, in the module's clock. */
  private pausedAt?: number;

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

  /** The module's time now, in ms since the epoch: frozen while the run is paused. */
  private clock(): number {
    return this.pausedAt ?? this.moduleNow();
  }

  /** The module's time now, in ms since the epoch, going on while the run is paused. */
  moduleNow(): number {
    return Date.now() + this.skew;
  }

  /** On its way along a walk from the module: the walk places it, not its band's last report. */
  private following(w: Walker): boolean {
    return !!w.way && !isDown(w.band) && this.clock() < w.way.end;
  }

  /** A walk from the module started or changed. */
  walk(row: CrowdWalk) {
    const xs: number[] = [];
    const zs: number[] = [];
    const at: number[] = [];
    for (let i = 0; i + 1 < row.path.length; i += 2) {
      const n = xs.length;
      at.push(n ? at[n - 1] + Math.hypot(row.path[i] - xs[n - 1], row.path[i + 1] - zs[n - 1]) : 0);
      xs.push(row.path[i]);
      zs.push(row.path[i + 1]);
    }
    if (!xs.length) return this.unwalk(row.bandId);
    const way: Way = { xs, zs, along: at, start: millis(row.startedAt), end: millis(row.arrivesAt), speed: row.speedMps / 1000 };
    this.ways.set(row.bandId, way);
    const w = this.walkers.get(row.bandId);
    if (w) w.way = way;
  }

  unwalk(bandId: number) {
    this.ways.delete(bandId);
    const w = this.walkers.get(bandId);
    if (w) w.way = undefined;
  }

  /** The run paused at `at` (the module's clock, ms), or carries on when undefined. */
  setPaused(at?: number) {
    this.pausedAt = at;
  }

  /** A band row arrived or changed: it walks to its new spot. */
  upsert(b: Band, now = performance.now()) {
    const shown = present(b) && !(b.xM === 0 && b.yM === 0);
    if (b.id >= FIRST_CROWD_BAND && b.online) {
      // The crowd reports on every tick: the freshest report says how far the module's clock is from ours.
      const skew = millis(b.lastSeen) - Date.now();
      if (skew > this.skew || now - this.skewAt > 10_000) {
        this.skew = skew;
        this.skewAt = now;
      }
    }
    const w = this.walkers.get(b.id);
    if (!w) {
      const n: Walker = { band: b, shown, x: b.xM, z: b.yM, fromX: b.xM, fromZ: b.yM, toX: b.xM, toZ: b.yM, at: now, ms: 0, speed: (1.1 + 0.4 * hash(b.id)) / 1000, way: this.ways.get(b.id), walking: false };
      this.walkers.set(b.id, n);
      this.list.push(n);
      return;
    }
    const wasShown = w.shown;
    w.band = b;
    w.shown = shown;
    if (this.following(w)) return;
    if (w.toX === b.xM && w.toZ === b.yM) return;
    if (!wasShown) {
      // Someone who just arrived stands where they are; nobody saw them walk.
      Object.assign(w, { x: b.xM, z: b.yM, fromX: b.xM, fromZ: b.yM, toX: b.xM, toZ: b.yM, ms: 0 });
      return;
    }
    this.walkTo(w, b, now);
  }

  /** From where the walker stands to the band's spot: walking when it is near, else standing there at once. */
  private walkTo(w: Walker, b: Band, now: number) {
    const d = Math.hypot(b.xM - w.x, b.yM - w.z);
    if (d < 0.01 || d > JUMP_M) {
      Object.assign(w, { x: b.xM, z: b.yM, fromX: b.xM, fromZ: b.yM, toX: b.xM, toZ: b.yM, ms: 0 });
      return;
    }
    Object.assign(w, { fromX: w.x, fromZ: w.z, toX: b.xM, toZ: b.yM, at: now, ms: Math.max(WALK_MIN_MS, d / w.speed) });
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
    const t = this.clock();
    for (const w of this.list) {
      if (this.following(w)) {
        [w.x, w.z] = along(w.way!, (t - w.way!.start) * w.way!.speed);
        w.walking = true;
        w.ms = 0;
      } else if (w.walking) {
        // Arrived: from the end of the walk to the band's own spot, which is the same unless it steps aside.
        w.walking = false;
        const b = w.band;
        if (w.way && !isDown(b)) [w.x, w.z] = along(w.way, Infinity);
        this.walkTo(w, b, now);
      }
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
