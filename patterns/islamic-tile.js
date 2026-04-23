import * as THREE from 'three';

function buildHubStar(symmetry, rOuter, rInner) {
  const shape = new THREE.Shape();
  const points = symmetry * 2;
  for (let i = 0; i < points; i++) {
    const theta = (i / points) * Math.PI * 2;
    const r = i % 2 === 0 ? rOuter : rInner;
    const x = Math.cos(theta) * r;
    const y = Math.sin(theta) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function buildDiamondPetal(theta, rBase, rTip, halfWidth) {
  const cx = Math.cos(theta);
  const cy = Math.sin(theta);
  const px = -cy;
  const py = cx;
  const midR = (rBase + rTip) * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(cx * rBase, cy * rBase);
  shape.lineTo(cx * midR + px * halfWidth, cy * midR + py * halfWidth);
  shape.lineTo(cx * rTip, cy * rTip);
  shape.lineTo(cx * midR - px * halfWidth, cy * midR - py * halfWidth);
  shape.closePath();
  return shape;
}

function buildRosetteGeometry({ symmetry, hubR, innerR, midR, outerR, depth }) {
  const shapes = [];

  shapes.push(buildHubStar(symmetry, hubR, hubR * 0.5));

  const innerHalfWidth = (midR - innerR) * 0.3;
  for (let i = 0; i < symmetry; i++) {
    const theta = (i / symmetry) * Math.PI * 2;
    shapes.push(buildDiamondPetal(theta, innerR, midR, innerHalfWidth));
  }

  const outerHalfWidth = (outerR - midR) * 0.35;
  for (let i = 0; i < symmetry; i++) {
    const theta = ((i + 0.5) / symmetry) * Math.PI * 2;
    shapes.push(buildDiamondPetal(theta, midR, outerR, outerHalfWidth));
  }

  return new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 2,
    curveSegments: 4,
  });
}

function buildStrapGeometry(length, halfWidth, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(-length * 0.5, 0);
  shape.lineTo(-length * 0.25, halfWidth);
  shape.lineTo(length * 0.25, halfWidth);
  shape.lineTo(length * 0.5, 0);
  shape.lineTo(length * 0.25, -halfWidth);
  shape.lineTo(-length * 0.25, -halfWidth);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
    bevelSegments: 2,
  });
}

function buildKnotGeometry(size, depth) {
  return new THREE.ExtrudeGeometry(buildHubStar(6, size, size * 0.5), {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 2,
  });
}

// Ray-cast point-in-polygon test. `poly` is [{x, y}, ...] — closed automatically.
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const hit = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}

// Perpendicular distance from (px, py) to the line segment a→b.
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const qx = ax + t * dx, qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

// Inside polygon AND at least `margin` away from every edge — lets us treat
// each tile as a disc of radius `margin` and reject any disc that would
// overhang the polygon boundary.
function insideWithMargin(x, y, poly, margin) {
  if (!pointInPolygon(x, y, poly)) return false;
  if (margin <= 0) return true;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (distToSegment(x, y, a.x, a.y, b.x, b.y) < margin) return false;
  }
  return true;
}

// Build a flat tileable panel of the Islamic pattern, laid out in the XY plane
// with extrusion along +Z. Returns a THREE.Group suitable for adding as a
// child of any mesh (or the scene directly).
//
// `clipPolygon` (optional): array of { x, y } points in panel-local coordinates.
// When provided, any tile whose centre falls outside the polygon is skipped,
// so the pattern follows a custom silhouette (e.g. the logo's outline).
// `clipMargin` (optional): tiles must also sit this far INSIDE each polygon
// edge — set to roughly `mainTileSize` to keep whole rosettes within bounds.
// `fadeInnerR`/`fadeOuterR`: opacity smoothly ramps from 0 at inner radius
// to `maxOpacity` at outer — measured in panel-local units from the panel
// centre — so the pattern dissolves around the middle and the galaxy core
// glows through.
export function createIslamicPanel({
  cols = 9,
  rows = 9,
  tileStep = 3.6,
  mainSymmetry = 12,
  mainTileSize = 1.45,
  secondarySymmetry = 8,
  secondaryScale = 0.55,
  reliefDepth = 0.18,
  strapHalfWidth = 0.18,
  knotSize = 0.42,
  goldColor = 0xE5A400,
  material = null,
  clipPolygon = null,
  clipMargin = 0,
  fadeInnerR = 0,
  fadeOuterR = 0,
  fadeCenter = [0, 0],
  // Stretch the fade downward only (values > 1 extend it below uFadeCenter).
  fadeDownStretch = 1.0,
  // Pinch horizontal reach as the fade descends — 0 = no taper (rounded
  // bottom), 1 = width halves at the fade's bottom edge (teardrop point).
  fadeBottomTaper = 0.0,
  maxOpacity = 1.0,
  gradientMinY = -5,
  gradientMaxY = 5,
  gradientDark = [0.7, 0.58, 0.42],
  gradientBright = [1.0, 1.0, 1.0],
} = {}) {
  const group = new THREE.Group();

  const goldMat = material || new THREE.MeshStandardMaterial({
    color: goldColor,
    metalness: 0.55,
    roughness: 0.45,
  });

  const panelMatrixInv = new THREE.Matrix4();
  const fadeGradUniforms = {
    uPanelInv:    { value: panelMatrixInv },
    uFadeInner:   { value: fadeInnerR },
    uFadeOuter:   { value: fadeOuterR },
    uFadeCenter:  { value: new THREE.Vector2(fadeCenter[0], fadeCenter[1]) },
    uFadeDownStretch: { value: fadeDownStretch },
    uFadeBottomTaper: { value: fadeBottomTaper },
    uMaxOpacity:  { value: maxOpacity },
    uGradMinY:    { value: gradientMinY },
    uGradMaxY:    { value: gradientMaxY },
    uGradDark:    { value: new THREE.Vector3(...gradientDark) },
    uGradBright:  { value: new THREE.Vector3(...gradientBright) },
  };

  // Enable transparency so the center fade can dissolve into the galaxy.
  if (fadeOuterR > 0 || maxOpacity < 1) {
    goldMat.transparent = true;
  }

  goldMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fadeGradUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nvarying vec3 vGradWP;\nvarying vec2 vPanelXY;\nuniform mat4 uPanelInv;')
      .replace('#include <project_vertex>',
        `#include <project_vertex>
         vec4 _wp = modelMatrix * vec4(position, 1.0);
         vGradWP = _wp.xyz;
         vPanelXY = (uPanelInv * _wp).xy;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        `#include <common>
         uniform float uGradMinY;
         uniform float uGradMaxY;
         uniform vec3  uGradDark;
         uniform vec3  uGradBright;
         uniform float uFadeInner;
         uniform float uFadeOuter;
         uniform vec2  uFadeCenter;
         uniform float uFadeDownStretch;
         uniform float uFadeBottomTaper;
         uniform float uMaxOpacity;
         varying vec3  vGradWP;
         varying vec2  vPanelXY;`)
      .replace('#include <color_fragment>',
        `#include <color_fragment>
         float _gt = clamp((vGradWP.y - uGradMinY) / max(uGradMaxY - uGradMinY, 1e-4), 0.0, 1.0);
         diffuseColor.rgb *= mix(uGradDark, uGradBright, _gt);`)
      .replace('#include <dithering_fragment>',
        `#include <dithering_fragment>
         vec2  _delta = vPanelXY - uFadeCenter;
         // Stretch only downward (panel-local -Y is down) — top stays round.
         if (_delta.y < 0.0) _delta.y /= max(uFadeDownStretch, 1e-4);
         // Pinch horizontal reach the further down we travel — teardrop shape.
         float _downN = clamp(-_delta.y / max(uFadeOuter, 1e-4), 0.0, 2.0);
         _delta.x *= 1.0 + uFadeBottomTaper * _downN;
         float _d = length(_delta);
         float _a = (uFadeOuter > uFadeInner)
            ? smoothstep(uFadeInner, uFadeOuter, _d)
            : 1.0;
         gl_FragColor.a *= _a * uMaxOpacity;`);
  };

  group.userData.refreshFade = () => {
    group.updateMatrixWorld(true);
    panelMatrixInv.copy(group.matrixWorld).invert();
  };
  group.userData.fadeGradUniforms = fadeGradUniforms;

  const mainGeo = buildRosetteGeometry({
    symmetry: mainSymmetry,
    hubR: mainTileSize * 0.18,
    innerR: mainTileSize * 0.22,
    midR: mainTileSize * 0.55,
    outerR: mainTileSize,
    depth: reliefDepth,
  });

  const secondarySize = mainTileSize * secondaryScale;
  const secondaryGeo = buildRosetteGeometry({
    symmetry: secondarySymmetry,
    hubR: secondarySize * 0.22,
    innerR: secondarySize * 0.28,
    midR: secondarySize * 0.58,
    outerR: secondarySize,
    depth: reliefDepth,
  });

  const hGap = tileStep - mainTileSize - secondarySize;
  const vGap = tileStep - mainTileSize - secondarySize;
  const hStrapLen = Math.max(0.3, hGap + 0.35);
  const vStrapLen = Math.max(0.3, vGap + 0.35);

  const hStrapGeo = buildStrapGeometry(hStrapLen, strapHalfWidth, reliefDepth * 0.75);
  const vStrapGeo = buildStrapGeometry(vStrapLen, strapHalfWidth, reliefDepth * 0.75);
  const knotGeo = buildKnotGeometry(knotSize, reliefDepth * 0.9);

  const startX = -(cols - 1) * tileStep * 0.5;
  const startY = -(rows - 1) * tileStep * 0.5;
  const inClip = clipPolygon
    ? (x, y, r) => insideWithMargin(x, y, clipPolygon, Math.max(clipMargin, r))
    : () => true;

  // --- Rosettes on a checkerboard ---
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = startX + c * tileStep;
      const y = startY + r * tileStep;
      const isMain = (c + r) % 2 === 0;
      const radius = isMain ? mainTileSize : secondarySize;
      if (!inClip(x, y, radius)) continue;
      const mesh = new THREE.Mesh(isMain ? mainGeo : secondaryGeo, goldMat);
      mesh.position.set(x, y, 0);
      group.add(mesh);
    }
  }

  // --- Horizontal straps between (c, r) and (c+1, r) ---
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const x = startX + (c + 0.5) * tileStep;
      const y = startY + r * tileStep;
      if (!inClip(x, y, hStrapLen * 0.5)) continue;
      const mesh = new THREE.Mesh(hStrapGeo, goldMat);
      mesh.position.set(x, y, 0);
      group.add(mesh);
    }
  }

  // --- Vertical straps between (c, r) and (c, r+1) ---
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      const x = startX + c * tileStep;
      const y = startY + (r + 0.5) * tileStep;
      if (!inClip(x, y, vStrapLen * 0.5)) continue;
      const mesh = new THREE.Mesh(vStrapGeo, goldMat);
      mesh.position.set(x, y, 0);
      mesh.rotation.z = Math.PI * 0.5;
      group.add(mesh);
    }
  }

  // --- Knots at every 4-way crossing ---
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const x = startX + (c + 0.5) * tileStep;
      const y = startY + (r + 0.5) * tileStep;
      if (!inClip(x, y, knotSize)) continue;
      const mesh = new THREE.Mesh(knotGeo, goldMat);
      mesh.position.set(x, y, 0);
      group.add(mesh);
    }
  }

  return group;
}
