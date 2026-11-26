// Constellations (key 7, viewMode 'flameOnly') — a deep night sky seen
// through the logo, with star figures that trace themselves.
//
// Three layers, all inside the logo silhouette:
//   1. SKY    one shader plate cut to the silhouette (outer loop minus
//             the star cutout): three star layers drifting at different
//             speeds (parallax), a wide brightness range, a soft band of
//             denser stars, and thin indigo / rust dust for depth. The
//             field is black wherever there is no star or dust.
//   2. LINES  fine fat-lines. Each figure draws itself outward from its
//             brightest star: a line grows toward the next star with a
//             bright travelling head, the star flares when it arrives.
//             Lines stop short of every star so the stars sit in gaps.
//   3. STARS  the figure's own stars: round core, soft halo and a thin
//             four-point glint (the logo's own star shape), twinkling.
//
// Up to three figures share the sky, each in its own lobe of the logo,
// on staggered clocks: place → stars appear → lines trace → hold → fade
// → rest → a different figure somewhere else. Figure, place, size and
// tilt are picked at random each time, and every placement is checked
// against the silhouette (with a margin) so nothing touches the frame
// or crosses the star opening.
//
// Shooting stars cross the sky every few seconds (ANIM.constellation.
// meteor; trigger 'stellar.meteor' sends some now). The first figure of
// each visit is ANIM.constellation.firstFigure (the Big Dipper), drawn
// the right way round after firstDelay seconds of open sky.
//
// Vortex (trigger 'stellar.vortex'): the sky turns about the star and
// sinks into it, each star stretching into a streak, while the figures
// fade. The show fires it a few seconds before the Depth Portal, and
// main.js lets this sky stay alive a little into that look, so the stars
// become its flow lines. It resets on the next visit.
//
// Stellar pulse (key P, trigger 'stellar.pulse', and by itself every
// ~half minute): a ring of light contracts from the rim to the star
// centre, lifting the sky stars, the figure stars and the lines as it
// passes.
//
// Knobs: ANIM.constellation (all live). Each visit re-rolls the sky seed,
// band angle, drift and dust through ANIM.variations.flameOnly.

import * as THREE from 'three';
import { LineSegments2 }        from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial }         from 'three/addons/lines/LineMaterial.js';
import { pointInPolygon }       from '../../util/polygon.js';
import { ANIM }                 from '../../config.js';

// True if (x,y) lies in the visible (positive) region of the logo —
// inside the outer silhouette loop and outside every interior cutout.
function isInsideVisibleArea(x, y, polys) {
  if (!pointInPolygon(x, y, polys[0])) return false;
  for (let i = 1; i < polys.length; i++) {
    if (pointInPolygon(x, y, polys[i])) return false;
  }
  return true;
}

// Flat [ax, ay, bx, by, ...] list of every silhouette + cutout edge, for
// exact clearance tests (the star's tips are too thin for probe points).
function buildSegments(polys) {
  let n = 0;
  for (const poly of polys) n += poly.length;
  const seg = new Float32Array(n * 4);
  let k = 0;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      seg[k++] = a.x; seg[k++] = a.y; seg[k++] = b.x; seg[k++] = b.y;
    }
  }
  return seg;
}

// True if (x,y) is in the visible area and at least `m` from every edge.
function isInsideWithMargin(x, y, polys, m, seg) {
  if (!isInsideVisibleArea(x, y, polys)) return false;
  const m2 = m * m;
  for (let k = 0; k < seg.length; k += 4) {
    const ax = seg[k], ay = seg[k + 1];
    const ex = seg[k + 2] - ax, ey = seg[k + 3] - ay;
    const px = x - ax, py = y - ay;
    const l2 = ex * ex + ey * ey;
    let u = l2 > 0 ? (px * ex + py * ey) / l2 : 0;
    u = u < 0 ? 0 : (u > 1 ? 1 : u);
    const dx = px - ex * u, dy = py - ey * u;
    if (dx * dx + dy * dy < m2) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// Figure library — stars in canonical coords (x right, y up, 0..1) and
// edges by index. `mag` (optional) marks the bright stars (0..1).
// ─────────────────────────────────────────────────────────────────────
const FIGURES = [
  { name: 'Ursa Major',
    stars: [[0.97, 0.68], [0.97, 0.40], [0.74, 0.32], [0.78, 0.58], [0.56, 0.62], [0.32, 0.58], [0.05, 0.42]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]],
    mag:   [1.0, 0.7, 0.6, 0.45, 0.9, 0.8, 0.85] },
  { name: 'Cassiopeia',
    stars: [[0.00, 0.72], [0.25, 0.22], [0.52, 0.62], [0.78, 0.28], [1.00, 0.80]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4]],
    mag:   [0.8, 1.0, 0.95, 0.7, 0.55] },
  { name: 'Cygnus',
    stars: [[0.50, 1.00], [0.08, 0.66], [0.50, 0.58], [0.92, 0.44], [0.50, 0.28], [0.50, 0.00]],
    edges: [[0, 2], [1, 2], [2, 3], [2, 4], [4, 5]],
    mag:   [1.0, 0.6, 0.8, 0.65, 0.45, 0.75] },
  { name: 'Orion',
    stars: [[0.50, 1.00], [0.70, 0.82], [0.30, 0.85], [0.36, 0.52], [0.50, 0.50], [0.64, 0.48],
            [0.22, 0.05], [0.78, 0.10], [0.49, 0.34], [0.47, 0.22]],
    edges: [[0, 1], [0, 2], [1, 2], [2, 3], [1, 5], [3, 4], [4, 5], [3, 6], [5, 7], [4, 8], [8, 9]],
    mag:   [0.45, 1.0, 0.8, 0.7, 0.75, 0.7, 1.0, 0.65, 0.4, 0.4] },
  { name: 'Lyra',
    stars: [[0.50, 1.00], [0.30, 0.66], [0.70, 0.70], [0.22, 0.12], [0.78, 0.08]],
    edges: [[0, 1], [0, 2], [1, 3], [2, 4], [3, 4], [1, 2]],
    mag:   [1.0, 0.5, 0.5, 0.7, 0.7] },
  { name: 'Scorpius',
    stars: [[0.10, 0.98], [0.20, 0.86], [0.06, 0.80], [0.30, 0.72], [0.40, 0.58], [0.47, 0.42],
            [0.52, 0.24], [0.62, 0.10], [0.80, 0.06], [0.93, 0.16], [0.96, 0.32], [0.86, 0.38]],
    edges: [[0, 1], [2, 1], [1, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11]],
    mag:   [0.6, 0.7, 0.55, 1.0, 0.6, 0.65, 0.6, 0.7, 0.75, 0.7, 0.9, 0.6] },
  { name: 'Leo',
    stars: [[0.30, 0.98], [0.14, 0.88], [0.08, 0.70], [0.20, 0.56], [0.26, 0.34], [0.66, 0.50],
            [0.98, 0.30], [0.72, 0.26]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [3, 5], [5, 6], [6, 7], [7, 4]],
    mag:   [0.55, 0.5, 0.7, 0.6, 1.0, 0.65, 0.9, 0.6] },
  { name: 'Corona Borealis',
    stars: [[0.00, 0.80], [0.10, 0.42], [0.32, 0.16], [0.60, 0.12], [0.84, 0.34], [1.00, 0.70]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]],
    mag:   [0.5, 0.6, 1.0, 0.65, 0.6, 0.5] },
  { name: 'Aquila',
    stars: [[0.50, 0.98], [0.52, 0.78], [0.54, 0.60], [0.10, 0.66], [0.94, 0.52], [0.60, 0.26], [0.70, 0.02]],
    edges: [[0, 1], [1, 2], [1, 3], [1, 4], [2, 5], [5, 6]],
    mag:   [0.6, 1.0, 0.6, 0.65, 0.65, 0.6, 0.7] },
  { name: 'Gemini',
    stars: [[0.26, 1.00], [0.70, 0.96], [0.22, 0.72], [0.72, 0.66], [0.14, 0.40], [0.64, 0.34],
            [0.06, 0.08], [0.56, 0.04]],
    edges: [[0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 6], [5, 7], [2, 3]],
    mag:   [1.0, 0.95, 0.6, 0.6, 0.55, 0.6, 0.75, 0.7] },
];

const MAX_SLOTS = 3;
const MAX_STARS = 12;
const MAX_EDGES = 12;
const PTS_PER_SLOT = MAX_STARS + MAX_EDGES;   // figure stars + one travelling head per edge
const MAX_METEORS = 3;                         // shooting stars alive at once

// Breadth-first trace order from the brightest star. Returns edges as
// { a, b } oriented in drawing direction with start time + duration.
function planTrace(stars, edges, mags, speed) {
  let root = 0;
  for (let i = 1; i < stars.length; i++) if (mags[i] > mags[root]) root = i;
  const arrive = new Array(stars.length).fill(-1);
  arrive[root] = 0;
  const out = [];
  const used = new Array(edges.length).fill(false);
  const queue = [root];
  const len = (a, b) => Math.hypot(stars[a].x - stars[b].x, stars[a].y - stars[b].y);
  while (queue.length) {
    // earliest-arrived node first so the trace spreads evenly
    queue.sort((p, q) => arrive[p] - arrive[q]);
    const n = queue.shift();
    for (let i = 0; i < edges.length; i++) {
      if (used[i]) continue;
      const [ea, eb] = edges[i];
      if (ea !== n && eb !== n) continue;
      const other = ea === n ? eb : ea;
      const dur = Math.max(0.55, len(n, other) / speed);
      if (arrive[other] < 0) {
        used[i] = true;
        arrive[other] = arrive[n] + dur;
        out.push({ a: n, b: other, start: arrive[n], dur });
        queue.push(other);
      } else if (arrive[other] <= arrive[n]) {
        // closing edge between two stars that are both already lit
        used[i] = true;
        out.push({ a: other, b: n, start: arrive[n], dur });
      }
    }
  }
  for (let i = 0; i < edges.length; i++) {       // disconnected leftovers (none in the library)
    if (!used[i]) out.push({ a: edges[i][0], b: edges[i][1], start: 0, dur: 1 });
  }
  let total = 0;
  for (const e of out) total = Math.max(total, e.start + e.dur);
  return { edges: out, arrive, total, root };
}

export function createConstellation({
  silhouettePolygons,        // mesh-local outer + cutout polygons
  fadeCenter,                // [x, y] in same space, inner-star centroid
  hullMaxR,                  // max radius from fadeCenter
  renderer,
} = {}) {
  const group = new THREE.Group();
  group.name = 'constellation';
  const polys = silhouettePolygons;
  const noop = { group, update: () => {}, setOpacity: () => {}, triggerPulse: () => {}, triggerMeteor: () => {}, triggerVortex: () => {}, vortexLevel: () => 0,
                 getFlameOpacity: () => 0, figureCount: 0 };
  if (!polys || !polys[0] || polys[0].length < 3) return noop;

  const cfg = () => ANIM.constellation || {};
  const fcx = fadeCenter[0], fcy = fadeCenter[1];

  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const p of polys[0]) {
    if (p.x < xmin) xmin = p.x; if (p.x > xmax) xmax = p.x;
    if (p.y < ymin) ymin = p.y; if (p.y > ymax) ymax = p.y;
  }
  const W = xmax - xmin, H = ymax - ymin;
  const segs = buildSegments(polys);

  // ---- 1. Sky plate -----------------------------------------------------
  const shape = new THREE.Shape(polys[0].map(p => new THREE.Vector2(p.x, p.y)));
  for (let i = 1; i < polys.length; i++) {
    if (polys[i].length >= 3) shape.holes.push(new THREE.Path(polys[i].map(p => new THREE.Vector2(p.x, p.y))));
  }
  const skyUniforms = {
    uTime:    { value: 0 },
    uOpacity: { value: 0 },
    uSeed:    { value: 0 },
    uBright:  { value: 1 },
    uNebula:  { value: 1 },
    uBand:    { value: new THREE.Vector4(fcx, fcy, 0.6, H * 0.2) },   // centre xy, angle, width
    uDrift:   { value: new THREE.Vector2(1, 0) },
    uShock:   { value: new THREE.Vector3(-100, 1, 0) },                // radius, width, envelope
    uCenter:  { value: new THREE.Vector2(fcx, fcy) },
    uSwirl:   { value: new THREE.Vector3(0, 0, 1) },                   // angle, streak, pull
    uSwirlR:  { value: hullMaxR * 0.5 },
  };
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    vertexShader: /* glsl */`
      varying vec2 vP;
      void main() {
        vP = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime, uOpacity, uSeed, uBright, uNebula;
      uniform vec4  uBand;
      uniform vec2  uDrift, uCenter;
      uniform vec3  uShock;
      uniform vec3  uSwirl;
      uniform float uSwirlR;
      varying vec2  vP;

      float h21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float hn(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      float vn(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
        return mix(mix(hn(i), hn(i + vec2(1.0, 0.0)), u.x),
                   mix(hn(i + vec2(0.0, 1.0)), hn(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * vn(p); p = p * 2.03 + vec2(17.0, 31.0); a *= 0.5; }
        return v;
      }
      // One star per cell at most. cell and rad in mesh units; the star
      // (three radii) always stays inside its own cell, so none is cut.
      vec3 stars(vec2 p, float cell, float density, float rad, float tw, float halo, float salt) {
        vec2 g = p / cell;
        vec2 id = floor(g) + salt + uSeed;
        vec2 f = fract(g);
        float h = h21(id);
        if (h > density) return vec3(0.0);
        float pad = min(0.45, (3.0 + 4.0 * halo) * rad / cell);
        vec2 jit = vec2(h21(id + 3.71), h21(id + 8.13));
        vec2 c = pad + jit * (1.0 - 2.0 * pad);
        float d = length(f - c) * cell;
        float m = h21(id + 9.37);
        float b = 0.10 + 2.6 * pow(m, 6.0);                 // few bright, many faint
        float core = exp(-(d * d) / (rad * rad));
        float glow = halo * b * exp(-(d * d) / (rad * rad * 7.0)) * 0.16;
        float ph = uTime * (0.6 + 2.6 * h21(id + 1.3)) + m * 40.0;
        float twk = 1.0 - tw * (0.5 + 0.5 * sin(ph)) * (0.5 + 0.5 * sin(ph * 0.37 + 1.7));
        float ct = h21(id + 5.5);
        vec3 col = mix(vec3(0.74, 0.84, 1.0), vec3(1.0, 0.84, 0.62), smoothstep(0.45, 0.95, ct));
        col = mix(col, vec3(1.0), 0.3);
        return col * (core * b + glow) * twk;
      }

      // The three star layers at one point of sky.
      vec3 field(vec2 p, float t, float band, float lane) {
        vec3 s = vec3(0.0);
        s += stars(p + uDrift * t * 0.035, 1.25, 0.10 + 0.55 * band, 0.105, 0.45, 0.0, 0.0) * 0.42 * lane;
        s += stars(p + uDrift * t * 0.090, 2.90, 0.16 + 0.22 * band, 0.150, 0.60, 0.4, 37.0) * 0.85 * mix(1.0, lane, 0.5);
        s += stars(p + uDrift * t * 0.220, 6.80, 0.26, 0.215, 0.70, 1.0, 71.0) * 1.6;
        return s;
      }

      void main() {
        vec2 p = vP;
        float t = uTime;
        // Band of denser stars + dust, a different angle every visit.
        vec2 bn = vec2(cos(uBand.z), sin(uBand.z));
        float bc = dot(p - uBand.xy, bn) / uBand.w;
        float band = exp(-bc * bc);

        // Dust: two warped noise fields at their own drift. Thresholded
        // hard so most of the sky stays black.
        vec2 q = p * 0.030 + uSeed * vec2(3.1, 1.7) + uDrift * t * 0.0016;
        float w = fbm(q * 1.6 + vec2(t * 0.004, 0.0));
        float n1 = fbm(q + 1.4 * vec2(w, fbm(q * 1.3 + 4.7)));
        float n2 = fbm(q * 2.1 + vec2(7.3, 2.9) - uDrift * t * 0.0030);
        float dust = smoothstep(0.44, 0.96, n1);
        dust = dust * dust * (0.15 + 0.85 * band);
        vec3 dustCol = mix(vec3(0.034, 0.052, 0.125), vec3(0.120, 0.050, 0.026), smoothstep(0.50, 0.78, n2) * band);
        // Dark lanes in front of the far stars (depth cue).
        float lane = 1.0 - 0.75 * smoothstep(0.52, 0.72, n2) * band;

        vec3 s;
        if (uSwirl.x == 0.0 && uSwirl.y == 0.0) {
          s = field(p, t, band, lane);
        } else {
          // Vortex: the whole sky turns about the star, faster near the
          // centre, and sinks into it. Each star is drawn several times
          // along its own arc, so it becomes a streak (a flow line).
          vec2 d = p - uCenter;
          float kk = uSwirlR / (length(d) + 0.35 * uSwirlR);
          s = vec3(0.0);
          for (int i = 0; i < 20; i++) {
            float f = float(i) / 19.0;
            float a = (uSwirl.x - uSwirl.y * f) * kk;
            float ca = cos(a), sa = sin(a);
            vec2 ps = uCenter + vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y) * uSwirl.z;
            s = max(s, field(ps, t, band, lane) * (1.0 - 0.82 * f));
          }
          s *= 1.0 + 1.2 * min(1.0, uSwirl.y * 4.0);
        }

        // Stellar pulse: a contracting ring lifts whatever it crosses.
        float sr = length(p - uCenter);
        float sh = exp(-pow((sr - uShock.x) / max(uShock.y, 0.001), 2.0)) * uShock.z;
        s *= 1.0 + 6.0 * sh;
        dust *= 1.0 + 1.5 * sh;

        vec3 col = dustCol * dust * uNebula + s * uBright;
        gl_FragColor = vec4(col * uOpacity, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.ShapeGeometry(shape), skyMat);
  sky.renderOrder = 4;
  sky.frustumCulled = false;
  group.add(sky);

  // ---- 3. Figure stars + trace heads (Points) ---------------------------
  const NP0 = MAX_SLOTS * PTS_PER_SLOT;          // figure points
  const NP = NP0 + MAX_METEORS;                  // + one head per shooting star
  const posBuf  = new Float32Array(NP * 3);
  const colBuf  = new Float32Array(NP * 3);
  const sizeBuf = new Float32Array(NP);
  const kindBuf = new Float32Array(NP);        // glint amount 0..1
  const ptsGeom = new THREE.BufferGeometry();
  ptsGeom.setAttribute('position', new THREE.BufferAttribute(posBuf, 3));
  ptsGeom.setAttribute('aColor',   new THREE.BufferAttribute(colBuf, 3));
  ptsGeom.setAttribute('aSize',    new THREE.BufferAttribute(sizeBuf, 1));
  ptsGeom.setAttribute('aGlint',   new THREE.BufferAttribute(kindBuf, 1));
  const ptsMat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uPixelRatio: { value: 1 } },
    transparent: true,
    blending:    THREE.AdditiveBlending,
    depthTest:   false,
    depthWrite:  false,
    vertexShader: /* glsl */`
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aGlint;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vGlint;
      void main() {
        vColor = aColor;
        vGlint = aGlint;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vGlint;
      void main() {
        vec2 uv = (gl_PointCoord - 0.5) * 2.0;          // -1..1
        float r = length(uv);
        float edge = 1.0 - smoothstep(0.72, 1.0, r);    // reaches 0 well inside the sprite quad
        float core = exp(-r * r * 90.0);
        float halo = exp(-r * 7.0) * 0.30;
        // Thin four-point glint along the axes.
        float gx = exp(-abs(uv.y) * 60.0) * exp(-abs(uv.x) * 3.2);
        float gy = exp(-abs(uv.x) * 60.0) * exp(-abs(uv.y) * 3.2);
        float a = (core * 1.6 + halo + (gx + gy) * 0.55 * vGlint) * edge;
        gl_FragColor = vec4(vColor * a * uOpacity, 1.0);
      }
    `,
  });
  const points = new THREE.Points(ptsGeom, ptsMat);
  points.renderOrder = 6;
  points.frustumCulled = false;
  group.add(points);

  // ---- 2. Lines ---------------------------------------------------------
  const NE0 = MAX_SLOTS * MAX_EDGES;             // figure lines
  const NE = NE0 + MAX_METEORS;                  // + one tail per shooting star
  const lineGeom = new LineSegmentsGeometry();
  lineGeom.setPositions(new Float32Array(NE * 6));
  lineGeom.setColors(new Float32Array(NE * 6));
  const lineMat = new LineMaterial({
    color:        0xFFFFFF,
    linewidth:    1.6,
    vertexColors: true,
    transparent:  true,
    opacity:      1,
    blending:     THREE.AdditiveBlending,
    depthTest:    false,
    depthWrite:   false,
  });
  const sz = new THREE.Vector2();
  if (renderer) renderer.getSize(sz); else sz.set(window.innerWidth, window.innerHeight);
  lineMat.resolution.set(sz.x, sz.y);
  const lineMesh = new LineSegments2(lineGeom, lineMat);
  lineMesh.renderOrder = 5;
  lineMesh.frustumCulled = false;
  group.add(lineMesh);
  const lposAttr = lineGeom.attributes.instanceStart.data;
  const lcolAttr = lineGeom.attributes.instanceColorStart.data;
  const lpos = lposAttr.array, lcol = lcolAttr.array;

  // ---- Slots ------------------------------------------------------------
  // Lobe anchors: the four lobes between the star's arms plus the crown.
  const anchors = [
    { x: fcx - W * 0.25, y: fcy + H * 0.22 },   // upper left
    { x: fcx + W * 0.25, y: fcy + H * 0.22 },   // upper right
    { x: fcx - W * 0.25, y: fcy - H * 0.26 },   // lower left
    { x: fcx + W * 0.25, y: fcy - H * 0.26 },   // lower right
  ];
  const slots = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    slots.push({ state: 'off', t0: 0, wait: 0, fig: null, anchor: -1, figIdx: -1,
                 tries: 0, best: null, hold: 0 });
  }
  let lastFigIdx = -1;
  let firstPending = true;          // the first figure of a visit is fixed (cfg.firstFigure)
  // Shooting stars: a short bright streak that crosses one lobe of sky.
  const meteors = [];
  for (let i = 0; i < MAX_METEORS; i++) meteors.push({ on: false, t0: 0, dur: 1, x: 0, y: 0, dx: 0, dy: 1, len: 1 });
  let nextMeteor = 4, meteorQueue = 0, meteorHold = 0;
  // Vortex: the sky spins up and sinks into the star (the hand-off to
  // the Depth Portal's flow lines). Trigger 'stellar.vortex'.
  let vortexOn = false, vortexT0 = 0, vortexAngle = 0, vortexLevel = 0;
  let clock = 0;                    // local seconds since mode entry
  let wasHidden = true;
  let groupOpacity = 0;
  let pulseActive = false, pulseStart = 0, nextAutoPulse = 30;

  function tryPlace(figDef, anchor, others, strict) {
    const c = cfg();
    const margin = c.margin ?? 2.6;
    const scales = [0.50, 0.45, 0.40, 0.36, 0.32, 0.29];
    const cx = anchor.x + (Math.random() * 2 - 1) * W * 0.12;
    const cy = anchor.y + (Math.random() * 2 - 1) * H * 0.12;
    // strict = keep the figure readable: no mirror image, only a small tilt
    const rot = (Math.random() * 2 - 1) * (strict ? 0.3 : 0.9);
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const flip = strict ? 1 : (Math.random() < 0.5 ? -1 : 1);
    // centre the figure on its own bounding box
    let fx0 = 1, fx1 = 0, fy0 = 1, fy1 = 0;
    for (const [px, py] of figDef.stars) {
      if (px < fx0) fx0 = px; if (px > fx1) fx1 = px;
      if (py < fy0) fy0 = py; if (py > fy1) fy1 = py;
    }
    const mx = (fx0 + fx1) * 0.5, my = (fy0 + fy1) * 0.5;
    const maxScale = (c.figureScale ?? 1) * W;
    for (const sc of scales) {
      const scale = sc * maxScale;
      const stars = figDef.stars.map(([px, py]) => {
        const dx = (px - mx) * scale * flip, dy = (py - my) * scale;
        return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
      });
      let ok = true;
      for (const s of stars) { if (!isInsideWithMargin(s.x, s.y, polys, margin, segs)) { ok = false; break; } }
      if (!ok) continue;
      // keep clear of the other figures (bounding circles)
      let rad = 0;
      for (const s of stars) rad = Math.max(rad, Math.hypot(s.x - cx, s.y - cy));
      for (const o of others) {
        if (Math.hypot(o.cx - cx, o.cy - cy) < o.rad + rad + margin) { ok = false; break; }
      }
      if (!ok) continue;
      for (const [a, b] of figDef.edges) {
        const A = stars[a], B = stars[b];
        const n = Math.max(6, Math.ceil(Math.hypot(B.x - A.x, B.y - A.y) / 1.5));
        for (let i = 1; i < n && ok; i++) {
          const u = i / n;
          if (!isInsideWithMargin(A.x + (B.x - A.x) * u, A.y + (B.y - A.y) * u, polys, margin * 0.8, segs)) ok = false;
        }
        if (!ok) break;
      }
      if (ok) return { stars, cx, cy, rad, scale };
    }
    return null;
  }

  function activeOthers(self) {
    const out = [];
    for (const s of slots) if (s !== self && s.fig) out.push(s.fig);
    return out;
  }

  function beginPlacing(slot) {
    // a lobe no other figure is using, and a figure different from the last
    const taken = new Set();
    for (const s of slots) if (s !== slot && s.fig) taken.add(s.anchor);
    const free = anchors.map((_, i) => i).filter(i => !taken.has(i) && i !== slot.anchor);
    slot.anchor = free.length ? free[Math.floor(Math.random() * free.length)]
                              : Math.floor(Math.random() * anchors.length);
    const inUse = new Set(slots.filter(s => s.fig).map(s => s.figIdx));
    let idx = Math.floor(Math.random() * FIGURES.length), guard = 0;
    while ((inUse.has(idx) || idx === lastFigIdx) && guard++ < 20) idx = Math.floor(Math.random() * FIGURES.length);
    // The first figure of every visit is the named one (the Big Dipper).
    slot.strict = false;
    if (firstPending) {
      firstPending = false;
      const want = FIGURES.findIndex(f => f.name === (cfg().firstFigure || ''));
      if (want >= 0) { idx = want; slot.strict = true; }
    }
    slot.figIdx = idx; lastFigIdx = idx;
    slot.state = 'placing'; slot.tries = 0; slot.best = null; slot.fig = null;
  }

  function finishPlacing(slot) {
    const def = FIGURES[slot.figIdx];
    const b = slot.best;
    const c = cfg();
    const mags = def.mag || def.stars.map(() => 0.7);
    const plan = planTrace(b.stars, def.edges, mags, c.traceSpeed ?? 9);
    const stars = b.stars.map((s, i) => {
      const dx = s.x - fcx, dy = s.y - fcy, r = Math.hypot(dx, dy);
      return { x: s.x, y: s.y, r, rx: r > 1e-3 ? dx / r : 0, ry: r > 1e-3 ? dy / r : 1,
               mag: mags[i], arrive: plan.arrive[i] < 0 ? 0 : plan.arrive[i],
               phase: Math.random() * 6.283, speed: 0.5 + Math.random() * 1.3,
               warm: Math.random() };
    });
    slot.fig = { stars, edges: plan.edges, total: plan.total, cx: b.cx, cy: b.cy, rad: b.rad };
    slot.state = 'live';
    slot.t0 = clock;
    slot.hold = (c.holdMin ?? 12) + Math.random() * ((c.holdMax ?? 19) - (c.holdMin ?? 12));
    slot.extra = 0;
  }

  function resetAll() {
    clock = 0;
    pulseActive = false;
    nextAutoPulse = 22 + Math.random() * 14;
    // The sky stays empty for a moment first (twinkle + shooting stars),
    // then the first figure draws itself.
    const lead = cfg().firstDelay ?? 0.5;
    firstPending = true;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const s = slots[i];
      s.state = 'wait'; s.fig = null; s.anchor = -1;
      s.wait = lead + (i === 0 ? 0 : (i === 1 ? 9 + Math.random() * 3 : 18 + Math.random() * 4));
    }
    vortexOn = false; vortexAngle = 0; vortexLevel = 0;
    skyUniforms.uSwirl.value.set(0, 0, 1);
    for (const m of meteors) m.on = false;
    meteorQueue = 0; meteorHold = 0;
    nextMeteor = (cfg().meteor?.first ?? 2.5);
    posBuf.fill(0); colBuf.fill(0); sizeBuf.fill(0); kindBuf.fill(0);
    lpos.fill(0); lcol.fill(0);
  }
  resetAll();

  function triggerPulse() { pulseActive = true; pulseStart = clock; }
  function triggerVortex() { if (!vortexOn) { vortexOn = true; vortexT0 = clock; vortexAngle = 0; } }

  // ---- shooting stars ----
  // n = how many to send (they leave a short beat apart).
  function triggerMeteor(n = 1) { meteorQueue = Math.min(6, meteorQueue + Math.max(1, n | 0)); }
  function spawnMeteor() {
    const slot = meteors.find(m => !m.on);
    if (!slot) return false;
    for (let k = 0; k < 4; k++) {
      // travel down and across, like a real one
      const side = Math.random() < 0.5 ? -1 : 1;
      const ang = -(0.30 + Math.random() * 0.85);
      const dx = Math.cos(ang) * side, dy = Math.sin(ang);
      const len = W * (0.20 + Math.random() * 0.22);
      const x = xmin + Math.random() * W, y = ymin + H * (0.30 + Math.random() * 0.68);
      let ok = true;
      for (let i = 0; i <= 8 && ok; i++) {
        const u = i / 8;
        if (!isInsideWithMargin(x + dx * len * u, y + dy * len * u, polys, 1.6, segs)) ok = false;
      }
      if (!ok) continue;
      slot.on = true; slot.t0 = clock; slot.dur = 0.55 + Math.random() * 0.45;
      slot.x = x; slot.y = y; slot.dx = dx; slot.dy = dy; slot.len = len;
      return true;
    }
    return false;
  }
  function updateMeteors(c) {
    const mc = c.meteor || {};
    if (mc.enabled !== false && !vortexOn && clock >= nextMeteor) {
      meteorQueue = Math.min(6, meteorQueue + 1);
      nextMeteor = clock + (mc.min ?? 4) + Math.random() * ((mc.max ?? 9) - (mc.min ?? 4));
    }
    if (meteorQueue > 0 && clock >= meteorHold && spawnMeteor()) {
      meteorQueue--;
      meteorHold = clock + 0.28 + Math.random() * 0.4;
    }
    const bright = (mc.brightness ?? 1) * (c.starBrightness ?? 1);
    for (let i = 0; i < MAX_METEORS; i++) {
      const m = meteors[i];
      const lo = (NE0 + i) * 6, ho = NP0 + i;
      if (m.on && clock - m.t0 >= m.dur) m.on = false;
      if (!m.on) {
        for (let k = 0; k < 6; k++) lcol[lo + k] = 0;
        sizeBuf[ho] = 0;
        continue;
      }
      const u = (clock - m.t0) / m.dur;
      const head = u * (2 - u);                          // fast start, slows as it burns out
      const tail = Math.max(0, head - 0.42 * Math.sin(u * Math.PI));
      const hx = m.x + m.dx * m.len * head, hy = m.y + m.dy * m.len * head;
      const tx = m.x + m.dx * m.len * tail, ty = m.y + m.dy * m.len * tail;
      const env = Math.pow(Math.sin(u * Math.PI), 0.7) * bright;
      lpos[lo] = tx; lpos[lo + 1] = ty; lpos[lo + 2] = 0;
      lpos[lo + 3] = hx; lpos[lo + 4] = hy; lpos[lo + 5] = 0;
      lcol[lo] = 0; lcol[lo + 1] = 0; lcol[lo + 2] = 0;                       // the tail end is dark
      lcol[lo + 3] = 1.9 * env; lcol[lo + 4] = 2.0 * env; lcol[lo + 5] = 2.3 * env;
      posBuf[ho * 3] = hx; posBuf[ho * 3 + 1] = hy; posBuf[ho * 3 + 2] = 0;
      colBuf[ho * 3] = 2.4 * env; colBuf[ho * 3 + 1] = 2.5 * env; colBuf[ho * 3 + 2] = 2.8 * env;
      sizeBuf[ho] = (c.starSize ?? 30) * 0.5;
      kindBuf[ho] = 0.6;
    }
  }
  function setOpacity(a) { groupOpacity = a; }

  const INTRO = 1.1;        // seconds: stars appear before the lines trace
  const FADE  = 2.6;
  const tint = new THREE.Color();

  function update(t, dt) {
    if (groupOpacity <= 0.002) {
      skyUniforms.uOpacity.value = 0;
      ptsMat.uniforms.uOpacity.value = 0;
      lineMat.opacity = 0;
      wasHidden = true;
      return;
    }
    if (wasHidden) { wasHidden = false; resetAll(); }
    clock += dt;
    const c = cfg();

    // ---- sky uniforms (all live) ----
    skyUniforms.uTime.value    = clock + (c.seed ?? 0) * 13.7;
    skyUniforms.uOpacity.value = groupOpacity;
    skyUniforms.uSeed.value    = Math.floor(c.seed ?? 0);
    skyUniforms.uBright.value  = c.skyBrightness ?? 1;
    skyUniforms.uNebula.value  = c.nebula ?? 1;
    skyUniforms.uBand.value.z  = c.bandAngle ?? 0.6;
    skyUniforms.uBand.value.w  = H * (c.bandWidth ?? 0.2);
    const da = c.driftAngle ?? 0.4, ds = c.drift ?? 1;
    skyUniforms.uDrift.value.set(Math.cos(da) * ds, Math.sin(da) * ds);

    // ---- vortex ----
    if (vortexOn) {
      const vc = c.vortex || {};
      const u = clock - vortexT0;
      const ramp = Math.max(0.5, vc.ramp ?? 4);
      const e = Math.min(1, u / ramp);
      const omega = (vc.spin ?? 0.9) * (e * e * (3 - 2 * e) + 0.18 * Math.max(0, u - ramp));
      vortexAngle += omega * dt;
      const streak = Math.min(vc.streakMax ?? 0.55, omega * (vc.exposure ?? 0.24));
      const pull = 1 + (vc.pull ?? 0.035) * u * u;
      skyUniforms.uSwirl.value.set(vortexAngle, streak, pull);
      const l = Math.min(1, u / 1.6);
      vortexLevel = l * l * (3 - 2 * l);
    }

    // ---- stellar pulse ----
    if (!pulseActive && clock >= nextAutoPulse && (c.autoPulse ?? true)) triggerPulse();
    let shockR = -1e3, shockEnv = 0;
    const pulseDur = c.pulseDuration ?? 4.5;
    const pulseW = c.pulseWidth ?? 5.0;
    if (pulseActive) {
      const u = (clock - pulseStart) / pulseDur;
      if (u >= 1) { pulseActive = false; nextAutoPulse = clock + 26 + Math.random() * 18; }
      else { shockR = hullMaxR * 1.05 * (1 - u); shockEnv = Math.sin(u * Math.PI); }
    }
    skyUniforms.uShock.value.set(shockR, pulseW, shockEnv);
    const passing = (r) => shockEnv > 0 ? Math.max(0, 1 - Math.abs(r - shockR) / pulseW) * shockEnv : 0;

    // ---- slots ----
    const nSlots = Math.max(0, Math.min(MAX_SLOTS, Math.round(c.figures ?? 2)));
    const lineBright = c.lineBrightness ?? 0.5;
    const starBright = c.starBrightness ?? 1.0;
    const starSize   = c.starSize ?? 30;
    const gap        = c.starGap ?? 1.15;
    tint.set(c.lineColor || '#BFD4FF');

    for (let si = 0; si < MAX_SLOTS; si++) {
      const slot = slots[si];
      const pBase = si * PTS_PER_SLOT, eBase = si * MAX_EDGES;

      if (slot.state === 'wait') {
        slot.wait -= dt;
        if (slot.wait <= 0 && si < nSlots) beginPlacing(slot);
      }
      if (slot.state === 'placing') {
        // a few candidates per frame, keep the LARGEST fit of the batch;
        // if the lobe is too tight for this figure, pick again
        const others = activeOthers(slot);
        for (let k = 0; k < 3; k++) {
          const cand = tryPlace(FIGURES[slot.figIdx], anchors[slot.anchor], others, slot.strict);
          if (cand && (!slot.best || cand.scale > slot.best.scale)) slot.best = cand;
          slot.tries++;
        }
        if (slot.tries >= 36) {
          if (slot.best) finishPlacing(slot);
          else { slot.state = 'wait'; slot.wait = 0.1; }
        }
      }

      if (slot.state !== 'live' || !slot.fig) {
        // blank this slot's buffers
        for (let i = 0; i < PTS_PER_SLOT; i++) sizeBuf[pBase + i] = 0;
        for (let i = 0; i < MAX_EDGES * 6; i++) lcol[eBase * 6 + i] = 0;
        continue;
      }

      const fig = slot.fig;
      const age = clock - slot.t0;
      const traceT = age - INTRO;
      // Never leave the sky without a finished figure: when this one is
      // due to fade, hold it (up to 16 s more) until another is fully
      // drawn with time to spare.
      if (nSlots > 1 && slot.extra < 16 && age >= INTRO + fig.total + slot.hold) {
        let covered = false;
        for (const o of slots) {
          if (o === slot || o.state !== 'live' || !o.fig) continue;
          const oa = clock - o.t0, oDone = INTRO + o.fig.total;
          // covered if the other is finished and either has time left or
          // is the younger of the two (then it is the one that waits)
          if (oa > oDone && oa < oDone + o.hold + FADE * 0.1 && (oa < oDone + o.hold - 5 || o.t0 > slot.t0)) covered = true;
        }
        if (!covered && age - (INTRO + fig.total + slot.hold) < 0.1) { slot.hold += dt; slot.extra += dt; }
      }
      const endHold = INTRO + fig.total + slot.hold;
      // fade: lines go first, stars linger a beat longer
      const fadeU = Math.max(0, (age - endHold) / FADE);
      const lineFade = 1 - Math.min(1, fadeU * 1.5);
      const starFade = 1 - Math.min(1, Math.max(0, fadeU * 1.25 - 0.25));
      if (fadeU >= 1) {
        slot.state = 'wait'; slot.fig = null;
        slot.wait = (c.restMin ?? 1.5) + Math.random() * ((c.restMax ?? 4) - (c.restMin ?? 1.5));
        for (let i = 0; i < PTS_PER_SLOT; i++) sizeBuf[pBase + i] = 0;
        for (let i = 0; i < MAX_EDGES * 6; i++) lcol[eBase * 6 + i] = 0;
        continue;
      }

      // -- stars
      const S = fig.stars;
      for (let i = 0; i < MAX_STARS; i++) {
        const o = pBase + i;
        if (i >= S.length) { sizeBuf[o] = 0; continue; }
        const s = S[i];
        // appear: staggered ease-in to a dim "unlit" level
        const ap = Math.min(1, Math.max(0, (age - i * 0.07) / 0.9));
        const appear = ap * ap * (3 - 2 * ap);
        // lit: when the trace reaches the star it flares, then settles
        const since = traceT - s.arrive;
        const lit = since >= 0 ? 1 : 0;
        const flare = since >= 0 ? Math.exp(-since / 0.55) : 0;
        const tw = 1 + 0.22 * Math.sin(s.phase + clock * s.speed) * Math.sin(s.phase * 1.7 + clock * s.speed * 0.43);
        const p = passing(s.r);
        const level = (0.28 + 0.72 * lit) * (0.45 + 0.75 * s.mag);
        const b = starBright * appear * starFade * (level * tw + flare * 1.6 + p * 2.2);
        // warm white ↔ cool white per star
        const wr = 1.0, wg = 0.90 + 0.08 * (1 - s.warm), wb = 0.72 + 0.28 * (1 - s.warm);
        posBuf[o * 3]     = s.x - s.rx * p * 0.6;
        posBuf[o * 3 + 1] = s.y - s.ry * p * 0.6;
        colBuf[o * 3] = wr * b * 2.2; colBuf[o * 3 + 1] = wg * b * 2.2; colBuf[o * 3 + 2] = wb * b * 2.2;
        sizeBuf[o] = starSize * (0.62 + 0.55 * s.mag) * (1 + 0.35 * flare + 0.5 * p);
        kindBuf[o] = lit * (0.35 + 0.65 * s.mag) * (0.75 + 0.25 * tw);
      }

      // -- lines + travelling heads
      const E = fig.edges;
      for (let i = 0; i < MAX_EDGES; i++) {
        const lo = (eBase + i) * 6;
        const ho = pBase + MAX_STARS + i;
        if (i >= E.length) {
          for (let k = 0; k < 6; k++) lcol[lo + k] = 0;
          sizeBuf[ho] = 0;
          continue;
        }
        const e = E[i];
        const A = S[e.a], B = S[e.b];
        const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
        const ux = dx / L, uy = dy / L;
        const g = Math.min(gap, L * 0.3);
        const ax = A.x + ux * g, ay = A.y + uy * g;
        const span = L - 2 * g;
        const u = Math.min(1, Math.max(0, (traceT - e.start) / e.dur));
        const prog = u * u * (3 - 2 * u);
        const ex = ax + ux * span * prog, ey = ay + uy * span * prog;
        lpos[lo] = ax; lpos[lo + 1] = ay; lpos[lo + 2] = 0;
        lpos[lo + 3] = ex; lpos[lo + 4] = ey; lpos[lo + 5] = 0;
        const drawing = u > 0 && u < 1;
        const since = traceT - (e.start + e.dur);
        const after = since >= 0 ? Math.exp(-since / 0.9) : 0;      // settle glow
        const p = passing((A.r + B.r) * 0.5);
        const base = u > 0 ? lineBright * (1 + 1.1 * after + 2.4 * p) : 0;
        const tail = base * lineFade;
        const head = (drawing ? base + 1.6 : base) * lineFade;
        lcol[lo]     = tint.r * tail; lcol[lo + 1] = tint.g * tail; lcol[lo + 2] = tint.b * tail;
        lcol[lo + 3] = tint.r * head; lcol[lo + 4] = tint.g * head; lcol[lo + 5] = tint.b * head;
        // head spark
        if (drawing) {
          const env = Math.sin(u * Math.PI);
          posBuf[ho * 3] = ex; posBuf[ho * 3 + 1] = ey;
          const hb = (0.6 + 1.6 * env) * lineFade;
          colBuf[ho * 3] = hb * 1.6; colBuf[ho * 3 + 1] = hb * 1.7; colBuf[ho * 3 + 2] = hb * 2.0;
          sizeBuf[ho] = starSize * 0.42;
          kindBuf[ho] = 0;
        } else {
          sizeBuf[ho] = 0;
        }
      }
    }

    updateMeteors(c);

    ptsGeom.attributes.position.needsUpdate = true;
    ptsGeom.attributes.aColor.needsUpdate   = true;
    ptsGeom.attributes.aSize.needsUpdate    = true;
    ptsGeom.attributes.aGlint.needsUpdate   = true;
    lposAttr.needsUpdate = true;
    lcolAttr.needsUpdate = true;
    // the figures let go as the sky starts to turn
    const figOpacity = groupOpacity * (1 - vortexLevel);
    ptsMat.uniforms.uOpacity.value = figOpacity;
    ptsMat.uniforms.uPixelRatio.value = renderer ? renderer.getPixelRatio() : (window.devicePixelRatio || 1);
    lineMat.opacity = figOpacity;
    lineMat.linewidth = c.lineWidth ?? 1.6;

    if (renderer) {
      renderer.getSize(sz);
      if (Math.abs(sz.x - lineMat.resolution.x) > 0.5 || Math.abs(sz.y - lineMat.resolution.y) > 0.5) {
        lineMat.resolution.set(sz.x, sz.y);
      }
    }
  }

  return {
    group,
    update,
    setOpacity,
    triggerPulse,
    triggerMeteor,
    triggerVortex,
    vortexLevel: () => vortexLevel,
    // The hearth-flame interlude was retired from this mode; kept for the
    // effects.js export surface.
    getFlameOpacity: () => 0,
    figureCount: FIGURES.length,
    // probe / devtools visibility
    debug: () => slots.map(s => ({ state: s.state, fig: s.figIdx >= 0 ? FIGURES[s.figIdx].name : null,
                                   anchor: s.anchor, stars: s.fig ? s.fig.stars.length : 0 })),
  };
}
