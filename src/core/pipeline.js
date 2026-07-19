// Render + size authority. The ONLY module allowed to call
// renderer.setSize / setPixelRatio (and, once post-processing lands,
// composer.setSize). Everything that used to fight over the canvas —
// the window resize listener, the quality cycle, video export, and the
// fixed-resolution projection mode — routes through here so exactly one
// sizing policy is active at a time.
//
// Mode stack:  window  →  projection  →  export
//   window      canvas tracks the browser window, DPR capped by quality
//   projection  fixed internal resolution (pixelRatio 1), CSS letterbox
//   export      fixed capture resolution; restores whichever mode was
//               active before (so export-from-projection round-trips)
//
// Point-sprite note: spark/stream shaders size points via a uPixelRatio
// uniform baked from the live canvas DPR. Any fixed-resolution mode must
// rescale that uniform (factor = outputHeight / window.innerHeight) or
// particles shrink to a fraction of their intended frame-relative size —
// same trick export.js has always used.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ANIM } from '../config.js';
import { QUALITY } from '../quality.js';

export function createPipeline({ renderer, scene, camera, ctx }) {
  const canvas = renderer.domElement;

  const state = {
    mode: 'window',            // 'window' | 'projection' | 'export'
    projW: 1920, projH: 1080,
    preExportMode: null,       // mode to restore after export
    spriteMats: [],            // materials whose uPixelRatio we rescaled
    savedSpriteRatios: [],
  };

  // ---- sprite uPixelRatio rescale (shared by projection + export) ------

  function collectSpriteMats() {
    return [
      ctx.particleMats?.emberMat,
      ctx.particleMats?.whiteMat,
      ...(ctx.sparkSystems ?? []).map(s => s?.points?.material),
    ].filter(m => m?.uniforms?.uPixelRatio);
  }

  function applySpriteScale(outputHeight) {
    restoreSpriteScale();   // never stack two rescales
    state.spriteMats = collectSpriteMats();
    state.savedSpriteRatios = state.spriteMats.map(m => m.uniforms.uPixelRatio.value);
    const factor = outputHeight / Math.max(window.innerHeight, 1);
    state.spriteMats.forEach(m => { m.uniforms.uPixelRatio.value = factor; });
  }

  function restoreSpriteScale() {
    state.spriteMats.forEach((m, i) => {
      m.uniforms.uPixelRatio.value = state.savedSpriteRatios[i];
    });
    state.spriteMats = [];
    state.savedSpriteRatios = [];
  }

  // ---- sizing per mode -------------------------------------------------

  function applyWindowSize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY.preset.pixelRatioMax));
    renderer.setSize(w, h);          // also resets canvas CSS to fill
    clearLetterbox();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    sizeComposer(w, h, renderer.getPixelRatio());
  }

  // Contain-fit the fixed-resolution canvas inside the window. setSize
  // with updateStyle=false leaves whatever CSS was there before, so the
  // letterbox has to be asserted explicitly every time.
  function layoutLetterbox(w, h) {
    const winW = window.innerWidth, winH = window.innerHeight;
    const s = Math.min(winW / w, winH / h);
    const cssW = Math.round(w * s), cssH = Math.round(h * s);
    Object.assign(canvas.style, {
      position: 'absolute',
      width:  cssW + 'px',
      height: cssH + 'px',
      left:   Math.round((winW - cssW) / 2) + 'px',
      top:    Math.round((winH - cssH) / 2) + 'px',
    });
  }

  function clearLetterbox() {
    canvas.style.position = '';
    canvas.style.left = '';
    canvas.style.top = '';
  }

  function applyProjectionSize() {
    const { projW: w, projH: h } = state;
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    layoutLetterbox(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    applySpriteScale(h);
    sizeComposer(w, h, 1);
  }

  // ---- post-processing composer ---------------------------------------
  // Chain: RenderPass → UnrealBloomPass → OutputPass (ACES + sRGB applied
  // once, at the end, to the whole frame — including the custom
  // ShaderMaterials that used to bypass tone mapping entirely; that
  // uniform treatment is the one deliberate look re-baseline of the
  // revamp, and ANIM.post.enabled=false remains a permanent exact-legacy
  // escape hatch).
  //
  // The composer's render target must be custom:
  //   - stencilBuffer: the overlay mask + fireplace tiles stencil-test
  //     (modes 0/2/3/4 silently break on the default stencil-less RT)
  //   - HalfFloatType: HDR headroom so additive stacks can exceed 1.0 and
  //     feed the bloom threshold meaningfully
  //   - samples: MSAA lives on the default framebuffer only; without
  //     samples the composer path would regress to aliased edges
  // Built lazily on the first post-enabled frame so the legacy path costs
  // nothing; rebuilt when the quality preset changes msaaSamples.
  let composer = null;
  let bloomPass = null;
  let builtSamples = -1;
  // Transition manager hook — bloom strength rides the dip envelope so
  // glow can't ghost through a fade-to-black (set via setEnvelopeSource).
  let envelopeFn = null;
  // Corner-pin warp (pipeline B) — a ShaderPass appended AFTER OutputPass
  // so it warps finished display-referred pixels. Registered before the
  // lazy composer build via setWarpPass. Note: the warp only applies on
  // the composer path (ANIM.post.enabled) — documented limitation.
  let warpPass = null;
  let warpWasEnabled = false;

  function buildComposer() {
    disposeComposer();
    const size = new THREE.Vector2();
    renderer.getDrawingBufferSize(size);
    const samples = QUALITY.preset.msaaSamples ?? 4;
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples,
      stencilBuffer: true,
    });
    composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(renderer.getPixelRatio());
    const css = new THREE.Vector2();
    renderer.getSize(css);
    composer.setSize(css.x, css.y);
    composer.addPass(new RenderPass(scene, camera));
    const b = ANIM.post?.bloom || {};
    bloomPass = new UnrealBloomPass(size.clone(), b.strength ?? 0.35, b.radius ?? 0.5, b.threshold ?? 1.0);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    if (warpPass) composer.addPass(warpPass);
    builtSamples = samples;
    applyBloomScale();
  }

  function disposeComposer() {
    if (!composer) return;
    composer.renderTarget1.dispose();
    composer.renderTarget2.dispose();
    for (const p of composer.passes) p.dispose?.();
    composer = null;
    bloomPass = null;
  }

  // Lower presets run the bloom pyramid at reduced resolution.
  function applyBloomScale() {
    if (!bloomPass) return;
    const scale = QUALITY.preset.bloomScale ?? 1.0;
    const size = new THREE.Vector2();
    renderer.getDrawingBufferSize(size);
    bloomPass.setSize(Math.round(size.x * scale), Math.round(size.y * scale));
  }

  // Live-sync pass settings from ANIM each frame (codebase convention —
  // devtools/remote writes take effect next frame).
  function syncPost() {
    const b = ANIM.post?.bloom || {};
    // Calibration patterns must render halo-free: alignment needs crisp
    // edges, and bloom around a white fill corrupts them.
    const calibrating = ANIM.viewMode === 'calibration';
    bloomPass.enabled = b.enabled !== false && !calibrating;
    const env = envelopeFn ? envelopeFn() : 1;
    bloomPass.strength   = (b.strength ?? 0.35) * env;
    bloomPass.radius     = b.radius ?? 0.5;
    bloomPass.threshold  = b.threshold ?? 1.0;
  }

  function sizeComposer(w, h, pixelRatio) {
    if (!composer) return;
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
    applyBloomScale();
  }

  // ---- public API ------------------------------------------------------

  const pipeline = {
    get mode() { return state.mode; },

    render() {
      if (ANIM.post?.enabled) {
        if (!composer) buildComposer();
        syncPost();
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
    },

    setEnvelopeSource(fn) { envelopeFn = fn; },

    setWarpPass(pass) {
      warpPass = pass;
      if (composer) composer.addPass(pass);
    },

    enterProjection(w, h) {
      if (state.mode === 'export') return;   // export owns the canvas right now
      if (w) state.projW = w;
      if (h) state.projH = h;
      state.mode = 'projection';
      applyProjectionSize();
    },

    exitProjection() {
      if (state.mode !== 'projection') return;
      restoreSpriteScale();
      state.mode = 'window';
      applyWindowSize();
    },

    enterExport(w, h) {
      state.preExportMode = state.mode;
      state.mode = 'export';
      // Exports are always unwarped — the warp is projector geometry, not
      // content. Restored on exit.
      if (warpPass) { warpWasEnabled = warpPass.enabled; warpPass.enabled = false; }
      renderer.setPixelRatio(1);
      renderer.setSize(w, h, false);   // CSS untouched: live canvas doubles as preview
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      applySpriteScale(h);
      sizeComposer(w, h, 1);
    },

    exitExport() {
      if (state.mode !== 'export') return;
      if (warpPass) warpPass.enabled = warpWasEnabled;
      restoreSpriteScale();
      state.mode = state.preExportMode || 'window';
      state.preExportMode = null;
      if (state.mode === 'projection') applyProjectionSize();
      else applyWindowSize();
    },

    // Quality cycle entry point — window mode re-applies the DPR cap;
    // fixed-resolution modes stay pixelRatio 1 but the composer reacts:
    // an msaaSamples change forces a rebuild (RT samples are baked at
    // creation), bloomScale just resizes the bloom pyramid.
    applyQuality() {
      if (state.mode === 'window') applyWindowSize();
      if (composer) {
        if ((QUALITY.preset.msaaSamples ?? 4) !== builtSamples) {
          buildComposer();
        } else {
          applyBloomScale();
        }
      }
    },

    getState() {
      return { mode: state.mode, width: canvas.width, height: canvas.height };
    },
  };

  window.addEventListener('resize', () => {
    if (state.mode === 'export') return;                    // export owns sizing
    if (state.mode === 'projection') layoutLetterbox(state.projW, state.projH);
    else applyWindowSize();
  });

  return pipeline;
}
