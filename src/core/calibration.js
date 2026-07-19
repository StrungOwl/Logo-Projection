// Calibration patterns for lining up the projection in TouchDesigner
// (Kantan Mapper / Stoner) or the built-in corner-pin warp.
//
//   viewMode 'calibration' (key 9) shows ONLY these patterns; 'C' cycles:
//   off → fill → outline → grid → checker → corners
//
// Two kinds of pattern, deliberately different spaces:
//   - fill / outline are the logo silhouette in WORLD space (they inherit
//     the logo transform), for aligning the projected silhouette onto the
//     physical surface.
//   - grid / checker / corners are SCREEN space (one fullscreen triangle
//     shaded from gl_FragCoord), for judging warp/keystone quality. They
//     must traverse the exact same output chain as content — same
//     composer, same warp — so they draw inside the normal scene pass.

import * as THREE from 'three';
import { ANIM } from '../config.js';
import { buildSilhouetteShape } from '../util/geometry.js';

export const CAL_PATTERNS = ['off', 'fill', 'outline', 'grid', 'checker', 'corners'];

export function createCalibration({ scene, logoMesh, meta }) {
  if (!ANIM.calibration) ANIM.calibration = { pattern: 'off' };

  // ---- silhouette group (world space, matches logo transform) ----------
  const silGroup = new THREE.Group();
  silGroup.name = 'calibration-silhouette';
  // Copy the logo's world transform once instead of parenting under the
  // model — the model itself is hidden while calibration is active.
  silGroup.matrixAutoUpdate = false;
  silGroup.matrix.copy(logoMesh.matrixWorld);
  scene.add(silGroup);

  const zFill = meta.maxZ + 0.6;

  // Fill: white silhouette plate (outer loop + cutout holes). Overbright
  // color so it still lands ≥ 0.99 after ACES once the composer arrives.
  const fillMesh = new THREE.Mesh(
    new THREE.ShapeGeometry(buildSilhouetteShape(meta.silhouette)),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4) }),
  );
  fillMesh.position.z = zFill;
  silGroup.add(fillMesh);

  // Outline: one line loop per silhouette loop (outer + each cutout).
  const outlineGroup = new THREE.Group();
  const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(4, 4, 4) });
  for (const loop of meta.silhouette) {
    const pts = loop.map(p => new THREE.Vector3(p.x, p.y, zFill));
    outlineGroup.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  }
  silGroup.add(outlineGroup);

  // ---- screen-space patterns (fullscreen triangle) ---------------------
  const screenGeo = new THREE.BufferGeometry();
  screenGeo.setAttribute('position', new THREE.BufferAttribute(
    new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const screenMat = new THREE.ShaderMaterial({
    uniforms: {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uPattern:    { value: 0 },     // 1 grid, 2 checker, 3 corners
      uSpacing:    { value: 64.0 },  // px per cell
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */`
      void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */`
      uniform vec2  uResolution;
      uniform int   uPattern;
      uniform float uSpacing;
      void main() {
        vec2 p = gl_FragCoord.xy;
        vec2 r = uResolution;
        vec3 col = vec3(0.0);
        if (uPattern == 1) {
          // Minor grid + brighter major line every 4 cells + red crosshair.
          vec2 g  = mod(p, uSpacing);
          vec2 g4 = mod(p, uSpacing * 4.0);
          float minor = (g.x  < 1.5 || g.y  < 1.5) ? 1.0 : 0.0;
          float major = (g4.x < 2.5 || g4.y < 2.5) ? 1.0 : 0.0;
          col = vec3(max(minor * 0.35, major));
          vec2 c = abs(p - r * 0.5);
          if (c.x < 2.0 || c.y < 2.0) col = vec3(1.0, 0.25, 0.15);
        } else if (uPattern == 2) {
          vec2 q = floor(p / uSpacing);
          col = vec3(mod(q.x + q.y, 2.0));
        } else if (uPattern == 3) {
          // Border + gold corner L-marks + red center cross.
          float b = 3.0;
          if (p.x < b || p.y < b || p.x > r.x - b || p.y > r.y - b) col = vec3(1.0);
          float L = min(r.x, r.y) * 0.08;
          vec2 q = min(p, r - p);
          if ((q.x < b * 2.0 && q.y < L) || (q.y < b * 2.0 && q.x < L)) col = vec3(1.0, 0.8, 0.2);
          vec2 c = abs(p - r * 0.5);
          if ((c.x < b && c.y < L) || (c.y < b && c.x < L)) col = vec3(1.0, 0.25, 0.15);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const screenMesh = new THREE.Mesh(screenGeo, screenMat);
  screenMesh.name = 'calibration-screen';
  screenMesh.frustumCulled = false;
  screenMesh.renderOrder = 1000;
  scene.add(screenMesh);

  const drawSize = new THREE.Vector2();

  function setPattern(name) {
    if (!CAL_PATTERNS.includes(name)) return;
    ANIM.calibration.pattern = name;
  }

  function cyclePattern() {
    const i = CAL_PATTERNS.indexOf(ANIM.calibration.pattern);
    setPattern(CAL_PATTERNS[(i + 1) % CAL_PATTERNS.length]);
    return ANIM.calibration.pattern;
  }

  // Per-frame: asserts visibility from viewMode + pattern, syncs the
  // screen-shader resolution to the current drawing buffer.
  function update(renderer, calibrationActive) {
    const pattern = calibrationActive ? (ANIM.calibration.pattern || 'off') : 'off';
    fillMesh.visible     = pattern === 'fill';
    outlineGroup.visible = pattern === 'outline';
    const screenIdx = { grid: 1, checker: 2, corners: 3 }[pattern] || 0;
    screenMesh.visible = screenIdx > 0;
    if (screenIdx > 0) {
      screenMat.uniforms.uPattern.value = screenIdx;
      renderer.getDrawingBufferSize(drawSize);
      screenMat.uniforms.uResolution.value.copy(drawSize);
    }
    silGroup.visible = fillMesh.visible || outlineGroup.visible;
  }

  return { setPattern, cyclePattern, update, patterns: CAL_PATTERNS };
}
