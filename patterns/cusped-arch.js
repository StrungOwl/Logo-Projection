// Procedural multi-foil (cusped) arch silhouette in the Mughal / Indo-Islamic
// tradition: straight vertical sides rising to a shoulder height, then a
// scalloped top made of `cuspCount` foils separated by inward cusps.
//
// Returned polygon is CCW in (x, y) with origin at the centre of the bottom
// edge (bottom-right corner at (+width/2, 0), apex at (0, height)).

export function buildCuspedArchPolygon({
  width,
  height,
  shoulderHeight = null,
  cuspCount = 5,
  cuspDepth = null,
  segmentsPerCusp = 18,
} = {}) {
  const w = width;
  const h = height;
  const sh = shoulderHeight != null ? shoulderHeight : h * 0.35;
  const cd = cuspDepth != null ? cuspDepth : w * 0.055;

  const pts = [];
  // CCW: bottom-right → right wall up → top arch (right shoulder to left
  // shoulder) → left wall down → close.
  pts.push({ x:  w / 2, y: 0 });
  pts.push({ x:  w / 2, y: sh });

  const totalSegments = Math.max(2, cuspCount * segmentsPerCusp);
  // Walk s=0 (right shoulder) to s=1 (left shoulder), inclusive of both
  // via the tapered cusp — sin(π s) makes the cusp amplitude zero at both
  // shoulders so the curve joins the vertical walls without a kink.
  for (let i = 1; i < totalSegments; i++) {
    const s = i / totalSegments;
    const theta = Math.PI * s;         // 0 → π
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    // Base envelope: half-ellipse from right shoulder over apex to left shoulder.
    const baseX = (w / 2) * cosT;
    const baseY = sh + (h - sh) * sinT;

    // Inward direction (toward the arch's geometric centre).
    const inX = -cosT;
    const inY = -sinT;

    // Cusp wave: 1 at cusp positions (including shoulders), 0 at foil peaks.
    const cuspWave = 0.5 + 0.5 * Math.cos(2 * Math.PI * s * cuspCount);
    // Taper kills the cusp amplitude at the shoulders so the curve lands
    // cleanly on the vertical sides.
    const taper = Math.sin(Math.PI * s);
    const inward = cd * taper * cuspWave;

    pts.push({ x: baseX + inward * inX, y: baseY + inward * inY });
  }

  pts.push({ x: -w / 2, y: sh });
  pts.push({ x: -w / 2, y: 0 });

  return pts;
}

// Build a rectangular polygon (CCW) centred on (0, cy) with given width and
// height. Useful for the outer frame surrounding the cusped arches.
export function buildRectanglePolygon({ width, height, cy = 0 } = {}) {
  const hw = width / 2, hh = height / 2;
  return [
    { x:  hw, y: cy - hh },
    { x:  hw, y: cy + hh },
    { x: -hw, y: cy + hh },
    { x: -hw, y: cy - hh },
  ];
}

// Generalised inward polygon offset. Moves each vertex along its inward
// angle bisector by a distance that keeps both adjacent edges at
// perpendicular distance ≈ `offset` from their originals. Works for convex
// and mildly non-convex (e.g. cusped-arch) polygons. Assumes CCW order.
//
// The scale denominator is clamped so reflex/cusp vertices don't shoot
// off to infinity — at worst they move roughly perpendicular by `offset`.
export function insetPolygon(poly, offset) {
  const n = poly.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const curr = poly[i];
    const next = poly[(i + 1) % n];

    let e1x = curr.x - prev.x, e1y = curr.y - prev.y;
    let e2x = next.x - curr.x, e2y = next.y - curr.y;
    const l1 = Math.hypot(e1x, e1y) || 1;
    const l2 = Math.hypot(e2x, e2y) || 1;
    e1x /= l1; e1y /= l1;
    e2x /= l2; e2y /= l2;

    // Inward normal (rotate edge +90° CCW) for a CCW polygon.
    const n1x = -e1y, n1y =  e1x;
    const n2x = -e2y, n2y =  e2x;

    const bx = n1x + n2x, by = n1y + n2y;
    // scale = offset / (bisector · n1) = offset / (1 + n1·n2)
    const dot = n1x * n2x + n1y * n2y;
    const denom = Math.max(1 + dot, 0.2);   // clamp so cusps don't explode
    const s = offset / denom;

    out[i] = { x: curr.x + bx * s, y: curr.y + by * s };
  }
  return out;
}
