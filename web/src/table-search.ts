// A plain search box over a long table: typing hides the rows that miss a word. What each box holds is kept by
// name, so the next redraw, which builds the table again, filters the new rows the same way.

import { h } from './lib';

const queries = new Map<string, string>();
let redraw = () => {};
let redrawSoon: ReturnType<typeof setTimeout> | undefined;

/** The page's redraw, for tables that build only some of their rows and filter the data first. */
export function redrawOnSearch(fn: () => void) {
  redraw = fn;
}

/** The words typed in the named table's search box, lowercased. */
export function searchWords(name: string): string[] {
  return (queries.get(name) ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every word appears in the text. */
export function matches(text: string, words: string[]): boolean {
  if (!words.length) return true;
  const lower = text.toLowerCase();
  return words.every(w => lower.includes(w));
}

/** Shows the rows of `el` that hold every word and returns how many; header and total rows, all th, always show. */
function filter(el: HTMLElement, words: string[]): number {
  let shown = 0;
  for (const row of el.querySelectorAll('tr')) {
    if (!row.querySelector('td')) continue;
    const hit = matches(Array.from(row.cells, c => c.textContent).join(' '), words);
    row.style.display = hit ? '' : 'none';
    if (hit) shown++;
  }
  return shown;
}

/**
 * A search box, then `el`: a table or a box around one. `partial` says the table holds only some of the rows, so
 * typing also redraws the page, which filters the data before it picks the rows.
 */
export function searchable(name: string, el: HTMLElement, partial = false): HTMLElement[] {
  const count = h('span', { class: 'muted' });
  const apply = (words: string[]) => {
    const n = filter(el, words);
    count.textContent = words.length ? ` ${n} found` : '';
  };
  if (searchWords(name).length) apply(searchWords(name));
  const typed = (e: Event) => {
    queries.set(name, (e.target as HTMLInputElement).value);
    apply(searchWords(name));
    if (partial) {
      clearTimeout(redrawSoon);
      redrawSoon = setTimeout(redraw, 200);
    }
  };
  return [
    h('p', {}, h('input', { name: `search-${name}`, type: 'search', class: 'search', placeholder: 'Search', value: queries.get(name) ?? '', oninput: typed }), count),
    el,
  ];
}
