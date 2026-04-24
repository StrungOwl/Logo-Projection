import * as THREE from 'three';

// Build a Shape whose outer boundary follows `outer` (CCW) and whose
// single hole follows `inner` (reversed so it's CW relative to the outer).
function buildRingShape(outer, inner) {
  const shape = new THREE.Shape();
  shape.moveTo(outer[0].x, outer[0].y);
  for (let i = 1; i < outer.length; i++) shape.lineTo(outer[i].x, outer[i].y);
  shape.closePath();

  const hole = new THREE.Path();
  hole.moveTo(inner[inner.length - 1].x, inner[inner.length - 1].y);
  for (let i = inner.length - 2; i >= 0; i--) hole.lineTo(inner[i].x, inner[i].y);
  hole.closePath();
  shape.holes.push(hole);
  return shape;
}

// Inset a CCW closed polygon by `distance`. For CCW input the interior
// sits on the LEFT of each edge, so the inward normal of edge (a→b) is
// (-dy, dx)/len. Each vertex's offset position is its angle bisector
// scaled by `distance / cos(turn/2)` — this is mathematically the same
// as intersecting the two adjacent offset lines, but avoids the
// degenerate case where parallel-line intersection blows up. The same
// formula handles convex and reflex corners; both stay pointed.
//
// Very sharp reflex corners (e.g. inner-star tips) would offset by
// distances much larger than `distance`, producing spikes that
// self-intersect the inset polygon. We clamp at `maxSpikeMul * distance`
// — pointed enough to read as a tip, short enough not to poke through a
// far edge of the inset.
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
    // cos(turn/2) = (n1 . bisector). Both unit vectors, so this is just
    // the dot of n1 with the bisector — equals blen/2 since n1+n2 has
    // length blen and bisector is (n1+n2)/blen.
    const cosHalf = blen * 0.5;
    const len = Math.min(distance / Math.max(cosHalf, 1e-3), maxLen);
    out[i] = { x: b.x + bx * len, y: b.y + by * len };
  }
  return out;
}

function intersectLines(x1, y1, x2, y2, x3, y3, x4, y4) {
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

// Walk a closed polygon by arc length and return `count` evenly-spaced
// points around the perimeter, each with a position and an outward
// tangent (pointing along the edge, CCW).
function samplePerimeter(poly, count) {
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
function samplePolyline(pts, count) {
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
function clipArcAboveY(poly, yCut) {
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

// Build a solid (no-hole) Shape whose outline is: outerArc forward, then
// innerArc reversed. Both arcs are walked CCW and share a y-level at their
// endpoints, so the resulting outline is a closed ring with two flat feet.
function buildArchShape(outerArc, innerArc) {
  const shape = new THREE.Shape();
  shape.moveTo(outerArc[0].x, outerArc[0].y);
  for (let i = 1; i < outerArc.length; i++) shape.lineTo(outerArc[i].x, outerArc[i].y);
  for (let i = innerArc.length - 1; i >= 0; i--) shape.lineTo(innerArc[i].x, innerArc[i].y);
  shape.closePath();
  return shape;
}

function polylineLength(pts) {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  }
  return total;
}

function polygonPerimeter(poly) {
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

// Gate-like frame following an arbitrary convex silhouette:
//   body       — extruded ring between `hull` and an inward-offset inner edge
//   innerLip   — thin raised band along the inner edge (door-jamb step)
//   outerLip   — thin raised band along the outer edge (outer moulding)
//   bosses     — evenly-spaced studs along the ring for ornate detail
//
// `hull` must be given in CCW order in local coords (already centred on
// whatever origin you want the frame to sit on).
export function createGateFrame({
  hull,
  frameWidth = 1.4,
  frameDepth = 0.45,
  lipWidth = 0.25,
  lipDepth = 0.18,
  bossCount = 48,
  bossRadius = 0.22,
  bossDepth = 0.22,
  color = 0xD9B77C,
  material = null,
  gradientMinY = -5,
  gradientMaxY = 5,
  gradientDark = [0.7, 0.58, 0.42],
  gradientBright = [1.0, 1.0, 1.0],
  bottomCutY = null,
  innerOffsetter = insetPolygon,
} = {}) {
  const group = new THREE.Group();

  const mat = material || new THREE.MeshStandardMaterial({
    color,
    metalness: 0.7,
    roughness: 0.3,
    envMapIntensity: 0.3,
  });

  const gradUniforms = {
    uGradMinY:    { value: gradientMinY },
    uGradMaxY:    { value: gradientMaxY },
    uGradDark:    { value: new THREE.Vector3(...gradientDark) },
    uGradBright:  { value: new THREE.Vector3(...gradientBright) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, gradUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nvarying vec3 vGradWP;')
      .replace('#include <project_vertex>',
        '#include <project_vertex>\nvGradWP = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        `#include <common>
         uniform float uGradMinY;
         uniform float uGradMaxY;
         uniform vec3  uGradDark;
         uniform vec3  uGradBright;
         varying vec3  vGradWP;`)
      .replace('#include <color_fragment>',
        `#include <color_fragment>
         float _gt = clamp((vGradWP.y - uGradMinY) / max(uGradMaxY - uGradMinY, 1e-4), 0.0, 1.0);
         diffuseColor.rgb *= mix(uGradDark, uGradBright, _gt);`);
  };
  group.userData.gradUniforms = gradUniforms;

  const inner = innerOffsetter(hull, frameWidth);
  const innerLipOuter = innerOffsetter(hull, frameWidth - lipWidth);
  const outerLipInner = innerOffsetter(hull, lipWidth);
  const midline = innerOffsetter(hull, frameWidth * 0.5);

  const clip = bottomCutY !== null;
  const outerArc = clip ? clipArcAboveY(hull, bottomCutY) : null;
  const innerArc = clip ? clipArcAboveY(inner, bottomCutY) : null;
  const innerLipOuterArc = clip ? clipArcAboveY(innerLipOuter, bottomCutY) : null;
  const outerLipInnerArc = clip ? clipArcAboveY(outerLipInner, bottomCutY) : null;
  const midlineArc = clip ? clipArcAboveY(midline, bottomCutY) : null;

  const bodyShape = clip
    ? buildArchShape(outerArc, innerArc)
    : buildRingShape(hull, inner);
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
    depth: frameDepth,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.035,
    bevelSegments: 3,
    curveSegments: 2,
  });
  group.add(new THREE.Mesh(bodyGeo, mat));

  // Inner lip — raised above the body, narrow band on the inside edge.
  const innerLipShape = clip
    ? buildArchShape(innerLipOuterArc, innerArc)
    : buildRingShape(innerLipOuter, inner);
  const innerLipGeo = new THREE.ExtrudeGeometry(innerLipShape, {
    depth: lipDepth,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.025,
    bevelSegments: 2,
    curveSegments: 2,
  });
  const innerLip = new THREE.Mesh(innerLipGeo, mat);
  innerLip.position.z = frameDepth;
  group.add(innerLip);

  // Outer lip — matching raised band on the outer edge.
  const outerLipShape = clip
    ? buildArchShape(outerArc, outerLipInnerArc)
    : buildRingShape(hull, outerLipInner);
  const outerLipGeo = new THREE.ExtrudeGeometry(outerLipShape, {
    depth: lipDepth,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.025,
    bevelSegments: 2,
    curveSegments: 2,
  });
  const outerLip = new THREE.Mesh(outerLipGeo, mat);
  outerLip.position.z = frameDepth;
  group.add(outerLip);

  // Bosses — short octagonal studs at the middle of the ring.
  if (bossCount > 0 && bossRadius > 0) {
    const bossShape = new THREE.Shape();
    const sides = 8;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const x = Math.cos(a) * bossRadius, y = Math.sin(a) * bossRadius;
      if (i === 0) bossShape.moveTo(x, y); else bossShape.lineTo(x, y);
    }
    bossShape.closePath();
    const bossGeo = new THREE.ExtrudeGeometry(bossShape, {
      depth: bossDepth,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
      bevelSegments: 2,
    });

    let samples;
    if (clip && midlineArc && midlineArc.length >= 2) {
      // Keep boss density constant — scale count by arc length vs full perimeter.
      const fullLen = polygonPerimeter(midline);
      const arcLen = polylineLength(midlineArc);
      const effectiveCount = Math.max(1, Math.round(bossCount * (arcLen / fullLen)));
      samples = samplePolyline(midlineArc, effectiveCount);
    } else {
      samples = samplePerimeter(midline, bossCount);
    }
    for (const s of samples) {
      const mesh = new THREE.Mesh(bossGeo, mat);
      mesh.position.set(s.x, s.y, frameDepth + lipDepth - 0.01);
      mesh.rotation.z = Math.atan2(s.ty, s.tx);
      group.add(mesh);
    }
  }

  return group;
}
