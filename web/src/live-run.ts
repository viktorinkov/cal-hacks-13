// The live run in the organizer portal: one set of controls in the top bar on every tab (start, pause,
// resume, end the event), and on the Live tab the crowd and the open incidents in the venue's 3D view from
// the Venue setup tab, placing our bands with a click on the floor, and the decision history. The module
// runs everything; this page only shows it.

import * as THREE from 'three';
import { act, h, time } from './lib';
import { bandCode } from './band-code';
import { Crowd } from './crowd-3d';
import { present } from './venue-map';
import { venueView, type LiveView } from './venue-setup';
import type { DbConnection } from './module_bindings';
import type { IncidentMarker, LiveRun } from './module_bindings/types';

const START = { crowd: 1000, minutes: 12, pace: 8 };
/** Test bands, which need no radio. */
const TEST_BANDS = [90, 91, 92, 93, 94, 95, 96, 97, 98, 99];
/** A click moves the pointer less than this; more is a drag of the camera. */
const CLICK_PX = 5;
const HISTORY_ROWS = 60;

let conn: DbConnection;
let v: LiveView | undefined;
let crowd: Crowd;
let placing: { bandId: number; label: string } | undefined;
let hint = '';
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
  let down: { x: number; y: number } | undefined;
  v.canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  v.canvas.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_PX || !placing) return;
    const at = v!.floorAt(e);
    if (!at) {
      hint = 'That is not the venue floor. Click inside the hall.';
      return;
    }
    const p = placing;
    placing = undefined;
    hint = '';
    act(() => conn.reducers.placeBand({ bandId: p.bandId, xM: at.x, yM: at.z, label: p.label }));
  });
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

function status(r: LiveRun | undefined, list: IncidentMarker[]): string {
  if (!r || r.phase.tag === 'Idle') return 'No run yet.';
  const paused = conn.db.livePause.id.find(0);
  const now = Date.now();
  const people = [...conn.db.band.iter()].filter(b => b.id >= 100 && present(b, now)).length;
  const open = list.filter(m => m.status !== 'resolved').length;
  const count = (s: string) => list.filter(m => m.claimStatus === s).length;
  const paid = list.filter(m => m.claimStatus.startsWith('paid')).length;
  const claims = `claims: ${paid} paid, ${count('waiting for the organizer')} waiting for the organizer, ${count('refused')} refused`;
  const numbers = `${people.toLocaleString()} people, ${list.length} incidents (${open} open), ${claims}. Seed ${r.seed}.`;
  const phase = r.phase.tag === 'Running'
    ? `Running since ${time(r.startedAt)}, ${r.crowd.toLocaleString()} people at ${r.pace}× speed, ends at ${time(r.endsAt)}.`
    : r.phase.tag === 'Closing'
      ? `Doors closed at ${time(r.closingAt)}: everyone walks out and the medic finishes the open incidents.`
      : `The event ended at ${time(r.endedAt)}.`;
  return `${paused ? `Paused at ${time(paused.pausedAt)}. ` : ''}${phase} ${numbers}`;
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
  const begin = (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const bandId = Number((f.querySelector('[name="place_band"]') as HTMLSelectElement).value);
    const label = (f.querySelector('[name="place_label"]') as HTMLInputElement).value.trim();
    placing = { bandId, label };
    hint = `Click the floor where ${label || bandCode(bandId)} stands.`;
    (f.querySelector('[name="place_label"]') as HTMLInputElement).value = '';
  };
  return h('section', {},
    h('h4', {}, 'Place our band'),
    h('form', { onsubmit: begin },
      h('select', { name: 'place_band' }, ourBands().map(id => h('option', { value: id }, bandCode(id)))), ' ',
      h('input', { name: 'place_label', placeholder: 'Name, e.g. the presenter', maxlength: 40 }), ' ',
      h('button', {}, 'Place'),
      placing && [' ', h('button', { type: 'button', onclick: () => { placing = undefined; hint = ''; } }, 'Cancel')]),
    hint && h('p', {}, h('b', {}, hint)),
    placed.length > 0 && h('ul', {}, placed.map(p => h('li', {},
      `${bandCode(p.bandId)}${p.label ? ` (${p.label})` : ''} at ${p.xM.toFixed(1)}, ${p.yM.toFixed(1)} m `,
      h('button', { class: 'link', onclick: () => act(() => conn.reducers.unplaceBand({ bandId: p.bandId })) }, 'Remove')))));
}

function history() {
  const rows = [...conn.db.decision.iter()].sort((a, b) => Number(b.id - a.id)).slice(0, HISTORY_ROWS);
  return h('section', {},
    h('h4', {}, 'Decision history'),
    rows.length === 0
      ? h('p', { class: 'muted' }, 'Nothing decided yet.')
      : h('table', {},
        h('tr', {}, h('th', {}, 'Time'), h('th', {}, 'Incident'), h('th', {}, 'Who'), h('th', {}, 'Decided'), h('th', {}, 'Why')),
        rows.map(d => h('tr', {},
          h('td', {}, time(d.at)),
          h('td', {}, d.incidentId ? String(d.incidentId) : ''),
          h('td', {}, d.who === d.actor ? d.who : `${d.who} (${d.actor})`),
          h('td', {}, d.what),
          h('td', {}, d.why)))));
}

/** The run's state and its controls, for the portal's top bar. */
export function runBar(c: DbConnection, canRun: boolean) {
  conn = c;
  const r = run();
  return [h('p', {}, h('b', {}, 'Event run: '), status(r, markers(r))), canRun && controls(r)];
}

/** The Live tab's run section: the 3D view, placing our bands and the decision history. */
export function liveRunSection(c: DbConnection, canRun: boolean) {
  if (!v) setUp(c);
  else venueView(c);
  crowd.recheck();
  const r = run();
  syncPoles(going(r) ? markers(r).filter(m => m.status !== 'resolved') : []);
  return [
    h('section', {},
      v!.view, v!.note,
      h('p', { class: 'muted' }, 'Green, amber and red people are calm, busy and very busy spots; a red person lying down fell or pressed SOS, and a red pole marks each open incident. Our bands are blue.'),
      canRun && placeBands()),
    history(),
  ];
}
