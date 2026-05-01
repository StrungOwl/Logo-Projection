// Procedural-brick arch effect. Three groups stacked on the same logo:
//
//   1. Outer arch row — bricks placed along the gate frame's inner ogee
//      curve. Brick local-X (longest dim) aligns with world-Z so the
//      brick juts toward the camera. Static.
//
//   2. Inner cascade arch row — same curve, scaled so the bricks protrude
//      less in Z. Each brick falls from above its rest pose and settles in
//      with an arc-length-staggered start time (apex-first by default), so
//      the arch reads as crystallizing out of the keystone down to the
//      springers.
//
//   3. Floor fill — bricks laid flat (long-X) tiled in running bond across
//      the gate frame's interior, below the arch springer line. Bricks
//      whose centre falls outside the silhouette (incl. interior cutouts)
//      are dropped, so the boundary reads ragged but no brick overhangs.
//
// Each brick carries a deterministic seeded jitter on its vertex positions,
// clamped strictly inside a uniform mortarGap shrink. Two bricks therefore
// never interpenetrate regardless of fault amount.

import * as THREE from 'three';
import { ANIM } from '../src/config.js';
import { insetPolygon, samplePolyline, clipArcAboveY, samplePerimeter } from './gate-frame.js';
import { pointInPolygon } from './lattice-underlay.js';
import { applyGoldShimmer } from '../src/shaders/gold-shimmer.js';

// -----------------------------------------------------------------------
// Brick geometry — BoxGeometry shrunk by mortarGap, then jittered per
// vertex by a position-keyed hash. Same hash → same delta on every vertex
// at that original position, so shared corners stay welded (no cracks).
// -----------------------------------------------------------------------
function hash01(x, y, z, salt) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + salt * 91.345) * 43758.5453;
  return s - Math.floor(s);
}

function makeBrickGeometry(seed, brickCfg) {
  const { width, height, depth, mortarGap, faultAmount } = brickCfg;
  const geo = new THREE.BoxGeometry(width, height, depth, 1, 1, 1);
  const pos = geo.attributes.position;
  // Shrink uniformly so the brick sits inside its slot with `mortarGap`
  // breathing room on every face. Faults will move vertices within that
  // gap, never poking past the original cuboid.
  const sx = Math.max(0, 1 - (mortarGap * 2) / width);
  const sy = Math.max(0, 1 - (mortarGap * 2) / height);
  const sz = Math.max(0, 1 - (mortarGap * 2) / depth);
  // Max per-axis displacement: bounded by both faultAmount*depth and the
  // mortar gap, so a brick is guaranteed to fit inside its slot.
  const maxJ = Math.min(faultAmount * depth, mortarGap);

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i) * sx;
    let y = pos.getY(i) * sy;
    let z = pos.getZ(i) * sz;
    // Original (pre-shrink) position drives the hash so symmetric vertices
    // get matching deltas across faces.
    const ox = pos.getX(i), oy = pos.getY(i), oz = pos.getZ(i);
    const dx = (hash01(ox, oy, oz, seed +  3.1) - 0.5) * 2 * maxJ;
    const dy = (hash01(ox, oy, oz, seed + 17.7) - 0.5) * 2 * maxJ;
    const dz = (hash01(ox, oy, oz, seed + 41.3) - 0.5) * 2 * maxJ;
    pos.setXYZ(i, x + dx, y + dy, z + dz);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// Quaternion that maps brick-local axes onto chosen world directions.
// Each parameter is a unit world-space vector for the corresponding local
// axis. Three.js' Matrix4.makeBasis takes the columns of the rotation
// matrix in this exact order.
const _basisMat = new THREE.Matrix4();
function basisQuat(localX, localY, localZ) {
  _basisMat.makeBasis(localX, localY, localZ);
  return new THREE.Quaternion().setFromRotationMatrix(_basisMat);
}

// One pass of tangent averaging: smooths out jitter from the RDP-
// simplified silhouette so neighbouring brick rotations don't visibly
// hop. Each sample's tangent becomes the mean of itself and its two
// neighbours, renormalised.
function smoothTangents(samples) {
  const n = samples.length;
  if (n < 3) return samples;
  const tx = new Float32Array(n);
  const ty = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[i];
    const c = samples[Math.min(n - 1, i + 1)];
    let mx = a.tx + b.tx + c.tx;
    let my = a.ty + b.ty + c.ty;
    const len = Math.hypot(mx, my) || 1;
    tx[i] = mx / len;
    ty[i] = my / len;
  }
  for (let i = 0; i < n; i++) {
    samples[i].tx = tx[i];
    samples[i].ty = ty[i];
  }
  return samples;
}

// Build the inner-ogee curve we walk for both arch rows. Returns:
//   { samples: [{x,y,tx,ty}], totalLength, apexIndex, springerY }
function buildArchCurve({ silhouette, gateFrameWidth, brickHeight,
                          springerYFrac, brickWidth }) {
  // Two insets: gateFrameWidth (matches the gate-frame inner lip) plus
  // half a brick height so the brick's outer face sits flush with the
  // lip. Arch bricks therefore live entirely INSIDE the gate frame's
  // inner aperture.
  const inset1 = insetPolygon(silhouette, gateFrameWidth);
  const inset2 = insetPolygon(inset1, brickHeight * 0.5);

  // Bbox to derive the springer Y cut.
  let minY = Infinity, maxY = -Infinity;
  for (const p of inset2) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const springerY = minY + (maxY - minY) * springerYFrac;

  const arc = clipArcAboveY(inset2, springerY);
  if (arc.length < 2) return { samples: [], totalLength: 0, apexIndex: 0, springerY };

  // Total arc length and uniform sample count from brick width.
  let totalLength = 0;
  for (let i = 0; i < arc.length - 1; i++) {
    totalLength += Math.hypot(arc[i + 1].x - arc[i].x, arc[i + 1].y - arc[i].y);
  }
  const count = Math.max(3, Math.round(totalLength / brickWidth));
  let samples = samplePolyline(arc, count);
  samples = smoothTangents(samples);

  // Apex = sample with largest Y. Cascade direction works from this.
  let apexIndex = 0;
  let apexY = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].y > apexY) { apexY = samples[i].y; apexIndex = i; }
  }
  return { samples, totalLength, apexIndex, springerY };
}

// Outward-radial direction at a sample (inset polygon is CCW so the
// outward normal — pointing toward the gate frame — is the right-hand
// 90° turn of the tangent).
function outwardNormal2D(tx, ty) {
  return { x: ty, y: -tx };
}

// Outset a CCW polygon by `distance` (positive expands OUTWARD). Mirrors
// gate-frame.js's insetPolygon but uses the outward (right-hand) bisector,
// so the maxSpikeMul cap clamps with positive numbers and Math.min picks
// the SHORTER spike — same behaviour insetPolygon has at sharp convex
// corners. Required because insetPolygon with a negative distance picks
// the MORE negative of the two clamps and overshoots ~maxSpikeMul× near
// concave corners (the SDG side flares), causing the offset polygon to
// self-intersect and land inside the original silhouette.
function outsetPolygonCCW(poly, distance, maxSpikeMul = 3) {
  const n = poly.length;
  const out = new Array(n);
  const maxLen = distance * maxSpikeMul;
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n], b = poly[i], c = poly[(i + 1) % n];
    const e1x = b.x - a.x, e1y = b.y - a.y;
    const e2x = c.x - b.x, e2y = c.y - b.y;
    const l1 = Math.hypot(e1x, e1y) || 1;
    const l2 = Math.hypot(e2x, e2y) || 1;
    // Right-90° rotation of each edge tangent = outward normal for CCW.
    const n1x = e1y / l1, n1y = -e1x / l1;
    const n2x = e2y / l2, n2y = -e2x / l2;
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

// Polygon perimeter length.
function polyPerimeter(poly) {
  let p = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    p += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return p;
}

// Even-odd point-in-silhouette test across all silhouette loops (outer +
// any inner cutouts). True iff (x, y) is inside the SOLID region of the
// logo — i.e., inside the outer loop and outside every cutout. Used to
// reject muqarnas cells whose centre or tip falls into the star bay or
// any other interior cutout, so cells never extend into a void.
function insideSilhouette(x, y, silhouettes) {
  let inside = pointInPolygon(x, y, silhouettes[0]);
  for (let k = 1; k < silhouettes.length; k++) {
    if (pointInPolygon(x, y, silhouettes[k])) inside = !inside;
  }
  return inside;
}

// Expand a polygon radially away from a centre point. Each vertex moves
// directly away from (cx, cy) by `dist` units. For our star bay (4-point
// star centred at the bay centroid), this preserves the angular shape
// and just scales the radii outward — perfect for building the curved
// brick rails that wrap the star at progressively larger offsets.
function offsetPolygonFromPoint(poly, cx, cy, dist) {
  const out = new Array(poly.length);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const dx = p.x - cx, dy = p.y - cy;
    const l  = Math.hypot(dx, dy) || 1;
    out[i] = { x: p.x + (dx / l) * dist, y: p.y + (dy / l) * dist };
  }
  return out;
}

// Polygon centroid (simple vertex-average; accurate enough for our
// near-symmetric star bay).
function polyCentroid(poly) {
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
  return { x: cx / poly.length, y: cy / poly.length };
}

// 4 corners of an oriented bounding box centred at (cx, cy), with size
// (w, h) along axes (ux, uy) and the perpendicular (-uy, ux). Used by
// the brick collision check below.
function obbCorners(cx, cy, halfW, halfH, ux, uy) {
  const px = -uy, py = ux;
  return [
    { x: cx - ux * halfW - px * halfH, y: cy - uy * halfW - py * halfH },
    { x: cx + ux * halfW - px * halfH, y: cy + uy * halfW - py * halfH },
    { x: cx + ux * halfW + px * halfH, y: cy + uy * halfW + py * halfH },
    { x: cx - ux * halfW + px * halfH, y: cy - uy * halfW + py * halfH },
  ];
}

// Separating Axis Theorem overlap test for two convex 2D polygons. Used
// to detect brick-vs-brick collisions in the curved rail layers — each
// candidate brick is OBB-tested against every brick already placed in
// the same ring; overlap → skip. With rotated rectangles AABBs would
// produce many false-positives at corners, so we do proper OBB SAT.
function obbsOverlap(a, b) {
  for (const poly of [a, b]) {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p1 = poly[i], p2 = poly[(i + 1) % n];
      const ex = p2.x - p1.x, ey = p2.y - p1.y;
      const len = Math.hypot(ex, ey) || 1;
      // Edge normal (perpendicular to edge, unit-length).
      const nx = -ey / len, ny = ex / len;
      let amin =  Infinity, amax = -Infinity;
      let bmin =  Infinity, bmax = -Infinity;
      for (let k = 0; k < a.length; k++) {
        const d = a[k].x * nx + a[k].y * ny;
        if (d < amin) amin = d;
        if (d > amax) amax = d;
      }
      for (let k = 0; k < b.length; k++) {
        const d = b[k].x * nx + b[k].y * ny;
        if (d < bmin) bmin = d;
        if (d > bmax) bmax = d;
      }
      if (amax < bmin || bmax < amin) return false;  // separating axis
    }
  }
  return true;
}

// -----------------------------------------------------------------------
// Pointed-arch cell — extruded 2D shape used as the per-cell muqarnas
// niche. The 2D shape lives in local-XY with:
//   local-X spans 0 .. length  (the cell's radial axis; pointed end at +X)
//   local-Y spans -width/2 .. +width/2  (the cell's tangential width)
// The shape has a flat BASE at X=0 (sits on the tier polygon) and a
// pointed TIP at X=length (faces radially inward toward the star). The
// extrusion runs along local-Z by `thickness` and is centred on z=0 so
// the mesh's position.z lands at the cell's middle-thickness.
// -----------------------------------------------------------------------
function makeArchCellGeometry(length, width, thickness) {
  const shape = new THREE.Shape();
  const halfW = width * 0.5;
  // Flat base on the polygon (X=0), then the two side walls curve up to
  // a point at (length, 0). Quadratic control points pulled in toward
  // the tip so the silhouette reads as a pointed lancet rather than a
  // round semicircle.
  shape.moveTo(0, -halfW);
  shape.lineTo(0,  halfW);
  shape.quadraticCurveTo(length * 0.65,  halfW, length, 0);
  shape.quadraticCurveTo(length * 0.65, -halfW, 0,    -halfW);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth:        thickness,
    bevelEnabled: false,
    curveSegments: 8,
  });
  // Centre the extrusion on z=0 so position.z is the cell's mid-thickness.
  geo.translate(0, 0, -thickness * 0.5);
  return geo;
}

// -----------------------------------------------------------------------
// Muqarnas tier — places small pointed-arch cells along a polygon's
// perimeter. Each cell is oriented so:
//   local-X → world radial-INWARD  (cell's tip points toward star)
//   local-Y → polygon tangent      (cell width along curve)
//   local-Z → world +Z             (cell thickness, perpendicular to wall)
// The cell's base (X=0 in shape coords) sits on the tier polygon, so the
// tip extends inward by `cellRadial`. Inset the polygon by `cellRadial`
// to obtain the next tier's polygon — cells then nest tier-to-tier with
// no radial gap. Each tier's `zCenter` parks the cells' mid-thickness
// at a chosen depth, and tiers step deeper into the wall per `tierStepZ`
// so the cells appear DUG INTO the wall (not protruding out toward the
// camera) — which is what the reference muqarnas vault does.
//
// `startOffset` rotates the sample start position around the loop so
// adjacent tiers can stagger by half a cell (brick-course offset).
// -----------------------------------------------------------------------
function placeMuqarnasTier({ polygon, cellW, cellRadial, cellThick,
                             zCenter, startOffset, material, group,
                             silhouettes, centerX, centerY,
                             backWall }) {
  const perim = polyPerimeter(polygon);
  const sampleCount = Math.max(6, Math.round(perim / cellW));
  let samples = samplePerimeter(polygon, sampleCount);
  samples = smoothTangents(samples);

  // startOffset: rotate sample list so cells of this tier start at a
  // shifted angular position (used to stagger alternate tiers by half a
  // cell — see tierOffsetAlternate in the config).
  if (startOffset && samples.length > 1) {
    const shift = Math.round(startOffset * samples.length) % samples.length;
    if (shift > 0) {
      samples = samples.slice(shift).concat(samples.slice(0, shift));
    }
  }

  const geo = makeArchCellGeometry(cellRadial, cellW, cellThick);
  // Optional shadow back-wall: a smaller, darker pointed-arch shape
  // sitting INSIDE each cell, recessed in Z by `cellThick + offset`,
  // so the eye reads it as the dark interior of the niche behind the
  // visible arch frame. Built once per tier, reused for all cells.
  let backGeo = null, backMat = null, backDz = 0;
  if (backWall && backWall.scale > 0) {
    backGeo = makeArchCellGeometry(
      cellRadial * backWall.scale,
      cellW      * backWall.scale,
      Math.max(cellThick * 0.4, 0.06),
    );
    backMat = new THREE.MeshStandardMaterial({
      color:     backWall.color,
      metalness: 0.0,
      roughness: 1.0,
    });
    backDz = -(cellThick * 0.5 + (backWall.offset || 0.15));
  }

  const localX = new THREE.Vector3();
  const localY = new THREE.Vector3();
  const localZ = new THREE.Vector3(0, 0, 1);

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];

    // Inward direction = -outwardNormal of local tangent, then sign-
    // checked against the centroid direction. This keeps cells
    // oriented along the LOCAL perimeter curve (architectural feel,
    // adjacent cells follow the arc) but flips if the polygon's
    // winding or a local concavity makes the tangent-based "inward"
    // actually point AWAY from the centroid — fixes the right-side
    // mis-orientation seen with pure tangent-based inward.
    const out  = outwardNormal2D(s.tx, s.ty);
    let   inX  = -out.x;
    let   inY  = -out.y;
    const toCx = centerX - s.x;
    const toCy = centerY - s.y;
    // If our chosen inward points away from the centroid (negative dot
    // product), flip it. Tangent stays as the local edge tangent so
    // cell width still aligns with the perimeter walk.
    if (inX * toCx + inY * toCy < 0) {
      inX = -inX;
      inY = -inY;
    }
    const tanX = s.tx;
    const tanY = s.ty;

    // Cell's tip (radial-inward end) and mid point — tested against
    // silhouette so cells whose footprint enters a cutout (the star
    // bay) are rejected. This is what stops the muqarnas from
    // outlining the inner star: cells whose tip would land in the
    // cutout simply aren't placed.
    const tipX = s.x + inX * cellRadial;
    const tipY = s.y + inY * cellRadial;
    const midX = s.x + inX * cellRadial * 0.5;
    const midY = s.y + inY * cellRadial * 0.5;

    if (silhouettes) {
      if (!insideSilhouette(s.x,  s.y,  silhouettes)) continue;
      if (!insideSilhouette(midX, midY, silhouettes)) continue;
      if (!insideSilhouette(tipX, tipY, silhouettes)) continue;
    }

    localX.set(inX,  inY,  0);
    localY.set(tanX, tanY, 0);
    const q = basisQuat(localX, localY, localZ);

    // Dark back-wall mesh recessed inside the cell — gives each cell a
    // visible "shadow interior" so they read as 3D niches rather than
    // flat extruded petals. Slightly inset on local-X (radial) so its
    // tip doesn't poke past the parent cell's silhouette.
    if (backGeo) {
      const back = new THREE.Mesh(backGeo, backMat);
      const insetRadial = cellRadial * (1 - (backWall.scale || 1)) * 0.5;
      back.position.set(
        s.x + inX * insetRadial,
        s.y + inY * insetRadial,
        zCenter + backDz,
      );
      back.quaternion.copy(q);
      group.add(back);
    }

    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(s.x, s.y, zCenter);
    mesh.quaternion.copy(q);
    group.add(mesh);
  }
}

// Walk the full closed perimeter of the gate-frame inner aperture and
// return uniformly-spaced samples around the entire loop. Used by the
// outline brick layer so bricks wrap continuously around the aperture
// (top arch + sides + bottom) instead of stopping at a springer line.
function buildPerimeterCurve({ silhouette, gateFrameWidth, brickHeight, brickWidth }) {
  const inset1 = insetPolygon(silhouette, gateFrameWidth);
  const inset2 = insetPolygon(inset1, brickHeight * 0.5);
  if (inset2.length < 3) {
    return { samples: [], totalLength: 0, apexIndex: 0, perimeterPoly: inset2 };
  }
  let totalLength = 0;
  for (let i = 0; i < inset2.length; i++) {
    const a = inset2[i], b = inset2[(i + 1) % inset2.length];
    totalLength += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const count = Math.max(8, Math.round(totalLength / brickWidth));
  let samples = samplePerimeter(inset2, count);
  samples = smoothTangents(samples);
  let apexIndex = 0;
  let apexY = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].y > apexY) { apexY = samples[i].y; apexIndex = i; }
  }
  return { samples, totalLength, apexIndex, perimeterPoly: inset2 };
}

// -----------------------------------------------------------------------
// Outer arch row — static. Bricks oriented:
//   local-X → world-Z (longest dim sticks toward camera)
//   local-Y → world-radial-outward (from arch interior toward gate frame)
//   local-Z → curve tangent (along the arch curve)
// -----------------------------------------------------------------------
function placeArchRow({ samples, brickCfg, depthScale, zCenter, material,
                        group, seedOffset = 0, withRestPose = false }) {
  const localX = new THREE.Vector3(0, 0, 1);
  const localY = new THREE.Vector3();
  const localZ = new THREE.Vector3();
  // depthScale shrinks the brick's world-Z extent, which for an arch brick
  // is its local-X dimension (brickCfg.width — the "longest on Z" axis).
  const dimsForFault = {
    ...brickCfg,
    width: brickCfg.width * depthScale,
  };
  const bricks = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const n = outwardNormal2D(s.tx, s.ty);
    localY.set(n.x, n.y, 0).normalize();
    localZ.set(s.tx, s.ty, 0).normalize();
    const geo  = makeBrickGeometry(i + seedOffset, dimsForFault);
    const mesh = new THREE.Mesh(geo, material);
    // Local axes: brick.depth is the per-instance depth (already scaled).
    // We baked the scaling into the geometry, so position is just the
    // sample point lifted to zCenter.
    mesh.position.set(s.x, s.y, zCenter);
    mesh.quaternion.copy(basisQuat(localX, localY, localZ));
    if (withRestPose) {
      mesh.userData.restPos = mesh.position.clone();
      mesh.userData.restQuat = mesh.quaternion.clone();
    }
    group.add(mesh);
    bricks.push(mesh);
  }
  return bricks;
}

// -----------------------------------------------------------------------
// Inner cascade arch row — same as outer with depthScale<1, plus per-brick
// startPose (lifted +fallHeight in world Y) and a stagger-driven startTime.
// -----------------------------------------------------------------------
function placeInnerCascadeRow({ samples, apexIndex, totalLength, brickCfg,
                                cascadeCfg, zCenter, material, group, seedOffset }) {
  const bricks = placeArchRow({
    samples, brickCfg, depthScale: cascadeCfg.depthScale,
    zCenter, material, group, seedOffset, withRestPose: true,
  });
  // Arc-length distance from apex for stagger ordering.
  const springerFirst = cascadeCfg.cascade.direction === 'springer-first';
  // Pre-compute cumulative arc length so we can rank bricks by arc-distance
  // from the apex.
  const cum = [0];
  for (let i = 1; i < samples.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x,
                                     samples[i].y - samples[i - 1].y));
  }
  const apexArc = cum[apexIndex];
  for (let i = 0; i < bricks.length; i++) {
    const arcDist = Math.abs(cum[i] - apexArc);
    const norm = totalLength > 0 ? arcDist / totalLength : 0;
    const order = springerFirst ? (1 - norm) : norm;
    bricks[i].userData.cascadeOrder = order;
    const startPos = bricks[i].userData.restPos.clone();
    startPos.y += cascadeCfg.cascade.fallHeight;
    bricks[i].userData.startPos = startPos;
  }
  return bricks;
}

// -----------------------------------------------------------------------
// Floor fill — running-bond grid in the area below the springer line, inside
// the silhouette (with even-odd rule for interior cutouts). Bricks oriented:
//   local-X → world-X (long axis horizontal, left-right)
//   local-Y → world-Z (short axis vertical, brick "stands on its face")
//   local-Z → world-Y (depth runs front-to-back across the floor)
// -----------------------------------------------------------------------
// Build an inside-arch test from a bbox + archShape config. Returns null
// if archShape is disabled or missing. Geometry: two-centred lancet —
// each side is a circular arc through a springer at the side and the
// apex at the top, with its center on the springer line on the OPPOSITE
// side. Below the springer line the cutout extends as vertical walls.
function makeInsideArch(minX, maxX, minY, maxY, archShape) {
  if (!archShape || archShape.enabled === false) return null;
  const halfWBox  = (maxX - minX) * 0.5;
  const cxBox     = (maxX + minX) * 0.5;
  const springerY = minY + (archShape.springerYFrac ?? 0.10) * (maxY - minY);
  const apexY     = minY + (archShape.apexYFrac     ?? 0.85) * (maxY - minY);
  const s         = (archShape.springerXFrac        ?? 0.55) * halfWBox;
  const h         = apexY - springerY;
  const c         = (h > s) ? (h * h - s * s) / (2 * s) : 0;
  const r         = s + c;
  return (px, py) => {
    const localY = py - springerY;
    if (localY > h) return false;
    const localX = Math.abs(px - cxBox);
    if (localY < 0) return localX < s;
    const dx = localX + c;
    return dx * dx + localY * localY < r * r;
  };
}

// Lancet tier metric — for each cell (px, py), return the half-span
// `s_cell` of the lancet (anchored at SHARED apex (cx, apexY) and SHARED
// springer line) whose outline passes through that cell. Contours of
// constant s_cell are nested two-centred lancet arches that all reach
// the SAME apex point at the silhouette top — only their springer
// widths vary. This guarantees every tier's apex tip sits at the same
// high Y (above the inner star aperture), at the cost of inner tiers
// being narrower (and therefore pointier). The alternative of scaling
// uniformly around the springer centre (which preserves curvature)
// drops the inner-tier apexes progressively lower, which the user has
// rejected in favour of all-tips-high.
//
// Math: given a cell's (localX, localY) relative to (cx, springerY),
// find c_cell such that the right-arc circle (centre (cx − c_cell, 0),
// passing through apex (0, h)) also passes through the cell. From
//   c_cell² + h² = (localX + c_cell)² + localY²
// → c_cell = (h² − localX² − localY²) / (2·localX)
// Then s_cell = sqrt(c_cell² + h²) − c_cell.
function makeLancetTierMetric(minX, maxX, minY, maxY, archShape, innerSFrac) {
  const cx        = (minX + maxX) * 0.5;
  const halfWBox  = (maxX - minX) * 0.5;
  const springerY = minY + (archShape?.springerYFrac ?? 0.05) * (maxY - minY);
  const apexY     = minY + (archShape?.apexYFrac     ?? 0.95) * (maxY - minY);
  const sOuter    = (archShape?.springerXFrac        ?? 0.95) * halfWBox;
  const sInner    = sOuter * (innerSFrac ?? 0.05);
  const h         = apexY - springerY;
  const invSpan   = 1 / Math.max(1e-9, sOuter - sInner);
  return {
    cx, springerY, h, sOuter, sInner, invSpan,
    sCell(px, py) {
      const localX = Math.abs(px - cx);
      const localY = py - springerY;
      // Y-checks fire BEFORE the central-axis X-check so cells in those
      // Y bands (even on the axis) get the correct shell.
      if (localY > h)    return sOuter;       // above apex → outermost shell
      if (localY < 0)    return localX;       // below springer: vertical-wall tier
      if (localX < 1e-6) return 0;            // central axis (below apex) → innermost
      const cCell = (h * h - localX * localX - localY * localY) / (2 * localX);
      if (cCell <= 0)    return sOuter;       // outside lancet domain → outermost
      return Math.sqrt(cCell * cCell + h * h) - cCell;
    },
  };
}

function placeFloor({ silhouettes, springerY = Infinity, brickCfg, floorCfg, zCenter,
                      material, group, seedOffset, dropoutProb = 0, dropoutSalt = 0,
                      archShape = null }) {
  // Bbox of the entire silhouette (outer loop). We track maxY too so the
  // grid can fill all the way up when no springer cap is supplied.
  const outer = silhouettes[0];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of outer) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const yCap = Math.min(springerY, maxY);
  // Per-axis grid spacing. mortarGapX/mortarGapY override the default
  // mortarGap on a single axis so we can space bricks apart horizontally
  // while keeping vertical rows tight (or vice versa). The brick
  // geometry's shrink still uses the symmetric mortarGap so individual
  // bricks read as full-size; only the grid stepping changes.
  const gapX  = brickCfg.mortarGapX ?? brickCfg.mortarGap;
  const gapY  = brickCfg.mortarGapY ?? brickCfg.mortarGap;
  const stepX = brickCfg.width + gapX * 2;
  const stepY = brickCfg.depth + gapY * 2;
  const cols  = Math.ceil((maxX - minX) / stepX) + 2;
  const rows  = Math.ceil((yCap - minY) / stepY) + 1;

  const localX = new THREE.Vector3(1, 0, 0);
  const localY = new THREE.Vector3(0, 0, 1);
  const localZ = new THREE.Vector3(0, 1, 0);
  const q = basisQuat(localX, localY, localZ);

  // Brick footprint = halfWidth × halfDepth around its centre. We accept
  // a brick if its centre OR any of its four corners is inside the
  // solid silhouette region. This lets bricks at the edge get placed
  // even when their centre falls outside the polygon — the visible
  // ring of bricks then covers the whole interior right up to the
  // silhouette boundary, instead of leaving a jagged gap one brick wide.
  const halfBW = brickCfg.width  * 0.5;
  const halfBD = brickCfg.depth  * 0.5;

  // Even-odd polygon test across all silhouette loops (so interior cutouts
  // are excluded).
  function insideAll(x, y) {
    let inside = pointInPolygon(x, y, outer);
    for (let k = 1; k < silhouettes.length; k++) {
      if (pointInPolygon(x, y, silhouettes[k])) inside = !inside;
    }
    return inside;
  }

  const insideArchTest = makeInsideArch(minX, maxX, minY, maxY, archShape);

  const bricks = [];
  let seedCounter = 0;
  const offsetFrac = (floorCfg.pattern === 'running-bond') ? floorCfg.rowOffset : 0;
  // Brick top should sit at zCenter + brick.height/2; we anchor brick
  // centre Z at zCenter so the bottom face is at zCenter - height/2 and the
  // top face protrudes height/2 toward the camera.
  for (let r = 0; r < rows; r++) {
    const rowOffset = (r % 2 === 1) ? offsetFrac * stepX : 0;
    const y = minY + (r + 0.5) * stepY;
    if (y > yCap) continue;
    for (let c = 0; c < cols; c++) {
      const x = minX + (c + 0.5) * stepX + rowOffset;
      if (!insideAll(x, y)) continue;
      if (insideArchTest && insideArchTest(x, y)) continue;
      // Deterministic per-cell dropout: hash the grid cell so the same
      // (r, c) always picks the same coin-flip across reloads. Pass
      // dropoutProb=0.5 to skip ~half the bricks; salt lets two layers
      // sharing the same grid drop different cells.
      if (dropoutProb > 0 && hash01(c, r, 0, dropoutSalt) < dropoutProb) continue;
      const geo = makeBrickGeometry(seedOffset + seedCounter++, brickCfg);
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(x, y, zCenter);
      mesh.quaternion.copy(q);
      group.add(mesh);
      bricks.push(mesh);
    }
  }
  return bricks;
}

// -----------------------------------------------------------------------
// Top-layer staircase — bricks stream IN from the LEFT, RIGHT, and TOP
// edges of `outerSilhouette`'s bbox, stop after reaching `reachFraction`
// of each half-dimension, and step DOWN in Z thickness as they go
// inward. Result: an inverted-U band of bricks whose outer edge follows
// the silhouette outline (because each candidate is filtered against
// `outerSilhouette`) and whose tops rise from the centre outward like a
// staircase. The bottom edge of the silhouette is intentionally bare
// (no contributing edge there).
//
// Brick orientation matches `placeFloor` — local-X→worldX, local-Y→worldZ,
// local-Z→worldY — so brickCfg.height is the Z (depth) extent. Each brick's
// back face stays flush with `backZ`, so taller bricks protrude further
// toward the camera.
//
// Per-step colour gradient: each brick is assigned a material from
// `stepMats[stepIdx]`. Caller passes pre-built materials lerped from
// `darkColor` (innermost step, closest to floor) to `lightColor`
// (outermost step, closest to camera) so the staircase shifts in
// value as it rises forward.
//
// No-overlap invariant: every brick is centred on a unique (row, col)
// grid cell with stride (width + 2*gapX, depth + 2*gapY). Within-cell
// vertex jitter is clamped to ±mortarGap by `makeBrickGeometry`, so
// no brick ever crosses its cell boundary. Adjacent bricks at
// different stair steps share the same back-face Z and only differ
// in forward extent, so they touch on a shared side without
// interpenetrating. Grid arithmetic guarantees collision-free
// placement — no physics sim required.
// -----------------------------------------------------------------------
// Pointy-top hex extruded as a flat tile, sized so its flat-to-flat width
// matches the topLayer brick width. Used for steps whose `layerKinds`
// entry is 'hex' — at the same brick grid spacing, alternate rows offset
// by half a flatWidth (running-bond) tessellate hexes cleanly.
function makeStepHexGeometry(flatWidth, stepHeight) {
  const radius  = flatWidth / Math.sqrt(3);  // circumradius (vertex-to-centre)
  const apothem = flatWidth * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(0,        radius);
  shape.lineTo( apothem, radius * 0.5);
  shape.lineTo( apothem, -radius * 0.5);
  shape.lineTo(0,       -radius);
  shape.lineTo(-apothem, -radius * 0.5);
  shape.lineTo(-apothem,  radius * 0.5);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth:         stepHeight,
    bevelEnabled:  false,
    curveSegments: 1,
  });
}

function placeTopLayer({ outerSilhouette, brickCfgBase, floorCfg, backZ,
                         stepMats, group, seedOffset, topCfg }) {
  const outer = outerSilhouette;
  if (!outer || outer.length < 3) return;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of outer) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const halfW = (maxX - minX) * 0.5;
  const halfH = (maxY - minY) * 0.5;

  // reachFraction = how far the brick band reaches inward from each
  // contributing edge, expressed as a fraction of that edge's half-
  // dimension. 0.66 → bricks fill the outer ~2/3 of half-W from L/R
  // and 2/3 of half-H from the top, leaving an inner column-of-the-
  // bottom region bare.
  const reachFraction = topCfg.reachFraction ?? 0.66;
  const reachLR = reachFraction * halfW;
  const reachT  = reachFraction * halfH;

  // Stair depth: brick Z thickness ramps from maxStepHeight at the
  // outermost step down to minStepHeight at the innermost step.
  // stepCount discrete levels → bricks within the same step share a
  // height, so adjacent bricks read as one stair tread (no smooth
  // gradient).
  const numSteps = Math.max(1, topCfg.stepCount ?? 4);
  const minH     = topCfg.minStepHeight ?? 0.4;
  const maxH     = topCfg.maxStepHeight ?? 1.6;

  // Per-step kind: 'brick' (default) or 'hex'. Length is normalised to
  // numSteps; missing entries default to 'brick' so old presets still
  // produce a pure brick staircase.
  const layerKinds = topCfg.layerKinds || [];
  const kindFor = (i) => (layerKinds[i] === 'hex') ? 'hex' : 'brick';

  // Niche cutouts — rectangular boxes in (x,y) where bricks/hexes are
  // skipped, leaving carved alcoves for lantern fixtures. Each entry is
  // { x, y, w, h }; both axis-aligned. Empty list = no carving.
  const niches = topCfg.niches || [];
  const insideNiche = (px, py) => {
    for (const n of niches) {
      const dx = Math.abs(px - n.x);
      const dy = Math.abs(py - n.y);
      if (dx <= n.w * 0.5 && dy <= n.h * 0.5) return true;
    }
    return false;
  };

  // Islamic pointed-arch cutout — bricks falling inside the arch curve
  // are skipped, carving an arch-shaped opening into the rectangular
  // L/R/T brick band. Same helper used by placeFloor so all brick
  // layers share the same opening.
  const insideArch = makeInsideArch(minX, maxX, minY, maxY, topCfg.archShape);
  const archActive = !!insideArch;

  // Tier metric: 'rect' (default) uses the rectangular L/R/T edge-distance
  // metric below; 'lancet' uses a two-centred pointed-arch metric so the
  // tier rings nest as Islamic lancet arches converging on the apex.
  // Built independently of archShape.enabled (which gates the carve-out).
  const tierShape    = topCfg.tierShape ?? 'rect';
  const lancetMetric = (tierShape === 'lancet')
    ? makeLancetTierMetric(minX, maxX, minY, maxY,
        topCfg.archShape, topCfg.archShape?.innerSFrac)
    : null;

  const gapX  = brickCfgBase.mortarGapX ?? brickCfgBase.mortarGap;
  const gapY  = brickCfgBase.mortarGapY ?? brickCfgBase.mortarGap;
  const stepX = brickCfgBase.width + gapX * 2;
  const stepY = brickCfgBase.depth + gapY * 2;
  const cols  = Math.ceil((maxX - minX) / stepX) + 2;
  const rows  = Math.ceil((maxY - minY) / stepY) + 1;

  const localX = new THREE.Vector3(1, 0, 0);
  const localY = new THREE.Vector3(0, 0, 1);
  const localZ = new THREE.Vector3(0, 1, 0);
  const q = basisQuat(localX, localY, localZ);

  const offsetFrac = (floorCfg.pattern === 'running-bond') ? floorCfg.rowOffset : 0;
  let seedCounter = 0;

  for (let r = 0; r < rows; r++) {
    const rowOffset = (r % 2 === 1) ? offsetFrac * stepX : 0;
    const y = minY + (r + 0.5) * stepY;
    if (y > maxY) continue;
    for (let c = 0; c < cols; c++) {
      const x = minX + (c + 0.5) * stepX + rowOffset;
      // Stay inside the actual logo silhouette so bricks never poke
      // past the perimeter (per user request: "don't go past the
      // perimeter of the logo").
      if (!pointInPolygon(x, y, outer)) continue;

      // tNorm = 1 at the OUTERMOST tier (silhouette outline), 0 at the
      // INNERMOST tier (centre / apex). Two metrics:
      //  - 'rect'  : max across L/R/T edge progress → nested rectangles
      //  - 'lancet': lancet half-span sCell of the lancet whose outline
      //              passes through (x, y) → nested pointed arches
      let tNorm;
      if (lancetMetric) {
        // Cell sits on the outline of a lancet of half-span sCell that
        // shares the apex (cx, apexY) with all other tiers. Map sClamp
        // linearly so the convention matches the rect branch:
        // tNorm = 1 at the outer (s ≈ sOuter, silhouette-hugging) shell,
        // tNorm = 0 at the inner (s ≈ sInner, axis-hugging) tier.
        // Each tier's apex sits at the SAME Y (apexY), so every tip
        // lands above the inner star aperture by construction.
        const sC     = lancetMetric.sCell(x, y);
        const sClamp = Math.max(lancetMetric.sInner,
                                Math.min(lancetMetric.sOuter, sC));
        tNorm = (sClamp - lancetMetric.sInner) * lancetMetric.invSpan;
        // No `continue` — every silhouette cell stays placed (per user
        // constraint: "do not lose any bricks"). Clamp into [0,1] so
        // outermost shell catches cells outside the lancet domain.
        if (tNorm < 0) tNorm = 0;
        else if (tNorm > 1) tNorm = 1;
      } else {
        const distL = x - minX;
        const distR = maxX - x;
        const distT = maxY - y;
        tNorm = 0;
        if (distL < reachLR) tNorm = Math.max(tNorm, 1 - distL / reachLR);
        if (distR < reachLR) tNorm = Math.max(tNorm, 1 - distR / reachLR);
        if (distT < reachT ) tNorm = Math.max(tNorm, 1 - distT / reachT );
        if (tNorm <= 0) continue;  // outside the L/R/T band
      }

      // Skip cells that fall inside a carved niche so a gap is left
      // for the lantern fixture / shelf to sit in.
      if (niches.length > 0 && insideNiche(x, y)) continue;

      // Skip cells inside the Islamic-arch cutout so the brick band's
      // inner edge follows the arch curve instead of the rectangular
      // reach boundary.
      if (insideArch && insideArch(x, y)) continue;

      // Quantise to discrete stair steps. step 0 = outermost (tallest),
      // step numSteps-1 = innermost (shortest).
      const u       = 1 - tNorm;  // 0 at edge, 1 at inner
      const stepIdx = Math.min(numSteps - 1, Math.floor(u * numSteps));
      const sFrac   = numSteps > 1 ? stepIdx / (numSteps - 1) : 0;
      const stepHeight = maxH - sFrac * (maxH - minH);

      // Dispatch on this step's kind. Brick = box geometry with running-
      // bond mortar fault; hex = flat hex extrusion with REDUCED Z extent
      // (hexZScale × stepHeight) so the hex tier recedes behind the
      // adjacent brick tiers and the alternation reads as a visible
      // groove between brick rows.
      let geo, mesh;
      if (kindFor(stepIdx) === 'hex') {
        const hexZScale = topCfg.hexZScale ?? 0.4;
        const hexZ      = stepHeight * hexZScale;
        // Shrink the hex by 2 × mortarGap so it sits inside its grid
        // cell with the same slight gap as adjacent bricks have on
        // their faces — no kiss-edge contact, no overlap.
        const hexShrink = (brickCfgBase.mortarGap ?? 0) * 2;
        geo = makeStepHexGeometry(Math.max(brickCfgBase.width - hexShrink, 0.1), hexZ);
        // Choose hex material — defaults to a darker tint than the
        // step's gradient brick material so the hex tier reads as a
        // shadow band rather than blending with the bricks.
        const hexMat = stepMats.hexMat || stepMats[stepIdx];
        mesh = new THREE.Mesh(geo, hexMat);
        // ExtrudeGeometry sweeps along +Z from its shape plane (XY); the
        // tile back face is at the shape's z=0, so positioning at
        // (x, y, backZ) puts the hex back face on the same plane the
        // bricks share. Hex front face sits at backZ + hexZ < backZ +
        // stepHeight = brick front face → groove visible.
        mesh.position.set(x, y, backZ);
      } else {
        const cfg = { ...brickCfgBase, height: stepHeight };
        geo = makeBrickGeometry(seedOffset + seedCounter++, cfg);
        mesh = new THREE.Mesh(geo, stepMats[stepIdx]);
        mesh.position.set(x, y, backZ + stepHeight * 0.5);
        mesh.quaternion.copy(q);
      }
      group.add(mesh);
    }
  }

  // Drop-shadow rings tracing each lancet tier boundary — narrow dark
  // bands sitting on the recessed tier's front face along the boundary
  // curve. Mimics the shadow the projecting tier would cast onto the
  // recessed tier behind it, adding depth between adjacent tiers
  // without any 3D mass. Built as a single closed polygon (outer arc
  // forward + inner arc reversed) so triangulation is clean — no
  // shape-with-holes complications. Gated on lancetMetric.
  if (lancetMetric && topCfg.lancetShadow?.enabled !== false) {
    const sCfg          = topCfg.lancetShadow || {};
    const shadowWidth   = sCfg.width        ?? 0.10;   // band width in s-units (world units, since s is half-span)
    const samplesPerArc = sCfg.samples      ?? 64;
    const zOffset       = sCfg.zOffset      ?? 0.04;
    const opacity       = sCfg.opacity      ?? 0.55;

    const shadowMat = new THREE.MeshBasicMaterial({
      color:       new THREE.Color(sCfg.color ?? '#000000'),
      transparent: true,
      opacity,
      depthWrite:  false,                              // don't occlude bricks behind
      side:        THREE.DoubleSide,
    });

    const span = lancetMetric.sOuter - lancetMetric.sInner;
    const { cx, springerY, h } = lancetMetric;

    // Sample one lancet's arcs (right springer → apex → left springer),
    // returning a flat array of THREE.Vector2 in CCW order around the
    // lancet interior.
    const sampleLancetArcs = (s) => {
      const c = (h * h - s * s) / (2 * s);
      const r = s + c;
      const tApex = Math.atan2(h, c);
      const pts = [];
      pts.push(new THREE.Vector2(cx + s, springerY));
      for (let i = 1; i <= samplesPerArc; i++) {
        const th = (i / samplesPerArc) * tApex;
        pts.push(new THREE.Vector2(
          cx - c + r * Math.cos(th),
          springerY + r * Math.sin(th),
        ));
      }
      for (let i = 1; i <= samplesPerArc; i++) {
        const thL = (Math.PI - tApex) + (i / samplesPerArc) * tApex;
        pts.push(new THREE.Vector2(
          cx + c + r * Math.cos(thL),
          springerY + r * Math.sin(thL),
        ));
      }
      return pts;
    };

    // Resolve shadowWidth (world-units fraction of span). Width is a
    // fraction of one tier's s-step (span / numSteps), so it scales with
    // how dramatic the staircase is. 0.10 = 10% of one tier's s-step.
    const shadowSWidth = Math.min(shadowWidth * (span / numSteps), span * 0.4);

    for (let k = 0; k < numSteps - 1; k++) {
      const sK      = lancetMetric.sInner + ((k + 1) / numSteps) * span;
      const sKinner = Math.max(lancetMetric.sInner, sK - shadowSWidth);
      // Drop the shadow on the RECESSED tier (k+1)'s front face.
      const stepHk1 = maxH - (numSteps > 1 ? (k + 1) / (numSteps - 1) : 0) * (maxH - minH);
      const zRing   = backZ + stepHk1 + zOffset;

      const outerPts = sampleLancetArcs(sK);
      const innerPts = sampleLancetArcs(sKinner);

      // Build a single closed ring polygon: outer CCW, then inner
      // reversed (still CCW around the ring annulus).
      const ring = outerPts.concat(innerPts.slice().reverse());
      const shape = new THREE.Shape(ring);
      const geo  = new THREE.ShapeGeometry(shape, 1);
      const mesh = new THREE.Mesh(geo, shadowMat);
      mesh.position.z = zRing;
      group.add(mesh);
    }
  }

}

// -----------------------------------------------------------------------
// Under-brick hex layers — one ring of half-hex tiles per topLayer step.
// Each ring traces silhouette[0] inset by the step's reach, so step 0's
// ring sits at the seam between the outermost and second steps, step 3's
// ring sits at the deepest seam (closest to the logo centre). Hex
// radius shrinks per step (smaller tiles for inner rings), and each
// ring's Z is anchored at its step's brick FRONT face so the half-hexes
// read as decorative tiles laid on each stair tread, with the flat cut
// edge along the curve tangent and the rounded half pointing inward.
// Clipped above the floor springer line so hexes only ride the upper
// L+R+T region the topLayer staircase covers (same coverage as the
// brick steps themselves).
// -----------------------------------------------------------------------
function makeUnderHexGeometry(radius, depth) {
  const shape = new THREE.Shape();
  const apothem = Math.sqrt(3) * radius / 2;
  shape.moveTo(-apothem, 0);
  shape.lineTo( apothem, 0);
  shape.lineTo( apothem, radius * 0.5);
  shape.lineTo( 0,       radius);
  shape.lineTo(-apothem, radius * 0.5);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled:  false,
    curveSegments: 1,
  });
  geo.translate(0, 0, -depth * 0.5);
  return geo;
}

function placeUnderBrickHexLayers({ outerSilhouette, topCfg, floorCfg, backZ,
                                     gradientBright, gradientDark, group }) {
  const uhCfg = topCfg.underHexes || {};
  if (uhCfg.enabled === false) return;
  if (!outerSilhouette || outerSilhouette.length < 3) return;

  const reachFraction = topCfg.reachFraction ?? 0.66;
  const numSteps      = Math.max(1, topCfg.stepCount ?? 4);
  const minH          = topCfg.minStepHeight ?? 0.4;
  const maxH          = topCfg.maxStepHeight ?? 1.6;

  const baseRadius   = uhCfg.baseRadius   ?? 2.6;
  const shrinkRatio  = uhCfg.shrinkRatio  ?? 0.78;
  const hexDepth     = uhCfg.depth        ?? 0.4;
  const zLift        = uhCfg.zLift        ?? 0.05;
  const pitchScale   = uhCfg.pitchScale   ?? 1.15;

  // bbox + reach used to size each step's inset polygon.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of outerSilhouette) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const halfW = (maxX - minX) * 0.5;
  const halfH = (maxY - minY) * 0.5;
  const reachLR = reachFraction * halfW;
  const stepWidth = reachLR / numSteps;
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;

  // Y clip — keep hexes above the floor wall's springer line so they
  // don't appear on the bare bottom band where the topLayer is absent.
  const floorSpringerY = minY
    + (floorCfg?.springerYFrac ?? 0.30) * (maxY - minY);

  for (let s = 0; s < numSteps; s++) {
    const r = baseRadius * Math.pow(shrinkRatio, s);
    // Inset distance: each step's inner perimeter sits at (s+1)*stepWidth
    // from the silhouette boundary. So step 0's ring is at the FIRST
    // step seam (between outermost and next), and step (numSteps-1)'s
    // ring is the deepest seam (near the centre).
    const insetDist = (s + 1) * stepWidth;
    const insetPoly = insetPolygon(outerSilhouette, insetDist);
    if (!insetPoly || insetPoly.length < 3) continue;

    const upperArc = clipArcAboveY(insetPoly, floorSpringerY);
    if (!upperArc || upperArc.length < 2) continue;

    // Step s's brick FRONT face Z (= backZ + stepHeight). Outermost
    // step has the tallest stepHeight; inner steps progressively
    // shorter, matching the staircase silhouette so each ring sits
    // exactly on its step's surface.
    const sFrac = numSteps > 1 ? s / (numSteps - 1) : 0;
    const stepHeight = maxH - sFrac * (maxH - minH);
    const frontZ = backZ + stepHeight + zLift;

    // Colour lerp matches the topLayer's stepMats: outermost → bright,
    // innermost → dark. Override via uhCfg.color if set.
    const tCol = numSteps > 1 ? (numSteps - s) / numSteps : 1;
    const col = gradientDark.clone().lerp(gradientBright, tCol);
    if (uhCfg.color) col.set(uhCfg.color);
    const mat = new THREE.MeshStandardMaterial({
      color:        col,
      metalness:    0.10,
      roughness:    0.85,
      stencilWrite: true,
      stencilRef:   2,
      stencilFunc:  THREE.EqualStencilFunc,
      stencilFail:  THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.KeepStencilOp,
    });

    // Sample the open upper arc at half-hex flat-width pitch so adjacent
    // tiles touch (or have a small gap when pitchScale > 1).
    const flatWidth = Math.sqrt(3) * r * pitchScale;
    let arcLen = 0;
    for (let i = 1; i < upperArc.length; i++) {
      arcLen += Math.hypot(
        upperArc[i].x - upperArc[i - 1].x,
        upperArc[i].y - upperArc[i - 1].y,
      );
    }
    const sampleCount = Math.max(2, Math.round(arcLen / flatWidth));
    const samples = samplePolyline(upperArc, sampleCount);

    const geo = makeUnderHexGeometry(r, hexDepth);
    const localX = new THREE.Vector3();
    const localY = new THREE.Vector3();
    const localZ = new THREE.Vector3(0, 0, 1);

    for (const sample of samples) {
      // Inward normal — perpendicular to tangent, toward logo centre.
      let nx =  sample.ty, ny = -sample.tx;
      if (nx * (cx - sample.x) + ny * (cy - sample.y) < 0) {
        nx = -nx; ny = -ny;
      }
      localX.set(sample.tx, sample.ty, 0);
      localY.set(nx, ny, 0);

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(sample.x, sample.y, frontZ);
      mesh.quaternion.copy(basisQuat(localX, localY, localZ));
      group.add(mesh);
    }
  }
}

// -----------------------------------------------------------------------
// Corner hexagons — three flat extruded hexes nestled into each upper
// corner of the topLayer brick band. Each hex is centred near the
// silhouette bbox corner so the topLayer stencil mask clips ~2/3 of
// the body, leaving roughly 1/3 visible inside the silhouette.
// Subsequent hexes step diagonally inward toward the bbox centre and
// shrink by `shrinkRatio` per step.
//
// Reuses the topLayer stencil mask (stencilRef = 2) — works because
// both meshes are added to the same arch group and the mask is drawn
// first (renderOrder = -50). No mask redraw needed here.
// -----------------------------------------------------------------------
function buildHexShapeGeometry(radius, depth) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 2 + i * Math.PI / 3;  // pointy-top
    const x = Math.cos(a) * radius, y = Math.sin(a) * radius;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled:  false,
    curveSegments: 1,
  });
}

function placeCornerHexes({ outerSilhouette, frontZ, gradientBright,
                            gradientDark, group, cornerCfg }) {
  if (!outerSilhouette || outerSilhouette.length < 3) return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of outerSilhouette) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;

  const count        = Math.max(1, cornerCfg.count        ?? 3);
  const outerRadius  =             cornerCfg.outerRadius  ?? 4.5;
  const shrinkRatio  =             cornerCfg.shrinkRatio  ?? 0.7;
  const spacingFrac  =             cornerCfg.spacingFrac  ?? 0.95;
  const cornerInset  =             cornerCfg.cornerInset  ?? 0.0;
  const depth        =             cornerCfg.depth        ?? 0.5;
  const zLift        =             cornerCfg.zLift        ?? 0.05;

  // The silhouette doesn't actually reach the bbox corners (the SDG dome
  // is rounded, side flares pull away from the corners) — anchoring at
  // (minX, maxY) drops the whole hex outside the stencil mask, which
  // discards everything. Instead, find the silhouette[0] vertex that
  // sits FARTHEST in each diagonal direction (UL: maximises -x + y,
  // UR: maximises x + y). That's the silhouette's true upper-left /
  // upper-right "corner" point — the spot where the convex corner the
  // brick layers create actually lives.
  let ulPt = null, urPt = null;
  let ulScore = -Infinity, urScore = -Infinity;
  for (const p of outerSilhouette) {
    const sUL = -p.x + p.y;
    const sUR =  p.x + p.y;
    if (sUL > ulScore) { ulScore = sUL; ulPt = p; }
    if (sUR > urScore) { urScore = sUR; urPt = p; }
  }

  // Diagonal direction from the silhouette corner point toward the bbox
  // centre — used to march each successive hex inward and to slide the
  // first hex partially across the silhouette boundary so the stencil
  // mask clips ~2/3 of it (leaving ~1/3 nestled into the inside corner).
  const corners = [
    { x: ulPt.x, y: ulPt.y, dirX: cx - ulPt.x, dirY: cy - ulPt.y },
    { x: urPt.x, y: urPt.y, dirX: cx - urPt.x, dirY: cy - urPt.y },
  ];

  // Pre-compute radii so we can space adjacent hexes by their summed radii
  // (centres are pushed apart by (r_k + r_{k+1}) * spacingFrac so they kiss
  // when spacingFrac = 1, overlap when < 1).
  const radii = [];
  for (let k = 0; k < count; k++) {
    radii.push(outerRadius * Math.pow(shrinkRatio, k));
  }

  // One material per hex so we can lerp the colour from gradientBright at
  // the outer corner toward gradientDark as they march inward — same
  // dark→light gradient cue the topLayer staircase uses.
  const matFor = (k) => {
    const t = count > 1 ? 1 - (k / (count - 1)) : 1;
    const col = gradientDark.clone().lerp(gradientBright, t);
    if (cornerCfg.color) col.set(cornerCfg.color);
    return new THREE.MeshStandardMaterial({
      color:        col,
      metalness:    0.10,
      roughness:    0.85,
      stencilWrite: true,
      stencilRef:   2,
      stencilFunc:  THREE.EqualStencilFunc,
      stencilFail:  THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.KeepStencilOp,
    });
  };

  // Outline — same stencil ref so the LineSegments are clipped by the
  // silhouette mask too (otherwise the outline would stick out past the
  // visible 1/3 of each hex inside the corner).
  let outlineMat = null;
  if (cornerCfg.outline !== false &&
      (cornerCfg.outlineColor || cornerCfg.outline === true)) {
    outlineMat = new THREE.LineBasicMaterial({
      color:        new THREE.Color(cornerCfg.outlineColor || '#1a0d05'),
      stencilWrite: true,
      stencilRef:   2,
      stencilFunc:  THREE.EqualStencilFunc,
      stencilFail:  THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.KeepStencilOp,
    });
  }

  for (const corner of corners) {
    const dlen = Math.hypot(corner.dirX, corner.dirY);
    const dx = corner.dirX / dlen, dy = corner.dirY / dlen;

    // Cumulative diagonal distance for the k-th hex centre.
    let t = cornerInset;
    for (let k = 0; k < count; k++) {
      const r = radii[k];
      if (k === 0) {
        // Largest hex: centre on the corner (plus optional inset). Stencil
        // clips it to the visible inside-corner region.
        t = cornerInset;
      } else {
        // Step inward by the summed radii of this hex and its predecessor.
        t += (radii[k - 1] + radii[k]) * spacingFrac;
      }
      const hx = corner.x + dx * t;
      const hy = corner.y + dy * t;
      const geo  = buildHexShapeGeometry(r, depth);
      const mesh = new THREE.Mesh(geo, matFor(k));
      // ExtrudeGeometry extrudes along +Z from the shape plane, so anchor
      // the back face at frontZ + zLift; front face lands at frontZ +
      // zLift + depth (closer to the camera than the topLayer steps).
      mesh.position.set(hx, hy, frontZ + zLift);
      group.add(mesh);
      if (outlineMat) {
        const edge = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo, 1),
          outlineMat,
        );
        edge.position.copy(mesh.position);
        group.add(edge);
      }
    }
  }
}

// -----------------------------------------------------------------------
// Lantern niche — a small recessed pointed-arch alcove with a glowing
// flame mesh and a real PointLight inside, both flickered each frame
// via a two-sine envelope (transcribed from src/3DOverlay.js's petal
// shimmer math). Returns a group containing the niche frame, back
// wall, lantern mesh, and light, plus an `update(t)` closure.
// -----------------------------------------------------------------------
// Hex frame — stretched pointy-top hexagon in the XY plane (no rotation
// needed when placed). `radial` = full vertical extent (top vertex to
// bottom vertex); `width` = full horizontal extent (left flat to right
// flat). Six vertices: top, top-right, bottom-right, bottom, bottom-left,
// top-left.
function makeHexFrameGeometry(radial, width, thickness) {
  const halfH = radial * 0.5;
  const halfW = width  * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(0,        halfH);          // top
  shape.lineTo( halfW,   halfH * 0.5);    // top-right
  shape.lineTo( halfW,  -halfH * 0.5);    // bottom-right
  shape.lineTo(0,       -halfH);          // bottom
  shape.lineTo(-halfW,  -halfH * 0.5);    // bottom-left
  shape.lineTo(-halfW,   halfH * 0.5);    // top-left
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth:        thickness,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geo.translate(0, 0, -thickness * 0.5);
  return geo;
}

function createLanternNiche({ x, y, frameZ, cfg }) {
  const niche = new THREE.Group();

  // Frame — pointed-arch by default, hexagonal wedge if frameShape='hex'.
  const useHex = (cfg.frameShape || 'arch') === 'hex';
  const frameGeo = useHex
    ? makeHexFrameGeometry(cfg.frameSize.radial,
                           cfg.frameSize.width,
                           cfg.frameSize.thickness)
    : makeArchCellGeometry(cfg.frameSize.radial,
                           cfg.frameSize.width,
                           cfg.frameSize.thickness);
  const frameMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(cfg.frameColor || '#7A5A30'),
    metalness: 0.10, roughness: 0.85,
  });
  const frameMesh = new THREE.Mesh(frameGeo, frameMat);
  if (useHex) {
    // Hex shape is already in XY (vertical = Y), no axis swap needed.
    frameMesh.position.set(x, y, frameZ);
  } else {
    // Pointed-arch: shape's local-X = arch length → world-Y (up).
    frameMesh.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 0, 1),
      ),
    );
    frameMesh.position.set(x, y, frameZ);
  }
  niche.add(frameMesh);

  // Back wall — small dark rectangle recessed into the wall. Centred
  // around the frame so the flame sits in the middle of the niche.
  const backW = cfg.frameSize.width  * 1.05;
  const backH = cfg.frameSize.radial * 1.0;
  const backGeo = new THREE.BoxGeometry(backW, backH, 0.08);
  const backMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1a0d05'),
    metalness: 0.05, roughness: 1.0,
  });
  const backMesh = new THREE.Mesh(backGeo, backMat);
  // Hex frame is centred on (x, y); arch frame's base is at y. Match
  // back wall placement to whichever frame anchor we used.
  const backCY = useHex ? y : (y + backH * 0.4);
  backMesh.position.set(x, backCY, frameZ + cfg.zBack);
  niche.add(backMesh);

  // Lantern flame — taller emissive teardrop (squashed sphere) so the
  // mesh reads as a candle flame rather than a tiny dot. Additive
  // blending lets it punch through the dim back wall as a bright core.
  const flameRadius = cfg.flameSize ?? 0.35;
  const flameMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(cfg.flameColor || '#FFC070'),
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const flameGeo = new THREE.SphereGeometry(flameRadius, 12, 10);
  // Squash horizontally and stretch vertically (teardrop-ish).
  flameGeo.scale(0.7, 1.5, 0.7);
  const flameMesh = new THREE.Mesh(flameGeo, flameMat);
  const flameY = useHex ? y : (y + backH * 0.25);
  const flameZpos = frameZ + cfg.zBack * 0.3;
  flameMesh.position.set(x, flameY, flameZpos);
  niche.add(flameMesh);

  // PointLight at the flame position with attenuation.
  const light = new THREE.PointLight(
    new THREE.Color(cfg.lightColor || '#FF9030'),
    cfg.intensityMin || 4.0,
    /* distance */ 0,
    cfg.decay || 1.5,
  );
  light.position.set(x, flameY, flameZpos + 0.1);
  niche.add(light);

  // Per-niche random phase so all four lanterns flicker out of sync.
  const phaseA = Math.random() * Math.PI * 2;
  const phaseB = Math.random() * Math.PI * 2;
  const speedA = cfg.flickerSpeedA || 6.0;
  const speedB = cfg.flickerSpeedB || 11.0;
  const intMin = cfg.intensityMin  || 4.0;
  const intMax = cfg.intensityMax  || 9.0;
  // Stochastic flutter — separate quick noise blended on top of the
  // smooth two-sine envelope so the candle has rapid micro-jitter on
  // top of slower breathing. jitterAmount 0 = pure sine; 1 = pure noise.
  const jitterAmount = cfg.flickerJitter ?? 0.35;
  let jitterNoise = 0.5;
  let lastJitterTime = -1;

  function update(t) {
    // Two-sine envelope (smooth breathing).
    const a = Math.sin(t * speedA + phaseA);
    const b = Math.sin(t * speedB + phaseB);
    const sineEnv = (a + 0.5 * b + 1.5) / 3.0;       // 0 .. 1
    // Stochastic noise updated every frame at high rate so flicker
    // looks like rapid candle micro-flutter rather than smooth wave.
    if (lastJitterTime < 0 || (t - lastJitterTime) > 0.04) {
      jitterNoise = Math.random();
      lastJitterTime = t;
    }
    const env = sineEnv * (1 - jitterAmount) + jitterNoise * jitterAmount;
    const intensity = intMin + (intMax - intMin) * env;
    light.intensity = intensity;
    // Wider opacity range for the flame mesh so it pulses dramatically.
    flameMat.opacity = 0.4 + 0.6 * env;
    // Subtle scale flicker — flame grows / shrinks with brightness so
    // the mesh visibly breathes (not just opacity changes).
    const s = 0.85 + 0.3 * env;
    flameMesh.scale.set(s, s * 1.2, s);
  }

  return { group: niche, update };
}

// -----------------------------------------------------------------------
// 8-point geometric inlay — a flat extruded rosette built from an
// outer 8-point star with a smaller 8-point star concentric inside it,
// suitable for an embossed decorative medallion on a brick panel. The
// shape lives in local-XY (radius `outerR`); extrusion along local-Z
// gives a small relief. Single combined ExtrudeGeometry so all parts
// share one material call.
// -----------------------------------------------------------------------
function makeOctaInlayGeometry(outerR, depth) {
  const points = 8;

  const buildStar = (rOuter, rInner, sweepRotate = 0) => {
    const shape = new THREE.Shape();
    for (let i = 0; i < points * 2; i++) {
      const r = (i % 2 === 0) ? rOuter : rInner;
      const theta = (i / (points * 2)) * Math.PI * 2 + sweepRotate;
      const x = Math.cos(theta) * r;
      const y = Math.sin(theta) * r;
      if (i === 0) shape.moveTo(x, y);
      else         shape.lineTo(x, y);
    }
    shape.closePath();
    return shape;
  };

  // Outer 8-point star + inner concentric 8-point star (rotated half-step
  // so its points sit between the outer star's points). Extrude both at
  // once so the resulting geometry has both stars layered as a single
  // mesh.
  const shapes = [
    buildStar(outerR,        outerR * 0.55, 0),
    buildStar(outerR * 0.45, outerR * 0.20, Math.PI / points),
  ];

  return new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled:   true,
    bevelThickness: 0.04,
    bevelSize:      0.04,
    bevelSegments:  2,
    curveSegments:  4,
  });
}

// -----------------------------------------------------------------------
// Curved brick rail — a single ring of bricks tiled along the perimeter
// of `railPolygon`, oriented so each brick's long axis (local-X) runs
// along the local tangent. Heights extend radially outward (local-Y),
// thicknesses run along world +Z (local-Z). Used to build the layered
// curved rails that wrap the inner star in the reference muqarnas gate.
// -----------------------------------------------------------------------
function placeStarRail({ railPolygon, brickLength, brickHeight, brickThick,
                         mortarGap, zCenter, color, group, seedOffset }) {
  const perim = polyPerimeter(railPolygon);
  if (perim < brickLength * 2) return [];

  const sampleCount = Math.max(8, Math.round(perim / brickLength));
  let samples = samplePerimeter(railPolygon, sampleCount);
  samples = smoothTangents(samples);

  const material = new THREE.MeshStandardMaterial({
    color:     new THREE.Color(color),
    metalness: 0.10,
    roughness: 0.85,
  });

  const brickCfg = {
    width:       brickLength,   // local-X (along tangent)
    height:      brickHeight,   // local-Y (radial-outward)
    depth:       brickThick,    // local-Z (Z protrusion)
    mortarGap,
    faultAmount: 0.04,
    chamfer:     0.03,
  };

  const localX = new THREE.Vector3();
  const localY = new THREE.Vector3();
  const localZ = new THREE.Vector3(0, 0, 1);
  const bricks = [];
  // Track every placed brick's OBB so each new candidate can be
  // collision-tested against its predecessors. On tight curve sections
  // adjacent samples can rotate enough that the rectangles would
  // overlap at their inner corners; SAT-rejecting the candidate keeps
  // the ring clean without leaving large gaps elsewhere.
  const placedOBBs = [];
  const halfL = brickLength * 0.5;
  const halfH = brickHeight * 0.5;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    // Tangent along the rail = local-X (brick length)
    const tx = s.tx, ty = s.ty;
    localX.set(tx, ty, 0).normalize();
    const out = outwardNormal2D(tx, ty);
    localY.set(out.x, out.y, 0).normalize();

    // OBB candidate — the brick is centred at (s.x, s.y) with half-
    // extent halfL along the tangent and halfH along the radial.
    const obb = obbCorners(s.x, s.y, halfL, halfH, tx, ty);
    let collided = false;
    for (let k = 0; k < placedOBBs.length; k++) {
      if (obbsOverlap(obb, placedOBBs[k])) { collided = true; break; }
    }
    if (collided) continue;
    placedOBBs.push(obb);

    const geo  = makeBrickGeometry(seedOffset + i, brickCfg);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(s.x, s.y, zCenter);
    mesh.quaternion.copy(basisQuat(localX, localY, localZ));
    group.add(mesh);
    bricks.push(mesh);
  }
  return bricks;
}

// -----------------------------------------------------------------------
// Outer-perimeter brick arch — a single ring of CHUNKY voussoir-style
// bricks tiled along silhouette[0] inset inward by half a brick height,
// then clipped to the arc ABOVE `springerYFrac` so the result is an
// upside-down U (top + side curves of the logo). The bottom edge of the
// silhouette is intentionally bare. Bricks are oriented:
//   local-X → curve tangent (long axis runs along the arch curve)
//   local-Y → outward normal (radial; brick height extends outward
//             from the logo interior toward silhouette[0])
//   local-Z → world +Z (brick thickness runs forward to the camera)
// Inset by half a brick height pins each brick's outer face flush with
// silhouette[0], so the whole brick body sits INSIDE the logo
// perimeter — never poking past it — while the body extends only one
// brick-height inward, never crossing into the inner region of the logo.
// SAT OBB rejection on already-placed bricks keeps tight curve sections
// gap-free without making any pair interpenetrate.
// -----------------------------------------------------------------------
function placeOuterBrickArch({
  silhouette, springerYFrac, minSpringerY, brickLength, brickHeight, brickThick,
  mortarGap, zCenter, color, group, seedOffset, outwardOffset = 0,
  rotate90 = false, inwardSafety = 0,
}) {
  if (!silhouette || silhouette.length < 3) return [];

  const halfH = brickHeight * 0.5;
  // Always walk the ORIGINAL silhouette and apply the radial offset
  // per-sample. Polygon-level offsetting (insetPolygon / outsetPolygonCCW)
  // fails near the SDG's concave side flares: the bisector method
  // self-intersects there and the resulting "polygon" walks weird
  // segments. Per-sample offsetting along the local outward normal
  // keeps the curve topologically clean regardless of polygon shape.
  const walkPoly = silhouette;
  if (!walkPoly || walkPoly.length < 3) return [];

  let minY = Infinity, maxY = -Infinity;
  for (const p of walkPoly) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  // springerY = base fraction of the polygon's Y range, but never
  // below `minSpringerY` (passed in by the caller as the star bay's
  // top + buffer). Guarantees the arch's feet stay clear of the star
  // so the brick band can never wrap around it.
  let springerY = minY + (maxY - minY) * (springerYFrac ?? 0.30);
  if (typeof minSpringerY === 'number' && minSpringerY > springerY) {
    springerY = minSpringerY;
  }

  // Build a clean upside-down-U arc by sampling the polygon perimeter
  // uniformly and picking the LONGEST CONTIGUOUS RUN of samples whose
  // Y is above springerY. clipArcAboveY only handles polygons that
  // cross the cut line exactly twice — silhouettes with side flares
  // (the SDG bottom flares) cross many times and confuse it. This
  // approach is robust against multiple Y crossings: it always returns
  // one connected upper segment regardless of how the lower polygon
  // shape behaves.
  let totalPerim = 0;
  for (let i = 0; i < walkPoly.length; i++) {
    const a = walkPoly[i], b = walkPoly[(i + 1) % walkPoly.length];
    totalPerim += Math.hypot(b.x - a.x, b.y - a.y);
  }
  // Oversample by ~3× brick density so the longest-run search has fine
  // resolution. We'll thin to brickLength spacing after picking the run.
  const sampleCount = Math.max(48, Math.round(totalPerim / brickLength) * 3);
  const perimSamples = samplePerimeter(walkPoly, sampleCount);
  // Find the longest contiguous run of indices where Y > springerY.
  // Wrap-around aware: the run can cross the seam (sample 0).
  const above = perimSamples.map(s => s.y > springerY);
  let bestStart = -1, bestLen = 0;
  const N = perimSamples.length;
  // Walk 2N to cover wrap-around runs (a run that crosses the seam is
  // contiguous in [0, 2N) but split in [0, N)). Cap len at N to avoid
  // double-counting if every sample is above (full-loop case).
  let curStart = -1, curLen = 0;
  for (let i = 0; i < N * 2; i++) {
    if (above[i % N]) {
      if (curStart < 0) curStart = i;
      curLen++;
      if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
    } else {
      curStart = -1; curLen = 0;
    }
  }
  if (bestLen > N) bestLen = N;
  if (bestLen < 2) return [];
  // Slice the run out (may wrap around the seam).
  const arc = [];
  for (let k = 0; k < bestLen; k++) arc.push(perimSamples[(bestStart + k) % N]);

  // Re-thin to brickLength spacing along the arc — preserves per-sample
  // tangents while giving us the right brick count.
  let arcLen = 0;
  for (let i = 0; i < arc.length - 1; i++) {
    arcLen += Math.hypot(arc[i + 1].x - arc[i].x, arc[i + 1].y - arc[i].y);
  }
  const count = Math.max(3, Math.round(arcLen / brickLength));
  let samples = samplePolyline(arc, count);
  samples = smoothTangents(samples);

  const material = new THREE.MeshStandardMaterial({
    color:     new THREE.Color(color),
    metalness: 0.10,
    roughness: 0.85,
  });

  const brickCfg = {
    width:       brickLength,   // local-X — along the tangent
    height:      brickHeight,   // local-Y — radial-outward
    depth:       brickThick,    // local-Z — Z protrusion forward
    mortarGap:   mortarGap ?? 0.04,
    faultAmount: 0.03,
    chamfer:     0.03,
  };

  const localX = new THREE.Vector3();
  const localY = new THREE.Vector3();
  const localZ = new THREE.Vector3(0, 0, 1);
  const halfL  = brickLength * 0.5;
  const halfHr = brickHeight * 0.5;
  const placedOBBs = [];
  const bricks = [];

  // Per-sample radial offset:
  //   outwardOffset > 0 → push OUT by (outwardOffset + halfH); brick
  //                       body sits entirely OUTSIDE silhouette[0].
  //   outwardOffset = 0 → push IN by (halfH + inwardSafety); brick
  //                       outer face sits inwardSafety units inside
  //                       silhouette[0], so the brick's straight outer
  //                       edge can't poke past the curving silhouette
  //                       between sample points (esp. near concave
  //                       corners — the SDG flare-to-dome transitions).
  const pushDist = outwardOffset > 0
    ? (outwardOffset + halfH)
    : -(halfH + inwardSafety);
  for (let i = 0; i < samples.length; i++) {
    const s  = samples[i];
    const tx = s.tx, ty = s.ty;
    const out = outwardNormal2D(tx, ty);
    // rotate90: swap which world direction each local brick axis maps
    // to, rotating every brick 90° about its own local-Z. Default puts
    // brickLength (local-X) along the tangent and brickHeight (local-Y)
    // radial-outward. With rotate90, brickLength runs RADIAL and
    // brickHeight runs along the tangent — visually rotating each
    // voussoir a quarter turn relative to the curve.
    if (rotate90) {
      localX.set(out.x, out.y, 0).normalize();
      localY.set(-tx, -ty, 0).normalize();
    } else {
      localX.set(tx, ty, 0).normalize();
      localY.set(out.x, out.y, 0).normalize();
    }
    const cx = s.x + out.x * pushDist;
    const cy = s.y + out.y * pushDist;

    // SAT OBB collision against every brick already placed in this
    // ring — on tight curve sections two adjacent samples can rotate
    // enough that the rectangles would overlap at their inner
    // corners. Skipping the collider keeps the ring clean. With
    // rotate90 the brick's halfL extends along the OUTWARD axis, not
    // the tangent — pass the matching orientation to obbCorners.
    const obb = rotate90
      ? obbCorners(cx, cy, halfL, halfHr, out.x, out.y)
      : obbCorners(cx, cy, halfL, halfHr, tx, ty);
    let collided = false;
    for (let k = 0; k < placedOBBs.length; k++) {
      if (obbsOverlap(obb, placedOBBs[k])) { collided = true; break; }
    }
    if (collided) continue;
    placedOBBs.push(obb);

    const geo  = makeBrickGeometry(seedOffset + i, brickCfg);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(cx, cy, zCenter);
    mesh.quaternion.copy(basisQuat(localX, localY, localZ));
    group.add(mesh);
    bricks.push(mesh);
  }
  return bricks;
}

// -----------------------------------------------------------------------
// Public entry point. Returns a group + an update function + a triggerCascade
// callable. The patterns-layer wires the group into the logo and the update
// into main.js's tick.
// -----------------------------------------------------------------------
export function createArch({ silhouette, maxZ, frameDepth = 0.5,
                             gateFrameWidth = 1.6, configOverride = null,
                             groupName = 'arch' }) {
  // configOverride lets a caller build a second, parallel arch group
  // with different config (e.g. the 'carved' viewMode's deeper-wall
  // experiment) without swapping ANIM.arch globally.
  const cfg = configOverride || ANIM.arch || {};
  const group = new THREE.Group();
  group.name = groupName;
  if (cfg.enabled === false) return { group, update: () => {}, triggerCascade: () => {} };
  if (!silhouette || !silhouette.length || !silhouette[0]) {
    return { group, update: () => {}, triggerCascade: () => {} };
  }

  const brickCfg = cfg.brick || {};
  const archMat = new THREE.MeshStandardMaterial({
    color:     new THREE.Color(cfg.color    || '#9A7544'),
    metalness: 0.15,
    roughness: 0.75,
  });

  // Dark / light gradient anchors. The floor (deepest, farthest from
  // camera) uses `gradientDark`; each top-layer staircase step then
  // lerps a notch lighter as it rises forward, with the outermost
  // step pinned to `gradientBright`.
  const gradientDark   = new THREE.Color(cfg.gradientDark   || '#5C4530');
  const gradientBright = new THREE.Color(cfg.gradientBright || '#E0BE89');

  // Material PBR controls — bricks/hexes pick these up so a config can
  // dial in stone (low metalness / high roughness) vs. metallic gold
  // (metalness ~1, low roughness). Falls back to the previous "warm
  // stone" defaults if the config doesn't set them.
  const matMetalness = cfg.metalness ?? 0.10;
  const matRoughness = cfg.roughness ?? 0.85;

  // Floor material — explicit dark colour so the deepest layer reads
  // as the value floor of the gradient. Keeps `archMat` (used by the
  // outer / cascade rows) untouched.
  const floorMat = new THREE.MeshStandardMaterial({
    color:     gradientDark,
    metalness: matMetalness,
    roughness: matRoughness,
  });

  // Outline curve — full closed perimeter of the gate-frame inner aperture
  // (so bricks wrap continuously around top + sides + bottom). Both arch
  // rows reuse these samples; the cascade row keeps the same source so
  // re-enabling innerArch lights up the same loop.
  const curve = buildPerimeterCurve({
    silhouette: silhouette[0],
    gateFrameWidth,
    brickHeight:   brickCfg.height,
    brickWidth:    brickCfg.width,
  });

  // Springer Y — used by the muqarnas region clipper (we tile cells only
  // above this Y so the SDG side flares aren't decorated with cells).
  // Re-derived from the perimeter polygon's Y extent the same way
  // buildArchCurve does it.
  {
    let minPy = Infinity, maxPy = -Infinity;
    for (const p of curve.perimeterPoly) {
      if (p.y < minPy) minPy = p.y;
      if (p.y > maxPy) maxPy = p.y;
    }
    const sFrac = cfg.floor?.springerYFrac ?? 0.30;
    curve.springerY = minPy + (maxPy - minPy) * sFrac;
  }

  // Z anchor: arch bricks sit just in front of the gate frame. The brick's
  // local-X (longest dim, brickCfg.width) maps to world-Z, so it's `width`
  // — not `depth` — that drives the Z-extent of an arch brick. We park the
  // brick's BACK face flush with the gate frame's front face.
  const gateFrontZ      = maxZ + 0.45 + frameDepth;
  const archZCenter     = gateFrontZ + brickCfg.width * 0.5;
  const innerDepthScale = cfg.innerArch?.depthScale ?? 0.65;
  const innerArchZCenter = gateFrontZ + brickCfg.width * innerDepthScale * 0.5;

  // --- Outer static arch row ---
  if (cfg.outerArch?.enabled !== false) {
    placeArchRow({
      samples: curve.samples,
      brickCfg,
      depthScale: 1.0,
      zCenter: archZCenter,
      material: archMat,
      group,
      seedOffset: 1000,
    });
  }

  // --- Muqarnas vault (fractal-scaled) ---
  // Pointed-arch niches DUG INTO the wall depth, restricted to the dome
  // region above the springer line so the SDG side flares aren't tiled.
  // Each tier r uses cell dimensions scaled by `fractalScale^r` from
  // tier 0; because cell width shrinks geometrically while the inset
  // polygon's perimeter shrinks roughly linearly, the cell COUNT per
  // tier grows ~geometrically too — i.e. a self-similar/fractal packing
  // where every successive tier exposes finer detail at half the scale.
  // All cells stay strictly within the silhouette (clipped polygon) and
  // strictly within the logo's depth (the deepest tier sits inside the
  // gate-frame thickness plus a bite of the logo body, never forward of
  // the gate-frame front face).
  const muqCfg = cfg.muqarnas || {};
  if (muqCfg.enabled !== false && (muqCfg.tierCount || 0) > 0) {
    const baseColor = new THREE.Color(cfg.color || '#9A7544');
    const darkColor = new THREE.Color(cfg.gradientDark || '#5C4530');

    // Use the full inset perimeter as the base polygon. placeMuqarnasTier
    // filters individual cells against the silhouette cutouts (so cells
    // never enter the star bay) and orients each cell toward the dome's
    // centroid (so cells point inward consistently regardless of
    // concave silhouette features like the SDG side flares).
    let polygon = curve.perimeterPoly;

    // Inward-pointing target for every cell. We prefer the centroid of
    // the FIRST inner cutout (silhouette[1] — the star bay), so cells
    // literally face the star regardless of how the SDG side flares
    // pull the dome polygon's centroid off-axis. Fall back to the dome
    // polygon's centroid if there's no inner cutout.
    let cx = 0, cy = 0;
    const inwardLoop = (silhouette.length > 1 && silhouette[1].length >= 3)
      ? silhouette[1]
      : curve.perimeterPoly;
    for (const p of inwardLoop) { cx += p.x; cy += p.y; }
    cx /= inwardLoop.length;
    cy /= inwardLoop.length;

    const silhouettesForFilter = silhouette;

    const fractalScale = muqCfg.fractalScale ?? 0.78;

    for (let r = 0; r < muqCfg.tierCount; r++) {
      const perim = polyPerimeter(polygon);
      if (perim < (muqCfg.minPerimeter || 6)) break;

      // Stop the tier loop once the inset polygon has entered a cutout.
      // We measure what fraction of the polygon's vertices sit inside
      // the SOLID silhouette region (= inside silhouette[0] AND outside
      // every cutout). When more than `cutoutStopFrac` of vertices have
      // crossed a cutout boundary, placing cells from this polygon
      // creates a thin ring of cells around the cutout (the unwanted
      // "star outline") so we abort instead.
      let solidCount = 0;
      for (const p of polygon) {
        if (insideSilhouette(p.x, p.y, silhouettesForFilter)) solidCount++;
      }
      const cutoutStopFrac = muqCfg.cutoutStopFrac ?? 0.85;
      if (solidCount / polygon.length < cutoutStopFrac) break;

      // Fractal-scaled cell dims for this tier.
      const scale      = Math.pow(fractalScale, r);
      const cellW      = (muqCfg.cellWidth       || 3.0) * scale;
      const cellRadial = (muqCfg.cellRadialDepth || 2.4) * scale;
      const cellThick  = (muqCfg.cellThickness   || 0.5) * scale;

      // Tier Z: front face stepping back from gateFrontZ by tierStepZ
      // per tier. Tier 0 sits flush with the gate-frame front and the
      // deepest tier sinks into the model body. Cell mesh centres on
      // mid-thickness.
      const tierStep  = muqCfg.tierStepZ || 0.5;
      const tierFront = gateFrontZ - r * tierStep;
      const zCenter   = tierFront - cellThick * 0.5;

      // Material darkens toward gradientDark per tier so deeper niches
      // read as shaded interiors.
      const t       = muqCfg.tierCount > 1 ? r / (muqCfg.tierCount - 1) : 0;
      const mixT    = Math.min(1, t * (muqCfg.colorMix || 0));
      const tierCol = baseColor.clone().lerp(darkColor, mixT);
      const aDrop   = (muqCfg.opacityFalloff || 0) * t;
      const tierMat = new THREE.MeshStandardMaterial({
        color:       tierCol,
        metalness:   0.15,
        roughness:   0.85,
        transparent: aDrop > 0,
        opacity:     1 - aDrop,
      });

      const startOffset = (muqCfg.tierOffsetAlternate && (r % 2 === 1)) ? 0.5 : 0;

      // Back-wall config — same dark wall material across tiers so the
      // shadow read is consistent. Slightly less aggressive on the inner
      // tiers (smaller scale) so they don't crowd out the visible cell.
      const backWall = muqCfg.backWallEnabled !== false ? {
        scale:  muqCfg.backWallScale  ?? 0.72,
        offset: muqCfg.backWallOffset ?? 0.15,
        color:  new THREE.Color(muqCfg.backWallColor || '#1A0A04'),
      } : null;

      placeMuqarnasTier({
        polygon,
        cellW,
        cellRadial,
        cellThick,
        zCenter,
        startOffset,
        material:    tierMat,
        group,
        silhouettes: silhouettesForFilter,
        centerX:     cx,
        centerY:     cy,
        backWall,
      });

      // Inset by `cellRadial * tierOverlap` for the next tier — when
      // tierOverlap < 1 the next tier's cells overlap radially with the
      // current tier's, interlocking like a honeycomb instead of stacking
      // edge-to-edge with gaps.
      const tierOverlap = muqCfg.tierOverlap ?? 1.0;
      polygon = insetPolygon(polygon, cellRadial * tierOverlap);
    }
  }

  // --- Inner cascade arch row ---
  let cascadeBricks = [];
  let cascadeStartTime = null;
  let lastFireTime = -Infinity;
  if (cfg.innerArch?.enabled !== false) {
    cascadeBricks = placeInnerCascadeRow({
      samples: curve.samples,
      apexIndex: curve.apexIndex,
      totalLength: curve.totalLength,
      brickCfg,
      cascadeCfg: cfg.innerArch,
      zCenter: innerArchZCenter,
      material: archMat,
      group,
      seedOffset: 2000,
    });
    // Park bricks at start pose until the cascade fires.
    for (const b of cascadeBricks) b.position.copy(b.userData.startPos);
  }

  // --- Floor fill ---
  if (cfg.floor?.enabled !== false) {
    // Flat brick layer that fills the gate-frame aperture interior.
    // If `floor.innerInset` is set, an inner-cutout polygon is computed
    // (perimeterPoly inset by that distance) and passed alongside the
    // outer perimeter — placeFloor's even-odd silhouette test then
    // skips bricks whose centre lands inside the cutout, leaving the
    // central panel bare so only the OUTER BAND of bricks is laid.
    const floorZCenter = maxZ + (cfg.floor?.yLevel || 0) + brickCfg.height * 0.5;
    const floorSilhouettes = [curve.perimeterPoly];
    const innerInset = cfg.floor?.innerInset || 0;
    if (innerInset > 0) {
      const innerCutout = insetPolygon(curve.perimeterPoly, innerInset);
      if (innerCutout && innerCutout.length >= 3) {
        floorSilhouettes.push(innerCutout);
      }
    }
    placeFloor({
      silhouettes: floorSilhouettes,
      brickCfg,
      floorCfg: cfg.floor || {},
      zCenter: floorZCenter,
      material: floorMat,
      group,
      seedOffset: 5000,
      archShape: cfg.topLayer?.archShape,
    });
  }

  // --- Top-layer staircase (L/R/T band, depth steps inward) ---
  // Bricks stream IN from the LEFT, RIGHT, and TOP edges of the logo
  // silhouette and stop after reaching `topCfg.reachFraction` of the
  // half-dimension in each direction. The bottom edge is bare. Each
  // brick's Z thickness is quantised into `topCfg.stepCount` discrete
  // levels — outermost bricks are tallest, innermost shortest — so
  // the layer reads as a staircase building up depth as you move away
  // from the centre. Bricks are filtered against silhouette[0] so they
  // never poke past the logo perimeter.
  const topCfg = cfg.topLayer;
  if (topCfg?.enabled !== false && silhouette[0] && silhouette[0].length >= 3) {
    const topBrickCfgBase = {
      width:       brickCfg.width  * (topCfg.widthScale ?? 1.0),
      height:      brickCfg.height,  // overridden per-brick by stair step
      depth:       brickCfg.depth  * (topCfg.depthScale ?? 1.0),
      mortarGap:   brickCfg.mortarGap ?? 0,
      mortarGapX:  topCfg.mortarGapX ?? brickCfg.mortarGapX ?? 0,
      mortarGapY:  topCfg.mortarGapY ?? brickCfg.mortarGapY ?? 0,
      faultAmount: brickCfg.faultAmount ?? 0.05,
      chamfer:     brickCfg.chamfer ?? 0.03,
    };
    // Stencil mask — render a flat fill of the logo silhouette into
    // the stencil buffer first, then make the brick material only draw
    // where stencil=1. Same technique as 3DOverlay.js's flower/rosette
    // mask: any brick fragment that pokes past the silhouette outline
    // is GPU-discarded by the stencil test, so the layer is clipped
    // exactly to the logo shape regardless of where individual brick
    // corners land relative to silhouette[0]. Inset by a hair so the
    // mask sits just inside the perimeter and stencilled bricks don't
    // produce a 1-px halo.
    const maskInset = topCfg.maskInset ?? 0.4;
    const sil = maskInset > 0
      ? insetPolygon(silhouette[0], maskInset)
      : silhouette[0];
    const maskShape = new THREE.Shape();
    maskShape.moveTo(sil[0].x, sil[0].y);
    for (let i = 1; i < sil.length; i++) maskShape.lineTo(sil[i].x, sil[i].y);
    const maskGeo = new THREE.ShapeGeometry(maskShape);
    const maskMat = new THREE.MeshBasicMaterial({
      colorWrite:   false,
      depthWrite:   false,
      depthTest:    false,
      side:         THREE.DoubleSide,
      stencilWrite: true,
      stencilRef:   2,
      stencilFunc:  THREE.AlwaysStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
    });
    const maskMesh = new THREE.Mesh(maskGeo, maskMat);
    maskMesh.name = 'arch-toplayer-stencil-mask';
    maskMesh.position.z = maxZ;     // depthTest off — z is irrelevant
    maskMesh.renderOrder = -50;     // first in opaque pass for this group
    group.add(maskMesh);

    // Per-step gradient materials. Total levels = numSteps + 1
    // (floor at level 0, outermost step at level numSteps). For step
    // s in [0..numSteps-1], level = numSteps - s, so:
    //   stepIdx 0 (outermost / closest to camera) → t = 1   → gradientBright
    //   stepIdx numSteps-1 (innermost / by floor) → t = 1/N → just lighter
    //                                                          than the floor
    // Each material reads the stencil mask (stencilRef=2) so brick
    // fragments outside the silhouette are GPU-discarded.
    const numSteps = Math.max(1, topCfg.stepCount ?? 4);
    const stepMats = [];
    for (let s = 0; s < numSteps; s++) {
      const t = numSteps > 0 ? (numSteps - s) / numSteps : 1.0;
      const c = gradientDark.clone().lerp(gradientBright, t);
      const stepMat = new THREE.MeshStandardMaterial({
        color:        c,
        metalness:    matMetalness,
        roughness:    matRoughness,
        stencilWrite: true,
        stencilRef:   2,
        stencilFunc:  THREE.EqualStencilFunc,
        stencilFail:  THREE.KeepStencilOp,
        stencilZFail: THREE.KeepStencilOp,
        stencilZPass: THREE.KeepStencilOp,
      });
      if (cfg.shimmer && cfg.shimmer.enabled !== false) {
        applyGoldShimmer(stepMat);
      }
      stepMats.push(stepMat);
    }
    // Hex tier material — only create a shared one when topCfg.hexColor
    // is explicitly set, so the hex tiers read as a unified ornamental
    // shadow band. Otherwise hex tiles inherit the per-step brick mat
    // (stepMats[stepIdx]) and the gradient reads cleanly across both
    // brick AND hex tiers — no bright→dark→medium→dark zigzag.
    if (topCfg.hexColor) {
      const hexColor = new THREE.Color(topCfg.hexColor);
      stepMats.hexMat = new THREE.MeshStandardMaterial({
        color:        hexColor,
        metalness:    matMetalness,
        roughness:    matRoughness,
        stencilWrite: true,
        stencilRef:   2,
        stencilFunc:  THREE.EqualStencilFunc,
        stencilFail:  THREE.KeepStencilOp,
        stencilZFail: THREE.KeepStencilOp,
        stencilZPass: THREE.KeepStencilOp,
      });
    }
    // Back face of every top-layer brick sits on the floor's top
    // surface plus zLift. Taller stair-steps then push out further
    // toward the camera; shorter inner steps stay closer to the floor.
    const floorTopZ = maxZ + (cfg.floor?.yLevel || 0) + brickCfg.height;
    const backZ     = floorTopZ + (topCfg.zLift ?? 0.05);

    // Lantern positions are computed BEFORE placeTopLayer so that the
    // bricks/hexes at those XYs can be skipped, leaving carved alcoves
    // ("niches") that hold the lantern fixture + shelf. The same
    // positions are reused later by the lantern-placement loop so the
    // alcoves and lanterns stay synchronised by construction.
    let lanternPositions = [];
    const lantCfgEarly = cfg.lanterns;
    if (lantCfgEarly && lantCfgEarly.enabled !== false && silhouette[0]) {
      let lminX = Infinity, lmaxX = -Infinity, lminY = Infinity, lmaxY = -Infinity;
      for (const p of silhouette[0]) {
        if (p.x < lminX) lminX = p.x; if (p.x > lmaxX) lmaxX = p.x;
        if (p.y < lminY) lminY = p.y; if (p.y > lmaxY) lmaxY = p.y;
      }
      // Star bay centroid — use silhouette[1] (inner cutout) if present,
      // else fall back to the outer bbox centre. The SDG logo silhouette
      // extraction only emits the outer loop, so the bbox-centre fallback
      // is the production path here.
      const sc = (silhouette[1] && silhouette[1].length >= 3)
        ? polyCentroid(silhouette[1])
        : { x: (lminX + lmaxX) * 0.5, y: (lminY + lmaxY) * 0.5 };
      const quadCentres = [
        { x: (lminX + sc.x) * 0.5, y: (lmaxY + sc.y) * 0.5 },  // UL
        { x: (lmaxX + sc.x) * 0.5, y: (lmaxY + sc.y) * 0.5 },  // UR
        { x: (lminX + sc.x) * 0.5, y: (lminY + sc.y) * 0.5 },  // LL
        { x: (lmaxX + sc.x) * 0.5, y: (lminY + sc.y) * 0.5 },  // LR
      ];
      const positions = lantCfgEarly.positions || [
        { panel: 0, yOffset:  1.6 }, { panel: 1, yOffset:  1.6 },
        { panel: 2, yOffset: -1.6 }, { panel: 3, yOffset: -1.6 },
      ];
      for (const n of positions) {
        const c = quadCentres[n.panel];
        if (!c) continue;
        lanternPositions.push({
          x: c.x,
          y: c.y + (n.yOffset ?? 0),
          panel: n.panel,
        });
      }
    }

    // Niche box per lantern: rectangular carve-out where bricks/hexes
    // are skipped. Sized off the lantern frame plus configurable margin
    // so the carved hole is visibly larger than the fixture inside it.
    // The box centre is shifted UP from the lantern centre so the bottom
    // of the niche lines up with where the shelf will sit (the lantern
    // flame rests on the shelf, occupying the upper 2/3 of the alcove).
    const nicheCfg = topCfg.niche || {};
    const lantFrameW = lantCfgEarly?.frameSize?.width  ?? 0.9;
    const lantFrameR = lantCfgEarly?.frameSize?.radial ?? 1.4;
    // Niche box just slightly larger than the lantern frame so a thin
    // border of carved-out wall reads around the fixture. Tighter ratios
    // keep the brick wall visually dominant.
    const nicheW     = nicheCfg.width  ?? lantFrameW * 1.5;
    const nicheH     = nicheCfg.height ?? lantFrameR * 1.4;
    const nicheBoxes = lanternPositions.map(lp => ({
      x: lp.x,
      // Shift box centre up so the lantern (placed at lp) sits in the
      // UPPER part of the niche; lower part is the shelf+flame zone.
      y: lp.y + nicheH * 0.15,
      w: nicheW,
      h: nicheH,
    }));
    topCfg.niches = nicheBoxes;

    placeTopLayer({
      outerSilhouette: silhouette[0],
      brickCfgBase:    topBrickCfgBase,
      floorCfg:        cfg.floor || {},
      backZ,
      stepMats,
      group,
      seedOffset:      5500,
      topCfg,
    });

    // Shelf bricks — one chunky brick spanning the bottom of each niche,
    // sitting forward in Z so it reads as a ledge inside the alcove.
    // Material reuses the outermost step's bright tone so the shelf
    // stands out against the dark hex tier behind it.
    const shelfMat = stepMats[0];
    const shelfHexCfg = {
      width:       nicheW * 0.85,                       // tangent extent
      height:      topBrickCfgBase.depth * 1.0,         // Z thickness (toward camera)
      depth:       topBrickCfgBase.depth * 0.9,         // vertical Y extent
      mortarGap:   topBrickCfgBase.mortarGap ?? 0,
      mortarGapX:  0,
      mortarGapY:  0,
      faultAmount: 0.04,
      chamfer:     0.04,
    };
    for (let i = 0; i < nicheBoxes.length; i++) {
      const n = nicheBoxes[i];
      const shelfGeo = makeBrickGeometry(7700 + i, shelfHexCfg);
      const shelfMesh = new THREE.Mesh(shelfGeo, shelfMat);
      // Brick orientation: width=local-X (world-X), height=local-Y
      // (world-Z = thickness toward camera), depth=local-Z (world-Y).
      // Same basis the topLayer uses so this brick sits flat against
      // the wall like the others.
      const shelfQ = basisQuat(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 1, 0),
      );
      shelfMesh.quaternion.copy(shelfQ);
      // Position: centre of the shelf brick sits at the niche's bottom
      // edge (just above lp's lower bound) and one shelf-thickness
      // forward of backZ so the shelf protrudes visibly into the alcove
      // cavity. This places the lantern's flame mesh directly on top of
      // the shelf in screen space.
      const shelfX = n.x;
      const shelfY = n.y - n.h * 0.5 + shelfHexCfg.depth * 0.5;
      const shelfZ = backZ + shelfHexCfg.height * 0.5
                   + (topCfg.shelfZLift ?? (topCfg.maxStepHeight ?? 1.6) * 0.45);
      shelfMesh.position.set(shelfX, shelfY, shelfZ);
      group.add(shelfMesh);
    }

    // Under-brick hex layers — one ring of half-hex tiles per stair
    // step, smaller per step, sitting on each step's front face. See
    // placeUnderBrickHexLayers comment for placement geometry.
    placeUnderBrickHexLayers({
      outerSilhouette: silhouette[0],
      topCfg,
      floorCfg:        cfg.floor || {},
      backZ,
      gradientBright,
      gradientDark,
      group,
    });

    // Corner hexes — nested into the upper-left and upper-right corners
    // of the silhouette, clipped by the same stencil mask. Anchored Z
    // is the front face of the topLayer's outermost step; a per-hex
    // zLift then pushes them past the fireplace brick ring (which sits
    // ~3-5 units further forward in fireplace mode), so the hexes
    // float in front of the rim instead of being occluded by it.
    const cornerCfg = topCfg.cornerHexes;
    if (cornerCfg?.enabled !== false && cornerCfg) {
      const maxStepHeight = topCfg.maxStepHeight ?? 1.6;
      placeCornerHexes({
        outerSilhouette: silhouette[0],
        frontZ:          backZ + maxStepHeight,
        gradientBright,
        gradientDark,
        group,
        cornerCfg,
      });
    }
  }

  // --- Embossed geometric inlays ---
  // Four 8-point geometric medallions, one centred in each quadrant
  // formed by the star bay against the outer silhouette bbox. Sit flat
  // on top of the brick floor (small relief depth) so they read as
  // embossed decoration on the panel surface, matching the reference.
  const inlayCfg = cfg.inlays;
  if (inlayCfg?.enabled !== false && silhouette[0] && silhouette[1]
      && silhouette[1].length >= 3) {
    const star = silhouette[1];
    const sc = polyCentroid(star);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of silhouette[0]) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    // Panel centres = midpoint between silhouette bbox corner and star
    // centroid, in each of the four quadrants.
    const centres = [
      { x: (minX + sc.x) * 0.5, y: (maxY + sc.y) * 0.5 },  // upper-left
      { x: (maxX + sc.x) * 0.5, y: (maxY + sc.y) * 0.5 },  // upper-right
      { x: (minX + sc.x) * 0.5, y: (minY + sc.y) * 0.5 },  // lower-left
      { x: (maxX + sc.x) * 0.5, y: (minY + sc.y) * 0.5 },  // lower-right
    ];
    const inlayMat = new THREE.MeshStandardMaterial({
      color:     new THREE.Color(inlayCfg.color || '#D4A06A'),
      metalness: 0.20,
      roughness: 0.65,
    });
    const floorTopZ = maxZ + (cfg.floor?.yLevel || 0) + brickCfg.height;
    const inlayZ = floorTopZ + (inlayCfg.zLift ?? 0.05);
    const radius = inlayCfg.radius ?? 1.6;
    const depth  = inlayCfg.depth  ?? 0.18;
    const geo = makeOctaInlayGeometry(radius, depth);
    for (const c of centres) {
      const m = new THREE.Mesh(geo, inlayMat);
      m.position.set(c.x, c.y, inlayZ);
      group.add(m);
    }
  }

  // --- Lit lantern niches ---
  // Four pointed-arch alcoves, one per panel quadrant. Each houses an
  // emissive flame mesh and a real PointLight whose intensity flickers
  // via a two-sine envelope. Lantern positions are interpolated between
  // the panel-quadrant centroid (used for the inlays above) and a
  // y-fraction parameter from config so the user can place them above
  // or below the panel inlay.
  const lanternUpdaters = [];
  const lantCfg = cfg.lanterns;
  if (lantCfg && lantCfg.enabled !== false && silhouette[0]) {
    let lminX = Infinity, lmaxX = -Infinity, lminY = Infinity, lmaxY = -Infinity;
    for (const p of silhouette[0]) {
      if (p.x < lminX) lminX = p.x; if (p.x > lmaxX) lmaxX = p.x;
      if (p.y < lminY) lminY = p.y; if (p.y > lmaxY) lmaxY = p.y;
    }
    const sc = (silhouette[1] && silhouette[1].length >= 3)
      ? polyCentroid(silhouette[1])
      : { x: (lminX + lmaxX) * 0.5, y: (lminY + lmaxY) * 0.5 };
    const quadCentres = [
      { x: (lminX + sc.x) * 0.5, y: (lmaxY + sc.y) * 0.5 },  // UL
      { x: (lmaxX + sc.x) * 0.5, y: (lmaxY + sc.y) * 0.5 },  // UR
      { x: (lminX + sc.x) * 0.5, y: (lminY + sc.y) * 0.5 },  // LL
      { x: (lmaxX + sc.x) * 0.5, y: (lminY + sc.y) * 0.5 },  // LR
    ];
    const floorTopZL = maxZ + (cfg.floor?.yLevel || 0) + brickCfg.height;
    const niches = lantCfg.positions || [
      { panel: 0, yOffset:  1.6 }, { panel: 1, yOffset:  1.6 },
      { panel: 2, yOffset: -1.6 }, { panel: 3, yOffset: -1.6 },
    ];
    for (const n of niches) {
      const c = quadCentres[n.panel];
      if (!c) continue;
      const lx = c.x;
      const ly = c.y + (n.yOffset ?? 0);
      const niche = createLanternNiche({
        x: lx, y: ly,
        frameZ: floorTopZL + (lantCfg.zLift ?? 0.10),
        cfg: lantCfg,
      });
      group.add(niche.group);
      lanternUpdaters.push(niche.update);
    }
  }

  // --- Outer brick arch (upside-down U on the logo perimeter) ---
  // Chunky voussoir-style bricks tiled along silhouette[0] above the
  // springer line. Bricks are tangent-aligned so each one's tangent
  // face flushes with its neighbour's, reading as a real archway's
  // wedge stones. Inset by half-brick-height so the outer face kisses
  // silhouette[0] and the body extends ONLY one brick-height inward —
  // no stone reaches into the inner region of the logo.
  const obaCfg = cfg.outerBrickArch;
  if (obaCfg?.enabled !== false && silhouette[0] && silhouette[0].length >= 3) {
    const obaThick = obaCfg.brickThick ?? 1.5;
    // Star bay clearance — keep the arch's feet above the star.
    let starMaxY = -Infinity;
    if (silhouette[1] && silhouette[1].length >= 3) {
      for (const p of silhouette[1]) if (p.y > starMaxY) starMaxY = p.y;
    }
    const minSpringerY = starMaxY > -Infinity
      ? starMaxY + (obaCfg.starClearance ?? 1.0)
      : undefined;
    placeOuterBrickArch({
      silhouette:    silhouette[0],
      springerYFrac: obaCfg.springerYFrac ?? 0.30,
      minSpringerY,
      brickLength:   obaCfg.brickLength ?? 5.0,
      brickHeight:   obaCfg.brickHeight ?? 2.5,
      brickThick:    obaThick,
      mortarGap:     obaCfg.mortarGap ?? 0.06,
      zCenter:       gateFrontZ + (obaCfg.zLift ?? 0.5) + obaThick * 0.5,
      color:         obaCfg.color || cfg.gradientBright || '#E0BE89',
      group,
      seedOffset:    9500,
    });
  }

  // --- Outer frame arch (outside the logo, left/right/top) ---
  // Larger voussoir bricks tiled along silhouette[0] OUTSET by outwardOffset
  // so the ring sits entirely outside the logo perimeter, framing it from
  // the outside. Same upside-down U shape as outerBrickArch (top + sides;
  // bottom edge bare) but the brick body lives in negative space beyond
  // the silhouette instead of inside it.
  const ofaCfg = cfg.outerFrameArch;
  if (ofaCfg?.enabled !== false && silhouette[0] && silhouette[0].length >= 3) {
    const ofaThick = ofaCfg.brickThick ?? 2.0;
    placeOuterBrickArch({
      silhouette:    silhouette[0],
      springerYFrac: ofaCfg.springerYFrac ?? 0.20,
      brickLength:   ofaCfg.brickLength ?? 8.0,
      brickHeight:   ofaCfg.brickHeight ?? 4.0,
      brickThick:    ofaThick,
      mortarGap:     ofaCfg.mortarGap ?? 0.08,
      zCenter:       gateFrontZ + (ofaCfg.zLift ?? 0.5) + ofaThick * 0.5,
      color:         ofaCfg.color || cfg.gradientBright || '#E0BE89',
      outwardOffset: ofaCfg.outwardOffset ?? 0.6,
      rotate90:      ofaCfg.rotate90 ?? false,
      inwardSafety:  ofaCfg.inwardSafety ?? 0,
      group,
      seedOffset:    9700,
    });
  }

  // --- Outer frame bricks ---
  // Visible cut-stone bricks tiled along the gate frame's outer
  // perimeter. The polygon is silhouette[0] inset inward by half a
  // brick's radial height so each brick sits FULLY inside the logo
  // silhouette (its outer face just kisses silhouette[0], satisfying
  // "nothing extends beyond the logo"). Z places the brick centre just
  // in front of the gate-frame front face so the stones read as a ring
  // of decorative blocks lining the frame.
  const ofCfg = cfg.outerFrame;
  if (ofCfg?.enabled !== false && silhouette[0] && silhouette[0].length >= 3) {
    const halfH = ofCfg.brickHeight * 0.5;
    const ofPoly = insetPolygon(silhouette[0], halfH);
    placeStarRail({
      railPolygon:  ofPoly,
      brickLength:  ofCfg.brickLength,
      brickHeight:  ofCfg.brickHeight,
      brickThick:   ofCfg.thickness,
      mortarGap:    ofCfg.mortarGap ?? 0.04,
      zCenter:      gateFrontZ + ofCfg.thickness * 0.5,
      color:        ofCfg.color || cfg.color || '#9A7544',
      group,
      seedOffset:   8000,
    });
  }

  // --- Inner frame bricks (second ring framing the floor wall) ---
  // A medium-sized brick ring sitting INSIDE the outer-frame stones,
  // framing the inner floor brick wall. Its polygon = silhouette[0]
  // inset by `inset` (so it lives radially inside the outer frame),
  // and its Z sits above the floor wall but below the outer frame's
  // forward Z, giving a layered "frame inside a frame" read.
  const ifCfg = cfg.innerFrame;
  if (ifCfg?.enabled !== false && silhouette[0] && silhouette[0].length >= 3) {
    const ifPoly = insetPolygon(silhouette[0], ifCfg.inset);
    if (ifPoly && ifPoly.length >= 3) {
      const floorTopZ = maxZ + (cfg.floor?.yLevel || 0) + brickCfg.height;
      placeStarRail({
        railPolygon:  ifPoly,
        brickLength:  ifCfg.brickLength,
        brickHeight:  ifCfg.brickHeight,
        brickThick:   ifCfg.thickness,
        mortarGap:    ifCfg.mortarGap ?? 0.04,
        zCenter:      floorTopZ + (ifCfg.zLift ?? 0.10) + ifCfg.thickness * 0.5,
        color:        ifCfg.color || cfg.color || '#9A7544',
        group,
        seedOffset:   8500,
      });
    }
  }

  // --- Curved star rails ---
  // Layered brick bands that wrap the inner star bay (silhouette[1]) at
  // increasing outward offsets. Each rail = one ring of bricks tiled
  // along the offset polygon. Together with the muqarnas above and the
  // floor bricks below, this gives the reference's "framed star" read.
  // Reference: ANIM.arch.starRails.rails — list of {offset, zLift,
  // brickHeight, brickLength, color} entries.
  const railsCfg = cfg.starRails;
  if (railsCfg?.enabled !== false && silhouette.length > 1
      && Array.isArray(railsCfg?.rails) && railsCfg.rails.length > 0) {
    const star = silhouette[1];
    const starC = polyCentroid(star);
    // Same Z floor reference as the floor-fill back wall: rails sit just
    // in front of the floor so they read as raised brick bands on top
    // of the panel surface.
    const floorTopZ = maxZ + (cfg.floor?.yLevel || 0) + brickCfg.height;
    let seed = 9000;
    for (const rail of railsCfg.rails) {
      const railPoly = offsetPolygonFromPoint(star, starC.x, starC.y, rail.offset);
      placeStarRail({
        railPolygon:  railPoly,
        brickLength:  rail.brickLength,
        brickHeight:  rail.brickHeight,
        brickThick:   rail.brickThick ?? 0.4,
        mortarGap:    railsCfg.mortarGap ?? 0.04,
        zCenter:      floorTopZ + (rail.zLift ?? 0),
        color:        rail.color || cfg.color || '#9A7544',
        group,
        seedOffset:   seed,
      });
      seed += 500;
    }
  }

  // Invisible LineSegments cloned from every brick's edges. Lives inside
  // `group` so the spark system (stroke-sparks) finds it via traverse and
  // builds its snap cloud from these vertices — sparks then hop along
  // brick outlines / mortar gaps the same way they hop along panel strokes.
  // For cascade bricks (parked at startPos pre-cascade), edges are sampled
  // at restPos so the snap cloud reflects the final arch geometry.
  const edgePositions = [];
  const _edgeMat = new THREE.Matrix4();
  const _edgeVec = new THREE.Vector3();
  group.traverse(obj => {
    if (!obj.isMesh || !obj.geometry) return;
    // Compose from position/quaternion/scale rather than reading obj.matrix:
    // mesh.matrix is only refreshed by updateMatrixWorld(), which the renderer
    // hasn't run yet, so obj.matrix is still identity here. Cascade bricks
    // substitute restPos because they're parked at startPos for the pre-
    // cascade pose, and we want the snap cloud to reflect final geometry.
    const posForMat = obj.userData.restPos || obj.position;
    _edgeMat.compose(posForMat, obj.quaternion, obj.scale);
    const edges = new THREE.EdgesGeometry(obj.geometry);
    const arr = edges.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) {
      _edgeVec.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(_edgeMat);
      edgePositions.push(_edgeVec.x, _edgeVec.y, _edgeVec.z);
    }
    edges.dispose();
  });
  let sparkZ = 0.12;
  if (edgePositions.length > 0) {
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position',
      new THREE.BufferAttribute(new Float32Array(edgePositions), 3));
    const edgeLines = new THREE.LineSegments(edgeGeo,
      new THREE.LineBasicMaterial({ visible: false }));
    edgeLines.name = 'arch-edges';
    edgeLines.visible = false;
    group.add(edgeLines);
    // Park sparks just in front of the outer-arch row's front face so they
    // render on top of every brick face instead of behind them.
    sparkZ = gateFrontZ + brickCfg.width + 0.05;
  }

  function triggerCascade(t) { cascadeStartTime = t; lastFireTime = t; }

  function update(t /*, dt */) {
    // Tick every lantern's flicker (independent of cascade state).
    for (const u of lanternUpdaters) u(t);

    const c = cfg.innerArch?.cascade;
    if (!c || cascadeBricks.length === 0) return;
    // Auto-fire on first call after triggerDelay; honour repeatPeriod.
    if (cascadeStartTime === null && t >= (c.triggerDelay || 0)) {
      cascadeStartTime = t;
      lastFireTime     = t;
    }
    if (cascadeStartTime === null) return;
    if (c.repeatPeriod > 0 && (t - lastFireTime) >= c.repeatPeriod) {
      cascadeStartTime = t;
      lastFireTime     = t;
    }
    const fall = c.fallDuration || 1.0;
    const stag = c.stagger || 0;
    const elapsed = t - cascadeStartTime;
    for (let i = 0; i < cascadeBricks.length; i++) {
      const b = cascadeBricks[i];
      const startOffset = b.userData.cascadeOrder * stag * cascadeBricks.length;
      const local = elapsed - startOffset;
      if (local <= 0) {
        b.position.copy(b.userData.startPos);
      } else if (local >= fall) {
        b.position.copy(b.userData.restPos);
      } else {
        const u = local / fall;
        const e = 1 - Math.pow(1 - u, 3); // ease-out cubic
        b.position.lerpVectors(b.userData.startPos, b.userData.restPos, e);
      }
    }
  }

  return { group, update, triggerCascade, sparkZ };
}
