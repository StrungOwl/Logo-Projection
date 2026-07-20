// 'I' — on-screen help card listing every control. Pure DOM (never in
// the WebGL frame, so captures/exports stay clean unless deliberately
// opened), styled to match the piece. Toggle with I or Escape.

const ROWS = [
  ['MODES', ''],
  ['0', 'Visual Sequence — rosettes + hex lattice cascade'],
  ['1', 'Molten Gold — liquid gold fills the A'],
  ['2', 'Fractal Pattern — infinite lens dive'],
  ['3', 'Hexagons — pulsing morphing hex wall'],
  ['4', 'Flowers — petal pattern morphs'],
  ['5', 'Fireplace — amber arch, flame, corona'],
  ['6', 'Depth Portal — infinite outline tunnel'],
  ['7', 'Constellations — star figures in the void'],
  ['9', 'Calibration patterns (C cycles them)'],
  ['SHOW', ''],
  ['S / N', 'auto-show play–pause / next step'],
  ['Space', 'fire the cascade / fractal zoom now'],
  ['D', 'domino brick waves (fireplace)'],
  ['P', 'stellar pulse (constellations)'],
  ['LOOK', ''],
  ['B / Shift+B', 'bloom on–off / whole post pipeline A-B'],
  ['Q', 'quality preset HIGH → MED → LOW'],
  ['PROJECTION', ''],
  ['Shift+P', 'fixed-resolution projection mode'],
  ['W', 'corner-pin warp editor (drag corners)'],
  ['Shift+E / Shift+D', 'export 4K / 1080p video'],
  ['I', 'toggle this help'],
];

let el = null;

function build() {
  el = document.createElement('div');
  el.id = 'info-overlay';
  el.style.cssText = [
    'position:fixed', 'top:50%', 'left:50%',
    'transform:translate(-50%,-50%)',
    'background:rgba(10,7,3,0.92)', 'color:#ffd9a0',
    'border:1px solid rgba(255,194,74,0.45)', 'border-radius:12px',
    'padding:22px 30px', 'z-index:9500',
    'font:13px/1.7 ui-monospace,Menlo,Consolas,monospace',
    'box-shadow:0 8px 60px rgba(0,0,0,0.8)',
    'max-height:86vh', 'overflow-y:auto', 'pointer-events:auto',
  ].join(';');
  const rows = ROWS.map(([k, v]) => v === ''
    ? `<div style="margin:10px 0 2px;color:#8a7a5e;font-size:10px;letter-spacing:0.18em">${k}</div>`
    : `<div style="display:flex;gap:14px"><span style="color:#ffc24a;min-width:120px">${k}</span><span>${v}</span></div>`
  ).join('');
  el.innerHTML =
    `<div style="color:#ffc24a;font-size:15px;margin-bottom:4px">LOGO PROJECTION — CONTROLS</div>${rows}`;
  el.style.display = 'none';   // built hidden; toggle() flips it on
  document.body.appendChild(el);
}

export function toggleInfoOverlay(force) {
  if (!el) build();
  const show = force !== undefined ? force : el.style.display === 'none';
  el.style.display = show ? '' : 'none';
  return show;
}

export function isInfoOverlayOpen() {
  return !!el && el.style.display !== 'none';
}
