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
import { createArch }            from '../patterns/arch.js';

export function addPatternLayers(logoMesh, meta) {
  const { hull, silhouette, cx, cy, maxR, maxZ, patternFadeCenter } = meta;
  const strokeTimeUniforms = [];
  const sparkSystems = [];
  const patternsToRefresh = [];

  // Hull in panel-local coords (panel is positioned at (cx, cy), so
  // pattern clip uses mesh-local - (cx, cy)).
  const clipPolygon = hull.map(h => ({ x: h.x - cx, y: h.y - cy }));
  // True silhouette (concave, from SVG) in the same local space; falls
  // back to the convex hull if the SVG didn't load.
  const gateOutline = (silhouette && silhouette[0])
    ? silhouette[0].map(p => ({ x: p.x - cx, y: p.y - cy }))
    : clipPolygon;

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

  // Polygon clip for both patterns: the true silhouette (outer concave
  // outline + interior cutouts) so pattern fragments are confined to the
  // logo's solid area — outer perimeter sits flush with the gate frame's
  // outer edge, and tiles are sliced cleanly out of the negative-space
  // holes (where the gate frame doesn't wrap). Falls back to the convex
  // hull if the SVG didn't load.
  const silhouettePolygons = (silhouette && silhouette.length)
    ? silhouette.map(loop => loop.map(p => ({ x: p.x - cx, y: p.y - cy })))
    : [clipPolygon];

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
    hullClip: silhouettePolygons,
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
    hullClip: silhouettePolygons,
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

  // Gate frame — extruded ring that follows the true model silhouette
  // (concave outline from the SVG), wrapping the entire perimeter.
  const gate = createGateFrame({
    hull: gateOutline,
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
    bottomCutY: null,
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
  panelSparks.host = 'panel';

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
  latticeSparks.host = 'lattice';

  // Central companion layer — streams straight to centre, starts after the
  // main spark layer, dimmer.
  const centralSparks = createSparkSystem({
    patternGroup: panel,
    fadeCenter: patternFadeCenter,
    fadeOuter:  maxR * 0.55,
    count:            ANIM.centralSparks.count,
    gravity:          ANIM.centralSparks.gravity,
    maxSpeed:         ANIM.centralSparks.maxSpeed,
    damping:          ANIM.centralSparks.damping,
    snapStrength:     ANIM.centralSparks.snapStrength,
    tangentialFactor: ANIM.centralSparks.tangentialFactor,
    speedVariance:    ANIM.centralSparks.speedVariance,
    sizeVariance:     ANIM.centralSparks.sizeVariance,
    color:            ANIM.centralSparks.color,
    hueVariance:      ANIM.centralSparks.hueVariance,
    pointSize:        ANIM.centralSparks.pointSize,
    trailSize:        ANIM.centralSparks.trailSize,
    startDelay:       ANIM.centralSparks.startDelay,
    startDelayMax:    ANIM.centralSparks.startDelayMax,
    brightness:       ANIM.centralSparks.brightness,
    z: 0.13,
  });
  panel.add(centralSparks.points);
  centralSparks.host = 'panel';

  sparkSystems.push(panelSparks, latticeSparks, centralSparks);

  // Arch effect — procedural-brick ogee arch + cascade row + floor fill,
  // built off the same inset silhouette the gate frame uses. Sits in front
  // of the gate frame in Z. See patterns/arch.js for orientation logic.
  const arch = createArch({
    silhouette:     silhouettePolygons,
    maxZ,
    frameDepth:     0.5,
    gateFrameWidth,
  });
  arch.group.position.set(cx, cy, 0);
  logoMesh.add(arch.group);

  // Sparks that hop along the arch's brick edges — same effect as the panel
  // sparks but the snap cloud is built from an invisible LineSegments layer
  // inside arch.group (see patterns/arch.js).
  if (ANIM.archSparks) {
    const archSparks = createSparkSystem({
      patternGroup: arch.group,
      fadeCenter: patternFadeCenter,
      fadeOuter:  maxR * 0.55,
      count:            ANIM.archSparks.count,
      gravity:          ANIM.archSparks.gravity,
      maxSpeed:         ANIM.archSparks.maxSpeed,
      damping:          ANIM.archSparks.damping,
      snapStrength:     ANIM.archSparks.snapStrength,
      tangentialFactor: ANIM.archSparks.tangentialFactor,
      speedVariance:    ANIM.archSparks.speedVariance,
      sizeVariance:     ANIM.archSparks.sizeVariance,
      color:            ANIM.archSparks.color,
      hueVariance:      ANIM.archSparks.hueVariance,
      pointSize:        ANIM.archSparks.pointSize,
      trailSize:        ANIM.archSparks.trailSize,
      z: arch.sparkZ ?? 0.12,
    });
    arch.group.add(archSparks.points);
    archSparks.host = 'arch';
    sparkSystems.push(archSparks);
  }

  // ---------------------------------------------------------------------
  // Slow rotation for a random subset of rosettes and lattice hexes. Each
  // picked mesh gets a random phase offset and a signed angular speed so
  // neighbours drift in different directions at different rates. Runs
  // independently of the radial cascade (cascade writes position, this
  // writes rotation.z) so both can stack.
  // ---------------------------------------------------------------------
  const rotatableMeshes = [];
  panel.traverse(o => {
    if (o.isMesh && o.userData.isRosette) {
      rotatableMeshes.push({ mesh: o, kind: 'rosette' });
    }
  });
  underlay.traverse(o => {
    if (o.isMesh && o.userData.baseX !== undefined) {
      rotatableMeshes.push({ mesh: o, kind: 'hex' });
    }
  });

  const rotCfg0 = ANIM.patternRotation;
  for (const r of rotatableMeshes) {
    const fraction = r.kind === 'rosette' ? rotCfg0.rosetteFraction
                                          : rotCfg0.hexFraction;
    if (Math.random() < fraction) {
      const dir   = Math.random() < 0.5 ? -1 : 1;
      const speed = rotCfg0.speedMin +
                    Math.random() * (rotCfg0.speedMax - rotCfg0.speedMin);
      r.mesh.userData.rotateSpeed = dir * speed;
      r.mesh.userData.rotatePhase = Math.random() * Math.PI * 2;
    } else {
      r.mesh.userData.rotateSpeed = 0;
      r.mesh.userData.rotatePhase = 0;
    }
  }

  function updateRotations(t) {
    const cfg = ANIM.patternRotation;
    if (!cfg || cfg.enabled === false) return;
    for (let i = 0; i < rotatableMeshes.length; i++) {
      const m = rotatableMeshes[i].mesh;
      if (m.userData.rotateSpeed !== 0) {
        m.rotation.z = m.userData.rotatePhase + m.userData.rotateSpeed * t;
      }
    }
  }

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
    // Per-tile random phase jitter — sampled once at load so the wave
    // direction (outer-first) is preserved but tiles within the same
    // ring don't all fire at the same instant, and each page load
    // produces a different flow.
    m.userData.phaseJitter = Math.random() - 0.5;
  }

  // Infinite-loop mode: each tile runs its OWN rest → exit → gap → entry
  // cycle with a radius-based phase offset (outer-first). Because
  // `rest` (per-tile rest) dominates the cycle, most tiles are at rest
  // at any instant — only a thin radial band is in motion at once, and
  // new tiles are continuously re-emerging from beyond the hull to
  // replace the ones being pulled inward. No global idle/gap — the
  // pattern never fully empties.
  //
  // `playAllT` / `playAllDuration` are written each frame when
  // `ANIM.timings.playAll` is true: they expose the all-at-center
  // window's elapsed seconds (and length) so the 3D overlay can drive
  // its brick↔petals morph from the same clock.
  //
  // `triggerNow(t)` shifts the cycle clock so exit begins immediately
  // (skipping the rest phase). The natural period continues from there,
  // so auto-loop keeps running on a new phase. Bound to spacebar in
  // src/main.js.
  const cascadeState = { active: 1, playAllT: -1, playAllDuration: 0 };
  let lastAllAtRest = false;
  let clockBase     = null;   // null = use tcfg.triggerDelay; otherwise overrides

  cascadeState.triggerNow = (t) => {
    const c  = ANIM.rowCascade;
    const tc = ANIM.timings && ANIM.timings.cascade;
    if (!c || !tc) return;
    const restDur = (c.continuous ? 0 : tc.rest) || 0;
    // Anchor clock so adjT = restDur right now → exit phase starts immediately.
    clockBase = t - restDur;
  };

  function parkAll() {
    for (let i = 0; i < cascadeMeshes.length; i++) {
      const m = cascadeMeshes[i];
      m.position.x = m.userData.baseX;
      m.position.y = m.userData.baseY;
    }
  }

  function updateRowCascade(t, dt = 0) {
    const cfg  = ANIM.rowCascade;
    const tcfg = ANIM.timings && ANIM.timings.cascade;
    if (!cfg || !tcfg) return;

    // Master toggle + initial delay. Before the trigger moment (or while
    // disabled), all tiles stay at rest and the spark snap is full. The
    // first-frame park is guarded so we don't re-assign positions every
    // frame during the long idle.
    const adjT = t - (clockBase !== null ? clockBase : (tcfg.triggerDelay || 0));
    if (cfg.enabled === false || adjT < 0) {
      if (!lastAllAtRest) { parkAll(); lastAllAtRest = true; }
      cascadeState.active = 1;
      cascadeState.playAllT = -1;
      // Advance every tile's pulse clock — they're all at rest.
      for (let i = 0; i < cascadeMeshes.length; i++) {
        const m = cascadeMeshes[i];
        m.userData.pulseTime = (m.userData.pulseTime || 0) + dt;
      }
      return;
    }
    lastAllAtRest = false;

    // `continuous` drops the per-tile rest so tiles cycle nonstop —
    // pattern is in constant radial motion instead of mostly-at-rest.
    const restDur   = cfg.continuous ? 0 : tcfg.rest;
    const exDur     = tcfg.out;
    const enDur     = tcfg.in;
    const stag      = tcfg.stagger;
    const jitter    = tcfg.phaseJitter || 0;
    const outerRing = maxRadius + (cfg.outerMargin ?? 5.0);

    // PlayAll mode: anchor the gap so the overlay window opens the moment
    // the OUTERMOST tile arrives at center (restDur+exDur). Inner tiles
    // are still mid-exit during the early window, but they're already
    // close to the fade-center and the radial alpha fade has dropped them
    // toward transparent — so the brick wall reads as starting to come in
    // while the last patterns finish dissolving. Window length = morph
    // total. Outermost begins entry the moment the window closes.
    // playAll syncs cascade ↔ overlay only in 'all' view mode. Single-effect
    // modes (pattern/hex/flowers/arch/flame) disable the sync window so each
    // layer free-runs on its own clock.
    const playAllOn = !!(ANIM.timings && ANIM.timings.playAll)
                   && (!ANIM.viewMode || ANIM.viewMode === 'all');
    let gapDur, playAllWinStart = -1, playAllDur = 0;
    if (playAllOn) {
      const ovr = (ANIM.timings && ANIM.timings.overlay) || {};
      playAllDur = (ovr.brickHold   || 0) + (ovr.brickToRose || 0)
                 + (ovr.roseHold    || 0) + (ovr.roseToBrick || 0);
      gapDur          = playAllDur;
      playAllWinStart = restDur + exDur;
    } else {
      gapDur = tcfg.gap || 0;
    }

    const period = restDur + exDur + gapDur + enDur;
    if (period < 1e-3) return;

    // Compute where the current global-cycle phase falls inside the
    // playAll window (or -1 if outside / disabled). Overlay reads this
    // each frame to drive its morph in lockstep.
    if (playAllOn) {
      const cycT = ((adjT % period) + period) % period;
      const rel  = cycT - playAllWinStart;
      cascadeState.playAllT        = (rel >= 0 && rel < playAllDur) ? rel : -1;
      cascadeState.playAllDuration = playAllDur;
    } else {
      cascadeState.playAllT = -1;
    }

    const exitStart  = restDur;
    const gapStart   = restDur + exDur;
    const entryStart = restDur + exDur + gapDur;

    for (let i = 0; i < cascadeMeshes.length; i++) {
      const m    = cascadeMeshes[i];
      const sIdx = m.userData.staggerIdx;
      const bx   = m.userData.baseX;
      const by   = m.userData.baseY;
      const rayX = m.userData.rayX;
      const rayY = m.userData.rayY;

      const offset = sIdx * stag + m.userData.phaseJitter * jitter;
      let phase;
      if (cfg.continuous) {
        // Continuous mode: tiles drop straight into their natural phase
        // at the trigger instant. Because outer tiles have small offset
        // and inner tiles have large offset, negative-wrapping puts the
        // inner tiles mid-entry (approaching rest from the outer ring)
        // at the exact moment outer tiles start their exit — so the
        // exterior is already refilling the first time the pattern moves.
        phase = ((adjT - offset) % period + period) % period;
      } else {
        // Non-continuous: gate each tile at its base position until its
        // own stagger moment so no tile is caught mid-motion on the
        // trigger frame (clean cold start for discrete cycles).
        const localT = adjT - offset;
        if (localT < 0) {
          m.position.x = bx; m.position.y = by;
          m.userData.pulseTime = (m.userData.pulseTime || 0) + dt;
          continue;
        }
        phase = localT % period;
      }

      let posX, posY, atRest = false;
      if (phase < exitStart) {
        posX = bx; posY = by;                       // resting at base
        atRest = true;
      } else if (phase < gapStart) {
        // Exit: base → fade center, ease-in cubic (accelerating suction).
        const u = (phase - exitStart) / exDur;
        const e = u * u * u;
        posX = bx + (fcx - bx) * e;
        posY = by + (fcy - by) * e;
      } else if (phase < entryStart) {
        posX = fcx; posY = fcy;                     // parked at center, invisible under fade
      } else {
        // Entry: outer ring → base, ease-in-out cubic. Tile stays beyond
        // the hull at entry start (clipped) and settles into place.
        const u = (phase - entryStart) / enDur;
        const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        const outerX = fcx + outerRing * rayX;
        const outerY = fcy + outerRing * rayY;
        posX = outerX + (bx - outerX) * e;
        posY = outerY + (by - outerY) * e;
      }
      m.position.x = posX;
      m.position.y = posY;
      // Per-tile pulse clock — advances only while at rest so the hex
      // brightness animation freezes during exit/gap/entry and resumes
      // where it left off when the tile returns to base. Keeps the pulse
      // from fighting the cascade motion.
      if (atRest) m.userData.pulseTime = (m.userData.pulseTime || 0) + dt;
      else if (m.userData.pulseTime === undefined) m.userData.pulseTime = 0;
    }

    // Time-averaged fraction at rest — drives spark snap strength in
    // main.js. Matches the expected fraction of tiles at rest at any
    // instant under uniform-phase-offset assumption, so sparks pull
    // toward strokes roughly in proportion to how much of the pattern
    // is stationary.
    cascadeState.active = restDur / period;
  }

  return { strokeTimeUniforms, sparkSystems, patternsToRefresh,
           updateRowCascade, cascadeState, updateRotations,
           panelGroup: panel,
           latticeGroup: underlay,
           gateFrameGroup: gate,
           archGroup: arch.group,
           updateArch: arch.update,
           triggerArchCascade: arch.triggerCascade };
}
