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
import { createWarp } from './core/warp.js';
import { toggleInfoOverlay } from './core/infoOverlay.js';
import { loadLogo } from './core/logo.js';
import { applyScreenDefaults } from './core/surface.js';
import { applyShapeDefaults, nextShapeUrl } from './core/shape.js';
import { createShapeMask } from './core/shapeMask.js';
import { addEffects } from './effects/effects.js';
import { addOverlay } from './effects/flowers/starFans.js';
import { SHADER_LOOK_MODES } from './effects/looks/shaderLooks.js';
import { addParticles, updateParticles } from './effects/_shared/streams.js';
import { toggleDominoes, updateDominoes } from './effects/fireplaceTwo/dominoAnim.js';
import { tickShimmer } from './shaders/gold-shimmer.js';
import { setAmberFlameEnv } from './shaders/amber-stone.js';
import { applyLogoStarry, tickLogoStarry } from './shaders/logo-starry.js';
import { cycleQuality, setQuality } from './quality.js';
import { registerTrigger, fireTrigger, listTriggers } from './show/triggers.js';
import { createTransitionManager } from './show/transitions.js';
import { createSequencer } from './show/sequencer.js';
import { initControl } from './core/control.js';

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
  // Per-effect group handles. Keyed visibility (modes 1–9) reads these
  // in tick() so the user can solo a single layer for tuning.
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

// Built-in corner-pin warp (pipeline B — no TouchDesigner). Final pass
// after OutputPass; 'W' opens the drag/nudge editor; persists per
// output-resolution in localStorage; remote via {"type":"warp",...}.
const warp = createWarp({ renderer });
pipeline.setWarpPass(warp.pass);

// Output mask for SVG shapes (src/core/shapeMask.js): keeps the light
// inside the exact outline. Off (no cost) until a shape attaches itself.
const shapeMask = createShapeMask({ camera });
pipeline.setMaskPass(shapeMask.pass);

// Show system: transition manager owns viewMode flips (dip/wipe/edgeFlash
// envelopes); the sequencer walks ANIM.show.playlist through it; the
// control dispatcher feeds both from TouchDesigner (WebSocket), the
// control.html panel (BroadcastChannel), and window.__control.
const transitions = createTransitionManager({ renderer, camera });
pipeline.setEnvelopeSource(transitions.envelope);
if (transitions.morphPass) pipeline.setMorphPass(transitions.morphPass);
const sequencer = createSequencer({ transitions, getTime: () => clock.elapsedTime });
const controlDeps = {
  getTime: () => clock.elapsedTime,
  transitions, sequencer, projection, warp,
  calibration: null,          // filled in after the logo loads
  setQuality: (name) => setQuality(name, pipeline),
};
const control = initControl(controlDeps);

// Dominoes toggle with explicit on/off tracking so the sequencer can cue
// 'domino.on' / 'domino.off' without knowing the current state.
let dominoesOn = false;
function setDominoes(on, t) {
  if (on === dominoesOn) return;
  dominoesOn = toggleDominoes(scene, t);
}

// Low-passed flame brightness 0..1 — driven by the live PointLight stack
// in src/effects/fireplaceOne/flame.js. Read by the galaxy uBrightness
// pulse so the starry backdrop breathes with the flame's broader envelope
// without strobing on every per-frame flicker spike.
let smoothedFlameEnv = 1.0;

// Logo starry blend 0..1 — driven by viewMode. Lerps toward 1 in
// flameOnly (key 7) so the starry shader fades onto the logo body,
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

// Gate-frame "fiery silhouette" override (key 7 flameOnly). Captures
// the frame's base gradient + color on first invocation so we can
// restore them on exit. Per-frame emissive pulse driven by
// smoothedFlameEnv lives in tick() (see flame envelope block below).
let gateFrameBase = null;
let gateLipBase = null, gateLipLevel = 0;   // gilded lip emissive (constellation trim)
const FIRE_GRAD_DARK   = [0.55, 0.04, 0.00];   // deep ember red
const FIRE_GRAD_BRIGHT = [1.00, 0.55, 0.12];   // hot yellow-orange tip
const FIRE_BASE_HEX    = 0x331100;             // dark molten diffuse
const FIRE_EMISSIVE    = 0xFF741A;             // glowing fire emissive
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
  if (logo.meta.isScreenSurface) applyScreenDefaults(ANIM);
  // SVG shape: per-shape ANIM values first (some are read at build time).
  if (logo.meta.isShapeSurface) applyShapeDefaults(ANIM, logo.meta.shape);
  // The glow light sits in the opening. On a shape the opening is not
  // always at the origin (an outline that is not symmetric).
  if (logo.meta.isShapeSurface && logo.meta.shape.center) {
    const c = logo.meta.shape.center;
    logo.logoMesh.updateWorldMatrix(true, false);
    const p = logo.logoMesh.localToWorld(new THREE.Vector3(c.x, c.y, 0));
    // A little below the centre of the opening, and never below its edge.
    let drop = 1.0;
    const hole = logo.meta.shape.hole;
    if (hole?.length) {
      const minY = Math.min(...hole.map(q => q.y));
      const low = logo.logoMesh.localToWorld(new THREE.Vector3(c.x, minY, 0));
      drop = Math.min(1.0, (p.y - low.y) * 0.35);
    }
    lights.innerGlow.position.x = p.x;
    lights.innerGlow.position.y = p.y - drop;
  }

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
  ctx.triggerStellarMeteor    = patternResult.triggerStellarMeteor;
  ctx.triggerStellarVortex    = patternResult.triggerStellarVortex;
  ctx.constellationVortexLevel = patternResult.constellationVortexLevel;
  ctx.hearthFlameGroup        = patternResult.hearthFlameGroup;
  ctx.updateHearthFlame       = patternResult.updateHearthFlame;
  ctx.hearthFlameLights       = patternResult.hearthFlameLights || [];
  ctx.getHearthFlameOpacity   = patternResult.getHearthFlameOpacity;
  ctx.silhouettePolygons = patternResult.silhouettePolygons;
  ctx.moltenGroup        = patternResult.moltenGroup;
  ctx.updateMolten       = patternResult.updateMolten;
  ctx.moltenTriggers     = patternResult.moltenTriggers;
  ctx.getMoltenFill      = patternResult.getMoltenFill;
  ctx.edgeChase          = patternResult.edgeChase;
  ctx.triggerPortalRush  = patternResult.triggerPortalRush;
  ctx.togglePortalFlow   = patternResult.togglePortalFlow;
  ctx.starDiveGroup      = patternResult.starDiveGroup;
  ctx.updateStarDive     = patternResult.updateStarDive;
  ctx.triggerDiveRush    = patternResult.triggerDiveRush;
  ctx.reverseDive        = patternResult.reverseDive;
  ctx.updateShaderLooks  = patternResult.updateShaderLooks;
  ctx.pulseShaderLook    = patternResult.pulseShaderLook;

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
  controlDeps.calibration = calibration;
  projection.setLogo(logo.logoMesh);
  scene.add(transitions.attachWipe(logo.logoMesh, logo.meta));
  transitions.attachMorph(logo.logoMesh, logo.meta);
  if (logo.meta.isShapeSurface) shapeMask.attach(logo.logoMesh, logo.meta);

  // Trigger registry — every control surface (keyboard, playlist cues,
  // TouchDesigner, control.html, window.__triggers) fires these by name.
  registerTrigger('cascade.now',   (t) => ctx.cascadeState?.triggerNow?.(t));
  registerTrigger('fractal.zoom',  (t) => ctx.fractalState?.triggerZoom?.(t));
  registerTrigger('arch.cascade',  (t) => ctx.triggerArchCascade?.(t));
  registerTrigger('domino.on',     (t) => setDominoes(true, t));
  registerTrigger('domino.off',    (t) => setDominoes(false, t));
  registerTrigger('domino.toggle', (t) => { dominoesOn = toggleDominoes(scene, t); });
  registerTrigger('stellar.pulse', ()  => ctx.triggerStellarPulse?.());
  registerTrigger('stellar.vortex', ()  => ctx.triggerStellarVortex?.());
  registerTrigger('stellar.meteor', (t, a) => ctx.triggerStellarMeteor?.(a && a.count ? a.count : 1));
  registerTrigger('quality.cycle', ()  => cycleQuality(pipeline));
  registerTrigger('edge.burst',    (t) => ctx.edgeChase?.burst(t));
  registerTrigger('portal.rush',   (t) => ctx.triggerPortalRush?.(t));
  registerTrigger('dive.rush',     (t) => ctx.triggerDiveRush?.(t));
  registerTrigger('dive.reverse',  ()  => ctx.reverseDive?.());
  registerTrigger('look.pulse',    ()  => ctx.pulseShaderLook?.());
  registerTrigger('portal.flow',   (t, a) => ctx.togglePortalFlow?.(a && typeof a.on === 'boolean' ? a.on : undefined));
  registerTrigger('molten.fill',     (t, a) => ctx.moltenTriggers?.fill(t, a));
  registerTrigger('molten.drain',    (t, a) => ctx.moltenTriggers?.drain(t, a));
  registerTrigger('molten.surge',    (t, a) => ctx.moltenTriggers?.surge(t, a));
  registerTrigger('molten.setLevel', (t, a) => ctx.moltenTriggers?.setLevel(t, a));

  frameLogo(camera, controls);
  // ?proj=1 boots straight into fixed-resolution projection framing.
  if (projection.bootRequested) projection.enable();
  // Installation duty: the show starts itself in projection boots (or
  // whenever autoStart is set) so nobody has to touch a keyboard.
  if ((projection.bootRequested && ANIM.show?.autoStartInProjection) || ANIM.show?.autoStart) {
    sequencer.play();
  }
  control.sendState();
}).catch(err => console.error('Failed to load logo:', err));

// Single per-frame update — called by both the live animate loop and the
// deterministic export loop. `t` is absolute seconds, `dt` is the step
// size for stateful systems (sparks) — the live loop passes real delta;
// the export loop passes a fixed 1/fps.
export // Roll the per-entry variation table for a mode. Each row is
// [dotted ANIM path, min, max]; the value must already exist in ANIM
// (rows that do not resolve are skipped, never created).
let lastVariedMode = null;
// Eased per-look body brightness trim (ANIM.looks.<mode>.body).
let lookBody = 1;
// Eased per-look nebula trim (ANIM.looks.<mode>.galaxy) - dims the warm
// plate inside the star; the black starry sky variant is left alone.
let lookGalaxy = 1;
function rollVariations(mode) {
  const table = ANIM.variations && ANIM.variations.enabled !== false
    ? ANIM.variations[mode] : null;
  if (!Array.isArray(table)) return;
  for (const [path, min, max] of table) {
    const keys = path.split('.');
    let node = ANIM;
    for (let i = 0; i < keys.length - 1 && node; i++) node = node[keys[i]];
    const leaf = keys[keys.length - 1];
    if (!node || typeof node[leaf] !== 'number') continue;
    node[leaf] = min + (max - min) * Math.random();
  }
}

function tick(t, dt) {
  // Show system first: transitions may flip ANIM.viewMode at a blackpoint
  // this frame (the gating below then reacts immediately); the sequencer
  // schedules those flips + fires playlist cues.
  transitions.update(t, dt);
  sequencer.update(t, dt);

  if (ctx.galaxyMat) {
    ctx.galaxyMat.uniforms.uTime.value       = t * ANIM.galaxy.timeScale;
    // Composer active → galaxy must emit linear (OutputPass re-encodes);
    // legacy direct render → display-referred as always (exact old look).
    if (ctx.galaxyMat.uniforms.uOutputLinear) {
      ctx.galaxyMat.uniforms.uOutputLinear.value = ANIM.post?.enabled ? 1 : 0;
    }
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
    let galaxyMul = 1 - galaxyFadeOut;
    // Portal mode: pure black void — the galaxy (both nebula and starry
    // variants) goes fully dark so only the corridor outlines exist.
    if ((ANIM.viewMode === 'fireplaceTwo' && !(ANIM.recede?.conveyor?.enabled === false))
        || ANIM.viewMode === 'starDive' || SHADER_LOOK_MODES.includes(ANIM.viewMode)) {
      galaxyMul = 0;
    }
    lookGalaxy += ((((ANIM.looks && ANIM.looks[ANIM.viewMode]) || {}).galaxy ?? 1) - lookGalaxy) * 0.06;
    ctx.galaxyMat.uniforms.uBrightness.value = targetBright * pulseMul * galaxyMul
      * (lookGalaxy + (1 - lookGalaxy) * galStarry);
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
  //   1 → 'moltenGold'      liquid-gold fill cycle
  //   2 → 'fractalPattern'  rosette + hex lattice (with fractal lens)
  //   3 → 'hexagons'        overlay BIG hex bricks only
  //   4 → 'flowers'         full flower overlay (hex → roses → hex)
  //   5 → 'fireplaceOne'    cascading brick arch + flame + starry sky
  //   6 → 'fireplaceTwo'    depth-portal corridor of receding outlines
  //   7 → 'flameOnly'       constellations + gilded frame
  //   8 → 'visualSequence'  rosette + hex lattice + flower overlay
  // `ANIM.patterns.enabled === false` is the legacy kill switch — when
  // off, panel + lattice stay hidden regardless of view mode.
  const mode = ANIM.viewMode || 'visualSequence';
  // GENERATIVE LOOKS: every time a mode is entered, roll its variation
  // table (ANIM.variations) — each visit gets its own speeds, curls,
  // spirals and depths, inside ranges that are known to look good.
  if (mode !== lastVariedMode) {
    lastVariedMode = mode;
    rollVariations(mode);
  }
  const legacyPatterns = !(ANIM.patterns && ANIM.patterns.enabled === false);
  const showPanel     = legacyPatterns && (mode === 'visualSequence' || mode === 'fractalPattern');
  const showLattice   = legacyPatterns && (mode === 'visualSequence' || mode === 'fractalPattern');
  const showHexBrick  = (mode === 'visualSequence' || mode === 'hexagons');
  const showFlowers   = (mode === 'visualSequence' || mode === 'flowers');
  const showFireplace = (mode === 'fireplaceOne');
  const showRecede    = (mode === 'fireplaceTwo');
  const showFlameOnly = (mode === 'flameOnly');
  const showMolten    = (mode === 'moltenGold');
  const showDive      = (mode === 'starDive');
  const showShaderLook = SHADER_LOOK_MODES.includes(mode);
  // Lerp logoStarryBlend toward 1 in flameOnly mode AND fireplaceTwo mode
  // (the receding-logo effect wants the same shimmering body), 0 elsewhere.
  // Slow fadeSpeed gives a few-second cross-fade between the galaxy plate
  // and the logo-body starry shader. The blend is split into two halves
  // (galaxy fades first, then logo stars come up) — see the galaxy
  // uBrightness block above for the front-half curve.
  {
    // NOTE: portal (showRecede+conveyor) deliberately excluded — that
    // mode wants a pure black void (no starfield, no body twinkle).
    const target = (showFlameOnly || (showRecede && ANIM.recede?.conveyor?.enabled === false) || showMolten) ? 1 : 0;
    const fadeSpeed = 0.15;
    const k = 1 - Math.exp(-fadeSpeed * dt);
    logoStarryBlend += (target - logoStarryBlend) * k;
    // Logo stars fade in only over the SECOND half of the blend so the
    // galaxy can fully disappear before the body's stars become visible.
    const logoStarsBlend = Math.max(0, (logoStarryBlend - 0.5) / 0.5);
    tickLogoStarry(t, logoStarsBlend);
  }
  // Flame stays lit in fireplaceOne (key 5) and, only when the legacy
  // static stack is active, fireplaceTwo (key 6). flameOnly (key 7) is the
  // constellation mode where the gate frame is recolored fiery.
  // Portal (conveyor) mode owns the whole frame: body black, flame off,
  // full-size corridor. Legacy static recede keeps the old flame + body.
  // Star Dive owns the frame the same way (black body, no depth writes),
  // but keeps the gilded gate frame as the fixed 'window' it falls through.
  const corridorActive = showRecede && !(ANIM.recede?.conveyor?.enabled === false);
  const portalActive = corridorActive || showDive || showShaderLook;
  const showFlame    = showFireplace
    || (showRecede && (!corridorActive || ANIM.recede?.flameEnabled === true));
  const fireLikeMode = showFlame || showFlameOnly || showMolten || showRecede || showDive || showShaderLook;
  if (ctx.panelGroup)   ctx.panelGroup.visible   = showPanel;
  if (ctx.latticeGroup) ctx.latticeGroup.visible = showLattice;
  if (ctx.archGroup)    ctx.archGroup.visible    = showFireplace;
  if (ctx.recedeGroup)  ctx.recedeGroup.visible  = showRecede;
  if (ctx.starDiveGroup) ctx.starDiveGroup.visible = showDive;
  if (ctx.flameGroup)   ctx.flameGroup.visible   = showFlame;
  if (ctx.gateRimGroup) ctx.gateRimGroup.visible = showFlameOnly;
  if (ctx.moltenGroup)  ctx.moltenGroup.visible  = showMolten;
  // Edge chase: idle comets only in the modes that own it; the mesh stays
  // live through burst decay in any mode (edgeFlash transitions), then
  // hides itself once every comet has faded.
  if (ctx.edgeChase) {
    ctx.edgeChase.setIdleEnabled(showFlameOnly);   // molten: no comets — they read as stray glints on the gold's edge
    ctx.edgeChase.setMaster(showMolten && ctx.getMoltenFill
      ? 0.35 + 0.65 * ctx.getMoltenFill()
      : (showFlameOnly ? (ANIM.constellation?.cometLevel ?? 1) : 1));
  }
  // fireplaceOne still wants the outer brick fireplace; fireplaceTwo doesn't.
  if (ctx.fireplaceGroup) ctx.fireplaceGroup.visible = showFireplace;
  // Hide the smooth extruded gate-frame ring when fireplaceOne wants to
  // own the perimeter look — set ANIM.arch.hideGateFrame in config to
  // drop the procedural frame so only the brick layers read. Recede mode
  // keeps the gate frame visible — it caps the receding silhouette nicely.
  if (ctx.gateFrameGroup) {
    // Portal and molten modes drop the frame entirely — the corridor's
    // receding outlines / the liquid surface ARE the structure there,
    // and the static gilded ring fought them.
    ctx.gateFrameGroup.visible = !corridorActive && !showMolten && !showShaderLook
      && !(ANIM.looks && ANIM.looks[mode] && ANIM.looks[mode].gate === false)
      && !(showFireplace && ANIM.arch && ANIM.arch.hideGateFrame);
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
    // The ember stream drifts to an attractor BEHIND the logo and shows as
    // faint specks outside the silhouette; looks can opt out (embers:false).
    const lookEmbers = !(ANIM.looks && ANIM.looks[mode] && ANIM.looks[mode].embers === false);
    if (ctx.particleMats.emberPoints) ctx.particleMats.emberPoints.visible = showParticles && lookEmbers;
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
  // The mask must not cut the full-frame calibration patterns.
  shapeMask.setSuspended(mode === 'calibration');

  // Portal mode: the body must not merely go black — its depth writes
  // would still occlude the full-size corridor behind it. Dropping
  // colorWrite+depthWrite makes it a pure transform parent (children —
  // frame, galaxy, effects — keep rendering) while the corridor shows
  // through the whole interior. Can't hide the mesh: effects are its
  // children and visible=false stops subtree traversal.
  if (ctx.logoMaterials) {
    for (let i = 0; i < ctx.logoMaterials.length; i++) {
      ctx.logoMaterials[i].colorWrite = !portalActive;
      ctx.logoMaterials[i].depthWrite = !portalActive;
    }
  }

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
    // flameOnly (key 7) forces the logo body to pure black so the
    // silhouette reads as a void framing the central flame. envI is
    // already at the fireplace-low value so any residual env reflection
    // is killed too. moltenGold (key 1) dims the body to a faint amber
    // (~15%) instead — "the emblem being filled" — so the liquid surface
    // reads against a barely-there vessel rather than a void.
    const blackBody = showFlameOnly || portalActive;
    // Per-look body trim: pattern modes sink the gold body toward black so
    // the tiles in front of it carry the picture (default 1 = unchanged).
    lookBody += ((((ANIM.looks && ANIM.looks[mode]) || {}).body ?? 1) - lookBody) * 0.06;
    const effectiveFactor = blackBody ? 0 : (showMolten ? factor * 0.15 : factor * lookBody);
    if (Math.abs(effectiveFactor - lastBrightness) > 1e-4 || envI !== lastEnvIntensity) {
      if (blackBody) ctx.baseColorScratch.setRGB(0, 0, 0);
      else           ctx.baseColorScratch.set(COLORS.logo.base).multiplyScalar(effectiveFactor);
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
  // fractalPattern (key 2) swaps the radial cascade out for the fractal
  // lens (central magnification + back-layer fractal copies). Both
  // updaters drive the same per-tile mesh.position/scale, so only one
  // can run at a time. The fractal updater self-cleans when viewMode
  // isn't 'fractalPattern' (parks tiles back at rest, fades back layers out).
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
  if (ctx.updateStarDive)   ctx.updateStarDive(t, dt);
  if (ctx.updateShaderLooks) ctx.updateShaderLooks(t, dt, mode);
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
  // Molten + edge chase stay warm every frame (cheap when hidden) so
  // entering their modes never pops a cold first frame. The chase mesh
  // shows itself whenever any comet is lit — including edge.burst flares
  // fired mid-transition in unrelated modes.
  if (ctx.updateMolten)     ctx.updateMolten(t, dt);
  if (ctx.edgeChase) {
    ctx.edgeChase.update(t, dt);
    ctx.edgeChase.mesh.visible = ctx.edgeChase.isActive();
  }

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
  // Drive the amber-stone bricks' internal glow with the same envelope.
  setAmberFlameEnv(smoothedFlameEnv);

  // In flameOnly mode (key 7), pulse the gate-frame's emissive intensity
  // with the smoothed flame envelope so the fiery silhouette breathes
  // with the fire flicker. The base color + gradient swap was applied
  // once on mode entry by applyGateFrameTint.
  if (showFlameOnly && ctx.gateFrameGroup && ctx.gateFrameGroup.userData) {
    const mat = ctx.gateFrameGroup.userData.frameMaterial;
    // The frame dims as the sky starts to turn (stellar.vortex), so the
    // spinning stars carry the hand-off to the portal.
    const vx = 1 - 0.8 * (ctx.constellationVortexLevel?.() ?? 0);
    if (mat) mat.emissiveIntensity = (0.45 + 0.6 * smoothedFlameEnv) * (ANIM.constellation?.frameGlow ?? 1) * vx;
  }
  // Constellations: ease the gilded lip's emissive down so its bloom does
  // not lift the night sky (or spill outside the silhouette); every other
  // mode keeps the authored value.
  {
    const lip = ctx.gateFrameGroup?.userData?.lipMaterial;
    if (lip && lip !== ctx.gateFrameGroup.userData.frameMaterial) {
      if (gateLipBase === null) gateLipBase = gateLipLevel = lip.emissiveIntensity;
      const target = gateLipBase * (showFlameOnly
        ? (ANIM.constellation?.frameLip ?? 1) * (1 - 0.8 * (ctx.constellationVortexLevel?.() ?? 0)) : 1);
      gateLipLevel += (target - gateLipLevel) * (1 - Math.exp(-dt / 0.5));
      if (Math.abs(target - gateLipLevel) < 1e-3) gateLipLevel = target;
      lip.emissiveIntensity = gateLipLevel;
    }
  }

  // Constellation overlay (key 7 only) — fade in after CONSTELLATION_DELAY
  // so the starry sky + frame can establish first. Constellation runs its
  // own internal clock for draw-in scheduling and stellar pulses; we just
  // drive opacity in/out and call its update.
  if (showFlameOnly) flameOnlyElapsed += dt;
  else               flameOnlyElapsed  = 0;
  const cTarget = showFlameOnly
    ? Math.max(0, Math.min(1, (flameOnlyElapsed - CONSTELLATION_DELAY) / CONSTELLATION_FADE_DUR))
    : 0;
  // A spinning sky (stellar.vortex) stays alive a few seconds into the
  // Depth Portal, so its star streaks sink into the portal's flow lines.
  const skyLingers = !showFlameOnly && showRecede && (ctx.constellationVortexLevel?.() ?? 0) > 0;
  const cBlend = 1 - Math.exp(-dt / (skyLingers ? (ANIM.constellation?.vortex?.linger ?? 1.8) : 0.4));
  constellationOpacity += (cTarget - constellationOpacity) * cBlend;
  if (ctx.constellationGroup) {
    const visible = constellationOpacity > 0.002;
    ctx.constellationGroup.visible = visible;
    if (ctx.setConstellationOpacity) ctx.setConstellationOpacity(constellationOpacity);
    if (visible && ctx.updateConstellation) ctx.updateConstellation(t, dt);
  }

  // Hearth flame — retired from the constellation mode by user request
  // ("just keep the constellations"): the wide fire beams competed with
  // the star figures. Re-enable via ANIM.hearthFlame.enabled = true.
  const hearthVisible = showFlameOnly && ANIM.hearthFlame?.enabled === true;
  if (ctx.hearthFlameGroup) ctx.hearthFlameGroup.visible = hearthVisible;
  if (ctx.hearthFlameLights) {
    for (let i = 0; i < ctx.hearthFlameLights.length; i++) {
      ctx.hearthFlameLights[i].visible = hearthVisible;
    }
  }
  if (ctx.updateHearthFlame && hearthVisible) ctx.updateHearthFlame(t, dt);

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
  // updateOverlay re-asserts its roots' visibility from its own morph
  // phase every frame (bricks during brick holds, the ghost/rosette side
  // during rose holds). Re-apply the per-mode gating AFTER it runs so a
  // layer this mode doesn't own can never leak back on. The leak wasn't
  // just visual: in fractalPattern the 1,152 morph-ghost petals (and in
  // the fire modes ~1,000 masked hex bricks) were issuing draw calls
  // while contributing nothing to the frame.
  if (!showFlowers) {
    for (let i = 0; i < ctx.overlayFlowerRoots.length; i++) {
      ctx.overlayFlowerRoots[i].visible = false;
    }
  }
  // 'flowers' solo mode also hides the brick wall: the rose petals + their
  // morph-ghost transit are the only things visible there.
  if (!showHexBrick || mode === 'flowers') {
    for (let i = 0; i < ctx.overlayHexRoots.length; i++) {
      ctx.overlayHexRoots[i].visible = false;
    }
  }
  if (ctx.overlayMaskMesh && !(showFlowers || showHexBrick)) {
    ctx.overlayMaskMesh.visible = false;
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
  window.__shapeMask = shapeMask;
  window.__transitions = transitions;
  window.__sequencer = sequencer;
  // Devtools trigger surface: __triggers.fire('cascade.now'), .list().
  window.__triggers = {
    fire: (name, args) => fireTrigger(name, clock.elapsedTime, args),
    list: listTriggers,
  };
  // Deterministic driver for the .verify probes: with ctx.paused=true the
  // rAF loop idles, and a probe can step the scene manually via
  // __tick(t, dt) + __renderer.render(...) for reproducible screenshots.
  window.__tick = tick;
  // LAYERS (?layers=1): this page is the "story" of a layered show. It
  // tells TouchDesigner when the upper wood layers change to the accent
  // looks (src/layers/planner.js, touchdesigner/logo_layers.py).
  if (new URLSearchParams(window.location.search).get('layers') === '1') {
    import('./layers/planner.js').then(m => m.startLayerPlanner({ ANIM, sequencer, sendEvent: control.sendEvent }));
  }
  window.addEventListener('keydown', (e) => {
    // Spacebar — fire the cascade sequence now (skip rest, begin exit
    // immediately). Auto-loop continues from this new phase. In arch
    // mode, also re-trigger the brick cascade so the user can rebuild
    // the arch on demand.
    if (e.code === 'Space' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      let handled = false;
      // Shader looks (W/E/R/T): Space sends a pulse of light.
      if (SHADER_LOOK_MODES.includes(ANIM.viewMode) && ctx.pulseShaderLook) {
        ctx.pulseShaderLook();
        e.preventDefault();
        return;
      }
      // Star Dive: Space is the rush — the fall accelerates.
      if (ANIM.viewMode === 'starDive' && ctx.triggerDiveRush) {
        ctx.triggerDiveRush(clock.elapsedTime);
        e.preventDefault();
        return;
      }
      // Depth Portal: Space is the rush — the corridor accelerates and
      // the particle flow surges.
      if (ANIM.viewMode === 'fireplaceTwo' && ctx.triggerPortalRush) {
        ctx.triggerPortalRush(clock.elapsedTime);
        e.preventDefault();
        return;
      }
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
      dominoesOn = toggleDominoes(scene, clock.elapsedTime);
      console.log(`[dominoes] ${dominoesOn ? 'on' : 'off'}`);
      return;
    }
    // The warp editor owns R / Tab / arrows while it is open (a key sent
    // from TouchDesigner lands on window itself, where the editor's
    // stopPropagation cannot shield this handler).
    if (warp.isEditing() && (e.code === 'KeyR' || e.code === 'Tab' || e.code.startsWith('Arrow'))) return;
    // Letter-row looks: Q = STAR DIVE (continuous fractal zoom),
    // W / R / T = the shader looks (E is free). 'x' reverses the dive.
    const lookByKey = { KeyQ: 'starDive', KeyW: 'mercury', KeyR: 'strata', KeyT: 'shards' };
    if (lookByKey[e.code] && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      sequencer.notifyManualInput();
      transitions.requestMode(lookByKey[e.code]);
      control.sendState();
      return;
    }
    if (e.code === 'KeyX' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (ctx.reverseDive) console.log(`[dive] ${ctx.reverseDive() > 0 ? 'falling in' : 'rising out'}`);
      return;
    }
    // 'f' — toggle the Depth Portal's particle flow (fades in / out).
    if (e.code === 'KeyF' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const on = ctx.togglePortalFlow ? ctx.togglePortalFlow() : false;
      console.log(`[portal] flow ${on ? 'on' : 'off'}`);
      return;
    }
    // 'g' — next SVG shape (shapes/shapes.js order, then the logo). The
    // page reloads on the new shape; the other URL parameters are kept.
    if (e.code === 'KeyG' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      window.location.href = nextShapeUrl();
      return;
    }
    // 'h' — SVG shapes: mask outline -> small holes dark -> off.
    if (e.code === 'KeyH' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (shapeMask.ready()) {
        const order = ['outline', 'holes', 'off'];
        const m = shapeMask.setMode(order[(order.indexOf(shapeMask.getMode()) + 1) % order.length]);
        console.log(`[shape] mask: ${m}`);
      }
      return;
    }
    // 'i' — toggle the on-screen controls card.
    if (e.code === 'KeyI' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      toggleInfoOverlay();
      return;
    }
    // 'w' — toggle the corner-pin warp calibration editor.
    if (e.code === 'KeyM' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      console.log(`[warp] editor ${warp.toggleEditor() ? 'on' : 'off'}`);
      return;
    }
    // 's' — play/pause the auto-show. 'n' — skip to the next playlist step.
    if (e.code === 'KeyS' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      console.log(`[show] ${sequencer.toggle() ? 'playing' : 'paused'}`);
      control.sendState();
      return;
    }
    if (e.code === 'KeyN' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      sequencer.play();
      sequencer.next();
      control.sendState();
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
    if (e.code === 'KeyK' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
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
    // Digit keys (no modifiers). 0 = THE SHOW: restart the curated full
    // sequence from the gold opening (it self-advances through every
    // visual with per-pair transitions). 1-8 = solo modes, 9 = calibration.
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.code === 'Digit0') {
        e.preventDefault();
        sequencer.goto(0);
        sequencer.play();
        control.sendState();
        return;
      }
      const modeByKey = {
        Digit1: 'moltenGold',   Digit2: 'fractalPattern', Digit3: 'hexagons',
        Digit4: 'flowers',      Digit5: 'fireplaceOne',   Digit6: 'fireplaceTwo',
        Digit7: 'flameOnly',    Digit8: 'visualSequence', Digit9: 'calibration',
      };
      const next = modeByKey[e.code];
      if (next) {
        e.preventDefault();
        // Manual mode keys pause the auto-show (it would yank the mode
        // right back) and go through the transition manager's envelope.
        sequencer.notifyManualInput();
        transitions.requestMode(next);
        control.sendState();
        return;
      }
    }
    if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'E') runExport();
    else if (e.key === 'D') runExport({ width: 1920, height: 1080 });
    else if (e.key === 'P') {                      // Shift+P — projection mode
      projection.toggle();
      warp.refresh();   // corners are stored per output resolution
    }
    else if (e.key === 'B') {                      // Shift+B — composer on/off A-B
      ANIM.post.enabled = !ANIM.post.enabled;
      console.log(`[post] composer ${ANIM.post.enabled ? 'on' : 'off (legacy pipeline)'}`);
    }
  });
}
