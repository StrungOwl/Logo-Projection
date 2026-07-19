// Pipeline probe: projection mode asserts + calibration patterns
// (+ post on/off A-B matrix once the composer lands in Phase 4).
//
//   node .verify/verify-pipeline.mjs
//
// Server must be running on 127.0.0.1:5501.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join('.verify', 'shots', 'pipeline');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Users/root/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',
});
const page = await browser.newContext({ viewport: { width: 1280, height: 800 } }).then(c => c.newPage());

const errors = [];
const failures = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console.error: ' + m.text());
});
function assert(cond, label) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures.push(label);
}

await page.addInitScript(() => { window.__PROBE_PAUSED = true; });
await page.goto('http://127.0.0.1:5501/index.html?proj=1&w=1920&h=1080', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ctx?.logoMaterials && window.__tick, null, { timeout: 30000 });
// Boot projection.enable() runs inside the same .then that sets logoMaterials.
await page.waitForFunction(() => {
  const c = document.querySelector('canvas');
  return c && c.width === 1920;
}, null, { timeout: 5000 }).catch(() => {});

const probe = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const r = window.__renderer;
  return {
    canvasW: c.width, canvasH: c.height,
    cssW: c.style.width, cssH: c.style.height, cssPos: c.style.position,
    pixelRatio: r.getPixelRatio(),
    fov: window.__camera.fov,
    aspect: Math.round(window.__camera.aspect * 1000) / 1000,
  };
});
assert(probe.canvasW === 1920 && probe.canvasH === 1080, `canvas is 1920x1080 (got ${probe.canvasW}x${probe.canvasH})`);
assert(probe.pixelRatio === 1, `pixelRatio 1 (got ${probe.pixelRatio})`);
assert(probe.fov === 20, `locked fov 20 (got ${probe.fov})`);
assert(probe.aspect === Math.round(1920 / 1080 * 1000) / 1000, `aspect 16:9 (got ${probe.aspect})`);
assert(probe.cssPos === 'absolute' && probe.cssW.endsWith('px'), `letterbox CSS applied (${probe.cssPos} ${probe.cssW}x${probe.cssH})`);

// Render some settled frames, shoot the projection framing.
await page.evaluate(() => {
  window.__ctx.paused = true;
  let t = 0;
  for (let i = 0; i < 360; i++) { t += 1 / 60; window.__tick(t, 1 / 60); }
  window.__renderer.render(window.__scene, window.__camera);
});
await page.screenshot({ path: join(OUT, 'projection-framing.png') });

// Calibration patterns.
for (const pattern of ['fill', 'outline', 'grid', 'checker', 'corners']) {
  await page.evaluate((p) => {
    window.ANIM.viewMode = 'calibration';
    window.ANIM.calibration.pattern = p;
    window.__tick(400, 1 / 60);
    window.__renderer.render(window.__scene, window.__camera);
  }, pattern);
  await page.screenshot({ path: join(OUT, `cal-${pattern}.png`) });
}

// Leaving calibration restores the model.
const restored = await page.evaluate(() => {
  window.ANIM.viewMode = 'visualSequence';
  window.ANIM.calibration.pattern = 'off';
  window.__tick(401, 1 / 60);
  window.__renderer.render(window.__scene, window.__camera);
  return window.__ctx.logoModel.visible;
});
assert(restored === true, 'logo model visible again after calibration');
await page.screenshot({ path: join(OUT, 'after-calibration.png') });

// Projection toggle round-trip.
const toggled = await page.evaluate(() => {
  const before = window.__renderer.getPixelRatio();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', shiftKey: true }));
  const c = document.querySelector('canvas');
  return { off: { w: c.width, pos: c.style.position } };
});
assert(toggled.off.pos === '' || toggled.off.pos === 'static', `projection off clears letterbox (pos='${toggled.off.pos}')`);

console.log('ERRORS', JSON.stringify(errors, null, 2));
await browser.close();
process.exit(errors.length || failures.length ? 1 : 0);
