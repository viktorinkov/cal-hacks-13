// Shared code for the BandIt pages: settings from bandit-api, SpacetimeAuth sign-in, the
// SpacetimeDB connection, and tiny DOM helpers. Every screen is a subscription; every change is a
// reducer call.

import { Identity, Timestamp } from 'spacetimedb';
import { DbConnection } from './module_bindings';
import type { Band, MedicCard } from './module_bindings/types';
import { bandCode } from './band-code';

export type Config = {
  spacetimedb_url: string;
  database: string;
  kibana_url: string;
  auth_client_id: string;
  test_mode: boolean;
};

export type Actor = { name: string; label: string; token: string };

let configCache: Config | undefined;

export async function config(): Promise<Config> {
  if (!configCache) configCache = await (await fetch('/config.json')).json();
  return configCache!;
}

// --- SpacetimeAuth (OpenID Connect, code flow with PKCE) -------------------------------------

const AUTHORITY = 'https://auth.spacetimedb.com/oidc';
const ID_TOKEN_KEY = 'bandit-id-token';

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

function jwtClaims(token: string): Record<string, any> {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

/** The signed-in person's ID token, if it is still valid. */
export function idToken(): string | undefined {
  const token = localStorage.getItem(ID_TOKEN_KEY) ?? undefined;
  if (!token) return undefined;
  const exp = jwtClaims(token).exp;
  return exp && exp * 1000 > Date.now() + 60_000 ? token : undefined;
}

export function signedInEmail(): string {
  const token = viewing() ? undefined : idToken();
  return token ? jwtClaims(token).email ?? '' : '';
}

export async function signIn(): Promise<void> {
  const cfg = await config();
  const verifier = randomString();
  const state = randomString();
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  sessionStorage.setItem('bandit-oidc', JSON.stringify({ verifier, state, back: location.pathname + location.search }));
  const params = new URLSearchParams({
    client_id: cfg.auth_client_id,
    redirect_uri: `${location.origin}/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  location.href = `${AUTHORITY}/auth?${params}`;
}

export function signOut(): void {
  localStorage.removeItem(ID_TOKEN_KEY);
  location.reload();
}

/** Handles /callback: trades the code for the ID token and goes back to the page that asked. */
export async function finishSignIn(): Promise<void> {
  const cfg = await config();
  const query = new URLSearchParams(location.search);
  const saved = JSON.parse(sessionStorage.getItem('bandit-oidc') ?? '{}');
  if (!query.get('code') || query.get('state') !== saved.state) throw new Error('sign-in did not complete');
  const res = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: query.get('code')!,
      redirect_uri: `${location.origin}/callback`,
      client_id: cfg.auth_client_id,
      code_verifier: saved.verifier,
    }),
  });
  const body = await res.json();
  if (!body.id_token) throw new Error(`sign-in failed: ${JSON.stringify(body)}`);
  localStorage.setItem(ID_TOKEN_KEY, body.id_token);
  sessionStorage.removeItem('bandit-oidc');
  location.replace(saved.back || '/');
}

// --- Test identities ------------------------------------------------------------------------

/** With BANDIT_TEST_MODE=1, the people `bandit-claims setup` created, so one browser can play each. */
export async function actors(): Promise<Actor[]> {
  const res = await fetch('/api/actors');
  return res.ok ? res.json() : [];
}

/** The "Test as" switcher: reloads the page as the chosen person (`?as=name`). */
export function testAs(people: Actor[]): HTMLElement {
  const as = new URLSearchParams(location.search).get('as') ?? '';
  return h('label', { class: 'check' }, 'Test as',
    h('select', { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; location.search = v ? `?as=${v}` : ''; } },
      h('option', { value: '' }, 'myself'),
      people.map(p => h('option', { value: p.name, selected: p.name === as || undefined }, p.label))));
}

/** The token of the person this browser plays (`?as=name`), when the switcher is on. */
export async function playedToken(): Promise<string | undefined> {
  const as = new URLSearchParams(location.search).get('as');
  if (!as) return undefined;
  return (await actors()).find(a => a.name === as)?.token;
}

// --- View as -------------------------------------------------------------------------------

/** The person the owner's View as tab shows this page for (`?view=<identity>`), else ''. */
export function viewing(): string {
  return new URLSearchParams(location.search).get('view') ?? '';
}

/**
 * Points this page's viewer, a fresh identity kept for the browser tab, at the person through the
 * nearest owner page around it (see view-as.ts): the module then answers every view for them.
 */
async function pointViewer(viewer: string, person: string): Promise<void> {
  let w: Window = window.parent;
  while (!(w as any).banditViewAs && w !== w.parent) w = w.parent;
  const viewAs = (w as any).banditViewAs;
  if (!viewAs) throw new Error("Open this page from the organizer portal's View as tab.");
  await viewAs(viewer, person);
}

// --- Connection -----------------------------------------------------------------------------

/**
 * Connects as the played person, else the signed-in person, else the identity kept in this
 * browser, and resolves once `queries` have arrived. `onChange` runs after every change to them.
 * In the View as frame it connects as the tab's viewer instead, read-only.
 */
export async function connect(queries: string[], onChange: () => void): Promise<DbConnection> {
  const cfg = await config();
  const played = await playedToken();
  const view = viewing();
  // One kept identity per database, so a local test run never clashes with Maincloud.
  const storeKey = `bandit-token:${cfg.database}`;
  const viewerKey = `bandit-viewer:${cfg.database}`;
  const stored = localStorage.getItem(storeKey) ?? localStorage.getItem('bandit-token') ?? undefined;
  const token = view ? sessionStorage.getItem(viewerKey) ?? undefined : played ?? idToken() ?? stored;
  if (view) document.body.classList.add('viewing');
  const open = (token: string | undefined) => new Promise<DbConnection>((resolve, reject) => {
    DbConnection.builder()
      .withUri(cfg.spacetimedb_url)
      .withDatabaseName(cfg.database)
      .withToken(token)
      .onConnect((c, identity, newToken) => {
        if (view) sessionStorage.setItem(viewerKey, newToken);
        else if (!played && !idToken()) localStorage.setItem(storeKey, newToken);
        const subscribe = () => c.subscriptionBuilder()
          .onApplied(() => {
            watch(c, onChange);
            (window as any).bandit = c;
            resolve(c);
            setTimeout(onChange, 0);
          })
          .onError(ctx => reject((ctx as any).event ?? new Error('subscription failed')))
          .subscribe(queries);
        if (view) pointViewer(identity.toHexString(), view).then(subscribe, reject);
        else subscribe();
      })
      .onConnectError((_ctx, e) => reject(e))
      // A lost connection (a module update, a network drop) never comes back on its own: the page reloads.
      .onDisconnect(() => setTimeout(() => location.reload(), 3000))
      .build();
  });
  try {
    return await open(token);
  } catch (e) {
    // A kept identity from another server is refused; start a fresh one.
    if (token !== stored || !stored) throw e;
    localStorage.removeItem(storeKey);
    localStorage.removeItem('bandit-token');
    return open(undefined);
  }
}

/** Pages redraw at most this often, however many rows change: a crowd of a thousand bands changes many. */
const REDRAW_GAP_MS = 500;

/** Calls `onChange` (batched) after any row of any table changes. */
function watch(conn: DbConnection, onChange: () => void) {
  let queued = false;
  let last = 0;
  const kick = () => {
    if (queued) return;
    queued = true;
    // A timer, not an animation frame: frames stop in a background tab and the page would go stale.
    setTimeout(() => {
      queued = false;
      last = Date.now();
      onChange();
    }, Math.max(30, last + REDRAW_GAP_MS - Date.now()));
  };
  for (const table of Object.values(conn.db as Record<string, any>)) {
    if (table && typeof table.onInsert === 'function') {
      table.onInsert(kick);
      table.onDelete(kick);
      table.onUpdate?.(kick);
    }
  }
}

/** The bands by id, kept in step with the table: the SDK's `band.id.find` walks every row, and with a crowd of a
 *  thousand the pages look bands up thousands of times per redraw. */
const bandMaps = new WeakMap<DbConnection, Map<number, Band>>();

export function bandById(conn: DbConnection, id: number): Band | undefined {
  let bands = bandMaps.get(conn);
  if (!bands) {
    const m = new Map([...conn.db.band.iter()].map(b => [b.id, b]));
    conn.db.band.onInsert((_ctx, b) => m.set(b.id, b));
    conn.db.band.onUpdate((_ctx, _old, b) => m.set(b.id, b));
    conn.db.band.onDelete((_ctx, b) => m.delete(b.id));
    bandMaps.set(conn, bands = m);
  }
  return bands.get(id);
}

/** Opens a bandit-api session for this identity, so bandit-api knows who calls it. */
export async function apiSession(conn: DbConnection): Promise<string> {
  const token = randomString();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  await conn.reducers.openApiSession({ tokenHash: hash });
  return token;
}

export async function api<T>(path: string, session: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...(init.headers ?? {}), 'x-bandit-session': session } });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}

/** The medical card a medic opened by tapping the band, from the module's `medic_medical_cards`. */
export function medicalCard(m: MedicCard): HTMLElement {
  const c = m.card;
  if (!c) return h('section', { class: 'alert' }, h('h4', {}, `Medical card: ${m.name}, band ${bandCode(m.bandId)}`), h('p', {}, 'No medical card on file.'));
  const list = (label: string, items: string[]) => items.length > 0 && h('p', {}, h('b', {}, `${label}: `), items.join('; '));
  return h('section', { class: 'alert' },
    h('h4', {}, `Medical card: ${m.name}, band ${bandCode(m.bandId)}`, c.status !== 'confirmed' ? ' (not yet confirmed by the wearer)' : ''),
    c.bloodType && h('p', {}, h('b', {}, 'Blood type: '), c.bloodType),
    list('Allergies', c.allergies), list('Conditions', c.conditions), list('Medications', c.medications),
    c.emergencyContact && h('p', {}, h('b', {}, 'Emergency contact: '), c.emergencyContact),
    c.insurer && h('p', {}, h('b', {}, 'Insurance: '), `${c.insurer} ${c.plan}, member ${c.memberId}, group ${c.groupNumber}${c.insurerPhone ? `, ${c.insurerPhone}` : ''}`),
    c.notes && h('p', {}, c.notes));
}

// --- Formatting and DOM ---------------------------------------------------------------------

export function money(cents: bigint | number): string {
  const n = Number(cents) / 100;
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A claim with a gap or mismatch in the policies: the organizer decides it one by one, and it makes no rule proposal. */
export function complicated(c: { statusNote: string }): boolean {
  return c.statusNote.startsWith('Complication');
}

export function time(t: Timestamp | undefined): string {
  return t ? t.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
}

export function date(t: Timestamp | undefined): string {
  return t ? t.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}

/** Each incident kind in a few words, for staff screens. */
const KIND_WORDS: Record<string, string> = {
  sos: 'SOS',
  fall: 'fall',
  property: 'venue equipment broken',
  theft: 'stolen from the venue',
  breakage: 'venue equipment broken',
};

/** An incident kind (`theft`, or an enum tag like `Theft`) in words. */
export function kindWords(kind: string): string {
  return KIND_WORDS[kind.toLowerCase()] ?? kind;
}

/** The venue's loss, its equipment broken or something stolen from it: the venue's property policy pays it, staff
 *  can name who did it, and that attendee can be charged. */
export function isLoss(kind: string): boolean {
  return ['property', 'theft', 'breakage'].includes(kind.toLowerCase());
}

const ROLE_WORDS: Record<string, string> = {
  hacker: 'hacker',
  booth_staff: 'booth staff',
  organizer: 'organizer',
  photographer: 'photographer',
  speaker: 'speaker',
  attendee: 'attendee',
};

/** What someone does at the event (`booth_staff`), in words. */
export function roleWords(role: string): string {
  return ROLE_WORDS[role] ?? role.replace(/_/g, ' ');
}

export function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function short(id: Identity | string): string {
  const hex = typeof id === 'string' ? id : id.toHexString();
  return hex.slice(0, 10);
}

type Child = Node | string | number | false | null | undefined | Child[];

/** h('p', { class: 'x', onclick: fn }, 'text', child) */
export function h(tag: string, attrs: Record<string, any> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') (el as HTMLInputElement).value = v;
    else if (k === 'checked') (el as HTMLInputElement).checked = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  const add = (c: Child) => {
    if (Array.isArray(c)) c.forEach(add);
    else if (c instanceof Node) el.appendChild(c);
    else if (c !== false && c !== null && c !== undefined) el.appendChild(document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

/** Replaces the contents of #id, keeping focus and typed text in inputs that keep their name. */
export function mount(id: string, ...children: Child[]) {
  const root = document.getElementById(id)!;
  const active = document.activeElement as HTMLInputElement | null;
  const keep = new Map<string, string>();
  const ticked = new Map<string, boolean>();
  root.querySelectorAll('input[name], textarea[name], select[name]').forEach(e => {
    const i = e as HTMLInputElement;
    if (i.type === 'checkbox') ticked.set(i.name, i.checked);
    else if (i.type !== 'file') keep.set(i.name, i.value);
  });
  // A chosen file cannot be set back on a new input, so the old file inputs move into the new tree,
  // matched in order when they ask for the same kind of file.
  const files = [...root.querySelectorAll('input[type=file]')] as HTMLInputElement[];
  const focused = active && root.contains(active) ? active.getAttribute('name') : null;
  root.replaceChildren(h('div', {}, ...children));
  root.querySelectorAll('input[name], textarea[name], select[name]').forEach(e => {
    const i = e as HTMLInputElement;
    if (i.type === 'checkbox') {
      if (ticked.has(i.name)) i.checked = ticked.get(i.name)!;
    } else if (keep.has(i.name) && i.dataset.fresh === undefined) i.value = keep.get(i.name)!;
  });
  ([...root.querySelectorAll('input[type=file]')] as HTMLInputElement[]).forEach((fresh, n) => {
    const old = files[n];
    if (old && old.files?.length && old.accept === fresh.accept && old.name === fresh.name) fresh.replaceWith(old);
  });
  if (focused) (root.querySelector(`[name="${focused}"]`) as HTMLElement | null)?.focus();
}

/** Runs a reducer call or request and shows its error under the page title instead of throwing. */
export async function act(what: () => Promise<unknown>): Promise<boolean> {
  const bar = document.getElementById('error');
  if (viewing()) {
    if (bar) bar.textContent = 'This is a read-only view: nothing changes for this person.';
    return false;
  }
  try {
    if (bar) bar.textContent = '';
    await what();
    return true;
  } catch (e: any) {
    if (bar) bar.textContent = String(e?.message ?? e);
    return false;
  }
}

export function field(form: HTMLElement, name: string): string {
  return (form.querySelector(`[name="${name}"]`) as HTMLInputElement).value.trim();
}

/** The busy level of a zone from the bands in it, by the same thresholds the bands use. */
export function risk(avgNeigh: number, yellow: number, red: number): 'calm' | 'busy' | 'very busy' {
  return avgNeigh >= red ? 'very busy' : avgNeigh >= yellow ? 'busy' : 'calm';
}

// Exit colour indexes 1 to 6, as the bands and stations glow them.
export const EXIT_COLOURS = ['none', 'blue', 'magenta', 'cyan', 'white', 'orange', 'violet'];

// Band light states 0 to 9 and what the attendee app says about each.
export const BAND_STATES: [string, string][] = [
  ['green', 'All calm'],
  ['yellow', 'Getting busy around you'],
  ['red', 'Move out: follow the exit lights'],
  ['red', 'Staff alerted'],
  ['blue', 'Someone next to you needs help. Keep your ring visible so the medic can find them.'],
  ['yellow', 'Press to approve'],
  ['green', 'Paid'],
  ['pink', 'Connected'],
  ['white', 'Press to claim'],
  ['grey', 'Ring off'],
];

// The Meta socials an attendee can add, with their profile URL prefixes.
export const PLATFORMS: [string, string, string][] = [
  ['instagram', 'Instagram', 'https://instagram.com/'],
  ['facebook', 'Facebook', 'https://facebook.com/'],
  ['threads', 'Threads', 'https://threads.net/@'],
];

export function handleLinks(handles: { platform: string; handle: string }[]): HTMLElement[] {
  return handles.map(x => {
    const p = PLATFORMS.find(p => p[0] === x.platform);
    const name = x.handle.replace(/^@/, '');
    return h('a', { class: 'handle', href: p ? p[2] + name : '#', target: '_blank' }, `${p ? p[1] : x.platform} @${name}`);
  });
}
