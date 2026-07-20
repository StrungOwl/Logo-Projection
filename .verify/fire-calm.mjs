// Fireplace-mode (key 5) flicker metric probe.
//
//   node .verify/fire-calm.mjs <label>
//
// Enters fireplaceOne, settles, then samples mean canvas luminance over
// two windows of 40 frames at 0.5 s virtual steps:
//   W1  t ≈  8–28 s (inside the envDim dark hold)
//   W2  t ≈ 50–70 s (spans the envDim ramp-up region)
// Reports per-window mean, std, flicker index (std/mean) and mean
// |frame-to-frame delta| / mean. Run before + after a calming change and
// compare the indices.
//
// Determinism mirrors modes.mjs (seeded PRNG, parked rAF loop, __tick).
// The fireplace choreographer (if present) is disabled so the metric
// isolates the lighting behaviour, not scheduled domino/cascade events.
import { chromium } from 'playwright';

const label = process.argv[2] || 'run';

const SETTLE_S  = 8;      // virtual seconds before the first window
const SAMPLES   = 40;     // frames per window
const STEP_S    = 0.5;    // virtual seconds between samples
const DT        = 1 / 60;

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
  // Isolate lighting: no scheduled choreography events during sampling.
  if (window.ANIM.fireplaceChoreo) window.ANIM.fireplaceChoreo.enabled = false;
});

// Advance the virtual clock `seconds` without sampling.
async function step(fromT, seconds) {
  return page.evaluate(({ fromT, seconds, dt }) => {
    let t = fromT;
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) { t += dt; window.__tick(t, dt); }
    return t;
  }, { fromT, seconds, dt: DT });
}

// Advance STEP_S, render, and read mean luminance of the live canvas via
// an OffscreenCanvas downsample (same-task as the render, so no
// preserveDrawingBuffer needed).
async function sampleWindow(fromT, samples) {
  return page.evaluate(({ fromT, samples, stepS, dt }) => {
    const lums = [];
    let t = fromT;
    const cv = window.__renderer.domElement;
    const oc = new OffscreenCanvas(128, 128);
    const g  = oc.getContext('2d', { willReadFrequently: true });
    for (let s = 0; s < samples; s++) {
      const steps = Math.round(stepS / dt);
      for (let i = 0; i < steps; i++) { t += dt; window.__tick(t, dt); }
      if (window.__pipeline) window.__pipeline.render();
      else window.__renderer.render(window.__scene, window.__camera);
      g.drawImage(cv, 0, 0, 128, 128);
      const d = g.getImageData(0, 0, 128, 128).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) {
        sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      }
      lums.push(sum / (d.length / 4));
    }
    return { t, lums };
  }, { fromT, samples, stepS: STEP_S, dt: DT });
}

function stats(lums) {
  const n = lums.length;
  const mean = lums.reduce((a, b) => a + b, 0) / n;
  const varc = lums.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std  = Math.sqrt(varc);
  let dsum = 0;
  for (let i = 1; i < n; i++) dsum += Math.abs(lums[i] - lums[i - 1]);
  const meanDelta = dsum / (n - 1);
  return {
    mean:       +mean.toFixed(3),
    std:        +std.toFixed(3),
    flickerIdx: +(std / mean).toFixed(4),
    deltaIdx:   +(meanDelta / mean).toFixed(4),
    min:        +Math.min(...lums).toFixed(3),
    max:        +Math.max(...lums).toFixed(3),
  };
}

let t = 0;
t = await step(t, SETTLE_S);
const w1 = await sampleWindow(t, SAMPLES);
t = w1.t;                                       // ≈ 28 s
t = await step(t, 50 - t > 0 ? 50 - t : 0);     // jump to 50 s
const w2 = await sampleWindow(t, SAMPLES);      // 50 → 70 s

console.log(`[fire-calm] label=${label}`);
console.log('W1 (dark hold, t≈8–28s): ', JSON.stringify(stats(w1.lums)));
console.log('W2 (ramp span, t≈50–70s):', JSON.stringify(stats(w2.lums)));
console.log('ERRORS', JSON.stringify(errors, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
