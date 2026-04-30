// Dump fireplace.group children + key bbox numbers so we can see why
// the horseshoe isn't hugging the logo.

import { chromium } from 'file:///C:/Users/sydne/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const browser = await chromium.launch();
const ctx     = await browser.newContext({ viewport: { width: 1280, height: 1280 } });
const page    = await ctx.newPage();
page.on('console', msg => console.log('[page]', msg.text()));
page.on('pageerror', err => console.log('[err]', err.message));

await page.goto('http://localhost:8000/', { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');
await page.evaluate(() => { window.ANIM.viewMode = 'fireplace'; });
await page.waitForTimeout(2000);

const data = await page.evaluate(() => {
  const out = { silhouette: null, fireplace: null };
  // Grab the first logoMesh by traversing the scene for an object whose
  // userData has silhouette/meta info — fall back to globals.
  const ctx = window.__ctx;
  // Walk scene to find fireplace group by name
  let fpGroup = null;
  ctx.scene.traverse(o => { if (o.name === 'fireplace') fpGroup = o; });
  if (!fpGroup) return { error: 'no fireplace group' };
  // simpler: collect children world positions
  const childPositions = [];
  fpGroup.children.forEach(c => {
    childPositions.push({ x: c.position.x, y: c.position.y, z: c.position.z });
  });
  let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
  for (const p of childPositions) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  out.fireplace = {
    childCount: childPositions.length,
    bbox: { minX, maxX, minY, maxY },
    groupPos: { x: fpGroup.position.x, y: fpGroup.position.y, z: fpGroup.position.z },
  };
  // Find logoMesh and its silhouette via parent of fireplace group
  const logoMesh = fpGroup.parent;
  out.logoMeshName = logoMesh?.name || 'unnamed';
  out.logoMeshPos = logoMesh ? { x: logoMesh.position.x, y: logoMesh.position.y, z: logoMesh.position.z } : null;

  // Pull bbox of the actual visible logo material — the dome should
  // tell us the right "narrow" width to size the fireplace against.
  let logoBox = null;
  ctx.scene.traverse(o => {
    if (o.isMesh && o.userData && o.userData.galaxyMat) {
      const g = o.geometry;
      g.computeBoundingBox();
      const b = g.boundingBox;
      logoBox = { min: { ...b.min }, max: { ...b.max } };
    }
  });
  out.logoGeomBbox = logoBox;

  // Find arch group's bbox for comparison (the existing arch).
  let archBricks = null;
  ctx.scene.traverse(o => {
    if (o.name === 'arch') {
      let aMinX=Infinity,aMaxX=-Infinity,aMinY=Infinity,aMaxY=-Infinity;
      o.traverse(c => {
        if (c.isMesh) {
          if (c.position.x < aMinX) aMinX = c.position.x;
          if (c.position.x > aMaxX) aMaxX = c.position.x;
          if (c.position.y < aMinY) aMinY = c.position.y;
          if (c.position.y > aMaxY) aMaxY = c.position.y;
        }
      });
      archBricks = { aMinX, aMaxX, aMinY, aMaxY };
    }
  });
  out.archBbox = archBricks;
  return out;
});

console.log(JSON.stringify(data, null, 2));
await browser.close();
