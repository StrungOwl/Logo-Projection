// Projection-mode (?proj=1&w=1920&h=1080) deterministic screenshots of
// every mode at several simulated times — what the wall actually sees.
//   node .verify/proj-modes.mjs <label> [modes] [times]
//   times: comma list of seconds after mode entry (default 3,12,30,50)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const label = process.argv[2] || 'proj';
const OUT = join('.verify', 'shots', label);
mkdirSync(OUT, { recursive: true });
const MODES = { 1: 'moltenGold', 2: 'fractalPattern', 3: 'hexagons', 4: 'flowers',
                5: 'fireplaceOne', 6: 'fireplaceTwo', 7: 'flameOnly', 8: 'visualSequence' };
const keys  = (process.argv[3] || Object.keys(MODES).join(',')).split(',').filter(Boolean);
const times = (process.argv[4] || '3,12,30,50').split(',').map(Number);
const DT = 1 / 60;

const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME || 'C:/Users/root/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe' });
const ctxBr = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
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
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 300)); });
await page.goto('http://127.0.0.1:5501/index.html?proj=1&w=1920&h=1080' + (process.env.SURFACE ? '&surface=' + process.env.SURFACE + (process.env.HOLE ? '&hole=' + process.env.HOLE : '') : '') + '', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ctx?.logoMaterials && window.__tick, null, { timeout: 30000 });
await page.evaluate(() => {
  window.__ctx.paused = true;
  window.__control({ type: 'show', action: 'pause' });
  // The projection boot auto-started THE SHOW, whose opening wipe is
  // still in flight; let it land (it would otherwise flip the mode we
  // set below to its own target) before the probe owns the mode.
  let t = 0; for (let i = 0; i < 150; i++) { t += 1 / 60; window.__tick(t, 1 / 60); }
});

let t = 0;
for (const k of keys) {
  const mode = MODES[k];
  await page.evaluate((m) => { window.ANIM.viewMode = m; }, mode);
  let last = 0;
  for (const s of times) {
    t = await page.evaluate(({ t, secs, dt }) => {
      let tt = t; const n = Math.round(secs / dt);
      for (let i = 0; i < n; i++) { tt += dt; window.__tick(tt, dt); }
      window.__pipeline.render(); return tt;
    }, { t, secs: s - last, dt: DT });
    last = s;
    await page.screenshot({ path: join(OUT, `m${k}-${mode}-${String(s).padStart(3,'0')}s.png`) });
  }
  console.log(`mode ${k} ${mode} done`);
}
console.log('ERRORS', JSON.stringify(errors, null, 1));
await browser.close();
