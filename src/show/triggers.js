// Trigger registry — the single namespace every control surface fires
// through: keyboard handlers, the auto-show sequencer, the remote-control
// channel (TouchDesigner / control.html), and devtools (window.__triggers).
//
// Names are dotted verbs: 'cascade.now', 'domino.toggle', 'molten.fill'.
// Effects register their triggers at wiring time in main.js; new effects
// only need registerTrigger() — every control surface picks them up.

const registry = new Map();

export function registerTrigger(name, fn) {
  registry.set(name, fn);
}

// Returns true if the trigger existed and was fired. Unknown names warn
// instead of throwing so a stale playlist/remote cue can't kill the loop.
export function fireTrigger(name, t, args) {
  const fn = registry.get(name);
  if (!fn) {
    console.warn(`[triggers] unknown trigger '${name}' (known: ${listTriggers().join(', ')})`);
    return false;
  }
  fn(t, args);
  return true;
}

export function listTriggers() {
  return [...registry.keys()].sort();
}
