// How the evidence for one claim was gathered, oldest first: the band's flag, the bands around it,
// the staff notes, the camera, the attendee's own words, the hospital report, the code and Elastic
// checks, the review, the organizer's decision, the payout and the insurer's payment. Built from the
// current evidence pack's facts (see crates/bandit-insurance/src/evidence.rs for their sources and
// keys) and the claim's other board rows.

import type { Timestamp } from 'spacetimedb';
import { date, h, money, time } from './lib';
import { bandCode } from './band-code';
import type { DbConnection } from './module_bindings';
import type { Claim, EvidenceFact } from './module_bindings/types';

type Entry = { at: Timestamp; source: string; text: string };

/** Facts that share a source, a reference and a time: one row the module read. */
type Group = { source: string; at: Timestamp; values: Map<string, string[]> };

function micros(t: Timestamp): bigint {
  return t.microsSinceUnixEpoch;
}

function groups(facts: EvidenceFact[]): Group[] {
  const out: (Group & { reference: string })[] = [];
  for (const f of facts) {
    const last = out[out.length - 1];
    const same = last && last.source === f.source && last.reference === f.reference && micros(last.at) === micros(f.observedAt);
    const g = same ? last : { source: f.source, reference: f.reference, at: f.observedAt, values: new Map<string, string[]>() };
    if (!same) out.push(g);
    g.values.set(f.key, [...(g.values.get(f.key) ?? []), f.value]);
  }
  return out;
}

const OPENED_BY: Record<string, string> = { band: 'the band', ops: 'the organizer', medic: 'a medic', vision: 'the venue camera' };
const KIND: Record<string, string> = { fall: 'Fall', sos: 'SOS', property: 'Property damage' };

/** Where the evidence for `claim` came from, as a timeline. */
export function evidenceTrail(conn: DbConnection, claim: Claim): HTMLElement {
  const id = claim.id;
  const names = new Map([...conn.db.boardAttendees.iter()].filter(a => a.bandId).map(a => [a.bandId, a.displayName]));
  const band = (n: number) => {
    const name = names.get(n) || (n === claim.bandId ? claim.claimantName : '');
    return `${bandCode(n)}${name ? ` (${name})` : ''}`;
  };
  const zone = (zid: string) => zid === '0' ? 'no zone' : conn.db.zone.id.find(BigInt(zid))?.name ?? `zone ${zid}`;
  const list = (s: string) => s === 'none' ? [] : s.split(', ');
  const facts = [...conn.db.boardFacts.iter()].filter(f => f.claimId === id && f.packVersion === claim.packVersion).sort((a, b) => a.seq - b.seq);
  const entries: Entry[] = [];
  const add = (at: Timestamp | undefined, source: string, text: string) => { if (at) entries.push({ at, source, text }); };

  const all = groups(facts);
  for (let i = 0; i < all.length; i++) {
    const g = all[i];
    const v = (key: string) => g.values.get(key)?.[0] ?? '';
    // Runs of witness bands and of zone stays each read better as one line.
    const run = (source: string) => {
      const items = [g];
      while (all[i + 1]?.source === source) items.push(all[++i]);
      return items;
    };
    switch (g.source) {
      case 'incident_snapshot':
        if (g.values.has('incident_kind')) {
          add(g.at, 'Incident', `${KIND[v('incident_kind')] ?? v('incident_kind')} opened by ${OPENED_BY[v('opened_by')] ?? v('opened_by')} in ${zone(v('zone_id'))}`);
        } else {
          // The light-circle line below names the bands when the module recorded them as witnesses.
          const circle = list(v('circle_bands')).map(b => band(Number(b)));
          const named = all.some(x => x.source === 'light_circle');
          add(g.at, 'Bands around it', `${v('band_count')} bands in the zone, about ${v('neigh_mean')} close to each${named ? '' : `; ${circle.length ? `light circle on ${circle.join(', ')}` : 'no band showed the light circle'}`}`);
        }
        break;
      case 'band_report': {
        const flag = v('fall_flag') === '1' ? 'fall' : v('sos_flag') === '1' ? 'SOS' : 'alert';
        add(g.at, 'Band', `Band ${band(Number(v('band_id')))} raised the ${flag} flag, ${v('neigh')} bands close by, heard by station ${v('station_id')}`);
        break;
      }
      case 'light_circle': {
        const items = run('light_circle');
        const seen = items.map(x => {
          const [, b, , z, , rssi] = (x.values.get('witness')?.[0] ?? '').split(' ');
          return `${band(Number(b))} in ${zone(z)}${rssi && rssi !== '0' ? `, ${rssi} dBm` : ''}`;
        });
        const first = items.reduce((a, x) => micros(x.at) < micros(a.at) ? x : a);
        add(first.at, 'Light circle', `${seen.length} ${seen.length === 1 ? 'band' : 'bands'} around it lit the light circle: ${seen.join('; ')}`);
        break;
      }
      case 'staff_note': {
        const cost = v('cost_cents');
        add(g.at, 'Staff note', `${v('note')}${cost ? ` (${money(BigInt(cost))})` : ''}`);
        break;
      }
      case 'zone_context': {
        const booths = list(v('nearby_booths'));
        const on = v('schedule_now');
        add(g.at, 'Venue', `${v('zone_name')} (${v('zone_kind')}, capacity ${v('zone_capacity')})${on && on !== 'none' ? `; ${on} was on` : ''}${booths.length ? `; near ${booths.join(', ')}` : ''}`);
        break;
      }
      case 'presence': {
        const items = run('presence');
        add(items[0].at, 'Where the band was', items.map(x => x.values.get('zone_stay')?.[0] ?? '').join(', then '));
        break;
      }
      case 'vision_assessment': {
        // The camera's frames follow its assessment, one group each.
        let count = 0;
        while (all[i + 1]?.source === 'vision_assessment' && !all[i + 1].values.has('vision_confirmed')) { i++; count++; }
        if (g.values.has('vision_confirmed')) add(g.at, 'Camera', `${v('vision_confirmed') === 'yes' ? 'Confirmed' : 'Did not confirm'} it (${v('vision_confidence')} sure): ${v('vision_description')}; ${count} ${count === 1 ? 'frame' : 'frames'} kept`);
        break;
      }
      case 'policy':
        add(g.at, 'Policy', `${v('policy_number')} with ${v('insurer')}: ${v('cover_kind').replace('_', ' ')}, up to ${money(BigInt(v('per_claim_limit_cents') || 0))} a claim, deductible ${money(BigInt(v('deductible_cents') || 0))}, ${money(BigInt(v('aggregate_remaining_cents') || 0))} left`);
        break;
      // The medical record's facts are shown from the record itself, below.
    }
  }

  const who = claim.claimantName || 'no claimant';
  add(claim.openedAt, 'Claim', claim.statement ? `${who} filed the claim: "${claim.statement}"` : `Claim opened for ${who}`);

  const clinic = [...conn.db.boardClinicReports.iter()].filter(r => r.claimId === id).sort((a, b) => Number(a.id - b.id)).pop();
  if (clinic) {
    add(clinic.requestedAt, 'Hospital', 'Hospital report requested');
    if (clinic.status === 'received') add(clinic.receivedAt, 'Hospital', `Hospital report received from ${clinic.providerName}, visit ${clinic.visitDate}`);
    if (clinic.status === 'failed') add(clinic.receivedAt ?? clinic.requestedAt, 'Hospital', `The hospital report failed: ${clinic.problems.join('; ')}`);
  }
  const record = [...conn.db.boardRecords.iter()].filter(r => r.claimId === id).sort((a, b) => Number(a.id - b.id)).pop();
  if (record) {
    if (!clinic) add(record.submittedAt, 'Medical record', 'Medical record filed');
    if (record.status === 'extracted') {
      add(record.extractedAt ?? record.submittedAt, 'Claude', `Read the record: ${record.documentKind} for ${record.patientName} from ${record.providerName} on ${record.dateOfService}; ${record.diagnoses.join('; ')}; billed ${money(record.billedCents)}, covered ${money(record.coveredCents)}`);
    } else if (record.status !== 'reading') {
      add(record.extractedAt ?? record.submittedAt, 'Claude', `Could not read the record: ${record.dropped.join('; ')}`);
    }
  }

  const checks = [...conn.db.boardChecks.iter()].filter(x => x.claimId === id && x.packVersion === claim.packVersion);
  for (const reader of ['code', 'elastic', 'model']) {
    const mine = checks.filter(x => x.reader === reader);
    if (!mine.length) continue;
    const failed = mine.filter(x => x.result === 'fail');
    const passed = mine.filter(x => x.result === 'pass').length;
    const last = mine.reduce((a, x) => micros(x.createdAt) > micros(a.createdAt) ? x : a);
    const label = reader === 'code' ? 'Code' : reader === 'elastic' ? 'Elastic' : 'Claude';
    const corroboration = reader === 'code' && claim.corroboration ? `; evidence ${claim.corroboration}` : '';
    add(last.createdAt, label, `${mine.length} ${mine.length === 1 ? 'check' : 'checks'}: ${passed} passed, ${failed.length} failed${failed.length ? ` (${failed.map(x => `${x.name}: ${x.detail}`).join('; ')})` : ''}${corroboration}`);
  }

  const review = [...conn.db.boardReviews.iter()].filter(r => r.claimId === id).sort((a, b) => Number(a.id - b.id)).pop();
  if (review) add(review.createdAt, 'Claims agent', `${review.verdict.replace('_', ' ')}: ${review.summary}${review.concerns.length ? ` ${review.concerns.length} ${review.concerns.length === 1 ? 'concern' : 'concerns'}.` : ''}`);

  for (const a of [...conn.db.boardApprovals.iter()].filter(a => a.claimId === id)) {
    add(a.decidedAt, 'Decision', `${a.approverName} (${a.approverRole}) ${a.decision === 'approve' ? 'approved' : 'refused'} at ${money(a.amountSeenCents)}${a.learn ? ', learned a rule' : ''}${a.reason ? `: ${a.reason}` : ''}`);
  }
  if (claim.decidedBy === 'rule') {
    const rule = [...conn.db.boardRules.iter()].find(r => r.id === claim.settlementRuleId);
    add(claim.decidedAt, 'Decision', `Settled on its own under rule v${claim.settlementRuleVersion}${rule ? `, learned from ${rule.approverName}` : ''}`);
  } else if (claim.decidedBy && claim.decidedBy !== 'approver') {
    add(claim.decidedAt, 'Decision', `Refused by ${claim.decidedBy}: ${claim.refusalReason || claim.statusNote}`);
  }

  const ledger = [...conn.db.boardLedger.iter()].filter(l => l.claimId === id).sort((a, b) => Number(a.id - b.id));
  const journals = new Map<string, typeof ledger>();
  for (const l of ledger) journals.set(l.journalId.toString(), [...(journals.get(l.journalId.toString()) ?? []), l]);
  let paid = false;
  let reconciled = false;
  for (const lines of journals.values()) {
    const name = lines[0].journal;
    const debit = lines.reduce((s, l) => s + l.debitCents, 0n);
    const cash = lines.filter(l => l.account === 'cash').reduce((s, l) => s + l.debitCents, 0n);
    const text = name.startsWith('J1r') ? `Released the ${money(debit)} reserve`
      : name.startsWith('J1') ? `Reserved ${money(debit)} for the payout`
      : name.startsWith('J2') ? `Booked ${money(debit)} as recoverable from the insurer`
      : name.startsWith('J3') ? `Paid ${money(debit)}${claim.claimantName ? ` to ${claim.claimantName}` : ''}${claim.payoutReference ? ` (${claim.payoutReference})` : ''}`
      : name.startsWith('J4') ? `The insurer paid ${money(cash)}`
      : `${name}: ${money(debit)}`;
    paid ||= name.startsWith('J3');
    reconciled ||= name.startsWith('J4');
    add(lines[0].postedAt, 'Ledger', text);
  }
  if (!paid) add(claim.settledAt, 'Ledger', `Settled${claim.payoutReference ? ` (${claim.payoutReference})` : ''}`);
  if (!reconciled) add(claim.reconciledAt, 'Ledger', 'Reconciled with the insurer');

  // Oldest first; the sort is stable, so rows at the same moment keep the order above.
  entries.sort((a, b) => (micros(a.at) < micros(b.at) ? -1 : micros(a.at) > micros(b.at) ? 1 : 0));
  const day = claim.openedAt.toDate().toDateString();
  const when = (t: Timestamp) => (t.toDate().toDateString() === day ? time(t) : date(t));
  return h('div', {},
    h('h4', {}, 'How the evidence was gathered'),
    !entries.length && h('p', { class: 'muted' }, 'Nothing gathered yet.'),
    entries.length > 0 && h('ol', { class: 'trail' }, entries.map(e => h('li', {}, h('span', { class: 'muted' }, when(e.at)), ' ', h('b', {}, e.source), ' ', e.text))));
}
