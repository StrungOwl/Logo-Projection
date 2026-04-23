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
  });
  underlay.name = 'lattice-underlay';
  underlay.position.set(cx, cy, maxZ + 0.005);
  logoMesh.add(underlay);
  if (underlay.userData.strokeTimeUniform) strokeTimeUniforms.push(underlay.userData.strokeTimeUniform);
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
  // Row cascade driver — drives a staggered downward slide across both
  // patterns. Each tagged mesh (see islamic-tile.js + lattice-underlay.js,
  // userData.baseY) gets a time-varying Y offset keyed off its baseY, so
  // the islamic panel and the larger lattice underlay move as one wave
  // even though their row indexing starts at different Y coordinates.
  // ---------------------------------------------------------------------
  const cascadeMeshes = [];
  panel   .traverse(o => { if (o.userData.baseY !== undefined) cascadeMeshes.push(o); });
  underlay.traverse(o => { if (o.userData.baseY !== undefined) cascadeMeshes.push(o); });

  let maxBaseY = -Infinity, minBaseY = Infinity;
  for (const m of cascadeMeshes) {
    if (m.userData.baseY > maxBaseY) maxBaseY = m.userData.baseY;
    if (m.userData.baseY < minBaseY) minBaseY = m.userData.baseY;
  }
  // staggerIdx: 0 for topmost mesh, increasing downward in units of tileStep.
  // Fractional for between-row straps/knots so they trigger between their
  // neighbours rather than alongside them.
  for (const m of cascadeMeshes) {
    m.userData.staggerIdx = (maxBaseY - m.userData.baseY) / tileStep;
  }
  const maxStaggerIdx = (maxBaseY - minBaseY) / tileStep;

  const cascadeState = { active: 1 };   // 1 = pattern is still, 0 = rows moving
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
      // Idle — reset once on idle entry, then skip the per-mesh loop
      // so the common case costs almost nothing per frame.
      if (!lastWasIdle) {
        for (let i = 0; i < cascadeMeshes.length; i++) {
          const m = cascadeMeshes[i];
          m.position.y = m.userData.baseY;
        }
        lastWasIdle = true;
      }
      cascadeState.active = 1;
      return;
    }
    lastWasIdle = false;
    cascadeState.active = 0;

    const localT = phase - cfg.idlePeriod;
    const slide  = cfg.slideDistance;
    const exDur  = cfg.exitDuration;
    const enDur  = cfg.entryDuration;
    const stag   = cfg.rowStagger;

    for (let i = 0; i < cascadeMeshes.length; i++) {
      const m       = cascadeMeshes[i];
      const sIdx    = m.userData.staggerIdx;
      const exStart = sIdx * stag;
      const enStart = entryPhaseStart + sIdx * stag;
      let offset;
      if (localT < exStart) {
        offset = 0;
      } else if (localT < exStart + exDur) {
        const u = (localT - exStart) / exDur;
        offset = -slide * u * u * u;                  // ease-in cubic
      } else if (localT < enStart) {
        offset = -slide;
      } else if (localT < enStart + enDur) {
        const v = 1 - (localT - enStart) / enDur;
        offset = -slide * v * v * v;                  // ease-out cubic (mirror)
      } else {
        offset = 0;
      }
      m.position.y = m.userData.baseY + offset;
    }
  }

  return { strokeTimeUniforms, sparkSystems, patternsToRefresh,
           updateRowCascade, cascadeState };
}
