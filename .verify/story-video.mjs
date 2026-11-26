// Story video — records THE SHOW (a short cut of the story) as a frame sequence, 30 fps, any size.
//   DRY=1 node .verify/story-video.mjs                      -> prints the total frame count
//   START=0 COUNT=900 OUT=dir node .verify/story-video.mjs  -> writes frames START..START+COUNT-1
// Several runs with different START can run side by side; every run simulates the same clock.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
const E = process.env;
const W = Number(E.W || 1080), H = Number(E.H || 1920);
const DRY = E.DRY === '1', START = Number(E.START || 0), COUNT = Number(E.COUNT || 1e9);
const OUT = E.OUT || '.verify/shots/storyvideo'; if (!DRY) mkdirSync(OUT, { recursive: true });
const END_HOLD = Number(E.END_HOLD || 3.5);
const browser = await chromium.launch({ headless: true, executablePath: E.CHROME });
const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
// Seeded random numbers + paused live loop, so every run (and every side-by-side chunk) is the same show.
await page.addInitScript((seed) => {
  window.__PROBE_PAUSED = true;
  let a = seed >>> 0;
  // Called at the start of every tick: the random stream then depends only on
  // the tick number, not on how many frames were drawn before it.
  window.__reseed = (n) => { a = (seed ^ Math.imul(n + 1, 0x9E3779B1)) >>> 0; };
  Math.random = function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}, Number(E.SEED || 20261116));
page.on('pageerror', e => console.log('pageerror: ' + e.message));
await page.goto(`http://127.0.0.1:5501/index.html?proj=1&w=${W}&h=${H}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ctx?.logoMaterials && window.__tick && window.__sequencer, null, { timeout: 60000 });
await page.evaluate((END_HOLD) => {
  const A = window.ANIM, S = window.__sequencer, T = window.__transitions;
  window.__ctx.paused = true;
  window.__control({ type: 'show', action: 'pause' });
  // ---- the short cut of the story ----
  Object.assign(A.molten.cycle, { holdTop: 1.5, drain: 9, holdBottom: 4 });
  A.constellation.firstDelay = 2.5;
  Object.assign(A.constellation.meteor, { first: 1.0, min: 2, max: 4 });
  const P = A.show.playlist;
  [12.5, 20, 11, 13, 8, 8, 7, 12, 9].forEach((d, i) => { P[i].dwell = d; });
  P[1].cues = [{ at: 1.5, trigger: 'stellar.meteor', args: { count: 2 } }, { at: 8, trigger: 'stellar.meteor', args: { count: 3 } },
               { at: 9, trigger: 'stellar.pulse' }, { at: 14, trigger: 'stellar.vortex' }];
  P[2].cues = [{ at: 7.2, trigger: 'portal.rush' }];
  P[3].cues = [{ at: 4, trigger: 'dive.rush' }, { at: 9.5, trigger: 'dive.rush' }];
  P[4].cues = [{ at: 3, trigger: 'look.pulse' }];
  P[5].cues = [{ at: 3, trigger: 'look.pulse' }];
  // ---- boot, then start the show already in the gold look ----
  window.__t = 0; const dt = 1 / 60;
  for (let i = 0; i < 90; i++) { window.__t += dt; window.__tick(window.__t, dt); }
  A.viewMode = 'moltenGold';
  window.__t += dt; window.__tick(window.__t, dt);
  S.goto(0); S.play();
  let seenLast = false, endTicks = 0, tickNo = 0;
  // n ticks; the morph snapshot is rendered the moment it is asked for.
  window.__vstep = (n) => {
    for (let i = 0; i < n; i++) {
      window.__reseed(++tickNo);
      window.__t += dt; window.__tick(window.__t, dt);
      if (T.phase() === 'morphCapture') window.__pipeline.render();
      const s = S.state();
      if (s.index === P.length - 1) seenLast = true;
      if (seenLast && s.index === 0) {
        A.molten.cycle.holdTop = 60;        // the gold stays for the ending
        S.pause();
        if (!T.isTransitioning()) endTicks++;
      }
    }
    return endTicks >= END_HOLD * 60;
  };
}, END_HOLD);
const step = (n) => page.evaluate((n) => window.__vstep(n), n);
if (DRY) {
  let f = 0;
  await page.evaluate(() => window.__pipeline.render());
  while (!(await step(2)) && f < 30000) f++;
  console.log('TOTAL_FRAMES ' + (f + 1));
} else {
  // Frames before START are simulated only (the random stream is re-seeded per tick,
  // so drawing or not drawing a frame does not change the show).
  await page.evaluate(() => window.__pipeline.render());
  for (let done = 0; done < START * 2; done += 240) await step(Math.min(240, START * 2 - done));
  const t0 = Date.now(); let f = 0;
  for (; f < COUNT; f++) {
    const ended = await step(2);
    await page.evaluate(() => window.__pipeline.render());
    await page.screenshot(E.JPEG
      ? { path: join(OUT, String(START + f).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: Number(E.JPEG) }
      : { path: join(OUT, String(START + f).padStart(5, '0') + '.png') });
    if (ended) { f++; break; }
  }
  console.log(`frames ${START}..${START + f - 1} in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${OUT}`);
}
await browser.close();
