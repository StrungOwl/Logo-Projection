// Fireplace frame — a self-contained brick arch + muqarnas petal frame
// that wraps the OUTSIDE of the logo's bounding box. Built from scratch
// (does NOT share silhouette[0] curves, knobs, or helpers with the
// existing arch.js) so tweaks to arch never affect this and vice versa.
//
// Geometry: Roman horseshoe — two vertical brick legs flanking the
// logo's bbox on the left and right, joined by a half-ellipse dome
// across the top. Open at the bottom (the hearth). Petals (muqarnas-
// style pointed-arch cells) line the INNER face of that horseshoe
// with their tips pointing toward the logo centre.
//
// All knobs live under ANIM.fireplace — see src/config.js. Sparks are
// owned by patterns/flame.js as before; this module only emits static
// brick + petal meshes into its own group.

import * as THREE from 'three';
import { ANIM } from '../src/config.js';

// =======================================================================
// Local helpers — duplicated intentionally so this module shares no
// state or knob semantics with patterns/arch.js. Identical implementations
// today, free to drift later.
// =======================================================================

function hash01(x, y, z, salt) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + salt * 91.345) * 43758.5453;
  return s - Math.floor(s);
}

function makeBrickGeometry(seed, dims) {
  const { width, height, depth, mortarGap, faultAmount } = dims;
  const geo = new THREE.BoxGeometry(width, height, depth, 1, 1, 1);
  const pos = geo.attributes.position;
  const sx = Math.max(0, 1 - (mortarGap * 2) / width);
  const sy = Math.max(0, 1 - (mortarGap * 2) / height);
  const sz = Math.max(0, 1 - (mortarGap * 2) / depth);
  const maxJ = Math.min(faultAmount * depth, mortarGap);
  for (let i = 0; i < pos.count; i++) {
    const ox = pos.getX(i), oy = pos.getY(i), oz = pos.getZ(i);
    const dx = (hash01(ox, oy, oz, seed +  3.1) - 0.5) * 2 * maxJ;
    const dy = (hash01(ox, oy, oz, seed + 17.7) - 0.5) * 2 * maxJ;
    const dz = (hash01(ox, oy, oz, seed + 41.3) - 0.5) * 2 * maxJ;
    pos.setXYZ(i, ox * sx + dx, oy * sy + dy, oz * sz + dz);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

const _basisMat = new THREE.Matrix4();
function basisQuat(localX, localY, localZ) {
  _basisMat.makeBasis(localX, localY, localZ);
  return new THREE.Quaternion().setFromRotationMatrix(_basisMat);
}

// Pointed-arch petal — extruded 2D shape used as the muqarnas cell.
// local-X = radial axis (tip at +X), local-Y = tangential width.
function makePetalGeometry(length, width, thickness) {
  const shape = new THREE.Shape();
  const halfW = width * 0.5;
  shape.moveTo(0, -halfW);
  shape.lineTo(0,  halfW);
  shape.quadraticCurveTo(length * 0.65,  halfW, length, 0);
  shape.quadraticCurveTo(length * 0.65, -halfW, 0,    -halfW);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth:         thickness,
    bevelEnabled:  false,
    curveSegments: 8,
  });
  geo.translate(0, 0, -thickness * 0.5);
  return geo;
}

// =======================================================================
// Centerline — the path bricks + petals walk. Traces silhouette[0]
// directly so the fireplace hugs the actual logo curve (SDG dome + side
// flares) instead of a bbox-derived half-ellipse. Same longest-run-above-Y
// approach that placeOuterBrickArch in arch.js uses, intentionally
// inlined here so fireplace.js shares no helpers with arch.js.
//
// Inputs: silhouette[0] (CCW polygon) + a springerYFrac knob.
// Output: open polyline of {x,y} points walking foot→over-the-top→foot
//         along the actual silhouette curve. Bricks extend outward from
//         this line by brickHeight; petals extend inward.
// =======================================================================
function samplePerimeterDense(poly, count) {
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
        });
        break;
      }
      target -= segLens[i];
    }
  }
  return out;
}

function buildSilhouetteArc({ poly, springerYFrac, sampleDensity }) {
  let minY =  Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const springerY = minY + (maxY - minY) * springerYFrac;

  // Perimeter total length — used to size the dense sample count.
  let totalPerim = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    totalPerim += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const sampleCount = Math.max(96, Math.round(totalPerim / sampleDensity) * 3);
  const perimSamples = samplePerimeterDense(poly, sampleCount);

  // Longest CONTIGUOUS run of samples with y > springerY (wrap-aware).
  // Robust against multi-crossing polygons (the SDG flares cross the cut
  // line many times in the lower half — the upper U is still one run).
  const N = perimSamples.length;
  const above = perimSamples.map(s => s.y > springerY);
  let bestStart = -1, bestLen = 0;
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
  if (bestLen < 2) return { points: [], springerY };

  const arc = [];
  for (let k = 0; k < bestLen; k++) arc.push(perimSamples[(bestStart + k) % N]);
  return { points: arc, springerY };
}

// Walk an open polyline and emit `count` evenly-spaced samples with
// tangent vectors. Returns [{x, y, tx, ty}].
function samplePolylineEven(points, count) {
  if (points.length < 2) return [];
  // Cumulative arc length.
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    ));
  }
  const total = cum[cum.length - 1];
  if (total <= 0) return [];
  const out = [];
  for (let i = 0; i < count; i++) {
    const target = (i + 0.5) / count * total;
    // Locate the segment containing `target`.
    let seg = 0;
    while (seg < cum.length - 2 && cum[seg + 1] < target) seg++;
    const segLen = cum[seg + 1] - cum[seg] || 1;
    const u      = (target - cum[seg]) / segLen;
    const a = points[seg], b = points[seg + 1];
    const x = a.x + (b.x - a.x) * u;
    const y = a.y + (b.y - a.y) * u;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    out.push({ x, y, tx: dx / len, ty: dy / len });
  }
  return out;
}

// One pass of tangent averaging — knocks down corner discontinuities at
// the springer joins so adjacent bricks don't snap-rotate by π/2.
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
  for (let i = 0; i < n; i++) { samples[i].tx = tx[i]; samples[i].ty = ty[i]; }
  return samples;
}

// =======================================================================
// Brick row — chunky tangent-aligned stones whose body extends INWARD
// (toward the logo) from each sample point. Brick local axes:
//   local-X → world-Z       (long axis points at the camera)
//   local-Y → outward       (radial, away from logo centre)
//   local-Z → curve tangent (along the horseshoe path)
// The brick's OUTER face (local-Y = +height/2) kisses the silhouette
// centerline; the body extends `brickHeight` units inward, so no part of
// the brick pokes outside silhouette[0].
// =======================================================================
function placeFireplaceBricks({ samples, logoCx, logoCy, brickCfg, zCenter,
                                material, group, seedOffset }) {
  const localX = new THREE.Vector3(0, 0, 1);
  const localY = new THREE.Vector3();
  const localZ = new THREE.Vector3();
  const halfH  = brickCfg.height * 0.5;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    // Outward = away from logo centre, projected onto the line normal.
    // Tangent = (tx, ty); two candidate normals are (ty, -tx) and (-ty, tx).
    // Pick the one pointing AWAY from (logoCx, logoCy).
    let nx =  s.ty, ny = -s.tx;
    const toLogoX = logoCx - s.x;
    const toLogoY = logoCy - s.y;
    if (nx * toLogoX + ny * toLogoY > 0) { nx = -nx; ny = -ny; }
    localY.set(nx, ny, 0).normalize();
    localZ.set(s.tx, s.ty, 0).normalize();
    const geo  = makeBrickGeometry(seedOffset + i, brickCfg);
    const mesh = new THREE.Mesh(geo, material);
    // Push the brick centre INWARD by halfH so its outer face kisses
    // silhouette[0] and the body stays entirely inside the logo.
    mesh.position.set(s.x - nx * halfH, s.y - ny * halfH, zCenter);
    mesh.quaternion.copy(basisQuat(localX, localY, localZ));
    group.add(mesh);
  }
}

// =======================================================================
// Petal row — muqarnas-style pointed-arch cells lining the INNER face
// of the horseshoe with tips pointing toward the logo centre. Petal
// local axes:
//   local-X → inward (toward logo centre)
//   local-Y → curve tangent (along the horseshoe path)
//   local-Z → world +Z      (cell thickness)
// =======================================================================
function placePetalRow({ samples, logoCx, logoCy, petalLength, petalWidth,
                         petalThick, inwardOffset, zCenter, material, group }) {
  const geo = makePetalGeometry(petalLength, petalWidth, petalThick);
  const localX = new THREE.Vector3();
  const localY = new THREE.Vector3();
  const localZ = new THREE.Vector3(0, 0, 1);
  // Use the curve normal (perpendicular to tangent, pointing toward logo
  // centre) for the inward push so adjacent petals all shift by the same
  // signed distance along the same local frame — using the raw "to-centre"
  // vector instead would skew their bases off the curve.
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    let nx =  s.ty, ny = -s.tx;
    const toLogoX = logoCx - s.x;
    const toLogoY = logoCy - s.y;
    if (nx * toLogoX + ny * toLogoY < 0) { nx = -nx; ny = -ny; }
    localX.set(nx, ny, 0);
    localY.set(s.tx, s.ty, 0);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(s.x + nx * inwardOffset, s.y + ny * inwardOffset, zCenter);
    mesh.quaternion.copy(basisQuat(localX, localY, localZ));
    group.add(mesh);
  }
}

// =======================================================================
// Inner hex band — flat-extruded pointy-top hexagons tiled across the
// inner face of the horseshoe to "fill" the inner lining with a hex
// pattern. The band is laid out in the curve's LOCAL frame at every
// sample (local-X = curve tangent, local-Y = inward radial), so the
// hex grid wraps around the horseshoe instead of being drawn in flat
// world XY (which would mis-tile around the dome curve).
//
// Tiling: pointy-top hexes touch flat-edge along the tangent at
// horizontal pitch √3·R; successive rows are pushed inward (toward
// the logo centre) by 1.5·R and offset along the tangent by half a
// hex-width so the rows interlock.
// =======================================================================
function makeFlatHexGeometry(radius, depth) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 2 + i * Math.PI / 3;  // pointy-top
    const x = Math.cos(a) * radius, y = Math.sin(a) * radius;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled:  false,
    curveSegments: 1,
  });
  geo.translate(0, 0, -depth * 0.5);  // centre the extrusion on Z=0
  return geo;
}

// Half hex — pointy-top hex sliced along the horizontal diameter,
// keeping the upper half. The flat cut edge runs along local-X
// (= curve tangent when placed) at local-Y = 0, so the cut sits
// flush against the inner wall; the rounded half protrudes in
// local-+Y (= radial inward toward the logo). Apothem-half-width
// across the cut = √3·R/2 on each side.
function makeHalfHexGeometry(radius, depth) {
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

function placeInnerHexBand({ arcPoints, logoCx, logoCy, hexRadius, hexDepth,
                              rowCount, baseInwardOffset, alongOffset,
                              pitchScale, halfCut, outlineMat, zCenter,
                              material, group }) {
  if (!arcPoints || arcPoints.length < 2) return;

  // pitchScale multiplies the natural touching-hex pitch on BOTH axes,
  // so values >1 introduce uniform gaps between adjacent tiles in both
  // the tangent (along-curve) and radial (between-row) directions.
  const ps         = Math.max(0.1, pitchScale ?? 1.0);
  const flatWidth  = Math.sqrt(3) * hexRadius * ps;  // tangent pitch
  const rowSpacing = 1.5            * hexRadius * ps;  // radial pitch
  // Half-cut hex: pointy half hugs the wall, flat edge flush against
  // the inner brick face. Tangent pitch becomes the half-hex's flat
  // width = √3·R (same as full hex, since we keep the full diameter
  // on the cut edge). Radial extent shrinks to R (half hex height).
  const hexGeo     = halfCut
    ? makeHalfHexGeometry(hexRadius, hexDepth)
    : makeFlatHexGeometry(hexRadius, hexDepth);
  // Edges geometry — built once, instanced per hex via LineSegments.
  // Threshold of 1° catches every flat-to-flat seam on the extrusion,
  // so each tile gets all 6 face edges + the front/back outlines.
  const edgesGeo   = outlineMat ? new THREE.EdgesGeometry(hexGeo, 1) : null;

  // Local axes: hex face stays perpendicular to world-Z, so local-Z
  // always = +Z. local-X aligns with the curve tangent at each sample,
  // local-Y is the radial-inward normal — this is what makes the hex
  // grid follow the horseshoe path instead of being drawn in flat XY.
  const localX = new THREE.Vector3();
  const localY = new THREE.Vector3();
  const localZ = new THREE.Vector3(0, 0, 1);

  for (let r = 0; r < rowCount; r++) {
    // Even rows kiss flat-to-flat along the tangent; odd rows shift by
    // half a hex-width so they interlock with the row outside them.
    const rowAlongShift  = (r % 2 === 1) ? flatWidth * 0.5 : 0.0;
    const rowInwardShift = baseInwardOffset + r * rowSpacing;

    // Build this row's OWN inset polyline by pushing each arc point
    // inward by rowInwardShift along the local normal, then resample
    // THAT polyline at flatWidth pitch. Sampling the OUTER arc and
    // then radially shifting (the previous approach) bunched hexes
    // near the dome apex because the inner curve is shorter than the
    // outer one — uniform spacing on the outer curve became uneven
    // spacing on the inner curve where the hexes physically sit.
    const insetPoly = offsetPolylineInward(
      arcPoints, rowInwardShift, logoCx, logoCy,
    );
    if (insetPoly.length < 2) continue;
    const insetLen = arcLength(insetPoly);
    const sampleCount = Math.max(2, Math.round(insetLen / flatWidth));
    const samples = samplePolylineEven(insetPoly, sampleCount);
    if (samples.length === 0) continue;

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      // Inward normal at the inset sample — perpendicular to its OWN
      // tangent, so the hex's local-Y points correctly inward at the
      // inset curve's curvature.
      let nx =  s.ty, ny = -s.tx;
      const toLogoX = logoCx - s.x;
      const toLogoY = logoCy - s.y;
      if (nx * toLogoX + ny * toLogoY < 0) { nx = -nx; ny = -ny; }
      localX.set(s.tx, s.ty, 0);
      localY.set(nx, ny, 0);

      // Tangential shift only — the sample already lies on the inset
      // curve, so no further radial push is needed.
      const px = s.x + s.tx * (rowAlongShift + alongOffset);
      const py = s.y + s.ty * (rowAlongShift + alongOffset);

      const mesh = new THREE.Mesh(hexGeo, material);
      mesh.position.set(px, py, zCenter);
      mesh.quaternion.copy(basisQuat(localX, localY, localZ));
      group.add(mesh);
      if (edgesGeo) {
        const edge = new THREE.LineSegments(edgesGeo, outlineMat);
        edge.position.copy(mesh.position);
        edge.quaternion.copy(mesh.quaternion);
        group.add(edge);
      }
    }
  }
}

// Push every point of an open polyline INWARD (toward the logo centre)
// by `distance`, along the local normal at that point. Used so we can
// resample the actual centerline a row of inner hexes traces — uniform
// pitch on this curve = uniform spacing where the hexes physically sit.
function offsetPolylineInward(pts, distance, logoCx, logoCy) {
  if (!pts || pts.length < 2) return pts;
  const out = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b.x - a.x, ty = b.y - a.y;
    const tlen = Math.hypot(tx, ty) || 1;
    let nx =  ty / tlen, ny = -tx / tlen;
    const p = pts[i];
    if (nx * (logoCx - p.x) + ny * (logoCy - p.y) < 0) { nx = -nx; ny = -ny; }
    out[i] = { x: p.x + nx * distance, y: p.y + ny * distance };
  }
  return out;
}

function arcLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return L;
}

// =======================================================================
// Public entry point. Returns { group, update } so patterns-layer can
// add the group to logoMesh and main.js can call update each frame
// (currently a no-op — kept for parallel wiring with arch / flame).
// =======================================================================
export function createFireplace({ silhouette, maxZ, frameDepth = 0.5 }) {
  const cfg   = ANIM.fireplace || {};
  const group = new THREE.Group();
  group.name  = 'fireplace';
  if (cfg.enabled === false) return { group, update: () => {} };
  if (!silhouette || !silhouette[0] || silhouette[0].length < 3) {
    return { group, update: () => {} };
  }

  // Logo bbox is only used for the logo centre (so per-sample inward /
  // outward direction can point toward / away from the body). The
  // centerline itself comes from silhouette[0] directly.
  let minY =  Infinity, maxY = -Infinity;
  let minX =  Infinity, maxX = -Infinity;
  for (const p of silhouette[0]) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const logoCx   = (minX + maxX) * 0.5;
  const logoCy   = (minY + maxY) * 0.5;

  // springerYFrac sets how far down the legs reach along silhouette[0]:
  // 0 = legs follow the curve all the way to the bottom; 0.5 = stop at
  // mid-height (drops the SDG side flares).
  const springerYFrac = cfg.springerYFrac ?? 0.0;
  // archInset shifts the WHOLE centerline inward (toward logo centre).
  // 0 = brick outer face kisses silhouette[0]; positive values pull the
  // arch in so it floats inside the silhouette.
  const archInset     = cfg.archInset     ?? 0.0;

  // Bricks ----------------------------------------------------------------
  const bCfg = cfg.brick || {};
  const brickDims = {
    width:       bCfg.width       ?? 1.4,
    height:      bCfg.height      ?? 2.4,
    depth:       bCfg.depth       ?? 1.6,
    mortarGap:   bCfg.mortarGap   ?? 0.06,
    faultAmount: bCfg.faultAmount ?? 0.05,
  };

  const arc = buildSilhouetteArc({
    poly:           silhouette[0],
    springerYFrac,
    sampleDensity:  brickDims.depth,
  });
  if (arc.points.length < 2) return { group, update: () => {} };

  // Apply archInset by walking the arc's segment normals and shifting
  // each point inward (toward logo centre). Done before sampling so both
  // bricks and petals inherit the same offset centerline.
  if (archInset > 0) {
    const offset = new Array(arc.points.length);
    for (let i = 0; i < arc.points.length; i++) {
      const a = arc.points[Math.max(0, i - 1)];
      const b = arc.points[Math.min(arc.points.length - 1, i + 1)];
      const tx = b.x - a.x, ty = b.y - a.y;
      const tlen = Math.hypot(tx, ty) || 1;
      let nx =  ty / tlen, ny = -tx / tlen;
      const p = arc.points[i];
      if (nx * (logoCx - p.x) + ny * (logoCy - p.y) < 0) { nx = -nx; ny = -ny; }
      offset[i] = { x: p.x + nx * archInset, y: p.y + ny * archInset };
    }
    for (let i = 0; i < arc.points.length; i++) {
      arc.points[i].x = offset[i].x;
      arc.points[i].y = offset[i].y;
    }
  }

  // Spacing along the curve = brick.depth (the dimension that runs along
  // local-Z, which is our tangent). Sample density is total arc length
  // divided by that spacing, so adjacent bricks butt edge-to-edge.
  let totalLen = 0;
  for (let i = 1; i < arc.points.length; i++) {
    totalLen += Math.hypot(
      arc.points[i].x - arc.points[i - 1].x,
      arc.points[i].y - arc.points[i - 1].y,
    );
  }
  const brickCount = Math.max(8, Math.round(totalLen / brickDims.depth));
  let brickSamples = samplePolylineEven(arc.points, brickCount);
  brickSamples = smoothTangents(brickSamples);

  const brickMat = new THREE.MeshStandardMaterial({
    color:     new THREE.Color(cfg.brickColor || '#9A7544'),
    metalness: 0.15,
    roughness: 0.78,
  });

  // Z anchor — bricks sit just in front of the gate frame's front face.
  const gateFrontZ = maxZ + 0.45 + frameDepth;
  const brickZ     = gateFrontZ + brickDims.width * 0.5 + (cfg.brickZLift ?? 0.0);

  if (cfg.bricks?.enabled !== false) {
    placeFireplaceBricks({
      samples:    brickSamples,
      logoCx, logoCy,
      brickCfg:   brickDims,
      zCenter:    brickZ,
      material:   brickMat,
      group,
      seedOffset: 4400,
    });
  }

  // Petals ----------------------------------------------------------------
  const pCfg = cfg.petals || {};
  if (pCfg.enabled !== false) {
    const petalLength = pCfg.length    ?? 4.0;
    const petalWidth  = pCfg.width     ?? 2.4;
    const petalThick  = pCfg.thickness ?? 0.4;
    // Petals get their own sample density (typically lower than bricks
    // so each cell has visible spacing along the curve).
    const petalCount = Math.max(6, Math.round(totalLen / (pCfg.spacing ?? 1.6)));
    let petalSamples = samplePolylineEven(arc.points, petalCount);
    petalSamples = smoothTangents(petalSamples);

    const petalMat = new THREE.MeshStandardMaterial({
      color:     new THREE.Color(pCfg.color || '#7A5A38'),
      metalness: 0.10,
      roughness: 0.85,
    });
    // Petals sit UNDER the brick arch — their Z centre matches the brick
    // centre, so the brick rim reads as the dominant outer layer with the
    // petals as recessed niches just radially inward of it. Both bricks
    // and petals are pushed past the topLayer staircase by brickZLift,
    // so neither is occluded.
    const petalZ = brickZ + (pCfg.zLift ?? 0.0);
    // Default petal inwardOffset = brick.height so the petal's base sits
    // exactly flush with the inner face of the brick band (= silhouette[0]
    // - archInset - brick.height inward), and the petal extends inward
    // FROM that face.
    const petalInset = pCfg.inwardOffset ?? brickDims.height;
    placePetalRow({
      samples:      petalSamples,
      logoCx, logoCy,
      petalLength, petalWidth, petalThick,
      inwardOffset: petalInset,
      zCenter:      petalZ,
      material:     petalMat,
      group,
    });
  }

  // Inner hex band ---------------------------------------------------------
  // Tessellated hex tiles filling the inner lining of the horseshoe. Sits
  // just inside the inner brick face (= silhouette - archInset -
  // brick.height) and extends further inward by `rowCount` rows of hex
  // pitch. Z is co-planar with the brick centre by default so the band
  // reads as a continuous inner skin of the brick rim.
  const hCfg = cfg.innerHexes || {};
  if (hCfg.enabled !== false) {
    const hexRadius   = hCfg.radius        ?? 1.4;
    const hexDepth    = hCfg.depth         ?? 0.5;
    const rowCount    = Math.max(1, hCfg.rowCount ?? 3);
    const alongOffset = hCfg.alongOffset   ?? 0.0;
    const pitchScale  = hCfg.pitchScale    ?? 1.0;
    const halfCut     = hCfg.halfCut       !== false;
    // Default base inward offset:
    //   halfCut on  → brick.height. The half-hex's cut edge anchors at
    //                 local-Y = 0 of its own geometry, so placing the
    //                 anchor exactly at the inner brick face puts the
    //                 cut edge flush with the wall and the half-hex
    //                 protrudes inward.
    //   halfCut off → brick.height + hexRadius. The full hex's anchor
    //                 is its centre, so we shift inward by R so the
    //                 hex's outer EDGE sits at the inner brick face
    //                 instead of bisecting it.
    const defaultInset = halfCut
      ? brickDims.height
      : (brickDims.height + hexRadius);
    const baseInset   = hCfg.baseInwardOffset ?? defaultInset;
    const hexZ        = brickZ + (hCfg.zLift ?? 0.05);

    const hexMat = new THREE.MeshStandardMaterial({
      color:     new THREE.Color(hCfg.color || '#B8915A'),
      metalness: 0.10,
      roughness: 0.80,
    });
    // Outline — undefined / null outlineColor disables the outline.
    let outlineMat = null;
    if (hCfg.outline !== false && (hCfg.outlineColor || hCfg.outline === true)) {
      outlineMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(hCfg.outlineColor || '#1a0d05'),
      });
    }

    placeInnerHexBand({
      arcPoints:        arc.points,
      logoCx, logoCy,
      hexRadius,
      hexDepth,
      rowCount,
      baseInwardOffset: baseInset,
      alongOffset,
      pitchScale,
      halfCut,
      outlineMat,
      zCenter:          hexZ,
      material:         hexMat,
      group,
    });
  }

  return { group, update: () => {} };
}
