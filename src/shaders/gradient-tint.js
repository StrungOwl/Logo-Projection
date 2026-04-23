// Injects a simple world-Y gradient tint into any MeshStandardMaterial via
// onBeforeCompile. Darkens/warms toward the bottom, brightens neutral at
// the top — subtle depth cue without overriding the existing lighting model.

import * as THREE from 'three';

export function applyGradientTint(mat, {
  minY = -5,
  maxY = 5,
  darkTint   = [0.72, 0.6, 0.44],
  brightTint = [1.02, 1.0, 0.95],
} = {}) {
  const uniforms = {
    uGradMinY:   { value: minY },
    uGradMaxY:   { value: maxY },
    uGradDark:   { value: new THREE.Vector3(...darkTint) },
    uGradBright: { value: new THREE.Vector3(...brightTint) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nvarying vec3 vGradWP;')
      .replace('#include <project_vertex>',
        '#include <project_vertex>\nvGradWP = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        `#include <common>
         uniform float uGradMinY;
         uniform float uGradMaxY;
         uniform vec3  uGradDark;
         uniform vec3  uGradBright;
         varying vec3  vGradWP;`)
      .replace('#include <color_fragment>',
        `#include <color_fragment>
         float _gt = clamp((vGradWP.y - uGradMinY) / max(uGradMaxY - uGradMinY, 1e-4), 0.0, 1.0);
         diffuseColor.rgb *= mix(uGradDark, uGradBright, _gt);`);
  };
  mat.userData.gradUniforms = uniforms;
}
