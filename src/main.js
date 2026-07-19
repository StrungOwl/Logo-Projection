// Orchestrator. Boots the scene + lights, loads the logo, wires the
// pattern + particle layers onto it, then runs the per-frame breathing
// loop. Every breathing value is pulled from ANIM each frame so
// `window.ANIM.*` edits in the devtools console take effect immediately.

import * as THREE from 'three';
import { ANIM, COLORS } from './config.js';
import { createScene, frameLogo } from './core/scene.js';
import { createLights, updateLights } from './core/lights.js';
import { createPipeline } from './core/pipeline.js';
import { createProjectionMode } from './core/projection.js';
import { createCalibration } from './core/calibration.js';
import { loadLogo } from './core/logo.js';
import { addEffects } from './effects/effects.js';
import { addOverlay } from './effects/flowers/starFans.js';
import { addParticles, updateParticles } from './effects/_shared/streams.js';
import { toggleDominoes, updateDominoes } from './effects/fireplaceTwo/dominoAnim.js';
import { tickShimmer } from './shaders/gold-shimmer.js';
import { applyLogoStarry, tickLogoStarry } from './shaders/logo-starry.js';
import { cycleQuality } from './quality.js';

const { scene, camera, renderer, controls } = createScene();
const lights = createLights(scene);
// Captured here at scene-build time so the per-frame env toggle in
// fireplace mode can restore the original PMREM cubemap when leaving
// the mode (vs. permanently overwriting scene.environment with null).
const baseEnvironment = scene.environment;

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
  updateFractalZoom:  null,
  fractalState:       null,
  updateRotations:    null,
  updateLatticeEvolution: null,
  updateOverlay:      null,
  // Per-effect group handles. Keyed visibility (0–5 view modes) reads
  // these in tick() so the user can solo a single layer for tuning.
  panelGroup:         null,
  latticeGroup:       null,
  gateFrameGroup:     null,
  gateRimGroup:       null,
  updateGateRim:      null,
  overlayFlowerRoots: [],
  overlayHexRoots:    [],
  overlayMaskMesh:    null,
  archGroup:          null,
  updateArch:         null,
  triggerArchCascade: null,
  recedeGroup:        null,
  updateRecede:       null,
  flameGroup:         null,
  updateFlame:        null,
  flameLights:        [],
  fireplaceGroup:     null,
  updateFireplace:    null,
  constellationGroup:      null,
  updateConstellation:     null,
  setConstellationOpacity: null,
  triggerStellarPulse:     null,
  hearthFlameGroup:        null,
  updateHearthFlame:       null,
  hearthFlameLights:       [],
  getHearthFlameOpacity:   null,
  lights,
  scene,
  camera,
  renderer,
  baseColorScratch:   new THREE.Color(),
  // Separate clock that pauses while the fractal zoom is animating, so
  // the logo body breath + lattice/twinkle stroke uniforms freeze at
  // their last value during the dive (any pulse on top of the dive's
  // own brightness motion reads as flicker). When the fractal settles
  // back to rest, this clock resumes from where it paused — no snap.
  brightnessTime:     0,
  // Whole loaded model (all effects are parented under it) — calibration
  // mode hides it wholesale so only the alignment patterns render.
  logoModel:          null,
};

// Render/size authority + fixed-resolution projection mode. The pipeline
// is the ONLY caller of renderer.setSize/setPixelRatio from here on.
const pipeline   = createPipeline({ renderer, scene, camera, ctx });
const projection = createProjectionMode({ camera, controls, pipeline });
let calibration  = null;   // built once the logo (and its silhouette) loads

// Low-passed flame brightness 0..1 — driven by the live PointLight stack
// in src/effects/fireplaceOne/flame.js. Read by the galaxy uBrightness
// pulse so the starry backdrop breathes with the flame's broader envelope
// without strobing on every per-frame flicker spike.
let smoothedFlameEnv = 1.0;

// Logo starry blend 0..1 — driven by viewMode. Lerps toward 1 in
// flameOnly (key 6) so the starry shader fades onto the logo body,
// and toward 0 elsewhere. Same value also dims the galaxy backdrop
// plate so the two layers cross-fade.
let logoStarryBlend = 0;

// Hex-mode background cycle clock. While viewMode === 'hexagons' the
// galaxy backdrop auto-alternates between the warm nebula it shows in
// the other non-fireplace modes and a denser/larger "starry sky" that
// boosts the effect-4 starry look. Reset to -1 whenever we leave hex
// mode so the next hex-mode entry starts fresh from state A (nebula).
let hexBgCycleEnterT = -1;

// Constellation overlay state — the group's opacity is essentially
// pass-through to the constellation module, which manages its own
// long initial idle phase (20 s) + cycle through 5 figures internally.
// Tiny CONSTELLATION_DELAY/FADE_DUR here just make the group available
// shortly after entering flameOnly mode; the actual visual delay before
// any figure appears comes from constellation.js's `initialDelay`.
const CONSTELLATION_DELAY    = 0.0;
const CONSTELLATION_FADE_DUR = 0.5;
let flameOnlyElapsed   = 0;
let constellationOpacity = 0;

// Cached state so per-frame work skips when nothing relevant changed.
// Without these, main.js used to write the same scene.environment swap,
// the same logoMaterials.color value, and the same stroke time uniform
// every frame. Lossless cleanup.
let lastViewMode    = null;
let lastBrightness  = NaN;
let lastEnvIntensity = NaN;

// Gate-frame "fiery silhouette" override (mode 6 flameOnly). Captures
// the frame's base gradient + color on first invocation so we can
// restore them on exit. Per-frame emissive pulse driven by
// smoothedFlameEnv lives in tick() (see flame envelope block below).
let gateFrameBase = null;
const FIRE_GRAD_DARK   = [0.55, 0.04, 0.00];   // deep ember red
const FIRE_GRAD_BRIGHT = [1.00, 0.55, 0.12];   // hot yellow-orange tip
const FIRE_BASE_HEX    = 0x331100;             // dark molten diffuse
const FIRE_EMISSIVE    = 0xFF5510;             // glowing fire emissive
function applyGateFrameTint(flameOn) {
  const g = ctx.gateFrameGroup;
  if (!g || !g.userData) return;
  const mat  = g.userData.frameMaterial;
  const grad = g.userData.gradUniforms;
  if (!mat || !grad) return;
  if (!gateFrameBase) {
    gateFrameBase = {
      darkV:             grad.uGradDark.value.clone(),
      brightV:           grad.uGradBright.value.clone(),
      baseHex:           mat.color.getHex(),
      emissiveHex:       mat.emissive.getHex(),
      emissiveIntensity: mat.emissiveIntensity || 0,
    };
  }
  if (flameOn) {
    grad.uGradDark.value.set(...FIRE_GRAD_DARK);
    grad.uGradBright.value.set(...FIRE_GRAD_BRIGHT);
    mat.color.setHex(FIRE_BASE_HEX);
    mat.emissive.setHex(FIRE_EMISSIVE);
    mat.emissiveIntensity = 0.7;
  } else {
    grad.uGradDark.value.copy(gateFrameBase.darkV);
    grad.uGradBright.value.copy(gateFrameBase.brightV);
    mat.color.setHex(gateFrameBase.baseHex);
    mat.emissive.setHex(gateFrameBase.emissiveHex);
    mat.emissiveIntensity = gateFrameBase.emissiveIntensity;
  }
}

loadLogo().then((logo) => {
  ctx.galaxyMat     = logo.galaxyMat;
  ctx.logoMaterials = logo.logoMaterials;

  // Inject the starry-night shader patch onto every logo material so
  // they can emit a twinkling starfield (gated by uStarryBlend, lerped
  // in tick()). All materials share the same uniforms — one tick driver
  // updates the field for all of them.
  for (const m of ctx.logoMaterials) applyLogoStarry(m);

  const patternResult = addEffects(logo.logoMesh, logo.meta, renderer);
  ctx.strokeTimeUniforms.push(...patternResult.strokeTimeUniforms);
  ctx.sparkSystems.push(...patternResult.sparkSystems);
  ctx.updateRowCascade   = patternResult.updateRowCascade;
  ctx.cascadeState       = patternResult.cascadeState;
  ctx.updateFractalZoom  = patternResult.updateFractalZoom;
  ctx.fractalState       = patternResult.fractalState;
  ctx.updateRotations    = patternResult.updateRotations;
  ctx.updateLatticeEvolution = patternResult.updateLatticeEvolution;
  ctx.panelGroup         = patternResult.panelGroup;
  ctx.latticeGroup       = patternResult.latticeGroup;
  ctx.gateFrameGroup     = patternResult.gateFrameGroup;
  ctx.gateRimGroup       = patternResult.gateRimGroup;
  ctx.updateGateRim      = patternResult.updateGateRim;
  ctx.archGroup          = patternResult.archGroup;
  ctx.updateArch         = patternResult.updateArch;
  ctx.triggerArchCascade = patternResult.triggerArchCascade;
  ctx.recedeGroup        = patternResult.recedeGroup;
  ctx.updateRecede       = patternResult.updateRecede;
  ctx.flameGroup         = patternResult.flameGroup;
  ctx.updateFlame        = patternResult.updateFlame;
  ctx.flameLights        = patternResult.flameLights || [];
  ctx.fireplaceGroup     = patternResult.fireplaceGroup;
  ctx.updateFireplace    = patternResult.updateFireplace;
  ctx.constellationGroup      = patternResult.constellationGroup;
  ctx.updateConstellation     = patternResult.updateConstellation;
  ctx.setConstellationOpacity = patternResult.setConstellationOpacity;
  ctx.triggerStellarPulse     = patternResult.triggerStellarPulse;
  ctx.hearthFlameGroup        = patternResult.hearthFlameGroup;
  ctx.updateHearthFlame       = patternResult.updateHearthFlame;
  ctx.hearthFlameLights       = patternResult.hearthFlameLights || [];
  ctx.getHearthFlameOpacity   = patternResult.getHearthFlameOpacity;
  ctx.silhouettePolygons = patternResult.silhouettePolygons;

  // cascadeState is passed in so the overlay can sync its brick↔petals
  // morph to the cascade's all-at-center window when ANIM.timings.playAll
  // is true. With playAll off, the overlay ignores it and free-runs.
  const overlayResult = addOverlay(logo.logoMesh, logo.meta, patternResult.cascadeState);
  ctx.updateOverlay   = overlayResult.updateOverlay;
  ctx.overlayFlowerRoots = overlayResult.flowerRoots || [];
  ctx.overlayHexRoots    = overlayResult.hexRoots    || [];
  ctx.overlayMaskMesh    = overlayResult.sharedMask  || null;

  scene.add(logo.model);
  ctx.logoModel = logo.model;

  // World matrices must be finalised before pattern fade shaders compute
  // their inverse-world matrices (so world-Y gradient conversions land in
  // panel-local coords correctly).
  scene.updateMatrixWorld(true);
  patternResult.patternsToRefresh.forEach(g => g.userData.refreshFade?.());
  overlayResult.patternsToRefresh.forEach(g => g.userData.refreshFade?.());

  ctx.particleMats = addParticles(logo.logoMesh, renderer);

  // Calibration patterns + projection framing both need the finalised
  // logo world transform (they copy matrixWorld / fit the world bbox).
  calibration = createCalibration({ scene, logoMesh: logo.logoMesh, meta: logo.meta });
  projection.setLogo(logo.logoMesh);

  frameLogo(camera, controls);
  // ?proj=1 boots straight into fixed-resolution projection framing.
  if (projection.bootRequested) projection.enable();
}).catch(err => console.error('Failed to load logo:', err));

// Single per-frame update — called by both the live animate loop and the
// deterministic export loop. `t` is absolute seconds, `dt` is the step
// size for stateful systems (sparks) — the live loop passes real delta;
// the export loop passes a fixed 1/fps.
export function tick(t, dt) {
  if (ctx.galaxyMat) {
    ctx.galaxyMat.uniforms.uTime.value       = t * ANIM.galaxy.timeScale;
    // In fireplace mode, lerp uBrightness toward the configured override
    // so the backdrop is dimmer and the flame body reads clearly against
    // mostly-black sky-with-stars.
    const galStarry = ctx.galaxyMat.uniforms.uStarryMode.value;
    const flameBg = (ANIM.flame && ANIM.flame.galaxyStarry && ANIM.flame.galaxyStarry.brightness);
    const targetBright = (flameBg !== undefined)
      ? ANIM.galaxy.brightness * (1 - galStarry) + flameBg * galStarry
      : ANIM.galaxy.brightness;
    // Pulse the backdrop with the flame envelope. Only blends in
    // proportion to galStarry (so non-fireplace modes are untouched).
    const pulseAmount = (ANIM.flame && ANIM.flame.galaxyStarry
                         && ANIM.flame.galaxyStarry.pulseAmount) ?? 0;
    const pulseMul = 1 - galStarry * pulseAmount * (1 - smoothedFlameEnv);
    // Staggered cross-fade: galaxy plate fades out over the FIRST half
    // of logoStarryBlend (0 → 0.5), then logo stars fade in over the
    // SECOND half (0.5 → 1.0). The shader-side blend driver below uses
    // the back-loaded half. Without this stagger both layers were dim
    // at the same moment, leaving a visible flicker-of-nothing.
    const galaxyFadeOut = Math.min(logoStarryBlend / 0.5, 1.0);
    const galaxyMul = 1 - galaxyFadeOut;
    ctx.galaxyMat.uniforms.uBrightness.value = targetBright * pulseMul * galaxyMul;
  }

  // Skip stream physics in fireplace modes — the streams emit from the
  // inner-star outline and would compete with the flame body in the same
  // negative-space region, so they're hidden anyway. Skipping the update
  // saves the per-particle Bezier evaluation while invisible.
  if (ctx.particleMats &&
      ANIM.viewMode !== 'fireplaceOne' &&
      ANIM.viewMode !== 'fireplaceTwo') {
    updateParticles(ctx.particleMats, t);
  }

  // View-mode + master-toggle gating. The base scene (logo galaxy, gate
  // frame, particles, lights) stays on across every mode. Each effect
  // family is shown only in Visual Sequence or its own solo mode.
  //   0 → 'visualSequence'  rosette + hex lattice + flower overlay
  //   1 → 'fractalPattern'  rosette + hex lattice (with fractal lens)
  //   2 → 'hexagons'        overlay BIG hex bricks only
  //   3 → 'flowers'         full flower overlay (hex → roses → hex)
  //   4 → 'fireplaceOne'    cascading brick arch + flame + starry sky
  //   5 → 'fireplaceTwo'    nested receding logo silhouettes + flame
  // `ANIM.patterns.enabled === false` is the legacy kill switch — when
  // off, panel + lattice stay hidden regardless of view mode.
  const mode = ANIM.viewMode || 'visualSequence';
  const legacyPatterns = !(ANIM.patterns && ANIM.patterns.enabled === false);
  const showPanel     = legacyPatterns && (mode === 'visualSequence' || mode === 'fractalPattern');
  const showLattice   = legacyPatterns && (mode === 'visualSequence' || mode === 'fractalPattern');
  const showHexBrick  = (mode === 'visualSequence' || mode === 'hexagons');
  const showFlowers   = (mode === 'visualSequence' || mode === 'flowers');
  const showFireplace = (mode === 'fireplaceOne');
  const showRecede    = (mode === 'fireplaceTwo');
  const showFlameOnly = (mode === 'flameOnly');
  // Lerp logoStarryBlend toward 1 in flameOnly mode AND fireplaceTwo mode
  // (the receding-logo effect wants the same shimmering body), 0 elsewhere.
  // Slow fadeSpeed gives a few-second cross-fade between the galaxy plate
  // and the logo-body starry shader. The blend is split into two halves
  // (galaxy fades first, then logo stars come up) — see the galaxy
  // uBrightness block above for the front-half curve.
  {
    const target = (showFlameOnly || showRecede) ? 1 : 0;
    const fadeSpeed = 0.15;
    const k = 1 - Math.exp(-fadeSpeed * dt);
    logoStarryBlend += (target - logoStarryBlend) * k;
    // Logo stars fade in only over the SECOND half of the blend so the
    // galaxy can fully disappear before the body's stars become visible.
    const logoStarsBlend = Math.max(0, (logoStarryBlend - 0.5) / 0.5);
    tickLogoStarry(t, logoStarsBlend);
  }
  // Flame stays lit in fireplaceOne (key 4), fireplaceTwo (key 5 — recede),
  // and flameOnly (key 6). fireplaceTwo no longer carries any bricks; the
  // recede stack + flame + galaxy is the whole show. flameOnly remains the
  // "molten frame" mode where the gate frame is recolored fiery.
  const showFlame    = showFireplace || showRecede;
  const fireLikeMode = showFlame || showFlameOnly;
  if (ctx.panelGroup)   ctx.panelGroup.visible   = showPanel;
  if (ctx.latticeGroup) ctx.latticeGroup.visible = showLattice;
  if (ctx.archGroup)    ctx.archGroup.visible    = showFireplace;
  if (ctx.recedeGroup)  ctx.recedeGroup.visible  = showRecede;
  if (ctx.flameGroup)   ctx.flameGroup.visible   = showFlame;
  if (ctx.gateRimGroup) ctx.gateRimGroup.visible = showFlameOnly;
  // fireplaceOne still wants the outer brick fireplace; fireplaceTwo doesn't.
  if (ctx.fireplaceGroup) ctx.fireplaceGroup.visible = showFireplace;
  // Hide the smooth extruded gate-frame ring when fireplaceOne wants to
  // own the perimeter look — set ANIM.arch.hideGateFrame in config to
  // drop the procedural frame so only the brick layers read. Recede mode
  // keeps the gate frame visible — it caps the receding silhouette nicely.
  if (ctx.gateFrameGroup) {
    ctx.gateFrameGroup.visible = !(showFireplace && ANIM.arch && ANIM.arch.hideGateFrame);
  }
  // Three.js checks light.visible directly when collecting scene lights —
  // hiding the parent group does NOT remove the light from the shader's
  // light list. Toggle each PointLight in the flame stack so they only
  // contribute to the inner cutout walls + arch bricks while fireplace
  // mode is active.
  if (ctx.flameLights) {
    for (let i = 0; i < ctx.flameLights.length; i++) {
      ctx.flameLights[i].visible = showFlame;
    }
  }
  // Hide the ember + white particle streams in fire-like modes (fireplace
  // and flameOnly). They emit from the inner-star outline and would clutter
  // the flame body in the same negative-space region.
  if (ctx.particleMats) {
    const showParticles = !fireLikeMode;
    if (ctx.particleMats.emberPoints) ctx.particleMats.emberPoints.visible = showParticles;
    if (ctx.particleMats.whitePoints) ctx.particleMats.whitePoints.visible = showParticles;
  }
  // Strip the scene-wide PMREM env cubemap in fireplace modes so
  // the grey ambient wash baked into every MeshStandardMaterial goes
  // away — without this, those materials read at ~constant brightness
  // regardless of light state, defeating the "only the flame
  // illuminates" goal.
  // Only reassign scene.environment when the mode actually changes —
  // writing it every frame triggers a PBR recompute even though the
  // value is identical.
  if (mode !== lastViewMode) {
    const stripEnv = fireLikeMode
                  && (ANIM.flame && ANIM.flame.stripEnvironment !== false);
    scene.environment = stripEnv ? null : baseEnvironment;
    applyGateFrameTint(showFlameOnly);
    lastViewMode = mode;
  }
  for (let i = 0; i < ctx.overlayFlowerRoots.length; i++) {
    ctx.overlayFlowerRoots[i].visible = showFlowers;
  }
  for (let i = 0; i < ctx.overlayHexRoots.length; i++) {
    ctx.overlayHexRoots[i].visible = showHexBrick;
  }
  // Stencil mask must be on whenever either overlay layer is on — both
  // flowers and hex bricks test against it.
  if (ctx.overlayMaskMesh) {
    ctx.overlayMaskMesh.visible = showFlowers || showHexBrick;
  }

  // Calibration mode (key 9): the whole model — every effect is parented
  // under it — disappears and only the alignment patterns render.
  if (ctx.logoModel) ctx.logoModel.visible = mode !== 'calibration';
  if (calibration)   calibration.update(renderer, mode === 'calibration');

  // Brightness clock — pauses while the fractal zoom is animating
  // (clones visible OR displacement non-zero). The dive's own brightness
  // motion is dramatic enough that any background breath / pulse / stroke
  // twinkle layered on top reads as flicker; freezing those during the
  // zoom keeps the eye on the fractal motion. The clock resumes
  // seamlessly when the fractal settles back to rest, so the logo body
  // breath continues from where it paused — no snap-back jump.
  const fractalRunning = ctx.fractalState
    && ((ctx.fractalState.cloneOp ?? 0) > 0.01
     || (ctx.fractalState.lambda  ?? 0) > 0.01);
  if (!fractalRunning) ctx.brightnessTime += dt;
  const tBright = ctx.brightnessTime;

  // Logo base brightness — sine-wave breath between min and max over `period` seconds.
  // Skip the per-material write loop when neither the breath factor nor the
  // envMapIntensity changed since last frame (steady-state fast path).
  if (ctx.logoMaterials) {
    const lb = ANIM.logoBase;
    const phase = (tBright / Math.max(lb.period, 1e-3)) * Math.PI * 2;
    const k01 = 0.5 + 0.5 * Math.sin(phase);
    const factor = lb.brightnessMin + (lb.brightnessMax - lb.brightnessMin) * k01;
    // In fireplace modes, drop envMapIntensity heavily so the metallic
    // env reflection doesn't wash the body warm-grey on its own.
    const envI = fireLikeMode
      ? ((ANIM.flame && ANIM.flame.envMapIntensity) ?? 0.08)
      : 1.0;
    // flameOnly (key 6) forces the logo body to pure black so the
    // silhouette reads as a void framing the central flame. envI is
    // already at the fireplace-low value so any residual env reflection
    // is killed too.
    const effectiveFactor = showFlameOnly ? 0 : factor;
    if (Math.abs(effectiveFactor - lastBrightness) > 1e-4 || envI !== lastEnvIntensity) {
      if (showFlameOnly) ctx.baseColorScratch.setRGB(0, 0, 0);
      else               ctx.baseColorScratch.set(COLORS.logo.base).multiplyScalar(factor);
      for (let i = 0; i < ctx.logoMaterials.length; i++) {
        ctx.logoMaterials[i].color.copy(ctx.baseColorScratch);
        ctx.logoMaterials[i].envMapIntensity = envI;
      }
      lastBrightness = effectiveFactor;
      lastEnvIntensity = envI;
    }
  }

  for (let i = 0; i < ctx.strokeTimeUniforms.length; i++) ctx.strokeTimeUniforms[i].value = tBright;

  // Row cascade runs BEFORE both overlay and sparks: the overlay reads
  // cascadeState.playAllT to gate its brick↔petals morph to the all-at-
  // center window, and sparks read cascadeState.active for snap strength.
  //
  // Pattern mode (key 1) swaps the radial cascade out for the fractal
  // lens (central magnification + back-layer fractal copies). Both
  // updaters drive the same per-tile mesh.position/scale, so only one
  // can run at a time. The fractal updater self-cleans when viewMode
  // isn't 'pattern' (parks tiles back at rest, fades back layers out).
  const fractalActive = mode === 'fractalPattern'
                     && ctx.updateFractalZoom
                     && !(ANIM.fractalZoom && ANIM.fractalZoom.enabled === false);
  // Skip updateRotations during the fractal dive — originals are at
  // opacity 0 there, so writing rotation.z on hundreds of hidden meshes
  // each frame just dirties their world matrices for nothing. intro /
  // landing / rest keep originals visible, so rotations still run.
  const fractalDiving = fractalActive && ctx.fractalState
                     && ctx.fractalState.phase === 'dive';
  if (ctx.updateRotations && !fractalDiving) ctx.updateRotations(t);
  // Lattice evolution (noise hot patches + macro LFOs + coherence
  // crossfade) is amplitude-only; it can run unconditionally regardless
  // of view mode or cascade state without disturbing the pulse phase.
  if (ctx.updateLatticeEvolution) ctx.updateLatticeEvolution(t);
  if (ctx.updateFractalZoom) ctx.updateFractalZoom(t, dt);
  if (ctx.updateRowCascade && !fractalActive) ctx.updateRowCascade(t, dt);
  // While the fractal lens drives pattern mode, project its λ-derived
  // "active" value onto the existing cascade-state spark wiring: sparks
  // snap fully when the lens is at rest (λ=0) and float free when the
  // lens is at peak (λ=1). Disable the playAll window in this mode so
  // the overlay doesn't try to sync to a non-existent cascade beat.
  if (fractalActive && ctx.cascadeState && ctx.fractalState) {
    ctx.cascadeState.active   = ctx.fractalState.active;
    ctx.cascadeState.playAllT = -1;
  }
  if (ctx.updateOverlay)    ctx.updateOverlay(t);
  if (ctx.updateArch)       ctx.updateArch(t, dt);
  if (ctx.updateFireplace)  ctx.updateFireplace(t, dt);
  if (ctx.updateRecede)     ctx.updateRecede(t, dt);
  // Drive the gold-shimmer sparkle phase. Cheap — one uniform write —
  // and a no-op on materials the shader patch wasn't applied to.
  tickShimmer(t);
  // Domino-flip wave — no-op when idle; runs through all registered
  // bricks once per trigger (key 'd' or window.__triggerDominoes()).
  updateDominoes(t);
  // Flame body shader, sparks, and flickering point light — runs every
  // frame regardless of mode so the flame keeps "warming up" off-screen
  // (no first-frame popping in when switching to mode 5).
  if (ctx.updateFlame)      ctx.updateFlame(t, dt);
  if (ctx.updateGateRim)    ctx.updateGateRim(t, dt);

  // Read the live flame PointLight stack and low-pass it to drive the
  // galaxy backdrop pulse. The lights are flickered by patterns/flame.js
  // each frame; we average normalized intensity and lerp our smoothed
  // value toward it with a 1-sec time constant — high-frequency flicker
  // averages out, slower envelope shifts (movement modulation, flares)
  // ride through.
  if (ctx.flameLights && ctx.flameLights.length && ANIM.flame && ANIM.flame.light) {
    const lc = ANIM.flame.light;
    let sum = 0, maxSum = 0;
    for (const lt of ctx.flameLights) {
      sum    += lt.intensity || 0;
      maxSum += (lc.intensityMax || 1) * ((lt.userData && lt.userData.intensityScale) || 1);
    }
    const instant = maxSum > 0 ? Math.min(1, Math.max(0, sum / maxSum)) : 0.5;
    const k = 1 - Math.exp(-dt / 1.0);
    smoothedFlameEnv += (instant - smoothedFlameEnv) * k;
  }

  // In flameOnly mode (key 6), pulse the gate-frame's emissive intensity
  // with the smoothed flame envelope so the fiery silhouette breathes
  // with the fire flicker. The base color + gradient swap was applied
  // once on mode entry by applyGateFrameTint.
  if (showFlameOnly && ctx.gateFrameGroup && ctx.gateFrameGroup.userData) {
    const mat = ctx.gateFrameGroup.userData.frameMaterial;
    if (mat) mat.emissiveIntensity = 0.45 + 0.6 * smoothedFlameEnv;
  }

  // Constellation overlay (key 6 only) — fade in after CONSTELLATION_DELAY
  // so the starry sky + frame can establish first. Constellation runs its
  // own internal clock for draw-in scheduling and stellar pulses; we just
  // drive opacity in/out and call its update.
  if (showFlameOnly) flameOnlyElapsed += dt;
  else               flameOnlyElapsed  = 0;
  const cTarget = showFlameOnly
    ? Math.max(0, Math.min(1, (flameOnlyElapsed - CONSTELLATION_DELAY) / CONSTELLATION_FADE_DUR))
    : 0;
  const cBlend = 1 - Math.exp(-dt / 0.4);
  constellationOpacity += (cTarget - constellationOpacity) * cBlend;
  if (ctx.constellationGroup) {
    const visible = constellationOpacity > 0.002;
    ctx.constellationGroup.visible = visible;
    if (ctx.setConstellationOpacity) ctx.setConstellationOpacity(constellationOpacity);
    if (visible && ctx.updateConstellation) ctx.updateConstellation(t, dt);
  }

  // Hearth flame (key 6 only) — single wide flame masked to the gate-
  // frame interior. While iterating on the look, force always-visible
  // in flameOnly mode (bypass the constellation cycle's flame-phase
  // gating). To restore cycle gating swap the line below back to:
  //   const hearthVisible = showFlameOnly &&
  //     (ctx.getHearthFlameOpacity ? ctx.getHearthFlameOpacity() : 0) > 0.05;
  const hearthVisible = showFlameOnly;
  if (ctx.hearthFlameGroup) ctx.hearthFlameGroup.visible = hearthVisible;
  if (ctx.hearthFlameLights) {
    for (let i = 0; i < ctx.hearthFlameLights.length; i++) {
      ctx.hearthFlameLights[i].visible = hearthVisible;
    }
  }
  if (ctx.updateHearthFlame) ctx.updateHearthFlame(t, dt);

  // Galaxy starry-night blend — lerps toward 1 in fireplace mode (black
  // sky + denser flickering stars behind the flame), toward 0 otherwise
  // (warm nebula). Eased exponentially using the configured fadeSpeed
  // (1/sec).
  //
  // Hex mode (effect 2) overrides the targets to auto-cycle between
  // the warm nebula and a denser/larger boosted-starry look:
  //   [0, dwell)              → state A: nebula      (phase 0)
  //   [dwell, dwell+fade)     → A → B transition     (phase 0..1)
  //   [dwell+fade, 2d+f)      → state B: boosted sky (phase 1)
  //   [2d+f, 2(d+f))          → B → A transition     (phase 1..0)
  // phase drives uStarryMode + uStarryBoost in lockstep, and lerps
  // uStarSizeScale from 1.0 → boostSizeScale during the starry half.
  if (mode === 'hexagons') {
    if (hexBgCycleEnterT < 0) hexBgCycleEnterT = t;
  } else {
    hexBgCycleEnterT = -1;
  }
  if (ctx.galaxyMat && ctx.galaxyMat.uniforms.uStarryMode) {
    let targetStarry = fireLikeMode ? 1.0 : 0.0;
    let targetScale  = showFlameOnly ? 1.5 : 1.0;
    let targetBoost  = 0.0;

    const cycleCfg = ANIM.galaxy && ANIM.galaxy.bgCycle;
    if (mode === 'hexagons' && cycleCfg && cycleCfg.enabled !== false
        && hexBgCycleEnterT >= 0) {
      const dwell = Math.max(0.1, cycleCfg.dwellSeconds ?? 30);
      const fade  = Math.max(0.1, cycleCfg.fadeSeconds  ?? 3);
      const boostScale = cycleCfg.boostSizeScale ?? 2.5;
      const cycleLen = 2 * (dwell + fade);
      const cyc = ((t - hexBgCycleEnterT) % cycleLen + cycleLen) % cycleLen;
      let phase;
      if      (cyc < dwell)              phase = 0;
      else if (cyc < dwell + fade)       phase = (cyc - dwell) / fade;
      else if (cyc < 2 * dwell + fade)   phase = 1;
      else                               phase = 1 - (cyc - (2 * dwell + fade)) / fade;
      // Smoothstep for an ease-in/out feel on the transition halves.
      phase = phase * phase * (3 - 2 * phase);
      targetStarry = phase;
      targetScale  = 1.0 + phase * (boostScale - 1.0);
      targetBoost  = phase;
    }

    const fadeSpeed = (ANIM.flame && ANIM.flame.galaxyStarry && ANIM.flame.galaxyStarry.fadeSpeed) || 1.5;
    const blend = 1 - Math.exp(-fadeSpeed * dt);
    const u = ctx.galaxyMat.uniforms.uStarryMode;
    u.value += (targetStarry - u.value) * blend;
    if (ctx.galaxyMat.uniforms.uStarSizeScale) {
      const us = ctx.galaxyMat.uniforms.uStarSizeScale;
      us.value += (targetScale - us.value) * blend;
    }
    if (ctx.galaxyMat.uniforms.uStarryBoost) {
      const ub = ctx.galaxyMat.uniforms.uStarryBoost;
      ub.value += (targetBoost - ub.value) * blend;
    }

    // Particle fade — the white + ember streams crowd the boosted-starry
    // sky, so we fade them out in lockstep with uStarryBoost: fully
    // visible at nebula (boost=0), invisible at boosted starry (boost=1).
    // updateParticles writes uBrightness from config each frame above;
    // scaling it here keeps the fade tied to the shader's live phase
    // without touching the config values. Non-hex modes hold boost=0 so
    // this multiplier is 1 there (no-op).
    if (ctx.particleMats) {
      const boost = ctx.galaxyMat.uniforms.uStarryBoost
        ? ctx.galaxyMat.uniforms.uStarryBoost.value : 0;
      const visMul = Math.max(0, 1 - boost);
      if (ctx.particleMats.emberMat) {
        ctx.particleMats.emberMat.uniforms.uBrightness.value *= visMul;
      }
      if (ctx.particleMats.whiteMat) {
        ctx.particleMats.whiteMat.uniforms.uBrightness.value *= visMul;
      }
    }
  }
  // updateOverlay re-asserts brickHexWall.visible based on its morph phase
  // each frame, which in mode 'flowers' would re-enable the bricks during
  // the brick hold. Re-apply the mode 'flowers' suppression after the
  // overlay runs so the brick wall stays hidden — the rose petals + their
  // morph-ghost transit are the only things visible in this mode.
  if (mode === 'flowers') {
    for (let i = 0; i < ctx.overlayHexRoots.length; i++) {
      ctx.overlayHexRoots[i].visible = false;
    }
  }
  // flameOnly: updateOverlay's internal morph state can re-enable BOTH
  // the hex wall and the rose flowers during its brick-hold and rose-
  // hold phases. Mode 6 wants only the starry sky + frame + hearth, so
  // suppress everything the overlay owns here.
  if (mode === 'flameOnly') {
    for (let i = 0; i < ctx.overlayHexRoots.length; i++) {
      ctx.overlayHexRoots[i].visible = false;
    }
    for (let i = 0; i < ctx.overlayFlowerRoots.length; i++) {
      ctx.overlayFlowerRoots[i].visible = false;
    }
    if (ctx.overlayMaskMesh) ctx.overlayMaskMesh.visible = false;
  }
  const snapScale = ctx.cascadeState ? ctx.cascadeState.active : 1;
  // Sparks fade out (not snap to invisible) while the playAll overlay
  // window is open — the stroke cloud is a load-time snapshot that
  // doesn't follow the cascade, so unfaded sparks would drift over the
  // brick wall / petals. Lerp the per-system shader uniform `uOpacity`
  // toward target each frame for a smooth fade-in / fade-out.
  // Per-mode gating: in solo modes, sparks fade out unless their host
  // layer is visible (panel-sparks ↔ pattern mode, lattice-sparks ↔ hex
  // mode). In 'all' mode they fade against the playAll overlay window
  // exactly as before.
  const inOverlayWindow = !!(ctx.cascadeState && ctx.cascadeState.playAllT >= 0);
  // Pattern-mode dive suppression: gate sparks on cloneOp.
  // Sparks anchor to the originals' stroke geometry. With the redesigned
  // fractal zoom, originals stay parked at rest position throughout
  // (no λ-driven displacement) and instead crossfade by opacity:
  //   rest   → cloneOp = 0, originals visible → sparks ride.
  //   intro  → cloneOp 0 → 1, originals fade 1 → 0 → sparks fade out.
  //   dive   → cloneOp = 1, originals invisible → sparks fully off.
  //   landing → cloneOp snaps back to 0 → sparks ramp back in.
  // Exponential smoothing on the spark uOpacity (sparkBlend below) keeps
  // the on/off transitions soft, no perceptible snap at the landing swap.
  const fractalAnim = fractalActive && ctx.fractalState
    && ctx.fractalState.cloneOp > 0.01;
  const sparkFadeDur = (ANIM.timings && ANIM.timings.overlay && ANIM.timings.overlay.sparkFade) || 0.8;
  const sparkBlend = 1 - Math.exp(-dt / Math.max(sparkFadeDur, 1e-3));
  for (let i = 0; i < ctx.sparkSystems.length; i++) {
    const sys = ctx.sparkSystems[i];
    // Per-system host gating: a spark system rides only when the layer it
    // attaches to is visible. panel/lattice hosts ride in Visual Sequence
    // or Fractal Pattern; 'arch' rides only in fireplace modes. In Visual
    // Sequence they additionally fade out while the playAll overlay
    // window is open.
    const host = sys.host;
    let hostVisible = false;
    if (host === 'panel' || host === 'lattice') {
      hostVisible = (mode === 'visualSequence' || mode === 'fractalPattern');
    } else if (host === 'arch') {
      hostVisible = showFireplace;
    }
    let target = hostVisible ? 1 : 0;
    if (mode === 'visualSequence' && inOverlayWindow) target = 0;
    if ((host === 'panel' || host === 'lattice') && fractalAnim) target = 0;
    const u = sys.uOpacity;
    if (u) u.value += (target - u.value) * sparkBlend;
    sys.snapScale = snapScale;
    // Skip the spark physics step entirely once a system has fully faded
    // out — saves the per-spark Verlet integration + stroke-snap lookup
    // for the long stretches of the dive where they're invisible anyway.
    if (u && u.value < 0.005 && target === 0) continue;
    sys.update(dt);
  }

  updateLights(ctx.lights, t, scene);
}

// Live animate loop — real-time clock. `ctx.paused` lets the export
// subsystem take full control of render + timing without interleaving.
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  // __PROBE_PAUSED is set by the .verify probes via addInitScript so the
  // live loop never ticks before the probe takes control — otherwise the
  // variable number of real frames before page.evaluate runs consumes the
  // seeded RNG differently per run and breaks screenshot determinism.
  if (ctx.paused || window.__PROBE_PAUSED) {
    // Keep the clock baseline fresh so elapsedTime freezes during pause
    // and the first frame after resume reports a normal ~16ms delta.
    clock.oldTime = performance.now();
    return;
  }
  if (!projection.isActive()) controls.update();   // camera is locked in projection mode
  const dt = Math.min(clock.getDelta(), 0.05);   // cap stepping after tab-unhide
  const t = clock.elapsedTime;
  tick(t, dt);
  pipeline.render();
}
animate();

// Export bridge — lazy-loaded so mp4-muxer + export.js only download when
// the user triggers a capture.
//   Shift+E  →  4K  (3840×2160)
//   Shift+D  →  1080p (1920×1080)
// or call `startExport({ width, height })` from devtools for custom sizes.
export const __exportCtx = { ctx, scene, camera, renderer, controls, tick, pipeline };

async function runExport(opts) {
  const { startExport } = await import('./core/export.js');
  return startExport(__exportCtx, opts);
}

if (typeof window !== 'undefined') {
  window.startExport      = runExport;                                       // default 4K
  window.startExport1080p = () => runExport({ width: 1920, height: 1080 });
  window.__ctx = ctx;  // debug handle
  window.__pipeline = pipeline;
  // Deterministic driver for the .verify probes: with ctx.paused=true the
  // rAF loop idles, and a probe can step the scene manually via
  // __tick(t, dt) + __renderer.render(...) for reproducible screenshots.
  window.__tick = tick;
  window.addEventListener('keydown', (e) => {
    // Spacebar — fire the cascade sequence now (skip rest, begin exit
    // immediately). Auto-loop continues from this new phase. In arch
    // mode, also re-trigger the brick cascade so the user can rebuild
    // the arch on demand.
    if (e.code === 'Space' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      let handled = false;
      // Pattern mode (with fractal zoom enabled) gets its own trigger that
      // resets the loop to start a fresh zoom-in immediately. In every
      // other mode, fall through to the radial cascade trigger.
      const fractalEnabled = !(ANIM.fractalZoom && ANIM.fractalZoom.enabled === false);
      if (ANIM.viewMode === 'fractalPattern' && fractalEnabled
          && ctx.fractalState && ctx.fractalState.triggerZoom) {
        ctx.fractalState.triggerZoom(clock.elapsedTime);
        handled = true;
      } else if (ctx.cascadeState && ctx.cascadeState.triggerNow) {
        ctx.cascadeState.triggerNow(clock.elapsedTime);
        handled = true;
      }
      if ((ANIM.viewMode === 'fireplaceOne' || ANIM.viewMode === 'visualSequence') && ctx.triggerArchCascade) {
        ctx.triggerArchCascade(clock.elapsedTime);
        handled = true;
      }
      if (handled) e.preventDefault();
      return;
    }
    // Lowercase 'd' (no modifiers) — toggle the domino-flip loop on/off.
    // First press starts continuous waves; second press snaps bricks back
    // to rest.
    if (e.code === 'KeyD' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const on = toggleDominoes(scene, clock.elapsedTime);
      console.log(`[dominoes] ${on ? 'on' : 'off'}`);
      return;
    }
    // 'p' (no modifiers) — manually fire the constellation's stellar pulse
    // (inward shockwave + anchor convergence). Useful for tuning the
    // event without waiting for the random scheduler.
    if (e.code === 'KeyP' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (ctx.triggerStellarPulse) ctx.triggerStellarPulse();
      return;
    }
    // 'q' (no modifiers) — cycle quality preset HIGH → MED → LOW → HIGH.
    // Default is HIGH (identical to original visuals on every device).
    // Lowering opts the user into a smaller particle / spark / pixel-ratio
    // budget so the scene runs smoother on weaker hardware.
    if (e.code === 'KeyQ' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      cycleQuality(pipeline);
      return;
    }
    // 'b' (no modifiers) — toggle the bloom pass alone. Shift+B (below)
    // bypasses the whole composer for an exact-legacy A/B comparison.
    if (e.code === 'KeyB' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      ANIM.post.bloom.enabled = !ANIM.post.bloom.enabled;
      console.log(`[post] bloom ${ANIM.post.bloom.enabled ? 'on' : 'off'}`);
      return;
    }
    // 'c' (no modifiers) — cycle the calibration pattern (and jump into
    // calibration mode if not already there, so alignment is one key).
    if (e.code === 'KeyC' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (ANIM.viewMode !== 'calibration') ANIM.viewMode = 'calibration';
      if (calibration) console.log(`[calibration] pattern: ${calibration.cyclePattern()}`);
      return;
    }
    // Digit keys (no modifiers) switch ANIM.viewMode. 9 = calibration.
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const modeByKey = {
        Digit0: 'visualSequence', Digit1: 'fractalPattern', Digit2: 'hexagons',
        Digit3: 'flowers',         Digit4: 'fireplaceOne',   Digit5: 'fireplaceTwo',
        Digit6: 'flameOnly',       Digit9: 'calibration',
      };
      const next = modeByKey[e.code];
      if (next) {
        e.preventDefault();
        ANIM.viewMode = next;
        return;
      }
    }
    if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'E') runExport();
    else if (e.key === 'D') runExport({ width: 1920, height: 1080 });
    else if (e.key === 'P') projection.toggle();   // Shift+P — projection mode
    else if (e.key === 'B') {                      // Shift+B — composer on/off A-B
      ANIM.post.enabled = !ANIM.post.enabled;
      console.log(`[post] composer ${ANIM.post.enabled ? 'on' : 'off (legacy pipeline)'}`);
    }
  });
}
