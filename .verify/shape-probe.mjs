// Shape probe — pictures of every look on any surface / shape.
//
//   [QUERY='shape=mandala' W=1280 H=720 MODES=a,b TIMES=6,14 OUT=label] node .verify/shape-probe.mjs
//
//   QUERY  extra URL parameters (shape=, hole=, surface=screen ...)
//   MODES  comma list of viewMode names (default: every look)
//   TIMES  seconds after the mode starts at which a picture is taken
//   OUT    folder name under .verify/shots/
//   FRESH  1 = reload the page for every mode (clean state, slower)
//
// Needs the app on http://127.0.0.1:5501 (python3 -m http.server 5501).
// The clock is driven by the probe (window.__tick), so runs repeat.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const E = process.env;
const W = Number(E.W || 1280), H = Number(E.H || 720);
const QUERY = E.QUERY || '';
const ALL = ['moltenGold', 'flameOnly', 'fireplaceTwo', 'starDive', 'strata', 'shards',
             'hexagons', 'flowers', 'fireplaceOne', 'fractalPattern', 'visualSequence', 'mercury'];
const MODES = (E.MODES ? E.MODES.split(',') : ALL).map(s => s.trim()).filter(Boolean);
const TIMES = (E.TIMES || '6,14').split(',').map(Number);
const OUT = join('.verify', 'shots', E.OUT || 'shape');
const FRESH = E.FRESH === '1';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: E.CHROME });
const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
await page.addInitScript(() => {
  window.__PROBE_PAUSED = true;
  let s = 0x1234abcd;
  Math.random = function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
});
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => {
  const txt = m.text();
  if (m.type() === 'error' && !txt.includes('favicon')) errors.push('console.error: ' + txt.slice(0, 400));
  if (E.LOG === '1' && m.type() === 'log') console.log('  [page]', txt.slice(0, 300));
});

const url = `http://127.0.0.1:5501/index.html?proj=1&w=${W}&h=${H}${QUERY ? '&' + QUERY : ''}`;
async function boot() {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ctx?.logoMaterials && window.__tick, null, { timeout: 90000 });
  await page.evaluate(() => {
    window.__ctx.paused = true;
    if (window.__sequencer?.stop) window.__sequencer.stop();
    else if (window.__sequencer?.pause) window.__sequencer.pause();
    window.__t = 0;
    // Let the boot transition finish, so the first mode write is kept.
    const dt = 1 / 60;
    for (let i = 0; i < 240; i++) { window.__t += dt; window.__tick(window.__t, dt); }
  });
}
const run = (mode, secs) => page.evaluate(({ mode, secs }) => {
  const dt = 1 / 60;
  if (mode) window.ANIM.viewMode = mode;
  let n = Math.round(secs * 60);
  const t0 = performance.now();
  while (n-- > 0) { window.__t += dt; window.__tick(window.__t, dt); }
  window.__pipeline.render();
  return { t: window.__t, ms: performance.now() - t0 };
}, { mode, secs });

const t0 = Date.now();
await boot();
let first = true;
for (const mode of MODES) {
  if (FRESH && !first) await boot();
  first = false;
  let prev = 0;
  for (const at of TIMES) {
    await run(mode, at - prev); prev = at;
    await page.screenshot({ path: join(OUT, `${mode}-${String(at).padStart(2, '0')}s.png`) });
  }
  console.log(`${mode} done`);
}
console.log(`shape-probe: ${MODES.length} modes -> ${OUT} (${((Date.now() - t0) / 1000).toFixed(0)}s)  ${url}`);
if (errors.length) console.log('ERRORS', JSON.stringify([...new Set(errors)].slice(0, 15), null, 1));
await browser.close();
