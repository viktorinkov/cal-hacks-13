// The organizer portal: the live event from the bands, alerts, who joined, insurance claims from the
// medic's filing to the named approver's decision, the event graph with its photos, the merch templates
// and orders, the Kibana dashboards, the venue setup from the event's name, and "Event ended".
// One portal for every staff member: the same tabs for all. Buttons a person cannot use are hidden,
// and the module checks every role again. The medic works incidents during the event; the organizer
// decides the claims afterwards.

import {
  act, config, connect, date, field, h, idToken, medicalCard, money, mount, risk, signIn,
  signOut, signedInEmail, time, type Config, EXIT_COLOURS,
} from '../lib';
import { bandCode } from '../band-code';
import { graphTab, showPhotoInGraph } from '../graph';
import { MAP_LEGEND, present, venueMap } from '../venue-map';
import { venueSetupTab } from '../venue-setup';
import type { DbConnection } from '../module_bindings';
import type { Claim } from '../module_bindings/types';

const QUERIES = [
  'SELECT * FROM my_roles',
  'SELECT * FROM my_owner',
  'SELECT * FROM event_state',
  'SELECT * FROM venue',
  'SELECT * FROM zone',
  'SELECT * FROM booth',
  'SELECT * FROM organization',
  'SELECT * FROM band',
  'SELECT * FROM venue_plan',
  'SELECT * FROM station',
  'SELECT * FROM gateway',
  'SELECT * FROM settings',
  'SELECT * FROM open_incidents',
  'SELECT * FROM board_notes',
  'SELECT * FROM board_attendees',
  'SELECT * FROM claims_board',
  'SELECT * FROM board_facts',
  'SELECT * FROM board_checks',
  'SELECT * FROM board_lines',
  'SELECT * FROM board_reviews',
  'SELECT * FROM board_precedents',
  'SELECT * FROM board_records',
  'SELECT * FROM board_approvals',
  'SELECT * FROM board_ledger',
  'SELECT * FROM board_rules',
  'SELECT * FROM board_policies',
  'SELECT * FROM medic_medical_cards',
  'SELECT * FROM event_graph',
  'SELECT * FROM board_photos',
  'SELECT * FROM merch_template',
  'SELECT * FROM board_merch_orders',
  'SELECT * FROM board_merch_picks',
  'SELECT * FROM venue_setup',
  'SELECT * FROM venue_setup_step',
  'SELECT * FROM chosen_venue',
  'SELECT * FROM board_staff',
];

/** The synthetic clinic records in fixtures/medical-records, rendered for the incident's date and time. */
const TEST_RECORDS: [string, string][] = [
  ['first-aid-wrist', 'Event first aid, wrist sprain (Maya Chen, $180)'],
  ['urgent-care-wrist', 'Urgent care, wrist sprain (Jordan Alvarez, $1,308)'],
  ['urgent-care-ankle-home', 'Urgent care, ankle hurt at home (Sam Patel, $565)'],
];

let conn: DbConnection;
let cfg: Config;
let tab = location.hash.slice(1);
let openClaim: bigint | undefined;

/** The staff roles: the organizer (ops) and the medic. */
const STAFF_ROLES = ['ops', 'medic'];
/** Bands 90 to 99, which need no radio: 90 to 93 belong to the claims story's attendees, 94 to 99 to testers. */
const TEST_BANDS = [90, 91, 92, 93, 94, 95, 96, 97, 98, 99];
/** The crowd's attendees listed on the Attendees tab, after everyone who tapped a band. */
const CROWD_ROWS = 200;

function roles(): Set<string> {
  return new Set([...conn.db.myRoles.iter()].map(r => r.role));
}

/** The module owner passes every role check, as in the module. */
function isOwner(): boolean {
  return conn.db.myOwner.count() > 0;
}

function can(...wanted: string[]): boolean {
  if (isOwner()) return true;
  const mine = roles();
  return wanted.some(r => mine.has(r));
}

/** Every tab, for anyone with a staff role; nothing for anyone else. */
function tabs(): [string, string][] {
  if (!can(...STAFF_ROLES)) return [];
  const all: [string, string][] = [['live', 'Live'], ['attendees', 'Attendees'], ['claims', 'Claims'], ['graph', 'Event graph'], ['photos', 'Photos'], ['merch', 'Merch'], ['venue', 'Venue setup'], ['kibana', 'Kibana']];
  const owned: [string, string][] = isOwner() ? [...all, ['staff', 'Staff']] : all;
  return cfg.test_mode ? [...owned, ['bands', 'Bands']] : owned;
}

function zoneName(id: bigint) {
  return conn.db.zone.id.find(id)?.name ?? 'no zone';
}

/** Who wears each band, by the host's attendee list. */
function wearers(): Map<number, string> {
  return new Map([...conn.db.boardAttendees.iter()].filter(a => a.bandId).map(a => [a.bandId, a.displayName]));
}

/** A band is alive when it was heard in the last 5 s (the crowd's while they are online), else stale. */
function alive(bandId: number): boolean {
  const b = conn.db.band.id.find(bandId);
  return !!b && present(b);
}

function bandStatus(bandId: number): string {
  if (!bandId) return 'no band';
  if (!conn.db.band.id.find(bandId)) return 'not seen yet';
  return alive(bandId) ? 'online' : 'offline';
}

function header() {
  const roleList = [...(isOwner() ? ['owner'] : []), ...[...conn.db.myRoles.iter()].map(r => `${r.role} (${r.label})`)];
  const state = conn.db.eventState.id.find(0);
  const ended = state?.ended ?? false;
  return [
    h('h2', {}, `${conn.db.venue.iter().next().value?.name ?? 'Event'} organizer portal`),
    h('p', {},
      signedInEmail() && [`Signed in as ${signedInEmail()} `, h('button', { class: 'link', onclick: signOut }, 'Sign out')]),
    h('p', { class: 'muted' }, `Staff role: ${roleList.length ? roleList.join(', ') : 'none'}`),
    roles().has('medic') && h('p', {}, 'Tap a band with this phone to open the wearer\'s medical card.'),
    can('ops') && h('p', {},
      ended
        ? [h('b', {}, `The event ended at ${date(state?.endedAt)}. `), 'Every tap link now shows the recap. ',
          h('button', { onclick: () => act(() => conn.reducers.reopenEvent({})) }, 'Reopen the event')]
        : h('button', { onclick: () => confirm('End the event? Every tap link switches to the recap.') && act(() => conn.reducers.endEvent({})) }, 'Event ended')),
    h('nav', {}, tabs().map(([key, label]) => h('a', { href: `#${key}`, class: key === tab ? 'on' : '', onclick: () => { tab = key; render(); } }, label))),
  ];
}

/** A signed-in person with no staff role sees the email the organizer adds them by. */
function noRole() {
  const email = signedInEmail();
  if (roles().has('photographer')) return h('section', {}, h('h3', {}, 'Photographer'), h('p', {}, h('a', { href: '/photo' }, 'Add event photos')));
  return h('section', {},
    h('h3', {}, 'This account has no staff role'),
    email
      ? h('p', {}, `The organizer portal is for the event's staff. Ask the organizer to add ${email} on the Staff tab; this page opens as soon as they do.`)
      : [h('p', {}, 'The organizer portal is for the event\'s staff. To get access, send this code to the organizer:'), h('p', {}, h('code', {}, conn.identity!.toHexString()))],
    h('p', {}, 'Once you are a medic, tapping a band with this phone opens the wearer\'s medical card.'));
}

/** The first screen: staff sign in before they see anything. */
function signInScreen() {
  return [
    h('h2', {}, 'BandIt organizer portal'),
    h('p', {}, 'Sign in with your staff email to run the event: live zones and alerts, attendees, claims and the end of the event.'),
    h('button', { onclick: signIn }, 'Sign in with email'),
  ];
}

// --- Live -----------------------------------------------------------------------------------

function live() {
  const settings = conn.db.settings.iter().next().value;
  const now = Date.now();
  const bands = [...conn.db.band.iter()].filter(b => present(b, now));
  const gw = conn.db.gateway.id.find(0);
  const zones = [...conn.db.zone.iter()].sort((a, b) => a.stationId - b.stationId);
  const alerts = bands.filter(b => b.sos || b.fall);
  const inside = bands.filter(b => b.zone !== 0);
  const crowd = bands.filter(b => b.id >= 100).length;
  const test = bands.filter(b => b.id >= 90 && b.id < 100).length;
  const incidents = [...conn.db.openIncidents.iter()];
  const names = wearers();
  const wearer = (band: number) => names.has(band) ? ` (${names.get(band) || 'no name yet'})` : '';
  return [
    (alerts.length > 0 || incidents.length > 0) && h('section', { class: 'alert' },
      h('h3', {}, 'Alerts'),
      h('ul', {},
        alerts.map(b => {
          const z = zones.find(z => z.stationId === b.zone);
          return h('li', {}, h('b', {}, b.fall ? 'Fall' : 'SOS'), ` on band ${bandCode(b.id)}${wearer(b.id)} in ${z?.name ?? 'no zone'}: the bands around it show the light circle.`);
        }),
        incidents.map(i => h('li', {}, `Incident ${i.id}: ${i.kind.tag} in ${zoneName(i.zoneId)}, ${i.subjectBand ? `band ${bandCode(i.subjectBand)}${wearer(i.subjectBand)}` : 'no band'}, ${i.status.tag}, opened ${time(i.openedAt)} `,
          h('a', { href: '#claims' }, 'open in Claims'))))),
    h('section', {},
      h('h3', {}, 'Venue'),
      h('p', { class: 'muted' }, `${bands.length} bands at the event right now: ${crowd} in the crowd, ${test} test bands and ${bands.length - crowd - test} hardware bands. Every dot is a band row in SpacetimeDB, moving as the module writes it.`),
      venueMap(conn),
      h('p', { class: 'legend' }, MAP_LEGEND.map(([c, label]) => h('span', {}, h('i', { class: 'dot', style: `background:${c}` }), label)))),
    h('section', {},
      h('h3', {}, 'Zones'),
      h('p', {}, settings?.lowVis
        ? [h('b', {}, 'Low visibility is on: every band guides its wearer to the exit colour of its zone. '), h('button', { onclick: () => act(() => conn.reducers.setLowVis({ on: false })) }, 'Turn it off')]
        : h('button', { onclick: () => confirm('Fire or smoke? Every band starts guiding its wearer to the exit.') && act(() => conn.reducers.setLowVis({ on: true })) }, 'Low visibility: guide everyone to the exits')),
      h('p', { class: 'muted' }, `${inside.length} of the ${bands.length} bands are in a zone right now. The gateway, which receives the hardware bands, is ${gw?.online ? 'online' : 'offline'}${gw ? `, last heard at ${time(gw.lastLine)}` : ''}. A zone is busy when its bands have ${settings?.yellow ?? 3} other bands close by on average, very busy at ${settings?.red ?? 5}.`),
      h('table', {},
        h('tr', {}, h('th', {}, 'Zone'), h('th', {}, 'People now'), h('th', {}, 'Hardware and test bands'), h('th', {}, 'Bands close by, average'), h('th', {}, 'Level'), h('th', {}, 'Capacity'), h('th', {}, 'Exit'), h('th', {}, 'Station')),
        zones.map(z => {
          const here = bands.filter(b => b.zone === z.stationId);
          const avg = here.length ? here.reduce((s, b) => s + b.neigh, 0) / here.length : 0;
          const level = risk(avg, settings?.yellow ?? 3, settings?.red ?? 5);
          const st = conn.db.station.id.find(z.stationId);
          return h('tr', {},
            h('td', {}, z.name), h('td', {}, here.length), h('td', {}, here.filter(b => b.id < 100).length), h('td', {}, avg.toFixed(1)),
            h('td', { class: `level ${level.replace(' ', '-')}` }, level), h('td', {}, z.capacity),
            h('td', {}, EXIT_COLOURS[z.exitColour]), h('td', {}, `${z.stationId} ${st?.online ? 'online' : 'offline'}`));
        }))),
  ];
}

// --- Attendees ------------------------------------------------------------------------------

function attendees() {
  const all = [...conn.db.boardAttendees.iter()].sort((a, b) => Number(a.crowd) - Number(b.crowd) || a.displayName.localeCompare(b.displayName));
  const kind = (a: (typeof all)[number]) => a.crowd || a.bandId >= 100 ? 'crowd' : a.bandId >= 90 ? 'test' : a.bandId > 0 ? 'hardware' : 'none';
  const count = (k: string) => all.filter(a => kind(a) === k).length;
  const people = all.filter(a => !a.crowd).length;
  const shown = all.slice(0, people + CROWD_ROWS);
  const ended = conn.db.eventState.id.find(0)?.ended ?? false;
  const takeBack = (bandId: number, name: string) =>
    confirm(`Take band ${bandCode(bandId)} back from ${name || 'this attendee'}? They keep their profile and memories; the next person can claim the band.`)
      && act(() => conn.reducers.releaseBand({ bandId }));
  return h('section', {},
    h('h3', {}, `${all.length} attendees`),
    h('p', { class: 'muted' }, `${count('crowd')} in the crowd, ${count('test')} wearing test bands, ${count('hardware')} wearing hardware bands${count('none') ? `, ${count('none')} without a band` : ''}.`),
    all.length > shown.length && h('p', { class: 'muted' }, `Showing the first ${CROWD_ROWS} crowd attendees, by name.`),
    h('table', {},
      h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Band'), h('th', {}, 'Band status'), h('th', {}, 'Company'), h('th', {}, 'Findable'), h('th', {}, 'Socials'), h('th', {}, 'Joined')),
      shown.map(a => h('tr', {},
        h('td', {}, a.displayName || '(no name yet)', a.crowd && h('span', { class: 'muted' }, ' crowd')),
        h('td', {}, a.bandId ? h('a', { href: `/t/${bandCode(a.bandId)}` }, bandCode(a.bandId)) : ''),
        h('td', { class: a.bandId && alive(a.bandId) ? 'pass' : 'muted' }, bandStatus(a.bandId),
          a.bandId > 0 && a.bandId < 100 && !ended && h('div', {}, h('button', { class: 'link', onclick: () => takeBack(a.bandId, a.displayName) }, 'Take the band back'))),
        h('td', {}, a.organization), h('td', {}, a.findable ? 'yes' : 'no'),
        h('td', {}, a.handles.map(x => `${x.platform} ${x.handle}`).join(', ')), h('td', {}, time(a.createdAt))))));
}

// --- Staff ----------------------------------------------------------------------------------

/** The roles the owner adds people to by email, as the module allows them. */
const EMAIL_ROLES: [string, string][] = [['medic', 'Medic'], ['ops', 'Organizer'], ['photographer', 'Photographer']];

function roleName(role: string): string {
  return EMAIL_ROLES.find(([r]) => r === role)?.[1] ?? role;
}

/** The owner adds a medic, organizer or photographer by email. Whoever signs in with it gets the role. */
function staffTab() {
  const staff = [...conn.db.boardStaff.iter()].sort((a, b) => a.name.localeCompare(b.name));
  const add = async (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    if (await act(() => conn.reducers.addStaff({ email: field(f, 'staff-email'), role: field(f, 'staff-role'), name: field(f, 'staff-name') }))) {
      f.reset();
      render();
    }
  };
  const remove = (id: bigint, name: string, role: string) =>
    confirm(`Remove ${name} as ${roleName(role).toLowerCase()}?`) && act(() => conn.reducers.removeStaff({ id }));
  return h('section', {},
    h('h3', {}, 'Staff'),
    h('p', {}, 'Add staff by the email they sign in with. A medic who then taps a band with their phone gets the wearer\'s medical card.'),
    h('form', { onsubmit: add },
      h('label', {}, 'Name', h('input', { name: 'staff-name', required: true })),
      h('label', {}, 'Email', h('input', { name: 'staff-email', type: 'email', required: true })),
      h('label', {}, 'Role', h('select', { name: 'staff-role' }, EMAIL_ROLES.map(([value, label]) => h('option', { value }, label)))),
      h('button', {}, 'Add')),
    staff.length > 0 && h('table', {},
      h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Email'), h('th', {}, 'Role'), h('th', {}, 'Signed in'), h('th', {}, '')),
      staff.map(m => h('tr', {},
        h('td', {}, m.name), h('td', {}, m.email), h('td', {}, roleName(m.role)),
        h('td', { class: m.account ? 'pass' : 'muted' }, m.account ? 'yes' : 'not yet'),
        h('td', {}, h('button', { class: 'link', onclick: () => remove(m.id, m.name, m.role) }, 'Remove'))))));
}

// --- Claims ---------------------------------------------------------------------------------

/** Open incidents: the medic takes one, opens the medical card, notes the cost and resolves it. */
function incidentDesk() {
  const incidents = [...conn.db.openIncidents.iter()].sort((a, b) => Number(a.id - b.id));
  const notes = [...conn.db.boardNotes.iter()];
  const names = wearers();
  const medic = can('medic');
  return h('section', {},
    h('h3', {}, 'Open incidents'),
    !incidents.length && h('p', { class: 'muted' }, 'None. A fall or SOS on a band opens one here.'),
    incidents.map(i => {
      const mine = notes.filter(n => n.incidentId === i.id);
      const note = async (e: Event) => {
        e.preventDefault();
        const f = e.target as HTMLFormElement;
        const cost = field(f, `cost-${i.id}`);
        const ok = await act(() => conn.reducers.addIncidentNote({
          incidentId: i.id, text: field(f, `text-${i.id}`), costCents: cost ? BigInt(Math.round(Number(cost) * 100)) : undefined,
        }));
        if (ok) f.reset();
      };
      const who = i.subjectBand ? `band ${bandCode(i.subjectBand)}${names.has(i.subjectBand) ? ` (${names.get(i.subjectBand) || 'no name yet'})` : ''}` : 'no band';
      return h('div', { class: 'incident' },
        h('p', {}, h('b', {}, `Incident ${i.id}: ${i.kind.tag}`), ` in ${zoneName(i.zoneId)}, ${who}, ${i.status.tag}, opened ${time(i.openedAt)} by ${i.openedBy}`),
        h('ul', {}, mine.map(n => h('li', {}, `${time(n.createdAt)} ${n.authorRole}: ${n.text}${n.costCents !== undefined ? ` (${money(n.costCents)})` : ''}`))),
        medic && i.status.tag === 'Open' && h('button', { onclick: () => act(() => conn.reducers.assignMedic({ incidentId: i.id })) }, 'Take it'),
        medic && i.subjectBand !== 0 && h('button', { onclick: () => act(() => conn.reducers.requestMedicalCard({ bandId: i.subjectBand })) }, `Tap band ${bandCode(i.subjectBand)} for the medical card`),
        medicCard(i.id),
        h('form', { onsubmit: note },
          h('input', { name: `text-${i.id}`, placeholder: 'Treatment note', required: true }),
          h('input', { name: `cost-${i.id}`, placeholder: 'Cost in dollars (optional)', inputmode: 'decimal' }),
          h('button', {}, 'Add note')),
        can('ops', 'medic') && h('button', { onclick: () => act(() => conn.reducers.resolveIncident({ incidentId: i.id, resolution: 'treated on site' })) }, 'Resolve'));
    }));
}

/** The medical card a medic opened by tapping the band, while the incident is open. */
function medicCard(incidentId: bigint) {
  const m = [...conn.db.medicMedicalCards.iter()].find(c => c.incidentId === incidentId);
  return m ? medicalCard(m) : null;
}

// --- Bands ---------------------------------------------------------------------------------

async function post(path: string) {
  const res = await fetch(path, { method: 'POST' });
  if (!res.ok) throw new Error((await res.json()).error);
}

function toClaims(ok: boolean) {
  if (!ok) return;
  tab = 'claims';
  location.hash = 'claims';
  render();
}

/** Bands 90 to 99: who wears them and where they are, with buttons to walk, press or drop them. */
function bandsTab() {
  const owners = wearers();
  const zones = [...conn.db.zone.iter()].sort((a, b) => a.stationId - b.stationId);
  return h('section', {},
    h('h3', {}, 'Test bands'),
    h('p', { class: 'muted' }, `The first four are the claims story\'s attendees; the other six are the ones testers claim from a tap link: open /t/${bandCode(94)}, then press that band here. A fall uses two of the story attendees as the bands around it, and they stay in that zone afterwards.`),
    h('table', {},
      h('tr', {}, h('th', {}, 'Band'), h('th', {}, 'Wearer'), h('th', {}, 'Zone'), h('th', {}, 'Walk to'), h('th', {})),
      TEST_BANDS.map(id => {
        const b = conn.db.band.id.find(id);
        const claimed = owners.has(id);
        return h('tr', {},
          h('td', {}, h('b', {}, bandCode(id)), h('div', { class: alive(id) ? 'pass' : 'muted' }, alive(id) ? 'online' : 'offline')),
          h('td', {}, claimed ? owners.get(id) || '(no name yet)' : h('span', { class: 'muted' }, 'not claimed')),
          h('td', {}, zones.find(z => z.stationId === b?.zone)?.name ?? 'no zone'),
          h('td', {}, zones.map(z => h('button', { class: 'test', disabled: z.stationId === b?.zone || undefined,
            onclick: () => act(() => post(`/api/dev/move/${id}/${z.stationId}`)) }, z.name))),
          h('td', {},
            id >= 94 && h('button', { class: 'test', onclick: () => act(() => post(`/api/dev/press/${id}`)) }, 'Press'),
            claimed && h('button', { class: 'test', onclick: () => act(() => post(`/api/dev/fall/${id}`)).then(toClaims) }, 'Fall here')));
      })),
    h('h3', {}, 'Property damage'),
    h('p', { class: 'muted' }, 'A venue camera sees a speaker knocked off its stand; the vision check confirms it and a property claim opens.'),
    zones.map(z => h('button', { class: 'test', onclick: () => act(() => post(`/api/dev/property/${z.stationId}`)).then(toClaims) }, `Speaker breaks in ${z.name}`)));
}

function statusOf(c: Claim) {
  return c.status.tag.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/** The approver's queue: the claims routed to the caller, oldest first. */
/** Can the caller approve or refuse this claim: the person it waits for, or anyone holding its role. */
function decides(c: Claim): boolean {
  return c.routedTo.isEqual(conn.identity!) || can(c.routedToRole);
}

/** The organizer's queue: claims no learned rule settled, oldest first. */
function myQueue() {
  const mine = [...conn.db.claimsBoard.iter()].filter(c => c.status.tag === 'Routed' && decides(c)).sort((a, b) => Number(a.id - b.id));
  if (!can('ops')) return null;
  return h('section', { class: mine.length ? 'alert' : '' },
    h('h3', {}, `Waiting for your decision (${mine.length})`),
    !mine.length && h('p', { class: 'muted' }, 'Nothing right now. Claims a learned rule covers settle on their own.'),
    h('ul', {}, mine.map(c => h('li', {},
      h('button', { class: 'link', onclick: () => { openClaim = c.id; render(); } }, `#${c.id}`),
      ` ${c.claimantName || 'no claimant'}, ${c.incidentKind} in ${c.zoneName}, ${money(c.payoutCents)}: ${c.statusNote}`))));
}

function claimList() {
  const claims = [...conn.db.claimsBoard.iter()].sort((a, b) => Number(b.id - a.id));
  return h('section', {},
    h('h3', {}, 'All claims'),
    !claims.length && h('p', { class: 'muted' }, 'No claims yet. Resolving an injury incident with a note opens one.'),
    claims.length > 0 && h('table', {},
      h('tr', {}, h('th', {}, 'Claim'), h('th', {}, 'Claimant'), h('th', {}, 'What'), h('th', {}, 'Status'), h('th', {}, 'Payout'), h('th', {}, 'Waiting for')),
      claims.map(c => h('tr', { class: c.status.tag === 'Routed' && decides(c) ? 'alert' : '' },
        h('td', {}, h('button', { class: 'link', onclick: () => { openClaim = c.id; render(); } }, `#${c.id}`)),
        h('td', {}, c.claimantName || '(none)'), h('td', {}, `${c.incidentKind} in ${c.zoneName}`),
        h('td', {}, statusOf(c), h('div', { class: 'muted' }, c.statusNote)),
        h('td', {}, money(c.payoutCents)),
        h('td', {}, c.status.tag === 'Routed' ? `${c.routedToName}${decides(c) ? ', you' : ''}` : '')))));
}

async function fileRecord(claimId: bigint, form: HTMLFormElement) {
  const input = form.querySelector('input[type=file]') as HTMLInputElement;
  const record = field(form, 'test-record');
  if (!input.files?.[0] && record) {
    const res = await fetch(`/api/dev/record/${claimId}/${record}`, { method: 'POST' });
    if (!res.ok) throw new Error((await res.json()).error);
    return;
  }
  const bytes = await input.files?.[0]?.arrayBuffer();
  if (!bytes) throw new Error('choose the clinic PDF');
  const res = await fetch('/api/blobs?purpose=medical', { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: bytes });
  const blob = await res.json();
  if (!res.ok) throw new Error(blob.error);
  await conn.reducers.submitMedicalRecord({ claimId, fileHash: blob.hash, pageCount: blob.pages });
}

/** Claims whose approver unticked "learn"; kept here because each redraw makes a fresh checkbox. */
const noLearn = new Set<bigint>();

function decide(c: Claim) {
  const approve = async (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const ceiling = field(f, 'ceiling');
    await act(() => conn.reducers.approveClaim({
      claimId: c.id, amountSeenCents: c.payoutCents, packHashSeen: c.packHash,
      requestedCeilingCents: ceiling ? BigInt(Math.round(Number(ceiling) * 100)) : undefined,
      learn: !noLearn.has(c.id),
    }));
  };
  const refuse = async (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    await act(() => conn.reducers.refuseClaim({ claimId: c.id, packHashSeen: c.packHash, reason: field(f, 'reason') }));
  };
  return h('div', {},
    h('form', { onsubmit: approve },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !noLearn.has(c.id),
        onchange: (e: Event) => { (e.target as HTMLInputElement).checked ? noLearn.delete(c.id) : noLearn.add(c.id); } }), 'Learn a rule from this approval, so similar claims settle on their own'),
      h('label', {}, 'Rule ceiling in dollars (optional)', h('input', { name: 'ceiling', inputmode: 'decimal' })),
      h('button', {}, `Approve ${money(c.payoutCents)}`)),
    h('form', { onsubmit: refuse },
      h('input', { name: 'reason', placeholder: 'Reason for refusing', required: true }),
      h('button', {}, 'Refuse')));
}

function claimDetail(id: bigint) {
  const c = [...conn.db.claimsBoard.iter()].find(x => x.id === id);
  if (!c) return null;
  const v = c.packVersion;
  const facts = [...conn.db.boardFacts.iter()].filter(f => f.claimId === id && f.packVersion === v).sort((a, b) => a.seq - b.seq);
  const checks = [...conn.db.boardChecks.iter()].filter(x => x.claimId === id && x.packVersion === v);
  const record = [...conn.db.boardRecords.iter()].filter(r => r.claimId === id).pop();
  const lines = [...conn.db.boardLines.iter()].filter(l => l.claimId === id).sort((a, b) => a.lineNo - b.lineNo);
  const review = [...conn.db.boardReviews.iter()].filter(r => r.claimId === id).pop();
  const precedents = [...conn.db.boardPrecedents.iter()].filter(p => p.claimId === id && p.packVersion === v);
  const approvals = [...conn.db.boardApprovals.iter()].filter(a => a.claimId === id);
  const ledger = [...conn.db.boardLedger.iter()].filter(l => l.claimId === id);
  const rule = c.settlementRuleId ? [...conn.db.boardRules.iter()].find(r => r.id === c.settlementRuleId) : undefined;
  return h('section', {},
    h('h3', {}, `Claim #${c.id}: ${c.claimantName || 'no claimant'}, ${c.incidentKind} in ${c.zoneName}`, ' ', h('button', { class: 'link', onclick: () => { openClaim = undefined; render(); } }, 'close')),
    h('p', {}, h('b', {}, statusOf(c)), `: ${c.statusNote}`),
    h('p', {}, `Cost ${money(c.costCents)} · payout ${money(c.payoutCents)} · recoverable from the insurer ${money(c.recoverableCents)} · venue pays ${money(c.venueCostCents)}`),
    h('p', { class: 'muted' }, `Evidence pack v${v}, sha ${c.packHash.slice(0, 12)} · corroboration ${c.corroboration || 'n/a'} · decided by ${c.decidedBy || 'nobody yet'}${rule ? ` under rule v${rule.version} from ${rule.approverName}` : ''}${c.payoutReference ? ` · ${c.payoutReference}` : ''}`),
    c.status.tag === 'AwaitingRecord' && can('medic', 'ops') && h('form', { onsubmit: (e: Event) => { e.preventDefault(); act(() => fileRecord(c.id, e.target as HTMLFormElement)); } },
      h('h4', {}, 'File the medical record'),
      h('label', {}, 'Clinic PDF', h('input', { type: 'file', name: `record-${c.id}`, accept: 'application/pdf' })),
      cfg.test_mode && h('label', {}, 'or a test record, dated for this incident', h('select', { name: 'test-record' }, h('option', { value: '' }, '—'), TEST_RECORDS.map(([f, label]) => h('option', { value: f }, label)))),
      h('button', {}, 'File it, Claude reads it')),
    c.status.tag === 'Routed' && (decides(c)
      ? h('div', {}, h('h4', {}, 'Your decision'), decide(c))
      : h('p', {}, h('b', {}, `Waiting for the ${c.routedToName.toLowerCase()}.`))),
    h('h4', {}, 'Checks'),
    h('table', {}, checks.map(x => h('tr', {}, h('td', { class: x.result }, x.result), h('td', {}, x.name), h('td', {}, x.detail), h('td', { class: 'muted' }, x.reader)))),
    record && record.status !== 'extracted' && [h('h4', {}, 'Medical record'),
      h('p', {}, record.status === 'reading' ? 'Claude is reading the PDF.' : `Claude could not read it: ${record.dropped.join('; ')}`, ' ',
        h('a', { href: `/blobs/${record.fileHash}`, target: '_blank' }, 'Open the PDF'))],
    record && record.status === 'extracted' && [h('h4', {}, 'Medical record, read by Claude'),
      h('p', {}, `${record.documentKind} for ${record.patientName} from ${record.providerName} on ${record.dateOfService}, invoice ${record.invoiceNumber}. Billed ${money(record.billedCents)}, covered ${money(record.coveredCents)}.`),
      record.reasonForVisit && h('p', {}, `Reason: ${record.reasonForVisit}. ${record.history}`),
      h('p', {}, `Diagnoses: ${record.diagnoses.join('; ')}`),
      record.dropped.length > 0 && h('p', {}, `Dropped: ${record.dropped.join('; ')}`),
      h('a', { href: `/blobs/${record.fileHash}`, target: '_blank' }, 'Open the PDF')],
    lines.length > 0 && [h('h4', {}, 'Billed lines'), h('table', {},
      h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Service'), h('th', {}, 'Billed'), h('th', {}, 'Allowed'), h('th', {}, 'Covered'), h('th', {}, 'Outcome')),
      lines.map(l => h('tr', {}, h('td', {}, l.code), h('td', {}, l.description), h('td', {}, money(l.billedCents)), h('td', {}, money(l.allowedCents)),
        h('td', {}, money(l.coveredCents)), h('td', { class: l.outcome === 'excluded' ? 'fail' : '' }, `${l.outcome}${l.reason ? `: ${l.reason}` : ''}`))))],
    review && [h('h4', {}, `Claims agent review (Claude): ${review.verdict}`),
      h('p', {}, review.summary), review.causation && h('p', {}, `Causation: ${review.causation}`),
      review.concerns.length > 0 && h('ul', {}, review.concerns.map(x => h('li', {}, x))),
      review.missingEvidence.length > 0 && h('p', {}, `Missing: ${review.missingEvidence.join('; ')}`),
      review.rejected.length > 0 && h('p', { class: 'fail' }, `Code rejected the review: ${review.rejected.join('; ')}`)],
    precedents.length > 0 && [h('h4', {}, 'Similar past claims (Elastic)'),
      h('ul', {}, precedents.map(p => h('li', {}, `${p.reference}: ${p.outcome}, ${money(p.payoutCents)}, score ${p.score.toFixed(2)}. ${p.narrative}`)))],
    h('h4', {}, 'Evidence facts'),
    h('table', {}, facts.map(f => h('tr', {}, h('td', {}, `[${f.seq}]`), h('td', {}, f.key), h('td', {}, f.value), h('td', { class: 'muted' }, `${f.source}, ${f.reader}`)))),
    approvals.length > 0 && [h('h4', {}, 'Decisions'), h('ul', {}, approvals.map(a => h('li', {}, `${date(a.decidedAt)} ${a.approverName} (${a.approverRole}) ${a.decision} at ${money(a.amountSeenCents)}${a.learn ? ', learned a rule' : ''}${a.reason ? `: ${a.reason}` : ''}`)))],
    ledger.length > 0 && [h('h4', {}, 'Ledger'), h('table', {}, ledger.map(l => h('tr', {}, h('td', {}, l.journal), h('td', {}, l.account),
      h('td', {}, l.debitCents ? `Dr ${money(l.debitCents)}` : ''), h('td', {}, l.creditCents ? `Cr ${money(l.creditCents)}` : ''), h('td', { class: 'muted' }, l.memo))))]);
}

function rules() {
  const rows = [...conn.db.boardRules.iter()].sort((a, b) => b.version - a.version);
  const policy = conn.db.boardPolicies.iter().next().value;
  return h('section', {},
    h('h3', {}, 'Learned rules'),
    !rows.length && h('p', { class: 'muted' }, 'None yet. An approval with "learn" checked creates one.'),
    h('table', {}, rows.map(r => h('tr', {}, h('td', {}, `v${r.version}`), h('td', {}, `${r.incidentKind} under ${r.coverKind}`),
      h('td', {}, `up to ${money(r.ceilingCents)}${r.requiresCorroborated ? ', corroborated only' : ''}`),
      h('td', {}, `from ${r.approverName} (${r.approverRole})`), h('td', {}, r.status)))),
    policy && h('p', { class: 'muted' }, `Policy ${policy.policyNumber} with ${policy.insurerName}. Medical payments used ${money(policy.medicalUsedCents)}, property used ${money(policy.propertyUsedCents)}.`));
}

function claimsTab() {
  return [incidentDesk(), myQueue(), openClaim !== undefined && claimDetail(openClaim), claimList(), rules()];
}

// --- Photos -------------------------------------------------------------------------------

/** Photo elements, kept across redraws so the images don't reload each second. */
const pictures = new Map<string, HTMLElement>();

function picture(url: string) {
  if (!pictures.has(url)) pictures.set(url, h('a', { href: url, target: '_blank' }, h('img', { src: url, alt: '' })));
  return pictures.get(url)!;
}

/** Every event photo, newest first: where and when, and the people the bands put in it. */
function photosTab() {
  const photos = [...conn.db.boardPhotos.iter()].sort((a, b) => Number(b.takenAt.microsSinceUnixEpoch - a.takenAt.microsSinceUnixEpoch));
  const names = new Map([...conn.db.boardAttendees.iter()].map(a => [a.nodeId, a.displayName]));
  const show = (id: bigint) => { tab = 'graph'; location.hash = 'graph'; render(); showPhotoInGraph(id); };
  return h('section', {},
    h('h3', {}, `Photos (${photos.length})`),
    !photos.length && h('p', { class: 'muted' }, 'No photos yet. A photographer adds them on /photo, and the people whose bands were in that zone at that moment are tagged.'),
    h('div', { class: 'photos' }, photos.map(p => h('figure', {},
      picture(p.url),
      h('figcaption', {},
        h('b', {}, p.caption || 'Event photo'),
        h('div', { class: 'muted' }, `${p.zoneName}, ${date(p.takenAt)}`),
        p.read && h('div', { class: 'muted' }, `${p.peopleCount} ${p.peopleCount === 1 ? 'person' : 'people'} in the photo`),
        h('div', {}, p.nodeIds.length ? p.nodeIds.map(id => names.get(id) || 'no name yet').join(', ') : h('span', { class: 'muted' }, 'Nobody tagged')),
        p.nodeIds.length > 0 && h('button', { class: 'link', onclick: () => show(p.id) }, 'Show in the event graph'))))));
}

// --- Merch --------------------------------------------------------------------------------

/** Template thumbnails, kept across redraws so the images don't blank out each second. */
const thumbs = new Map<string, HTMLElement>();

function thumb(url: string, title: string) {
  if (!thumbs.has(url)) thumbs.set(url, h('a', { href: url, target: '_blank' }, h('img', { src: url, width: 64, alt: title })));
  return thumbs.get(url)!;
}

/** The shopping agent's three picks for each attendee, with the photo, the line and why. */
function merchPicks() {
  const picks = [...conn.db.boardMerchPicks.iter()].sort((a, b) => a.attendeeName.localeCompare(b.attendeeName) || a.rank - b.rank);
  const ended = conn.db.eventState.id.find(0)?.ended ?? false;
  const titles = new Map([...conn.db.merchTemplate.iter()].map(t => [t.id, t]));
  return h('section', {},
    h('h3', {}, `Shopping agent picks (${new Set(picks.map(p => p.attendeeName)).size} attendees)`),
    !picks.length && h('p', { class: 'muted' }, ended ? 'Picking now. Each attendee in a photo gets three picks.' : 'The shopping agent picks for everyone in a photo once the event ends.'),
    can('ops') && ended && h('button', { onclick: () => act(() => conn.reducers.rerunShoppingAgent({})) }, 'Run the shopping agent again'),
    picks.length > 0 && h('table', {},
      h('tr', {}, h('th', {}, 'Attendee'), h('th', {}, '#'), h('th', {}, 'Product'), h('th', {}, 'Photo'), h('th', {}, 'Printed line'), h('th', {}, 'Why')),
      picks.map(p => {
        const t = titles.get(p.templateId);
        return h('tr', {},
          h('td', {}, p.attendeeName || '(no name yet)'), h('td', {}, String(p.rank)),
          h('td', {}, t ? [thumb(t.imageUrl, t.title), h('div', {}, t.title)] : `template ${p.templateId}`),
          h('td', {}, thumb(p.photoUrl, 'photo')),
          h('td', {}, p.line || h('span', { class: 'muted' }, 'none')),
          h('td', {}, p.reason));
      })));
}

/** The shopping agent's picks, the loaded templates and every attendee's order. */
function merchTab() {
  const templates = [...conn.db.merchTemplate.iter()].sort((a, b) => Number(a.id - b.id));
  const orders = [...conn.db.boardMerchOrders.iter()].sort((a, b) => Number(b.id - a.id));
  const paid = orders.filter(o => o.status === 'paid');
  const booths = (ids: bigint[]) => ids.map(id => conn.db.booth.id.find(id)?.name ?? `booth ${id}`).join(', ');
  return [
    merchPicks(),
    h('section', {},
      h('h3', {}, `Orders: ${orders.length}, of which ${paid.length} paid for ${money(paid.reduce((s, o) => s + o.amountCents, 0n))}`),
      !can('ops') && h('p', { class: 'muted' }, 'Orders show for the organizer.'),
      can('ops') && !orders.length && h('p', { class: 'muted' }, 'No orders yet. Attendees buy merch from their recap once the event ends.'),
      orders.length > 0 && h('table', {},
        h('tr', {}, h('th', {}, 'Order'), h('th', {}, 'Attendee'), h('th', {}, 'Item'), h('th', {}, 'Photo'), h('th', {}, 'Printed line'), h('th', {}, 'Size'), h('th', {}, 'Amount'), h('th', {}, 'Status'), h('th', {}, 'Nessie purchase'), h('th', {}, 'Ordered')),
        orders.map(o => h('tr', {},
          h('td', {}, `#${o.id}`), h('td', {}, o.attendeeName || '(no name yet)'), h('td', {}, o.title),
          h('td', {}, o.photoUrl ? thumb(o.photoUrl, 'photo') : ''), h('td', {}, o.line || '—'), h('td', {}, o.size || '—'),
          h('td', {}, money(o.amountCents)),
          h('td', { class: o.status === 'paid' ? 'pass' : o.status === 'failed' ? 'fail' : '' }, o.status, o.failure && h('div', { class: 'muted' }, o.failure)),
          h('td', {}, o.nessiePurchaseId ? h('code', {}, o.nessiePurchaseId) : h('span', { class: 'muted' }, 'not yet')),
          h('td', {}, date(o.createdAt)))))),
    h('section', {},
      h('h3', {}, `Templates (${templates.length})`),
      !templates.length && h('p', { class: 'muted' }, 'None loaded. scripts/merch-setup loads assets/merch/templates.json after the event import.'),
      templates.length > 0 && h('table', {},
        h('tr', {}, h('th', {}, 'Image'), h('th', {}, 'Title'), h('th', {}, 'Kind'), h('th', {}, 'Price'), h('th', {}, 'Photo area'), h('th', {}, 'Sponsor booths')),
        templates.map(t => h('tr', {},
          h('td', {}, thumb(t.imageUrl, t.title)),
          h('td', {}, t.title, h('div', { class: 'muted' }, t.name)), h('td', {}, t.kind), h('td', {}, money(t.priceCents)),
          h('td', {}, `${t.photoW}×${t.photoH} at ${t.photoX},${t.photoY}`),
          h('td', {}, t.boothIds.length ? booths(t.boothIds) : h('span', { class: 'muted' }, 'plain')))))),
  ];
}

// --- Kibana ---------------------------------------------------------------------------------

function kibana() {
  return [h('section', {}, h('ul', {}, cfg.dashboards.map(d => h('li', {}, h('a', { href: d.url, target: '_blank' }, d.title)))))];
}

// The page redraws on every change and every second; holding off while a button is pressed keeps a
// click from landing on a button that was just replaced.
let pressing = false;
document.addEventListener('pointerdown', () => { pressing = true; }, true);
document.addEventListener('pointerup', () => setTimeout(() => { pressing = false; }, 100), true);

function render() {
  if (!conn || pressing) return;
  const open = tabs();
  if (!open.length) return mount('app', header(), noRole());
  // A tab the caller's roles do not open falls back to their first one.
  if (!open.some(([key]) => key === tab)) tab = open[0][0];
  const body = tab === 'attendees' ? attendees() : tab === 'claims' ? claimsTab() : tab === 'graph' ? graphTab(conn) : tab === 'photos' ? photosTab() : tab === 'merch' ? merchTab() : tab === 'venue' ? venueSetupTab(conn, can('ops')) : tab === 'kibana' ? kibana() : tab === 'bands' ? bandsTab() : tab === 'staff' ? staffTab() : live();
  mount('app', header(), body);
}

async function main() {
  cfg = await config();
  // Wherever SpacetimeAuth is set up, sign-in comes first and staff always act as themselves; only a
  // local server without sign-in still takes ?as= for testing.
  if (cfg.auth_client_id && !idToken()) return mount('app', signInScreen());
  if (cfg.auth_client_id && new URLSearchParams(location.search).has('as')) history.replaceState(null, '', location.pathname + location.hash);
  conn = await connect(QUERIES, render);
  window.addEventListener('hashchange', () => { tab = location.hash.slice(1); render(); });
  setInterval(() => { if (!(document.activeElement instanceof HTMLInputElement)) render(); }, 1000);
}

main().catch(e => mount('app', h('p', { class: 'error' }, String(e?.message ?? e))));
