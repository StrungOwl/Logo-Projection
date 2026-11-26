// The wood layers as two pictures that a shader can read.
//   A: red = layer 1, green = layer 2, blue = layer 3
//   B: red = layer 4, green = shadow lines, blue = light lines
// (Layer 0, the base plate, is everything that is not covered.)
//
// zones = { box: [minx, miny, maxx, maxy], paths: [Path2D ...], kinds: ['plate' | 'lace' ...] }
// P     = three corners of the outline box in the picture, in pixels:
//         top left, top right, bottom left (from shapeMask.frame()).
// Used by: layers.html (src/layers/director.js) and .verify/make-zones.mjs
// (which makes the PNG files for TouchDesigner).
export function drawZones(gA, gB, zones, P, W, H) {
  const [minx, miny, maxx, maxy] = zones.box;
  const bw = maxx - minx, bh = maxy - miny;
  const a = (P[1][0] - P[0][0]) / bw, b = (P[1][1] - P[0][1]) / bw;
  const c = (P[2][0] - P[0][0]) / bh, d = (P[2][1] - P[0][1]) / bh;
  const e = P[0][0] - a * minx - c * miny, f = P[0][1] - b * minx - d * miny;
  const px = 1 / Math.max(Math.hypot(a, b), 1e-6);     // one screen pixel, in drawing units
  for (const g of [gA, gB]) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.filter = 'none';
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
  }
  gA.setTransform(a, b, c, d, e, f);
  ['#ff0000', '#00ff00', '#0000ff'].forEach((col, i) => {
    if (zones.paths[i + 1]) { gA.fillStyle = col; gA.fill(zones.paths[i + 1], 'evenodd'); }
  });
  gB.setTransform(a, b, c, d, e, f);
  if (zones.paths[4]) { gB.fillStyle = '#ff0000'; gB.fill(zones.paths[4], 'evenodd'); }
  // Wood lines: only the plates get a step edge (the line layers are thin).
  for (let k = 1; k < zones.paths.length; k++) {
    if (zones.kinds[k] !== 'plate') continue;
    gB.setTransform(a, b, c, d, e + 1.0, f + 1.6);
    gB.filter = 'blur(1.3px)';
    gB.strokeStyle = '#00ff00'; gB.lineWidth = 3.2 * px; gB.stroke(zones.paths[k]);
    gB.filter = 'none';
    gB.setTransform(a, b, c, d, e, f);
    gB.strokeStyle = '#0000ff'; gB.lineWidth = 1.0 * px; gB.stroke(zones.paths[k]);
  }
}

export function zonesFromJson(data) {
  return { box: data.box, paths: data.layers.map(l => new Path2D(l.d)), kinds: data.layers.map(l => l.kind) };
}
