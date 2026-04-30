// Drives index.html with Playwright. Steps λ manually through specific
// values via fractalState.applyAt() so each screenshot lands at a known
// point in the grow phase.
//
// Run from project root with a local HTTP server on :8000:
//   python -m http.server 8000
//   node .snapshot.mjs

import { chromium } from 'file:///C:/Users/sydne/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
import { mkdir } from 'node:fs/promises';

const URL    = 'http://localhost:8000/';
const OUTDIR = '.snapshot.mjs.shots';

await mkdir(OUTDIR, { recursive: true });

const browser = await chromium.launch();
const ctx     = await browser.newContext({ viewport: { width: 1280, height: 1280 } });
const page    = await ctx.newPage();

page.on('console', msg => {
  const t = msg.type();
  if (t === 'error' || t === 'warning') console.log(`[page ${t}]`, msg.text());
});
page.on('pageerror', err => console.log('[pageerror]', err.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');
await page.waitForFunction(
  () => window.__ctx
     && window.__ctx.fractalState
     && typeof window.__ctx.fractalState.applyAt === 'function',
  { timeout: 30000 }
);
console.log('app initialized');

await page.evaluate(() => {
  window.ANIM.viewMode = 'pattern';
  window.__ctx.scene.traverse(o => { if (o.name === 'fractal-clone') o.visible = true; });
  window.__ctx.updateFractalZoom = () => {
    window.__ctx.scene.traverse(o => { if (o.name === 'fractal-clone') o.visible = true; });
  };
});
await page.waitForTimeout(150);

// Sweep intro (λ varies, d=λ), then continuous dive (λ=1, d advances 1→2 to
// cover one full Droste step — the visual at d=2 should match d=1 because
// of the modular role-rotation, confirming the seamless loop).
const steps = [
  ...[0, 0.3, 0.6, 1.0].map(l => ({ l, d: l })),
  ...[1.2, 1.4, 1.6, 1.8, 2.0].map(d => ({ l: 1.0, d })),
];
for (let i = 0; i < steps.length; i++) {
  const { l, d } = steps[i];
  await page.evaluate(({ l, d }) => window.__ctx.fractalState.applyAt(l, d), { l, d });
  await page.waitForTimeout(150);
  const file = `${OUTDIR}/${String(i).padStart(2, '0')}-l${l.toFixed(2)}-d${d.toFixed(2)}.png`;
  try {
    await page.screenshot({ path: file, timeout: 60000 });
    console.log(`shot ${i}: λ=${l} d=${d} → ${file}`);
  } catch (err) {
    console.log(`shot ${i} failed:`, err.message);
  }
}

await browser.close();
console.log('done. Screenshots in', OUTDIR);
