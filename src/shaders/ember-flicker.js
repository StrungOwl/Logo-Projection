// Shared ember-flicker shader injection. Grafts the flame's domain-warped
// fbm noise (same one used by patterns/flame.js) onto a MeshStandardMaterial
// via onBeforeCompile so the brick keeps PBR shading but glows with subtle
// flickering ember light. Sampled in WORLD-XY so the noise pattern reads as
// one continuous "flame creeping over the bricks" effect across every brick
// material that uses this helper, regardless of which pattern module
// created the material.
//
// Usage:
//   import { applyEmberFlicker, tickEmber } from '../src/shaders/ember-flicker.js';
//   const mat = new THREE.MeshStandardMaterial({ ... });
//   applyEmberFlicker(mat);
//   ...
//   // once per frame from your render loop:
//   tickEmber(t);
//
// Config lives under ANIM.fireplace.ember.* (we already had the knobs there
// for the fireplace rim — the same numbers now drive the whole brick scene).

import * as THREE from 'three';
import { ANIM } from '../config.js';

// One shared uniform record so every patched material's onBeforeCompile
// references the SAME { value } objects. Bumping uTime.value once per
// frame propagates to every brick everywhere.
const sharedUniforms = {
  uTime:         { value: 0 },
  uEmberScale:   { value: 0.18 },
  uEmberSpeed:   { value: 0.7 },
  uEmberWarp:    { value: 1.4 },
  uEmberStr:     { value: 0.7 },
  uEmberHotCol:  { value: new THREE.Color('#FFB060') },
  uEmberColdCol: { value: new THREE.Color('#3A0E04') },
};

let initialized = false;
function syncFromConfig() {
  const e = (ANIM.fireplace && ANIM.fireplace.ember) || {};
  sharedUniforms.uEmberScale.value = e.scale     ?? 0.18;
  sharedUniforms.uEmberSpeed.value = e.speed     ?? 0.7;
  sharedUniforms.uEmberWarp.value  = e.warp      ?? 1.4;
  sharedUniforms.uEmberStr.value   = e.strength  ?? 0.7;
  sharedUniforms.uEmberHotCol.value.set(e.hotColor  || '#FFB060');
  sharedUniforms.uEmberColdCol.value.set(e.coldColor || '#3A0E04');
}

export function applyEmberFlicker(material) {
  if (!initialized) { syncFromConfig(); initialized = true; }
  // Skip if strength is 0 — caller wants the patch off.
  if (sharedUniforms.uEmberStr.value <= 0) return;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sharedUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `
        #include <common>
        varying vec3 vEmberWorldPos;
      `)
      .replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vEmberWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `
        #include <common>
        uniform float uTime;
        uniform float uEmberScale;
        uniform float uEmberSpeed;
        uniform float uEmberWarp;
        uniform float uEmberStr;
        uniform vec3  uEmberHotCol;
        uniform vec3  uEmberColdCol;
        varying vec3  vEmberWorldPos;
        float embHash21(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float embVnoise2(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(embHash21(i),                  embHash21(i + vec2(1.0, 0.0)), u.x),
                     mix(embHash21(i + vec2(0.0, 1.0)), embHash21(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float embFbm2(vec2 p) {
          float v = 0.0; float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * embVnoise2(p);
            p = p * 2.05 + vec2(17.0, 31.0);
            a *= 0.5;
          }
          return v;
        }
      `)
      .replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        vec2 sp = (vEmberWorldPos.xy
                   + vec2(0.0, -uTime * uEmberSpeed)) * uEmberScale;
        vec2 q  = vec2(embFbm2(sp), embFbm2(sp + vec2(5.2, 1.3)));
        float n = embFbm2(sp + uEmberWarp * q);
        float gate = smoothstep(0.35, 0.75, n);
        vec3 ember = mix(uEmberColdCol, uEmberHotCol, gate);
        totalEmissiveRadiance += ember * uEmberStr * gate;
      `);
  };
}

export function tickEmber(t) {
  sharedUniforms.uTime.value = t;
}
