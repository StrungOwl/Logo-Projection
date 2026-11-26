// Makes the wood-layer pictures that TouchDesigner uses to mix the layers.
//
//   [SHAPES=fire04,flower02 SIZES=1280x720,1920x1080] node .verify/make-zones.mjs
//
// For each shape (default: SHAPE_MENU in shapes/shapes.js) and each size:
//   shapes/zones/<shape>.A.<w>x<h>.png   red = layer 1, green = layer 2, blue = layer 3
//   shapes/zones/<shape>.B.<w>x<h>.png   red = layer 4, green = shadow lines, blue = light lines
// The pictures are in screen space: the show is opened at that size, and
// the place of the shape in the picture is read from it.
// Needs the app on http://127.0.0.1:5501 and the file <shape>.layers.json
// (made by shapes/fire-flower/make_fg.py). Run it again after a shape changes.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const E = process.env;
const SIZES = (E.SIZES || '1280x720,1920x1080').split(',').map(s => s.split('x').map(Number));
const OUT = join('shapes', 'zones');
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: E.CHROME });
let shapes = E.SHAPES ? E.SHAPES.split(',') : null;
for (const [W, H] of SIZES) {
  const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
  await page.addInitScript(() => { window.__PROBE_PAUSED = true; });
  if (!shapes) {
    await page.goto('http://127.0.0.1:5501/shapes.html', { waitUntil: 'domcontentloaded' });
    shapes = await page.evaluate(async () => { const m = await import('./shapes/shapes.js'); return (m.SHAPE_MENU || []).filter(n => m.SHAPES[n]); });
  }
  for (const name of shapes) {
    await page.goto(`http://127.0.0.1:5501/index.html?proj=1&w=${W}&h=${H}&shape=${name}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ctx?.logoMaterials && window.__tick && window.__shapeMask?.ready(), null, { timeout: 120000 });
    const r = await page.evaluate(async ({ name, W, H }) => {
      window.__ctx.paused = true;
      const step = (n) => { for (let i = 0; i < n; i++) { window.__t = (window.__t || 0) + 1 / 60; window.__tick(window.__t, 1 / 60); } };
      step(30);
      const f0 = window.__shapeMask.frame();
      step(600);                                           // 10 s later: does the shape move?
      const f1 = window.__shapeMask.frame();
      const moved = Math.max(...f0.flatMap((p, i) => [Math.abs(p[0] - f1[i][0]) * W, Math.abs(p[1] - f1[i][1]) * H]));
      const shapesMod = await import('./shapes/shapes.js');
      const file = (shapesMod.SHAPES[name] && shapesMod.SHAPES[name].file) || `${name}.svg`;
      const res = await fetch(`./shapes/${file.replace(/\.svg$/i, '.layers.json')}`);
      if (!res.ok) return { error: `no layers file (${res.status})` };
      const { drawZones, zonesFromJson } = await import('./src/layers/zones.js');
      const zones = zonesFromJson(await res.json());
      const cA = document.createElement('canvas'), cB = document.createElement('canvas');
      cA.width = cB.width = W; cA.height = cB.height = H;
      const P = f0.map(([x, y]) => [x * W, y * H]);
      drawZones(cA.getContext('2d'), cB.getContext('2d'), zones, P, W, H);
      return { A: cA.toDataURL('image/png'), B: cB.toDataURL('image/png'), moved, P, layers: zones.paths.length };
    }, { name, W, H });
    if (r.error) { console.log(`${name} ${W}x${H}: ${r.error}`); continue; }
    writeFileSync(join(OUT, `${name}.A.${W}x${H}.png`), Buffer.from(r.A.split(',')[1], 'base64'));
    writeFileSync(join(OUT, `${name}.B.${W}x${H}.png`), Buffer.from(r.B.split(',')[1], 'base64'));
    console.log(`${name} ${W}x${H}: ${r.layers} layers, box ${r.P.map(p => p.map(v => v.toFixed(1)).join(',')).join(' | ')}, moved ${r.moved.toFixed(2)} px in 10 s`);
  }
  await page.close();
}
await browser.close();
