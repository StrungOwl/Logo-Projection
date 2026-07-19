// Effect 5 — DEPTH PORTAL: nested logo silhouettes on an infinite
// conveyor through the central cutout.
//
// Builds N concentric copies of the SDG silhouette (outer loop + interior
// holes). Each copy carries the logo body's starry-shimmer + gradient
// patches, plus a thin overbright rim line (bloom draws receding
// concentric A-outlines toward the vanishing point). A continuous depth
// parameter drifts every copy toward the viewer; a copy reaching the
// front fades out and wraps to the deepest slot (fade-in), so the
// corridor never ends. Per-copy twist accumulates with depth and slowly
// oscillates — the corridor gently spirals.
//
//   ANIM.recede.conveyor.enabled = false  → the original static stack
//   (k-indexed placement + group breath), kept as the legacy look.
//   'portal.rush' trigger → conveyor compresses (speedMul) + rims swell
//   (brightMul) for rush.duration seconds.
//
// RenderOrder discipline (load-bearing — see galaxy/body notes below):
// every copy must stay strictly between the galaxy plate (-1) and the
// logo body (0). Below -1 the opaque starry galaxy wipes the stack out;
// at 0+ the stack covers the body. Within the band, deeper copies draw
// first so closer copies alpha-blend over them — re-sorted every frame
// after conveyor wrap.

import * as THREE from 'three';
import { ANIM, COLORS } from '../../config.js';
import { hexToRgb } from '../../util/color.js';
import { applyLogoStarry } from '../../shaders/logo-starry.js';
import { applyGradientTint } from '../../shaders/gradient-tint.js';
import { buildSilhouetteShape } from '../../util/geometry.js';

export function createRecede({
  silhouettePolygons,
  hullMaxR,
}) {
  const group = new THREE.Group();
  group.name = 'recede';

  if (!silhouettePolygons || !silhouettePolygons.length) {
    return { group, update: () => {}, triggerRush: () => {} };
  }

  const cfg = () => ANIM.recede || {};
  const c0 = cfg();

  const outer = silhouettePolygons[0];
  const sharedGeometry =
    new THREE.ShapeGeometry(buildSilhouetteShape(silhouettePolygons));

  // Copy 0 is the LARGEST visible silhouette — it must fit inside the
  // logo body's central cutout, otherwise it sits BEHIND the body's solid
  // area and is invisible.
  let outerR = 0, innerR = 0;
  for (const p of outer) outerR = Math.max(outerR, Math.hypot(p.x, p.y));
  if (silhouettePolygons.length > 1) {
    for (const p of silhouettePolygons[1]) {
      innerR = Math.max(innerR, Math.hypot(p.x, p.y));
    }
  }
  const innerOuterRatio = (innerR > 0 && outerR > 0) ? (innerR / outerR) : 0.30;

  const N            = Math.max(3, c0.copies ?? 10);
  const baseScale    = innerOuterRatio * 0.88;  // small margin inside the cutout
  const shrinkFactor = c0.shrinkFactor ?? 0.78;
  const zStep        = c0.zStep ?? 1.3;
  const maxD         = N * zStep;
  // Legacy static stack: near-solid nested logos. Conveyor corridor:
  // fills must stay TRANSLUCENT (each is a depth-haze layer dimming what
  // lies behind; a solid front copy would wall off the whole corridor)
  // while the rims carry the structure.
  const opacityHead  = 0.95;
  const opacityTail  = 0.20;
  const convHead     = c0.opacity?.head ?? 0.45;
  const convTail     = c0.opacity?.tail ?? 0.12;

  const gradDark   = hexToRgb(COLORS.logo.gradientDark);
  const gradBright = hexToRgb(COLORS.logo.gradientBright);

  // Rim lines: one per silhouette loop so both the outer A outline and
  // the star cutout glow. Overbright color → crosses the bloom threshold.
  const rimCfg = c0.rim || {};
  const rimColor = new THREE.Color(rimCfg.color || '#FFD070')
    .multiplyScalar(rimCfg.intensity ?? 2.2);
  const rimGeos = silhouettePolygons.map(loop =>
    new THREE.BufferGeometry().setFromPoints(
      loop.map(p => new THREE.Vector3(p.x, p.y, 0.02))));

  const copies = [];
  for (let k = 0; k < N; k++) {
    const mat = new THREE.MeshStandardMaterial({
      color:       COLORS.logo.base,
      metalness:   COLORS.logo.metalness,
      roughness:   COLORS.logo.roughness,
      transparent: true,
      opacity:     opacityHead,
      depthWrite:  false,
      side:        THREE.FrontSide,
      flatShading: true,
    });
    applyGradientTint(mat, {
      minY: -hullMaxR * 1.1,
      maxY:  hullMaxR * 1.1,
      darkTint:   gradDark,
      brightTint: gradBright,
    });
    // Shares the global uStarryBlend uniform with the logo body — the
    // whole corridor twinkles in lockstep with the front face.
    applyLogoStarry(mat);

    const mesh = new THREE.Mesh(sharedGeometry, mat);
    group.add(mesh);

    const rimMat = new THREE.LineBasicMaterial({
      color: rimColor.clone(),
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const rims = rimGeos.map(g => new THREE.LineLoop(g, rimMat));
    rims.forEach(r => mesh.add(r));

    copies.push({ mesh, mat, rimMat, offset: k * zStep });
  }

  // Conveyor phase — copies move toward the viewer (depth decreases).
  let phase = 0;
  let rushUntil = -1;
  let rushEnv = 0;

  function triggerRush(t) {
    rushUntil = (t ?? 0) + ((cfg().rush || {}).duration ?? 4);
  }

  function placeStatic(t) {
    // Legacy static stack + group breath (original look, kept verbatim).
    const breath = 1 + 0.022 * Math.sin(t * (2 * Math.PI / 18));
    const zDrift = 0.45 * Math.sin(t * (2 * Math.PI / 22));
    for (let k = 0; k < copies.length; k++) {
      const c = copies[k];
      const u = N > 1 ? k / (N - 1) : 0;
      const s = baseScale * Math.pow(shrinkFactor, k) * breath;
      c.mesh.scale.set(s, s, 1);
      c.mesh.position.z = -k * zStep + zDrift;
      c.mesh.rotation.z = 0;
      c.mat.opacity = opacityHead + (opacityTail - opacityHead) * u;
      c.mesh.renderOrder = -0.3 - 0.1 * (N - 1 - k);
      c.rimMat.opacity = (cfg().rim?.enabled === false) ? 0 : c.mat.opacity;
      for (const r of c.mesh.children) r.renderOrder = c.mesh.renderOrder + 0.005;
    }
  }

  function update(t, dt = 0.016) {
    if (!group.visible) return;
    const c = cfg();
    if (!c.conveyor || c.conveyor.enabled === false) { placeStatic(t); return; }

    const rush = c.rush || {};
    const rushing = t < rushUntil;
    rushEnv += ((rushing ? 1 : 0) - rushEnv) * (1 - Math.exp(-dt / (rushing ? 0.4 : 1.2)));
    const speed = (c.conveyor.speed ?? 0.35) * (1 + rushEnv * ((rush.speedMul ?? 6) - 1));
    phase = (phase + speed * dt) % maxD;

    const twist  = THREE.MathUtils.degToRad(c.twistDeg ?? 4);
    const wob    = c.wobble || {};
    const wobble = THREE.MathUtils.degToRad(wob.ampDeg ?? 3)
                 * Math.sin(t * (2 * Math.PI / (wob.period ?? 16)));
    const brightMul = 1 + rushEnv * ((rush.brightMul ?? 1.8) - 1);
    const rimOn = c.rim?.enabled !== false;
    // Conveyor mode runs FULL-SIZE — the logo body goes black in portal
    // mode (main.js) so nothing occludes the corridor; the head copy
    // nearly fills the gate frame and the whole recession reads as an
    // infinite tunnel of glowing A-outlines. The legacy static stack
    // stays cutout-sized (it coexists with the visible body).
    const headScale = c.headScale ?? 0.86;

    for (let k = 0; k < copies.length; k++) {
      const cp = copies[k];
      // Depth decreases over time → the copy travels toward the viewer,
      // wrapping to the deepest slot as it crosses the front.
      const d = ((cp.offset - phase) % maxD + maxD) % maxD;
      const step = d / zStep;
      const s = headScale * Math.pow(shrinkFactor, step);
      cp.mesh.scale.set(s, s, 1);
      cp.mesh.position.z = -d;
      cp.mesh.rotation.z = twist * step + wobble * (step / N);
      // Envelope hides the wrap: fade out approaching the front (d→0),
      // fade in emerging from the deep end.
      const front = Math.min(1, d / (zStep * 0.8));
      const back  = Math.min(1, (maxD - d) / zStep);
      const env = front * front * back;
      const u = d / maxD;
      cp.mat.opacity = (convHead + (convTail - convHead) * u) * env;
      // Rims fade with depth too — nearest outline brightest, vanishing
      // point dimmest — and swell during a rush.
      cp.rimMat.opacity = rimOn ? Math.min(1, env * (1 - u * 0.75) * brightMul) : 0;
      // Deeper draws first (more negative) within the (-1, 0) band; each
      // copy's rim draws immediately after its own fill so outlines
      // interleave with the haze layers instead of all stacking on top.
      cp.mesh.renderOrder = -0.05 - 0.9 * u;
      const rimOrder = cp.mesh.renderOrder + 0.005;
      for (const r of cp.mesh.children) r.renderOrder = rimOrder;
    }
  }

  return { group, update, triggerRush };
}
