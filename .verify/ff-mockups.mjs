// Fire-flower mock-up page.
//
//   node .verify/ff-mockups.mjs
//
// Needs: python3 -m http.server 5501 (repo root), CHROME, and the frames
// from shape-probe in .verify/shots/ff/ffNN/ (see shapes/fire-flower/README.md).
// Writes shapes/fire-flower/mockups.html + mockups/*.jpg + mockups/_overview.png
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const DIR = 'shapes/fire-flower';
const ROUND3 = process.env.ROUND === '3';   // ROUND=3: the designs made from the hand drawings
const REEF = process.env.ROUND === 'free';   // ROUND=free: one piece, not round
const FG = process.env.ROUND === 'fg';       // ROUND=fg: the precise set (flowers, gears, fire)
const OUTNAME = FG ? 'mockups-fg' : REEF ? 'mockups-free' : ROUND3 ? 'mockups-round3' : 'mockups';
const OUT = `${DIR}/${OUTNAME}`;
mkdirSync(OUT, { recursive: true });
const meta = JSON.parse(readFileSync(`${DIR}/${FG ? 'fg-options.json' : REEF ? 'free-options.json' : ROUND3 ? 'ink-options.json' : 'options.json'}`, 'utf8'));
const LOOKS = [
  ['moltenGold-02s', 'Gold'], ['fireplaceOne-20s', 'Fire'], ['flameOnly-20s', 'Night sky'], ['hexagons-20s', 'Hexagons'],
  ['flowers-20s', 'Flowers'], ['starDive-20s', 'Star Dive'], ['strata-20s', 'Strata'], ['shards-20s', 'Shards'],
];
// A different visual on each wood layer: [label, base, ring 1, ring 2, ring 3]
const MIXES = [
  ['Fire / Gold / Strata', 'fireplaceOne-20s', 'moltenGold-02s', 'strata-20s', 'shards-20s'],
  ['Night sky / Shards / Gold', 'flameOnly-20s', 'shards-20s', 'moltenGold-02s', 'strata-20s'],
  ['Star Dive / Strata / Fire', 'starDive-20s', 'strata-20s', 'fireplaceOne-20s', 'moltenGold-02s'],
  ['Strata / Night sky / Shards', 'strata-20s', 'flameOnly-20s', 'shards-20s', 'moltenGold-02s'],
];
const S = 560;   // tile size, px

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
await page.goto('http://127.0.0.1:5501/shapes.html', { waitUntil: 'domcontentloaded' });

for (const m of meta) {
  const tiles = await page.evaluate(async ({ m, LOOKS, MIXES, S }) => {
    const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
    const base = `/.verify/shots/ff/${m.id}/`;
    const imgs = {};
    for (const f of new Set([...LOOKS.map(l => l[0]), ...MIXES.flatMap(x => x.slice(1))])) imgs[f] = await load(base + f + '.png');
    // Where is the shape in the frame? Lit pixels of the gold frame.
    const gold = imgs['moltenGold-02s'];
    const c0 = document.createElement('canvas'); c0.width = gold.width; c0.height = gold.height;
    const g0 = c0.getContext('2d'); g0.drawImage(gold, 0, 0);
    const d = g0.getImageData(0, 0, c0.width, c0.height).data;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < c0.height; y++) for (let x = 0; x < c0.width; x++) {
      const i = (y * c0.width + x) * 4;
      if (d[i] + d[i + 1] + d[i + 2] > 60) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const [W, H] = m.view, pad = m.pad;
    const kx = bw / (W - 2 * pad), ky = bh / (H - 2 * pad);
    const side = Math.max(bw, bh) * 1.05, cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
    const z = S / side;
    const rings = m.rings.map(r => new Path2D(r));
    const hole = new Path2D(m.hole);
    const lw = 1 / (z * kx);
    const tile = (draw) => {
      const c = document.createElement('canvas'); c.width = S; c.height = S;
      const g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
      const frame = (f) => g.drawImage(imgs[f], cx - side / 2, cy - side / 2, side, side, 0, 0, S, S);
      // Shape space: the SVG units of the wood drawing.
      const inShape = (fn) => { g.save(); g.translate(S / 2, S / 2); g.scale(z, z); g.translate(-cx, -cy);
        g.translate(x0, y0); g.scale(kx, ky); g.translate(-pad, -pad); fn(); g.restore(); };
      draw(g, frame, inShape);
      // Engraved (burnt) strokes take a little light away.
      if (m.engrave) inShape(() => { g.fillStyle = 'rgba(0,0,0,0.30)'; g.fill(new Path2D(m.engrave), 'evenodd'); });
      // Step edges of the wood: a thin shadow and a thin light line.
      inShape(() => {
        for (const p of rings) {
          g.save(); g.translate(0.9 * lw, 1.4 * lw);
          g.filter = 'blur(1px)'; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2.4 * lw; g.stroke(p); g.restore();
          g.strokeStyle = 'rgba(255,232,190,0.22)'; g.lineWidth = 0.9 * lw; g.stroke(p);
        }
      });
      return c.toDataURL('image/jpeg', 0.9);
    };
    const out = {};
    for (const [file] of LOOKS) out[file] = tile((g, frame) => frame(file));
    MIXES.forEach((mix, k) => {
      out['mix' + k] = tile((g, frame, inShape) => {
        frame(mix[1]);
        // Clip per ring (the clip must live in the same save/restore as the draw).
        rings.forEach((p, i) => {
          g.save();
          g.translate(S / 2, S / 2); g.scale(z, z); g.translate(-cx, -cy);
          g.translate(x0, y0); g.scale(kx, ky); g.translate(-pad, -pad);
          g.clip(p, 'evenodd');
          g.setTransform(1, 0, 0, 1, 0, 0);
          frame(mix[1 + ((i + 1) % (mix.length - 1))]);
          g.restore();
        });
      });
    });
    return out;
  }, { m, LOOKS, MIXES, S });
  for (const key of Object.keys(tiles)) {
    writeFileSync(`${OUT}/${m.id}-${key}.jpg`, Buffer.from(tiles[key].split(',')[1], 'base64'));
  }
  console.log(m.id, 'tiles');
}

// The page. Wood drawings are inline SVG; projection tiles are the JPGs.
const wood = (m, px) => readFileSync(`${DIR}/${m.id}-layers.svg`, 'utf8')
  .replace('<svg ', `<svg style="width:${Math.round(px * m.view[0] / Math.max(...m.view))}px;height:auto;display:block" `)
  .replace(/id="sh"/g, `id="sh-${m.id}-${px}"`).replace(/url\(#sh\)/g, `url(#sh-${m.id}-${px})`)
  .replace(/(id="|url\(#)f-/g, `$1f${m.id}${px}-`);
const KIND = { flower: 'Flower', gear: 'Gear' };
const kindOf = (m) => m.id.startsWith('fire') ? 'Fire' : (KIND[m.kind] || '');
const GROUPS = [['Flowers', 'flower'], ['Gears', 'gear'], ['Fire', 'fire']];
const num = (m) => m.id.slice(-2);
const LEAD = FG ? `<p class="lead">A new set: 5 flowers, 5 gears and 5 fires. Every curve is drawn as exact geometry. Nothing is traced from a picture, so every line is clean and every petal and tooth is exact.
Each piece is 5 layers of wood. The light layers are plates. The thick dark lines are their own raised layer. The thin dark lines are engraved (burnt in). The outer edges have small flames, buds, hooks or teeth.
Click a wood picture to see it big. These are sketches, not cut files.</p>` : REEF ? `<p class="lead">One piece each, and not round. I took the designs made from your strokes and pulled them into new outlines: a flame, an eye, a star, wings, a comet and more. All layers move together, so the piece still stacks. These are sketches.</p>` : ROUND3 ? `<p class="lead">Ten designs made from your own brush strokes. I put your four drawings through a kaleidoscope with 8, 12, 16 or 24 mirrors (your drawings have 4).
New after the study of laser-cut fine art: 5 layers, not 3. Your strokes are now raised: they are their own dark wood layer on top of a light plate. The tone changes from layer to layer, so the depth shows.
Seven designs are flowers. Three designs (06, 07, 09) are gears. The edge of every piece follows the tips of your strokes.
Each card shows the wood, then one visual on the whole piece, then a different visual on each wood layer. These are sketches.</p>
<div class="src">${['0069', '0070', '0068', '0071'].map(n => `<figure><img src="drawings/IMG_${n}.png" alt="" loading="lazy"><figcaption>drawing ${n}</figcaption></figure>`).join('')}</div>` : `<p class="lead">Ten new ideas. All of them keep the outline you liked (old number 4): spikes with buds, and flame tongues between them.
The inside is new each time: rings of lace petals, and a fire flower as the opening in the middle.
"Lace" means that only the edge of a petal stays. The middle is cut out, so you see the layer below.
Each card shows the wood, then one visual on the whole piece, then a different visual on each wood layer.
These are sketches. You can mix them, for example "outline of 04 with the inside of 07".</p>`;
const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Fire Flower Mock-ups</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0b0a09; color: #e9dcc3; font-family: Calibri, Arial, sans-serif; padding: 28px 16px 80px; }
  main { max-width: 1500px; margin: 0 auto; }
  h1 { font-size: 30px; color: #ffc56a; }
  h2 { font-size: 24px; color: #ffc56a; }
  h3 { font-size: 16px; color: #ffc56a; margin: 0 0 6px; }
  p.lead { margin: 8px 0 22px; color: #b7a98f; max-width: 900px; line-height: 1.5; font-size: 17px; }
  .over { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 44px; }
  .over a { background: #15120f; border: 1px solid #2c251c; border-radius: 10px; padding: 10px; text-decoration: none; color: inherit; display: block; }
  .over a:hover { border-color: #ffc56a; }
  .over .w { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; background: #1d1a17; border-radius: 6px; }
  .over .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 6px; }
  .over img { width: 100%; border-radius: 6px; display: block; }
  .over .t { font-weight: 700; font-size: 16px; margin-top: 8px; }
  .over .n { color: #ffc56a; }
  .card { background: #15120f; border: 1px solid #2c251c; border-radius: 12px; padding: 18px; margin-bottom: 26px; }
  .note { color: #cdbfa5; font-size: 17px; margin: 4px 0; }
  .facts { color: #8c7f69; font-size: 15px; margin-bottom: 14px; }
  .body { display: grid; grid-template-columns: minmax(360px, 560px) 1fr; gap: 18px; align-items: start; }
  .woodbox { background: #1d1a17; border-radius: 8px; aspect-ratio: 1; display: flex; align-items: center; justify-content: center; }
  .cap { color: #8c7f69; font-size: 14px; margin-top: 6px; text-align: center; }
  .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
  .tiles figure { position: relative; }
  .tiles img { width: 100%; display: block; border-radius: 6px; }
  .tiles figcaption { position: absolute; left: 6px; top: 4px; font-size: 13px; color: #fff; background: #0009; padding: 1px 6px; border-radius: 4px; }
  .src { display: flex; gap: 10px; margin: 0 0 26px; } .src figure { width: 150px; } .src img { width: 100%; height: 150px; object-fit: contain; background: #fff; border-radius: 6px; display: block; } .src figcaption { color: #8c7f69; font-size: 13px; text-align: center; margin-top: 3px; }
  code { background: #1d1914; padding: 1px 6px; border-radius: 4px; color: #ffd89a; }
  @media (max-width: 1100px) { .over { grid-template-columns: repeat(2, 1fr); } .body { grid-template-columns: 1fr; } .tiles { grid-template-columns: repeat(2, 1fr); } }
</style></head><body><main>
<h1>${FG ? 'Flowers, Gears and Fire' : REEF ? 'Free shapes: one piece, not round' : ROUND3 ? 'Fire Flower Mock-ups, round 3: from your drawings' : 'Fire Flower Mock-ups, round 2'}</h1>
${LEAD}
<div class="over">
${(FG ? GROUPS : [['', null]]).map(([title, key]) => (title ? `<h2 style="grid-column:1/-1;margin-top:8px">${title}</h2>` : '') +
  meta.filter(m => !key || m.id.startsWith(key)).map(m => `<a href="#${m.id}"><div class="w">${wood(m, 250)}</div>
<div class="pair"><img src="${OUTNAME}/${m.id}-strata-20s.jpg" alt=""><img src="${OUTNAME}/${m.id}-mix0.jpg" alt=""></div>
<div class="t"><span class="n">${num(m)}</span> ${m.name}</div></a>`).join('\n')).join('\n')}
</div>
${meta.map(m => `<section class="card" id="${m.id}">
<h2>${FG ? kindOf(m) + ' ' : ''}${num(m)} &nbsp;${m.name}</h2>
<div class="note">${m.note}</div>
<div class="facts">${m.src ? `from drawing ${m.src} &nbsp;|&nbsp; ` : ''}${m.pieces} wood pieces &nbsp;|&nbsp; ${Math.round(m.width)} x ${Math.round(m.height)} mm in this sketch &nbsp;|&nbsp; name in the Shape control: <code>${m.id}</code></div>
<div class="body">
  <div><a href="${m.id}-layers.svg" target="_blank" title="Open the big picture"><div class="woodbox">${wood(m, 540)}</div></a><div class="cap">${FG ? '5 layers of 3 mm wood. Thick dark lines = a raised layer. Thin dark lines = engraved. Click to see it big.' : 'The wood pieces, stacked (3 mm each). Darker = lower.'}</div></div>
  <div>
    <h3>One visual on the whole piece</h3>
    <div class="tiles">${LOOKS.map(([f, label]) => `<figure><img src="${OUTNAME}/${m.id}-${f}.jpg" alt="${label}" loading="lazy"><figcaption>${label}</figcaption></figure>`).join('')}</div>
    <h3>A different visual on each wood layer (quick mock-up)</h3>
    <div class="tiles">${MIXES.map((x, k) => `<figure><img src="${OUTNAME}/${m.id}-mix${k}.jpg" alt="${x[0]}" loading="lazy"><figcaption>${x[0]}</figcaption></figure>`).join('')}</div>
  </div>
</div></section>`).join('\n')}
</main></body></html>
`;
const PAGE = FG ? 'mockups-fg.html' : REEF ? 'mockups-free.html' : ROUND3 ? 'mockups-round3.html' : 'mockups.html';
writeFileSync(`${DIR}/${PAGE}`, html);

// One picture of the whole page top (the ten at a glance) + the full page.
const view = await (await browser.newContext({ viewport: { width: 1560, height: 900 } })).newPage();
await view.goto(`http://127.0.0.1:5501/shapes/fire-flower/${PAGE}`, { waitUntil: 'load' });
await view.evaluate(() => document.querySelectorAll('img').forEach(i => i.loading = 'eager'));
await view.waitForFunction(() => [...document.images].every(i => i.complete && i.naturalWidth > 0));
await view.locator('.over').screenshot({ path: `${OUT}/_overview.png` });
for (const m of meta) await view.locator(`#${m.id}`).screenshot({ path: `${OUT}/_card-${m.id}.png` });
await browser.close();
console.log('wrote', `${DIR}/${PAGE}`);
