// Reel capture — deterministic frame sequence of one mode, any size (default 1080x1920 portrait).
//   MODE=starDive WARM=8 SECS=4 FPS=30 OUT=/path ZOOM=1 CUES='key: @2,dive.rush@3' node .verify/reel-capture.mjs
// WARM = seconds simulated before the first frame. Cue times count from the mode switch.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const E = process.env;
const W = Number(E.W || 1080), H = Number(E.H || 1920);
const MODE = E.MODE || 'starDive', WARM = Number(E.WARM || 6), SECS = Number(E.SECS || 3), FPS = Number(E.FPS || 30);
const OUT = E.OUT || '.verify/shots/reel'; mkdirSync(OUT, { recursive: true });
const cues = (E.CUES || '').split(',').filter(Boolean).map(c => { const i = c.lastIndexOf('@'); return { name: c.slice(0, i), at: Number(c.slice(i + 1)), fired: false }; });
const browser = await chromium.launch({ headless: true, executablePath: E.CHROME,
  args: (E.CHROME_ARGS || '').split(' ').filter(Boolean) });
const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
await page.addInitScript(() => { window.__PROBE_PAUSED = true; });
page.on('pageerror', e => console.log('pageerror: ' + e.message));
await page.goto(`http://127.0.0.1:5501/index.html?proj=1&w=${W}&h=${H}&zoom=${E.ZOOM || 1}` + (E.MARGIN ? '&margin=' + E.MARGIN : ''), { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ctx?.logoMaterials && window.__tick, null, { timeout: 60000 });
await page.evaluate(({ MODE, over }) => {
  window.__ctx.paused = true;
  window.__control({ type: 'show', action: 'pause' });
  window.__t = 0; const dt = 1 / 60;
  for (let i = 0; i < 150; i++) { window.__t += dt; window.__tick(window.__t, dt); }
  window.ANIM.viewMode = MODE;
  for (const [path, value] of Object.entries(over)) window.__control({ type: 'param', path, value });
  window.__t0 = window.__t;
}, { MODE, over: JSON.parse(E.OVER || '{}') });
const step = async (n) => page.evaluate(({ n, cues }) => {
  const dt = 1 / 60; const fired = [];
  for (let i = 0; i < n; i++) {
    window.__t += dt;
    const el = window.__t - window.__t0;
    for (const c of cues) if (!c.fired && el >= c.at) { c.fired = true; fired.push(c.name);
      if (c.name.startsWith('key:')) window.__control({ type: 'key', key: c.name.slice(4) }); else window.__triggers.fire(c.name); }
    window.__tick(window.__t, dt);
  }
  window.__pipeline.render();
  return fired;
}, { n, cues });
const mark = (f) => { for (const c of cues) if (f.includes(c.name)) c.fired = true; };
// warm in chunks so the page stays responsive
const WT = Math.round(WARM * 60);
for (let done = 0; done < WT; done += 120) mark(await step(Math.min(120, WT - done)));
const sub = Math.round(60 / FPS), N = Math.round(SECS * FPS);
const t0 = Date.now();
for (let f = 0; f < N; f++) {
  mark(await step(sub));
  await page.screenshot({ path: join(OUT, String(f).padStart(5, '0') + '.png') });
}
console.log(`${MODE}: ${N} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${OUT}`);
await browser.close();
