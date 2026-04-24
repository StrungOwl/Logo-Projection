// Orchestrator. Boots the scene + lights, loads the logo, wires the
// pattern + particle layers onto it, then runs the per-frame breathing
// loop. Every breathing value is pulled from ANIM each frame so
// `window.ANIM.*` edits in the devtools console take effect immediately.

import * as THREE from 'three';
import { ANIM, COLORS } from './config.js';
import { createScene, frameLogo } from './scene.js';
import { createLights, updateLights } from './lights.js';
import { loadLogo } from './logo.js';
import { addPatternLayers } from './patterns-layer.js';
import { addParticles, updateParticles } from './particles.js';

const { scene, camera, renderer, controls } = createScene();
const lights = createLights(scene);

// Shared per-frame context. Populated as async init resolves; `tick()`
// no-ops on any null it finds, so the live loop can start immediately
// and the export loop can drive the same updater function.
const ctx = {
  galaxyMat:          null,
  particleMats:       null,
  logoMaterials:      null,
  strokeTimeUniforms: [],
  sparkSystems:       [],
  updateRowCascade:   null,
  cascadeState:       null,
  updateRotations:    null,
  lights,
  scene,
  camera,
  renderer,
  baseColorScratch:   new THREE.Color(),
};

loadLogo().then((logo) => {
  ctx.galaxyMat     = logo.galaxyMat;
  ctx.logoMaterials = logo.logoMaterials;

  const patternResult = addPatternLayers(logo.logoMesh, logo.meta);
  ctx.strokeTimeUniforms.push(...patternResult.strokeTimeUniforms);
  ctx.sparkSystems.push(...patternResult.sparkSystems);
  ctx.updateRowCascade = patternResult.updateRowCascade;
  ctx.cascadeState     = patternResult.cascadeState;
  ctx.updateRotations  = patternResult.updateRotations;

  scene.add(logo.model);

  // World matrices must be finalised before pattern fade shaders compute
  // their inverse-world matrices (so world-Y gradient conversions land in
  // panel-local coords correctly).
  scene.updateMatrixWorld(true);
  patternResult.patternsToRefresh.forEach(g => g.userData.refreshFade?.());

  ctx.particleMats = addParticles(logo.logoMesh, renderer);

  frameLogo(camera, controls);
}).catch(err => console.error('Failed to load logo:', err));

// Single per-frame update — called by both the live animate loop and the
// deterministic export loop. `t` is absolute seconds, `dt` is the step
// size for stateful systems (sparks) — the live loop passes real delta;
// the export loop passes a fixed 1/fps.
export function tick(t, dt) {
  if (ctx.galaxyMat) {
    ctx.galaxyMat.uniforms.uTime.value       = t * ANIM.galaxy.timeScale;
    ctx.galaxyMat.uniforms.uBrightness.value = ANIM.galaxy.brightness;
  }

  if (ctx.particleMats) updateParticles(ctx.particleMats, t);

  // Logo base brightness — sine-wave breath between min and max over `period` seconds.
  if (ctx.logoMaterials) {
    const lb = ANIM.logoBase;
    const phase = (t / Math.max(lb.period, 1e-3)) * Math.PI * 2;
    const k01 = 0.5 + 0.5 * Math.sin(phase);
    const factor = lb.brightnessMin + (lb.brightnessMax - lb.brightnessMin) * k01;
    ctx.baseColorScratch.set(COLORS.logo.base).multiplyScalar(factor);
    for (let i = 0; i < ctx.logoMaterials.length; i++) ctx.logoMaterials[i].color.copy(ctx.baseColorScratch);
  }

  for (let i = 0; i < ctx.strokeTimeUniforms.length; i++) ctx.strokeTimeUniforms[i].value = t;

  // Row cascade runs BEFORE sparks so the cascade state gates this frame's
  // spark snap: sparks drift freely while rows are moving (their stroke
  // cloud is a load-time snapshot that doesn't follow row motion).
  if (ctx.updateRotations) ctx.updateRotations(t);
  if (ctx.updateRowCascade) ctx.updateRowCascade(t, dt);
  const snapScale = ctx.cascadeState ? ctx.cascadeState.active : 1;
  for (let i = 0; i < ctx.sparkSystems.length; i++) {
    ctx.sparkSystems[i].snapScale = snapScale;
    ctx.sparkSystems[i].update(dt);
  }

  updateLights(ctx.lights, t);
}

// Live animate loop — real-time clock. `ctx.paused` lets the export
// subsystem take full control of render + timing without interleaving.
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  if (ctx.paused) {
    // Keep the clock baseline fresh so elapsedTime freezes during pause
    // and the first frame after resume reports a normal ~16ms delta.
    clock.oldTime = performance.now();
    return;
  }
  controls.update();
  const dt = Math.min(clock.getDelta(), 0.05);   // cap stepping after tab-unhide
  const t = clock.elapsedTime;
  tick(t, dt);
  renderer.render(scene, camera);
}
animate();

// Export bridge — lazy-loaded so mp4-muxer + export.js only download when
// the user triggers a capture.
//   Shift+E  →  4K  (3840×2160)
//   Shift+D  →  1080p (1920×1080)
// or call `startExport({ width, height })` from devtools for custom sizes.
export const __exportCtx = { ctx, scene, camera, renderer, controls, tick };

async function runExport(opts) {
  const { startExport } = await import('./export.js');
  return startExport(__exportCtx, opts);
}

if (typeof window !== 'undefined') {
  window.startExport      = runExport;                                       // default 4K
  window.startExport1080p = () => runExport({ width: 1920, height: 1080 });
  window.addEventListener('keydown', (e) => {
    if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'E') runExport();
    else if (e.key === 'D') runExport({ width: 1920, height: 1080 });
  });
}
