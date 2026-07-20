// All-modes deterministic screenshot probe.
//
//   node .verify/modes.mjs <label> [modes]
//
//   <label>  subfolder under .verify/shots/ (e.g. "baseline", "phase2")
//   [modes]  optional comma list of digit keys to probe (default: all known)
//
// Requires the app server on http://127.0.0.1:5501 (start.bat).
//
// Determinism strategy:
//   - Math.random is replaced with a seeded PRNG *before* the app loads, so
//     placement jitter + spark spawns follow the same sequence every run.
//   - The live rAF loop is parked via __ctx.paused; the probe advances the
//     scene itself through window.__tick(t, dt) with a fixed 1/60 step and
//     renders once per screenshot. Identical code paths → identical pixels.
//   - Caveat: a refactor that changes the *order* of Math.random() calls
//     shifts all downstream jitter. Shots stay comparable by eye, but a
//     pixel diff will light up — check the visuals, not just the diff.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const label = process.argv[2] || 'run';
const OUT = join('.verify', 'shots', label);
mkdirSync(OUT, { recursive: true });

// key → mode name (must mirror the modeByKey map in src/main.js).
const ALL_MODES = {
  0: 'visualSequence',
  1: 'moltenGold',
  2: 'fractalPattern',
  3: 'hexagons',
  4: 'flowers',
  5: 'fireplaceOne',
  6: 'fireplaceTwo',   // depth portal
  7: 'flameOnly',      // constellations
  // 9: 'calibration'
};
const modeKeys = (process.argv[3] || Object.keys(ALL_MODES).join(','))
  .split(',').map(s => s.trim()).filter(Boolean);

// Per-mode settle time (seconds of simulated clock before the screenshot)
// and extra sample offsets for animated looks.
const SETTLE_S  = 6;
const EXTRA_S   = [2, 4];   // additional shots after settle, at +2s / +4s
const DT        = 1 / 60;

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Users/root/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',
});
const ctxBr = await browser.newContext({ viewport: { width: 1024, height: 1024 } });
// BLOCK_EXTERNAL=1 simulates an offline venue: any request that isn't
// 127.0.0.1/localhost is aborted. With vendored deps the app must still boot.
const blockExternal = process.env.BLOCK_EXTERNAL === '1';
await ctxBr.route('**/*', (route) => {
  const url = route.request().url();
  if (blockExternal && !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    console.log('BLOCKED external request:', url);
    return route.abort();
  }
  const headers = { ...route.request().headers(), 'cache-control': 'no-cache' };
  route.continue({ headers });
});
const page = await ctxBr.newPage();

// Seeded PRNG (mulberry32) installed before any app code runs, and the
// live loop parked from frame zero (main.js checks __PROBE_PAUSED) so no
// real-time frames consume the RNG before the probe takes over.
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

// Wait for the async logo load to finish wiring the scene.
await page.waitForFunction(
  () => window.__ctx && window.__ctx.logoMaterials && window.__tick,
  null, { timeout: 30000 },
);

// Park the live loop; from here the probe owns time.
await page.evaluate(() => { window.__ctx.paused = true; });

// POST_OFF=1 forces the legacy direct-render pipeline (composer bypass) —
// used to prove the bypass is exactly the pre-composer look.
if (process.env.POST_OFF === '1') {
  await page.evaluate(() => { if (window.ANIM.post) window.ANIM.post.enabled = false; });
}

// step(seconds): advance the simulated clock without rendering each tick
// (tick mutates state; only the final frame needs a render).
async function stepAndShot(fromT, seconds, shotPath) {
  return page.evaluate(({ fromT, seconds, dt, shot }) => {
    let t = fromT;
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) { t += dt; window.__tick(t, dt); }
    // Render through the pipeline (composer-aware); fall back for old builds.
    if (window.__pipeline) window.__pipeline.render();
    else window.__renderer.render(window.__scene, window.__camera);
    return t;
  }, { fromT, seconds, dt: DT, shot: shotPath });
}

let t = 0;
for (const key of modeKeys) {
  const mode = ALL_MODES[key] || null;
  const setOk = await page.evaluate((k) => {
    // Prefer the real keyboard path once transitions exist; direct write is
    // the deterministic route (transition manager adopts external writes).
    const byKey = {
      0: 'visualSequence', 1: 'moltenGold', 2: 'fractalPattern', 3: 'hexagons',
      4: 'flowers', 5: 'fireplaceOne', 6: 'fireplaceTwo', 7: 'flameOnly',
      9: 'calibration',
    };
    const m = byKey[k];
    if (!m) return false;
    window.ANIM.viewMode = m;
    return true;
  }, key);
  if (!setOk) { console.log(`skip unknown mode key ${key}`); continue; }

  t = await stepAndShot(t, SETTLE_S, null);
  await page.screenshot({ path: join(OUT, `mode${key}-a.png`) });
  for (let i = 0; i < EXTRA_S.length; i++) {
    t = await stepAndShot(t, EXTRA_S[i] - (i > 0 ? EXTRA_S[i - 1] : 0), null);
    await page.screenshot({ path: join(OUT, `mode${key}-${'bc'[i]}.png`) });
  }
  console.log(`mode ${key} (${mode}) captured at t≈${t.toFixed(1)}s`);
}

console.log('ERRORS', JSON.stringify(errors, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
