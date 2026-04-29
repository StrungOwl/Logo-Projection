// Flame effect — fills the main central cutout of the logo with a
// volumetric, organic flame (mode 5 only). Three coordinated layers:
//
//   1. Body  — extruded mesh of the cutout shape, custom shader using
//              domain-warped 2D fbm with z-perturbation. Vertical gradient
//              (yellow → orange → deep red) plus continuous chromatic
//              shimmer + rare brighter chromatic flares confined to the
//              hot zone.
//   2. Sparks — GPU points loop independently (Bezier-style position
//              evolution like src/particles.js) and rise from the lower
//              flame body up past the vanishing point.
//   3. Light  — flickering THREE.PointLight at the hot zone. Intensity
//              + colour modulated by the same flare envelope the body
//              uses, so the surrounding glow shifts cool when the flame
//              flares blue/green/purple. Naturally illuminates the inner
//              cutout walls of the logo (StandardMaterial responds to
//              lights) for the "fire glow on the inside of the hole" read.
//
// All three layers are children of one Group positioned at (cx, cy, 0)
// in mesh-local coords (same convention as panel/lattice). The cutout
// loop is converted to flame-local (panel-local) by subtracting (cx, cy).

import * as THREE from 'three';
import { ANIM } from '../src/config.js';
import { hexToRgb } from '../src/util/color.js';

// -----------------------------------------------------------------------
// extractInnerCutout — pulls the central "inner star" outline directly
// off the model's mesh edges (via EdgesGeometry @ 30°), bypasses the
// outer-perimeter silhouette walk in src/logo.js (which collapses the
// inner cutout onto the outer perimeter for this particular model due
// to weld-key collisions in densely-tessellated curves).
//
// Strategy:
//   1. Collect all sharp edges at the front-face Z plane.
//   2. Filter to the inner region by elliptical mask centred on the
//      fade-centre — same mask shape src/particles.js#extractStarSegments
//      uses to isolate the cutout edges from the outer perimeter.
//   3. Weld endpoints to a coarse grid and build adjacency.
//   4. Chain segments into closed loops.
//   5. Return the largest-area closed loop, RDP-simplified.
// Returns mesh-local 2D points (caller subtracts (cx, cy) for panel-local).
// -----------------------------------------------------------------------
function extractInnerCutout(logoMesh, meta) {
  const { maxZ, halfExtent, patternFadeCenter, cx, cy } = meta;
  const geom = logoMesh.geometry;
  const pos = geom.attributes.position;
  const idx = geom.index;

  // The SDG logo's mesh has ONE topologically-connected boundary loop:
  // the outer perimeter dips into the inner-star "bay" through a thin
  // neck at the bottom and traces back out, so outer + inner share one
  // continuous chain (not two closed loops). The inner-star is an OPEN
  // bay carved into the body, not a closed hole — that's why the
  // standard boundary-walker in src/logo.js can't isolate it.
  //
  // Strategy:
  //   1. Walk the boundary chain (one loop, ~13k vertices).
  //   2. Mark vertices as INSIDE the inner-star region using an
  //      elliptical mask centred on the fade-centre with downward
  //      stretch (inner star drops a long bottom tip).
  //   3. Find the longest contiguous arc of "inside" vertices on the
  //      chain — that's the inner-bay outline.
  //   4. Close the arc with a straight chord between its endpoints to
  //      form a polygon. The chord sits across the neck where the
  //      bay opens to the outer perimeter.
  //   5. Smooth + RDP-simplify.
  const zTol = Math.max(halfExtent * 0.02, 0.1);
  const fxMesh = patternFadeCenter[0] + cx;
  const fyMesh = patternFadeCenter[1] + cy;

  // Weld front-face vertices.
  const wmap = new Map();
  const wpts = [];
  const vToW = new Map();
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getZ(i) - maxZ) > zTol) continue;
    const x = pos.getX(i), y = pos.getY(i);
    const key = Math.round(x * 10000) + ':' + Math.round(y * 10000);
    let w = wmap.get(key);
    if (w === undefined) { w = wpts.length; wmap.set(key, w); wpts.push({ x, y }); }
    vToW.set(i, w);
  }

  // Boundary edges via triangle walker.
  const edgeCount = new Map();
  function ek(a, b) { return a < b ? a + ',' + b : b + ',' + a; }
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3)     : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const w0 = vToW.get(i0), w1 = vToW.get(i1), w2 = vToW.get(i2);
    if (w0 === undefined || w1 === undefined || w2 === undefined) continue;
    if (w0 !== w1) edgeCount.set(ek(w0, w1), (edgeCount.get(ek(w0, w1)) || 0) + 1);
    if (w1 !== w2) edgeCount.set(ek(w1, w2), (edgeCount.get(ek(w1, w2)) || 0) + 1);
    if (w2 !== w0) edgeCount.set(ek(w2, w0), (edgeCount.get(ek(w2, w0)) || 0) + 1);
  }
  const adj = new Map();
  for (const [key, count] of edgeCount) {
    if (count !== 1) continue;
    const sep = key.indexOf(',');
    const a = +key.slice(0, sep);
    const b = +key.slice(sep + 1);
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  }
  if (adj.size === 0) return null;

  // Walk the single boundary chain.
  const chain = [];
  const visited = new Set();
  // Pick any boundary vertex as start.
  const start = adj.keys().next().value;
  chain.push(start); visited.add(start);
  let prev = -1, cur = start;
  while (true) {
    const neigh = adj.get(cur);
    let next = -1;
    for (const n of neigh) {
      if (n === prev) continue;
      if (n === start && chain.length >= 3) { next = -2; break; }   // closed
      if (!visited.has(n)) { next = n; break; }
    }
    if (next === -1 || next === -2) break;
    chain.push(next); visited.add(next);
    prev = cur; cur = next;
  }
  if (chain.length < 4) return null;

  // Elliptical inner-star mask. Half-axes calibrated to enclose the
  // inner bay's left/right/top/bottom while excluding all outer-
  // perimeter vertices. Vertical axis stretched downward because the
  // inner star drops a long tip past the fade centre.
  const hAxis    = halfExtent * 0.65;
  const vAxisUp  = halfExtent * 0.62;
  const vAxisDn  = halfExtent * 0.92;
  function inside(pt) {
    const dx = pt.x - fxMesh;
    const dy = pt.y - fyMesh;
    const va = dy >= 0 ? vAxisUp : vAxisDn;
    return (dx * dx) / (hAxis * hAxis) + (dy * dy) / (va * va) < 1;
  }

  // Find the longest contiguous inside-arc on the chain. Chain is
  // closed-ish (we treat it as a cycle), so wrap when scanning.
  const N = chain.length;
  const flags = new Uint8Array(N);
  for (let i = 0; i < N; i++) flags[i] = inside(wpts[chain[i]]) ? 1 : 0;

  let bestStart = -1, bestLen = 0;
  let i = 0;
  while (i < N) {
    if (!flags[i]) { i++; continue; }
    // Found a run starting at i. Walk forward.
    let j = i;
    while (j < N && flags[j]) j++;
    let len = j - i;
    let runStart = i;
    // If the run wraps (started at 0 AND ends at N), check if there's
    // a run ending at N-1 that wraps into this one.
    if (i === 0) {
      let k = N - 1;
      while (k >= 0 && flags[k]) k--;
      const wrapLen = (N - 1 - k);
      if (wrapLen > 0 && k < N - 1) {
        len += wrapLen;
        runStart = k + 1;
      }
    }
    if (len > bestLen) { bestLen = len; bestStart = runStart; }
    i = j + 1;
  }
  if (bestLen < 4) return null;

  // Materialize the arc and close with a chord (the chord crosses the
  // bay's neck, sealing the polygon). RDP-simplify the result so
  // ExtrudeGeometry isn't fed thousands of points. Clamp every Y
  // coordinate to the model's actual bbox so the polygon — which
  // includes a chord that may dip slightly past the model bottom in
  // the chain's neck region — never extrudes outside the silhouette.
  const yFloor = meta.bbox.min.y + halfExtent * 0.02;
  const arc = [];
  for (let k = 0; k < bestLen; k++) {
    const p = wpts[chain[(bestStart + k) % N]];
    arc.push({ x: p.x, y: Math.max(p.y, yFloor) });
  }
  const tol = halfExtent * 0.005;
  return rdpClosedLoop(arc, tol);
}

function rdpClosedLoop(loop, tol) {
  if (loop.length < 4) return loop.slice();
  // Anchor at the two farthest-apart vertices for rotation stability.
  let i1 = 0, maxD = -1;
  for (let i = 1; i < loop.length; i++) {
    const dx = loop[i].x - loop[0].x, dy = loop[i].y - loop[0].y;
    const d = dx * dx + dy * dy;
    if (d > maxD) { maxD = d; i1 = i; }
  }
  const armA = [], armB = [];
  for (let k = 0;  k !== i1; k = (k + 1) % loop.length) armA.push(loop[k]);
  armA.push(loop[i1]);
  for (let k = i1; k !== 0;  k = (k + 1) % loop.length) armB.push(loop[k]);
  armB.push(loop[0]);
  return rdpOpen(armA, tol).slice(0, -1).concat(rdpOpen(armB, tol).slice(0, -1));
}
function rdpOpen(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = true; keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    if (e <= s + 1) continue;
    const a = pts[s], b = pts[e];
    const dx = b.x - a.x, dy = b.y - a.y;
    const denom = Math.hypot(dx, dy) || 1;
    let maxD = -1, maxI = -1;
    for (let i = s + 1; i < e; i++) {
      const p = pts[i];
      const d = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / denom;
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > tol) { keep[maxI] = true; stack.push([s, maxI]); stack.push([maxI, e]); }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

// -----------------------------------------------------------------------
// FLAME BODY — extruded cutout shape + domain-warped fbm shader.
// -----------------------------------------------------------------------
function buildFlameBody({ cutoutLoop, vpX, vpY, minY, maxY, halfWidth, zBack, zFront }) {
  const shape = new THREE.Shape();
  shape.moveTo(cutoutLoop[0].x, cutoutLoop[0].y);
  for (let i = 1; i < cutoutLoop.length; i++) {
    shape.lineTo(cutoutLoop[i].x, cutoutLoop[i].y);
  }
  shape.closePath();

  // ExtrudeGeometry extrudes from z=0 to z=depth; translate so the slab
  // spans [zBack, zFront].
  const zDepth = Math.max(0.1, zFront - zBack);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: zDepth,
    bevelEnabled: false,
    curveSegments: 24,
  });
  geo.translate(0, 0, zBack);

  const cfg = ANIM.flame;
  // Lift the top of the t-mapping above the vanishing point so the flame
  // visibly reaches into the polygon's headroom (the inner-star tips) —
  // makes it read taller without changing geometry.
  const topExtendFrac = (cfg.topExtendFrac ?? 0);
  const effTopY = vpY + Math.max(0, maxY - vpY) * topExtendFrac;
  const uniforms = {
    uTime:            { value: 0 },
    uBottomY:         { value: minY },
    uVanishingY:      { value: effTopY },
    uVanishingX:      { value: vpX },
    uHalfWidth:       { value: halfWidth },
    uZCenter:         { value: (zBack + zFront) * 0.5 },
    uZHalfDepth:      { value: zDepth * 0.5 },
    uColorBottom:     { value: new THREE.Vector3(...hexToRgb(cfg.colorBottom)) },
    uColorMid:        { value: new THREE.Vector3(...hexToRgb(cfg.colorMid)) },
    uColorTop:        { value: new THREE.Vector3(...hexToRgb(cfg.colorTop)) },
    uNoiseScale:      { value: cfg.noiseScale },
    uNoiseSpeed:      { value: cfg.noiseSpeed },
    uWarpStrength:    { value: cfg.warpStrength },
    uTaperPower:      { value: cfg.taperPower },
    uEdgeSoft:        { value: cfg.edgeSoftness },
    uThreshLow:       { value: cfg.threshLow },
    uThreshHigh:      { value: cfg.threshHigh },
    uColHalfBase:     { value: cfg.bodyHalfWidthBase },
    uColHalfTop:      { value: cfg.bodyHalfWidthTop },
    uColWobble:       { value: cfg.columnWobble },
    uWidthNoiseAmt:   { value: cfg.widthNoiseAmt },
    uWidthNoiseFreq:  { value: cfg.widthNoiseFreq },
    uColEdgeSoft:     { value: cfg.columnEdgeSoft },
    uBottomFadeFrac:  { value: cfg.bottomFadeFrac },
    uBrightness:      { value: cfg.brightness },
    uOpacity:         { value: cfg.opacity },
    uFlareColor:      { value: new THREE.Vector3(0, 0, 0) },
    uFlareIntensity:  { value: 0 },
    uFlareYMax:       { value: cfg.flares.yMax },
    uShimmerEnabled:  { value: cfg.shimmer.enabled ? 1 : 0 },
    uShimmerIntensity:{ value: cfg.shimmer.intensity },
    uShimmerYMax:     { value: cfg.shimmer.yMax },
    uShimmerSpeed:    { value: cfg.shimmer.speed },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest:  true,
    side:       THREE.DoubleSide,
    blending:   THREE.AdditiveBlending,
    vertexShader: `
      varying vec3 vLocalPos;
      void main() {
        vLocalPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uBottomY;
      uniform float uVanishingY;
      uniform float uVanishingX;
      uniform float uHalfWidth;
      uniform float uZCenter;
      uniform float uZHalfDepth;
      uniform vec3  uColorBottom;
      uniform vec3  uColorMid;
      uniform vec3  uColorTop;
      uniform float uNoiseScale;
      uniform float uNoiseSpeed;
      uniform float uWarpStrength;
      uniform float uTaperPower;
      uniform float uEdgeSoft;
      uniform float uThreshLow;
      uniform float uThreshHigh;
      uniform float uColHalfBase;
      uniform float uColHalfTop;
      uniform float uColWobble;
      uniform float uWidthNoiseAmt;
      uniform float uWidthNoiseFreq;
      uniform float uColEdgeSoft;
      uniform float uBottomFadeFrac;
      uniform float uBrightness;
      uniform float uOpacity;
      uniform vec3  uFlareColor;
      uniform float uFlareIntensity;
      uniform float uFlareYMax;
      uniform int   uShimmerEnabled;
      uniform float uShimmerIntensity;
      uniform float uShimmerYMax;
      uniform float uShimmerSpeed;
      varying vec3  vLocalPos;

      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float vnoise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i),                  hash21(i + vec2(1.0, 0.0)), u.x),
                   mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm2(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * vnoise2(p);
          p = p * 2.05 + vec2(17.0, 31.0);
          a *= 0.5;
        }
        return v;
      }

      void main() {
        // Height fraction t — 0 at cutout's bottom, 1 at vanishing point.
        // Flame body exists in t in [0, ~1.05]; fragments outside are
        // discarded so the front/back caps of the extruded slab don't
        // colour-bomb past the vanishing point.
        float yRange = max(uVanishingY - uBottomY, 0.001);
        float t = (vLocalPos.y - uBottomY) / yRange;
        if (t < -0.05 || t > 1.15) discard;
        float tClamp = clamp(t, 0.0, 1.0);

        // Sample point: scroll downward over time so the noise pattern
        // appears to lick UPWARD; z perturbs the 2D field so the slab's
        // front/back faces aren't identical (gives a fake-volumetric look
        // through additive blending of front + back caps + side walls).
        vec2 sp = (vec2(vLocalPos.x, vLocalPos.y - uTime * uNoiseSpeed)
                   + vec2(vLocalPos.z * 0.6, vLocalPos.z * 0.2)) * uNoiseScale;

        // Domain-warped fbm — gives the licking, organic flame look.
        vec2 q = vec2(fbm2(sp), fbm2(sp + vec2(5.2, 1.3)));
        float n = fbm2(sp + uWarpStrength * q);

        // Vertical falloff — flame intensity drops toward the vanishing
        // point. Higher taperPower = sharper narrowing near the tip.
        // Applied as a FINAL alpha multiplier (after thresholding) so
        // every height keeps the same noise visibility, just dimmer
        // toward the tip — instead of the threshold gating cutting out
        // most of the upper body.
        float vTaper = pow(1.0 - tClamp, uTaperPower);

        // Narrow flame column. The cutout polygon is very wide (the
        // logo's inner-star bay), so we don't fade against the polygon
        // edge — we fade against a slim vertical column centered on the
        // vanishing-point X. The column's centerline wobbles laterally
        // and its width modulates per-row, both driven by fbm so the
        // silhouette curls organically instead of running as straight
        // sides. Width tapers from base → top so the flame points.
        float colHalfFrac = mix(uColHalfBase, uColHalfTop, tClamp);
        float wobbleN = fbm2(vec2(11.7, vLocalPos.y * 0.14 - uTime * 1.5));
        float xCenter = uVanishingX
                      + (wobbleN - 0.5) * 2.0 * uColWobble * uHalfWidth;
        float widthN = fbm2(vec2(vLocalPos.y * uWidthNoiseFreq + uTime * 0.7,
                                  vLocalPos.z * 0.25 + 4.1));
        float widthScale = 1.0 + (widthN - 0.5) * 2.0 * uWidthNoiseAmt;
        float colHalfWidth = uHalfWidth * colHalfFrac * max(widthScale, 0.15);
        float xRel = (vLocalPos.x - xCenter) / max(colHalfWidth, 0.001);
        float xFade = 1.0 - smoothstep(1.0 - uColEdgeSoft, 1.0, abs(xRel));

        // Threshold the raw noise (uniform across the body), then
        // combine with vertical + horizontal soft fades. (Earlier
        // versions added a z-distance-from-body-centre fade to soften
        // the front/back caps of the extrusion — but that wiped out
        // the front face entirely, since the camera-facing face has
        // zRel == 1 and was getting multiplied by zero. Without the
        // z-fade the front face renders the noise pattern directly.)
        float intensity = smoothstep(uThreshLow, uThreshHigh, n);
        intensity *= vTaper;
        intensity *= xFade;
        intensity *= smoothstep(1.05, 0.85, t);   // top fade — flame
                                                  // dies out at vanishing
                                                  // point.
        intensity *= smoothstep(0.0, max(uBottomFadeFrac, 0.001), t);
                                                  // bottom fade — wick
                                                  // area is dark, body
                                                  // ramps in over the
                                                  // first uBottomFadeFrac
                                                  // of height.

        if (intensity <= 0.001) discard;

        // Vertical colour gradient: bottom (hot yellow) -> mid (orange)
        // -> top (deep red).
        vec3 base;
        if (tClamp < 0.5) {
          base = mix(uColorBottom, uColorMid, tClamp / 0.5);
        } else {
          base = mix(uColorMid,    uColorTop, (tClamp - 0.5) / 0.5);
        }

        // Continuous chromatic shimmer in the hot zone — separate noise
        // octave + time gives a rolling cool-tinted flicker that's always
        // present at low t. Mask = 1 at t=0 (full hot zone), 0 at t=yMax.
        // ("1 - smoothstep(lo, hi, t)" is the safe form for fading with
        // increasing t — GLSL smoothstep with reversed edge args is
        // undefined behaviour.)
        if (uShimmerEnabled == 1 && t < uShimmerYMax) {
          float shimmerMask = 1.0 - smoothstep(uShimmerYMax * 0.4, uShimmerYMax, t);
          float sn = fbm2(sp * 1.7 + vec2(0.0, uTime * uShimmerSpeed));
          float hueShift = sn * 2.0 - 1.0;
          vec3 cool = vec3(0.4 + hueShift * 0.3,
                           0.6 - abs(hueShift) * 0.2,
                           0.9 + hueShift * 0.1);
          float shimmerAmt = uShimmerIntensity * shimmerMask
                           * smoothstep(0.50, 0.85, sn);
          base = mix(base, cool, shimmerAmt);
        }

        // Rare brighter chromatic flare — the JS update picks a colour
        // and ramps uFlareIntensity up + down over a 1-2 sec envelope.
        // Spatial pattern via a second high-frequency noise so the flare
        // reads as a tongue not a flat wash.
        if (uFlareIntensity > 0.001 && t < uFlareYMax) {
          float flareMask = 1.0 - smoothstep(uFlareYMax * 0.3, uFlareYMax, t);
          float fn = fbm2(sp * 2.4 + vec2(11.7, uTime * 0.8));
          float flareAmt = uFlareIntensity * flareMask
                         * smoothstep(0.45, 0.85, fn);
          base = mix(base, uFlareColor, flareAmt);
        }

        vec3 color = base * intensity * uBrightness;
        gl_FragColor = vec4(color, intensity * uOpacity);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 6;
  return { mesh, uniforms };
}

// -----------------------------------------------------------------------
// SPARKS — GPU points looping independently along the flame height.
// Each particle has a fixed spawn (x, y) within the cutout and rises
// upward over its lifetime, with sinusoidal sway. Loop modelled after
// src/particles.js (mod-time phase, ease curve, fade-in/out).
// -----------------------------------------------------------------------
function buildSparks({ cutoutLoop, vpX, vpY, minY, maxY, zBack, zFront, renderer }) {
  const cfg = ANIM.flame.sparks;
  const count = cfg.count | 0;
  if (count <= 0) return null;

  const yRange = Math.max(maxY - minY, 0.001);
  const xs = new Float32Array(count);
  const ys = new Float32Array(count);
  const zs = new Float32Array(count);
  const randoms = new Float32Array(count);
  const lifeScales = new Float32Array(count);
  const sizes = new Float32Array(count);

  // Pre-compute cutout polygon Y-row spans for rejection-style sampling.
  // For each candidate (rx, ry) drawn uniformly from the cutout's bbox
  // weighted toward upper Y, accept only if inside the polygon. With ~50
  // attempts max we'll always find a point.
  let bboxMinX = Infinity, bboxMaxX = -Infinity;
  for (const p of cutoutLoop) {
    if (p.x < bboxMinX) bboxMinX = p.x;
    if (p.x > bboxMaxX) bboxMaxX = p.x;
  }

  function pointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Rejection sample inside the cutout polygon, biased toward the upper
  // portion (sparks denser near the top). spawnYMin..spawnYMax fractions
  // map onto (minY..maxY).
  const yLo = minY + (maxY - minY) * cfg.spawnYMin;
  const yHi = minY + (maxY - minY) * cfg.spawnYMax;
  for (let i = 0; i < count; i++) {
    let attempts = 0;
    let placed = false;
    while (!placed && attempts < 80) {
      // Bias upward: bias = u^0.6 so the upper band gets more samples.
      const u = Math.pow(Math.random(), 0.6);
      const ry = yLo + u * (yHi - yLo);
      const rx = bboxMinX + Math.random() * (bboxMaxX - bboxMinX);
      if (pointInPolygon(rx, ry, cutoutLoop)) {
        xs[i] = rx;
        ys[i] = ry;
        zs[i] = zBack + Math.random() * (zFront - zBack);
        placed = true;
      }
      attempts++;
    }
    if (!placed) {
      // Fallback: drop on the vanishing-point column.
      xs[i] = vpX;
      ys[i] = yLo + Math.random() * (yHi - yLo);
      zs[i] = (zBack + zFront) * 0.5;
    }
    randoms[i] = Math.random();
    lifeScales[i] = 1 + (Math.random() * 2 - 1) * cfg.lifeVariance;
    if (lifeScales[i] < 0.2) lifeScales[i] = 0.2;
    // Bigger hero sparks rare; mostly fine dust.
    const r = Math.random();
    let s;
    if (r < 0.08) s = 1.6 + Math.random() * 1.4;
    else if (r < 0.3) s = 0.9 + Math.random() * 0.7;
    else s = 0.3 + Math.random() * 0.6;
    sizes[i] = s * (1 + (Math.random() * 2 - 1) * cfg.sizeVariance);
    if (sizes[i] < 0.1) sizes[i] = 0.1;
  }

  // Pack initial positions into one attribute. The shader treats this as
  // the spawn point; the rise + sway are computed per-frame in the shader
  // from uniforms + per-particle randoms.
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3]     = xs[i];
    positions[i * 3 + 1] = ys[i];
    positions[i * 3 + 2] = zs[i];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aRandom',  new THREE.BufferAttribute(randoms, 1));
  geometry.setAttribute('aLife',    new THREE.BufferAttribute(lifeScales, 1));
  geometry.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1));

  const uniforms = {
    uTime:          { value: 0 },
    uPixelRatio:    { value: renderer.getPixelRatio() },
    uCycleDuration: { value: cfg.cycleDuration },
    uRiseDistance:  { value: cfg.riseDistance },
    uSwayAmount:    { value: cfg.swayAmount },
    uSwayFreq:      { value: cfg.swayFreq },
    uPointSize:     { value: cfg.pointSize },
    uVanishingY:    { value: vpY },
    uBodyColor:     { value: new THREE.Vector3(...hexToRgb(cfg.bodyColor)) },
    uCoreColor:     { value: new THREE.Vector3(...hexToRgb(cfg.coreColor)) },
    uBrightness:    { value: cfg.brightness },
    uOpacity:       { value: 1.0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest:  true,
    blending:   THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uCycleDuration;
      uniform float uRiseDistance;
      uniform float uSwayAmount;
      uniform float uSwayFreq;
      uniform float uPointSize;
      uniform float uVanishingY;
      attribute float aRandom;
      attribute float aLife;
      attribute float aSize;
      varying float vAlpha;
      varying float vT;

      void main() {
        float cycle = uCycleDuration * aLife;
        float t = mod(uTime + aRandom * cycle, cycle) / cycle;

        // Rise: ease-out so sparks decelerate as they climb (cooling).
        float ease = 1.0 - pow(1.0 - t, 1.6);
        vec3 pos = position;
        pos.y += ease * uRiseDistance;
        // Cap the rise at the vanishing point so sparks don't fly past
        // the visible cutout.
        if (pos.y > uVanishingY) pos.y = uVanishingY - 0.05;
        // Horizontal sway — sinusoidal, phase from aRandom.
        pos.x += sin(uTime * uSwayFreq + aRandom * 31.4) * uSwayAmount * t;
        pos.z += cos(uTime * uSwayFreq * 0.7 + aRandom * 17.3) * uSwayAmount * 0.5 * t;

        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;

        // Size + flicker — sparks shrink as they rise.
        float sizeCurve = (1.0 - 0.5 * t);
        float flicker = 0.7 + 0.3 * sin(uTime * 4.0 + aRandom * 6.28);
        gl_PointSize = max(aSize * uPointSize * sizeCurve * flicker
                           * uPixelRatio * (1.0 / -mv.z), 1.0);

        // Fade in fast, fade out gradually.
        float fadeIn  = smoothstep(0.0, 0.08, t);
        float fadeOut = 1.0 - smoothstep(0.55, 1.0, t);
        vAlpha = fadeIn * fadeOut;
        vT = t;
      }
    `,
    fragmentShader: `
      uniform vec3 uBodyColor;
      uniform vec3 uCoreColor;
      uniform float uBrightness;
      uniform float uOpacity;
      varying float vAlpha;
      varying float vT;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float core = 1.0 - smoothstep(0.0, 0.14, d);
        float halo = 1.0 - smoothstep(0.0, 0.5, d);
        halo = pow(halo, 1.8);
        // Sparks cool as they rise — mix toward body colour at end of life.
        vec3 col = mix(uCoreColor, uBodyColor, vT * 0.7);
        col += uCoreColor * core * 0.6;
        gl_FragColor = vec4(col * uBrightness, halo * vAlpha * uOpacity);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 7;
  return { points, uniforms };
}

// -----------------------------------------------------------------------
// FLICKERING POINT LIGHT — sits at the flame's hot zone, modulated by
// sine + stochastic noise. Picks up the flare colour during a flare
// envelope so the surrounding inner-cutout walls glow cool with the
// chromatic flame.
// -----------------------------------------------------------------------
function buildLight({ vpX, minY, maxY, maxZ }) {
  const cfg = ANIM.flame.light;
  if (!cfg.enabled) return null;
  const lightY = minY + (maxY - minY) * cfg.yFraction;
  const light = new THREE.PointLight(
    new THREE.Color(cfg.color),
    cfg.intensityMin,
    0,            // distance: 0 = unlimited
    cfg.decay,
  );
  // Place INSIDE the cutout volume (behind the front face). With
  // zOffsetFromFront negative, the light sits at maxZ + offset, which
  // is < maxZ and therefore inside the model's depth.
  light.position.set(vpX, lightY, maxZ + cfg.zOffsetFromFront);
  // Default off — main.js sets it true only while viewMode === 'flame'.
  // Three.js checks light.visible directly, not the parent group's, so
  // this needs to be explicit.
  light.visible = false;
  return light;
}

// -----------------------------------------------------------------------
// PUBLIC: createFlame
//   meta — the silhouette/centroid bundle from src/logo.js#computeSilhouetteMeta.
//   renderer — passed through for pixel-ratio in the spark shader.
//
// Returns { group, update, light, flameMesh, sparkPoints }. Caller adds
// `group` to the logoMesh and calls `update(t, dt)` from the per-frame
// tick. `group.visible` is the on/off switch — main.js gates it on
// view mode.
// -----------------------------------------------------------------------
export function createFlame({ logoMesh, meta, renderer }) {
  const { patternFadeCenter, cx, cy, maxZ } = meta;
  const group = new THREE.Group();
  group.name = 'flame';
  group.position.set(cx, cy, 0);
  group.visible = false;

  // Extract the inner-star cutout outline directly from the model's edges.
  // The default silhouette walk in src/logo.js folds the inner cutout into
  // the outer perimeter for this model, so we sidestep it here using an
  // EdgesGeometry-based chain bounded by an elliptical mask centred on
  // the fade centre (same isolation strategy as src/particles.js).
  const cutoutMeshLocal = extractInnerCutout(logoMesh, meta);
  if (!cutoutMeshLocal || cutoutMeshLocal.length < 4) {
    console.warn('[flame] could not extract inner cutout; flame disabled');
    return { group, update: () => {}, light: null, flameMesh: null, sparkPoints: null };
  }
  // Convert mesh-local -> flame-local (flame group sits at (cx, cy, 0)).
  const cutoutLoop = cutoutMeshLocal.map(p => ({ x: p.x - cx, y: p.y - cy }));

  // Cutout extents (flame-local).
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of cutoutLoop) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const halfWidth = (maxX - minX) * 0.5;

  // Vanishing point (flame-local). patternFadeCenter is already
  // panel-local (mesh-local minus (cx, cy)), which is exactly what we
  // want here.
  const vpX = patternFadeCenter[0];
  const vpY = patternFadeCenter[1];

  const cfg = ANIM.flame;
  const zBack  = maxZ + cfg.zBack;
  const zFront = maxZ + cfg.zFront;

  // Body
  const body = buildFlameBody({ cutoutLoop, vpX, vpY, minY, maxY, halfWidth, zBack, zFront });
  group.add(body.mesh);

  // Sparks
  const sparks = buildSparks({ cutoutLoop, vpX, vpY, minY, maxY, zBack, zFront, renderer });
  if (sparks) group.add(sparks.points);

  // Light
  const light = buildLight({ vpX, minY, maxY, maxZ });
  if (light) group.add(light);

  // ----- Flare envelope state (shared between body + light) -----
  let flareEndTime = -1;
  let flareStartTime = -1;
  const flareColorVec = new THREE.Vector3(0, 0, 0);
  const tmpColor = new THREE.Color();
  const baseLightColor = new THREE.Color(cfg.light.color);
  const coolLightColor = new THREE.Color(cfg.light.coolColor);
  const flareLightColor = new THREE.Color();
  const lerpedLightColor = new THREE.Color();

  function update(t, dt) {
    // Body shader time
    body.uniforms.uTime.value = t;

    // Spark uniforms — hot-swap so devtools edits to ANIM.flame.sparks.*
    // take effect immediately (count + spawn pos are load-only).
    if (sparks) {
      const sc = ANIM.flame.sparks;
      sparks.uniforms.uTime.value          = t;
      sparks.uniforms.uCycleDuration.value = sc.cycleDuration;
      sparks.uniforms.uRiseDistance.value  = sc.riseDistance;
      sparks.uniforms.uSwayAmount.value    = sc.swayAmount;
      sparks.uniforms.uSwayFreq.value      = sc.swayFreq;
      sparks.uniforms.uPointSize.value     = sc.pointSize;
      sparks.uniforms.uBrightness.value    = sc.brightness;
      sparks.uniforms.uBodyColor.value.fromArray(hexToRgb(sc.bodyColor));
      sparks.uniforms.uCoreColor.value.fromArray(hexToRgb(sc.coreColor));
    }

    // Hot-swap body uniforms that are cheap to push every frame so the
    // user can tweak them in devtools.
    const bcfg = ANIM.flame;
    body.uniforms.uNoiseScale.value   = bcfg.noiseScale;
    body.uniforms.uNoiseSpeed.value   = bcfg.noiseSpeed;
    body.uniforms.uWarpStrength.value = bcfg.warpStrength;
    body.uniforms.uTaperPower.value   = bcfg.taperPower;
    body.uniforms.uEdgeSoft.value     = bcfg.edgeSoftness;
    body.uniforms.uThreshLow.value    = bcfg.threshLow;
    body.uniforms.uThreshHigh.value   = bcfg.threshHigh;
    body.uniforms.uColHalfBase.value    = bcfg.bodyHalfWidthBase;
    body.uniforms.uColHalfTop.value     = bcfg.bodyHalfWidthTop;
    body.uniforms.uColWobble.value      = bcfg.columnWobble;
    body.uniforms.uWidthNoiseAmt.value  = bcfg.widthNoiseAmt;
    body.uniforms.uWidthNoiseFreq.value = bcfg.widthNoiseFreq;
    body.uniforms.uColEdgeSoft.value    = bcfg.columnEdgeSoft;
    body.uniforms.uBottomFadeFrac.value = bcfg.bottomFadeFrac;
    // Recompute effective top Y from current topExtendFrac so live
    // tweaks in devtools take effect.
    const teFrac = bcfg.topExtendFrac ?? 0;
    body.uniforms.uVanishingY.value = vpY + Math.max(0, maxY - vpY) * teFrac;
    body.uniforms.uBrightness.value   = bcfg.brightness;
    body.uniforms.uOpacity.value      = bcfg.opacity;
    body.uniforms.uShimmerEnabled.value   = bcfg.shimmer.enabled ? 1 : 0;
    body.uniforms.uShimmerIntensity.value = bcfg.shimmer.intensity;
    body.uniforms.uShimmerYMax.value      = bcfg.shimmer.yMax;
    body.uniforms.uShimmerSpeed.value     = bcfg.shimmer.speed;
    body.uniforms.uColorBottom.value.fromArray(hexToRgb(bcfg.colorBottom));
    body.uniforms.uColorMid.value.fromArray(hexToRgb(bcfg.colorMid));
    body.uniforms.uColorTop.value.fromArray(hexToRgb(bcfg.colorTop));
    body.uniforms.uFlareYMax.value = bcfg.flares.yMax;

    // ----- Chromatic flare envelope -----
    // Pick a new flare with rate-based Bernoulli probability per frame
    // when none is active. Envelope: 0 → peak (at 25 % through) → 0.
    const fcfg = bcfg.flares;
    let flareEnv = 0;
    if (fcfg.enabled) {
      if (t > flareEndTime && fcfg.palette && fcfg.palette.length > 0) {
        const prob = (fcfg.rate || 0) * dt;
        if (Math.random() < prob) {
          const pick = fcfg.palette[(Math.random() * fcfg.palette.length) | 0];
          tmpColor.set(pick);
          flareColorVec.set(tmpColor.r, tmpColor.g, tmpColor.b);
          body.uniforms.uFlareColor.value.copy(flareColorVec);
          flareLightColor.copy(tmpColor);
          flareStartTime = t;
          flareEndTime   = t + (fcfg.duration || 1.0);
        }
      }
      if (t <= flareEndTime && t >= flareStartTime) {
        const totalDur = Math.max(fcfg.duration || 1.0, 0.01);
        const u = (t - flareStartTime) / totalDur;
        // Smooth bell — peak near 0.25, longer decay tail.
        flareEnv = u < 0.25
          ? (u / 0.25)
          : Math.max(0, 1.0 - (u - 0.25) / 0.75);
        body.uniforms.uFlareIntensity.value = (fcfg.intensity || 0) * flareEnv;
      } else {
        body.uniforms.uFlareIntensity.value = 0;
      }
    }

    // ----- Light flicker -----
    if (light) {
      const lc = ANIM.flame.light;
      // Sine + stochastic noise — gives the candle-like irregular flicker.
      const sineWave  = 0.5 + 0.5 * Math.sin(t * lc.flickerSpeed * 6.28
                                              + Math.sin(t * lc.flickerSpeed * 1.7) * 1.3);
      const stochastic = Math.random();   // per-frame jitter
      const flickerK   = (1 - lc.flickerJitter) * sineWave
                       + lc.flickerJitter * stochastic;
      let intensity = lc.intensityMin + (lc.intensityMax - lc.intensityMin) * flickerK;
      // Flare boost — adds extra intensity during a flare.
      intensity += (lc.flareIntensityBoost || 0) * flareEnv;
      light.intensity = intensity;
      light.decay     = lc.decay;

      // Colour: lerp from base toward flare colour during a flare, with
      // a cool tint mid-envelope for that "cooled flame" read.
      if (flareEnv > 0.001) {
        // Blend base → coolColor → flarePickedColor based on envelope.
        // At low envelope, mostly base (warm). At peak, mostly flare colour
        // (the picked palette colour).
        lerpedLightColor.copy(baseLightColor);
        lerpedLightColor.lerp(coolLightColor, flareEnv * 0.5);
        lerpedLightColor.lerp(flareLightColor, flareEnv * 0.7);
        light.color.copy(lerpedLightColor);
      } else {
        light.color.copy(baseLightColor);
      }
    }
  }

  return {
    group,
    update,
    light,
    flameMesh: body.mesh,
    sparkPoints: sparks ? sparks.points : null,
    sparkOpacity: sparks ? sparks.uniforms.uOpacity : null,
  };
}
