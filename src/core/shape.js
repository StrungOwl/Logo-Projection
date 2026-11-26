// SVG shape surface — run the show on any outline.
//
// A shape is one SVG file in /shapes (see shapes/README.md and
// shapes/shapes.js). This module reads the SVG, finds the outline, and
// builds a slab with that outline. The slab goes through the same
// pipeline as the 3D logo (src/core/logo.js finishModel), so every look
// draws on it.
//
// Select a shape with any of:
//   index.html?shape=mandala        (URL parameter — wins)
//   window.__SHAPE = 'mandala'      (set by a launcher page)
//   MODEL.shape = 'mandala'         (src/config.js)
// URL knobs (optional, they override shapes/shapes.js):
//   &hole=star|svg|none  &holeScale=1.2  &holeWidth= &holeHeight=
//   &holeX= &holeY=  &rotate=45  &mask=outline|holes|off  &maxPoints=200
//
// Two versions of the outline are kept:
//   - the SIMPLIFIED outline (opts.maxPoints). The slab and all looks use
//     it. Several shaders test every pixel against every edge, so the
//     point count must stay small.
//   - the EXACT outline (and the exact small holes). The output mask
//     (src/core/shapeMask.js) and the calibration patterns use it, so
//     the edge of the light is the true edge of the object.
//
// Mesh units match the GLB logo (80 x 110.85 x 10, front face at z = 10):
// the longest side of the shape is 110.85 * opts.scale, the depth is 10.

import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { MODEL } from '../config.js';
import { SHAPES, SHAPE_DEFAULTS, SHAPE_MENU } from '../../shapes/shapes.js';
import { starPolygon } from './surface.js';

const LOGO_HEIGHT = 110.85;   // mesh units (the GLB's height)
const LOGO_DEPTH  = 10;       // extrusion depth (the GLB's)

// ---- which shape -------------------------------------------------------

export function resolveShapeName() {
  if (typeof window !== 'undefined') {
    const p = new URLSearchParams(window.location.search);
    const fromUrl = p.get('shape');
    if (fromUrl) return fromUrl;
    // ?surface=logo / ?surface=screen always wins over a default shape.
    const surf = p.get('surface');
    if (surf === 'logo' || surf === 'screen') return null;
    if (window.__SHAPE) return window.__SHAPE;
  }
  return MODEL.shape || null;
}

export function listShapes() {
  return Object.keys(SHAPES);
}

// The shapes that key G steps through: SHAPE_MENU, or every shape when
// that list is empty. Names that are not in SHAPES are left out.
export function menuShapes() {
  const menu = (SHAPE_MENU || []).filter(n => SHAPES[n]);
  return menu.length ? menu : listShapes();
}

// Address of the next shape: SHAPE_MENU order, then the logo, then round
// again. Every other URL parameter is kept (proj, w, h, ws ...). Key G.
export function nextShapeUrl() {
  const names = menuShapes();
  const url = new URL(window.location.href);
  const cur = resolveShapeName();
  const i = names.indexOf(cur);
  const next = cur === null ? names[0] : (i >= 0 ? names[i + 1] : names[0]);
  ['hole', 'holeScale', 'holeWidth', 'holeHeight', 'holeX', 'holeY', 'rotate', 'mask']
    .forEach(k => url.searchParams.delete(k));
  if (next) { url.searchParams.set('shape', next); url.searchParams.delete('surface'); }
  else      { url.searchParams.delete('shape'); url.searchParams.set('surface', 'logo'); }
  return url.toString();
}

// Options = defaults <- shapes.js entry <- URL parameters.
export function shapeOptions(name = resolveShapeName()) {
  const opts = { ...SHAPE_DEFAULTS, ...(SHAPES[name] || {}) };
  opts.name = name;
  opts.file = opts.file || `${name}.svg`;
  opts.label = opts.label || name;
  opts.anim = { ...(SHAPE_DEFAULTS.anim || {}), ...((SHAPES[name] || {}).anim || {}) };
  if (typeof window !== 'undefined') {
    const p = new URLSearchParams(window.location.search);
    const num = (key) => {
      if (!p.has(key)) return;
      const v = parseFloat(p.get(key));
      if (Number.isFinite(v)) opts[key] = v;
    };
    if (p.has('hole')) opts.hole = p.get('hole');
    if (p.has('mask')) opts.mask = p.get('mask');
    if (p.has('maskOpening')) opts.maskOpening = !/^(0|false|off|no)$/i.test(p.get('maskOpening'));
    ['holeScale', 'holeWidth', 'holeHeight', 'holeX', 'holeY', 'rotate',
     'scale', 'maxPoints', 'maskFeather'].forEach(num);
  }
  return opts;
}

// ---- polygon helpers ---------------------------------------------------

function signedArea(loop) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

function bounds(loop) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of loop) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function pointInLoop(x, y, loop) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    if ((a.y > y) !== (b.y > y) && x < a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}

function ccw(loop) {
  return signedArea(loop) < 0 ? loop.slice().reverse() : loop;
}

// Ramer-Douglas-Peucker on an open polyline.
function rdpOpen(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    if (e <= s + 1) continue;
    const a = pts[s], b = pts[e];
    const dx = b.x - a.x, dy = b.y - a.y;
    const denom = Math.hypot(dx, dy) || 1;
    let maxD = -1, maxI = -1;
    for (let i = s + 1; i < e; i++) {
      const p = pts[i];
      const d = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / denom;
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > tol) { keep[maxI] = 1; stack.push([s, maxI]); stack.push([maxI, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// Closed-loop RDP: split at the two points farthest apart, simplify each
// arc, join.
function simplifyLoop(loop, tol) {
  if (loop.length < 5 || tol <= 0) return loop.slice();
  let i1 = 0, maxD = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = (loop[i].x - loop[0].x) ** 2 + (loop[i].y - loop[0].y) ** 2;
    if (d > maxD) { maxD = d; i1 = i; }
  }
  const armA = loop.slice(0, i1 + 1);
  const armB = loop.slice(i1).concat([loop[0]]);
  const out = rdpOpen(armA, tol).slice(0, -1).concat(rdpOpen(armB, tol).slice(0, -1));
  return out.length >= 3 ? out : loop.slice();
}

// Simplify until the loop has at most maxPoints points. Returns the loop
// and the tolerance that was needed (mesh units).
function simplifyToBudget(loop, maxPoints, startTol) {
  let tol = startTol;
  let out = simplifyLoop(loop, tol);
  let guard = 0;
  while (out.length > maxPoints && guard++ < 40) {
    tol *= 1.35;
    out = simplifyLoop(loop, tol);
  }
  return { loop: out, tol };
}

// ---- SVG -> loops ------------------------------------------------------

// All closed sub-paths of the SVG as point loops, y up. Open paths with
// three or more points are closed. Curves are sampled.
export function svgToLoops(svgText, curveSegments = 12) {
  const data = new SVGLoader().parse(svgText);
  const loops = [];
  for (const path of data.paths) {
    for (const sub of path.subPaths) {
      const pts = sub.getPoints(curveSegments);
      const loop = [];
      for (const p of pts) {
        const last = loop[loop.length - 1];
        if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
        loop.push({ x: p.x, y: -p.y });      // SVG y is down
      }
      if (loop.length > 1) {
        const a = loop[0], b = loop[loop.length - 1];
        if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) loop.pop();
      }
      if (loop.length >= 3 && Math.abs(signedArea(loop)) > 1e-9) loops.push(loop);
    }
  }
  return loops;
}

// ---- shape data (no three.js objects) ----------------------------------

// Turn SVG text + options into every polygon the app needs, in mesh
// units, centred on the outline's bounding box:
//   outer       simplified outline, CCW
//   hole        the opening (star or SVG hole) or null, CCW
//   exactOuter  full-detail outline, CCW
//   exactHoles  full-detail small holes (never includes `hole`)
//   exactOpening full-detail SVG opening (hole 'svg' only), or null
//   flameCutout region where the fire burns
//   center      centre of the opening
export function buildShapeData(svgText, opts) {
  let loops = svgToLoops(svgText, opts.curveSegments);
  if (!loops.length) throw new Error(`[shape] '${opts.file}' has no closed path`);

  // Biggest loop = the outline. Loops inside it = holes.
  loops.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  let outer = loops[0];
  let inner = loops.slice(1).filter(l => pointInLoop(l[0].x, l[0].y, outer));
  const dropped = loops.length - 1 - inner.length;

  // Centre, rotate, flip, scale to mesh units.
  const b0 = bounds(outer);
  const cx0 = (b0.minX + b0.maxX) / 2, cy0 = (b0.minY + b0.maxY) / 2;
  const rot = THREE.MathUtils.degToRad(opts.rotate || 0);
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const fx = opts.flipX ? -1 : 1;
  const place = (l) => l.map(p => {
    const x = (p.x - cx0) * fx, y = p.y - cy0;
    return { x: x * cr - y * sr, y: x * sr + y * cr };
  });
  outer = place(outer);
  inner = inner.map(place);
  const b1 = bounds(outer);
  const k = (LOGO_HEIGHT * (opts.scale || 1)) / Math.max(b1.w, b1.h);
  const ox = (b1.minX + b1.maxX) / 2, oy = (b1.minY + b1.maxY) / 2;
  const fit = (l) => l.map(p => ({ x: (p.x - ox) * k, y: (p.y - oy) * k }));
  outer = ccw(fit(outer));
  inner = inner.map(l => ccw(fit(l)));
  const bb = bounds(outer);
  const longSide = Math.max(bb.w, bb.h);

  // Exact versions: only drop points that are closer than 1/5000 of the
  // size to the line (invisible, and it keeps the mask mesh light).
  const exactTol = longSide * 0.0002;
  const exactOuter = simplifyLoop(outer, exactTol);
  let exactHoles = inner.map(l => simplifyLoop(l, exactTol));

  // Simplified outline for the looks.
  const simp = simplifyToBudget(outer, opts.maxPoints || 700, longSide * 0.0002);

  // The opening.
  let hole = null, center = { x: 0, y: 0 };
  let star = null, exactOpening = null;
  const makeStar = (scale) => {
    const hw = (bb.w * opts.holeWidth  / 2) * opts.holeScale * scale;
    const hh = (bb.h * opts.holeHeight / 2) * opts.holeScale * scale;
    const sx = bb.w * opts.holeX, sy = bb.h * opts.holeY;
    return starPolygon(sx, sy, hw, hh).map(p => ({ x: p.x, y: p.y }));
  };
  if (opts.hole === 'svg' && inner.length) {
    // Biggest SVG hole becomes the opening; the rest stay "small holes".
    let bi = 0;
    for (let i = 1; i < inner.length; i++) {
      if (Math.abs(signedArea(inner[i])) > Math.abs(signedArea(inner[bi]))) bi = i;
    }
    hole = simplifyToBudget(inner[bi], 120, longSide * 0.0008).loop;
    exactOpening = exactHoles[bi];
    exactHoles = exactHoles.filter((_, i) => i !== bi);
    const hb = bounds(hole);
    center = { x: (hb.minX + hb.maxX) / 2, y: (hb.minY + hb.maxY) / 2 };
  } else {
    if (opts.hole === 'svg') console.warn(`[shape] '${opts.name}': hole 'svg' but the SVG has no hole - using a star`);
    // Shrink the star until it sits inside the outline.
    let s = 1;
    star = makeStar(s);
    for (let i = 0; i < 12 && !star.every(p => pointInLoop(p.x, p.y, simp.loop)); i++) {
      s *= 0.88;
      star = makeStar(s);
    }
    if (s < 1) console.warn(`[shape] '${opts.name}': star shrunk to ${(s * 100).toFixed(0)} % to fit inside the outline`);
    center = { x: bb.w * opts.holeX, y: bb.h * opts.holeY };
    if (opts.hole !== 'none' && star.every(p => pointInLoop(p.x, p.y, simp.loop))) hole = star;
  }
  // Fire region: the opening, or (no opening) an invisible star column.
  const flameCutout = hole || star || makeStar(1);

  console.log(`[shape] '${opts.name}': outline ${loops[0].length} -> ${simp.loop.length} points ` +
    `(tolerance ${(simp.tol / longSide * 100).toFixed(2)} % of size), ${inner.length} SVG holes` +
    (dropped ? `, ${dropped} loose paths ignored` : '') +
    `, opening '${hole ? opts.hole : 'none'}', mask '${opts.mask}'`);

  return {
    name: opts.name, opts,
    outer: simp.loop, hole,
    exactOuter, exactHoles, exactOpening,
    flameCutout, center,
    width: bb.w, height: bb.h,
  };
}

// ---- model -------------------------------------------------------------

function toShape(outer, holes = []) {
  const shape = new THREE.Shape(outer.map(p => new THREE.Vector2(p.x, p.y)));
  for (const h of holes) {
    // Hole paths wind opposite to the outer contour.
    shape.holes.push(new THREE.Path(h.slice().reverse().map(p => new THREE.Vector2(p.x, p.y))));
  }
  return shape;
}

// Object3D root shaped like a loaded GLB scene (one child mesh), so
// logo.js finishes it the way it finishes the logo.
export function buildShapeModel(data) {
  const geometry = new THREE.ExtrudeGeometry(toShape(data.outer, data.hole ? [data.hole] : []), {
    depth: LOGO_DEPTH,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.computeBoundingBox();

  const mesh = new THREE.Mesh(geometry);
  mesh.name = `shape-${data.name}`;
  mesh.userData.isShapeSurface = true;
  mesh.userData.shape = data;
  mesh.userData.flameCutout = data.flameCutout;
  mesh.userData.fadeCenter = data.center;

  const root = new THREE.Group();
  root.name = `shape-${data.name}-root`;
  root.add(mesh);
  return root;
}

// Fetch + build. Rejects with a clear message when the file is missing.
export async function loadShapeModel(name = resolveShapeName()) {
  const opts = shapeOptions(name);
  const url = new URL(`../../shapes/${opts.file}`, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`[shape] cannot load '${opts.file}' (${res.status}). ` +
      `Put the SVG in the shapes folder. Known shapes: ${listShapes().join(', ') || 'none'}`);
  }
  return buildShapeModel(buildShapeData(await res.text(), opts));
}

// Per-shape ANIM values (shapes.js `anim`). Runs once, after the model
// loads and before the looks are built. A path that does not exist in
// ANIM is reported and skipped.
export function applyShapeDefaults(ANIM, data) {
  if (!data) return;
  for (const [path, value] of Object.entries(data.opts.anim || {})) {
    const keys = path.split('.');
    let node = ANIM;
    for (let i = 0; i < keys.length - 1 && node; i++) node = node[keys[i]];
    const leaf = keys[keys.length - 1];
    if (!node || typeof node !== 'object' || !(leaf in node)) {
      console.warn(`[shape] '${data.name}': anim path '${path}' is not in ANIM - skipped`);
      continue;
    }
    node[leaf] = value;
  }
  // Leave looks out of THE SHOW on this shape.
  const skip = data.opts.skip || [];
  if (skip.length && ANIM.show?.playlist) {
    ANIM.show.playlist = ANIM.show.playlist.filter(step => !skip.includes(step.mode));
  }
}
