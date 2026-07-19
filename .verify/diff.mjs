// Pixel-diff two shot folders: node .verify/diff.mjs <labelA> <labelB> [tolerance]
//
// Reports, per image: differing-pixel count, percent, and max channel delta.
// Exit 0 when every image's differing-pixel percentage is <= tolerance
// (default 0.1%). Decodes PNGs via headless Chromium canvas (no npm deps).
import { chromium } from 'playwright';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [a, b] = [process.argv[2], process.argv[3]];
const tolPct = parseFloat(process.argv[4] ?? '0.1');
if (!a || !b) { console.error('usage: node diff.mjs <labelA> <labelB> [tolPct]'); process.exit(2); }
const dirA = join('.verify', 'shots', a);
const dirB = join('.verify', 'shots', b);

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Users/root/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe',
});
const page = await browser.newPage();

let worst = 0;
const files = readdirSync(dirA).filter(f => f.endsWith('.png'));
for (const f of files) {
  let bufB;
  try { bufB = readFileSync(join(dirB, f)); } catch { console.log(`${f}: MISSING in ${b}`); worst = 100; continue; }
  const bufA = readFileSync(join(dirA, f));
  const res = await page.evaluate(async ({ da, db }) => {
    async function decode(b64) {
      const resp = await fetch('data:image/png;base64,' + b64);
      const blob = await resp.blob();
      const bmp = await createImageBitmap(blob);
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const g = cv.getContext('2d');
      g.drawImage(bmp, 0, 0);
      return g.getImageData(0, 0, bmp.width, bmp.height);
    }
    const [ia, ib] = [await decode(da), await decode(db)];
    if (ia.width !== ib.width || ia.height !== ib.height) return { sizeMismatch: true };
    let diff = 0, maxD = 0;
    const A = ia.data, B = ib.data;
    for (let i = 0; i < A.length; i += 4) {
      const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i+1] - B[i+1]), Math.abs(A[i+2] - B[i+2]));
      if (d > 0) { diff++; if (d > maxD) maxD = d; }
    }
    return { diff, maxD, total: A.length / 4 };
  }, { da: bufA.toString('base64'), db: bufB.toString('base64') });
  if (res.sizeMismatch) { console.log(`${f}: SIZE MISMATCH`); worst = 100; continue; }
  const pct = (100 * res.diff / res.total);
  if (pct > worst) worst = pct;
  console.log(`${f}: ${res.diff} px differ (${pct.toFixed(3)}%), max channel delta ${res.maxD}`);
}
await browser.close();
console.log(worst <= tolPct ? `PASS (worst ${worst.toFixed(3)}% <= ${tolPct}%)` : `FAIL (worst ${worst.toFixed(3)}% > ${tolPct}%)`);
process.exit(worst <= tolPct ? 0 : 1);
