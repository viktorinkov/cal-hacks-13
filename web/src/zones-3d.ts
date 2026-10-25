// The zones on the floor of the venue's 3D view on the Live tab: circles around the spots of each zone with a
// station (the tables, sponsor tables, stage, food and doors the crowd uses), coloured by how crowded they are
// right now by the same thresholds the bands use. A zone spread over the hall gets a circle for each part of it.

import * as THREE from 'three';
import { EXIT_COLOURS, risk } from './lib';
import { present } from './venue-map';
import type { DbConnection } from './module_bindings';
import type { Zone } from './module_bindings/types';

/** A circle grows to this radius before its spots split in two. */
const MAX_RADIUS_M = 15;
/** The circle reaches this far past its outermost spot. */
const MARGIN_M = 1.5;
/** The crowd's levels are counted again this often. */
const COUNT_MS = 500;
const LEVEL_COLOURS: Record<string, string> = { calm: '#2fd27a', busy: '#ffb020', 'very busy': '#ff5a2a' };

export type ZoneCircle = {
  zone: Zone;
  x: number;
  z: number;
  r: number;
  /** The bands inside the circle now, and how many other bands each has close by on average. */
  people: number;
  neigh: number;
  level: 'calm' | 'busy' | 'very busy';
  fill: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  edge: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
};

type Pt = [number, number];

/** The smallest circle around the points' centre that holds them all. */
function around(pts: Pt[]): { x: number; z: number; r: number } {
  const x = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const z = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return { x, z, r: Math.max(...pts.map(p => Math.hypot(p[0] - x, p[1] - z))) };
}

/** Splits the points along their longer side at the widest gap in the middle half, until every circle is small. */
function parts(pts: Pt[]): Pt[][] {
  if (pts.length < 2 || around(pts).r <= MAX_RADIUS_M) return [pts];
  const span = (k: 0 | 1) => Math.max(...pts.map(p => p[k])) - Math.min(...pts.map(p => p[k]));
  const k = span(0) >= span(1) ? 0 : 1;
  const sorted = [...pts].sort((a, b) => a[k] - b[k]);
  let cut = sorted.length >> 1;
  let gap = -1;
  for (let i = Math.max(1, sorted.length >> 2); i < Math.max(2, sorted.length - (sorted.length >> 2)); i++) {
    const g = sorted[i][k] - sorted[i - 1][k];
    if (g > gap) {
      gap = g;
      cut = i;
    }
  }
  return [...parts(sorted.slice(0, cut)), ...parts(sorted.slice(cut))];
}

export class ZoneCircles {
  readonly group = new THREE.Group();
  list: ZoneCircle[] = [];
  private key = '';
  private countedAt = 0;
  private hovered: ZoneCircle | undefined;

  constructor(layer: THREE.Object3D) {
    layer.add(this.group);
  }

  /** Draws the circles again when the zones or their spots changed, and counts the crowd in them. */
  update(conn: DbConnection, now: number) {
    const zones = [...conn.db.zone.iter()].filter(z => z.stationId !== 0);
    const spots = [...conn.db.venueSpot.iter()].filter(s => s.stationId !== 0 && s.kind !== 'exit');
    const key = `${zones.map(z => `${z.id}:${z.stationId}`).join(',')}|${spots.length}|${spots.reduce((s, p) => s + p.xM + p.yM, 0)}`;
    if (key !== this.key) {
      this.key = key;
      this.build(zones, spots.map(s => [s.stationId, s.xM, s.yM] as [number, number, number]));
      this.countedAt = 0;
    }
    if (now - this.countedAt >= COUNT_MS) {
      this.countedAt = now;
      this.count(conn);
    }
  }

  private build(zones: Zone[], spots: [number, number, number][]) {
    for (const c of this.list) {
      c.fill.geometry.dispose();
      c.edge.geometry.dispose();
      c.fill.material.dispose();
      c.edge.material.dispose();
    }
    this.group.clear();
    this.list = [];
    this.hovered = undefined;
    for (const zone of zones) {
      const pts = spots.filter(s => s[0] === zone.stationId).map(s => [s[1], s[2]] as Pt);
      if (!pts.length) continue;
      for (const part of parts(pts)) {
        const { x, z, r: spread } = around(part);
        const r = spread + MARGIN_M;
        const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 64).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
        const edge = new THREE.Mesh(new THREE.RingGeometry(Math.max(0, r - 0.35), r, 64).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
        fill.position.set(x, 0.03, z);
        edge.position.set(x, 0.04, z);
        fill.renderOrder = edge.renderOrder = 1;
        this.group.add(fill, edge);
        this.list.push({ zone, x, z, r, people: 0, neigh: 0, level: 'calm', fill, edge });
      }
    }
  }

  private count(conn: DbConnection) {
    const settings = conn.db.settings.iter().next().value;
    const wall = Date.now();
    const sums = this.list.map(() => [0, 0]);
    for (const b of conn.db.band.iter()) {
      if (!present(b, wall) || (b.xM === 0 && b.yM === 0)) continue;
      this.list.forEach((c, i) => {
        if ((b.xM - c.x) ** 2 + (b.yM - c.z) ** 2 <= c.r * c.r) {
          sums[i][0]++;
          sums[i][1] += b.neigh;
        }
      });
    }
    this.list.forEach((c, i) => {
      c.people = sums[i][0];
      c.neigh = c.people ? sums[i][1] / c.people : 0;
      c.level = risk(c.neigh, settings?.yellow ?? 3, settings?.red ?? 5);
      const colour = LEVEL_COLOURS[c.level];
      c.fill.material.color.set(colour);
      c.edge.material.color.set(colour);
      c.fill.material.opacity = c === this.hovered ? 0.4 : 0.14;
    });
  }

  /** The smallest circle around a point of the floor. */
  at(x: number, z: number): ZoneCircle | undefined {
    return this.list.filter(c => (x - c.x) ** 2 + (z - c.z) ** 2 <= c.r * c.r).sort((a, b) => a.r - b.r)[0];
  }

  hover(c: ZoneCircle | undefined) {
    if (c === this.hovered) return;
    if (this.hovered) this.hovered.fill.material.opacity = 0.14;
    this.hovered = c;
    if (c) c.fill.material.opacity = 0.4;
  }
}

/** What a circle's tooltip says: the zone, its crowd here and in the whole zone, and its exit. */
export function zoneWords(conn: DbConnection, c: ZoneCircle): [string, string[]] {
  const settings = conn.db.settings.iter().next().value;
  const yellow = settings?.yellow ?? 3;
  const red = settings?.red ?? 5;
  const wall = Date.now();
  const all = [...conn.db.band.iter()].filter(b => b.zone === c.zone.stationId && present(b, wall));
  const avg = all.length ? all.reduce((s, b) => s + b.neigh, 0) / all.length : 0;
  return [c.zone.name, [
    c.zone.description,
    `Crowd risk here: ${c.level}. ${c.people} ${c.people === 1 ? 'person' : 'people'} in this circle, ${c.neigh.toFixed(1)} other bands close by on average (busy from ${yellow}, very busy from ${red}).`,
    `The whole zone: ${all.length} of its capacity of ${c.zone.capacity}, ${risk(avg, yellow, red)}.`,
    c.zone.exitColour ? `Exit colour: ${EXIT_COLOURS[c.zone.exitColour]}.` : '',
  ].filter(Boolean)];
}
