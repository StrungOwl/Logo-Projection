// Molten Gold Fill — signature mode 1. The logo cavity fills with liquid
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

export function createMolten({ logoMesh, meta, renderer, sdf = null, sdfOffset = [0, 0] }) {
  const cfg = () => ANIM.molten || {};

  const group = new THREE.Group();
  group.name = 'molten-gold';

  const minY = meta.hullMinY;
  const maxY = meta.hullMaxY;
  const zFront = meta.maxZ + 0.10;

  // ---- liquid body ----------------------------------------------------
  const shape = buildSilhouetteShape(meta.silhouette);
  const geo = new THREE.ShapeGeometry(shape);

  // Signed-distance texture of the logo body (shared with Star Dive):
  // lets the liquid cling to / creep along the walls, bevels the slab at
  // the logo outline and keeps overbright light off the outer edge (so
  // bloom never lands on the wall). Optional — falls back to "no walls".
  const sdfBox = sdf && sdf.box ? sdf.box : new THREE.Vector4(0, 0, 1, 1);
  const uniforms = {
    uTime:          { value: 0 },
    uLevel:         { value: maxY + 10 },   // free-surface height, mesh units
    uDrain:         { value: 0 },           // 0..1 while the surface is falling
    uRise:          { value: 0 },           // 0..1 while the surface is climbing
    uSurge:         { value: 0 },
    uMinY:          { value: minY },
    uMaxY:          { value: maxY },
    uWaveAmp:       { value: 0.45 },
    uSdf:           { value: sdf && sdf.tex ? sdf.tex : null },
    uSdfOn:         { value: sdf && sdf.tex ? 1 : 0 },
    uSdfBox:        { value: sdfBox },
    uSdfOff:        { value: new THREE.Vector2(sdfOffset[0], sdfOffset[1]) },
    uDrip:          { value: new THREE.Vector4(1, 1, 1, 1) },   // drop length, finger length, wall cling, bevel width
    // Tuned for the ACES output: the old '#D96A14' hot tone tonemapped to
    // a brown-orange slab; this pair reads as lit gold with ember depths.
    uDeepColor:     { value: new THREE.Color('#5C1E04') },
    uHotColor:      { value: new THREE.Color('#FFB13A') },
    uMeniscusColor: { value: new THREE.Color('#FFE9A0') },
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
      uniform float uLevel;
      uniform float uDrain;
      uniform float uRise;
      uniform float uSurge;
      uniform float uMinY;
      uniform float uMaxY;
      uniform float uWaveAmp;
      uniform sampler2D uSdf;
      uniform float uSdfOn;
      uniform vec4  uSdfBox;
      uniform vec2  uSdfOff;
      uniform vec4  uDrip;
      uniform vec3  uDeepColor;
      uniform vec3  uHotColor;
      uniform vec3  uMeniscusColor;
      uniform float uMeniscusBoost;
      varying vec2  vPos;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float h11(float n) { return fract(sin(n * 127.1 + 1.7) * 43758.5453123); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);   // quintic: no creases in the relief
        return mix(mix(hash(i),                 hash(i + vec2(1, 0)), u.x),
                   mix(hash(i + vec2(0, 1)),    hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 3; i++) {
          v += a * noise(p);
          p = p * 2.03 + vec2(17.3, 9.1);
          a *= 0.5;
        }
        return v;
      }
      // Polynomial smooth-min: two bodies of liquid neck together.
      float smin(float a, float b, float k) {
        float h = max(k - abs(a - b), 0.0) / k;
        return min(a, b) - h * h * k * 0.25;
      }

      // Free surface height (no wall cling): a slow swell, cheap enough to
      // evaluate again at every drip / tendril root.
      float surf(float x) {
        float a = uWaveAmp * (1.0 + uSurge * 2.5);
        return uLevel + a * (1.6 * sin(x * 0.085 + uTime * 0.42)
                           + 1.0 * sin(x * 0.21  - uTime * 0.66 + 1.7)
                           + 0.5 * sin(x * 0.52  + uTime * 1.05 + 4.0));
      }

      // DRIPS (draining). One bead per column cell, sliding down toward
      // the falling surface with a thinning thread trailing above it —
      // bulb below, tail above — then necking into the pool.
      float drops(vec2 p, float cw, float seed) {
        float d = 1e3;
        float ci = floor(p.x / cw);
        for (int j = -1; j <= 1; j++) {
          float c = ci + float(j);
          float h2 = h11(c * 1.7 + seed + 3.1), h3 = h11(c * 2.3 + seed + 7.7);
          float ph = uTime / mix(3.4, 6.8, h2) + h3;
          float k = fract(ph);
          float hc = h11(c * 3.1 + floor(ph) * 5.3 + seed);
          float cx = (c + 0.5 + (hc - 0.5) * 0.5) * cw + sin(p.y * 0.3 + h3 * 6.28) * 0.22;
          // As the flow dies the drops' reach collapses, so the last ones
          // run down into the pool instead of shrinking in mid-air.
          float D = mix(9.0, 40.0, h11(hc * 91.7 + 0.3)) * uDrip.x * smoothstep(0.0, 0.7, uDrain);
          float rel = D * (1.0 - k * k) - 1.2;
          float r = mix(0.75, 1.9, h11(hc * 37.1 + 2.0))
                  * smoothstep(0.0, 0.22, k) * (1.0 - smoothstep(0.93, 1.0, k)) * smoothstep(0.0, 0.25, uDrain)
                  * step(0.3, h11(hc * 53.9 + 4.0));          // some columns sit a cycle out
          if (r < 0.2) continue;
          float tail = min(D * k * 1.5 + 1.0, mix(12.0, 34.0, h2)) * (1.0 - smoothstep(0.7, 0.97, k)) + 0.01;
          float ay = surf(cx) + rel;
          tail *= 1.0 - 0.97 * smoothstep(0.0, 5.0, uMinY - ay);   // bead gone through the floor: its thread follows
          float t = clamp((p.y - ay) / tail, 0.0, 1.0);
          float rad = r * (1.0 - pow(t, 0.5)) - 0.07;   // threads end before they thin to a scratch
          d = min(d, length(p - vec2(cx, ay + t * tail)) - rad);
        }
        return d;
      }

      // TENDRILS (filling). Rounded fingers that creep up ahead of the
      // front in stick-slip surges, each on its own clock.
      float fingers(vec2 p, float cw, float seed, float rr) {
        float d = 1e3;
        float ci = floor(p.x / cw);
        for (int j = -1; j <= 1; j++) {
          float c = ci + float(j);
          float h1 = h11(c + seed), h2 = h11(c * 1.7 + seed + 3.1), h3 = h11(c * 2.3 + seed + 7.7);
          float cx = (c + 0.5 + (h1 - 0.5) * 0.5) * cw + sin(p.y * 0.17 + h2 * 6.28) * 0.9;
          float grow = 0.55 + 0.45 * sin(uTime * mix(0.35, 0.8, h3) + h2 * 6.28);
          float len = mix(0.5, 17.0, h2 * h2) * grow * uRise * uDrip.y;
          float r = rr * mix(0.55, 1.0, h3) * smoothstep(0.0, 0.3, uRise);
          float ay = surf(cx) - 3.0;
          float L = len + 3.0;
          float t = clamp((p.y - ay) / L, 0.0, 1.0);
          float rad = r * (0.72 + 0.6 * (1.0 - t) * (1.0 - t) + 0.28 * smoothstep(0.7, 1.0, t));
          d = min(d, length(p - vec2(cx, ay + t * L)) - rad);
        }
        return d;
      }

      void main() {
        float range = uMaxY - uMinY;
        vec2 p = vPos;
        float flow = max(uDrain, uRise);

        // Distance inside the logo outline (>0 inside).
        float sd = -1000.0;
        if (uSdfOn > 0.5) {
          vec2 suv = (p - uSdfOff - uSdfBox.xy) * uSdfBox.zw;
          sd = texture2D(uSdf, suv).r;
        }
        float wall = max(-sd, 0.0);

        // ---- the liquid as a signed field (negative = gold) ------------
        // Pool: swell + uneven lobes while it moves + a wetting film that
        // clings to every wall (climbs ahead when filling, lags behind
        // when draining).
        float lobes = (noise(vec2(p.x * 0.13, uTime * 0.16)) - 0.5)
                    * (uRise * 9.0 + uDrain * 5.0 + uSurge * 2.0);
        float clingN = 0.35 + 1.3 * noise(vec2(p.x * 0.05 + 3.0, p.y * 0.12 - uTime * 0.1));
        float cling = (1.0 + uRise * 11.0 + uDrain * 8.0) * uDrip.z * clingN
                    * exp(-wall / (1.6 + 1.2 * flow));
        float S = surf(p.x) + lobes;
        float d = p.y - (S + cling);
        if (flow > 0.004) {
          if (uRise > 0.004 && d < 34.0) {
            d = smin(d, fingers(p, 8.0, 11.0, 2.7), 2.6);
            d = smin(d, fingers(p, 5.6, 47.0, 1.75) + 0.2, 1.8);
          }
          if (uDrain > 0.004 && d < 90.0) {
            float kd = 0.15 + 1.1 * uDrain;
            d = smin(d, drops(p, 5.2, 0.0), kd);
            d = smin(d, drops(p, 3.7, 23.0) + 0.15, kd);
          }
        }

        // World-space gradient through screen derivatives (2x2 Jacobian so
        // it survives any camera).
        vec2 jx = dFdx(p), jy = dFdy(p);
        float det = jx.x * jy.y - jx.y * jy.x;
        det = abs(det) < 1e-9 ? 1e-9 : det;
        float ddx = dFdx(d), ddy = dFdy(d);
        vec2 gL = vec2(ddx * jy.y - ddy * jx.y, ddy * jx.x - ddx * jy.x) / det;
        float gLen = clamp(length(gL), 0.75, 4.0);
        float px = sqrt(abs(det));                 // world units per pixel
        float alpha = clamp(0.5 - d / (px * 1.5), 0.0, 1.0);
        if (alpha < 0.004) discard;
        float distL = max(-d, 0.0) / gLen;         // distance in from the liquid front

        // ---- relief: a thick slab, rounded at its own front and at the
        // logo outline -----------------------------------------------------
        float bw = 1.7 * uDrip.w;
        float bevL = 1.0 - smoothstep(0.0, bw, distL);
        float bevW = 1.0 - smoothstep(0.0, bw * 0.8, wall);
        vec2 gW = vec2(0.0);
        if (uSdfOn > 0.5 && bevW > 0.001) {
          float sx = dFdx(sd), sy = dFdy(sd);
          gW = vec2(sx * jy.y - sy * jx.y, sy * jx.x - sx * jy.x) / det;
          gW /= max(length(gW), 0.5);
        }
        // Interior: slow undulating swell so the flat face catches light.
        vec2 q = p * 0.05;
        vec2 warp = vec2(fbm(q + uTime * 0.045), fbm(q + vec2(5.2, 1.3) - uTime * 0.04));
        vec2 qq = q + warp * 1.1 + vec2(0.0, uTime * (0.05 + uSurge * 0.2 + uDrain * 0.1 - uRise * 0.06));
        float e = 0.35;
        float hf  = fbm(qq);
        float hfx = fbm(qq + vec2(e, 0.0));
        float hfy = fbm(qq + vec2(0.0, e));
        vec2 gH = vec2(hfx - hf, hfy - hf) / e;
        vec3 n = normalize(vec3(
          (gL / gLen) * bevL * bevL * 2.6
          + gW * bevW * bevW * 2.2
          - gH * (0.34 + uSurge * 0.3),
          1.0));

        // ---- gold: mirror-like metal reflecting a dark studio ----------
        vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
        float sky  = smoothstep(-0.25, 0.75, r.y);
        float box1 = exp(-pow((r.y - 0.30) / 0.13, 2.0)) * smoothstep(-0.9, 0.2, -abs(r.x - 0.1));
        float box2 = exp(-pow((r.x + 0.34) / 0.10, 2.0)) * 0.6;
        float env  = 0.17 + 0.55 * sky + 1.15 * box1 + box2;
        float depth = clamp((S - p.y) / max(range * 0.85, 1e-3), 0.0, 1.0);
        vec3 tint = mix(uHotColor, uDeepColor, smoothstep(0.15, 1.0, depth) * 0.72);
        vec3 col = tint * env * (1.0 + uSurge * 0.5);
        // Ember heat glowing in the troughs so the darks stay warm, not grey.
        col += uDeepColor * 0.5 * (1.0 - sky);
        // Key-light glint.
        vec3 Ld = normalize(vec3(-0.42, 0.62, 0.66));
        vec3 Hv = normalize(Ld + vec3(0.0, 0.0, 1.0));
        float spec = pow(max(dot(n, Hv), 0.0), 70.0);
        col += uMeniscusColor * spec * 2.6;
        // Contact shadow just inside the rounded edges: reads as thickness.
        col *= 1.0 - 0.16 * bevL * bevL * smoothstep(-0.2, 0.9, -n.y + n.x * 0.4);

        // Hot meniscus line riding the moving front (the bloom emitter).
        float band = smoothstep(0.55, 0.0, distL);
        col += mix(uHotColor, uMeniscusColor, 0.5) * uMeniscusBoost * band * (0.12 + 0.22 * flow + uSurge * 0.25);

        // Nothing overbright near the logo outline: bloom must not land on
        // the wall behind the piece.
        float cap = mix(1.2, 24.0, smoothstep(1.5, 6.0, wall));
        col = min(col, vec3(cap));

        gl_FragColor = vec4(col, alpha);
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
  // The cycle ENTERS at the top: the piece opens as the fully golden
  // logo, holds, then the surface particlizes downward to reveal the
  // starry sky. Re-entering the mode resets here too (wasVisible edge).
  const st = {
    fill: 1.0,
    prevFill: 1.0,
    mode: 'idle',        // 'idle' (cycle or breathing) | 'anim'
    animFrom: 1.0,
    animTo: 1.0,
    animT: 0,
    animDur: 1,
    cyclePhase: 'holdTop',  // 'rise' | 'holdTop' | 'drain' | 'holdBottom'
    cycleT: 0,
    idleCenter: 0.45,
    idlePhase: 0,
    surgeUntil: -1,
    wasVisible: false,
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
    // Mode-entry reset: every visit opens on the full gold logo.
    if (group.visible && !st.wasVisible) {
      st.mode = 'idle';
      st.cyclePhase = 'holdTop';
      st.cycleT = 0;
      st.fill = c.fillTop ?? 1.0;
      st.prevFill = st.fill;
      uniforms.uDrain.value = 0;
      uniforms.uRise.value = 0;
    }
    st.wasVisible = group.visible;
    if (!group.visible) return;   // hidden: nothing to animate (reset above re-seats on entry)
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
    // The surface is parked well clear of the logo at both ends: at rest
    // the piece is either the whole gold logo or pure sky — no sliver of
    // gold left glowing at the feet, no meniscus line across the top.
    const lv = c.level || {};
    const below = lv.below ?? 12, above = lv.above ?? 8;
    uniforms.uLevel.value = (minY - below) + st.fill * ((maxY - minY) + below + above);
    // Flow envelopes from the surface's own speed: drips while it falls,
    // creeping tendrils while it climbs, a calm mirror when it rests.
    const dr = c.drip || {};
    const vel = dt > 1e-5 ? (st.fill - st.prevFill) / dt : 0;
    st.prevFill = st.fill;
    const ref = dr.speedRef ?? 0.022;
    const eb = 1 - Math.exp(-dt / (dr.ease ?? 1.1));
    uniforms.uDrain.value += (Math.min(1, Math.max(0, -vel / ref)) - uniforms.uDrain.value) * eb;
    uniforms.uRise.value  += (Math.min(1, Math.max(0,  vel / ref)) - uniforms.uRise.value)  * eb;
    uniforms.uDrip.value.set(dr.dropLength ?? 1, dr.fingerLength ?? 1, dr.cling ?? 1, dr.bevel ?? 1);

    // Sparks ride the (unwaved) surface line. Organic motion: each ember
    // rises at its own speed, wanders sideways on its own frequency, and
    // fades in/out over its life (sin envelope) at its own size.
    if (renderer) {
      renderer.getDrawingBufferSize(drawSize);
      sparkMat.uniforms.uScale.value = drawSize.y * 0.5;
    }
    const sc = sparkCfg();
    const surfaceLevel = uniforms.uLevel.value;
    // "Particlize": while the surface descends, the emitter runs hot so
    // the gold visibly dissolves into embers as it recedes.
    const draining = (st.mode === 'idle' && st.cyclePhase === 'drain')
                  || (st.mode === 'anim' && st.animTo < st.animFrom - 0.05);
    const rate = (sc.rate ?? 1) * (surging ? 3 : 1) * (draining ? (sc.drainBurst ?? 2.5) : 1);
    const wander = (sc.wander ?? 0.35) * (draining ? 1.5 : 1);
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
      const sx = s.baseX + Math.sin(t * s.wanderFreq + s.seed) * wander * (1 - frac * 0.5);
      // An ember that drifts off the logo (past the outline or into the
      // star cutout) would land on the wall — put it out.
      if (!insideAt(sx, s.y)) { s.life = 0; sparkAlpha[i] = 0; sparkPos[i * 3 + 1] = minY - 100; continue; }
      sparkAlpha[i] = Math.sin(Math.PI * frac) * 0.9;
      sparkSize[i]  = s.size;
      sparkPos[i * 3]     = sx;
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
