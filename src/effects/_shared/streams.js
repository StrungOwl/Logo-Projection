// Two particle passes that share emergence geometry (the inner-star
// outline on the front face) but drift to different targets:
//
//   • Ember particles — warm orange, target a cloud around a distant
//     attractor behind the logo. Sells the back-glow "portal" read.
//   • White particles — cool white, target a single shared vanishing
//     point. Reads as perspective rays into the distance.
//
// Both loop independently per-particle on a Bezier arc
// (origin → passage → target), with a quintic ease so density is
// highest near the origin (most of the cycle is spent clustered on the
// traced outline).

import * as THREE from 'three';
import { ANIM } from '../../config.js';
import { hexToRgb } from '../../util/color.js';
import { QUALITY } from '../../quality.js';

// -----------------------------------------------------------------------
// Inner-star outline extraction. Elliptical filter: vertical axis grows
// as y goes negative so the region stretches down to the cutout's bottom
// corners without widening sideways (which would start catching the
// outer silhouette).
// -----------------------------------------------------------------------
function extractStarSegments(logoMesh) {
  const edgesGeo = new THREE.EdgesGeometry(logoMesh.geometry, 30);
  const edgePos = edgesGeo.attributes.position;

  logoMesh.geometry.computeBoundingBox();
  const bbox = logoMesh.geometry.boundingBox;
  const frontZ = bbox.max.z;
  const halfExtent = Math.max((bbox.max.x - bbox.min.x) * 0.5, (bbox.max.y - bbox.min.y) * 0.5);
  const zTol = Math.max(halfExtent * 0.02, 0.1);
  const innerRadius     = halfExtent * 0.58;
  const innerRadiusDown = halfExtent * 0.98;  // stretched downward

  const segments = [];
  for (let i = 0; i < edgePos.count; i += 2) {
    const x1 = edgePos.getX(i),     y1 = edgePos.getY(i),     z1 = edgePos.getZ(i);
    const x2 = edgePos.getX(i + 1), y2 = edgePos.getY(i + 1), z2 = edgePos.getZ(i + 1);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const vNorm = my >= 0 ? my / innerRadius : my / innerRadiusDown;
    const hNorm = mx / innerRadius;
    const inside = (hNorm * hNorm + vNorm * vNorm) < 1;
    if (inside && Math.abs(z1 - frontZ) < zTol && Math.abs(z2 - frontZ) < zTol) {
      segments.push({ x1, y1, x2, y2 });
    }
  }

  // Fallback: if no inner cutout was detected, synthesise a circular
  // arch outline so particles still have something to emerge from.
  if (segments.length === 0) {
    const R = innerRadius * 0.7;
    const N = 48;
    for (let i = 0; i < N; i++) {
      const a1 = (i / N) * Math.PI * 2;
      const a2 = ((i + 1) / N) * Math.PI * 2;
      segments.push({
        x1: Math.cos(a1) * R, y1: Math.sin(a1) * R,
        x2: Math.cos(a2) * R, y2: Math.sin(a2) * R,
      });
    }
  }

  return { segments, frontZ, halfExtent, bbox };
}

// Samples a point exactly on the star outline, weighted by segment length.
function makeOutlineSampler(segments) {
  let totalLength = 0;
  const lengths = segments.map(s => {
    const l = Math.sqrt((s.x2 - s.x1) ** 2 + (s.y2 - s.y1) ** 2);
    totalLength += l;
    return l;
  });

  return () => {
    let t = Math.random() * totalLength;
    let idx = 0;
    while (idx < lengths.length - 1 && t > lengths[idx]) { t -= lengths[idx]; idx++; }
    const s = segments[idx];
    const frac = lengths[idx] > 0 ? t / lengths[idx] : 0;
    return [s.x1 + (s.x2 - s.x1) * frac, s.y1 + (s.y2 - s.y1) * frac];
  };
}

// Shared Bezier vertex shader — identical for both passes.
const VERTEX_SHADER = `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uCycleDuration;
  uniform float uBrightness;
  attribute vec3 aPassage;
  attribute vec3 aTarget;
  attribute float aRandom;
  attribute float aSpeed;
  attribute float aSize;
  varying float vAlpha;
  varying float vProgress;
  varying float vSize;

  void main() {
    // Each particle loops independently.
    float cycleDuration = uCycleDuration / aSpeed;
    float t = mod(uTime + aRandom * cycleDuration, cycleDuration) / cycleDuration;

    // Steep ease-in (quintic) — particles cluster tightly near the
    // origin for most of the cycle and accelerate only near the end,
    // so density reads highest at the start of their lifespan.
    float eased = t * t * t * t * t;

    // Quadratic Bezier: deep inside -> star passage -> outward & forward.
    vec3 p0 = position;
    vec3 p1 = aPassage;
    vec3 p2 = aTarget;
    float mt = 1.0 - eased;
    vec3 pos = mt*mt*p0 + 2.0*mt*eased*p1 + eased*eased*p2;

    // Wobble — zero at origin so the outline reads crisply, growing
    // only as particles leave the star and drift toward the attractor.
    float wobble = eased * 1.0;
    pos.x += sin(uTime * 0.9 + aRandom * 50.0) * 0.6 * wobble;
    pos.y += cos(uTime * 0.7 + aRandom * 50.0) * 0.6 * wobble;
    pos.y += eased * eased * 1.2;  // extra gentle lift as they fly out

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPos;

    // Gentle flicker like real embers.
    float flicker = 0.7 + 0.3 * sin(uTime * 3.0 + aRandom * 6.28);
    float sizeCurve = 0.6 + 0.4 * sin(t * 3.14159);
    gl_PointSize = max(aSize * (10.0 + sizeCurve * 9.0) * flicker * uPixelRatio * (1.0 / -mvPos.z), 1.0);

    // Quick fade-in so particles are already bright while dense at origin.
    float fadeIn  = smoothstep(0.0, 0.04, t);
    float fadeOut = 1.0 - smoothstep(0.55, 1.0, t);
    vAlpha = fadeIn * fadeOut * uBrightness;
    vProgress = t;
    vSize = aSize;
  }
`;

// Shared tight-core-plus-halo fragment shader. Colors come from uniforms
// so ember (warm) and white (cool) share the same pixel logic.
const FRAGMENT_SHADER = `
  uniform vec3 uBodyColor;
  uniform vec3 uCoreColor;
  varying float vAlpha;
  varying float vProgress;
  varying float vSize;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;

    float core = 1.0 - smoothstep(0.0, 0.12, d);
    float halo = 1.0 - smoothstep(0.0, 0.5, d);
    halo = pow(halo, 1.8);

    vec3 color = mix(uBodyColor, uCoreColor, core * 0.85);

    // Big particles get a more prominent hot core.
    float bigBoost = smoothstep(2.0, 4.5, vSize);
    color += uCoreColor * core * bigBoost * 0.7;

    gl_FragColor = vec4(color, halo * vAlpha);
  }
`;

const PARTICLE_COUNT = 20000;

function buildParticleMaterial(renderer, animCfg) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime:          { value: 0 },
      uPixelRatio:    { value: renderer.getPixelRatio() },
      uCycleDuration: { value: animCfg.cycleDuration },
      uBodyColor:     { value: new THREE.Vector3(...hexToRgb(animCfg.bodyColor)) },
      uCoreColor:     { value: new THREE.Vector3(...hexToRgb(animCfg.coreColor)) },
      uBrightness:    { value: animCfg.brightness },
    },
    vertexShader:   VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthTest:   true,    // let the logo mesh depth-cull blocked particles
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
  });
}

// Ember-style size distribution: mostly fine dust with occasional
// bright hero embers.
function sampleEmberSize() {
  const r = Math.random();
  if (r < 0.08) return 3.2 + Math.random() * 2.5;       // bright hero
  if (r < 0.3)  return 1.4 + Math.random() * 1.2;       // medium
  return 0.4 + Math.random() * 0.8;                     // fine dust
}

// Build a Points geometry for a particle pass. `targetFn(halfExtent, rand)`
// returns the [x,y,z] target for each particle so ember/white can diverge
// while sharing the emergence setup.
function buildParticleGeometry(sampleOutline, halfExtent, frontZ, passageFn, targetFn) {
  const origins  = new Float32Array(PARTICLE_COUNT * 3);
  const passages = new Float32Array(PARTICLE_COUNT * 3);
  const targets  = new Float32Array(PARTICLE_COUNT * 3);
  const randoms  = new Float32Array(PARTICLE_COUNT);
  const speeds   = new Float32Array(PARTICLE_COUNT);
  const sizes    = new Float32Array(PARTICLE_COUNT);

  const jitter = halfExtent * 0.004;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // Origin: on the inner-star outline with tiny jitter for crisp read.
    const [ox, oy] = sampleOutline();
    origins[i * 3]     = ox + (Math.random() - 0.5) * jitter;
    origins[i * 3 + 1] = oy + (Math.random() - 0.5) * jitter;
    origins[i * 3 + 2] = frontZ;

    const [px, py, pz] = passageFn(sampleOutline, halfExtent, frontZ);
    passages[i * 3]     = px;
    passages[i * 3 + 1] = py;
    passages[i * 3 + 2] = pz;

    const [tx, ty, tz] = targetFn(halfExtent, frontZ);
    targets[i * 3]     = tx;
    targets[i * 3 + 1] = ty;
    targets[i * 3 + 2] = tz;

    randoms[i] = Math.random();
    speeds[i]  = 0.25 + Math.random() * 0.7;
    sizes[i]   = sampleEmberSize();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(origins, 3));
  geo.setAttribute('aPassage', new THREE.BufferAttribute(passages, 3));
  geo.setAttribute('aTarget',  new THREE.BufferAttribute(targets, 3));
  geo.setAttribute('aRandom',  new THREE.BufferAttribute(randoms, 1));
  geo.setAttribute('aSpeed',   new THREE.BufferAttribute(speeds, 1));
  geo.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1));
  return geo;
}

// Ember pass: passage still traces the outline, but nudged behind the
// front face so the Bezier arc stays BEHIND the model the whole way to
// the attractor (no forward bulge in front of the logo). Targets form a
// soft cloud so particles drift toward the distance rather than a point.
function emberPassage(sampleOutline, halfExtent, frontZ) {
  const [px, py] = sampleOutline();
  return [px, py, frontZ - halfExtent * 0.1];
}
function makeEmberTargetFn() {
  // Pre-bake attractor so every particle samples around the same point.
  return (halfExtent, frontZ) => {
    const attractorX = 0;
    const attractorY = halfExtent * 3.5;
    const attractorZ = frontZ - halfExtent * 6.0;
    const spread     = halfExtent * 2.2;
    return [
      attractorX + (Math.random() - 0.5) * spread,
      attractorY + (Math.random() - 0.5) * spread,
      attractorZ + (Math.random() - 0.5) * spread * 0.8,
    ];
  };
}

// White pass: passage pulled hard onto the central axis — Bezier arc
// funnels every particle through a tight waist before flying on to the
// single shared vanishing point. That makes the convergence much more
// dramatic than the ember cloud.
function whitePassage(_sampleOutline, halfExtent, frontZ) {
  const vanishingY = halfExtent * 0.4;
  return [0, vanishingY * 0.15, frontZ - halfExtent * 2.5];
}
function whiteTarget(halfExtent, frontZ) {
  return [0, halfExtent * 0.4, frontZ - halfExtent * 14.0];
}

// Attach ember + white particle systems onto the logo mesh. Returns the
// two materials so main.js can push uTime / hot-swap color & brightness
// each frame, plus the two Points objects so main.js can hide them in
// view modes (e.g. flame) where the ember/white particle streams would
// compete with the mode's own visual.
export function addParticles(logoMesh, renderer) {
  const { segments, frontZ, halfExtent } = extractStarSegments(logoMesh);
  const sampleOutline = makeOutlineSampler(segments);

  const emberMat = buildParticleMaterial(renderer, ANIM.emberParticles);
  const emberGeo = buildParticleGeometry(sampleOutline, halfExtent, frontZ, emberPassage, makeEmberTargetFn());
  const emberPoints = new THREE.Points(emberGeo, emberMat);
  logoMesh.add(emberPoints);

  const whiteMat = buildParticleMaterial(renderer, ANIM.whiteParticles);
  const whiteGeo = buildParticleGeometry(sampleOutline, halfExtent, frontZ, whitePassage, whiteTarget);
  const whitePoints = new THREE.Points(whiteGeo, whiteMat);
  logoMesh.add(whitePoints);

  return { emberMat, whiteMat, emberPoints, whitePoints };
}

// Per-frame update — hot-swaps color/cycle/brightness so devtools edits
// to ANIM.emberParticles / ANIM.whiteParticles take effect immediately.
// Also applies QUALITY.preset.particles by capping the geometry's draw
// range so MED/LOW render fewer points without rebuilding the buffers.
export function updateParticles({ emberMat, whiteMat, emberPoints, whitePoints }, t) {
  const drawCount = Math.max(1, Math.floor(PARTICLE_COUNT * QUALITY.preset.particles));
  if (emberMat) {
    emberMat.uniforms.uTime.value          = t;
    emberMat.uniforms.uCycleDuration.value = ANIM.emberParticles.cycleDuration;
    emberMat.uniforms.uBodyColor.value.fromArray(hexToRgb(ANIM.emberParticles.bodyColor));
    emberMat.uniforms.uCoreColor.value.fromArray(hexToRgb(ANIM.emberParticles.coreColor));
    emberMat.uniforms.uBrightness.value    = ANIM.emberParticles.brightness;
    if (emberPoints) emberPoints.geometry.setDrawRange(0, drawCount);
  }
  if (whiteMat) {
    whiteMat.uniforms.uTime.value          = t;
    whiteMat.uniforms.uCycleDuration.value = ANIM.whiteParticles.cycleDuration;
    whiteMat.uniforms.uBodyColor.value.fromArray(hexToRgb(ANIM.whiteParticles.bodyColor));
    whiteMat.uniforms.uCoreColor.value.fromArray(hexToRgb(ANIM.whiteParticles.coreColor));
    whiteMat.uniforms.uBrightness.value    = ANIM.whiteParticles.brightness;
    if (whitePoints) whitePoints.geometry.setDrawRange(0, drawCount);
  }
}
