// The live run in the organizer portal: one set of controls in the top bar on every tab (start, pause,
// resume, end the event), and on the Live tab the crowd and the open incidents in the venue's 3D view from
// the Venue setup tab, our bands dragged from the panel onto the floor, and the decision history. The module
// runs everything; this page only shows it.

import * as THREE from 'three';
import { act, h, money, time } from './lib';
import { bandCode } from './band-code';
import { Crowd } from './crowd-3d';
import { present } from './venue-map';
import { matches, searchWords, searchable } from './table-search';
import { venueView, type LiveView } from './venue-setup';
import type { DbConnection } from './module_bindings';
import type { IncidentMarker, LiveRun } from './module_bindings/types';

const START = { crowd: 1000, minutes: 12, pace: 8 };
/** Test bands, which need no radio. */
const TEST_BANDS = [90, 91, 92, 93, 94, 95, 96, 97, 98, 99];
const HISTORY_ROWS = 60;

let conn: DbConnection;
let v: LiveView | undefined;
let crowd: Crowd;
/** A band to put on the floor: from the panel, with the name typed there, or one already placed. */
type Placing = { bandId: number; label: string; fromPanel: boolean };
/** The band being dragged, with the tag that follows the pointer. */
let dragging: (Placing & { tag: HTMLElement }) | undefined;
/** The band the panel's marker drags; it follows the band list. */
let chosenBand: number | undefined;
let hint = '';
/** A blue pin and ring on the floor where the dragged band lands if let go, big enough to see from afar. */
const pinColour = new THREE.MeshBasicMaterial({ color: '#3d8bff', side: THREE.DoubleSide });
const dropPin = new THREE.Group().add(
  new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 3.8, 12).translate(0, 1.9, 0), pinColour),
  new THREE.Mesh(new THREE.RingGeometry(1.6, 2.6, 32).rotateX(-Math.PI / 2).translate(0, 0.05, 0), pinColour));
/** A red pole over each open incident. */
const poles = new Map<bigint, THREE.Mesh>();
const poleShape = new THREE.CylinderGeometry(0.35, 0.35, 3.6, 12).translate(0, 1.8, 0);
const poleColour = new THREE.MeshBasicMaterial({ color: '#e00020' });

function setUp(c: DbConnection) {
  conn = c;
  v = venueView(c);
  crowd = new Crowd(v.layer);
  for (const b of conn.db.band.iter()) crowd.upsert(b);
  conn.db.band.onInsert((_ctx, b) => crowd.upsert(b));
  conn.db.band.onUpdate((_ctx, _old, b) => crowd.upsert(b));
  conn.db.band.onDelete((_ctx, b) => crowd.remove(b.id));
  v.onFrame(now => crowd.frame(now));
  dropPin.visible = false;
  v.layer.add(dropPin);
  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', drop);
  window.addEventListener('pointercancel', () => endDrag());
  window.addEventListener('keydown', e => { if (e.key === 'Escape') endDrag(); });
}

// --- Dragging a band onto the floor -------------------------------------------------------------

/** The spot of the floor under the pointer, if the pointer is over the 3D view and inside the hall. */
function spotUnder(e: PointerEvent) {
  return document.elementFromPoint(e.clientX, e.clientY) === v!.canvas ? v!.floorAt(e) : undefined;
}

function startDrag(e: PointerEvent, p: Placing) {
  e.preventDefault();
  // A focused list holds the page's redraws, so it lets go first.
  (document.activeElement as HTMLElement | null)?.blur();
  endDrag();
  const tag = h('span', { class: 'chip blue drag-tag' });
  document.body.append(tag);
  dragging = { ...p, tag };
  moveDrag(e);
}

function moveDrag(e: PointerEvent) {
  if (!dragging) return;
  const at = spotUnder(e);
  const who = dragging.label || bandCode(dragging.bandId);
  dragging.tag.textContent = at ? who : `${who}: drop it on the floor`;
  dragging.tag.style.left = `${e.clientX + 14}px`;
  dragging.tag.style.top = `${e.clientY + 14}px`;
  dropPin.visible = !!at;
  if (at) dropPin.position.set(at.x, 0, at.z);
}

function endDrag() {
  dragging?.tag.remove();
  dragging = undefined;
  dropPin.visible = false;
}

/** Letting go over the floor puts the band there. */
function drop(e: PointerEvent) {
  const d = dragging;
  if (!d) return;
  const at = spotUnder(e);
  endDrag();
  if (!at) {
    hint = 'Drop the band on the floor inside the hall.';
    return;
  }
  hint = '';
  // The typed name goes with the band it was typed for.
  const typed = document.querySelector('[name="place_label"]') as HTMLInputElement | null;
  if (d.fromPanel && typed) typed.value = '';
  act(() => conn.reducers.placeBand({ bandId: d.bandId, xM: at.x, yM: at.z, label: d.label }));
}

/** A band to drag onto the floor, blue like our bands in the 3D view. */
function marker(text: Node | string, take: () => Placing, title: string) {
  return h('span', { class: 'chip blue drag-band', title, onpointerdown: (e: PointerEvent) => startDrag(e, take()) }, '● ', text);
}

function run(): LiveRun | undefined {
  return conn.db.liveRun.id.find(0) ?? undefined;
}

function going(r: LiveRun | undefined): boolean {
  return r?.phase.tag === 'Running' || r?.phase.tag === 'Closing';
}

/** This run's incidents. */
function markers(r: LiveRun | undefined): IncidentMarker[] {
  if (!r) return [];
  return [...conn.db.incidentMarker.iter()].filter(m => m.openedAt.microsSinceUnixEpoch >= r.startedAt.microsSinceUnixEpoch);
}

function syncPoles(open: IncidentMarker[]) {
  const keep = new Set(open.map(m => m.incidentId));
  for (const [id, pole] of poles) if (!keep.has(id)) { pole.removeFromParent(); poles.delete(id); }
  for (const m of open) {
    let pole = poles.get(m.incidentId);
    if (!pole) {
      pole = new THREE.Mesh(poleShape, poleColour);
      poles.set(m.incidentId, pole);
      v!.layer.add(pole);
    }
    pole.position.set(m.xM, 0, m.yM);
  }
}

function phaseWords(r: LiveRun | undefined): string {
  if (!r || r.phase.tag === 'Idle') return 'Not started';
  const paused = conn.db.livePause.id.find(0);
  if (paused) return `Paused since ${time(paused.pausedAt)}`;
  if (r.phase.tag === 'Running') return 'Running';
  if (r.phase.tag === 'Closing') return `Doors closed at ${time(r.closingAt)}, everyone walking out`;
  return `Ended at ${time(r.endedAt)}`;
}

/** The run at a glance, as a plain table. */
function status(r: LiveRun | undefined, list: IncidentMarker[]) {
  const now = Date.now();
  const people = [...conn.db.band.iter()].filter(b => b.id >= 100 && present(b, now)).length;
  const row = (k: string, val: string) => h('tr', {}, h('th', {}, k), h('td', {}, val));
  if (!r || r.phase.tag === 'Idle') return h('table', {}, row('Event run', 'Not started'), row('People', people.toLocaleString()));
  const open = list.filter(m => m.status !== 'resolved').length;
  const count = (s: string) => list.filter(m => m.claimStatus === s).length;
  const paid = list.filter(m => m.claimStatus.startsWith('paid')).length;
  // The first incident comes a minute in, once the crowd has reached its tables.
  const secs = Math.max(0, Math.round((Number(r.nextIncidentAt.microsSinceUnixEpoch / 1000n) - now) / 1000));
  const next = r.phase.tag === 'Running' && !conn.db.livePause.id.find(0) ? `, next in ${secs} s` : '';
  return h('table', {},
    row('Event run', `${phaseWords(r)}: started ${time(r.startedAt)}, ends ${time(r.endsAt)}, ${r.pace}× speed`),
    row('People', `${people.toLocaleString()} of ${r.crowd.toLocaleString()}`),
    row('Incidents', `${list.length}, ${open} open${next}`),
    row('Claims', `${paid} paid, ${count('waiting for the organizer')} waiting for the organizer, ${count('refused')} refused`),
    row('Seed', String(r.seed)));
}

function controls(r: LiveRun | undefined) {
  if (going(r)) {
    const paused = conn.db.livePause.id.find(0);
    return h('p', {},
      paused
        ? h('button', { onclick: () => act(() => conn.reducers.resumeLiveRun({})) }, 'Resume')
        : h('button', { onclick: () => act(() => conn.reducers.pauseLiveRun({})) }, 'Pause'),
      ' ',
      r!.phase.tag === 'Running' && h('button', {
        onclick: () => confirm('End the event? The doors close, everyone walks out, and then every tap link switches to the recap.') && act(() => conn.reducers.endLiveRun({})),
      }, 'End the event'));
  }
  const start = (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const num = (name: string) => Number((f.querySelector(`[name="${name}"]`) as HTMLInputElement).value);
    const fresh = (f.querySelector('[name="fresh"]') as HTMLInputElement).checked;
    act(() => conn.reducers.startLiveRun({ crowdSize: num('crowd'), minutes: num('minutes'), pace: num('pace'), fresh, seed: 0n }));
  };
  const state = conn.db.eventState.id.find(0);
  return [
    h('form', { onsubmit: start },
      h('label', {}, 'People ', h('input', { name: 'crowd', type: 'number', min: 1, max: 2000, value: START.crowd })), ' ',
      h('label', {}, 'Minutes ', h('input', { name: 'minutes', type: 'number', min: 1, max: 240, value: START.minutes })), ' ',
      h('label', {}, 'Speed ', h('input', { name: 'pace', type: 'number', min: 1, max: 30, value: START.pace }), '×'), ' ',
      h('label', { title: 'Clears the decision history and retires the learned rules, so the organizer teaches them again' },
        h('input', { name: 'fresh', type: 'checkbox', checked: true }), ' Start fresh'), ' ',
      h('button', {}, 'Start the event')),
    state?.ended
      ? h('p', {}, h('button', { onclick: () => act(() => conn.reducers.reopenEvent({})) }, 'Reopen the event'), ' without a run.')
      : h('p', {}, h('button', { onclick: () => confirm('End the event? Every tap link switches to the recap.') && act(() => conn.reducers.endEvent({})) }, 'End the event'), ' without a run.'),
  ];
}

/** Our bands: radio bands 1 to 89 on the floor now, the test bands, and any band placed before. */
function ourBands(): number[] {
  const placed = new Set([...conn.db.bandPlace.iter()].map(p => p.bandId));
  const now = Date.now();
  const ids: number[] = [];
  for (let id = 1; id < 100; id++) {
    const b = conn.db.band.id.find(id);
    if (TEST_BANDS.includes(id) || placed.has(id) || (b && present(b, now))) ids.push(id);
  }
  return ids;
}

function placeBands() {
  const placed = [...conn.db.bandPlace.iter()].sort((a, b) => a.bandId - b.bandId);
  const ids = ourBands();
  if (chosenBand === undefined || !ids.includes(chosenBand)) chosenBand = ids[0];
  const code = h('span', {}, bandCode(chosenBand));
  const choose = (e: Event) => {
    chosenBand = Number((e.target as HTMLSelectElement).value);
    code.textContent = bandCode(chosenBand);
  };
  const label = () => (document.querySelector('[name="place_label"]') as HTMLInputElement | null)?.value.trim() ?? '';
  return h('section', {},
    h('h4', {}, 'Put one of our real bands on the map'),
    h('label', {}, 'Band ', h('select', { name: 'place_band', onchange: choose }, ids.map(id => h('option', { value: id, selected: id === chosenBand }, bandCode(id))))),
    h('label', {}, 'Who wears it ', h('input', { name: 'place_label', placeholder: 'Name, e.g. the presenter', maxlength: 40 })),
    h('p', {}, marker(code, () => ({ bandId: chosenBand!, label: label(), fromPanel: true }), 'Drag onto the floor of the 3D view')),
    hint && h('p', {}, h('b', {}, hint)),
    placed.length > 0 && h('ul', {}, placed.map(p => h('li', {},
      marker(`${bandCode(p.bandId)}${p.label ? ` (${p.label})` : ''}`, () => ({ bandId: p.bandId, label: p.label, fromPanel: false }), 'Drag to move it'),
      ` at ${p.xM.toFixed(1)}, ${p.yM.toFixed(1)} m `,
      h('button', { class: 'link', onclick: () => act(() => conn.reducers.unplaceBand({ bandId: p.bandId })) }, 'Remove')))));
}

function history() {
  const all = [...conn.db.decision.iter()];
  const words = searchWords('decisions');
  const hits = words.length ? all.filter(d => matches(`${time(d.at)} ${d.incidentId || ''} ${d.who} ${d.actor} ${d.what} ${d.why}`, words)) : all;
  const rows = hits.sort((a, b) => Number(b.id - a.id)).slice(0, HISTORY_ROWS);
  return h('section', {},
    h('h4', {}, 'Decision history'),
    all.length === 0
      ? h('p', { class: 'muted' }, 'Nothing decided yet.')
      : searchable('decisions', h('table', {},
        h('tr', {}, h('th', {}, 'Time'), h('th', {}, 'Who'), h('th', {}, 'Decided')),
        rows.map(d => h('tr', {},
          h('td', {}, time(d.at), d.incidentId ? [h('br'), `#${d.incidentId}`] : ''),
          h('td', {}, d.who === d.actor ? d.who : `${d.who} (${d.actor})`),
          h('td', {}, d.what, d.why && [h('br'), h('span', { class: 'muted' }, d.why)])))), rows.length < all.length));
}

/** The run's state and its controls, for the portal's top bar. */
export function runBar(c: DbConnection, canRun: boolean) {
  conn = c;
  const r = run();
  return [status(r, markers(r)), canRun && controls(r)];
}

/** This run's incidents, newest first, with what happened to each and its claim. */
function incidents(r: LiveRun | undefined, canRun: boolean) {
  const list = markers(r).sort((a, b) => Number(b.incidentId - a.incidentId));
  const claims = new Map([...conn.db.claimsBoard.iter()].map(c => [c.id, c]));
  return h('section', {},
    h('h4', {}, `Incidents (${list.length})`),
    list.length === 0
      ? h('p', { class: 'muted' }, r && r.phase.tag !== 'Idle' ? 'None yet. The first one happens about a minute after the doors open.' : 'None.')
      : searchable('incidents', h('table', {},
        h('tr', {}, h('th', {}, 'Time'), h('th', {}, 'What'), h('th', {}, 'Status'), h('th', {}, 'Claim'), h('th', {}, '')),
        list.map(m => {
          const c = claims.get(m.claimId);
          const waiting = canRun && c?.status.tag === 'Routed';
          return h('tr', {},
            h('td', {}, `${time(m.openedAt)} #${m.incidentId} ${m.kind}`, h('br'), `${m.person || ''}${m.place ? `${m.person ? ' at ' : ''}${m.place}` : ''}`),
            h('td', {}, m.status === 'responding' && m.medic ? `${m.medic} responding` : m.status,
              m.claimId ? [h('br'), `claim ${m.claimStatus}${m.payoutCents && m.claimStatus !== 'refused' ? `, ${money(m.payoutCents)}` : ''}`] : ''),
            h('td', {},
              h('button', { class: 'link', onclick: () => v!.lookAt(m.xM, m.yM) }, 'Show'),
              waiting && [' ', h('button', {
                onclick: () => act(() => conn.reducers.approveClaim({ claimId: c!.id, amountSeenCents: c!.payoutCents, packHashSeen: c!.packHash, requestedCeilingCents: undefined, learn: true })),
              }, 'Approve and teach a rule')]));
        }))));
}

/** What the colours in the 3D view mean: the band light states of the Hardware doc. */
const LEGEND: [string, string][] = [
  ['#2fd27a', 'Calm'],
  ['#ffb020', 'Busy'],
  ['#ff5a2a', 'Very busy'],
  ['#ff1030', 'SOS or a fall: red strobe; someone who fell lies down'],
  ['#2f6bff', 'The light circle around them: blue pulse'],
  ['#3d8bff', 'Our hardware and test bands'],
  ['#e00020', 'Pole: an open incident'],
];

function legend() {
  return h('section', {},
    h('h4', {}, 'Legend'),
    h('table', {}, LEGEND.map(([colour, meaning]) => h('tr', {},
      h('td', { style: `background: ${colour}; width: 24px` }),
      h('td', {}, meaning)))));
}

/** The Live tab: the incidents and the legend on the left, the 3D view in the middle, the decisions and our
 * bands on the right. */
export function liveRunSection(c: DbConnection, canRun: boolean) {
  if (!v) setUp(c);
  else venueView(c);
  crowd.recheck();
  const r = run();
  syncPoles(going(r) ? markers(r).filter(m => m.status !== 'resolved') : []);
  return h('div', { class: 'live' },
    h('div', {}, incidents(r, canRun), legend()),
    h('div', {}, h('section', {}, v!.view, v!.note)),
    h('div', {}, history(), canRun && placeBands()));
}
