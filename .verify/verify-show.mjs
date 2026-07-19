// Show-system probe: transitions, sequencer, trigger registry, control
// channel (BroadcastChannel + window.__control).
//
//   node .verify/verify-show.mjs     (server on 127.0.0.1:5501)
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Users/root/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',
});
const page = await browser.newContext({ viewport: { width: 800, height: 800 } }).then(c => c.newPage());

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
await page.goto('http://127.0.0.1:5501/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ctx?.logoMaterials && window.__tick, null, { timeout: 30000 });
await page.evaluate(() => { window.__ctx.paused = true; });

// helper: run n ticks of dt inside the page, returning latest exposure.
const step = (n, dt = 1 / 60) => page.evaluate(({ n, dt }) => {
  window.__t = window.__t || 500;
  for (let i = 0; i < n; i++) { window.__t += dt; window.__tick(window.__t, dt); }
  return {
    exposure: window.__renderer.toneMappingExposure,
    mode: window.ANIM.viewMode,
  };
}, { n, dt });

// 1. Dip transition: keyboard '4' → exposure dips to ~0, mode flips at
//    blackpoint, exposure recovers to base 0.95.
const start = await page.evaluate(() => {
  window.ANIM.viewMode = 'visualSequence';
  window.__tick(499, 1 / 60);   // let the manager adopt the direct write
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit4', key: '4' }));
  return window.ANIM.viewMode;
});
assert(start === 'visualSequence', `mode unchanged immediately after keypress (transition pending), got '${start}'`);
const mid = await step(18);   // 0.3s into a 0.35s fade-out
assert(mid.exposure < 0.3, `exposure dipped near blackpoint (got ${mid.exposure.toFixed(3)})`);
const after = await step(80); // through blackpoint + fade-in
assert(after.mode === 'fireplaceOne', `mode flipped to fireplaceOne (got '${after.mode}')`);
assert(Math.abs(after.exposure - 0.95) < 1e-3, `exposure restored to 0.95 (got ${after.exposure.toFixed(3)})`);

// 2. Trigger registry.
const trig = await page.evaluate(() => ({
  known: window.__triggers.fire('stellar.pulse'),
  unknown: window.__triggers.fire('nope.nothing'),
  list: window.__triggers.list(),
}));
assert(trig.known === true, 'known trigger fires');
assert(trig.unknown === false, 'unknown trigger nacks without throwing');
assert(trig.list.includes('cascade.now') && trig.list.includes('domino.on'), `registry lists triggers (${trig.list.length} registered)`);

// 3. Sequencer: 1.5s dwells, confirm auto-advance through the playlist.
const seq = await page.evaluate(() => {
  for (const s of window.ANIM.show.playlist) { s.dwell = 1.5; delete s.cues; }
  window.__seq_states = [];
  return true;
});
await page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's' })); });
let modesSeen = new Set();
for (let i = 0; i < 14; i++) {
  const s = await step(60);   // 1s
  modesSeen.add(s.mode);
}
assert(modesSeen.size >= 3, `sequencer advanced through ${modesSeen.size} modes (${[...modesSeen].join(', ')})`);

// 4. Manual key pauses the show.
const paused = await page.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit0', key: '0' }));
  return true;
});
const before = (await step(1)).mode;
await step(240);   // 4s — a 1.5s-dwell show would have advanced twice
const stay = await step(1);
assert(stay.mode === 'visualSequence', `show paused on manual input (mode stayed '${stay.mode}')`);

// 5. Control channel: window.__control param write + ack, BroadcastChannel mode msg.
const ctl = await page.evaluate(async () => {
  const acks = [];
  const origLog = console.log;
  window.__control({ type: 'param', path: 'galaxy.timeScale', value: 0.5 });
  window.__control({ type: 'param', path: 'not.a.real.path', value: 1 });
  const bc = new BroadcastChannel('logo-projection-control');
  const reply = new Promise((res) => { bc.onmessage = (e) => { if (e.data.type === 'ack') res(e.data); }; });
  bc.postMessage({ type: 'mode', value: 'hexagons', style: 'cut' });
  const ack = await Promise.race([reply, new Promise(r => setTimeout(() => r(null), 1500))]);
  return { timeScale: window.ANIM.galaxy.timeScale, ack, mode: window.ANIM.viewMode };
});
assert(ctl.timeScale === 0.5, `param write landed (galaxy.timeScale=${ctl.timeScale})`);
assert(ctl.ack && ctl.ack.ok === true, `BroadcastChannel mode msg acked (${JSON.stringify(ctl.ack)})`);
assert(ctl.mode === 'hexagons', `BC 'cut' mode switch applied (got '${ctl.mode}')`);

console.log('ERRORS', JSON.stringify(errors, null, 2));
await browser.close();
process.exit(errors.length || failures.length ? 1 : 0);
