// Two star fans anchored to the left and right sides of the model,
// fanning inward. Each fan is a row of rosettes (12-pointed stars — the
// same shape as the main Islamic panel, built at half-size) arrayed on
// rays from an edge pivot across a configurable angular spread, so the
// collection reads as an opened fan splaying into the model's interior.
//
// The wrapper group around each fan pulses (scale breathes) and slowly
// spins; the pivot sits on the outline and the blade length is short
// enough that the fan stays inside the silhouette at the default pulse
// range.

import * as THREE from 'three';
import { ANIM, COLORS } from './config.js';

// Single-shape 12-point star. The main panel's rosette is a composite
// of a hub plus 24 diamond petals — beautiful opaque, but at 0.35
// opacity every internal face shows through every other and one
// rosette reads as a stack of shards. This clean star is one closed
// polyline so there's no internal overlap.
function buildStarGeometry(points, outerR, innerR, depth) {
  const shape = new THREE.Shape();
  const total = points * 2;
  for (let i = 0; i < total; i++) {
    const theta = (i / total) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = Math.cos(theta) * r;
    const y = Math.sin(theta) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  // Bevel off — ExtrudeGeometry's bevel pass can silently produce an
  // empty mesh at acute star-point corners. Depth extrusion alone is
  // enough for the silhouette we want.
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
}

export function addOverlay(logoMesh, meta) {
  const { silhouette, hull, maxR, maxZ, cx, cy } = meta;
  const wrappers = [];

  const outline = (silhouette && silhouette[0]) ? silhouette[0] : hull;
  if (!outline || outline.length < 3) {
    return { updateOverlay: () => {}, patternsToRefresh: [] };
  }

  // Left / right pivots: outline vertices at extreme x. These anchor
  // each fan to the physical edge of the logo.
  let leftPivot = outline[0], rightPivot = outline[0];
  let leftBestX = Infinity, rightBestX = -Infinity;
  for (const p of outline) {
    if (p.x < leftBestX)  { leftBestX  = p.x; leftPivot  = p; }
    if (p.x > rightBestX) { rightBestX = p.x; rightPivot = p; }
  }

  const cfg0 = ANIM.overlay || {};
  const starSize = cfg0.starSize ?? 1.2;

  // Shared geometry — every star across both fans reuses one buffer.
  const starGeo = buildStarGeometry(
    12,                 // points
    starSize,           // outer radius
    starSize * 0.45,    // inner radius (2.22:1 point-to-valley ratio)
    starSize * 0.15,    // extrusion depth
  );

  // Shared translucent material — gold, matching the main rosettes.
  const starMat = new THREE.MeshStandardMaterial({
    color: COLORS.islamicPanel.gold,
    metalness: 0.55,
    roughness: 0.45,
    transparent: true,
    opacity: cfg0.opacity ?? 0.35,
  });

  function makeFan(pivot, baseAngle, spinDir, phaseOffset) {
    const count     = cfg0.starCount   ?? 5;
    const spread    = cfg0.angleSpread ?? Math.PI * 0.55;
    const fanRadius = cfg0.fanRadius   ?? maxR * 0.45;

    // Inner group holds the star instances at their fan positions. The
    // wrapper is what the per-frame update writes scale + rotation to,
    // so the whole fan pulses + spins around the pivot.
    const fan = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const u = count === 1 ? 0.5 : i / (count - 1);
      const a = baseAngle + (u - 0.5) * spread;
      const x = Math.cos(a) * fanRadius;
      const y = Math.sin(a) * fanRadius;
      const star = new THREE.Mesh(starGeo, starMat);
      star.position.set(x, y, 0);
      fan.add(star);
    }

    const wrapper = new THREE.Group();
    wrapper.name = 'overlay-fan';
    wrapper.add(fan);
    // PREVIEW — temporarily anchored in empty space to the left of the
    // model so the overlay geometry is visible in isolation. Swap back
    // to `pivot.x, pivot.y` to snap it onto the model's left edge.
    wrapper.position.set(
      cx - maxR * (cfg0.previewXFactor ?? 1.2),
      cy,
      maxZ + (cfg0.zOffset ?? 0.22),
    );
    wrapper.userData.phaseOffset = phaseOffset;
    wrapper.userData.spinDir     = spinDir;
    logoMesh.add(wrapper);
    wrappers.push(wrapper);
  }

  // Left pivot fans toward +x (into the model).
  makeFan(leftPivot, 0, +1, 0);

  function updateOverlay(t) {
    const cfg = ANIM.overlay;
    if (!cfg || cfg.enabled === false) {
      for (const w of wrappers) w.visible = false;
      return;
    }
    const period = Math.max(cfg.pulsePeriod, 1e-3);
    const twoPi  = Math.PI * 2;
    const mn = cfg.scaleMin;
    const mx = cfg.scaleMax;
    for (const w of wrappers) {
      w.visible = true;
      const phase = (t / period) * twoPi + w.userData.phaseOffset;
      const k = 0.5 + 0.5 * Math.sin(phase);
      const s = mn + (mx - mn) * k;
      w.scale.setScalar(s);
      w.rotation.z = w.userData.spinDir * t * cfg.spinSpeed;
    }
  }

  return { updateOverlay, patternsToRefresh: [] };
}
