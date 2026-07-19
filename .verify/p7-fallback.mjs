// Fallback-knob probe (p7 verification).
//
//   node .verify/p7-fallback.mjs <override>
//
//   <override>  'legacyArch' → ANIM.fireplace.legacy = true (old outer arch)
//               'amberOff'   → ANIM.arch.amber.enabled = false (raw bricks)
//
// The override must land BEFORE the fireplace/arch groups are built
// (materials + geometry are load-time), so an init script polls for
// window.ANIM (mirrored synchronously at module-eval, long before the
// async model load wires the effects) and applies the override then.
// Captures one settled mode-4 shot into .verify/shots/p7-<override>/.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const override = process.argv[2] || 'legacyArch';
const OUT = join('.verify', 'shots', `p7-${override}`);
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

await page.addInitScript((ov) => {
  window.__PROBE_PAUSED = true;
  let s = 0x1234abcd;
  Math.random = function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Apply the config override the instant window.ANIM appears — well
  // before the async model load builds the brick materials/groups.
  const iv = setInterval(() => {
    if (!window.ANIM) return;
    if (ov === 'legacyArch') window.ANIM.fireplace.legacy = true;
    if (ov === 'amberOff')   window.ANIM.arch.amber.enabled = false;
    clearInterval(iv);
  }, 0);
}, override);

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
await page.evaluate(() => { window.ANIM.viewMode = 'fireplaceOne'; });

await page.evaluate(({ dt }) => {
  let t = 0;
  const steps = Math.round(6 / dt);
  for (let i = 0; i < steps; i++) { t += dt; window.__tick(t, dt); }
  if (window.__pipeline) window.__pipeline.render();
  else window.__renderer.render(window.__scene, window.__camera);
}, { dt: DT });
await page.screenshot({ path: join(OUT, 'mode4.png') });

console.log('ERRORS', JSON.stringify(errors, null, 2));
await browser.close();
process.exit(errors.length ? 1 : 0);
