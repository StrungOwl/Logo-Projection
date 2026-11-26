// STAR FLOW — the Depth Portal's particle layer.
//
// The vision (Particle Practice/FLOW_NOTES.md, the old TouchDesigner
// experiment): the star outline stays visible in front, and particles
// flow from that outline back into a distant vanishing point on smooth,
// curved, elegant lines — endlessly.
//
// How it works
//   • Particles spawn on the silhouette outline — mostly on the edges
//     that FACE the vanishing point (the star and its stem), some on the
//     outer A outline.
//   • Motion is polar about the vanishing point:
//       radial  = always inward, exponential (reads as perspective
//                 recession), its rate gently modulated by a smooth field
//       angular = a slow whirl + a smooth signed field that drifts in
//                 space and time, so ribbons bend, braid and reverse
//     Both fields are low-frequency analytic sines: next-door particles
//     get next-door motion, so the paths are smooth curves, never the
//     jagged random walk that plain per-point noise gives.
//   • Containment: the radial part is never outward, and a per-angle
//     radius limit (the outline's outer boundary seen from the vanishing
//     point) clamps anything the whirl would carry past the edge — a
//     ribbon that reaches the boundary glides along it. No light can
//     spill off the logo onto the wall.
//   • Each particle drags a ribbon of its last `trail` positions, drawn
//     as fat additive line segments (bright head → ember tail).
//
// Uses its own PRNG — never Math.random — so adding this layer does not
// shift the seeded stream the .verify probes rely on.
//
// Knobs: ANIM.recede.flow (config.js). Trigger: 'portal.flow' (key F).

import * as THREE from 'three';
import { LineSegments2 }        from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial }         from 'three/addons/lines/LineMaterial.js';
import { ANIM } from '../../config.js';
import { QUALITY } from '../../quality.js';

function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// For each segment i (loop[i] → loop[i+1]) of a closed loop: can its
// midpoint be seen from (px, py) without crossing another edge? Those
// are the edges that face the vanishing point — on the logo, the star
// cutout and its stem. O(n²), run once at load.
export function segmentsFacingPoint(loop, px, py) {
  const n = loop.length;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = mx - px, dy = my - py;
    let blocked = false;
    for (let j = 0; j < n && !blocked; j++) {
      if (j === i) continue;
      const c = loop[j], d = loop[(j + 1) % n];
      const ex = d.x - c.x, ey = d.y - c.y;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c.x - px) * ey - (c.y - py) * ex) / den;   // along the sight line
      const u = ((c.x - px) * dy - (c.y - py) * dx) / den;   // along edge j
      if (t > 1e-4 && t < 0.999 && u >= 0 && u <= 1) blocked = true;
    }
    out[i] = blocked ? 0 : 1;
  }
  return out;
}

// Radius limit per angle about (px, py): the farthest hit of a ray against
// the outline — i.e. the outline's outer boundary as seen from that point,
// with notches (the star) filled in. Rays that slip out through an opening
// (the stem gap) borrow the nearest bin that did hit. Eroded by a small
// neighbourhood minimum (so a clamp never cuts a corner between bins) and
// pulled in a hair. Returns Float32Array(bins); bin b ↔ angle
// (b / bins)·2π − π.
export function buildRadialLimit(loop, px, py, bins = 720) {
  const limit = new Float32Array(bins);
  const nL = loop.length;
  for (let b = 0; b < bins; b++) {
    const th = (b / bins) * Math.PI * 2 - Math.PI;
    const dx = Math.cos(th), dy = Math.sin(th);
    let far = 0;
    for (let j = 0; j < nL; j++) {
      const c = loop[j], d = loop[(j + 1) % nL];
      const ex = d.x - c.x, ey = d.y - c.y;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c.x - px) * ey - (c.y - py) * ex) / den;
      const u = ((c.x - px) * dy - (c.y - py) * dx) / den;
      if (t > 0 && u >= 0 && u <= 1 && t > far) far = t;
    }
    limit[b] = far;
  }
  for (let b = 0; b < bins; b++) {
    if (limit[b] > 0) continue;
    for (let k = 1; k < bins; k++) {
      const v = limit[(b + k) % bins] || limit[(b - k + bins) % bins];
      if (v > 0) { limit[b] = v; break; }
    }
  }
  const eroded = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    let m = Infinity;
    for (let k = -2; k <= 2; k++) m = Math.min(m, limit[(b + k + bins) % bins]);
    eroded[b] = m * 0.985;
  }
  return eroded;
}

// Sampler over a closed polygon loop, uniform by (weighted) length.
// `weights` (optional, one per segment) biases where samples land.
function makeLoopSampler(loop, px, py, scale, weights) {
  const n = loop.length;
  const cum = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.y - a.y) * (weights ? weights[i] : 1);
  }
  const total = cum[n];
  return {
    total,
    sample(u, out) {
      const target = u * total;
      let lo = 0, hi = n;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= target) lo = mid; else hi = mid;
      }
      const a = loop[lo], b = loop[(lo + 1) % n];
      const seg = cum[lo + 1] - cum[lo];
      const f = seg > 0 ? (target - cum[lo]) / seg : 0;
      // Relative to the vanishing point, optionally pulled in a touch.
      out[0] = ((a.x + (b.x - a.x) * f) - px) * scale;
      out[1] = ((a.y + (b.y - a.y) * f) - py) * scale;
    },
  };
}

export function createStarFlow({ silhouettePolygons, pivot = [0, 0], renderer }) {
  const group = new THREE.Group();
  group.name = 'starFlow';
  const noop = { group, update: () => {}, toggle: () => false };
  if (!silhouettePolygons || silhouettePolygons.length < 1) return noop;

  const cfg = () => (ANIM.recede && ANIM.recede.flow) || {};
  const c0 = cfg();
  const px = pivot[0] || 0, py = pivot[1] || 0;

  const MAX   = Math.max(50, c0.count ?? 1100);        // allocated at HIGH
  const K     = Math.max(4, c0.trail ?? 28);           // points per ribbon
  const SEG   = K - 1;
  const rand  = mulberry32(0x51A7F10);

  // Spawn sources. "Star" = separate hole loops (full-screen slab) plus
  // the parts of the main outline that face the vanishing point (on the
  // logo the star is a notch in the ONE outline, not its own loop).
  const outerLoop  = silhouettePolygons[0];
  const facing = segmentsFacingPoint(outerLoop, px, py);
  const facingW = Float32Array.from(facing);
  const awayW = Float32Array.from(facing, f => 1 - f);
  const starSamplers = silhouettePolygons.slice(1)
    .map(l => makeLoopSampler(l, px, py, 1.0));
  if (facing.some(f => f)) starSamplers.push(makeLoopSampler(outerLoop, px, py, 0.985, facingW));
  const outerSampler = awayW.some(w => w)
    ? makeLoopSampler(outerLoop, px, py, 0.97, awayW)
    : makeLoopSampler(outerLoop, px, py, 0.97);
  const starTotal = starSamplers.reduce((s, x) => s + x.total, 0);

  let refR = 1;
  for (const p of outerLoop) refR = Math.max(refR, Math.hypot(p.x - px, p.y - py));

  // Radius limit per angle (see buildRadialLimit).
  const BINS = 720;
  const limit = buildRadialLimit(outerLoop, px, py, BINS);
  const BIN_SCALE = BINS / (Math.PI * 2);

  // Per-particle state (relative to the vanishing point).
  const qx = new Float32Array(MAX), qy = new Float32Array(MAX);
  const r0 = new Float32Array(MAX);          // spawn radius (for fades)
  const age = new Float32Array(MAX), life = new Float32Array(MAX);
  const spin = new Float32Array(MAX);        // per-particle whirl bias
  const heat = new Float32Array(MAX);        // 0 = ember tone, 1 = white-gold
  const hx = new Float32Array(MAX * K), hy = new Float32Array(MAX * K);

  const tmp = [0, 0];
  function spawn(p, prewarm) {
    const c = cfg();
    const useStar = starTotal > 0 && rand() < (c.starShare ?? 0.72);
    if (useStar) {
      let pick = rand() * starTotal, s = starSamplers[0];
      for (const cand of starSamplers) { s = cand; if (pick < cand.total) break; pick -= cand.total; }
      s.sample(rand(), tmp);
    } else {
      outerSampler.sample(rand(), tmp);
    }
    qx[p] = tmp[0]; qy[p] = tmp[1];
    r0[p] = Math.max(1e-3, Math.hypot(tmp[0], tmp[1]));
    const lf = c.life || [5, 9];
    life[p] = lf[0] + (lf[1] - lf[0]) * rand();
    age[p] = prewarm ? rand() * life[p] : 0;
    spin[p] = 0.6 + 0.8 * rand();
    heat[p] = rand();
    if (prewarm) {
      // Slide the particle to where it would be at this age (pull only),
      // so the first frame already shows a filled field, not a ring.
      const k = Math.exp(-(c.pull ?? 0.3) * age[p]);
      qx[p] *= k; qy[p] *= k;
    }
    const base = p * K;
    for (let i = 0; i < K; i++) { hx[base + i] = qx[p]; hy[base + i] = qy[p]; }
  }
  for (let p = 0; p < MAX; p++) spawn(p, true);

  // Geometry: MAX*SEG instanced fat segments, written in place.
  const geom = new LineSegmentsGeometry();
  geom.setPositions(new Float32Array(MAX * SEG * 6));
  geom.setColors(new Float32Array(MAX * SEG * 6));
  const posBuf = geom.attributes.instanceStart.data;
  const colBuf = geom.attributes.instanceColorStart.data;
  const pos = posBuf.array, col = colBuf.array;
  posBuf.setUsage(THREE.DynamicDrawUsage);
  colBuf.setUsage(THREE.DynamicDrawUsage);

  const mat = new LineMaterial({
    color: 0xFFFFFF,
    linewidth: c0.linewidth ?? 1.6,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const sz = new THREE.Vector2();
  function syncResolution() {
    if (renderer) renderer.getSize(sz); else sz.set(window.innerWidth, window.innerHeight);
    if (Math.abs(sz.x - mat.resolution.x) > 0.5 || Math.abs(sz.y - mat.resolution.y) > 0.5) {
      mat.resolution.set(sz.x, sz.y);
    }
  }
  syncResolution();

  const mesh = new LineSegments2(geom, mat);
  mesh.frustumCulled = false;      // positions are rewritten every frame
  mesh.renderOrder = -0.02;        // above the corridor, below the body
  group.add(mesh);

  const headCol = new THREE.Color(), tailCol = new THREE.Color();
  // Ribbon fade table: bright head → dark tail.
  const fade = new Float32Array(K);
  for (let i = 0; i < K; i++) fade[i] = Math.pow(1 - i / (K - 1), 1.6);

  let pushAcc = 0;
  let level = 1;          // smoothed on/off (key F) so the layer fades
  let wanted = true;

  function toggle(force) {
    wanted = force !== undefined ? !!force : !wanted;
    return wanted;
  }

  // update(t, dt, { rush: 0..1, color: THREE.Color|null })
  function update(t, dt = 0.016, env = {}) {
    const c = cfg();
    const on = wanted && c.enabled !== false;
    level += ((on ? 1 : 0) - level) * (1 - Math.exp(-dt / 0.8));
    mesh.visible = level > 0.004;
    if (!mesh.visible) return;
    syncResolution();

    const rush = env.rush || 0;
    const n = Math.max(1, Math.min(MAX,
      Math.round(MAX * (QUALITY.preset?.particles ?? 1))));
    const speedMul = 1 + rush * ((c.rushSpeedMul ?? 3.2) - 1);
    const pull  = (c.pull ?? 0.3) * speedMul;
    const whirl = (c.swirl ?? 0.35) * (0.6 + 0.4 * Math.sin(t * 0.071)) * speedMul;
    const curlA = (c.curl ?? 0.55) * speedMul;
    const freq  = (c.curlFreq ?? 3.2) / refR;
    const drift = t * (c.curlDrift ?? 0.11);
    const stepDt = Math.min(dt, 0.05);

    // Ribbon history advances on a fixed clock so trail length is the
    // same at any frame rate.
    const interval = (c.trailSeconds ?? 1.1) / SEG / Math.max(1, speedMul * 0.6);
    pushAcc += dt;
    let pushes = 0;
    while (pushAcc >= interval && pushes < 3) { pushAcc -= interval; pushes++; }
    if (pushes === 3) pushAcc = 0;
    for (let k = 0; k < pushes; k++) {
      // One global shift; slot 0 of every ribbon is rewritten below.
      hx.copyWithin(1, 0, MAX * K - 1);
      hy.copyWithin(1, 0, MAX * K - 1);
      for (let p = 0; p < MAX; p++) { hx[p * K] = qx[p]; hy[p * K] = qy[p]; }
    }

    headCol.set(c.color || '#FFE2A8');
    if (env.color) headCol.lerp(env.color, c.followPalette ?? 0.55);
    tailCol.set(c.tailColor || '#FF5A14');
    const inten = (c.intensity ?? 2.2) * (1 + rush * (env.bright ?? 0.9)) * level;
    mat.linewidth = (c.linewidth ?? 1.6) * (1 + rush * 0.5);

    for (let p = 0; p < n; p++) {
      age[p] += stepDt * speedMul;
      let x = qx[p], y = qy[p];
      const r = Math.hypot(x, y);
      if (age[p] >= life[p] || r < refR * 0.012) { spawn(p, false); x = qx[p]; y = qy[p]; }

      // Two smooth, slowly drifting fields sampled at the particle:
      //   bend  (≈ ±1.5) → signed angular velocity (ribbons curve + braid)
      //   surge (≈ ±1)   → radial-rate modulation (never flips outward)
      const ax = x * freq, by = y * freq;
      const bend = Math.sin(ax + drift) * Math.cos(by - drift * 0.7)
                 + 0.5 * Math.sin(1.9 * ax - 1.3 * by + 1.6 * drift);
      const surge = Math.sin(1.3 * ax - 0.6 * drift + 2.0) * Math.cos(1.1 * by + 0.9 * drift);
      // Near the outer boundary the turning eases off, so ribbons head
      // inward instead of piling up along the edge.
      const lim0 = limit[Math.min(BINS - 1, ((Math.atan2(y, x) + Math.PI) * BIN_SCALE) | 0)];
      const edge = Math.min(1, Math.max(0, (r / lim0 - 0.55) / 0.45));
      const omega = (whirl * spin[p] + curlA * bend) * (1 - 0.75 * edge);   // rad/s about the pivot
      const inward = pull * (1 + 0.55 * surge);          // always > 0
      // Exact rotation + decay (stable at any dt, no outward drift).
      const ang = omega * stepDt, ca = Math.cos(ang), sa = Math.sin(ang);
      const k = Math.exp(-inward * stepDt);
      const nx = (x * ca - y * sa) * k;
      const ny = (x * sa + y * ca) * k;
      x = nx; y = ny;
      // Boundary clamp (see `limit` above).
      const lim = limit[Math.min(BINS - 1, ((Math.atan2(y, x) + Math.PI) * BIN_SCALE) | 0)];
      const r2 = x * x + y * y;
      if (r2 > lim * lim) { const f = lim / Math.sqrt(r2); x *= f; y *= f; }
      qx[p] = x; qy[p] = y;
      const base = p * K;
      hx[base] = x; hy[base] = y;          // live head

      // Brightness envelope: quick fade-in, long fade-out, and dimmer as
      // it nears the vanishing point (where every ribbon piles up).
      const a = age[p] / life[p];
      const fin = Math.min(1, age[p] / 0.5);
      const fout = 1 - a * a;
      const depth = Math.pow(Math.min(1, Math.hypot(x, y) / r0[p]), 0.55);
      const b = inten * fin * fout * (0.25 + 0.75 * depth);
      const h = heat[p];
      const hr = headCol.r * b, hg = headCol.g * b, hb = headCol.b * b;
      const tr = tailCol.r * b, tg = tailCol.g * b, tb = tailCol.b * b;

      let o = p * SEG * 6;
      for (let i = 0; i < SEG; i++, o += 6) {
        pos[o]     = px + hx[base + i];     pos[o + 1] = py + hy[base + i];     pos[o + 2] = 0.05;
        pos[o + 3] = px + hx[base + i + 1]; pos[o + 4] = py + hy[base + i + 1]; pos[o + 5] = 0.05;
        const f0 = fade[i], f1 = fade[i + 1];
        // Head colour near the front of the ribbon, ember toward the tail.
        const m0 = f0 * (0.35 + 0.65 * h), m1 = f1 * (0.35 + 0.65 * h);
        col[o]     = (tr + (hr - tr) * m0) * f0;
        col[o + 1] = (tg + (hg - tg) * m0) * f0;
        col[o + 2] = (tb + (hb - tb) * m0) * f0;
        col[o + 3] = (tr + (hr - tr) * m1) * f1;
        col[o + 4] = (tg + (hg - tg) * m1) * f1;
        col[o + 5] = (tb + (hb - tb) * m1) * f1;
      }
    }
    geom.instanceCount = n * SEG;
    posBuf.needsUpdate = true;
    colBuf.needsUpdate = true;
  }

  return { group, update, toggle };
}
