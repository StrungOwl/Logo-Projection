// Debug snapshot: confirm visibility, camera, and brick world positions.
import { chromium } from 'file:///C:/Users/sydne/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const browser = await chromium.launch();
const ctx     = await browser.newContext({ viewport: { width: 1280, height: 1280 } });
const page    = await ctx.newPage();
page.on('pageerror', err => console.log('[pageerror]', err.message));

await page.goto('http://localhost:8000/', { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');
// Set arch mode and wait for the tick loop to apply visibility changes.
await page.evaluate(() => { window.ANIM.viewMode = 'arch'; });
await page.waitForTimeout(3000);

const info = await page.evaluate(() => {
  const c = window.__ctx;
  const arch = c.archGroup;
  const cam = c.camera;
  arch.updateMatrixWorld(true);

  // Project a few huge brick world positions to NDC to see if they're in view.
  const THREE = window.THREE || (() => null)();
  const huge = [];
  arch.traverse(o => {
    if (!o.isMesh) return;
    o.geometry?.computeBoundingBox?.();
    const bb = o.geometry?.boundingBox;
    if (!bb) return;
    const max = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
    if (max > 6 && (bb.max.z - bb.min.z) > 0.5) {
      const m = o.matrixWorld.elements;
      const wp = { x: m[12], y: m[13], z: m[14] };
      huge.push({ local: o.position.toArray().map(n => +n.toFixed(2)),
                  world: [+wp.x.toFixed(2), +wp.y.toFixed(2), +wp.z.toFixed(2)],
                  visible: o.visible });
    }
  });
  return {
    viewMode: window.ANIM.viewMode,
    archVisible: arch.visible,
    archParentVisible: arch.parent?.visible,
    archParentParentVisible: arch.parent?.parent?.visible,
    archGroupChildrenCount: arch.children.length,
    cameraPos: cam.position.toArray().map(n => +n.toFixed(2)),
    cameraTarget: c.controls?.target?.toArray().map(n => +n.toFixed(2)),
    hugeCount: huge.length,
    hugeFirst: huge.slice(0, 3),
    hugeLast: huge.slice(-3),
  };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: '.snapshot.png', fullPage: false });
await browser.close();
