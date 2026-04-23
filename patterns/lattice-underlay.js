import * as THREE from 'three';

// Solid pointy-top hexagon, flat extrusion with hard edges — the look
// of a laser-cut plate stamped into the panel.
function buildSolidHexGeometry(radius, depth) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 2 + i * Math.PI / 3;
    const x = Math.cos(a) * radius, y = Math.sin(a) * radius;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 1,
  });
}

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

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const qx = ax + t * dx, qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

function insideWithMargin(x, y, poly, margin) {
  if (!pointInPolygon(x, y, poly)) return false;
  if (margin <= 0) return true;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (distToSegment(x, y, a.x, a.y, b.x, b.y) < margin) return false;
  }
  return true;
}

// Solid-fill hex lattice aligned to a square grid. Each hex sits at a
// grid cell — intended to match the Islamic panel's `tileStep`/`cols`/`rows`
// so every hex frames one of the front pattern's stars. The gaps between
// hexagons form horizontal/vertical channels and diagonal diamond holes
// of negative space — a laser-cut stamped-plate look.
export function createLatticeUnderlay({
  cols = 9,
  rows = 9,
  tileStep = 6.5,
  hexRadius = 3.0,
  depth = 0.035,
  color = 0xb88700,
  material = null,
  clipPolygon = null,
  clipMargin = 0,
  // Convex CCW polygon (panel-local). When provided, the fragment shader
  // hard-clips every hex/stroke fragment to the polygon's interior —
  // hexes that overhang get sliced along the polygon edge instead of
  // poking past it. Separate from `clipPolygon` so placement can still
  // allow overhang while the rendered edge stays clean.
  hullClip = null,
  fadeInnerR = 0,
  fadeOuterR = 0,
  fadeCenter = [0, 0],
  fadeDownStretch = 1.0,
  fadeBottomTaper = 0.0,
  maxOpacity = 1.0,
  gradientMinY = -5,
  gradientMaxY = 5,
  gradientDark = [0.65, 0.55, 0.42],
  gradientBright = [1.0, 1.0, 1.0],
  strokeColor = null,
  strokeOpacity = 1.0,
  pulseSpeed = 0.0,
  pulseSpeedVariance = 0.0,
  pulseBrightMin = 1.0,
  pulseBrightMax = 1.0,
  pulseEmissiveMin = 0.0,
  pulseEmissiveMax = 0.0,
  pulseColorA = [1.0, 1.0, 1.0],
  pulseColorB = [1.0, 1.0, 1.0],
} = {}) {
  const group = new THREE.Group();

  const mat = material || new THREE.MeshStandardMaterial({
    color,
    metalness: 0.55,
    roughness: 0.55,
  });

  // Push the fill slightly back so edge lines sit cleanly on top
  if (strokeColor !== null) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = 1;
    mat.polygonOffsetUnits = 1;
  }

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
  // Per-hex pulse uniforms. uPulseSeed + uPulseSpeedFactor are swapped
  // per draw by each mesh's onBeforeRender so every hex cycles at a
  // different phase AND period while sharing one material.
  const pulseUniforms = {
    uPulseTime:        { value: 0 },
    uPulseSpeed:       { value: pulseSpeed },
    uPulseSeed:        { value: 0 },
    uPulseSpeedFactor: { value: 1 },
    uPulseBrightMin:   { value: pulseBrightMin },
    uPulseBrightMax:   { value: pulseBrightMax },
    uPulseEmissiveMin: { value: pulseEmissiveMin },
    uPulseEmissiveMax: { value: pulseEmissiveMax },
    uPulseColorA:      { value: new THREE.Vector3(...pulseColorA) },
    uPulseColorB:      { value: new THREE.Vector3(...pulseColorB) },
  };

  if (fadeOuterR > 0 || maxOpacity < 1) {
    mat.transparent = true;
  }

  // Precompute half-plane equations for the hard hull clip. Each edge a→b
  // of a CCW convex polygon has an inward normal; a point p is inside iff
  // n·p + d >= 0 for every edge. Packed as vec3(nx, ny, d).
  let hullPlanes = null;
  let hullPlaneCount = 0;
  if (hullClip && hullClip.length >= 3) {
    hullPlaneCount = hullClip.length;
    hullPlanes = new Float32Array(hullPlaneCount * 3);
    for (let i = 0; i < hullPlaneCount; i++) {
      const a = hullClip[i];
      const b = hullClip[(i + 1) % hullPlaneCount];
      const ex = b.x - a.x, ey = b.y - a.y;
      const len = Math.hypot(ex, ey) || 1;
      const nx = -ey / len, ny = ex / len;
      const d = -(nx * a.x + ny * a.y);
      hullPlanes[i * 3] = nx;
      hullPlanes[i * 3 + 1] = ny;
      hullPlanes[i * 3 + 2] = d;
    }
  }
  const hullClipUniforms = hullPlanes
    ? { uHullPlanes: { value: hullPlanes } }
    : null;

  // GLSL snippets injected into both the fill and stroke shaders when
  // hullClip is active. HULL_CLIP_COUNT is baked at compile time so the
  // loop unrolls cleanly on WebGL drivers.
  const hullClipCommon = hullPlanes
    ? `
      #define HULL_CLIP_COUNT ${hullPlaneCount}
      uniform vec3 uHullPlanes[HULL_CLIP_COUNT];`
    : '';
  const hullClipCall = hullPlanes
    ? `
      for (int _hi = 0; _hi < HULL_CLIP_COUNT; _hi++) {
        vec3 _pl = uHullPlanes[_hi];
        if (_pl.x * vPanelXY.x + _pl.y * vPanelXY.y + _pl.z < 0.0) discard;
      }`
    : '';

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fadeGradUniforms, pulseUniforms);
    if (hullClipUniforms) Object.assign(shader.uniforms, hullClipUniforms);
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
         uniform float uPulseTime;
         uniform float uPulseSpeed;
         uniform float uPulseSeed;
         uniform float uPulseSpeedFactor;
         uniform float uPulseBrightMin;
         uniform float uPulseBrightMax;
         uniform float uPulseEmissiveMin;
         uniform float uPulseEmissiveMax;
         uniform vec3  uPulseColorA;
         uniform vec3  uPulseColorB;
         varying vec3  vGradWP;
         varying vec2  vPanelXY;
         ${hullClipCommon}`)
      .replace('#include <color_fragment>',
        `#include <color_fragment>
         ${hullClipCall}
         float _gt = clamp((vGradWP.y - uGradMinY) / max(uGradMaxY - uGradMinY, 1e-4), 0.0, 1.0);
         float _raw = 0.5 + 0.5 * sin(uPulseTime * uPulseSpeed * uPulseSpeedFactor + uPulseSeed);
         // smoothstep applied twice = quintic-ish ease-in-out: each hex
         // sits longer at its dim and bright extremes with a snappier glide
         // through the middle, so the pulse reads as a slow held breath
         // rather than constant sweeping motion.
         float _pk = smoothstep(0.0, 1.0, smoothstep(0.0, 1.0, _raw));
         float _pBright = mix(uPulseBrightMin, uPulseBrightMax, _pk);
         float _pEmiss  = mix(uPulseEmissiveMin, uPulseEmissiveMax, _pk);
         vec3  _pColor  = mix(uPulseColorA, uPulseColorB, _pk);
         diffuseColor.rgb = _pColor * mix(uGradDark, uGradBright, _gt) * _pBright;`)
      .replace('#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += _pColor * _pEmiss;`)
      .replace('#include <dithering_fragment>',
        `#include <dithering_fragment>
         vec2  _delta = vPanelXY - uFadeCenter;
         _delta.y /= max(uFadeDownStretch, 1e-4);
         float _downN = clamp(abs(_delta.y) / max(uFadeOuter, 1e-4), 0.0, 2.0);
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

  const hexGeo = buildSolidHexGeometry(hexRadius, depth);

  // Optional stroke: real edge lines on every hex, faded to match the fill
  let edgesGeo = null;
  let lineMat = null;
  const strokeUniforms = {
    uTime:        { value: 0 },
    uTwinkleSeed: { value: 0 },
  };
  if (strokeColor !== null) {
    edgesGeo = new THREE.EdgesGeometry(hexGeo, 30);
    lineMat = new THREE.LineBasicMaterial({
      color: strokeColor,
      transparent: true,
      opacity: strokeOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    lineMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, fadeGradUniforms, strokeUniforms);
      if (hullClipUniforms) Object.assign(shader.uniforms, hullClipUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>',
          '#include <common>\nvarying vec2 vPanelXY;\nuniform mat4 uPanelInv;')
        .replace('#include <project_vertex>',
          `#include <project_vertex>
           vec4 _wp = modelMatrix * vec4(position, 1.0);
           vPanelXY = (uPanelInv * _wp).xy;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
          `#include <common>
           uniform float uFadeInner;
           uniform float uFadeOuter;
           uniform vec2  uFadeCenter;
           uniform float uFadeDownStretch;
           uniform float uFadeBottomTaper;
           uniform float uMaxOpacity;
           uniform float uTime;
           uniform float uTwinkleSeed;
           varying vec2  vPanelXY;
           ${hullClipCommon}`)
        .replace('#include <dithering_fragment>',
          `#include <dithering_fragment>
           ${hullClipCall}
           vec2  _delta = vPanelXY - uFadeCenter;
           if (_delta.y < 0.0) _delta.y /= max(uFadeDownStretch, 1e-4);
           float _downN = clamp(-_delta.y / max(uFadeOuter, 1e-4), 0.0, 2.0);
           _delta.x *= 1.0 + uFadeBottomTaper * _downN;
           float _d = length(_delta);
           float _a = (uFadeOuter > uFadeInner)
              ? smoothstep(uFadeInner, uFadeOuter, _d)
              : 1.0;
           // Per-instance twinkle: two sine waves offset by a random seed
           // give a non-periodic-feeling flicker from 0 to full brightness.
           float _t1 = sin(uTime * 1.2 + uTwinkleSeed);
           float _t2 = sin(uTime * 0.7 + uTwinkleSeed * 2.3);
           float _twinkle = clamp(0.5 + 0.65 * (_t1 * 0.6 + _t2 * 0.4), 0.0, 1.0);
           gl_FragColor.a *= _a * uMaxOpacity * _twinkle;`);
    };
  }
  group.userData.strokeTimeUniform = strokeUniforms.uTime;
  group.userData.pulseTimeUniform  = pulseUniforms.uPulseTime;

  const startX = -(cols - 1) * tileStep * 0.5;
  const startY = -(rows - 1) * tileStep * 0.5;
  const inClip = clipPolygon
    ? (x, y) => insideWithMargin(x, y, clipPolygon, clipMargin)
    : () => true;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = startX + c * tileStep;
      const y = startY + r * tileStep;
      if (!inClip(x, y)) continue;
      const mesh = new THREE.Mesh(hexGeo, mat);
      mesh.position.set(x, y, 0);
      mesh.userData.rowIndex = r;
      mesh.userData.baseX = x;
      mesh.userData.baseY = y;
      mesh.userData.pulseSeed = Math.random() * Math.PI * 2;
      mesh.userData.pulseSpeedFactor = 1 + (Math.random() - 0.5) * 2 * pulseSpeedVariance;
      mesh.onBeforeRender = function () {
        pulseUniforms.uPulseSeed.value        = this.userData.pulseSeed;
        pulseUniforms.uPulseSpeedFactor.value = this.userData.pulseSpeedFactor;
      };
      if (edgesGeo) {
        const stroke = new THREE.LineSegments(edgesGeo, lineMat);
        stroke.userData.twinkleSeed = Math.random() * Math.PI * 2;
        stroke.onBeforeRender = function () {
          strokeUniforms.uTwinkleSeed.value = this.userData.twinkleSeed;
        };
        mesh.add(stroke);
      }
      group.add(mesh);
    }
  }

  group.userData.rowCount = rows;
  return group;
}
