// Layer director probe: pictures of layers.html (one visual, then a mix).
//
//   [SHAPE=fire04 OUT=layers WAIT=9] node .verify/layers-probe.mjs
//
// Needs the app on http://127.0.0.1:5501 (python3 -m http.server 5501).
// The three shows run on their own clocks here (real time), so the
// pictures are not the same on every run.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const E = process.env;
const SHAPE = E.SHAPE || 'fire04';
const W = Number(E.W || 1280), H = Number(E.H || 720);
const OUT = join('.verify', 'shots', E.OUT || 'layers');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: E.CHROME });
const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console.error: ' + m.text().slice(0, 300)); });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:5501/layers.html?shape=${SHAPE}&proj=1&w=${W}&h=${H}&stats=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const s = window.__layers?.state(); return s && s.ready.every(Boolean) && s.zonesDrawn; }, null, { timeout: 180000 });
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
const st = () => page.evaluate(() => { const s = window.__layers.state(); return { fps: s.fps, mixed: s.mixed, accentsOn: s.accentsOn, plan: s.plan && { story: s.plan.storyMode, accents: s.plan.accents, pattern: s.plan.pattern }, w: s.weights.map(v => Math.round(v * 100) / 100).join(' ') }; });
await page.waitForTimeout(4000);
await page.screenshot({ path: join(OUT, `${SHAPE}-1-one-visual.png`) });
console.log('one visual', JSON.stringify(await st()));
await page.evaluate(() => window.__layers.mix());
await page.waitForTimeout(Number(E.WAIT || 9) * 1000);
await page.screenshot({ path: join(OUT, `${SHAPE}-2-mix.png`) });
console.log('mix       ', JSON.stringify(await st()));
await page.evaluate(() => window.__layers.setLines(false));
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, `${SHAPE}-3-mix-no-lines.png`) });
await page.evaluate(() => { window.__layers.setLines(true); window.__layers.unite(); });
await page.waitForTimeout(5000);
await page.screenshot({ path: join(OUT, `${SHAPE}-4-back.png`) });
console.log('back      ', JSON.stringify(await st()));
if (errors.length) console.log('ERRORS', JSON.stringify([...new Set(errors)].slice(0, 12), null, 1)); else console.log('ERRORS []');
await browser.close();
