// The payment rules proposed from the organizer's precedents: the Proposed rules tab of the organizer portal, and
// the proposals waiting for the organizer on the Live tab. The organizer approves one with the ceiling it shows,
// or rejects it with a reason; the module refuses an approval from whoever proposed it.

import { act, date, field, h, money } from './lib';
import { searchable } from './table-search';
import type { DbConnection } from './module_bindings';
import type { RuleProposal } from './module_bindings/types';

const KIND_WORDS: Record<string, string> = { fall: 'Falls', sos: 'SOS calls', property: 'Broken equipment' };
const COVER_WORDS: Record<string, string> = { medical_payments: 'medical payments', property: 'property' };

/** "Falls under medical payments cover". */
export function shapeWords(incidentKind: string, coverKind: string): string {
  return `${KIND_WORDS[incidentKind] ?? incidentKind} under ${COVER_WORDS[coverKind] ?? coverKind} cover`;
}

/** The proposals waiting for the organizer, oldest first. */
export function waitingProposals(conn: DbConnection): RuleProposal[] {
  return [...conn.db.boardRuleProposals.iter()].filter(p => p.status === 'proposed').sort((a, b) => Number(a.id - b.id));
}

/** Approve, with the ceiling on screen, and Reject with a reason. */
export function decideProposal(conn: DbConnection, p: RuleProposal) {
  const reject = (e: Event) => {
    e.preventDefault();
    act(() => conn.reducers.rejectRuleProposal({ proposalId: p.id, reason: field(e.target as HTMLFormElement, 'reason') }));
  };
  return h('div', {},
    h('button', { onclick: (e: Event) => { e.stopPropagation(); act(() => conn.reducers.approveRuleProposal({ proposalId: p.id, ceilingSeenCents: p.ceilingCents })); } },
      `Approve: pays up to ${money(p.ceilingCents)}`),
    h('form', { onsubmit: reject },
      h('input', { name: 'reason', placeholder: 'Reason for rejecting', required: true }),
      h('button', {}, 'Reject')));
}

/** Each cited claim as a link, with who it paid and how much. */
function claimLinks(conn: DbConnection, ids: bigint[], open: (id: bigint) => void) {
  const claims = [...conn.db.claimsBoard.iter()];
  return h('ul', {}, ids.map(id => {
    const c = claims.find(x => x.id === id);
    return h('li', {}, h('button', { class: 'link', onclick: () => open(id) }, `#${id}`), c ? ` ${c.claimantName || 'the venue'}, ${money(c.payoutCents)}` : '');
  }));
}

function proposed(conn: DbConnection, canDecide: boolean, open: (id: bigint) => void) {
  const rows = [...conn.db.boardRuleProposals.iter()].filter(p => p.status === 'proposed' || p.status === 'proposing').sort((a, b) => Number(a.id - b.id));
  return h('section', { class: rows.some(p => p.status === 'proposed') ? 'alert' : '' },
    h('h3', {}, `Proposed rules (${rows.length})`),
    !rows.length && h('p', { class: 'muted' }, 'None right now.'),
    rows.length > 0 && h('table', {},
      h('tr', {}, h('th', {}, 'Proposal'), h('th', {}, 'Precedents'), h('th', {}, 'Rule'), h('th', {}, 'Ceiling'), h('th', {}, 'Why'), h('th', {}, '')),
      rows.map(p => h('tr', {},
        h('td', {}, `#${p.id} ${shapeWords(p.incidentKind, p.coverKind)}`, h('div', { class: 'muted' }, date(p.createdAt))),
        h('td', {}, claimLinks(conn, p.claimIds, open)),
        h('td', {}, p.status === 'proposing' ? h('span', { class: 'muted' }, 'Being written') : p.rule),
        h('td', {}, p.status === 'proposed' ? money(p.ceilingCents) : '', h('div', { class: 'muted' }, `policy limit ${money(p.limitCents)}`)),
        h('td', {}, p.summary),
        h('td', {}, p.status === 'proposed' && canDecide && decideProposal(conn, p))))));
}

function rules(conn: DbConnection, open: (id: bigint) => void) {
  const rows = [...conn.db.boardRules.iter()].sort((a, b) => b.version - a.version);
  const proposals = [...conn.db.boardRuleProposals.iter()];
  const policy = conn.db.boardPolicies.iter().next().value;
  return h('section', {},
    h('h3', {}, 'Payment rules'),
    !rows.length && h('p', { class: 'muted' }, 'None yet.'),
    rows.length > 0 && h('table', {},
      h('tr', {}, h('th', {}, 'Version'), h('th', {}, 'Claims'), h('th', {}, 'Pays up to'), h('th', {}, 'Precedents'), h('th', {}, 'Approved by'), h('th', {}, 'Status')),
      rows.map(r => {
        const p = r.proposalId ? proposals.find(x => x.id === r.proposalId) : undefined;
        return h('tr', {},
          h('td', {}, `v${r.version}`), h('td', {}, shapeWords(r.incidentKind, r.coverKind)),
          h('td', {}, `${money(r.ceilingCents)}${r.requiresCorroborated ? ', corroborated only' : ''}`),
          h('td', {}, p ? claimLinks(conn, p.claimIds, open) : ''),
          h('td', {}, `${r.approverName} (${r.approverRole}), ${date(r.createdAt)}`), h('td', {}, r.status));
      })),
    policy && h('p', { class: 'muted' }, `Venue policy ${policy.policyNumber} with ${policy.insurerName}: paid out so far ${money(policy.medicalUsedCents)} for injuries and ${money(policy.propertyUsedCents)} for the venue's equipment.`));
}

function precedents(conn: DbConnection, open: (id: bigint) => void) {
  const rows = [...conn.db.boardOrganizerPrecedents.iter()].sort((a, b) => Number(b.id - a.id));
  return h('section', {},
    h('h3', {}, `Precedents (${rows.length})`),
    !rows.length && h('p', { class: 'muted' }, 'None yet.'),
    rows.length > 0 && searchable('precedents', h('table', {},
      h('tr', {}, h('th', {}, 'Claim'), h('th', {}, 'Claimant'), h('th', {}, 'Claims'), h('th', {}, 'Decision'), h('th', {}, 'Paid'), h('th', {}, 'Gap in the policy'), h('th', {}, 'Decided by'), h('th', {}, 'Proposal')),
      rows.map(p => h('tr', {},
        h('td', {}, h('button', { class: 'link', onclick: () => open(p.claimId) }, `#${p.claimId}`)),
        h('td', {}, p.claimantName || 'the venue', h('div', { class: 'muted' }, p.zoneName)),
        h('td', {}, shapeWords(p.incidentKind, p.coverKind)),
        h('td', {}, p.decision === 'approve' ? 'approved' : 'refused', p.reason && h('div', { class: 'muted' }, p.reason)),
        h('td', {}, p.decision === 'approve' ? money(p.payoutCents) : ''),
        h('td', {}, p.complications),
        h('td', {}, p.decidedByName, h('div', { class: 'muted' }, date(p.decidedAt))),
        h('td', {}, p.proposalId ? `#${p.proposalId}` : ''))))));
}

function earlier(conn: DbConnection, open: (id: bigint) => void) {
  const rows = [...conn.db.boardRuleProposals.iter()].filter(p => p.status !== 'proposed' && p.status !== 'proposing').sort((a, b) => Number(b.id - a.id));
  return rows.length > 0 && h('section', {},
    h('h3', {}, 'Earlier proposals'),
    h('table', {},
      h('tr', {}, h('th', {}, 'Proposal'), h('th', {}, 'Precedents'), h('th', {}, 'Rule'), h('th', {}, 'Ceiling'), h('th', {}, 'Outcome')),
      rows.map(p => h('tr', {},
        h('td', {}, `#${p.id} ${shapeWords(p.incidentKind, p.coverKind)}`, h('div', { class: 'muted' }, date(p.createdAt))),
        h('td', {}, claimLinks(conn, p.claimIds, open)),
        h('td', {}, p.rule, p.summary && h('div', { class: 'muted' }, p.summary)),
        h('td', {}, p.ceilingCents ? money(p.ceilingCents) : ''),
        h('td', {}, p.status === 'approved' ? `approved by ${p.decidedByName} as rule v${p.ruleVersion}` : p.status === 'rejected' ? `rejected by ${p.decidedByName}: ${p.reason}` : p.status === 'declined' ? 'no rule proposed' : p.status)))));
}

/** The Proposed rules tab. `open` shows a claim on the Settlements tab. */
export function rulesTab(conn: DbConnection, canDecide: boolean, open: (id: bigint) => void) {
  return [proposed(conn, canDecide, open), rules(conn, open), precedents(conn, open), earlier(conn, open)];
}
