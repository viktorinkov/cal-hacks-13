// Shared code for the BandIt pages: settings from bandit-api, SpacetimeAuth sign-in, the
// SpacetimeDB connection, and tiny DOM helpers. Every screen is a subscription; every change is a
// reducer call.

import { Identity, Timestamp } from 'spacetimedb';
import { DbConnection } from './module_bindings';

export type Config = {
  spacetimedb_url: string;
  database: string;
  kibana_url: string;
  dashboards: { title: string; url: string }[];
  auth_client_id: string;
  demo: boolean;
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
  const token = idToken();
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

// --- Demo identities ------------------------------------------------------------------------

/** With BANDIT_DEMO=1, the people `bandit-claims setup` created, so one browser can play each. */
export async function actors(): Promise<Actor[]> {
  const res = await fetch('/api/actors');
  return res.ok ? res.json() : [];
}

/** The token of the person this browser plays (`?as=name`), when the demo switcher is on. */
export async function playedToken(): Promise<string | undefined> {
  const as = new URLSearchParams(location.search).get('as');
  if (!as) return undefined;
  return (await actors()).find(a => a.name === as)?.token;
}

// --- Connection -----------------------------------------------------------------------------

/**
 * Connects as the played person, else the signed-in person, else the identity kept in this
 * browser, and resolves once `queries` have arrived. `onChange` runs after every change to them.
 */
export async function connect(queries: string[], onChange: () => void): Promise<DbConnection> {
  const cfg = await config();
  const played = await playedToken();
  const storeKey = 'bandit-token';
  const token = played ?? idToken() ?? localStorage.getItem(storeKey) ?? undefined;
  return new Promise((resolve, reject) => {
    const conn = DbConnection.builder()
      .withUri(cfg.spacetimedb_url)
      .withDatabaseName(cfg.database)
      .withToken(token)
      .onConnect((c, _identity, newToken) => {
        if (!played && !idToken()) localStorage.setItem(storeKey, newToken);
        c.subscriptionBuilder()
          .onApplied(() => {
            watch(c, onChange);
            resolve(c);
            setTimeout(onChange, 0);
          })
          .onError(ctx => reject((ctx as any).event ?? new Error('subscription failed')))
          .subscribe(queries);
      })
      .onConnectError((_ctx, e) => reject(e))
      .build();
  });
}

/** Calls `onChange` (at most once per frame) after any row of any table changes. */
function watch(conn: DbConnection, onChange: () => void) {
  let queued = false;
  const kick = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      onChange();
    });
  };
  for (const table of Object.values(conn.db as Record<string, any>)) {
    if (table && typeof table.onInsert === 'function') {
      table.onInsert(kick);
      table.onDelete(kick);
      table.onUpdate?.(kick);
    }
  }
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

// --- Formatting and DOM ---------------------------------------------------------------------

export function money(cents: bigint | number): string {
  return `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function time(t: Timestamp | undefined): string {
  return t ? t.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
}

export function date(t: Timestamp | undefined): string {
  return t ? t.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
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
  root.querySelectorAll('input[name], textarea[name], select[name]').forEach(e => {
    const i = e as HTMLInputElement;
    if (i.type !== 'checkbox' && i.type !== 'file') keep.set(i.name, i.value);
  });
  const focused = active && root.contains(active) ? active.getAttribute('name') : null;
  root.replaceChildren(h('div', {}, ...children));
  root.querySelectorAll('input[name], textarea[name], select[name]').forEach(e => {
    const i = e as HTMLInputElement;
    if (keep.has(i.name) && i.dataset.fresh === undefined) i.value = keep.get(i.name)!;
  });
  if (focused) (root.querySelector(`[name="${focused}"]`) as HTMLElement | null)?.focus();
}

/** Runs a reducer call or request and shows its error under the page title instead of throwing. */
export async function act(what: () => Promise<unknown>): Promise<boolean> {
  const bar = document.getElementById('error');
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
