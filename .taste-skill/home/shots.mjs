// Timed frames of the home page: the intro, pointer play, a fall and the scroll spin.
// node .taste-skill/home/shots.mjs <url> <outDir> [width] [height] [modes=intro,play,scroll]
import { mkdirSync } from 'node:fs';
import { Browser, sleep } from '../../.claude/skills/design-taste-frontend/scripts/lib/cdp.mjs';

const [url, out, W = '1440', H = '900', modes = 'intro,play,scroll'] = process.argv.slice(2);
const w = +W, h = +H;
mkdirSync(out, { recursive: true });
const b = await Browser.launch({ width: w, height: h });
const p = await b.newPage({ width: w, height: h, mobile: w < 600 });
const shot = (name) => p.screenshot({ path: `${out}/${name}.jpg`, quality: 82 });
const move = (x, y) => p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }).catch(() => {});
const click = async (x, y) => {
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const set = new Set(modes.split(','));

const t0 = Date.now();
p.send('Page.navigate', { url }).catch(() => {});
if (set.has('intro')) {
  for (const t of [250, 650, 1050, 1450, 1850, 2250, 2650, 3100, 3700, 4600]) {
    await sleep(Math.max(0, t - (Date.now() - t0)));
    await shot(`intro-${String(t).padStart(4, '0')}`);
  }
} else {
  await sleep(2000);
  for (let i = 0; i < 60; i++) {
    const busy = await p.eval(`document.documentElement.classList.contains('intro')`).catch(() => true);
    if (!busy) break;
    await sleep(250);
  }
  await sleep(2500);
}
if (set.has('play')) {
  for (let i = 0; i <= 24; i++) {
    await move(Math.round(w * (0.15 + 0.7 * (i / 24))), Math.round(h * (0.78 + 0.08 * Math.sin(i / 3))));
    await sleep(30);
  }
  await shot('play-ripples');
  await click(Math.round(w * 0.28), Math.round(h * 0.82));
  for (const t of [120, 700, 1500, 2600, 3600]) {
    await sleep(t === 120 ? 120 : 500);
    await shot(`play-fall-${t}`);
  }
  await sleep(3500);
}
if (set.has('scroll')) {
  for (const y of [120, 260, 420, 640]) {
    await p.eval(`window.scrollTo({ top: ${Math.round((y / 900) * h)}, behavior: 'instant' })`);
    await p.wheel(1);
    await sleep(160);
    await shot(`scroll-${y}`);
  }
}
if (set.has('spin')) {
  const turn = Math.max(640, h * 1.1);
  for (let i = 1; i <= 48; i++) {
    await p.eval(`window.scrollBy({ top: ${Math.round(turn / 64)}, behavior: 'instant' })`);
    await sleep(40);
    if (i % 8 === 0) {
      await shot(`spin-${String(i).padStart(2, '0')}`);
      console.log(await p.eval(`document.querySelector('[data-act-spin]').style.transform`));
    }
  }
  await sleep(2600);
  await shot('spin-rest');
  await p.eval(`window.scrollBy({ top: ${Math.round(turn * 1.6)}, behavior: 'instant' })`);
  await sleep(140);
  await shot('spin-fast');
  const st = await p.eval(`JSON.stringify({ y: scrollY, max: document.documentElement.scrollHeight - innerHeight, t: document.querySelector('[data-act-spin]').style.transform })`);
  console.log(st);
}
if (set.has('mirror')) {
  const turn = Math.max(640, h * 1.1);
  await move(Math.round(w * 0.92), Math.round(h * 0.45));
  await sleep(800);
  await shot('mirror-front');
  for (let i = 0; i < 16; i++) {
    await p.eval(`window.scrollBy({ top: ${Math.round(turn / 32)}, behavior: 'instant' })`);
    await sleep(40);
  }
  await sleep(3200);
  await move(Math.round(w * 0.93), Math.round(h * 0.45));
  await sleep(600);
  await shot('mirror-back');
  console.log(await p.eval(`document.querySelector('[data-act-spin]').style.transform`));
}
if (set.has('model')) {
  const turn = Math.max(640, h * 1.1);
  const crop = async (name) => {
    const r = await p.eval(`(() => { const c = document.querySelector('.band-3d'); if (!c) return null; const b = c.getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height }; })()`);
    if (!r) { await shot(name); return; }
    const x = Math.max(0, r.x + r.w * 0.12), y = Math.max(0, r.y + r.h * 0.06);
    await p.screenshot({ path: `${out}/${name}.jpg`, quality: 88, clip: { x, y, width: r.w * 0.76, height: r.h * 0.84, scale: 1.5 } });
  };
  await shot('model-full');
  await crop('model-rest');
  let done = 0;
  for (const deg of [60, 120, 180, 240, 300]) {
    const steps = Math.round(((deg - done) / 360) * 64);
    for (let i = 0; i < steps; i++) {
      await p.eval(`window.scrollBy({ top: ${Math.round(turn / 64)}, behavior: 'instant' })`);
      await sleep(30);
    }
    done = deg;
    await sleep(260);
    await crop(`model-${deg}`);
  }
  await sleep(2600);
  await click(Math.round(w * 0.3), Math.round(h * 0.85));
  for (let i = 0; i < 6; i++) {
    await sleep(70);
    await crop(`model-fall-${i}`);
  }
}
if (set.has('sections')) {
  const sels = ['#night', '#safety', '#why', '.crowd', '#merch', '.cta', '.foot'];
  for (const sel of sels) {
    await p.eval(`(() => { const el = document.querySelector('${sel}'); window.scrollTo({ top: el.getBoundingClientRect().top + scrollY + ${sel === '.cta' ? -200 : 0}, behavior: 'instant' }); })()`);
    await p.wheel(1);
    await sleep(1400);
    await shot(`section-${sel.replace(/[#.]/g, '')}`);
  }
}
console.log(JSON.stringify({ errors: p.consoleErrors }, null, 1));
await b.close();
process.exit(0);
