// Remote-control dispatcher — one handleMessage() fed by three transports:
//   1. WebSocket client (ws-client.js) — TouchDesigner's WebSocket DAT is
//      the server; enabled via ?ws=HOST:PORT or ANIM.control.wsUrl.
//   2. BroadcastChannel 'logo-projection-control' — control.html in a
//      second window of the same browser, zero dependencies.
//   3. window.__control(msg) — devtools, or TouchDesigner's Web Render
//      TOP executejavascript (keyboard is dead inside that TOP; this
//      route covers every control).
//
// Inbound message shapes (JSON, one object per message):
//   { type:'ping' }
//   { type:'mode',        value:'fireplaceOne', style?:'dip' }
//   { type:'trigger',     name:'cascade.now', args?:{...} }
//   { type:'param',       path:'flame.light.intensityMax', value:4.5 }
//   { type:'calibration', pattern:'grid' }
//   { type:'projection',  enabled:true, width?:1920, height?:1080 }
//   { type:'quality',     value:'HIGH'|'MED'|'LOW' }
//   { type:'show',        action:'play'|'pause'|'toggle'|'next'|'prev'|'goto'|'state', target?:idx|mode }
//   { type:'warp',        ... }   // forwarded to the warp module (Phase 9)
//   { type:'key',         key:'1', shift?:false }   // press a keyboard key
//       remotely. `key` is a TouchDesigner Keyboard In name ('a', '1',
//       'space', 'left', 'tab', 'esc'…) or a DOM code ('KeyA', 'Digit1').
//       Runs the SAME handler as a real key press, so every keyboard
//       control works from TouchDesigner with no per-key wiring.
// Outbound: {type:'pong'} · {type:'state', ...} · {type:'event', name, t}
//           {type:'ack', ok, for, error?}
//
// `param` writes are deliberately conservative: the dotted path must
// already exist in ANIM and hold a primitive (or array of numbers) — the
// channel can tune knobs but can never create structure.

import { ANIM } from '../config.js';
import { fireTrigger, listTriggers } from '../show/triggers.js';
import { initWsClient } from './ws-client.js';

const CHANNEL_NAME = 'logo-projection-control';

export function initControl(deps) {
  // deps: { getTime, transitions, sequencer, calibration, projection,
  //         setQuality, getStateExtras?, warp? (late-bound via setWarp) }
  const transports = [];   // { send(obj) }

  function broadcast(obj) {
    for (const tr of transports) {
      try { tr.send(obj); } catch { /* transport gone — reconnect handles it */ }
    }
  }

  function stateMsg() {
    return {
      type: 'state',
      mode: ANIM.viewMode,
      calibration: ANIM.calibration?.pattern ?? 'off',
      projection: { enabled: !!deps.projection?.isActive() },
      show: deps.sequencer ? deps.sequencer.state() : null,
      post: ANIM.post ? { enabled: !!ANIM.post.enabled, bloom: !!ANIM.post.bloom?.enabled } : null,
      warp: ANIM.warp ? { enabled: !!ANIM.warp.enabled } : null,
      triggers: listTriggers(),
      ...(deps.getStateExtras ? deps.getStateExtras() : {}),
    };
  }

  const sendState = () => broadcast(stateMsg());
  // A mode change lands only after its transition (dip / wipe), so the
  // state sent at request time still names the OLD mode. Send it again
  // once the transition has had time to finish.
  let lateTimer = null;
  const sendStateLate = () => {
    clearTimeout(lateTimer);
    lateTimer = setTimeout(sendState, 2500);
  };
  const sendEvent = (name, extra) =>
    broadcast({ type: 'event', name, t: deps.getTime(), ...(extra || {}) });

  // Type-checked dotted-path write into ANIM. Existing keys only.
  function writeParam(path, value) {
    const keys = String(path).split('.');
    let node = ANIM;
    for (let i = 0; i < keys.length - 1; i++) {
      node = node?.[keys[i]];
      if (node === undefined || node === null || typeof node !== 'object') {
        return `unknown path segment '${keys[i]}'`;
      }
    }
    const leaf = keys[keys.length - 1];
    if (!(leaf in node)) return `unknown key '${leaf}'`;
    const cur = node[leaf];
    const okCur = ['number', 'string', 'boolean'].includes(typeof cur)
      || (Array.isArray(cur) && cur.every(v => typeof v === 'number'));
    const okNew = typeof value === typeof cur
      && (!Array.isArray(cur) || (Array.isArray(value) && value.every(v => typeof v === 'number')));
    if (!okCur) return `'${path}' is not a tunable value`;
    if (!okNew) return `type mismatch for '${path}'`;
    node[leaf] = value;
    return null;
  }

  // Remote key press → a synthetic keydown on window, so the one keyboard
  // handler in main.js (and the warp editor's) stays the single source
  // of truth for what each key does.
  const KEY_NAMES = {
    space: ['Space', ' '], tab: ['Tab', 'Tab'], enter: ['Enter', 'Enter'],
    esc: ['Escape', 'Escape'], escape: ['Escape', 'Escape'],
    left: ['ArrowLeft', 'ArrowLeft'], right: ['ArrowRight', 'ArrowRight'],
    up: ['ArrowUp', 'ArrowUp'], down: ['ArrowDown', 'ArrowDown'],
    arrowleft: ['ArrowLeft', 'ArrowLeft'], arrowright: ['ArrowRight', 'ArrowRight'],
    arrowup: ['ArrowUp', 'ArrowUp'], arrowdown: ['ArrowDown', 'ArrowDown'],
  };
  function pressKey(msg) {
    const raw = String(msg.key ?? msg.code ?? '');
    if (!raw) return 'missing key';
    const shift = !!msg.shift;
    let code, key;
    const lower = raw.toLowerCase();
    if (/^Key[A-Z]$/.test(raw))        { code = raw; key = raw.slice(3); key = shift ? key : key.toLowerCase(); }
    else if (/^Digit[0-9]$/.test(raw)) { code = raw; key = raw.slice(5); }
    else if (/^[a-z]$/i.test(raw))     { code = 'Key' + raw.toUpperCase(); key = shift ? raw.toUpperCase() : lower; }
    else if (/^[0-9]$/.test(raw))      { code = 'Digit' + raw; key = raw; }
    else if (/^Numpad[0-9]$/.test(raw)) { key = raw.slice(6); code = 'Digit' + key; }
    else if (KEY_NAMES[lower])         { [code, key] = KEY_NAMES[lower]; }
    else if (raw === ' ')              { code = 'Space'; key = ' '; }
    else return `unknown key '${raw}'`;
    window.dispatchEvent(new KeyboardEvent('keydown', {
      code, key, shiftKey: shift, ctrlKey: !!msg.ctrl, altKey: !!msg.alt,
      bubbles: true, cancelable: true,
    }));
    return null;
  }

  function handleMessage(msg, replyFn) {
    const reply = (obj) => { if (replyFn) replyFn(obj); else broadcast(obj); };
    if (!msg || typeof msg !== 'object' || !msg.type) {
      return reply({ type: 'ack', ok: false, for: '?', error: 'malformed message' });
    }
    const t = deps.getTime();
    switch (msg.type) {
      case 'ping':
        return reply({ type: 'pong' });
      case 'mode':
        deps.transitions.requestMode(msg.value, msg.style);
        deps.sequencer?.notifyManualInput();
        reply({ type: 'ack', ok: true, for: 'mode' });
        sendStateLate();
        return sendState();
      case 'trigger': {
        const ok = fireTrigger(msg.name, t, msg.args);
        if (ok) sendEvent(`trigger:${msg.name}`);
        return reply(ok
          ? { type: 'ack', ok: true, for: 'trigger' }
          : { type: 'ack', ok: false, for: 'trigger', error: `unknown trigger '${msg.name}'` });
      }
      case 'param': {
        const err = writeParam(msg.path, msg.value);
        return reply(err
          ? { type: 'ack', ok: false, for: 'param', error: err }
          : { type: 'ack', ok: true, for: 'param' });
      }
      case 'calibration':
        deps.calibration?.setPattern(msg.pattern);
        reply({ type: 'ack', ok: true, for: 'calibration' });
        return sendState();
      case 'projection':
        if (msg.enabled) deps.projection?.enable({ width: msg.width, height: msg.height });
        else deps.projection?.disable();
        reply({ type: 'ack', ok: true, for: 'projection' });
        return sendState();
      case 'quality':
        deps.setQuality?.(msg.value);
        reply({ type: 'ack', ok: true, for: 'quality' });
        return sendState();
      case 'show': {
        const s = deps.sequencer;
        if (!s) return reply({ type: 'ack', ok: false, for: 'show', error: 'no sequencer' });
        const act = msg.action;
        if      (act === 'play')   s.play();
        else if (act === 'pause')  s.pause();
        else if (act === 'toggle') s.toggle();
        else if (act === 'next')   s.next();
        else if (act === 'prev')   s.prev();
        else if (act === 'goto')   s.goto(msg.target);
        else if (act !== 'state')  return reply({ type: 'ack', ok: false, for: 'show', error: `unknown action '${act}'` });
        reply({ type: 'ack', ok: true, for: 'show' });
        return sendState();
      }
      case 'key': {
        const err = pressKey(msg);
        reply(err
          ? { type: 'ack', ok: false, for: 'key', error: err }
          : { type: 'ack', ok: true, for: 'key' });
        if (err) return undefined;
        sendStateLate();
        return sendState();
      }
      case 'warp':
        if (!deps.warp) return reply({ type: 'ack', ok: false, for: 'warp', error: 'warp not available' });
        deps.warp.handleMessage(msg);
        reply({ type: 'ack', ok: true, for: 'warp' });
        return sendState();
      default:
        return reply({ type: 'ack', ok: false, for: msg.type, error: `unknown type '${msg.type}'` });
    }
  }

  // ---- transports ------------------------------------------------------

  // BroadcastChannel (control.html) — same browser only.
  if (typeof BroadcastChannel !== 'undefined') {
    const bc = new BroadcastChannel(CHANNEL_NAME);
    bc.onmessage = (e) => handleMessage(e.data, (obj) => bc.postMessage(obj));
    transports.push({ send: (obj) => bc.postMessage(obj) });
  }

  // WebSocket (TouchDesigner is the server).
  const params = new URLSearchParams(window.location.search);
  const wsTarget = params.get('ws') || (ANIM.control && ANIM.control.wsUrl);
  if (wsTarget) {
    const ws = initWsClient({
      url: wsTarget.startsWith('ws') ? wsTarget : `ws://${wsTarget}`,
      onMessage: (msg) => handleMessage(msg, (obj) => ws.send(obj)),
      onOpen: () => ws.send(stateMsg()),
    });
    transports.push({ send: (obj) => ws.send(obj) });
  }

  // Devtools / Web Render TOP escape hatch.
  window.__control = (msg) => handleMessage(msg, (obj) => console.log('[control]', obj));

  return {
    handleMessage,
    sendState,
    sendEvent,
    setWarp(w) { deps.warp = w; },
  };
}
