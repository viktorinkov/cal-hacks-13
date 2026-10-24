// The band's tap link, /t/BANDIT-0n. Sign in, claim the band by pressing it, fill the profile,
// then the live view of the event. When the host ends the event, the same page turns into the recap.

import {
  act, api, apiSession, config, connect, finishSignIn, h, idToken, money, mount, playedToken, risk, signIn,
  signOut, signedInEmail, handleLinks, BAND_STATES, EXIT_COLOURS, PLATFORMS,
} from '../lib';
import { recap, wallet, type Recap } from '../recap';
import type { DbConnection } from '../module_bindings';

const QUERIES = [
  'SELECT * FROM my_attendee',
  'SELECT * FROM my_band',
  'SELECT * FROM my_handles',
  'SELECT * FROM my_visits',
  'SELECT * FROM my_encounters',
  'SELECT * FROM my_photos',
  'SELECT * FROM my_claims',
  'SELECT * FROM merch_template',
  'SELECT * FROM my_merch_orders',
  'SELECT * FROM my_merch_suggestions',
  'SELECT * FROM my_wallet_entries',
  'SELECT * FROM my_wallet',
  'SELECT * FROM event_state',
  'SELECT * FROM venue',
  'SELECT * FROM zone',
  'SELECT * FROM booth',
  'SELECT * FROM organization',
  'SELECT * FROM person',
  'SELECT * FROM claimed_people',
  'SELECT * FROM settings',
  'SELECT * FROM band',
  'SELECT * FROM zone_visit',
];

const token = decodeURIComponent(location.pathname.split('/').pop() ?? '');
const bandId = Number(token.replace('BANDIT-', ''));

let conn: DbConnection;
let demo = false;
/** Where this page is in the claim: before the tap, refused, or after a refusal message. */
let claimError = '';
let claimAsked = false;
/** Onboarding steps after the name: socials, then "is this you?". */
let step: 'name' | 'socials' | 'profile' | 'done' = 'name';
let session = '';
let recapData: Recap | undefined;
let recapLoading = false;

function zoneOfStation(station: number) {
  return [...conn.db.zone.iter()].find(z => z.stationId === station);
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
    demo && bandId >= 94 && h('button', { class: 'demo', onclick: () => act(async () => {
      const res = await fetch(`/api/dev/press/${bandId}`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error);
    }) }, 'Demo: press the band for me'),
  ];
}

function onboarding() {
  const me = conn.db.myAttendee.iter().next().value;
  if (step === 'name') {
    const save = async (e: Event) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const name = (f.elements.namedItem('name') as HTMLInputElement).value;
      const findable = (f.elements.namedItem('findable') as HTMLInputElement).checked;
      if (await act(() => conn.reducers.updateProfile({ displayName: name, findable }))) {
        step = 'socials';
        render();
      }
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
  if (step === 'socials') {
    return [h('h2', {}, 'Your socials'), socialsForm(() => { step = 'profile'; render(); }, 'Continue')];
  }
  const matches = profileMatches();
  if (step === 'profile' && matches.length) {
    return [h('h2', {}, 'Are you one of these?'), h('p', { class: 'muted' }, 'From the event pages.'), profileList(matches),
      h('button', { class: 'link', onclick: () => { step = 'done'; render(); } }, 'None of these')];
  }
  step = 'done';
  return home();
}

function socialsForm(after: () => void, label: string) {
  const mine = new Map([...conn.db.myHandles.iter()].map(x => [x.platform, x.handle]));
  const save = async (e: Event) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    for (const [platform] of PLATFORMS) {
      const handle = (f.elements.namedItem(platform) as HTMLInputElement).value.trim();
      if (handle && handle !== mine.get(platform)) {
        if (!(await act(() => conn.reducers.setSocialHandle({ platform, handle })))) return;
      }
      if (!handle && mine.has(platform)) {
        if (!(await act(() => conn.reducers.removeSocialHandle({ platform })))) return;
      }
    }
    after();
  };
  return h('form', { onsubmit: save },
    PLATFORMS.map(([key, name]) => h('label', {}, name, h('input', { name: key, placeholder: '@handle', value: mine.get(key) ?? '' }))),
    h('button', {}, label));
}

function profileMatches() {
  const me = conn.db.myAttendee.iter().next().value;
  if (!me || me.personId !== 0n) return [];
  const taken = new Set([...conn.db.claimedPeople.iter()].map(c => c.personId));
  const words = me.displayName.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  return [...conn.db.person.iter()].filter(p => !taken.has(p.id) && words.some(w => p.displayName.toLowerCase().includes(w)));
}

function profileList(people: ReturnType<typeof profileMatches>) {
  return h('ul', { class: 'cards' }, people.map(p => {
    const org = conn.db.organization.id.find(p.organizationId);
    return h('li', {},
      h('b', {}, p.displayName), ` ${p.title ? p.title + ', ' : ''}${org?.name ?? ''} (${p.kind})`,
      h('button', { onclick: () => act(() => conn.reducers.claimPerson({ personId: p.id })).then(() => { step = 'done'; render(); }) }, 'This is me'));
  }));
}

function bandCard() {
  const band = conn.db.band.id.find(bandId);
  const settings = conn.db.settings.iter().next().value;
  if (!band) return h('section', { class: 'card grey' }, h('h3', {}, `Band ${bandId}`), h('p', {}, 'Not heard yet.'));
  const stale = !band.online || Date.now() - band.lastSeen.toDate().getTime() > 5000;
  const [colour, text] = BAND_STATES[band.state] ?? ['grey', ''];
  const zone = zoneOfStation(band.zone);
  const exit = zone ? EXIT_COLOURS[zone.exitColour] : '';
  const say = band.state === 2 && exit ? `Move out: follow the ${exit} lights` : text;
  const claim = [...conn.db.myClaims.iter()][0];
  return h('section', { class: `card ${stale ? 'grey' : ''}` },
    h('h3', {}, `Band ${bandId}`, h('span', { class: `chip ${stale ? 'grey' : colour}` }, stale ? 'not heard' : say)),
    h('p', {}, zone ? `Near ${zone.name}` : 'No zone yet', band.bat !== 255 ? ` · battery ${band.bat}%` : ''),
    band.state === 3 && claim && h('p', {}, `Claim: ${claim.status.tag}`),
    settings && h('p', { class: 'muted' }, `Band density limits: busy at ${settings.yellow}, very busy at ${settings.red} people close by.`),
    demo && bandId >= 94 && h('p', { class: 'demo' }, 'Demo: walk your band to ',
      [...conn.db.zone.iter()].sort((a, b) => a.stationId - b.stationId).map(z =>
        h('button', { class: 'demo', disabled: z.stationId === band.zone || undefined, onclick: () => act(async () => {
          const res = await fetch(`/api/dev/move/${bandId}/${z.stationId}`, { method: 'POST' });
          if (!res.ok) throw new Error((await res.json()).error);
        }) }, z.name))));
}

function venue() {
  const settings = conn.db.settings.iter().next().value;
  const bands = [...conn.db.band.iter()].filter(b => b.online);
  const inside = [...conn.db.zoneVisit.iter()].filter(v => v.left === undefined);
  const zones = [...conn.db.zone.iter()].sort((a, b) => a.stationId - b.stationId);
  return h('section', {},
    h('h3', {}, 'How busy is it'),
    h('table', {}, zones.map(z => {
      const here = bands.filter(b => b.zone === z.stationId);
      const avg = here.length ? here.reduce((s, b) => s + b.neigh, 0) / here.length : 0;
      const level = risk(avg, settings?.yellow ?? 3, settings?.red ?? 5);
      return h('tr', {}, h('td', {}, z.name), h('td', {}, `${inside.filter(v => v.zone === z.stationId).length} people`),
        h('td', { class: `level ${level.replace(' ', '-')}` }, level),
        h('td', { class: 'muted' }, `exit: ${EXIT_COLOURS[z.exitColour]}`));
    })));
}

function claims() {
  const mine = [...conn.db.myClaims.iter()];
  if (!mine.length) return null;
  return h('section', {},
    h('h3', {}, 'Your insurance claims'),
    h('ul', {}, mine.map(c => h('li', {},
      h('b', {}, `Claim ${c.id}`), ` ${c.incidentKind} in ${c.zoneName}: ${c.status.tag}. ${c.statusNote}`,
      c.payoutCents > 0n && ` Payout ${money(c.payoutCents)}${c.payoutReference ? ` (${c.payoutReference})` : ''}.`))));
}

function profile() {
  const me = conn.db.myAttendee.iter().next().value!;
  const org = conn.db.organization.id.find(me.organizationId);
  return h('section', {},
    h('h3', {}, 'Profile'),
    h('p', {}, h('b', {}, me.displayName), org ? ` · ${org.name}` : '', me.findable ? ' · findable' : ' · hidden'),
    h('p', {}, handleLinks([...conn.db.myHandles.iter()])),
    h('details', {}, h('summary', {}, 'Edit socials'), socialsForm(() => render(), 'Save')),
    profileMatches().length > 0 && h('details', {}, h('summary', {}, 'Claim your speaker or exhibitor profile'), profileList(profileMatches())));
}

function home() {
  const v = conn.db.venue.iter().next().value;
  return [
    h('h2', {}, v?.name ?? 'Your event'),
    bandCard(),
    venue(),
    claims(),
    wallet(conn),
    profile(),
  ];
}

async function loadRecap() {
  if (recapLoading || recapData) return;
  recapLoading = true;
  try {
    if (!session) session = await apiSession(conn);
    recapData = await api<Recap>('/api/recap', session);
  } catch (e: any) {
    document.getElementById('error')!.textContent = `Recap ranking: ${e?.message ?? e}`;
  }
  recapLoading = false;
  render();
}

function render() {
  if (!conn) return;
  const mb = conn.db.myBand.iter().next().value;
  const me = conn.db.myAttendee.iter().next().value;
  const ended = conn.db.eventState.id.find(0)?.ended ?? false;
  const signed = signedInEmail();
  const top = h('p', { class: 'muted top' }, signed ? `Signed in as ${signed} · ` : '', signed && h('button', { class: 'link', onclick: signOut }, 'Sign out'));
  if (mb && mb.bandId === bandId && mb.status === 'claimed') {
    if (ended) {
      loadRecap();
      return mount('app', top, recap(conn, recapData));
    }
    if (!me?.displayName || step !== 'done') return mount('app', top, onboarding());
    return mount('app', top, home());
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
  demo = cfg.demo;
  if (!bandId) return mount('app', h('h2', {}, 'Unknown band'), h('p', {}, 'This tag is not a BandIt band.'));
  if (cfg.auth_client_id && !idToken() && !(await playedToken())) {
    return mount('app', h('h2', {}, `Band ${bandId}`), h('p', {}, 'Sign in with your email to make this band yours.'),
      h('button', { onclick: signIn }, 'Sign in with email'));
  }
  conn = await connect(QUERIES, render);
  const mb = conn.db.myBand.iter().next().value;
  if (!mb || (mb.bandId === bandId && mb.status !== 'claimed')) await tryClaim();
  if (conn.db.myAttendee.iter().next().value?.displayName) step = 'done';
  // The live view ages the band card every second; the recap only changes with its rows.
  setInterval(() => {
    const ended = conn.db.eventState.id.find(0)?.ended ?? false;
    if (!ended && !(document.activeElement instanceof HTMLInputElement)) render();
  }, 1000);
}

main().catch(e => mount('app', h('p', { class: 'error' }, String(e?.message ?? e))));
