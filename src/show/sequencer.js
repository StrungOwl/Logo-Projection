// Auto-show sequencer — walks ANIM.show.playlist unattended: request each
// step's mode through the transition manager, hold for `dwell` seconds,
// fire cue triggers along the way, advance, loop. Built for installation
// duty (default-on in projection mode), paused the moment the operator
// touches a mode key so live editing never fights the playlist.
//
// Playlist step shape (see ANIM.show in config.js):
//   { mode, dwell, transition?, cues?: [{ at, trigger, every?, args? }] }
// Cue `at` counts from the moment the step's transition-in completes;
// `every` re-fires the trigger on that period for the rest of the dwell.

import { ANIM } from '../config.js';
import { fireTrigger } from './triggers.js';

export function createSequencer({ transitions, getTime }) {
  const st = {
    playing: false,
    index: -1,
    elapsed: 0,          // dwell clock, runs only after transition-in
    entered: false,      // has the step's transition finished yet?
    cueState: [],        // per-cue { fired, lastFireAt } for current step
  };

  const playlist = () => (ANIM.show && ANIM.show.playlist) || [];

  function startStep(i, styleOverride) {
    const list = playlist();
    if (!list.length) { st.playing = false; return; }
    st.index = ((i % list.length) + list.length) % list.length;
    const step = list[st.index];
    st.elapsed = 0;
    st.entered = false;
    st.cueState = (step.cues || []).map(() => ({ fired: false, lastFireAt: 0 }));
    transitions.requestMode(
      step.mode,
      styleOverride || step.transition || (ANIM.show && ANIM.show.defaultTransition),
    );
  }

  function play()  { if (!st.playing) { st.playing = true; if (st.index < 0) startStep(0); } }
  function pause() { st.playing = false; }
  function next()  { startStep(st.index + 1); }
  function prev()  { startStep(st.index - 1); }

  function goto(target) {
    const list = playlist();
    const i = typeof target === 'number'
      ? target
      : list.findIndex(s => s.mode === target);
    if (i >= 0 && i < list.length) startStep(i);
  }

  // Called by main.js when the operator presses a mode key or fires a
  // manual trigger — the show yields instead of yanking modes back.
  function notifyManualInput() {
    if (st.playing && ANIM.show && ANIM.show.pauseOnManualInput !== false) {
      st.playing = false;
      console.log('[show] paused (manual input)');
    }
  }

  function update(t, dt) {
    if (!st.playing || st.index < 0) return;
    const step = playlist()[st.index];
    if (!step) { st.playing = false; return; }

    if (!st.entered) {
      if (transitions.isTransitioning()) return;   // dwell starts after fade-in
      st.entered = true;
    }
    st.elapsed += dt;

    const cues = step.cues || [];
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      const cs = st.cueState[i];
      if (!cs.fired) {
        if (st.elapsed >= (cue.at ?? 0)) {
          fireTrigger(cue.trigger, t, cue.args);
          cs.fired = true;
          cs.lastFireAt = st.elapsed;
        }
      } else if (cue.every > 0 && st.elapsed >= cs.lastFireAt + cue.every) {
        fireTrigger(cue.trigger, t, cue.args);
        cs.lastFireAt = st.elapsed;
      }
    }

    if (st.elapsed >= (step.dwell ?? 30)) next();
  }

  return {
    play, pause, next, prev, goto, update, notifyManualInput,
    toggle() { st.playing ? pause() : play(); return st.playing; },
    state() {
      const step = playlist()[st.index];
      return {
        playing: st.playing,
        index: st.index,
        mode: step ? step.mode : null,
        elapsed: Math.round(st.elapsed * 10) / 10,
      };
    },
  };
}
