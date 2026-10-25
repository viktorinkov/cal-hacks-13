import { actors, config, connect, h, idToken, mount, signIn, signOut, signedInEmail, testAs, viewing, type Actor } from '../lib';
import { friendSearch } from '../friend-search';
import type { DbConnection } from '../module_bindings';

let conn: DbConnection | undefined;
let people: Actor[] = [];
let canSignIn = false;

function render() {
  if (!conn) return;
  const me = conn.db.myAttendee.iter().next().value;
  const email = signedInEmail();
  mount('app',
    h('p', {}, h('a', { href: '/' }, 'Band1t')),
    h('p', { class: 'muted top' }, email ? `Signed in as ${email} · ` : '',
      email && h('button', { class: 'link', onclick: signOut }, 'Sign out'),
      people.length > 0 && !viewing() && testAs(people)),
    me
      ? [h('p', {}, `Your connections, ${me.displayName}.`), friendSearch(conn)]
      : [h('h2', {}, 'Find someone you met'),
        h('p', {}, 'No attendee profile is connected to this browser yet. Open this page in the browser you used to register your band.'),
        canSignIn && !idToken() && h('button', { onclick: signIn }, 'Sign in with your event email'),
        h('p', {}, 'If you have not joined yet, tap your band to get started.')]);
}

async function main() {
  const cfg = await config();
  canSignIn = !!cfg.auth_client_id;
  if (cfg.test_mode) people = await actors();
  // The registration app keeps the attendee's database credential in this browser.
  // Reuse it before asking for email sign-in, which can represent another identity.
  conn = await connect(['SELECT * FROM my_attendee', 'SELECT * FROM my_encounters'], render);
  render();
}

main().catch(() => mount('app',
  h('h2', {}, 'Find someone you met'),
  h('p', { class: 'error' }, 'Your connections could not be loaded. Please try again.'),
  h('button', { onclick: () => location.reload() }, 'Try again')));
