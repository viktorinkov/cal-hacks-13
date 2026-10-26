// The incidents in the venue's 3D view on the Live tab, one per `incident_marker` row of the run: a pulsing ring
// and a beam of light where it happened (red while open, amber while the medic responds, green once resolved),
// and a tag with who, where and, once there is a claim, how far the claim is. When the medic takes it, a medic
// walks in from the nearest door along the aisles. A resolved incident fades out 20 s later. The tags are page
// text over the canvas, above the names on the floor, and climb above each other instead of covering one another.

import * as THREE from 'three';
import { h, money } from './dom';
import { Floor, type P } from './floor-path';
import type { IncidentMarker } from '@/stdb/module_bindings/types';

const STATUS_COLOURS: Record<string, string> = { open: '#ff2f45', responding: '#ffb020', resolved: '#34d399' };
const KIND_WORDS: Record<string, string> = { fall: 'FALL', sos: 'SOS', property: 'EQUIPMENT' };
/** A resolved incident stays this long, then fades out over the last seconds. */
const STAY_MS = 20_000;
const FADE_MS = 5_000;
/** The medic walks at this speed, sped up so the walk takes at most this long: the medic treats for at least
 *  10 s, so they are there before it is resolved. */
const MEDIC_M_PER_MS = 5 / 1000;
const MEDIC_MIN_MS = 1_500;
const MEDIC_MAX_MS = 9_000;
/** The medic stops this far from the person. */
const MEDIC_GAP_M = 1.4;
const BEAM_M = 6;
/** The medic's cross floats this high. */
const CROSS_M = 2.2;
/** Tags keep this gap between them when they climb, at most this many places. */
const GAP_PX = 3;
const MAX_LIFT = 6;
const RANK: Record<string, number> = { open: 0, responding: 1, resolved: 2 };

const ms = (t: { microsSinceUnixEpoch: bigint } | undefined) => (t ? Number(t.microsSinceUnixEpoch / 1000n) : 0);

type Pin = {
  row: IncidentMarker;
  group: THREE.Group;
  disc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  ripple: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  tag: HTMLElement;
  /** The tag's text, to redraw it only when it changes. */
  said: string;
  alpha: number;
  medic?: Medic;
};

/** A medic on their way: the figure and its cross, and the walk from the door to beside the person. */
type Medic = { group: THREE.Group; cross: HTMLElement; way: P[]; along: number[]; length: number; routed: number };

/** What the incidents draw on: the 3D view's layer, the page box over its canvas and its camera. */
export type IncidentView = { layer: THREE.Object3D; view: HTMLElement; camera: THREE.PerspectiveCamera };

const ringGeometry = new THREE.RingGeometry(1.7, 2.1, 56).rotateX(-Math.PI / 2);
const discGeometry = new THREE.CircleGeometry(2.1, 56).rotateX(-Math.PI / 2);
const beamGeometry = new THREE.CylinderGeometry(0.22, 0.22, BEAM_M, 12, 1, true).translate(0, BEAM_M / 2, 0);
const medicGeometry = new THREE.CapsuleGeometry(0.34, 1.0, 3, 10);
const medicRingGeometry = new THREE.RingGeometry(0.6, 0.85, 32).rotateX(-Math.PI / 2);
const AT = new THREE.Vector3();

/** A see-through colour that does not hide what is under it. */
function tint(colour: string, opacity: number) {
  return new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
}

/** Who and where: "Maya Chen · table 112", or "Equipment · the stage". */
export function incidentTitle(m: IncidentMarker): string {
  const who = m.kind === 'property' ? 'Equipment' : m.person || 'Someone';
  return m.place ? `${who} · ${m.place}` : who;
}

/** How far the incident is: the claim once there is one, else the medic. `arrived` says the medic is there. */
export function incidentState(m: IncidentMarker, arrived: boolean): string {
  if (m.claimId !== 0n && m.claimStatus) {
    return `Claim: ${m.claimStatus}${m.payoutCents > 0n && m.claimStatus !== 'refused' ? ` · ${money(m.payoutCents)}` : ''}`;
  }
  if (m.status === 'resolved') return 'Resolved';
  if (m.status === 'responding') return `${m.medic || 'The medic'} ${arrived ? 'is with them' : 'is on the way'}`;
  return m.kind === 'property' ? 'Waiting for staff' : 'Waiting for the medic';
}

export class Incidents {
  private pins = new Map<bigint, Pin>();
  private v: IncidentView;
  /** The tags and crosses, over the canvas. */
  private box = h('div', { class: 'venue-incidents' });
  /** The module's time now, in ms since the epoch. */
  private now: () => number;
  private floor?: Floor;
  private doors: P[] = [];
  /** Goes up as the floor and the doors arrive, so a medic who set off before takes the better way. */
  private loaded = 0;

  constructor(v: IncidentView, now: () => number) {
    this.v = v;
    this.now = now;
    v.view.append(this.box);
    // The doors the medic comes in through, and the floor they walk on.
    Floor.load().then(f => { this.floor = f; this.loaded++; });
    fetch('/venue/spots.json').then(r => r.json()).then((spots: { kind: string; x: number; z: number }[]) => {
      this.doors = spots.filter(s => s.kind === 'exit' || s.kind === 'entrance').map(s => [s.x, s.z] as P);
      this.loaded++;
    }).catch(() => {});
  }

  /** Shows exactly these incidents. */
  sync(rows: IncidentMarker[]) {
    const keep = new Set(rows.map(m => m.incidentId));
    for (const id of [...this.pins.keys()]) if (!keep.has(id)) this.remove(id);
    for (const m of rows) this.upsert(m);
  }

  /** The incidents showing on the floor now. */
  shown(): IncidentMarker[] {
    return [...this.pins.values()].filter(p => p.alpha > 0).map(p => p.row);
  }

  private upsert(row: IncidentMarker) {
    let p = this.pins.get(row.incidentId);
    if (!p) {
      const group = new THREE.Group();
      const disc = new THREE.Mesh(discGeometry, tint('#ffffff', 0.14));
      const ring = new THREE.Mesh(ringGeometry, tint('#ffffff', 0.95));
      const ripple = new THREE.Mesh(ringGeometry, tint('#ffffff', 0.8));
      const beam = new THREE.Mesh(beamGeometry, tint('#ffffff', 0.32));
      disc.position.y = 0.05;
      ring.position.y = 0.07;
      ripple.position.y = 0.08;
      for (const o of [disc, ring, ripple, beam]) o.renderOrder = 3;
      group.add(disc, ring, ripple, beam);
      this.v.layer.add(group);
      const tag = h('div', { class: 'venue-incident' });
      this.box.append(tag);
      p = { row, group, disc, ring, ripple, beam, tag, said: '', alpha: 1 };
      this.pins.set(row.incidentId, p);
    }
    const moved = p.row.xM !== row.xM || p.row.yM !== row.yM;
    p.row = row;
    p.group.position.set(row.xM, 0, row.yM);
    const colour = STATUS_COLOURS[row.status] ?? STATUS_COLOURS.open;
    for (const m of [p.disc.material, p.ring.material, p.ripple.material, p.beam.material]) m.color.set(colour);
    if (p.medic && moved) p.medic.way = [];
    if (row.respondingAt && row.kind !== 'property' && !p.medic) p.medic = this.medic();
    this.label(p);
  }

  private remove(id: bigint) {
    const p = this.pins.get(id);
    if (!p) return;
    for (const g of [p.group, p.medic?.group]) {
      g?.traverse(o => ((o as THREE.Mesh).material as THREE.Material | undefined)?.dispose());
      g?.removeFromParent();
    }
    p.tag.remove();
    p.medic?.cross.remove();
    this.pins.delete(id);
  }

  private arrived(p: Pin, now: number): boolean {
    return !!p.medic && now - ms(p.row.respondingAt) >= this.walkMs(p.medic);
  }

  private label(p: Pin, now = this.now()) {
    const m = p.row;
    const kind = KIND_WORDS[m.kind] ?? m.kind.toUpperCase();
    const state = incidentState(m, this.arrived(p, now));
    const said = `${m.status}|${kind}|${incidentTitle(m)}|${state}`;
    if (said === p.said) return;
    p.said = said;
    p.tag.replaceChildren(
      h('span', { class: 'pill', style: `background: ${STATUS_COLOURS[m.status] ?? STATUS_COLOURS.open}` }, kind),
      h('b', {}, incidentTitle(m)),
      h('div', { class: m.claimStatus === 'waiting for the organizer' ? 'waiting' : '' }, state));
  }

  /** A medic: a white figure with a green ring and a cross above. It walks across the hall, so it is not part of
   *  the incident's group. */
  private medic(): Medic {
    const group = new THREE.Group();
    const body = new THREE.Mesh(medicGeometry, new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#1d6b4a', transparent: true, toneMapped: false }));
    body.position.y = 0.34 + 0.5 + 0.04;
    const ring = new THREE.Mesh(medicRingGeometry, tint('#2fe08a', 0.95));
    ring.position.y = 0.07;
    group.add(body, ring);
    group.visible = false;
    this.v.layer.add(group);
    const cross = h('div', { class: 'venue-medic' }, '+');
    this.box.append(cross);
    return { group, cross, way: [], along: [], length: 0, routed: -1 };
  }

  /** The medic's way: from the nearest door along the aisles to a step short of the person. */
  private route(p: Pin, medic: Medic) {
    const to: P = [p.row.xM, p.row.yM];
    let door: P = [to[0], to[1] + 15];
    let d = Infinity;
    for (const s of this.doors) {
      const e = Math.hypot(s[0] - to[0], s[1] - to[1]);
      if (e < d) { d = e; door = s; }
    }
    const f = this.floor;
    let way = f ? f.path(f.snap(door), f.snap(to)) : undefined;
    if (!way || way.length < 2) way = [door, to];
    const along = [0];
    for (let i = 1; i < way.length; i++) along.push(along[i - 1] + Math.hypot(way[i][0] - way[i - 1][0], way[i][1] - way[i - 1][1]));
    medic.way = way;
    medic.along = along;
    medic.length = Math.max(0, along[along.length - 1] - MEDIC_GAP_M);
    medic.routed = this.loaded;
  }

  private walkMs(medic: Medic): number {
    return Math.min(MEDIC_MAX_MS, Math.max(MEDIC_MIN_MS, medic.length / MEDIC_M_PER_MS));
  }

  /** Where the medic is `m` metres along their way. */
  private at(medic: Medic, m: number): P {
    const { way, along } = medic;
    for (let i = 1; i < way.length; i++) {
      if (m > along[i]) continue;
      const t = (m - along[i - 1]) / Math.max(1e-6, along[i] - along[i - 1]);
      return [way[i - 1][0] + (way[i][0] - way[i - 1][0]) * t, way[i - 1][1] + (way[i][1] - way[i - 1][1]) * t];
    }
    return way[way.length - 1];
  }

  frame(clock: number) {
    const now = this.now();
    const seconds = clock / 1000;
    for (const p of this.pins.values()) {
      const m = p.row;
      let alpha = 1;
      if (m.status === 'resolved') {
        const since = now - (ms(m.resolvedAt) || now);
        alpha = since < STAY_MS - FADE_MS ? 1 : Math.max(0, (STAY_MS - since) / FADE_MS);
      }
      p.alpha = alpha;
      const visible = alpha > 0;
      p.group.visible = visible;
      if (p.medic) p.medic.group.visible = visible;
      if (!visible) continue;
      const live = m.status !== 'resolved';
      const period = m.status === 'open' ? 1.1 : 1.8;
      const t = live ? (seconds / period) % 1 : 0;
      p.ripple.visible = live;
      p.ripple.scale.setScalar(1 + 1.6 * t);
      p.ripple.material.opacity = 0.8 * (1 - t) * alpha;
      p.ring.material.opacity = (live ? 0.75 + 0.25 * Math.sin(seconds * 6) : 0.7) * alpha;
      p.disc.material.opacity = 0.14 * alpha;
      p.beam.material.opacity = (live ? 0.3 + 0.12 * Math.sin(seconds * 4) : 0.12) * alpha;
      if (p.medic) this.walk(p, p.medic, now, alpha);
      // The tag's second line says when the medic arrives.
      if (m.status === 'responding' && !m.claimId) this.label(p, now);
    }
    this.place();
  }

  /** The medic walks from the nearest door, setting off when the incident was taken. */
  private walk(p: Pin, medic: Medic, now: number, alpha: number) {
    if (!medic.way.length || medic.routed !== this.loaded) this.route(p, medic);
    const t = Math.min(1, Math.max(0, (now - ms(p.row.respondingAt)) / this.walkMs(medic)));
    const [x, z] = this.at(medic, medic.length * t);
    const walking = t < 1;
    medic.group.position.set(x, walking ? Math.abs(Math.sin(now / 140)) * 0.12 : 0, z);
    medic.group.traverse(o => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (mat) mat.opacity = alpha;
    });
  }

  /** Puts the tags over their beams and the crosses over the medics. A tag that would cover another climbs above
   *  it: the open incidents first, then the newest. */
  private place() {
    const w = this.box.clientWidth;
    const ht = this.box.clientHeight;
    const shown = this.v.layer.visible && w > 0;
    const onScreen = (x: number, y: number, z: number): [number, number] | undefined => {
      AT.set(x, y, z).project(this.v.camera);
      return AT.z > 1 ? undefined : [((AT.x + 1) / 2) * w, ((1 - AT.y) / 2) * ht];
    };
    const placed: [number, number, number, number][] = [];
    const covers = (r: [number, number, number, number]) => placed.some(o => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1]);
    const pins = [...this.pins.values()]
      .sort((a, b) => (RANK[a.row.status] ?? 0) - (RANK[b.row.status] ?? 0) || (b.row.incidentId > a.row.incidentId ? 1 : -1));
    for (const p of pins) {
      const medic = p.medic;
      if (medic) {
        const c = shown && p.alpha > 0 ? onScreen(medic.group.position.x, CROSS_M, medic.group.position.z) : undefined;
        show(medic.cross, c && [c[0] - medic.cross.offsetWidth / 2, c[1] - medic.cross.offsetHeight], p.alpha);
      }
      const at = shown && p.alpha > 0 ? onScreen(p.row.xM, BEAM_M, p.row.yM) : undefined;
      if (!at) {
        show(p.tag, undefined, 0);
        continue;
      }
      const tw = p.tag.offsetWidth;
      const th = p.tag.offsetHeight;
      const rect = (lift: number): [number, number, number, number] => {
        const top = at[1] - th - lift * (th + GAP_PX);
        return [at[0] - tw / 2, top, at[0] + tw / 2, top + th];
      };
      let lift = 0;
      let r = rect(0);
      while (covers(r) && lift < MAX_LIFT) r = rect(++lift);
      placed.push(r);
      show(p.tag, [r[0], r[1]], p.alpha);
    }
  }
}

/** Shows an element with its top left corner at `at`, or hides it. */
function show(el: HTMLElement, at: number[] | undefined, alpha: number) {
  if (!at || alpha <= 0) {
    el.style.visibility = 'hidden';
    return;
  }
  el.style.visibility = 'visible';
  el.style.opacity = String(alpha);
  el.style.transform = `translate(${Math.round(at[0])}px, ${Math.round(at[1])}px)`;
}
