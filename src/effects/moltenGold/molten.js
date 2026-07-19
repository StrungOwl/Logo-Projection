// Molten Gold Fill — signature mode 7. The logo cavity fills with liquid
// gold from the feet upward: a dark ember-red convecting body (domain-
// warped FBM), topped by an overbright rippled meniscus band that blooms
// hard. Above the surface: nothing (discard) — on the physical surface
// the black region is literally unlit, so the fill reads as real liquid
// inside the A.
//
//   createMolten({ logoMesh, meta }) →
//     { group, update(t, dt), getFill(),
//       triggers: { fill, drain, surge, setLevel } }
//
// Behavior: idle breathing between molten.idle.min/max; 'molten.fill'
// animates to 1, 'molten.drain' to near-0, 'molten.setLevel' {level} to
// a target; 'molten.surge' boils the surface for a few seconds (wave amp
// + meniscus boost + spark burst). A ~60-point ember emitter rides the
// surface line. Follows the hearth-flame precedent: depthTest off, drawn
// over the darkened body.

import * as THREE from 'three';
import { ANIM } from '../../config.js';
import { buildSilhouetteShape } from '../../util/geometry.js';
import { pointInPolygon } from '../../util/polygon.js';

export function createMolten({ logoMesh, meta }) {
  const cfg = () => ANIM.molten || {};

  const group = new THREE.Group();
  group.name = 'molten-gold';

  const minY = meta.hullMinY;
  const maxY = meta.hullMaxY;
  const zFront = meta.maxZ + 0.10;

  // ---- liquid body ----------------------------------------------------
  const shape = buildSilhouetteShape(meta.silhouette);
  const geo = new THREE.ShapeGeometry(shape);

  const uniforms = {
    uTime:          { value: 0 },
    uFill:          { value: 0.45 },
    uSurge:         { value: 0 },
    uMinY:          { value: minY },
    uMaxY:          { value: maxY },
    uWaveAmp:       { value: 0.45 },
    uDeepColor:     { value: new THREE.Color('#3A0E02') },
    uHotColor:      { value: new THREE.Color('#D96A14') },
    uMeniscusColor: { value: new THREE.Color('#FFD870') },
    uMeniscusBoost: { value: 3.0 },
  };

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms,
    vertexShader: /* glsl */`
      varying vec2 vPos;
      void main() {
        vPos = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uFill;
      uniform float uSurge;
      uniform float uMinY;
      uniform float uMaxY;
      uniform float uWaveAmp;
      uniform vec3  uDeepColor;
      uniform vec3  uHotColor;
      uniform vec3  uMeniscusColor;
      uniform float uMeniscusBoost;
      varying vec2  vPos;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i),                 hash(i + vec2(1, 0)), u.x),
                   mix(hash(i + vec2(0, 1)),    hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * noise(p);
          p = p * 2.03 + vec2(17.3, 9.1);
          a *= 0.5;
        }
        return v;
      }

      void main() {
        float range = uMaxY - uMinY;
        // Rippled surface line — two travelling wave octaves; surge
        // multiplies amplitude and speeds the churn.
        float waveAmp = uWaveAmp * (1.0 + uSurge * 2.5);
        float wave = (fbm(vec2(vPos.x * 0.55 + uTime * 0.35, uTime * 0.22)) - 0.5) * 2.0
                   + (fbm(vec2(vPos.x * 1.7 - uTime * 0.6, 31.0 + uTime * 0.4)) - 0.5) * 0.7;
        float surfaceY = uMinY + range * uFill + wave * waveAmp;

        if (vPos.y > surfaceY) discard;

        // Depth gradient: hot near the surface, deep ember toward the feet.
        float depth = clamp((surfaceY - vPos.y) / max(range * 0.85, 1e-3), 0.0, 1.0);
        // Convection: slow domain-warped churn, brighter cells rising.
        vec2 q = vPos * 0.35;
        vec2 warp = vec2(fbm(q + uTime * 0.05), fbm(q + vec2(5.2, 1.3) - uTime * 0.04));
        float convect = fbm(q + warp * 1.6 + vec2(0.0, -uTime * (0.08 + uSurge * 0.2)));
        vec3 body = mix(uHotColor, uDeepColor, smoothstep(0.05, 0.8, depth));
        body *= 0.65 + convect * (0.8 + uSurge * 0.8);

        // Meniscus — the overbright band at the surface (this is what
        // blooms). Width breathes slightly with the wave.
        float band = smoothstep(1.4, 0.0, surfaceY - vPos.y);
        vec3 col = body + uMeniscusColor * uMeniscusBoost * band * (1.0 + uSurge * 1.2);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const liquid = new THREE.Mesh(geo, material);
  liquid.position.z = zFront;
  liquid.renderOrder = 6;
  liquid.frustumCulled = false;
  group.add(liquid);

  // ---- meniscus spark emitter -----------------------------------------
  const SPARKS = 60;
  const sparkPos  = new Float32Array(SPARKS * 3);
  const sparkSeed = new Float32Array(SPARKS);   // 0..1 phase offset
  for (let i = 0; i < SPARKS; i++) sparkSeed[i] = Math.random();
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = new THREE.PointsMaterial({
    color: new THREE.Color('#FFD870').multiplyScalar(2.2),
    size: 0.16,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.position.z = zFront + 0.05;
  sparks.renderOrder = 7;
  sparks.frustumCulled = false;
  group.add(sparks);

  // Spark spawn columns: x positions inside the silhouette near a given
  // y — resampled lazily as the fill level moves. Outer loop only; holes
  // (the star cutout) excluded via pointInPolygon tests.
  const outer = meta.silhouette[0];
  const holes = meta.silhouette.slice(1);
  const xs = outer.map(p => p.x);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);

  function insideAt(x, y) {
    if (!pointInPolygon(x, y, outer)) return false;
    for (const h of holes) if (pointInPolygon(x, y, h)) return false;
    return true;
  }

  const sparkState = [];
  for (let i = 0; i < SPARKS; i++) sparkState.push({ x: 0, y: minY - 100, vy: 0, life: 0 });

  function respawnSpark(s, surfaceLevel) {
    for (let tries = 0; tries < 12; tries++) {
      const x = xMin + Math.random() * (xMax - xMin);
      if (insideAt(x, surfaceLevel)) {
        s.x = x;
        s.y = surfaceLevel + (Math.random() - 0.5) * 0.5;
        s.vy = 0.6 + Math.random() * 1.2;
        s.life = 0.7 + Math.random() * 1.4;
        return;
      }
    }
    s.life = 0;   // no valid column at this level (e.g. fill inside cutout)
  }

  // ---- fill state machine ---------------------------------------------
  const st = {
    fill: 0.45,          // current
    mode: 'idle',        // 'idle' | 'anim'
    animFrom: 0.45,
    animTo: 0.45,
    animT: 0,
    animDur: 1,
    idleCenter: 0.45,
    idlePhase: 0,
    surgeUntil: -1,
  };

  function animTo(target, dur) {
    st.mode = 'anim';
    st.animFrom = st.fill;
    st.animTo = Math.min(1, Math.max(0, target));
    st.animT = 0;
    st.animDur = Math.max(0.1, dur);
  }

  const triggers = {
    fill:     () => animTo(1.0, cfg().fillDuration ?? 12),
    drain:    () => animTo(cfg().drainTo ?? 0.06, cfg().drainDuration ?? 8),
    surge:    (t, args) => { st.surgeUntil = st.now + ((args && args.duration) || cfg().surge?.duration || 4); },
    setLevel: (t, args) => animTo((args && args.level) ?? 0.5, (args && args.duration) ?? 3),
  };

  function update(t, dt) {
    st.now = t;
    const c = cfg();
    uniforms.uTime.value = t;
    uniforms.uWaveAmp.value = c.waveAmp ?? 0.45;
    uniforms.uMeniscusBoost.value = c.meniscusBoost ?? 3.0;

    // Surge envelope: fast attack, exponential release.
    const surging = t < st.surgeUntil;
    const sTarget = surging ? 1 : 0;
    const sBlend = 1 - Math.exp(-dt / (surging ? 0.25 : 0.9));
    uniforms.uSurge.value += (sTarget - uniforms.uSurge.value) * sBlend;

    // Fill level.
    if (st.mode === 'anim') {
      st.animT += dt;
      const k = Math.min(1, st.animT / st.animDur);
      const e = k * k * (3 - 2 * k);
      st.fill = st.animFrom + (st.animTo - st.animFrom) * e;
      if (k >= 1) {
        st.mode = 'idle';
        st.idleCenter = st.fill;
        st.idlePhase = 0;
      }
    } else {
      const idle = c.idle || {};
      const lo = idle.min ?? 0.35, hi = idle.max ?? 0.75, period = idle.period ?? 40;
      st.idlePhase += dt;
      // Breathe around idleCenter, drifting toward the configured band.
      const bandCenter = (lo + hi) / 2;
      st.idleCenter += (bandCenter - st.idleCenter) * (1 - Math.exp(-dt / 30));
      const amp = (hi - lo) / 2;
      st.fill = st.idleCenter + Math.sin((st.idlePhase / period) * Math.PI * 2) * amp * 0.9;
    }
    st.fill = Math.min(1, Math.max(0, st.fill));
    uniforms.uFill.value = st.fill;

    // Sparks ride the (unwaved) surface line.
    const surfaceLevel = minY + (maxY - minY) * st.fill;
    const rate = surging ? 3 : 1;
    for (let i = 0; i < SPARKS; i++) {
      const s = sparkState[i];
      s.life -= dt * rate;
      if (s.life <= 0) {
        // Stagger respawns by seed so the emitter never pulses in sync.
        if (Math.random() < 0.25 * rate) respawnSpark(s, surfaceLevel);
        else { sparkPos[i * 3 + 1] = minY - 100; continue; }
      }
      s.y += s.vy * dt * (surging ? 1.8 : 1);
      sparkPos[i * 3]     = s.x;
      sparkPos[i * 3 + 1] = s.y;
      sparkPos[i * 3 + 2] = 0;
    }
    sparkGeo.attributes.position.needsUpdate = true;
  }

  return {
    group, update, triggers,
    getFill: () => st.fill,
  };
}
