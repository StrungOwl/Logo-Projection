import * as THREE from 'three';
import { pointInPolygon } from '../../util/polygon.js';
import { buildHullClip, buildRadialFade } from '../_shared/shaderPatches.js';

// Re-exported for callers that pulled this helper from the lattice module.
// Authoritative source is util/polygon.js.
export { pointInPolygon };

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
  // Polygon clip (panel-local). Accepts either a single CCW polygon
  // (array of {x,y}) or a list of loops [outer CCW, hole CW, ...] for
  // concave shapes with holes. The fragment shader hard-clips every
  // hex/stroke fragment to the polygon's interior — hexes that overhang
  // get sliced along the polygon edge. Separate from `clipPolygon` so
  // placement can still allow overhang while the rendered edge stays clean.
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
  // Long-form evolution layered on the per-hex pulse. All three layers
  // are stutter-free by construction:
  //   * `noise*`     — a 2D value-noise field on panel coords drifts with
  //                    uEvoTime, modulating brightness/emissive AFTER the
  //                    sine ease. Adds slow-drifting "hot patches" that
  //                    migrate across the wall. Driven by uEvoTime
  //                    (continuous), not uPulseTime — so it keeps moving
  //                    during cascade exit/entry.
  //   * `coherence*` — crossfade between a scattered pulse (per-hex seed +
  //                    speed factor) and a coherent pulse (no seed, no
  //                    factor). Both share uPulseTime so the phase base is
  //                    identical → no jump as coherence varies.
  //   * `emissive*` / `bright*` / `color*` — slow LFOs on the existing
  //                    amplitude/colour uniforms. These are multiplied
  //                    POST-sine so changing them never shifts the phase.
  //                    Periods are intentionally non-harmonic so the three
  //                    LFOs don't lock up.
  evolution = {
    enabled:          true,
    noiseAmp:         0.30,   // ±fraction modulation on bright/emissive
    noiseScale:       0.10,   // patch frequency (panel units⁻¹); 0.10 ≈ ~10-unit patches
    noiseSpeed:       0.04,   // patch drift speed (panel units / sec)
    coherenceMin:     0.20,
    coherenceMax:     1.00,
    coherencePeriod: 65.0,
    emissivePulse:    0.25,   // ±fraction LFO on pulseEmissiveMax
    emissivePeriod:  45.0,
    brightPulse:      0.15,   // ±fraction LFO on pulseBrightMax
    brightPeriod:    55.0,
    colorPulse:       0.10,   // ±fraction RGB scale on pulseColorB
    colorPeriod:     80.0,
  },
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
  //
  // Evolution uniforms layered on top:
  //   uEvoTime    — continuous global clock for the noise field (does NOT
  //                 freeze during cascade motion, unlike uPulseTime).
  //   uCoherence  — 0 (fully synced wall) → 1 (fully scattered). Mixes the
  //                 scattered and coherent sine results AFTER computing both
  //                 from the same uPulseTime, so changing it cannot jump
  //                 the phase of either component.
  //   uNoise*     — spatial value-noise modulator on bright/emissive.
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
    uEvoTime:          { value: 0 },
    uCoherence:        { value: 1 },
    uNoiseAmp:         { value: evolution.enabled ? evolution.noiseAmp   : 0 },
    uNoiseScale:       { value: evolution.noiseScale },
    uNoiseSpeed:       { value: evolution.noiseSpeed },
  };

  if (fadeOuterR > 0 || maxOpacity < 1) {
    mat.transparent = true;
  }

  // Hull-clip + radial-fade GLSL — shared builders (see shaderPatches.js).
  // Emitted text is byte-identical to the previously inlined blocks, so
  // the compiled programs (and fractalZoom's replace anchors) are
  // unchanged.
  const { uniforms: hullClipUniforms,
          glslCommon: hullClipCommon,
          glslCall:   hullClipCall } = buildHullClip(hullClip);
  const radialFadeBody   = buildRadialFade({ variant: 'body',   indent: 9 });
  const radialFadeStroke = buildRadialFade({ variant: 'stroke', indent: 11 });

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
         uniform float uEvoTime;
         uniform float uCoherence;
         uniform float uNoiseAmp;
         uniform float uNoiseScale;
         uniform float uNoiseSpeed;
         varying vec3  vGradWP;
         varying vec2  vPanelXY;
         // Cheap hash → 2D value noise. Used for slow-drifting "hot
         // patches" on the wall (uNoiseScale = patch frequency,
         // uNoiseSpeed = patch drift). Output ∈ [0, 1].
         float _hash21(vec2 p) {
           p = fract(p * vec2(123.34, 456.21));
           p += dot(p, p + 45.32);
           return fract(p.x * p.y);
         }
         float _vnoise2(vec2 p) {
           vec2 i = floor(p), f = fract(p);
           vec2 u = f * f * (3.0 - 2.0 * f);
           float a = _hash21(i);
           float b = _hash21(i + vec2(1.0, 0.0));
           float c = _hash21(i + vec2(0.0, 1.0));
           float d = _hash21(i + vec2(1.0, 1.0));
           return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
         }
         ${hullClipCommon}`)
      .replace('#include <color_fragment>',
        `#include <color_fragment>
         ${hullClipCall}
         float _gt = clamp((vGradWP.y - uGradMinY) / max(uGradMaxY - uGradMinY, 1e-4), 0.0, 1.0);
         // Coherent + scattered pulses share the same uPulseTime * uPulseSpeed
         // phase base, so crossfading via uCoherence cannot jump the
         // sine argument — the wall can drift between unison and scatter
         // without any phase stutter.
         float _scat = 0.5 + 0.5 * sin(uPulseTime * uPulseSpeed * uPulseSpeedFactor + uPulseSeed);
         float _coh  = 0.5 + 0.5 * sin(uPulseTime * uPulseSpeed);
         float _raw  = mix(_coh, _scat, clamp(uCoherence, 0.0, 1.0));
         // smoothstep applied twice = quintic-ish ease-in-out: each hex
         // sits longer at its dim and bright extremes with a snappier glide
         // through the middle, so the pulse reads as a slow held breath
         // rather than constant sweeping motion.
         float _pk = smoothstep(0.0, 1.0, smoothstep(0.0, 1.0, _raw));
         // Spatial noise modulator. Drives off uEvoTime (continuous) so it
         // keeps drifting through cascade motion; multiplied POST-sine so
         // changing amplitude/scale/speed cannot disturb phase.
         vec2  _np    = vPanelXY * uNoiseScale + vec2(uEvoTime * uNoiseSpeed,
                                                       uEvoTime * uNoiseSpeed * 0.73);
         float _nm    = 1.0 + uNoiseAmp * (_vnoise2(_np) - 0.5) * 2.0;
         float _pBright = mix(uPulseBrightMin, uPulseBrightMax, _pk) * _nm;
         float _pEmiss  = mix(uPulseEmissiveMin, uPulseEmissiveMax, _pk) * _nm;
         vec3  _pColor  = mix(uPulseColorA, uPulseColorB, _pk);
         diffuseColor.rgb = _pColor * mix(uGradDark, uGradBright, _gt) * _pBright;`)
      .replace('#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += _pColor * _pEmiss;`)
      .replace('#include <dithering_fragment>',
        `#include <dithering_fragment>
         ${radialFadeBody}`);
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
           ${radialFadeStroke}`);
    };
  }
  group.userData.strokeTimeUniform = strokeUniforms.uTime;
  group.userData.pulseTimeUniform  = pulseUniforms.uPulseTime;

  const startX = -(cols - 1) * tileStep * 0.5;
  const startY = -(rows - 1) * tileStep * 0.5;
  const inClip = clipPolygon
    ? (x, y) => insideWithMargin(x, y, clipPolygon, clipMargin)
    : () => true;

  const tiles = [];
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
        // Per-hex pulse clock — set by the row cascade each frame. Freezes
        // while the hex is in motion so brightness doesn't animate during
        // exit/gap/entry. Falls back to the shared uPulseTime before the
        // cascade has run at least once.
        if (this.userData.pulseTime !== undefined) {
          pulseUniforms.uPulseTime.value = this.userData.pulseTime;
        }
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
      tiles.push(mesh);
    }
  }

  group.userData.rowCount = rows;

  // ------------------------------------------------------------------
  // Instanced fill mirror. The per-hex Meshes above stay in the graph as
  // ANCHORS: the cascade / rotation-pool / fractal-park drivers keep
  // writing their transforms and per-tile pulse clocks, the stroke
  // LineSegments stay parented to them (so spark snap clouds and stroke
  // motion are untouched), and fractalZoom's `underlay.clone(true)`
  // machinery keeps cloning real per-tile meshes with the ORIGINAL
  // uniform-based material — the frozen-uniform snapshot and per-tile
  // reveal stagger inside the fractal dive are preserved bit-for-bit.
  //
  // What changes: the LIVE underlay's fills render through ONE
  // InstancedMesh instead of ~200 draw calls. After the fractal clones
  // are built, the call site invokes userData.finalizeInstancing() which
  // flips `mat.visible = false` (anchors stop drawing; their stroke
  // children still render) and shows this mesh. Every frame the call
  // site invokes userData.syncLatticeInstances() (after cascade /
  // fractal updates) to mirror anchor transforms + pulse clocks into the
  // instance buffers. The per-draw uniform swap (uPulseSeed /
  // uPulseSpeedFactor / per-tile uPulseTime via onBeforeRender) becomes
  // three instanced attributes; aPulseTime < 0 reproduces the "fall back
  // to the shared clock before the cascade has run" behaviour.
  //
  // The instanced material's shader patch keeps every exact-string
  // anchor fractalZoom's clone rewriter targets ('varying vec2
  // vPanelXY;\nuniform mat4 uPanelInv;', 'vPanelXY = (uPanelInv *
  // _wp).xy;', 'uniform float uMaxOpacity;', and the radial-fade alpha
  // line) so cloned copies of this mesh — which ride along invisible
  // inside each fractal clone — still compile cleanly.
  // ------------------------------------------------------------------
  const tileCount = tiles.length;
  let instMesh = null;
  let instTimeAttr = null;
  if (tileCount > 0) {
    const instMat = mat.clone();       // clone() drops onBeforeCompile
    instMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, fadeGradUniforms, pulseUniforms);
      if (hullClipUniforms) Object.assign(shader.uniforms, hullClipUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>',
          '#include <common>\nvarying vec3 vGradWP;\nvarying vec2 vPanelXY;\nuniform mat4 uPanelInv;'
          + '\nattribute float aPulseSeed;'
          + '\nattribute float aPulseSpeedFactor;'
          + '\nattribute float aPulseTime;'
          + '\nvarying float vPulseSeed;'
          + '\nvarying float vPulseSpeedFactor;'
          + '\nvarying float vPulseTime;')
        .replace('#include <project_vertex>',
          `#include <project_vertex>
         vec4 _wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
         vGradWP = _wp.xyz;
         vPanelXY = (uPanelInv * _wp).xy;
         vPulseSeed = aPulseSeed;
         vPulseSpeedFactor = aPulseSpeedFactor;
         vPulseTime = aPulseTime;`);
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
         uniform float uPulseBrightMin;
         uniform float uPulseBrightMax;
         uniform float uPulseEmissiveMin;
         uniform float uPulseEmissiveMax;
         uniform vec3  uPulseColorA;
         uniform vec3  uPulseColorB;
         uniform float uEvoTime;
         uniform float uCoherence;
         uniform float uNoiseAmp;
         uniform float uNoiseScale;
         uniform float uNoiseSpeed;
         varying vec3  vGradWP;
         varying vec2  vPanelXY;
         varying float vPulseSeed;
         varying float vPulseSpeedFactor;
         varying float vPulseTime;
         // Cheap hash → 2D value noise. Used for slow-drifting "hot
         // patches" on the wall (uNoiseScale = patch frequency,
         // uNoiseSpeed = patch drift). Output ∈ [0, 1].
         float _hash21(vec2 p) {
           p = fract(p * vec2(123.34, 456.21));
           p += dot(p, p + 45.32);
           return fract(p.x * p.y);
         }
         float _vnoise2(vec2 p) {
           vec2 i = floor(p), f = fract(p);
           vec2 u = f * f * (3.0 - 2.0 * f);
           float a = _hash21(i);
           float b = _hash21(i + vec2(1.0, 0.0));
           float c = _hash21(i + vec2(0.0, 1.0));
           float d = _hash21(i + vec2(1.0, 1.0));
           return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
         }
         ${hullClipCommon}`)
        .replace('#include <color_fragment>',
          `#include <color_fragment>
         ${hullClipCall}
         float _gt = clamp((vGradWP.y - uGradMinY) / max(uGradMaxY - uGradMinY, 1e-4), 0.0, 1.0);
         // Per-tile clock: aPulseTime mirrors the anchor's frozen-while-
         // moving clock; negative = "not yet set by the cascade", fall
         // back to the shared live uPulseTime (same rule the per-mesh
         // onBeforeRender override implemented).
         float _pt = vPulseTime >= 0.0 ? vPulseTime : uPulseTime;
         // Coherent + scattered pulses share the same phase base, so
         // crossfading via uCoherence cannot jump the sine argument.
         float _scat = 0.5 + 0.5 * sin(_pt * uPulseSpeed * vPulseSpeedFactor + vPulseSeed);
         float _coh  = 0.5 + 0.5 * sin(_pt * uPulseSpeed);
         float _raw  = mix(_coh, _scat, clamp(uCoherence, 0.0, 1.0));
         // smoothstep applied twice = quintic-ish ease-in-out: each hex
         // sits longer at its dim and bright extremes with a snappier glide
         // through the middle, so the pulse reads as a slow held breath
         // rather than constant sweeping motion.
         float _pk = smoothstep(0.0, 1.0, smoothstep(0.0, 1.0, _raw));
         // Spatial noise modulator. Drives off uEvoTime (continuous) so it
         // keeps drifting through cascade motion; multiplied POST-sine so
         // changing amplitude/scale/speed cannot disturb phase.
         vec2  _np    = vPanelXY * uNoiseScale + vec2(uEvoTime * uNoiseSpeed,
                                                       uEvoTime * uNoiseSpeed * 0.73);
         float _nm    = 1.0 + uNoiseAmp * (_vnoise2(_np) - 0.5) * 2.0;
         float _pBright = mix(uPulseBrightMin, uPulseBrightMax, _pk) * _nm;
         float _pEmiss  = mix(uPulseEmissiveMin, uPulseEmissiveMax, _pk) * _nm;
         vec3  _pColor  = mix(uPulseColorA, uPulseColorB, _pk);
         diffuseColor.rgb = _pColor * mix(uGradDark, uGradBright, _gt) * _pBright;`)
        .replace('#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
         totalEmissiveRadiance += _pColor * _pEmiss;`)
        .replace('#include <dithering_fragment>',
          `#include <dithering_fragment>
         ${radialFadeBody}`);
    };

    const seedArr  = new Float32Array(tileCount);
    const speedArr = new Float32Array(tileCount);
    for (let i = 0; i < tileCount; i++) {
      seedArr[i]  = tiles[i].userData.pulseSeed;
      speedArr[i] = tiles[i].userData.pulseSpeedFactor;
    }
    hexGeo.setAttribute('aPulseSeed',
      new THREE.InstancedBufferAttribute(seedArr, 1));
    hexGeo.setAttribute('aPulseSpeedFactor',
      new THREE.InstancedBufferAttribute(speedArr, 1));
    instTimeAttr = new THREE.InstancedBufferAttribute(
      new Float32Array(tileCount).fill(-1), 1);
    instTimeAttr.setUsage(THREE.DynamicDrawUsage);
    hexGeo.setAttribute('aPulseTime', instTimeAttr);

    instMesh = new THREE.InstancedMesh(hexGeo, instMat, tileCount);
    instMesh.name = 'lattice-instanced';
    instMesh.frustumCulled = false;
    instMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Tiny sort-z bias: the transparent pass depth-ties this mesh with
    // the per-hex strokes (all at group z), and the id tiebreak would
    // draw the fill LAST — over its own strokes. Biasing the object back
    // by 0.002 (and compensating inside every instance matrix, so world
    // positions are unchanged) makes the fill sort strictly before the
    // strokes, matching the old fill-then-stroke ordering.
    instMesh.position.z = -0.002;
    instMesh.visible = false;          // shown by finalizeInstancing()
    const _im = new THREE.Matrix4();
    for (let i = 0; i < tileCount; i++) {
      _im.makeTranslation(tiles[i].position.x, tiles[i].position.y, 0.002);
      instMesh.setMatrixAt(i, _im);
    }
    group.add(instMesh);
  }

  // Called by the effects wiring AFTER fractalZoom has cloned the
  // per-mesh originals: swap the live render path to the instanced fill.
  group.userData.finalizeInstancing = () => {
    if (!instMesh) return;
    instMesh.visible = true;
    mat.visible = false;               // anchors stop drawing; strokes stay
  };
  // Called once per frame (after cascade / fractal drivers have written
  // anchor transforms) to mirror anchors → instance buffers.
  group.userData.syncLatticeInstances = () => {
    if (!instMesh || !instMesh.visible || !group.visible) return;
    const mArr = instMesh.instanceMatrix.array;
    const tArr = instTimeAttr.array;
    for (let i = 0; i < tileCount; i++) {
      const tile = tiles[i];
      const rz = tile.rotation.z;
      const sx = tile.scale.x, sy = tile.scale.y, sz = tile.scale.z;
      const c = Math.cos(rz), s = Math.sin(rz);
      const o = i * 16;
      mArr[o]      = c * sx;  mArr[o + 1]  = s * sx;  mArr[o + 2]  = 0;  mArr[o + 3]  = 0;
      mArr[o + 4]  = -s * sy; mArr[o + 5]  = c * sy;  mArr[o + 6]  = 0;  mArr[o + 7]  = 0;
      mArr[o + 8]  = 0;       mArr[o + 9]  = 0;       mArr[o + 10] = sz; mArr[o + 11] = 0;
      mArr[o + 12] = tile.position.x;
      mArr[o + 13] = tile.position.y;
      mArr[o + 14] = tile.position.z + 0.002;   // cancel the object z bias
      mArr[o + 15] = 1;
      tArr[i] = tile.userData.pulseTime !== undefined ? tile.userData.pulseTime : -1;
    }
    instMesh.instanceMatrix.needsUpdate = true;
    instTimeAttr.needsUpdate = true;
  };

  // --- Long-form evolution updater ---------------------------------------
  // Captured base values so LFOs oscillate around the configured settings
  // without drift. Three layers, all stutter-free:
  //   1. Sets uEvoTime → drives the spatial noise field in the fragment
  //      shader. Advances every frame (no cascade freeze).
  //   2. LFOs uPulseEmissiveMax / uPulseBrightMax / uPulseColorB. These
  //      are all multiplied POST-sine in the shader, so changing them at
  //      any rate cannot shift the pulse phase.
  //   3. LFOs uCoherence. The shader mixes a scattered and coherent pulse
  //      that share the same uPulseTime base, so this crossfade also
  //      cannot disturb phase.
  // The pulse phase argument (uPulseTime, uPulseSpeed, uPulseSpeedFactor,
  // uPulseSeed) is NEVER touched here — that is the stutter guarantee.
  const baseEmissiveMax = pulseEmissiveMax;
  const baseBrightMax   = pulseBrightMax;
  const baseColorBR     = pulseColorB[0];
  const baseColorBG     = pulseColorB[1];
  const baseColorBB     = pulseColorB[2];
  const evoEnabled        = !!evolution.enabled;
  const evoEmissivePulse  = evolution.emissivePulse;
  const evoEmissivePeriod = Math.max(evolution.emissivePeriod, 1e-3);
  const evoBrightPulse    = evolution.brightPulse;
  const evoBrightPeriod   = Math.max(evolution.brightPeriod,   1e-3);
  const evoColorPulse     = evolution.colorPulse;
  const evoColorPeriod    = Math.max(evolution.colorPeriod,    1e-3);
  const evoCohMin         = evolution.coherenceMin;
  const evoCohMax         = evolution.coherenceMax;
  const evoCohPeriod      = Math.max(evolution.coherencePeriod, 1e-3);
  const TAU = Math.PI * 2;
  group.userData.updateEvolution = (t) => {
    pulseUniforms.uEvoTime.value = t;
    if (!evoEnabled) return;
    const cohN = 0.5 + 0.5 * Math.sin(t * TAU / evoCohPeriod);
    pulseUniforms.uCoherence.value = evoCohMin + (evoCohMax - evoCohMin) * cohN;
    pulseUniforms.uPulseEmissiveMax.value =
      baseEmissiveMax * (1 + evoEmissivePulse * Math.sin(t * TAU / evoEmissivePeriod));
    pulseUniforms.uPulseBrightMax.value =
      baseBrightMax * (1 + evoBrightPulse * Math.sin(t * TAU / evoBrightPeriod));
    // Hue tilt within the warm family: opposite-sign drift on R and B
    // around the configured base. G stays fixed so the colour never
    // crosses into cool tones — only the gold↔amber balance shifts.
    const cPhase = Math.sin(t * TAU / evoColorPeriod);
    const cv = pulseUniforms.uPulseColorB.value;
    cv.x = baseColorBR * (1 + evoColorPulse * cPhase);
    cv.y = baseColorBG;
    cv.z = baseColorBB * (1 - evoColorPulse * cPhase);
  };

  return group;
}
