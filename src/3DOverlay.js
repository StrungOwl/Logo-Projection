// Two star fans anchored to the left and right sides of the model,
// fanning inward. Each fan is a row of rosettes (12-pointed stars — the
// same shape as the main Islamic panel, built at half-size) arrayed on
// rays from an edge pivot across a configurable angular spread, so the
// collection reads as an opened fan splaying into the model's interior.
//
// The wrapper group around each fan pulses (scale breathes) and slowly
// spins; the pivot sits on the outline and the blade length is short
// enough that the fan stays inside the silhouette at the default pulse
// range.

import * as THREE from 'three';
import { ANIM, COLORS } from './config.js';
import { insetPolygon } from '../patterns/gate-frame.js';

// Rosette parts — the same hub + inner/outer petal ratios as
// patterns/islamic-tile.js, but returned as independent pieces so each
// petal can become its own mesh. A single petal geometry is built per
// ring (petal-local coords, +x pointing outward, origin at the base
// edge); the caller stamps it at each kept angle. The tangent to the
// ring at the base is local +y, so rotating a petal about its local +y
// axis tips it like a domino hinged at its base.
function buildRosetteParts({ points, hubR, innerR, midR, outerR, depth, halfCut = false }) {
  const keep = (theta) => !halfCut || Math.cos(theta) > 1e-6;

  let hubGeo = null;
  if (!halfCut) {
    const hub = new THREE.Shape();
    const hubSteps = points * 2;
    for (let i = 0; i < hubSteps; i++) {
      const theta = (i / hubSteps) * Math.PI * 2;
      const r = i % 2 === 0 ? hubR : hubR * 0.5;
      const x = Math.cos(theta) * r;
      const y = Math.sin(theta) * r;
      if (i === 0) hub.moveTo(x, y); else hub.lineTo(x, y);
    }
    hub.closePath();
    hubGeo = new THREE.ExtrudeGeometry(hub, { depth, bevelEnabled: false });
  }

  // Diamond petal in local coords: base at (0,0), tip at (length,0),
  // waist at (length/2, ±halfWidth). Extruded in +z by `depth`. Origin
  // sits on the base edge so rotation.y hinges the tip up and over.
  const mkPetalGeo = (base, tip, halfWidth) => {
    const length = tip - base;
    const mid = length * 0.5;
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(mid, halfWidth);
    s.lineTo(length, 0);
    s.lineTo(mid, -halfWidth);
    s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  };

  const innerPetalGeo = mkPetalGeo(innerR, midR, (midR - innerR) * 0.3);
  const outerPetalGeo = mkPetalGeo(midR, outerR, (outerR - midR) * 0.35);

  // Angles kept on each ring (halfCut drops everything behind +x).
  // Outer ring is offset by half a step so its tips sit between the
  // inner tips — doubles the apparent ray count around the flower.
  const innerAngles = [];
  for (let i = 0; i < points; i++) {
    const theta = (i / points) * Math.PI * 2;
    if (keep(theta)) innerAngles.push(theta);
  }
  const outerAngles = [];
  for (let i = 0; i < points; i++) {
    const theta = ((i + 0.5) / points) * Math.PI * 2;
    if (keep(theta)) outerAngles.push(theta);
  }

  return {
    hubGeo,
    innerPetalGeo, outerPetalGeo,
    innerBase: innerR, outerBase: midR,
    innerAngles, outerAngles,
  };
}

// Quadratic tip lift for a single petal geometry, matching the old
// full-rosette formula (z += (r/outerR)^2 * amount) in petal-local
// coords: r ≈ baseR + hypot(lx, ly), where baseR is the petal's base
// radius on the parent ring. Near-hub vertices barely lift; tip lifts
// the most, giving every petal the same dish angle across cascade
// layers. Normals recomputed so the bent slab still lights correctly.
function liftPetalTip(geo, baseR, outerR, amount) {
  if (!(amount > 0)) return;
  const pos = geo.attributes.position;
  const invR = 1 / Math.max(outerR, 1e-4);
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const ly = pos.getY(i);
    const rFrac = Math.min((baseR + Math.hypot(lx, ly)) * invR, 1);
    pos.setZ(i, pos.getZ(i) + rFrac * rFrac * amount);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

// Ray-cast point-in-polygon. Poly is a closed ring of {x,y}; returns true
// if (x,y) is inside. Used for masking the brick-wall grid against the
// insetted gate-frame silhouette.
function pointInPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const cross = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
    if (cross) inside = !inside;
  }
  return inside;
}

// Honeycomb tiling inside `poly` with flat-top hexagons of circumradius
// `R`. Column spacing is 1.5R, row spacing is R·√3, and alternate
// columns are offset by half a row — the standard tight hex pack.
// Only slot centers inside the polygon are kept.
function buildHexSlots(poly, R) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const colStep = R * 1.5;
  const rowStep = R * Math.sqrt(3);
  const slots = [];
  let col = 0;
  // Right bound is one extra `colStep` beyond the polygon so the loop
  // gets one more column on the right side. `pointInPolygon` filters out
  // any centers that land outside the actual silhouette, so empty
  // overflow columns naturally drop away.
  for (let x = minX + R; x <= maxX - R * 0.25 + colStep; x += colStep) {
    const yOff = (col & 1) ? rowStep * 0.5 : 0;
    for (let y = minY + rowStep * 0.5 + yOff; y <= maxY - rowStep * 0.25; y += rowStep) {
      if (pointInPolygon(poly, x, y)) slots.push({ x, y });
    }
    col++;
  }
  return slots;
}

// Clamped smoothstep on [a,b]. Used to shape the morph alpha curve over
// the cycle so holds at both endpoints feel steady.
function smoothstep01(x, a, b) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Pick the two "lower" seed petals for a flower — one on the world-left
// (x<0) and one on the world-right (x>0), each with the most-negative
// world-y (i.e. closest to "below" from each side). `wrapperRotation` is
// the flower's base rotation so world-angle = petalAngle + wrapperRotation.
// Falls back to the single lowest petal if one side has no candidate.
function findLowerSeeds(angles, wrapperRotation) {
  const ranked = angles.map((a, i) => {
    const wa = a + wrapperRotation;
    return { i, x: Math.cos(wa), y: Math.sin(wa) };
  });
  ranked.sort((p, q) => p.y - q.y); // most-negative y first
  const left  = ranked.find(r => r.x <  0);
  const right = ranked.find(r => r.x >= 0);
  const seeds = [];
  if (left)  seeds.push(left.i);
  if (right) seeds.push(right.i);
  if (seeds.length === 0 && ranked.length) seeds.push(ranked[0].i);
  return seeds;
}

// Step number per petal for a domino that starts at every seed simultaneously
// (step 0) and, at each step, adds the unvisited petal angularly closest to
// any already-flipped petal. Returns { steps, maxStep }. Seeds fire together;
// the wave then ripples outward from both, meeting where the fronts converge.
function computeSeedChain(angles, seeds) {
  const twoPi = Math.PI * 2;
  const N = angles.length;
  const steps = new Array(N).fill(-1);
  const visited = new Array(N).fill(false);
  let placed = 0;
  for (const s of seeds) {
    if (s >= 0 && s < N && !visited[s]) {
      visited[s] = true;
      steps[s] = 0;
      placed++;
    }
  }
  let cur = 0;
  while (placed < N) {
    cur++;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < N; i++) {
      if (visited[i]) continue;
      let mn = Infinity;
      for (let j = 0; j < N; j++) {
        if (!visited[j]) continue;
        let d = Math.abs(angles[i] - angles[j]);
        d = Math.min(d, twoPi - d);
        if (d < mn) mn = d;
      }
      if (mn < bestD) { bestD = mn; best = i; }
    }
    if (best < 0) break;
    visited[best] = true;
    steps[best] = cur;
    placed++;
  }
  return { steps, maxStep: cur };
}

// Longest outline edge on the requested side of the hull centroid. The
// silhouette is RDP-simplified, so the straight vertical side of the
// archway collapses to one long segment that this loop reliably picks
// out. We pivot on that segment's midpoint so the halfCut rosette's cut
// edge lands along the archway's flat side. Tangent (dx, dy) is kept so
// the caller can rotate the wrapper to match the edge's actual slope.
// Returns null if the side has no edges.
function pickStraightEdge(outline, cx, side) {
  let best = null, bestLen = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const mx = (a.x + b.x) * 0.5;
    if (side === 'left'  && mx >= cx) continue;
    if (side === 'right' && mx <= cx) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len > bestLen) {
      bestLen = len;
      best = { x: mx, y: (a.y + b.y) * 0.5, dx, dy, len };
    }
  }
  return best;
}

// Rotation that puts the halfCut rosette's cut edge (its local +y axis)
// flush against the given edge tangent and aims its rays (local +x
// axis) toward `center`. Flips the tangent sign if the 90°-CW normal
// would point away from center, so rays always fan inward regardless
// of which way the outline was wound.
function alignToEdge(pivot, edge, center) {
  let tx = edge.dx / edge.len;
  let ty = edge.dy / edge.len;
  const toCx = center.x - pivot.x;
  const toCy = center.y - pivot.y;
  // 90°-CW normal of the tangent = (ty, -tx). If this points away from
  // center, flip the tangent so it points toward center instead.
  if (ty * toCx - tx * toCy < 0) { tx = -tx; ty = -ty; }
  // Rosette +y should align with (tx, ty); no-rotation default has +y
  // at world angle π/2, so subtract π/2 to land the axis on the tangent.
  return Math.atan2(ty, tx) - Math.PI / 2;
}

export function addOverlay(logoMesh, meta, cascadeState = null) {
  const { silhouette, hull, maxR, maxZ, cx, cy, patternFadeCenter } = meta;
  // Vanishing point the particles converge to — used as the centre of
  // the flower ring below. Falls back to the hull centroid if the logo
  // pipeline couldn't find an inner-star centroid.
  const fadeCX = cx + (patternFadeCenter?.[0] ?? 0);
  const fadeCY = cy + (patternFadeCenter?.[1] ?? 0);
  const wrappers = [];
  // Per-viewMode visibility splits (main.js toggles these independently):
  //   flowerRoots  — petal rosettes + morph-ghost group (the "rose" side
  //                  of the brick↔rose morph; visible in modes 0/3).
  //   hexRoots     — the bigger overlay brick-wall hexes that animate
  //                  in/out (visible in modes 0/2/3 — mode 2 wants them
  //                  alone; mode 3 wants them as transition states).
  //   sharedMask   — the stencil mask both flowers and hexes test
  //                  against; must be visible whenever either is on.
  const flowerRoots = [];
  const hexRoots = [];
  let sharedMask = null;

  const outline = (silhouette && silhouette[0]) ? silhouette[0] : hull;
  if (!outline || outline.length < 3) {
    return { updateOverlay: () => {}, patternsToRefresh: [] };
  }

  // Left pivot: midpoint of the longest outline edge on the left half
  // of the hull — that's the archway's straight vertical side. Falls
  // back to the extreme-x vertex if no left edges exist.
  const leftEdge = pickStraightEdge(outline, cx, 'left');
  let leftPivot;
  if (leftEdge) {
    leftPivot = { x: leftEdge.x, y: leftEdge.y };
  } else {
    leftPivot = outline[0];
    let leftBestX = Infinity;
    for (const p of outline) {
      if (p.x < leftBestX) { leftBestX = p.x; leftPivot = p; }
    }
  }

  const cfg0 = ANIM.overlay || {};
  const starSize = cfg0.starSize ?? 1.2;

  // Cascade stack — N concentric rosettes at decreasing size, stacked
  // in +z so each smaller layer sits on top of the one below it and
  // their extrusions slightly overlap. Each layer owns its own geometry
  // (size differs) and its own material (colour lerps from darkest at
  // the base to lightest at the top). Tip lift is applied per-layer,
  // scaled with layer size so every layer shares the same dish angle.
  const cascade      = cfg0.cascade || {};
  const cascadeCount = Math.max(1, cascade.count ?? 1);
  const scaleStep    = cascade.scaleStep ?? 0.75;
  const zStep        = cascade.zStep ?? 1.0;
  const tipLift      = cascade.tipLift ?? 0.0;
  const colorDarkest  = new THREE.Color(cascade.colorDarkest
                                        ?? COLORS.islamicPanel.gold);
  const colorLightest = new THREE.Color(cascade.colorLightest
                                        ?? COLORS.islamicPanel.gold);

  // Stencil clip — render a flat fill of the silhouette into the stencil
  // buffer first, then test against it on each cluster material so any
  // ray that pokes past the gate-frame outline is masked away. Disable
  // by setting `cfg0.maskClip = false`.
  const maskClip = cfg0.maskClip !== false;
  if (maskClip && silhouette && silhouette[0] && silhouette[0].length >= 3) {
    // Inset the silhouette so the stencil polygon sits INSIDE the
    // gate-frame's inner edge — clusters clip to the aperture, not the
    // gate-frame's outer outline, so rays never overlap the frame.
    const maskInset = cfg0.maskInset ?? 1.6;
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
      stencilRef:   1,
      stencilFunc:  THREE.AlwaysStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
    });
    const maskMesh = new THREE.Mesh(maskGeo, maskMat);
    maskMesh.name = 'overlay-stencil-mask';
    maskMesh.position.z = maxZ;             // depthTest off — z is irrelevant
    maskMesh.renderOrder = -100;            // first in opaque pass
    logoMesh.add(maskMesh);
    sharedMask = maskMesh;
  }

  const layerParts = [];
  const starMats = [];
  for (let i = 0; i < cascadeCount; i++) {
    const s = Math.pow(scaleStep, i);
    const layerR = starSize * s;
    const parts = buildRosetteParts({
      points:  12,
      hubR:    layerR * 0.18,
      innerR:  layerR * 0.22,
      midR:    layerR * 0.55,
      outerR:  layerR,
      depth:   cfg0.starDepth ?? Math.min(layerR * 0.15, 1.5),
      halfCut: cfg0.halfCut === true,
    });
    // Lift by `tipLift * s` so the peak-to-radius ratio (dish angle)
    // stays constant across layers even though each layer has its own
    // absolute scale. Applied per-petal-geo so the dish bake rotates
    // with each petal during the domino flip.
    liftPetalTip(parts.innerPetalGeo, parts.innerBase, layerR, tipLift * s);
    liftPetalTip(parts.outerPetalGeo, parts.outerBase, layerR, tipLift * s);
    layerParts.push(parts);

    // Colour lerp: i=0 (largest) is darkest, i=count-1 (smallest) is
    // lightest. HSL lerp keeps the transition perceptually smooth.
    const k = cascadeCount === 1 ? 1 : i / (cascadeCount - 1);
    const c = colorDarkest.clone().lerpHSL(colorLightest, k);
    const matOpts = {
      color: c,
      metalness: 0.55,
      roughness: 0.45,
      transparent: true,
      opacity: cfg0.opacity ?? 0.35,
    };
    if (maskClip) {
      // Pass only where the silhouette mask wrote stencil=1.
      // `stencilWrite` MUST be true for stencil state to apply at all
      // (three.js bypasses the entire stencil pipeline when it's
      // false). All ops are KEEP so we test without modifying the
      // buffer the mask just set.
      matOpts.stencilWrite  = true;
      matOpts.stencilRef    = 1;
      matOpts.stencilFunc   = THREE.EqualStencilFunc;
      matOpts.stencilFail   = THREE.KeepStencilOp;
      matOpts.stencilZFail  = THREE.KeepStencilOp;
      matOpts.stencilZPass  = THREE.KeepStencilOp;
    }
    starMats.push(new THREE.MeshStandardMaterial(matOpts));
  }

  function makeFan(pivot, wrapperRotation, spinDir, phaseOffset, dominoDelay = 0) {
    const count     = cfg0.starCount   ?? 5;
    const spread    = cfg0.angleSpread ?? Math.PI * 0.55;
    const fanRadius = cfg0.fanRadius   ?? maxR * 0.45;

    // Fan layout is always built with +x as the forward axis in
    // wrapper-local coords. `wrapperRotation` then swings the whole
    // cluster in world, so the rosette's +x (ray direction) ends up
    // pointing at the model center. For starCount=1 the spread
    // collapses (u=0.5) and the star sits at (fanRadius, 0) — set
    // fanRadius to 0 if you want the cut edge flush on the pivot.
    const cascadeLayers = [];
    const fan = new THREE.Group();
    const basePeriod    = cfg0.pulsePeriod ?? 6.0;
    const pulseVariance = cascade.pulseVariance ?? 0;
    const dominoCfg      = cfg0.petalDomino || {};
    const fanStagger     = dominoCfg.fanStagger     ?? 0.35;
    const cascadeStagger = dominoCfg.cascadeStagger ?? 0.12;
    for (let i = 0; i < count; i++) {
      const u = count === 1 ? 0.5 : i / (count - 1);
      const localAngle = (u - 0.5) * spread;
      const x = Math.cos(localAngle) * fanRadius;
      const y = Math.sin(localAngle) * fanRadius;
      // Cascade stack at this fan position — largest layer at z=0,
      // each smaller layer stepped forward by zStep so its base plane
      // sinks into the layer below instead of floating above it.
      const stack = new THREE.Group();
      stack.position.set(x, y, 0);
      for (let j = 0; j < cascadeCount; j++) {
        const parts = layerParts[j];
        const mat   = starMats[j];

        // One flower group per cascade layer. Hub + petals live as
        // siblings inside it so the pulse scale still applies to the
        // whole rosette, while each petal group can swing independently
        // around its base-tangent axis for the domino animation.
        const flower = new THREE.Group();
        flower.position.z = j * zStep;

        if (parts.hubGeo) {
          flower.add(new THREE.Mesh(parts.hubGeo, mat));
        }

        const petals = [];
        const petalAngles = [];
        // Per-petal brightness twinkle needs an independent material per
        // petal (so color + emissiveIntensity can diverge). Clone the
        // shared cascade material; stencil state copies over with it.
        // Emissive colour is locked to the base diffuse so modulating
        // emissiveIntensity alone gives a warm glow without a hue shift.
        const pbCfg         = cfg0.petalBrightness || {};
        const pbSpeedVar    = pbCfg.speedVariance ?? 0;
        const addPetal = (geo, theta, baseR) => {
          const g = new THREE.Group();
          g.position.set(Math.cos(theta) * baseR, Math.sin(theta) * baseR, 0);
          g.rotation.z = theta;            // local +x → outward, +y → ring-tangent
          const petalMat = mat.clone();
          petalMat.emissive = mat.color.clone();
          petalMat.emissiveIntensity = 0;
          const m = new THREE.Mesh(geo, petalMat);
          m.userData.petalBaseColor   = mat.color.clone();
          m.userData.petalPhase       = Math.random() * Math.PI * 2;
          m.userData.petalSpeedFactor = 1 + (Math.random() * 2 - 1) * pbSpeedVar;
          g.add(m);
          flower.add(g);
          petals.push(m);
          petalAngles.push(theta);
        };
        for (const theta of parts.innerAngles) {
          addPetal(parts.innerPetalGeo, theta, parts.innerBase);
        }
        for (const theta of parts.outerAngles) {
          addPetal(parts.outerPetalGeo, theta, parts.outerBase);
        }

        // Per-layer pulse state — randomised once at load so each layer
        // has its own period and phase. Scale animation runs on the
        // flower group so the whole rosette breathes as one unit while
        // leaving per-petal rotation.y free for the domino.
        const jitter = (Math.random() * 2 - 1) * pulseVariance;
        flower.userData.pulsePeriod = basePeriod * (1 + jitter);
        flower.userData.phaseOffset = Math.random() * Math.PI * 2;

        // Domino state. Seeds = world-lower-left + world-lower-right petals
        // (computed from the flower's base rotation so the wave originates at
        // the bottom of each rosette regardless of how the fan is oriented).
        // From those seeds we pre-bake per-petal step numbers: both seeds
        // fire at step 0, then each next petal is the one angularly nearest
        // to any already-flipped petal. `dominoStart` cascades deterministically
        // across fan position (i) and cascade layer (j).
        const seeds   = findLowerSeeds(petalAngles, wrapperRotation);
        const chain   = computeSeedChain(petalAngles, seeds);
        flower.userData.petals         = petals;
        flower.userData.petalAngles    = petalAngles;
        flower.userData.dominoSteps    = chain.steps;
        flower.userData.dominoMaxStep  = chain.maxStep;
        flower.userData.dominoStart    = i * fanStagger + j * cascadeStagger + dominoDelay;

        stack.add(flower);
        cascadeLayers.push(flower);
      }
      fan.add(stack);
    }

    const wrapper = new THREE.Group();
    wrapper.name = 'overlay-fan';
    wrapper.add(fan);
    // Snap the wrapper to the physical outline pivot when `snapToEdge`
    // is on — the half-rosette's cut edge lines up with the archway's
    // side so the rays read as a fan fixed to the model. Otherwise fall
    // back to the isolated preview slot controlled by `previewXFactor`.
    if (cfg0.snapToEdge !== false) {
      wrapper.position.set(pivot.x, pivot.y, maxZ + (cfg0.zOffset ?? 0.22));
    } else {
      wrapper.position.set(
        cx + maxR * (cfg0.previewXFactor ?? 1.2),
        cy,
        maxZ + (cfg0.zOffset ?? 0.22),
      );
    }
    wrapper.rotation.z             = wrapperRotation;
    wrapper.userData.phaseOffset   = phaseOffset;
    wrapper.userData.spinDir       = spinDir;
    wrapper.userData.baseRotation  = wrapperRotation;
    wrapper.userData.cascadeLayers = cascadeLayers;
    logoMesh.add(wrapper);
    wrappers.push(wrapper);
    flowerRoots.push(wrapper);
  }

  // Right pivot: symmetric to the left. Midpoint of the longest right
  // outline edge so the chain ends on the opposite straight side.
  const rightEdge = pickStraightEdge(outline, cx, 'right');
  let rightPivot;
  if (rightEdge) {
    rightPivot = { x: rightEdge.x, y: rightEdge.y };
  } else {
    rightPivot = outline[0];
    let rightBestX = -Infinity;
    for (const p of outline) {
      if (p.x > rightBestX) { rightBestX = p.x; rightPivot = p; }
    }
  }

  // Cumulative arc-length table for the outline. `sampleAtArc` then
  // gives us (position, tangent) at any arc-length offset, which we
  // use to stamp the cluster at evenly-spaced points from leftPivot up
  // and over the gate-frame to rightPivot.
  const N = outline.length;
  const cumArc = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % N];
    cumArc[i + 1] = cumArc[i] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const perimeter = cumArc[N];

  const sampleAtArc = (arc) => {
    arc = ((arc % perimeter) + perimeter) % perimeter;
    let lo = 0, hi = N;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cumArc[mid] <= arc) lo = mid; else hi = mid;
    }
    const a = outline[lo];
    const b = outline[(lo + 1) % N];
    const segLen = cumArc[lo + 1] - cumArc[lo];
    const u = segLen > 0 ? (arc - cumArc[lo]) / segLen : 0;
    return {
      x:   a.x + (b.x - a.x) * u,
      y:   a.y + (b.y - a.y) * u,
      dx:  b.x - a.x,
      dy:  b.y - a.y,
      len: Math.max(segLen, 1e-6),
    };
  };

  const nearestIdx = (p) => {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < N; i++) {
      const dx = outline[i].x - p.x, dy = outline[i].y - p.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  const center = { x: cx, y: cy };

  // Left-pivot rotation reused by the hex backdrop further down.
  // Computed once so both placement paths have a consistent reference.
  let leftRot = leftEdge
    ? alignToEdge(leftPivot, leftEdge, center)
    : Math.atan2(cy - leftPivot.y, cx - leftPivot.x);
  leftRot -= cfg0.rotationOffset ?? 0;

  // `snapToEdge: false` keeps the old preview behaviour — single
  // cluster parked beside the model with no outline walking.
  if (cfg0.snapToEdge === false) {
    const previewPivot = {
      x: cx + maxR * (cfg0.previewXFactor ?? 1.2),
      y: cy,
    };
    makeFan(previewPivot, -(cfg0.rotationOffset ?? 0), +1, 0);
  } else {
    // Radial fill — concentric rings around the particle vanishing
    // point (fadeCX, fadeCY). Outermost ring lives at
    // `maxR * radialRadiusFactor`, with each inner ring stepped in by
    // `maxR * ringSpacingFactor`. Instance count scales with ring
    // radius so angular spacing (≈ outerCircumference / instances)
    // stays roughly constant from ring to ring. Alternate rings are
    // offset by half an angular step so adjacent rings stagger
    // instead of radially stacking. Each flower's rotation aims its
    // rays inward toward the vanishing point.
    const outerInstances = Math.max(1, cfg0.instances ?? 1);
    const rotationOffset = cfg0.rotationOffset ?? 0;
    const outerR      = maxR * (cfg0.radialRadiusFactor ?? 0.6);
    const ringSpacing = maxR * (cfg0.ringSpacingFactor  ?? 0.18);
    const innerR      = maxR * (cfg0.innerRadiusFactor  ?? 0.08);
    const angleStep   = (2 * Math.PI * outerR) / outerInstances;
    // Outer ring fires the domino first; each inner ring delayed by
    // `ringStagger` so the flip wave rolls inward toward the centre.
    const ringStagger = cfg0.petalDomino?.ringStagger ?? 0.9;

    let k = 0;
    for (let r = 0; r < 32; r++) {
      const ringR = outerR - r * ringSpacing;
      if (ringR < innerR) break;
      const ringCircum = 2 * Math.PI * ringR;
      const ringCount  = Math.max(1, Math.round(ringCircum / angleStep));
      const ringOffset = (r & 1) ? Math.PI / ringCount : 0;
      const ringDelay  = r * ringStagger;
      for (let i = 0; i < ringCount; i++) {
        const theta = ringOffset + (i / ringCount) * Math.PI * 2;
        const px = fadeCX + Math.cos(theta) * ringR;
        const py = fadeCY + Math.sin(theta) * ringR;
        const rot = theta + Math.PI - rotationOffset;
        const spinDir = k % 2 === 0 ? +1 : -1;
        const phaseOffset = (k * 0.37) % (Math.PI * 2);
        makeFan({ x: px, y: py }, rot, spinDir, phaseOffset, ringDelay);
        k++;
      }
    }
  }

  // ============ Brick-wall morph ============
  // Snapshot each rosette petal's at-rest world transform ("rose home"),
  // tile an inset copy of the silhouette with a staggered brick grid,
  // greedily assign petals → nearest bricks, and build a flat morphGroup
  // of ghost meshes that interpolate between the two states at runtime.
  // Unassigned bricks get "filler" ghosts (big-outer petal) that only
  // exist in brick mode; extra petals with no brick fade to zero scale.
  const brickCfg      = cfg0.brickWall || {};
  const brickEnabled  = brickCfg.enabled !== false;
  let morphGroup     = null;
  let brickHexWall   = null;
  let brickHexMeshes = [];
  const ghosts = [];

  if (brickEnabled && silhouette && silhouette[0] && silhouette[0].length >= 3) {
    for (const w of wrappers) w.updateMatrixWorld(true);
    logoMesh.updateMatrixWorld(true);
    const logoInv = new THREE.Matrix4().copy(logoMesh.matrixWorld).invert();

    // Rose-home poses — captured before pulse or domino state runs, so
    // each transform is the petal's calm resting pose inside its
    // rosette. Expressed in logoMesh-local coords (ghosts are added to
    // logoMesh so that's the frame that applies to them).
    const petalData = [];
    for (const w of wrappers) {
      for (const flower of w.userData.cascadeLayers) {
        for (const petal of flower.userData.petals) {
          petal.updateMatrixWorld(true);
          const local = new THREE.Matrix4().multiplyMatrices(logoInv, petal.matrixWorld);
          const pos  = new THREE.Vector3();
          const quat = new THREE.Quaternion();
          const scl  = new THREE.Vector3();
          local.decompose(pos, quat, scl);
          petalData.push({
            geometry:  petal.geometry,
            material:  petal.material,
            rosePos:   pos,
            roseQuat:  quat,
            roseScale: scl.x,
          });
        }
      }
    }

    // Hex honeycomb tiling inside the inset silhouette. Each slot gets a
    // flat-top hexagonal mesh; petals (ghosts) fly out of those hex
    // centers during the transit to morph into the flowers.
    //
    // Inset defaults to the silhouette-mask inset (= the gate frame's
    // inner edge) so hex centers can sit right at the archway boundary
    // and the wall fills the entire interior. The stencil mask trims any
    // hex that pokes past the inner edge, so the visible footprint lands
    // flush with the gate's inner lip instead of inside a smaller pocket.
    const wallInset = brickCfg.inset ?? cfg0.maskInset ?? 1.6;
    const inner     = insetPolygon(silhouette[0], wallInset);
    const hexR      = brickCfg.hexRadius ?? starSize * 0.25;
    const hexDepth  = brickCfg.hexDepth  ?? starSize * 0.12;
    const sizeVar   = brickCfg.sizeJitter ?? 0.20;
    const slots     = buildHexSlots(inner, hexR);

    morphGroup = new THREE.Group();
    morphGroup.name = 'overlay-morph';
    morphGroup.visible = false;
    logoMesh.add(morphGroup);
    flowerRoots.push(morphGroup);

    const wallZ = maxZ + (cfg0.zOffset ?? 0.22);

    // Shared hex geometry (flat-top). CylinderGeometry with 6 radial
    // segments = hex prism; rotate its axis to Z then rotate 30° so a
    // flat edge is on top. Depth is modest so hexes read as solid tiles
    // rather than tall prisms.
    const hexGeo = new THREE.CylinderGeometry(hexR, hexR, hexDepth, 6, 1);
    hexGeo.rotateX(Math.PI / 2);
    hexGeo.rotateZ(Math.PI / 6);

    // Dedicated group for the hex wall. Hexes keep a STATIC size and
    // instead do a domino-flip around their local +X axis (wave sweeps
    // left-to-right across the wall). Opacity fade handles the
    // brick↔rose hand-off so tiles don't pop.
    const hexWall = new THREE.Group();
    hexWall.name = 'brick-hex-wall';
    hexWall.visible = false;
    logoMesh.add(hexWall);
    hexRoots.push(hexWall);

    // Warm amber-red hue for the wall — distinct from the rosettes so
    // the brick↔rose hand-off reads as a colour shift too.
    const hexColor = new THREE.Color(brickCfg.color ?? '#D14A22');
    const hexMeshes = [];
    for (const slot of slots) {
      const hMat = starMats[0].clone();
      hMat.color = hexColor.clone();
      hMat.emissive = hexColor.clone();
      hMat.emissiveIntensity = 0;
      hMat.transparent = true;         // needed for brickW-driven opacity
      const mesh = new THREE.Mesh(hexGeo, hMat);
      mesh.position.set(slot.x, slot.y, wallZ);
      hexWall.add(mesh);
      hexMeshes.push(mesh);
    }

    // Assign each hex a domino step index by spatial order — sort by X
    // (then Y as tiebreaker) so the wave reads as a clean left-to-right
    // sweep across the wall. flipStep is read at runtime to stagger the
    // flip trigger times.
    const sortedHexes = [...hexMeshes].sort((a, b) =>
      (a.position.x - b.position.x) || (a.position.y - b.position.y));
    for (let i = 0; i < sortedHexes.length; i++) {
      sortedHexes[i].userData.flipStep = i;
    }

    // Per-hex drift vector for the "move out" transit animation. The
    // base direction is radial from the model center so hexes scatter
    // outward; a small angular jitter + distance variance breaks strict
    // radial symmetry so it reads as organic scatter rather than an
    // explosion.
    const driftDistBase = brickCfg.hexDriftDist   ?? hexR * 4.0;
    const driftJitter   = brickCfg.hexDriftJitter ?? 0.5; // radians
    for (const hex of hexMeshes) {
      const sx = hex.position.x - cx;
      const sy = hex.position.y - cy;
      const len = Math.hypot(sx, sy) || 1;
      const baseX = sx / len, baseY = sy / len;
      const ja = (Math.random() - 0.5) * driftJitter * 2;
      const ca = Math.cos(ja), sa = Math.sin(ja);
      hex.userData.driftDirX = baseX * ca - baseY * sa;
      hex.userData.driftDirY = baseX * sa + baseY * ca;
      hex.userData.driftDist = driftDistBase * (0.7 + Math.random() * 0.6);
      hex.userData.homeX = hex.position.x;
      hex.userData.homeY = hex.position.y;
    }

    // Pair each rosette petal with its nearest unused hex slot — the
    // slot becomes that petal's emergence point during transit. Unused
    // slots are fine; they just keep their hex and no petal flies out.
    const slotUsed = new Array(slots.length).fill(false);
    const ghostSlot = new Array(petalData.length).fill(-1);
    for (let i = 0; i < petalData.length; i++) {
      const px = petalData[i].rosePos.x, py = petalData[i].rosePos.y;
      let bestS = -1, bestD = Infinity;
      for (let s = 0; s < slots.length; s++) {
        if (slotUsed[s]) continue;
        const dx = slots[s].x - px, dy = slots[s].y - py;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bestS = s; }
      }
      if (bestS >= 0) { ghostSlot[i] = bestS; slotUsed[bestS] = true; }
    }

    // Flat petal list so each ghost can read live rose pose at runtime.
    const sourcePetals = [];
    for (const w of wrappers) {
      for (const flower of w.userData.cascadeLayers) {
        for (const petal of flower.userData.petals) sourcePetals.push(petal);
      }
    }

    // One ghost per rosette petal. Ghosts are invisible in brick mode
    // (brickBaseScale = 0); during transit they grow from scale 0 at
    // their assigned hex center and travel to their live rose pose.
    // Petals without a hex slot stay at their rose position and fade.
    for (let i = 0; i < petalData.length; i++) {
      const pd      = petalData[i];
      const slotIdx = ghostSlot[i];
      const hasSlot = slotIdx >= 0;

      const mesh = new THREE.Mesh(pd.geometry, pd.material);
      morphGroup.add(mesh);

      const brickPos = hasSlot
        ? new THREE.Vector3(slots[slotIdx].x, slots[slotIdx].y, wallZ)
        : pd.rosePos.clone();

      ghosts.push({
        mesh,
        brickPos,
        brickQuat:      new THREE.Quaternion(),
        brickBaseScale: 0,
        sourcePetal:    sourcePetals[i],
        rosePos:        pd.rosePos,
        roseQuat:       pd.roseQuat,
        roseScale:      pd.roseScale,
        // Perpendicular-to-path bob for an organic curved transit.
        // Magnitude is a fraction of path length so short transits
        // bob less; sign randomises which side of the straight line
        // each petal curves around.
        bobMagFrac:     0.18 * (0.5 + Math.random() * 0.8),
        bobSign:        Math.random() < 0.5 ? -1 : 1,
      });
    }

    // Stash the hex wall on the closure so updateOverlay can drive it.
    // (Declared here so the update function can see it via `hexMeshesRef`
    // captured above the function.)
    brickHexWall    = hexWall;
    brickHexMeshes  = hexMeshes;
  }

  // Large 3D hexagon — a neutral canvas for future "looks". Held in its
  // own wrapper outside the fan-pulse loop so future animation hooks can
  // live below without fighting the fan's scale/spin.
  let hexWrapper = null;
  const hcfg0 = cfg0.hexagon;
  if (hcfg0 && hcfg0.enabled !== false) {
    const radius  = starSize * (hcfg0.radiusFactor ?? 1.15);
    const depth   = hcfg0.depth ?? 2.0;
    const flatTop = hcfg0.flatTop !== false;
    const halfCut = hcfg0.halfCut === true;

    let hexGeo;
    if (halfCut) {
      // Clip the flat hex polygon against x >= 0 (Sutherland-Hodgman)
      // and extrude along z. Matches the rosette's halfCut convention:
      // the cut edge lies on the -x side, rays/faces point toward +x.
      // Re-center on z so the prism straddles the wrapper plane like
      // the full-hex (CylinderGeometry) path does.
      const angleOffset = flatTop ? 0 : Math.PI / 6;
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const theta = angleOffset + i * Math.PI / 3;
        pts.push({ x: Math.cos(theta) * radius, y: Math.sin(theta) * radius });
      }
      const clipped = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const aIn = a.x >= -1e-9;
        const bIn = b.x >= -1e-9;
        if (aIn) clipped.push(a);
        if (aIn !== bIn) {
          const t = a.x / (a.x - b.x);
          clipped.push({ x: 0, y: a.y + (b.y - a.y) * t });
        }
      }
      const shape = new THREE.Shape();
      clipped.forEach((p, i) => { i === 0 ? shape.moveTo(p.x, p.y) : shape.lineTo(p.x, p.y); });
      shape.closePath();
      hexGeo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
      hexGeo.translate(0, 0, -depth / 2);
    } else {
      // CylinderGeometry with 6 radial segments = hexagonal prism.
      // Rotate X by π/2 so the hex face lies on the XY plane (facing
      // camera); Z rotation picks flat-top vs pointy-top orientation.
      hexGeo = new THREE.CylinderGeometry(radius, radius, depth, 6, 1);
      hexGeo.rotateX(Math.PI / 2);
      if (flatTop) hexGeo.rotateZ(Math.PI / 6);
    }

    const hexMat = new THREE.MeshStandardMaterial({
      color: COLORS.islamicPanel.gold,
      metalness: 0.55,
      roughness: 0.45,
      transparent: true,
      opacity: hcfg0.opacity ?? 0.35,
    });

    const hexMesh = new THREE.Mesh(hexGeo, hexMat);
    hexWrapper = new THREE.Group();
    hexWrapper.name = 'overlay-hexagon';
    hexWrapper.add(hexMesh);

    // Park the hex directly behind the preview star — same X/Y, pushed
    // back in z so the star reads in front. With halfCut enabled on
    // both, cut edges coincide at local x=0, so the hex acts as a
    // half-disc backdrop. `snapToEdge` path matches the fan: anchor to
    // the outline pivot and rotate to the edge-aligned base rotation so
    // the hex stays fixed behind the fan when snapped. `hexagon.zOffset`
    // layers on top of the computed depth pushback.
    const pushback = depth;  // hex front face lands depth/2 behind starZ
    if (cfg0.snapToEdge !== false) {
      hexWrapper.position.set(
        leftPivot.x,
        leftPivot.y,
        maxZ + (cfg0.zOffset ?? 0.22) - pushback + (hcfg0.zOffset ?? 0),
      );
      hexWrapper.rotation.z = leftRot;
    } else {
      const previewX = cx + maxR * (cfg0.previewXFactor ?? 1.2);
      const starX    = previewX + (cfg0.fanRadius ?? maxR * 0.45);
      hexWrapper.position.set(
        starX,
        cy,
        maxZ + (cfg0.zOffset ?? 0.22) - pushback + (hcfg0.zOffset ?? 0),
      );
    }
    logoMesh.add(hexWrapper);
    hexRoots.push(hexWrapper);
  }

  // Scratch objects reused every frame by the morph pass — avoids an
  // allocation per ghost per frame.
  const _qBase    = new THREE.Quaternion();
  const _localMat = new THREE.Matrix4();
  const _logoInv  = new THREE.Matrix4();
  const _rPos     = new THREE.Vector3();
  const _rQuat    = new THREE.Quaternion();
  const _rScale   = new THREE.Vector3();

  function updateOverlay(t) {
    const cfg = ANIM.overlay;
    if (!cfg || cfg.enabled === false) {
      for (const w of wrappers) w.visible = false;
      if (hexWrapper) hexWrapper.visible = false;
      if (morphGroup) morphGroup.visible = false;
      return;
    }
    const twoPi = Math.PI * 2;

    // Brick-wall morph alpha (0 = brick, 1 = rosettes). Phase durations
    // come from ANIM.timings.overlay as absolute seconds. The morph runs
    // brickHold → brickToRose → roseHold → roseToBrick.
    //
    // Time source depends on ANIM.timings.playAll:
    //   - false: free-running cycle on `t`, looping every morphTotal sec
    //            (legacy behaviour; defaults match the old 40s split).
    //   - true:  driven by cascadeState.playAllT — the elapsed time inside
    //            the cascade's all-at-center window. Outside that window
    //            (playAllT < 0) the entire overlay is hidden so nothing
    //            renders while patterns are exiting / returning.
    const tov = (ANIM.timings && ANIM.timings.overlay) || {};
    // Solo 'flowers' mode skips the brick hold so the rose petals loop
    // back-to-back: fade in → hold (with domino) → fade out → repeat. No
    // long invisible gap waiting for hidden bricks to "hold".
    const tBrickHold   = (ANIM.viewMode === 'flowers') ? 0 : (tov.brickHold ?? 15);
    const tBrickToRose = tov.brickToRose ?? 5;
    // Solo 'hex' mode skips the rose hold so the brick wall is the focus.
    // The cycle becomes brick hold → fade out → fade in → loop, with only
    // a single-frame invisibility at the morph midpoint.
    const tRoseHold    = (ANIM.viewMode === 'hex') ? 0 : (tov.roseHold ?? 15);
    const tRoseToBrick = tov.roseToBrick ?? 5;
    const morphTotal   = tBrickHold + tBrickToRose + tRoseHold + tRoseToBrick;

    // playAll syncs only in 'all' viewMode — solo modes free-run with
    // synthesized timings instead of reading cascadeState.playAllT (which
    // is pinned at -1 in solo modes by patterns-layer.js).
    const playAllOn = !!(ANIM.timings && ANIM.timings.playAll)
                    && (!ANIM.viewMode || ANIM.viewMode === 'all');
    // Solo modes 'hex' and 'flowers' synthesize a playAll-style cycle so
    // the brick-wall entry/exit waves animate the same way they do in
    // 'all' — the user sees the in/out transitions, just without the
    // cascade syncing them to the pattern's all-at-center window.
    const soloMode = ANIM.viewMode === 'hex' || ANIM.viewMode === 'flowers';
    const wavesOn  = playAllOn || soloMode;
    let cyc;
    if (playAllOn) {
      const pT = cascadeState ? cascadeState.playAllT : -1;
      if (pT < 0) {
        for (const w of wrappers) w.visible = false;
        if (hexWrapper)   hexWrapper.visible   = false;
        if (morphGroup)   morphGroup.visible   = false;
        if (brickHexWall) brickHexWall.visible = false;
        return;
      }
      cyc = pT;
    } else {
      cyc = morphTotal > 0
        ? ((t % morphTotal) + morphTotal) % morphTotal
        : 0;
    }

    let morphAlpha = 1;
    if (morphGroup && morphTotal > 0) {
      const t1 = tBrickHold;
      const t2 = t1 + tBrickToRose;
      const t3 = t2 + tRoseHold;
      morphAlpha = smoothstep01(cyc, t1, t2)
                 - smoothstep01(cyc, t3, t3 + tRoseToBrick);
    }
    // Mode 'hex' is brick-only: clamp morphAlpha so the bricks never fade
    // into the rose state. brickW stays 1, inMorph stays true, and the
    // per-hex position/rotation update keeps running every frame so the
    // entry/exit waves cycle cleanly.
    if (ANIM.viewMode === 'hex') morphAlpha = 0;
    let inMorph = !!morphGroup && morphAlpha < 0.999;
    // Mode 'hex' override: force inMorph true whenever the hex wall exists
    // so the per-hex position update keeps writing every frame. Without
    // this, a brief inMorph=false at the morph boundary would freeze the
    // hexes at whatever drift position they were last in.
    if (ANIM.viewMode === 'hex' && brickHexWall) inMorph = true;

    // Per-hex stagger params — entry wave at window open, exit wave at
    // window close. Each hex's start time is keyed off `flipStep` so the
    // wave reads as a coherent left→right sweep both directions. Read
    // here so the hex loop below can use them. Free-running mode skips
    // all of this (envelope stays at 1, drift stays at 0).
    const hexEntryDelay   = tov.hexEntryDelay   ?? 1.5;
    const hexEntryStagger = tov.hexEntryStagger ?? 3.0;
    const hexEntryGlide   = tov.hexEntryGlide   ?? 4.0;
    const hexExitStagger  = tov.hexExitStagger  ?? 2.5;
    const hexExitGlide    = tov.hexExitGlide    ?? 3.5;

    // ---- Flower anim always runs ----
    // Writes flower.scale + petal.rotation.x so petal.matrixWorld
    // reflects the live animation whether or not the rosettes are
    // currently being rendered. Ghosts read this live pose during
    // transit, which keeps the brick↔rose hand-off seamless — the
    // ghost at alpha≈1 sits exactly where the rosette will draw when
    // it becomes visible.
    const mn = cfg.scaleMin;
    const mx = cfg.scaleMax;
    const dominoCfg    = cfg.petalDomino || {};
    const dominoOn     = dominoCfg.enabled !== false;
    const trigger      = dominoCfg.triggerInterval ?? 0.08;
    const fall         = dominoCfg.fallDuration    ?? 0.9;
    const pauseBetween = dominoCfg.pause           ?? 1.5;
    const pbCfg   = cfg.petalBrightness || {};
    const pbOn    = pbCfg.enabled !== false;
    const pbBrMin = pbCfg.brightnessMin ?? 0.45;
    const pbBrMax = pbCfg.brightnessMax ?? 1.35;
    const pbEmMin = pbCfg.emissiveMin   ?? 0.0;
    const pbEmMax = pbCfg.emissiveMax   ?? 0.8;
    const pbPer   = Math.max(pbCfg.pulsePeriod ?? 3.8, 1e-3);
    const pbDelay = pbCfg.startDelay   ?? 0;
    const pbRamp  = Math.max(pbCfg.rampDuration ?? 0, 1e-3);
    const pbEnv   = (() => {
      const x = (t - pbDelay) / pbRamp;
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      return x * x * (3 - 2 * x);
    })();

    for (const w of wrappers) {
      w.visible = !inMorph;
      w.rotation.z = w.userData.baseRotation +
                     w.userData.spinDir * t * cfg.spinSpeed;
      const flowers = w.userData.cascadeLayers;
      for (let fi = 0; fi < flowers.length; fi++) {
        const flower = flowers[fi];
        const pp = Math.max(flower.userData.pulsePeriod, 1e-3);
        const phase = (t / pp) * twoPi + flower.userData.phaseOffset;
        const k = 0.5 + 0.5 * Math.sin(phase);
        flower.scale.setScalar(mn + (mx - mn) * k);

        const petals = flower.userData.petals;
        const N = petals ? petals.length : 0;
        if (!dominoOn || N === 0) {
          for (let q = 0; q < N; q++) petals[q].rotation.x = 0;
        } else {
          const rawElapsed = t - flower.userData.dominoStart;
          if (rawElapsed < 0) {
            for (let q = 0; q < N; q++) petals[q].rotation.x = 0;
          } else {
            const maxStep   = flower.userData.dominoMaxStep;
            const cycleLen  = maxStep * trigger + fall;
            const fullCycle = cycleLen + pauseBetween;
            const elapsed   = rawElapsed % fullCycle;
            const steps     = flower.userData.dominoSteps;
            for (let p = 0; p < N; p++) {
              const triggerTime = steps[p] * trigger;
              const ph = (elapsed - triggerTime) / fall;
              let angle = 0;
              if (ph > 0 && ph < 1) {
                const eased = 0.5 - 0.5 * Math.cos(ph * Math.PI);
                angle = eased * twoPi;
              }
              petals[p].rotation.x = angle;
            }
          }
        }

        // Shimmer runs in both rose and brick modes — non-filler ghosts
        // share materials with their source petals, so mutating petal
        // colours here propagates to the wall as a bonus. Rose/brick
        // flow is identical: lerp-to-pulse via pbEnv so the shimmer
        // fades in after startDelay regardless of current mode.
        if (pbOn) {
          for (let q = 0; q < N; q++) {
            const petal = petals[q];
            const sf      = petal.userData.petalSpeedFactor || 1;
            const pPhase  = (t / pbPer) * twoPi * sf + petal.userData.petalPhase;
            const pK      = 0.5 + 0.5 * Math.sin(pPhase);
            const brPulse = pbBrMin + (pbBrMax - pbBrMin) * pK;
            const emPulse = pbEmMin + (pbEmMax - pbEmMin) * pK;
            const br = 1 + (brPulse - 1) * pbEnv;
            const em = emPulse * pbEnv;
            petal.material.color.copy(petal.userData.petalBaseColor).multiplyScalar(br);
            petal.material.emissiveIntensity = em;
          }
        }
      }
    }

    if (morphGroup)   morphGroup.visible   = inMorph;
    if (brickHexWall) brickHexWall.visible = inMorph;

    if (inMorph) {
      // Force world-matrix updates on hidden wrappers so the ghost can
      // read live rose pose — three.js skips matrix update on invisible
      // objects by default, which would leave ghosts reading stale pose.
      for (const w of wrappers) w.updateMatrixWorld(true);
      logoMesh.updateMatrixWorld(true);
      _logoInv.copy(logoMesh.matrixWorld).invert();

      const ta     = morphAlpha;
      const e      = 0.5 - 0.5 * Math.cos(ta * Math.PI);
      const brickW = 1 - e;            // 1 at brick hold, 0 at rose hold

      // Hex wall: STATIC size. Tiles do a domino flip around their
      // local +X axis, with trigger times staggered by flipStep so a
      // left-to-right wave rolls across the wall. brickW drives the
      // material opacity so hexes fade (not shrink) across transits.
      const hexTrigger = brickCfg.hexDominoTrigger ?? 0.18;
      const hexFall    = brickCfg.hexDominoFall    ?? 2.2;
      const hexPause   = brickCfg.hexDominoPause   ?? 2.5;
      const hexCount   = brickHexMeshes.length;
      const hexMaxStep = Math.max(0, hexCount - 1);
      const hexCycleLen = hexMaxStep * hexTrigger + hexFall;
      const hexFullCyc  = hexCycleLen + hexPause;
      const hexElapsed  = hexFullCyc > 0
        ? ((t % hexFullCyc) + hexFullCyc) % hexFullCyc
        : 0;
      // Exit anchor — last hex (stepFrac=1) finishes at cyc = morphTotal.
      // Each hex's exit start = exitTailEnd - hexExitGlide, offset back by
      // (1 - stepFrac) * hexExitStagger so flipStep=0 leaves first.
      const exitTailEnd = morphTotal - hexExitGlide;
      const stepDenom   = Math.max(1, brickHexMeshes.length - 1);

      for (const hex of brickHexMeshes) {
        const step = hex.userData.flipStep;
        const ph   = (hexElapsed - step * hexTrigger) / hexFall;
        let angle = 0;
        if (ph > 0 && ph < 1) {
          const eased = 0.5 - 0.5 * Math.cos(ph * Math.PI);
          angle = eased * twoPi;
        }
        hex.rotation.x = angle;

        // Per-hex window-edge envelope. `edgeDrift` (0..1) pushes the hex
        // toward its drifted-out position; `edgeFade` (0..1) is the on-
        // screen alpha multiplier. In free-running mode both stay at the
        // identity (drift 0, fade 1) so only the natural brick↔rose drift
        // (driven by `e`) takes effect.
        let edgeDrift = 0;
        let edgeFade  = 1;
        if (wavesOn) {
          const stepFrac = step / stepDenom;

          // Entry wave — first hex (stepFrac=0) starts gliding at
          // cyc=hexEntryDelay, last hex starts at cyc=hexEntryDelay+
          // hexEntryStagger. Pre-trigger frames fall through the smoothstep
          // (u clamped to 0 → eased=0 → edgeDrift=1, edgeFade=0), so each
          // hex stays drifted + invisible until its turn.
          const entryStart = hexEntryDelay + hexEntryStagger * stepFrac;
          const entryEnd   = entryStart + hexEntryGlide;
          if (cyc < entryEnd) {
            const u = Math.max(0, (cyc - entryStart) / Math.max(hexEntryGlide, 1e-3));
            const eased = u * u * (3 - 2 * u);     // smoothstep
            edgeDrift = 1 - eased;                 // 1 at trigger → 0 settled
            edgeFade  = eased;                     // 0 → 1 as it settles
          }

          // Exit wave — symmetric, anchored to the window close. flipStep=0
          // exits first, last hex exits last (matches entry order so each
          // hex's "life" inside the window has a coherent in/out direction).
          const exitStart = exitTailEnd - hexExitStagger * (1 - stepFrac);
          if (cyc > exitStart) {
            const u = Math.min(1, (cyc - exitStart) / Math.max(hexExitGlide, 1e-3));
            const eased = u * u * (3 - 2 * u);
            if (eased > edgeDrift) edgeDrift = eased;       // drift back out
            if (1 - eased < edgeFade) edgeFade = 1 - eased; // fade out
          }
        }

        // Drift: max(natural-morph drift, window-edge drift). They never
        // overlap meaningfully — natural drift is 0 in the brick-hold
        // window where the edge waves live.
        const driftFactor = e > edgeDrift ? e : edgeDrift;
        hex.position.x = hex.userData.homeX + hex.userData.driftDirX * hex.userData.driftDist * driftFactor;
        hex.position.y = hex.userData.homeY + hex.userData.driftDirY * hex.userData.driftDist * driftFactor;
        hex.material.opacity = brickW * edgeFade;
      }

      // Ghosts: grow out of their hex slot (brickBaseScale=0) and
      // travel to their live rose pose. Live pose is read from the
      // rosette's petal.matrixWorld so the hand-off at alpha≈1 is
      // seamless — ghost and rosette render the same transform.
      for (const g of ghosts) {
        let rScaleX;
        if (g.sourcePetal) {
          _localMat.multiplyMatrices(_logoInv, g.sourcePetal.matrixWorld);
          _localMat.decompose(_rPos, _rQuat, _rScale);
          rScaleX = _rScale.x;
        } else {
          _rPos.copy(g.rosePos);
          _rQuat.copy(g.roseQuat);
          rScaleX = g.roseScale;
        }

        g.mesh.position.lerpVectors(g.brickPos, _rPos, e);
        // Perpendicular bob — peaks mid-transit, zero at both ends — so
        // each petal curves around a unique arc instead of tracking a
        // straight line. Gives the flowers their "organic" drift-in.
        const pdx = _rPos.x - g.brickPos.x;
        const pdy = _rPos.y - g.brickPos.y;
        const pLen = Math.hypot(pdx, pdy);
        if (pLen > 1e-4) {
          const bob = Math.sin(e * Math.PI) * pLen * g.bobMagFrac * g.bobSign;
          g.mesh.position.x += (-pdy / pLen) * bob;
          g.mesh.position.y += ( pdx / pLen) * bob;
        }
        g.mesh.scale.setScalar(g.brickBaseScale + (rScaleX - g.brickBaseScale) * e);
        _qBase.copy(g.brickQuat).slerp(_rQuat, e);
        g.mesh.quaternion.copy(_qBase);
      }
    }

    if (hexWrapper) {
      if (inMorph) {
        hexWrapper.visible = false;
      } else {
        hexWrapper.visible = cfg.hexagon ? cfg.hexagon.enabled !== false : true;
      }
    }
  }

  return { updateOverlay, patternsToRefresh: [],
           flowerRoots, hexRoots, sharedMask };
}
