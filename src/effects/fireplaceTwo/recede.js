// Effect 5 — nested logo silhouettes receding inward.
//
// Builds N concentric copies of the SDG silhouette (outer loop + interior
// holes). Each copy is smaller, further back in z, and dimmer than the one
// in front of it so the stack reads as a single logo receding into depth.
// Every copy carries the same starry-shimmer shader patch the logo body
// uses, so the whole stack twinkles in unison while the flame illuminates
// it from the central cutout.
//
// Static geometry on purpose — the user wants symmetry and a quiet,
// easy-to-look-at composition. The only motion is a subtle group-level
// breath (slow scale + z drift) so the recession reads as living rather
// than frozen.

import * as THREE from 'three';
import { COLORS } from '../../config.js';
import { hexToRgb } from '../../util/color.js';
import { applyLogoStarry } from '../../shaders/logo-starry.js';
import { applyGradientTint } from '../../shaders/gradient-tint.js';

export function createRecede({
  silhouettePolygons,
  hullMaxR,
}) {
  const group = new THREE.Group();
  group.name = 'recede';

  if (!silhouettePolygons || !silhouettePolygons.length) {
    return { group, update: () => {} };
  }

  // Master shape: outer loop CCW + remaining loops as holes (CW).
  const outer = silhouettePolygons[0];
  const shape = new THREE.Shape();
  shape.moveTo(outer[0].x, outer[0].y);
  for (let i = 1; i < outer.length; i++) shape.lineTo(outer[i].x, outer[i].y);
  shape.closePath();
  for (let h = 1; h < silhouettePolygons.length; h++) {
    const hole = silhouettePolygons[h];
    const path = new THREE.Path();
    path.moveTo(hole[0].x, hole[0].y);
    for (let i = 1; i < hole.length; i++) path.lineTo(hole[i].x, hole[i].y);
    path.closePath();
    shape.holes.push(path);
  }
  const sharedGeometry = new THREE.ShapeGeometry(shape);

  // Copy 0 is the LARGEST visible silhouette — it must fit inside the
  // logo body's central cutout, otherwise it sits BEHIND the body's solid
  // area and is invisible. Size copy 0 against the inner cutout's max
  // radius vs the outer hull's max radius, with a small margin so its
  // perimeter clears the cutout edges.
  let outerR = 0, innerR = 0;
  for (const p of outer) outerR = Math.max(outerR, Math.hypot(p.x, p.y));
  if (silhouettePolygons.length > 1) {
    for (const p of silhouettePolygons[1]) {
      innerR = Math.max(innerR, Math.hypot(p.x, p.y));
    }
  }
  // Fallback: assume the inner cutout is ~30% of the outer hull radius.
  const innerOuterRatio = (innerR > 0 && outerR > 0) ? (innerR / outerR) : 0.30;
  const N            = 6;
  const baseScale    = innerOuterRatio * 0.88;  // small margin inside the cutout
  const shrinkFactor = 0.74;
  const zStep        = 1.4;
  const opacityHead  = 0.95;
  const opacityTail  = 0.20;

  const gradDark   = hexToRgb(COLORS.logo.gradientDark);
  const gradBright = hexToRgb(COLORS.logo.gradientBright);

  const copies = [];
  for (let k = 0; k < N; k++) {
    const u = N > 1 ? k / (N - 1) : 0;       // 0 at front, 1 at deepest
    const mat = new THREE.MeshStandardMaterial({
      color:       COLORS.logo.base,
      metalness:   COLORS.logo.metalness,
      roughness:   COLORS.logo.roughness,
      transparent: true,
      opacity:     opacityHead + (opacityTail - opacityHead) * u,
      depthWrite:  false,
      side:        THREE.FrontSide,
      flatShading: true,
    });
    // Gradient tint matches the live logo body so the receding copies read
    // as the same material at depth.
    applyGradientTint(mat, {
      minY: -hullMaxR * 1.1,
      maxY:  hullMaxR * 1.1,
      darkTint:   gradDark,
      brightTint: gradBright,
    });
    // Starry shimmer — shares the global uStarryBlend uniform with the
    // logo body so when fireplaceTwo mode raises the blend, every copy
    // twinkles in lockstep with the front face.
    applyLogoStarry(mat);

    const mesh = new THREE.Mesh(sharedGeometry, mat);
    const scale = baseScale * Math.pow(shrinkFactor, k);
    const baseZ = -k * zStep;
    mesh.scale.set(scale, scale, 1);
    mesh.position.set(0, 0, baseZ);
    // RenderOrder must sit BETWEEN galaxy (-1) and body (default 0):
    //   • Below -1 would mean recede draws BEFORE the galaxy plate, which
    //     in fireplaceTwo / flameOnly outputs opaque black (alpha hard-
    //     coded to 1 with rgb * uBrightness) — that would wipe the recede
    //     stack out behind the galaxy.
    //   • At or above 0 would put recede in front of the body, hiding
    //     the body's solid area instead of showing through its cutouts.
    // Within recede, the DEEPEST copy must draw FIRST so closer copies
    // alpha-blend correctly on top of it.
    mesh.renderOrder = -0.3 - 0.1 * (N - 1 - k);
    group.add(mesh);
    copies.push({ mesh, baseScale: scale, baseZ });
  }

  function update(t /*, dt */) {
    if (!group.visible) return;
    // Slow group breath — entire stack scales gently and drifts in z.
    // Period ~18 s for the breath, ~22 s for the z drift so the two
    // motions don't beat. Amplitudes kept tiny to preserve symmetry.
    const breath = 1 + 0.022 * Math.sin(t * (2 * Math.PI / 18));
    const zDrift = 0.45 * Math.sin(t * (2 * Math.PI / 22));
    for (let i = 0; i < copies.length; i++) {
      const c = copies[i];
      const s = c.baseScale * breath;
      c.mesh.scale.set(s, s, 1);
      c.mesh.position.z = c.baseZ + zDrift;
    }
  }

  return { group, update };
}
