// STAR DIVE — a continuous fractal zoom through the star (key Z,
// viewMode 'starDive').
//
// The logo contains itself: through the star cutout you see a half-size
// copy of the whole logo floating in space, through ITS star another,
// and so on. The camera falls forward forever. Each copy is a dark lit slab —
// bevelled edges, a drop shadow onto the copy behind, depth fog, and a
// little parallax as the eye drifts — so the stack reads as real depth
// behind the physical surface (the projection-mapping "window" trick).
//
// Why the zoom never ends or jumps (Droste construction)
//   Copy k is the logo scaled by rho^(k - phase) about the star centre.
//   phase runs 0 → 1; at 1 every copy has exactly the size the next-
//   nearer copy had at 0, so phase wraps to 0 with no visible seam.
//   Everything a copy shows depends only on its own local coordinates
//   and on the continuous depth (k - phase), so the picture at phase 1
//   and phase 0 is identical. `wraps` counts completed levels so each
//   copy can keep its own material as it travels.
//
// The copies are drawn from a signed-distance texture built once from
// the real silhouette polygons, so every copy has the exact outline of
// the logo (outer A + star), stays sharp at any zoom, and gives a cheap
// surface normal for the bevel lighting.
//
// Knobs: ANIM.dive (config.js). Triggers: 'dive.rush' (Space in this
// mode), 'dive.reverse'.

import * as THREE from 'three';
import { ANIM } from '../../config.js';
import { buildRadialLimit } from '../fireplaceTwo/starFlow.js';

// ---- signed-distance texture -------------------------------------------

function segDist2(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = wx - vx * t, dy = wy - vy * t;
  return dx * dx + dy * dy;
}

// loops → flat segment array [ax, ay, bx, by, ...]
function loopsToSegments(loops, maxPerLoop = 700) {
  const out = [];
  for (const loop of loops) {
    const step = Math.max(1, Math.ceil(loop.length / maxPerLoop));
    const pts = [];
    for (let i = 0; i < loop.length; i += step) pts.push(loop[i]);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push(a.x, a.y, b.x, b.y);
    }
  }
  return new Float32Array(out);
}

// Signed distance (negative inside, even-odd rule) of (x, y) to segments.
function signedDistance(x, y, segs) {
  let best = Infinity, inside = false;
  for (let i = 0; i < segs.length; i += 4) {
    const ax = segs[i], ay = segs[i + 1], bx = segs[i + 2], by = segs[i + 3];
    const d2 = segDist2(x, y, ax, ay, bx, by);
    if (d2 < best) best = d2;
    if ((ay > y) !== (by > y) && x < ax + (bx - ax) * (y - ay) / (by - ay)) inside = !inside;
  }
  const d = Math.sqrt(best);
  return inside ? -d : d;
}

// Convex hull (Andrew monotone chain) of a point list → closed loop.
function convexHull(points) {
  const p = points.map(q => ({ x: q.x, y: q.y })).sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function buildSdfTexture(silhouettePolygons, pivot, longSide) {
  const outer = silhouettePolygons[0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of outer) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const pad = 0.12 * Math.max(maxX - minX, maxY - minY);
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const bw = maxX - minX, bh = maxY - minY;
  const W = bw >= bh ? longSide : Math.max(8, Math.round(longSide * bw / bh));
  const H = bh >  bw ? longSide : Math.max(8, Math.round(longSide * bh / bw));

  // Body: the logo's solid face (outer loop minus any hole loops).
  const bodySegs = loopsToSegments(silhouettePolygons);
  // Hull: the outer boundary with the star notch filled in.
  const BINS = 360;
  const lim = buildRadialLimit(outer, pivot[0], pivot[1], BINS);
  const hullLoop = [];
  for (let b = 0; b < BINS; b++) {
    const th = (b / BINS) * Math.PI * 2 - Math.PI;
    // buildRadialLimit pulls in 1.5 % — undo it so the hull meets the outline.
    const r = lim[b] / 0.985;
    hullLoop.push({ x: pivot[0] + Math.cos(th) * r, y: pivot[1] + Math.sin(th) * r });
  }
  const hullSegs = loopsToSegments([hullLoop]);
  // Full outline: the convex shape of the whole logo (arch + flat base).
  // Unlike the radial hull above it also covers the flared opening below
  // the star, so a look can treat "star + flare" as one continuous
  // opening and run an edge glow around the ENTIRE logo.
  const fullLoop = convexHull(outer);
  const fullSegs = loopsToSegments([fullLoop]);

  const data = new Uint16Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    const y = minY + (j + 0.5) / H * bh;
    for (let i = 0; i < W; i++) {
      const x = minX + (i + 0.5) / W * bw;
      const o = (j * W + i) * 4;
      data[o]     = THREE.DataUtils.toHalfFloat(signedDistance(x, y, bodySegs));
      data[o + 1] = THREE.DataUtils.toHalfFloat(signedDistance(x, y, hullSegs));
      data[o + 2] = THREE.DataUtils.toHalfFloat(signedDistance(x, y, fullSegs));
      data[o + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { tex, box: new THREE.Vector4(minX, minY, 1 / bw, 1 / bh), hullLoop, fullLoop, lim };
}

// ---- shader ------------------------------------------------------------

const VERT = /* glsl */`
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  varying vec2 vP;
  uniform sampler2D uSdf;
  uniform vec4  uBox;        // minX, minY, 1/width, 1/height of the SDF domain
  uniform vec2  uPivot;      // star centre = the zoom's fixed point
  uniform float uUnit;       // reference length (hull radius)
  uniform float uPhase;      // 0..1 within one level
  uniform float uWraps;      // completed levels (material continuity)
  uniform float uRho;        // scale ratio between neighbouring copies
  uniform float uTime;
  uniform vec2  uSway;       // eye drift (panel units) → parallax
  uniform float uTwist;      // radians per level
  uniform float uLiquid;     // edge wobble of deep copies
  uniform vec2  uLight;      // light direction in the panel plane
  uniform float uBevel;
  uniform float uShadow;
  uniform float uFog;
  uniform float uRush;       // 0..1
  uniform float uGain;
  uniform float uVeins;
  uniform float uSeed;
  uniform vec3  uGold;
  uniform vec3  uEmber;
  uniform vec3  uDeep;
  uniform vec3  uCool;

  #define LEVELS 8

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x),
               mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
    return s;
  }

  // (body, hull) signed distances at a level-local point, panel units.
  vec2 sdf(vec2 u) {
    vec2 uv = (u - uBox.xy) * uBox.zw;
    vec2 c = clamp(uv, 0.0, 1.0);
    return texture2D(uSdf, c).rg + length((uv - c) / uBox.zw);
  }

  // eff = depth into the slab measured from its (possibly opened-up)
  // edge, in uUnit lengths. The caller computes it once so the cut-out,
  // the bevel and the lit rim all ride the same edge.
  vec3 shadeBody(vec2 u, vec2 sd, float eff, float idx) {
    // Surface normal: flat on top, rolling off at the bevel.
    float h = 0.012 * uUnit;
    vec2 g = vec2(sdf(u + vec2(h, 0.0)).x - sdf(u - vec2(h, 0.0)).x,
                  sdf(u + vec2(0.0, h)).x - sdf(u - vec2(0.0, h)).x) / (2.0 * h);
    float bev = 1.0 - smoothstep(0.0, uBevel, eff);
    // Is this edge the star (inner) or the outer A?  Near the outer edge
    // body and hull distances agree; near the star they do not.
    float starEdge = smoothstep(0.0, 0.06 * uUnit, abs(sd.y - sd.x));

    // Each copy has its own identity: material + vein pattern.
    float id = hash21(vec2(idx * 1.37 + uSeed, 4.1));
    float id2 = hash21(vec2(idx * 2.91 + uSeed, 9.7));

    // Organic surface: slow domain-warped veins, in the copy's own space
    // so the texture travels with the copy.
    vec2 w = u / uUnit * (2.0 + 1.2 * id2) + id * 40.0;
    vec2 q = vec2(fbm(w + uTime * 0.021), fbm(w + 5.2 - uTime * 0.017));
    float f = fbm(w + 1.7 * q);
    float vein = pow(1.0 - abs(2.0 * f - 1.0), 10.0);
    float pool = smoothstep(0.55, 0.8, f);

    vec3 n = normalize(vec3(g * bev * 1.6 + (q - 0.5) * 0.22, 1.0));
    vec3 L = normalize(vec3(uLight, 0.75));
    float diff = max(dot(n, L), 0.0);
    vec3 R = reflect(-L, n);
    float spec = pow(max(R.z, 0.0), 48.0);
    float fres = pow(1.0 - n.z, 2.0);

    // Dark materials only — obsidian / oxblood / bronze — so the light
    // (rim, glint, veins) is what reads, not a coloured fill.
    // Keep every material DARK: a bright base (the old bronze) washed the
    // whole slab to milky orange on its lit side.
    vec3 base = id < 0.4 ? vec3(0.030, 0.024, 0.024)
              : id < 0.75 ? uDeep * 0.30
              :             vec3(0.050, 0.028, 0.013);
    // Contrast, not lift: the shadow side stays near black (a raised
    // floor turns the slab milky grey on screen), the lit side climbs
    // steeply, and the rims / veins / glints carry the brightness.
    vec3 col = base * (0.06 + 1.5 * diff * diff * diff);
    col += uCool * 0.012 * (1.0 - diff) * (1.0 - bev);                 // cold fill in the shadows
    col += uGold * spec * (0.9 + 3.0 * bev);                           // polished bevel glint
    col += uGold * fres * 0.5 * bev;   // only on the rolled edge — a flat sheen greys the slab out
    // Thin molten veins; they breathe.
    float pulse = 0.6 + 0.4 * sin(uTime * 0.6 + f * 9.0 + idx);
    col += mix(uEmber, uGold, pool) * vein * (0.9 + 2.2 * pool) * pulse * uVeins * (1.0 + uRush);
    // Lit rims: a crisp line with a short falloff. The star edge burns
    // white-gold, the outer A edge ember.
    float rim = 1.5 * exp(-eff / 0.007) + 0.16 * exp(-eff / 0.028);
    col += mix(uEmber * 1.6 + uGold * 0.6, uGold * 2.4, starEdge) * rim * (1.0 + 1.2 * uRush);
    return col;
  }

  // Deep space seen past a copy, in that copy's local space.
  vec3 shadeVoid(vec2 u, float kap) {
    vec2 w = (u - uPivot) / uUnit;
    float r = length(w);
    float neb = fbm(w * 2.1 + vec2(uTime * 0.013, -uTime * 0.009));
    vec3 col = uDeep * 0.20 * smoothstep(0.25, 0.85, neb);
    col += uEmber * 0.10 * exp(-r * 2.2);
    vec2 cell = floor(w * 34.0);
    float st = hash21(cell);
    vec2 cp = fract(w * 34.0) - 0.5 - (vec2(hash21(cell + 3.7), hash21(cell + 9.1)) - 0.5) * 0.6;
    float tw = 0.6 + 0.4 * sin(uTime * (1.0 + 3.0 * st) + st * 40.0);
    col += vec3(1.0, 0.86, 0.66) * step(0.93, st) * smoothstep(0.11, 0.0, length(cp)) * tw * 1.6;
    return col;
  }

  void main() {
    vec2 q = vP - uPivot;
    float px = fwidth(vP.x) + 1e-5;                // panel units per pixel
    vec3 col = vec3(0.0);
    float T = 1.0;                                 // how much of deeper space still shows
    float lit = 1.0;                               // shadow cast by nearer copies

    for (int i = 0; i < LEVELS; i++) {
      float k = float(i) - 1.0;
      float kap = k - uPhase;                      // continuous depth index
      float idx = mod(k + uWraps, 24.0);           // identity of this copy (cycle of 24)
      float s = pow(uRho, kap);
      // Parallax: copies behind the surface plane drift with the eye.
      vec2 off = uSway * clamp(1.0 - s, -0.35, 1.0);
      float th = uTwist * kap * (mod(idx, 2.0) < 0.5 ? 1.0 : -0.6);
      float ct = cos(th), sn = sin(th);
      vec2 r = (q - off) / s;
      vec2 u = uPivot + vec2(ct * r.x + sn * r.y, -sn * r.x + ct * r.y);
      // Deep copies go slightly liquid; the front copy stays true so it
      // sits on the physical edges.
      float liq = uLiquid * uUnit * smoothstep(0.1, 2.0, kap);
      u += liq * vec2(sin(u.y / uUnit * 6.0 + uTime * 0.7 + idx),
                      cos(u.x / uUnit * 5.3 - uTime * 0.55 + idx * 1.7));

      vec2 sd = sdf(u);
      float aa = px / s * 1.2;
      float inBody = 1.0 - smoothstep(-aa, aa, sd.x);
      float inHull = 1.0 - smoothstep(-aa, aa, sd.y);
      // Far end: the last copies fade up out of the core glow.
      float farFade = 1.0 - smoothstep(float(LEVELS) - 3.2, float(LEVELS) - 2.0, kap);
      float fog = exp(-uFog * max(kap, 0.0));

      // Space around this copy (inside the previous copy's star, outside
      // this copy's outline).
      float voidA = (1.0 - inHull) * T;
      if (voidA > 0.002) col += voidA * lit * fog * shadeVoid(u, kap);
      T *= inHull;

      // The nearest copy does not fade out: its openings grow. The edge
      // (star AND outer outline) eats inward until the slab is gone, so
      // you fall through a star that opens around you.
      float open = smoothstep(-0.22, -1.0, kap) * 0.5;      // in uUnit lengths
      float eff = -sd.x / uUnit - open;
      float aaN = aa / uUnit;
      float solid = open > 0.0 ? smoothstep(-aaN, aaN, eff) : inBody;

      if (solid * T > 0.002) {
        vec3 c = shadeBody(u, sd, max(eff, 0.0), idx);
        float a = solid * farFade;
        // Rims and veins survive the fog better than the dark slab does.
        col += T * a * c * lit * mix(fog, 1.0, 0.4);
        T *= 1.0 - a;
      }

      // Drop shadow of this copy onto everything behind it: look a little
      // toward the light — if that spot is solid, we are in its shadow.
      float sh = sdf(u + uLight * uShadow * uUnit).x + open * uUnit;
      float occ = 1.0 - smoothstep(-0.02 * uUnit, 0.05 * uUnit, sh);
      float vis = smoothstep(-0.98, -0.45, kap) * farFade;
      lit *= 1.0 - 0.6 * occ * vis;
      // Contact darkening right at the star's edge.
      lit *= mix(1.0, 0.7 + 0.3 * smoothstep(0.0, 0.05 * uUnit, sd.x + open * uUnit), vis);

      if (T < 0.003) break;
    }

    // Whatever still shows is the light at the bottom of the well.
    float rr = length(q) / uUnit;
    vec3 core = uGold * (2.2 + 2.0 * uRush) * exp(-rr * 9.0) + uEmber * 0.8 * exp(-rr * 3.0);
    col += T * core;
    // A soft bloom of that light over the nearest layers (volumetric feel).
    col += uGold * 0.05 * (1.0 + 2.0 * uRush) * exp(-rr * 6.5);

    gl_FragColor = vec4(col * uGain, 1.0);
  }
`;

// ---- effect ------------------------------------------------------------

export function createStarDive({ silhouettePolygons, pivot = [0, 0] }) {
  const group = new THREE.Group();
  group.name = 'starDive';
  const noop = { group, update: () => {}, triggerRush: () => {}, reverse: () => {}, sdf: null };
  if (!silhouettePolygons || !silhouettePolygons.length) return noop;

  const cfg = () => ANIM.dive || {};
  const c0 = cfg();
  const { tex, box, hullLoop, fullLoop, lim } = buildSdfTexture(silhouettePolygons, pivot, c0.sdfSize ?? 288);
  let unit = 1;
  for (let i = 0; i < lim.length; i++) unit = Math.max(unit, lim[i]);

  // The mesh is the hull: the whole logo interior, star included.
  const shape = new THREE.Shape(hullLoop.map(p => new THREE.Vector2(p.x, p.y)));
  const geom = new THREE.ShapeGeometry(shape);

  const uniforms = {
    uSdf:    { value: tex },
    uBox:    { value: box },
    uPivot:  { value: new THREE.Vector2(pivot[0] || 0, pivot[1] || 0) },
    uUnit:   { value: unit },
    uPhase:  { value: 0 },
    uWraps:  { value: 0 },
    uRho:    { value: c0.ratio ?? 0.5 },
    uTime:   { value: 0 },
    uSway:   { value: new THREE.Vector2() },
    uTwist:  { value: 0 },
    uLiquid: { value: 0 },
    uLight:  { value: new THREE.Vector2(-0.5, 0.6) },
    uBevel:  { value: c0.bevel ?? 0.055 },
    uShadow: { value: c0.shadow ?? 0.07 },
    uFog:    { value: c0.fog ?? 0.3 },
    uRush:   { value: 0 },
    uGain:   { value: c0.gain ?? 1 },
    uVeins:  { value: c0.veins ?? 0.6 },
    uSeed:   { value: c0.seed ?? 0 },
    uGold:   { value: new THREE.Color(c0.gold  || '#FFC56A') },
    uEmber:  { value: new THREE.Color(c0.ember || '#FF4A12') },
    uDeep:   { value: new THREE.Color(c0.deep  || '#5A0A12') },
    uCool:   { value: new THREE.Color(c0.cool  || '#3A5C8C') },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    depthWrite: false, depthTest: false, transparent: true,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = -0.5;       // between the galaxy plate (-1) and the body (0)
  mesh.frustumCulled = false;
  group.add(mesh);

  let phase = 0, wraps = 0;
  let rushUntil = -1, rushEnv = 0;
  let dir = 1, dirEnv = 1;

  function triggerRush(t) { rushUntil = (t ?? 0) + ((cfg().rush || {}).duration ?? 4); }
  function reverse() { dir = -dir; return dir; }

  function update(t, dt = 0.016) {
    if (!group.visible) return;
    const c = cfg();
    const rush = c.rush || {};
    const rushing = t < rushUntil;
    rushEnv += ((rushing ? 1 : 0) - rushEnv) * (1 - Math.exp(-dt / (rushing ? 0.5 : 1.6)));
    dirEnv += (dir - dirEnv) * (1 - Math.exp(-dt / 1.2));

    // Speed in levels per second, breathing on slow incommensurate sines
    // so the fall never feels metronomic.
    const breathe = 1 + (c.speedWander ?? 0.3) * 0.5 * (Math.sin(t * 0.047) + Math.sin(t * 0.019 + 1.3));
    const speed = (1 / Math.max(1, c.secondsPerLevel ?? 9)) * breathe
                * (1 + rushEnv * ((rush.speedMul ?? 4) - 1)) * dirEnv;
    phase += speed * Math.min(dt, 0.1);
    // wraps cycles 0..23: 24 distinct copies before the identities repeat.
    while (phase >= 1) { phase -= 1; wraps = (wraps + 1) % 24; }
    while (phase < 0)  { phase += 1; wraps = (wraps + 23) % 24; }

    const sw = c.sway || {};
    const amp = (sw.amount ?? 0.07) * unit;
    uniforms.uSway.value.set(
      amp * Math.sin(t * (2 * Math.PI / (sw.periodX ?? 23))),
      amp * 0.7 * Math.sin(t * (2 * Math.PI / (sw.periodY ?? 31)) + 1.1));
    const la = t * (2 * Math.PI / (c.lightPeriod ?? 37));
    uniforms.uLight.value.set(Math.cos(la) * 0.75, 0.45 + 0.4 * Math.sin(la * 0.7));
    uniforms.uTwist.value = THREE.MathUtils.degToRad(c.twistDeg ?? 0)
      * Math.sin(t * (2 * Math.PI / (c.twistPeriod ?? 41)));
    uniforms.uLiquid.value = c.liquid ?? 0.005;
    uniforms.uPhase.value = phase;
    uniforms.uWraps.value = wraps;
    uniforms.uRho.value = c.ratio ?? 0.5;
    uniforms.uTime.value = t;
    uniforms.uBevel.value = c.bevel ?? 0.055;
    uniforms.uShadow.value = c.shadow ?? 0.07;
    uniforms.uFog.value = c.fog ?? 0.3;
    uniforms.uRush.value = rushEnv;
    uniforms.uGain.value = c.gain ?? 1;
    uniforms.uVeins.value = c.veins ?? 0.6;
    uniforms.uSeed.value = c.seed ?? 0;
  }

  // The SDF texture + hull are shared with the shader looks (W/E/R/T).
  return { group, update, triggerRush, reverse, sdf: { tex, box, hullLoop, fullLoop, unit } };
}
