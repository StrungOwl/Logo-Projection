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

// Collected across async init; the animate loop checks each for null.
let galaxyMat = null;
let particleMats = null;
let logoMaterials = null;
const strokeTimeUniforms = [];
const sparkSystems = [];
const baseColorScratch = new THREE.Color();
let updateRowCascade = null;
let cascadeState = null;

loadLogo().then((logo) => {
  galaxyMat = logo.galaxyMat;
  logoMaterials = logo.logoMaterials;

  const patternResult = addPatternLayers(logo.logoMesh, logo.meta);
  strokeTimeUniforms.push(...patternResult.strokeTimeUniforms);
  sparkSystems.push(...patternResult.sparkSystems);
  updateRowCascade = patternResult.updateRowCascade;
  cascadeState     = patternResult.cascadeState;

  scene.add(logo.model);

  // World matrices must be finalised before pattern fade shaders compute
  // their inverse-world matrices (so world-Y gradient conversions land in
  // panel-local coords correctly).
  scene.updateMatrixWorld(true);
  patternResult.patternsToRefresh.forEach(g => g.userData.refreshFade?.());

  particleMats = addParticles(logo.logoMesh, renderer);

  frameLogo(camera, controls);
}).catch(err => console.error('Failed to load logo:', err));

// Animate loop — every breathing value reads from ANIM each frame.
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  const dt = Math.min(clock.getDelta(), 0.05);   // cap stepping after tab-unhide
  const t = clock.elapsedTime;

  if (galaxyMat) {
    galaxyMat.uniforms.uTime.value       = t * ANIM.galaxy.timeScale;
    galaxyMat.uniforms.uBrightness.value = ANIM.galaxy.brightness;
  }

  if (particleMats) updateParticles(particleMats, t);

  // Logo base brightness — sine-wave breath between min and max over `period` seconds.
  if (logoMaterials) {
    const lb = ANIM.logoBase;
    const phase = (t / Math.max(lb.period, 1e-3)) * Math.PI * 2;
    const k01 = 0.5 + 0.5 * Math.sin(phase);
    const factor = lb.brightnessMin + (lb.brightnessMax - lb.brightnessMin) * k01;
    baseColorScratch.set(COLORS.logo.base).multiplyScalar(factor);
    for (let i = 0; i < logoMaterials.length; i++) logoMaterials[i].color.copy(baseColorScratch);
  }

  for (let i = 0; i < strokeTimeUniforms.length; i++) strokeTimeUniforms[i].value = t;

  // Row cascade runs BEFORE sparks so the cascade state gates this frame's
  // spark snap: sparks drift freely while rows are moving (their stroke
  // cloud is a load-time snapshot that doesn't follow row motion).
  if (updateRowCascade) updateRowCascade(t);
  const snapScale = cascadeState ? cascadeState.active : 1;
  for (let i = 0; i < sparkSystems.length; i++) {
    sparkSystems[i].snapScale = snapScale;
    sparkSystems[i].update(dt);
  }

  updateLights(lights, t);

  renderer.render(scene, camera);
}
animate();
