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

export function createIslamicDome({
  radius = 14,
  height = 18,
  centerY = -1,
  tilesAround = 12,
  tilesVertical = 5,
  rosetteSymmetry = 12,
  tileSize = 1.6,
  reliefDepth = 0.18,
  goldColor = 0xE5A400,
  creamColor = 0xF4E6C2,
} = {}) {
  const group = new THREE.Group();

  group.add(buildCreamBackdrop(radius, height, creamColor));

  const rosetteGeo = buildRosetteGeometry({
    symmetry: rosetteSymmetry,
    hubR: tileSize * 0.18,
    innerR: tileSize * 0.22,
    midR: tileSize * 0.55,
    outerR: tileSize,
    depth: reliefDepth,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: goldColor,
    metalness: 0.9,
    roughness: 0.15,
  });

  // Flat face of the motif sits `reliefDepth` in from the wall so the back of
  // the extrusion meets the cylinder (small epsilon to avoid z-fighting).
  const placementR = radius - reliefDepth - 0.002;
  const rowSpacing = height / tilesVertical;

  for (let v = 0; v < tilesVertical; v++) {
    const y = -height * 0.5 + (v + 0.5) * rowSpacing;
    const rowOffset = (v % 2) * (Math.PI / tilesAround);
    for (let u = 0; u < tilesAround; u++) {
      const theta = (u / tilesAround) * Math.PI * 2 + rowOffset;
      const m = new THREE.Mesh(rosetteGeo, goldMat);
      m.position.set(
        Math.cos(theta) * placementR,
        y,
        Math.sin(theta) * placementR
      );
      m.lookAt(0, y, 0);
      group.add(m);
    }
  }

  group.position.y = centerY;
  return group;
}
