// Wires the four front-face pattern layers onto the logo mesh:
//   1. Islamic tile panel (rosettes + straps + knots)
//   2. Lattice hex underlay (sits behind the panel)
//   3. Gate frame (extruded arch along the silhouette)
//   4. Two spark systems (panel + lattice), additive-blended embers
//      drifting along each pattern's stroke network.
//
// All four share the logo's hull so their edges line up. Patterns clip
// to a pushed-out polygon so their outer rings slip UNDER the gate
// frame; the gate frame then crops to the original hull so the visible
// edge reads flush with the gate's inner lip.

import { ANIM, COLORS } from './config.js';
import { hexToRgb } from './util/color.js';
import { createIslamicPanel }   from '../patterns/islamic-tile.js';
import { createLatticeUnderlay } from '../patterns/lattice-underlay.js';
import { createGateFrame }       from '../patterns/gate-frame.js';
import { createSparkSystem }     from '../patterns/stroke-sparks.js';

export function addPatternLayers(logoMesh, meta) {
  const { hull, cx, cy, maxR, maxZ, patternFadeCenter } = meta;
  const strokeTimeUniforms = [];
  const sparkSystems = [];
  const patternsToRefresh = [];

  // Hull in panel-local coords (panel is positioned at (cx, cy), so
  // pattern clip uses mesh-local - (cx, cy)).
  const clipPolygon = hull.map(h => ({ x: h.x - cx, y: h.y - cy }));

  // Pattern grid sizing.
  const tileStep      = 6.5;
  const mainTileSize  = 2.4;
  const panelSpan     = maxR * 1.9;
  const cols          = Math.max(3, Math.ceil(panelSpan / tileStep) | 1);
  // Gate frame width drives both pattern clip margins so their outer
  // rings extend to the frame's inner edge (slipping under the frame).
  const gateFrameWidth = 1.6;

  // Pattern-only clip polygon. Top and sides are pushed outward past the
  // hull so grid cells nearer the edges pass placement — the hard hullClip
  // shader then slices any hex/rosette that pokes beyond the frame
  // silhouette, so the visible edge stays flush with the gate frame.
  const topPushOut  = 0.7;
  const sidePushOut = 0.7;
  const patternClipPolygon = clipPolygon.map(p => ({
    x: p.x + (p.x > 0 ?  sidePushOut : -sidePushOut),
    y: p.y > 0 ? p.y + topPushOut : p.y,
  }));

  // Islamic tile panel. Center fades to transparent so the galaxy core
  // glow bleeds through; outer rim stays mostly opaque.
  const panel = createIslamicPanel({
    cols,
    rows: cols,
    tileStep,
    mainTileSize,
    secondaryScale: 0.55,
    reliefDepth: 0.35,
    strapHalfWidth: 0.3,
    knotSize: 0.7,
    goldColor: COLORS.islamicPanel.gold,
    clipPolygon: patternClipPolygon,
    clipMargin: gateFrameWidth,
    hullClip: clipPolygon,
    fadeInnerR: maxR * 0.12,
    fadeOuterR: maxR * 0.55,
    fadeCenter: patternFadeCenter,
    fadeDownStretch: 2.3,
    fadeBottomTaper: 0.75,
    maxOpacity: 0.92,
    gradientMinY: -maxR * 1.1,
    gradientMaxY:  maxR * 1.1,
    gradientDark:   hexToRgb(COLORS.islamicPanel.gradientDark),
    gradientBright: hexToRgb(COLORS.islamicPanel.gradientBright),
    strokeColor: COLORS.islamicPanel.stroke,
    strokeOpacity: 0.9,
  });
  panel.name = 'islamic-panel';
  panel.position.set(cx, cy, maxZ + 0.05);
  logoMesh.add(panel);
  if (panel.userData.strokeTimeUniform) strokeTimeUniforms.push(panel.userData.strokeTimeUniform);
  patternsToRefresh.push(panel);

  // Lattice hex underlay — same grid as the panel so each hex frames one
  // rosette. Clip margin pushes outer hexes under the gate frame; fades
  // to transparent toward center so the inner glow isn't stifled.
  const hexRadius = mainTileSize * 1.4;
  const underlay = createLatticeUnderlay({
    cols: cols + 2,
    rows: cols + 2,
    tileStep,
    hexRadius,
    depth: 0.035,
    color: COLORS.latticeUnderlay.fill,
    clipPolygon: patternClipPolygon,
    clipMargin: gateFrameWidth,
    hullClip: clipPolygon,
    fadeInnerR: maxR * 0.16,
    fadeOuterR: maxR * 0.65,
    fadeCenter: patternFadeCenter,
    fadeDownStretch: 2.5,
    fadeBottomTaper: 0.75,
    maxOpacity: 0.82,
    gradientMinY: -maxR * 1.1,
    gradientMaxY:  maxR * 1.1,
    gradientDark:   hexToRgb(COLORS.latticeUnderlay.gradientDark),
    gradientBright: hexToRgb(COLORS.latticeUnderlay.gradientBright),
    strokeColor: COLORS.latticeUnderlay.stroke,
    strokeOpacity: 1.0,
    pulseSpeed:         ANIM.latticeHex.pulseSpeed,
    pulseSpeedVariance: ANIM.latticeHex.speedVariance,
    pulseBrightMin:     ANIM.latticeHex.brightnessMin,
    pulseBrightMax:     ANIM.latticeHex.brightnessMax,
    pulseEmissiveMin:   ANIM.latticeHex.emissiveMin,
    pulseEmissiveMax:   ANIM.latticeHex.emissiveMax,
    pulseColorA:        hexToRgb(ANIM.latticeHex.colorAtMin),
    pulseColorB:        hexToRgb(ANIM.latticeHex.colorAtMax),
  });
  underlay.name = 'lattice-underlay';
  underlay.position.set(cx, cy, maxZ + 0.005);
  logoMesh.add(underlay);
  if (underlay.userData.strokeTimeUniform) strokeTimeUniforms.push(underlay.userData.strokeTimeUniform);
  if (underlay.userData.pulseTimeUniform)  strokeTimeUniforms.push(underlay.userData.pulseTimeUniform);
  patternsToRefresh.push(underlay);

  // Gate frame — extruded arch along the silhouette. Legs extend to the
  // lowest hull point; bottomCutY offset by a tiny epsilon above hullMinY
  // so the flat-bottom detection doesn't degenerate to a zero-height cut.
  let hullMinY = Infinity, hullMaxY = -Infinity;
  for (const p of clipPolygon) {
    if (p.y < hullMinY) hullMinY = p.y;
    if (p.y > hullMaxY) hullMaxY = p.y;
  }
  const gateBottomCutY = hullMinY + (hullMaxY - hullMinY) * 0.025;
  const gate = createGateFrame({
    hull: clipPolygon,
    frameWidth: gateFrameWidth,
    frameDepth: 0.5,
    lipWidth: 0.3,
    lipDepth: 0.22,
    bossCount: 56,
    bossRadius: 0.24,
    bossDepth: 0.26,
    color: COLORS.gateFrame.base,
    gradientMinY: -maxR * 1.1,
    gradientMaxY:  maxR * 1.1,
    gradientDark:   hexToRgb(COLORS.gateFrame.gradientDark),
    gradientBright: hexToRgb(COLORS.gateFrame.gradientBright),
    bottomCutY: gateBottomCutY,
  });
  gate.name = 'gate-frame';
  gate.position.set(cx, cy, maxZ + 0.45);
  logoMesh.add(gate);

  // Spark systems — gravity pulls each spark toward patternFadeCenter,
  // with a per-frame snap to whatever stroke vertex is closest. That
  // combination lets sparks hop between strokes as they drift inward.
  const panelSparks = createSparkSystem({
    patternGroup: panel,
    fadeCenter: patternFadeCenter,
    fadeOuter:  maxR * 0.55,
    count:            ANIM.panelSparks.count,
    gravity:          ANIM.panelSparks.gravity,
    maxSpeed:         ANIM.panelSparks.maxSpeed,
    damping:          ANIM.panelSparks.damping,
    snapStrength:     ANIM.panelSparks.snapStrength,
    tangentialFactor: ANIM.panelSparks.tangentialFactor,
    speedVariance:    ANIM.panelSparks.speedVariance,
    sizeVariance:     ANIM.panelSparks.sizeVariance,
    color:            ANIM.panelSparks.color,
    hueVariance:      ANIM.panelSparks.hueVariance,
    pointSize:        ANIM.panelSparks.pointSize,
    trailSize:        ANIM.panelSparks.trailSize,
    z: 0.12,
  });
  panel.add(panelSparks.points);

  const latticeSparks = createSparkSystem({
    patternGroup: underlay,
    fadeCenter: patternFadeCenter,
    fadeOuter:  maxR * 0.65,
    count:            ANIM.latticeSparks.count,
    gravity:          ANIM.latticeSparks.gravity,
    maxSpeed:         ANIM.latticeSparks.maxSpeed,
    damping:          ANIM.latticeSparks.damping,
    snapStrength:     ANIM.latticeSparks.snapStrength,
    tangentialFactor: ANIM.latticeSparks.tangentialFactor,
    speedVariance:    ANIM.latticeSparks.speedVariance,
    sizeVariance:     ANIM.latticeSparks.sizeVariance,
    color:            ANIM.latticeSparks.color,
    hueVariance:      ANIM.latticeSparks.hueVariance,
    pointSize:        ANIM.latticeSparks.pointSize,
    trailSize:        ANIM.latticeSparks.trailSize,
    z: 0.12,
  });
  underlay.add(latticeSparks.points);

  sparkSystems.push(panelSparks, latticeSparks);

  // ---------------------------------------------------------------------
  // Radial cascade driver. Each tagged mesh has a rest position (baseX,
  // baseY) and an outward ray through the pattern's fade center.
  //   Exit  — every tile is pulled along its ray toward the fade center.
  //           The pattern's radial opacity fade already drops tiles to
  //           transparent at the center, so convergence reads as tiles
  //           dissolving inward rather than piling up.
  //   Entry — every tile re-enters from just outside the hull on its own
  //           ray, sliding inward along the ray to its rest position. The
  //           hull-clip shader discards any fragment past the hull, so
  //           tiles only become visible as they cross the silhouette.
  // Outer-first stagger: tiles farther from the fade center begin motion
  // first on exit and reach rest first on entry, so the pattern empties
  // from the outside in and refills from the outside in.
  // ---------------------------------------------------------------------
  const cascadeMeshes = [];
  panel   .traverse(o => { if (o.userData.baseX !== undefined) cascadeMeshes.push(o); });
  underlay.traverse(o => { if (o.userData.baseX !== undefined) cascadeMeshes.push(o); });

  const fcx = patternFadeCenter[0];
  const fcy = patternFadeCenter[1];
  let maxRadius = 0;
  for (const m of cascadeMeshes) {
    const dx = m.userData.baseX - fcx;
    const dy = m.userData.baseY - fcy;
    const r  = Math.hypot(dx, dy);
    m.userData.radius = r;
    // Unit ray away from the fade center. Tiles exactly at the center
    // fall back to a neutral direction; they're inside the fade zone
    // (fully transparent) at that radius anyway.
    m.userData.rayX = r > 1e-4 ? dx / r : 0;
    m.userData.rayY = r > 1e-4 ? dy / r : 1;
    if (r > maxRadius) maxRadius = r;
  }
  for (const m of cascadeMeshes) {
    m.userData.staggerIdx = (maxRadius - m.userData.radius) / tileStep;
  }
  const maxStaggerIdx = maxRadius / tileStep;

  const cascadeState = { active: 1 };
  let lastWasIdle = false;

  function updateRowCascade(t) {
    const cfg = ANIM.rowCascade;
    if (!cfg) return;
    const maxStaggerTime  = maxStaggerIdx * cfg.rowStagger;
    const exitPhaseLen    = maxStaggerTime + cfg.exitDuration;
    const entryPhaseStart = exitPhaseLen + cfg.gap;
    const entryPhaseLen   = maxStaggerTime + cfg.entryDuration;
    const cycleLen        = cfg.idlePeriod + exitPhaseLen + cfg.gap + entryPhaseLen;
    const phase           = ((t % cycleLen) + cycleLen) % cycleLen;

    if (phase < cfg.idlePeriod) {
      if (!lastWasIdle) {
        for (let i = 0; i < cascadeMeshes.length; i++) {
          const m = cascadeMeshes[i];
          m.position.x = m.userData.baseX;
          m.position.y = m.userData.baseY;
        }
        lastWasIdle = true;
      }
      cascadeState.active = 1;
      return;
    }
    lastWasIdle = false;
    cascadeState.active = 0;

    const localT     = phase - cfg.idlePeriod;
    const exDur      = cfg.exitDuration;
    const enDur      = cfg.entryDuration;
    const stag       = cfg.rowStagger;
    const outerRing  = maxRadius + cfg.outerMargin;

    for (let i = 0; i < cascadeMeshes.length; i++) {
      const m    = cascadeMeshes[i];
      const sIdx = m.userData.staggerIdx;
      const bx   = m.userData.baseX;
      const by   = m.userData.baseY;
      const rayX = m.userData.rayX;
      const rayY = m.userData.rayY;

      const exStart = sIdx * stag;
      const enStart = entryPhaseStart + sIdx * stag;

      let posX, posY;
      if (localT < exStart) {
        posX = bx; posY = by;
      } else if (localT < exStart + exDur) {
        // Exit: rest → fade-center, ease-in cubic (accelerating suction).
        const u = (localT - exStart) / exDur;
        const e = u * u * u;
        posX = bx + (fcx - bx) * e;
        posY = by + (fcy - by) * e;
      } else if (localT < enStart) {
        // Gap: parked at the fade center (invisible under radial fade).
        posX = fcx; posY = fcy;
      } else if (localT < enStart + enDur) {
        // Entry: outer-ring → rest, ease-in-out cubic. Tiles stay beyond
        // the hull at entry start (clipped) and settle smoothly into place.
        const u = (localT - enStart) / enDur;
        const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        const outerX = fcx + outerRing * rayX;
        const outerY = fcy + outerRing * rayY;
        posX = outerX + (bx - outerX) * e;
        posY = outerY + (by - outerY) * e;
      } else {
        posX = bx; posY = by;
      }
      m.position.x = posX;
      m.position.y = posY;
    }
  }

  return { strokeTimeUniforms, sparkSystems, patternsToRefresh,
           updateRowCascade, cascadeState };
}
