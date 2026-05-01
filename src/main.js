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
import { addOverlay } from './3DOverlay.js';
import { addParticles, updateParticles } from './particles.js';
import { toggleDominoes, updateDominoes } from './dominoes.js';
import { tickShimmer } from './shaders/gold-shimmer.js';

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
  updateOverlay:      null,
  // Per-effect group handles. Keyed visibility (0–5 view modes) reads
  // these in tick() so the user can solo a single layer for tuning.
  panelGroup:         null,
  latticeGroup:       null,
  gateFrameGroup:     null,
  overlayFlowerRoots: [],
  overlayHexRoots:    [],
  overlayMaskMesh:    null,
  archGroup:          null,
  archCarvedGroup:    null,
  updateArchCarved:   null,
  updateArch:         null,
  triggerArchCascade: null,
  flameGroup:         null,
  updateFlame:        null,
  flameLights:        [],
  fireplaceGroup:     null,
  updateFireplace:    null,
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
};

// Low-passed flame brightness 0..1 — driven by the live PointLight stack
// in patterns/flame.js. Read by the galaxy uBrightness pulse so the
// starry backdrop breathes with the flame's broader envelope without
// strobing on every per-frame flicker spike.
let smoothedFlameEnv = 1.0;

loadLogo().then((logo) => {
  ctx.galaxyMat     = logo.galaxyMat;
  ctx.logoMaterials = logo.logoMaterials;

  const patternResult = addPatternLayers(logo.logoMesh, logo.meta, renderer);
  ctx.strokeTimeUniforms.push(...patternResult.strokeTimeUniforms);
  ctx.sparkSystems.push(...patternResult.sparkSystems);
  ctx.updateRowCascade   = patternResult.updateRowCascade;
  ctx.cascadeState       = patternResult.cascadeState;
  ctx.updateFractalZoom  = patternResult.updateFractalZoom;
  ctx.fractalState       = patternResult.fractalState;
  ctx.updateRotations    = patternResult.updateRotations;
  ctx.panelGroup         = patternResult.panelGroup;
  ctx.latticeGroup       = patternResult.latticeGroup;
  ctx.gateFrameGroup     = patternResult.gateFrameGroup;
  ctx.archGroup          = patternResult.archGroup;
  ctx.archCarvedGroup    = patternResult.archCarvedGroup;
  ctx.updateArchCarved   = patternResult.updateArchCarved;
  ctx.updateArch         = patternResult.updateArch;
  ctx.triggerArchCascade = patternResult.triggerArchCascade;
  ctx.flameGroup         = patternResult.flameGroup;
  ctx.updateFlame        = patternResult.updateFlame;
  ctx.flameLights        = patternResult.flameLights || [];
  ctx.fireplaceGroup     = patternResult.fireplaceGroup;
  ctx.updateFireplace    = patternResult.updateFireplace;
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

  // World matrices must be finalised before pattern fade shaders compute
  // their inverse-world matrices (so world-Y gradient conversions land in
  // panel-local coords correctly).
  scene.updateMatrixWorld(true);
  patternResult.patternsToRefresh.forEach(g => g.userData.refreshFade?.());
  overlayResult.patternsToRefresh.forEach(g => g.userData.refreshFade?.());

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
    ctx.galaxyMat.uniforms.uBrightness.value = targetBright * pulseMul;
  }

  if (ctx.particleMats) updateParticles(ctx.particleMats, t);

  // View-mode + master-toggle gating. The base scene (logo galaxy, gate
  // frame, particles, lights) stays on across every mode. Each effect
  // family is shown only in 'all' or its own solo mode.
  //   0 → 'all'        panel + lattice + flower-overlay
  //   1 → 'pattern'    panel + lattice underlay (front-pattern combo)
  //   2 → 'hex'        overlay BIG hex bricks only (entry/rotation/exit)
  //   3 → 'flowers'    full flower overlay (hex bricks → roses → bricks)
  //   4 → 'fireplace'  procedural-brick arch wrapping a volumetric flame
  //                    in the central cutout, against a starry-sky sky.
  // `ANIM.patterns.enabled === false` is the legacy kill switch — when
  // off, panel + lattice stay hidden regardless of view mode.
  const mode = ANIM.viewMode || 'all';
  const legacyPatterns = !(ANIM.patterns && ANIM.patterns.enabled === false);
  const showPanel     = legacyPatterns && (mode === 'all' || mode === 'pattern');
  const showLattice   = legacyPatterns && (mode === 'all' || mode === 'pattern');
  const showHexBrick  = (mode === 'all' || mode === 'hex');
  const showFlowers   = (mode === 'all' || mode === 'flowers');
  const showFireplace = (mode === 'fireplace');
  const showCarved    = (mode === 'carved');
  // Both fireplace + carved share the central flame, fireplace voussoir
  // ring, and the fade-to-black galaxy backdrop. They differ only in
  // which arch brick layer is shown — archGroup (fireplace) vs
  // archCarvedGroup (deeper-wall experimental version).
  const showFireOrCarved = showFireplace || showCarved;
  if (ctx.panelGroup)   ctx.panelGroup.visible   = showPanel;
  if (ctx.latticeGroup) ctx.latticeGroup.visible = showLattice;
  if (ctx.archGroup)    ctx.archGroup.visible    = showFireplace;
  if (ctx.archCarvedGroup) ctx.archCarvedGroup.visible = showCarved;
  if (ctx.flameGroup)   ctx.flameGroup.visible   = showFireOrCarved;
  if (ctx.fireplaceGroup) ctx.fireplaceGroup.visible = showFireOrCarved;
  // Hide the smooth extruded gate-frame ring when fireplace/carved mode
  // wants to own the perimeter look — set ANIM.arch.hideGateFrame in
  // config to drop the procedural frame so only the brick layers read.
  if (ctx.gateFrameGroup) {
    ctx.gateFrameGroup.visible = !(showFireOrCarved && ANIM.arch && ANIM.arch.hideGateFrame);
  }
  // Three.js checks light.visible directly when collecting scene lights —
  // hiding the parent group does NOT remove the light from the shader's
  // light list. Toggle each PointLight in the flame stack so they only
  // contribute to the inner cutout walls + arch bricks while fireplace
  // mode is active.
  if (ctx.flameLights) {
    for (let i = 0; i < ctx.flameLights.length; i++) {
      ctx.flameLights[i].visible = showFireOrCarved;
    }
  }
  // Hide the ember + white particle streams in fireplace/carved mode.
  // They emit from the inner-star outline and would visually clutter /
  // compete with the flame body in the same negative-space region.
  if (ctx.particleMats) {
    const showParticles = !showFireOrCarved;
    if (ctx.particleMats.emberPoints) ctx.particleMats.emberPoints.visible = showParticles;
    if (ctx.particleMats.whitePoints) ctx.particleMats.whitePoints.visible = showParticles;
  }
  // Strip the scene-wide PMREM env cubemap in fireplace/carved mode so
  // the grey ambient wash baked into every MeshStandardMaterial goes
  // away — without this, those materials read at ~constant brightness
  // regardless of light state, defeating the "only the flame
  // illuminates" goal.
  const stripEnv = showFireOrCarved
                && (ANIM.flame && ANIM.flame.stripEnvironment !== false);
  scene.environment = stripEnv ? null : baseEnvironment;
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
  if (ctx.logoMaterials) {
    const lb = ANIM.logoBase;
    const phase = (tBright / Math.max(lb.period, 1e-3)) * Math.PI * 2;
    const k01 = 0.5 + 0.5 * Math.sin(phase);
    const factor = lb.brightnessMin + (lb.brightnessMax - lb.brightnessMin) * k01;
    ctx.baseColorScratch.set(COLORS.logo.base).multiplyScalar(factor);
    // In fireplace mode, drop envMapIntensity heavily so the metallic
    // env reflection doesn't wash the body warm-grey on its own — the
    // flame's own point light should be the dominant illumination on
    // the logo body, with the body going dark between flicker peaks.
    const envI = (ANIM.viewMode === 'fireplace' || ANIM.viewMode === 'carved')
      ? ((ANIM.flame && ANIM.flame.envMapIntensity) ?? 0.08)
      : 1.0;
    for (let i = 0; i < ctx.logoMaterials.length; i++) {
      ctx.logoMaterials[i].color.copy(ctx.baseColorScratch);
      ctx.logoMaterials[i].envMapIntensity = envI;
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
  if (ctx.updateRotations)  ctx.updateRotations(t);
  const fractalActive = mode === 'pattern'
                     && ctx.updateFractalZoom
                     && !(ANIM.fractalZoom && ANIM.fractalZoom.enabled === false);
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
  if (ctx.updateArchCarved) ctx.updateArchCarved(t, dt);
  if (ctx.updateFireplace)  ctx.updateFireplace(t, dt);
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

  // Galaxy starry-night blend — lerps toward 1 in fireplace mode (black
  // sky + denser flickering stars behind the flame), toward 0 otherwise
  // (warm nebula). Eased exponentially using the configured fadeSpeed
  // (1/sec).
  if (ctx.galaxyMat && ctx.galaxyMat.uniforms.uStarryMode) {
    const targetStarry = (mode === 'fireplace' || mode === 'carved') ? 1.0 : 0.0;
    const fadeSpeed = (ANIM.flame && ANIM.flame.galaxyStarry && ANIM.flame.galaxyStarry.fadeSpeed) || 1.5;
    const blend = 1 - Math.exp(-fadeSpeed * dt);
    const u = ctx.galaxyMat.uniforms.uStarryMode;
    u.value += (targetStarry - u.value) * blend;
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
    // attaches to is visible. panel/lattice hosts ride in 'all' or 'pattern';
    // 'arch' rides only in fireplace mode. In 'all' mode they additionally
    // fade out while the playAll overlay window is open.
    const host = sys.host;
    let hostVisible = false;
    if (host === 'panel' || host === 'lattice') {
      hostVisible = (mode === 'all' || mode === 'pattern');
    } else if (host === 'arch') {
      hostVisible = (mode === 'fireplace' || mode === 'carved');
    }
    let target = hostVisible ? 1 : 0;
    if (mode === 'all' && inOverlayWindow) target = 0;
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
  window.__ctx = ctx;  // debug handle
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
      if (ANIM.viewMode === 'pattern' && fractalEnabled
          && ctx.fractalState && ctx.fractalState.triggerZoom) {
        ctx.fractalState.triggerZoom(clock.elapsedTime);
        handled = true;
      } else if (ctx.cascadeState && ctx.cascadeState.triggerNow) {
        ctx.cascadeState.triggerNow(clock.elapsedTime);
        handled = true;
      }
      if ((ANIM.viewMode === 'fireplace' || ANIM.viewMode === 'all') && ctx.triggerArchCascade) {
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
    // Digit keys 0–4 (no modifiers) switch ANIM.viewMode.
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const modeByKey = {
        Digit0: 'all', Digit1: 'pattern', Digit2: 'hex',
        Digit3: 'flowers', Digit4: 'fireplace', Digit5: 'carved',
      };
      const next = modeByKey[e.code];
      if (next) {
        e.preventDefault();
        ANIM.viewMode = next;
        console.log(`[viewMode] ${next}`);
        return;
      }
    }
    if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'E') runExport();
    else if (e.key === 'D') runExport({ width: 1920, height: 1080 });
  });
}
