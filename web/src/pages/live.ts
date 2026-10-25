// The live page (/live): the event on the venue's 3D floor, for presenting it on a big screen. Every band
// walks where the module puts it, incidents appear where they happen and the medic walks to them, and the
// decision history says who decided what and why, from the band to the payout. Anyone can watch; staff start
// the live run, close the doors, approve the claims that wait for the organizer and place our own bands on
// the floor by clicking it.

import { act, complicated, config, connect, h, idToken, mount, signIn, signOut, signedInEmail, type Config } from '../lib';
import { bandCode } from '../band-code';
import { present } from '../venue-map';
import type { DbConnection } from '../module_bindings';
import { Venue, type Spot } from '../live/venue3d';
import { CROWD_LEGEND, Crowd, isDown, isOurs } from '../live/crowd';
import { Incidents } from '../live/incidents';
import { drawHistory } from '../live/history';
import { ms, type Band, type Claim, type IncidentMarker, type LiveRun } from '../live/rows';

const QUERIES = [
  'SELECT * FROM band',
  'SELECT * FROM live_run',
  'SELECT * FROM incident_marker',
  'SELECT * FROM decision',
  'SELECT * FROM band_place',
  'SELECT * FROM venue_spot',
  'SELECT * FROM my_roles',
  'SELECT * FROM my_owner',
  'SELECT * FROM event_state',
  'SELECT * FROM claims_board',
];

/** What the Start form starts with: a thousand people for twelve minutes, moving eight times faster than the clock. */
const START = { crowd: 1000, minutes: 12, pace: 8 };
/** A click moves the pointer less than this; more is a drag of the camera. */
const CLICK_PX = 6;

let cfg: Config;
let conn: DbConnection | undefined;
let venue: Venue;
let crowd: Crowd;
let incidents: Incidents;
let focus: bigint | undefined;
let placing: { bandId: number; label: string } | undefined;
/** Panels to draw again at the next change: bands alone never redraw them. */
const dirty = { bar: true, history: true, place: true };
let pressing = false;

const $ = (id: string) => document.getElementById(id)!;

// --- Roles ---------------------------------------------------------------------------------------

function isOwner(): boolean {
  return !!conn && conn.db.myOwner.count() > 0;
}

function can(...wanted: string[]): boolean {
  if (!conn) return false;
  if (isOwner()) return true;
  const mine = new Set([...conn.db.myRoles.iter()].map(r => r.role));
  return wanted.some(r => mine.has(r));
}

/** The person a claim waits for, or anyone holding its role, as on the organizer portal. */
function approves(c: Claim): boolean {
  return !!conn && (c.routedTo.isEqual(conn.identity!) || can(c.routedToRole));
}

// --- Rows ----------------------------------------------------------------------------------------

function run(): LiveRun | undefined {
  return conn?.db.liveRun.id.find(0) ?? undefined;
}

/** The incidents of this run, or every incident when no run has started. */
function runMarkers(): IncidentMarker[] {
  const all = conn ? [...conn.db.incidentMarker.iter()] : [];
  const r = run();
  return r ? all.filter(m => ms(m.openedAt) >= ms(r.startedAt)) : all;
}

function places(): Map<number, string> {
  return new Map(conn ? [...conn.db.bandPlace.iter()].map(p => [p.bandId, p.label]) : []);
}

// --- Top bar -------------------------------------------------------------------------------------

function mmss(msLeft: number): string {
  const s = Math.max(0, Math.round(msLeft / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The phase in words, and the clock under it. */
function phase(): { key: string; label: string; clock: string } {
  const r = run();
  const now = Date.now();
  if (!r) return { key: 'idle', label: 'Not started', clock: 'Waiting for the doors to open' };
  switch (r.phase.tag) {
    case 'Running':
      return { key: 'running', label: 'Doors open', clock: `${mmss(now - ms(r.startedAt))} in · ${mmss(ms(r.endsAt) - now)} left` };
    case 'Closing':
      return { key: 'closing', label: 'Doors closed', clock: `Doors closed · the crowd walks out` };
    case 'Ended':
      return { key: 'ended', label: 'Event ended', clock: `Event ended${r.endedAt ? ` at ${r.endedAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}` };
    default:
      return { key: 'idle', label: 'Not started', clock: 'Waiting for the doors to open' };
  }
}

function stat(id: string, value: string | number, label: string) {
  return h('div', { class: 'stat' }, h('b', { id }, value), h('span', {}, label));
}

function people(): string {
  const { crowd: n } = crowd.counts();
  const r = run();
  return r && r.phase.tag === 'Running' ? `${n.toLocaleString()} / ${r.crowd.toLocaleString()}` : n.toLocaleString();
}

function startForm() {
  const submit = (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const num = (name: string) => Number((f.querySelector(`[name="${name}"]`) as HTMLInputElement).value);
    const fresh = (f.querySelector('[name="fresh"]') as HTMLInputElement).checked;
    act(() => conn!.reducers.startLiveRun({ crowdSize: num('crowd'), minutes: num('minutes'), pace: num('pace'), fresh, seed: 0n }));
  };
  return h('form', { class: 'start', onsubmit: submit },
    h('label', {}, 'Crowd', h('input', { name: 'crowd', type: 'number', min: 1, max: 2000, value: START.crowd })),
    h('label', {}, 'Minutes', h('input', { name: 'minutes', type: 'number', min: 1, max: 240, value: START.minutes })),
    h('label', {}, 'Pace', h('input', { name: 'pace', type: 'number', min: 1, max: 30, value: START.pace })),
    h('label', { title: 'Clears the decision history and retires the learned rules, so the organizer teaches the Decision Engine again' },
      h('input', { name: 'fresh', type: 'checkbox', checked: true }), 'Fresh'),
    h('button', { class: 'primary' }, 'Start the live run'));
}

function drawBar() {
  const p = phase();
  const r = run();
  const markers = runMarkers();
  const paid = markers.filter(m => m.claimStatus.startsWith('paid')).length;
  const waiting = markers.filter(m => m.claimStatus === 'waiting for the organizer').length;
  const refused = markers.filter(m => m.claimStatus === 'refused').length;
  const open = markers.filter(m => m.status !== 'resolved').length;
  const staff = can('ops');
  mount('bar',
    h('div', { class: 'brand' }, h('b', {}, 'BandIt'), h('span', {}, 'Live venue')),
    h('div', { class: 'clockbox' }, h('span', { class: `phase ${p.key}` }, p.label), h('span', { id: 'clock' }, p.clock)),
    stat('people', people(), 'people'),
    stat('incidents', markers.length, open ? `incidents · ${open} open` : 'incidents'),
    h('div', { class: 'stat claims' },
      h('b', {}, h('i', { class: 'paid' }, paid), ' · ', h('i', { class: 'waiting' }, waiting), ' · ', h('i', { class: 'refused' }, refused)),
      h('span', {}, 'claims paid · waiting · refused')),
    h('div', { class: 'spacer' }),
    staff && (r?.phase.tag === 'Running'
      ? h('button', { class: 'danger', onclick: () => act(() => conn!.reducers.endLiveRun({})) }, 'Close the doors')
      : startForm()),
    staff && r && h('span', { class: 'seed', title: 'The seed this run started with' }, `seed ${r.seed}`),
    account());
  dirty.bar = false;
  layout();
}

function account() {
  if (cfg.auth_client_id && !idToken()) return h('button', { class: 'primary', onclick: signIn }, 'Sign in to run the event');
  const email = signedInEmail();
  return email ? h('span', { class: 'who' }, email, ' ', h('button', { class: 'link', onclick: signOut }, 'Sign out')) : null;
}

/** The clock and the head count move every second without redrawing the bar. */
function tick() {
  crowd.recheck();
  // Our bands come and go with their radios: the place panel lists them again when the set changes.
  const key = ourBands().map(b => b.id).join(',');
  if (key !== oursKey) {
    oursKey = key;
    dirty.place = true;
    flush();
  }
  const clock = document.getElementById('clock');
  if (clock) clock.textContent = phase().clock;
  const n = document.getElementById('people');
  if (n) n.textContent = people();
}

// --- History -------------------------------------------------------------------------------------

function drawPanel() {
  drawHistory($('history-head'), $('history-list'), {
    decisions: conn ? [...conn.db.decision.iter()] : [],
    markers: new Map(conn ? [...conn.db.incidentMarker.iter()].map(m => [m.incidentId, m]) : []),
    claims: new Map(conn ? [...conn.db.claimsBoard.iter()].map(c => [c.id, c]) : []),
    focus,
    approves,
    onFocus: id => (id === undefined ? showAll() : focusOn(id)),
    onApprove: c => act(() => conn!.reducers.approveClaim({ claimId: c.id, amountSeenCents: c.payoutCents, packHashSeen: c.packHash, requestedCeilingCents: undefined, learn: !complicated(c) })),
  });
  dirty.history = false;
  layout();
}

/** Flies to the incident and lights its rows. */
function focusOn(id: bigint) {
  focus = id;
  incidents.focus(id);
  const at = incidents.where(id);
  if (at) venue.flyTo(at.x, at.z);
  drawPanel();
  document.querySelector('#history-list .on')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function showAll() {
  focus = undefined;
  incidents.focus(undefined);
  venue.overview();
  drawPanel();
}

// --- Our bands on the floor ----------------------------------------------------------------------

/** The ids of our bands the place panel lists, as of its last drawing. */
let oursKey = '';

/** Our bands, 1 to 99, that are on the floor now or placed. */
function ourBands(): Band[] {
  if (!conn) return [];
  const placed = places();
  const now = Date.now();
  const out: Band[] = [];
  for (let id = 1; id < 100; id++) {
    const b = conn.db.band.id.find(id);
    if (b && (present(b, now) || placed.has(id))) out.push(b);
  }
  return out;
}

function drawPlace() {
  dirty.place = false;
  if (!conn || !can('ops', 'tester')) return void $('place').replaceChildren();
  const placed = places();
  const ours = ourBands();
  const label = (id: number) => `${bandCode(id)}${placed.get(id) ? ` · ${placed.get(id)}` : ''}`;
  const start = (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const bandId = Number((f.querySelector('[name="band"]') as HTMLSelectElement).value);
    if (!bandId) return;
    placing = { bandId, label: (f.querySelector('[name="label"]') as HTMLInputElement).value.trim() };
    document.body.classList.add('placing');
    $('hint').textContent = `Click the floor where ${placing.label || bandCode(bandId)} stands. Esc cancels.`;
  };
  mount('place',
    h('h3', {}, 'Place our band'),
    !ours.length && h('p', { class: 'muted' }, 'None of our bands is online yet. Turn one on and it shows here.'),
    ours.length > 0 && h('form', { onsubmit: start },
      h('select', { name: 'band' }, ours.map(b => h('option', { value: b.id }, label(b.id)))),
      h('input', { name: 'label', placeholder: 'Name above it, e.g. the presenter', maxlength: 40 }),
      h('button', { class: 'primary' }, 'Place')),
    placed.size > 0 && h('ul', { class: 'placed' },
      [...conn.db.bandPlace.iter()].sort((a, b) => a.bandId - b.bandId).map(p => h('li', {},
        h('button', { class: 'link', onclick: () => { const at = crowd.where(p.bandId) ?? { x: p.xM, z: p.yM }; venue.flyTo(at.x, at.z); } }, `${bandCode(p.bandId)}${p.label ? ` · ${p.label}` : ''}`),
        h('button', { class: 'ghost small', onclick: () => act(() => conn!.reducers.unplaceBand({ bandId: p.bandId })) }, 'Remove')))));
  layout();
}

function stopPlacing() {
  placing = undefined;
  document.body.classList.remove('placing');
}

// --- Clicks on the floor -------------------------------------------------------------------------

function onFloorClick(x: number, y: number) {
  if (placing) {
    const at = venue.floorAt(x, y);
    if (!at) {
      $('hint').textContent = 'That is not the venue floor. Click inside the hall, or Esc to cancel.';
      return;
    }
    const p = placing;
    stopPlacing();
    act(() => conn!.reducers.placeBand({ bandId: p.bandId, xM: at.x, yM: at.z, label: p.label }));
    return;
  }
  const hit = venue.pick(x, y, [...incidents.pickables(), crowd.bodies])[0];
  if (!hit) return;
  const id = incidents.idOf(hit.object);
  if (id !== undefined) return focusOn(id);
  if (hit.object === crowd.bodies && hit.instanceId !== undefined) {
    const band = crowd.bandAt(hit.instanceId);
    if (!band || !conn) return;
    const marker = [...conn.db.incidentMarker.iter()].filter(m => m.bandId === band.id).sort((a, b) => ms(b.openedAt) - ms(a.openedAt))[0];
    if (marker && (isDown(band) || marker.status !== 'resolved')) return focusOn(marker.incidentId);
    if (isOurs(band.id)) venue.flyTo(band.xM, band.yM);
  }
}

function watchPointer(canvas: HTMLCanvasElement) {
  let down: { x: number; y: number; at: number } | undefined;
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, at: performance.now() }; });
  canvas.addEventListener('pointerup', e => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.at < 700;
    down = undefined;
    if (moved < CLICK_PX && quick && e.button === 0) onFloorClick(e.clientX, e.clientY);
  });
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (placing) stopPlacing();
    else if (focus !== undefined) showAll();
  });
}

// --- Drawing -------------------------------------------------------------------------------------

/** The camera keeps the hall clear of the bar and the history panel. */
function layout() {
  const bar = $('bar').getBoundingClientRect();
  const panel = $('history');
  const top = Math.ceil(bar.bottom) + 10;
  panel.style.top = innerWidth > 760 ? `${top}px` : '';
  const side = innerWidth > 760 ? Math.ceil(innerWidth - panel.getBoundingClientRect().left) : 0;
  venue.setInsets(top, side);
}

/** Draws the panels whose rows changed, unless a button is being pressed or someone is typing. */
function flush() {
  if (!conn || pressing) return;
  const active = document.activeElement;
  const typing = (id: string) => !!active && $(id).contains(active) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName);
  if (dirty.bar && !typing('bar')) drawBar();
  if (dirty.history) drawPanel();
  if (dirty.place && !typing('place')) drawPlace();
}

function legend() {
  const dot = (c: string) => h('i', { style: `background:${c}` });
  return [
    ...CROWD_LEGEND.map(([c, label]) => h('span', {}, dot(c), label)),
    h('span', {}, h('i', { class: 'ring', style: 'border-color:#ff2f45' }), 'incident'),
    h('span', {}, h('i', { class: 'ring', style: 'border-color:#ffb020' }), 'medic on it'),
    h('span', {}, h('i', { style: 'background:#fff;outline:2px solid #2fe08a' }), 'medic'),
  ];
}

/** The floor's names and the medic's doors: the `venue_spot` rows, or the venue's spots file before they are loaded. */
async function spots(): Promise<Spot[]> {
  const rows = conn ? [...conn.db.venueSpot.iter()] : [];
  if (rows.length) return rows.map(s => ({ kind: s.kind, name: s.name, x: s.xM, z: s.yM }));
  try {
    const file: { kind: string; name: string; x: number; z: number }[] = await (await fetch('/venue/spots.json')).json();
    return file.map(s => ({ kind: s.kind, name: s.name, x: s.x, z: s.z }));
  } catch {
    return [];
  }
}

function wire(c: DbConnection) {
  const db = c.db;
  db.band.onInsert((_ctx, b) => crowd.upsert(b));
  db.band.onUpdate((_ctx, _old, b) => crowd.upsert(b));
  db.band.onDelete((_ctx, b) => crowd.remove(b.id));
  for (const b of db.band.iter()) crowd.upsert(b);

  const marker = () => { dirty.bar = true; dirty.history = true; };
  db.incidentMarker.onInsert((_ctx, m) => { incidents.upsert(m); marker(); });
  db.incidentMarker.onUpdate((_ctx, _old, m) => { incidents.upsert(m); marker(); });
  db.incidentMarker.onDelete((_ctx, m) => { incidents.remove(m.incidentId); marker(); });
  for (const m of db.incidentMarker.iter()) incidents.upsert(m);

  const names = () => { crowd.setNames(places()); dirty.place = true; };
  db.bandPlace.onInsert(names);
  db.bandPlace.onUpdate(names);
  db.bandPlace.onDelete(names);
  names();

  const all = () => { dirty.bar = true; dirty.history = true; dirty.place = true; };
  for (const t of [db.decision, db.claimsBoard]) { t.onInsert(() => { dirty.history = true; }); t.onDelete(() => { dirty.history = true; }); }
  db.liveRun.onInsert(() => { dirty.bar = true; });
  db.liveRun.onUpdate(() => { dirty.bar = true; });
  db.liveRun.onDelete(() => { dirty.bar = true; });
  for (const t of [db.myRoles, db.myOwner, db.eventState]) { t.onInsert(all); t.onDelete(all); }
}

async function main() {
  // The 3D venue lives on the organizer portal's Live tab; opened on its own, this page goes there.
  if (window.top === window) return location.replace('/organizer#live');
  cfg = await config();
  venue = new Venue($('stage'));
  crowd = new Crowd(venue.scene);
  incidents = new Incidents(venue.scene);
  venue.onFrame(now => { crowd.frame(now); incidents.frame(now); });
  venue.setStacked(() => [...incidents.tags(), ...crowd.tags()]);
  watchPointer(venue.renderer.domElement);
  mount('legend', legend(), h('button', { class: 'ghost small', onclick: showAll }, 'Overview'));
  addEventListener('resize', () => { layout(); });
  document.addEventListener('pointerdown', e => { if ((e.target as HTMLElement).closest?.('#bar, #history, #place')) pressing = true; }, true);
  document.addEventListener('pointerup', () => setTimeout(() => { pressing = false; flush(); }, 100), true);
  document.addEventListener('focusout', () => setTimeout(flush, 0));

  const model = venue.load('/venue/venue.glb')
    .then(() => document.body.classList.add('loaded'))
    .catch(e => { $('loading').textContent = `The venue model did not load: ${e?.message ?? e}`; });

  drawBar();
  drawPanel();
  try {
    conn = await connect(QUERIES, flush);
    wire(conn);
    // The first rows arrived before the handlers: every panel draws them now.
    Object.assign(dirty, { bar: true, history: true, place: true });
    flush();
  } catch (e: any) {
    $('error').textContent = `Not connected: ${e?.message ?? e}`;
  }
  const s = await spots();
  venue.addFloorNames(s);
  incidents.setDoors(s);
  setInterval(tick, 1000);
  await model;
}

main().catch(e => { $('error').textContent = String(e?.message ?? e); });
