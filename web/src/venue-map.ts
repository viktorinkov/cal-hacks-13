// The venue map on the Live tab: the zones and booths of the `venue_plan` view, and every online band as a
// dot where the module last placed it. Band rows arrive live from the subscription; a dot glides to its
// new spot instead of jumping, and the canvas only draws while the Live tab shows it.

import { h } from './lib';
import type { DbConnection } from './module_bindings';
import type { Band, PlanArea } from './module_bindings/types';

const FIRST_CROWD_BAND = 100;
/** A dot takes this long per metre to glide to its new spot, within these bounds. */
const GLIDE_MS_PER_M = 60;
const GLIDE_MIN_MS = 400;
const GLIDE_MAX_MS = 4000;
const PAD_PX = 12;

// Crowding states 0 to 2 (calm, busy, very busy), the alarms, and bands 1 to 99, which people tap and claim.
const STATE_COLOURS = ['#3ecf8e', '#f5a623', '#e5484d'];
const ALARM = '#b00020';
const NUMBERED = '#4c8dff';

type Dot = { x: number; y: number; fromX: number; fromY: number; toX: number; toY: number; at: number; ms: number; band: Band };

let conn: DbConnection;
let box: HTMLElement | undefined;
let canvas: HTMLCanvasElement;
let drawing = false;
const dots = new Map<number, Dot>();

/** A band is on the map while it is online; bands 1 to 99 also need a report in the last 5 s. */
export function present(b: Band, now = Date.now()): boolean {
  return b.online && (b.id >= FIRST_CROWD_BAND || now - b.lastSeen.toDate().getTime() < 5000);
}

function place(b: Band) {
  const now = performance.now();
  const d = dots.get(b.id);
  if (!d) {
    dots.set(b.id, { x: b.xM, y: b.yM, fromX: b.xM, fromY: b.yM, toX: b.xM, toY: b.yM, at: now, ms: 0, band: b });
    return;
  }
  d.band = b;
  if (d.toX === b.xM && d.toY === b.yM) return;
  const dist = Math.hypot(b.xM - d.x, b.yM - d.y);
  Object.assign(d, { fromX: d.x, fromY: d.y, toX: b.xM, toY: b.yM, at: now, ms: Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, dist * GLIDE_MS_PER_M)) });
}

function setup(c: DbConnection) {
  conn = c;
  for (const b of conn.db.band.iter()) place(b);
  conn.db.band.onInsert((_ctx, b) => place(b));
  conn.db.band.onUpdate((_ctx, _old, b) => place(b));
  conn.db.band.onDelete((_ctx, b) => { dots.delete(b.id); });
  canvas = h('canvas', {}) as HTMLCanvasElement;
  box = h('div', { class: 'venue-map' }, canvas);
}

/** The plan's bounds in metres, and the scale that fits them into the canvas. */
function frame(areas: PlanArea[], width: number) {
  const zones = areas.filter(a => a.boothId === 0n);
  const x0 = Math.min(...zones.map(z => z.x0M)), x1 = Math.max(...zones.map(z => z.x1M));
  const y0 = Math.min(...zones.map(z => z.y0M)), y1 = Math.max(...zones.map(z => z.y1M));
  const scale = (width - 2 * PAD_PX) / Math.max(1, x1 - x0);
  return { x0, y0, scale, height: (y1 - y0) * scale + 2 * PAD_PX };
}

function draw() {
  if (!box?.isConnected) {
    drawing = false;
    return;
  }
  requestAnimationFrame(draw);
  const areas = [...conn.db.venuePlan.iter()];
  if (!areas.some(a => a.boothId === 0n)) return;
  const ratio = window.devicePixelRatio || 1;
  const width = box.clientWidth;
  const f = frame(areas, width);
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(f.height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(f.height * ratio);
    canvas.style.height = `${f.height}px`;
  }
  const g = canvas.getContext('2d')!;
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  g.clearRect(0, 0, width, f.height);
  const px = (x: number) => PAD_PX + (x - f.x0) * f.scale;
  const py = (y: number) => PAD_PX + (y - f.y0) * f.scale;

  const now = performance.now();
  const wall = Date.now();
  const counts = new Map<number, number>();
  for (const d of dots.values()) {
    const t = d.ms ? Math.min(1, (now - d.at) / d.ms) : 1;
    const e = t * t * (3 - 2 * t);
    d.x = d.fromX + (d.toX - d.fromX) * e;
    d.y = d.fromY + (d.toY - d.fromY) * e;
    if (present(d.band, wall)) counts.set(d.band.zone, (counts.get(d.band.zone) ?? 0) + 1);
  }

  g.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  for (const z of areas.filter(a => a.boothId === 0n)) {
    g.fillStyle = 'rgba(76, 141, 255, 0.06)';
    g.strokeStyle = '#c9d6ea';
    g.fillRect(px(z.x0M), py(z.y0M), (z.x1M - z.x0M) * f.scale, (z.y1M - z.y0M) * f.scale);
    g.strokeRect(px(z.x0M), py(z.y0M), (z.x1M - z.x0M) * f.scale, (z.y1M - z.y0M) * f.scale);
    g.fillStyle = '#333';
    g.fillText(`${z.name} · ${counts.get(z.stationId) ?? 0}`, px(z.x0M) + 4, py(z.y0M) + 13);
  }
  g.fillStyle = '#c69500';
  for (const b of areas.filter(a => a.boothId !== 0n)) g.fillRect(px(b.x0M) - 2, py(b.y0M) - 2, 4, 4);

  // The crowd first, then bands 1 to 99 on top with their numbers, and alarms last.
  const order = (d: Dot) => (d.band.sos || d.band.fall ? 2 : d.band.id >= FIRST_CROWD_BAND ? 0 : 1);
  for (const d of [...dots.values()].filter(d => present(d.band, wall)).sort((a, b) => order(a) - order(b))) {
    const crowd = d.band.id >= FIRST_CROWD_BAND;
    const alarm = d.band.sos || d.band.fall;
    g.fillStyle = alarm ? ALARM : crowd ? STATE_COLOURS[Math.min(d.band.state, 2)] : NUMBERED;
    g.beginPath();
    g.arc(px(d.x), py(d.y), alarm ? 6 : crowd ? 2.2 : 4, 0, Math.PI * 2);
    g.fill();
    if (!crowd) g.fillText(String(d.band.id), px(d.x) + 6, py(d.y) - 6);
  }
}

/** The map element; it keeps its canvas across the portal's redraws and draws while it is on the page. */
export function venueMap(c: DbConnection) {
  if (!box) setup(c);
  if (!drawing) {
    drawing = true;
    requestAnimationFrame(draw);
  }
  return box!;
}

export const MAP_LEGEND: [string, string][] = [
  [STATE_COLOURS[0], 'calm'], [STATE_COLOURS[1], 'busy'], [STATE_COLOURS[2], 'very busy'],
  [NUMBERED, 'bands 1 to 99'], [ALARM, 'fall or SOS'], ['#c69500', 'booth'],
];
