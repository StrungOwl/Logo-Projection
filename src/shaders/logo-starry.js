// Starry-night shader injection for the logo body. Grafts a multi-scale
// twinkling starfield onto every logo MeshStandardMaterial via
// onBeforeCompile so the body keeps PBR shading but emits the same kind
// of starlit sky the galaxy backdrop draws. Sampled in WORLD-XY (like
// shaders/ember-flicker.js) so the star pattern reads as one continuous
// field across every part of the logo, regardless of which sub-mesh.
//
// Driven by a shared `uStarryBlend` uniform — main.js lerps it toward 1
// in flameOnly mode (key 6) so the stars fade in while the galaxy
// backdrop plate's brightness is faded toward 0, swapping where the
// twinkle lives.

import * as THREE from 'three';

const sharedUniforms = {
  uStarryTime:    { value: 0 },
  uStarryBlend:   { value: 0 },
  // 1.0 = each starLayer's sharpness reads as-authored. Higher = bigger.
  // Keep at 1.0 on the logo so stars stay tight (the larger layers were
  // reading as fat blobs across the body).
  uStarSizeScale: { value: 1.0 },
};

export function applyLogoStarry(material) {
  const prior = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (typeof prior === 'function') prior(shader, renderer);
    Object.assign(shader.uniforms, sharedUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `
        #include <common>
        varying vec3 vStarryWorldPos;
      `)
      .replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vStarryWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `
        #include <common>
        uniform float uStarryTime;
        uniform float uStarryBlend;
        uniform float uStarSizeScale;
        varying vec3 vStarryWorldPos;
        float starryHash21(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float starryLayer(vec2 p, float scale, float threshold, float sharpness) {
          p *= scale;
          vec2 cell = floor(p);
          vec2 f = fract(p) - 0.5;
          float n = starryHash21(cell);
          if (n < threshold) return 0.0;
          vec2 jitter = vec2(starryHash21(cell + 13.17), starryHash21(cell + 47.31)) - 0.5;
          float d = length(f - jitter * 0.6);
          float intensity = (n - threshold) / (1.0 - threshold);
          float twinkle = 0.55 + 0.45 * sin(uStarryTime * (1.5 + n * 7.0) + n * 100.0);
          float s = sharpness / max(uStarSizeScale, 0.001);
          return smoothstep(0.5, 0.0, d * s) * intensity * twinkle;
        }
      `)
      .replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        if (uStarryBlend > 0.001) {
          vec2 sp = vStarryWorldPos.xy;
          float stars = 0.0;
          // Dropped the two lowest-frequency layers (scale 0.55 and 1.10)
          // — at the logo's world scale they seeded ~a handful of huge
          // blob stars that read as bright spots rather than starlight.
          // The kept layers stay tight + numerous.
          stars += starryLayer(sp, 2.20, 0.88, 12.0) * 1.05;
          stars += starryLayer(sp, 4.20, 0.92, 15.0) * 0.8;
          stars += starryLayer(sp, 7.50, 0.95, 18.0) * 0.55;
          stars += starryLayer(sp, 12.0, 0.97, 22.0) * 0.4;
          vec3 starColor = vec3(1.0, 0.95, 0.85) * stars * 3.5;
          totalEmissiveRadiance += starColor * uStarryBlend;
        }
      `);
  };
  material.needsUpdate = true;
}

export function tickLogoStarry(t, blend) {
  sharedUniforms.uStarryTime.value  = t;
  sharedUniforms.uStarryBlend.value = blend;
}
