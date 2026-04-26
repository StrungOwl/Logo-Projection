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
  updateArch:         null,
  triggerArchCascade: null,
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
  ctx.updateRowCascade   = patternResult.updateRowCascade;
  ctx.cascadeState       = patternResult.cascadeState;
  ctx.updateRotations    = patternResult.updateRotations;
  ctx.panelGroup         = patternResult.panelGroup;
  ctx.latticeGroup       = patternResult.latticeGroup;
  ctx.gateFrameGroup     = patternResult.gateFrameGroup;
  ctx.archGroup          = patternResult.archGroup;
  ctx.updateArch         = patternResult.updateArch;
  ctx.triggerArchCascade = patternResult.triggerArchCascade;

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
    ctx.galaxyMat.uniforms.uBrightness.value = ANIM.galaxy.brightness;
  }

  if (ctx.particleMats) updateParticles(ctx.particleMats, t);

  // View-mode + master-toggle gating. The base scene (logo galaxy, gate
  // frame, particles, lights) stays on across every mode. Each effect
  // family is shown only in 'all' or its own solo mode.
  //   0 → 'all'      panel + lattice + flower-overlay (NO arch)
  //   1 → 'pattern'  panel + lattice underlay (front-pattern combo)
  //   2 → 'hex'      overlay BIG hex bricks only (entry/rotation/exit)
  //   3 → 'flowers'  full flower overlay (hex bricks → roses → bricks)
  //   4 → 'arch'     procedural-brick arch
  //   5 → 'flame'    placeholder, hides all effect layers
  // `ANIM.patterns.enabled === false` is the legacy kill switch — when
  // off, panel + lattice stay hidden regardless of view mode.
  const mode = ANIM.viewMode || 'all';
  const legacyPatterns = !(ANIM.patterns && ANIM.patterns.enabled === false);
  const showPanel    = legacyPatterns && (mode === 'all' || mode === 'pattern');
  const showLattice  = legacyPatterns && (mode === 'all' || mode === 'pattern');
  const showHexBrick = (mode === 'all' || mode === 'hex');
  const showFlowers  = (mode === 'all' || mode === 'flowers');
  const showArch     = (mode === 'arch');
  if (ctx.panelGroup)   ctx.panelGroup.visible   = showPanel;
  if (ctx.latticeGroup) ctx.latticeGroup.visible = showLattice;
  if (ctx.archGroup)    ctx.archGroup.visible    = showArch;
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

  // Row cascade runs BEFORE both overlay and sparks: the overlay reads
  // cascadeState.playAllT to gate its brick↔petals morph to the all-at-
  // center window, and sparks read cascadeState.active for snap strength.
  if (ctx.updateRotations)  ctx.updateRotations(t);
  if (ctx.updateRowCascade) ctx.updateRowCascade(t, dt);
  if (ctx.updateOverlay)    ctx.updateOverlay(t);
  if (ctx.updateArch)       ctx.updateArch(t, dt);
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
  const sparkFadeDur = (ANIM.timings && ANIM.timings.overlay && ANIM.timings.overlay.sparkFade) || 0.8;
  const sparkBlend = 1 - Math.exp(-dt / Math.max(sparkFadeDur, 1e-3));
  for (let i = 0; i < ctx.sparkSystems.length; i++) {
    const sys = ctx.sparkSystems[i];
    // Per-system host gating: a spark system rides only when the layer it
    // attaches to is visible. panel/lattice hosts ride in 'all' or 'pattern';
    // 'arch' rides only in arch mode. In 'all' mode they additionally fade
    // out while the playAll overlay window is open.
    const host = sys.host;
    let hostVisible = false;
    if (host === 'panel' || host === 'lattice') {
      hostVisible = (mode === 'all' || mode === 'pattern');
    } else if (host === 'arch') {
      hostVisible = (mode === 'arch');
    }
    let target = hostVisible ? 1 : 0;
    if (mode === 'all' && inOverlayWindow) target = 0;
    const u = sys.uOpacity;
    if (u) u.value += (target - u.value) * sparkBlend;
    sys.snapScale = snapScale;
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
      if (ctx.cascadeState && ctx.cascadeState.triggerNow) {
        ctx.cascadeState.triggerNow(clock.elapsedTime);
        handled = true;
      }
      if ((ANIM.viewMode === 'arch' || ANIM.viewMode === 'all') && ctx.triggerArchCascade) {
        ctx.triggerArchCascade(clock.elapsedTime);
        handled = true;
      }
      if (handled) e.preventDefault();
      return;
    }
    // Digit keys 0–5 (no modifiers) switch ANIM.viewMode.
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const modeByKey = {
        Digit0: 'all', Digit1: 'pattern', Digit2: 'hex',
        Digit3: 'flowers', Digit4: 'arch', Digit5: 'flame',
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
