// The band's tap link, /t/<band code> (the first stickers say /t/BANDIT-0n). During the event it is only
// the band setup: sign in, claim the band by pressing it, name, socials, the medical history and insurance
// PDFs (or the plan's name), the Capital One wallet, then a thank-you.
// When the host ends the event, or once the attendee leaves early, the same page turns into the recap.
// After a fall or a call for help, the top of the page asks what happened and asks the venue to pay, then
// shows how each claim is going until it lands in the wallet.
// Below it, any charge the organizer approved for something the wearer broke or took from the venue, to pay
// from the wallet or dispute; at the bottom, the wallet with its movements.
// Someone with the medic role who taps a band gets the medic view instead: the wearer's medical card
// for first aid.

import {
  act, actors, api, apiSession, capital, config, connect, finishSignIn, h, idToken, medicalCard, money, mount, playedToken,
  signIn, signOut, signedInEmail, testAs, time, viewing, type Actor, PLATFORMS,
} from '../lib';
import { bandCode, bandFromCode } from '../band-code';
import { movements, recap } from '../recap';
import type { DbConnection } from '../module_bindings';
import type { MyCharge } from '../module_bindings/types';

const QUERIES = [
  'SELECT * FROM my_attendee',
  'SELECT * FROM my_band',
  'SELECT * FROM my_handles',
  'SELECT * FROM my_medical_card',
  'SELECT * FROM my_medical_documents',
  'SELECT * FROM my_plan_lookups',
  'SELECT * FROM my_visits',
  'SELECT * FROM my_encounters',
  'SELECT * FROM my_photos',
  'SELECT * FROM merch_template',
  'SELECT * FROM my_merch_orders',
  'SELECT * FROM my_merch_suggestions',
  'SELECT * FROM my_wallet_entries',
  'SELECT * FROM my_wallet',
  'SELECT * FROM event_state',
  'SELECT * FROM my_departure',
  'SELECT * FROM venue',
  'SELECT * FROM organization',
  'SELECT * FROM person',
  'SELECT * FROM claimed_people',
  'SELECT * FROM my_roles',
  'SELECT * FROM open_incidents',
  'SELECT * FROM medic_medical_cards',
  'SELECT * FROM my_incidents',
  'SELECT * FROM my_claims',
  'SELECT * FROM my_charges',
];

const token = decodeURIComponent(location.pathname.split('/').pop() ?? '');
const bandId = bandFromCode(token);
const code = bandId ? bandCode(bandId) : token;

type Step = 'name' | 'socials' | 'history' | 'insurance' | 'profile' | 'card' | 'wallet' | 'done';

let conn: DbConnection;
let testMode = false;
let people: Actor[] = [];
let claimError = '';
let claimAsked = false;
let step: Step = 'name';
let session = '';

function go(next: Step) {
  step = next;
  render();
}

async function tryClaim() {
  claimAsked = true;
  claimError = '';
  try {
    await conn.reducers.claimBand({ token });
  } catch (e: any) {
    claimError = String(e?.message ?? e);
  }
  render();
}

function claimScreen(waiting: boolean, expiresAt?: Date) {
  const band = conn.db.band.id.find(bandId);
  const heard = band && band.online && Date.now() - band.lastSeen.toDate().getTime() < 5000;
  if (claimError) {
    const text = claimError.includes('belongs to someone')
      ? `Band ${code} is already claimed. If it is yours, ask staff at the entrance.`
      : claimError.includes('another band')
        ? 'You already wear another band.'
        : claimError.includes('wait a few seconds')
          ? 'Someone just tapped this band. Wait a few seconds and tap again.'
          : claimError;
    return [h('h2', {}, `Band ${code}`), h('p', {}, text), h('button', { onclick: tryClaim }, 'Try again')];
  }
  if (!waiting) {
    return [
      h('h2', {}, `Band ${code}`),
      h('p', {}, claimAsked ? 'No press arrived in time.' : 'Getting your band ready…'),
      claimAsked && h('button', { onclick: tryClaim }, 'Try again'),
    ];
  }
  const left = expiresAt ? Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 1000)) : 0;
  return [
    h('h2', {}, `Band ${code} is blinking white`),
    h('p', { class: 'big' }, 'Press the button on your band to make it yours.'),
    h('p', { class: 'muted' }, `${left} s left. ${heard ? 'Your band is being heard.' : 'Your band is not heard right now: walk toward the gateway.'}`),
    testMode && bandId >= 94 && h('button', { class: 'test', onclick: () => act(async () => {
      const res = await fetch(`/api/dev/press/${bandId}`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error);
    }) }, 'Press the band for me'),
  ];
}

function nameStep() {
  const me = conn.db.myAttendee.iter().next().value;
  const save = async (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const name = (f.elements.namedItem('name') as HTMLInputElement).value;
    const findable = (f.elements.namedItem('findable') as HTMLInputElement).checked;
    if (await act(() => conn.reducers.updateProfile({ displayName: name, findable }))) go('socials');
  };
  return [
    h('h2', {}, "It's yours"),
    h('p', {}, 'Tell people who you are.'),
    h('form', { onsubmit: save },
      h('label', {}, 'Your name', h('input', { name: 'name', value: me?.displayName || signedInEmail().split('@')[0], required: true })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'findable', checked: true }),
        'People I spend time with can see my name and socials after the event'),
      h('button', {}, 'Continue')),
  ];
}

function socialsStep() {
  const mine = new Map([...conn.db.myHandles.iter()].map(x => [x.platform, x.handle]));
  const save = async (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    for (const [platform] of PLATFORMS) {
      const handle = (f.elements.namedItem(platform) as HTMLInputElement).value.trim();
      if (handle && handle !== mine.get(platform)) {
        if (!(await act(() => conn.reducers.setSocialHandle({ platform, handle })))) return;
      }
    }
    go('history');
  };
  return [
    h('h2', {}, 'Your socials'),
    h('form', { onsubmit: save },
      PLATFORMS.map(([key, name]) => h('label', {}, name, h('input', { name: key, placeholder: '@handle', value: mine.get(key) ?? '' }))),
      h('button', {}, 'Continue')),
  ];
}

/** Uploads the PDF as this attendee's own file and asks Claude to read it into the medical card. */
async function fileDocument(kind: 'history' | 'insurance', bytes: ArrayBuffer) {
  if (!session) session = await apiSession(conn);
  const blob = await api<{ hash: string; pages: number }>(`/api/blobs?purpose=${kind}`, session, {
    method: 'POST', headers: { 'content-type': 'application/pdf' }, body: bytes,
  });
  await conn.reducers.submitMedicalDocument({ kind, fileHash: blob.hash, pageCount: blob.pages });
}

function documentStep(kind: 'history' | 'insurance', next: Step) {
  const title = kind === 'history' ? 'Your medical history' : 'Your health insurance';
  const why = kind === 'history'
    ? 'Upload a PDF from your doctor with your allergies, conditions, medications and emergency contact. It becomes your medical card, which a medic sees by tapping your band.'
    : 'Upload your insurance card as a PDF, front and back. It goes on the same medical card, so the medic and the clinic have it.';
  const testFile = kind === 'history' ? 'medical-history.pdf' : 'insurance-card.pdf';
  const upload = async (e: Event) => {
    e.preventDefault();
    const file = ((e.target as HTMLFormElement).querySelector('input[type=file]') as HTMLInputElement).files?.[0];
    if (!file) throw new Error('choose a PDF');
    await fileDocument(kind, await file.arrayBuffer());
    go(next);
  };
  return [
    h('h2', {}, title),
    h('p', {}, why),
    h('form', { onsubmit: (e: Event) => act(() => upload(e)) },
      h('label', {}, 'PDF', h('input', { type: 'file', name: kind, accept: 'application/pdf' })),
      h('button', {}, 'Upload')),
    testMode && h('button', { class: 'test', onclick: () => act(async () => {
      await fileDocument(kind, await (await fetch(`/test-records/${testFile}`)).arrayBuffer());
      go(next);
    }) }, 'Use a test record'),
    kind === 'insurance' && planLookup(next),
    h('button', { class: 'link', onclick: () => go(next) }, 'Skip'),
  ];
}

/** The latest lookup of the attendee's health plan by its name. */
function latestLookup() {
  return [...conn.db.myPlanLookups.iter()].filter(l => l.kind === 'health').sort((a, b) => Number(b.id - a.id))[0];
}

/** "Name your plan instead": the insurer and plan go to the web, and the plan's public document comes back. */
function planLookup(next: Step) {
  const l = latestLookup();
  const status = !l ? null
    : l.status === 'searching' ? h('p', { class: 'muted' }, 'Looking up your plan…')
    : l.status === 'found' ? h('p', {}, h('b', {}, 'Plan found: '),
        `${l.printedInsurer} ${l.printedPlan}${l.planYear ? ` (${l.planYear})` : ''} `, h('a', { href: l.sourceUrl, target: '_blank' }, 'read it'))
    : h('p', { class: 'error' }, "We couldn't find your plan's documents online. Upload your insurance card instead.");
  const look = async (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const v = (name: string) => (f.elements.namedItem(name) as HTMLInputElement).value;
    await conn.reducers.lookUpPlan({ insurer: v('insurer'), plan: v('plan'), state: v('state') });
    go(next);
  };
  return h('section', {},
    h('h3', {}, 'Name your plan instead'),
    status,
    h('form', { onsubmit: (e: Event) => act(() => look(e)) },
      h('label', {}, 'Insurer', h('input', { name: 'insurer', required: true, placeholder: 'Blue Shield of California' })),
      h('label', {}, 'Plan', h('input', { name: 'plan', required: true, placeholder: 'Silver 70 PPO' })),
      h('label', {}, 'State', h('input', { name: 'state', required: true, maxlength: 2, placeholder: 'CA' })),
      h('button', {}, 'Look it up')));
}

function profileMatches() {
  const me = conn.db.myAttendee.iter().next().value;
  if (!me || me.personId !== 0n) return [];
  const taken = new Set([...conn.db.claimedPeople.iter()].map(c => c.personId));
  const words = me.displayName.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  return [...conn.db.person.iter()].filter(p => !taken.has(p.id) && words.some(w => p.displayName.toLowerCase().includes(w)));
}

function profileStep() {
  const matches = profileMatches();
  if (!matches.length) {
    step = 'card';
    return cardStep();
  }
  return [
    h('h2', {}, 'Are you one of these?'),
    h('p', { class: 'muted' }, 'From the event pages.'),
    h('ul', { class: 'cards' }, matches.map(p => {
      const org = conn.db.organization.id.find(p.organizationId);
      return h('li', {},
        h('b', {}, p.displayName), ` ${[p.title, org?.name].filter(Boolean).join(', ')} (${p.kind})`,
        h('button', { onclick: () => act(() => conn.reducers.claimPerson({ personId: p.id })).then(() => go('card')) }, 'This is me'));
    })),
    h('button', { class: 'link', onclick: () => go('card') }, 'None of these'),
  ];
}

/** What Claude read, for the wearer to check once. */
function cardStep() {
  const docs = [...conn.db.myMedicalDocuments.iter()];
  if (!docs.length) {
    step = 'wallet';
    return walletStep();
  }
  const reading = docs.filter(d => d.status === 'reading');
  const card = conn.db.myMedicalCard.iter().next().value;
  if (reading.length || !card) {
    return [h('h2', {}, 'Reading your documents'), h('p', { class: 'muted' }, 'This takes a few seconds.'),
      h('button', { class: 'link', onclick: () => go('wallet') }, 'Check later')];
  }
  const list = (label: string, items: string[]) => items.length > 0 && h('p', {}, h('b', {}, `${label}: `), items.join('; '));
  return [
    h('h2', {}, 'Your medical card'),
    h('p', { class: 'muted' }, 'Read from your PDFs; each item shows the page it came from.'),
    h('section', {},
      card.bloodType && card.bloodType !== 'unknown' && h('p', {}, h('b', {}, 'Blood type: '), card.bloodType),
      list('Allergies', card.allergies), list('Conditions', card.conditions), list('Medications', card.medications),
      card.emergencyContact && h('p', {}, h('b', {}, 'Emergency contact: '), card.emergencyContact),
      card.insurer && h('p', {}, h('b', {}, 'Insurance: '), [`${card.insurer} ${card.plan}`, card.memberId && `member ${card.memberId}`, card.groupNumber && `group ${card.groupNumber}`, card.insurerPhone].filter(Boolean).join(', ')),
      docs.some(d => d.status === 'failed') && h('p', { class: 'error' }, 'One document could not be read.')),
    h('button', { onclick: () => act(() => conn.reducers.confirmMedicalCard({})).then(ok => ok && go('wallet')) }, 'Looks right'),
  ];
}

let walletAsked = false;

/** The Capital One wallet: claim payouts land in it, and merch after the event is paid from it. */
function walletStep() {
  const w = conn.db.myWallet.iter().next().value;
  if (w) {
    return [
      h('h2', {}, 'Your wallet is connected'),
      h('p', { class: 'big' }, `${money(w.balanceCents)} in your BandIt wallet`),
      h('p', { class: 'muted' }, `Capital One account ${w.accountId.slice(0, 8)}. If you get hurt here, the venue pays your treatment into it, and after the event you can buy merch with your photos from it.`),
      h('button', { onclick: () => go('done') }, 'Continue'),
    ];
  }
  if (walletAsked) {
    return [h('h2', {}, 'Connecting your Capital One wallet'), h('p', { class: 'muted' }, 'Opening your account…')];
  }
  return [
    h('h2', {}, 'Connect your Capital One wallet'),
    h('p', {}, "If you get hurt here, the venue pays your treatment into this wallet, and after the event you can buy merch made from your photos with it. It starts with $200."),
    h('button', { onclick: () => act(() => conn.reducers.connectWallet({})).then(ok => { if (ok) { walletAsked = true; render(); } }) }, 'Connect'),
    h('button', { class: 'link', onclick: () => go('done') }, 'Skip'),
  ];
}

function thanks() {
  const v = conn.db.venue.iter().next().value;
  return [
    h('h2', {}, "You're all set"),
    h('p', { class: 'big' }, `Thanks, ${conn.db.myAttendee.iter().next().value?.displayName ?? ''}. Enjoy ${v?.name ?? 'the event'}.`),
    h('p', {}, 'Keep your band on. After the event, tap it again for your recap: where you went, who you spent time with, and your photos.'),
    !viewing() && h('button', { onclick: () => confirm('Leave the event now? Your band stops and your recap opens.') && act(() => conn.reducers.leaveEvent({})) }, 'Leave the event'),
  ];
}

function resumeStep(): Step {
  if (!conn.db.myAttendee.iter().next().value?.displayName) return 'name';
  const docs = [...conn.db.myMedicalDocuments.iter()];
  if (!docs.some(d => d.kind === 'history')) return 'history';
  if (!docs.some(d => d.kind === 'insurance') && !latestLookup()) return 'insurance';
  if (conn.db.myMedicalCard.iter().next().value?.status !== 'confirmed') return 'card';
  if (!conn.db.myWallet.iter().next().value) return 'wallet';
  return 'done';
}

function setup() {
  switch (step) {
    case 'name': return nameStep();
    case 'socials': return socialsStep();
    case 'history': return documentStep('history', 'insurance');
    case 'insurance': return documentStep('insurance', 'profile');
    case 'profile': return profileStep();
    case 'card': return cardStep();
    case 'wallet': return walletStep();
    default: return thanks();
  }
}

// --- Claims ---------------------------------------------------------------------------------

/** What a claim's status means for the attendee, in plain words. */
function claimStatus(tag: string, payoutCents: bigint): string {
  switch (tag) {
    case 'AwaitingRecord': return 'Waiting for the hospital report';
    case 'ReadingRecord': case 'Verifying': case 'Reviewing': return 'Being reviewed';
    case 'Routed': return 'Waiting for the organizer to approve the payment';
    case 'Paying': return 'Approved, paying into your wallet';
    case 'Settled': case 'Reconciled': return `Paid ${money(payoutCents)} into your wallet`;
    case 'Refused': return 'Not paid. The organizer can tell you why.';
    default: return 'Being reviewed';
  }
}

const KIND_WORDS: Record<string, string> = {
  fall: 'a fall',
  sos: 'a call for help',
};

/** After a fall or a call for help: ask the venue to pay, in your own words. Then each of the attendee's own
 *  claims, all of them injuries, followed to the wallet. */
function claims() {
  const open = [...conn.db.myIncidents.iter()].filter(i => i.resolved && i.claimId === 0n).sort((a, b) => Number(a.incidentId - b.incidentId));
  const mine = [...conn.db.myClaims.iter()].sort((a, b) => Number(a.id - b.id));
  const file = (incidentId: bigint) => async (e: Event) => {
    e.preventDefault();
    const statement = ((e.target as HTMLFormElement).elements.namedItem(`statement-${incidentId}`) as HTMLTextAreaElement).value.trim();
    await act(() => conn.reducers.fileClaim({ incidentId, statement }));
  };
  return [
    open.length > 0 && h('section', {},
      h('h3', {}, 'Hurt at the event?'),
      open.map(i => h('form', { onsubmit: file(i.incidentId) },
        h('p', {}, `Your band flagged ${KIND_WORDS[i.kind] ?? 'an alert'} at the ${i.zoneName} at ${time(i.openedAt)}. If you were hurt, tell us what happened and the venue pays your treatment into your wallet.`),
        h('textarea', { name: `statement-${i.incidentId}`, rows: 4, required: true, placeholder: 'Tell us what happened…' }),
        h('button', {}, 'Ask the venue to pay')))),
    mine.length > 0 && h('section', {},
      h('h3', {}, mine.length > 1 ? 'Your claims' : 'Your claim'),
      mine.map(c => h('div', {},
        h('p', { class: 'big' }, claimStatus(c.status.tag, c.payoutCents)),
        h('p', { class: 'muted' }, `Claim ${c.id}, for ${KIND_WORDS[c.incidentKind] ?? 'an injury'} at the ${c.zoneName}, filed ${time(c.openedAt)}.`),
        c.statement && h('p', {}, `You said: "${c.statement}"`)))),
  ];
}

/** What a charge is for, at the start of its receipt. */
const CHARGE_WHAT: Record<string, string> = {
  property: 'Venue equipment broken',
  theft: 'Taken from the venue',
  breakage: 'Venue equipment broken',
};

function chargeStatus(c: MyCharge): string {
  switch (c.status) {
    case 'approved': return 'To pay. Nothing leaves your wallet until you press pay.';
    case 'paying': return 'Paying from your wallet…';
    case 'paid': return `Paid from your wallet${c.paidAt ? ` at ${time(c.paidAt)}` : ''}.`;
    case 'disputed': return 'Disputed. The organizer looks at it again.';
    case 'waived': return 'Waived. You owe nothing.';
    default: return c.status;
  }
}

/** Charges the organizer approved for something the attendee broke or took from the venue, each like a receipt:
 *  pay it from the wallet or dispute it in their own words. */
function charges() {
  const mine = [...conn.db.myCharges.iter()].sort((a, b) => Number(b.id - a.id));
  const dispute = (chargeId: bigint) => async (e: Event) => {
    e.preventDefault();
    const text = ((e.target as HTMLFormElement).elements.namedItem(`dispute-${chargeId}`) as HTMLTextAreaElement).value.trim();
    await act(() => conn.reducers.disputeCharge({ chargeId, text }));
  };
  return mine.length > 0 && h('section', {},
    h('h3', {}, 'Your charges'),
    mine.map(c => h('div', {},
      h('p', { class: 'big' }, `${CHARGE_WHAT[c.incidentKind] ?? 'Broken or taken from the venue'} at the ${c.zoneName}, ${time(c.happenedAt)}. ${money(c.amountCents)}.`),
      c.why && h('p', {}, `Why: ${c.why.replace(/\.$/, '')}.`),
      c.clause && h('p', {}, `${capital(c.clause.replace(/\.$/, ''))}.`),
      h('p', {}, h('b', {}, chargeStatus(c))),
      c.disputeText && h('p', {}, `You said: "${c.disputeText}"`),
      c.status === 'approved' && [
        h('button', { onclick: () => act(() => conn.reducers.payCharge({ chargeId: c.id })) }, 'Pay from wallet'),
        h('form', { onsubmit: dispute(c.id) },
          h('label', {}, 'Not you, or not right? Say why in your own words',
            h('textarea', { name: `dispute-${c.id}`, rows: 3, required: true, placeholder: 'What happened…' })),
          h('button', {}, 'Dispute'))])));
}

/** The wallet and its movements during the event. The recap shows the wallet after it. */
function wallet(ended: boolean) {
  const w = conn.db.myWallet.iter().next().value;
  if (!w || ended || step === 'wallet') return null;
  return h('section', {},
    h('h3', {}, 'Your wallet'),
    h('p', { class: 'big' }, `${money(w.balanceCents)} in your BandIt wallet`, h('span', { class: 'muted' }, ` · Capital One account ${w.accountId.slice(0, 8)}`)),
    movements(conn));
}

// --- Medic view -------------------------------------------------------------------------------

function isMedic(): boolean {
  return [...conn.db.myRoles.iter()].some(r => r.role === 'medic');
}

/** `asking` until the module answers the tap, then `granted` or the reason it refused. */
let tap = 'asking';

/** The medic's tap: the module checks the role and logs the read. */
async function tapAsMedic() {
  tap = 'asking';
  try {
    await conn.reducers.requestMedicalCard({ bandId });
    tap = 'granted';
  } catch (e: any) {
    tap = String(e?.message ?? e);
  }
  render();
}

function medicView() {
  const m = [...conn.db.medicMedicalCards.iter()].filter(c => c.bandId === bandId).pop();
  const incident = [...conn.db.openIncidents.iter()].find(i => i.subjectBand === bandId && ['Sos', 'Fall'].includes(i.kind.tag));
  const title = h('h2', {}, `Medic view: band ${code}`);
  const again = h('button', { class: 'link', onclick: tapAsMedic }, 'Tap again');
  if (m) {
    return [
      title,
      incident && [
        h('p', {}, `${incident.kind.tag} incident ${incident.id}, ${incident.status.tag.toLowerCase()}, opened ${time(incident.openedAt)} by ${incident.openedBy}.`),
        incident.status.tag === 'Open' && h('button', { onclick: () => act(() => conn.reducers.assignMedic({ incidentId: incident.id })) }, 'Take it'),
      ],
      medicalCard(m),
      incident && h('p', {}, h('a', { href: `/organizer${location.search}#claims` }, 'Notes, cost and resolve on the incident desk')),
    ];
  }
  if (tap === 'asking' || tap === 'granted') return [title, h('p', { class: 'muted' }, 'Opening the medical card…')];
  if (tap.includes('nobody wears')) return [title, h('p', {}, `Nobody wears band ${code}.`), again];
  return [title, h('p', { class: 'error' }, tap), again];
}

// --- View as -------------------------------------------------------------------------------

/** The screen the organizer's View as frame picked by its hash: the medical card or the recap. */
function viewedScreen() {
  const screen = location.hash.slice(1);
  if (screen === 'card') {
    const me = conn.db.myAttendee.iter().next().value;
    return medicalCard({ incidentId: 0n, bandId, name: me?.displayName ?? '', card: conn.db.myMedicalCard.iter().next().value });
  }
  return screen === 'recap' ? recap(conn, render) : null;
}

function render() {
  // While someone types what happened, the page holds still so the phone keeps its keyboard up.
  if (!conn || document.activeElement instanceof HTMLTextAreaElement) return;
  const mb = conn.db.myBand.iter().next().value;
  // The event is over for an attendee once it ends, or once they walked out early.
  const ended = (conn.db.eventState.id.find(0)?.ended ?? false) || !!conn.db.myDeparture.iter().next().value?.leftAt;
  const signed = signedInEmail();
  const top = h('p', { class: 'muted top' }, signed ? `Signed in as ${signed} · ` : '', signed && h('button', { class: 'link', onclick: signOut }, 'Sign out'),
    testMode && !viewing() && people.length > 0 && testAs(people));
  if (isMedic()) return mount('app', top, medicView());
  // The View as frame also shows a crowd attendee, who wears a band without tapping it.
  const wears = mb && mb.bandId === bandId && mb.status === 'claimed';
  if (wears || (viewing() && conn.db.myAttendee.count() > 0)) {
    const screen = viewing() && viewedScreen();
    // The recap shows the wallet itself.
    if (screen) return mount('app', top, claims(), charges(), screen, wallet(ended || location.hash === '#recap'));
    if (ended) {
      return mount('app', top, claims(), charges(), recap(conn, render), wallet(ended));
    }
    // The setup first: it can move on a step, and the wallet's balance shows once, on the wallet step or below.
    const steps = setup();
    return mount('app', top, claims(), charges(), steps, wallet(ended));
  }
  if (mb && mb.bandId !== bandId && mb.status === 'claimed') {
    return mount('app', top, h('h2', {}, `Band ${code}`), h('p', {}, `You wear band ${bandCode(mb.bandId)}.`), h('a', { href: `/t/${bandCode(mb.bandId)}` }, 'Open your band'));
  }
  const waiting = !!mb && mb.status === 'waiting_for_press' && mb.bandId === bandId;
  mount('app', top, claimScreen(waiting, mb?.expiresAt?.toDate()));
}

async function main() {
  if (location.pathname === '/callback') return finishSignIn();
  const cfg = await config();
  testMode = cfg.test_mode;
  if (!bandId) return mount('app', h('h2', {}, 'Unknown band'), h('p', {}, 'This tag is not a BandIt band.'));
  const guest = sessionStorage.getItem('bandit-guest') === '1';
  if (cfg.auth_client_id && !idToken() && !(await playedToken()) && !guest && !viewing()) {
    return mount('app', h('h2', {}, `Band ${code}`), h('p', {}, 'Sign in with your email to make this band yours.'),
      h('button', { onclick: signIn }, 'Sign in with email'),
      testMode && h('button', { class: 'test', onclick: () => { sessionStorage.setItem('bandit-guest', '1'); location.reload(); } }, 'Continue without an account'));
  }
  if (testMode) people = await actors();
  conn = await connect([...QUERIES, `SELECT * FROM band WHERE id = ${bandId}`], render);
  // The View as frame only reads: it never taps, claims or opens a card, and its hash picks the screen.
  if (viewing()) {
    step = resumeStep();
    window.addEventListener('hashchange', render);
    return render();
  }
  // A medic's tap opens the medical card; it never claims the band.
  if (isMedic()) return tapAsMedic();
  const mb = conn.db.myBand.iter().next().value;
  if (!mb || (mb.bandId === bandId && mb.status !== 'claimed')) await tryClaim();
  // Someone who reloads mid-setup picks up at the first step they have not finished.
  step = resumeStep();
  // The claim countdown ticks every second until the band is claimed.
  setInterval(() => {
    const claimed = conn.db.myBand.iter().next().value?.status === 'claimed';
    if (!claimed) render();
  }, 1000);
}

main().catch(e => mount('app', h('p', { class: 'error' }, String(e?.message ?? e))));
