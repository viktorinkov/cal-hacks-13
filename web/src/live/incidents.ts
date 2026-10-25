// The incidents on the 3D floor, one per `incident_marker` row: a pulsing ring and a beam of light where it
// happened (red while open, amber while someone responds, green once resolved), a tag with who and where and,
// once there is a claim, how far the claim is. When the medic takes it, a medic walks in from the nearest door.
// A resolved incident fades out 20 s later.

import * as THREE from 'three';
import { money } from '../lib';
import { drawTag, dropTag, tagSprite, zoomTag, type Tag } from './labels';
import { ms, type IncidentMarker } from './rows';
import type { Spot } from './venue3d';

const STATUS_COLOURS: Record<string, string> = { open: '#ff2f45', responding: '#ffb020', resolved: '#34d399' };
const KIND_WORDS: Record<string, string> = { fall: 'FALL', sos: 'SOS', property: 'EQUIPMENT' };
/** A resolved incident stays this long, then fades out over the last seconds. */
const STAY_MS = 20_000;
const FADE_MS = 5_000;
/** The medic walks at this speed, sped up so the walk takes at most this long. */
const MEDIC_M_PER_MS = 5 / 1000;
const MEDIC_MAX_MS = 9_000;
/** The medic stops this far from the person. */
const MEDIC_GAP_M = 1.4;
const BEAM_M = 6;

type Pin = {
  row: IncidentMarker;
  group: THREE.Group;
  disc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  ripple: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  tag: THREE.Sprite;
  medic?: THREE.Group;
  colour: THREE.Color;
};

const ringGeometry = new THREE.RingGeometry(1.7, 2.1, 56).rotateX(-Math.PI / 2);
const discGeometry = new THREE.CircleGeometry(2.1, 56).rotateX(-Math.PI / 2);
const beamGeometry = new THREE.CylinderGeometry(0.22, 0.22, BEAM_M, 12, 1, true).translate(0, BEAM_M / 2, 0);
const medicGeometry = new THREE.CapsuleGeometry(0.34, 1.0, 3, 10);
const medicRingGeometry = new THREE.RingGeometry(0.6, 0.85, 32).rotateX(-Math.PI / 2);

function glow(colour: string, opacity: number) {
  return new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
}

/** Who and where, in the words the floor shows: "Maya Chen · table 112", or "Equipment · the stage". */
export function incidentTitle(m: IncidentMarker): string {
  const who = m.kind === 'property' ? 'Equipment' : m.person || 'Someone';
  return m.place ? `${who} · ${m.place}` : who;
}

/** How far the incident is: the claim once there is one, else the medic. */
export function incidentState(m: IncidentMarker, now = Date.now()): string {
  if (m.claimId !== 0n && m.claimStatus) {
    return `Claim: ${m.claimStatus}${m.payoutCents > 0n ? ` · ${money(m.payoutCents)}` : ''}`;
  }
  if (m.status === 'resolved') return 'Resolved';
  if (m.status === 'responding') {
    const there = now - ms(m.respondingAt) > MEDIC_MAX_MS;
    return `${m.medic || 'The medic'} ${there ? 'is with them' : 'is on the way'}`;
  }
  return m.kind === 'property' ? 'Waiting for staff' : 'Waiting for the medic';
}

export class Incidents {
  private pins = new Map<bigint, Pin>();
  private scene: THREE.Scene;
  private doors: Spot[] = [];
  private focused?: bigint;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** The doors the medic comes in through. */
  setDoors(spots: Spot[]) {
    this.doors = spots.filter(s => s.kind === 'exit');
    if (!this.doors.length) this.doors = spots.filter(s => s.kind === 'entrance');
  }

  upsert(row: IncidentMarker) {
    let p = this.pins.get(row.incidentId);
    if (!p) {
      const group = new THREE.Group();
      const disc = new THREE.Mesh(discGeometry, glow('#ffffff', 0.14));
      const ring = new THREE.Mesh(ringGeometry, glow('#ffffff', 0.95));
      const ripple = new THREE.Mesh(ringGeometry, glow('#ffffff', 0.8));
      const beam = new THREE.Mesh(beamGeometry, glow('#ffffff', 0.32));
      disc.position.y = 0.05;
      ring.position.y = 0.07;
      ripple.position.y = 0.08;
      for (const o of [disc, ring, ripple, beam]) o.renderOrder = 3;
      const tag = tagSprite({ lines: [{ text: '', px: 13, color: '#fff' }] }, 20);
      tag.position.y = BEAM_M + 0.4;
      group.add(disc, ring, ripple, beam, tag);
      this.scene.add(group);
      p = { row, group, disc, ring, ripple, beam, tag, colour: new THREE.Color() };
      this.pins.set(row.incidentId, p);
    }
    p.row = row;
    p.group.position.set(row.xM, 0, row.yM);
    p.colour.set(STATUS_COLOURS[row.status] ?? STATUS_COLOURS.open);
    for (const m of [p.disc.material, p.ring.material, p.ripple.material, p.beam.material]) m.color.copy(p.colour);
    if (row.respondingAt && !p.medic) p.medic = this.medic();
    this.label(p);
  }

  remove(id: bigint) {
    const p = this.pins.get(id);
    if (!p) return;
    dropTag(p.tag);
    if (p.medic) dropTag(p.medic.userData.cross);
    for (const g of [p.group, p.medic]) {
      g?.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) (mesh.material as THREE.Material).dispose();
      });
      g?.removeFromParent();
    }
    this.pins.delete(id);
  }

  private label(p: Pin, now = Date.now()) {
    const m = p.row;
    const tag: Tag = {
      pill: { text: KIND_WORDS[m.kind] ?? m.kind.toUpperCase(), color: STATUS_COLOURS[m.status] ?? STATUS_COLOURS.open },
      lines: [
        { text: incidentTitle(m), px: 13, bold: true, color: '#ffffff' },
        { text: incidentState(m, now), px: 11, color: m.claimStatus === 'waiting for the organizer' ? '#ffd166' : '#c9d3e3' },
      ],
      background: 'rgba(10, 14, 24, 0.86)',
      border: this.focused === m.incidentId ? '#ffffff' : undefined,
    };
    drawTag(p.tag, tag);
  }

  /** A medic: a white figure with a green ring and cross, standing at the incident until it walks. */
  private medic(): THREE.Group {
    const medic = new THREE.Group();
    const body = new THREE.Mesh(medicGeometry, new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#1d6b4a', transparent: true, toneMapped: false }));
    body.position.y = 0.34 + 0.5 + 0.04;
    const ring = new THREE.Mesh(medicRingGeometry, glow('#2fe08a', 0.95));
    ring.position.y = 0.07;
    const cross = tagSprite({ lines: [{ text: '+', px: 15, bold: true, color: '#ffffff' }], background: 'rgba(22, 163, 74, 0.95)' }, 15);
    cross.position.y = 2.2;
    medic.add(body, ring, cross);
    // The medic is placed in the scene, not under the incident, since it walks across the hall.
    this.scene.add(medic);
    medic.userData.cross = cross;
    return medic;
  }

  /** The nearest door to a spot. */
  private door(x: number, z: number): { x: number; z: number } {
    let best = { x, z: z + 15 };
    let d = Infinity;
    for (const s of this.doors) {
      const e = Math.hypot(s.x - x, s.z - z);
      if (e < d) { d = e; best = { x: s.x, z: s.z }; }
    }
    return best;
  }

  /** Puts a tag's frame around the incident in focus and lifts it above the others. */
  focus(id: bigint | undefined) {
    this.focused = id;
    for (const p of this.pins.values()) {
      zoomTag(p.tag, id === undefined || id === p.row.incidentId ? 1 : 0.82);
      p.tag.renderOrder = id === p.row.incidentId ? 30 : 20;
      this.label(p);
    }
  }

  where(id: bigint): { x: number; z: number } | undefined {
    const p = this.pins.get(id);
    return p ? { x: p.row.xM, z: p.row.yM } : undefined;
  }

  /** The tags on the floor, the incident in focus first, then the open ones, the newest first. */
  tags(): THREE.Sprite[] {
    const rank = (p: Pin) => (p.row.incidentId === this.focused ? 0 : p.row.status === 'open' ? 1 : p.row.status === 'responding' ? 2 : 3);
    return [...this.pins.values()]
      .filter(p => p.group.visible)
      .sort((a, b) => rank(a) - rank(b) || (b.row.incidentId > a.row.incidentId ? 1 : -1))
      .map(p => p.tag);
  }

  /** The rings and tags a click can land on. */
  pickables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const p of this.pins.values()) if (p.group.visible) out.push(p.disc, p.tag);
    return out;
  }

  /** The incident a picked ring or tag belongs to. */
  idOf(o: THREE.Object3D): bigint | undefined {
    for (const p of this.pins.values()) if (p.disc === o || p.tag === o) return p.row.incidentId;
    return undefined;
  }

  frame(now: number) {
    const wall = Date.now();
    const seconds = now / 1000;
    for (const p of this.pins.values()) {
      const m = p.row;
      let alpha = 1;
      if (m.status === 'resolved') {
        const since = wall - (ms(m.resolvedAt) || wall);
        alpha = since < STAY_MS - FADE_MS ? 1 : Math.max(0, (STAY_MS - since) / FADE_MS);
        if (m.incidentId === this.focused) alpha = Math.max(alpha, 0.6);
      }
      const visible = alpha > 0;
      p.group.visible = visible;
      if (p.medic) p.medic.visible = visible;
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
      if (p.medic) this.walk(p, wall, alpha);
      // The tag's second line says when the medic arrives.
      if (m.status === 'responding' && !m.claimId) this.label(p, wall);
    }
  }

  /** The medic walks from the nearest door, starting when the incident was taken. */
  private walk(p: Pin, wall: number, alpha: number) {
    const m = p.row;
    const medic = p.medic!;
    const from = this.door(m.xM, m.yM);
    const dx = m.xM - from.x;
    const dz = m.yM - from.z;
    const dist = Math.hypot(dx, dz);
    const stop = Math.max(0, dist - MEDIC_GAP_M);
    const walkMs = Math.min(MEDIC_MAX_MS, Math.max(1500, stop / MEDIC_M_PER_MS));
    const t = Math.min(1, Math.max(0, (wall - ms(m.respondingAt)) / walkMs));
    const along = dist > 0 ? (stop * t) / dist : 0;
    const walking = t < 1;
    medic.position.set(from.x + dx * along, walking ? Math.abs(Math.sin(wall / 140)) * 0.12 : 0, from.z + dz * along);
    medic.traverse(o => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (mat) mat.opacity = alpha;
    });
    (medic.userData.cross as THREE.Sprite).material.opacity = alpha;
  }
}
