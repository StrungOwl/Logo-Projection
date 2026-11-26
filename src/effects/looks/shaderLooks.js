// SHADER LOOKS — full-surface looks drawn on the logo interior.
//
//   W  'mercury'  liquid chrome; bars of light slide over a moving surface
//   R  'strata'   the logo as a carved, terraced landscape of fine lines
//   T  'shards'   faceted obsidian that flashes as a light sweeps it
//   (E 'corona' was removed 2026-11 at Sydney's request.)
//
// The drawn area is the logo's FULL outline (arch + flat base), so the
// star and the flared opening beneath it are one continuous opening —
// nothing is cut off at the star's neck — and a gold line runs around
// the entire edge of the logo.
//
// All share one recipe (the Star Dive direction): mostly black,
// one bold idea each, light that reads the real shape, no gate. They
// reuse Star Dive's signed-distance texture, so every look knows exactly
// where the star edge and the outer A edge are.
//
// Each look reads three generic knobs (a, b, c) plus a seed from
// ANIM.shaderLooks.<name>; ANIM.variations rolls them on every entry,
// so the look is different every visit. Space = 'look.pulse'.

import * as THREE from 'three';
import { ANIM } from '../../config.js';

export const SHADER_LOOK_MODES = ['mercury', 'strata', 'shards'];

const VERT = /* glsl */`
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const COMMON = /* glsl */`
  precision highp float;
  varying vec2 vP;
  uniform sampler2D uSdf;
  uniform vec4  uBox;
  uniform vec2  uPivot;
  uniform float uUnit;
  uniform float uTime;
  uniform float uSeed;
  uniform float uA;
  uniform float uB;
  uniform float uC;
  uniform float uPulse;      // 0..1, decays after Space
  uniform vec2  uLight;      // drifting light direction (panel plane)
  uniform vec2  uSway;       // drifting eye offset, in uUnit lengths
  uniform float uGain;
  uniform vec3  uGold;
  uniform vec3  uEmber;
  uniform vec3  uDeep;
  uniform vec3  uCool;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  vec2 hash22(vec2 p) {
    float n = hash21(p);
    return vec2(n, hash21(p + n * 31.7 + 1.3));
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
  float fbm3(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
    return s;
  }
  // (body, full) signed distances in uUnit lengths at a panel point.
  // body < 0 inside the solid logo face; full < 0 anywhere inside the
  // logo's whole outline (so body > 0 && full < 0 is the opening: the
  // star plus the flare beneath it).
  vec2 sdfN(vec2 p) {
    vec2 uv = (p - uBox.xy) * uBox.zw;
    vec2 c = clamp(uv, 0.0, 1.0);
    return (texture2D(uSdf, c).rb + length((uv - c) / uBox.zw)) / uUnit;
  }
  // One gold line around the ENTIRE logo: every body edge (star, flare,
  // outer A) plus the base line that closes the flare.
  float edgeLine(vec2 sd, float w) {
    return exp(-min(abs(sd.x), abs(sd.y)) / w);
  }
`;

// ---- W: MERCURY ---------------------------------------------------------
// Liquid chrome. A slowly moving surface mirrors a dark studio lit by
// three long bars of light (two warm, one cold); as the surface moves the
// bars bend, stretch and break up — which is what makes it read as
// liquid metal rather than a texture. Fine ripples run parallel to the
// logo's edges, so the liquid visibly meets the star and the A.
//   a = ripple fineness, b = how choppy the surface is, c = flow speed
const FRAG_MERCURY = COMMON + /* glsl */`
  float height(vec2 p) {
    vec2 q = (p - uPivot) / uUnit;
    vec2 sd = sdfN(p);
    float t = uTime * (0.35 + 0.9 * uC);
    // Large slow swell, advected by a second field so it rolls.
    vec2 adv = vec2(fbm3(q * 0.9 + t * 0.04 + uSeed), fbm3(q * 0.9 - t * 0.035 + uSeed + 9.0));
    float swell = fbm3(q * 1.25 + adv * 1.6 + vec2(0.0, t * 0.05));
    // A second, smaller swell crossing the first. (Fine noise here
    // turns the mirror into glitter — keep it smooth.)
    float chop = fbm3(q * (2.0 + 1.6 * uA) + adv * 1.4 - vec2(t * 0.07, 0.0) + 4.0);
    // Thin ripples hugging every edge, fading into the open surface.
    float d = min(abs(sd.x), abs(sd.y));
    float rip = sin(d * (40.0 + 40.0 * uA) - t * 2.2) * exp(-d * 9.0);
    // Space: a ring leaves the star centre.
    float r = length(q);
    float ring = uPulse * sin(r * 30.0 - uTime * 9.0) * exp(-r * 2.2);
    return swell * 0.9 + chop * (0.18 + 0.30 * uB) + rip * 0.012 + ring * 0.10;
  }
  // A soft-edged bar of light in reflection space.
  float bar(float v, float c, float w) { return smoothstep(w, 0.0, abs(v - c)); }
  void main() {
    vec2 sd = sdfN(vP);
    float e = uUnit * 0.014;
    float h0 = height(vP);
    vec3 n = normalize(vec3((h0 - height(vP + vec2(e, 0.0))) / 0.014,
                            (h0 - height(vP + vec2(0.0, e))) / 0.014, 2.3));
    vec3 R = reflect(vec3(0.0, 0.0, -1.0), n);
    // The studio turns slowly, so the bars sweep across the surface.
    float ang = uTime * 0.05 + uSeed;
    vec2 rr = vec2(cos(ang) * R.x - sin(ang) * R.y, sin(ang) * R.x + cos(ang) * R.y);
    float warm1 = bar(rr.y,  0.34, 0.10);
    float warm2 = bar(rr.y, -0.52, 0.07);
    float cold  = bar(rr.x,  0.58, 0.10);
    float fres = pow(1.0 - n.z, 1.6);
    vec3 col = vec3(0.012, 0.012, 0.014);                              // the dark room
    col += vec3(0.07, 0.075, 0.085) * smoothstep(-0.6, 0.9, rr.y) * (0.4 + fres); // faint ceiling → silver body
    col += uGold * 0.75 * warm1;
    col += (uGold * 1.5 + vec3(0.15)) * warm2;
    col += (uCool * 0.8 + vec3(0.08)) * cold;
    col += uEmber * 0.20 * fres;

    float inBody = 1.0 - smoothstep(-0.004, 0.004, sd.x);
    float inFull = 1.0 - smoothstep(-0.004, 0.004, sd.y);
    // The opening (star + flare) is the same liquid seen far below:
    // darker, slower to catch the light, with the lip lit.
    float s = max(sd.x, 0.0);
    vec3 below = col * (0.22 + 0.25 * exp(-s * 10.0));
    col = mix(below, col, inBody);
    // Meniscus shadow just inside the solid face, then the gold line
    // around the whole logo.
    col *= mix(1.0, 0.6, inBody * exp(-max(-sd.x, 0.0) / 0.03));
    col += uGold * (1.5 + 0.8 * uPulse) * edgeLine(sd, 0.0055);
    gl_FragColor = vec4(col * uGain * inFull, 1.0);
  }
`;

// ---- R: STRATA ----------------------------------------------------------
// The logo carved into terraces, like a topographic model lit from the
// side. The field is the distance from the nearest edge (so the terraces
// follow the star and the A) bent by noise; contour lines are thin gold
// and risers catch the light. Five motions are layered so it never sits
// still or repeats:
//   1. the whole map creeps (contours crawl inward)
//   2. two noise fields drift against each other, so lines merge, split
//      and re-route
//   3. the terrace spacing breathes (the map slowly zooms)
//   4. beads of light run along the contours, alternate lines in
//      opposite directions
//   5. a band of brightness climbs the terraces, and every so often a
//      tide of light leaves the star by itself (Space fires one now)
//   a = terrace density, b = how much noise bends the contours, c = speed
const FRAG_STRATA = COMMON + /* glsl */`
  float field(vec2 p) {
    vec2 q = (p - uPivot) / uUnit;
    vec2 sd = sdfN(p);
    float sp = 0.5 + uC;
    float n1 = fbm(q * 2.3 + uSeed + vec2(0.0, uTime * 0.020 * sp));
    float n2 = fbm3(q * 4.6 - uSeed * 0.7 + vec2(uTime * 0.031 * sp, -uTime * 0.017 * sp));
    // Body climbs away from its edges; the opening descends.
    float h = sd.x < 0.0 ? -sd.x : -sd.x * 1.2;
    float dens = (24.0 + 30.0 * uA) * (1.0 + 0.12 * sin(uTime * 0.11));
    return h * dens + (n1 - 0.5) * (2.0 + 5.0 * uB) + (n2 - 0.5) * (0.6 + 1.6 * uB)
         + uTime * (0.04 + 0.12 * uC);
  }
  void main() {
    vec2 q = (vP - uPivot) / uUnit;
    vec2 sd = sdfN(vP);
    float e = uUnit * 0.008;
    float F = field(vP);
    vec2 g = vec2(field(vP + vec2(e, 0.0)) - F, field(vP + vec2(0.0, e)) - F) / 0.008;
    float gl = length(g) + 1e-4;
    float fl = floor(F), fr = fract(F);
    float dLine = min(fr, 1.0 - fr) / gl;                 // distance to the nearest contour
    float line = 1.0 - smoothstep(0.0008, 0.0024, dLine);
    float lineId = floor(F + 0.5);                        // which contour that is
    float riser = 1.0 - smoothstep(0.0, 0.009, fr / gl);
    vec2 gd = g / gl;
    float lit = clamp(dot(gd, normalize(uLight)) * 0.5 + 0.5, 0.0, 1.0);
    float inBody = 1.0 - smoothstep(-0.003, 0.003, sd.x);
    float inFull = 1.0 - smoothstep(-0.003, 0.003, sd.y);
    float r = length(q);

    float lvl = hash21(vec2(fl, uSeed));
    float height = clamp((sd.x < 0.0 ? -sd.x : 0.0) * 4.0, 0.0, 1.0);
    vec3 col = mix(vec3(0.012, 0.011, 0.013), uDeep * 0.22, height) * (0.6 + 0.8 * lvl);
    col += mix(uCool * 0.06, uGold * 0.55, lit * lit) * riser;
    col *= 1.0 - 0.55 * (1.0 - smoothstep(0.0, 0.03, (1.0 - fr) / gl));

    // (5) a band of brightness climbing the terraces.
    float band = pow(0.5 + 0.5 * sin(lineId * 0.55 - uTime * 0.9), 6.0);
    // (4) beads running along the contours. The angle about the star
    // centre is the "along the line" coordinate; odd lines run backward.
    float dirn = mod(lineId, 2.0) < 0.5 ? 1.0 : -1.0;
    float along = atan(q.y, q.x) * (7.0 + 5.0 * hash21(vec2(lineId, 3.0)))
                + dirn * uTime * (0.5 + 0.9 * hash21(vec2(lineId, 7.0))) + lineId * 2.4;
    float bead = pow(0.5 + 0.5 * sin(along), 14.0);
    float index = step(4.5, mod(lineId, 5.0));            // every fifth line is the bright index line
    vec3 lineCol = mix(uEmber * 0.55, uGold * 1.4, index);
    col += lineCol * line * (0.55 + 1.3 * band);
    col += (uGold * 2.6 + vec3(0.5)) * line * bead;
    // (5) the tide: one wave of light from the star every ~11 s, plus Space.
    float tideT = fract(uTime / 11.0 + uSeed * 0.37);
    float tide = exp(-abs(r - tideT * 1.5) / 0.045) * (1.0 - tideT);
    float wave = uPulse * exp(-abs(r - (1.0 - uPulse) * 1.3) / 0.05);
    col += uGold * (tide * 0.8 + wave) * (0.2 + 1.6 * line + 0.6 * riser);

    // The opening (star + flare): the same map going DOWN — cooler,
    // dimming gently with depth instead of stopping at the neck.
    float s = max(sd.x, 0.0);
    vec3 pit = col * vec3(0.62, 0.74, 1.0) * (0.30 + 0.70 * exp(-s * 5.0))
             + uGold * 0.8 * exp(-r * 30.0);
    col = mix(pit, col, inBody);
    // Gold line around the entire logo.
    col += uGold * 1.5 * edgeLine(sd, 0.0045);
    gl_FragColor = vec4(col * uGain * inFull, 1.0);
  }
`;

// ---- T: SHARDS ----------------------------------------------------------
// Faceted obsidian. Every cell is a little mirror with its own tilt; as
// the light drifts, facets flash gold one after another. The cracks
// between them glow from inside, in waves that travel out from the star.
//   a = shard size (small → large), b = facet tilt, c = crack glow
const FRAG_SHARDS = COMMON + /* glsl */`
  // Cellular field: nearest site id, vector to it, distance to the border.
  vec3 cells(vec2 x, out vec2 id) {
    vec2 n = floor(x), f = fract(x);
    vec2 mg, mr;
    float md = 8.0;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(n + g + uSeed);
      o = 0.5 + 0.42 * sin(uTime * 0.07 + 6.2831 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; }
    }
    float mb = 8.0;
    for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 o = hash22(n + g + uSeed);
      o = 0.5 + 0.42 * sin(uTime * 0.07 + 6.2831 * o);
      vec2 r = g + o - f;
      if (dot(mr - r, mr - r) > 1e-5) mb = min(mb, dot(0.5 * (mr + r), normalize(r - mr)));
    }
    id = n + mg;
    return vec3(mr, mb);
  }
  void main() {
    vec2 q = (vP - uPivot) / uUnit;
    vec2 sd = sdfN(vP);
    float inBody = 1.0 - smoothstep(-0.003, 0.003, sd.x);
    float r = length(q);
    // Shards get finer toward the star and finer still inside it.
    float scale = mix(15.0, 8.0, uA) * (inBody > 0.5 ? 1.0 : 2.1);
    vec2 id;
    vec3 c = cells(q * scale + (inBody > 0.5 ? vec2(0.0) : uSway * 6.0), id);
    float border = c.z / scale;                       // uUnit lengths
    vec2 h = hash22(id + 3.0);
    // Facet normal: its own tilt, rocking slowly.
    float tilt = 0.35 + 0.9 * uB;
    vec3 n = normalize(vec3((h - 0.5) * tilt
             + 0.10 * vec2(sin(uTime * 0.5 + h.x * 20.0), cos(uTime * 0.43 + h.y * 20.0)), 1.0));
    vec3 L = normalize(vec3(uLight, 0.55));
    float diff = max(dot(n, L), 0.0);
    float spec = pow(max(reflect(-L, n).z, 0.0), 60.0);
    float fres = pow(1.0 - n.z, 2.0);
    vec3 base = mix(vec3(0.014, 0.012, 0.014), uDeep * 0.26, step(0.72, h.x));
    vec3 col = base * (0.25 + 1.6 * diff * diff);
    col += uGold * spec * 2.6;
    col += uCool * 0.10 * fres + uGold * 0.20 * fres * diff;
    // Raised facets: one side of every crack sits in shadow.
    float sideLit = dot(normalize(c.xy + 1e-5), normalize(uLight));
    col *= 1.0 - 0.5 * exp(-border / 0.010) * smoothstep(-0.2, 0.6, sideLit);
    // Cracks glow from inside in waves leaving the star.
    float wave = 0.5 + 0.5 * sin(r * 9.0 - uTime * 1.1 + h.y * 2.0);
    float crack = exp(-border / 0.0020);
    // Only the crest of each wave lights the cracks; between waves they are dark seams.
    float crest = pow(wave, 6.0);
    col += mix(uEmber, uGold, crest) * crack * (0.05 + (0.5 + 1.5 * uC) * crest + 2.2 * uPulse);

    // Inside the star: the same stone, deeper — a geode with a lit core.
    // The opening (star + flare) is the same stone, deeper and finer —
    // it dims gently with depth rather than stopping at the neck.
    float s = max(sd.x, 0.0);
    vec3 geode = col * (0.28 + 0.34 * exp(-s * 5.0)) + uGold * 0.9 * exp(-r * 30.0);
    col = mix(geode, col, inBody);
    // Gold line around the entire logo.
    float inFull = 1.0 - smoothstep(-0.003, 0.003, sd.y);
    col += uGold * 1.8 * edgeLine(sd, 0.005);
    gl_FragColor = vec4(col * uGain * inFull, 1.0);
  }
`;

const FRAGS = {
  mercury: FRAG_MERCURY,
  strata:  FRAG_STRATA,
  shards:  FRAG_SHARDS,
};

export function createShaderLooks({ sdf, pivot = [0, 0] }) {
  const group = new THREE.Group();
  group.name = 'shaderLooks';
  if (!sdf) return { group, update: () => {}, pulse: () => {} };

  // Drawn area = the logo's full outline (arch + base), slightly
  // oversized; the shaders trim to the exact edge with the SDF.
  const shape = new THREE.Shape((sdf.fullLoop || sdf.hullLoop).map(p => new THREE.Vector2(p.x, p.y)));
  const geom = new THREE.ShapeGeometry(shape);
  const meshes = {};
  for (const name of SHADER_LOOK_MODES) {
    const uniforms = {
      uSdf:   { value: sdf.tex },
      uBox:   { value: sdf.box },
      uPivot: { value: new THREE.Vector2(pivot[0] || 0, pivot[1] || 0) },
      uUnit:  { value: sdf.unit },
      uTime:  { value: 0 },
      uSeed:  { value: 0 },
      uA:     { value: 0.5 },
      uB:     { value: 0.5 },
      uC:     { value: 0.5 },
      uPulse: { value: 0 },
      uLight: { value: new THREE.Vector2(-0.5, 0.6) },
      uSway:  { value: new THREE.Vector2() },
      uGain:  { value: 1 },
      uGold:  { value: new THREE.Color('#FFC56A') },
      uEmber: { value: new THREE.Color('#FF4A12') },
      uDeep:  { value: new THREE.Color('#5A0A12') },
      uCool:  { value: new THREE.Color('#3A5C8C') },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT, fragmentShader: FRAGS[name],
      depthWrite: false, depthTest: false, transparent: true,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = -0.5;
    mesh.frustumCulled = false;
    mesh.visible = false;
    group.add(mesh);
    meshes[name] = { mesh, uniforms };
  }

  let pulseEnv = 0;
  function pulse() { pulseEnv = 1; }

  function update(t, dt, mode) {
    pulseEnv *= Math.exp(-dt / 1.1);
    for (const name of SHADER_LOOK_MODES) {
      const m = meshes[name];
      const on = mode === name;
      m.mesh.visible = on;
      if (!on) continue;
      const all = ANIM.shaderLooks || {};
      const c = all[name] || {};
      const u = m.uniforms;
      u.uTime.value = t;
      u.uSeed.value = c.seed ?? 0;
      u.uA.value = c.a ?? 0.5;
      u.uB.value = c.b ?? 0.5;
      u.uC.value = c.c ?? 0.5;
      u.uPulse.value = pulseEnv;
      u.uGain.value = c.gain ?? 1;
      const la = t * (2 * Math.PI / (all.lightPeriod ?? 29));
      u.uLight.value.set(Math.cos(la) * 0.8, 0.35 + 0.5 * Math.sin(la * 0.63));
      const amp = all.sway ?? 0.06;
      u.uSway.value.set(amp * Math.sin(t * 0.27), amp * 0.7 * Math.sin(t * 0.19 + 1.1));
      u.uGold.value.set(all.gold  || '#FFC56A');
      u.uEmber.value.set(all.ember || '#FF4A12');
      u.uDeep.value.set(all.deep  || '#5A0A12');
      u.uCool.value.set(all.cool  || '#3A5C8C');
    }
  }

  return { group, update, pulse };
}
