// Single-frame snapshot of the fireplace (mode 4) view. Outputs .snapshot.png.
// Run: node .snapshot-arch.mjs (with python -m http.server 8000 running).

import { chromium } from 'file:///C:/Users/sydne/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const browser = await chromium.launch();
const ctx     = await browser.newContext({ viewport: { width: 1280, height: 1280 } });
const page    = await ctx.newPage();

page.on('pageerror', err => console.log('[pageerror]', err.message));

await page.goto('http://localhost:8000/', { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');
await page.evaluate(() => { window.ANIM.viewMode = 'fireplace'; });
await page.waitForTimeout(2500);
await page.screenshot({ path: '.snapshot.png', fullPage: false });
console.log('saved .snapshot.png');
await browser.close();
