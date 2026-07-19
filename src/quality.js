// Quality presets and the live 'Q' key cycle.
//
// Default = HIGH = identical visuals to the original codebase. The toggle
// is opt-in: a viewer on a weaker machine still sees HIGH unless the user
// presses Q to lower it. Switching is live (no reload) — particle and
// spark systems pre-allocate at HIGH and just iterate fewer points per
// frame at MED / LOW.

// msaaSamples sizes the post-processing composer's render target (0 = no
// MSAA — accepts aliasing for framerate); bloomScale shrinks the bloom
// pass's internal resolution on lower presets. Both read by
// src/core/pipeline.js when the composer is active.
export const QUALITY_PRESETS = {
  HIGH: { particles: 1.0,  sparks: 1.0,  pixelRatioMax: 2.0, trailLength: 1.0, msaaSamples: 4, bloomScale: 1.0 },
  MED:  { particles: 0.6,  sparks: 0.6,  pixelRatioMax: 1.5, trailLength: 0.6, msaaSamples: 2, bloomScale: 0.7 },
  LOW:  { particles: 0.35, sparks: 0.35, pixelRatioMax: 1.0, trailLength: 0.4, msaaSamples: 0, bloomScale: 0.5 },
};

const ORDER = ['HIGH', 'MED', 'LOW'];

export const QUALITY = {
  current: 'HIGH',
  preset: QUALITY_PRESETS.HIGH,
};

let toastEl = null;
let toastTimer = null;

function showToast(text) {
  if (typeof document === 'undefined') return;
  // Projection mode suppresses all DOM chrome — nothing may pollute the
  // projector / capture feed (flag set by src/core/projection.js).
  if (window.__SUPPRESS_TOASTS) return;
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.style.cssText = [
      'position:fixed', 'top:20px', 'left:50%',
      'transform:translateX(-50%)',
      'padding:10px 22px', 'background:rgba(0,0,0,0.75)',
      'color:#ffd28a', 'font:600 14px Arial,sans-serif',
      'border:1px solid rgba(255,180,90,0.4)', 'border-radius:6px',
      'pointer-events:none', 'z-index:9999',
      'transition:opacity 0.3s', 'opacity:0',
    ].join(';');
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  toastEl.style.opacity = '1';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, 1800);
}

// Set a preset by name. `sizer` is either the pipeline (preferred — it
// owns renderer sizing + composer settings) or a bare renderer (legacy
// path, pixel ratio only). Particle/spark systems read QUALITY.preset on
// every update tick so their iteration counts reflect the change next
// frame.
export function setQuality(name, sizer) {
  if (!QUALITY_PRESETS[name]) return QUALITY.current;
  QUALITY.current = name;
  QUALITY.preset = QUALITY_PRESETS[name];
  if (sizer?.applyQuality) {
    sizer.applyQuality();
  } else if (sizer?.setPixelRatio) {
    const dpr = Math.min(window.devicePixelRatio || 1, QUALITY.preset.pixelRatioMax);
    sizer.setPixelRatio(dpr);
  }
  showToast(`Quality: ${name}`);
  return name;
}

// Cycle HIGH → MED → LOW → HIGH.
export function cycleQuality(sizer) {
  const idx = ORDER.indexOf(QUALITY.current);
  return setQuality(ORDER[(idx + 1) % ORDER.length], sizer);
}
