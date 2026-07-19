// Built-in corner-pin warp — pipeline B (no TouchDesigner). A true
// projective homography as the composer's final pass, after OutputPass,
// so it operates on finished display-referred pixels and has zero color-
// management interaction. One fullscreen pass, exact keystone, bilinear
// resample; outside the pinned quad renders black.
//
//   W        toggle the calibration editor (drag corners; Tab selects,
//            arrows nudge 1px, Shift+arrows 10px, Alt+arrows 0.1px)
//   remote   {type:'warp', enabled, corners:[[x,y]×4]} · {action:'reset'}
//
// Corners are stored in OUTPUT-pixel space (top-left origin, matching
// what you see on the projector), persisted per-resolution in
// localStorage. Homography math: Heckbert basis-to-points adjugate.

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { ANIM } from '../config.js';

// ---- 3×3 helpers (column-major arrays, like THREE.Matrix3.elements) ----

function adjugate(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  return [
    e * i - f * h, c * h - b * i, b * f - c * e,
    f * g - d * i, a * i - c * g, c * d - a * f,
    d * h - e * g, b * g - a * h, a * e - b * d,
  ];
}

function mul3(A, B) {
  const r = new Array(9).fill(0);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      r[col * 3 + row] =
        A[0 * 3 + row] * B[col * 3 + 0] +
        A[1 * 3 + row] * B[col * 3 + 1] +
        A[2 * 3 + row] * B[col * 3 + 2];
    }
  }
  return r;
}

// Basis→points: the unique (up to scale) matrix taking the projective
// basis e1,e2,e3,(1,1,1) to the four given 2D points.
function basisToPoints(p) {
  const m = [p[0].x, p[0].y, 1, p[1].x, p[1].y, 1, p[2].x, p[2].y, 1];
  const adj = adjugate(m);
  // v = adj * p4 gives the scale for each basis column.
  const [x, y, w] = [p[3].x, p[3].y, 1];
  const v = [
    adj[0] * x + adj[3] * y + adj[6] * w,
    adj[1] * x + adj[4] * y + adj[7] * w,
    adj[2] * x + adj[5] * y + adj[8] * w,
  ];
  return [
    m[0] * v[0], m[1] * v[0], m[2] * v[0],
    m[3] * v[1], m[4] * v[1], m[5] * v[1],
    m[6] * v[2], m[7] * v[2], m[8] * v[2],
  ];
}

// Homography mapping srcQuad → dstQuad (arrays of 4 {x,y}, same order).
function computeHomography(src, dst) {
  return mul3(basisToPoints(dst), adjugate(basisToPoints(src)));
}

const WarpShader = {
  name: 'CornerPinWarp',
  uniforms: {
    tDiffuse: { value: null },
    uHinv:    { value: new THREE.Matrix3() },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform mat3 uHinv;
    varying vec2 vUv;
    void main() {
      vec3 p = uHinv * vec3(vUv, 1.0);
      vec2 src = p.xy / p.z;
      if (src.x < 0.0 || src.x > 1.0 || src.y < 0.0 || src.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
      gl_FragColor = texture2D(tDiffuse, src);
    }
  `,
};

const LS_PREFIX = 'logoProjection.warp.v1:';

export function createWarp({ renderer }) {
  if (!ANIM.warp) ANIM.warp = { enabled: false, corners: null };

  const canvas = renderer.domElement;
  const pass = new ShaderPass(WarpShader);
  pass.enabled = false;

  let corners = null;      // [[x,y]×4] TL,TR,BR,BL in output-pixel space
  let editing = false;
  let selected = 0;
  let ui = null;

  function outputSize() {
    return { w: canvas.width, h: canvas.height };
  }

  function defaultCorners() {
    const { w, h } = outputSize();
    return [[0, 0], [w, 0], [w, h], [0, h]];
  }

  function lsKey() {
    const { w, h } = outputSize();
    return `${LS_PREFIX}${w}x${h}`;
  }

  // Output pixels (top-left origin) → GL uv (bottom-left origin).
  function toUv([x, y]) {
    const { w, h } = outputSize();
    return { x: x / w, y: 1 - y / h };
  }

  function updateHomography() {
    if (!corners) corners = loadStored() || defaultCorners();
    const srcQuad = [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 }];
    const dstQuad = corners.map(toUv);
    // Fragment needs OUTPUT uv → SOURCE uv, i.e. the inverse mapping.
    const H = computeHomography(srcQuad, dstQuad);
    pass.uniforms.uHinv.value.fromArray(adjugate(H));
    ANIM.warp.corners = corners;
  }

  function setEnabled(on) {
    ANIM.warp.enabled = !!on;
    pass.enabled = !!on;
    if (on) updateHomography();
    if (!on && editing) setEditing(false);
  }

  function reset() {
    corners = defaultCorners();
    try { localStorage.removeItem(lsKey()); } catch { /* private mode */ }
    updateHomography();
    if (editing) layoutHandles();
  }

  function persist() {
    try { localStorage.setItem(lsKey(), JSON.stringify(corners)); } catch { /* private mode */ }
  }

  function loadStored() {
    try {
      const raw = localStorage.getItem(lsKey());
      if (!raw) return null;
      const c = JSON.parse(raw);
      return Array.isArray(c) && c.length === 4 ? c : null;
    } catch { return null; }
  }

  // ---- calibration editor (DOM overlay over the letterboxed canvas) ----

  const LABELS = ['TL', 'TR', 'BR', 'BL'];

  function outputToScreen([x, y]) {
    const r = canvas.getBoundingClientRect();
    const { w, h } = outputSize();
    return [r.left + (x / w) * r.width, r.top + (y / h) * r.height];
  }

  function screenToOutput(cx, cy) {
    const r = canvas.getBoundingClientRect();
    const { w, h } = outputSize();
    return [((cx - r.left) / r.width) * w, ((cy - r.top) / r.height) * h];
  }

  function buildUi() {
    ui = document.createElement('div');
    ui.id = 'warp-editor';
    ui.style.cssText = 'position:fixed;inset:0;z-index:9000;pointer-events:none;';
    ui.innerHTML = `
      <svg style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none">
        <polygon fill="none" stroke="rgba(255,194,74,0.85)" stroke-width="1.5" stroke-dasharray="6 4"/>
      </svg>
      <div style="position:fixed;top:14px;left:50%;transform:translateX(-50%);
                  background:rgba(0,0,0,0.8);color:#ffd9a0;padding:8px 16px;border-radius:6px;
                  font:12px ui-monospace,monospace;border:1px solid rgba(255,194,74,0.4)">
        WARP EDIT — drag corners · Tab select · arrows nudge (Shift ×10, Alt ×0.1) · R reset · W done
      </div>`;
    for (let i = 0; i < 4; i++) {
      const hnd = document.createElement('div');
      hnd.dataset.corner = i;
      hnd.textContent = LABELS[i];
      hnd.style.cssText =
        'position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;' +
        'background:rgba(20,12,4,0.85);border:2px solid #FFC24A;color:#ffd9a0;cursor:grab;' +
        'display:flex;align-items:center;justify-content:center;font:9px ui-monospace,monospace;' +
        'pointer-events:auto;user-select:none;';
      hnd.addEventListener('pointerdown', (e) => {
        selected = i;
        highlight();
        const move = (ev) => {
          corners[i] = screenToOutput(ev.clientX, ev.clientY).map(v => Math.round(v * 10) / 10);
          updateHomography(); persist(); layoutHandles();
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        e.preventDefault();
      });
      ui.appendChild(hnd);
    }
    document.body.appendChild(ui);
    highlight();
    layoutHandles();
  }

  function highlight() {
    if (!ui) return;
    ui.querySelectorAll('[data-corner]').forEach((el, i) => {
      el.style.borderColor = i === selected ? '#FF5510' : '#FFC24A';
    });
  }

  function layoutHandles() {
    if (!ui) return;
    const pts = [];
    ui.querySelectorAll('[data-corner]').forEach((el, i) => {
      const [sx, sy] = outputToScreen(corners[i]);
      el.style.left = sx + 'px';
      el.style.top  = sy + 'px';
      pts.push(`${sx},${sy}`);
    });
    ui.querySelector('polygon').setAttribute('points', pts.join(' '));
  }

  function onEditorKey(e) {
    const stepPx = e.altKey ? 0.1 : e.shiftKey ? 10 : 1;
    const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.code];
    if (nudge) {
      corners[selected][0] += nudge[0] * stepPx;
      corners[selected][1] += nudge[1] * stepPx;
      updateHomography(); persist(); layoutHandles();
      e.preventDefault(); e.stopPropagation();
      return;
    }
    if (e.code === 'Tab') {
      selected = (selected + 1) % 4;
      highlight();
      e.preventDefault(); e.stopPropagation();
    } else if (e.code === 'KeyR' && !e.shiftKey) {
      reset();
      e.preventDefault(); e.stopPropagation();
    }
  }

  function setEditing(on) {
    editing = !!on;
    if (editing) {
      if (!ANIM.warp.enabled) setEnabled(true);
      if (!ui) buildUi();
      ui.style.display = '';
      layoutHandles();
      // Capture phase so editor nudge keys win over app shortcuts.
      window.addEventListener('keydown', onEditorKey, true);
      window.addEventListener('resize', layoutHandles);
    } else {
      if (ui) ui.style.display = 'none';
      window.removeEventListener('keydown', onEditorKey, true);
      window.removeEventListener('resize', layoutHandles);
    }
  }

  return {
    pass,
    toggleEditor() { setEditing(!editing); return editing; },
    isEditing: () => editing,
    setEnabled,
    reset,
    // Re-derive on output-resolution changes (projection enter/exit).
    refresh() {
      corners = loadStored() || defaultCorners();
      if (ANIM.warp.enabled) updateHomography();
      if (editing) layoutHandles();
    },
    handleMessage(msg) {
      if (msg.action === 'reset') { reset(); return; }
      if (Array.isArray(msg.corners) && msg.corners.length === 4) {
        corners = msg.corners.map(c => [Number(c[0]), Number(c[1])]);
        persist(); updateHomography();
        if (editing) layoutHandles();
      }
      if (typeof msg.enabled === 'boolean') setEnabled(msg.enabled);
    },
  };
}
