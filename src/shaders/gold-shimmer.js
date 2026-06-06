// Gold sheen shimmer. Grafts a slow drifting fbm-noise emissive onto a
// MeshStandardMaterial via onBeforeCompile so each gold brick still
// renders with full PBR metalness/roughness, but broad bright/dim
// patches sweep across the surface as time advances — the metal feels
// alive instead of statically painted. Sampled in WORLD-XY so the
// pattern is coherent across adjacent bricks (no seams at brick edges).
//
// Usage:
//   import { applyGoldShimmer, tickShimmer } from '../src/shaders/gold-shimmer.js';
//   const mat = new THREE.MeshStandardMaterial({ ... });
//   applyGoldShimmer(mat);
//   ...
//   // once per frame from your render loop:
//   tickShimmer(t);
//
// Knobs live under ANIM.arch.shimmer.
// Set sheenStrength to 0 or enabled to false to no-op the patch.

import * as THREE from 'three';
import { ANIM } from '../config.js';

// One shared uniform record — every patched material's onBeforeCompile
// references the SAME { value } objects. Bumping uTime once per frame
// propagates to every gold brick everywhere.
const sharedUniforms = {
  uTime:           { value: 0 },
  uShimColor:      { value: new THREE.Color('#FFE48A') },
  uSheenScale:     { value: 0.20 },    // world-XY scale for sheen noise
  uSheenSpeed:     { value: 0.25 },    // noise drift speed
  uSheenStrength:  { value: 0.6 },     // emissive multiplier (sheen)
  // Per-fragment shadow gradient — darkens each brick face toward its
  // bottom edge (uv.v = 0) and lets the top edge (uv.v = 1) keep its
  // full gold colour. Fakes the soft shadow that would naturally fall
  // under each step's overhang without doing actual shadow casting.
  // Strength = 0 disables; falloff > 1 concentrates darkening at the
  // very bottom (gamma curve on the gradient).
  uShadowStrength: { value: 0.55 },
  uShadowFalloff:  { value: 1.6 },
};

let initialized = false;
function syncFromConfig() {
  const s = (ANIM.arch && ANIM.arch.shimmer) || {};
  sharedUniforms.uShimColor.value.set(s.color || '#FFE48A');
  sharedUniforms.uSheenScale.value    = s.sheenScale    ?? 0.20;
  sharedUniforms.uSheenSpeed.value    = s.sheenSpeed    ?? 0.25;
  sharedUniforms.uSheenStrength.value = s.sheenStrength ?? 0.6;
  sharedUniforms.uShadowStrength.value = s.shadowStrength ?? 0.55;
  sharedUniforms.uShadowFalloff.value  = s.shadowFalloff  ?? 1.6;
}

export function applyGoldShimmer(material) {
  if (!initialized) { syncFromConfig(); initialized = true; }
  if (sharedUniforms.uSheenStrength.value <= 0
      && sharedUniforms.uShadowStrength.value <= 0) return;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sharedUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `
        #include <common>
        varying vec3 vShimWorldPos;
        varying vec2 vShadowUv;
      `)
      .replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vShimWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vShadowUv = uv;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `
        #include <common>
        uniform float uTime;
        uniform vec3  uShimColor;
        uniform float uSheenScale;
        uniform float uSheenSpeed;
        uniform float uSheenStrength;
        uniform float uShadowStrength;
        uniform float uShadowFalloff;
        varying vec3  vShimWorldPos;
        varying vec2  vShadowUv;
        float shimHash21(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float shimVnoise2(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(shimHash21(i),                  shimHash21(i + vec2(1.0, 0.0)), u.x),
                     mix(shimHash21(i + vec2(0.0, 1.0)), shimHash21(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float shimFbm2(vec2 p) {
          float v = 0.0; float a = 0.5;
          for (int i = 0; i < 3; i++) {
            v += a * shimVnoise2(p);
            p = p * 2.05 + vec2(17.0, 31.0);
            a *= 0.5;
          }
          return v;
        }
      `)
      // Per-fragment shadow gradient. Hooked into <color_fragment> (where
      // diffuseColor gets initialized from material.color) so the gradient
      // multiplies the diffuse BEFORE lighting — gold reflects through the
      // gradient and the result reads as a baked overhang shadow. UV.y is
      // the vertical axis on every side face of the BoxGeometry brick, so
      // bottom edge (v=0) gets the full darkening and the top edge (v=1)
      // stays at full diffuse.
      .replace('#include <color_fragment>', `
        #include <color_fragment>
        float shadowGrad = pow(clamp(vShadowUv.y, 0.0, 1.0), uShadowFalloff);
        diffuseColor.rgb *= mix(1.0 - uShadowStrength, 1.0, shadowGrad);
      `)
      .replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        // Slow drifting fbm noise — broad bright/dim patches sweep
        // across the surface so the metal feels alive. Drift direction:
        // slight diagonal so adjacent bricks see different phases.
        vec2 sheenP = vShimWorldPos.xy * uSheenScale
                    + uTime * uSheenSpeed * vec2(0.7, 0.3);
        float sheenN = shimFbm2(sheenP);
        // Bias toward bright peaks so the sheen reads as occasional
        // glints, not a uniform grey wash.
        float sheen  = pow(smoothstep(0.4, 0.95, sheenN), 1.5);
        // Same gradient applied to the sheen so the overhang shadow
        // doesn't get washed out by bright sparkles at the bottom edge.
        float shadowGradE = pow(clamp(vShadowUv.y, 0.0, 1.0), uShadowFalloff);
        float shadowMul   = mix(1.0 - uShadowStrength, 1.0, shadowGradE);
        totalEmissiveRadiance += uShimColor * sheen * uSheenStrength * shadowMul;
      `);
  };
}

export function tickShimmer(t) {
  // Re-pull config knobs each frame so devtools edits take effect live.
  syncFromConfig();
  sharedUniforms.uTime.value = t;
}
