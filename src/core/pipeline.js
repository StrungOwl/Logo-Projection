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

  // Composer hook — no-op until Phase 4 attaches one via setComposer().
  let composer = null;
  function sizeComposer(w, h, pixelRatio) {
    if (!composer) return;
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
  }

  // ---- public API ------------------------------------------------------

  const pipeline = {
    get mode() { return state.mode; },

    render() {
      // Phase 4 swaps in: composer.render() when ANIM.post.enabled.
      renderer.render(scene, camera);
    },

    setComposer(c) { composer = c; },

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
      renderer.setPixelRatio(1);
      renderer.setSize(w, h, false);   // CSS untouched: live canvas doubles as preview
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      applySpriteScale(h);
      sizeComposer(w, h, 1);
    },

    exitExport() {
      if (state.mode !== 'export') return;
      restoreSpriteScale();
      state.mode = state.preExportMode || 'window';
      state.preExportMode = null;
      if (state.mode === 'projection') applyProjectionSize();
      else applyWindowSize();
    },

    // Quality cycle entry point — window mode re-applies the DPR cap;
    // fixed-resolution modes are always pixelRatio 1 so only the (future)
    // composer settings react there.
    applyQuality() {
      if (state.mode === 'window') applyWindowSize();
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
