// Fireplace choreographer probe — verifies mode 5 starts STILL and comes
// alive on its own.
//
//   node .verify/fire-choreo.mjs <label>
//
// Enters fireplaceOne with the choreographer enabled, then shoots:
//   still-t2   — ~2 s after entry (inside the start-delay hold; bricks at rest)
//   live-t20   — around 20 s (stepping up to +20 s extra until a wave is
//                actually running, so the shot catches bricks mid-flip)
//   live-t60   — around 60 s (same wave-hunting)
// Also dumps window.__fireChoreo.events so the schedule is auditable.
// Determinism mirrors modes.mjs (seeded PRNG, parked loop, __tick).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const label = process.argv[2] || 'choreo';
const OUT = join('.verify', 'shots', label);
mkdirSync(OUT, { recursive: true });
const DT = 1 / 60;

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Users/root/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',
});
const ctxBr = await browser.newContext({ viewport: { width: 1024, height: 1024 } });
const page = await ctxBr.newPage();

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
page.on('console', msg => {
  if (msg.type() === 'error') {
    const txt = msg.text();
    if (!txt.includes('favicon')) errors.push('console.error: ' + txt);
  }
});

await page.goto('http://127.0.0.1:5501/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => window.__ctx && window.__ctx.logoMaterials && window.__tick,
  null, { timeout: 30000 },
);
await page.evaluate(() => {
  window.__ctx.paused = true;
  window.ANIM.viewMode = 'fireplaceOne';
});

async function step(fromT, seconds) {
  return page.evaluate(({ fromT, seconds, dt }) => {
    let t = fromT;
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) { t += dt; window.__tick(t, dt); }
    if (window.__pipeline) window.__pipeline.render();
    else window.__renderer.render(window.__scene, window.__camera);
    return t;
  }, { fromT, seconds, dt: DT });
}

const choreo = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__fireChoreo || {})));

// Step in 1 s chunks until the choreographer reports an active wave (or
// budget runs out), then render + return.
async function stepUntilWave(fromT, budgetS) {
  let t = fromT;
  for (let i = 0; i < budgetS; i++) {
    const c = await choreo();
    if (c.state === 'wave') return { t, waving: true };
    t = await step(t, 1);
  }
  return { t, waving: (await choreo()).state === 'wave' };
}

let t = 0;

// --- Stillness check: ~2 s after entry, inside the start-delay hold ---
t = await step(t, 2);
const c2 = await choreo();
await page.screenshot({ path: join(OUT, 'still-t2.png') });
console.log(`t=${t.toFixed(1)}  state=${c2.state}  (expect 'holding')`);

// --- ~20 s: first wave should be flowing (start delay 8–16 s) ---------
t = await step(t, 16);
let r = await stepUntilWave(t, 20);
t = r.t;
await page.screenshot({ path: join(OUT, 'live-t20.png') });
console.log(`t=${t.toFixed(1)}  waving=${r.waving}  shot live-t20`);

// --- ~60 s: later, fuller events -------------------------------------
if (t < 58) t = await step(t, 58 - t);
r = await stepUntilWave(t, 30);
t = r.t;
// Step a beat into the wave so bricks are visibly mid-flip.
if (r.waving) t = await step(t, 2.5);
await page.screenshot({ path: join(OUT, 'live-t60.png') });
console.log(`t=${t.toFixed(1)}  waving=${r.waving}  shot live-t60`);

const cEnd = await choreo();
console.log('choreo state:', cEnd.state, ' nextEventT:', cEnd.nextEventT);
console.log('events:', JSON.stringify(cEnd.events));
console.log('ERRORS', JSON.stringify(errors, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
