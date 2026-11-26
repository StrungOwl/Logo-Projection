// Full-screen projection surface — the "no 3D logo" version.
//
// Instead of loading the SDG GLB, this builds a procedural slab whose
// front face is a plain rectangle in the projector's aspect ratio (with
// an optional star aperture in the middle). The slab is handed to the
// exact same pipeline as the logo (materials, silhouette metadata, galaxy
// plate, every effect), so all nine modes render onto a flat wall or
// screen with no mapping onto the physical A.
//
// (A third surface, an SVG outline, lives in src/core/shape.js:
//  index.html?shape=<name>. See shapes/README.md.)
//
// Select it with any of:
//   fullscreen.html                 (sets window.__SURFACE = 'screen')
//   index.html?surface=screen       (URL param — wins over config)
//   MODEL.surface = 'screen'        (src/config.js)
// Extra URL knobs: &aspect=1.777  &hole=star|none  &holeScale=1.2
//
// Mesh-local units match the GLB (the logo is 80 × 110.85 × 10 units,
// front face at z = 10): every effect sizes itself in those units, so the
// slab keeps the same HEIGHT and extrusion depth and only its width
// follows the aspect. Pattern density, frame width, flame extents and
// particle sizes therefore read identically on the wall.

import * as THREE from 'three';
import { MODEL } from '../config.js';

// Resolve which surface to build. Priority: URL param → window flag
// (fullscreen.html) → MODEL.surface → 'logo'.
export function resolveSurface() {
  if (typeof window === 'undefined') return MODEL.shape ? 'shape' : (MODEL.surface || 'logo');
  const params = new URLSearchParams(window.location.search);
  // An SVG shape (src/core/shape.js) is its own surface: ?shape=<name>.
  if (params.get('shape')) return 'shape';
  const fromUrl = params.get('surface');
  if (fromUrl === 'screen' || fromUrl === 'logo') return fromUrl;
  if (window.__SHAPE) return 'shape';
  if (window.__SURFACE === 'screen') return 'screen';
  if (MODEL.shape) return 'shape';
  return MODEL.surface || 'logo';
}

export function isScreenSurface() {
  return resolveSurface() === 'screen';
}

// Screen options: config defaults, overridable per-session via URL.
export function screenOptions() {
  const cfg = { ...(MODEL.screen || {}) };
  if (typeof window !== 'undefined') {
    const p = new URLSearchParams(window.location.search);
    if (p.has('aspect'))    cfg.aspect    = parseFloat(p.get('aspect')) || cfg.aspect;
    if (p.has('hole'))      cfg.hole      = p.get('hole');
    if (p.has('holeScale')) cfg.holeScale = parseFloat(p.get('holeScale')) || cfg.holeScale;
    // No explicit aspect: follow the projection output (w/h params) or
    // the window itself, so fullscreen.html fills whatever it is on.
    if (!cfg.aspect) {
      const w = parseInt(p.get('w') || '0', 10) || window.innerWidth;
      const h = parseInt(p.get('h') || '0', 10) || window.innerHeight;
      cfg.aspect = (w > 0 && h > 0) ? w / h : 16 / 9;
    }
  }
  return {
    aspect:     cfg.aspect     || 16 / 9,
    hole:       cfg.hole       || 'star',
    holeScale:  cfg.holeScale  || 1.0,
    holeWidth:  cfg.holeWidth  ?? 0.30,   // fraction of slab WIDTH
    holeHeight: cfg.holeHeight ?? 0.50,   // fraction of slab HEIGHT
    holeY:      cfg.holeY      ?? 0.04,   // centre offset, fraction of height
    height:     cfg.height     || 110.85, // mesh units (== the GLB's height)
    depth:      cfg.depth      || 10,     // extrusion depth (== the GLB's)
  };
}

// Four-cusp star (astroid: x = a·cos³θ, y = b·sin³θ) — the same family of
// concave-sided star the logo carries, sampled as a polygon. Returned CCW.
export function starPolygon(cx, cy, halfW, halfH, n = 96) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const c = Math.cos(th), s = Math.sin(th);
    pts.push(new THREE.Vector2(cx + halfW * c * c * c, cy + halfH * s * s * s));
  }
  return pts;
}

// Per-surface config overrides, applied once after the model loads.
// The full-frame portal head copy spans the whole output, so even a
// degree of twist shows black wedges at the corners: the corridor runs
// straight and converges by scale alone.
export function applyScreenDefaults(ANIM) {
  if (ANIM.recede) {
    ANIM.recede.twistDeg = 0;
    if (ANIM.recede.wobble) ANIM.recede.wobble.ampDeg = 0;
    if (ANIM.recede.evolve) ANIM.recede.evolve.twistWander = 0;
    ANIM.recede.headScale = 1.0;
  }
}

// Build the slab. Returns an Object3D root shaped like a loaded GLB scene
// (one child mesh named 'screen-surface') so logo.js can finish it the
// way it finishes a loaded model. `meta.flameCutout` (mesh-local polygon)
// is attached on the mesh's userData for the hole:'none' case so the fire
// still has a column region to burn in.
export function buildScreenModel(opts = screenOptions()) {
  const H = opts.height;
  const W = H * opts.aspect;
  const shape = new THREE.Shape([
    new THREE.Vector2(-W / 2, -H / 2), new THREE.Vector2( W / 2, -H / 2),
    new THREE.Vector2( W / 2,  H / 2), new THREE.Vector2(-W / 2,  H / 2),
  ]);
  const holeHalfW = (W * opts.holeWidth  / 2) * opts.holeScale;
  const holeHalfH = (H * opts.holeHeight / 2) * opts.holeScale;
  const holeCy    = H * opts.holeY;
  const star = starPolygon(0, holeCy, holeHalfW, holeHalfH);
  if (opts.hole === 'star') {
    // Hole paths must wind opposite to the outer contour.
    shape.holes.push(new THREE.Path(star.slice().reverse()));
  }

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: opts.depth,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.computeBoundingBox();

  const mesh = new THREE.Mesh(geometry);
  mesh.name = 'screen-surface';
  // Synthetic fire column for hole:'none' (flame.js reads this when the
  // mesh carries no inner cutout). Mesh-local coordinates.
  mesh.userData.flameCutout = star.map(p => ({ x: p.x, y: p.y }));
  mesh.userData.isScreenSurface = true;

  const root = new THREE.Group();
  root.name = 'screen-surface-root';
  root.add(mesh);
  return root;
}
