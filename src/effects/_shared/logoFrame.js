import * as THREE from 'three';
import { insetPolygon, samplePerimeter, samplePolyline, clipArcAboveY } from '../../util/polygon.js';

// Re-exported for callers that already pulled these helpers from
// gate-frame's module path. Authoritative source is util/polygon.js.
export { insetPolygon, samplePerimeter, samplePolyline, clipArcAboveY };

// Build a Shape whose outer boundary follows `outer` (CCW) and whose
// single hole follows `inner` (reversed so it's CW relative to the outer).
function buildRingShape(outer, inner) {
  const shape = new THREE.Shape();
  shape.moveTo(outer[0].x, outer[0].y);
  for (let i = 1; i < outer.length; i++) shape.lineTo(outer[i].x, outer[i].y);
  shape.closePath();

  const hole = new THREE.Path();
  hole.moveTo(inner[inner.length - 1].x, inner[inner.length - 1].y);
  for (let i = inner.length - 2; i >= 0; i--) hole.lineTo(inner[i].x, inner[i].y);
  hole.closePath();
  shape.holes.push(hole);
  return shape;
}

// Build a solid (no-hole) Shape whose outline is: outerArc forward, then
// innerArc reversed. Both arcs are walked CCW and share a y-level at their
// endpoints, so the resulting outline is a closed ring with two flat feet.
function buildArchShape(outerArc, innerArc) {
  const shape = new THREE.Shape();
  shape.moveTo(outerArc[0].x, outerArc[0].y);
  for (let i = 1; i < outerArc.length; i++) shape.lineTo(outerArc[i].x, outerArc[i].y);
  for (let i = innerArc.length - 1; i >= 0; i--) shape.lineTo(innerArc[i].x, innerArc[i].y);
  shape.closePath();
  return shape;
}

function polylineLength(pts) {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  }
  return total;
}

function polygonPerimeter(poly) {
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

// Gate-like frame following an arbitrary convex silhouette:
//   body       — extruded ring between `hull` and an inward-offset inner edge
//   innerLip   — thin raised band along the inner edge (door-jamb step)
//   outerLip   — thin raised band along the outer edge (outer moulding)
//   bosses     — evenly-spaced studs along the ring for ornate detail
//
// `hull` must be given in CCW order in local coords (already centred on
// whatever origin you want the frame to sit on).
export function createGateFrame({
  hull,
  frameWidth = 1.4,
  frameDepth = 0.45,
  lipWidth = 0.25,
  lipDepth = 0.18,
  bossCount = 48,
  bossRadius = 0.22,
  bossDepth = 0.22,
  color = 0xD9B77C,
  material = null,
  gradientMinY = -5,
  gradientMaxY = 5,
  gradientDark = [0.7, 0.58, 0.42],
  gradientBright = [1.0, 1.0, 1.0],
  bottomCutY = null,
  innerOffsetter = insetPolygon,
} = {}) {
  const group = new THREE.Group();

  const mat = material || new THREE.MeshStandardMaterial({
    color,
    metalness: 0.7,
    roughness: 0.3,
    envMapIntensity: 0.3,
  });

  const gradUniforms = {
    uGradMinY:    { value: gradientMinY },
    uGradMaxY:    { value: gradientMaxY },
    uGradDark:    { value: new THREE.Vector3(...gradientDark) },
    uGradBright:  { value: new THREE.Vector3(...gradientBright) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, gradUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nvarying vec3 vGradWP;')
      .replace('#include <project_vertex>',
        '#include <project_vertex>\nvGradWP = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        `#include <common>
         uniform float uGradMinY;
         uniform float uGradMaxY;
         uniform vec3  uGradDark;
         uniform vec3  uGradBright;
         varying vec3  vGradWP;`)
      .replace('#include <color_fragment>',
        `#include <color_fragment>
         float _gt = clamp((vGradWP.y - uGradMinY) / max(uGradMaxY - uGradMinY, 1e-4), 0.0, 1.0);
         diffuseColor.rgb *= mix(uGradDark, uGradBright, _gt);`);
  };
  group.userData.gradUniforms = gradUniforms;

  const inner = innerOffsetter(hull, frameWidth);
  const innerLipOuter = innerOffsetter(hull, frameWidth - lipWidth);
  const outerLipInner = innerOffsetter(hull, lipWidth);
  const midline = innerOffsetter(hull, frameWidth * 0.5);

  const clip = bottomCutY !== null;
  const outerArc = clip ? clipArcAboveY(hull, bottomCutY) : null;
  const innerArc = clip ? clipArcAboveY(inner, bottomCutY) : null;
  const innerLipOuterArc = clip ? clipArcAboveY(innerLipOuter, bottomCutY) : null;
  const outerLipInnerArc = clip ? clipArcAboveY(outerLipInner, bottomCutY) : null;
  const midlineArc = clip ? clipArcAboveY(midline, bottomCutY) : null;

  const bodyShape = clip
    ? buildArchShape(outerArc, innerArc)
    : buildRingShape(hull, inner);
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
    depth: frameDepth,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.035,
    bevelSegments: 3,
    curveSegments: 2,
  });
  group.add(new THREE.Mesh(bodyGeo, mat));

  // Inner lip — raised above the body, narrow band on the inside edge.
  const innerLipShape = clip
    ? buildArchShape(innerLipOuterArc, innerArc)
    : buildRingShape(innerLipOuter, inner);
  const innerLipGeo = new THREE.ExtrudeGeometry(innerLipShape, {
    depth: lipDepth,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.025,
    bevelSegments: 2,
    curveSegments: 2,
  });
  const innerLip = new THREE.Mesh(innerLipGeo, mat);
  innerLip.position.z = frameDepth;
  group.add(innerLip);

  // Outer lip — matching raised band on the outer edge.
  const outerLipShape = clip
    ? buildArchShape(outerArc, outerLipInnerArc)
    : buildRingShape(hull, outerLipInner);
  const outerLipGeo = new THREE.ExtrudeGeometry(outerLipShape, {
    depth: lipDepth,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.025,
    bevelSegments: 2,
    curveSegments: 2,
  });
  const outerLip = new THREE.Mesh(outerLipGeo, mat);
  outerLip.position.z = frameDepth;
  group.add(outerLip);

  // Bosses — short octagonal studs at the middle of the ring.
  if (bossCount > 0 && bossRadius > 0) {
    const bossShape = new THREE.Shape();
    const sides = 8;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const x = Math.cos(a) * bossRadius, y = Math.sin(a) * bossRadius;
      if (i === 0) bossShape.moveTo(x, y); else bossShape.lineTo(x, y);
    }
    bossShape.closePath();
    const bossGeo = new THREE.ExtrudeGeometry(bossShape, {
      depth: bossDepth,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
      bevelSegments: 2,
    });

    let samples;
    if (clip && midlineArc && midlineArc.length >= 2) {
      // Keep boss density constant — scale count by arc length vs full perimeter.
      const fullLen = polygonPerimeter(midline);
      const arcLen = polylineLength(midlineArc);
      const effectiveCount = Math.max(1, Math.round(bossCount * (arcLen / fullLen)));
      samples = samplePolyline(midlineArc, effectiveCount);
    } else {
      samples = samplePerimeter(midline, bossCount);
    }
    for (const s of samples) {
      const mesh = new THREE.Mesh(bossGeo, mat);
      mesh.position.set(s.x, s.y, frameDepth + lipDepth - 0.01);
      mesh.rotation.z = Math.atan2(s.ty, s.tx);
      group.add(mesh);
    }
  }

  // Expose the shared material + gradient uniforms so callers (main.js)
  // can recolor the frame for special modes (e.g. fiery silhouette in
  // flame-only mode 6) without re-traversing the group.
  group.userData.frameMaterial = mat;
  group.userData.gradUniforms  = gradUniforms;
  return group;
}
