// The recap the tap link shows once the host ends the event or the attendee leaves early, top to bottom: where you were and when
// (live from SpacetimeDB), the people and booths you spent time with and the people you were near but
// never met (ranked by Elastic through bandit-api, each person with why they are there), your photos with the people in them and tap-to-share, then merch
// made from them, paid from the Nessie wallet.

import { act, api, apiSession, date, field, h, handleLinks, money, time } from './lib';
import type { DbConnection } from './module_bindings';
import type { MerchSuggestion, MyPhoto } from './module_bindings/types';
import { friendSearch } from './friend-search';

type Person = { node_id: number; name: string; photo_url: string; handles: Record<string, string> };

/** A booth someone's band stood at, with their minutes and yours; `shared` when you both stood there. */
type Interest = { booth_id: number; name: string; minutes: number; your_minutes: number; shared: boolean };

/** When you share no booth: their booth closest to your interests, yours closest to it, and a tag both carry (or ''). */
type Similar = { your_booth: string; their_booth: string; topic: string };

/** Someone you spent time with, how you met, and their interests, the shared ones first. */
type Suggested = Person & { minutes: number; met_zone_name: string; met_at: string; interests: Interest[]; photos_together: number; similar: Similar | null };

/** One place you were both in, from when and for how long. */
type Place = { zone_name: string; started_at: string; minutes: number };

/** Someone you were near but never met: every place you shared, most minutes first, and their interests. */
type Near = Person & { minutes: number; places: Place[]; interests: Interest[]; similar: Similar | null };

export type Recap = {
  display_name: string;
  suggested_people: Suggested[];
  also_there: Near[];
  suggested_booths: { booth_id: number; name: string; zone_name: string }[];
};

let data: Recap | undefined;
let loadedFor = 0;
let loading = false;
let session = '';

/** When the attendee walked out early, else when the host ended the event, else `running`; the night is drawn up to then. */
function endedAt(conn: DbConnection, running = Date.now()): number {
  const left = conn.db.myDeparture.iter().next().value?.leftAt;
  return (left ?? conn.db.eventState.id.find(0)?.endedAt)?.toDate().getTime() ?? running;
}

/**
 * Asks bandit-api for the people and booths in Elastic's order, once per "Event ended", and tries
 * again every 5 s until it answers.
 */
async function load(conn: DbConnection, rerender: () => void) {
  // While the event runs (the organizer's View as), one answer serves until it ends.
  const end = endedAt(conn, 0);
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

/**
 * "Met at Stage at 09:40 PM · 25 min together · 2 shared interests · 2 photos together", leaving out what is
 * empty, and the place and minutes when the line above already says them (`said`).
 */
function howYouMet(p: Suggested, said: boolean) {
  const min = Math.round(p.minutes), n = p.photos_together, shared = p.interests.filter(i => i.shared).length;
  return [
    p.met_at && `Met${p.met_zone_name && !said ? ` at ${p.met_zone_name}` : ''} at ${clock(Date.parse(p.met_at))}`,
    min > 0 && !said && `${min} min together`,
    shared > 0 && `${shared} shared interest${shared > 1 ? 's' : ''}`,
    n > 0 && `${n} photo${n > 1 ? 's' : ''} together`,
  ].filter(Boolean).join(' · ');
}

const mins = (m: number) => `${Math.max(1, Math.round(m))} min`;
const firstName = (name: string) => name.split(' ')[0];

/** "the Visa booth", "the Visa and Elastic booths". */
function boothPhrase(names: string[]) {
  return `the ${and(names.map(n => n.replace(/\s+booth$/i, '')))} booth${names.length > 1 ? 's' : ''}`;
}

/**
 * Why this person is on your recap, read off the booths: the ones you both hung out at, else the closest
 * pair by meaning, else `place` (null when there is none of these).
 */
function why(p: { name: string; interests: Interest[]; similar: Similar | null }, never: boolean, place: string | false) {
  const shared = p.interests.filter(i => i.shared), end = never ? ' but never met' : '';
  if (shared.length === 1) {
    const i = shared[0];
    return `You both hung out at ${boothPhrase([i.name])} (${mins(i.your_minutes)} you, ${mins(i.minutes)} ${firstName(p.name)})${end}`;
  }
  if (shared.length > 1) return `You both hung out at ${boothPhrase(shared.slice(0, 3).map(i => i.name))}${end}`;
  if (p.similar) {
    const s = p.similar, pair = `you stood at ${s.your_booth}, ${firstName(p.name)} at ${s.their_booth}`;
    const topic = /^[A-Z0-9]+$/.test(s.topic) ? s.topic : s.topic.toLowerCase();
    return topic ? `You're both into ${topic}: ${pair}` : `Close interests: ${pair}`;
  }
  return place || null;
}

/** "Into: Visa 8 min, Elastic 3 min", their top booths, the ones you both stood at first and in bold. */
function into(p: Near) {
  if (!p.interests.length) return false;
  const top = p.interests.slice(0, 5);
  return h('div', {}, 'Into: ', top.flatMap((i, k) => [k > 0 ? ', ' : '', i.shared ? h('b', {}, `${i.name} ${mins(i.minutes)}`) : `${i.name} ${mins(i.minutes)}`]));
}

/** The booths they stood at, with their minutes and yours: the ones you both stood at first, in bold. */
function interests(p: Suggested) {
  if (!p.interests.length) return false;
  return h('table', {},
    h('tr', {}, h('th', {}, 'Interests'), h('th', {}, p.name), h('th', {}, 'You')),
    p.interests.map(i => i.shared
      ? h('tr', { class: 'pass' }, h('td', {}, h('b', {}, i.name)), h('td', {}, h('b', {}, mins(i.minutes))), h('td', {}, h('b', {}, mins(i.your_minutes))))
      : h('tr', {}, h('td', {}, i.name), h('td', {}, mins(i.minutes)), h('td', {}))));
}

function people() {
  if (!data) return h('p', { class: 'muted' }, 'Loading…');
  if (!data.suggested_people.length) return h('p', { class: 'muted' }, 'Nobody stayed close to you long enough to count.');
  return h('ul', { class: 'cards' }, data.suggested_people.map(p => {
    const place = p.met_zone_name && `You spent ${mins(p.minutes)} together at ${p.met_zone_name}`;
    const reason = why(p, false, place);
    return h('li', {},
      p.photo_url && h('img', { class: 'face', src: p.photo_url }),
      h('b', {}, p.name),
      reason && h('div', {}, reason),
      h('div', { class: 'muted' }, howYouMet(p, !!place && reason === place)),
      interests(p),
      socials(p));
  }));
}

const at = (pl: Place) => `${pl.zone_name} for ${mins(pl.minutes)} from ${clock(Date.parse(pl.started_at))}`;

/** The people you were in the same place with for a while but never met, best match for your interests first. */
function alsoThere() {
  if (!data) return h('p', { class: 'muted' }, 'Loading…');
  if (!data.also_there.length) return h('p', { class: 'muted' }, 'Nobody else was in the same place as you for long.');
  return h('ul', { class: 'cards' }, data.also_there.map(p => {
    const place = p.places.length > 0 && `You were both at ${at(p.places[0])} but never met`;
    const reason = why(p, true, place);
    const shared = p.interests.filter(i => i.shared).length;
    const facts = [
      ...p.places.slice(reason === place ? 1 : 0).map(pl => `At ${at(pl)}`),
      shared > 0 && `${shared} shared interest${shared > 1 ? 's' : ''}`,
    ].filter(Boolean).join(' · ');
    return h('li', {},
      p.photo_url && h('img', { class: 'face', src: p.photo_url }),
      h('b', {}, p.name),
      reason && h('div', {}, reason),
      facts && h('div', { class: 'muted' }, facts),
      into(p),
      socials(p));
  }));
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

/** Everyone the bands put in the photo with you, by name and socials. */
function who(p: MyPhoto) {
  if (!p.people.length) return h('div', { class: 'muted' }, 'Just you');
  return [
    h('div', {}, 'You with:'),
    h('ul', {}, p.people.map(x => h('li', {},
      h('b', {}, x.name), ' ',
      x.handles.length ? handleLinks(x.handles) : h('span', { class: 'muted' }, 'no socials shared')))),
  ];
}

function photos(conn: DbConnection, event: string) {
  const mine = [...conn.db.myPhotos.iter()].sort((a, b) => Number(a.takenAt.microsSinceUnixEpoch - b.takenAt.microsSinceUnixEpoch));
  if (!mine.length) return h('p', { class: 'muted' }, 'No photos of you yet.');
  return h('div', { class: 'photos' }, mine.map(p => h('figure', {},
    h('img', { src: p.url }),
    h('figcaption', {},
      h('b', {}, p.caption || p.zoneName), ` · ${p.zoneName} · ${time(p.takenAt)}`,
      who(p),
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

const MOVES: Record<string, string> = { opening: 'Wallet opened', payout: 'Paid in for your claim', charge: 'Charge paid' };

/** The wallet's movements, newest first: payouts in, charges and merch out. */
export function movements(conn: DbConnection) {
  const entries = [...conn.db.myWalletEntries.iter()].sort((a, b) => Number(b.id - a.id));
  const what = (kind: string, memo: string) => {
    if (kind === 'purchase') return memo.replace(/^BandIt merch: /, 'Merch: ');
    const claim = kind === 'payout' && memo.match(/claim (\d+)/)?.[1];
    return claim ? `Paid in for claim ${claim}` : MOVES[kind] ?? (memo || kind);
  };
  return entries.length > 0 && [h('h4', {}, 'Wallet activity'), h('table', {}, entries.map(e => h('tr', {},
    h('td', {}, date(e.createdAt)), h('td', {}, what(e.kind, e.memo)),
    h('td', { class: e.amountCents < 0n ? '' : 'pass' }, `${e.amountCents < 0n ? 'out' : 'in'} ${money(e.amountCents < 0n ? -e.amountCents : e.amountCents)}`))))];
}

/** The same shop during the event and in the recap, with its wallet shown once. */
export function merch(conn: DbConnection) {
  const picks = [...conn.db.myMerchSuggestions.iter()].sort((a, b) => a.rank - b.rank);
  const orders = [...conn.db.myMerchOrders.iter()].sort((a, b) => Number(b.id - a.id));
  const shipping = new Map([...conn.db.myMerchShipping.iter()].map(s => [s.orderId, s.shippingAddress]));
  const titles = new Map([...conn.db.merchTemplate.iter()].map(t => [t.id, t.title]));
  const hasWallet = !!conn.db.myWallet.iter().next().value;
  const shopper = conn.db.myAttendee.iter().next().value?.nodeId ?? 0n;
  const buy = async (e: Event, t: MerchSuggestion) => {
    e.preventDefault();
    const size = t.kind === 'tee' ? field(e.target as HTMLElement, `size-${t.templateId}`) : '';
    const shippingAddress = field(e.target as HTMLElement, `shipping-${shopper}-${t.templateId}`);
    await act(() => conn.reducers.buyMerchWithShipping({ templateId: t.templateId, photoId: t.photoId, size, shippingAddress }));
  };
  return h('section', {}, h('h3', {}, 'Make it merch'),
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
            h('label', {}, 'Shipping address (recipient and full mailing address)',
              h('textarea', { name: `shipping-${shopper}-${t.templateId}`, rows: 4, required: true, maxlength: 1000, placeholder: 'Recipient name\nStreet address and apartment\nCity, state, postal code\nCountry' })),
            h('button', { disabled: !hasWallet || undefined }, `Buy ${money(t.priceCents)}`))));
    })),
    orders.length > 0 && [h('h4', {}, 'Your orders'), h('ul', {}, orders.map(o => h('li', {},
      `${titles.get(o.templateId) ?? 'Merch'}${o.size ? ` (${o.size})` : ''}${o.line ? ` "${o.line}"` : ''}, ${money(o.amountCents)}: ${o.status}${o.failure ? `, ${o.failure}` : ''}${o.nessiePurchaseId ? ` · receipt ${o.nessiePurchaseId.slice(0, 8)}` : ''}`,
      h('div', { style: 'white-space: pre-line' }, shipping.has(o.id) ? `Ship to: ${shipping.get(o.id)}` : 'Shipping address not recorded.'))))],
    movements(conn),
  );
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
    friendSearch(conn),
    h('section', {}, h('h3', {}, 'People you spent time with'), people()),
    h('section', {}, h('h3', {}, 'Also there with you'), alsoThere()),
    h('section', {}, h('h3', {}, 'Booths you spent time at'), booths()),
    h('section', {}, h('h3', {}, 'Your photos'), photos(conn, event)),
    merch(conn),
  ];
}
