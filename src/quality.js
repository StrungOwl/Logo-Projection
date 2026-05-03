// Quality presets and the live 'Q' key cycle.
//
// Default = HIGH = identical visuals to the original codebase. The toggle
// is opt-in: a viewer on a weaker machine still sees HIGH unless the user
// presses Q to lower it. Switching is live (no reload) — particle and
// spark systems pre-allocate at HIGH and just iterate fewer points per
// frame at MED / LOW.

export const QUALITY_PRESETS = {
  HIGH: { particles: 1.0,  sparks: 1.0,  pixelRatioMax: 2.0, trailLength: 1.0 },
  MED:  { particles: 0.6,  sparks: 0.6,  pixelRatioMax: 1.5, trailLength: 0.6 },
  LOW:  { particles: 0.35, sparks: 0.35, pixelRatioMax: 1.0, trailLength: 0.4 },
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

// Cycle HIGH → MED → LOW → HIGH. Updates the renderer's pixel ratio
// immediately; particle/spark systems read QUALITY.preset on every
// update tick so their iteration counts reflect the change next frame.
export function cycleQuality(renderer) {
  const idx = ORDER.indexOf(QUALITY.current);
  const next = ORDER[(idx + 1) % ORDER.length];
  QUALITY.current = next;
  QUALITY.preset = QUALITY_PRESETS[next];
  if (renderer) {
    const dpr = Math.min(window.devicePixelRatio || 1, QUALITY.preset.pixelRatioMax);
    renderer.setPixelRatio(dpr);
  }
  showToast(`Quality: ${next}`);
  return next;
}
