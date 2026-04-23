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

// Elongated 4-point lozenge — the "strapwork" that links neighbouring rosettes.
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

// Six-point star knot — sits at each grid crossing where four straps meet,
// tying the web together.
function buildKnotGeometry(size, depth) {
  return new THREE.ExtrudeGeometry(buildHubStar(6, size, size * 0.5), {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 2,
  });
}

function buildCreamBackdrop(radius, height, color) {
  const geo = new THREE.CylinderGeometry(radius, radius, height, 96, 1, true);
  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.0,
    roughness: 0.8,
    side: THREE.BackSide,
  });
  return new THREE.Mesh(geo, mat);
}

// Place a flat mesh on the inside wall of the cylinder at (theta, y),
// oriented so its flat face points at the centre. Optional in-plane rotation
// `rollZ` spins the mesh around its local Z (tangent plane normal) — used to
// swing horizontal straps into vertical straps.
function placeOnCylinder(mesh, placementR, theta, y, rollZ = 0) {
  mesh.position.set(
    Math.cos(theta) * placementR,
    y,
    Math.sin(theta) * placementR
  );
  mesh.lookAt(0, y, 0);
  if (rollZ !== 0) mesh.rotateZ(rollZ);
}

export function createIslamicDome({
  radius = 14,
  height = 18,
  centerY = -1,
  tilesAround = 14,
  tilesVertical = 5,
  mainSymmetry = 12,
  mainTileSize = 1.45,
  secondarySymmetry = 8,
  secondaryScale = 0.55,
  reliefDepth = 0.18,
  strapHalfWidth = 0.18,
  knotSize = 0.42,
  goldColor = 0xE5A400,
  creamColor = 0xF4E6C2,
} = {}) {
  const group = new THREE.Group();

  group.add(buildCreamBackdrop(radius, height, creamColor));

  const goldMat = new THREE.MeshStandardMaterial({
    color: goldColor,
    metalness: 0.9,
    roughness: 0.15,
  });

  // --- Geometries built once, reused across all instances ---
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

  // --- Layout maths ---
  const angleStep = (Math.PI * 2) / tilesAround;
  const rowSpacing = height / tilesVertical;
  const placementR = radius - reliefDepth - 0.002;
  const rowY = (v) => -height * 0.5 + (v + 0.5) * rowSpacing;

  // Chord distance between two adjacent tile centres along the circumference.
  const chord = 2 * placementR * Math.sin(angleStep * 0.5);

  // Straps reach from one rosette's outer tip to its neighbour's outer tip,
  // with a small overlap so it visually reads as joined.
  const hGap = chord - mainTileSize - secondarySize;
  const vGap = rowSpacing - mainTileSize - secondarySize;
  const hStrapLen = Math.max(0.3, hGap + 0.35);
  const vStrapLen = Math.max(0.3, vGap + 0.35);

  const hStrapGeo = buildStrapGeometry(hStrapLen, strapHalfWidth, reliefDepth * 0.75);
  const vStrapGeo = buildStrapGeometry(vStrapLen, strapHalfWidth, reliefDepth * 0.75);
  const knotGeo = buildKnotGeometry(knotSize, reliefDepth * 0.9);

  // --- Alternating rosette grid: main and secondary on a checkerboard ---
  for (let v = 0; v < tilesVertical; v++) {
    const y = rowY(v);
    for (let u = 0; u < tilesAround; u++) {
      const theta = u * angleStep;
      const isMain = (u + v) % 2 === 0;
      const mesh = new THREE.Mesh(isMain ? mainGeo : secondaryGeo, goldMat);
      placeOnCylinder(mesh, placementR, theta, y);
      group.add(mesh);
    }
  }

  // --- Horizontal straps at midpoint between every pair of row-neighbours ---
  for (let v = 0; v < tilesVertical; v++) {
    const y = rowY(v);
    for (let u = 0; u < tilesAround; u++) {
      const theta = (u + 0.5) * angleStep;
      const mesh = new THREE.Mesh(hStrapGeo, goldMat);
      placeOnCylinder(mesh, placementR, theta, y);
      group.add(mesh);
    }
  }

  // --- Vertical straps at midpoint between every pair of stacked neighbours ---
  for (let v = 0; v < tilesVertical - 1; v++) {
    const y = (rowY(v) + rowY(v + 1)) * 0.5;
    for (let u = 0; u < tilesAround; u++) {
      const theta = u * angleStep;
      const mesh = new THREE.Mesh(vStrapGeo, goldMat);
      placeOnCylinder(mesh, placementR, theta, y, Math.PI * 0.5);
      group.add(mesh);
    }
  }

  // --- Knots at every grid crossing (corner between 4 tiles) ---
  for (let v = 0; v < tilesVertical - 1; v++) {
    const y = (rowY(v) + rowY(v + 1)) * 0.5;
    for (let u = 0; u < tilesAround; u++) {
      const theta = (u + 0.5) * angleStep;
      const mesh = new THREE.Mesh(knotGeo, goldMat);
      placeOnCylinder(mesh, placementR, theta, y);
      group.add(mesh);
    }
  }

  group.position.y = centerY;
  return group;
}
