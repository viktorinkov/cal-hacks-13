// Reduced-motion still of the home page.
import { Browser, sleep } from '../../.claude/skills/design-taste-frontend/scripts/lib/cdp.mjs';
const [url, out] = process.argv.slice(2);
const b = await Browser.launch({ width: 1440, height: 900 });
const p = await b.newPage({ width: 1440, height: 900 });
await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
p.send('Page.navigate', { url }).catch(() => {});
await sleep(2500);
await p.screenshot({ path: out, quality: 82 });
console.log(await p.eval(`JSON.stringify({ h: document.documentElement.scrollHeight, edges: document.querySelectorAll('.act-edge').length, errors: 0 })`));
console.log(JSON.stringify(p.consoleErrors));
await b.close();
process.exit(0);
