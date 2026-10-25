// The organizer portal: the live event from the bands, alerts, everyone at the event with what staff do as each of them, settlements: who pays what on each
// claim, from the attendee's filing (or staff filing for them) to the named approver's sign-off and the payout, the costs so far from the claims' journals, the event graph with its photos,
// the merch templates and orders, Elastic's jobs with their Kibana views, the venue setup from the event's name with the venue's insurance policy, and the live run
// in the venue's 3D view with its start, pause and end of the event.
// The owner also views the portal and the attendee pages as any person sees them, read-only.
// One portal for every staff member: the same tabs for all. Buttons a person cannot use are hidden,
// and the module checks every role again. The medic works incidents during the event; the organizer
// decides the claims afterwards.

import {
  act, bandById, capital, complicated, config, connect, date, field, h, idToken, isLoss, kindWords, medicalCard, money, mount, risk, roleWords,
  signIn, signOut, signedInEmail, time, viewing, type Config, EXIT_COLOURS,
} from '../lib';
import { bandCode, bandFromCode } from '../band-code';
import { costsTab } from '../costs';
import { evidenceTrail } from '../evidence-trail';
import { graphTab, showPhotoInGraph } from '../graph';
import { present } from '../venue-map';
import { venueSetupTab } from '../venue-setup';
import { liveRunSection, runBar } from '../live-run';
import { rulesTab } from '../rule-proposals';
import { screens, serveViewers, viewUrl } from '../view-as';
import { matches, redrawOnSearch, searchWords, searchable } from '../table-search';
import { keepTableHeights } from '../resize';
import { defineTerms, readingDefinition } from '../terms';
import { mockup } from '../recap';
import type { DbConnection } from '../module_bindings';
import type { AttendeeOut, BoardMerchPick, BoardWallet, Charge, Claim, Departure, MerchTemplate, ViewablePerson } from '../module_bindings/types';

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
  'SELECT * FROM decision',
  'SELECT * FROM board_charges',
  'SELECT * FROM board_records',
  'SELECT * FROM board_approvals',
  'SELECT * FROM board_ledger',
  'SELECT * FROM board_rules',
  'SELECT * FROM board_rule_proposals',
  'SELECT * FROM board_organizer_precedents',
  'SELECT * FROM board_policies',
  'SELECT * FROM board_covers',
  'SELECT * FROM board_policy_documents',
  'SELECT * FROM board_policy_terms',
  'SELECT * FROM board_venue_policy_lookups',
  'SELECT * FROM board_fee_schedule',
  'SELECT * FROM medic_medical_cards',
  'SELECT * FROM event_graph',
  'SELECT * FROM board_photos',
  'SELECT * FROM merch_template',
  'SELECT * FROM board_merch_orders',
  'SELECT * FROM board_merch_shipping',
  'SELECT * FROM board_wallets',
  'SELECT * FROM board_merch_picks',
  'SELECT * FROM event_import',
  'SELECT * FROM event_import_step',
  'SELECT * FROM venue_setup',
  'SELECT * FROM venue_setup_step',
  'SELECT * FROM chosen_venue',
  'SELECT * FROM board_staff',
  'SELECT * FROM live_run',
  'SELECT * FROM live_pause',
  'SELECT * FROM live_evacuation',
  'SELECT * FROM incident_marker',
  'SELECT * FROM decision',
  'SELECT * FROM band_place',
  'SELECT * FROM departure',
  'SELECT * FROM venue_spot',
  'SELECT * FROM view_as_people',
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
  const all: [string, string][] = [['live', 'Live'], ['attendees', 'Attendees'], ['claims', 'Settlements'], ['rules', 'Proposed rules'], ['costs', 'Costs'], ['graph', 'Event graph'], ['photos', 'Photos'], ['merch', 'Merch'], ['venue', 'Venue setup'], ['kibana', 'Kibana']];
  const owned: [string, string][] = isOwner() ? [...all, ['staff', 'Staff'], ['viewas', 'View as']] : all;
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
  const b = bandById(conn, bandId);
  return !!b && present(b);
}

function bandStatus(bandId: number): string {
  if (!bandId) return 'no band';
  if (!bandById(conn, bandId)) return 'not seen yet';
  return alive(bandId) ? 'online' : 'offline';
}

/** The attendee's departure, by graph node id, once they left early. */
function departureOf(nodeId: bigint | undefined) {
  return nodeId === undefined ? undefined : [...conn.db.departure.iter()].find(d => d.nodeId === nodeId);
}

/** True once the event has ended for this attendee: it ended, or they walked out early. */
function overFor(nodeId: bigint | undefined): boolean {
  return (conn.db.eventState.id.find(0)?.ended ?? false) || !!departureOf(nodeId)?.leftAt;
}

/** "walking to the Public Entrance" or "left at 09:41 PM by the Public Entrance". */
function leftWords(d: Departure): string {
  const door = d.door ? ` by the ${d.door}` : '';
  return d.leftAt ? `left at ${time(d.leftAt)}${door}` : `walking to the ${d.door || 'door'}`;
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
    signedInEmail() && can('medic') && !can('ops') && h('p', {}, organizerAccessLink()),
    roles().has('medic') && h('p', {}, 'Tap a band with this phone to open the wearer\'s medical card.'),
    ended && h('p', {}, h('b', {}, `The event ended at ${date(state?.endedAt)}. `), 'Every tap link now shows the recap.'),
    can(...STAFF_ROLES) && runBar(conn, can('ops')),
    h('nav', {}, tabs().map(([key, label]) => h('a', { href: `#${key}`, class: key === tab ? 'on' : '', onclick: () => { tab = key; render(); } }, label))),
  ];
}

/** Signed-in people can choose organizer access without an email invitation. */
function noRole() {
  return h('section', {},
    h('h3', {}, 'Organizer access'),
    signedInEmail()
      ? h('p', {}, 'You can run the event with this account.')
      : h('p', {}, 'Sign in with email to run the event.'),
    h('p', {}, organizerAccessLink()),
    roles().has('photographer') && h('p', {}, h('a', { href: '/photo' }, 'Add event photos')));
}

function organizerAccessLink() {
  const next = location.pathname === '/portal' ? '/portal' : '/organizer';
  return h('a', { href: `/organizer-access?next=${encodeURIComponent(next)}` }, 'Continue as organizer');
}

/** The first screen: staff sign in before they see anything. */
function signInScreen() {
  return [
    h('h2', {}, 'BandIt organizer portal'),
    h('p', {}, 'Sign in with your email to run the event: live zones and alerts, attendees, who pays for each claim and the end of the event.'),
    h('button', { onclick: signIn }, 'Sign in with email'),
  ];
}

// --- Live -----------------------------------------------------------------------------------

/** The Live tab: the 3D venue with the opened person beside it, then the alerts and the zones. */
function live(people: Person[]) {
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
  const selected = (people.find(p => p.key === opened) ?? bandOnly(opened))?.bandId ?? 0;
  const panel = personPanel(people);
  return [
    // The 3D venue is the same for everyone, so a View as frame leaves it out.
    viewing() ? panel : liveRunSection(conn, can('ops'), { open: openBand, selected, panel }),
    (alerts.length > 0 || incidents.length > 0) && h('section', { class: 'alert' },
      h('h3', {}, 'Alerts'),
      h('ul', {},
        alerts.map(b => {
          const z = zones.find(z => z.stationId === b.zone);
          return h('li', {}, h('b', {}, b.fall ? 'Fall' : 'SOS'), ` on band ${bandCode(b.id)}${wearer(b.id)} in ${z?.name ?? 'no zone'}: the bands around it show the light circle.`);
        }),
        incidents.map(i => h('li', {}, `Incident ${i.id}: ${kindWords(i.kind.tag)} in ${zoneName(i.zoneId)}, ${i.subjectBand ? `band ${bandCode(i.subjectBand)}${wearer(i.subjectBand)}` : 'no band'}, ${i.status.tag}, opened ${time(i.openedAt)} `,
          h('a', { href: '#claims' }, 'open in Settlements'))))),
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
    leftEarly(people),
  ];
}

/** Everyone who left before the event ended, newest first. */
function leftEarly(people: Person[]) {
  const gone = [...conn.db.departure.iter()].sort((a, b) => Number(b.askedAt.microsSinceUnixEpoch - a.askedAt.microsSinceUnixEpoch));
  if (!gone.length) return null;
  return h('section', {},
    h('h3', {}, `Left early (${gone.length})`),
    h('table', {},
      h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Door'), h('th', {}, 'Set off'), h('th', {}, 'Left'), h('th', {}, 'By'), h('th', {})),
      gone.map(d => {
        const p = people.find(x => x.att?.nodeId === d.nodeId);
        return h('tr', {},
          h('td', {}, d.name), h('td', {}, d.door), h('td', {}, time(d.askedAt)), h('td', {}, d.leftAt ? time(d.leftAt) : 'walking'), h('td', {}, d.by),
          h('td', {}, p && h('button', { onclick: () => openPerson(p) }, 'Open')));
      })));
}

// --- Attendees ------------------------------------------------------------------------------

function takeBack(bandId: number, name: string) {
  return confirm(`Take band ${bandCode(bandId)} back from ${name || 'this attendee'}? They keep their profile and memories; the next person can claim the band.`)
    && act(() => conn.reducers.releaseBand({ bandId }));
}

function attendees() {
  const all = [...conn.db.boardAttendees.iter()].sort((a, b) => Number(a.crowd) - Number(b.crowd) || a.displayName.localeCompare(b.displayName));
  const kind = (a: (typeof all)[number]) => a.crowd || a.bandId >= 100 ? 'crowd' : a.bandId >= 90 ? 'test' : a.bandId > 0 ? 'hardware' : 'none';
  const count = (k: string) => all.filter(a => kind(a) === k).length;
  const roles = new Map<string, number>();
  for (const a of all) roles.set(a.role, (roles.get(a.role) ?? 0) + 1);
  const words = searchWords('attendees');
  const hits = words.length ? all.filter(a => matches([a.displayName, roleWords(a.role), a.crowd ? 'crowd' : '', a.bandId ? bandCode(a.bandId) : '', bandStatus(a.bandId), a.organization,
    a.findable ? 'yes' : 'no', ...a.handles.map(x => `${x.platform} ${x.handle}`), time(a.createdAt)].join(' '), words)) : all;
  const shown = hits.slice(0, hits.filter(a => !a.crowd).length + CROWD_ROWS);
  const ended = conn.db.eventState.id.find(0)?.ended ?? false;
  return h('section', {},
    h('h3', {}, `${all.length} attendees`),
    h('p', { class: 'muted' }, `${count('crowd')} in the crowd, ${count('test')} wearing test bands, ${count('hardware')} wearing hardware bands${count('none') ? `, ${count('none')} without a band` : ''}.`),
    h('p', { class: 'muted' }, `${ROLES.filter(([r]) => roles.has(r)).map(([r, many]) => `${roles.get(r)} ${roles.get(r) === 1 ? roleWords(r) : many}`).join(', ')}.`),
    hits.length > shown.length && h('p', { class: 'muted' }, `Showing the first ${CROWD_ROWS} crowd attendees, by name.`),
    searchable('attendees', h('table', {},
      h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Role'), h('th', {}, 'Band'), h('th', {}, 'Band status'), h('th', {}, 'Company'), h('th', {}, 'Findable'), h('th', {}, 'Socials'), h('th', {}, 'Joined')),
      shown.map(a => h('tr', {},
        h('td', {}, a.displayName || '(no name yet)', a.crowd && h('span', { class: 'muted' }, ' crowd')),
        h('td', {}, roleWords(a.role)),
        h('td', {}, a.bandId ? h('a', { href: `/t/${bandCode(a.bandId)}` }, bandCode(a.bandId)) : ''),
        h('td', { class: a.bandId && alive(a.bandId) ? 'pass' : 'muted' }, bandStatus(a.bandId),
          a.bandId > 0 && a.bandId < 100 && !ended && h('div', {}, h('button', { class: 'link', onclick: () => takeBack(a.bandId, a.displayName) }, 'Take the band back'))),
        h('td', {}, a.organization), h('td', {}, a.findable ? 'yes' : 'no'),
        h('td', {}, a.handles.map(x => `${x.platform} ${x.handle}`).join(', ')), h('td', {}, time(a.createdAt))))), shown.length < all.length));
}

// --- People (Live tab) ----------------------------------------------------------------------

/** One person on the Live tab's list: an attendee from the host's list, or a staff member the owner can view as,
 *  with what they do at the event and the kind of band they wear. */
type Person = { key: string; name: string; role: string; kind: string; crowd: boolean; bandId: number; att?: AttendeeOut; view?: ViewablePerson };

/** Every role that wears a band, in the order the counts list them, with its plural. */
const ROLES: [string, string][] = [
  ['hacker', 'hackers'], ['booth_staff', 'booth staff'], ['organizer', 'organizers'], ['photographer', 'photographers'], ['speaker', 'speakers'],
  ['attendee', 'attendees who tapped a band'],
];

/** What the Live tab's search holds, and the person opened from the list, by key. */
let peopleSearch = '';
let opened = '';
/** Where the opened person's panel scrolls to on the next redraw: its top, or just into view under the 3D venue. */
let scrollToPerson: '' | 'top' | 'view' = '';

/** Band codes by band id: the list shows a thousand of them on every redraw. */
const codes = new Map<number, string>();

function code(bandId: number): string {
  if (!codes.has(bandId)) codes.set(bandId, bandCode(bandId));
  return codes.get(bandId)!;
}

function kindOf(bandId: number, crowd: boolean): string {
  return crowd || bandId >= 100 ? 'crowd band' : bandId >= 90 ? 'test band' : bandId > 0 ? 'hardware band' : 'no band';
}

/** Everyone: the attendees who tapped a band, then the staff, then the crowd, by name. For the owner each
 *  attendee also carries their row of `view_as_people`, which opens their pages. */
function everyone(): Person[] {
  const out: Person[] = [...conn.db.boardAttendees.iter()].map(a =>
    ({ key: `a${a.nodeId}`, name: a.displayName, role: roleWords(a.role), kind: kindOf(a.bandId, a.crowd), crowd: a.crowd, bandId: a.bandId, att: a }));
  const byBand = new Map(out.filter(p => p.bandId).map(p => [p.bandId, p]));
  const byName = new Map(out.filter(p => !p.bandId).map(p => [p.name, p]));
  for (const v of conn.db.viewAsPeople.iter()) {
    if (v.role !== 'attendee') {
      out.push({ key: keyOf(v), name: v.name, role: roleName(v.role).toLowerCase(), kind: kindOf(v.bandId, false), crowd: false, bandId: v.bandId, view: v });
      continue;
    }
    const p = v.bandId ? byBand.get(v.bandId) : byName.get(v.name);
    if (p) p.view = v;
  }
  const rank = (p: Person) => (p.crowd ? 2 : p.att ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || (a.name || '~').localeCompare(b.name || '~'));
}

/** Every word of the search appears in the person's name, role, kind of band, band code, company or handles. */
function found(p: Person, words: string[]): boolean {
  return matches([p.name, p.role, p.kind, p.bandId ? code(p.bandId) : '', p.att?.organization ?? '', ...(p.att?.handles.map(x => x.handle) ?? [])]
    .join(' '), words);
}

/** What each person search bar holds, by the bar's name. */
const searches = new Map<string, string>();
/** How many matches a search bar lists under it. */
const SEARCH_ROWS = 12;

/** A search bar over people: each word typed must appear in the person's name, role, band, company or
 *  handles. Its first matches list under it; a click, or Enter for the first one, picks a person. */
function personSearch(name: string, people: Person[], chosen: (p: Person) => boolean, pick: (p: Person) => void, more: (p: Person) => string = () => '') {
  const words = (searches.get(name) ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = people.filter(p => found(p, words));
  const choose = (p: Person) => { pick(p); render(); };
  return h('div', {},
    h('input', { name, type: 'search', class: 'search', placeholder: 'Search by name, role, band, company or handle', value: searches.get(name) ?? '',
      oninput: (e: Event) => { searches.set(name, (e.target as HTMLInputElement).value); render(); },
      onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' && matches[0]) { e.preventDefault(); choose(matches[0]); } } }),
    h('ul', { class: 'results' }, matches.slice(0, SEARCH_ROWS).map(p => h('li', {},
      h('button', { type: 'button', class: chosen(p) ? 'on' : '', onclick: () => choose(p) },
        p.name || '(no name yet)', h('span', { class: 'muted' }, ` ${p.role || p.kind}${p.bandId ? `, band ${code(p.bandId)}` : ''}${more(p)}`))))),
    matches.length > SEARCH_ROWS && h('p', { class: 'muted' }, `${matches.length - SEARCH_ROWS} more found: keep typing to narrow it down.`),
    !matches.length && h('p', { class: 'muted' }, 'Nobody found.'));
}

/** The injury claims a person filed, or staff filed as them. */
function claimsOf(p: Person): Claim[] {
  if (!p.att) return [];
  return [...conn.db.claimsBoard.iter()]
    .filter(c => c.claimant && (p.view ? c.claimant.isEqual(p.view.identity) : c.bandId === p.bandId && c.claimantName === p.name))
    .sort((a, b) => Number(b.id - a.id));
}

/** The zone a band is in now, else the first zone with a station marker. */
function zoneOf(bandId: number) {
  const station = bandById(conn, bandId)?.zone ?? 0;
  const zones = [...conn.db.zone.iter()].filter(z => z.stationId !== 0).sort((a, b) => a.stationId - b.stationId);
  return zones.find(z => z.stationId === station) ?? zones[0];
}

function openPerson(p: Person) {
  opened = p.key;
  scrollToPerson = 'top';
  render();
}

/** A person clicked in the 3D venue: their row of the list, else their band alone. */
function openBand(bandId: number) {
  opened = everyone().find(p => p.bandId === bandId)?.key ?? `b${bandId}`;
  scrollToPerson = 'view';
  render();
}

/** A band nobody on the list wears, opened from the 3D venue. */
function bandOnly(key: string): Person | undefined {
  const id = Number(/^b(\d+)$/.exec(key)?.[1] ?? 0);
  return id ? { key, name: '', role: '', kind: kindOf(id, false), crowd: id >= 100, bandId: id } : undefined;
}

/** The list's rows by person, kept with what they show: a crowd of a thousand would otherwise rebuild every redraw. */
const personRows = new Map<string, { shows: string; row: HTMLElement }>();
/** What the list shows now; the list is drawn again only when it changes. */
let listShows = '';
/** The list's count and search as drawn, and its table: when only some rows change, only those rows are swapped,
 *  so the browser lays out a few rows instead of the whole list of a thousand. */
let listTop = '';
let listTable: HTMLElement | undefined;

/** The search and the list of everyone, or null when nothing in it changed; opening a person shows them above,
 *  with what staff can do as them. */
function peopleList(all: Person[]) {
  const words = peopleSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = all.filter(p => found(p, words));
  const stations = new Map([...conn.db.zone.iter()].map(z => [z.stationId, z.name]));
  const claims = new Map<string, number>();
  for (const c of conn.db.claimsBoard.iter()) {
    if (c.claimant) claims.set(`${c.bandId} ${c.claimantName}`, (claims.get(`${c.bandId} ${c.claimantName}`) ?? 0) + 1);
  }
  const filed = (p: Person) => p.att ? claims.get(`${p.bandId} ${p.name}`) ?? 0 : 0;
  const left = new Map([...conn.db.departure.iter()].map(d => [d.nodeId, d]));
  const rows = shown.map(p => {
    const b = p.bandId ? bandById(conn, p.bandId) : undefined;
    const gone = left.get(p.att?.nodeId ?? -1n);
    const cells = [p.name || '(no name yet)', p.role, p.kind, p.bandId ? code(p.bandId) : '', b && present(b) ? stations.get(b.zone) ?? 'no zone' : '',
      gone ? (gone.leftAt ? 'left' : 'walking out') : bandStatus(p.bandId), p.att?.organization ?? '', String(filed(p) || '')];
    const shows = [...cells, p.key === opened].join('|');
    let kept = personRows.get(p.key);
    if (kept?.shows !== shows) {
      const [name, role, kind, band, zone, status, company, count] = cells;
      kept = { shows, row: h('tr', {},
        h('td', {}, h('button', { class: 'link', onclick: () => openPerson(p) }, name)),
        h('td', {}, role),
        h('td', {}, band, band && h('span', { class: 'muted' }, ` ${kind}`)), h('td', {}, zone),
        h('td', { class: status === 'online' ? 'pass' : 'muted' }, status),
        h('td', {}, company), h('td', {}, count),
        h('td', {}, h('button', { class: p.key === opened ? 'on' : '', onclick: () => openPerson(p) }, 'Open'))) };
      personRows.set(p.key, kept);
    }
    return kept;
  });
  const shows = [all.length, peopleSearch, ...rows.map(r => r.shows)].join('\n');
  if (shows === listShows) return null;
  listShows = shows;
  const top = `${all.length}|${peopleSearch}|${shown.length}`;
  const old = listTable?.isConnected && top === listTop ? listTable.children : undefined;
  if (old && old.length === rows.length + 1 && rows.every((r, i) => old[i + 1] === r.row || !r.row.isConnected)) {
    rows.forEach((r, i) => { if (old[i + 1] !== r.row) old[i + 1].replaceWith(r.row); });
    return null;
  }
  listTop = top;
  listTable = h('table', {},
    h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Role'), h('th', {}, 'Band'), h('th', {}, 'Zone now'), h('th', {}, 'Band status'), h('th', {}, 'Company'), h('th', {}, 'Claims'), h('th', {})),
    rows.map(r => r.row));
  return h('section', {},
    h('h3', {}, `People (${all.length})`),
    h('input', { name: 'people-search', type: 'search', placeholder: 'Search by name, role, band, company or handle', value: peopleSearch,
      oninput: (e: Event) => { peopleSearch = (e.target as HTMLInputElement).value; render(); } }),
    words.length > 0 && h('p', { class: 'muted' }, `${shown.length} found`),
    listTable);
}

/** The opened person: who they are, their pages, and what staff do as them. */
function personPanel(all: Person[]) {
  const p = all.find(x => x.key === opened) ?? bandOnly(opened);
  if (!p) return null;
  const a = p.att;
  const b = p.bandId ? bandById(conn, p.bandId) : undefined;
  const ended = conn.db.eventState.id.find(0)?.ended ?? false;
  const gone = departureOf(a?.nodeId);
  const name = p.name || 'them';
  const facts = [
    p.role,
    p.kind,
    gone && leftWords(gone),
    b && present(b) ? `${bandStatus(p.bandId)} in ${[...conn.db.zone.iter()].find(z => z.stationId === b.zone)?.name ?? 'no zone'}` : p.bandId ? bandStatus(p.bandId) : '',
    a?.organization,
    a?.handles.map(x => `${x.platform} ${x.handle}`).join(', '),
    a && (a.findable ? 'findable' : 'not findable'),
    a && `joined ${time(a.createdAt)}`,
  ].filter(Boolean);
  const pages = p.view && (p.view.role !== 'attendee' || p.bandId) ? screens(p.view) : [];
  const showing = !!p.view && keyOf(p.view) === viewKey && !!viewScreen;
  const card = [...conn.db.medicMedicalCards.iter()].find(m => m.bandId === p.bandId);
  return h('section', { id: 'person' },
    h('h3', {}, p.name || (a || p.view ? '(no name yet)' : 'Nobody wears this band'), ' ', h('button', { class: 'link', onclick: () => { opened = ''; viewScreen = ''; render(); } }, 'close')),
    h('p', {}, p.bandId > 0 && [h('a', { href: `/t/${bandCode(p.bandId)}` }, `Band ${bandCode(p.bandId)}`), ' · '], facts.join(' · ')),
    pages.length > 0 && h('p', {}, 'Their pages: ',
      pages.map(([screen, label]) => h('button', { class: showing && viewScreen === screen ? 'on' : '',
        onclick: () => { viewKey = keyOf(p.view!); viewScreen = screen; render(); } }, label)),
      showing && h('button', { class: 'link', onclick: () => { viewScreen = ''; render(); } }, 'Hide their page')),
    a && claimAs(p),
    a && theirClaims(p),
    a && can('ops') && !ended && !gone && h('p', {},
      h('button', { onclick: () => confirm(`${name} leaves the event now? Their recap opens once they are out.`) && act(() => conn.reducers.leaveEarly({ nodeId: a.nodeId })) }, 'Leave early')),
    a && can('ops') && theirShop(a),
    p.bandId > 0 && p.bandId < 100 && h('p', {},
      !ended && a && h('button', { onclick: () => takeBack(p.bandId, p.name) }, `Take band ${bandCode(p.bandId)} back`),
      can('medic') && h('button', { onclick: () => act(() => conn.reducers.requestMedicalCard({ bandId: p.bandId })) }, `Tap band ${bandCode(p.bandId)} for ${name}'s medical card`)),
    card && can('medic') && medicalCard(card),
    cfg.test_mode && TEST_BANDS.includes(p.bandId) && [h('p', {}, 'Walk to: ', walkButtons(p.bandId)), h('p', {}, testBandButtons(p.bandId, !!a))]);
}

/** Staff file an injury claim as the attendee: for their injury nobody filed a claim for yet, else for a fall
 *  or SOS opened on their band where they stand now. The hospital report matches, doesn't match, or is random. */
function claimAs(p: Person) {
  if (!p.bandId || !can('ops', 'medic')) return null;
  const injury = [...conn.db.unclaimedInjuries.iter()].filter(r => r.bandId === p.bandId).sort((x, y) => Number(y.incidentId - x.incidentId))[0];
  const zone = zoneOf(p.bandId);
  if (!injury && !zone) return null;
  const options: [string, string, string][] = injury
    ? stories(injury.kind, injury.zoneName || 'stage').map(([label, text]) => [injury.kind, label, text])
    : (['fall', 'sos'] as const).flatMap(kind => stories(kind, zone!.name).map(([label, text]): [string, string, string] => [kind, label, text]));
  const name = p.name || 'the attendee';
  const file = async (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const [kind, , statement] = options[Number(field(f, 'claim-story'))] ?? options[0];
    await act(async () => {
      const incidentId = injury?.incidentId ?? await injure(p.bandId, kind, zone!.id);
      await conn.reducers.fileClaimForWearer({ incidentId, statement, report: field(f, 'claim-report') });
    });
  };
  return h('form', { onsubmit: file },
    h('h4', {}, `File a claim as ${name}`),
    injury && h('p', {}, `For their ${injury.kind === 'sos' ? 'SOS' : 'fall'} in ${injury.zoneName} at ${time(injury.openedAt)}.`),
    h('label', {}, 'What happened',
      h('select', { name: 'claim-story' }, options.map(([kind, label], i) => h('option', { value: i }, injury ? label : `${kind === 'sos' ? 'SOS' : 'Fall'}: ${label}`)))),
    h('label', {}, 'Hospital report',
      h('select', { name: 'claim-report' }, REPORTS.map(([value, label]) => h('option', { value, selected: value === 'random' || undefined }, label)))),
    h('button', {}, `File the claim as ${name}`));
}

/** Opens a fall or SOS on the band where it is now, as its alert would, and resolves it as treated on site. */
async function injure(bandId: number, kind: string, zoneId: bigint): Promise<bigint> {
  const before = new Set([...conn.db.openIncidents.iter()].map(i => i.id));
  await conn.reducers.openIncident({ kind, zoneId, bandId, note: '' });
  const fresh = () => [...conn.db.openIncidents.iter()].find(i => i.subjectBand === bandId && !before.has(i.id));
  for (let n = 0; n < 50 && !fresh(); n++) await new Promise(r => setTimeout(r, 100));
  const incident = fresh();
  if (!incident) throw new Error('The incident did not open.');
  await conn.reducers.resolveIncident({ incidentId: incident.id, resolution: 'treated on site' });
  return incident.id;
}

function theirClaims(p: Person) {
  const mine = claimsOf(p);
  return mine.length > 0 && [h('h4', {}, 'Their claims'), h('ul', {}, mine.map(c => h('li', {},
    h('button', { class: 'link', onclick: () => toClaim(c.id) }, `#${c.id}`),
    ` ${kindWords(c.incidentKind)} in ${c.zoneName}: ${statusOf(c)}${c.payoutCents ? `, ${money(c.payoutCents)} to ${payee(c)}` : ''}`)))];
}

/** Their shop, as the Merch tab's "Buy as an attendee" shows it. */
function theirShop(a: AttendeeOut) {
  const w = [...conn.db.boardWallets.iter()].find(x => x.nodeId === a.nodeId);
  if (!w) return h('p', { class: 'muted' }, 'No wallet, so no merch.');
  const people = new Map([...conn.db.boardAttendees.iter()].map(x => [x.nodeId, x.displayName || 'no name yet']));
  return [h('h4', {}, `Buy merch as ${a.displayName || 'them'}`), shopFor(w, people)];
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

// --- View as --------------------------------------------------------------------------------

/** The person the owner views as, by `<role> <identity>`, and which of their screens. */
let viewKey = '';
let viewScreen = '';

function keyOf(p: ViewablePerson) {
  return `${p.role} ${p.identity.toHexString()}`;
}

function viewed(): ViewablePerson | undefined {
  return [...conn.db.viewAsPeople.iter()].find(p => keyOf(p) === viewKey);
}

/** Opens /organizer#viewas/<identity hex> on that person, as an attendee when they are one. */
function openFromHash() {
  const hex = location.hash.match(/^#viewas\/([0-9a-f]+)/i)?.[1]?.toLowerCase();
  if (!hex) return;
  tab = 'viewas';
  const matches = [...conn.db.viewAsPeople.iter()].filter(p => p.identity.toHexString() === hex);
  const p = matches.find(x => x.role === 'attendee') ?? matches[0];
  if (!p) return;
  viewKey = keyOf(p);
  viewScreen = screens(p)[0][0];
}

/** The owner picks a person; their page shows below, live with their data. Nothing on it can be pressed. */
function viewAsTab() {
  const p = viewed();
  return h('section', {},
    h('h3', {}, 'View as'),
    h('p', { class: 'muted' }, 'See the pages a person sees, live with their data. It is read-only: nothing on their page can be pressed or changed.'),
    personSearch('viewas-search', everyone().filter(x => x.view), x => keyOf(x.view!) === viewKey,
      x => { viewKey = keyOf(x.view!); viewScreen = screens(x.view!)[0][0]; }),
    p && h('p', {}, h('b', {}, `${p.name || '(no name yet)'}: `), screens(p).map(([screen, label]) =>
      h('button', { class: screen === viewScreen ? 'on' : '', onclick: () => { viewScreen = screen; render(); } }, label))),
    p && p.role === 'attendee' && !p.bandId && h('p', {}, `${p.name || 'They'} wear no band right now, so there is no band page to show.`));
}

/** The View as frame sits outside the redrawn parts, so the person's page never reloads on a redraw. */
function showViewAs(on: boolean) {
  const box = document.getElementById('viewas')!;
  const p = on ? viewed() : undefined;
  box.hidden = !p || (p.role === 'attendee' && !p.bandId);
  const frame = box.querySelector('iframe')!;
  const want = p ? viewUrl(p, viewScreen) : '';
  if (want && frame.getAttribute('src') !== want) frame.setAttribute('src', want);
}

// --- Claims ---------------------------------------------------------------------------------

/** Open incidents: the medic takes one, opens the medical card, notes the cost and resolves it. For the venue's
 *  equipment broken or something stolen from the venue, staff note what it is and its value, and name who did it
 *  by their band. */
function incidentDesk() {
  const incidents = [...conn.db.openIncidents.iter()].sort((a, b) => Number(a.id - b.id));
  const notes = [...conn.db.boardNotes.iter()];
  const charges = new Map([...conn.db.boardCharges.iter()].map(c => [c.incidentId, c]));
  const names = wearers();
  const medic = can('medic');
  return h('section', {},
    h('h3', {}, 'Open incidents'),
    !incidents.length && h('p', { class: 'muted' }, 'None. A fall or SOS on a band opens one here, and so does a report below of the venue\'s equipment broken or something stolen from the venue.'),
    incidents.map(i => {
      const kind = i.kind.tag.toLowerCase();
      const loss = isLoss(kind);
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
      const band = i.subjectBand ? `band ${bandCode(i.subjectBand)}${names.has(i.subjectBand) ? ` (${names.get(i.subjectBand) || 'no name yet'})` : ''}` : 'no band';
      return h('div', { class: 'incident' },
        h('p', {}, h('b', {}, `Incident ${i.id}: ${capital(kindWords(kind))}`), ` in ${zoneName(i.zoneId)}, ${band}, ${i.status.tag}, opened ${time(i.openedAt)} by ${i.openedBy}`),
        h('ul', {}, mine.map(n => h('li', {}, `${time(n.createdAt)} ${n.authorRole}: ${n.text}${n.costCents !== undefined ? ` (${money(n.costCents)})` : ''}`))),
        medic && i.status.tag === 'Open' && h('button', { onclick: () => act(() => conn.reducers.assignMedic({ incidentId: i.id })) }, 'Take it'),
        medic && !loss && i.subjectBand !== 0 && h('button', { onclick: () => act(() => conn.reducers.requestMedicalCard({ bandId: i.subjectBand })) }, `Tap band ${bandCode(i.subjectBand)} for the medical card`),
        medicCard(i.id),
        h('form', { onsubmit: note },
          h('input', { name: `text-${i.id}`, placeholder: loss ? 'Note: what it is, what you saw' : 'Treatment note', required: true }),
          h('input', { name: `cost-${i.id}`, placeholder: loss ? 'Value or repair cost in dollars' : 'Cost in dollars (optional)', inputmode: 'decimal' }),
          h('button', {}, 'Add note')),
        loss && can('ops', 'medic') && nameWhoDidIt(i.id, charges.get(i.id)),
        can('ops', 'medic') && h('button', { onclick: () => act(() => conn.reducers.resolveIncident({ incidentId: i.id, resolution: loss ? 'reported by staff' : 'treated on site' })) }, 'Resolve'));
    }),
    can('ops', 'medic') && reportLoss());
}

/** Staff name the attendee who broke or took it, by their band code; the module checks the band against the
 *  zone, the bands at the spot and the cameras, and proposes a charge for the organizer. */
function nameWhoDidIt(incidentId: bigint, charge: Charge | undefined) {
  const name = async (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const code = field(f, `culprit-${incidentId}`);
    const bandId = bandFromCode(code);
    const ok = await act(async () => {
      if (!bandId) throw new Error(`${code} is not a band code. A band code looks like ${bandCode(94)}.`);
      await conn.reducers.nameResponsibleBand({ incidentId, bandId, note: field(f, `culprit-note-${incidentId}`) });
    });
    if (ok) f.reset();
  };
  return [
    charge && h('p', {}, `Named ${charge.attendeeName}, band ${bandCode(charge.bandId)}, by ${charge.namedByName}: the charge is ${charge.status}.`),
    (!charge || charge.status === 'proposed') && h('form', { onsubmit: name },
      h('input', { name: `culprit-${incidentId}`, placeholder: `Band code of who did it, e.g. ${bandCode(94)}`, required: true }),
      h('input', { name: `culprit-note-${incidentId}`, placeholder: 'What you saw' }),
      h('button', {}, charge ? 'Name someone else' : 'Name who did it')),
  ];
}

/** What staff can report by hand: the venue's losses. */
const LOSS_KINDS: [string, string][] = [
  ['property', 'Venue equipment broken'],
  ['theft', "Stolen from the venue: its equipment, merch or a sponsor's gear at its booth"],
];

/** Staff report the venue's equipment broken or something stolen from the venue: the kind, the zone and a note. */
function reportLoss() {
  const zones = [...conn.db.zone.iter()].sort((a, b) => a.stationId - b.stationId);
  const report = async (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const ok = await act(() => conn.reducers.openIncident({
      kind: field(f, 'report-kind'), zoneId: BigInt(field(f, 'report-zone')), bandId: 0, note: field(f, 'report-note'),
    }));
    if (ok) f.reset();
  };
  return h('form', { onsubmit: report },
    h('h4', {}, 'Report something broken or stolen'),
    h('label', {}, 'What happened', h('select', { name: 'report-kind' }, LOSS_KINDS.map(([value, label]) => h('option', { value }, label)))),
    h('label', {}, 'Where', h('select', { name: 'report-zone' }, zones.map(z => h('option', { value: String(z.id) }, z.name)))),
    h('label', {}, 'Note', h('input', { name: 'report-note', placeholder: 'What it is and what it is worth, e.g. a sponsor\'s laptop, $1,299' })),
    h('button', {}, 'Report it'));
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

/** A test band's buttons to walk it to each zone. */
function walkButtons(id: number) {
  const at = bandById(conn, id)?.zone;
  return [...conn.db.zone.iter()].sort((a, b) => a.stationId - b.stationId).map(z => h('button', { class: 'test', disabled: z.stationId === at || undefined,
    onclick: () => act(() => post(`/api/dev/move/${id}/${z.stationId}`)) }, z.name));
}

/** A test band's press, and its fall once someone wears it. */
function testBandButtons(id: number, claimed: boolean) {
  return [
    id >= 94 && h('button', { class: 'test', onclick: () => act(() => post(`/api/dev/press/${id}`)) }, 'Press'),
    claimed && h('button', { class: 'test', onclick: () => act(() => post(`/api/dev/fall/${id}`)).then(toClaims) }, 'Fall here'),
  ];
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
        const b = bandById(conn, id);
        const claimed = owners.has(id);
        return h('tr', {},
          h('td', {}, h('b', {}, bandCode(id)), h('div', { class: alive(id) ? 'pass' : 'muted' }, alive(id) ? 'online' : 'offline')),
          h('td', {}, claimed ? owners.get(id) || '(no name yet)' : h('span', { class: 'muted' }, 'not claimed')),
          h('td', {}, zones.find(z => z.stationId === b?.zone)?.name ?? 'no zone'),
          h('td', {}, walkButtons(id)),
          h('td', {}, testBandButtons(id, claimed)));
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

/** Opens a claim's detail on the Settlements tab. */
function toClaim(id: bigint) {
  tab = 'claims';
  location.hash = 'claims';
  showClaim(id);
}

function statusOf(c: Claim) {
  return c.status.tag.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/** The approver's queue: the claims routed to the caller, oldest first. */
/** Can the caller approve or refuse this claim: the person it waits for, or anyone holding its role. */
function decides(c: Claim): boolean {
  return c.routedTo.isEqual(conn.identity!) || can(c.routedToRole);
}

/** Where a claim's payout goes: the attendee's wallet, the repair vendor for the venue's broken equipment, or the
 *  venue, to replace what was stolen from it. */
function payee(c: Claim): string {
  if (c.coverKind !== 'property') return `${c.claimantName || 'the claimant'}'s wallet`;
  return c.incidentKind === 'theft' ? 'the venue, to replace what was stolen' : 'the repair vendor';
}

const COVER_WORDS: Record<string, string> = { medical_payments: 'medical payments', property: 'property' };

const INJURIES = ['sos', 'fall'];

/** Who pays what on a claim: the payout, what the insurer pays back under which policy, the venue's share and what is not covered.
 *  An injury is paid from the venue's medical payments cover; the venue's equipment broken or stolen from its property policy. */
function whoPays(c: Claim) {
  if (!c.costCents && !c.payoutCents) return null;
  const policy = [...conn.db.boardPolicies.iter()].find(p => p.id === c.policyId);
  const cover = `${COVER_WORDS[c.coverKind] ?? c.coverKind} cover${c.incidentKind === 'theft' ? ', theft as a cause of loss' : ''}`;
  const insurer = policy ? `${policy.insurerName} pays back, policy ${policy.policyNumber}, ${cover}` : 'The insurer pays back';
  const rows: [string, bigint][] = [
    ['Cost', c.costCents],
    [`Paid to ${payee(c)}`, c.payoutCents],
    [insurer, c.recoverableCents],
    ['The venue carries (deductible)', c.venueCostCents],
  ];
  if (c.costCents > c.payoutCents) rows.push(['Not covered', c.costCents - c.payoutCents]);
  return [h('h4', {}, 'Who pays what'), h('table', {}, rows.map(([label, cents]) => h('tr', {}, h('td', {}, label), h('td', {}, money(cents)))))];
}

/** The organizer's queue: claims no approved rule settled, oldest first. */
function myQueue() {
  const mine = [...conn.db.claimsBoard.iter()].filter(c => c.status.tag === 'Routed' && decides(c)).sort((a, b) => Number(a.id - b.id));
  if (!can('ops')) return null;
  return h('section', { class: mine.length ? 'alert' : '' },
    h('h3', {}, `Payments waiting for your sign-off (${mine.length})`),
    !mine.length && h('p', { class: 'muted' }, 'Nothing right now.'),
    h('ul', {}, mine.map(c => h('li', {},
      h('button', { class: 'link', onclick: () => showClaim(c.id) }, `#${c.id}`),
      ` ${money(c.payoutCents)} to ${payee(c)}, ${kindWords(c.incidentKind)} in ${c.zoneName}: ${c.statusNote}`))));
}

function claimList() {
  const claims = [...conn.db.claimsBoard.iter()].sort((a, b) => Number(b.id - a.id));
  return h('section', {},
    h('h3', {}, 'All claims and who pays them'),
    !claims.length && h('p', { class: 'muted' }, 'No claims yet. An attendee files one from their band page after an injury, or staff file it for them above.'),
    claims.length > 0 && searchable('claims', h('table', {},
      h('tr', {}, h('th', {}, 'Claim'), h('th', {}, 'Claimant'), h('th', {}, 'What'), h('th', {}, 'Cost'), h('th', {}, 'Paid out'), h('th', {}, 'Insurer pays back'), h('th', {}, 'Venue carries'), h('th', {}, 'Status'), h('th', {}, 'Waiting for')),
      claims.map(c => h('tr', { class: c.status.tag === 'Routed' && decides(c) ? 'alert' : '' },
        h('td', {}, h('button', { class: 'link', onclick: () => showClaim(c.id) }, `#${c.id}`)),
        h('td', {}, c.claimantName || (c.coverKind === 'property' ? 'the venue' : '(none)')), h('td', {}, `${kindWords(c.incidentKind)} in ${c.zoneName}`),
        h('td', {}, money(c.costCents)), h('td', {}, money(c.payoutCents)), h('td', {}, money(c.recoverableCents)), h('td', {}, money(c.venueCostCents)),
        h('td', {}, statusOf(c), h('div', { class: 'muted' }, c.statusNote)),
        h('td', {}, c.status.tag === 'Routed' ? `${c.routedToName}${decides(c) ? ', you' : ''}` : ''))))));
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

function decide(c: Claim) {
  const gap = complicated(c);
  const approve = async (e: Event) => {
    e.preventDefault();
    await act(() => conn.reducers.approveClaim({ claimId: c.id, amountSeenCents: c.payoutCents, packHashSeen: c.packHash }));
  };
  const refuse = async (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    await act(() => conn.reducers.refuseClaim({ claimId: c.id, packHashSeen: c.packHash, reason: field(f, 'reason') }));
  };
  return h('div', {},
    h('form', { onsubmit: approve },
      gap && h('p', { class: 'muted' }, 'Decided one by one: a gap in the policy makes no rule.'),
      h('button', {}, `Approve paying ${money(c.payoutCents)} to ${payee(c)}`)),
    h('form', { onsubmit: refuse },
      h('input', { name: 'reason', placeholder: 'Reason for refusing', required: true }),
      h('button', {}, 'Refuse to pay')));
}

/** A Nessie deposit that failed leaves the claim in Paying with this in its note. */
function payoutFailed(c: Claim): boolean {
  return c.status.tag === 'Paying' && /payout failed/i.test(c.statusNote);
}

/** What the claim is waiting for, and for whom. */
function waiting(c: Claim, hospital: boolean): string {
  const name = c.claimantName || 'the claimant';
  switch (c.status.tag) {
    case 'AwaitingRecord':
      if (!INJURIES.includes(c.incidentKind)) return 'Waiting for the evidence to be gathered.';
      return hospital ? 'Waiting for the hospital report.' : 'Waiting for the medical record: upload the clinic\'s report below.';
    case 'ReadingRecord': return 'Waiting for the Evidence Engine to read the hospital report.';
    case 'Verifying': return 'Waiting for the Elastic checks.';
    case 'Reviewing': return 'Waiting for the claims agent\'s review.';
    case 'Routed': return decides(c) ? `Waiting for your sign-off to pay ${money(c.payoutCents)} to ${payee(c)}.` : `Waiting for the ${c.routedToName.toLowerCase()} to sign off the payment.`;
    case 'Paying': return payoutFailed(c) ? `Approved. The payout to ${name}'s wallet failed and waits for a retry.` : `Approved. Paying ${money(c.payoutCents)} into ${name}'s wallet.`;
    case 'Settled': return `Paid out. Waiting for the insurer to pay ${money(c.recoverableCents)} back.`;
    case 'Refused': return 'Refused: nothing is paid. Nothing is waiting.';
    case 'Reconciled': return `Closed: the insurer paid ${money(c.recoverableCents)} back. Nothing is waiting.`;
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
  const approvals = [...conn.db.boardApprovals.iter()].filter(a => a.claimId === id);
  const ledger = [...conn.db.boardLedger.iter()].filter(l => l.claimId === id);
  const rule = c.settlementRuleId ? [...conn.db.boardRules.iter()].find(r => r.id === c.settlementRuleId) : undefined;
  const open = hospital ? 'Open the report' : 'Open the PDF';
  const verdict = (x: string) => x.replace('_', ' ');
  return h('section', { id: 'claim-detail' },
    h('h3', {}, `Claim #${c.id}: ${c.claimantName || (c.coverKind === 'property' ? 'the venue' : 'no claimant')}, ${kindWords(c.incidentKind)} in ${c.zoneName}`, ' ', h('button', { class: 'link', onclick: () => { openClaim = undefined; render(); } }, 'close')),
    h('p', { class: 'big' }, h('b', {}, statusOf(c)), c.statusNote && `: ${c.statusNote}`),
    h('p', {}, h('b', {}, waiting(c, !!hospital)), review && ` Decision Engine recommendation: ${verdict(review.verdict)}.`),
    whoPays(c),
    c.statement && h('p', {}, h('b', {}, 'In their words: '), `"${c.statement}"`),
    evidenceTrail(conn, c),
    hospital && [h('h4', {}, 'Hospital report'),
      hospital.status === 'requested' && h('p', {}, 'Hospital report requested', h('span', { class: 'muted' }, ` at ${time(hospital.requestedAt)}`)),
      hospital.status === 'received' && h('p', {}, `Hospital report from ${hospital.providerName}, visit ${hospital.visitDate}. `, h('a', { href: `/blobs/${hospital.fileHash}`, target: '_blank' }, 'Open the report')),
      hospital.status === 'failed' && h('p', { class: 'fail' }, `The hospital report failed: ${hospital.problems.join('; ')}`)],
    // Claims the scripted claims run files have no hospital report: staff upload the clinic's PDF.
    !hospital && c.status.tag === 'AwaitingRecord' && INJURIES.includes(c.incidentKind) && can('medic', 'ops') && h('form', { onsubmit: (e: Event) => { e.preventDefault(); act(() => fileRecord(c.id, e.target as HTMLFormElement)); } },
      h('h4', {}, 'Upload the clinic\'s report'),
      h('label', {}, 'Clinic report PDF', h('input', { type: 'file', name: `record-${c.id}`, accept: 'application/pdf' })),
      cfg.test_mode && h('label', {}, 'or a test report, dated for this incident', h('select', { name: 'test-record' }, h('option', { value: '' }, '—'), TEST_RECORDS.map(([f, label]) => h('option', { value: f }, label)))),
      h('button', {}, 'Upload it, the Evidence Engine reads it')),
    review && [h('h4', {}, `Decision Engine recommendation: ${verdict(review.verdict)}`),
      h('p', {}, review.summary), review.causation && h('p', {}, `Causation: ${review.causation}`),
      review.concerns.length > 0 && h('ul', {}, review.concerns.map(x => h('li', {}, x))),
      review.innocentExplanations.length > 0 && h('p', {}, `Innocent readings: ${review.innocentExplanations.join('; ')}`),
      review.missingEvidence.length > 0 && h('p', {}, `Missing: ${review.missingEvidence.join('; ')}`),
      review.citedFactIds.length > 0 && h('p', { class: 'muted' }, `Rests on facts ${review.citedFactIds.map(n => `[${n}]`).join(' ')}`),
      review.rejected.length > 0 && h('p', { class: 'fail' }, `Code set the recommendation aside: ${review.rejected.join('; ')}`)],
    c.status.tag === 'Routed' && decides(c) && h('div', {}, h('h4', {}, 'Your sign-off'), decide(c)),
    afterDecision(c),
    h('p', { class: 'muted' }, `Evidence pack v${v}, sha ${c.packHash.slice(0, 12)} · corroboration ${c.corroboration || 'n/a'} · decided by ${c.decidedBy || 'nobody yet'}${rule ? ` under rule v${rule.version} from ${rule.approverName}` : ''}${c.payoutReference ? ` · ${c.payoutReference}` : ''}`),
    h('h4', {}, 'Checks'),
    h('table', {}, checks.map(x => h('tr', {}, h('td', { class: x.result }, x.result), h('td', {}, x.name), h('td', {}, x.detail), h('td', { class: 'muted' }, x.reader)))),
    record && record.status !== 'extracted' && [h('h4', {}, 'Hospital report'),
      h('p', {}, record.status === 'reading' ? 'The Evidence Engine is reading the report.' : `The report could not be read: ${record.dropped.join('; ')}`, ' ',
        h('a', { href: `/blobs/${record.fileHash}`, target: '_blank' }, open))],
    record && record.status === 'extracted' && [h('h4', {}, 'Hospital report, read by the Evidence Engine'),
      h('p', {}, `${record.documentKind} for ${record.patientName} from ${record.providerName} on ${record.dateOfService}, invoice ${record.invoiceNumber}. Billed ${money(record.billedCents)}, covered ${money(record.coveredCents)}.`),
      record.reasonForVisit && h('p', {}, `Reason: ${record.reasonForVisit}. ${record.history}`),
      h('p', {}, `Diagnoses: ${record.diagnoses.join('; ')}`),
      record.dropped.length > 0 && h('p', {}, `Dropped: ${record.dropped.join('; ')}`),
      h('a', { href: `/blobs/${record.fileHash}`, target: '_blank' }, open)],
    lines.length > 0 && [h('h4', {}, 'Billed lines'), h('table', {},
      h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Service'), h('th', {}, 'Billed'), h('th', {}, 'Allowed'), h('th', {}, 'Covered'), h('th', {}, 'Outcome')),
      lines.map(l => h('tr', {}, h('td', {}, l.code), h('td', {}, l.description), h('td', {}, money(l.billedCents)), h('td', {}, money(l.allowedCents)),
        h('td', {}, money(l.coveredCents)), h('td', { class: l.outcome === 'excluded' ? 'fail' : '' }, `${l.outcome}${l.reason ? `: ${l.reason}` : ''}`))))],
    clauses(c),
    h('h4', {}, 'Evidence facts'),
    h('table', {}, facts.map(f => h('tr', {}, h('td', {}, `[${f.seq}]`), h('td', {}, f.key), h('td', {}, f.value), h('td', { class: 'muted' }, `${f.source}, ${f.reader}`)))),
    approvals.length > 0 && [h('h4', {}, 'Decisions'), h('ul', {}, approvals.map(a => h('li', {}, `${date(a.decidedAt)} ${a.approverName} (${a.approverRole}) ${a.decision} at ${money(a.amountSeenCents)}${a.reason ? `: ${a.reason}` : ''}`)))],
    ledger.length > 0 && [h('h4', {}, 'Ledger'), h('table', {}, ledger.map(l => h('tr', {}, h('td', {}, l.journal), h('td', {}, l.account),
      h('td', {}, l.debitCents ? `Dr ${money(l.debitCents)}` : ''), h('td', {}, l.creditCents ? `Cr ${money(l.creditCents)}` : ''), h('td', { class: 'muted' }, l.memo))))]);
}

/** The claims whose policy clauses this page subscribed to: `claim_clauses` takes the claim's id. */
const clauseClaims = new Set<bigint>();

/** The policy clauses the Evidence Engine found for the claim's latest evidence pack, best match first. */
function clauses(c: Claim) {
  if (!clauseClaims.has(c.id)) {
    clauseClaims.add(c.id);
    conn.subscriptionBuilder()
      .onApplied(() => render())
      .onError(ctx => console.warn(`claim ${c.id} clauses`, (ctx as any).event))
      .subscribe([`SELECT * FROM claim_clauses(${c.id})`]);
  }
  const all = [...conn.db.claimClauses.iter()].filter(k => k.claimId === c.id);
  const latest = Math.max(0, ...all.map(k => k.packVersion));
  const rows = all.filter(k => k.packVersion === latest).sort((a, b) => b.score - a.score);
  if (!rows.length) return null;
  return [h('h4', {}, 'Policy clauses that bear on it (Elastic)'), h('table', {},
    h('tr', {}, h('th', {}, 'Policy'), h('th', {}, 'Section'), h('th', {}, 'Page'), h('th', {}, 'Clause'), h('th', {}, 'Match')),
    rows.map(k => h('tr', {},
      h('td', {}, k.policy === 'attendee' ? "The attendee's own" : "The venue's"),
      h('td', {}, k.section.replace(/_/g, ' ')), h('td', {}, k.page),
      h('td', {}, `"${k.text}"`, h('div', { class: 'muted' }, k.clauseId)),
      h('td', { class: 'muted' }, k.score.toFixed(2)))))];
}

const CHARGE_STATUS: Record<string, string> = {
  proposed: 'proposed: waits for the organizer',
  approved: 'approved: on their tap page to pay or dispute',
  paying: 'paying from their wallet',
  paid: 'paid',
  disputed: 'disputed: waits for the organizer again',
  waived: 'waived',
};

/** The incident kind a charge is for, from its claim or its incident. */
function chargeKind(c: Charge): string {
  const claim = c.claimId ? [...conn.db.claimsBoard.iter()].find(x => x.id === c.claimId) : undefined;
  if (claim) return claim.incidentKind;
  const open = [...conn.db.openIncidents.iter()].find(i => i.id === c.incidentId);
  if (open) return open.kind.tag.toLowerCase();
  return [...conn.db.incidentMarker.iter()].find(m => m.incidentId === c.incidentId)?.kind ?? '';
}

/** Every charge to an attendee who broke or took something: who staff named, the band's checks, the
 *  recommendation, and the organizer's approve or waive. Nothing is taken until the attendee presses pay. */
function chargeList() {
  const rows = [...conn.db.boardCharges.iter()].sort((a, b) => Number(b.id - a.id));
  const ops = can('ops');
  const waive = (c: Charge) => {
    const reason = prompt(`Why waive the ${money(c.amountCents)} charge to ${c.attendeeName}?`)?.trim();
    if (reason) act(() => conn.reducers.waiveCharge({ chargeId: c.id, reason }));
  };
  const check = (line: string) => {
    const [name, result, ...detail] = line.split(': ');
    return h('div', { class: result }, `${result} ${name.replace(/_/g, ' ')}: ${detail.join(': ')}`);
  };
  return h('section', {},
    h('h3', {}, `Charges (${rows.length})`),
    !rows.length && h('p', { class: 'muted' }, 'None. Staff name who broke or took something on the open incident, and its charge shows here for the organizer.'),
    rows.length > 0 && h('table', {},
      h('tr', {}, h('th', {}, 'Charge'), h('th', {}, 'Attendee'), h('th', {}, 'Amount'), h('th', {}, 'What'), h('th', {}, 'Status'), h('th', {}, "The band's checks"), h('th', {}, 'Recommendation'), h('th', {})),
      rows.map(c => {
        const deciding = c.status === 'proposed' || c.status === 'disputed';
        return h('tr', { class: ops && deciding ? 'alert' : '' },
          h('td', {}, `#${c.id}`),
          h('td', {}, `${c.attendeeName}, band ${bandCode(c.bandId)}`,
            h('div', { class: 'muted' }, `named by ${c.namedByName} (${c.namedByRole})${c.note ? `: ${c.note}` : ''}`)),
          h('td', {}, c.amountCents ? money(c.amountCents) : h('span', { class: 'muted' }, "waits for the claim's cost")),
          h('td', {}, `${capital(kindWords(chargeKind(c)))}, incident ${c.incidentId}`,
            c.claimId !== 0n && h('div', {}, h('button', { class: 'link', onclick: () => showClaim(c.claimId) }, `claim #${c.claimId}`))),
          h('td', {}, CHARGE_STATUS[c.status] ?? c.status,
            c.approvedByName && h('div', { class: 'muted' }, `approved by ${c.approvedByName}`),
            c.disputeText && h('div', {}, `They said: "${c.disputeText}"`),
            c.waiveReason && h('div', { class: 'muted' }, `waived: ${c.waiveReason}`),
            c.paymentReference && h('div', { class: 'muted' }, c.paymentReference)),
          h('td', {}, c.checks.map(check), !c.checksPassed && h('div', { class: 'fail' }, 'A check failed: waive it or name the band again.')),
          h('td', {}, c.recommendation ? h('b', {}, c.recommendation === 'charge' ? 'Charge' : 'No charge') : h('span', { class: 'muted' }, 'not yet: comes with the claim\'s decision'),
            c.recommendationReason && h('div', {}, c.recommendationReason),
            c.clauseIds.length > 0 && h('div', { class: 'muted' }, `clauses ${c.clauseIds.join(', ')}`)),
          h('td', {},
            ops && deciding && c.amountCents > 0n && h('button', {
              onclick: () => act(() => conn.reducers.approveCharge({ chargeId: c.id, amountSeenCents: c.amountCents, packHashSeen: c.packHash })),
            }, `Approve charge of ${money(c.amountCents)}`),
            ops && (deciding || c.status === 'approved') && h('button', { onclick: () => waive(c) }, 'Waive')));
      })));
}

function claimsTab() {
  // A claim staff just filed opens as soon as the module creates it.
  const filed = openWhenFiled !== undefined && [...conn.db.claimsBoard.iter()].find(c => c.incidentId === openWhenFiled);
  if (filed) {
    openWhenFiled = undefined;
    openClaim = filed.id;
    scrollToClaim = true;
  }
  return [incidentDesk(), injuriesWithoutClaim(), fileAs(), myQueue(), openClaim !== undefined && claimDetail(openClaim), claimList(), chargeList()];
}

/** The attendee staff file a claim as from the Settlements tab, by key. */
let claimant = '';

/** Staff find anyone with a band and file a claim as them, as on the Live tab. */
function fileAs() {
  if (!can('ops', 'medic')) return null;
  const people = everyone().filter(p => p.att && p.bandId);
  const p = people.find(x => x.key === claimant);
  return h('section', {},
    h('h3', {}, 'File a claim as someone'),
    personSearch('claimant-search', people, x => x.key === claimant, x => { claimant = x.key; }),
    p && claimAs(p),
    p && theirClaims(p));
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
  const people = new Map([...conn.db.boardAttendees.iter()].map(a => [a.nodeId, a.displayName || 'no name yet']));
  const wallets = [...conn.db.boardWallets.iter()].filter(w => people.has(w.nodeId));
  const byNode = new Map(wallets.map(w => [w.nodeId, w]));
  const chosen = wallets.find(w => w.nodeId === shopper);
  return h('section', {},
    h('h3', {}, 'Buy as an attendee'),
    h('p', { class: 'muted' }, 'Pick an attendee to buy from their wallet, during or after the event.'),
    !wallets.length && h('p', { class: 'muted' }, 'Nobody has a wallet yet. Attendees connect one at band setup.'),
    wallets.length > 0 && personSearch('shopper-search', everyone().filter(p => p.att && byNode.has(p.att.nodeId)), p => p.att!.nodeId === shopper,
      p => { shopper = p.att!.nodeId; }, p => ` · ${money(byNode.get(p.att!.nodeId)!.balanceCents)}`),
    chosen && shopFor(chosen, people));
}

/** The pick as the recap draws it. The booth crawl ticks come from the attendee's own view, so none show here. */
function pickMockup(p: BoardMerchPick, t: MerchTemplate) {
  const key = `${p.nodeId} ${p.templateId} ${p.photoId}`;
  if (!pickMockups.has(key)) pickMockups.set(key, mockup({ ...t, rank: p.rank, templateId: t.id, photoId: p.photoId, photoUrl: p.photoUrl, line: p.line, reason: p.reason, friends: [], ticks: [] }));
  return pickMockups.get(key)!;
}

const pickMockups = new Map<string, HTMLCanvasElement>();

function shopFor(w: BoardWallet, people: Map<bigint, string>) {
  const who = people.get(w.nodeId)!;
  const picks = [...conn.db.boardMerchPicks.iter()].filter(p => p.nodeId === w.nodeId).sort((a, b) => a.rank - b.rank);
  const ownPhotos = [...conn.db.boardPhotos.iter()].filter(p => p.nodeIds.includes(w.nodeId)).sort((a, b) => Number(b.id - a.id));
  if (!picks.length && ownPhotos.length) {
    const photo = ownPhotos[0];
    for (const t of [...conn.db.merchTemplate.iter()].filter(t => !t.boothIds.length)) {
      picks.push({ id: t.id, nodeId: w.nodeId, attendeeName: who, templateId: t.id, photoId: photo.id,
        photoUrl: photo.url, rank: picks.length + 1, line: '', reason: 'Made with your event photo.', createdAt: photo.takenAt });
    }
  }
  const orders = [...conn.db.boardMerchOrders.iter()].filter(o => o.nodeId === w.nodeId).sort((a, b) => Number(b.id - a.id));
  const shipping = new Map([...conn.db.boardMerchShipping.iter()].map(s => [s.orderId, s.shippingAddress]));
  const lastAddress = orders.map(o => shipping.get(o.id)).find(Boolean) ?? '';
  const photoIds = new Set(picks.map(p => p.photoId));
  const photos = [...conn.db.boardPhotos.iter()].filter(p => photoIds.has(p.id));
  const buy = (e: Event, p: BoardMerchPick, kind: string) => {
    e.preventDefault();
    const size = kind === 'tee' ? field(e.target as HTMLElement, `as-size-${p.templateId}`) : '';
    const shippingAddress = field(e.target as HTMLElement, `as-address-${w.nodeId}-${p.templateId}`);
    act(() => conn.reducers.buyMerchAsWithShipping({ nodeId: w.nodeId, templateId: p.templateId, photoId: p.photoId, size, shippingAddress }));
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
      h('b', {}, '2. Their merch'),
      !picks.length && h('p', { class: 'muted' }, 'Merch appears once a photo includes this attendee.'),
      h('div', { class: 'merch' }, picks.map(p => {
        const t = conn.db.merchTemplate.id.find(p.templateId);
        if (!t) return null;
        return h('figure', {}, pickMockup(p, t),
          h('figcaption', {},
            h('b', {}, `${p.rank}. ${t.title}`), ` · ${money(t.priceCents)}`,
            p.reason && h('div', { class: 'muted' }, p.reason),
            !p.line && h('div', { class: 'muted' }, 'The printed line is added from friends tagged in the photo.'),
            h('form', { onsubmit: (e: Event) => buy(e, p, t.kind) },
              t.kind === 'tee' && h('label', {}, 'Size', h('select', { name: `as-size-${p.templateId}` },
                ['S', 'M', 'L', 'XL'].map(x => h('option', { value: x, selected: x === 'M' || undefined }, x)))),
              h('label', {}, 'Shipping address', h('textarea', { name: `as-address-${w.nodeId}-${p.templateId}`, required: true, maxlength: 1000, rows: 4,
                placeholder: 'Recipient name, street, city, region, postal code, country' }, lastAddress)),
              h('button', { disabled: w.balanceCents < t.priceCents || undefined }, `Buy as ${who}`))));
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
        shipping.get(o.id) && h('div', { style: 'white-space: pre-line' }, `Ship to: ${shipping.get(o.id)}`),
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
    picks.length > 0 && searchable('picks', h('table', {},
      h('tr', {}, h('th', {}, 'Attendee'), h('th', {}, '#'), h('th', {}, 'Product'), h('th', {}, 'Photo'), h('th', {}, 'Printed line'), h('th', {}, 'Why')),
      picks.map(p => {
        const t = titles.get(p.templateId);
        return h('tr', {},
          h('td', {}, p.attendeeName || '(no name yet)'), h('td', {}, String(p.rank)),
          h('td', {}, t ? [thumb(t.imageUrl, t.title, `pick ${p.id}`), h('div', {}, t.title)] : `template ${p.templateId}`),
          h('td', {}, thumb(p.photoUrl, 'photo', `pick ${p.id}`)),
          h('td', {}, p.line || h('span', { class: 'muted' }, 'none')),
          h('td', {}, p.reason));
      }))));
}

/** Buying as an attendee, the shopping agent's picks, every attendee's order and the loaded templates. */
function merchTab() {
  const templates = [...conn.db.merchTemplate.iter()].sort((a, b) => Number(a.id - b.id));
  const orders = [...conn.db.boardMerchOrders.iter()].sort((a, b) => Number(b.id - a.id));
  const shipping = new Map([...conn.db.boardMerchShipping.iter()].map(s => [s.orderId, s.shippingAddress]));
  const paid = orders.filter(o => o.status === 'paid');
  const booths = (ids: bigint[]) => ids.map(id => conn.db.booth.id.find(id)?.name ?? `booth ${id}`).join(', ');
  return [
    can('ops') && buyAs(),
    merchPicks(),
    h('section', {},
      h('h3', {}, `Orders: ${orders.length}, of which ${paid.length} paid for ${money(paid.reduce((s, o) => s + o.amountCents, 0n))}`),
      !can('ops') && h('p', { class: 'muted' }, 'Orders show for the organizer.'),
      can('ops') && !orders.length && h('p', { class: 'muted' }, 'No orders yet. Attendees can buy merch during and after the event.'),
      orders.length > 0 && searchable('orders', h('table', {},
        h('tr', {}, h('th', {}, 'Order'), h('th', {}, 'Attendee'), h('th', {}, 'Item'), h('th', {}, 'Photo'), h('th', {}, 'Printed line'), h('th', {}, 'Size'), h('th', {}, 'Amount'), h('th', {}, 'Status'), h('th', {}, 'Shipping address'), h('th', {}, 'Nessie purchase'), h('th', {}, 'Ordered')),
        orders.map(o => h('tr', {},
          h('td', {}, `#${o.id}`), h('td', {}, o.attendeeName || '(no name yet)'), h('td', {}, o.title),
          h('td', {}, o.photoUrl ? thumb(o.photoUrl, 'photo', `order ${o.id}`) : ''), h('td', {}, o.line || '—'), h('td', {}, o.size || '—'),
          h('td', {}, money(o.amountCents)),
          h('td', { class: o.status === 'paid' ? 'pass' : o.status === 'failed' ? 'fail' : '' }, o.status, o.failure && h('div', { class: 'muted' }, o.failure)),
          h('td', { style: 'white-space: pre-line' }, shipping.get(o.id) || 'Not provided'),
          h('td', {}, o.nessiePurchaseId ? h('code', {}, o.nessiePurchaseId) : h('span', { class: 'muted' }, 'not yet')),
          h('td', {}, date(o.createdAt))))))),
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
      ['bandit-organize runs, step by step', '/app/workflows/bandit-organize'],
      ['bandit-organizer, the agent and its tool calls', '/app/agent_builder/agents/bandit-organizer'],
    ],
  },
  {
    job: 'During the event: the bands\' radio log and the photos',
    what: 'The venue laptop records every packet the gateway hears from the bands and the station markers: zone, battery, SOS, fall and button presses, and the signal strength of every band nearby. It also records every photo\'s camera, time and place, never the image. The log is kept for after the event; nothing live reads it, since the Live tab comes from SpacetimeDB.',
    views: [['Band radio and photos', '/app/dashboards#/view/bandit-radio']],
  },
  {
    job: 'After the event: ordering the recap\'s suggestions',
    what: 'SpacetimeDB supplies the people and booths eligible for each recap. Elastic combines keyword and meaning searches, then reranks the results against the attendee\'s interests.',
    views: [['Recap suggestions: each attendee\'s latest ranking next to the minutes order', '/app/dashboards#/view/bandit-recap']],
  },
  {
    job: 'Documents and other model tasks',
    what: 'The document reader extracts quoted facts from policies and hospital reports. Separate workflows handle medical cards, images, letters and recommendations. Rust checks each result before saving it.',
    views: [
      ['Document reading runs', '/app/workflows/bandit-read-document'],
      ['Document reader and its page tools', '/app/agent_builder/agents/bandit-document-reader'],
      ['Text extraction, drafting and recommendation runs', '/app/workflows/bandit-run-task'],
    ],
  },
  {
    job: 'Claims: checking the evidence',
    what: 'Elastic checks claim copies without names and searches the venue and attendee policies for relevant clauses. The investigator requests evidence through Rust workers, which restrict every request to the claim. Code enforces policy amounts and approval rules before settlement.',
    views: [
      ['Claims evidence: validation, outcomes and approved amounts', '/app/dashboards#/view/bandit-claims'],
      ['Claim investigation runs', '/app/workflows/bandit-investigate-claim'],
      ['Claim investigator', '/app/agent_builder/agents/bandit-claim-investigator'],
    ],
  },
  {
    job: 'Claims: proposing payment rules from the organizer\'s approvals',
    what: 'After three claims of one kind receive organizer approval, the rule proposer suggests their highest payout as the ceiling. Code checks the cited claims, enforced scope and ceiling. Future claims can use the rule only after the organizer approves that scope.',
    views: [
      ['bandit-propose-rule runs, step by step', '/app/workflows/bandit-propose-rule'],
      ['bandit-rule-proposer, the agent and its counts', '/app/agent_builder/agents/bandit-rule-proposer'],
    ],
  },
];

function kibana() {
  return [
    h('section', {},
      h('h3', {}, 'Elastic, the Evidence Engine'),
      h('p', {}, 'The Evidence Engine organizes and validates data and searches it by meaning. The Decision Engine reviews claim evidence and recommends outcomes. Code checks each recommendation against the policy and approval rules before settlement. Each view opens in Kibana, signed in to the Elastic Cloud project.')),
    EVIDENCE_ENGINE.map(({ job, what, views }) => h('section', {},
      h('h3', {}, job),
      h('p', {}, what),
      h('ul', {}, views.map(([title, path]) => h('li', {}, h('a', { href: `${cfg.kibana_url}${path}`, target: '_blank' }, title)))))),
  ];
}

// The page redraws on every change and every second; holding off while a button is pressed keeps a
// click from landing on a button that was just replaced. The redraw the press held off follows the release.
let pressing = false;
document.addEventListener('pointerdown', () => { pressing = true; }, true);
document.addEventListener('pointerup', () => setTimeout(() => { pressing = false; render(); }, 100), true);
function render() {
  // Typing in a story box or choosing from a list holds redraws too, so the text and the open list stay put.
  const busy = document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLSelectElement;
  if (!conn || pressing || busy || readingDefinition(tab)) return;
  const open = tabs();
  // The Live tab uses the window's whole width.
  document.body.classList.toggle('wide', tab === 'live' && !viewing());
  mount('head', header());
  const list = document.getElementById('people')!;
  if (!open.length) {
    showViewAs(false);
    list.replaceChildren();
    listShows = '';
    return mount('app', noRole());
  }
  // A tab the caller's roles do not open falls back to their first one.
  if (!open.some(([key]) => key === tab)) tab = open[0][0];
  // On the Live tab the frame shows the opened person's page, between them and the list.
  const people = tab === 'live' ? everyone() : [];
  const person = people.find(p => p.key === opened);
  showViewAs(tab === 'viewas' || (!!person?.view && keyOf(person.view) === viewKey && !!viewScreen));
  if (tab !== 'live') {
    list.replaceChildren();
    listShows = '';
  } else {
    const drawn = peopleList(people);
    if (drawn) mount('people', drawn);
  }
  const body = tab === 'attendees' ? attendees() : tab === 'claims' ? claimsTab() : tab === 'rules' ? rulesTab(conn, can('ops'), toClaim) : tab === 'costs' ? costsTab(conn, {
    openClaim: id => { tab = 'claims'; location.hash = 'claims'; showClaim(id); },
    openTab: next => { tab = next; location.hash = next; render(); },
    canManage: can('ops'),
  }) : tab === 'graph' ? graphTab(conn) : tab === 'photos' ? photosTab() : tab === 'merch' ? merchTab() : tab === 'venue' ? venueSetupTab(conn, can('ops')) : tab === 'kibana' ? kibana() : tab === 'bands' ? bandsTab() : tab === 'staff' ? staffTab() : tab === 'viewas' ? viewAsTab() : live(people);
  mount('app', body);
  if (tab === 'claims' || tab === 'rules' || tab === 'costs') defineTerms(document.getElementById('app')!, tab);
  keepTableHeights(document.getElementById('app')!);
  if (scrollToClaim) {
    scrollToClaim = false;
    document.getElementById('claim-detail')?.scrollIntoView({ block: 'start' });
  }
  const panel = scrollToPerson && document.getElementById('person');
  if (panel) {
    // From the 3D venue, the panel beside it comes into view only when it is below the screen.
    const top = panel.getBoundingClientRect().top;
    if (scrollToPerson === 'top') panel.scrollIntoView({ block: 'start' });
    else if (top > innerHeight * 0.6) scrollBy({ top: top - innerHeight * 0.6, behavior: 'smooth' });
  }
  scrollToPerson = '';
}

async function main() {
  cfg = await config();
  // Wherever SpacetimeAuth is set up, sign-in comes first and staff always act as themselves; only a
  // local server without sign-in still takes ?as= for testing.
  if (cfg.auth_client_id && !idToken()) return mount('app', signInScreen());
  if (cfg.auth_client_id && new URLSearchParams(location.search).has('as')) history.replaceState(null, '', location.pathname + location.hash);
  conn = await connect(QUERIES, render);
  redrawOnSearch(render);
  serveViewers(conn);
  openFromHash();
  render();
  window.addEventListener('hashchange', () => { tab = location.hash.slice(1); openFromHash(); render(); });
  setInterval(() => { if (!(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLSelectElement)) render(); }, 1000);
}

main().catch(e => mount('app', h('p', { class: 'error' }, String(e?.message ?? e))));
