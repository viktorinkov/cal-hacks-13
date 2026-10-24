// The band's tap link, /t/BANDIT-0n. During the event it is only the band setup: sign in, claim the
// band by pressing it, name, socials, the medical history and insurance PDFs, the Capital One wallet,
// then a thank-you.
// When the host ends the event, the same page turns into the recap.

import {
  act, api, apiSession, config, connect, finishSignIn, h, idToken, money, mount, playedToken, signIn, signOut,
  signedInEmail, PLATFORMS,
} from '../lib';
import { recap } from '../recap';
import type { DbConnection } from '../module_bindings';

const QUERIES = [
  'SELECT * FROM my_attendee',
  'SELECT * FROM my_band',
  'SELECT * FROM my_handles',
  'SELECT * FROM my_medical_card',
  'SELECT * FROM my_medical_documents',
  'SELECT * FROM my_visits',
  'SELECT * FROM my_encounters',
  'SELECT * FROM my_photos',
  'SELECT * FROM merch_template',
  'SELECT * FROM my_merch_orders',
  'SELECT * FROM my_merch_suggestions',
  'SELECT * FROM my_wallet_entries',
  'SELECT * FROM my_wallet',
  'SELECT * FROM event_state',
  'SELECT * FROM venue',
  'SELECT * FROM organization',
  'SELECT * FROM person',
  'SELECT * FROM claimed_people',
  'SELECT * FROM band',
];

const token = decodeURIComponent(location.pathname.split('/').pop() ?? '');
const bandId = Number(token.replace('BANDIT-', ''));

type Step = 'name' | 'socials' | 'history' | 'insurance' | 'profile' | 'card' | 'wallet' | 'done';

let conn: DbConnection;
let simulate = false;
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
      ? `Band ${bandId} is already claimed. If it is yours, ask staff at the entrance.`
      : claimError.includes('another band')
        ? 'You already wear another band.'
        : claimError.includes('wait a few seconds')
          ? 'Someone just tapped this band. Wait a few seconds and tap again.'
          : claimError;
    return [h('h2', {}, `Band ${bandId}`), h('p', {}, text), h('button', { onclick: tryClaim }, 'Try again')];
  }
  if (!waiting) {
    return [
      h('h2', {}, `Band ${bandId}`),
      h('p', {}, claimAsked ? 'No press arrived in time.' : 'Getting your band ready…'),
      claimAsked && h('button', { onclick: tryClaim }, 'Try again'),
    ];
  }
  const left = expiresAt ? Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 1000)) : 0;
  return [
    h('h2', {}, `Band ${bandId} is blinking white`),
    h('p', { class: 'big' }, 'Press the button on your band to make it yours.'),
    h('p', { class: 'muted' }, `${left} s left. ${heard ? 'Your band is being heard.' : 'Your band is not heard right now: walk toward the gateway.'}`),
    simulate && bandId >= 94 && h('button', { class: 'sim', onclick: () => act(async () => {
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
    ? 'Upload a PDF from your doctor with your allergies, conditions, medications and emergency contact. Claude reads it into your medical card. A medic sees the card only if you fall or press SOS, and only by tapping your band.'
    : 'Upload your insurance card as a PDF, front and back. It goes on the same medical card, so the medic and the clinic have it.';
  const sample = kind === 'history' ? 'medical-history.pdf' : 'insurance-card.pdf';
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
    simulate && h('button', { class: 'sim', onclick: () => act(async () => {
      await fileDocument(kind, await (await fetch(`/samples/${sample}`)).arrayBuffer());
      go(next);
    }) }, 'Use the sample PDF'),
    h('button', { class: 'link', onclick: () => go(next) }, 'Skip'),
  ];
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
    return [h('h2', {}, 'Claude is reading your documents'), h('p', { class: 'muted' }, 'This takes a few seconds.'),
      h('button', { class: 'link', onclick: () => go('wallet') }, 'Check later')];
  }
  const list = (label: string, items: string[]) => items.length > 0 && h('p', {}, h('b', {}, `${label}: `), items.join('; '));
  return [
    h('h2', {}, 'Your medical card'),
    h('p', { class: 'muted' }, 'Read by Claude from your PDFs; each item shows the page it came from.'),
    h('section', {},
      card.bloodType && card.bloodType !== 'unknown' && h('p', {}, h('b', {}, 'Blood type: '), card.bloodType),
      list('Allergies', card.allergies), list('Conditions', card.conditions), list('Medications', card.medications),
      card.emergencyContact && h('p', {}, h('b', {}, 'Emergency contact: '), card.emergencyContact),
      card.insurer && h('p', {}, h('b', {}, 'Insurance: '), `${card.insurer} ${card.plan}, member ${card.memberId}, group ${card.groupNumber}${card.insurerPhone ? `, ${card.insurerPhone}` : ''}`),
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
      h('p', { class: 'muted' }, `Capital One account ${w.accountId.slice(0, 8)}. If you get hurt here, the venue's insurance pays into it, and after the event you can buy merch with your photos from it.`),
      h('button', { onclick: () => go('done') }, 'Continue'),
    ];
  }
  if (walletAsked) {
    return [h('h2', {}, 'Connecting your Capital One wallet'), h('p', { class: 'muted' }, 'Opening your account…')];
  }
  return [
    h('h2', {}, 'Connect your Capital One wallet'),
    h('p', {}, "If you get hurt here, the venue's insurance pays into this wallet, and after the event you can buy merch made from your photos with it. It starts with $200."),
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
  ];
}

function resumeStep(): Step {
  if (!conn.db.myAttendee.iter().next().value?.displayName) return 'name';
  const docs = [...conn.db.myMedicalDocuments.iter()];
  if (!docs.some(d => d.kind === 'history')) return 'history';
  if (!docs.some(d => d.kind === 'insurance')) return 'insurance';
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

function render() {
  if (!conn) return;
  const mb = conn.db.myBand.iter().next().value;
  const ended = conn.db.eventState.id.find(0)?.ended ?? false;
  const signed = signedInEmail();
  const top = h('p', { class: 'muted top' }, signed ? `Signed in as ${signed} · ` : '', signed && h('button', { class: 'link', onclick: signOut }, 'Sign out'));
  if (mb && mb.bandId === bandId && mb.status === 'claimed') {
    if (ended) {
      return mount('app', top, recap(conn, render));
    }
    return mount('app', top, setup());
  }
  if (mb && mb.bandId !== bandId && mb.status === 'claimed') {
    return mount('app', top, h('h2', {}, `Band ${bandId}`), h('p', {}, `You wear band ${mb.bandId}.`), h('a', { href: `/t/BANDIT-${String(mb.bandId).padStart(2, '0')}` }, 'Open your band'));
  }
  const waiting = !!mb && mb.status === 'waiting_for_press' && mb.bandId === bandId;
  mount('app', top, claimScreen(waiting, mb?.expiresAt?.toDate()));
}

async function main() {
  if (location.pathname === '/callback') return finishSignIn();
  const cfg = await config();
  simulate = cfg.simulate;
  if (!bandId) return mount('app', h('h2', {}, 'Unknown band'), h('p', {}, 'This tag is not a BandIt band.'));
  const guest = sessionStorage.getItem('bandit-guest') === '1';
  if (cfg.auth_client_id && !idToken() && !(await playedToken()) && !guest) {
    return mount('app', h('h2', {}, `Band ${bandId}`), h('p', {}, 'Sign in with your email to make this band yours.'),
      h('button', { onclick: signIn }, 'Sign in with email'),
      simulate && h('button', { class: 'sim', onclick: () => { sessionStorage.setItem('bandit-guest', '1'); location.reload(); } }, 'Continue without an account'));
  }
  conn = await connect(QUERIES, render);
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
