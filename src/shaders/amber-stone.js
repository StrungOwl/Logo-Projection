// Amber-stone material patch. Grafts a world-space FBM albedo mottle
// (light amber ↔ dark amber), ridged-noise dark veins, a roughness
// breakup octave, and a faint internal warm glow onto a
// MeshStandardMaterial via onBeforeCompile — the brick keeps full PBR
// shading but reads as translucent amber stone lit from within by the
// fire. Sampled in WORLD space so the mottle/vein pattern is coherent
// across adjacent bricks (no seams at brick edges).
//
// The internal glow is driven by main.js's smoothedFlameEnv (0..1
// low-passed flame brightness) via setAmberFlameEnv(v) — the stone
// brightens from inside as the fire flares and dims as it settles.
// Glow strength is tuned to stay BELOW the bloom threshold at rest and
// only kiss it at flame peaks (bold, not neon).
//
// Usage:
//   import { applyAmberStone, setAmberFlameEnv } from '../src/shaders/amber-stone.js';
//   const mat = new THREE.MeshStandardMaterial({ ... });
//   applyAmberStone(mat);   // chains onto any existing onBeforeCompile
//   ...
//   // once per frame from your render loop:
//   setAmberFlameEnv(smoothedFlameEnv);
//
// Knobs live under ANIM.arch.amber. Set enabled to false (reload) to
// skip the patch entirely — bricks fall back to their raw materials.
//
// The patch composes through chainOnBeforeCompile so it stacks with
// gold-shimmer / ember-flicker patches already applied to a material
// (apply those FIRST — they overwrite onBeforeCompile; amber chains).

import * as THREE from 'three';
import { ANIM } from '../config.js';
import { chainOnBeforeCompile } from '../effects/_shared/shaderPatches.js';

// One shared uniform record — every patched material's onBeforeCompile
// references the SAME { value } objects, so bumping uAmbFlameEnv once
// per frame propagates to every amber brick everywhere.
const sharedUniforms = {
  uAmbMottleScale:  { value: 0.35 },   // world-space noise frequency
  uAmbVeinStrength: { value: 0.6 },    // dark-vein darkening amount 0..1
  uAmbRoughVar:     { value: 0.15 },   // ± roughness modulation
  uAmbLightCol:     { value: new THREE.Color('#C8862F') },
  uAmbDarkCol:      { value: new THREE.Color('#6E4416') },
  uAmbGlowColor:    { value: new THREE.Color('#FF7A1E') },
  uAmbGlowStrength: { value: 2.0 },    // emissive multiplier at env=1
  uAmbFlameEnv:     { value: 0.0 },    // 0..1 low-passed flame brightness
};

let initialized = false;
function syncFromConfig() {
  const a = (ANIM.arch && ANIM.arch.amber) || {};
  sharedUniforms.uAmbMottleScale.value  = a.mottleScale  ?? 0.35;
  sharedUniforms.uAmbVeinStrength.value = a.veinStrength ?? 0.6;
  sharedUniforms.uAmbRoughVar.value     = a.roughnessVar ?? 0.15;
  sharedUniforms.uAmbLightCol.value.set(a.lightColor || '#C8862F');
  sharedUniforms.uAmbDarkCol.value.set(a.darkColor  || '#6E4416');
  sharedUniforms.uAmbGlowColor.value.set(a.glowColor || '#FF7A1E');
  sharedUniforms.uAmbGlowStrength.value = a.glowStrength ?? 2.0;
}

export function applyAmberStone(material) {
  if (!initialized) { syncFromConfig(); initialized = true; }
  const a = (ANIM.arch && ANIM.arch.amber) || {};
  if (a.enabled === false) return;   // fallback: raw material, no mottle

  chainOnBeforeCompile(material, (shader) => {
    Object.assign(shader.uniforms, sharedUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `
        #include <common>
        varying vec3 vAmbWorldPos;
      `)
      .replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vAmbWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `
        #include <common>
        uniform float uAmbMottleScale;
        uniform float uAmbVeinStrength;
        uniform float uAmbRoughVar;
        uniform vec3  uAmbLightCol;
        uniform vec3  uAmbDarkCol;
        uniform vec3  uAmbGlowColor;
        uniform float uAmbGlowStrength;
        uniform float uAmbFlameEnv;
        varying vec3  vAmbWorldPos;
        float ambHash21(vec2 p) {
          return fract(sin(dot(p, vec2(157.31, 269.53))) * 43758.5453123);
        }
        float ambVnoise2(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(ambHash21(i),                  ambHash21(i + vec2(1.0, 0.0)), u.x),
                     mix(ambHash21(i + vec2(0.0, 1.0)), ambHash21(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float ambFbm2(vec2 p) {
          float v = 0.0; float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * ambVnoise2(p);
            p = p * 2.07 + vec2(19.0, 47.0);
            a *= 0.5;
          }
          return v;
        }
      `)
      // Albedo mottle + veins. World-XY drives the pattern; a Z fold-in
      // keeps front faces at different depths from repeating the exact
      // same slice. The amber tone REPLACES the hue but is scaled by the
      // base colour's luminance, so per-tier gradients (dark inner steps
      // → bright outer steps) survive the amber conversion and the
      // staircase depth-read stays intact.
      .replace('#include <color_fragment>', `
        #include <color_fragment>
        vec2 ambP = (vAmbWorldPos.xy + vAmbWorldPos.z * vec2(0.31, 0.17))
                  * uAmbMottleScale;
        float ambM = ambFbm2(ambP);
        ambM = smoothstep(0.22, 0.78, ambM);
        vec3 ambTone = mix(uAmbDarkCol, uAmbLightCol, ambM);
        float ambLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = ambTone * (ambLum / 0.42 + 0.06);
        // Ridged noise — thin dark veins where the ridge field peaks,
        // like mineral inclusions running through the stone.
        float ambRid = 1.0 - abs(2.0 * ambFbm2(ambP * 2.7 + vec2(43.7, 17.9)) - 1.0);
        float ambVein = pow(smoothstep(0.80, 0.985, ambRid), 1.4);
        diffuseColor.rgb *= 1.0 - uAmbVeinStrength * ambVein * 0.85;
      `)
      // Roughness breakup — a second, larger noise octave pushes the
      // material roughness up/down so polished patches catch the flame
      // light while weathered patches stay matte.
      .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        float ambRN = ambFbm2(ambP * 1.9 + vec2(7.3, 91.1));
        roughnessFactor = clamp(
          roughnessFactor + (ambRN - 0.5) * 2.0 * uAmbRoughVar, 0.05, 1.0);
      `)
      // Internal glow — the lighter mottle patches (translucent amber)
      // transmit the fire's light; pow() gates the glow into those
      // patches so the stone reads lit from WITHIN, not painted. Peaks
      // only ever kiss the bloom threshold when uAmbFlameEnv ≈ 1.
      .replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        totalEmissiveRadiance += uAmbGlowColor
          * (uAmbGlowStrength * pow(ambM, 2.0) * uAmbFlameEnv);
      `);
  });
}

// Per-frame driver — call once per frame with main.js's smoothedFlameEnv.
// Also re-pulls the config knobs so devtools edits take effect live.
export function setAmberFlameEnv(v) {
  syncFromConfig();
  sharedUniforms.uAmbFlameEnv.value = Math.min(1, Math.max(0, v || 0));
}
