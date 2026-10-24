// The host portal: the live event from the bands, alerts, who joined, insurance claims from the
// medic's filing to the named approver's decision, the import runs, Kibana, and "Event ended".

import {
  act, actors, config, connect, date, field, h, idToken, money, mount, playedToken, risk, short, signIn,
  signOut, signedInEmail, time, type Actor, type Config, EXIT_COLOURS,
} from '../lib';
import type { DbConnection } from '../module_bindings';
import type { Claim } from '../module_bindings/types';

const QUERIES = [
  'SELECT * FROM my_roles',
  'SELECT * FROM event_state',
  'SELECT * FROM venue',
  'SELECT * FROM zone',
  'SELECT * FROM booth',
  'SELECT * FROM organization',
  'SELECT * FROM band',
  'SELECT * FROM zone_visit',
  'SELECT * FROM station',
  'SELECT * FROM gateway',
  'SELECT * FROM settings',
  'SELECT * FROM import_run',
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
  'SELECT * FROM board_authority',
  'SELECT * FROM board_policies',
  'SELECT * FROM medic_medical_cards',
];

/** The synthetic clinic records in fixtures/medical-records, rendered for the incident's date and time. */
const SAMPLE_RECORDS: [string, string][] = [
  ['first-aid-wrist', 'Event first aid, wrist sprain (Maya Chen, $180)'],
  ['urgent-care-wrist', 'Urgent care, wrist sprain (Jordan Alvarez, $1,308)'],
  ['urgent-care-ankle-home', 'Urgent care, ankle hurt at home (Sam Patel, $565)'],
];

let conn: DbConnection;
let cfg: Config;
let people: Actor[] = [];
let tab = location.hash.slice(1) || 'live';
let openClaim: bigint | undefined;

const tabs: [string, string][] = [['live', 'Live'], ['attendees', 'Attendees'], ['claims', 'Claims'], ['data', 'Imports and Kibana'], ['simulate', 'Simulate']];

function zoneName(id: bigint) {
  return conn.db.zone.id.find(id)?.name ?? 'no zone';
}

function header() {
  const roles = [...conn.db.myRoles.iter()].map(r => `${r.role} (${r.label})`);
  const as = new URLSearchParams(location.search).get('as') ?? '';
  const state = conn.db.eventState.id.find(0);
  const ended = state?.ended ?? false;
  return [
    h('h2', {}, `${conn.db.venue.iter().next().value?.name ?? 'Event'} host portal`),
    h('p', {},
      cfg.simulate && h('label', { class: 'check' }, 'Play as',
        h('select', { onchange: (e: Event) => { location.search = `?as=${(e.target as HTMLSelectElement).value}`; } },
          h('option', { value: '' }, 'choose a person'),
          people.map(p => h('option', { value: p.name, selected: p.name === as || undefined }, p.label)))),
      !as && signedInEmail() && [`Signed in as ${signedInEmail()} `, h('button', { class: 'link', onclick: signOut }, 'Sign out')],
      !as && !idToken() && cfg.auth_client_id && h('button', { onclick: signIn }, 'Sign in with email'),
      h('span', { class: 'muted' }, ` Identity ${short(conn.identity!)}: ${roles.length ? roles.join(', ') : 'no staff role yet (the owner grants it with grant_role)'}`)),
    h('p', {},
      ended
        ? [h('b', {}, `The event ended at ${date(state?.endedAt)}. `), 'Every tap link now shows the recap. ',
          h('button', { onclick: () => act(() => conn.reducers.reopenEvent({})) }, 'Reopen the event')]
        : h('button', { onclick: () => confirm('End the event? Every tap link switches to the recap.') && act(() => conn.reducers.endEvent({})) }, 'Event ended')),
    h('nav', {}, tabs.filter(([key]) => key !== 'simulate' || cfg.simulate).map(([key, label]) => h('a', { href: `#${key}`, class: key === tab ? 'on' : '', onclick: () => { tab = key; render(); } }, label))),
  ];
}

// --- Live -----------------------------------------------------------------------------------

function live() {
  const settings = conn.db.settings.iter().next().value;
  const now = Date.now();
  const bands = [...conn.db.band.iter()].filter(b => b.online && now - b.lastSeen.toDate().getTime() < 5000);
  const gw = conn.db.gateway.id.find(0);
  const zones = [...conn.db.zone.iter()].sort((a, b) => a.stationId - b.stationId);
  const alerts = bands.filter(b => b.sos || b.fall);
  const inside = [...conn.db.zoneVisit.iter()].filter(v => v.left === undefined);
  const incidents = [...conn.db.openIncidents.iter()];
  return [
    (alerts.length > 0 || incidents.length > 0) && h('section', { class: 'alert' },
      h('h3', {}, 'Alerts'),
      h('ul', {},
        alerts.map(b => {
          const z = zones.find(z => z.stationId === b.zone);
          return h('li', {}, h('b', {}, b.fall ? 'Fall' : 'SOS'), ` on band ${b.id} in ${z?.name ?? 'no zone'}: the bands around it show the light circle.`);
        }),
        incidents.map(i => h('li', {}, `Incident ${i.id}: ${i.kind.tag} in ${zoneName(i.zoneId)}, band ${i.subjectBand}, ${i.status.tag}, opened ${time(i.openedAt)}`)))),
    h('section', {},
      h('h3', {}, 'Zones'),
      h('p', {}, settings?.lowVis
        ? [h('b', {}, 'Low visibility is on: every band guides its wearer to the exit colour of its zone. '), h('button', { onclick: () => act(() => conn.reducers.setLowVis({ on: false })) }, 'Turn it off')]
        : h('button', { onclick: () => confirm('Fire or smoke? Every band starts guiding its wearer to the exit.') && act(() => conn.reducers.setLowVis({ on: true })) }, 'Low visibility: guide everyone to the exits')),
      h('p', { class: 'muted' }, `${inside.length} people in zones right now, ${bands.length} bands heard in the last 5 s. Gateway ${gw?.online ? 'online' : 'offline'}${gw ? `, last line ${time(gw.lastLine)}` : ''}. Busy at ${settings?.yellow ?? 3} neighbours, very busy at ${settings?.red ?? 5}.`),
      h('table', {},
        h('tr', {}, h('th', {}, 'Zone'), h('th', {}, 'People now'), h('th', {}, 'Bands reporting'), h('th', {}, 'Neighbours per band'), h('th', {}, 'Level'), h('th', {}, 'Capacity'), h('th', {}, 'Exit'), h('th', {}, 'Station')),
        zones.map(z => {
          const here = bands.filter(b => b.zone === z.stationId);
          const avg = here.length ? here.reduce((s, b) => s + b.neigh, 0) / here.length : 0;
          const level = risk(avg, settings?.yellow ?? 3, settings?.red ?? 5);
          const st = conn.db.station.id.find(z.stationId);
          return h('tr', {},
            h('td', {}, z.name), h('td', {}, inside.filter(v => v.zone === z.stationId).length), h('td', {}, here.length), h('td', {}, avg.toFixed(1)),
            h('td', { class: `level ${level.replace(' ', '-')}` }, level), h('td', {}, z.capacity),
            h('td', {}, EXIT_COLOURS[z.exitColour]), h('td', {}, `${z.stationId} ${st?.online ? 'online' : 'offline'}`));
        }))),
  ];
}

// --- Attendees ------------------------------------------------------------------------------

function attendees() {
  const all = [...conn.db.boardAttendees.iter()].sort((a, b) => Number(a.simulated) - Number(b.simulated) || a.displayName.localeCompare(b.displayName));
  const real = all.filter(a => !a.simulated).length;
  return h('section', {},
    h('h3', {}, `Attendees (${real} people, ${all.length - real} simulated)`),
    h('table', {},
      h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Band'), h('th', {}, 'Company'), h('th', {}, 'Findable'), h('th', {}, 'Socials'), h('th', {}, 'Joined')),
      all.map(a => h('tr', {},
        h('td', {}, a.displayName || '(no name yet)', a.simulated && h('span', { class: 'muted' }, ' simulated')),
        h('td', {}, a.bandId ? h('a', { href: `/t/BANDIT-${String(a.bandId).padStart(2, '0')}` }, a.bandId) : ''),
        h('td', {}, a.organization), h('td', {}, a.findable ? 'yes' : 'no'),
        h('td', {}, a.handles.map(x => `${x.platform} ${x.handle}`).join(', ')), h('td', {}, time(a.createdAt))))));
}

// --- Claims ---------------------------------------------------------------------------------

function incidentDesk() {
  const incidents = [...conn.db.openIncidents.iter()];
  const notes = [...conn.db.boardNotes.iter()];
  return h('section', {},
    h('h3', {}, 'Open incidents (medic)'),
    !incidents.length && h('p', { class: 'muted' }, 'None. A fall or SOS on a band opens one here.'),
    incidents.map(i => {
      const mine = notes.filter(n => n.incidentId === i.id);
      const note = async (e: Event) => {
        e.preventDefault();
        const f = e.target as HTMLFormElement;
        const cost = field(f, 'cost');
        const ok = await act(() => conn.reducers.addIncidentNote({
          incidentId: i.id, text: field(f, 'text'), costCents: cost ? BigInt(Math.round(Number(cost) * 100)) : undefined,
        }));
        if (ok) f.reset();
      };
      return h('div', { class: 'incident' },
        h('p', {}, h('b', {}, `Incident ${i.id}: ${i.kind.tag}`), ` in ${zoneName(i.zoneId)}, band ${i.subjectBand}, ${i.status.tag}, opened ${time(i.openedAt)} by ${i.openedBy}`),
        h('ul', {}, mine.map(n => h('li', {}, `${time(n.createdAt)} ${n.authorRole}: ${n.text}${n.costCents !== undefined ? ` (${money(n.costCents)})` : ''}`))),
        i.status.tag === 'Open' && h('button', { onclick: () => act(() => conn.reducers.assignMedic({ incidentId: i.id })) }, 'Take it'),
        i.subjectBand !== 0 && h('button', { onclick: () => act(() => conn.reducers.requestMedicalCard({ bandId: i.subjectBand })) }, `Tap band ${i.subjectBand} for the medical card`),
        medicCard(i.id),
        h('form', { onsubmit: note },
          h('input', { name: `text`, placeholder: 'Treatment note', required: true }),
          h('input', { name: `cost`, placeholder: 'Cost in dollars (optional)', inputmode: 'decimal' }),
          h('button', {}, 'Add note')),
        h('button', { onclick: () => act(() => conn.reducers.resolveIncident({ incidentId: i.id, resolution: 'treated on site' })) }, 'Resolve'));
    }));
}

/** The medical card a medic opened by tapping the band, while the incident is open. */
function medicCard(incidentId: bigint) {
  const m = [...conn.db.medicMedicalCards.iter()].find(c => c.incidentId === incidentId);
  if (!m) return null;
  const c = m.card;
  const list = (label: string, items: string[]) => items.length > 0 && h('p', {}, h('b', {}, `${label}: `), items.join('; '));
  return h('section', { class: 'alert' },
    h('h4', {}, `Medical card: ${m.name}, band ${m.bandId}`, c.status !== 'confirmed' ? ' (not yet confirmed by the wearer)' : ''),
    c.bloodType && h('p', {}, h('b', {}, 'Blood type: '), c.bloodType),
    list('Allergies', c.allergies), list('Conditions', c.conditions), list('Medications', c.medications),
    c.emergencyContact && h('p', {}, h('b', {}, 'Emergency contact: '), c.emergencyContact),
    c.insurer && h('p', {}, h('b', {}, 'Insurance: '), `${c.insurer} ${c.plan}, member ${c.memberId}, group ${c.groupNumber}${c.insurerPhone ? `, ${c.insurerPhone}` : ''}`),
    c.notes && h('p', {}, c.notes));
}

// --- Simulate ------------------------------------------------------------------------------

async function post(path: string) {
  const res = await fetch(path, { method: 'POST' });
  if (!res.ok) throw new Error((await res.json()).error);
}

/** The simulated bands 90 to 99: who wears them, where they are, and buttons to walk or drop them. */
function simulateTab() {
  const owners = new Map([...conn.db.boardAttendees.iter()].filter(a => a.bandId >= 90).map(a => [a.bandId, a.displayName]));
  const zones = [...conn.db.zone.iter()].sort((a, b) => a.stationId - b.stationId);
  const bands = [...conn.db.band.iter()].filter(b => b.id >= 90 && b.id <= 99 && owners.has(b.id)).sort((a, b) => a.id - b.id);
  return h('section', {},
    h('h3', {}, 'Simulated bands'),
    h('p', { class: 'muted' }, 'Bands 90 to 93 are the claims story\'s attendees; 94 to 99 are the ones testers claim from a tap link. A fall uses two of the story attendees as the bands around it.'),
    !bands.length && h('p', { class: 'muted' }, 'No simulated band is claimed yet. Open /t/BANDIT-94 and press it.'),
    h('table', {}, bands.map(b => h('tr', {},
      h('td', {}, h('b', {}, `Band ${b.id}`), ` ${owners.get(b.id)}`),
      h('td', {}, zones.find(z => z.stationId === b.zone)?.name ?? 'no zone'),
      h('td', {}, b.id >= 94 && zones.map(z => h('button', { class: 'sim', disabled: z.stationId === b.zone || undefined,
        onclick: () => act(() => post(`/api/dev/move/${b.id}/${z.stationId}`)) }, z.name))),
      h('td', {}, h('button', { class: 'sim', onclick: () => act(() => post(`/api/dev/fall/${b.id}`)).then(ok => { if (ok) { tab = 'claims'; location.hash = 'claims'; render(); } }) }, 'Fall here'))))),
    h('h3', {}, 'Property damage'),
    h('p', { class: 'muted' }, 'A venue camera sees a speaker knocked off its stand; the vision check confirms it and a property claim opens.'),
    zones.map(z => h('button', { class: 'sim', onclick: () => act(() => post(`/api/dev/property/${z.stationId}`)).then(ok => { if (ok) { tab = 'claims'; location.hash = 'claims'; render(); } }) }, `Speaker breaks in ${z.name}`)));
}

function statusOf(c: Claim) {
  return c.status.tag.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function claimList() {
  const claims = [...conn.db.claimsBoard.iter()].sort((a, b) => Number(b.id - a.id));
  const me = conn.identity!;
  return h('section', {},
    h('h3', {}, 'Claims'),
    !claims.length && h('p', { class: 'muted' }, 'No claims yet. Resolving an injury incident with a note opens one.'),
    claims.length > 0 && h('table', {},
      h('tr', {}, h('th', {}, 'Claim'), h('th', {}, 'Claimant'), h('th', {}, 'What'), h('th', {}, 'Status'), h('th', {}, 'Payout'), h('th', {}, 'Waiting for')),
      claims.map(c => h('tr', { class: c.routedTo.isEqual(me) ? 'alert' : '' },
        h('td', {}, h('button', { class: 'link', onclick: () => { openClaim = c.id; render(); } }, `#${c.id}`)),
        h('td', {}, c.claimantName || '(none)'), h('td', {}, `${c.incidentKind} in ${c.zoneName}`),
        h('td', {}, statusOf(c), h('div', { class: 'muted' }, c.statusNote)),
        h('td', {}, money(c.payoutCents)),
        h('td', {}, c.status.tag === 'Routed' ? `${c.routedToName} (${c.routedToRole})${c.routedTo.isEqual(me) ? ', you' : ''}` : '')))));
}

async function fileRecord(claimId: bigint, form: HTMLFormElement) {
  const input = form.querySelector('input[type=file]') as HTMLInputElement;
  const sample = field(form, 'sample');
  if (!input.files?.[0] && sample) {
    const res = await fetch(`/api/dev/record/${claimId}/${sample}`, { method: 'POST' });
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
  const approve = async (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const ceiling = field(f, 'ceiling');
    await act(() => conn.reducers.approveClaim({
      claimId: c.id, amountSeenCents: c.payoutCents, packHashSeen: c.packHash,
      requestedCeilingCents: ceiling ? BigInt(Math.round(Number(ceiling) * 100)) : undefined,
      learn: (f.elements.namedItem('learn') as HTMLInputElement).checked,
    }));
  };
  const refuse = async (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    await act(() => conn.reducers.refuseClaim({ claimId: c.id, packHashSeen: c.packHash, reason: field(f, 'reason') }));
  };
  return h('div', {},
    h('form', { onsubmit: approve },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'learn', checked: true }), 'Learn a rule from this approval, so similar claims settle on their own'),
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
    c.status.tag === 'AwaitingRecord' && h('form', { onsubmit: (e: Event) => { e.preventDefault(); act(() => fileRecord(c.id, e.target as HTMLFormElement)); } },
      h('h4', {}, 'File the medical record'),
      h('label', {}, 'Clinic PDF', h('input', { type: 'file', accept: 'application/pdf' })),
      cfg.simulate && h('label', {}, 'or a sample record, dated for this incident', h('select', { name: 'sample' }, h('option', { value: '' }, '—'), SAMPLE_RECORDS.map(([f, label]) => h('option', { value: f }, label)))),
      h('button', {}, 'File it, Claude reads it')),
    c.status.tag === 'Routed' && h('div', {}, h('h4', {}, `Your decision (${c.routedToName}, ${c.routedToRole})`), decide(c)),
    h('h4', {}, 'Checks'),
    h('table', {}, checks.map(x => h('tr', {}, h('td', { class: x.result }, x.result), h('td', {}, x.name), h('td', {}, x.detail), h('td', { class: 'muted' }, x.reader)))),
    record && [h('h4', {}, 'Medical record, read by Claude'),
      h('p', {}, `${record.status}: ${record.documentKind} for ${record.patientName} from ${record.providerName} on ${record.dateOfService}, invoice ${record.invoiceNumber}. Billed ${money(record.billedCents)}, covered ${money(record.coveredCents)}.`),
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
  const authority = [...conn.db.boardAuthority.iter()].sort((a, b) => a.rank - b.rank);
  const policy = conn.db.boardPolicies.iter().next().value;
  return h('section', {},
    h('h3', {}, 'Learned rules'),
    !rows.length && h('p', { class: 'muted' }, 'None yet. An approval with "learn" checked creates one.'),
    h('table', {}, rows.map(r => h('tr', {}, h('td', {}, `v${r.version}`), h('td', {}, `${r.incidentKind} under ${r.coverKind}`),
      h('td', {}, `up to ${money(r.ceilingCents)}${r.requiresCorroborated ? ', corroborated only' : ''}`),
      h('td', {}, `from ${r.approverName} (${r.approverRole})`), h('td', {}, r.status)))),
    h('h3', {}, 'Who approves what'),
    h('table', {}, authority.map(a => h('tr', {}, h('td', {}, a.role), h('td', {}, a.assigneeName), h('td', {}, a.ceilingCents !== undefined ? `up to ${money(a.ceilingCents)}` : 'no limit')))),
    policy && h('p', { class: 'muted' }, `Policy ${policy.policyNumber} with ${policy.insurerName}. Medical payments used ${money(policy.medicalUsedCents)}, property used ${money(policy.propertyUsedCents)}.`));
}

function claimsTab() {
  return [incidentDesk(), openClaim !== undefined && claimDetail(openClaim), claimList(), rules()];
}

// --- Imports and Kibana ---------------------------------------------------------------------

function data() {
  const runs = [...conn.db.importRun.iter()].sort((a, b) => Number(b.id - a.id));
  return [
    h('section', {},
      h('h3', {}, 'Kibana'),
      h('ul', {}, cfg.dashboards.map(d => h('li', {}, h('a', { href: d.url, target: '_blank' }, d.title)))),
      h('p', { class: 'muted' }, 'Elastic validated and organized the scraped event pages before they were loaded here.')),
    h('section', {},
      h('h3', {}, 'Import runs'),
      h('p', {}, `${conn.db.organization.count()} organizations, ${conn.db.booth.count()} booths, ${conn.db.zone.count()} zones loaded.`),
      h('table', {}, runs.map(r => h('tr', {}, h('td', {}, r.runId), h('td', {}, date(r.importedAt)), h('td', {}, r.organizer),
        h('td', {}, r.counts.map(c => `${c.section} +${c.inserted} ~${c.updated}`).join(', ')))))),
  ];
}

function render() {
  if (!conn) return;
  const body = tab === 'attendees' ? attendees() : tab === 'claims' ? claimsTab() : tab === 'data' ? data() : tab === 'simulate' ? simulateTab() : live();
  mount('app', header(), body);
}

async function main() {
  cfg = await config();
  if (cfg.simulate) people = await actors();
  if (cfg.auth_client_id && !idToken() && !(await playedToken()) && !cfg.simulate) {
    return mount('app', h('h2', {}, 'Host portal'), h('button', { onclick: signIn }, 'Sign in with email'));
  }
  conn = await connect(QUERIES, render);
  window.addEventListener('hashchange', () => { tab = location.hash.slice(1) || 'live'; render(); });
  setInterval(() => { if (!(document.activeElement instanceof HTMLInputElement)) render(); }, 1000);
}

main().catch(e => mount('app', h('p', { class: 'error' }, String(e?.message ?? e))));
