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

// Domino trigger order starting from `startIdx`. Picks the angularly
// closest unvisited petal to the most recently activated one, so the
// wave reads as a chain hopping neighbor-to-neighbor. For a full ring
// this collapses to "go one way until you wrap"; for a halfCut arc it
// sweeps to one end, then jumps across the cut to sweep the other arc.
// Ties broken with `rng` so mirror-symmetric starts don't always bias
// the same direction.
function computeDominoOrder(angles, startIdx, rng) {
  const N = angles.length;
  const visited = new Array(N).fill(false);
  const order = [startIdx];
  visited[startIdx] = true;
  const twoPi = Math.PI * 2;
  while (order.length < N) {
    const curTheta = angles[order[order.length - 1]];
    let bestIdx = -1, bestDist = Infinity;
    for (let i = 0; i < N; i++) {
      if (visited[i]) continue;
      let d = Math.abs(angles[i] - curTheta);
      d = Math.min(d, twoPi - d);
      if (d < bestDist - 1e-9) {
        bestDist = d;
        bestIdx = i;
      } else if (Math.abs(d - bestDist) < 1e-9 && rng() < 0.5) {
        bestIdx = i;
      }
    }
    order.push(bestIdx);
    visited[bestIdx] = true;
  }
  return order;
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

export function addOverlay(logoMesh, meta) {
  const { silhouette, hull, maxR, maxZ, cx, cy } = meta;
  const wrappers = [];

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
    const sil = silhouette[0];
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

  function makeFan(pivot, wrapperRotation, spinDir, phaseOffset) {
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
    const dominoCfg     = cfg0.petalDomino || {};
    const dominoInitMax = dominoCfg.initStaggerMax ?? 3.0;
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
        const addPetal = (geo, theta, baseR) => {
          const g = new THREE.Group();
          g.position.set(Math.cos(theta) * baseR, Math.sin(theta) * baseR, 0);
          g.rotation.z = theta;            // local +x → outward, +y → ring-tangent
          const m = new THREE.Mesh(geo, mat);
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

        // Domino state — order computed lazily on the first post-stagger
        // update so petals stay at rest during the init window. Negative
        // initial stagger would fire immediately; randomise in [0,max)
        // so neighbouring flowers don't all trigger on the same frame.
        flower.userData.petals        = petals;
        flower.userData.petalAngles   = petalAngles;
        flower.userData.dominoOrder   = null;
        flower.userData.dominoStart   = Math.random() * dominoInitMax;

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
    // Walk the FULL outline perimeter, dropping `instances` clusters at
    // even arc-length intervals so the chain wraps the entire gate
    // frame — left side, top arch, right side, bottom — instead of
    // stopping at rightPivot. Starting offset is leftPivot's arc
    // position; direction is whichever way leads UP from that start
    // (so the chain reads "first instance ascends" on either winding).
    const startArc = cumArc[nearestIdx(leftPivot)];
    const startIdx = nearestIdx(leftPivot);
    const dir = outline[(startIdx + 1) % N].y > outline[startIdx].y ? +1 : -1;

    const instances = Math.max(1, cfg0.instances ?? 1);
    // Full-ring spacing — no `-1` since the chain wraps; the last
    // instance lands one step before the first, so the loop closes.
    const spacing = perimeter / instances;
    const rotationOffset = cfg0.rotationOffset ?? 0;

    for (let k = 0; k < instances; k++) {
      const s = sampleAtArc(startArc + dir * k * spacing);
      // alignToEdge accepts any object with dx/dy/len, so we pass the
      // sample itself as both pivot and edge.
      let rot = alignToEdge(s, s, center) - rotationOffset;
      // Alternate spin direction on adjacent clusters so any non-zero
      // `spinSpeed` doesn't make the whole chain drift in one direction.
      const spinDir = k % 2 === 0 ? +1 : -1;
      // Phase-stagger the initial pulse across instances; per-layer
      // random phase still dominates, this just breaks up k=0 sync.
      const phaseOffset = (k / instances) * Math.PI * 2;
      makeFan({ x: s.x, y: s.y }, rot, spinDir, phaseOffset);
    }
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
  }

  function updateOverlay(t) {
    const cfg = ANIM.overlay;
    if (!cfg || cfg.enabled === false) {
      for (const w of wrappers) w.visible = false;
      if (hexWrapper) hexWrapper.visible = false;
      return;
    }
    const twoPi = Math.PI * 2;
    const mn = cfg.scaleMin;
    const mx = cfg.scaleMax;
    const dominoCfg   = cfg.petalDomino || {};
    const dominoOn    = dominoCfg.enabled !== false;
    const trigger     = dominoCfg.triggerInterval ?? 0.08;
    const fall        = dominoCfg.fallDuration    ?? 0.9;
    const pauseBetween = dominoCfg.pause          ?? 1.5;
    for (const w of wrappers) {
      w.visible = true;
      w.rotation.z = w.userData.baseRotation +
                     w.userData.spinDir * t * cfg.spinSpeed;
      // Each cascade layer (flower) pulses on its own randomised period
      // + phase, so the stack breathes asynchronously — no single
      // global scale. Inside each flower, petals run an independent
      // domino-wave rotation around their base-tangent axis.
      const flowers = w.userData.cascadeLayers;
      for (let i = 0; i < flowers.length; i++) {
        const flower = flowers[i];
        const p = Math.max(flower.userData.pulsePeriod, 1e-3);
        const phase = (t / p) * twoPi + flower.userData.phaseOffset;
        const k = 0.5 + 0.5 * Math.sin(phase);
        flower.scale.setScalar(mn + (mx - mn) * k);

        const petals = flower.userData.petals;
        const N = petals ? petals.length : 0;
        if (!dominoOn || N === 0) {
          for (let q = 0; q < N; q++) petals[q].rotation.y = 0;
          continue;
        }
        let elapsed = t - flower.userData.dominoStart;
        if (elapsed < 0) {
          // Still in the init stagger — hold petals flat so the first
          // frames read as a calm rosette before the wave kicks in.
          for (let q = 0; q < N; q++) petals[q].rotation.y = 0;
          continue;
        }
        const cycleLen = (N - 1) * trigger + fall;
        if (!flower.userData.dominoOrder || elapsed >= cycleLen + pauseBetween) {
          // Pick a fresh random start petal each cycle, then chain to
          // the angularly closest unvisited petal from the most recent
          // one (classic single-file domino).
          const startIdx = Math.floor(Math.random() * N);
          flower.userData.dominoOrder = computeDominoOrder(
            flower.userData.petalAngles, startIdx, Math.random
          );
          flower.userData.dominoStart = t;
          elapsed = 0;
        }
        const order = flower.userData.dominoOrder;
        for (let q = 0; q < N; q++) {
          const petalIdx = order[q];
          const triggerTime = q * trigger;
          const ph = (elapsed - triggerTime) / fall;
          let angle = 0;
          if (ph > 0 && ph < 1) angle = ph * twoPi;
          petals[petalIdx].rotation.y = angle;
        }
      }
    }
    if (hexWrapper) {
      hexWrapper.visible = cfg.hexagon ? cfg.hexagon.enabled !== false : true;
      // Future "look" hooks go here — e.g. hexWrapper.rotation.z = t * ...
    }
  }

  return { updateOverlay, patternsToRefresh: [] };
}
