// The organizer starts the configured event import here; its progress and result arrive live.

import { act, date, field, h, time } from './lib';
import type { DbConnection } from './module_bindings';
import type { EventImport } from './module_bindings/types';

const EVENT = { slug: 'calhacks-13', name: 'Cal Hacks 13.0' };
const STATUS: Record<string, string> = { running: 'Importing', ready: 'Imported', failed: 'Failed' };
const SECTIONS: Record<string, string> = {
  venue: 'Event', zones: 'Zones', organizations: 'Organizations', people: 'People', booths: 'Booths', schedule: 'Schedule',
};

let submitting = false;
let startButton: HTMLButtonElement | undefined;

function importRun(conn: DbConnection, run: EventImport, latest: boolean) {
  const steps = [...conn.db.eventImportStep.iter()].filter(step => step.importId === run.id)
    .sort((a, b) => Number(a.id - b.id));
  return h('details', { open: latest || run.status === 'running' },
    h('summary', {}, `${run.eventName} · ${STATUS[run.status] ?? run.status} · ${date(run.createdAt)}`),
    run.error && h('p', { class: 'fail' }, run.error),
    h('ol', {}, steps.map(step => h('li', {},
      h('span', { class: 'muted' }, time(step.at)), ' ', h('b', {}, step.step), step.detail && `: ${step.detail}`))),
    run.status === 'ready' && h('table', {},
      h('caption', {}, 'Changes from this import'),
      h('tr', {}, ['Section', 'Added', 'Updated'].map(label => h('th', {}, label))),
      run.counts.map(count => h('tr', {},
        h('td', {}, SECTIONS[count.section] ?? count.section),
        h('td', {}, count.inserted), h('td', {}, count.updated)))));
}

export function eventImportSection(conn: DbConnection, canStart: boolean) {
  const runs = [...conn.db.eventImport.iter()].sort((a, b) => Number(b.id - a.id));
  const running = () => [...conn.db.eventImport.iter()].some(run => run.eventSlug === EVENT.slug && run.status === 'running');
  const updateButton = () => {
    if (!startButton) return;
    startButton.disabled = submitting || running();
    startButton.textContent = submitting ? 'Starting import…' : running() ? 'Import in progress' : 'Import event data';
  };
  const start = async (event: Event) => {
    event.preventDefault();
    if (submitting || running()) return;
    const eventSlug = field(event.target as HTMLFormElement, 'import_event_slug');
    submitting = true;
    updateButton();
    await act(() => conn.reducers.startEventImport({ eventSlug }));
    submitting = false;
    updateButton();
  };
  startButton = canStart ? h('button', { type: 'submit' }, 'Import event data') as HTMLButtonElement : undefined;
  updateButton();
  return h('section', {},
    h('h3', {}, 'Import event data'),
    h('p', { class: 'muted' }, 'Refresh sponsors, people, schedules and booths from the event’s configured public sources. You can leave this page while the import runs.'),
    canStart
      ? h('form', { onsubmit: start },
        h('label', {}, 'Configured event ', h('select', { name: 'import_event_slug' },
          h('option', { value: EVENT.slug }, EVENT.name))), ' ', startButton)
      : h('p', { class: 'muted' }, 'The organizer imports event data.'),
    runs.length > 0 && h('div', {}, runs.map((run, i) => importRun(conn, run, i === 0))));
}
