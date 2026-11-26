// Real-GPU frame-rate probe: headed Chromium, projection mode 1920x1080,
// live rAF loop, N seconds per mode. Prints fps + draw calls per mode.
//   node .verify/fps.mjs [seconds] [modes]
import { chromium } from 'playwright';
const secs  = Number(process.argv[2] || 5);
const MODES = ['moltenGold','fractalPattern','hexagons','flowers','fireplaceOne','fireplaceTwo','flameOnly','visualSequence'];
const modes = (process.argv[3] ? process.argv[3].split(',') : MODES);
const browser = await chromium.launch({ headless: false,
  executablePath: process.env.CHROME || 'C:/Users/root/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',
  args: ['--window-size=1920,1080', ...(process.env.UNCAP ? ['--disable-gpu-vsync','--disable-frame-rate-limit'] : []), '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://127.0.0.1:5501/index.html?proj=1&w=1920&h=1080', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ctx?.logoMaterials && window.__tick, null, { timeout: 30000 });
await page.evaluate(() => window.__control({ type: 'show', action: 'pause' }));
const gpu = await page.evaluate(() => { const gl = window.__renderer.getContext(); const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; });
console.log('GPU:', gpu);
for (const m of modes) {
  await page.evaluate((m) => { window.ANIM.viewMode = m; }, m);
  await page.waitForTimeout(2500);   // settle / warm shaders
  const r = await page.evaluate((secs) => new Promise(res => {
    let n = 0; const t0 = performance.now(); let worst = 0, last = t0;
    function f() { const now = performance.now(); worst = Math.max(worst, now - last); last = now; n++;
      if (now - t0 < secs * 1000) requestAnimationFrame(f);
      else { const info = window.__renderer.info.render; res({ fps: n / ((now - t0) / 1000), worstMs: worst, calls: info.calls, tris: info.triangles }); } }
    requestAnimationFrame(f);
  }), secs);
  console.log(m.padEnd(16), 'fps', r.fps.toFixed(1).padStart(6), 'worst', r.worstMs.toFixed(0).padStart(4) + 'ms', 'calls', String(r.calls).padStart(5), 'tris', r.tris);
}
await browser.close();
