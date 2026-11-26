// LAYER DIRECTOR — a different visual on each wood layer.
//
// The piece is made of stacked wood layers. This page shows the normal
// show on the whole piece, and at times it changes the upper layers to
// other visuals. Then it goes back to one visual on the whole piece.
//
// How it works
//   - The show runs three times, each in its own frame (same page as
//     index.html, nothing in it is changed):
//       slot 0  the STORY   plays THE SHOW as always (transitions, cues,
//                           keys, TouchDesigner control: all the same)
//       slot 1  ACCENT 1    one look, chosen to go with the story look
//       slot 2  ACCENT 2    one more look
//   - The file <shape>.layers.json gives the outline of each wood layer.
//   - Every frame, this page copies the three pictures and puts them
//     together: each layer shows the slot that the scene gives it.
//
// The wood layers ("zones"), bottom to top:
//     0 base plate   1 plate   2 line layer   3 plate   4 line layer
//
// Timing of one story step (dwell = the time of that look in THE SHOW):
//     one visual  ->  the upper layers change, from the centre outward
//     ->  hold  ->  the layers go back  ->  the story changes to its
//     next look with its normal transition.
//
// Settings: ANIM.layers in src/config.js (read live from the story frame).
// Keys:  L = layers on / off   O = wood lines on / off   J = mix now / stop

import { SHAPES, SHAPE_MENU } from '../../shapes/shapes.js';
import { drawZones, zonesFromJson } from './zones.js';

const q = new URLSearchParams(location.search);
const shapeName = q.get('shape') || '';
const W = parseInt(q.get('w') || '1280', 10) || 1280;
const H = parseInt(q.get('h') || '720', 10) || 720;
const SLOTS = 3, ZONES = 5;

// Used when ANIM.layers is missing (see src/config.js for the comments).
const DEFAULTS = {
  enabled: true,
  woodLines: true,
  mixStart: 0.22, mixStartMin: 6,
  mixEndBefore: 6.5,
  warmUp: 4,
  fade: 2.2,
  manualCycle: 32,
  patterns: [[0, 1, 2, 2, 1], [0, 0, 1, 2, 1], [0, 1, 1, 2, 2], [0, 2, 1, 1, 2]],
  accents: { default: ['moltenGold', 'strata'] },
};

const stage = document.getElementById('stage');
const hud = document.getElementById('hud');
stage.width = W; stage.height = H;
if (q.get('stats') === '1') hud.style.display = 'block';

function layout() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  stage.style.width = `${W * s}px`;
  stage.style.height = `${H * s}px`;
  stage.style.left = `${(window.innerWidth - W * s) / 2}px`;
  stage.style.top = `${(window.innerHeight - H * s) / 2}px`;
}
window.addEventListener('resize', layout);
layout();

// ---- the three shows ----------------------------------------------------
function childUrl(i) {
  const p = new URLSearchParams(location.search);
  p.set('proj', '1'); p.set('w', String(W)); p.set('h', String(H));
  p.delete('stats');
  if (i > 0) p.delete('ws');          // only the story talks to TouchDesigner
  p.set('slot', String(i));
  return `./index.html?${p.toString()}`;
}
const frames = [];
for (let i = 0; i < SLOTS; i++) {
  const f = document.createElement('iframe');
  f.style.width = `${W}px`; f.style.height = `${H}px`;
  f.src = childUrl(i);
  document.getElementById('slots').appendChild(f);
  frames.push(f);
}
const win = (i) => frames[i].contentWindow;
function ready(i) {
  try {
    const w = win(i);
    return !!(w && w.__ctx && w.__ctx.logoMaterials && w.__tick && w.__pipeline && w.__sequencer && w.__transitions);
  } catch { return false; }
}
const canvasOf = (i) => win(i).document.querySelector('canvas');

// ---- the wood layers ------------------------------------------------------
let zones = null;          // { box: [minx, miny, maxx, maxy], paths: [Path2D x layers], kinds }
(async () => {
  const entry = SHAPES[shapeName];
  const file = (entry && entry.file) || `${shapeName}.svg`;
  try {
    const res = await fetch(`./shapes/${file.replace(/\.svg$/i, '.layers.json')}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    zones = zonesFromJson(data);
  } catch (err) {
    console.warn(`[layers] no layer file for '${shapeName}' (${err.message}) - the plain show plays`);
  }
})();

const covA = document.createElement('canvas'); covA.width = W; covA.height = H;
const covB = document.createElement('canvas'); covB.width = W; covB.height = H;
const gA = covA.getContext('2d'), gB = covB.getContext('2d');
let lastFrame = null, zonesDrawn = false;

function drawAll(P) { drawZones(gA, gB, zones, P, W, H); zonesDrawn = true; }

// ---- the picture: WebGL ---------------------------------------------------
const gl = stage.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
const VS = 'attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
const FS = `precision highp float;
varying vec2 uv;
uniform sampler2D t0, t1, t2, cA, cB;
uniform vec3 w[5];
uniform float lines;
vec3 pick(vec3 k, vec3 a, vec3 b, vec3 c) { return a * k.x + b * k.y + c * k.z; }
void main() {
  vec3 a = texture2D(t0, uv).rgb, b = texture2D(t1, uv).rgb, c = texture2D(t2, uv).rgb;
  vec3 m = texture2D(cA, uv).rgb, x = texture2D(cB, uv).rgb;
  vec3 col = pick(w[0], a, b, c);
  col = mix(col, pick(w[1], a, b, c), m.r);
  col = mix(col, pick(w[2], a, b, c), m.g);
  col = mix(col, pick(w[3], a, b, c), m.b);
  col = mix(col, pick(w[4], a, b, c), x.r);
  col *= 1.0 - lines * 0.50 * x.g;                 // shadow under a wood step
  col += lines * 0.45 * x.b * col;                 // light on the edge of a wood step
  gl_FragColor = vec4(col, 1.0);
}`;
function shader(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog);
gl.useProgram(prog);
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, 'p');
gl.enableVertexAttribArray(loc);
gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
const tex = [];
['t0', 't1', 't2', 'cA', 'cB'].forEach((name, i) => {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + i);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  gl.uniform1i(gl.getUniformLocation(prog, name), i);
  tex.push(t);
});
const uW = gl.getUniformLocation(prog, 'w');
const uLines = gl.getUniformLocation(prog, 'lines');
gl.viewport(0, 0, W, H);
function upload(i, source) {
  gl.activeTexture(gl.TEXTURE0 + i);
  gl.bindTexture(gl.TEXTURE_2D, tex[i]);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
}

// ---- which slot is on which layer ------------------------------------------
const one = (s) => [s === 0 ? 1 : 0, s === 1 ? 1 : 0, s === 2 ? 1 : 0];
const fades = [];
for (let z = 0; z < ZONES; z++) fades.push({ from: one(0), to: one(0), t0: 0, dur: 0.001 });
const weights = new Float32Array(ZONES * 3);
const ease = (u) => u * u * (3 - 2 * u);
function weightsAt(now) {
  let busy = false;
  for (let z = 0; z < ZONES; z++) {
    const f = fades[z];
    const u = Math.min(Math.max((now - f.t0) / f.dur, 0), 1);
    if (u < 1) busy = true;
    const k = ease(u);
    for (let s = 0; s < 3; s++) weights[z * 3 + s] = f.from[s] + (f.to[s] - f.from[s]) * k;
  }
  return busy;
}
function fadeZone(z, slot, now, delay, dur) {
  const cur = [weights[z * 3], weights[z * 3 + 1], weights[z * 3 + 2]];
  fades[z] = { from: cur, to: one(slot), t0: now + delay, dur: Math.max(dur, 0.001) };
}

const state = {
  enabled: true,
  lines: true,
  plan: null,            // the timing of this story step
  step: 0,               // counts the story steps (picks the pattern)
  mixed: false,
  accentsOn: false,
  manualMode: null, manualT0: 0,
  force: null,           // 'mix' | 'unite' from key J
  fps: 60,
};
const cfgOf = () => { try { return { ...DEFAULTS, ...(win(0).ANIM.layers || {}) }; } catch { return DEFAULTS; } };

function setAccents(on, modes) {
  for (let i = 1; i < SLOTS; i++) {
    if (!ready(i)) continue;
    const w = win(i);
    if (on) {
      w.__ctx.paused = false;
      w.__sequencer.pause();
      if (modes && modes[i - 1]) w.__transitions.requestMode(modes[i - 1], 'cut');
    } else {
      w.__ctx.paused = true;
    }
  }
  state.accentsOn = on;
}

function mixIn(now, cfg) {
  const p = state.plan.pattern;
  const delay = { 4: 0, 3: 0.5, 2: 1.2, 1: 1.8, 0: 2.4 };          // from the centre outward
  for (let z = 0; z < ZONES; z++) fadeZone(z, p[z] || 0, now, delay[z], cfg.fade);
  state.mixed = true;
}
function mixOut(now, cfg, fast) {
  const delay = { 0: 0, 1: 0, 2: 0.4, 3: 0.9, 4: 1.4 };            // from the edge inward
  for (let z = 0; z < ZONES; z++) fadeZone(z, 0, now, fast ? 0 : delay[z], fast ? 0.8 : cfg.fade * 0.9);
  state.mixed = false;
}

function direct(now) {
  const s = win(0);
  const cfg = cfgOf();
  const seq = s.__sequencer.state();
  const mode = s.ANIM.viewMode;
  let key, dwell, e, storyMode;
  if (seq.playing && seq.mode) {
    const step = (s.ANIM.show.playlist || [])[seq.index] || {};
    key = `show:${seq.index}`; dwell = step.dwell ?? 30; e = seq.elapsed; storyMode = seq.mode;
    state.manualMode = null;
  } else {
    // THE SHOW is paused (a mode key was pressed): the same cycle, on a timer.
    if (mode !== state.manualMode) { state.manualMode = mode; state.manualT0 = now; }
    const n = Math.floor((now - state.manualT0) / cfg.manualCycle);
    key = `manual:${mode}:${n}`; dwell = cfg.manualCycle; e = (now - state.manualT0) - n * cfg.manualCycle; storyMode = mode;
  }
  if (!state.plan || state.plan.key !== key) {
    const acc = (cfg.accents[storyMode] || cfg.accents.default || DEFAULTS.accents.default).filter(m => m !== storyMode);
    while (acc.length < 2) acc.push(['moltenGold', 'strata', 'shards'].find(m => m !== storyMode && !acc.includes(m)));
    const inAt = Math.max(cfg.mixStartMin, cfg.mixStart * dwell);
    state.plan = {
      key, storyMode, dwell, accents: acc,
      pattern: cfg.patterns[state.step % cfg.patterns.length],
      warmAt: Math.max(inAt - cfg.warmUp, 0.5), inAt, outAt: dwell - cfg.mixEndBefore,
      warmed: false, done: false,
    };
    state.step++;
    state.force = null;
    if (state.mixed) mixOut(now, cfg, true);
  }
  const p = state.plan;
  const can = state.enabled && cfg.enabled !== false && zones && zonesDrawn && ready(1) && ready(2) && mode !== 'calibration';
  if (!can) {
    if (state.mixed) mixOut(now, cfg, true);
    return;
  }
  if (state.force === 'mix' && !state.mixed) {
    if (!p.warmed) { setAccents(true, p.accents); p.warmed = true; p.forceAt = now + 2.5; }
    if (now >= (p.forceAt || 0)) { mixIn(now, cfg); p.done = false; p.outAt = Infinity; state.force = null; }
    return;
  }
  if (state.force === 'unite') { if (state.mixed) mixOut(now, cfg, false); p.done = true; state.force = null; return; }
  if (p.outAt - p.inAt < 5) return;                       // the step is too short for a mix
  if (!p.warmed && e >= p.warmAt && e < p.outAt) { setAccents(true, p.accents); p.warmed = true; }
  if (p.warmed && !state.mixed && !p.done && e >= p.inAt && e < p.outAt) mixIn(now, cfg);
  if (state.mixed && e >= p.outAt) { mixOut(now, cfg, false); p.done = true; }
}

// ---- keys -----------------------------------------------------------------------
function ownKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
  if (e.code === 'KeyL') { state.enabled = !state.enabled; return true; }
  if (e.code === 'KeyO') { state.lines = !state.lines; return true; }
  if (e.code === 'KeyJ') { state.force = state.mixed ? 'unite' : 'mix'; return true; }
  return false;
}
let storyKeys = false;
function hookStoryKeys() {
  // Keys from TouchDesigner arrive in the story frame.
  win(0).addEventListener('keydown', (e) => { if (!e.__fromTop) ownKey(e); }, true);
  storyKeys = true;
}
window.addEventListener('keydown', (e) => {
  if (ownKey(e)) return;
  if (e.code === 'KeyG' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {      // next shape: this page changes
    const menu = (SHAPE_MENU || []).filter(n => SHAPES[n]);
    const names = menu.length ? menu : Object.keys(SHAPES);
    const i = names.indexOf(shapeName);
    const url = new URL(location.href);
    url.searchParams.set('shape', names[(i + 1) % names.length]);
    location.href = url.toString();
    return;
  }
  // Every other key goes to the story (H and K also to the accents).
  const all = (e.code === 'KeyH' || e.code === 'KeyK') ? [0, 1, 2] : [0];
  for (const i of all) {
    if (!ready(i)) continue;
    const w = win(i);
    const ev = new w.KeyboardEvent('keydown', { key: e.key, code: e.code, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, bubbles: true, cancelable: true });
    ev.__fromTop = true;
    w.dispatchEvent(ev);
  }
});

// ---- the loop -----------------------------------------------------------------------
let lastCompose = 0, frameCount = 0, fpsT0 = performance.now(), accentsParked = false, idleSince = 0;
function compose() {
  const now = performance.now() / 1000;
  lastCompose = now;
  if (!ready(0)) return;
  if (!storyKeys) hookStoryKeys();
  // Park the accents until they are needed (saves the graphics card).
  if (!accentsParked && ready(1) && ready(2)) { setAccents(false); for (let i = 1; i < SLOTS; i++) win(i).__sequencer.pause(); accentsParked = true; }

  // Where is the shape in the picture? (3 corners of its box, from the story.)
  if (zones && (frameCount % 30 === 0 || !zonesDrawn)) {
    const fr = win(0).__shapeMask && win(0).__shapeMask.frame ? win(0).__shapeMask.frame() : null;
    if (fr) {
      const P = fr.map(([x, y]) => [x * W, y * H]);
      const moved = !lastFrame || P.some((pt, i) => Math.abs(pt[0] - lastFrame[i][0]) + Math.abs(pt[1] - lastFrame[i][1]) > 0.25);
      if (moved) {
        drawAll(P); lastFrame = P;
        upload(3, covA); upload(4, covB);
      }
    }
  }

  direct(now);
  const busy = weightsAt(now);
  if (busy || state.mixed) idleSince = now;
  if (state.accentsOn && !state.mixed && !busy && now - idleSince > 1.0 && !(state.plan && state.plan.warmed && !state.plan.done)) setAccents(false);

  const tUp = performance.now();
  upload(0, canvasOf(0));
  for (let i = 1; i < SLOTS; i++) {
    let used = false;
    for (let z = 0; z < ZONES; z++) if (weights[z * 3 + i] > 0.001) used = true;
    if (used && ready(i) && !win(i).__ctx.paused) upload(i, canvasOf(i));
  }
  gl.uniform3fv(uW, weights);
  gl.uniform1f(uLines, (state.lines && cfgOf().woodLines !== false && win(0).ANIM.viewMode !== 'calibration') ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  prof.up += performance.now() - tUp; prof.all += performance.now() - now * 1000; prof.n++;
  if (snapWaiters.length) {                          // a picture of this frame (for tests)
    const url = stage.toDataURL('image/jpeg', 0.92);
    snapWaiters.splice(0).forEach(fn => fn(url));
  }

  frameCount++;
  const ms = performance.now();
  if (ms - fpsT0 >= 1000) {
    state.fps = Math.round((frameCount - frameCountAt) * 1000 / (ms - fpsT0) * 10) / 10;
    frameCountAt = frameCount; fpsT0 = ms;
    prof.top = prof.topN; prof.story = prof.storyN; prof.topN = 0; prof.storyN = 0;
    if (hud.style.display === 'block') {
      const p = state.plan;
      hud.textContent = `fps ${state.fps}  (page ${prof.top} story ${prof.story}  compose ${(prof.all / Math.max(prof.n, 1)).toFixed(1)} ms, copy+draw ${(prof.up / Math.max(prof.n, 1)).toFixed(1)} ms)  |  story ${p ? p.storyMode : '-'}  |  ${state.mixed ? `MIX ${p.accents.join(' + ')}  pattern ${p.pattern.join('')}` : 'one visual'}`
        + `  |  layers ${state.enabled ? 'on' : 'off'}  lines ${state.lines ? 'on' : 'off'}`;
    }
    prof.up = 0; prof.all = 0; prof.n = 0;
  }
}
let frameCountAt = 0;
const snapWaiters = [];
// Frame counters (shown with ?stats=1): this page, and the story frame.
const prof = { up: 0, all: 0, n: 0, top: 0, story: 0, topN: 0, storyN: 0 };
(function topLoop() { prof.topN++; requestAnimationFrame(topLoop); })();
frames[0].addEventListener('load', () => { const w = win(0); (function l() { prof.storyN++; w.requestAnimationFrame(l); })(); });

// The picture is put together right after the last frame has drawn, in
// the same screen refresh. So the three pictures are always fresh.
let chain = 0;
function startChain() {
  const id = ++chain;
  const w = win(SLOTS - 1);
  const loop = () => {
    if (id !== chain) return;
    w.requestAnimationFrame(loop);
    try { compose(); } catch (err) { console.error('[layers]', err); }
  };
  w.requestAnimationFrame(loop);
}
frames[SLOTS - 1].addEventListener('load', startChain);
// Safety: if that loop stops (a frame was reloaded), start it again.
setInterval(() => { if (performance.now() / 1000 - lastCompose > 1.5) startChain(); }, 1000);

window.__layers = {
  state: () => ({ fps: state.fps, enabled: state.enabled, lines: state.lines, mixed: state.mixed, accentsOn: state.accentsOn,
                  plan: state.plan && { ...state.plan }, ready: [0, 1, 2].map(ready), zones: !!zones, zonesDrawn, weights: Array.from(weights) }),
  mix: () => { state.force = 'mix'; },
  unite: () => { state.force = 'unite'; },
  setEnabled: (on) => { state.enabled = !!on; },
  setLines: (on) => { state.lines = !!on; },
  snap: () => new Promise(ok => snapWaiters.push(ok)),
  frames,
};
