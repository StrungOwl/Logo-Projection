// Loads the 3D logo, applies the amber metallic material + vertical
// gradient tint, computes the silhouette metadata downstream layers need
// (convex hull of the front face, inner-star centroid, bounding box),
// and attaches the galaxy backdrop plate right behind the front face.
//
// Everything except the final `scene.add(model)` is done here so that
// the patterns and particles layers can be wired onto `logoMesh` before
// the model's world transform is finalised.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader }  from 'three/addons/loaders/OBJLoader.js';
import { MODEL, COLORS } from './config.js';
import { hexToRgb } from './util/color.js';
import { applyGradientTint } from './shaders/gradient-tint.js';
import { createGalaxyMaterial } from './shaders/galaxy.js';

// Extension-aware loader — picks GLTFLoader for .glb/.gltf, OBJLoader for
// .obj. Hands back a single Object3D root so callers don't care about the
// source format.
function loadModelByExt(path, onDone, onError) {
  const ext = path.split('.').pop().toLowerCase();
  if (ext === 'glb' || ext === 'gltf') {
    new GLTFLoader().load(path, (gltf) => onDone(gltf.scene), undefined, onError);
  } else if (ext === 'obj') {
    new OBJLoader().load(path, onDone, undefined, onError);
  } else {
    console.error('Unsupported model format:', ext, '(' + path + ')');
  }
}

// Andrew's monotone-chain 2D convex hull. Returns a CCW-ish outline with
// no holes, so the galaxy plate + pattern clip polygons always cover the
// full silhouette even if the source geometry has internal cutouts.
function convexHull2D(pts) {
  const sorted = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (O, A, B) => (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

// Load the logo and return a promise resolving to a bundle of objects +
// metadata that the patterns/particles layers need.
export function loadLogo() {
  return new Promise((resolve, reject) => {
    loadModelByExt(MODEL.path, (model) => {
      // Center the model at origin before scaling.
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      model.position.sub(box.getCenter(new THREE.Vector3()));

      // Apply amber metallic + vertical gradient tint to every mesh.
      // Collect materials so the animate loop can breathe their base color.
      const logoMaterials = [];
      model.traverse((child) => {
        if (child.isMesh) {
          child.material = new THREE.MeshStandardMaterial({
            color: COLORS.logo.base,
            metalness: COLORS.logo.metalness,
            roughness: COLORS.logo.roughness,
            flatShading: true,
          });
          child.geometry.computeVertexNormals();
          applyGradientTint(child.material, {
            minY: -5.5,
            maxY: 3.5,
            darkTint:   hexToRgb(COLORS.logo.gradientDark),
            brightTint: hexToRgb(COLORS.logo.gradientBright),
          });
          logoMaterials.push(child.material);
        }
      });

      // Pick the mesh with the highest vertex count — robust against any
      // silhouette children added later. Everything downstream attaches here.
      let logoMesh = null;
      let maxVerts = 0;
      model.traverse((c) => {
        if (c.isMesh && c.geometry?.attributes?.position) {
          const n = c.geometry.attributes.position.count;
          if (n > maxVerts) { maxVerts = n; logoMesh = c; }
        }
      });

      if (!logoMesh) { reject(new Error('Logo has no mesh with position data')); return; }

      const meta = computeSilhouetteMeta(logoMesh);
      const galaxyMat = attachGalaxyPlate(logoMesh, meta);

      // Final scale + vertical placement. Must happen AFTER silhouette
      // metadata is computed (we use mesh-local coords so scaling doesn't
      // matter for geometry — but downstream layers assume the mesh isn't
      // yet rescaled when they compute absolute sizes).
      const maxDim = Math.max(size.x, size.y, size.z);
      model.scale.setScalar(MODEL.scaleToMaxDim / maxDim);
      model.rotation.set(0, 0, 0);
      model.position.y += MODEL.positionOffsetY;

      resolve({ model, logoMesh, galaxyMat, meta, logoMaterials });
    }, reject);
  });
}

// Computes: front-face convex hull, inner-star centroid (fadeCenter used
// by pattern opacity fades), maxR (farthest hull-vertex radius, used by
// pattern fades and by the galaxy back-glow falloff).
function computeSilhouetteMeta(logoMesh) {
  const posAttr = logoMesh.geometry.attributes.position;

  // Front face = vertices at the max local z. A small tolerance catches
  // vertices on the near face that are close but not exactly coplanar.
  let maxZ = -Infinity;
  for (let i = 0; i < posAttr.count; i++) maxZ = Math.max(maxZ, posAttr.getZ(i));
  const frontPts = [];
  for (let i = 0; i < posAttr.count; i++) {
    if (Math.abs(posAttr.getZ(i) - maxZ) < 0.25) {
      frontPts.push({ x: posAttr.getX(i), y: posAttr.getY(i) });
    }
  }

  const hull = convexHull2D(frontPts);

  // Hull centroid (average of hull vertices).
  let cx = 0, cy = 0;
  for (const h of hull) { cx += h.x; cy += h.y; }
  cx /= hull.length; cy /= hull.length;

  // Max distance from centroid — radius used by the galaxy glow falloff
  // and as the base unit for pattern fade radii.
  let maxR = 0;
  for (const h of hull) {
    const dx = h.x - cx, dy = h.y - cy;
    maxR = Math.max(maxR, Math.sqrt(dx * dx + dy * dy));
  }

  // Hull-local Y range (used by the galaxy plate for its bottom-fade).
  let hullMinY = Infinity, hullMaxY = -Infinity;
  for (const p of hull) {
    if (p.y < hullMinY) hullMinY = p.y;
    if (p.y > hullMaxY) hullMaxY = p.y;
  }

  // Inner-star centroid: average of front-face edge midpoints that fall
  // inside the inner cutout. This is where the galaxy glow reads brightest,
  // so we anchor pattern opacity fades here — the dissolve hugs the hot
  // spot rather than the geometric hull centroid.
  logoMesh.geometry.computeBoundingBox();
  const bb = logoMesh.geometry.boundingBox;
  const halfExtent = Math.max((bb.max.x - bb.min.x) * 0.5, (bb.max.y - bb.min.y) * 0.5);
  const zTol = Math.max(halfExtent * 0.02, 0.1);
  const innerR = halfExtent * 0.58;
  const edgesGeo = new THREE.EdgesGeometry(logoMesh.geometry, 30);
  const ep = edgesGeo.attributes.position;
  let ix = 0, iy = 0, ic = 0;
  for (let i = 0; i < ep.count; i += 2) {
    const z1 = ep.getZ(i), z2 = ep.getZ(i + 1);
    const mx = (ep.getX(i) + ep.getX(i + 1)) * 0.5;
    const my = (ep.getY(i) + ep.getY(i + 1)) * 0.5;
    const d = Math.sqrt(mx * mx + my * my);
    if (d < innerR && Math.abs(z1 - maxZ) < zTol && Math.abs(z2 - maxZ) < zTol) {
      ix += mx; iy += my; ic++;
    }
  }
  const innerCenterX = ic ? ix / ic : cx;
  const innerCenterY = ic ? iy / ic : cy;
  // Panel is positioned at (cx, cy), so panel-local = mesh-local - (cx, cy).
  const patternFadeCenter = [innerCenterX - cx, innerCenterY - cy];

  return { hull, cx, cy, maxR, maxZ, hullMinY, hullMaxY, halfExtent, bbox: bb, patternFadeCenter };
}

// Flat silhouette plate holding the galaxy shader, parented just behind
// the front face. Halo scale = 1.0 matches the logo silhouette exactly.
function attachGalaxyPlate(logoMesh, meta) {
  const { hull, cx, cy, maxR, maxZ, hullMinY } = meta;
  if (hull.length < 3) return null;

  const shape = new THREE.Shape();
  shape.moveTo(hull[0].x, hull[0].y);
  for (let i = 1; i < hull.length; i++) shape.lineTo(hull[i].x, hull[i].y);
  shape.closePath();

  const galaxyMat = createGalaxyMaterial();
  galaxyMat.uniforms.uCenter.value.set(cx, cy);
  galaxyMat.uniforms.uRadius.value = maxR;
  galaxyMat.uniforms.uMinY.value   = hullMinY;
  galaxyMat.uniforms.uFadeHeight.value = 0;  // bottom fade disabled

  const galaxyMesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), galaxyMat);
  galaxyMesh.position.set(0, 0, maxZ - 0.5);
  galaxyMesh.renderOrder = -1;
  logoMesh.add(galaxyMesh);

  return galaxyMat;
}
