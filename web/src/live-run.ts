// The live run in the organizer portal: one set of controls in the top bar on every tab (start, pause,
// resume, end the event), and on the Live tab the crowd, the incidents and the medic in the venue's 3D view from
// the Venue setup tab, our bands dragged from the panel onto the floor, and the decision history. Clicking a
// person opens them beside the view; hovering a person, an incident or a zone's circle on the floor says what it
// is. The module runs everything; this page only shows it.

import * as THREE from 'three';
import { act, complicated, h, money, time } from './lib';
import { bandCode } from './band-code';
import { Crowd, isDown } from './crowd-3d';
import { Incidents } from './incidents-3d';
import { ZoneCircles, zoneWords } from './zones-3d';
import { present } from './venue-map';
import { matches, searchWords, searchable } from './table-search';
import { dragBar, dragged } from './resize';
import { setLiveHeight, venueView, type LiveView } from './venue-setup';
import type { DbConnection } from './module_bindings';
import type { Band, Claim, IncidentMarker, LiveRun } from './module_bindings/types';

const START = { crowd: 1000, minutes: 12, pace: 8 };
/** Test bands, which need no radio. */
const TEST_BANDS = [90, 91, 92, 93, 94, 95, 96, 97, 98, 99];
const HISTORY_ROWS = 60;
/** A click moves the pointer less than this; more is a drag of the camera. */
const CLICK_PX = 5;
/** An incident is picked this far off the pointer's ray per metre from the camera, as a person is. */
const PICK_RADIANS = 0.006;
const LIGHTS = ['Calm around them', 'Busy around them', 'Very busy around them'];

let conn: DbConnection;
let v: LiveView | undefined;
let crowd: Crowd;
let incidentPins: Incidents;
let zones: ZoneCircles;
/** What the portal does with a person clicked in the view, and the band of the person it has open. */
let pick: Picking | undefined;
let tip: HTMLElement;
/** The incident the camera flew to; the decision history shows only its rows. */
let focus: bigint | undefined;
/** A dark ring on the floor under the opened person. */
const mark = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.15, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#111111', side: THREE.DoubleSide, depthWrite: false }));
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

function setUp(c: DbConnection) {
  conn = c;
  v = venueView(c);
  crowd = new Crowd(v.layer);
  for (const b of conn.db.band.iter()) crowd.upsert(b);
  conn.db.band.onInsert((_ctx, b) => crowd.upsert(b));
  conn.db.band.onUpdate((_ctx, _old, b) => crowd.upsert(b));
  conn.db.band.onDelete((_ctx, b) => crowd.remove(b.id));
  // The crowd's walks, and the run's pause, which holds everyone where they are. The walks have their own
  // subscription, so a module without them leaves the rest of the page working.
  conn.subscriptionBuilder().onError(() => console.warn('no crowd walks: the crowd walks to its spots')).subscribe(['SELECT * FROM crowd_walk']);
  conn.db.crowdWalk.onInsert((_ctx, w) => crowd.walk(w));
  conn.db.crowdWalk.onUpdate((_ctx, _old, w) => crowd.walk(w));
  conn.db.crowdWalk.onDelete((_ctx, w) => crowd.unwalk(w.bandId));
  const pause = () => crowd.setPaused(conn.db.livePause.id.find(0)?.pausedAt.toDate().getTime());
  conn.db.livePause.onInsert(pause);
  conn.db.livePause.onDelete(pause);
  pause();
  // This run's incidents, as they open, change and resolve.
  incidentPins = new Incidents(v, () => crowd.moduleNow());
  const sync = () => incidentPins.sync(markers(run()));
  for (const t of [conn.db.incidentMarker, conn.db.liveRun]) {
    t.onInsert(sync);
    t.onUpdate(sync);
    t.onDelete(sync);
  }
  sync();
  zones = new ZoneCircles(v.layer);
  mark.renderOrder = 3;
  v.layer.add(mark);
  tip = h('div', { class: 'venue-tip', hidden: true });
  v.view.append(tip);
  v.onFrame(now => {
    crowd.frame(now);
    incidentPins.frame(now);
    // Our bands' tags: the name typed when the band was placed, over its code.
    const ours = crowd.ours();
    v!.names.setBands(ours.map(b => ({ ...b, name: conn.db.bandPlace.bandId.find(b.id)?.label ?? '', code: bandCode(b.id) })));
    zones.update(conn, now);
    const at = pick?.selected ? crowd.where(pick.selected) : undefined;
    mark.visible = !!at;
    if (at) mark.position.set(at.x, 0.06, at.z);
  });
  let down: { x: number; y: number } | undefined;
  v.canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  v.canvas.addEventListener('pointerup', e => {
    if (dragging || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_PX) return;
    const ray = v!.rayAt(e);
    const b = crowd.pick(ray);
    if (b) return openBand(b);
    const incident = incidentAt(ray);
    if (incident) focusOn(incident);
  });
  let moved: PointerEvent | undefined;
  v.canvas.addEventListener('pointermove', e => {
    if (!moved) requestAnimationFrame(() => { hover(moved!); moved = undefined; });
    moved = e;
  });
  v.canvas.addEventListener('pointerleave', () => { tip.hidden = true; zones.hover(undefined); });
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

// --- Hovering and clicking ---------------------------------------------------------------------

/** A person clicked: they open beside the view and the camera flies to them; someone down also focuses their incident. */
function openBand(b: Band) {
  tip.hidden = true;
  pick?.open(b.id);
  const at = crowd.where(b.id) ?? { x: b.xM, z: b.yM };
  const incident = isDown(b) ? [...conn.db.incidentMarker.iter()].find(m => m.bandId === b.id && m.status !== 'resolved') : undefined;
  if (incident) focus = incident.incidentId;
  v!.lookAt(at.x, at.z);
}

/** The camera flies to an incident and the decision history shows only its rows. */
function focusOn(m: IncidentMarker) {
  tip.hidden = true;
  focus = m.incidentId;
  v!.lookAt(m.xM, m.yM);
}

function focusOnId(id: bigint) {
  const m = conn.db.incidentMarker.incidentId.find(id);
  if (m) focusOn(m);
  else focus = id;
}

/** Back to the whole hall and every decision. */
function showAll() {
  focus = undefined;
  v!.overview();
}

/** What is under the pointer, nearest first: a person, an incident's ring, then a zone's circle. */
function hover(e: PointerEvent) {
  tip.hidden = true;
  v!.canvas.style.cursor = '';
  if (e.buttons || dragging) return zones.hover(undefined);
  const ray = v!.rayAt(e);
  const b = crowd.pick(ray);
  const incident = b ? undefined : incidentAt(ray);
  const floor = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  const circle = b || incident || !floor ? undefined : zones.at(floor.x, floor.z);
  zones.hover(circle);
  const [title, lines] = b ? personWords(b) : incident ? incidentWords(incident) : circle ? zoneWords(conn, circle) : ['', []];
  if (!title) return;
  if (b) v!.canvas.style.cursor = 'pointer';
  tip.replaceChildren(h('b', {}, title), ...lines.map(l => h('div', {}, l)));
  tip.hidden = false;
  const r = v!.view.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  tip.style.left = `${x + 14 + tip.offsetWidth > r.width ? Math.max(0, x - 14 - tip.offsetWidth) : x + 14}px`;
  tip.style.top = `${y + 14 + tip.offsetHeight > r.height ? Math.max(0, y - 14 - tip.offsetHeight) : y + 14}px`;
}

function personWords(b: Band): [string, string[]] {
  const a = [...conn.db.boardAttendees.iter()].find(x => x.bandId === b.id);
  const light = b.fall ? 'Fell' : isDown(b) ? 'Pressed SOS' : b.state === 4 ? 'In the light circle around someone down' : LIGHTS[Math.min(b.state, 2)];
  return [a ? a.displayName || '(no name yet)' : 'Nobody wears this band', [
    `Band ${bandCode(b.id)}${a?.organization ? `, ${a.organization}` : ''}`,
    `${light}.`,
    pick ? 'Click to open them and fly to them.' : '',
  ].filter(Boolean)];
}

/** The incident on the floor whose ring the ray passes, or a few pixels from it when it is far away. */
function incidentAt(ray: THREE.Ray): IncidentMarker | undefined {
  const at = new THREE.Vector3();
  let best: IncidentMarker | undefined;
  let score = 1;
  for (const m of incidentPins.shown()) {
    at.set(m.xM, 1, m.yM);
    const along = at.clone().sub(ray.origin).dot(ray.direction);
    if (along <= 0) continue;
    const reach = Math.max(2.5, along * PICK_RADIANS);
    const off = ray.distanceSqToPoint(at) / (reach * reach);
    if (off < score) {
      score = off;
      best = m;
    }
  }
  return best;
}

function incidentWords(m: IncidentMarker): [string, string[]] {
  return [`Incident ${m.incidentId}: ${m.kind}`, [
    'Click to fly to it and show its decisions.',
    [m.person, m.place && `at ${m.place}`].filter(Boolean).join(' '),
    m.status === 'responding' && m.medic ? `${m.medic} responding` : m.status,
    m.claimId ? `Claim: ${m.claimStatus}${m.payoutCents && m.claimStatus !== 'refused' ? `, ${money(m.payoutCents)}` : ''}` : '',
  ].filter(Boolean)];
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

/** The organizer approves a claim waiting for them, and teaches the Decision Engine a rule for similar claims unless it is complicated. */
function approveButton(c: Claim) {
  return h('button', {
    onclick: (e: Event) => {
      e.stopPropagation();
      act(() => conn.reducers.approveClaim({ claimId: c.id, amountSeenCents: c.payoutCents, packHashSeen: c.packHash, requestedCeilingCents: undefined, learn: !complicated(c) }));
    },
  }, complicated(c) ? 'Approve' : 'Approve and teach a rule');
}

/** Every decision, newest first; a click on a row of an incident flies to it and shows only its rows. The newest
 *  row of each claim waiting for the organizer carries the approve button. */
function history(canRun: boolean) {
  const all = [...conn.db.decision.iter()];
  const words = searchWords('decisions');
  const mine = focus === undefined ? all : all.filter(d => d.incidentId === focus);
  const hits = words.length ? mine.filter(d => matches(`${time(d.at)} ${d.incidentId || ''} ${d.who} ${d.actor} ${d.what} ${d.why}`, words)) : mine;
  const rows = hits.sort((a, b) => Number(b.id - a.id)).slice(0, HISTORY_ROWS);
  const claims = new Map([...conn.db.claimsBoard.iter()].map(c => [c.id, c]));
  const waiting = new Set<bigint>();
  const focused = focus !== undefined ? conn.db.incidentMarker.incidentId.find(focus) : undefined;
  return h('section', {},
    h('h4', {}, focus === undefined ? 'Decision history' : `Decision history of incident #${focus}${focused ? `: ${focused.kind}${focused.person ? `, ${focused.person}` : ''}` : ''}`),
    focus !== undefined && h('p', {}, h('button', { onclick: showAll }, 'Show all decisions and the whole hall')),
    all.length === 0
      ? h('p', { class: 'muted' }, 'Nothing decided yet.')
      : searchable('decisions', h('table', {},
        h('tr', {}, h('th', {}, 'Time'), h('th', {}, 'Who'), h('th', {}, 'Decided')),
        rows.map(d => {
          const c = d.claimId ? claims.get(d.claimId) : undefined;
          const approve = canRun && c?.status.tag === 'Routed' && !waiting.has(c.id);
          if (approve) waiting.add(c!.id);
          return h('tr', d.incidentId ? { class: 'linked', title: 'Show this incident on the map', onclick: () => focusOnId(d.incidentId) } : {},
            h('td', {}, time(d.at), d.incidentId ? [h('br'), `#${d.incidentId}`] : ''),
            h('td', {}, d.who === d.actor ? d.who : `${d.who} (${d.actor})`),
            h('td', {}, d.what, d.why && [h('br'), h('span', { class: 'muted' }, d.why)], approve && [h('br'), approveButton(c!)]));
        })), rows.length < mine.length));
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
        h('tr', {}, h('th', {}, 'Incident'), h('th', {}, 'Status'), h('th', {}, '')),
        list.map(m => {
          const c = claims.get(m.claimId);
          const waiting = canRun && c?.status.tag === 'Routed';
          return h('tr', {},
            h('td', {}, `${time(m.openedAt)} #${m.incidentId} ${m.kind}`, h('br'), `${m.person || ''}${m.place ? `${m.person ? ' at ' : ''}${m.place}` : ''}`),
            h('td', {}, m.status === 'responding' && m.medic ? `${m.medic} responding` : m.status,
              m.claimId ? [h('br'), `claim ${m.claimStatus}${m.payoutCents && m.claimStatus !== 'refused' ? `, ${money(m.payoutCents)}` : ''}`] : '',
              waiting && [h('br'), approveButton(c!)]),
            h('td', {}, h('button', { class: 'link', onclick: () => focusOn(m) }, 'Show')));
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
  ['#ff2f45', 'Ring and beam: an open incident, with a tag saying who, where and how far the claim is'],
  ['#ffb020', 'Amber ring: the medic is responding'],
  ['#34d399', 'Green ring: resolved; it fades out 20 s later'],
  ['#2fe08a', 'White figure with a green ring and a cross: the medic, walking in from the nearest door'],
  ['#2fd27a', 'Circle on the floor: a zone, coloured by how crowded it is now (green, amber, red). Hover it for its risk'],
  ['#111111', 'Dark ring: the person open beside the view. Click anyone to open them'],
];

function legend() {
  return h('section', {},
    h('h4', {}, 'Legend'),
    h('table', {}, LEGEND.map(([colour, meaning]) => h('tr', {},
      h('td', { style: `background: ${colour}; width: 24px` }),
      h('td', {}, meaning)))));
}

/** The side panels' widths until their bars are dragged. */
const SIDES = { left: 300, right: 340 };
/** The 3D view keeps at least this much of the window's width between the side panels. */
const MIN_VIEW = 320;

/** The bar between a side panel and the 3D view, which drags the panel wider or narrower. */
function sideBar(side: 'left' | 'right') {
  const other = side === 'left' ? 'right' : 'left';
  const width = (s: 'left' | 'right') => dragged(`live ${s}`) ?? SIDES[s];
  return dragBar(`live ${side}`, 'x', side === 'left' ? 1 : -1, () => width(side),
    px => (document.querySelector('.live') as HTMLElement | null)?.style.setProperty(`--${side}`, `${px}px`),
    180, () => innerWidth - width(other) - MIN_VIEW);
}

/** A person clicked in the 3D view opens with `open`; `selected` is the band of the person open now, or 0, and
 *  `panel` shows them at the top of the right side. */
export type Picking = { open(bandId: number): void; selected: number; panel: HTMLElement | null };

/** The Live tab: the incidents and the legend on the left, the 3D view in the middle, the opened person, the
 * decisions and our bands on the right. The bars between them and under the view resize them. */
export function liveRunSection(c: DbConnection, canRun: boolean, picking?: Picking) {
  pick = picking;
  if (!v) setUp(c);
  else venueView(c);
  crowd.recheck();
  const r = run();
  incidentPins.sync(markers(r));
  const height = dragged('live height');
  if (height) setLiveHeight(height);
  const sides = (['left', 'right'] as const).map(s => `--${s}: ${dragged(`live ${s}`) ?? SIDES[s]}px`).join('; ');
  return h('div', { class: 'live', style: sides },
    h('div', {}, incidents(r, canRun), legend()),
    sideBar('left'),
    h('div', {}, h('section', {}, v!.view, dragBar('live height', 'y', 1, () => v!.canvas.clientHeight, setLiveHeight, 240),
      h('p', {}, h('button', { onclick: showAll }, 'Whole hall')), v!.note)),
    sideBar('right'),
    h('div', {}, picking?.panel, history(canRun), canRun && placeBands()));
}
