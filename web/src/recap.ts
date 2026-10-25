// The recap the tap link shows once the host ends the event or the attendee leaves early, top to bottom: where you were and when
// (live from SpacetimeDB), the people and booths you spent time with (ranked by Elastic through
// bandit-api) and who else was there, your photos with the people in them and tap-to-share, then merch
// made from them, paid from the Nessie wallet.

import { act, api, apiSession, date, field, h, handleLinks, money, time } from './lib';
import type { DbConnection } from './module_bindings';
import type { MerchSuggestion, MyPhoto } from './module_bindings/types';

type Person = { node_id: number; name: string; photo_url: string; handles: Record<string, string> };

/** Someone you spent time with, and how you met. */
type Suggested = Person & { minutes: number; met_zone_name: string; met_at: string; shared_booths: string[]; photos_together: number };

export type Recap = {
  display_name: string;
  suggested_people: Suggested[];
  suggested_booths: { booth_id: number; name: string; zone_name: string }[];
  shared_visits: { person: Person; zone_name: string; started_at: string; overlap_minutes: number }[];
};

let data: Recap | undefined;
let loadedFor = 0;
let loading = false;
let session = '';

/** When the attendee walked out early, else when the host ended the event; the night is drawn up to then. */
function endedAt(conn: DbConnection): number {
  const left = conn.db.myDeparture.iter().next().value?.leftAt;
  return (left ?? conn.db.eventState.id.find(0)?.endedAt)?.toDate().getTime() ?? Date.now();
}

/**
 * Asks bandit-api for the people and booths in Elastic's order, once per "Event ended", and tries
 * again every 5 s until it answers.
 */
async function load(conn: DbConnection, rerender: () => void) {
  const end = endedAt(conn);
  if (loadedFor !== end) {
    data = undefined;
    loadedFor = end;
  }
  if (loading || data) return;
  loading = true;
  try {
    if (!session) session = await apiSession(conn);
    data = await api<Recap>('/api/recap', session);
    document.getElementById('error')!.textContent = '';
  } catch (e: any) {
    document.getElementById('error')!.textContent = `Recap: ${e?.message ?? e}`;
    setTimeout(rerender, 5000);
  }
  loading = false;
  rerender();
}

const SVG = 'http://www.w3.org/2000/svg';
function s(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Zones down the side, time along the bottom: each stay is a bar, each person you met a dot. Then the stays as text. */
function spaceTime(conn: DbConnection) {
  const close = endedAt(conn);
  const visits = [...conn.db.myVisits.iter()]
    .filter(v => v.startedAt.toDate().getTime() < close)
    .sort((a, b) => Number(a.startedAt.microsSinceUnixEpoch - b.startedAt.microsSinceUnixEpoch));
  const met = [...conn.db.myEncounters.iter()].filter(e => e.startedAt.toDate().getTime() < close);
  if (!visits.length) return h('p', { class: 'muted' }, 'No stays recorded for your band.');
  const zones = [...new Set([...visits.map(v => v.zoneName), ...met.map(e => e.zoneName)])];
  const end = (v: (typeof visits)[number]) => Math.min(close, v.endedAt?.toDate().getTime() ?? close);
  // Back-to-back visits to the same zone (a band re-heard its station) read as one stay.
  const stays: { zoneName: string; start: number; end: number }[] = [];
  for (const v of visits) {
    const start = v.startedAt.toDate().getTime(), last = stays[stays.length - 1];
    if (last && last.zoneName === v.zoneName && start - last.end < 60_000) last.end = Math.max(last.end, end(v));
    else stays.push({ zoneName: v.zoneName, start, end: end(v) });
  }
  const t0 = Math.min(...visits.map(v => v.startedAt.toDate().getTime()), ...met.map(e => e.startedAt.toDate().getTime()));
  const t1 = Math.max(...visits.map(end), ...met.map(e => Math.min(close, e.lastSeenAt.toDate().getTime())));
  // Drawn at the section's own width so the text stays readable on a phone. Each zone is a label
  // with its lane under it.
  const W = Math.max(300, (document.getElementById('app')?.clientWidth ?? 560) - 34);
  const left = 6, right = 6, row = 46, H = zones.length * row + 24;
  const x = (t: number) => left + ((t - t0) / Math.max(1, t1 - t0)) * (W - left - right);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'spacetime' });
  zones.forEach((z, i) => {
    svg.appendChild(s('text', { x: left, y: i * row + 14 }, z));
    svg.appendChild(s('line', { x1: left, x2: W - right, y1: i * row + 31, y2: i * row + 31, class: 'grid' }));
  });
  for (const v of stays) {
    const y = zones.indexOf(v.zoneName) * row + 20;
    const a = x(v.start), b = x(v.end);
    const bar = s('rect', { x: a, y, width: Math.max(3, b - a), height: 22, rx: 4, class: 'stay' });
    bar.appendChild(s('title', {}, `${v.zoneName}: ${clock(v.start)} to ${clock(v.end)}`));
    svg.appendChild(bar);
  }
  for (const e of met) {
    const i = Math.max(0, zones.indexOf(e.zoneName));
    const dot = s('circle', { cx: x(e.startedAt.toDate().getTime()), cy: i * row + 31, r: 6, class: 'met' });
    dot.appendChild(s('title', {}, `Met ${e.person.name} at ${time(e.startedAt)}`));
    svg.appendChild(dot);
  }
  svg.appendChild(s('text', { x: left, y: H - 6, class: 'tick' }, clock(t0)));
  svg.appendChild(s('text', { x: W - right, y: H - 6, class: 'tick', 'text-anchor': 'end' }, clock(t1)));
  return [
    svg,
    h('p', { class: 'muted' }, 'Bars are where your band was; pink dots are when you met someone.'),
    h('ul', { class: 'cards' }, stays.map(v => h('li', {},
      `${clock(v.start)} to ${clock(v.end)} `, h('b', {}, v.zoneName),
      ` · ${Math.max(1, Math.round((v.end - v.start) / 60000))} min`))),
  ];
}

function socials(p: Person) {
  const handles = Object.entries(p.handles).map(([platform, handle]) => ({ platform, handle }));
  return h('div', {}, handles.length ? handleLinks(handles) : h('span', { class: 'muted' }, 'no socials shared'));
}

const and = (xs: string[]) => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs.join('');

/** "Met at Stage at 09:40 PM · 25 min together · You both visited A and B · 2 photos together", leaving out what is empty. */
function howYouMet(p: Suggested) {
  const min = Math.round(p.minutes), n = p.photos_together;
  return [
    p.met_at && `Met${p.met_zone_name ? ` at ${p.met_zone_name}` : ''} at ${clock(Date.parse(p.met_at))}`,
    min > 0 && `${min} min together`,
    p.shared_booths.length > 0 && `You both visited ${and(p.shared_booths)}`,
    n > 0 && `${n} photo${n > 1 ? 's' : ''} together`,
  ].filter(Boolean).join(' · ');
}

function people() {
  if (!data) return h('p', { class: 'muted' }, 'Loading…');
  if (!data.suggested_people.length) return h('p', { class: 'muted' }, 'Nobody stayed close to you long enough to count.');
  return h('ul', { class: 'cards' }, data.suggested_people.map(p => h('li', {},
    p.photo_url && h('img', { class: 'face', src: p.photo_url }),
    h('b', {}, p.name),
    h('div', { class: 'muted' }, howYouMet(p)),
    socials(p))));
}

/** The people who were in the same place as you, other than the ones you spent time with. */
function alsoThere() {
  if (!data) return h('p', { class: 'muted' }, 'Loading…');
  const known = new Set(data.suggested_people.map(p => p.node_id));
  const others = data.shared_visits.filter(v => !known.has(v.person.node_id));
  if (!others.length) return h('p', { class: 'muted' }, 'Nobody else was in the same place as you for long.');
  return h('ul', { class: 'cards' }, others.map(v => h('li', {},
    h('b', {}, v.person.name),
    ` at ${v.zone_name} for ${Math.max(1, Math.round(v.overlap_minutes))} min from ${clock(Date.parse(v.started_at))}`,
    socials(v.person))));
}

function booths() {
  if (!data) return h('p', { class: 'muted' }, 'Loading…');
  if (!data.suggested_booths.length) return h('p', { class: 'muted' }, 'No booth visits.');
  return h('ul', { class: 'cards' }, data.suggested_booths.map(b => h('li', {},
    h('b', {}, b.name), ` · ${b.zone_name}`)));
}

function caption(p: MyPhoto, event: string) {
  const tags = p.people.flatMap(x => x.handles.filter(h => h.platform === 'instagram').map(h => '@' + h.handle.replace(/^@/, '')));
  return `${p.caption || 'Good times'} at ${event} ${tags.join(' ')}`.replace(/\s+/g, ' ').trim();
}

/** The phone's share sheet with the photo and a caption naming the people you met in it. */
async function share(p: MyPhoto, event: string) {
  const text = caption(p, event);
  const blob = await (await fetch(p.url)).blob();
  const file = new File([blob], `bandit-photo-${p.photoId}.${blob.type.includes('png') ? 'png' : 'jpg'}`, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], text }).catch(e => { if (e?.name !== 'AbortError') throw e; });
  } else {
    await navigator.clipboard?.writeText(text).catch(() => {});
    const a = h('a', { href: URL.createObjectURL(file), download: file.name }) as HTMLAnchorElement;
    a.click();
    alert(`Photo saved and caption copied: ${text}`);
  }
}

function who(p: MyPhoto) {
  if (!p.people.length) return 'Just you';
  const named = p.people.filter(x => x.nodeId !== 0n).map(x => x.name);
  const others = p.people.length - named.length;
  return `You with ${[...named, others && `${others} other${others > 1 ? 's' : ''}`].filter(Boolean).join(', ')}`;
}

function photos(conn: DbConnection, event: string) {
  const mine = [...conn.db.myPhotos.iter()].sort((a, b) => Number(a.takenAt.microsSinceUnixEpoch - b.takenAt.microsSinceUnixEpoch));
  if (!mine.length) return h('p', { class: 'muted' }, 'No photos of you yet.');
  return h('div', { class: 'photos' }, mine.map(p => h('figure', {},
    h('img', { src: p.url }),
    h('figcaption', {},
      h('b', {}, p.caption || p.zoneName), ` · ${p.zoneName} · ${time(p.takenAt)}`,
      h('div', {}, who(p)),
      h('button', { onclick: () => act(() => share(p, event)) }, 'Share')))));
}

type Box = { x: number; y: number; w: number; h: number };
let boxes: Promise<Record<string, Record<string, Box>>> | undefined;

/** The check boxes printed on each template, by sponsor and keyed by image url, from assets/merch/templates.json. */
function checkBoxes() {
  return boxes ??= fetch('/assets/merch/templates.json')
    .then(r => r.json())
    .then(d => Object.fromEntries(Object.entries(d.templates as Record<string, { checks?: Record<string, Box> }>)
      .map(([name, t]) => [`/assets/merch/${name}`, t.checks ?? {}])))
    .catch(() => ({} as Record<string, Record<string, Box>>));
}

const picture = (src: string) => new Promise<HTMLImageElement>((ok, fail) => {
  const img = new Image();
  img.onload = () => ok(img);
  img.onerror = fail;
  img.src = src;
});

/**
 * The template image with the photo cover-cropped into its green photo box, the printed line in a strip
 * along the bottom of the photo, and a tick in the box of each sponsor whose booth you visited. Scaled by CSS.
 */
export function mockup(t: MerchSuggestion) {
  const canvas = h('canvas', { class: 'mockup', width: t.width, height: t.height }) as HTMLCanvasElement;
  Promise.all([picture(t.imageUrl), picture(t.photoUrl), checkBoxes()]).then(([base, img, checks]) => {
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(base, 0, 0, t.width, t.height);
    // The photo covers 2 px past the box, so no green shows at its antialiased edge.
    const x = t.photoX - 2, y = t.photoY - 2, w = t.photoW + 4, ph = t.photoH + 4;
    const sc = Math.max(w / img.width, ph / img.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, ph);
    ctx.clip();
    ctx.drawImage(img, x + (w - img.width * sc) / 2, y + (ph - img.height * sc) / 2, img.width * sc, img.height * sc);
    if (t.line) {
      const strip = Math.round(t.photoH * 0.17);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(t.photoX, t.photoY + t.photoH - strip, t.photoW, strip);
      let size = Math.round(strip * 0.55);
      ctx.font = `bold ${size}px system-ui, sans-serif`;
      const fit = t.photoW * 0.92;
      if (ctx.measureText(t.line).width > fit) {
        size = Math.floor(size * fit / ctx.measureText(t.line).width);
        ctx.font = `bold ${size}px system-ui, sans-serif`;
      }
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.line, t.photoX + t.photoW / 2, t.photoY + t.photoH - strip / 2);
    }
    ctx.restore();
    for (const sponsor of t.ticks) {
      const b = checks[t.imageUrl]?.[sponsor];
      if (!b) continue;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = b.w * 0.16;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(b.x + b.w * 0.2, b.y + b.h * 0.52);
      ctx.lineTo(b.x + b.w * 0.42, b.y + b.h * 0.76);
      ctx.lineTo(b.x + b.w * 0.86, b.y + b.h * 0.2);
      ctx.stroke();
    }
  }).catch(() => {});
  return canvas;
}

const mockups = new Map<string, HTMLCanvasElement>();

function balance(conn: DbConnection) {
  const w = conn.db.myWallet.iter().next().value;
  if (!w) return h('p', { class: 'muted' }, 'Connect your Capital One wallet at band setup to buy merch.');
  return h('p', { class: 'big' }, `${money(w.balanceCents)} in your BandIt wallet`, h('span', { class: 'muted' }, ` · Capital One account ${w.accountId.slice(0, 8)}`));
}

const MOVES: Record<string, string> = { opening: 'Wallet opened', payout: 'Paid in for your claim', charge: 'Charge paid', refund: 'Your deductible back' };

/** The wallet's movements, newest first: payouts in, charges and merch out. */
export function movements(conn: DbConnection) {
  const entries = [...conn.db.myWalletEntries.iter()].sort((a, b) => Number(b.id - a.id));
  const what = (kind: string, memo: string) => kind === 'purchase' ? memo.replace(/^BandIt merch: /, 'Merch: ') : MOVES[kind] ?? (memo || kind);
  return entries.length > 0 && [h('h4', {}, 'Wallet activity'), h('table', {}, entries.map(e => h('tr', {},
    h('td', {}, date(e.createdAt)), h('td', {}, what(e.kind, e.memo)),
    h('td', { class: e.amountCents < 0n ? '' : 'pass' }, `${e.amountCents < 0n ? 'out' : 'in'} ${money(e.amountCents < 0n ? -e.amountCents : e.amountCents)}`))))];
}

function merch(conn: DbConnection) {
  const picks = [...conn.db.myMerchSuggestions.iter()].sort((a, b) => a.rank - b.rank);
  const orders = [...conn.db.myMerchOrders.iter()].sort((a, b) => Number(b.id - a.id));
  const titles = new Map([...conn.db.merchTemplate.iter()].map(t => [t.id, t.title]));
  const hasWallet = !!conn.db.myWallet.iter().next().value;
  const buy = async (e: Event, t: MerchSuggestion) => {
    e.preventDefault();
    const size = t.kind === 'tee' ? field(e.target as HTMLElement, `size-${t.templateId}`) : '';
    await act(() => conn.reducers.buyMerch({ templateId: t.templateId, photoId: t.photoId, size }));
  };
  return [
    balance(conn),
    !picks.length && h('p', { class: 'muted' }, 'Merch appears once a photographer takes a photo of you.'),
    h('div', { class: 'merch' }, picks.map(t => {
      const key = `${t.templateId}:${t.photoId}:${t.line}:${t.ticks.join()}`;
      if (!mockups.has(key)) mockups.set(key, mockup(t));
      return h('figure', {}, mockups.get(key)!,
        h('figcaption', {},
          h('b', {}, t.title), ` · ${money(t.priceCents)}`,
          t.reason && h('div', {}, `Picked for you: ${t.reason}`),
          t.friends.length > 0 && h('div', { class: 'muted' }, `In the photo with ${and(t.friends)}`),
          t.ticks.length > 0 && h('div', { class: 'muted' }, `Booths you visited: ${and(t.ticks)}`),
          h('form', { onsubmit: (e: Event) => buy(e, t) },
            t.kind === 'tee' && h('label', {}, 'Size', h('select', { name: `size-${t.templateId}` },
              ['S', 'M', 'L', 'XL'].map(x => h('option', { value: x, selected: x === 'M' || undefined }, x)))),
            h('button', { disabled: !hasWallet || undefined }, `Buy ${money(t.priceCents)}`))));
    })),
    orders.length > 0 && [h('h4', {}, 'Your orders'), h('ul', {}, orders.map(o => h('li', {},
      `${titles.get(o.templateId) ?? 'Merch'}${o.size ? ` (${o.size})` : ''}${o.line ? ` "${o.line}"` : ''}, ${money(o.amountCents)}: ${o.status}${o.failure ? `, ${o.failure}` : ''}${o.nessiePurchaseId ? ` · receipt ${o.nessiePurchaseId.slice(0, 8)}` : ''}`)))],
    movements(conn),
  ];
}

/** The whole recap. `rerender` redraws the page once bandit-api answers. */
export function recap(conn: DbConnection, rerender: () => void) {
  load(conn, rerender);
  const v = conn.db.venue.iter().next().value;
  const event = v?.name ?? 'the event';
  const me = conn.db.myAttendee.iter().next().value;
  return [
    h('h2', {}, `Your ${event}`),
    h('p', {}, `Thanks for coming, ${me?.displayName ?? ''}. Here is your night.`),
    h('section', {}, h('h3', {}, 'Where you were'), spaceTime(conn)),
    h('section', {}, h('h3', {}, 'People you spent time with'), people()),
    h('section', {}, h('h3', {}, 'Also there with you'), alsoThere()),
    h('section', {}, h('h3', {}, 'Booths you spent time at'), booths()),
    h('section', {}, h('h3', {}, 'Your photos'), photos(conn, event)),
    h('section', {}, h('h3', {}, 'Make it merch'), merch(conn)),
  ];
}
