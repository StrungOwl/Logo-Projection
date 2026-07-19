// Domino ring-wave probe (task 2 verification).
//
//   node .verify/p7-domino.mjs [label]
//
// Switches to mode 4, settles 6s of stepped time, fires
// window.__triggers.fire('domino.toggle'), then screenshots every 0.5s
// of stepped time × 6 — rings of bricks should be visibly mid-flip
// TOGETHER, with multiple rings simultaneously airborne. Fires the
// toggle again at the end to stop. Exits non-zero on any console error.
//
// Optional env:
//   LEGACY_DOMINO=1  → sets ANIM.dominoFlip.epicenters = 0 before the
//                      trigger so the old centroid-descending wave runs.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const label = process.argv[2] || 'p7-domino';
const OUT = join('.verify', 'shots', label);
mkdirSync(OUT, { recursive: true });

const DT = 1 / 60;

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Users/root/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',
});
const ctxBr = await browser.newContext({ viewport: { width: 1024, height: 1024 } });
await ctxBr.route('**/*', (route) => {
  const headers = { ...route.request().headers(), 'cache-control': 'no-cache' };
  route.continue({ headers });
});
const page = await ctxBr.newPage();

// Seeded PRNG + parked live loop, same strategy as modes.mjs.
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
await page.evaluate(() => { window.__ctx.paused = true; });

// Mode 4 + optional legacy-domino override.
await page.evaluate((legacy) => {
  window.ANIM.viewMode = 'fireplaceOne';
  if (legacy) window.ANIM.dominoFlip.epicenters = 0;
}, process.env.LEGACY_DOMINO === '1');

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

// Settle 6s of stepped time, then trigger the domino wave. The trigger
// registers at clock.elapsedTime (0 while the probe has the rAF loop
// parked); on the first stepped tick updateDominoes sees that stale
// cycle as complete and auto-retriggers at the STEPPED clock, so the
// wave cleanly restarts on our deterministic timeline.
let t = await step(0, 6);
await page.evaluate(() => { window.__triggers.fire('domino.toggle'); });

for (let i = 0; i < 6; i++) {
  t = await step(t, 0.5);
  await page.screenshot({ path: join(OUT, `domino-${i}.png`) });
}

// Stop the wave; one more frame to confirm bricks snap back to rest.
await page.evaluate(() => { window.__triggers.fire('domino.toggle'); });
t = await step(t, 0.25);
await page.screenshot({ path: join(OUT, `domino-off.png`) });

console.log('ERRORS', JSON.stringify(errors, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
