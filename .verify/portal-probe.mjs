// Single-mode probe (default: Depth Portal; MODE=starDive etc.) — deterministic 1920x1080 projection shots with
// optional ANIM overrides and trigger cues.
//   node .verify/portal-probe.mjs <label> [seconds=12] ['{"recede.rim.enabled":false}'] [triggerName@sec]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const label = process.argv[2] || 'portal';
const secs = Number(process.argv[3] || 12);
const overrides = JSON.parse(process.argv[4] || '{}');
const cue = process.argv[5] || '';
const OUT = join('.verify', 'shots', 'portal');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME || 'C:/Users/root/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe' });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
await page.addInitScript(() => { window.__PROBE_PAUSED = true; });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('error: ' + m.text().slice(0, 300)); });
await page.goto('http://127.0.0.1:5501/index.html?proj=1&w=1920&h=1080' + (process.env.SURFACE ? '&surface=' + process.env.SURFACE : ''), { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ctx?.logoMaterials && window.__tick, null, { timeout: 30000 });
const info = await page.evaluate(({ secs, overrides, cue, MODE }) => {
  window.__ctx.paused = true;
  window.__control({ type: 'show', action: 'pause' });
  let t = 0; const dt = 1 / 60;
  for (let i = 0; i < 150; i++) { t += dt; window.__tick(t, dt); }
  window.ANIM.viewMode = MODE;
  const acks = [];
  for (const [path, value] of Object.entries(overrides)) {
    window.__control({ type: 'param', path, value });
  }
  const [cueName, cueAt] = cue ? cue.split('@') : [null, 0];
  let fired = false;
  const n = Math.round(secs / dt);
  for (let i = 0; i < n; i++) {
    t += dt;
    if (cueName && !fired && i * dt >= Number(cueAt)) {
      fired = true;
      if (cueName.startsWith('key:')) window.__control({ type: 'key', key: cueName.slice(4) });
      else window.__triggers.fire(cueName);
    }
    window.__tick(t, dt);
  }
  window.__pipeline.render();
  return { mode: window.ANIM.viewMode, triggers: window.__triggers.list() };
}, { secs, overrides, cue, MODE: process.env.MODE || 'fireplaceTwo' });
await page.screenshot({ path: join(OUT, label + '.png') });
console.log(JSON.stringify(info));
if (errors.length) console.log('ERRORS', errors);
await browser.close();
