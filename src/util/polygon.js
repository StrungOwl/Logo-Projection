// Polygon helpers shared by every effect that walks the logo's silhouette
// (the outer ring of the model). Originally lived inside the gate-frame
// and lattice-underlay effect files; extracted here so brick arches,
// petal rings, and pattern clips all use one implementation.

// Inset a CCW closed polygon by `distance`. For CCW input the interior
// sits on the LEFT of each edge, so the inward normal of edge (a→b) is
// (-dy, dx)/len. Each vertex's offset position is its angle bisector
// scaled by `distance / cos(turn/2)` — same as intersecting the two
// adjacent offset lines, but avoids the parallel-line degenerate case.
//
// Very sharp reflex corners (e.g. inner-star tips) would offset by
// distances much larger than `distance`, producing spikes that
// self-intersect the inset polygon. We clamp at `maxSpikeMul * distance`
// — pointed enough to read as a tip, short enough not to poke through
// a far edge of the inset.
export function insetPolygon(poly, distance, maxSpikeMul = 3) {
  const n = poly.length;
  const out = new Array(n);
  const maxLen = distance * maxSpikeMul;
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n], b = poly[i], c = poly[(i + 1) % n];
    const e1x = b.x - a.x, e1y = b.y - a.y;
    const e2x = c.x - b.x, e2y = c.y - b.y;
    const l1 = Math.hypot(e1x, e1y) || 1;
    const l2 = Math.hypot(e2x, e2y) || 1;
    const n1x = -e1y / l1, n1y = e1x / l1;
    const n2x = -e2y / l2, n2y = e2x / l2;
    let bx = n1x + n2x, by = n1y + n2y;
    const blen = Math.hypot(bx, by);
    if (blen < 1e-6) { out[i] = { x: b.x + n1x * distance, y: b.y + n1y * distance }; continue; }
    bx /= blen; by /= blen;
    const cosHalf = blen * 0.5;
    const len = Math.min(distance / Math.max(cosHalf, 1e-3), maxLen);
    out[i] = { x: b.x + bx * len, y: b.y + by * len };
  }
  return out;
}

// Walk a closed polygon by arc length and return `count` evenly-spaced
// points around the perimeter, each with a position and an outward
// tangent (pointing along the edge, CCW).
export function samplePerimeter(poly, count) {
  const segLens = [];
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segLens.push(len);
    total += len;
  }
  const out = [];
  const step = total / count;
  for (let k = 0; k < count; k++) {
    let target = k * step;
    for (let i = 0; i < poly.length; i++) {
      if (target <= segLens[i]) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const f = segLens[i] > 0 ? target / segLens[i] : 0;
        out.push({
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          tx: (b.x - a.x) / (segLens[i] || 1),
          ty: (b.y - a.y) / (segLens[i] || 1),
        });
        break;
      }
      target -= segLens[i];
    }
  }
  return out;
}

// Evenly-spaced samples along an open polyline (not a closed loop), centred
// in each interval so no sample lands on either endpoint.
export function samplePolyline(pts, count) {
  const segLens = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segLens.push(len);
    total += len;
  }
  const out = [];
  if (count < 1 || total <= 0) return out;
  const step = total / count;
  for (let k = 0; k < count; k++) {
    let target = (k + 0.5) * step;
    for (let i = 0; i < pts.length - 1; i++) {
      if (target <= segLens[i]) {
        const a = pts[i], b = pts[i + 1];
        const f = segLens[i] > 0 ? target / segLens[i] : 0;
        out.push({
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          tx: (b.x - a.x) / (segLens[i] || 1),
          ty: (b.y - a.y) / (segLens[i] || 1),
        });
        break;
      }
      target -= segLens[i];
    }
  }
  return out;
}

// For a CCW convex polygon, return the boundary arc lying strictly above
// yCut, walked in CCW order. Result starts at the ascending crossing point
// and ends at the descending crossing point, with a flat gap left between
// them. Entire-above / entire-below cases fall back sensibly.
export function clipArcAboveY(poly, yCut) {
  const n = poly.length;
  const above = poly.map(p => p.y > yCut);
  let entryIdx = -1, exitIdx = -1;
  for (let i = 0; i < n; i++) {
    const a = above[i], b = above[(i + 1) % n];
    if (!a && b) entryIdx = i;
    if (a && !b) exitIdx = i;
  }
  if (entryIdx < 0 || exitIdx < 0) {
    return above[0] ? poly.slice() : [];
  }
  const intersect = (a, b) => {
    const t = (yCut - a.y) / (b.y - a.y);
    return { x: a.x + (b.x - a.x) * t, y: yCut };
  };
  const entryPt = intersect(poly[entryIdx], poly[(entryIdx + 1) % n]);
  const exitPt = intersect(poly[exitIdx], poly[(exitIdx + 1) % n]);
  const arc = [entryPt];
  let i = (entryIdx + 1) % n;
  while (true) {
    arc.push(poly[i]);
    if (i === exitIdx) break;
    i = (i + 1) % n;
  }
  arc.push(exitPt);
  return arc;
}

// Sutherland-Hodgman clip of a closed polygon against the half-plane
// y <= yCut. Returns a new polygon containing only the portion below
// yCut, with the open top closed by the intersection points on the
// cut line. Handles non-convex inputs correctly (the algorithm is
// stable against arbitrary closed polygons clipping to a half-plane).
export function clipPolygonBelowY(poly, yCut) {
  const n = poly.length;
  if (n === 0) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const cur  = poly[i];
    const next = poly[(i + 1) % n];
    const curIn  = cur.y  <= yCut;
    const nextIn = next.y <= yCut;
    if (curIn && nextIn) {
      out.push({ x: next.x, y: next.y });
    } else if (curIn && !nextIn) {
      // Leaving the half-plane — emit intersection at yCut.
      const t = (yCut - cur.y) / (next.y - cur.y);
      out.push({ x: cur.x + (next.x - cur.x) * t, y: yCut });
    } else if (!curIn && nextIn) {
      // Entering — emit intersection then next.
      const t = (yCut - cur.y) / (next.y - cur.y);
      out.push({ x: cur.x + (next.x - cur.x) * t, y: yCut });
      out.push({ x: next.x, y: next.y });
    }
    // both outside: emit nothing
  }
  return out;
}

// Sutherland-Hodgman clip against an axis-aligned half-plane x <= xCut.
// Returns a new polygon containing only the portion to the left of xCut.
export function clipPolygonLeftOfX(poly, xCut) {
  const n = poly.length;
  if (n === 0) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const cur  = poly[i];
    const next = poly[(i + 1) % n];
    const curIn  = cur.x  <= xCut;
    const nextIn = next.x <= xCut;
    if (curIn && nextIn) {
      out.push({ x: next.x, y: next.y });
    } else if (curIn && !nextIn) {
      const t = (xCut - cur.x) / (next.x - cur.x);
      out.push({ x: xCut, y: cur.y + (next.y - cur.y) * t });
    } else if (!curIn && nextIn) {
      const t = (xCut - cur.x) / (next.x - cur.x);
      out.push({ x: xCut, y: cur.y + (next.y - cur.y) * t });
      out.push({ x: next.x, y: next.y });
    }
  }
  return out;
}

// Sutherland-Hodgman clip against an axis-aligned half-plane x >= xCut.
export function clipPolygonRightOfX(poly, xCut) {
  const n = poly.length;
  if (n === 0) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const cur  = poly[i];
    const next = poly[(i + 1) % n];
    const curIn  = cur.x  >= xCut;
    const nextIn = next.x >= xCut;
    if (curIn && nextIn) {
      out.push({ x: next.x, y: next.y });
    } else if (curIn && !nextIn) {
      const t = (xCut - cur.x) / (next.x - cur.x);
      out.push({ x: xCut, y: cur.y + (next.y - cur.y) * t });
    } else if (!curIn && nextIn) {
      const t = (xCut - cur.x) / (next.x - cur.x);
      out.push({ x: xCut, y: cur.y + (next.y - cur.y) * t });
      out.push({ x: next.x, y: next.y });
    }
  }
  return out;
}

// Ray-casting point-in-polygon test (winding number variant). Returns
// true if (x, y) is strictly inside `poly`. Edges count as outside.
export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}
