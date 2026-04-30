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
import { ANIM } from './config.js';

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
      if (!child.isMesh) return;
      if (!child.geometry || child.geometry.type !== 'BoxGeometry') return;
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

// At trigger time, rank every brick by 2D Euclidean distance to the
// brick mass's CENTROID. Sorted DESCENDING — bricks farthest from the
// centroid (outermost circular ring) fire first, innermost last. The
// wave reads as concentric circles collapsing inward, regardless of
// the underlying silhouette shape (arch, square, irregular — the
// circular ring shape is enforced by the radial distance metric).
function reorderForTrigger(bricks) {
  const n = bricks.length;
  if (!n) return;
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
  const stagger  = cfg.stagger  ?? 0.04;
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
