// Shared brick-geometry helpers used by both fireplace effects.
//
// Originally duplicated between patterns/arch.js and patterns/fireplace.js
// — extracted here so both fireplace effect files (fireplaceOne/fireplaceTiles.js
// and fireplaceTwo/outerArch.js) share one implementation.

import * as THREE from 'three';

// Position-keyed pseudo-random hash. Same (x, y, z, salt) input always
// returns the same value, so shared cuboid corners get the same vertex
// jitter and bricks stay welded (no cracks at face boundaries).
export function hash01(x, y, z, salt) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + salt * 91.345) * 43758.5453;
  return s - Math.floor(s);
}

// BoxGeometry shrunk by mortarGap, then jittered per-vertex by a
// position-keyed hash. Bricks stay inside their slot (no overlap with
// neighbours), and shared corners stay welded.
//
// dims: { width, height, depth, mortarGap, faultAmount }
export function makeBrickGeometry(seed, dims) {
  const { width, height, depth, mortarGap, faultAmount } = dims;
  const geo = new THREE.BoxGeometry(width, height, depth, 1, 1, 1);
  const pos = geo.attributes.position;
  const sx = Math.max(0, 1 - (mortarGap * 2) / width);
  const sy = Math.max(0, 1 - (mortarGap * 2) / height);
  const sz = Math.max(0, 1 - (mortarGap * 2) / depth);
  const maxJ = Math.min(faultAmount * depth, mortarGap);
  for (let i = 0; i < pos.count; i++) {
    const ox = pos.getX(i), oy = pos.getY(i), oz = pos.getZ(i);
    const dx = (hash01(ox, oy, oz, seed +  3.1) - 0.5) * 2 * maxJ;
    const dy = (hash01(ox, oy, oz, seed + 17.7) - 0.5) * 2 * maxJ;
    const dz = (hash01(ox, oy, oz, seed + 41.3) - 0.5) * 2 * maxJ;
    pos.setXYZ(i, ox * sx + dx, oy * sy + dy, oz * sz + dz);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// Quaternion that maps brick-local axes onto chosen world directions.
// Each parameter is a unit world-space vector for the corresponding local
// axis. Three.js' Matrix4.makeBasis takes the columns of the rotation
// matrix in this exact order.
const _basisMat = new THREE.Matrix4();
export function basisQuat(localX, localY, localZ) {
  _basisMat.makeBasis(localX, localY, localZ);
  return new THREE.Quaternion().setFromRotationMatrix(_basisMat);
}
