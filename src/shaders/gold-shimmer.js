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
// Knobs live under ANIM.arch.shimmer (or the merged archCarved.shimmer).
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
};

let initialized = false;
function syncFromConfig() {
  const s = (ANIM.arch && ANIM.arch.shimmer) || {};
  sharedUniforms.uShimColor.value.set(s.color || '#FFE48A');
  sharedUniforms.uSheenScale.value    = s.sheenScale    ?? 0.20;
  sharedUniforms.uSheenSpeed.value    = s.sheenSpeed    ?? 0.25;
  sharedUniforms.uSheenStrength.value = s.sheenStrength ?? 0.6;
}

export function applyGoldShimmer(material) {
  if (!initialized) { syncFromConfig(); initialized = true; }
  if (sharedUniforms.uSheenStrength.value <= 0) return;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sharedUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `
        #include <common>
        varying vec3 vShimWorldPos;
      `)
      .replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vShimWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `
        #include <common>
        uniform float uTime;
        uniform vec3  uShimColor;
        uniform float uSheenScale;
        uniform float uSheenSpeed;
        uniform float uSheenStrength;
        varying vec3  vShimWorldPos;
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
        totalEmissiveRadiance += uShimColor * sheen * uSheenStrength;
      `);
  };
}

export function tickShimmer(t) {
  // Re-pull config knobs each frame so devtools edits take effect live.
  syncFromConfig();
  sharedUniforms.uTime.value = t;
}
