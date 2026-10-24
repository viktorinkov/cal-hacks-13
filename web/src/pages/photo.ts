// The photographer's page: add a photo taken in a zone. The module tags the people whose bands
// were in that zone at that moment, and the photo lands in their recaps.

import { Timestamp } from 'spacetimedb';
import { act, actors, config, connect, field, h, idToken, mount, playedToken, short, signIn, type Actor } from '../lib';
import type { DbConnection } from '../module_bindings';

let conn: DbConnection;
let people: Actor[] = [];
let added: string[] = [];

async function add(e: Event) {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const file = (form.querySelector('input[type=file]') as HTMLInputElement).files?.[0];
  if (!file) throw new Error('choose a photo');
  const res = await fetch('/api/blobs?purpose=photo', { method: 'POST', headers: { 'content-type': file.type || 'image/jpeg' }, body: await file.arrayBuffer() });
  const blob = await res.json();
  if (!res.ok) throw new Error(blob.error);
  const zoneId = BigInt(field(form, 'zone'));
  await conn.reducers.registerPhoto({ url: blob.url, takenAt: Timestamp.now(), zoneId, caption: field(form, 'caption') });
  added = [`${file.name} in ${conn.db.zone.id.find(zoneId)?.name}`, ...added];
  form.reset();
  render();
}

function render() {
  const roles = [...conn.db.myRoles.iter()].map(r => r.role);
  const as = new URLSearchParams(location.search).get('as') ?? '';
  const zones = [...conn.db.zone.iter()].sort((a, b) => a.stationId - b.stationId);
  mount('app',
    h('h2', {}, 'Add event photos'),
    people.length > 0 && h('p', {}, 'Play as ', h('select', { onchange: (e: Event) => { location.search = `?as=${(e.target as HTMLSelectElement).value}`; } },
      h('option', { value: '' }, 'choose a person'), people.map(p => h('option', { value: p.name, selected: p.name === as || undefined }, p.label)))),
    h('p', { class: 'muted' }, `Identity ${short(conn.identity!)}: ${roles.length ? roles.join(', ') : 'no photographer role yet'}`),
    h('form', { onsubmit: (e: Event) => act(() => add(e)) },
      h('label', {}, 'Photo', h('input', { type: 'file', accept: 'image/*', required: true })),
      h('label', {}, 'Where it was taken', h('select', { name: 'zone' }, zones.map(z => h('option', { value: String(z.id) }, z.name)))),
      h('label', {}, 'Caption', h('input', { name: 'caption', placeholder: 'At the SpacetimeDB booth' })),
      h('button', {}, 'Add photo')),
    added.length > 0 && h('section', {}, h('h3', {}, 'Added'), h('ul', {}, added.map(a => h('li', {}, a)))));
}

async function main() {
  const cfg = await config();
  if (cfg.demo) people = await actors();
  if (cfg.auth_client_id && !idToken() && !(await playedToken()) && !cfg.demo) {
    return mount('app', h('h2', {}, 'Photographer'), h('button', { onclick: signIn }, 'Sign in with email'));
  }
  conn = await connect(['SELECT * FROM zone', 'SELECT * FROM my_roles'], render);
}

main().catch(e => mount('app', h('p', { class: 'error' }, String(e?.message ?? e))));
