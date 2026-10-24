// The recap the tap link shows once the host ends the event: where you were and when (live from
// SpacetimeDB), the people and booths you spent time with (ranked by Elastic through bandit-api),
// your photos with the people in them and tap-to-share, merch made from them, and the Nessie wallet
// that pays for it.

import { act, date, field, h, handleLinks, money, time } from './lib';
import type { DbConnection } from './module_bindings';
import type { MerchSuggestion, MyPhoto } from './module_bindings/types';

export type Recap = {
  display_name: string;
  suggested_people: { node_id: number; name: string; photo_url: string; handles: Record<string, string>; minutes: number; score: number | null }[];
  suggested_booths: { booth_id: number; name: string; zone_name: string; minutes: number; score: number | null }[];
  suggestions_ranked: boolean;
};

const SVG = 'http://www.w3.org/2000/svg';
function s(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Zones down the side, time along the bottom: each stay is a bar, each person met a dot. */
function spaceTime(conn: DbConnection) {
  const visits = [...conn.db.myVisits.iter()].sort((a, b) => Number(a.startedAt.microsSinceUnixEpoch - b.startedAt.microsSinceUnixEpoch));
  const met = [...conn.db.myEncounters.iter()];
  if (!visits.length) return h('p', { class: 'muted' }, 'No stays recorded for your band.');
  const zones = [...new Set(visits.map(v => v.zoneName))];
  const now = Date.now();
  const t0 = Math.min(...visits.map(v => v.startedAt.toDate().getTime()));
  const t1 = Math.max(...visits.map(v => v.endedAt?.toDate().getTime() ?? now), ...met.map(e => e.lastSeenAt.toDate().getTime()));
  const W = 720, left = 150, row = 34, H = zones.length * row + 40;
  const x = (t: number) => left + ((t - t0) / Math.max(1, t1 - t0)) * (W - left - 20);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'spacetime' });
  zones.forEach((z, i) => {
    svg.appendChild(s('text', { x: 4, y: i * row + 24 }, z));
    svg.appendChild(s('line', { x1: left, x2: W - 20, y1: i * row + 20, y2: i * row + 20, class: 'grid' }));
  });
  for (const v of visits) {
    const y = zones.indexOf(v.zoneName) * row + 8;
    const a = x(v.startedAt.toDate().getTime()), b = x(v.endedAt?.toDate().getTime() ?? now);
    const bar = s('rect', { x: a, y, width: Math.max(3, b - a), height: 24, rx: 4, class: 'stay' });
    bar.appendChild(s('title', {}, `${v.zoneName}: ${time(v.startedAt)} to ${v.endedAt ? time(v.endedAt) : 'now'}, ${Math.round(v.minutes)} min${v.booths.length ? ` (${v.booths.join(', ')})` : ''}`));
    svg.appendChild(bar);
  }
  for (const e of met) {
    const i = zones.indexOf(e.zoneName);
    const mid = (e.startedAt.toDate().getTime() + e.lastSeenAt.toDate().getTime()) / 2;
    const dot = s('circle', { cx: x(mid), cy: (i < 0 ? 0 : i) * row + 20, r: 7, class: 'met' });
    dot.appendChild(s('title', {}, `${e.person.name}, ${Math.round(e.minutes)} min together`));
    svg.appendChild(dot);
  }
  svg.appendChild(s('text', { x: left, y: H - 6, class: 'tick' }, new Date(t0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
  svg.appendChild(s('text', { x: W - 70, y: H - 6, class: 'tick' }, new Date(t1).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
  return svg;
}

function people(data: Recap | undefined) {
  if (!data) return h('p', { class: 'muted' }, 'Ranking…');
  if (!data.suggested_people.length) return h('p', { class: 'muted' }, 'Nobody stayed close to you long enough to count.');
  return h('ul', { class: 'cards' }, data.suggested_people.map(p => h('li', {},
    p.photo_url && h('img', { class: 'face', src: p.photo_url }),
    h('b', {}, p.name), ` · ${Math.round(p.minutes)} min together`,
    p.score !== null && h('span', { class: 'score' }, `match ${p.score.toFixed(2)}`),
    h('div', {}, handleLinks(Object.entries(p.handles).map(([platform, handle]) => ({ platform, handle })))))));
}

function booths(data: Recap | undefined) {
  if (!data) return null;
  if (!data.suggested_booths.length) return h('p', { class: 'muted' }, 'No booth visits.');
  return h('ul', { class: 'cards' }, data.suggested_booths.map(b => h('li', {},
    h('b', {}, b.name), ` · ${b.zone_name} · ${Math.round(b.minutes)} min`,
    b.score !== null && h('span', { class: 'score' }, `match ${b.score.toFixed(2)}`))));
}

function caption(p: MyPhoto, event: string) {
  const tags = p.people.flatMap(x => x.handles.filter(h => h.platform === 'instagram').map(h => '@' + h.handle.replace(/^@/, '')));
  return `${p.caption || 'Good times'} at ${event} ${tags.join(' ')} #CalHacks`.replace(/\s+/g, ' ').trim();
}

async function share(p: MyPhoto, event: string) {
  const text = caption(p, event);
  const blob = await (await fetch(p.url)).blob();
  const file = new File([blob], `bandit-photo-${p.photoId}.${blob.type.includes('png') ? 'png' : 'jpg'}`, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], text });
  } else {
    await navigator.clipboard.writeText(text);
    const a = h('a', { href: URL.createObjectURL(file), download: file.name }) as HTMLAnchorElement;
    a.click();
    alert(`Caption copied: ${text}`);
  }
}

function photos(conn: DbConnection, event: string) {
  const mine = [...conn.db.myPhotos.iter()];
  if (!mine.length) return h('p', { class: 'muted' }, 'No photos of you yet.');
  return h('div', { class: 'photos' }, mine.map(p => h('figure', {},
    h('img', { src: p.url }),
    h('figcaption', {},
      h('b', {}, p.caption || p.zoneName), ` · ${p.zoneName} · ${time(p.takenAt)}`,
      h('div', {}, p.people.length ? ['With ', p.people.map((x, i) => [i ? ', ' : '', x.name])] : 'Just you'),
      h('div', {}, p.people.map(x => handleLinks(x.handles))),
      h('button', { onclick: () => share(p, event) }, 'Share'),
      p.status === 'suggested' && [
        h('button', { onclick: () => act(() => conn.reducers.respondPhotoTag({ tagId: p.tagId, confirm: true })) }, "That's me"),
        h('button', { class: 'link', onclick: () => act(() => conn.reducers.respondPhotoTag({ tagId: p.tagId, confirm: false })) }, 'Not me')]))));
}

/** The template image with the photo cover-cropped into its photo box, scaled by CSS. */
function mockup(t: MerchSuggestion) {
  const canvas = h('canvas', { class: 'mockup', width: t.width, height: t.height }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const base = new Image();
  const img = new Image();
  let loaded = 0;
  const draw = () => {
    if (++loaded < 2) return;
    ctx.drawImage(base, 0, 0, t.width, t.height);
    const sc = Math.max(t.photoW / img.width, t.photoH / img.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(t.photoX, t.photoY, t.photoW, t.photoH);
    ctx.clip();
    ctx.drawImage(img, t.photoX + (t.photoW - img.width * sc) / 2, t.photoY + (t.photoH - img.height * sc) / 2, img.width * sc, img.height * sc);
    ctx.restore();
  };
  base.onload = draw;
  img.onload = draw;
  base.src = t.imageUrl;
  img.src = t.photoUrl;
  return canvas;
}

const mockups = new Map<string, HTMLCanvasElement>();

export function wallet(conn: DbConnection) {
  const w = conn.db.myWallet.iter().next().value;
  const entries = [...conn.db.myWalletEntries.iter()].sort((a, b) => Number(b.id - a.id));
  return h('section', {},
    h('h3', {}, 'Your BandIt wallet'),
    w ? h('p', { class: 'big' }, money(w.balanceCents), h('span', { class: 'muted' }, ` · Capital One Nessie account ${w.accountId.slice(0, 8)}`))
      : h('p', { class: 'muted' }, 'Opening your wallet…'),
    entries.length > 0 && h('table', {}, entries.map(e => h('tr', {},
      h('td', {}, date(e.createdAt)), h('td', {}, e.memo || e.kind), h('td', { class: e.amountCents < 0n ? '' : 'pass' }, money(e.amountCents))))));
}

function merch(conn: DbConnection) {
  const picks = [...conn.db.myMerchSuggestions.iter()].sort((a, b) => a.rank - b.rank);
  const orders = [...conn.db.myMerchOrders.iter()].sort((a, b) => Number(b.id - a.id));
  const titles = new Map([...conn.db.merchTemplate.iter()].map(t => [t.id, t.title]));
  const buy = async (e: Event, t: MerchSuggestion) => {
    e.preventDefault();
    const size = t.kind === 'tee' ? field(e.target as HTMLElement, 'size') : '';
    await act(() => conn.reducers.buyMerch({ templateId: t.templateId, photoId: t.photoId, size }));
  };
  return [
    !picks.length && h('p', { class: 'muted' }, 'Merch appears once you confirm a photo of you above ("That\'s me").'),
    h('div', { class: 'merch' }, picks.map(t => {
      const key = `${t.templateId}:${t.photoId}`;
      if (!mockups.has(key)) mockups.set(key, mockup(t));
      return h('figure', {}, mockups.get(key)!,
        h('figcaption', {},
          h('b', {}, t.title), ` · ${money(t.priceCents)}`,
          t.minutes > 0 && h('div', { class: 'muted' }, `${Math.round(t.minutes)} min at this sponsor's booth`),
          h('form', { onsubmit: (e: Event) => buy(e, t) },
            t.kind === 'tee' && h('select', { name: `size` }, ['S', 'M', 'L', 'XL'].map(x => h('option', { value: x, selected: x === 'M' || undefined }, x))),
            h('button', {}, `Buy ${money(t.priceCents)}`))));
    })),
    orders.length > 0 && [h('h4', {}, 'Your orders'), h('ul', {}, orders.map(o => h('li', {},
      `${titles.get(o.templateId) ?? 'Merch'}${o.size ? ` (${o.size})` : ''}, ${money(o.amountCents)}: ${o.status}${o.failure ? `, ${o.failure}` : ''}${o.nessiePurchaseId ? ` · Nessie purchase ${o.nessiePurchaseId.slice(0, 8)}` : ''}`)))],
  ];
}

export function recap(conn: DbConnection, data: Recap | undefined) {
  const v = conn.db.venue.iter().next().value;
  const event = v?.name ?? 'the event';
  const me = conn.db.myAttendee.iter().next().value;
  return [
    h('h2', {}, `Your ${event}`),
    h('p', {}, `Thanks for coming, ${me?.displayName ?? ''}. Here is your night.`),
    h('section', {}, h('h3', {}, 'Where you were'), spaceTime(conn)),
    h('section', {}, h('h3', {}, 'People you spent time with'),
      data && h('p', { class: 'muted' }, data.suggestions_ranked ? 'Best match for your interests first, ranked by Elastic.' : 'Most time together first.'),
      people(data)),
    h('section', {}, h('h3', {}, 'Booths you spent time at'), booths(data)),
    h('section', {}, h('h3', {}, 'Your photos'), photos(conn, event)),
    h('section', {}, h('h3', {}, 'Make it merch'), merch(conn)),
    wallet(conn),
  ];
}
