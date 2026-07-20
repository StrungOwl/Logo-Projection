// Fireplace-mode (key 5) choreographer — makes the hearth self-animating.
//
// User brief: "i don't want to press a key to make it animate. i want it
// to start still but over time it can animate ... use sin to ease that
// and please randomize it so it's not the same all the time."
//
// Behaviour:
//   * Watches ANIM.viewMode itself — dormant everywhere except
//     'fireplaceOne'; no main.js wiring beyond the per-frame call from
//     effects.js's updateFireplace hook.
//   * On mode entry the scene holds STILL (only the calm flame/light
//     breath) for a random ANIM.fireplaceChoreo.startDelay seconds.
//   * Then events fire on their own at random interval seconds apart,
//     alternating soft domino ring waves (forward tumble) with occasional
//     "cascade" events (fires the 'arch.cascade' trigger + a slow
//     in-screen pinwheel ripple across the bricks).
//   * Overall activity eases in on a sin ramp over rampDuration seconds
//     from the FIRST event: early events are single-epicenter, slow,
//     small-angle rocks; later ones are quicker, wider, occasionally a
//     full 360° spin wave.
//   * Every delay, event choice, and wave parameter is drawn from
//     Math.random at schedule time — no two visits play alike.
//
// Wave mechanics: writes ANIM.dominoFlip.soft (consumed live by
// fireplaceTwo/dominoAnim.js) then drives the existing trigger surface —
// 'domino.on' to start, 'domino.off' once the one-shot wave settles at
// rest — so main.js's dominoesOn bookkeeping stays in sync and the
// manual D key / spacebar continue to work. Externally-started waves
// (D key, show cues) are detected via isDominoWaveActive(); the
// choreographer defers and pushes its own schedule out past them.

import { ANIM } from '../../config.js';
import { fireTrigger } from '../../show/triggers.js';
import {
  isDominoWaveActive,
  isDominoWaveSettled,
} from '../fireplaceTwo/dominoAnim.js';

const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, u) => a + (b - a) * u;

let inMode      = false;
let firstEventT = 0;         // when the first event fires (ramp origin)
let nextEventT  = Infinity;  // next scheduled event
let waveMine    = false;     // we own the currently-running wave
let waveStartT  = 0;         // when our wave was fired (for the timeout)
let eventIndex  = 0;

// Devtools / probe visibility: window.__fireChoreo.{state,events,...}
const debug = { state: 'idle', nextEventT: 0, ramp: 0, events: [] };
if (typeof window !== 'undefined') window.__fireChoreo = debug;

function clearSoft() {
  if (ANIM.dominoFlip) ANIM.dominoFlip.soft = null;
}

export function updateFireplaceChoreo(t /*, dt */) {
  const cfg = ANIM.fireplaceChoreo;
  const active = ANIM.viewMode === 'fireplaceOne'
              && cfg && cfg.enabled !== false;

  if (!active) {
    if (inMode) {
      // Mode exit — stop any wave we own (the bricks are hidden in the
      // new mode, so the rest-snap is invisible) and hand the classic
      // config back to the manual D key.
      if (waveMine && isDominoWaveActive()) fireTrigger('domino.off', t);
      clearSoft();
      inMode = false; waveMine = false;
      debug.state = 'idle';
    }
    return;
  }

  if (!inMode) {
    // Mode entry — hold still, then stir. Randomized every visit.
    inMode = true; waveMine = false; eventIndex = 0;
    const [d0, d1] = cfg.startDelay || [8, 16];
    firstEventT = nextEventT = t + rand(d0, d1);
    debug.state = 'holding'; debug.events.length = 0;
    debug.nextEventT = nextEventT;
  }

  // Our one-shot wave settled back to rest → clean stop (no snap) and
  // release the soft params so a manual D wave gets the classic config.
  if (waveMine) {
    if (isDominoWaveSettled()
        || (!isDominoWaveActive() && t - waveStartT > 1)
        || t - waveStartT > 60) {
      fireTrigger('domino.off', t);
      clearSoft();
      waveMine = false;
      // Long waves can outlast the scheduled interval — guarantee a
      // stretch of stillness after every wave before the next stirs.
      const [i0] = cfg.interval || [15, 35];
      nextEventT = Math.max(nextEventT, t + Math.max(6, i0 * 0.5));
      debug.state = 'waiting';
      debug.nextEventT = nextEventT;
    }
    return;
  }

  // A wave we did NOT start (manual D key / show cue) is running — stay
  // out of the way and push our next event past it.
  if (isDominoWaveActive()) {
    const [i0] = cfg.interval || [15, 35];
    nextEventT = Math.max(nextEventT, t + i0);
    debug.nextEventT = nextEventT;
    return;
  }

  if (t < nextEventT) return;

  // ---- Fire an event ----------------------------------------------
  // Activity ramp: 0 at the first event, sin-easing to 1 over
  // rampDuration seconds. Early events are gentler and sparser.
  const rampDur = Math.max(1, cfg.rampDuration ?? 40);
  const u    = Math.min(1, Math.max(0, (t - firstEventT) / rampDur));
  const ramp = Math.sin(u * Math.PI / 2);
  debug.ramp = +ramp.toFixed(2);

  // First event is always a gentle ring wave; after that, roll for the
  // occasional cascade accent.
  const isCascade = eventIndex > 0 && Math.random() < (cfg.cascadeChance ?? 0.35);

  let soft;
  if (isCascade) {
    // "Cascade": the registered arch trigger (inner-arch brick fall when
    // that row is enabled) + a slow single-epicenter pinwheel ripple —
    // bricks twist in-screen and settle back, visually distinct from the
    // forward domino tumble.
    fireTrigger('arch.cascade', t);
    soft = {
      active: true, oneShot: true,
      epicenters:  1,
      ringWidth:   rand(4.0, 6.0),
      ringStagger: lerp(0.9, 0.5, ramp) * rand(0.85, 1.15),
      duration:    lerp(6.0, 4.5, ramp) * rand(0.9, 1.1),
      axis:        [0, 0, 1],
      rockAngle:   Math.PI * lerp(0.08, 0.22, ramp) * rand(0.9, 1.15),
    };
  } else {
    // Soft domino ring wave — forward tumble. Early: one epicenter, slow
    // ripple, small rock. Later: up to 3 epicenters, quicker, bigger —
    // and past ~60% ramp it sometimes graduates to the classic full
    // 360° spin (which returns to rest by construction).
    const fullSpin = ramp > 0.6 && Math.random() < 0.45;
    soft = {
      active: true, oneShot: true,
      epicenters:  Math.min(3, 1 + Math.floor(Math.random() * (1 + ramp * 2.2))),
      ringWidth:   rand(3.0, 4.5),
      ringStagger: lerp(0.85, 0.45, ramp) * rand(0.85, 1.15),
      duration:    lerp(5.5, 4.0, ramp) * rand(0.9, 1.1),
      axis:        [1, 0, 0],
      rockAngle:   fullSpin ? 0
                            : Math.PI * lerp(0.18, 0.45, ramp) * rand(0.85, 1.2),
    };
  }

  ANIM.dominoFlip.soft = soft;
  fireTrigger('domino.on', t);
  // Sync repair: if main.js's dominoesOn flag was left true by some
  // external path, 'domino.on' no-ops — force the toggle so the wave
  // really starts and the flag re-syncs.
  if (!isDominoWaveActive()) fireTrigger('domino.toggle', t);
  waveMine = true; waveStartT = t;

  // Schedule the next stirring — randomized, sparser while ramping in.
  const [i0, i1] = cfg.interval || [15, 35];
  nextEventT = t + rand(i0, i1) * lerp(1.35, 1.0, ramp);
  eventIndex++;
  debug.state = 'wave';
  debug.nextEventT = nextEventT;
  debug.events.push({
    t: +t.toFixed(1),
    type: isCascade ? 'cascade' : 'domino',
    ramp: +ramp.toFixed(2),
    spin: !isCascade && soft.rockAngle === 0,
  });
}
