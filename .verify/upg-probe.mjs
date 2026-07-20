// Time-coverage probe for the hex morph wall (mode 3) and the
// five-pattern flower cycle (mode 4). Copies modes.mjs's deterministic
// structure (seeded PRNG, parked rAF, fixed-step __tick) but:
//   - accepts an explicit comma list of absolute sim times to shoot,
//   - optionally shortens dwells via page.evaluate so long-form
//     behaviour (size retargets, shape morphs, pattern cycling) is
//     visible in a handful of stills.
//
//   node .verify/upg-probe.mjs <label> <modeKey> <t1,t2,...> [fast]
//
//   fast — mode 3: sizeEvolve retargets every ~4-6s, shapeMorph 3×.
//          mode 4: flowerPatterns dwell 3s / transit 2.5s.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const label   = process.argv[2] || 'upg';
const modeKey = process.argv[3] || '3';
const times   = (process.argv[4] || '6,12,18,24,30')
  .split(',').map(Number).filter(x => Number.isFinite(x)).sort((a, b) => a - b);
const fast    = process.argv[5] === 'fast';

const OUT = join('.verify', 'shots', label);
mkdirSync(OUT, { recursive: true });

const MODES = {
  0: 'visualSequence', 1: 'moltenGold', 2: 'fractalPattern', 3: 'hexagons',
  4: 'flowers', 5: 'fireplaceOne', 6: 'fireplaceTwo', 7: 'flameOnly',
};
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
await page.evaluate(() => { window.__ctx.paused = true; });

await page.evaluate(({ modeKey, fast }) => {
  const byKey = {
    0: 'visualSequence', 1: 'moltenGold', 2: 'fractalPattern', 3: 'hexagons',
    4: 'flowers', 5: 'fireplaceOne', 6: 'fireplaceTwo', 7: 'flameOnly',
  };
  window.ANIM.viewMode = byKey[modeKey] || 'hexagons';
  if (!fast) return;
  const bw = window.ANIM.overlay && window.ANIM.overlay.brickWall;
  if (modeKey === '3' && bw) {
    if (bw.sizeEvolve) {
      bw.sizeEvolve.retargetMin = 4;
      bw.sizeEvolve.retargetMax = 6;
      bw.sizeEvolve.retargetDur = 3;
    }
    if (bw.shapeMorph) bw.shapeMorph.rate = (bw.shapeMorph.rate || 1.2) * 3;
  }
  if (modeKey === '4' && window.ANIM.overlay.flowerPatterns) {
    window.ANIM.overlay.flowerPatterns.dwell   = 3.0;
    window.ANIM.overlay.flowerPatterns.transit = 2.5;
  }
}, { modeKey, fast });

let t = 0;
for (const target of times) {
  const seconds = target - t;
  if (seconds < 0) continue;
  t = await page.evaluate(({ fromT, seconds, dt }) => {
    let t = fromT;
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) { t += dt; window.__tick(t, dt); }
    if (window.__pipeline) window.__pipeline.render();
    else window.__renderer.render(window.__scene, window.__camera);
    return t;
  }, { fromT: t, seconds, dt: DT });
  await page.screenshot({ path: join(OUT, `m${modeKey}-t${String(target).padStart(3, '0')}.png`) });
  console.log(`mode ${modeKey} shot at t=${t.toFixed(2)}s`);
}

console.log('ERRORS', JSON.stringify(errors, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
