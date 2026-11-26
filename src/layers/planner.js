// LAYER PLANNER — runs in the "story" page when the address has ?layers=1.
//
// TouchDesigner shows three copies of the show and mixes them, one per
// wood layer (touchdesigner/logo_layers.py). This file decides WHEN:
//   one visual on the whole piece  ->  the upper layers change to the two
//   accent looks, from the centre outward  ->  hold  ->  the layers go
//   back  ->  the story changes to its next look with its normal transition.
// It only sends short messages ("warm", "mix", "unite"). TouchDesigner
// does the fades.
//
// Settings: ANIM.layers in src/config.js.
// Keys:  L = layers on / off   O = wood lines on / off   J = mix now / stop

const DEFAULTS = {
  enabled: true, woodLines: true,
  mixStart: 0.22, mixStartMin: 6, mixEndBefore: 6.5, warmUp: 4, fade: 2.2, manualCycle: 32,
  patterns: [[0, 1, 2, 2, 1], [0, 0, 1, 2, 1], [0, 1, 1, 2, 2], [0, 2, 1, 1, 2]],
  accents: { default: ['moltenGold', 'strata'] },
};

export function startLayerPlanner({ ANIM, sequencer, sendEvent }) {
  const cfgOf = () => ({ ...DEFAULTS, ...(ANIM.layers || {}) });
  const state = {
    enabled: true,
    lines: cfgOf().woodLines !== false,
    plan: null, step: 0, mixed: false,
    manualMode: null, manualT0: 0,
    force: null,                      // 'mix' | 'unite' from key J
  };
  const send = (action, extra) => sendEvent('layers', { action, lines: state.lines, ...(extra || {}) });
  const mixIn = (cfg) => {            // from the centre outward
    send('mix', { pattern: state.plan.pattern, fade: cfg.fade, delays: [2.4, 1.8, 1.2, 0.5, 0] });
    state.mixed = true;
  };
  const mixOut = (cfg, fast) => {     // from the edge inward
    send('unite', fast ? { fade: 0.8, delays: [0, 0, 0, 0, 0] } : { fade: cfg.fade * 0.9, delays: [0, 0, 0.4, 0.9, 1.4] });
    state.mixed = false;
  };

  function update() {
    const now = performance.now() / 1000;
    const cfg = cfgOf();
    const seq = sequencer.state();
    const mode = ANIM.viewMode;
    let key, dwell, e, storyMode;
    if (seq.playing && seq.mode) {
      const step = ((ANIM.show && ANIM.show.playlist) || [])[seq.index] || {};
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
        warmed: false, done: false, forceAt: 0,
      };
      state.step++;
      state.force = null;
      if (state.mixed) mixOut(cfg, true);
    }
    const p = state.plan;
    const can = state.enabled && cfg.enabled !== false && mode !== 'calibration';
    if (!can) {
      if (state.mixed) mixOut(cfg, true);
      return;
    }
    if (state.force === 'mix' && !state.mixed) {
      if (!p.warmed) { send('warm', { modes: p.accents }); p.warmed = true; p.forceAt = now + 2.5; }
      if (now >= p.forceAt) { mixIn(cfg); p.done = false; p.outAt = Infinity; state.force = null; }
      return;
    }
    if (state.force === 'unite') { if (state.mixed) mixOut(cfg, false); p.done = true; state.force = null; return; }
    if (p.outAt - p.inAt < 5) return;                       // the step is too short for a mix
    if (!p.warmed && e >= p.warmAt && e < p.outAt) { send('warm', { modes: p.accents }); p.warmed = true; }
    if (p.warmed && !state.mixed && !p.done && e >= p.inAt && e < p.outAt) mixIn(cfg);
    if (state.mixed && e >= p.outAt) { mixOut(cfg, false); p.done = true; }
  }

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.code === 'KeyL') { state.enabled = !state.enabled; console.log(`[layers] ${state.enabled ? 'on' : 'off'}`); }
    else if (e.code === 'KeyO') { state.lines = !state.lines; send('lines'); }
    else if (e.code === 'KeyJ') { state.force = state.mixed ? 'unite' : 'mix'; }
  });

  send('hello');
  setInterval(update, 100);
  window.__layerPlanner = {
    state: () => ({ ...state, plan: state.plan && { ...state.plan } }),
    mix: () => { state.force = 'mix'; },
    unite: () => { state.force = 'unite'; },
    setEnabled: (on) => { state.enabled = !!on; },
  };
  console.log('[layers] planner on (TouchDesigner mixes the wood layers)');
}
