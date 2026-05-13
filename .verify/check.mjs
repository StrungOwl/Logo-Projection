// Quick Playwright probe used by Claude to visually verify effect 2.
// Loads the page, presses '2' to switch to hex mode, captures console
// errors, and saves screenshots at several timestamps so the breathing
// lerp (slow wall-scale animation) is visible across frames.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '.verify/shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Users/root/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',
});
const ctxBr = await browser.newContext({ viewport: { width: 1024, height: 1024 } });
// Bust any stale browser cache between probe runs.
await ctxBr.route('**/*', (route) => {
  const headers = { ...route.request().headers(), 'cache-control': 'no-cache' };
  route.continue({ headers });
});
const page = await ctxBr.newPage();

const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', msg => {
  if (msg.type() === 'error') {
    const txt = msg.text();
    if (!txt.includes('favicon')) errors.push('console.error: ' + txt);
  }
});

await page.goto('http://127.0.0.1:5501/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.keyboard.press('2');
await page.waitForTimeout(2500);

// Shorten the background cycle dwell to a few seconds so we can sample
// both nebula and boosted-starry states within the probe window.
await page.evaluate(() => {
  const bg = window.ANIM?.galaxy?.bgCycle;
  if (bg) { bg.dwellSeconds = 4; bg.fadeSeconds = 2; }
});

// One bgCycle is 2*(dwell+fade) = 12s with the test settings. Sample
// for ~14s every 1s so we cover both states + both transitions.
const start = Date.now();
const stampStep = 1000;
const totalMs   = 14000;
for (let s = 0; s <= totalMs; s += stampStep) {
  const remain = s - (Date.now() - start);
  if (remain > 0) await page.waitForTimeout(remain);
  await page.screenshot({ path: join(OUT, `t${String(s).padStart(5, '0')}.png`) });
}

// Sample the uniforms over time to confirm the cycle is animating.
const uniformProbe = await page.evaluate(() => {
  const ctx = window.__ctx;
  const u = ctx?.galaxyMat?.uniforms;
  return u ? {
    uStarryMode:     u.uStarryMode?.value,
    uStarryBoost:    u.uStarryBoost?.value,
    uStarSizeScale:  u.uStarSizeScale?.value,
  } : null;
});
console.log('UNIFORMS_FINAL', JSON.stringify(uniformProbe, null, 2));

// Probe the pool — main.js exposes ctx on window.__ctx; overlayHexRoots
// is the array of hexWall parent groups (one per overlay; usually one).
const poolReport = await page.evaluate(() => {
  const ctx = window.__ctx;
  if (!ctx?.overlayHexRoots?.length) return { error: 'no overlayHexRoots' };
  const out = { canonical: null, pool: [] };
  function walk(obj) {
    if (!obj) return;
    if (obj.name === 'brick-hex-wall-canonical') {
      out.canonical = { visible: obj.visible, hexCount: obj.children.length };
    }
    if (typeof obj.name === 'string' && obj.name.startsWith('brick-hex-pool-')) {
      const r = obj.children[0]?.geometry?.parameters?.radiusTop ?? null;
      out.pool.push({
        name: obj.name,
        visible: obj.visible,
        hexCount: obj.children.length,
        radius: r,
      });
    }
    if (obj.children) for (const c of obj.children) walk(c);
  }
  for (const root of ctx.overlayHexRoots) walk(root);
  return out;
});
console.log('POOL', JSON.stringify(poolReport, null, 2));

console.log('ERRORS', JSON.stringify(errors, null, 2));

// Probe live state — confirm breathing config is live, sizeJitter is
// gone, jitter knobs are present.
const live = await page.evaluate(() => ({
  viewMode: window.ANIM?.viewMode,
  breathingCfg: window.ANIM?.overlay?.brickWall?.breathing,
  flipSpeedJitter: window.ANIM?.overlay?.brickWall?.flipSpeedJitter,
  flipStepJitter: window.ANIM?.overlay?.brickWall?.flipStepJitter,
  sizeJitterPresent: window.ANIM?.overlay?.brickWall?.sizeJitter ?? null,
}));
console.log('LIVE', JSON.stringify(live, null, 2));

await browser.close();
