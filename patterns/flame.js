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

// Merge a secondary-flame override block onto the main-flame cfg. Top-
// level fields override directly. Nested blocks (shimmer, flares) are
// shallow-merged so the secondary can disable shimmer without having
// to redeclare every shimmer field. Returns a fresh object — does not
// mutate either input.
function mergeFlameCfg(main, override) {
  const out = { ...main, ...override };
  out.shimmer = { ...main.shimmer, ...(override.shimmer || {}) };
  out.flares  = { ...main.flares,  ...(override.flares  || {}) };
  return out;
}

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
function buildFlameBody({ cutoutLoop, vpX, vpY, minY, maxY, halfWidth, zBack, zFront, cfg }) {
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
    uBottomRoundFrac: { value: cfg.bottomRoundFrac ?? 0 },
    uWaistY:          { value: cfg.waistY ?? 0.25 },
    uWaistAmt:        { value: cfg.waistAmt ?? 0 },
    uWaistWidth:      { value: cfg.waistWidth ?? 0.18 },
    uWaist2Y:         { value: cfg.waist2Y ?? 0.60 },
    uWaist2Amt:       { value: cfg.waist2Amt ?? 0 },
    uWaist2Width:     { value: cfg.waist2Width ?? 0.10 },
    uBranchSep:           { value: cfg.branching?.separation     ?? 0   },
    uBranchFreqY:         { value: cfg.branching?.freqY          ?? 0.05 },
    uBranchSpeed:         { value: cfg.branching?.speed          ?? 0.18 },
    uBranchPresenceThresh:{ value: cfg.branching?.presenceThresh ?? 0.55 },
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
      uniform float uBottomRoundFrac;
      uniform float uWaistY;
      uniform float uWaistAmt;
      uniform float uWaistWidth;
      uniform float uWaist2Y;
      uniform float uWaist2Amt;
      uniform float uWaist2Width;
      uniform float uBranchSep;
      uniform float uBranchFreqY;
      uniform float uBranchSpeed;
      uniform float uBranchPresenceThresh;
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
        // Optional Gaussian "waist" pinch at uWaistY — multiplicative
        // narrowing of the column at a chosen height fraction. Used to
        // squeeze the flame in the yellow→orange transition zone so the
        // bright base flares out then necks in before fanning back up.
        float wDx = (tClamp - uWaistY) / max(uWaistWidth, 0.001);
        float waistFactor = 1.0 - uWaistAmt * exp(-wDx * wDx);
        colHalfFrac *= max(waistFactor, 0.05);
        // Second narrower waist higher up — used to keep the column off
        // the inner-star polygon's neck (where the cutout pinches in
        // and the flame would otherwise touch the logo silhouette).
        // Independent height/amount/width so the lower waist isn't
        // affected.
        float w2Dx = (tClamp - uWaist2Y) / max(uWaist2Width, 0.001);
        float waist2Factor = 1.0 - uWaist2Amt * exp(-w2Dx * w2Dx);
        colHalfFrac *= max(waist2Factor, 0.05);
        float wobbleN = fbm2(vec2(11.7, vLocalPos.y * 0.14 - uTime * 1.5));
        float xCenter = uVanishingX
                      + (wobbleN - 0.5) * 2.0 * uColWobble * uHalfWidth;
        float widthN = fbm2(vec2(vLocalPos.y * uWidthNoiseFreq + uTime * 0.7,
                                  vLocalPos.z * 0.25 + 4.1));
        float widthScale = 1.0 + (widthN - 0.5) * 2.0 * uWidthNoiseAmt;
        float colHalfWidth = uHalfWidth * colHalfFrac * max(widthScale, 0.15);

        // Branching — a slow noise gates whether the column splits into
        // two centers offset by ±branchSep from xCenter. When branchAmp
        // is 0 the columns coincide (one flame); as it ramps up the
        // centers spread apart and the flame visibly bifurcates. The
        // gating uses |branchN-0.5| above a threshold so most of the
        // time only the central column is active.
        float branchN = fbm2(vec2(vLocalPos.y * uBranchFreqY + uTime * uBranchSpeed,
                                   uTime * uBranchSpeed * 0.6));
        float branchAmp = smoothstep(uBranchPresenceThresh, 1.0,
                                      abs(branchN - 0.5) * 2.0);
        float branchHalfSep = branchAmp * uBranchSep * uHalfWidth;
        float xRel1 = (vLocalPos.x - (xCenter - branchHalfSep)) / max(colHalfWidth, 0.001);
        float xRel2 = (vLocalPos.x - (xCenter + branchHalfSep)) / max(colHalfWidth, 0.001);
        float xFade1 = 1.0 - smoothstep(1.0 - uColEdgeSoft, 1.0, abs(xRel1));
        float xFade2 = 1.0 - smoothstep(1.0 - uColEdgeSoft, 1.0, abs(xRel2));
        // Take whichever column "owns" this pixel — preserves the soft
        // edge on each side without flattening the centre when the
        // columns merge.
        float xFade = max(xFade1, xFade2);
        // For the rounded-bottom dome, use the closer column's xRel so
        // each branch gets its own dome instead of one huge dome
        // spanning both.
        float xRel = abs(xRel1) < abs(xRel2) ? xRel1 : xRel2;

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
        // Rounded bottom — instead of a flat horizontal fade at t=0,
        // shape the bottom edge into a half-circle dome of t-radius
        // uBottomRoundFrac. Column-center pixels reach full intensity
        // earliest; column-edge pixels (xRel near 1) fade in last,
        // giving a domed/teardrop bottom rather than a hard cut. The
        // fade band of width uBottomFadeFrac softens the dome's edge.
        float xRound = clamp(abs(xRel), 0.0, 1.0);
        float bottomDome = uBottomRoundFrac
                         * (1.0 - sqrt(max(0.0, 1.0 - xRound * xRound)));
        intensity *= smoothstep(bottomDome,
                                bottomDome + max(uBottomFadeFrac, 0.001),
                                t);

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
  return { mesh, uniforms, vpY, maxY };
}

// Push live config values into a body's uniforms each frame. `cfg` is
// the live block to read from (ANIM.flame for the main flame; a merged
// override block for the secondary). The body's stored vpY/maxY are
// used to recompute uVanishingY from the live topExtendFrac.
function applyBodyUniforms(body, cfg) {
  const u = body.uniforms;
  u.uNoiseScale.value     = cfg.noiseScale;
  u.uNoiseSpeed.value     = cfg.noiseSpeed;
  u.uWarpStrength.value   = cfg.warpStrength;
  u.uTaperPower.value     = cfg.taperPower;
  u.uEdgeSoft.value       = cfg.edgeSoftness;
  u.uThreshLow.value      = cfg.threshLow;
  u.uThreshHigh.value     = cfg.threshHigh;
  u.uColHalfBase.value    = cfg.bodyHalfWidthBase;
  u.uColHalfTop.value     = cfg.bodyHalfWidthTop;
  u.uColWobble.value      = cfg.columnWobble;
  u.uWidthNoiseAmt.value  = cfg.widthNoiseAmt;
  u.uWidthNoiseFreq.value = cfg.widthNoiseFreq;
  u.uColEdgeSoft.value    = cfg.columnEdgeSoft;
  u.uBottomFadeFrac.value = cfg.bottomFadeFrac;
  u.uBottomRoundFrac.value = cfg.bottomRoundFrac ?? 0;
  u.uWaistY.value         = cfg.waistY ?? 0.25;
  u.uWaistAmt.value       = cfg.waistAmt ?? 0;
  u.uWaistWidth.value     = cfg.waistWidth ?? 0.18;
  u.uWaist2Y.value        = cfg.waist2Y ?? 0.60;
  u.uWaist2Amt.value      = cfg.waist2Amt ?? 0;
  u.uWaist2Width.value    = cfg.waist2Width ?? 0.10;
  const br = cfg.branching || {};
  u.uBranchSep.value           = (br.enabled === false) ? 0 : (br.separation     ?? 0);
  u.uBranchFreqY.value         = br.freqY          ?? 0.05;
  u.uBranchSpeed.value         = br.speed          ?? 0.18;
  u.uBranchPresenceThresh.value = br.presenceThresh ?? 0.55;
  const teFrac = cfg.topExtendFrac ?? 0;
  u.uVanishingY.value = body.vpY + Math.max(0, body.maxY - body.vpY) * teFrac;
  u.uBrightness.value = cfg.brightness;
  u.uOpacity.value    = cfg.opacity;
  u.uShimmerEnabled.value   = cfg.shimmer.enabled ? 1 : 0;
  u.uShimmerIntensity.value = cfg.shimmer.intensity;
  u.uShimmerYMax.value      = cfg.shimmer.yMax;
  u.uShimmerSpeed.value     = cfg.shimmer.speed;
  u.uColorBottom.value.fromArray(hexToRgb(cfg.colorBottom));
  u.uColorMid.value.fromArray(hexToRgb(cfg.colorMid));
  u.uColorTop.value.fromArray(hexToRgb(cfg.colorTop));
  u.uFlareYMax.value = cfg.flares.yMax;
}

// -----------------------------------------------------------------------
// FLAME SHADOW — sibling slab using the SAME extruded cutout shape and
// SAME domain-warped fbm sample as buildFlameBody, but with multiplicative
// blending so the noise-driven dark gaps between visible flame tongues
// project as DARKER pixels onto whatever lies behind (the galaxy backdrop
// + inner cutout walls). Adds contrast — bright flame tongues now sit
// against a darkened halo instead of un-modified background.
// -----------------------------------------------------------------------
function buildFlameShadow({ cutoutLoop, vpX, vpY, minY, maxY, halfWidth, zBack, zFront, cfg }) {
  const shape = new THREE.Shape();
  shape.moveTo(cutoutLoop[0].x, cutoutLoop[0].y);
  for (let i = 1; i < cutoutLoop.length; i++) {
    shape.lineTo(cutoutLoop[i].x, cutoutLoop[i].y);
  }
  shape.closePath();

  const zDepth = Math.max(0.1, zFront - zBack);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: zDepth,
    bevelEnabled: false,
    curveSegments: 24,
  });
  geo.translate(0, 0, zBack);

  const sh = cfg.shadow || {};
  const uniforms = {
    uTime:            { value: 0 },
    uBottomY:         { value: minY },
    uVanishingY:      { value: vpY },
    uVanishingX:      { value: vpX },
    uHalfWidth:       { value: halfWidth },
    uNoiseScale:      { value: cfg.noiseScale },
    uNoiseSpeed:      { value: cfg.noiseSpeed },
    uWarpStrength:    { value: cfg.warpStrength },
    uThreshLow:       { value: cfg.threshLow },
    uThreshHigh:      { value: cfg.threshHigh },
    uColHalfBase:     { value: cfg.bodyHalfWidthBase },
    uColHalfTop:      { value: cfg.bodyHalfWidthTop },
    uWaistY:          { value: cfg.waistY ?? 0.25 },
    uWaistAmt:        { value: cfg.waistAmt ?? 0 },
    uWaistWidth:      { value: cfg.waistWidth ?? 0.18 },
    uWaist2Y:         { value: cfg.waist2Y ?? 0.60 },
    uWaist2Amt:       { value: cfg.waist2Amt ?? 0 },
    uWaist2Width:     { value: cfg.waist2Width ?? 0.10 },
    uHaloScale:       { value: sh.haloScale ?? 1.6 },
    uShadowIntensity: { value: sh.intensity ?? 0.55 },
    uShadowYMax:      { value: sh.yMax      ?? 0.85 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite:  false,
    depthTest:   true,
    side:        THREE.DoubleSide,
    blending:    THREE.MultiplyBlending,
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
      uniform float uNoiseScale;
      uniform float uNoiseSpeed;
      uniform float uWarpStrength;
      uniform float uThreshLow;
      uniform float uThreshHigh;
      uniform float uColHalfBase;
      uniform float uColHalfTop;
      uniform float uWaistY;
      uniform float uWaistAmt;
      uniform float uWaistWidth;
      uniform float uWaist2Y;
      uniform float uWaist2Amt;
      uniform float uWaist2Width;
      uniform float uHaloScale;
      uniform float uShadowIntensity;
      uniform float uShadowYMax;
      varying vec3 vLocalPos;

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
        float yRange = max(uVanishingY - uBottomY, 0.001);
        float t = (vLocalPos.y - uBottomY) / yRange;
        if (t < 0.0 || t > uShadowYMax) discard;

        // Same column mask as the body, slightly inflated by uHaloScale
        // so the shadow extends past the visible flame edges (the dark
        // halo wraps the flame).
        float colHalfFrac = mix(uColHalfBase, uColHalfTop, t);
        float wDx = (t - uWaistY) / max(uWaistWidth, 0.001);
        float waistFactor = 1.0 - uWaistAmt * exp(-wDx * wDx);
        colHalfFrac *= max(waistFactor, 0.05);
        float w2Dx = (t - uWaist2Y) / max(uWaist2Width, 0.001);
        float waist2Factor = 1.0 - uWaist2Amt * exp(-w2Dx * w2Dx);
        colHalfFrac *= max(waist2Factor, 0.05);
        float colHalfWidth = uHalfWidth * colHalfFrac * uHaloScale;
        float xRel = (vLocalPos.x - uVanishingX) / max(colHalfWidth, 0.001);
        float xFade = 1.0 - smoothstep(0.7, 1.0, abs(xRel));

        // Same domain-warped fbm as the body.
        vec2 sp = (vec2(vLocalPos.x, vLocalPos.y - uTime * uNoiseSpeed)
                   + vec2(vLocalPos.z * 0.6, vLocalPos.z * 0.2)) * uNoiseScale;
        vec2 q = vec2(fbm2(sp), fbm2(sp + vec2(5.2, 1.3)));
        float n = fbm2(sp + uWarpStrength * q);

        // Shadow strongest where the body would be DIM (low n). Inverse
        // of the body's intensity gating so dark gaps between bright
        // tongues become darkened halo pixels.
        float bodyIntensity = smoothstep(uThreshLow, uThreshHigh, n);
        float shadowMask = (1.0 - bodyIntensity) * xFade;
        // Trail off above the visible flame.
        shadowMask *= 1.0 - smoothstep(uShadowYMax * 0.7, uShadowYMax, t);

        float shadow = clamp(shadowMask * uShadowIntensity, 0.0, 0.95);
        float c = 1.0 - shadow;   // 1 = no effect, 0 = black via multiplicative blend
        gl_FragColor = vec4(c, c, c, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 5;          // before body (6) so body's additive draw layers over it
  return { mesh, uniforms };
}

// -----------------------------------------------------------------------
// FLAME RIM — a thin ribbon hugging the inner-star cutout polygon, used
// for occasional gate-tracing events:
//
//   • CHASE   — a Gaussian "pulse tongue" travels around the perimeter
//               from a launch arc-length (closest rim vertex to the
//               flame's column base) over `pulse.duration` seconds.
//               Reads as fire chasing around the inner gate.
//   • IGNITE  — a Gaussian glow centred on the same launch point with
//               a spread radius that EXPANDS over the envelope's first
//               half (radiating outward in both directions until it
//               fills the whole rim) then fades. Reads as the gate
//               momentarily catching fire.
//
// Both events are independent — they have their own Bernoulli-rate
// triggers, durations, colours, intensities, envelopes — and the
// shader sums them so they can overlap. The ribbon is two vertices
// per polygon vertex (one ON the polygon edge, one offset OUTWARD by
// `thickness`) connected by triangles, with each vertex carrying the
// cumulative arc-length from polygon[0] as a vertex attribute. The
// fragment shader normalises arc-length to [0,1] and computes
// circle-aware Gaussian distances to the pulse and ignite centres.
// -----------------------------------------------------------------------
function buildFlameRim({ cutoutLoop, zCenter, vpX, minY, cfg }) {
  const N = cutoutLoop.length;
  if (N < 3) return null;
  const rcfg = cfg.rim || {};
  const thickness = rcfg.thickness ?? 1.4;

  // Detect winding direction via signed-area shoelace so outward
  // normals point AWAY from the polygon interior regardless of how
  // the cutout extractor returned its vertex order.
  let signedArea = 0;
  for (let i = 0; i < N; i++) {
    const cur  = cutoutLoop[i];
    const next = cutoutLoop[(i + 1) % N];
    signedArea += cur.x * next.y - next.x * cur.y;
  }
  const ccw = signedArea > 0;

  // Compute outward normals at each vertex by averaging the two
  // adjacent edge perpendiculars. CCW polygons get (dy, -dx); CW
  // polygons get (-dy, dx).
  const normals = new Array(N);
  for (let i = 0; i < N; i++) {
    const prev = cutoutLoop[(i - 1 + N) % N];
    const cur  = cutoutLoop[i];
    const next = cutoutLoop[(i + 1) % N];
    const e1x = cur.x - prev.x,  e1y = cur.y - prev.y;
    const e2x = next.x - cur.x,  e2y = next.y - cur.y;
    let n1x, n1y, n2x, n2y;
    if (ccw) { n1x =  e1y; n1y = -e1x; n2x =  e2y; n2y = -e2x; }
    else     { n1x = -e1y; n1y =  e1x; n2x = -e2y; n2y =  e2x; }
    const l1 = Math.hypot(n1x, n1y) || 1;
    const l2 = Math.hypot(n2x, n2y) || 1;
    n1x /= l1; n1y /= l1; n2x /= l2; n2y /= l2;
    let nx = (n1x + n2x) * 0.5;
    let ny = (n1y + n2y) * 0.5;
    const l = Math.hypot(nx, ny) || 1;
    normals[i] = { x: nx / l, y: ny / l };
  }

  // Cumulative arc-length per vertex, plus the closing edge so the
  // perimeter wraps cleanly.
  const arcLen = new Float32Array(N);
  for (let i = 1; i < N; i++) {
    const prev = cutoutLoop[i - 1];
    const cur  = cutoutLoop[i];
    arcLen[i] = arcLen[i - 1] + Math.hypot(cur.x - prev.x, cur.y - prev.y);
  }
  const closingDist = Math.hypot(
    cutoutLoop[0].x - cutoutLoop[N - 1].x,
    cutoutLoop[0].y - cutoutLoop[N - 1].y,
  );
  const perimeter = arcLen[N - 1] + closingDist;

  // Two vertices per polygon vertex (inner = on the polygon, outer =
  // offset outward by `thickness`). vSide attribute distinguishes them
  // for thickness fade in the shader.
  const positions  = new Float32Array(N * 2 * 3);
  const aArcLength = new Float32Array(N * 2);
  const aSide      = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const v = cutoutLoop[i];
    const n = normals[i];
    const inner = i * 2;
    const outer = i * 2 + 1;
    positions[inner * 3]     = v.x;
    positions[inner * 3 + 1] = v.y;
    positions[inner * 3 + 2] = zCenter;
    positions[outer * 3]     = v.x + n.x * thickness;
    positions[outer * 3 + 1] = v.y + n.y * thickness;
    positions[outer * 3 + 2] = zCenter;
    aArcLength[inner] = arcLen[i];
    aArcLength[outer] = arcLen[i];
    aSide[inner] = 0;
    aSide[outer] = 1;
  }
  // Two triangles per edge of the polygon. We deliberately SKIP the
  // closing edge (i === N - 1, connecting vertex N-1 back to vertex 0)
  // because that segment is the synthetic chord extractInnerCutout
  // adds to seal the open bay — it doesn't correspond to any actual
  // logo edge, and drawing it shows a horizontal "bottom line" across
  // the bay's neck. Leaving the rim as an open ribbon along the bay's
  // real edges reads correctly. The chase pulse + ignite envelopes
  // still use the full perimeter for arc-length, so the pulse simply
  // disappears as it crosses the chord region and reappears on the
  // other side.
  const indices = [];
  for (let i = 0; i < N - 1; i++) {
    const a = i;
    const b = i + 1;
    const aIn = a * 2,     aOut = a * 2 + 1;
    const bIn = b * 2,     bOut = b * 2 + 1;
    indices.push(aIn, aOut, bOut);
    indices.push(aIn, bOut, bIn);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',   new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aArcLength', new THREE.BufferAttribute(aArcLength, 1));
  geometry.setAttribute('aSide',      new THREE.BufferAttribute(aSide, 1));
  geometry.setIndex(indices);

  // Pre-compute the launch arc-length (fraction in [0,1]) — the rim
  // vertex closest to the flame's column base. Pulse + ignite events
  // start here so they emanate FROM the flame.
  let bestI = 0, bestD = Infinity;
  const lx = vpX, ly = minY;
  for (let i = 0; i < N; i++) {
    const v = cutoutLoop[i];
    const d = (v.x - lx) * (v.x - lx) + (v.y - ly) * (v.y - ly);
    if (d < bestD) { bestD = d; bestI = i; }
  }
  const launchS = arcLen[bestI] / Math.max(perimeter, 0.001);

  const uniforms = {
    uPerimeter:    { value: perimeter },
    uPulsePhase:   { value: 0 },
    uPulseWidth:   { value: rcfg.pulse?.width ?? 0.06 },
    uPulseEnv:     { value: 0 },
    uPulseColor:   { value: new THREE.Vector3(...hexToRgb(rcfg.pulse?.color ?? '#FFB840')) },
    uIgniteCenter: { value: launchS },
    uIgniteSpread: { value: 0 },
    uIgniteEnv:    { value: 0 },
    uIgniteColor:  { value: new THREE.Vector3(...hexToRgb(rcfg.ignite?.color ?? '#FFD060')) },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite:  false,
    depthTest:   true,
    side:        THREE.DoubleSide,
    blending:    THREE.AdditiveBlending,
    vertexShader: `
      attribute float aArcLength;
      attribute float aSide;
      varying float vS;       // arc-length [0..1]
      varying float vSide;    // 0 at polygon edge, 1 at outer ribbon edge
      uniform float uPerimeter;
      void main() {
        vS    = aArcLength / max(uPerimeter, 0.001);
        vSide = aSide;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uPulsePhase;
      uniform float uPulseWidth;
      uniform float uPulseEnv;
      uniform vec3  uPulseColor;
      uniform float uIgniteCenter;
      uniform float uIgniteSpread;
      uniform float uIgniteEnv;
      uniform vec3  uIgniteColor;
      varying float vS;
      varying float vSide;

      // Shortest distance between two arc-length fractions on a closed loop.
      float circDist(float a, float b) {
        float d = abs(a - b);
        return min(d, 1.0 - d);
      }

      void main() {
        // Chase pulse — Gaussian centred on uPulsePhase, wraps at the seam.
        float dPulse = circDist(vS, uPulsePhase);
        float pulseG = exp(-pow(dPulse / max(uPulseWidth, 0.001), 2.0));

        // Ignite — Gaussian centred on uIgniteCenter; uIgniteSpread is
        // the radius of the bell. As spread grows the glow expands
        // outward in both directions until it covers the whole rim.
        float dIgnite = circDist(vS, uIgniteCenter);
        float igniteG = exp(-pow(dIgnite / max(uIgniteSpread, 0.001), 2.0));

        // Across-thickness fade: brightest at the polygon edge (vSide=0),
        // softens outward.
        float sideFade = 1.0 - smoothstep(0.0, 1.0, vSide);

        float pAmt = pulseG  * uPulseEnv;
        float iAmt = igniteG * uIgniteEnv;
        vec3 col = uPulseColor * pAmt + uIgniteColor * iAmt;
        float alpha = (pAmt + iAmt) * sideFade;
        if (alpha <= 0.001) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;     // sit on top of body + secondary
  return { mesh, uniforms, perimeter, launchS };
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
    // Driven by the chromatic-flare envelope (0..1). Multiplied by
    // uFlareForward and added to each spark's z so the whole spark
    // population pops forward in front of the logo for the duration of
    // a flare. Set to 0 outside flares.
    uFlareBoost:    { value: 0 },
    uFlareForward:  { value: cfg.flareForward ?? 3.0 },
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
      uniform float uFlareBoost;
      uniform float uFlareForward;
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
        // Flare burst — push sparks toward the camera while a chromatic
        // flare envelope is active so they appear in front of the logo.
        // Per-particle weight gives the burst slight stagger instead of
        // a single solid plane of sparks marching forward.
        pos.z += uFlareBoost * uFlareForward * (0.6 + 0.4 * aRandom);

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
// FLICKERING POINT-LIGHT STACK — multiple PointLights distributed along
// the flame's vertical axis so the WHOLE flame illuminates its
// surroundings, not just the hot zone at the base. Each layer has its
// own base color (warm amber at the base → deep red at the tip,
// matching the body palette), its own intensity scale, and an
// independent flicker phase offset so the layers don't pulse in
// lockstep — the surrounding walls read as a soft, organic, full-height
// glow rather than a single bright point at the bottom.
//
// Returns an array of THREE.PointLight (one per stack entry). All
// share the same flare-envelope colour blend during a chromatic flare.
// -----------------------------------------------------------------------
function buildLights({ vpX, minY, maxY, maxZ }) {
  const cfg = ANIM.flame.light;
  if (!cfg.enabled) return [];
  const stack = (cfg.stack && cfg.stack.length) ? cfg.stack
              : [{ yFraction: cfg.yFraction ?? 0.20, intensityScale: 1,
                   color: cfg.color, phaseOffset: 0 }];
  const lights = [];
  for (let i = 0; i < stack.length; i++) {
    const entry = stack[i];
    const yFrac = entry.yFraction ?? cfg.yFraction ?? 0.20;
    const lightY = minY + (maxY - minY) * yFrac;
    const colorHex = entry.color || cfg.color;
    const light = new THREE.PointLight(
      new THREE.Color(colorHex),
      cfg.intensityMin * (entry.intensityScale ?? 1),
      0,            // distance: 0 = unlimited
      cfg.decay,
    );
    // Place INSIDE the cutout volume (behind the front face). With
    // zOffsetFromFront negative, the light sits at maxZ + offset, which
    // is < maxZ and therefore inside the model's depth. Per-stack
    // entries can nudge the depth via `zOffsetExtra` for finer control.
    const zOff = (cfg.zOffsetFromFront ?? -2.0) + (entry.zOffsetExtra ?? 0);
    light.position.set(vpX, lightY, maxZ + zOff);
    // Cache per-light flicker state on userData. The update loop reads
    // these to drive the stochastic + sine flicker, intensity ramp, and
    // base-colour blend independently for each layer.
    light.userData.intensityScale = entry.intensityScale ?? 1;
    light.userData.phaseOffset    = entry.phaseOffset ?? 0;
    light.userData.baseColor      = new THREE.Color(colorHex);
    // Default off — main.js sets it true only while viewMode === 'fireplace'.
    // Three.js checks light.visible directly, not the parent group's, so
    // this needs to be explicit.
    light.visible = false;
    lights.push(light);
  }
  return lights;
}

// -----------------------------------------------------------------------
// PUBLIC: createFlame
//   meta — the silhouette/centroid bundle from src/logo.js#computeSilhouetteMeta.
//   renderer — passed through for pixel-ratio in the spark shader.
//
// Returns { group, update, lights, flameMesh, sparkPoints }. Caller adds
// `group` to the logoMesh and calls `update(t, dt)` from the per-frame
// tick. `group.visible` is the on/off switch — main.js gates it on
// view mode. `lights` is the stack of PointLights distributed up the
// flame's vertical axis; main.js toggles each one's `.visible`
// (Three.js samples light.visible directly, not the parent group's).
// -----------------------------------------------------------------------
export function createFlame({ logoMesh, meta, renderer }) {
  const { patternFadeCenter, cx, cy, maxZ } = meta;
  const group = new THREE.Group();
  group.name = 'flame';
  // Y is finalised below once the cutout extents are known (so yOffsetFrac
  // can express the nudge as a fraction of the cutout height).
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
    return { group, update: () => {}, lights: [], flameMesh: null, sparkPoints: null };
  }
  // Convert mesh-local -> flame-local (flame group sits at (cx, cy, 0)).
  const cutoutLoop = cutoutMeshLocal.map(p => ({ x: p.x - cx, y: p.y - cy }));
  // Snapshot the polygon BEFORE the stretch below — the rim ribbon
  // needs to follow the logo's actual inner-star edges, not the
  // stretched flame polygon. Deep copy so the body's stretching can't
  // mutate the rim's geometry source.
  const cutoutLoopForRim = cutoutLoop.map(p => ({ x: p.x, y: p.y }));

  // Stretch the polygon's lower portion downward so its visible bottom
  // reaches the logo silhouette's bottom (`meta.bbox.min.y`) rather
  // than stopping where the inner-star bay's neck closes. Vertices
  // above the pattern fade center are untouched; vertices below get
  // pulled down proportionally so the bottom-most vertex lands at the
  // bbox bottom. The flame's vertical column is centered on the fade
  // center anyway, so widening the polygon's bottom tip doesn't change
  // what's visible — only the y-range the flame occupies.
  {
    const targetBottomY = meta.bbox.min.y - cy;
    const pivotY = patternFadeCenter[1];
    let curMinY = Infinity;
    for (const p of cutoutLoop) if (p.y < curMinY) curMinY = p.y;
    if (curMinY > targetBottomY && pivotY > curMinY) {
      const oldDrop = pivotY - curMinY;
      const newDrop = pivotY - targetBottomY;
      const scale = newDrop / oldDrop;
      for (const p of cutoutLoop) {
        if (p.y < pivotY) {
          p.y = pivotY - (pivotY - p.y) * scale;
        }
      }
    }
  }

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

  // Shadow halo — multiplicative-blend slab that darkens the background
  // in the dark gaps between bright noise tongues. Drawn first so the
  // body's additive pass paints over it.
  let shadow = null;
  if (cfg.shadow && cfg.shadow.enabled) {
    shadow = buildFlameShadow({ cutoutLoop, vpX, vpY, minY, maxY, halfWidth, zBack, zFront, cfg });
    group.add(shadow.mesh);
  }

  // Main body
  const body = buildFlameBody({ cutoutLoop, vpX, vpY, minY, maxY, halfWidth, zBack, zFront, cfg });
  group.add(body.mesh);

  // Secondary blue body — small saturated-blue flame at the base, like
  // the hot inner core of a candle. Same shader + same cutout polygon
  // as the main body; only the color stops, column width, and t-mapping
  // top differ. We pass `subVpY` (the height we want the secondary's
  // gradient to terminate at) as both `vpY` and `maxY` so topExtendFrac
  // can't push it any higher; the shader's `t > 1.15` discard then cuts
  // off everything above subVpY * 1.15.
  let secondaryBody = null;
  const sub = (cfg.secondary && cfg.secondary.enabled !== false) ? cfg.secondary : null;
  if (sub) {
    const heightFrac = sub.heightFraction ?? 0.33;
    const subTopY = minY + heightFrac * (vpY - minY);
    const subCfg = mergeFlameCfg(cfg, sub);
    secondaryBody = buildFlameBody({
      cutoutLoop, vpX, vpY: subTopY, minY, maxY: subTopY,
      halfWidth, zBack, zFront, cfg: subCfg,
    });
    // NormalBlending so the saturated blue COVERS the orange beneath
    // its column (rather than additively summing — orange + bright
    // blue with additive blends to white in the overlap, which kills
    // the "blue inside orange" read).
    secondaryBody.mesh.material.blending = THREE.NormalBlending;
    secondaryBody.mesh.material.needsUpdate = true;
    secondaryBody.mesh.renderOrder = 7;   // sit just over main body
    group.add(secondaryBody.mesh);
  }

  // Sparks
  const sparks = buildSparks({ cutoutLoop, vpX, vpY, minY, maxY, zBack, zFront, renderer });
  if (sparks) group.add(sparks.points);

  // Rim — sits at the front of the flame slab so the chase pulse +
  // radial ignite read clearly against the logo's front face. Built
  // from the UNSTRETCHED cutout (cutoutLoopForRim) so the ribbon
  // follows the logo's actual inner-star edges rather than the
  // stretched-downward polygon the body uses. The rim's y position is
  // counter-translated each frame to cancel out the flame group's
  // y-offset (so the rim stays glued to the logo even when the flame
  // is nudged up).
  let rim = null;
  if (cfg.rim && cfg.rim.enabled) {
    // Recompute the launch reference point using the unstretched
    // polygon's actual lower extent, not the stretched-flame minY.
    let rimMinY = Infinity;
    for (const p of cutoutLoopForRim) if (p.y < rimMinY) rimMinY = p.y;
    rim = buildFlameRim({
      cutoutLoop: cutoutLoopForRim,
      zCenter: zFront - 0.05,
      vpX,
      minY: rimMinY,
      cfg,
    });
    if (rim) group.add(rim.mesh);
  }

  // Light stack — N PointLights distributed up the flame's height so
  // the whole arch is illuminated, not just the hot zone. See
  // buildLights for the per-layer config (yFraction, intensityScale,
  // base color, phase offset).
  const lights = buildLights({ vpX, minY, maxY, maxZ });
  for (let i = 0; i < lights.length; i++) group.add(lights[i]);

  // Apply the rigid Y nudge now (cutout extents are finalised).
  const cutoutHeight = Math.max(maxY - minY, 0.001);
  group.position.y = cy + (cfg.yOffsetFrac ?? 0) * cutoutHeight;

  // ----- Flare envelope state (shared between body + light) -----
  let flareEndTime = -1;
  let flareStartTime = -1;
  const flareColorVec = new THREE.Vector3(0, 0, 0);
  const tmpColor = new THREE.Color();
  const coolLightColor = new THREE.Color(cfg.light.coolColor);
  const flareLightColor = new THREE.Color();
  const lerpedLightColor = new THREE.Color();
  // Reusable HSL → RGB scratch for the secondary's hue rotation.
  const hsl = new THREE.Color();
  // Reusable scratches for the main body's palette crossfade.
  const paletteA = new THREE.Color();
  const paletteB = new THREE.Color();

  // ----- Rim event state -----
  // Independent envelopes for the chase pulse and the radial ignite.
  // Each event is one-shot: triggered by a Bernoulli-rate check, runs
  // for `duration` seconds, then resets so it can fire again.
  let pulseStart  = -1, pulseEnd  = -1;
  let igniteStart = -1, igniteEnd = -1;
  const pulseColorVec  = new THREE.Vector3();
  const igniteColorVec = new THREE.Vector3();

  function update(t, dt) {
    // Body shader time
    body.uniforms.uTime.value = t;

    // Hot-swap the Y nudge so devtools edits to ANIM.flame.yOffsetFrac
    // take effect immediately.
    const yOffsetCurrent = (ANIM.flame.yOffsetFrac ?? 0) * cutoutHeight;
    group.position.y = cy + yOffsetCurrent;
    // Counter-translate the rim so it stays anchored to the logo's
    // inner-star edges regardless of the flame group's nudge — the
    // rim is supposed to trace the gate, not float with the flame.
    if (rim) rim.mesh.position.y = -yOffsetCurrent;

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

    // Hot-swap body uniforms each frame so devtools edits take effect.
    const bcfg = ANIM.flame;
    applyBodyUniforms(body, bcfg);

    // Shadow uniforms — keep noise + column shape in lock-step with the
    // body so the dark halo always lines up with the bright tongues.
    if (shadow) {
      const sh = bcfg.shadow || {};
      const su = shadow.uniforms;
      su.uTime.value         = t;
      su.uNoiseScale.value   = bcfg.noiseScale;
      su.uNoiseSpeed.value   = bcfg.noiseSpeed;
      su.uWarpStrength.value = bcfg.warpStrength;
      su.uThreshLow.value    = bcfg.threshLow;
      su.uThreshHigh.value   = bcfg.threshHigh;
      su.uColHalfBase.value  = bcfg.bodyHalfWidthBase;
      su.uColHalfTop.value   = bcfg.bodyHalfWidthTop;
      su.uWaistY.value       = bcfg.waistY     ?? 0.25;
      su.uWaistAmt.value     = bcfg.waistAmt   ?? 0;
      su.uWaistWidth.value   = bcfg.waistWidth ?? 0.18;
      su.uWaist2Y.value      = bcfg.waist2Y     ?? 0.60;
      su.uWaist2Amt.value    = bcfg.waist2Amt   ?? 0;
      su.uWaist2Width.value  = bcfg.waist2Width ?? 0.10;
      su.uHaloScale.value       = sh.haloScale ?? 1.6;
      su.uShadowIntensity.value = sh.intensity ?? 0.55;
      su.uShadowYMax.value      = sh.yMax      ?? 0.85;
    }

    // Slow palette crossfade — overwrites the colorBottom/Mid/Top the
    // call above just pushed. Picks two adjacent palettes from the
    // colorDrift list and blends between them with a smoothstep ease,
    // looping forever.
    const cd = bcfg.colorDrift;
    if (cd && cd.enabled && cd.palettes && cd.palettes.length > 0) {
      const N = cd.palettes.length;
      const dur = Math.max(cd.cycleDuration ?? 60, 0.001);
      const phase = ((t / dur) % 1 + 1) % 1;   // wrap negative t safely
      const slot = phase * N;
      const idx = Math.floor(slot);
      const frac = slot - idx;
      const ease = frac * frac * (3 - 2 * frac);
      const a = cd.palettes[idx];
      const b = cd.palettes[(idx + 1) % N];
      paletteA.set(a.bottom).lerp(paletteB.set(b.bottom), ease);
      body.uniforms.uColorBottom.value.set(paletteA.r, paletteA.g, paletteA.b);
      paletteA.set(a.mid).lerp(paletteB.set(b.mid), ease);
      body.uniforms.uColorMid.value.set(paletteA.r, paletteA.g, paletteA.b);
      paletteA.set(a.top).lerp(paletteB.set(b.top), ease);
      body.uniforms.uColorTop.value.set(paletteA.r, paletteA.g, paletteA.b);
    }

    // Secondary blue body uses the same uniform set, but reads a merged
    // config (main defaults + ANIM.flame.secondary overrides). Its time
    // is shared with the main flame so the noise patterns stay coherent.
    let subCfgLive = null;
    if (secondaryBody) {
      secondaryBody.uniforms.uTime.value = t;
      subCfgLive = mergeFlameCfg(bcfg, bcfg.secondary || {});

      // Animate the secondary's top Y over time. Two beating sines at
      // incommensurate periods give a non-repeating-feeling drift; the
      // result is a heightFrac in [base - amount, base + amount] that
      // we clamp to a safe range, then mutate the secondary's vpY +
      // maxY so the applyBodyUniforms call below pushes the updated
      // uVanishingY.
      const subSrc = bcfg.secondary || {};
      const ha = subSrc.heightAnimation;
      let heightFrac = subSrc.heightFraction ?? 0.33;
      if (ha && ha.enabled) {
        const dur   = Math.max(ha.cycleDuration ?? 12, 0.001);
        const phase = (t / dur) * Math.PI * 2;
        const s1 = Math.sin(phase);
        const s2 = Math.sin(phase * 0.71 + 1.3);
        const blended = (s1 + s2 * 0.6) / 1.6;          // ~[-1, 1]
        heightFrac += blended * (ha.amount ?? 0.20);
      }
      heightFrac = Math.min(0.95, Math.max(0.05, heightFrac));
      const subTopYLive = minY + heightFrac * (vpY - minY);
      secondaryBody.vpY  = subTopYLive;
      secondaryBody.maxY = subTopYLive;

      applyBodyUniforms(secondaryBody, subCfgLive);
      // Secondary doesn't fire chromatic flares — keep its flare
      // intensity at zero so the merged-cfg pipeline can't accidentally
      // bleed a main-flame flare colour into the blue body.
      secondaryBody.uniforms.uFlareIntensity.value = 0;
      // Secondary stays a unified blue column — branching is a main-
      // flame-only effect.
      secondaryBody.uniforms.uBranchSep.value = 0;

      // Hue oscillation — sine-wanders the BOTTOM + MID stops in a
      // narrow band around hr.baseHue (default blue). The TOP stop is
      // deliberately NOT overwritten so the flame's outline keeps the
      // saturated blue that applyBodyUniforms just pushed from
      // cfg.colorTop, regardless of the inner-core hue wander.
      const hr = subCfgLive.hueRotation;
      if (hr && hr.enabled) {
        const dur     = Math.max(hr.duration ?? 180, 0.001);
        const baseHue = hr.baseHue   ?? 0.62;
        const range   = hr.hueRange  ?? 0.10;
        const phase   = (t / dur) * Math.PI * 2;
        const hue     = ((baseHue + Math.sin(phase) * range) % 1 + 1) % 1;
        const sat     = hr.saturation ?? 0.92;
        hsl.setHSL(hue, sat, hr.lightnessBottom ?? 0.62);
        secondaryBody.uniforms.uColorBottom.value.set(hsl.r, hsl.g, hsl.b);
        hsl.setHSL(((hue + (hr.midHueOffset ?? 0.04)) % 1 + 1) % 1, sat,
                    hr.lightnessMid ?? 0.46);
        secondaryBody.uniforms.uColorMid.value.set(hsl.r, hsl.g, hsl.b);
      }
    }

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

    // Sparks burst forward during a flare — driven by the same envelope
    // so the chromatic flame flash and the spark forward-pop are
    // synchronised. uFlareForward is the maximum z displacement.
    if (sparks) {
      sparks.uniforms.uFlareBoost.value   = flareEnv;
      sparks.uniforms.uFlareForward.value = ANIM.flame.sparks.flareForward ?? 3.0;
    }

    // ----- Light-stack flicker -----
    // Each stacked light carries its own phaseOffset + intensityScale +
    // base color (set in buildLights). Driving the sine+stochastic mix
    // per-light with offset phases keeps the layers from pulsing in
    // lockstep, which would read as a single big light flickering
    // rather than a tall organic flame.
    if (lights && lights.length) {
      const lc = ANIM.flame.light;
      for (let li = 0; li < lights.length; li++) {
        const lt = lights[li];
        const ph = lt.userData.phaseOffset || 0;
        const tt = t + ph;
        const sineWave   = 0.5 + 0.5 * Math.sin(tt * lc.flickerSpeed * 6.28
                                                + Math.sin(tt * lc.flickerSpeed * 1.7) * 1.3);
        const stochastic = Math.random();   // independent per-light per-frame
        const flickerK   = (1 - lc.flickerJitter) * sineWave
                         + lc.flickerJitter * stochastic;
        const scale = lt.userData.intensityScale || 1;
        let intensity = (lc.intensityMin + (lc.intensityMax - lc.intensityMin) * flickerK) * scale;
        // Flare boost — adds extra intensity during a flare. Scale per-
        // light too so upper layers don't overpower the base on flares.
        intensity += (lc.flareIntensityBoost || 0) * flareEnv * scale;
        lt.intensity = intensity;
        lt.decay     = lc.decay;

        // Colour: lerp from this layer's base toward the picked flare
        // colour during a flare, with a cool tint mid-envelope. Each
        // light keeps its own warm/red gradient stop as the resting
        // colour so the inner walls show a vertical hue gradient that
        // tracks the flame body's palette.
        const baseC = lt.userData.baseColor;
        if (flareEnv > 0.001) {
          lerpedLightColor.copy(baseC);
          lerpedLightColor.lerp(coolLightColor, flareEnv * 0.5);
          lerpedLightColor.lerp(flareLightColor, flareEnv * 0.7);
          lt.color.copy(lerpedLightColor);
        } else {
          lt.color.copy(baseC);
        }
      }
    }

    // ----- Rim events -----
    // Chase pulse: Gaussian tongue travels around the rim from launchS
    // to launchS+1 (one full lap) over duration. Envelope ramps up
    // fast then trails off long, like a meteor.
    // Ignite: Gaussian glow centred on launchS whose spread radius
    // expands over the envelope's first half (so it radiates outward
    // and "fills" the rim) then fades.
    if (rim) {
      const rcfg = bcfg.rim || {};
      const rPulse  = rcfg.pulse  || {};
      const rIgnite = rcfg.ignite || {};

      // Trigger chase pulse
      if (rPulse.enabled !== false && rPulse.rate > 0 && t > pulseEnd) {
        if (Math.random() < rPulse.rate * dt) {
          pulseStart = t;
          pulseEnd   = t + (rPulse.duration ?? 4.0);
          if (rPulse.color) {
            const c = new THREE.Color(rPulse.color);
            pulseColorVec.set(c.r, c.g, c.b);
            rim.uniforms.uPulseColor.value.copy(pulseColorVec);
          }
        }
      }
      // Drive chase pulse
      if (t >= pulseStart && t <= pulseEnd) {
        const dur = Math.max((rPulse.duration ?? 4.0), 0.01);
        const u   = (t - pulseStart) / dur;
        // Phase travels one full lap — launchS at u=0, launchS+1 at u=1.
        const phase = (rim.launchS + u) % 1;
        rim.uniforms.uPulsePhase.value = (phase + 1) % 1;
        rim.uniforms.uPulseWidth.value = rPulse.width ?? 0.06;
        // Fast attack, long tail.
        const env = u < 0.10 ? (u / 0.10)
                              : Math.max(0, 1.0 - (u - 0.10) / 0.90);
        rim.uniforms.uPulseEnv.value = env * (rPulse.intensity ?? 1.5);
      } else {
        rim.uniforms.uPulseEnv.value = 0;
      }

      // Trigger ignite
      if (rIgnite.enabled !== false && rIgnite.rate > 0 && t > igniteEnd) {
        if (Math.random() < rIgnite.rate * dt) {
          igniteStart = t;
          igniteEnd   = t + (rIgnite.duration ?? 3.5);
          if (rIgnite.color) {
            const c = new THREE.Color(rIgnite.color);
            igniteColorVec.set(c.r, c.g, c.b);
            rim.uniforms.uIgniteColor.value.copy(igniteColorVec);
          }
          // Always re-anchor centre at launch — flame is the source.
          rim.uniforms.uIgniteCenter.value = rim.launchS;
        }
      }
      // Drive ignite
      if (t >= igniteStart && t <= igniteEnd) {
        const dur = Math.max((rIgnite.duration ?? 3.5), 0.01);
        const u   = (t - igniteStart) / dur;
        // Spread radius grows from a tiny seed at u=0 to maxSpread at
        // u=0.5 (the "ignition" half), then holds while the envelope
        // decays. Capped at 0.55 so the Gaussian's two ends meet
        // naturally without artefacts at the seam.
        const maxSpread = Math.min(rIgnite.maxSpread ?? 0.55, 0.55);
        const spread = 0.005 + maxSpread * Math.min(u * 2.0, 1.0);
        const env = u < 0.30 ? (u / 0.30)
                              : Math.max(0, 1.0 - (u - 0.30) / 0.70);
        rim.uniforms.uIgniteSpread.value = spread;
        rim.uniforms.uIgniteEnv.value    = env * (rIgnite.intensity ?? 1.2);
      } else {
        rim.uniforms.uIgniteEnv.value = 0;
      }
    }

    // ----- Movement diversity envelope -----
    // Beat of two incommensurate sines drives a slow scale in
    // [minScale, 1] applied to every motion-related uniform across
    // body, secondary, shadow, and sparks AFTER applyBodyUniforms has
    // pushed their base values. Each frame the base values are re-
    // pushed and re-multiplied, so this never compounds — it's a pure
    // post-multiplier on the configured speeds. Lets the flame settle
    // into still moments and resume motion organically without ever
    // freezing the whole shader.
    const m = ANIM.flame.movement;
    if (m && m.enabled) {
      const dur   = Math.max(m.cycleDuration ?? 35, 0.001);
      const phase = (t / dur) * Math.PI * 2;
      const s1    = 0.5 + 0.5 * Math.sin(phase);
      const s2    = 0.5 + 0.5 * Math.sin(phase * 0.41 + 1.7);
      const blended = s1 * 0.6 + s2 * 0.4;
      const eased   = blended * blended * (3 - 2 * blended);
      const minScale = m.minScale ?? 0.10;
      const movementScale = minScale + (1 - minScale) * eased;

      body.uniforms.uNoiseSpeed.value    *= movementScale;
      body.uniforms.uColWobble.value     *= movementScale;
      body.uniforms.uWidthNoiseAmt.value *= movementScale;
      body.uniforms.uBranchSpeed.value   *= movementScale;

      if (secondaryBody) {
        secondaryBody.uniforms.uNoiseSpeed.value    *= movementScale;
        secondaryBody.uniforms.uColWobble.value     *= movementScale;
        secondaryBody.uniforms.uWidthNoiseAmt.value *= movementScale;
      }
      if (shadow) {
        shadow.uniforms.uNoiseSpeed.value *= movementScale;
      }
      if (sparks) {
        sparks.uniforms.uSwayAmount.value *= movementScale;
      }
    }
  }

  return {
    group,
    update,
    lights,
    flameMesh: body.mesh,
    sparkPoints: sparks ? sparks.points : null,
    sparkOpacity: sparks ? sparks.uniforms.uOpacity : null,
  };
}
