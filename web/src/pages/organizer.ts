// The organizer portal: the live event from the bands, alerts, who joined, insurance claims from the
// attendee's filing (or staff filing for them) to the named approver's decision, the event graph with its photos,
// the merch templates and orders, Elastic's jobs with their Kibana views, the venue setup from the event's name, and the live run
// in the venue's 3D view with its start, pause and end of the event.
// One portal for every staff member: the same tabs for all. Buttons a person cannot use are hidden,
// and the module checks every role again. The medic works incidents during the event; the organizer
// decides the claims afterwards.

import {
  act, config, connect, date, field, h, idToken, medicalCard, money, mount, risk, signIn,
  signOut, signedInEmail, time, type Config, EXIT_COLOURS,
} from '../lib';
import { bandCode } from '../band-code';
import { evidenceTrail } from '../evidence-trail';
import { graphTab, showPhotoInGraph } from '../graph';
import { present } from '../venue-map';
import { venueSetupTab } from '../venue-setup';
import { liveRunSection } from '../live-run';
import { mockup } from '../recap';
import type { DbConnection } from '../module_bindings';
import type { BoardMerchPick, BoardWallet, Claim, MerchTemplate } from '../module_bindings/types';

const QUERIES = [
  'SELECT * FROM my_roles',
  'SELECT * FROM my_owner',
  'SELECT * FROM event_state',
  'SELECT * FROM venue',
  'SELECT * FROM zone',
  'SELECT * FROM booth',
  'SELECT * FROM organization',
  'SELECT * FROM band',
  'SELECT * FROM station',
  'SELECT * FROM gateway',
  'SELECT * FROM settings',
  'SELECT * FROM open_incidents',
  'SELECT * FROM board_notes',
  'SELECT * FROM board_attendees',
  'SELECT * FROM claims_board',
  'SELECT * FROM unclaimed_injuries',
  'SELECT * FROM board_clinic_reports',
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
  'SELECT * FROM board_wallets',
  'SELECT * FROM board_merch_picks',
  'SELECT * FROM venue_setup',
  'SELECT * FROM venue_setup_step',
  'SELECT * FROM chosen_venue',
  'SELECT * FROM board_staff',
  'SELECT * FROM live_run',
  'SELECT * FROM live_pause',
  'SELECT * FROM incident_marker',
  'SELECT * FROM decision',
  'SELECT * FROM band_place',
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
    ended && h('p', {}, h('b', {}, `The event ended at ${date(state?.endedAt)}. `), 'Every tap link now shows the recap. Start or reopen it on the Live tab.'),
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
    liveRunSection(conn, can('ops')),
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
      h('h3', {}, 'Zones'),
      h('p', { class: 'muted' }, `${bands.length} bands at the event right now: ${crowd} in the crowd, ${test} test bands and ${bands.length - crowd - test} hardware bands.`),
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

/** The hospital report staff ask for when they file for an attendee. */
const REPORTS: [string, string][] = [['matches', 'Matches'], ['mismatch', "Doesn't match"], ['random', 'Random']];

/** What staff typed and picked for each injury, by incident id; the page redraws every second. */
const drafts = new Map<bigint, { story: string; report: string }>();
/** The incident staff just filed a claim for: its claim opens once it appears. */
let openWhenFiled: bigint | undefined;

/** Short first-person stories, one press each, from the incident's kind and zone. */
function stories(kind: string, zone: string): [string, string][] {
  return kind === 'sos'
    ? [
      ['Felt faint', `I felt faint and short of breath near the ${zone}, so I pressed the button on my band.`],
      ['Crushed at the barrier', `I got crushed against the barrier at the ${zone} and hurt my ribs, so I called for help with my band.`],
      ['Cut on broken glass', `I cut my hand on a broken glass near the ${zone} and pressed my band for help.`],
    ]
    : [
      ['Slipped on a drink', `I slipped on a spilled drink near the ${zone} and landed on my right wrist.`],
      ['Knocked over in the crowd', `Someone knocked into me in the crowd at the ${zone}. I fell and twisted my left ankle.`],
      ['Tripped on a cable', `I tripped over a cable near the ${zone} and hit my knee hard on the floor.`],
    ];
}

/** Resolved falls and SOS calls nobody filed a claim for: staff file it for the wearer, in their words. */
function injuriesWithoutClaim() {
  if (!can('ops', 'medic')) return null;
  const rows = [...conn.db.unclaimedInjuries.iter()].sort((a, b) => Number(a.incidentId - b.incidentId));
  return h('section', {},
    h('h3', {}, `Injuries without a claim (${rows.length})`),
    !rows.length && h('p', { class: 'muted' }, 'None right now. A resolved fall or SOS shows here until the attendee files a claim from their band page.'),
    rows.map(r => {
      const id = r.incidentId;
      const d = drafts.get(id) ?? { story: '', report: 'random' };
      drafts.set(id, d);
      const name = r.wearerName || 'the wearer';
      const box = `story-${id}`;
      const fill = (text: string) => {
        d.story = text;
        const el = document.querySelector(`[name="${box}"]`) as HTMLTextAreaElement | null;
        if (el) el.value = text;
      };
      const file = async (e: Event) => {
        e.preventDefault();
        const ok = await act(() => conn.reducers.fileClaimForWearer({ incidentId: id, statement: d.story.trim(), report: d.report }));
        if (!ok) return;
        drafts.delete(id);
        openWhenFiled = id;
        render();
      };
      return h('div', { class: 'incident' },
        h('p', {}, h('b', {}, name), `, band ${bandCode(r.bandId)}: ${r.kind === 'sos' ? 'SOS' : 'fall'} in ${r.zoneName} at ${time(r.openedAt)}${r.resolvedAt ? `, resolved at ${time(r.resolvedAt)}` : ''}`),
        r.notes.length > 0 ? h('ul', {}, r.notes.map(n => h('li', {}, n))) : h('p', { class: 'muted' }, 'No staff notes.'),
        h('form', { onsubmit: file },
          h('label', {}, 'What happened, in their words',
            h('textarea', { name: box, rows: 3, required: true, value: d.story, oninput: (e: Event) => { d.story = (e.target as HTMLTextAreaElement).value; } })),
          h('p', {}, 'Fill in: ', stories(r.kind, r.zoneName || 'stage').map(([label, text]) => h('button', { type: 'button', onclick: () => fill(text) }, label))),
          h('label', {}, 'Hospital report',
            h('select', { name: `report-${id}`, onchange: (e: Event) => { d.report = (e.target as HTMLSelectElement).value; } },
              REPORTS.map(([value, label]) => h('option', { value, selected: value === d.report || undefined }, label)))),
          h('button', {}, `File the claim as ${name}`)));
    }));
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

/** Opens a claim's detail and scrolls to it after the redraw. */
let scrollToClaim = false;

function showClaim(id: bigint) {
  openClaim = id;
  scrollToClaim = true;
  render();
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
      h('button', { class: 'link', onclick: () => showClaim(c.id) }, `#${c.id}`),
      ` ${c.claimantName || 'no claimant'}, ${c.incidentKind} in ${c.zoneName}, ${money(c.payoutCents)}: ${c.statusNote}`))));
}

function claimList() {
  const claims = [...conn.db.claimsBoard.iter()].sort((a, b) => Number(b.id - a.id));
  return h('section', {},
    h('h3', {}, 'All claims'),
    !claims.length && h('p', { class: 'muted' }, 'No claims yet. An attendee files one from their band page after an injury, or staff file it for them above.'),
    claims.length > 0 && h('table', {},
      h('tr', {}, h('th', {}, 'Claim'), h('th', {}, 'Claimant'), h('th', {}, 'What'), h('th', {}, 'Status'), h('th', {}, 'Payout'), h('th', {}, 'Waiting for')),
      claims.map(c => h('tr', { class: c.status.tag === 'Routed' && decides(c) ? 'alert' : '' },
        h('td', {}, h('button', { class: 'link', onclick: () => showClaim(c.id) }, `#${c.id}`)),
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

/** A Nessie deposit that failed leaves the claim in Paying with this in its note. */
function payoutFailed(c: Claim): boolean {
  return c.status.tag === 'Paying' && /payout failed/i.test(c.statusNote);
}

/** What the claim is waiting for, and for whom. */
function waiting(c: Claim, hospital: boolean): string {
  const name = c.claimantName || 'the claimant';
  switch (c.status.tag) {
    case 'AwaitingRecord': return hospital ? 'Waiting for the hospital report.' : 'Waiting for the medical record: upload the clinic\'s report below.';
    case 'ReadingRecord': return `Waiting for Claude to read the ${hospital ? 'hospital report' : 'medical record'}.`;
    case 'Verifying': return 'Waiting for the Elastic checks.';
    case 'Reviewing': return 'Waiting for the claims agent\'s review.';
    case 'Routed': return decides(c) ? 'Waiting for your decision.' : `Waiting for the ${c.routedToName.toLowerCase()} to decide.`;
    case 'Paying': return payoutFailed(c) ? `Approved. The payout to ${name}'s wallet failed and waits for a retry.` : `Approved. Paying ${money(c.payoutCents)} into ${name}'s wallet.`;
    case 'Settled': return `Settled. Waiting for the insurer to pay ${money(c.recoverableCents)}.`;
    case 'Refused': return 'Refused. Nothing is waiting.';
    case 'Reconciled': return 'Closed: the insurer paid. Nothing is waiting.';
    default: return '';
  }
}

/** Claims the organizer asked a recovery letter for since the page loaded. */
const recoveryAsked = new Set<bigint>();

/** For the organizer once a claim is decided: its letters, a payout retry, the insurer's payment and a recovery letter. */
function afterDecision(c: Claim) {
  if (!can('ops')) return null;
  const letters = ([
    [c.fnolHash, 'First notice of loss to the insurer'],
    [c.summaryHash, 'Approver summary'],
    [c.determinationHash, 'Claimant letter'],
    [c.recoveryHash, 'Recovery letter'],
  ] as [string, string][]).filter(([hash]) => hash);
  const settled = c.status.tag === 'Settled';
  const recover = c.coverKind === 'property' && (settled || c.status.tag === 'Reconciled');
  const pay = async (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const amount = Number(field(f, `paid-${c.id}`));
    await act(async () => {
      if (!(amount >= 0)) throw new Error('The amount is in dollars, for example 180.00.');
      await conn.reducers.recordInsurerPayment({ claimId: c.id, amountCents: BigInt(Math.round(amount * 100)), reference: field(f, `paid-ref-${c.id}`) });
    });
  };
  const ask = async (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const ok = await act(() => conn.reducers.requestRecoveryLetter({ claimId: c.id, counterpartyName: field(f, `handler-${c.id}`), counterpartyContact: field(f, `handler-contact-${c.id}`) }));
    if (ok) {
      recoveryAsked.add(c.id);
      f.reset();
      render();
    }
  };
  return [
    letters.length > 0 && [h('h4', {}, 'Letters'), h('ul', {}, letters.map(([hash, label]) => h('li', {}, h('a', { href: `/blobs/${hash}`, target: '_blank' }, label))))],
    payoutFailed(c) && h('p', {}, h('button', { onclick: () => act(() => conn.reducers.retryClaimPayout({ claimId: c.id })) }, 'Retry the payout')),
    settled && h('form', { onsubmit: pay },
      h('h4', {}, 'Record the insurer\'s payment'),
      h('label', {}, 'Amount in dollars', h('input', { name: `paid-${c.id}`, inputmode: 'decimal', required: true, value: (Number(c.recoverableCents) / 100).toFixed(2) })),
      h('label', {}, 'Reference', h('input', { name: `paid-ref-${c.id}`, placeholder: 'Cheque or transfer reference' })),
      h('button', {}, 'Record the payment')),
    recover && h('form', { onsubmit: ask },
      h('h4', {}, 'Ask for a recovery letter'),
      h('label', {}, 'Who was handling the equipment', h('input', { name: `handler-${c.id}`, required: true })),
      h('label', {}, 'Their contact', h('input', { name: `handler-contact-${c.id}`, placeholder: 'Email or phone', required: true })),
      h('button', {}, 'Ask for the letter'),
      recoveryAsked.has(c.id) && !c.recoveryHash && h('p', { class: 'muted' }, 'Asked. The letter shows under Letters once it is drafted.')),
  ];
}

function claimDetail(id: bigint) {
  const c = [...conn.db.claimsBoard.iter()].find(x => x.id === id);
  if (!c) return null;
  const v = c.packVersion;
  const byId = <T extends { id: bigint }>(rows: T[]) => rows.sort((a, b) => Number(a.id - b.id));
  const facts = [...conn.db.boardFacts.iter()].filter(f => f.claimId === id && f.packVersion === v).sort((a, b) => a.seq - b.seq);
  const checks = [...conn.db.boardChecks.iter()].filter(x => x.claimId === id && x.packVersion === v);
  const record = byId([...conn.db.boardRecords.iter()].filter(r => r.claimId === id)).pop();
  const hospital = byId([...conn.db.boardClinicReports.iter()].filter(r => r.claimId === id)).pop();
  const lines = [...conn.db.boardLines.iter()].filter(l => l.claimId === id).sort((a, b) => a.lineNo - b.lineNo);
  const review = byId([...conn.db.boardReviews.iter()].filter(r => r.claimId === id)).pop();
  const precedents = [...conn.db.boardPrecedents.iter()].filter(p => p.claimId === id && p.packVersion === v);
  const approvals = [...conn.db.boardApprovals.iter()].filter(a => a.claimId === id);
  const ledger = [...conn.db.boardLedger.iter()].filter(l => l.claimId === id);
  const rule = c.settlementRuleId ? [...conn.db.boardRules.iter()].find(r => r.id === c.settlementRuleId) : undefined;
  const open = hospital ? 'Open the report' : 'Open the PDF';
  const verdict = (x: string) => x.replace('_', ' ');
  return h('section', { id: 'claim-detail' },
    h('h3', {}, `Claim #${c.id}: ${c.claimantName || 'no claimant'}, ${c.incidentKind} in ${c.zoneName}`, ' ', h('button', { class: 'link', onclick: () => { openClaim = undefined; render(); } }, 'close')),
    h('p', { class: 'big' }, h('b', {}, statusOf(c)), c.statusNote && `: ${c.statusNote}`),
    h('p', {}, h('b', {}, waiting(c, !!hospital)), review && ` Claims agent (Claude): ${verdict(review.verdict)}.`),
    c.statement && h('p', {}, h('b', {}, 'In their words: '), `"${c.statement}"`),
    evidenceTrail(conn, c),
    hospital && [h('h4', {}, 'Hospital report'),
      hospital.status === 'requested' && h('p', {}, 'Hospital report requested', h('span', { class: 'muted' }, ` at ${time(hospital.requestedAt)}`)),
      hospital.status === 'received' && h('p', {}, `Hospital report from ${hospital.providerName}, visit ${hospital.visitDate}. `, h('a', { href: `/blobs/${hospital.fileHash}`, target: '_blank' }, 'Open the report')),
      hospital.status === 'failed' && h('p', { class: 'fail' }, `The hospital report failed: ${hospital.problems.join('; ')}`)],
    // Claims the scripted claims run files have no hospital report: staff upload the clinic's PDF.
    !hospital && c.status.tag === 'AwaitingRecord' && can('medic', 'ops') && h('form', { onsubmit: (e: Event) => { e.preventDefault(); act(() => fileRecord(c.id, e.target as HTMLFormElement)); } },
      h('h4', {}, 'Upload the clinic\'s report'),
      h('label', {}, 'Clinic report PDF', h('input', { type: 'file', name: `record-${c.id}`, accept: 'application/pdf' })),
      cfg.test_mode && h('label', {}, 'or a test report, dated for this incident', h('select', { name: 'test-record' }, h('option', { value: '' }, '—'), TEST_RECORDS.map(([f, label]) => h('option', { value: f }, label)))),
      h('button', {}, 'Upload it, Claude reads it')),
    review && [h('h4', {}, `Claims agent review (Claude): ${verdict(review.verdict)}`),
      h('p', {}, review.summary), review.causation && h('p', {}, `Causation: ${review.causation}`),
      review.concerns.length > 0 && h('ul', {}, review.concerns.map(x => h('li', {}, x))),
      review.missingEvidence.length > 0 && h('p', {}, `Missing: ${review.missingEvidence.join('; ')}`),
      review.rejected.length > 0 && h('p', { class: 'fail' }, `Code rejected the review: ${review.rejected.join('; ')}`)],
    c.status.tag === 'Routed' && decides(c) && h('div', {}, h('h4', {}, 'Your decision'), decide(c)),
    afterDecision(c),
    h('p', {}, `Cost ${money(c.costCents)} · payout ${money(c.payoutCents)} · recoverable from the insurer ${money(c.recoverableCents)} · venue pays ${money(c.venueCostCents)}`),
    h('p', { class: 'muted' }, `Evidence pack v${v}, sha ${c.packHash.slice(0, 12)} · corroboration ${c.corroboration || 'n/a'} · decided by ${c.decidedBy || 'nobody yet'}${rule ? ` under rule v${rule.version} from ${rule.approverName}` : ''}${c.payoutReference ? ` · ${c.payoutReference}` : ''}`),
    h('h4', {}, 'Checks'),
    h('table', {}, checks.map(x => h('tr', {}, h('td', { class: x.result }, x.result), h('td', {}, x.name), h('td', {}, x.detail), h('td', { class: 'muted' }, x.reader)))),
    record && record.status !== 'extracted' && [h('h4', {}, hospital ? 'Hospital report' : 'Medical record'),
      h('p', {}, record.status === 'reading' ? `Claude is reading the ${hospital ? 'report' : 'PDF'}.` : `Claude could not read it: ${record.dropped.join('; ')}`, ' ',
        h('a', { href: `/blobs/${record.fileHash}`, target: '_blank' }, open))],
    record && record.status === 'extracted' && [h('h4', {}, `${hospital ? 'Hospital report' : 'Medical record'}, read by Claude`),
      h('p', {}, `${record.documentKind} for ${record.patientName} from ${record.providerName} on ${record.dateOfService}, invoice ${record.invoiceNumber}. Billed ${money(record.billedCents)}, covered ${money(record.coveredCents)}.`),
      record.reasonForVisit && h('p', {}, `Reason: ${record.reasonForVisit}. ${record.history}`),
      h('p', {}, `Diagnoses: ${record.diagnoses.join('; ')}`),
      record.dropped.length > 0 && h('p', {}, `Dropped: ${record.dropped.join('; ')}`),
      h('a', { href: `/blobs/${record.fileHash}`, target: '_blank' }, open)],
    lines.length > 0 && [h('h4', {}, 'Billed lines'), h('table', {},
      h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Service'), h('th', {}, 'Billed'), h('th', {}, 'Allowed'), h('th', {}, 'Covered'), h('th', {}, 'Outcome')),
      lines.map(l => h('tr', {}, h('td', {}, l.code), h('td', {}, l.description), h('td', {}, money(l.billedCents)), h('td', {}, money(l.allowedCents)),
        h('td', {}, money(l.coveredCents)), h('td', { class: l.outcome === 'excluded' ? 'fail' : '' }, `${l.outcome}${l.reason ? `: ${l.reason}` : ''}`))))],
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
  // A claim staff just filed opens as soon as the module creates it.
  const filed = openWhenFiled !== undefined && [...conn.db.claimsBoard.iter()].find(c => c.incidentId === openWhenFiled);
  if (filed) {
    openWhenFiled = undefined;
    openClaim = filed.id;
    scrollToClaim = true;
  }
  return [incidentDesk(), injuriesWithoutClaim(), myQueue(), openClaim !== undefined && claimDetail(openClaim), claimList(), rules()];
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

/** Thumbnails, kept across redraws so the images don't blank out each second. One element can sit in
 *  one place only, so each is kept per `slot`, the row it shows in. */
const thumbs = new Map<string, HTMLElement>();

function thumb(url: string, title: string, slot: string) {
  const key = `${slot} ${url}`;
  if (!thumbs.has(key)) thumbs.set(key, h('a', { href: url, target: '_blank' }, h('img', { src: url, width: 64, alt: title })));
  return thumbs.get(key)!;
}

/** The attendee the organizer is buying as, by node id. */
let shopper: bigint | undefined;

/** A button for every attendee with a wallet; the chosen one's shop follows, laid out as the same steps. */
function buyAs() {
  const ended = conn.db.eventState.id.find(0)?.ended ?? false;
  const people = new Map([...conn.db.boardAttendees.iter()].map(a => [a.nodeId, a.displayName || 'no name yet']));
  const wallets = [...conn.db.boardWallets.iter()].filter(w => people.has(w.nodeId))
    .sort((a, b) => people.get(a.nodeId)!.localeCompare(people.get(b.nodeId)!));
  const chosen = wallets.find(w => w.nodeId === shopper);
  return h('section', {},
    h('h3', {}, 'Buy as an attendee'),
    h('p', { class: 'muted' }, ended
      ? 'Pick someone to see their shop as their recap shows it, and buy for them from their own wallet.'
      : 'Merch is sold once the event ends. Until then this shows each wallet.'),
    !wallets.length && h('p', { class: 'muted' }, 'Nobody has a wallet yet. Attendees connect one at band setup.'),
    h('p', {}, wallets.map(w => h('button', { class: w.nodeId === shopper ? 'on' : '', onclick: () => { shopper = w.nodeId; render(); } },
      `${people.get(w.nodeId)} · ${money(w.balanceCents)}`))),
    chosen && shopFor(chosen, people, ended));
}

/** The pick as the recap draws it. The booth crawl ticks come from the attendee's own view, so none show here. */
function pickMockup(p: BoardMerchPick, t: MerchTemplate) {
  const key = `${p.nodeId} ${p.templateId} ${p.photoId}`;
  if (!pickMockups.has(key)) pickMockups.set(key, mockup({ ...t, rank: p.rank, templateId: t.id, photoId: p.photoId, photoUrl: p.photoUrl, line: p.line, reason: p.reason, friends: [], ticks: [] }));
  return pickMockups.get(key)!;
}

const pickMockups = new Map<string, HTMLCanvasElement>();

function shopFor(w: BoardWallet, people: Map<bigint, string>, ended: boolean) {
  const who = people.get(w.nodeId)!;
  const picks = [...conn.db.boardMerchPicks.iter()].filter(p => p.nodeId === w.nodeId).sort((a, b) => a.rank - b.rank);
  const orders = [...conn.db.boardMerchOrders.iter()].filter(o => o.nodeId === w.nodeId).sort((a, b) => Number(b.id - a.id));
  const photoIds = new Set(picks.map(p => p.photoId));
  const photos = [...conn.db.boardPhotos.iter()].filter(p => photoIds.has(p.id));
  const buy = (e: Event, p: BoardMerchPick, kind: string) => {
    e.preventDefault();
    const size = kind === 'tee' ? field(e.target as HTMLElement, `as-size-${p.templateId}`) : '';
    act(() => conn.reducers.buyMerchAs({ nodeId: w.nodeId, templateId: p.templateId, photoId: p.photoId, size }));
  };
  return h('div', { class: 'flow' },
    h('div', { class: 'step' },
      h('b', {}, `1. ${who}'s photo`),
      !photos.length && h('p', { class: 'muted' }, 'None picked yet.'),
      photos.map(p => [picture(p.url),
        h('div', {}, p.caption || 'Event photo'),
        h('div', { class: 'muted' }, `${p.zoneName}, ${date(p.takenAt)}${p.read ? `, ${p.peopleCount} people counted` : ''}`),
        h('div', {}, `With ${p.nodeIds.filter(id => id !== w.nodeId).map(id => people.get(id) ?? 'no name yet').join(', ') || 'nobody else tagged'}`)])),
    h('span', { class: 'arrow' }, '↓'),
    h('div', { class: 'step' },
      h('b', {}, '2. The shopping agent\'s picks'),
      !picks.length && h('p', { class: 'muted' }, ended ? 'No picks for them yet: the agent picks for everyone in a photo.' : 'The agent picks when the event ends.'),
      h('div', { class: 'merch' }, picks.map(p => {
        const t = conn.db.merchTemplate.id.find(p.templateId);
        if (!t) return null;
        return h('figure', {}, pickMockup(p, t),
          h('figcaption', {},
            h('b', {}, `${p.rank}. ${t.title}`), ` · ${money(t.priceCents)}`,
            p.reason && h('div', { class: 'muted' }, p.reason),
            h('form', { onsubmit: (e: Event) => buy(e, p, t.kind) },
              t.kind === 'tee' && h('label', {}, 'Size', h('select', { name: `as-size-${p.templateId}` },
                ['S', 'M', 'L', 'XL'].map(x => h('option', { value: x, selected: x === 'M' || undefined }, x)))),
              h('button', { disabled: !ended || w.balanceCents < t.priceCents || undefined }, `Buy as ${who}`))));
      }))),
    h('span', { class: 'arrow' }, '↓'),
    h('div', { class: 'step' },
      h('b', {}, '3. Their wallet'),
      h('div', { class: 'count' }, money(w.balanceCents)),
      h('div', { class: 'muted' }, `Capital One account ${w.accountId.slice(0, 8)}`)),
    h('span', { class: 'arrow' }, '↓'),
    h('div', { class: 'step' },
      h('b', {}, '4. Paid on Nessie'),
      !orders.length && h('p', { class: 'muted' }, 'No orders yet.'),
      orders.map(o => h('p', {},
        `#${o.id} ${o.title}${o.size ? ` (${o.size})` : ''}, ${money(o.amountCents)}: `,
        h('span', { class: o.status === 'paid' ? 'pass' : o.status === 'failed' ? 'fail' : '' }, o.status),
        o.nessiePurchaseId && h('div', { class: 'muted' }, 'Nessie purchase ', h('code', {}, o.nessiePurchaseId)),
        o.failure && h('div', { class: 'muted' }, o.failure)))));
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
          h('td', {}, t ? [thumb(t.imageUrl, t.title, `pick ${p.id}`), h('div', {}, t.title)] : `template ${p.templateId}`),
          h('td', {}, thumb(p.photoUrl, 'photo', `pick ${p.id}`)),
          h('td', {}, p.line || h('span', { class: 'muted' }, 'none')),
          h('td', {}, p.reason));
      })));
}

/** Buying as an attendee, the shopping agent's picks, every attendee's order and the loaded templates. */
function merchTab() {
  const templates = [...conn.db.merchTemplate.iter()].sort((a, b) => Number(a.id - b.id));
  const orders = [...conn.db.boardMerchOrders.iter()].sort((a, b) => Number(b.id - a.id));
  const paid = orders.filter(o => o.status === 'paid');
  const booths = (ids: bigint[]) => ids.map(id => conn.db.booth.id.find(id)?.name ?? `booth ${id}`).join(', ');
  return [
    can('ops') && buyAs(),
    merchPicks(),
    h('section', {},
      h('h3', {}, `Orders: ${orders.length}, of which ${paid.length} paid for ${money(paid.reduce((s, o) => s + o.amountCents, 0n))}`),
      !can('ops') && h('p', { class: 'muted' }, 'Orders show for the organizer.'),
      can('ops') && !orders.length && h('p', { class: 'muted' }, 'No orders yet. Attendees buy merch from their recap once the event ends.'),
      orders.length > 0 && h('table', {},
        h('tr', {}, h('th', {}, 'Order'), h('th', {}, 'Attendee'), h('th', {}, 'Item'), h('th', {}, 'Photo'), h('th', {}, 'Printed line'), h('th', {}, 'Size'), h('th', {}, 'Amount'), h('th', {}, 'Status'), h('th', {}, 'Nessie purchase'), h('th', {}, 'Ordered')),
        orders.map(o => h('tr', {},
          h('td', {}, `#${o.id}`), h('td', {}, o.attendeeName || '(no name yet)'), h('td', {}, o.title),
          h('td', {}, o.photoUrl ? thumb(o.photoUrl, 'photo', `order ${o.id}`) : ''), h('td', {}, o.line || '—'), h('td', {}, o.size || '—'),
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
          h('td', {}, thumb(t.imageUrl, t.title, 'template')),
          h('td', {}, t.title, h('div', { class: 'muted' }, t.name)), h('td', {}, t.kind), h('td', {}, money(t.priceCents)),
          h('td', {}, `${t.photoW}×${t.photoH} at ${t.photoX},${t.photoY}`),
          h('td', {}, t.boothIds.length ? booths(t.boothIds) : h('span', { class: 'muted' }, 'plain')))))),
  ];
}

// --- Kibana ---------------------------------------------------------------------------------

/** Elastic's jobs in the order of the event, each with what it does and the Kibana views that show it. */
const EVIDENCE_ENGINE: { job: string; what: string; views: [string, string][] }[] = [
  {
    job: 'Before the event: organizing the scraped event data',
    what: 'Bright Data scraped the event pages and the sponsors\' company profiles into raw indices. The workflow bandit-organize joins the exact matches with ES|QL LOOKUP JOIN, and the agent bandit-organizer resolves the rest and gives a reason for every merge. Rust checks the bundle and loads it into SpacetimeDB in one transaction: the venue, zones, sponsors, booths and schedule on the other tabs.',
    views: [
      ['Scrape pipeline: raw records, merges and the reason for each', '/app/dashboards#/view/bandit-pipeline-calhacks-13'],
      ['Sponsors and prizes: what the scrape found', '/app/dashboards#/view/bandit-event-calhacks-13'],
      ['bandit-organize runs, step by step', '/app/workflows'],
      ['bandit-organizer, the agent and its tool calls', '/app/agent_builder'],
    ],
  },
  {
    job: 'During the event: the bands\' radio log and the photos',
    what: 'The venue laptop records every packet the gateway hears from the bands and the station markers: zone, battery, SOS, fall and button presses, and the signal strength of every band nearby. It also records every photo\'s camera, time and place, never the image. The log is kept for after the event; nothing live reads it, since the Live tab comes from SpacetimeDB.',
    views: [['Band radio and photos', '/app/dashboards#/view/bandit-radio']],
  },
  {
    job: 'After the event: ordering the recap\'s suggestions',
    what: 'Each recap suggests the people an attendee hung out with and the booths where they spent time. SpacetimeDB decides who and what is on the list; Elastic only orders it by meaning, matching the attendee\'s interests against each person\'s interests and each booth\'s description.',
    views: [['Recap suggestions: each attendee\'s latest ranking next to the minutes order', '/app/dashboards#/view/bandit-recap']],
  },
  {
    job: 'Claims: checking the evidence',
    what: 'Each claim\'s evidence goes to Elastic as a copy with no names: codes, amounts, zone, time and a sentence written by code. The ingest pipeline bandit-claims-validate checks it on the way in, and a search by meaning finds the most similar past claims. Both come back to the claim as checks on the Claims tab; they never change an amount.',
    views: [['Claims evidence: validation, outcomes and payouts', '/app/dashboards#/view/bandit-claims']],
  },
];

function kibana() {
  return [
    h('section', {},
      h('h3', {}, 'Elastic, the Evidence Engine'),
      h('p', {}, 'Elastic works in the background: it organizes and validates data and orders it by meaning. It never holds live state and never decides; SpacetimeDB owns the live event and Claude makes the decisions. Each view opens in Kibana, signed in to the Elastic Cloud project.')),
    EVIDENCE_ENGINE.map(({ job, what, views }) => h('section', {},
      h('h3', {}, job),
      h('p', {}, what),
      h('ul', {}, views.map(([title, path]) => h('li', {}, h('a', { href: `${cfg.kibana_url}${path}`, target: '_blank' }, title)))))),
  ];
}

// The page redraws on every change and every second; holding off while a button is pressed keeps a
// click from landing on a button that was just replaced.
let pressing = false;
document.addEventListener('pointerdown', () => { pressing = true; }, true);
document.addEventListener('pointerup', () => setTimeout(() => { pressing = false; }, 100), true);

function render() {
  // Typing in a story box or choosing from a list holds redraws too, so the text and the open list stay put.
  const busy = document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLSelectElement;
  if (!conn || pressing || busy) return;
  const open = tabs();
  mount('head', header());
  if (!open.length) return mount('app', noRole());
  // A tab the caller's roles do not open falls back to their first one.
  if (!open.some(([key]) => key === tab)) tab = open[0][0];
  const body = tab === 'attendees' ? attendees() : tab === 'claims' ? claimsTab() : tab === 'graph' ? graphTab(conn) : tab === 'photos' ? photosTab() : tab === 'merch' ? merchTab() : tab === 'venue' ? venueSetupTab(conn, can('ops')) : tab === 'kibana' ? kibana() : tab === 'bands' ? bandsTab() : tab === 'staff' ? staffTab() : live();
  mount('app', body);
  if (scrollToClaim) {
    scrollToClaim = false;
    document.getElementById('claim-detail')?.scrollIntoView({ block: 'start' });
  }
}

async function main() {
  cfg = await config();
  // Wherever SpacetimeAuth is set up, sign-in comes first and staff always act as themselves; only a
  // local server without sign-in still takes ?as= for testing.
  if (cfg.auth_client_id && !idToken()) return mount('app', signInScreen());
  if (cfg.auth_client_id && new URLSearchParams(location.search).has('as')) history.replaceState(null, '', location.pathname + location.hash);
  conn = await connect(QUERIES, render);
  window.addEventListener('hashchange', () => { tab = location.hash.slice(1); render(); });
  setInterval(() => { if (!(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLSelectElement)) render(); }, 1000);
}

main().catch(e => mount('app', h('p', { class: 'error' }, String(e?.message ?? e))));
