import * as THREE from 'three';

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

// Offset each vertex of a convex polygon inward toward the centroid by
// `distance`. Fine for convex hulls; for concave polygons this would
// need a proper polygon-offset routine.
function insetConvex(poly, distance) {
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p.x; cy += p.y; }
  cx /= poly.length; cy /= poly.length;
  return poly.map(p => {
    const dx = cx - p.x, dy = cy - p.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / d) * distance, y: p.y + (dy / d) * distance };
  });
}

// Walk a closed polygon by arc length and return `count` evenly-spaced
// points around the perimeter, each with a position and an outward
// tangent (pointing along the edge, CCW).
function samplePerimeter(poly, count) {
  const segLens = [];
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segLens.push(len);
    total += len;
  }
  const out = [];
  const step = total / count;
  for (let k = 0; k < count; k++) {
    let target = k * step;
    for (let i = 0; i < poly.length; i++) {
      if (target <= segLens[i]) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const f = segLens[i] > 0 ? target / segLens[i] : 0;
        out.push({
          x: a.x + (b.x - a.x) * f,
          y: a.y + (b.y - a.y) * f,
          tx: (b.x - a.x) / (segLens[i] || 1),
          ty: (b.y - a.y) / (segLens[i] || 1),
        });
        break;
      }
      target -= segLens[i];
    }
  }
  return out;
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
} = {}) {
  const group = new THREE.Group();

  const mat = material || new THREE.MeshStandardMaterial({
    color,
    metalness: 0.7,
    roughness: 0.3,
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

  const inner = insetConvex(hull, frameWidth);
  const bodyShape = buildRingShape(hull, inner);
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
  const innerLipOuter = insetConvex(hull, frameWidth - lipWidth);
  const innerLipShape = buildRingShape(innerLipOuter, inner);
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
  const outerLipInner = insetConvex(hull, lipWidth);
  const outerLipShape = buildRingShape(hull, outerLipInner);
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

    const midline = insetConvex(hull, frameWidth * 0.5);
    const samples = samplePerimeter(midline, bossCount);
    for (const s of samples) {
      const mesh = new THREE.Mesh(bossGeo, mat);
      mesh.position.set(s.x, s.y, frameDepth + lipDepth - 0.01);
      mesh.rotation.z = Math.atan2(s.ty, s.tx);
      group.add(mesh);
    }
  }

  return group;
}
