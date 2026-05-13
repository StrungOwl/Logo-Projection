// Galaxy / deep-space shader — stars + nebula + warm core glow, drawn on
// a flat silhouette plate that sits just behind the amber logo. Masked by
// the plate's geometry (convex hull of the logo's front face), so the
// effect automatically conforms to the logo shape.

import * as THREE from 'three';
import { ANIM } from '../config.js';

export function createGalaxyMaterial() {
  return new THREE.ShaderMaterial({
    // Don't write depth: the galaxy sits close behind the front face,
    // and the white particles drift through a vanishing point far
    // behind it. Without this, the galaxy plate's depth value would
    // cull every particle behind it. Particles use additive blending
    // so they read as bright streaks layered over the galaxy.
    depthWrite: false,
    uniforms: {
      uTime:       { value: 0 },
      uCenter:     { value: new THREE.Vector2(0, 0) },
      uRadius:     { value: 1.0 },
      uMinY:       { value: -1.0 },
      uFadeHeight: { value: 1.0 },
      uBrightness: { value: ANIM.galaxy.brightness },
      // Starry-night blend (0..1). Lerped toward 1 by main.js while
      // viewMode === 'fireplace' — fades the nebula + warm core glow out and
      // brings up an extra dense, flicker-heavy star layer over a black
      // background so the flame reads against a clear night sky.
      uStarryMode: { value: 0.0 },
      // Multiplies the visual size of every star by dividing each
      // starLayer's sharpness. main.js lerps this toward >1 in flameOnly
      // mode so the empty backdrop reads richer when the flame is off.
      uStarSizeScale: { value: 1.0 },
      // 0..1 — when active, layers in EXTRA dense + larger star layers
      // on top of the standard starry-mode set. main.js lerps this up
      // during the hex-mode auto-cycle (effect 2 only). Effect 4/5
      // leave it at 0 so their starry look is unchanged.
      uStarryBoost: { value: 0.0 },
    },
    vertexShader: `
      varying vec3 vLocalPos;
      varying vec3 vNormal;
      void main() {
        vLocalPos = position;
        vNormal = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec2 uCenter;
      uniform float uRadius;
      uniform float uMinY;
      uniform float uFadeHeight;
      uniform float uBrightness;
      uniform float uStarryMode;
      uniform float uStarSizeScale;
      uniform float uStarryBoost;
      varying vec3 vLocalPos;
      varying vec3 vNormal;

      float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
                   mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 6; i++) {
          v += a * vnoise(p);
          p = p * 2.03 + vec2(17.0, 31.0);
          a *= 0.5;
        }
        return v;
      }

      float starLayer(vec2 p, float scale, float threshold, float sharpness) {
        p *= scale;
        vec2 cell = floor(p);
        vec2 f = fract(p) - 0.5;
        float n = hash21(cell);
        if (n < threshold) return 0.0;
        vec2 jitter = vec2(hash21(cell + 13.17), hash21(cell + 47.31)) - 0.5;
        float d = length(f - jitter * 0.6);
        float intensity = (n - threshold) / (1.0 - threshold);
        float twinkle = 0.55 + 0.45 * sin(uTime * (1.5 + n * 7.0) + n * 100.0);
        float s = sharpness / max(uStarSizeScale, 0.001);
        return smoothstep(0.5, 0.0, d * s) * intensity * twinkle;
      }

      void main() {
        vec2 p = vLocalPos.xy * 0.08;

        // Domain-warped FBM — q and r feed p back into itself on a slow
        // time offset so the clouds churn and morph in place instead of
        // just scrolling past.
        float tw = uTime * 0.05;
        vec2 q = vec2(
          fbm(p + vec2(tw * 0.6, -tw * 0.4)),
          fbm(p + vec2(5.2, 1.3) - vec2(tw * 0.3, tw * 0.5))
        );
        vec2 r = vec2(
          fbm(p + 3.0 * q + vec2(1.7, 9.2) + vec2(tw * 0.8, 0.0)),
          fbm(p + 3.0 * q + vec2(8.3, 2.8) - vec2(0.0, tw * 0.7))
        );
        float n1 = fbm(p * 0.6 + 2.2 * r);
        float n2 = fbm(p * 1.3 + 1.8 * r + vec2(5.0, -3.0));
        float nebulaDensity = pow(clamp(n1 * n2 * 2.4, 0.0, 1.3), 2.4);
        // Threshold so most of the field falls to pure black void,
        // leaving only brighter tendrils. Lots of empty sky for stars.
        nebulaDensity = smoothstep(0.18, 0.85, nebulaDensity);

        // Desaturated amber/rust palette — warm dust, not technicolor nebula.
        vec3 deepSpace = vec3(0.012, 0.009, 0.018);
        vec3 nebDark   = vec3(0.10, 0.06, 0.04);
        vec3 nebAmber  = vec3(0.60, 0.38, 0.14);
        vec3 nebRust   = vec3(0.40, 0.18, 0.09);
        vec3 nebula = mix(nebDark, nebAmber, n1);
        nebula = mix(nebula, nebRust, smoothstep(0.55, 0.95, n2));

        // Denser starfield — extra layers and lower thresholds so more
        // cells seed a star. Sharpness drives the visual size of each
        // star (lower = bigger glow).
        float stars = 0.0;
        stars += starLayer(vLocalPos.xy, 0.55, 0.78,  5.5) * 1.7;
        stars += starLayer(vLocalPos.xy, 1.10, 0.84,  7.5) * 1.35;
        stars += starLayer(vLocalPos.xy, 2.20, 0.88, 10.0) * 1.05;
        stars += starLayer(vLocalPos.xy, 4.20, 0.92, 13.0) * 0.8;
        stars += starLayer(vLocalPos.xy, 7.50, 0.95, 16.0) * 0.55;
        stars += starLayer(vLocalPos.xy, 12.0, 0.97, 20.0) * 0.4;

        vec3 color = deepSpace;
        color += nebula * nebulaDensity * 0.55;
        color += vec3(1.0, 0.92, 0.78) * stars * 2.4;

        // Vibrant orange back glow — radial gradient brightest at center, fades to rim
        float dCenter = length(vLocalPos.xy - uCenter) / max(uRadius, 0.0001);
        float coreGlow = exp(-dCenter * 1.6);
        float rimHaze  = exp(-dCenter * 3.2) * 0.6;
        vec3 emberColor = vec3(1.0, 0.45, 0.10);
        vec3 hotCore    = vec3(1.0, 0.78, 0.40);
        color += emberColor * coreGlow * 1.8;
        color += hotCore * rimHaze * 1.2;

        // Inner rim ring of brighter heat right at the silhouette edge
        float edgeRing = smoothstep(0.85, 1.0, dCenter) * (1.0 - smoothstep(1.0, 1.05, dCenter));
        color += vec3(1.0, 0.55, 0.18) * edgeRing * 1.5;

        // Starry-night palette — sampled in parallel so we can lerp between
        // the warm-nebula look and the black sky based on uStarryMode.
        // Extra dense star layers + a stronger overall star multiplier give
        // the "many flickering stars" feel during flame mode.
        if (uStarryMode > 0.001) {
          float extraStars = 0.0;
          extraStars += starLayer(vLocalPos.xy, 1.40, 0.86,  7.0) * 1.15;
          extraStars += starLayer(vLocalPos.xy, 2.80, 0.90, 10.0) * 0.85;
          extraStars += starLayer(vLocalPos.xy, 5.40, 0.94, 14.0) * 0.6;
          extraStars += starLayer(vLocalPos.xy, 9.00, 0.97, 19.0) * 0.4;
          vec3 starrySky = vec3(0.0);
          // Multipliers compensate for the dim galaxy uBrightness in
          // flame mode (~0.18) — without the boost the stars almost
          // disappear after the final color * uBrightness multiply.
          starrySky += vec3(1.0, 0.95, 0.85) * stars * 4.0;
          starrySky += vec3(0.92, 0.97, 1.00) * extraStars * 3.0;
          // Boosted layers — lower thresholds (more cells seed a star)
          // and lower sharpness (each star has a bigger soft glow).
          // Combined with main.js raising uStarSizeScale, this gives
          // the effect-2 cycle's "starry sky" a denser, bolder look
          // than the effect-4 starry sky.
          if (uStarryBoost > 0.001) {
            // Higher sharpness here = tighter, smaller star points. The
            // density (lower thresholds vs base layers) still gives the
            // boosted sky its denser feel without inflating each glow.
            float boostStars = 0.0;
            boostStars += starLayer(vLocalPos.xy, 0.40, 0.62, 11.0) * 1.6;
            boostStars += starLayer(vLocalPos.xy, 0.90, 0.74, 14.0) * 1.25;
            boostStars += starLayer(vLocalPos.xy, 1.80, 0.82, 17.0) * 0.95;
            boostStars += starLayer(vLocalPos.xy, 3.60, 0.88, 21.0) * 0.7;
            starrySky += vec3(1.0, 0.97, 0.92) * boostStars * 3.0 * uStarryBoost;
          }
          color = mix(color, starrySky, uStarryMode);
        }

        // Darken side faces so the logo's 3D depth still reads
        float facing = abs(vNormal.z);
        color *= mix(0.35, 1.0, facing);

        // Bottom-edge fade: dissolve into the void along the lower rim
        // of the silhouette so the galaxy doesn't end on a hard line.
        float bottomFade = smoothstep(uMinY, uMinY + uFadeHeight, vLocalPos.y);
        color *= bottomFade;

        gl_FragColor = vec4(color * uBrightness, 1.0);
      }
    `,
  });
}
