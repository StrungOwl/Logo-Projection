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
  color = 0x6B4A1E,
  material = null,
  clipPolygon = null,
  clipMargin = 0,
} = {}) {
  const group = new THREE.Group();

  const mat = material || new THREE.MeshStandardMaterial({
    color,
    metalness: 0.85,
    roughness: 0.35,
  });

  const hexGeo = buildSolidHexGeometry(hexRadius, depth);

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
      group.add(mesh);
    }
  }

  return group;
}
