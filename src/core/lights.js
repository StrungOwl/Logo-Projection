// Cinematic lighting rig + per-frame "breathing" update.
// Lights pulse in/out of phase with each other to keep the logo visually
// alive: the warm inner glow + front-pattern kiss swell anti-phase to the
// key light, and the cool rim light drifts on a phase offset so shading
// visibly travels across the metal.

import * as THREE from 'three';
import { ANIM, COLORS } from '../config.js';
import { hexToRgb } from '../util/color.js';

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
// In fireplace/carved mode the warm scene lights are dimmed to a small
// fraction (configurable via ANIM.flame.baseLightDim) so the flame's own
// point light + galaxy stars dominate the illumination — otherwise the
// existing innerGlow + key light wash the inner-cutout area in bright
// orange and make the flame body invisible.
//
// On top of that constant dim, the room "breathes" through a piecewise
// envelope shaped by ANIM.flame.envDim:
//   darkHold seconds at envDim.min → rampUp seconds easing to 1.0 →
//   brightHold seconds at 1.0      → rampDown seconds easing back → loop.
// Cycle starts in the dark phase at t = 0 (page load).
//
// The envelope scales: ambient + key + rim + fill (directional room
// wash), the scene-wide PMREM env cubemap (scene.environmentIntensity —
// otherwise the cubemap floor masks the directional dim), and the
// innerGlow + frontPatternLight point lights (without these in the
// pulse, the constant point-light floor stops the trough from going
// dark enough to make the flame stand out). The rearPatternLight and
// the flame's own light stack are excluded — the flame stays the
// steady bright anchor in the centre while everything else breathes
// around it.
export function updateLights(lights, t, scene) {
  const fireplaceMode = ANIM.viewMode === 'fireplaceOne' || ANIM.viewMode === 'fireplaceTwo';

  // In fireplace mode, compress the ~6 s warm key/glow throb toward its
  // midpoint (ANIM.flame.scenePulseFlatten, 0..1; 1 = full legacy swing)
  // so the hearth reads as a steady warm room with a faint sway instead
  // of a pulsing one. Other modes keep the full-amplitude pulse.
  const pulseFlat = fireplaceMode
    ? ((ANIM.flame && ANIM.flame.scenePulseFlatten) ?? 0.25)
    : 1.0;
  const pulse   = Math.sin(t * ANIM.pulseSpeed);
  const pulse01 = 0.5 + 0.5 * pulse * pulseFlat;
  const warm    = 1.0 - pulse01;

  const pointDim = fireplaceMode
    ? ((ANIM.flame && ANIM.flame.baseLightDim) ?? 0.06)
    : 1.0;

  // Piecewise dark-hold → ease-up → bright-hold → ease-down → loop.
  let envPulse = 1.0;
  if (fireplaceMode) {
    const ed     = (ANIM.flame && ANIM.flame.envDim) || {};
    const min    = ed.min        ?? 0.0;
    const dark   = Math.max(0, ed.darkHold   ?? 60);
    const up     = Math.max(0, ed.rampUp     ?? 30);
    const bright = Math.max(0, ed.brightHold ?? 60);
    const down   = Math.max(0, ed.rampDown   ?? 30);
    const total  = dark + up + bright + down;
    let shape = 1.0;
    if (total > 0) {
      let phase = t % total;
      if (phase < 0) phase += total;
      if      (phase < dark)              shape = 0;
      else if (phase < dark + up)         shape = smoothstep01((phase - dark) / Math.max(1e-6, up));
      else if (phase < dark + up + bright) shape = 1;
      else                                shape = 1 - smoothstep01((phase - dark - up - bright) / Math.max(1e-6, down));
    }
    envPulse = min + (1.0 - min) * shape;
  }
  const envDim = pointDim * envPulse;

  const kl = ANIM.keyLight;
  lights.keyLight.intensity = Math.max(0.0, kl.intensityMin + (kl.intensityMax - kl.intensityMin) * pulse01) * envDim;
  const [klMinR, klMinG, klMinB] = hexToRgb(kl.colorAtMin);
  const [klMaxR, klMaxG, klMaxB] = hexToRgb(kl.colorAtMax);
  lights.keyLight.color.setRGB(
    klMinR + (klMaxR - klMinR) * pulse01,
    klMinG + (klMaxG - klMinG) * pulse01,
    klMinB + (klMaxB - klMinB) * pulse01,
  );

  // innerGlow + frontPatternLight ride the env breath too, so the trough
  // can fall below the constant point-light floor and the flame becomes
  // the only visibly-lit element during the dark hold.
  const ig = ANIM.innerGlow;
  lights.innerGlow.intensity = (ig.intensityMin + (ig.intensityMax - ig.intensityMin) * warm) * envDim;
  lights.innerGlow.color.set(ig.color);

  const fp = ANIM.frontPatternLight;
  lights.frontPatternLight.intensity = (fp.intensityMin + (fp.intensityMax - fp.intensityMin) * warm) * envDim;
  lights.frontPatternLight.color.set(fp.color);

  const rl = ANIM.rimLight;
  const rimPulse01 = 0.5 + 0.5 * Math.sin(t * ANIM.pulseSpeed + rl.phaseOffset) * pulseFlat;
  lights.rimLight.intensity = (rl.intensityMin + (rl.intensityMax - rl.intensityMin) * rimPulse01) * envDim;
  lights.rimLight.color.set(rl.color);

  lights.ambientLight.intensity    = ANIM.ambientIntensity * envDim;
  lights.fillLight.intensity       = ANIM.fillIntensity * envDim;
  lights.rearPatternLight.intensity = ANIM.rearPatternIntensity * pointDim;
  lights.rearPatternLight.color.set(ANIM.rearPatternColor);

  // Scale the PMREM env reflection that every MeshStandardMaterial picks
  // up. Without this, brick / arch / topLayer materials read at constant
  // brightness from the cubemap regardless of light state and the room
  // never visibly darkens. Reset to 1.0 outside fireplace/carved so other
  // modes keep their full env wash.
  if (scene) scene.environmentIntensity = fireplaceMode ? envPulse : 1.0;
}

function smoothstep01(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}
