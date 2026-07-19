// Domino-flip animation across every brick in the scene. One-shot
// triggered (key 'd' or window.__triggerDominoes()); each brick rotates
// around a WORLD-frame axis (so the flip direction reads uniformly
// regardless of which way the brick was originally tangent-aligned).
//
// Wave ordering: at trigger time we pick N random epicenter bricks. Each
// other brick gets `dominoIndex` proportional to its distance to the
// CLOSEST epicenter, so multiple ripples expand outward simultaneously
// (Diagon Alley brick-wall feel: tap several bricks, walls open in
// concentric rings around each tap).
//
// On first trigger we walk the scene once to find every BoxGeometry
// child of the named brick-host groups, cache rest quaternions + world
// positions, and reuse the registry on subsequent triggers.
//
// Config: ANIM.dominoFlip — see src/config.js for knob docs.

import * as THREE from 'three';
import { ANIM } from '../../config.js';

const _v3       = new THREE.Vector3();
const _flipAxis = new THREE.Vector3(1, 0, 0);
const _flipQuat = new THREE.Quaternion();

let registry = null;     // [{ mesh, restQuat, worldPos, dominoIndex }]
let playing = false;     // toggle state (key 'd' flips this)
let triggerTime = 0;     // absolute t at the start of the current loop cycle

const BRICK_HOST_NAMES = ['arch', 'fireplace'];

function buildRegistry(scene) {
  const bricks = [];
  scene.traverse(host => {
    if (!BRICK_HOST_NAMES.includes(host.name)) return;
    host.traverse(child => {
      if (!child.isMesh || !child.geometry) return;
      // BoxGeometry catches every brick. The dominoFlippable tag opts in
      // non-brick meshes (currently the fireplace inner-hex band) that
      // share the host group but aren't BoxGeometry-based.
      const isBox  = child.geometry.type === 'BoxGeometry';
      const tagged = child.userData && child.userData.dominoFlippable === true;
      if (!isBox && !tagged) return;
      // Opt-out for decorative child meshes (e.g. the corona voussoirs'
      // gilded tip caps) that inherit their parent brick's flip and must
      // not register as independent dominoes.
      if (child.userData && child.userData.dominoExclude === true) return;
      const wp = new THREE.Vector3();
      child.getWorldPosition(wp);
      bricks.push({
        mesh:     child,
        restQuat: child.quaternion.clone(),
        worldPos: wp,
        dominoIndex: 0,   // assigned per-trigger
      });
    });
  });
  return bricks;
}

// At trigger time, assign each brick its dominoIndex. Two schemes:
//
// RING-QUANTIZED MULTI-EPICENTER (cfg.epicenters > 0, default): pick N
// random registry bricks as epicenters. Each brick's index is
//   floor(min-distance-to-any-epicenter / ringWidth)
// so every brick in a distance band shares an index and flips
// SIMULTANEOUSLY (like the small hexagons banding together), and the
// waves expand OUTWARD from each tap point. updateDominoes spaces
// adjacent rings by cfg.ringStagger seconds.
//
// LEGACY (cfg.epicenters === 0): rank every brick by 2D Euclidean
// distance to the brick mass's CENTROID, sorted DESCENDING — bricks
// farthest from the centroid (outermost circular ring) fire first,
// innermost last, one per-brick cfg.stagger apart. The wave reads as
// concentric circles collapsing inward.
function reorderForTrigger(bricks) {
  const n = bricks.length;
  if (!n) return;
  const cfg = ANIM.dominoFlip || {};
  const epicenters = cfg.epicenters ?? 3;

  if (epicenters > 0) {
    // --- Ring-quantized multi-epicenter waves ---
    const ringWidth = Math.max(1e-3, cfg.ringWidth ?? 3.0);
    const centers = [];
    for (let e = 0; e < epicenters; e++) {
      centers.push(bricks[Math.floor(Math.random() * n)].worldPos);
    }
    for (const b of bricks) {
      let dMin = Infinity;
      for (const c of centers) {
        const dx = b.worldPos.x - c.x, dy = b.worldPos.y - c.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < dMin) dMin = d;
      }
      // Every brick in the same ring band shares this index — they all
      // start flipping at the SAME instant (see updateDominoes).
      b.dominoIndex = Math.floor(dMin / ringWidth);
    }
    return;
  }

  // --- Legacy centroid-descending ordering (epicenters: 0) ---
  let cx = 0, cy = 0;
  for (const b of bricks) { cx += b.worldPos.x; cy += b.worldPos.y; }
  cx /= n; cy /= n;
  const distances = bricks.map(b => {
    const dx = b.worldPos.x - cx, dy = b.worldPos.y - cy;
    return Math.sqrt(dx * dx + dy * dy);
  });
  // Descending sort — largest distance first = outermost circular ring
  // fires first, then the next ring inward, and so on.
  const order = bricks.map((_, i) => i);
  order.sort((a, b) => distances[b] - distances[a]);
  for (let i = 0; i < n; i++) bricks[order[i]].dominoIndex = i;
}

// Smooth in-out cubic; matches the feel of a falling-then-settling brick
// without needing a full physics swing.
function easeInOut(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

// Toggle the loop on/off. Each 'on' transition picks a fresh outer-first
// ordering and starts a wave; while playing, completed waves immediately
// re-trigger from the current frame so the effect runs continuously.
export function toggleDominoes(scene, t) {
  if (!registry) registry = buildRegistry(scene);
  if (playing) {
    // Off: snap every brick back to its rest pose so the scene reads as
    // static again.
    for (const b of registry) b.mesh.quaternion.copy(b.restQuat);
    playing = false;
    return false;
  }
  reorderForTrigger(registry);
  triggerTime = t;
  playing = true;
  return true;
}

export function updateDominoes(t) {
  if (!registry || !playing) return;

  const cfg      = ANIM.dominoFlip || {};
  // Ring mode: dominoIndex is a RING index (small ints) → space rings
  // by ringStagger. Legacy mode: dominoIndex is a per-brick rank →
  // space bricks by the (much smaller) per-brick stagger.
  const ringMode = (cfg.epicenters ?? 3) > 0;
  const stagger  = ringMode ? (cfg.ringStagger ?? 0.35)
                            : (cfg.stagger     ?? 0.04);
  const duration = cfg.duration ?? 1.5;
  const angle    = cfg.angle    ?? Math.PI * 2;
  const axis     = cfg.axis     || [1, 0, 0];
  _flipAxis.set(axis[0], axis[1], axis[2]).normalize();

  let allDone = true;
  for (let i = 0; i < registry.length; i++) {
    const b = registry[i];
    const startT = triggerTime + b.dominoIndex * stagger;
    const localT = (t - startT) / duration;

    if (localT <= 0 || localT >= 1) {
      // Outside this brick's window — snap to rest.
      b.mesh.quaternion.copy(b.restQuat);
      if (localT < 1) allDone = false;
      continue;
    }
    allDone = false;
    const ease = easeInOut(localT);
    _flipQuat.setFromAxisAngle(_flipAxis, ease * angle);
    // PRE-multiply the flip quaternion so the rotation axis is in WORLD
    // space, not the brick's local frame. This way every brick — fireplace
    // rim (long axis pointing at camera), floor wall (lying flat),
    // topLayer steps (vertical) — flips around the same world axis and
    // the wave reads uniformly.
    b.mesh.quaternion.copy(_flipQuat).multiply(b.restQuat);
  }
  // While playing, auto-retrigger as soon as the previous cycle completes
  // so the wave keeps coming. Reorder is intentional: it's deterministic
  // (centroid-based), but the call is cheap and lets a future per-cycle
  // randomiser plug in here.
  if (allDone) {
    reorderForTrigger(registry);
    triggerTime = t;
  }
}

// Devtools / external toggle — call window.__triggerDominoes() from the
// JS console to flip the playmode without the keyboard.
if (typeof window !== 'undefined') {
  window.__triggerDominoes = () => {
    if (window.__ctx && window.__ctx.scene) {
      toggleDominoes(window.__ctx.scene, performance.now() / 1000);
    }
  };
}
