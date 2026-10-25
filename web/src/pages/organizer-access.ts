import { connect, h, idToken, mount, signIn, signedInEmail } from '../lib';

async function main() {
  const next = new URLSearchParams(location.search).get('next') === '/portal' ? '/portal' : '/organizer';
  // This page always enrolls the real email account, never a View as or test identity.
  history.replaceState(null, '', `/organizer-access?next=${encodeURIComponent(next)}`);
  if (!idToken()) {
    return mount('app',
      h('h2', {}, 'Organizer access'),
      h('p', {}, 'Sign in with your email to run the event.'),
      h('button', { onclick: () => signIn().catch(showError) }, 'Sign in with email'));
  }
  mount('app', h('h2', {}, 'Organizer access'), h('p', { role: 'status' }, `Opening the organizer for ${signedInEmail()}…`));
  const conn = await connect(['SELECT * FROM my_roles'], () => {});
  await conn.reducers.joinOrganizer({});
  location.replace(next);
}

function showError(error: unknown) {
  mount('app',
    h('h2', {}, 'Organizer access'),
    h('p', { class: 'error', role: 'alert' }, error instanceof Error ? error.message : String(error)),
    h('button', { onclick: () => location.reload() }, 'Try again'));
}

main().catch(showError);
