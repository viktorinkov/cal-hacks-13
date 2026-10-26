// Resizing in the organizer portal: a scrolling table drags taller or shorter by its bottom-right corner, and on
// the Live tab the side panels and the 3D view drag wider, narrower or taller by the bars between and under
// them. The page redraws every second and builds everything again, so the sizes are kept here, and in the
// browser for the next visit.

import { h } from './lib';

const STORE = 'bandit-sizes';
const sizes: Record<string, number> = load();

function load(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}');
  } catch {
    return {};
  }
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(sizes));
  } catch {
    // The sizes then last until the page reloads.
  }
}

/** The size dragged to under `key`, in pixels, if any. */
export function dragged(key: string): number | undefined {
  return sizes[key];
}

/**
 * A bar that resizes something by dragging: across (`x`) for a bar between two columns, up and down (`y`) for one
 * under a box. `grow` is 1 when dragging right or down makes it bigger, -1 when it makes it smaller. `from` reads
 * the size when the drag starts and `apply` sets each new size, kept between `min` and `max()`.
 */
export function dragBar(key: string, axis: 'x' | 'y', grow: 1 | -1, from: () => number, apply: (px: number) => void, min: number, max = () => Infinity) {
  const start = (e: PointerEvent) => {
    e.preventDefault();
    const bar = e.currentTarget as HTMLElement;
    bar.setPointerCapture(e.pointerId);
    const size = from();
    const at = axis === 'x' ? e.clientX : e.clientY;
    const move = (m: PointerEvent) => {
      sizes[key] = Math.round(Math.max(min, Math.min(max(), size + grow * ((axis === 'x' ? m.clientX : m.clientY) - at))));
      apply(sizes[key]);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('lostpointercapture', () => {
      bar.removeEventListener('pointermove', move);
      save();
    }, { once: true });
  };
  return h('div', { class: `drag-bar ${axis}`, title: 'Drag to resize', onpointerdown: start });
}

/** A table's name across redraws: the tab, the heading of the section it is in, without counts, and its place there. */
function tableKey(t: Element): string {
  const box = t.closest('section') ?? t.parentElement!;
  const head = box.querySelector('h2, h3, h4')?.textContent?.replace(/[\d,]+/g, '') ?? '';
  return `table ${location.hash} ${head} ${[...box.querySelectorAll('table')].indexOf(t as HTMLTableElement)}`;
}

/** Lets every table under `root` be dragged taller or shorter by its corner, at the height it was dragged to before. */
export function keepTableHeights(root: HTMLElement) {
  for (const t of root.querySelectorAll('table')) {
    t.classList.add('resizable');
    const px = sizes[tableKey(t)];
    if (px) t.style.height = `${px}px`;
  }
}

// A dragged corner leaves the table's new height on it, which is kept here before the redraw that follows the release.
document.addEventListener('pointerup', () => {
  let changed = false;
  for (const t of document.querySelectorAll<HTMLElement>('table.resizable')) {
    const px = Math.round(parseFloat(t.style.height));
    const key = tableKey(t);
    if (px && sizes[key] !== px) {
      sizes[key] = px;
      changed = true;
    }
  }
  if (changed) save();
}, true);
