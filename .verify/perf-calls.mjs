import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/root/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe' });
const page = await browser.newPage();
await page.addInitScript(() => { window.__PROBE_PAUSED = true; });
await page.goto('http://127.0.0.1:5501/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ctx?.logoMaterials && window.__tick, null, { timeout: 30000 });
const out = await page.evaluate(() => {
  window.__ctx.paused = true;
  const modes = ['visualSequence','fractalPattern','hexagons','flowers','fireplaceOne','fireplaceTwo','flameOnly','moltenGold'];
  const res = {};
  let t = 0;
  for (const m of modes) {
    window.ANIM.viewMode = m;
    for (let i = 0; i < 240; i++) { t += 1/60; window.__tick(t, 1/60); }
    window.ANIM.post.enabled = false; window.__renderer.info.reset?.();
    window.__pipeline.render();
    const info = window.__renderer.info.render;
    res[m] = { calls: info.calls, triangles: info.triangles };
  }
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
