// Cinematic lighting rig + per-frame "breathing" update.
// Lights pulse in/out of phase with each other to keep the logo visually
// alive: the warm inner glow + front-pattern kiss swell anti-phase to the
// key light, and the cool rim light drifts on a phase offset so shading
// visibly travels across the metal.

import * as THREE from 'three';
import { ANIM, COLORS } from './config.js';
import { hexToRgb } from './util/color.js';

export function createLights(scene) {
  const ambientLight = new THREE.AmbientLight(COLORS.ambient, ANIM.ambientIntensity);
  scene.add(ambientLight);

  // Steep top-front-right key.
  const keyLight = new THREE.DirectionalLight(0xffffff, ANIM.keyLight.intensityMax);
  keyLight.position.set(5, 8, 4);
  scene.add(keyLight);

  // Cool rim from behind-left.
  const rimLight = new THREE.DirectionalLight(ANIM.rimLight.color, ANIM.rimLight.intensityMax);
  rimLight.position.set(-3, 2, -6);
  scene.add(rimLight);

  const fillLight = new THREE.DirectionalLight(COLORS.fill, ANIM.fillIntensity);
  fillLight.position.set(0, -4, 2);
  scene.add(fillLight);

  // Vibrant orange spill from inside the model — sells the back-glow read.
  const innerGlow = new THREE.PointLight(ANIM.innerGlow.color, ANIM.innerGlow.intensityMax, 40, 1.6);
  innerGlow.position.set(0, -1.0, -2.0);
  scene.add(innerGlow);

  // Tight falloff grazes so the pattern reliefs catch a warm edge kiss
  // without flattening the ambient.
  const frontPatternLight = new THREE.PointLight(ANIM.frontPatternLight.color, ANIM.frontPatternLight.intensityMax, 5, 2);
  frontPatternLight.position.set(-2.8, 1.8, 2.6);
  scene.add(frontPatternLight);

  const rearPatternLight = new THREE.PointLight(ANIM.rearPatternColor, ANIM.rearPatternIntensity, 6, 2);
  rearPatternLight.position.set(2.8, 1.2, -1.2);
  scene.add(rearPatternLight);

  return { ambientLight, keyLight, rimLight, fillLight, innerGlow, frontPatternLight, rearPatternLight };
}

// Called every frame — reads live values from ANIM so devtools tweaks
// take effect immediately. Key sweeps red→amber and glow/front-pattern
// swell anti-phase; rim drifts on offset phase.
//
// In fireplace mode the warm scene lights are dimmed to a small fraction
// (configurable via ANIM.flame.baseLightDim) so the flame's own point
// light + galaxy stars dominate the illumination — otherwise the
// existing innerGlow + key light wash the inner-cutout area in bright
// orange and make the flame body invisible.
export function updateLights(lights, t) {
  const pulse   = Math.sin(t * ANIM.pulseSpeed);
  const pulse01 = 0.5 + 0.5 * pulse;
  const warm    = 1.0 - pulse01;

  const fireplaceMode = ANIM.viewMode === 'fireplace';
  const dim = fireplaceMode
    ? ((ANIM.flame && ANIM.flame.baseLightDim) ?? 0.06)
    : 1.0;

  const kl = ANIM.keyLight;
  lights.keyLight.intensity = Math.max(0.0, kl.intensityMin + (kl.intensityMax - kl.intensityMin) * pulse01) * dim;
  const [klMinR, klMinG, klMinB] = hexToRgb(kl.colorAtMin);
  const [klMaxR, klMaxG, klMaxB] = hexToRgb(kl.colorAtMax);
  lights.keyLight.color.setRGB(
    klMinR + (klMaxR - klMinR) * pulse01,
    klMinG + (klMaxG - klMinG) * pulse01,
    klMinB + (klMaxB - klMinB) * pulse01,
  );

  const ig = ANIM.innerGlow;
  lights.innerGlow.intensity = (ig.intensityMin + (ig.intensityMax - ig.intensityMin) * warm) * dim;
  lights.innerGlow.color.set(ig.color);

  const fp = ANIM.frontPatternLight;
  lights.frontPatternLight.intensity = (fp.intensityMin + (fp.intensityMax - fp.intensityMin) * warm) * dim;
  lights.frontPatternLight.color.set(fp.color);

  const rl = ANIM.rimLight;
  const rimPulse01 = 0.5 + 0.5 * Math.sin(t * ANIM.pulseSpeed + rl.phaseOffset);
  lights.rimLight.intensity = (rl.intensityMin + (rl.intensityMax - rl.intensityMin) * rimPulse01) * dim;
  lights.rimLight.color.set(rl.color);

  lights.ambientLight.intensity    = ANIM.ambientIntensity * dim;
  lights.fillLight.intensity       = ANIM.fillIntensity * dim;
  lights.rearPatternLight.intensity = ANIM.rearPatternIntensity * dim;
  lights.rearPatternLight.color.set(ANIM.rearPatternColor);
}
