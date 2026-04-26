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
function placeFloor({ silhouettes, springerY = Infinity, brickCfg, floorCfg, zCenter,
                      material, group, seedOffset }) {
  // Bbox of the entire silhouette (outer loop). We track maxY too so the
  // grid can fill all the way up when no springer cap is supplied.
  const outer = silhouettes[0];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of outer) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const yCap = Math.min(springerY, maxY);
  const stepX = brickCfg.width  + brickCfg.mortarGap * 2;
  const stepY = brickCfg.depth  + brickCfg.mortarGap * 2;
  const cols  = Math.ceil((maxX - minX) / stepX) + 2;
  const rows  = Math.ceil((yCap - minY) / stepY) + 1;

  const localX = new THREE.Vector3(1, 0, 0);
  const localY = new THREE.Vector3(0, 0, 1);
  const localZ = new THREE.Vector3(0, 1, 0);
  const q = basisQuat(localX, localY, localZ);

  // Even-odd polygon test across all silhouette loops (so interior cutouts
  // are excluded).
  function insideAll(x, y) {
    let inside = pointInPolygon(x, y, outer);
    for (let k = 1; k < silhouettes.length; k++) {
      if (pointInPolygon(x, y, silhouettes[k])) inside = !inside;
    }
    return inside;
  }

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
// Public entry point. Returns a group + an update function + a triggerCascade
// callable. The patterns-layer wires the group into the logo and the update
// into main.js's tick.
// -----------------------------------------------------------------------
export function createArch({ silhouette, maxZ, frameDepth = 0.5,
                             gateFrameWidth = 1.6 }) {
  const cfg = ANIM.arch || {};
  const group = new THREE.Group();
  group.name = 'arch';
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
    // Floor bricks lie flat: brick.height is the world-Z thickness. Park
    // the brick BOTTOM on the logo's front face (maxZ) so the floor reads
    // as resting inside the gate frame aperture, just above the model.
    // Bounds = the inset polygon (gate-frame inner aperture) so the fill
    // hugs the same boundary the outline ring sits on, with no springer
    // cut — bricks tile the entire aperture interior.
    const floorZCenter = maxZ + (cfg.floor?.yLevel || 0) + brickCfg.height * 0.5;
    placeFloor({
      silhouettes: [curve.perimeterPoly],
      brickCfg,
      floorCfg: cfg.floor || {},
      zCenter: floorZCenter,
      material: archMat,
      group,
      seedOffset: 5000,
    });
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
    if (obj.userData.restPos) {
      _edgeMat.compose(obj.userData.restPos, obj.quaternion, obj.scale);
    } else {
      _edgeMat.copy(obj.matrix);
    }
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
