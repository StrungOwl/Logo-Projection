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

export function createMolten({ logoMesh, meta, renderer }) {
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
  // Tiny organic embers: per-particle size, alpha envelope (fade in →
  // fade out over its life), and horizontal wander — a custom shader
  // Points because PointsMaterial can't do per-particle size/alpha.
  const sparkCfg = () => (ANIM.molten?.sparks) || {};
  const SPARKS = Math.max(8, sparkCfg().count ?? 90);
  const sparkPos   = new Float32Array(SPARKS * 3);
  const sparkSize  = new Float32Array(SPARKS);
  const sparkAlpha = new Float32Array(SPARKS);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute('aSize',    new THREE.BufferAttribute(sparkSize, 1));
  sparkGeo.setAttribute('aAlpha',   new THREE.BufferAttribute(sparkAlpha, 1));
  const sparkMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color('#FFD870').multiplyScalar(2.2) },
      // Half the drawing-buffer height — synced per frame so sprites keep
      // their world size across window/projection/export resolutions.
      uScale: { value: 400 },
    },
    vertexShader: /* glsl */`
      attribute float aSize;
      attribute float aAlpha;
      uniform float uScale;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.25, 0.02, dot(d, d)) * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.position.z = zFront + 0.05;
  sparks.renderOrder = 7;
  sparks.frustumCulled = false;
  group.add(sparks);
  const drawSize = new THREE.Vector2();

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
  for (let i = 0; i < SPARKS; i++) {
    sparkState.push({
      baseX: 0, y: minY - 100, vy: 0, life: 0, maxLife: 1,
      size: 0.05, wanderFreq: 1, seed: Math.random() * Math.PI * 2,
    });
  }

  function respawnSpark(s, surfaceLevel) {
    const sc = sparkCfg();
    for (let tries = 0; tries < 12; tries++) {
      const x = xMin + Math.random() * (xMax - xMin);
      if (insideAt(x, surfaceLevel)) {
        s.baseX = x;
        s.y = surfaceLevel + (Math.random() - 0.5) * 0.4;
        s.vy = 0.35 + Math.random() * 1.1;
        s.maxLife = 0.8 + Math.random() * 1.8;
        s.life = s.maxLife;
        const jitter = 1 + (Math.random() * 2 - 1) * (sc.sizeJitter ?? 0.6);
        s.size = (sc.size ?? 0.055) * jitter;
        s.wanderFreq = 1.2 + Math.random() * 2.6;
        s.seed = Math.random() * Math.PI * 2;
        return;
      }
    }
    s.life = 0;   // no valid column at this level (e.g. fill inside cutout)
  }

  // ---- fill state machine ---------------------------------------------
  // Default life is the autonomous CYCLE: rise all the way to the top →
  // hold there a beat → drain away to reveal the starry sky → rest →
  // repeat, sin-eased throughout. Manual triggers switch to 'anim' and
  // the cycle re-seats itself at the matching phase afterward.
  const st = {
    fill: 0.1,
    mode: 'idle',        // 'idle' (cycle or breathing) | 'anim'
    animFrom: 0.1,
    animTo: 0.1,
    animT: 0,
    animDur: 1,
    cyclePhase: 'rise',  // 'rise' | 'holdTop' | 'drain' | 'holdBottom'
    cycleT: 0,
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
    fill:     () => animTo(cfg().fillTop ?? 1.0, cfg().fillDuration ?? 12),
    drain:    () => animTo(cfg().drainTo ?? 0.02, cfg().drainDuration ?? 8),
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
    const top = c.fillTop ?? 1.0;
    const bot = c.drainTo ?? 0.02;
    if (st.mode === 'anim') {
      st.animT += dt;
      const k = Math.min(1, st.animT / st.animDur);
      const e = k * k * (3 - 2 * k);
      st.fill = st.animFrom + (st.animTo - st.animFrom) * e;
      if (k >= 1) {
        st.mode = 'idle';
        // Re-seat the cycle at whatever phase matches where we landed.
        if      (st.fill >= top - 0.03) { st.cyclePhase = 'holdTop';    st.cycleT = 0; }
        else if (st.fill <= bot + 0.03) { st.cyclePhase = 'holdBottom'; st.cycleT = 0; }
        else {
          st.cyclePhase = 'rise';
          st.cycleT = ((c.cycle?.rise ?? 20)) * ((st.fill - bot) / Math.max(top - bot, 1e-3));
        }
        st.idleCenter = st.fill;
        st.idlePhase = 0;
      }
    } else if (c.cycle?.enabled !== false) {
      // Autonomous rise → holdTop → drain → holdBottom loop, sin-eased.
      const cy = c.cycle || {};
      const durs = {
        rise:       cy.rise       ?? 20,
        holdTop:    cy.holdTop    ?? 6,
        drain:      cy.drain      ?? 12,
        holdBottom: cy.holdBottom ?? 9,
      };
      const seq = ['rise', 'holdTop', 'drain', 'holdBottom'];
      st.cycleT += dt;
      let dur = Math.max(0.1, durs[st.cyclePhase]);
      while (st.cycleT >= dur) {
        st.cycleT -= dur;
        st.cyclePhase = seq[(seq.indexOf(st.cyclePhase) + 1) % seq.length];
        dur = Math.max(0.1, durs[st.cyclePhase]);
      }
      const k = Math.min(1, st.cycleT / dur);
      const e = k * k * (3 - 2 * k);
      if      (st.cyclePhase === 'rise')  st.fill = bot + (top - bot) * e;
      else if (st.cyclePhase === 'drain') st.fill = top - (top - bot) * e;
      else if (st.cyclePhase === 'holdTop') st.fill = top;
      else st.fill = bot;
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

    // Sparks ride the (unwaved) surface line. Organic motion: each ember
    // rises at its own speed, wanders sideways on its own frequency, and
    // fades in/out over its life (sin envelope) at its own size.
    if (renderer) {
      renderer.getDrawingBufferSize(drawSize);
      sparkMat.uniforms.uScale.value = drawSize.y * 0.5;
    }
    const sc = sparkCfg();
    const surfaceLevel = minY + (maxY - minY) * st.fill;
    const rate = (sc.rate ?? 1) * (surging ? 3 : 1);
    const wander = sc.wander ?? 0.35;
    for (let i = 0; i < SPARKS; i++) {
      const s = sparkState[i];
      s.life -= dt * rate;
      if (s.life <= 0) {
        // Stagger respawns so the emitter never pulses in sync.
        if (Math.random() < 0.25 * rate) respawnSpark(s, surfaceLevel);
        else { sparkAlpha[i] = 0; sparkPos[i * 3 + 1] = minY - 100; continue; }
      }
      s.y += s.vy * dt * (surging ? 1.8 : 1);
      const frac = Math.max(0, Math.min(1, s.life / s.maxLife));
      sparkAlpha[i] = Math.sin(Math.PI * frac) * 0.9;
      sparkSize[i]  = s.size;
      sparkPos[i * 3]     = s.baseX + Math.sin(t * s.wanderFreq + s.seed) * wander * (1 - frac * 0.5);
      sparkPos[i * 3 + 1] = s.y;
      sparkPos[i * 3 + 2] = 0;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.aSize.needsUpdate = true;
    sparkGeo.attributes.aAlpha.needsUpdate = true;
  }

  return {
    group, update, triggers,
    getFill: () => st.fill,
  };
}
