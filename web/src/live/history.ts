// The "Decision history" panel: every row of `decision`, newest first, with who decided what and why. A row
// of an incident focuses it on the floor; a claim waiting for the organizer gets the approve button for staff.

import { complicated, h, money } from '../lib';
import { incidentState, incidentTitle } from './incidents';
import type { Claim, Decision, IncidentMarker } from './rows';

/** Each actor's chip colour. */
export const ACTOR_COLOURS: Record<string, string> = {
  band: '#60a5fa',
  camera: '#a78bfa',
  medic: '#34d399',
  organizer: '#f8fafc',
  Claude: '#e2876a',
  'Evidence Engine': '#22d3ee',
  'Decision Engine': '#f472b6',
  wallet: '#facc15',
  venue: '#94a3b8',
};
/** The panel lists at most this many rows; older ones are still in the table. */
const MAX_ROWS = 300;

export type HistoryView = {
  decisions: Decision[];
  markers: Map<bigint, IncidentMarker>;
  claims: Map<bigint, Claim>;
  focus: bigint | undefined;
  /** Whether the caller can approve this claim. */
  approves: (c: Claim) => boolean;
  onFocus: (incident: bigint | undefined) => void;
  onApprove: (c: Claim) => void;
};

/** The highest row id already shown, so new rows flash once as they arrive. */
let seen = -1n;

function clock(d: Decision) {
  return d.at.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function actorChip(actor: string, who: string) {
  const label = who && who !== actor ? `${actor} · ${who}` : actor;
  return h('span', { class: 'actor', style: `--actor:${ACTOR_COLOURS[actor] ?? '#cbd5e1'}` }, label);
}

/** Draws the panel's head and rows into `head` and `list`. */
export function drawHistory(head: HTMLElement, list: HTMLElement, v: HistoryView) {
  const rows = [...v.decisions].sort((a, b) => (b.id > a.id ? 1 : b.id < a.id ? -1 : 0)).slice(0, MAX_ROWS);
  const focused = v.focus !== undefined ? v.markers.get(v.focus) : undefined;
  const title = h('div', { class: 'history-title' }, h('h2', {}, 'Decision history'), h('span', { class: 'muted' }, `${v.decisions.length} decisions`));
  head.replaceChildren(title, ...(v.focus === undefined ? [] : [h('div', { class: 'focus' },
    h('div', {},
      h('b', {}, focused ? incidentTitle(focused) : `Incident ${v.focus}`),
      focused && h('div', { class: 'muted' }, incidentState(focused))),
    h('button', { class: 'ghost', onclick: () => v.onFocus(undefined) }, 'Show all'))]));

  // The approve button goes on the newest row of each claim that waits for the organizer.
  const waiting = new Set<bigint>();
  const fresh = seen >= 0n;
  const top = rows[0]?.id ?? seen;
  const items = rows.map(d => {
    const marker = d.incidentId ? v.markers.get(d.incidentId) : undefined;
    const claim = d.claimId ? v.claims.get(d.claimId) : undefined;
    let approve: HTMLElement | false = false;
    if (d.claimId && !waiting.has(d.claimId) && marker?.claimStatus === 'waiting for the organizer' && claim?.status.tag === 'Routed' && v.approves(claim)) {
      waiting.add(d.claimId);
      const gap = complicated(claim);
      approve = h('button', {
        class: 'approve',
        title: gap
          ? `Approves ${money(claim.payoutCents)} for ${claim.claimantName || 'the claimant'}. A gap in the policy teaches no rule: the decision is shown on the next such claim`
          : `Approves ${money(claim.payoutCents)} for ${claim.claimantName || 'the claimant'} and teaches the Decision Engine a rule for similar claims`,
        onclick: (e: Event) => { e.stopPropagation(); v.onApprove(claim); },
      }, gap ? `Approve ${money(claim.payoutCents)}` : `Approve ${money(claim.payoutCents)} and teach a rule`);
    }
    const mine = v.focus !== undefined && d.incidentId === v.focus;
    const cls = ['row', d.incidentId ? 'linked' : '', mine ? 'on' : '', v.focus !== undefined && !mine ? 'dim' : '', fresh && d.id > seen ? 'new' : ''];
    return h('li', {
      class: cls.filter(Boolean).join(' '),
      onclick: d.incidentId ? () => v.onFocus(d.incidentId === v.focus ? undefined : d.incidentId) : undefined,
    },
      h('div', { class: 'meta' }, h('time', {}, clock(d)), actorChip(d.actor, d.who)),
      h('div', { class: 'what' }, d.what),
      d.why && h('div', { class: 'why' }, d.why),
      approve);
  });
  seen = top;
  list.replaceChildren(...(items.length ? items : [h('li', { class: 'empty' }, 'No decisions yet. They appear here as the bands, the medic, the Evidence Engine, the Decision Engine and the organizer act.')]));
}
