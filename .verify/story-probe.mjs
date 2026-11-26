// Story probe — runs THE SHOW with its real dwells (deterministic clock) and takes pictures:
// one every IDLE seconds inside a step, one every SEAM seconds while a transition runs.
//   [W=1280 H=720 IDLE=6 SEAM=0.4 FROM=0 STEPS=10 OUT=dir] node .verify/story-probe.mjs
// FROM = playlist index to start at; STEPS = how many transitions to watch.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const E = process.env;
const W = Number(E.W || 1280), H = Number(E.H || 720);
const IDLE = Number(E.IDLE || 6), SEAM = Number(E.SEAM || 0.4), FROM = Number(E.FROM || 0), STEPS = Number(E.STEPS || 10);
const OUT = E.OUT || '.verify/shots/story'; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: E.CHROME });
const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
await page.addInitScript(() => { window.__PROBE_PAUSED = true; });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 300)); });
// QUERY = extra URL parameters, e.g. QUERY='shape=mandala'
await page.goto(`http://127.0.0.1:5501/index.html?proj=1&w=${W}&h=${H}${E.QUERY ? '&' + E.QUERY : ''}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ctx?.logoMaterials && window.__tick && window.__sequencer, null, { timeout: 60000 });
await page.evaluate(({ FROM, over }) => {
  window.__ctx.paused = true;
  window.__t = 0; const dt = 1 / 60;
  for (const [path, value] of Object.entries(over)) window.__control({ type: 'param', path, value });
  for (let i = 0; i < 60; i++) { window.__t += dt; window.__tick(window.__t, dt); }
  window.__pipeline.render();
  window.__sequencer.goto(FROM); window.__sequencer.play();
}, { FROM, over: JSON.parse(E.OVER || '{}') });
// Tick until `secs` pass or the transition state flips. Renders whenever the morph waits for its snapshot.
const advance = (secs) => page.evaluate((secs) => {
  const dt = 1 / 60; const T = window.__transitions;
  const was = T.isTransitioning(); let n = Math.round(secs * 60);
  while (n-- > 0) {
    window.__t += dt; window.__tick(window.__t, dt);
    if (T.phase() === 'morphCapture') window.__pipeline.render();
    if (T.isTransitioning() !== was) break;
  }
  window.__pipeline.render();
  const s = window.__sequencer.state();
  return { t: window.__t, trans: T.isTransitioning(), phase: T.phase(), mode: window.ANIM.viewMode, index: s.index, elapsed: s.elapsed };
}, secs);
if (E.SKIP) await advance(Number(E.SKIP));
let seams = 0, k = 0, wasTrans = false, st = { trans: false };
const t0 = Date.now();
while (seams < STEPS && k < 600) {
  st = await advance(st.trans ? SEAM : IDLE);
  if (wasTrans && !st.trans) seams++;
  wasTrans = st.trans;
  const name = `${String(k++).padStart(3, '0')}_${st.t.toFixed(1).padStart(6, '0')}_${st.mode}${st.trans ? '_T' : ''}.png`;
  await page.screenshot({ path: join(OUT, name) });
}
// AFTER = extra pictures after the last seam (IDLE seconds apart)
for (let i = 0; i < Number(E.AFTER || 0); i++) {
  st = await advance(Number(E.AFTERSTEP || 1));
  await page.screenshot({ path: join(OUT, `${String(k++).padStart(3, '0')}_${st.t.toFixed(1).padStart(6, '0')}_${st.mode}_after.png`) });
}
console.log(`story: ${k} pictures, ${seams} seams, ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${OUT}`);
if (errors.length) console.log('ERRORS', [...new Set(errors)].slice(0, 12));
await browser.close();
