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
import { ANIM, COLORS } from '../../config.js';
import { insetPolygon } from '../../util/polygon.js';

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

// onBeforeCompile patch shared by every instanced hex-wall material
// (front prisms + back discs). Per-instance opacity isn't a native
// three.js feature, so the per-tile fade (entry/exit edge fade, back-disc
// reveal) rides a custom instanced attribute `aHexAlpha` multiplied into
// diffuseColor.a. Defined once at module scope so every wall material
// shares one compiled program per material class.
function patchInstancedHexAlpha(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>',
      '#include <common>\nattribute float aHexAlpha;\nvarying float vHexAlpha;')
    .replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvHexAlpha = aHexAlpha;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>',
      '#include <common>\nvarying float vHexAlpha;')
    .replace('vec4 diffuseColor = vec4( diffuse, opacity );',
      'vec4 diffuseColor = vec4( diffuse, opacity * vHexAlpha );');
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
  let brickHexWall      = null;        // outer parent group toggled by main.js
  let brickHexCanonical = null;        // instanced wall record for canonical
  let brickHexMorph     = null;        // hex-mode size/shape-morph wall record
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
    const hexDepth  = brickCfg.hexDepth  ?? starSize * 0.12;
    // Per-hex randomization knobs. Speed + step are scattered so the
    // wave reads as ragged bursts (mixed flip durations, jittered fire
    // order). Size is intentionally NOT scattered — uniform per-wall
    // size is what lets the honeycomb tessellate cleanly. The "breathing"
    // block below animates the whole wall's size in lockstep instead.
    const speedJitter   = brickCfg.flipSpeedJitter ?? 0.55;   // ±fraction
    const stepJitterRaw = brickCfg.flipStepJitter  ?? 18;     // ± steps

    // Two walls are built:
    //   * CANONICAL wall at `largeRadiusFactor` — used by the brick↔rose
    //     ghost morph in 'all'/'flowers' modes (ghost slot positions
    //     depend on it, so it stays exactly as it always was).
    //   * MORPH wall at `gridRadiusFactor` — the only wall solo hex mode
    //     renders. One fixed grid whose tiles size-morph and shape-morph
    //     in place; per-tile radius is clamped to the grid pitch so
    //     tiles can never overlap (replaces the old 8-wall crossfade
    //     pool, which drew two different-size honeycombs at once).
    const largeFactor = brickCfg.largeRadiusFactor ?? 0.25;
    const largeHexR = brickCfg.hexRadius ?? starSize * largeFactor;
    const gridHexR  = starSize * (brickCfg.gridRadiusFactor ?? 0.16);

    morphGroup = new THREE.Group();
    morphGroup.name = 'overlay-morph';
    morphGroup.visible = false;
    logoMesh.add(morphGroup);
    flowerRoots.push(morphGroup);

    const wallZ = maxZ + (cfg0.zOffset ?? 0.22);

    // Outer parent group — main.js toggles this group's visibility for
    // mode gating; the per-size sub-groups live as children, each with
    // its own `visible` flag driven by the size-switch state machine.
    const hexWall = new THREE.Group();
    hexWall.name = 'brick-hex-wall';
    hexWall.visible = false;
    logoMesh.add(hexWall);
    hexRoots.push(hexWall);

    // Warm amber-red hue for the wall — distinct from the rosettes so
    // the brick↔rose hand-off reads as a colour shift too.
    const hexColor = new THREE.Color(brickCfg.color ?? '#D14A22');

    // Back-face alt colour — a random subset of tiles get a flat hex
    // disc on their back face in a contrasting hue. Reveals during each
    // tile's domino flip when the back rotates camera-facing.
    const backCfg      = brickCfg.backFace || {};
    const backEnabled  = backCfg.enabled !== false;
    const altZOff      = backCfg.zOffset ?? 0.02;

    // Per-tile flipStep — sorted along an Archimedean spiral so the
    // domino wave starts at the outer ring of tiles, winds around the
    // logo, and converges inward toward the fade center. For each
    // tile we compute an "alpha along the spiral arm" by finding the
    // arm's expected angle at the tile's radius (alphaTarget) and
    // wrapping the tile's actual atan2 angle to the nearest revolution
    // of that target. Sorting by that scalar gives a clean spiral.
    // Per-hex jitter is still applied afterward so the wave-front
    // reads ragged rather than mathematically perfect. Shared by the
    // canonical wall and the morph wall.
    function computeSpiralFlipSteps(homeX, homeY, n) {
      const spiralTurns = Math.max(0.1, brickCfg.spiralTurns ?? 2);
      const _twoPi = Math.PI * 2;
      const spiralRange = spiralTurns * _twoPi;
      let _wallMaxR = 0;
      for (let i = 0; i < n; i++) {
        const r = Math.hypot(homeX[i] - fadeCX, homeY[i] - fadeCY);
        if (r > _wallMaxR) _wallMaxR = r;
      }
      if (_wallMaxR < 1e-6) _wallMaxR = 1;
      const spiralPhase = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const dx = homeX[i] - fadeCX;
        const dy = homeY[i] - fadeCY;
        const r = Math.hypot(dx, dy);
        const uR = r / _wallMaxR;            // 0 at center, 1 at outer
        // Outermost tile → alphaTarget = 0 (fires first); center → spiralRange.
        const alphaTarget = spiralRange * (1 - uR);
        let alpha = Math.atan2(dy, dx);
        // Bring alpha into [alphaTarget - π, alphaTarget + π] so tiles
        // at the same angle on different rings get sequential alphas
        // along the spiral arm rather than colliding modulo 2π.
        alpha += _twoPi * Math.round((alphaTarget - alpha) / _twoPi);
        spiralPhase[i] = alpha;
      }
      const order = Array.from({ length: n }, (_, i) => i)
        .sort((a, b) => spiralPhase[a] - spiralPhase[b]);
      const stepJitter = Math.max(0, stepJitterRaw);
      const maxStepIdx = Math.max(0, n - 1);
      const flipStep = new Float32Array(n);
      for (let i = 0; i < order.length; i++) {
        const jittered = i + (Math.random() - 0.5) * 2 * stepJitter;
        flipStep[order[i]] = Math.max(0, Math.min(maxStepIdx, jittered));
      }
      return flipStep;
    }

    // Builder: produce one self-contained hex wall set as TWO InstancedMeshes
    // (front prisms + back discs) instead of hundreds of individual meshes.
    // Per-tile state that used to live on mesh.userData (flip step/speed,
    // evolution seeds, drift vectors, home positions) moves into flat arrays
    // on the returned record; per-tile visual state that used to be
    // per-material (colour wiggle, opacity fade) rides instanceColor + the
    // aHexAlpha instanced attribute. Wall-wide state (drift colour, brickW
    // opacity) stays on the two shared materials.
    function buildOneHexWall(hexR_) {
      const slots_ = buildHexSlots(inner, hexR_);
      const n = slots_.length;

      // Flat-top hex prism — depth scales with radius so smaller hexes
      // stay proportionally thin (otherwise the small wall reads as
      // chunky stubby cylinders rather than tiles).
      const hexDepth_ = hexDepth * (hexR_ / largeHexR);
      const hexGeo_ = new THREE.CylinderGeometry(hexR_, hexR_, hexDepth_, 6, 1);
      hexGeo_.rotateX(Math.PI / 2);
      hexGeo_.rotateZ(Math.PI / 6);

      // Flat 2D hex outline matching the prism cap, used for the
      // unlit back-face disc that hides the lit cap.
      const altGeo_ = backEnabled
        ? (() => {
            const shape = new THREE.Shape();
            for (let i = 0; i < 6; i++) {
              const a = i * (Math.PI / 3);
              const x = Math.cos(a) * hexR_, y = Math.sin(a) * hexR_;
              if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
            }
            shape.closePath();
            return new THREE.ShapeGeometry(shape);
          })()
        : null;

      const wall_ = new THREE.Group();
      hexWall.add(wall_);

      // ONE shared front material for the whole wall — the clone carries
      // the stencil-mask state over from starMats[0]. emissiveIntensity
      // stays 0 (as it always was), so emissive never contributes.
      const hMat = starMats[0].clone();
      hMat.color = hexColor.clone();
      hMat.emissive = hexColor.clone();
      hMat.emissiveIntensity = 0;
      hMat.transparent = true;       // needed for brickW-driven opacity
      hMat.onBeforeCompile = patchInstancedHexAlpha;

      const alphaAttr = new THREE.InstancedBufferAttribute(
        new Float32Array(n).fill(1), 1);
      alphaAttr.setUsage(THREE.DynamicDrawUsage);
      hexGeo_.setAttribute('aHexAlpha', alphaAttr);

      const front = new THREE.InstancedMesh(hexGeo_, hMat, n);
      front.frustumCulled = false;   // instances spread past base bounds
      front.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      front.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(n * 3).fill(1), 3);
      front.instanceColor.setUsage(THREE.DynamicDrawUsage);
      // Object z carries wallZ so the transparent-pass depth sort sees the
      // same z each individual hex mesh used to have; instance translations
      // below are relative to it (z = 0).
      front.position.z = wallZ;
      wall_.add(front);

      // Back discs — every tile gets one (matching the front colour,
      // drift-tracked per-frame). MeshBasicMaterial with toneMapped:false
      // keeps the scene lights from washing the back toward white.
      let back = null, backAlphaAttr = null;
      const backOff = hexDepth_ * 0.5 + altZOff;
      if (backEnabled && altGeo_) {
        const backMatOpts = {
          color:       hexColor.clone(),
          transparent: true,
          opacity:     1.0,
          depthWrite:  false,
          toneMapped:  false,
          side:        THREE.DoubleSide,
        };
        if (maskClip) {
          backMatOpts.stencilWrite = true;
          backMatOpts.stencilRef   = 1;
          backMatOpts.stencilFunc  = THREE.EqualStencilFunc;
          backMatOpts.stencilFail  = THREE.KeepStencilOp;
          backMatOpts.stencilZFail = THREE.KeepStencilOp;
          backMatOpts.stencilZPass = THREE.KeepStencilOp;
        }
        const backMat = new THREE.MeshBasicMaterial(backMatOpts);
        backMat.onBeforeCompile = patchInstancedHexAlpha;
        backAlphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
        backAlphaAttr.setUsage(THREE.DynamicDrawUsage);
        altGeo_.setAttribute('aHexAlpha', backAlphaAttr);
        back = new THREE.InstancedMesh(altGeo_, backMat, n);
        back.frustumCulled = false;
        back.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        back.renderOrder = 7;
        back.position.z = wallZ;
        wall_.add(back);
      }

      // Per-tile data arrays. The Math.random() call ORDER inside this
      // loop matches the old per-mesh builder exactly (evoSeed, evoFactor,
      // flipSpeed per tile) so the downstream RNG stream is unmoved.
      //   evoSeed/evoFactor — effect-2 brightness wiggle phase + ±40% rate.
      //   flipSpeed         — per-tile flip-duration scatter (mixed speeds).
      const homeX     = new Float32Array(n);
      const homeY     = new Float32Array(n);
      const evoSeed   = new Float32Array(n);
      const evoFactor = new Float32Array(n);
      const flipSpeed = new Float32Array(n);
      const _m = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        homeX[i] = slots_[i].x;
        homeY[i] = slots_[i].y;
        evoSeed[i]   = Math.random() * Math.PI * 2;
        evoFactor[i] = 1 + (Math.random() - 0.5) * 0.8;
        flipSpeed[i] = 1 + (Math.random() - 0.5) * 2 * speedJitter;
        _m.makeTranslation(homeX[i], homeY[i], 0);
        front.setMatrixAt(i, _m);
        if (back) {
          _m.makeTranslation(homeX[i], homeY[i], -backOff);
          back.setMatrixAt(i, _m);
        }
      }

      // Per-tile flipStep — spiral firing order (see helper above).
      const flipStep = computeSpiralFlipSteps(homeX, homeY, n);

      // Per-tile drift vector for the brick→rose transit. Drift base
      // scales with this wall's hex radius so smaller hexes drift
      // proportionally less.
      const driftDistBase = brickCfg.hexDriftDist   ?? hexR_ * 4.0;
      const driftJitter   = brickCfg.hexDriftJitter ?? 0.5;
      const driftX    = new Float32Array(n);
      const driftY    = new Float32Array(n);
      const driftDist = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const sx = homeX[i] - cx;
        const sy = homeY[i] - cy;
        const len = Math.hypot(sx, sy) || 1;
        const baseX = sx / len, baseY = sy / len;
        const ja = (Math.random() - 0.5) * driftJitter * 2;
        const ca = Math.cos(ja), sa = Math.sin(ja);
        driftX[i] = baseX * ca - baseY * sa;
        driftY[i] = baseX * sa + baseY * ca;
        driftDist[i] = driftDistBase * (0.7 + Math.random() * 0.6);
      }

      return { wall: wall_, front, back, alphaAttr, backAlphaAttr, backOff,
               count: n, slots: slots_, homeX, homeY,
               evoSeed, evoFactor, flipSpeed, flipStep,
               driftX, driftY, driftDist };
    }

    // ---- Morph wall builder (solo hex mode) --------------------------
    // ONE wall, FOUR shape slots. Each tile owns one grid cell and is
    // rendered by exactly one of the four InstancedMeshes (hexagon /
    // triangle / square / circle-ish); the other three hold a zeroed
    // matrix at that index. Size evolution + shape morphing recompose
    // the matrices every visible frame. Non-hex shapes are built at
    // 0.86 × the grid radius (≈ the hex cell's inradius) so even two
    // adjacent tiles at full size can only kiss, never overlap.
    function buildMorphWall(hexR_) {
      const slots_ = buildHexSlots(inner, hexR_);
      const n = slots_.length;
      const hexDepth_ = hexDepth * (hexR_ / largeHexR);
      const altR = hexR_ * 0.86;
      const shapeDefs = [
        { sides: 6,  radius: hexR_, rz: Math.PI / 6 },  // 0 — hexagon
        { sides: 3,  radius: altR,  rz: Math.PI / 6 },  // 1 — triangle
        { sides: 4,  radius: altR,  rz: Math.PI / 4 },  // 2 — square
        { sides: 24, radius: altR,  rz: 0 },            // 3 — circle-ish
      ];

      const wall_ = new THREE.Group();
      wall_.visible = false;
      hexWall.add(wall_);

      // One shared front material + one shared back material across all
      // four shape meshes — wall-wide colour/opacity writes stay O(1).
      const fMat = starMats[0].clone();
      fMat.color = hexColor.clone();
      fMat.emissive = hexColor.clone();
      fMat.emissiveIntensity = 0;
      fMat.transparent = true;
      fMat.onBeforeCompile = patchInstancedHexAlpha;

      let bMat = null;
      const backOff = hexDepth_ * 0.5 + altZOff;
      if (backEnabled) {
        const backMatOpts = {
          color:       hexColor.clone(),
          transparent: true,
          opacity:     1.0,
          depthWrite:  false,
          toneMapped:  false,
          side:        THREE.DoubleSide,
        };
        if (maskClip) {
          backMatOpts.stencilWrite = true;
          backMatOpts.stencilRef   = 1;
          backMatOpts.stencilFunc  = THREE.EqualStencilFunc;
          backMatOpts.stencilFail  = THREE.KeepStencilOp;
          backMatOpts.stencilZFail = THREE.KeepStencilOp;
          backMatOpts.stencilZPass = THREE.KeepStencilOp;
        }
        bMat = new THREE.MeshBasicMaterial(backMatOpts);
        bMat.onBeforeCompile = patchInstancedHexAlpha;
      }

      const shapes = [];
      for (const def of shapeDefs) {
        const geo = new THREE.CylinderGeometry(
          def.radius, def.radius, hexDepth_, def.sides, 1);
        geo.rotateX(Math.PI / 2);
        if (def.rz) geo.rotateZ(def.rz);
        const alphaAttr = new THREE.InstancedBufferAttribute(
          new Float32Array(n).fill(1), 1);
        alphaAttr.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('aHexAlpha', alphaAttr);
        const front = new THREE.InstancedMesh(geo, fMat, n);
        front.frustumCulled = false;
        front.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        front.instanceMatrix.array.fill(0);   // nothing drawn until composed
        front.instanceColor = new THREE.InstancedBufferAttribute(
          new Float32Array(n * 3).fill(1), 3);
        front.instanceColor.setUsage(THREE.DynamicDrawUsage);
        front.position.z = wallZ;
        wall_.add(front);

        let back = null, backAlphaAttr = null;
        if (bMat) {
          const shp = new THREE.Shape();
          for (let k = 0; k < def.sides; k++) {
            const a = def.rz + (k / def.sides) * Math.PI * 2;
            const x = Math.cos(a) * def.radius, y = Math.sin(a) * def.radius;
            if (k === 0) shp.moveTo(x, y); else shp.lineTo(x, y);
          }
          shp.closePath();
          const bGeo = new THREE.ShapeGeometry(shp);
          backAlphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
          backAlphaAttr.setUsage(THREE.DynamicDrawUsage);
          bGeo.setAttribute('aHexAlpha', backAlphaAttr);
          back = new THREE.InstancedMesh(bGeo, bMat, n);
          back.frustumCulled = false;
          back.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          back.instanceMatrix.array.fill(0);
          back.renderOrder = 7;
          back.position.z = wallZ;
          wall_.add(back);
        }
        shapes.push({ front, back, alphaAttr, backAlphaAttr });
      }

      // Per-tile data. evoSeed/evoFactor/flipSpeed mirror the canonical
      // wall; sizeSeed/sizeFreq drive the per-tile size wander.
      const homeX     = new Float32Array(n);
      const homeY     = new Float32Array(n);
      const evoSeed   = new Float32Array(n);
      const evoFactor = new Float32Array(n);
      const flipSpeed = new Float32Array(n);
      const sizeSeed  = new Float32Array(n);
      const sizeFreq  = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        homeX[i] = slots_[i].x;
        homeY[i] = slots_[i].y;
        evoSeed[i]   = Math.random() * Math.PI * 2;
        evoFactor[i] = 1 + (Math.random() - 0.5) * 0.8;
        flipSpeed[i] = 1 + (Math.random() - 0.5) * 2 * speedJitter;
        sizeSeed[i]  = Math.random() * Math.PI * 2;
        sizeFreq[i]  = 0.6 + Math.random() * 0.8;
      }

      const flipStep = computeSpiralFlipSteps(homeX, homeY, n);

      // Per-tile drift vector for the entry/exit glide (same shape as
      // the canonical wall's).
      const driftDistBase = brickCfg.hexDriftDist   ?? hexR_ * 4.0;
      const driftJitter   = brickCfg.hexDriftJitter ?? 0.5;
      const driftX    = new Float32Array(n);
      const driftY    = new Float32Array(n);
      const driftDist = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const sx = homeX[i] - cx;
        const sy = homeY[i] - cy;
        const len = Math.hypot(sx, sy) || 1;
        const baseX = sx / len, baseY = sy / len;
        const ja = (Math.random() - 0.5) * driftJitter * 2;
        const ca = Math.cos(ja), sa = Math.sin(ja);
        driftX[i] = baseX * ca - baseY * sa;
        driftY[i] = baseX * sa + baseY * ca;
        driftDist[i] = driftDistBase * (0.7 + Math.random() * 0.6);
      }

      // Shape-morph state. shapeIdx = settled shape (0..3); while a
      // morph is in flight morphFrom/morphTo/morphStart describe the
      // shrink→regrow; lastShape tracks which mesh's buffer holds the
      // tile's live matrix so it can be zeroed on hand-off.
      const shapeIdx   = new Uint8Array(n);       // all start as hexagons
      const lastShape  = new Uint8Array(n);
      const morphFrom  = new Uint8Array(n);
      const morphTo    = new Uint8Array(n);
      const morphStart = new Float32Array(n).fill(-1);

      return { wall: wall_, shapes, frontMat: fMat, backMat: bMat, backOff,
               count: n, gridR: hexR_,
               trigger: brickCfg.gridDominoTrigger ?? 0.10,
               homeX, homeY, evoSeed, evoFactor, flipSpeed, flipStep,
               driftX, driftY, driftDist,
               sizeSeed, sizeFreq,
               shapeIdx, lastShape, morphFrom, morphTo, morphStart };
    }

    // Canonical wall (used by the brick↔rose ghost pairing in 'all'
    // mode). Built first at the legacy `largeRadiusFactor` so the
    // existing ghost slot positions are unchanged.
    const canonicalRes = buildOneHexWall(largeHexR);
    canonicalRes.wall.name = 'brick-hex-wall-canonical';

    // Morph wall — the only wall solo hex mode renders.
    const morphRes = buildMorphWall(gridHexR);
    morphRes.wall.name = 'brick-hex-wall-morph';

    // Legacy ghost pairing slots come from the canonical wall.
    const slots = canonicalRes.slots;

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

    // ---- Five-pattern flower layouts (solo 'flowers' mode) -----------
    // Per-ghost target parameters for the pattern cycle. All layouts
    // are centred on the particle vanishing point and sized in maxR
    // units; the stencil mask clips anything that pokes past the
    // silhouette. Poses are evaluated per-frame (some layouts spin), so
    // only compact parameters are stored here.
    {
      const fpB = cfg0.flowerPatterns || {};
      const M = ghosts.length;

      // Petal length per ghost (local +x extent of its geometry) —
      // used to centre petals on their layout anchor and to auto-fit
      // the hex-lattice mosaic tile size.
      for (let i = 0; i < M; i++) {
        const g = ghosts[i];
        const geo = g.mesh.geometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        g.petalLen = Math.max(geo.boundingBox.max.x, 1e-3);
        g.layoutZ  = wallZ + (i % 24) * 0.05;
      }

      // Shared shuffled index so consecutive petals (same rosette /
      // cascade layer) scatter across each layout instead of clumping.
      const perm = Array.from({ length: M }, (_, i) => i);
      for (let i = M - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
      }

      // Phyllotaxis swirl — golden-angle spiral, r ∝ √index.
      const phCfg = fpB.phyllotaxis || {};
      const phR   = maxR * (phCfg.radiusFactor ?? 0.70);
      const phSc  = phCfg.petalScale ?? 0.5;
      const golden = Math.PI * (3 - Math.sqrt(5));

      // Mandala — concentric rings, per-ring count ∝ radius.
      const maCfg   = fpB.mandala || {};
      const maRings = Math.max(2, Math.floor(maCfg.rings ?? 5));
      const maR0    = maxR * (maCfg.innerFactor ?? 0.16);
      const maR1    = maxR * (maCfg.outerFactor ?? 0.72);
      const maSc    = maCfg.petalScale ?? 0.42;
      const ringR = [];
      let ringWeightSum = 0;
      for (let k = 0; k < maRings; k++) {
        const r = maR0 + (maR1 - maR0) * (k / (maRings - 1));
        ringR.push(r);
        ringWeightSum += r;
      }
      const ringCount = ringR.map(r =>
        Math.max(1, Math.round(M * r / ringWeightSum)));
      {
        let sum = 0;
        for (const c of ringCount) sum += c;
        ringCount[maRings - 1] = Math.max(1, ringCount[maRings - 1] + (M - sum));
      }

      // Starburst — feathered fans radiating from the centre.
      const sbCfg    = fpB.starburst || {};
      const sbSpokes = Math.max(4, Math.floor(sbCfg.spokes ?? 18));
      const sbR0     = maxR * (sbCfg.innerFactor ?? 0.10);
      const sbR1     = maxR * (sbCfg.outerFactor ?? 0.78);
      const sbSc     = sbCfg.petalScale ?? 0.55;
      const sbPerSpoke = Math.ceil(M / sbSpokes);

      // Hex-lattice mosaic — flat petals on a honeycomb grid. Pitch is
      // auto-derived so the grid has ≈M slots inside the inset
      // silhouette (hex cell area = (3√3/2)·R²).
      const hxCfg = fpB.hexLattice || {};
      let area = 0;
      for (let i2 = 0, j2 = inner.length - 1; i2 < inner.length; j2 = i2++) {
        area += (inner[j2].x + inner[i2].x) * (inner[j2].y - inner[i2].y);
      }
      area = Math.abs(area) * 0.5;
      const latR = Math.max(Math.sqrt(area / (2.598 * Math.max(M, 1))), 0.3);
      const latSlots = buildHexSlots(inner, latR);
      const nLat = Math.max(1, latSlots.length);

      let maRing = 0, maIdx = 0;   // walkers for the mandala ring fill
      for (let q = 0; q < M; q++) {
        const g = ghosts[perm[q]];

        // Phyllotaxis: angle q·golden, radius ∝ √(q/M).
        g.ph = { th: q * golden, r: phR * Math.sqrt((q + 0.5) / M), sc: phSc };

        // Mandala: fill ring by ring; alternate rings point inward and
        // are offset by half a step.
        if (maIdx >= ringCount[maRing] && maRing < maRings - 1) {
          maRing++; maIdx = 0;
        }
        {
          const cnt = Math.max(1, ringCount[maRing]);
          const ang = (maIdx / cnt) * Math.PI * 2
                    + (maRing % 2 ? Math.PI / cnt : 0);
          g.ma = { ring: maRing, r: ringR[maRing], ang,
                   out: maRing % 2 === 0, sc: maSc };
          maIdx++;
        }

        // Starburst: spoke index + feathered angular offset; petals
        // shrink slightly toward the rim so tips stay legible.
        {
          const s2   = q % sbSpokes;
          const j2   = Math.floor(q / sbSpokes);
          const frac = (j2 + 0.5) / sbPerSpoke;
          const ang  = (s2 / sbSpokes) * Math.PI * 2 + ((j2 % 5) - 2) * 0.03;
          g.sb = { ang, r: sbR0 + (sbR1 - sbR0) * frac,
                   sc: sbSc * (1.05 - 0.35 * frac) };
        }

        // Hex lattice: one petal per slot (wrapping if M > slots), each
        // rotated to one of the six hex directions and scaled to fit
        // its cell.
        {
          const slot = latSlots[q % nLat];
          const rot  = (q % 6) * (Math.PI / 3);
          const sc   = Math.min(hxCfg.petalScaleCap ?? 1,
                                (latR * 1.9) / g.petalLen) * 0.95;
          g.hx = { x: slot.x, y: slot.y, rot, sc };
        }
      }
    }

    // Stash on the closure so updateOverlay can drive everything.
    //   brickHexWall      — outer parent group toggled by main.js
    //   brickHexCanonical — the LARGE canonical wall record (ghost pairing
    //                       in 'all' mode; hidden in hex mode).
    //   brickHexMorph     — the hex-mode size/shape-morph wall record.
    brickHexWall        = hexWall;
    brickHexCanonical   = canonicalRes;
    brickHexMorph       = morphRes;
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

  // Scratch for the five-pattern flower cycle (pose A / pose B blend).
  const _fpPosA  = new THREE.Vector3();
  const _fpPosB  = new THREE.Vector3();
  const _fpQuatA = new THREE.Quaternion();
  const _fpQuatB = new THREE.Quaternion();
  const _zAxis   = new THREE.Vector3(0, 0, 1);

  // Layout pose evaluator for the flower-pattern cycle. Writes the
  // ghost's target position/orientation for `state` into pos/quat and
  // returns the target scale. 'rose' is handled inline by the caller
  // (live petal pose); unknown states park the ghost in its hex slot
  // at scale 0.
  function evalFlowerLayout(state, g, t, fpCfg, pos, quat) {
    switch (state) {
      case 'phyllotaxis': {
        const c    = fpCfg.phyllotaxis || {};
        const ang  = g.ph.th + (c.spinSpeed ?? 0.06) * t;
        const rot  = ang + (c.tilt ?? 0.55);
        const half = g.petalLen * g.ph.sc * 0.5;
        pos.set(fadeCX + Math.cos(ang) * g.ph.r - Math.cos(rot) * half,
                fadeCY + Math.sin(ang) * g.ph.r - Math.sin(rot) * half,
                g.layoutZ);
        quat.setFromAxisAngle(_zAxis, rot);
        return g.ph.sc;
      }
      case 'mandala': {
        const c    = fpCfg.mandala || {};
        const dir  = g.ma.ring % 2 === 0 ? 1 : -1;
        const ang  = g.ma.ang + dir * (c.spinSpeed ?? 0.12) * t;
        const rot  = g.ma.out ? ang : ang + Math.PI;
        const half = g.petalLen * g.ma.sc * 0.5;
        pos.set(fadeCX + Math.cos(ang) * g.ma.r - Math.cos(rot) * half,
                fadeCY + Math.sin(ang) * g.ma.r - Math.sin(rot) * half,
                g.layoutZ);
        quat.setFromAxisAngle(_zAxis, rot);
        return g.ma.sc;
      }
      case 'starburst': {
        const c    = fpCfg.starburst || {};
        const ang  = g.sb.ang + (c.spinSpeed ?? -0.03) * t;
        const half = g.petalLen * g.sb.sc * 0.5;
        pos.set(fadeCX + Math.cos(ang) * g.sb.r - Math.cos(ang) * half,
                fadeCY + Math.sin(ang) * g.sb.r - Math.sin(ang) * half,
                g.layoutZ);
        quat.setFromAxisAngle(_zAxis, ang);
        return g.sb.sc;
      }
      case 'hexLattice': {
        const half = g.petalLen * g.hx.sc * 0.5;
        pos.set(g.hx.x - Math.cos(g.hx.rot) * half,
                g.hx.y - Math.sin(g.hx.rot) * half,
                g.layoutZ);
        quat.setFromAxisAngle(_zAxis, g.hx.rot);
        return g.hx.sc;
      }
      default: {
        // 'hexWall' (or unknown) — ghosts sink into their hex slot at
        // scale 0; there is no instanced wall in flowers mode.
        pos.copy(g.brickPos);
        quat.copy(g.brickQuat);
        return 0;
      }
    }
  }

  // Scratch + cached colours for the hex-wall colour drift. Recompute the
  // base / deep endpoints only when their config strings change so we
  // don't re-parse hex on every frame.
  const _hexBaseColor = new THREE.Color();
  const _hexDeepColor = new THREE.Color();
  const _hexDriftColor = new THREE.Color();
  let _hexDriftBaseStr = null;
  let _hexDriftDeepStr = null;

  // Morph-wall state — only ticks in 'hex' viewMode.
  //   Size evolution: a wall-wide "global size" glides between random
  //   targets in [sizeEvolve.min, sizeEvolve.max]; the per-tile wander
  //   and regional swells are layered on top in the compose loop.
  let _szFrom = -1, _szTo = -1, _szStart = -1, _szNextRoll = -1;
  //   Shape morphing: scheduler clock + live count of non-hexagon tiles
  //   (enforces shapeMorph.maxAltFraction).
  let _shapeLastT  = -1;
  let _nonHexCount = 0;

  // --- Brick-wall evolution state (effect-2 long-form variation) -------
  // Pre-allocated flash pool so the per-frame scheduler has zero
  // allocations. A "flash" is a transient bell-curve brightness boost
  // on a randomly-chosen visible-wall hex — addressed as (wall record,
  // instance index). Slots are reused once their envelope completes
  // (rec set back to null).
  const _evoMaxFlashes = 5;
  const _evoFlashes = new Array(_evoMaxFlashes);
  for (let i = 0; i < _evoMaxFlashes; i++) {
    _evoFlashes[i] = { rec: null, index: 0, start: 0, dur: 1, intensity: 0 };
  }
  let _evoLastT = -1;

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
    const tBrickHold   = (ANIM.viewMode === 'flowers')  ? 0
                       : (ANIM.viewMode === 'hexagons') ? (tov.hexHold ?? 25)
                       : (tov.brickHold ?? 15);
    const tBrickToRose = tov.brickToRose ?? 5;
    // Solo 'hexagons' mode skips the rose hold so the brick wall is the focus.
    // The cycle becomes brick hold → fade out → fade in → loop, with only
    // a single-frame invisibility at the morph midpoint.
    const tRoseHold    = (ANIM.viewMode === 'hexagons') ? 0 : (tov.roseHold ?? 15);
    const tRoseToBrick = tov.roseToBrick ?? 5;
    const morphTotal   = tBrickHold + tBrickToRose + tRoseHold + tRoseToBrick;

    // playAll syncs only in 'visualSequence' viewMode — solo modes free-run
    // with synthesized timings instead of reading cascadeState.playAllT
    // (which is pinned at -1 in solo modes by effects.js).
    const playAllOn = !!(ANIM.timings && ANIM.timings.playAll)
                    && (!ANIM.viewMode || ANIM.viewMode === 'visualSequence');
    // Solo modes 'hexagons' and 'flowers' synthesize a playAll-style cycle so
    // the brick-wall entry/exit waves animate the same way they do in
    // visualSequence — the user sees the in/out transitions, just without the
    // cascade syncing them to the pattern's all-at-center window.
    const soloMode = ANIM.viewMode === 'hexagons' || ANIM.viewMode === 'flowers';
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
    // Mode 'hexagons' is brick-only: clamp morphAlpha so the bricks never fade
    // into the rose state. brickW stays 1, inMorph stays true, and the
    // per-hex position/rotation update keeps running every frame so the
    // entry/exit waves cycle cleanly.
    if (ANIM.viewMode === 'hexagons') morphAlpha = 0;
    let inMorph = !!morphGroup && morphAlpha < 0.999;
    // Mode 'hexagons' override: force inMorph true whenever the hex wall
    // exists so the per-hex position update keeps writing every frame.
    if (ANIM.viewMode === 'hexagons' && brickHexWall) inMorph = true;

    // ---- Five-pattern flower cycle (solo 'flowers' mode) -------------
    // Replaces the legacy 2-state brick↔rose loop with a cycle over
    // `flowerPatterns.sequence`: each pattern holds `dwell` seconds,
    // then the petals fly to the next arrangement over `transit`
    // seconds with the same eased, bobbing ghost-flight as the original
    // transit. The live rosettes (wrappers) only render while settled
    // in the 'rose' hold; the ghost petals render everything else.
    const fpCfg = cfg.flowerPatterns || {};
    const fpOn  = ANIM.viewMode === 'flowers' && !!morphGroup
               && ghosts.length > 0 && fpCfg.enabled !== false;
    let fpA = null, fpB = null, fpE = 0;
    if (fpOn) {
      const fpSeq = Array.isArray(fpCfg.sequence) && fpCfg.sequence.length >= 2
        ? fpCfg.sequence
        : ['rose', 'phyllotaxis', 'mandala', 'starburst', 'hexLattice'];
      const dwell   = Math.max(fpCfg.dwell ?? 9, 0.1);
      const transit = Math.max(fpCfg.transit ?? 4.5, 0.1);
      const per     = dwell + transit;
      const total   = fpSeq.length * per;
      const cycF    = ((t % total) + total) % total;
      const idx     = Math.min(fpSeq.length - 1, Math.floor(cycF / per));
      const local   = cycF - idx * per;
      fpA = fpSeq[idx];
      fpB = fpSeq[(idx + 1) % fpSeq.length];
      const holding = local < dwell;
      const u = holding ? 0 : (local - dwell) / transit;
      fpE = 0.5 - 0.5 * Math.cos(Math.min(u, 1) * Math.PI);
      inMorph = !(holding && fpA === 'rose');
    }

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

    // ---- Five-pattern flower branch: pose-blend the ghosts and skip
    // the legacy brick/rose machinery entirely (no wall renders in
    // flowers mode — main.js force-hides hexRoots there anyway).
    if (fpOn) {
      morphGroup.visible = inMorph;
      if (brickHexWall) brickHexWall.visible = false;
      if (hexWrapper)   hexWrapper.visible   = false;
      if (inMorph) {
        // Force world-matrix updates on hidden wrappers so ghosts can
        // read the live rose pose during rose-involved transits.
        for (const w of wrappers) w.updateMatrixWorld(true);
        logoMesh.updateMatrixWorld(true);
        _logoInv.copy(logoMesh.matrixWorld).invert();

        // Live rosette pose reader (matches the legacy ghost hand-off).
        const roseInto = (g, pos, quat) => {
          if (g.sourcePetal) {
            _localMat.multiplyMatrices(_logoInv, g.sourcePetal.matrixWorld);
            _localMat.decompose(pos, quat, _rScale);
            return _rScale.x;
          }
          pos.copy(g.rosePos);
          quat.copy(g.roseQuat);
          return g.roseScale;
        };

        const blending = fpE > 0 && fpB !== fpA;
        for (const g of ghosts) {
          const sA = fpA === 'rose'
            ? roseInto(g, _fpPosA, _fpQuatA)
            : evalFlowerLayout(fpA, g, t, fpCfg, _fpPosA, _fpQuatA);
          if (!blending) {
            g.mesh.position.copy(_fpPosA);
            g.mesh.quaternion.copy(_fpQuatA);
            g.mesh.scale.setScalar(sA);
            continue;
          }
          const sB = fpB === 'rose'
            ? roseInto(g, _fpPosB, _fpQuatB)
            : evalFlowerLayout(fpB, g, t, fpCfg, _fpPosB, _fpQuatB);

          g.mesh.position.lerpVectors(_fpPosA, _fpPosB, fpE);
          // Perpendicular bob — same organic curved transit as the
          // original brick↔rose flight.
          const pdx = _fpPosB.x - _fpPosA.x;
          const pdy = _fpPosB.y - _fpPosA.y;
          const pLen = Math.hypot(pdx, pdy);
          if (pLen > 1e-4) {
            const bob = Math.sin(fpE * Math.PI) * pLen * g.bobMagFrac * g.bobSign;
            g.mesh.position.x += (-pdy / pLen) * bob;
            g.mesh.position.y += ( pdx / pLen) * bob;
          }
          g.mesh.scale.setScalar(sA + (sB - sA) * fpE);
          _qBase.copy(_fpQuatA).slerp(_fpQuatB, fpE);
          g.mesh.quaternion.copy(_qBase);
        }
      }
      return;
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

      // Hex walls. Tiles do a domino flip around their local +X axis,
      // with trigger times staggered by flipStep so a spiral wave rolls
      // across the wall. brickW drives the material opacity so hexes
      // fade (not shrink) across transits. Non-hex modes draw the
      // CANONICAL wall (static size, ghost pairing); solo hex mode
      // draws the MORPH wall (per-tile size evolution + shape morphs).
      const hexFall    = brickCfg.hexDominoFall    ?? 2.2;
      const hexPause   = brickCfg.hexDominoPause   ?? 2.5;
      // Per-hex flip speed jitter — drives the slowest-tile fall length so
      // cycle bookkeeping (cycleLen, the inter-wave pause window) holds
      // even when an individual tile is dragging far behind the baseline.
      const flipSpeedJitter = brickCfg.flipSpeedJitter ?? 0.55;
      const slowestFall = hexFall / Math.max(1 - flipSpeedJitter, 0.1);
      const exitTailEnd = morphTotal - hexExitGlide;

      // Hex-mode gate — drives colour drift, alt-back overlay, size
      // evolution, shape morphs, and opacity ramps.
      const isHexMode = ANIM.viewMode === 'hexagons';

      // (The old wall-wide "breathing" scale is gone — scaling an
      // exactly-tessellating honeycomb past 1.0 made every tile overlap
      // its neighbours. The morph wall's per-tile size evolution
      // provides the organic size motion instead, hard-clamped to the
      // grid pitch so overlap is impossible.)

      // Compute the target hex colour for this frame: drifted while in
      // solo 'hex' mode (effect 2), otherwise the static base hue.
      // Outside 'hex' mode the alt-back overlay + low opacity is also
      // suppressed so the wall reads identically to its pre-effect-2
      // look in 'all' / fireplace.
      const cd = brickCfg.colorDrift;
      const baseStr = brickCfg.color ?? '#D14A22';
      if (baseStr !== _hexDriftBaseStr) { _hexBaseColor.set(baseStr); _hexDriftBaseStr = baseStr; }
      if (isHexMode && cd && cd.enabled !== false) {
        const deepStr = cd.deepColor ?? '#5C0A04';
        if (deepStr !== _hexDriftDeepStr) { _hexDeepColor.set(deepStr); _hexDriftDeepStr = deepStr; }
        const dur = Math.max(cd.cycleDuration ?? 18, 0.001);
        const phase = (t / dur) * Math.PI * 2;
        const lerpAmt = 0.5 - 0.5 * Math.cos(phase);
        _hexDriftColor.copy(_hexBaseColor).lerp(_hexDeepColor, lerpAmt);
      } else {
        _hexDriftColor.copy(_hexBaseColor);
      }

      // --- Brick-wall evolution: amplitude-only layers -------------------
      // Layered on top of the existing colorDrift + domino so the wall
      // evolves while keeping its look + feel. Touches NO timing/phase
      // state (domino clock, switch dwell timer, brickW cycle) — only
      // material.color magnitude — so transitions never stutter.
      //
      //   * Macro LFO multiplies _hexDriftColor by 1 ± macroAmp on a slow
      //     period. Affects both front + back disc.
      //   * Per-hex slow sine (random seed + ±40% rate) wiggles each
      //     tile's brightness independently — applied below in the
      //     per-tile loop. Read here so the constants are hoisted out.
      //   * Rare ember flashes: Poisson-style scheduler picks a random
      //     visible-wall hex every few seconds; each scheduled flash is
      //     a bell-curve brightness boost over ~1s. Pool is pre-allocated
      //     so the scheduler does zero per-frame allocations.
      const evoCfg = brickCfg.evolution || {};
      const evoOn  = isHexMode && evoCfg.enabled !== false;
      if (evoOn) {
        const mAmp = evoCfg.macroAmp ?? 0.10;
        const mP   = Math.max(evoCfg.macroPeriod ?? 70, 0.001);
        _hexDriftColor.multiplyScalar(1 + mAmp * Math.sin(t * Math.PI * 2 / mP));

        const dtRoll = (_evoLastT < 0) ? 0 : Math.max(0, t - _evoLastT);
        _evoLastT = t;
        const flashRate = evoCfg.flashRate ?? 0.45;
        if (Math.random() < flashRate * dtRoll) {
          let free = -1;
          for (let i = 0; i < _evoMaxFlashes; i++) {
            if (_evoFlashes[i].rec === null) { free = i; break; }
          }
          if (free >= 0) {
            // evoOn implies hex mode, where the morph wall is the one
            // drawing — flashes land on it.
            const activeRec = brickHexMorph || brickHexCanonical;
            if (activeRec && activeRec.count) {
              const slot = _evoFlashes[free];
              slot.rec   = activeRec;
              slot.index = Math.floor(Math.random() * activeRec.count);
              slot.start = t;
              const dMin = evoCfg.flashDurMin ?? 0.7;
              const dMax = evoCfg.flashDurMax ?? 1.9;
              slot.dur   = dMin + Math.random() * (dMax - dMin);
              const iMin = evoCfg.flashIntensityMin ?? 0.5;
              const iMax = evoCfg.flashIntensityMax ?? 1.2;
              slot.intensity = iMin + Math.random() * (iMax - iMin);
            }
          }
        }
        // Free completed slots (set rec = null so they can be reused).
        for (let i = 0; i < _evoMaxFlashes; i++) {
          const f = _evoFlashes[i];
          if (f.rec !== null && (t - f.start) / f.dur >= 1) f.rec = null;
        }
      } else {
        _evoLastT = -1;
        for (let i = 0; i < _evoMaxFlashes; i++) _evoFlashes[i].rec = null;
      }
      const evoWiggleAmp   = evoOn ? (evoCfg.wiggleAmp   ?? 0.18) : 0;
      const evoWiggleSpeed = evoCfg.wiggleSpeed ?? 0.60;

      const baseOpacity = isHexMode ? (brickCfg.baseOpacity ?? 1) : 1;

      const backCfgFrame = brickCfg.backFace || {};
      const altOpacity = isHexMode && backCfgFrame.enabled !== false
        ? (backCfgFrame.altOpacity ?? 1)
        : 0;

      // Wall selection. Outside hex mode the CANONICAL wall is the only
      // brick layer (used by the brick↔rose ghost morph). Inside hex
      // mode the canonical is hidden and the MORPH wall draws — one
      // wall, always, so two different-size honeycombs can never render
      // on top of each other (the old crossfade-pool overlap).
      const canonicalAlpha = isHexMode ? 0 : 1;
      if (brickHexCanonical) {
        brickHexCanonical.wall.visible = canonicalAlpha > 0.001;
      }
      if (brickHexMorph) {
        brickHexMorph.wall.visible = isHexMode;
      }

      const wallSpecs = [];
      if (canonicalAlpha > 0.001 && brickHexCanonical) {
        wallSpecs.push({
          rec:        brickHexCanonical,
          trigger:    brickCfg.largeDominoTrigger
                   ?? brickCfg.hexDominoTrigger ?? 0.18,
          sizeAlpha:  canonicalAlpha,
          wallScale:  1,
          waveOffset: 0,
        });
      }

      for (const ws of wallSpecs) {
        const rec = ws.rec;
        if (ws.sizeAlpha <= 0.001 || !rec || !rec.count) continue;
        const hexTrigger = ws.trigger;
        const sizeAlpha  = ws.sizeAlpha;
        const wallScale  = ws.wallScale;
        const waveOffset = ws.waveOffset || 0;
        const hexCount   = rec.count;
        const hexMaxStep = Math.max(0, hexCount - 1);
        const hexCycleLen = hexMaxStep * hexTrigger + slowestFall;
        const hexFullCyc  = hexCycleLen + hexPause;
        const hexElapsed  = hexFullCyc > 0
          ? (((t - waveOffset) % hexFullCyc) + hexFullCyc) % hexFullCyc
          : 0;
        const stepDenom   = Math.max(1, hexCount - 1);

        // Wall-wide state that used to be per-mesh material writes: the
        // whole wall shares one front + one back material now. Per-tile
        // components (edge fade, back-face reveal, wiggle/flash colour)
        // ride the instanced attributes below instead.
        const s = wallScale;
        const fMat = rec.front.material;
        fMat.color.copy(_hexDriftColor);
        fMat.opacity = brickW * sizeAlpha * baseOpacity;
        if (rec.back) {
          const bMat = rec.back.material;
          // Back disc tracks the wall's color drift so both sides read
          // as the same hue. Outside hex mode altOpacity is 0 — the
          // discs used to render fully transparent; now they skip the
          // draw entirely (visually identical).
          bMat.color.copy(_hexDriftColor);
          bMat.opacity = brickW * sizeAlpha * altOpacity;
          rec.back.visible = altOpacity > 0;
        }

        const mArr  = rec.front.instanceMatrix.array;
        const cArr  = rec.front.instanceColor.array;
        const aArr  = rec.alphaAttr.array;
        const bmArr = (rec.back && rec.back.visible)
          ? rec.back.instanceMatrix.array : null;
        const baArr = bmArr ? rec.backAlphaAttr.array : null;
        const backOff = rec.backOff;

        for (let i = 0; i < hexCount; i++) {
          // Per-tile colour multiplier (evolution wiggle + ember
          // flashes) — amplitude-only, multiplied against the wall's
          // drift colour in the shader via instanceColor.
          let mul = 1;
          if (evoOn) {
            mul = 1 + evoWiggleAmp * Math.sin(
              t * evoWiggleSpeed * rec.evoFactor[i] + rec.evoSeed[i]);
            for (let fi = 0; fi < _evoMaxFlashes; fi++) {
              const f = _evoFlashes[fi];
              if (f.rec !== rec || f.index !== i) continue;
              const u = (t - f.start) / f.dur;
              if (u >= 0 && u < 1) {
                mul *= 1 + Math.sin(u * Math.PI) * f.intensity;
              }
            }
          }
          const ci = i * 3;
          cArr[ci] = mul; cArr[ci + 1] = mul; cArr[ci + 2] = mul;

          const step      = rec.flipStep[i];
          const flipSpeed = rec.flipSpeed[i] || 1;
          // Per-tile fall duration: faster hexes finish their flip sooner,
          // slower hexes drag — wave reads as mixed speeds across the wall.
          const thisFall  = hexFall / Math.max(flipSpeed, 0.05);
          const ph   = (hexElapsed - step * hexTrigger) / thisFall;
          let angle = 0;
          if (ph > 0 && ph < 1) {
            const eased = 0.5 - 0.5 * Math.cos(ph * Math.PI);
            angle = eased * twoPi;
          }

          let edgeDrift = 0;
          let edgeFade  = 1;
          if (wavesOn) {
            const stepFrac = step / stepDenom;
            const entryStart = hexEntryDelay + hexEntryStagger * stepFrac;
            const entryEnd   = entryStart + hexEntryGlide;
            if (cyc < entryEnd) {
              const u = Math.max(0, (cyc - entryStart) / Math.max(hexEntryGlide, 1e-3));
              const eased = u * u * (3 - 2 * u);
              edgeDrift = 1 - eased;
              edgeFade  = eased;
            }
            const exitStart = exitTailEnd - hexExitStagger * (1 - stepFrac);
            if (cyc > exitStart) {
              const u = Math.min(1, (cyc - exitStart) / Math.max(hexExitGlide, 1e-3));
              const eased = u * u * (3 - 2 * u);
              if (eased > edgeDrift) edgeDrift = eased;
              if (1 - eased < edgeFade) edgeFade = 1 - eased;
            }
          }

          const driftFactor = e > edgeDrift ? e : edgeDrift;
          const px = rec.homeX[i]
                   + rec.driftX[i] * rec.driftDist[i] * driftFactor;
          const py = rec.homeY[i]
                   + rec.driftY[i] * rec.driftDist[i] * driftFactor;

          // Compose T(px, py, 0) · Rx(angle) · S(s) straight into the
          // instance buffer (column-major). z stays 0 — the wall's z
          // lives on the InstancedMesh object itself.
          const cA = Math.cos(angle), sA = Math.sin(angle);
          const o = i * 16;
          mArr[o]      = s;  mArr[o + 1]  = 0;        mArr[o + 2]  = 0;      mArr[o + 3]  = 0;
          mArr[o + 4]  = 0;  mArr[o + 5]  = cA * s;   mArr[o + 6]  = sA * s; mArr[o + 7]  = 0;
          mArr[o + 8]  = 0;  mArr[o + 9]  = -sA * s;  mArr[o + 10] = cA * s; mArr[o + 11] = 0;
          mArr[o + 12] = px; mArr[o + 13] = py;       mArr[o + 14] = 0;      mArr[o + 15] = 1;

          aArr[i] = edgeFade;

          if (bmArr) {
            // Back disc rides the same rotation/scale, offset along the
            // tile's local -z (matches the old child at z = -backOff).
            bmArr[o]      = s;  bmArr[o + 1]  = 0;       bmArr[o + 2]  = 0;      bmArr[o + 3]  = 0;
            bmArr[o + 4]  = 0;  bmArr[o + 5]  = cA * s;  bmArr[o + 6]  = sA * s; bmArr[o + 7]  = 0;
            bmArr[o + 8]  = 0;  bmArr[o + 9]  = -sA * s; bmArr[o + 10] = cA * s; bmArr[o + 11] = 0;
            bmArr[o + 12] = px;
            bmArr[o + 13] = py + sA * s * backOff;
            bmArr[o + 14] = -cA * s * backOff;
            bmArr[o + 15] = 1;

            let backVis = 0;
            if (isHexMode) {
              const backFacing = -cA;
              if (backFacing > 0) {
                if (backFacing >= 0.4) {
                  backVis = 1;
                } else {
                  const u = backFacing / 0.4;
                  backVis = u * u * (3 - 2 * u);
                }
              }
            }
            baArr[i] = edgeFade * backVis;
          }
        }

        rec.front.instanceMatrix.needsUpdate = true;
        rec.front.instanceColor.needsUpdate  = true;
        rec.alphaAttr.needsUpdate = true;
        if (bmArr) {
          rec.back.instanceMatrix.needsUpdate = true;
          rec.backAlphaAttr.needsUpdate = true;
        }
      }

      // ---- Morph wall (solo hex mode): size evolution + shape morphs --
      if (isHexMode && brickHexMorph) {
        const rec = brickHexMorph;
        const n   = rec.count;

        // --- Global size target: re-rolls to a random value in
        // [min, max] every retargetMin..retargetMax seconds and glides
        // there over retargetDur seconds. This is the "unexpected"
        // wall-wide morph; per-tile wander + regional swells layer on
        // top below.
        const seCfg  = brickCfg.sizeEvolve || {};
        const seOn   = seCfg.enabled !== false;
        const seMin  = Math.max(0.05, seCfg.min ?? 0.45);
        const seMax  = Math.min(1.0, Math.max(seMin, seCfg.max ?? 0.97));
        const seRate = seCfg.rate ?? 0.06;
        const seReg  = Math.max(0, Math.min(1, seCfg.regionality ?? 0.55));
        const seWob  = seCfg.wobble ?? 0.55;
        const rtMin  = seCfg.retargetMin ?? 9;
        const rtMax  = Math.max(rtMin, seCfg.retargetMax ?? 20);
        const rtDur  = Math.max(seCfg.retargetDur ?? 6, 0.001);
        let gSize = 1;
        if (seOn) {
          if (_szStart < 0) {
            _szFrom = _szTo = seMin + Math.random() * (seMax - seMin);
            _szStart = t;
            _szNextRoll = t + rtMin + Math.random() * (rtMax - rtMin);
          }
          const gk0 = Math.min(1, (t - _szStart) / rtDur);
          const gEase = gk0 * gk0 * (3 - 2 * gk0);
          if (t >= _szNextRoll) {
            _szFrom = _szFrom + (_szTo - _szFrom) * gEase;
            _szTo   = seMin + Math.random() * (seMax - seMin);
            _szStart = t;
            _szNextRoll = t + rtDur + rtMin + Math.random() * (rtMax - rtMin);
            gSize = _szFrom;
          } else {
            gSize = _szFrom + (_szTo - _szFrom) * gEase;
          }
        } else {
          gSize = seMax;
        }
        // Per-tile deviation amplitude + travelling regional swell. The
        // swell is a plane wave whose direction slowly rotates, so
        // whole neighbourhoods of tiles bulge and relax together.
        const devAmp = seOn ? seWob * (seMax - seMin) * 0.5 : 0;
        const regK   = twoPi / Math.max(maxR * 1.2, 1e-3);
        const regPhi = t * 0.05;
        const regKx  = Math.cos(regPhi) * regK;
        const regKy  = Math.sin(regPhi) * regK;
        const regW   = twoPi * seRate * 0.7;
        const tileW  = twoPi * seRate;

        // --- Shape-morph scheduler: Poisson picks, capped alt share.
        const smCfg  = brickCfg.shapeMorph || {};
        const smOn   = smCfg.enabled !== false;
        const smRate = smCfg.rate ?? 1.2;
        const smDur  = Math.max(smCfg.morphDur ?? 2.6, 0.2);
        const smCap  = Math.max(0, Math.min(1, smCfg.maxAltFraction ?? 0.22));
        const smRet  = Math.max(0, Math.min(1, smCfg.returnBias ?? 0.6));
        const smDt   = _shapeLastT < 0 ? 0 : Math.max(0, t - _shapeLastT);
        _shapeLastT = t;
        if (smOn && Math.random() < smRate * smDt) {
          const i = Math.floor(Math.random() * n);
          if (rec.morphStart[i] < 0) {
            const cur = rec.shapeIdx[i];
            let target = -1;
            if (cur !== 0) {
              // Non-hex tile: usually return home to hexagon, sometimes
              // hop to a different alt shape.
              if (Math.random() < smRet) {
                target = 0;
              } else {
                target = 1 + Math.floor(Math.random() * 3);
                if (target === cur) target = 0;
              }
            } else if (_nonHexCount < smCap * n) {
              target = 1 + Math.floor(Math.random() * 3);
            }
            if (target >= 0 && target !== cur) {
              rec.morphFrom[i]  = cur;
              rec.morphTo[i]    = target;
              rec.morphStart[i] = t;
            }
          }
        }

        // --- Wave clock (same spiral domino as the canonical wall).
        const hexTrigger  = rec.trigger;
        const hexMaxStep  = Math.max(0, n - 1);
        const hexCycleLen = hexMaxStep * hexTrigger + slowestFall;
        const hexFullCyc  = hexCycleLen + hexPause;
        const hexElapsed  = hexFullCyc > 0
          ? ((t % hexFullCyc) + hexFullCyc) % hexFullCyc
          : 0;
        const stepDenom   = Math.max(1, n - 1);

        // Wall-wide material state (front + back shared by all four
        // shape meshes).
        rec.frontMat.color.copy(_hexDriftColor);
        rec.frontMat.opacity = brickW * baseOpacity;
        const backOn = !!rec.backMat && altOpacity > 0;
        if (rec.backMat) {
          rec.backMat.color.copy(_hexDriftColor);
          rec.backMat.opacity = brickW * altOpacity;
        }
        for (const sh of rec.shapes) {
          if (sh.back) sh.back.visible = backOn;
        }

        for (let i = 0; i < n; i++) {
          // Colour multiplier (evolution wiggle + ember flashes).
          let mul = 1;
          if (evoOn) {
            mul = 1 + evoWiggleAmp * Math.sin(
              t * evoWiggleSpeed * rec.evoFactor[i] + rec.evoSeed[i]);
            for (let fi = 0; fi < _evoMaxFlashes; fi++) {
              const f = _evoFlashes[fi];
              if (f.rec !== rec || f.index !== i) continue;
              const u = (t - f.start) / f.dur;
              if (u >= 0 && u < 1) {
                mul *= 1 + Math.sin(u * Math.PI) * f.intensity;
              }
            }
          }

          // Per-tile radius factor — global glide + independent wander
          // + regional swell, hard-clamped to [seMin, seMax]. seMax ≤ 1
          // = the no-overlap guarantee (tile can never outgrow its
          // grid cell).
          let sFac = gSize;
          if (devAmp > 0) {
            const wander = Math.sin(tileW * rec.sizeFreq[i] * t + rec.sizeSeed[i]);
            const swell  = Math.sin(rec.homeX[i] * regKx + rec.homeY[i] * regKy
                                    - regW * t + rec.sizeSeed[i] * 0.13);
            sFac += devAmp * ((1 - seReg) * wander + seReg * swell);
          }
          if (sFac < seMin) sFac = seMin;
          else if (sFac > seMax) sFac = seMax;

          // Shape morph envelope — shrink the old shape to zero over
          // the first half, regrow the new shape over the second half.
          let active = rec.shapeIdx[i];
          let shapeEnv = 1;
          const ms = rec.morphStart[i];
          if (ms >= 0) {
            const u2 = (t - ms) / smDur;
            if (u2 >= 1) {
              const from = rec.morphFrom[i], to = rec.morphTo[i];
              if (from === 0 && to !== 0)      _nonHexCount++;
              else if (from !== 0 && to === 0) _nonHexCount--;
              rec.shapeIdx[i]   = to;
              rec.morphStart[i] = -1;
              active = to;
            } else if (u2 < 0.5) {
              active = rec.morphFrom[i];
              const q = u2 * 2;
              shapeEnv = 1 - q * q * (3 - 2 * q);
            } else {
              active = rec.morphTo[i];
              const q = (u2 - 0.5) * 2;
              shapeEnv = q * q * (3 - 2 * q);
            }
          }

          // Domino flip.
          const step      = rec.flipStep[i];
          const flipSpeed = rec.flipSpeed[i] || 1;
          const thisFall  = hexFall / Math.max(flipSpeed, 0.05);
          const ph   = (hexElapsed - step * hexTrigger) / thisFall;
          let angle = 0;
          if (ph > 0 && ph < 1) {
            const eased = 0.5 - 0.5 * Math.cos(ph * Math.PI);
            angle = eased * twoPi;
          }

          // Entry/exit edge waves (same as the canonical wall).
          let edgeDrift = 0;
          let edgeFade  = 1;
          if (wavesOn) {
            const stepFrac = step / stepDenom;
            const entryStart = hexEntryDelay + hexEntryStagger * stepFrac;
            const entryEnd   = entryStart + hexEntryGlide;
            if (cyc < entryEnd) {
              const u = Math.max(0, (cyc - entryStart) / Math.max(hexEntryGlide, 1e-3));
              const eased = u * u * (3 - 2 * u);
              edgeDrift = 1 - eased;
              edgeFade  = eased;
            }
            const exitStart = exitTailEnd - hexExitStagger * (1 - stepFrac);
            if (cyc > exitStart) {
              const u = Math.min(1, (cyc - exitStart) / Math.max(hexExitGlide, 1e-3));
              const eased = u * u * (3 - 2 * u);
              if (eased > edgeDrift) edgeDrift = eased;
              if (1 - eased < edgeFade) edgeFade = 1 - eased;
            }
          }

          const driftFactor = e > edgeDrift ? e : edgeDrift;
          const px = rec.homeX[i]
                   + rec.driftX[i] * rec.driftDist[i] * driftFactor;
          const py = rec.homeY[i]
                   + rec.driftY[i] * rec.driftDist[i] * driftFactor;

          // Hand the tile's buffer slot over to a different shape mesh
          // when the active shape changed — zero the old slot so the
          // tile is never drawn twice.
          const last = rec.lastShape[i];
          if (last !== active) {
            const oldSh = rec.shapes[last];
            const fo = oldSh.front.instanceMatrix.array;
            const o0 = i * 16;
            for (let z = 0; z < 16; z++) fo[o0 + z] = 0;
            if (oldSh.back) {
              const bo = oldSh.back.instanceMatrix.array;
              for (let z = 0; z < 16; z++) bo[o0 + z] = 0;
            }
            rec.lastShape[i] = active;
          }

          const sh   = rec.shapes[active];
          const s    = sFac * shapeEnv;
          const cA   = Math.cos(angle), sA = Math.sin(angle);
          const o    = i * 16;
          const mArr = sh.front.instanceMatrix.array;
          mArr[o]      = s;  mArr[o + 1]  = 0;        mArr[o + 2]  = 0;      mArr[o + 3]  = 0;
          mArr[o + 4]  = 0;  mArr[o + 5]  = cA * s;   mArr[o + 6]  = sA * s; mArr[o + 7]  = 0;
          mArr[o + 8]  = 0;  mArr[o + 9]  = -sA * s;  mArr[o + 10] = cA * s; mArr[o + 11] = 0;
          mArr[o + 12] = px; mArr[o + 13] = py;       mArr[o + 14] = 0;      mArr[o + 15] = 1;

          const ci = i * 3;
          const cArr = sh.front.instanceColor.array;
          cArr[ci] = mul; cArr[ci + 1] = mul; cArr[ci + 2] = mul;
          sh.alphaAttr.array[i] = edgeFade;

          if (backOn && sh.back) {
            const backOff = rec.backOff;
            const bmArr = sh.back.instanceMatrix.array;
            bmArr[o]      = s;  bmArr[o + 1]  = 0;       bmArr[o + 2]  = 0;      bmArr[o + 3]  = 0;
            bmArr[o + 4]  = 0;  bmArr[o + 5]  = cA * s;  bmArr[o + 6]  = sA * s; bmArr[o + 7]  = 0;
            bmArr[o + 8]  = 0;  bmArr[o + 9]  = -sA * s; bmArr[o + 10] = cA * s; bmArr[o + 11] = 0;
            bmArr[o + 12] = px;
            bmArr[o + 13] = py + sA * s * backOff;
            bmArr[o + 14] = -cA * s * backOff;
            bmArr[o + 15] = 1;

            let backVis = 0;
            const backFacing = -cA;
            if (backFacing > 0) {
              if (backFacing >= 0.4) {
                backVis = 1;
              } else {
                const u = backFacing / 0.4;
                backVis = u * u * (3 - 2 * u);
              }
            }
            sh.backAlphaAttr.array[i] = edgeFade * backVis;
          }
        }

        for (const sh of rec.shapes) {
          sh.front.instanceMatrix.needsUpdate = true;
          sh.front.instanceColor.needsUpdate  = true;
          sh.alphaAttr.needsUpdate = true;
          if (backOn && sh.back) {
            sh.back.instanceMatrix.needsUpdate = true;
            sh.backAlphaAttr.needsUpdate = true;
          }
        }
      } else if (!isHexMode) {
        // Reset hex-mode state when away so the next entry re-rolls.
        _szStart = -1; _szNextRoll = -1;
        _shapeLastT = -1;
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
