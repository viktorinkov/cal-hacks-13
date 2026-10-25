// The incidents in the venue's 3D view on the Live tab, one per `incident_marker` row of the run: a pulsing ring
// and a beam of light where it happened (red while open, amber while the medic responds, green once resolved),
// and a tag with who, where and, once there is a claim, how far the claim is. When the medic takes it, a medic
// walks in from the nearest door along the aisles. A resolved incident fades out 20 s later.

import * as THREE from 'three';
import { money } from './lib';
import { Floor, type P } from './floor-path';
import type { IncidentMarker } from './module_bindings/types';

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
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
/** Canvas pixels per CSS pixel, so tags stay sharp on retina screens. */
const RATIO = 2;
const PAD = 6;
/** Tags that would overlap on screen stack up with this gap, at most this many places. */
const STACK_GAP_PX = 3;
const MAX_LIFT = 6;
const RANK: Record<string, number> = { open: 0, responding: 1, resolved: 2 };

const ms = (t: { microsSinceUnixEpoch: bigint } | undefined) => (t ? Number(t.microsSinceUnixEpoch / 1000n) : 0);

type Line = { text: string; px: number; color: string; bold?: boolean };
type Tag = { lines: Line[]; pill?: { text: string; color: string }; background: string };

/** The camera and the canvas's size in CSS pixels at the last frame drawn, to see where tags land on screen. */
let seen: { camera: THREE.Camera; w: number; h: number } | undefined;
const ANCHOR = new THREE.Vector3();

type Pin = {
  row: IncidentMarker;
  group: THREE.Group;
  disc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  ripple: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  tag: THREE.Sprite;
  medic?: Medic;
};

/** A medic on their way: the figure, and the walk from the door to beside the person. */
type Medic = { group: THREE.Group; way: P[]; along: number[]; length: number; routed: number };

const ringGeometry = new THREE.RingGeometry(1.7, 2.1, 56).rotateX(-Math.PI / 2);
const discGeometry = new THREE.CircleGeometry(2.1, 56).rotateX(-Math.PI / 2);
const beamGeometry = new THREE.CylinderGeometry(0.22, 0.22, BEAM_M, 12, 1, true).translate(0, BEAM_M / 2, 0);
const medicGeometry = new THREE.CapsuleGeometry(0.34, 1.0, 3, 10);
const medicRingGeometry = new THREE.RingGeometry(0.6, 0.85, 32).rotateX(-Math.PI / 2);

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

// --- Tags -------------------------------------------------------------------------------------

/** A tag that stands above its anchor point and keeps the same size on screen however far the camera is. */
function tagSprite(tag: Tag, order = 20): THREE.Sprite {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true, toneMapped: false }));
  sprite.center.set(0.5, 0);
  sprite.renderOrder = order;
  sprite.frustumCulled = false;
  // Without size attenuation a sprite's scale is a share of the view's height: this many per CSS pixel.
  sprite.onBeforeRender = (renderer, _scene, camera) => {
    seen = { camera, w: renderer.domElement.clientWidth, h: renderer.domElement.clientHeight };
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 35;
    const k = (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2)) / Math.max(1, renderer.domElement.clientHeight);
    const [w, h] = sprite.userData.px as [number, number];
    if (Math.abs(sprite.scale.x - w * k) > 1e-9 || Math.abs(sprite.scale.y - h * k) > 1e-9) {
      sprite.scale.set(w * k, h * k, 1);
      sprite.updateMatrixWorld();
    }
  };
  drawTag(sprite, tag);
  return sprite;
}

/** Redraws the tag when its text changed. */
function drawTag(sprite: THREE.Sprite, tag: Tag) {
  const key = JSON.stringify(tag);
  if (sprite.userData.key === key) return;
  sprite.userData.key = key;
  const g = document.createElement('canvas').getContext('2d')!;
  const font = (l: Line) => `${l.bold ? 600 : 400} ${l.px}px ${FONT}`;
  const pillPx = Math.round((tag.lines[0]?.px ?? 12) * 0.72);
  g.font = `700 ${pillPx}px ${FONT}`;
  const pillW = tag.pill ? g.measureText(tag.pill.text).width + 12 : 0;
  const widths = tag.lines.map((l, i) => {
    g.font = font(l);
    return g.measureText(l.text).width + (i === 0 && tag.pill ? pillW + 6 : 0);
  });
  const w = Math.ceil(Math.max(1, ...widths) + 2 * (PAD + 2));
  const h = Math.ceil(tag.lines.reduce((s, l) => s + l.px * 1.3, 0) + 2 * PAD);
  g.canvas.width = w * RATIO;
  g.canvas.height = h * RATIO;
  g.scale(RATIO, RATIO);
  g.fillStyle = tag.background;
  g.beginPath();
  g.roundRect(0, 0, w, h, 6);
  g.fill();
  let y = PAD;
  tag.lines.forEach((l, i) => {
    const lh = l.px * 1.3;
    let x = PAD + 2;
    g.textBaseline = 'middle';
    if (i === 0 && tag.pill) {
      g.fillStyle = tag.pill.color;
      g.beginPath();
      g.roundRect(x, y + lh / 2 - pillPx * 0.8, pillW, pillPx * 1.6, 4);
      g.fill();
      g.font = `700 ${pillPx}px ${FONT}`;
      g.fillStyle = '#0a0e18';
      g.fillText(tag.pill.text, x + 6, y + lh / 2 + 0.5);
      x += pillW + 6;
    }
    g.font = font(l);
    g.fillStyle = l.color;
    g.fillText(l.text, x, y + lh / 2 + 0.5);
    y += lh;
  });
  const old = sprite.material.map;
  const map = new THREE.CanvasTexture(g.canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  sprite.material.map = map;
  sprite.material.needsUpdate = true;
  old?.dispose();
  sprite.userData.px = [w, h];
}

// --- Incidents --------------------------------------------------------------------------------

export class Incidents {
  private pins = new Map<bigint, Pin>();
  private layer: THREE.Object3D;
  /** The module's time now, in ms since the epoch. */
  private now: () => number;
  private floor?: Floor;
  private doors: P[] = [];
  /** Goes up as the floor and the doors arrive, so a medic who set off before takes the better way. */
  private loaded = 0;

  constructor(layer: THREE.Object3D, now: () => number) {
    this.layer = layer;
    this.now = now;
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

  /** Where an incident is on the floor, if it shows. */
  where(id: bigint): { x: number; z: number } | undefined {
    const p = this.pins.get(id);
    return p ? { x: p.row.xM, z: p.row.yM } : undefined;
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
      const tag = tagSprite({ lines: [{ text: '', px: 13, color: '#fff' }], background: 'rgba(10, 14, 24, 0.86)' });
      tag.position.y = BEAM_M + 0.4;
      group.add(disc, ring, ripple, beam, tag);
      this.layer.add(group);
      p = { row, group, disc, ring, ripple, beam, tag };
      this.pins.set(row.incidentId, p);
    }
    const moved = p.row.xM !== row.xM || p.row.yM !== row.yM;
    p.row = row;
    p.group.position.set(row.xM, 0, row.yM);
    const colour = STATUS_COLOURS[row.status] ?? STATUS_COLOURS.open;
    for (const m of [p.disc.material, p.ring.material, p.ripple.material, p.beam.material]) m.color.set(colour);
    if (p.medic && moved) p.medic.way = [];
    if (row.respondingAt && row.kind !== 'property' && !p.medic) p.medic = { group: this.medicFigure(), way: [], along: [], length: 0, routed: -1 };
    this.label(p);
  }

  private remove(id: bigint) {
    const p = this.pins.get(id);
    if (!p) return;
    for (const g of [p.group, p.medic?.group]) {
      g?.traverse(o => {
        const mat = (o as THREE.Mesh).material as THREE.Material & { map?: THREE.Texture | null } | undefined;
        mat?.map?.dispose();
        mat?.dispose();
      });
      g?.removeFromParent();
    }
    this.pins.delete(id);
  }

  private arrived(p: Pin, now: number): boolean {
    return !!p.medic && now - ms(p.row.respondingAt) >= this.walkMs(p.medic);
  }

  private label(p: Pin, now = this.now()) {
    const m = p.row;
    drawTag(p.tag, {
      pill: { text: KIND_WORDS[m.kind] ?? m.kind.toUpperCase(), color: STATUS_COLOURS[m.status] ?? STATUS_COLOURS.open },
      lines: [
        { text: incidentTitle(m), px: 13, bold: true, color: '#ffffff' },
        { text: incidentState(m, this.arrived(p, now)), px: 11, color: m.claimStatus === 'waiting for the organizer' ? '#ffd166' : '#c9d3e3' },
      ],
      background: 'rgba(10, 14, 24, 0.86)',
    });
  }

  /** A medic: a white figure with a green ring and a cross above. It walks across the hall, so it is not part of
   *  the incident's group. */
  private medicFigure(): THREE.Group {
    const medic = new THREE.Group();
    const body = new THREE.Mesh(medicGeometry, new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#1d6b4a', transparent: true, toneMapped: false }));
    body.position.y = 0.34 + 0.5 + 0.04;
    const ring = new THREE.Mesh(medicRingGeometry, tint('#2fe08a', 0.95));
    ring.position.y = 0.07;
    const cross = tagSprite({ lines: [{ text: '+', px: 15, bold: true, color: '#ffffff' }], background: 'rgba(22, 163, 74, 0.95)' }, 15);
    cross.position.y = 2.2;
    medic.add(body, ring, cross);
    medic.visible = false;
    this.layer.add(medic);
    return medic;
  }

  /** The medic's way: from the nearest door along the aisles to beside the person. */
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
    // The walk ends a step short of the person.
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
      p.tag.material.opacity = alpha;
      if (p.medic) this.walk(p, p.medic, now, alpha);
      // The tag's second line says when the medic arrives.
      if (m.status === 'responding' && !m.claimId) this.label(p, now);
    }
    this.stack();
  }

  /** Lifts tags that would cover another on screen above it: the open incidents first, the newest first. */
  private stack() {
    if (!seen) return;
    const placed: [number, number, number, number][] = [];
    const pins = [...this.pins.values()].filter(p => p.group.visible)
      .sort((a, b) => (RANK[a.row.status] ?? 0) - (RANK[b.row.status] ?? 0) || (b.row.incidentId > a.row.incidentId ? 1 : -1));
    for (const p of pins) {
      const [w, h] = p.tag.userData.px as [number, number];
      ANCHOR.set(p.row.xM, p.tag.position.y, p.row.yM).project(seen.camera);
      const x = ((ANCHOR.x + 1) / 2) * seen.w;
      const y = ((1 - ANCHOR.y) / 2) * seen.h;
      let bottom = y;
      for (let lift = 0; lift < MAX_LIFT; lift++) {
        const hit = placed.find(r => x - w / 2 < r[2] && x + w / 2 > r[0] && bottom - h < r[3] && bottom > r[1]);
        if (!hit) break;
        bottom = hit[1] - STACK_GAP_PX;
      }
      placed.push([x - w / 2, bottom - h, x + w / 2, bottom]);
      // A sprite's centre is a share of its size: below 0 the tag stands that many heights above its anchor.
      p.tag.center.y = -(y - bottom) / h;
    }
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
}
