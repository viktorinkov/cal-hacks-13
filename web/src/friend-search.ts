import { api, apiSession, h, handleLinks } from './lib';
import type { DbConnection } from './module_bindings';

type SearchPlace = {
  name: string;
  started_at: string;
  minutes: number;
  kind: 'shared_booth' | 'encounter_zone' | 'shared_zone';
};

type SearchPerson = {
  node_id: number;
  name: string;
  photo_url: string;
  handles: Record<string, string>;
  minutes: number;
  reason: string;
  places: SearchPlace[];
};

type SearchResult = { query: string; semantic_ranked: boolean; candidate_count: number; searched_count: number; people: SearchPerson[] };
type SearchPanel = { element: HTMLElement; sync: () => void };

const panels = new WeakMap<DbConnection, SearchPanel>();

function when(value: string): string {
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime())
    ? timestamp.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
}

function duration(minutes: number): string {
  return minutes < 1 ? 'under a minute' : `${Math.round(minutes)} min`;
}

function placeEvidence(place: SearchPlace): HTMLElement {
  const label = place.kind === 'encounter_zone' ? 'First recorded encounter'
    : place.kind === 'shared_booth' ? 'Shared booth visit' : 'Shared area visit';
  const at = when(place.started_at);
  return h('li', {}, `${label}: ${place.name}`,
    at && ` · ${at}`,
    place.kind !== 'encounter_zone' && place.minutes > 0 && ` · ${duration(place.minutes)} overlap`);
}

function personCard(person: SearchPerson): HTMLElement {
  const handles = Object.entries(person.handles).map(([platform, handle]) => ({ platform, handle }));
  return h('li', {},
    person.photo_url && h('img', { class: 'face', src: person.photo_url, alt: '' }),
    h('b', {}, person.name),
    h('p', {}, person.reason),
    person.minutes > 0 && h('div', { class: 'muted' }, `${duration(person.minutes)} together across your recorded encounters`),
    person.places.length > 0 && h('ul', {}, person.places.map(placeEvidence)),
    h('div', {}, handles.length ? handleLinks(handles) : h('span', { class: 'muted' }, 'No socials shared')));
}

/** Keeps the same form node while live subscriptions redraw the surrounding recap. */
function createPanel(conn: DbConnection): SearchPanel {
  let identity = '';
  let enabled = false;
  let request = 0;
  let active: AbortController | undefined;
  let session: Promise<string> | undefined;
  const input = h('input', {
    type: 'search', name: 'friend-search-query', maxlength: 500, required: true,
    placeholder: 'The person I met at the Meta booth', autocomplete: 'off',
  }) as HTMLInputElement;
  const button = h('button', { type: 'submit' }, 'Search');
  const status = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });
  const results = h('div', { 'aria-live': 'polite', 'aria-atomic': 'true' });
  const hint = h('p', { class: 'muted' });
  const reset = () => {
    request += 1;
    active?.abort();
    active = undefined;
    input.value = '';
    button.textContent = 'Search';
    status.textContent = '';
    results.replaceChildren();
    results.removeAttribute('aria-busy');
  };
  const search = async (event: Event) => {
    event.preventDefault();
    if (!enabled) return;
    const query = input.value.trim();
    if (!query) return;
    const current = ++request;
    active?.abort();
    active = new AbortController();
    const signal = active.signal;
    button.textContent = 'Searching…';
    status.textContent = 'Searching your recorded connections…';
    results.replaceChildren();
    results.setAttribute('aria-busy', 'true');
    try {
      session ??= apiSession(conn).catch(error => { session = undefined; throw error; });
      const token = await session;
      if (current !== request) return;
      const found = await api<SearchResult>(`/api/friends?q=${encodeURIComponent(query)}`, token, { signal });
      if (current !== request) return;
      status.textContent = found.people.length
        ? `Closest recorded connections for “${found.query}” (${found.people.length}).`
        : `No recorded connections matched “${found.query}”. Try a name or a place you remember.`;
      results.replaceChildren(h('div', {},
        !found.semantic_ranked && h('p', { class: 'muted' }, 'Showing matches from recorded names and places. Broader matching is temporarily unavailable.'),
        found.searched_count < found.candidate_count && h('p', { class: 'muted' }, 'Add a place or name to narrow these matches.'),
        found.people.length > 0 && h('ul', { class: 'cards' }, found.people.map(personCard))));
    } catch (error) {
      if (current !== request || signal.aborted) return;
      session = undefined;
      status.textContent = 'Search could not finish. Please try again.';
    } finally {
      if (current === request) {
        button.textContent = 'Search';
        results.removeAttribute('aria-busy');
      }
    }
  };
  const element = h('section', {},
    h('h2', {}, 'Find someone you met'),
    h('p', {}, 'Search your recorded connections by name and place.'),
    hint,
    h('form', { role: 'search', 'aria-label': 'Find someone you met', onsubmit: search },
      h('label', {}, 'What do you remember?', input),
      button,
      h('button', { type: 'button', onclick: () => { reset(); input.focus(); } }, 'Clear')),
    status, results);
  return {
    element,
    sync() {
      const me = conn.db.myAttendee.iter().next().value;
      const nextIdentity = me?.identity.toHexString() ?? '';
      const canSearch = !!me;
      if (nextIdentity !== identity || canSearch !== enabled) {
        identity = nextIdentity;
        enabled = canSearch;
        session = undefined;
        reset();
      }
      const count = conn.db.myEncounters.count();
      hint.textContent = count ? '' : 'No connections are recorded for you yet. They appear here after your band records time with someone.';
      hint.hidden = canSearch && count > 0;
      input.disabled = !canSearch;
      button.toggleAttribute('disabled', !canSearch);
    },
  };
}

export function friendSearch(conn: DbConnection): HTMLElement {
  let panel = panels.get(conn);
  if (!panel) {
    panel = createPanel(conn);
    panels.set(conn, panel);
  }
  panel.sync();
  return panel.element;
}
