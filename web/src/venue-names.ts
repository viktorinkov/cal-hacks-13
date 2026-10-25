// Text on the Live tab's 3D venue, drawn as page text over the canvas so the cut at the mezzanine never clips
// it: the names on the floor (the areas, every sponsor at its tables, the named places and the doors) and a tag
// above each of our bands with the name of who wears it. Our bands' tags climb above each other instead of
// covering one another; a floor name that would cover a tag is hidden, and close up a sponsor's name climbs a
// line or two first, so neighbouring tables all show theirs.

import * as THREE from 'three';
import { h } from './lib';

/** A spot of `spots.json` or the `venue_spot` table, in model metres (x east, z south). */
export type Spot = { kind: string; name: string; x: number; z: number };
/** One of our bands on the floor, where it stands now. */
export type BandTag = { id: number; x: number; z: number; down: boolean; name: string; code: string };

type Label = { el: HTMLElement; at: THREE.Vector3; w: number; h: number; climb: number; key: string };
type Rect = [number, number, number, number];

/** Tags keep this gap between them when they climb, and our bands' climb at most this many places. */
const GAP_PX = 3;
const MAX_LIFT = 8;
/** Tables of the same sponsor that stand side by side, at most this far apart, share one name. */
const SPONSOR_GAP_M = 4;
/** A sponsor's name climbs at most this many places above the names next to it. */
const SPONSOR_CLIMB = 2;
/** Sponsors' names climb only with the camera this close: from the overview a climbed name would sit over another sponsor's tables. */
const CLIMB_WITHIN_M = 150;

export class VenueNames {
  readonly box = h('div', { class: 'venue-names' });
  /** The floor's names, most important first. */
  private floor: Label[] = [];
  private bands = new Map<number, Label>();
  private v = new THREE.Vector3();

  /** Names on the floor: the areas, the sponsors at their tables, the named places and the doors, each name once. */
  setSpots(spots: Spot[]) {
    for (const l of this.floor) l.el.remove();
    const named: Spot[] = [];
    const add = (s: Spot) => {
      if (named.some(n => n.name === s.name && Math.hypot(n.x - s.x, n.z - s.z) < 25)) return;
      named.push(s);
    };
    spots.filter(s => s.kind === 'area').forEach(add);
    sponsors(spots).forEach(add);
    spots.filter(s => s.kind === 'place').forEach(add);
    spots.filter(s => s.kind === 'exit').forEach(add);
    this.floor = named.map(s => {
      const el = h('span', { class: `venue-name ${s.kind}` }, s.kind === 'area' ? s.name.toUpperCase() : s.name);
      this.box.append(el);
      const y = s.kind === 'area' ? 3.2 : s.kind === 'sponsor_table' ? 1.6 : 2.6;
      return { el, at: new THREE.Vector3(s.x, y, s.z), w: 0, h: 0, climb: s.kind === 'sponsor_table' ? SPONSOR_CLIMB : 0, key: '' };
    });
  }

  /** Our bands on the floor now: a tag follows each one, with the name of who wears it over its code. */
  setBands(tags: BandTag[]) {
    const seen = new Set<number>();
    for (const t of tags) {
      seen.add(t.id);
      let l = this.bands.get(t.id);
      if (!l) {
        l = { el: h('span', { class: 'venue-name band' }), at: new THREE.Vector3(), w: 0, h: 0, climb: MAX_LIFT, key: '' };
        this.box.append(l.el);
        this.bands.set(t.id, l);
      }
      const key = `${t.name}|${t.code}`;
      if (l.key !== key) {
        l.key = key;
        l.el.replaceChildren(...(t.name ? [h('b', {}, t.name), h('small', {}, t.code)] : [h('b', {}, t.code)]));
        l.w = 0;
      }
      l.at.set(t.x, t.down ? 1.4 : 3.3, t.z);
    }
    for (const [id, l] of this.bands) {
      if (seen.has(id)) continue;
      l.el.remove();
      this.bands.delete(id);
    }
  }

  /**
   * Places every tag for this frame: our bands' first, each climbing above the ones it would cover, then the
   * floor's names, each hidden where it would cover one placed before it.
   */
  draw(camera: THREE.PerspectiveCamera, target: THREE.Vector3, floorShown: boolean, bandsShown: boolean) {
    const w = this.box.clientWidth;
    const ht = this.box.clientHeight;
    const placed: Rect[] = [];
    const covers = (r: Rect) => placed.some(o => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1]);
    const close = camera.position.distanceTo(target) < CLIMB_WITHIN_M;
    const place = (l: Label, shown: boolean, climb: number, pad: number) => {
      if (!shown) return hide(l);
      this.v.copy(l.at).project(camera);
      if (this.v.z > 1) return hide(l);
      if (!l.w) [l.w, l.h] = [l.el.offsetWidth, l.el.offsetHeight];
      const x = ((this.v.x + 1) / 2) * w;
      const y = ((1 - this.v.y) / 2) * ht;
      const rect = (lift: number): Rect => {
        const top = y - l.h - lift * (l.h + GAP_PX);
        return [x - l.w / 2 - pad, top - 1, x + l.w / 2 + pad, top + l.h + 1];
      };
      let lift = 0;
      let r = rect(0);
      while (covers(r) && lift < climb) r = rect(++lift);
      if (covers(r) && climb < MAX_LIFT) return hide(l);
      l.el.style.visibility = 'visible';
      l.el.style.transform = `translate(${Math.round(r[0] + pad)}px, ${Math.round(r[1] + 1)}px)`;
      placed.push(r);
    };
    for (const l of this.bands.values()) place(l, bandsShown, MAX_LIFT, 2);
    for (const l of this.floor) place(l, floorShown, close ? l.climb : 0, 4);
  }
}

function hide(l: Label) {
  l.el.style.visibility = 'hidden';
}

/** One spot per sponsor's row of tables, at the middle of the row. */
function sponsors(spots: Spot[]): Spot[] {
  const rows: Spot[][] = [];
  for (const s of spots.filter(s => s.kind === 'sponsor_table')) {
    const row = rows.find(r => r[0].name === s.name && r.some(t => Math.hypot(t.x - s.x, t.z - s.z) <= SPONSOR_GAP_M));
    if (row) row.push(s);
    else rows.push([s]);
  }
  return rows.map(r => ({ kind: 'sponsor_table', name: r[0].name, x: r.reduce((a, t) => a + t.x, 0) / r.length, z: r.reduce((a, t) => a + t.z, 0) / r.length }));
}
