// Quick look at the wood mock-ups (no server needed):
//   [META=ink-options.json PX=700 COLS=5 OUTPNG=x.png] node .verify/ff-wood.mjs [id ...]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const dir = 'shapes/fire-flower';
let meta = JSON.parse(readFileSync(`${dir}/${process.env.META || 'options.json'}`, 'utf8'));
const want = process.argv.slice(2);
if (want.length) meta = meta.filter(m => want.includes(m.id));
const PX = Number(process.env.PX || 900), cols = Math.min(meta.length, Number(process.env.COLS || 2));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME });
const page = await (await browser.newContext({ viewport: { width: PX * cols, height: (PX + 26) * Math.ceil(meta.length / cols) } })).newPage();
await page.setContent(`<body style="margin:0;background:#1b1a19;display:grid;grid-template-columns:repeat(${cols},${PX}px);font:15px Calibri,Arial;color:#eee">` +
  meta.map(m => `<div style="height:${PX + 26}px"><div style="padding:4px 8px">${m.id} ${m.name}</div><div style="width:${PX}px;height:${PX}px;display:flex;align-items:center;justify-content:center">${readFileSync(`${dir}/${m.id}-layers.svg`, 'utf8').replace('<svg ', `<svg style="width:${Math.round((PX - 20) * m.view[0] / Math.max(...m.view))}px" `).replace(/id="sh"/g, `id="sh-${m.id}"`).replace(/url\(#sh\)/g, `url(#sh-${m.id})`).replace(/(id="|url\(#)f-/g, `$1f${m.id}-`)}</div></div>`).join('') + '</body>');
await page.screenshot({ path: process.env.OUTPNG || '.verify/shots/ff-wood.png' });
await browser.close();
