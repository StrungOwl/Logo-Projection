// Edge-light chase — comet heads with tapering ember tails racing along a
// silhouette loop. The most projection-mapping-native effect in the set:
// on the physical surface it reads as the object's own edge lighting up.
//
//   createEdgeChase({ loop, z, cfg, closeLoop }) →
//     { mesh, update(t, dt), burst(t), setMaster(v), uniforms }
//
// Ribbon geometry follows the buildFlameRim pattern in
// src/effects/fireplaceOne/flame.js (two vertices per polygon vertex, one
// on the edge + one offset outward, cumulative arc-length attribute) but
// is built here self-contained: this ribbon supports CLOSED loops (the
// outer silhouette's closing edge is real geometry, unlike the inner
// cutout's synthetic chord which flame.js must skip).
//
// Shader: up to 8 comets, each a hard overbright core (crosses the bloom
// threshold → the head blooms) + exponential tail. Per-comet speed &
// direction variance is assigned at creation (some counter-rotate) —
// bold, per-element variance over uniform motion.

import * as THREE from 'three';
import { ANIM } from '../../config.js';

const MAX_COMETS = 8;

function buildLoopRibbon(loop, thickness, z, closeLoop) {
  const N = loop.length;
  let signedArea = 0;
  for (let i = 0; i < N; i++) {
    const c = loop[i], n = loop[(i + 1) % N];
    signedArea += c.x * n.y - n.x * c.y;
  }
  const ccw = signedArea > 0;

  const normals = new Array(N);
  for (let i = 0; i < N; i++) {
    const prev = loop[(i - 1 + N) % N];
    const cur  = loop[i];
    const next = loop[(i + 1) % N];
    const e1x = cur.x - prev.x, e1y = cur.y - prev.y;
    const e2x = next.x - cur.x, e2y = next.y - cur.y;
    let n1x, n1y, n2x, n2y;
    if (ccw) { n1x =  e1y; n1y = -e1x; n2x =  e2y; n2y = -e2x; }
    else     { n1x = -e1y; n1y =  e1x; n2x = -e2y; n2y =  e2x; }
    const l1 = Math.hypot(n1x, n1y) || 1, l2 = Math.hypot(n2x, n2y) || 1;
    let nx = n1x / l1 + n2x / l2, ny = n1y / l1 + n2y / l2;
    const l = Math.hypot(nx, ny) || 1;
    normals[i] = { x: nx / l, y: ny / l };
  }

  const arcLen = new Float32Array(N);
  for (let i = 1; i < N; i++) {
    arcLen[i] = arcLen[i - 1] + Math.hypot(loop[i].x - loop[i - 1].x, loop[i].y - loop[i - 1].y);
  }
  const closing = Math.hypot(loop[0].x - loop[N - 1].x, loop[0].y - loop[N - 1].y);
  const perimeter = arcLen[N - 1] + closing;

  // Half-thickness inward + half outward so the streak straddles the edge.
  const positions  = new Float32Array(N * 2 * 3);
  const aArc       = new Float32Array(N * 2);
  const aSide      = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const v = loop[i], n = normals[i];
    const inIdx = i * 2, outIdx = i * 2 + 1;
    positions[inIdx * 3]     = v.x - n.x * thickness * 0.5;
    positions[inIdx * 3 + 1] = v.y - n.y * thickness * 0.5;
    positions[inIdx * 3 + 2] = z;
    positions[outIdx * 3]     = v.x + n.x * thickness * 0.5;
    positions[outIdx * 3 + 1] = v.y + n.y * thickness * 0.5;
    positions[outIdx * 3 + 2] = z;
    const a = arcLen[i] / perimeter;
    aArc[inIdx] = a; aArc[outIdx] = a;
    aSide[inIdx] = 0; aSide[outIdx] = 1;
  }

  const indices = [];
  const edges = closeLoop ? N : N - 1;
  for (let e = 0; e < edges; e++) {
    const a = e, b = (e + 1) % N;
    indices.push(a * 2, a * 2 + 1, b * 2 + 1);
    indices.push(a * 2, b * 2 + 1, b * 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aArc',  new THREE.BufferAttribute(aArc, 1));
  geo.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
  geo.setIndex(indices);
  return { geo, perimeter };
}

export function createEdgeChase({ loop, z, cfg = {}, closeLoop = true }) {
  const conf = () => ({ ...(ANIM.edgeChase || {}), ...cfg });
  const c0 = conf();

  const { geo } = buildLoopRibbon(loop, c0.thickness ?? 0.5, z, closeLoop);

  const uniforms = {
    uPhase:     { value: new Float32Array(MAX_COMETS) },
    uIntensity: { value: new Float32Array(MAX_COMETS) },
    uDir:       { value: new Float32Array(MAX_COMETS) },
    uTail:      { value: c0.tailLength ?? 0.10 },
    uHead:      { value: c0.headWidth ?? 0.012 },
    uColorHot:  { value: new THREE.Color(c0.colorHot ?? '#FFF6D8') },
    uColorTail: { value: new THREE.Color(c0.colorTail ?? '#FF7A1E') },
    uMaster:    { value: 1.0 },
  };

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms,
    vertexShader: /* glsl */`
      attribute float aArc;
      attribute float aSide;
      varying float vArc;
      varying float vSide;
      void main() {
        vArc = aArc;
        vSide = aSide;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      #define MAX_COMETS ${MAX_COMETS}
      uniform float uPhase[MAX_COMETS];
      uniform float uIntensity[MAX_COMETS];
      uniform float uDir[MAX_COMETS];
      uniform float uTail;
      uniform float uHead;
      uniform vec3  uColorHot;
      uniform vec3  uColorTail;
      uniform float uMaster;
      varying float vArc;
      varying float vSide;
      void main() {
        // Soft falloff across the ribbon width (edge at side 0.5).
        float widthFade = 1.0 - abs(vSide - 0.5) * 2.0;
        widthFade = widthFade * widthFade * (3.0 - 2.0 * widthFade);
        vec3 col = vec3(0.0);
        float alpha = 0.0;
        for (int i = 0; i < MAX_COMETS; i++) {
          float I = uIntensity[i];
          if (I < 0.001) continue;
          // Arc distance BEHIND the head along travel direction.
          float d = uDir[i] > 0.0 ? uPhase[i] - vArc : vArc - uPhase[i];
          d = fract(d);
          float tail = exp(-d / max(uTail, 1e-4));
          float core = exp(-(d * d) / max(uHead * uHead, 1e-8));
          col   += (uColorHot * core * 3.0 + uColorTail * tail * 0.8) * I;
          alpha += (core + tail * 0.6) * I;
        }
        col   *= widthFade * uMaster;
        alpha *= widthFade * uMaster;
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = 20;
  mesh.frustumCulled = false;

  // Per-comet runtime state: phase 0..1, speed (perimeter fractions/sec,
  // randomized ±speedVariance at creation), direction (odd comets
  // counter-rotate), target intensity.
  const comets = [];
  for (let i = 0; i < MAX_COMETS; i++) {
    const jitter = 1 + ((Math.random() * 2 - 1) * (c0.speedVariance ?? 0.4));
    comets.push({
      phase: Math.random(),
      speedMul: jitter,
      dir: i % 2 === 0 ? 1 : -1,
      intensity: 0,
    });
  }

  let burstUntil = -1;
  // Idle comets run only in the modes that own the chase (flameOnly /
  // moltenGold — set from main.js); edge.burst still flares in ANY mode.
  let idleEnabled = false;

  function burst(t) {
    const bc = conf().burst || {};
    burstUntil = t + (bc.duration ?? 3.0);
  }

  function update(t, dt) {
    const c = conf();
    const bursting = t < burstUntil;
    const bc = c.burst || {};
    const active = bursting ? (c.comets ?? 3) : (idleEnabled ? (c.idleComets ?? 1) : 0);
    const level  = bursting ? (bc.intensity ?? 4.0) : (c.idleIntensity ?? 0.35);
    const speedMul = bursting ? (bc.speedMul ?? 3.0) : 1.0;
    const blend = 1 - Math.exp(-dt / 0.35);

    uniforms.uTail.value = c.tailLength ?? 0.10;
    uniforms.uHead.value = c.headWidth ?? 0.012;

    for (let i = 0; i < MAX_COMETS; i++) {
      const cm = comets[i];
      const target = i < active ? level : 0;
      cm.intensity += (target - cm.intensity) * blend;
      cm.phase = (cm.phase + (c.speed ?? 0.06) * cm.speedMul * speedMul * cm.dir * dt) % 1;
      if (cm.phase < 0) cm.phase += 1;
      uniforms.uPhase.value[i] = cm.phase;
      uniforms.uIntensity.value[i] = cm.intensity;
      uniforms.uDir.value[i] = cm.dir;
    }
  }

  return {
    mesh, uniforms, update, burst,
    // External brightness scale (molten mode drives this with fill level).
    setMaster(v) { uniforms.uMaster.value = v; },
    setIdleEnabled(v) { idleEnabled = !!v; },
    // True while any comet is lit — used to gate mesh visibility.
    isActive() {
      for (let i = 0; i < MAX_COMETS; i++) {
        if (uniforms.uIntensity.value[i] > 0.005) return true;
      }
      return false;
    },
  };
}
