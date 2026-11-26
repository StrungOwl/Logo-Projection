// SVG shape asserts:  node .verify/verify-shapes.mjs
// Needs the app on http://127.0.0.1:5501 (python3 -m http.server 5501).
// Checks: every shape in shapes/shapes.js loads with no error and gives a
// lit picture; the mask keeps light inside the outline; keys H and G; the
// logo is still the default surface; shapes.html lists every shape.
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5501/';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
await page.addInitScript(() => { window.__PROBE_PAUSED = true; });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console.error: ' + m.text().slice(0, 300)); });
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
const ready = () => page.waitForFunction(() => window.__ctx?.logoMaterials && window.__tick && window.__ctx.logoModel, null, { timeout: 90000 });
const open = async (query) => { await page.goto(`${BASE}index.html?proj=1&w=960&h=540${query ? '&' + query : ''}`, { waitUntil: 'domcontentloaded' }); await ready(); };
// Tick 6 s of show, render, and measure the picture: lit pixels in the
// frame, and lit pixels in the four corners (must be dark on a shape).
const measure = () => page.evaluate(() => {
  window.__ctx.paused = true;
  let t = 0; const dt = 1 / 60;
  for (let i = 0; i < 360; i++) { t += dt; window.__tick(t, dt); }
  window.__pipeline.render();
  const src = window.__renderer.domElement;
  const c = document.createElement('canvas'); c.width = 240; c.height = 135;
  const g = c.getContext('2d'); g.drawImage(src, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let lit = 0, corner = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const o = (y * c.width + x) * 4, on = d[o] + d[o + 1] + d[o + 2] > 40;
    if (on) lit++;
    if (on && (x < 24 || x >= c.width - 24) && (y < 14 || y >= c.height - 14)) corner++;
  }
  return { lit: lit / (c.width * c.height), corner };
});

await page.goto(BASE + 'shapes.html', { waitUntil: 'domcontentloaded' });
const names = await page.evaluate(async () => Object.keys((await import('./shapes/shapes.js')).SHAPES));
check(names.length > 0, `shapes.js lists ${names.length} shapes: ${names.join(', ')}`);

for (const name of names) {
  const before = errors.length;
  await open(`shape=${name}`);
  const info = await page.evaluate(() => {
    const m = window.__ctx.logoModel.children[0];
    const s = m.userData.shape;
    return s ? { pts: s.outer.length, hole: !!s.hole, holes: s.exactHoles.length, mask: window.__shapeMask.getMode() } : null;
  });
  const px = await measure();
  check(!!info, `'${name}' builds a shape surface (${info ? `${info.pts} outline points, ${info.holes} small holes, mask ${info.mask}` : 'no shape data'})`);
  check(px.lit > 0.03, `'${name}' gives a lit picture (${(px.lit * 100).toFixed(1)} % of the frame)`);
  check(px.corner === 0, `'${name}' keeps the frame corners dark (${px.corner} lit)`);
  check(errors.length === before, `'${name}' has no page errors`);
}

// Keys on the first shape.
await page.evaluate(() => { window.__PROBE_PAUSED = false; });
await open(`shape=${names[0]}`);
const seen = [];
for (let i = 0; i < 3; i++) { seen.push(await page.evaluate(() => window.__shapeMask.getMode())); await page.keyboard.press('h'); }
check(new Set(seen).size === 3, `key H cycles the mask (${seen.join(' -> ')})`);
// Key G steps through SHAPE_MENU (or every shape when that list is empty).
const menu = await page.evaluate(async () => {
  const m = await import('./shapes/shapes.js');
  const list = (m.SHAPE_MENU || []).filter(n => m.SHAPES[n]);
  return list.length ? list : Object.keys(m.SHAPES);
});
await open(`shape=${menu[0]}`);
const visited = [];
for (let i = 0; i < menu.length + 1; i++) {
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.keyboard.press('g')]);
  await ready();
  visited.push(new URL(page.url()).searchParams.get('shape') || 'logo');
}
const want = [...menu.slice(1), 'logo', menu[0]];
check(JSON.stringify(visited) === JSON.stringify(want), `key G goes through the shapes, then the logo (${visited.join(' -> ')})`);

// No shape parameter = the logo, no mask.
await open('');
const logo = await page.evaluate(() => ({ shape: !!window.__ctx.logoModel.children.find(c => c.userData?.shape), mask: window.__shapeMask.pass.enabled }));
check(!logo.shape && !logo.mask, 'no ?shape= keeps the 3D logo, mask pass off');

// The shapes page.
await page.goto(BASE + 'shapes.html', { waitUntil: 'networkidle' });
const cards = await page.locator('.card').count();
check(cards === names.length + 2, `shapes.html shows ${cards} cards (${names.length} shapes + logo + full screen)`);

console.log('ERRORS', JSON.stringify([...new Set(errors)], null, 1));
await browser.close();
process.exit(fails || errors.length ? 1 : 0);
