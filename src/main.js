// Orchestrator. Boots the scene + lights, loads the logo, wires the
// pattern + particle layers onto it, then runs the per-frame breathing
// loop. Every breathing value is pulled from ANIM each frame so
// `window.ANIM.*` edits in the devtools console take effect immediately.

import * as THREE from 'three';
import { ANIM } from './config.js';
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
const strokeTimeUniforms = [];
const sparkSystems = [];

loadLogo().then((logo) => {
  galaxyMat = logo.galaxyMat;

  const patternResult = addPatternLayers(logo.logoMesh, logo.meta);
  strokeTimeUniforms.push(...patternResult.strokeTimeUniforms);
  sparkSystems.push(...patternResult.sparkSystems);

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

  for (let i = 0; i < strokeTimeUniforms.length; i++) strokeTimeUniforms[i].value = t;
  for (let i = 0; i < sparkSystems.length; i++)       sparkSystems[i].update(dt);

  updateLights(lights, t);

  renderer.render(scene, camera);
}
animate();
