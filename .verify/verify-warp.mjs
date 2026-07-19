// Warp + wipe-transition smoke test.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const OUT = join('.verify', 'shots', 'warp');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/root/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe' });
const page = await browser.newContext({ viewport: { width: 1024, height: 1024 } }).then(c => c.newPage());
const errors = []; const failures = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text()); });
const assert = (c, l) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) failures.push(l); };

await page.addInitScript(() => { window.__PROBE_PAUSED = true; });
await page.goto('http://127.0.0.1:5501/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ctx?.logoMaterials && window.__tick, null, { timeout: 30000 });
await page.evaluate(() => { window.__ctx.paused = true; });

// Straight render, then warped render with pinched top corners.
await page.evaluate(() => {
  window.ANIM.viewMode = 'visualSequence';
  let t = 0; for (let i = 0; i < 300; i++) { t += 1/60; window.__tick(t, 1/60); }
  window.__pipeline.render();
});
await page.screenshot({ path: join(OUT, 'straight.png') });
const state = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  window.__control({ type: 'warp', enabled: true,
    corners: [[c.width * 0.2, c.height * 0.1], [c.width * 0.8, 0], [c.width, c.height], [0, c.height]] });
  window.__tick(301, 1/60);
  window.__pipeline.render();
  return {
    enabled: window.ANIM.warp.enabled,
    stored: Object.keys(localStorage).filter(k => k.startsWith('logoProjection.warp')),
  };
});
await page.screenshot({ path: join(OUT, 'warped.png') });
assert(state.enabled === true, 'warp enabled via __control');
assert(state.stored.length === 1, `corners persisted (${state.stored.join(',')})`);

// Reset restores identity.
await page.evaluate(() => {
  window.__control({ type: 'warp', action: 'reset' });
  window.__pipeline.render();
});
await page.screenshot({ path: join(OUT, 'reset.png') });

// Wipe transition: request moltenGold with wipe, screenshot mid-cover.
await page.evaluate(() => {
  window.__control({ type: 'warp', enabled: false });
  window.ANIM.transitions.wipeDur = 2.0;
});
await page.evaluate(() => {
  window.__control({ type: 'mode', value: 'moltenGold', style: 'wipe' });
  let t = 400; for (let i = 0; i < 45; i++) { t += 1/60; window.__tick(t, 1/60); }  // 0.75s into 1s cover
  window.__pipeline.render();
});
await page.screenshot({ path: join(OUT, 'wipe-mid.png') });
const wipeEnd = await page.evaluate(() => {
  let t = 401; for (let i = 0; i < 200; i++) { t += 1/60; window.__tick(t, 1/60); }
  window.__pipeline.render();
  return window.ANIM.viewMode;
});
await page.screenshot({ path: join(OUT, 'wipe-done.png') });
assert(wipeEnd === 'moltenGold', `wipe completed into moltenGold (got ${wipeEnd})`);

console.log('ERRORS', JSON.stringify(errors));
await browser.close();
process.exit(errors.length || failures.length ? 1 : 0);
