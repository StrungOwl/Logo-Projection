// Contact sheet: node .verify/sheet.mjs <shots-label> [filter-substring] [cols=4]
// Writes .verify/shots/<label>/_sheet.png — every matching shot as a
// labelled thumbnail, for reviewing a mode over time at a glance.
import { chromium } from 'playwright';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const label = process.argv[2];
const filter = process.argv[3] || '';
const cols = Number(process.argv[4] || 4);
const dir = join('.verify', 'shots', label);
const files = readdirSync(dir).filter(f => f.endsWith('.png') && !f.startsWith('_') && f.includes(filter)).sort();
const TW = 480, TH = 270;
const rows = Math.ceil(files.length / cols);
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.CHROME || 'C:/Users/root/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe' });
const page = await (await browser.newContext({ viewport: { width: TW * cols, height: TH * rows } })).newPage();
const imgs = files.map(f => ({ name: f.replace('.png', ''), src: 'data:image/png;base64,' + readFileSync(join(dir, f)).toString('base64') }));
await page.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${TW}px)">` +
  imgs.map(i => `<div style="position:relative;width:${TW}px;height:${TH}px"><img src="${i.src}" style="width:100%;height:100%"><span style="position:absolute;left:4px;top:2px;color:#fff;font:12px monospace;background:#0008">${i.name}</span></div>`).join('') + '</body>');
await page.waitForFunction(() => [...document.images].every(i => i.complete));
await page.screenshot({ path: join(dir, '_sheet.png') });
await browser.close();
console.log(join(dir, '_sheet.png'), files.length, 'shots');
