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
// Horseshoe centerline — the path bricks + petals walk. Built directly
// from the logo's bbox (NOT from silhouette[0]), so it doesn't inherit
// the SDG side flares or any other concavity.
//
// Inputs: bbox of silhouette[0] + a few horseshoe shape knobs.
// Output: open polyline of {x,y} points ordered foot→over-the-top→foot.
//         The polyline traces the INNER face of the horseshoe (the face
//         pointing at the logo). Bricks extend outward from this line by
//         brickHeight; petals extend inward by petalLength.
// =======================================================================
function buildHorseshoe({ bbox, gap, domeRise, legHeight, arcSegments }) {
  const innerLeft  = bbox.minX - gap;
  const innerRight = bbox.maxX + gap;
  const cx         = (innerLeft + innerRight) * 0.5;
  const radiusX    = (innerRight - innerLeft) * 0.5;
  const springerY  = bbox.maxY;
  const apexY      = springerY + domeRise;
  // Half-ellipse with horizontal radius = radiusX, vertical radius = domeRise.
  // Center at (cx, springerY); sweep angle 0→π gives left-springer over top
  // back to right-springer (CCW in screen coords because Y is up).
  const baseY = springerY - legHeight;

  const pts = [];
  // Left foot up to left springer.
  pts.push({ x: innerLeft, y: baseY });
  pts.push({ x: innerLeft, y: springerY });
  // Half-ellipse arc from left springer over the apex to right springer.
  // theta runs from π (left) to 0 (right), via π/2 at apex.
  const seg = Math.max(8, arcSegments | 0);
  for (let i = 1; i < seg; i++) {
    const theta = Math.PI - (i / seg) * Math.PI;
    pts.push({
      x: cx + radiusX * Math.cos(theta),
      y: springerY + domeRise * Math.sin(theta),
    });
  }
  // Right springer down to right foot.
  pts.push({ x: innerRight, y: springerY });
  pts.push({ x: innerRight, y: baseY  });
  return { points: pts, apexY, springerY, baseY, cx };
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
// Brick row — chunky tangent-aligned stones whose body extends OUTWARD
// (away from the logo) from each sample point. Brick local axes:
//   local-X → world-Z       (long axis points at the camera)
//   local-Y → outward       (radial, away from logo centre)
//   local-Z → curve tangent (along the horseshoe path)
// The brick's INNER face (local-Y = -height/2) sits flush with the
// horseshoe centerline; the body extends `brickHeight` units outward.
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
    // Push the brick centre outward by halfH so its inner face kisses
    // the horseshoe centerline.
    mesh.position.set(s.x + nx * halfH, s.y + ny * halfH, zCenter);
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
                         petalThick, zCenter, material, group }) {
  const geo = makePetalGeometry(petalLength, petalWidth, petalThick);
  const localX = new THREE.Vector3();
  const localY = new THREE.Vector3();
  const localZ = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    // Inward = toward logo centre.
    let inX = logoCx - s.x;
    let inY = logoCy - s.y;
    const len = Math.hypot(inX, inY) || 1;
    inX /= len; inY /= len;
    localX.set(inX, inY, 0);
    localY.set(s.tx, s.ty, 0);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(s.x, s.y, zCenter);
    mesh.quaternion.copy(basisQuat(localX, localY, localZ));
    group.add(mesh);
  }
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

  // Logo bbox in panel-local coords (silhouette is already mesh-local
  // because patterns-layer pre-shifted it by (cx, cy)).
  //
  // X bounds come from the UPPER half of the silhouette only — this
  // drops the SDG side-flare width at the bottom of the logo, so the
  // horseshoe hugs the dome instead of stretching out to the flares.
  // Y bounds use the full silhouette so the legs can reach down past
  // the body if the user wants longer legs.
  let minY =  Infinity, maxY = -Infinity;
  for (const p of silhouette[0]) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const upperCutY = cfg.upperCutY ?? (minY + maxY) * 0.5;
  let minX =  Infinity, maxX = -Infinity;
  for (const p of silhouette[0]) {
    if (p.y < upperCutY) continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  // Fallback if the upper-cut filter rejects everything (defensive).
  if (!isFinite(minX) || !isFinite(maxX)) {
    for (const p of silhouette[0]) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
    }
  }
  const bbox     = { minX, maxX, minY, maxY };
  const upperW   = maxX - minX;
  const fullH    = maxY - minY;
  const logoCx   = (minX + maxX) * 0.5;
  const logoCy   = (minY + maxY) * 0.5;

  // Tight defaults — the silhouette is already wide, so a small absolute
  // domeRise keeps the apex just above the logo dome (visible on canvas)
  // instead of pushing it off the top. legHeight as a fullH fraction so
  // the legs scale with the logo body.
  const gap       = cfg.gap        ?? 0.6;
  const domeRise  = cfg.domeRise   ?? 1.5;
  const legHeight = cfg.legHeight  ?? fullH  * 0.70;
  const arcSeg    = cfg.arcSegments ?? 24;

  const horseshoe = buildHorseshoe({ bbox, gap, domeRise, legHeight, arcSeg });

  // Bricks ----------------------------------------------------------------
  const bCfg = cfg.brick || {};
  const brickDims = {
    width:       bCfg.width       ?? 1.4,
    height:      bCfg.height      ?? 2.4,
    depth:       bCfg.depth       ?? 1.6,
    mortarGap:   bCfg.mortarGap   ?? 0.06,
    faultAmount: bCfg.faultAmount ?? 0.05,
  };
  // Spacing along the curve = brick.depth (the dimension that runs along
  // local-Z, which is our tangent). Sample density is total arc length
  // divided by that spacing, so adjacent bricks butt edge-to-edge.
  let totalLen = 0;
  for (let i = 1; i < horseshoe.points.length; i++) {
    totalLen += Math.hypot(
      horseshoe.points[i].x - horseshoe.points[i - 1].x,
      horseshoe.points[i].y - horseshoe.points[i - 1].y,
    );
  }
  const brickCount = Math.max(8, Math.round(totalLen / brickDims.depth));
  let brickSamples = samplePolylineEven(horseshoe.points, brickCount);
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
    const petalLength = pCfg.length    ?? 2.0;
    const petalWidth  = pCfg.width     ?? 1.6;
    const petalThick  = pCfg.thickness ?? 0.4;
    // Petals get their own sample density (typically lower than bricks
    // so each cell has visible spacing along the curve).
    const petalCount = Math.max(6, Math.round(totalLen / (pCfg.spacing ?? 1.6)));
    let petalSamples = samplePolylineEven(horseshoe.points, petalCount);
    petalSamples = smoothTangents(petalSamples);

    const petalMat = new THREE.MeshStandardMaterial({
      color:     new THREE.Color(pCfg.color || '#7A5A38'),
      metalness: 0.10,
      roughness: 0.85,
    });
    // Petals sit slightly behind the brick front face so the brick
    // surround reads as the dominant outer layer and petals as inset
    // niches on the inner lip.
    const petalZ = gateFrontZ + petalThick * 0.5 + (pCfg.zLift ?? 0.05);
    placePetalRow({
      samples:     petalSamples,
      logoCx, logoCy,
      petalLength, petalWidth, petalThick,
      zCenter:     petalZ,
      material:    petalMat,
      group,
    });
  }

  return { group, update: () => {} };
}
