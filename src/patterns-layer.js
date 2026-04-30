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

import * as THREE from 'three';
import { ANIM, COLORS } from './config.js';
import { hexToRgb } from './util/color.js';
import { createIslamicPanel }   from '../patterns/islamic-tile.js';
import { createLatticeUnderlay } from '../patterns/lattice-underlay.js';
import { createGateFrame }       from '../patterns/gate-frame.js';
import { createSparkSystem }     from '../patterns/stroke-sparks.js';
import { createArch }            from '../patterns/arch.js';
import { createFlame }           from '../patterns/flame.js';
import { createFireplace }       from '../patterns/fireplace.js';

export function addPatternLayers(logoMesh, meta, renderer) {
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
    frameDepth: 1.5,
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
    frameDepth:     1.5,
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
  // Flame effect — fills the main central cutout of the logo. Hidden
  // unless ANIM.viewMode === 'fireplace' (gated in src/main.js), where it
  // burns inside the procedural-brick arch above. Carries its own update
  // fn for the body shader, sparks, and flickering point light.
  // ---------------------------------------------------------------------
  const flame = createFlame({
    logoMesh,
    meta,
    renderer,
  });
  logoMesh.add(flame.group);

  // ---------------------------------------------------------------------
  // Fireplace frame — standalone Roman-horseshoe brick + petal frame
  // wrapping the OUTSIDE of the logo's bounding box. Fully isolated from
  // the existing arch (no shared knobs, no shared silhouette curve).
  // Visibility gated to fireplace mode in src/main.js. Flame's own sparks
  // still drive the front-of-logo embers.
  // ---------------------------------------------------------------------
  const fireplace = createFireplace({
    silhouette: silhouettePolygons,
    maxZ,
    frameDepth: 1.5,
  });
  fireplace.group.position.set(cx, cy, 0);
  logoMesh.add(fireplace.group);

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

  // ---------------------------------------------------------------------
  // Fractal "telescope" zoom — replaces the radial cascade in viewMode
  // 'pattern' (mode 1). Two phases, then infinite continuous Droste dive:
  //
  //   intro (one-shot, ~introDuration seconds) -------------------------
  //     1. The CENTRAL ROSETTE (focal tile) scales up from 1 →
  //        focalGrowMax. hullClip silhouette mask trims overspill.
  //     2. EVERY OTHER tile is pushed radially OUTWARD past the
  //        silhouette so they're fully masked away by intro end.
  //     3. The dive's depth d ramps 0 → 1 in lockstep so the first clone
  //        emerges at peak as the original disappears.
  //
  //   dive (forever, after intro) --------------------------------------
  //     d(t) ramps linearly. For each clone k: r_k = mod(d - k + N/2, N)
  //     - N/2 ∈ [-N/2, N/2). scale_k = (1/cloneScaleFactor)^r_k. Opacity
  //     is Gaussian(log(scale)/sigma) — peaks at scale 1, falls to 0 at
  //     the depth-range edges. So one clone is always near peak with
  //     shallower neighbours growing past + fading out, deeper neighbours
  //     emerging from the centre. Wraparound at r = ±N/2 is invisible
  //     because opacity is already 0 there. Optional rotation per layer
  //     (droLayerRotation) gives a Mandelbrot-style spiral twist deeper.
  //
  // The originals are never restored — re-entering pattern mode resets to
  // intro. `fractalState.triggerZoom(t)` re-runs the intro from scratch.
  // ---------------------------------------------------------------------
  function cloneMaterialPreservingTime(origMat, cloneScaleUniform) {
    if (!origMat) return origMat;
    if (Array.isArray(origMat)) {
      return origMat.map(m => cloneMaterialPreservingTime(m, cloneScaleUniform));
    }
    const m = origMat.clone();
    // Don't re-share any uniforms with the original. The patterns'
    // onBeforeCompile (in lattice-underlay.js / islamic-tile.js) wires
    // shader.uniforms to a SHARED closure object (pulseUniforms /
    // strokeUniforms) via Object.assign. The cloned material's wrapped
    // onBeforeCompile (below) overrides those slots with frozen refs so
    // clones don't sample the live animation — that's what was producing
    // the brightness flicker (overlapping clones at different scales all
    // reading the same per-frame uPulseTime / uTwinkleSeed values via
    // the shared object, with onBeforeRender callbacks racing to stomp
    // the shared uniform each frame).
    m.transparent = true;

    // Wrap the original onBeforeCompile to "un-scale" vPanelXY so the
    // existing radial fade + hullClip (silhouette + inner-star cutout)
    // operate in CLONE-LOCAL coords, not absolute panel-local coords.
    //
    // Without this, a clone at scale 0.5 has its vertices land at HALF
    // distance from fadeCenter in the panel-local frame the fade/hull
    // shaders are configured against — so the inner-star cutout (sized
    // for the original) eats half the clone's content, AND the radial
    // fade dims everything because the clone lives entirely inside the
    // central fade zone.
    //
    // The override re-projects each clone vertex back to "as if I were
    // at scale 1" before the existing fade/hull tests run, so each clone
    // has its OWN proportionally-sized inner-star cutout and full fade
    // range — true Droste recursion.
    if (origMat.onBeforeCompile) {
      const origCb = origMat.onBeforeCompile;
      // Per-clone frozen uniform refs. Each call to this function builds
      // its own set so clones don't share state with each other either —
      // every clone is a fully independent static snapshot of the source
      // material at clone-init time.
      const frozenU = {
        uPulseTime:   { value: 0 },
        uTime:        { value: 0 },
        uTwinkleSeed: { value: 0 },
      };
      m.onBeforeCompile = (shader) => {
        origCb(shader);
        shader.uniforms.uCloneScale = cloneScaleUniform;
        // origCb just ran Object.assign(shader.uniforms, fadeGradUniforms,
        // pulseUniforms, strokeUniforms) which re-wired our shader to the
        // SAME shared time-driven uniforms the live render loop and the
        // per-mesh onBeforeRender callbacks mutate every frame. Replace
        // those slots with our frozen refs so the cloned shader compiles
        // against a steady snapshot — eliminates the flicker caused by
        // overlapping clones at different scales each compositing the
        // live animation values.
        for (const k of Object.keys(frozenU)) {
          if (shader.uniforms[k]) shader.uniforms[k] = frozenU[k];
        }
        // Add the uniform declaration to the vertex shader and rewrite
        // the vPanelXY assignment to un-scale around uFadeCenter. Both
        // the original and our injection target the same line written by
        // origCb, so this replace runs against the already-modified
        // shader source.
        shader.vertexShader = shader.vertexShader.replace(
          'varying vec2 vPanelXY;\nuniform mat4 uPanelInv;',
          `varying vec2 vPanelXY;
           uniform mat4  uPanelInv;
           uniform vec2  uFadeCenter;
           uniform float uCloneScale;`
        );
        shader.vertexShader = shader.vertexShader.replace(
          'vPanelXY = (uPanelInv * _wp).xy;',
          `vec2 _origPanelXY = (uPanelInv * _wp).xy;
           // Un-scale only for clones SMALLER than 1 (so each shrunken
           // clone gets its own proportional inner-star cutout + radial
           // fade). For clones grown PAST 1 (zoom-through dive) leave
           // the coord in true panel space so the silhouette hullClip
           // still trims anything spilling past the gate frame — without
           // this, growing clones leak pattern outside the arch.
           float _csInv = 1.0 / clamp(uCloneScale, 0.001, 1.0);
           vPanelXY = (_origPanelXY - uFadeCenter) * _csInv + uFadeCenter;`
        );
      };
      // Force the cached compiled program (if any) to be discarded so
      // our wrapper actually runs. Without this, three.js's internal
      // material-version check might reuse the original's program.
      m.needsUpdate = true;
    }
    return m;
  }

  function cloneAllMaterials(root, cloneScaleUniform) {
    // Dedupe by source-material identity. `panel.clone(true)` shallow-shares
    // material refs across many meshes, so without dedup we'd build a
    // unique cloned material per mesh — bloating the per-frame opacity
    // sweep to hundreds of writes per clone. Sharing one cloned material
    // per source ref keeps `fadeables` proportional to UNIQUE materials,
    // not mesh count.
    const matMap = new Map();
    root.traverse(o => {
      if ((o.isMesh || o.isLine || o.isLineSegments) && o.material) {
        const orig = o.material;
        let cloned = matMap.get(orig);
        if (!cloned) {
          cloned = cloneMaterialPreservingTime(orig, cloneScaleUniform);
          matMap.set(orig, cloned);
        }
        o.material = cloned;
        // Strip per-mesh onBeforeRender callbacks. The lattice-underlay
        // and islamic-tile patterns set onBeforeRender on each tile to
        // write per-tile pulseTime / twinkleSeed into SHARED uniform
        // objects. After clone(true), every cloned mesh inherits the
        // same callback and races to stomp the same shared uniform each
        // frame — that's the flicker. Clones don't need per-tile
        // animations (we've frozen their shader's time uniforms) so
        // a no-op is the correct replacement.
        o.onBeforeRender = noop;
      }
    });
  }
  function noop() {}

  // Pick the focal tile = central rosette in the panel (the rosette mesh
  // closest to the fade centre). It's the one tile that grows huge while
  // the rest of the pattern is pushed out.
  let focalTile = null;
  {
    let best = Infinity;
    panel.traverse(o => {
      if (o.isMesh && o.userData.isRosette && o.userData.baseX !== undefined) {
        const dx = o.userData.baseX - fcx;
        const dy = o.userData.baseY - fcy;
        const d  = dx * dx + dy * dy;
        if (d < best) { best = d; focalTile = o; }
      }
    });
  }

  // Cache base mesh transforms so we can restore exact rest poses each
  // cycle (Three.js initialises mesh.scale to (1,1,1), but capture here
  // is defensive in case anything else has touched them).
  for (let i = 0; i < cascadeMeshes.length; i++) {
    const m = cascadeMeshes[i];
    m.userData.baseScaleX = m.scale.x;
    m.userData.baseScaleY = m.scale.y;
    m.userData.baseScaleZ = m.scale.z;
  }

  // NOTE: We deliberately don't fade the originals via their shared
  // fadeGradUniforms.uMaxOpacity uniform. That uniform is also referenced
  // by every clone's shader (the cloned MeshStandardMaterials inherit
  // onBeforeCompile from the originals, which captures the same
  // fadeGradUniforms object as a closure variable). Modifying it would
  // hide the clones too — defeating the whole effect. Instead we let the
  // existing push-out + silhouette hullClip handle the originals'
  // disappearance: by the cycle peak every non-focal tile has been
  // displaced past the gate frame and is masked out automatically.

  // Build N identical cloned copies of (panel + underlay) at the focal
  // centre, each z-recessed by a fixed step for transparent-sort order.
  // Their per-frame role (scale / opacity / rotation) is fully driven by
  // the global dive depth d in applyDive — no static per-clone state.
  const fractalState = { active: 1, phase: 'rest', phaseStart: 0,
                         lambda: 0, diveD: 0 };
  const fractalRoot  = new THREE.Group();
  fractalRoot.name = 'fractal-clone';
  fractalRoot.visible = false;
  logoMesh.add(fractalRoot);

  const clones = [];   // [{ pivot, fadeables, cloneScaleUniform }, ...]
  {
    const fcfg = ANIM.fractalZoom || {};
    const N = Math.max(1, fcfg.cloneCount ?? 5);
    const zStep  = fcfg.cloneZStep ?? 0.03;
    for (let k = 0; k < N; k++) {
      const pivot = new THREE.Group();
      // Sit each clone slightly BEHIND the previous one in z. With
      // transparent materials Three.js sorts back-to-front by depth, so
      // the deepest (smallest) clone draws first and the largest draws
      // last on top of it. The whole stack sits behind the live panel.
      pivot.position.set(cx + fcx, cy + fcy, -0.02 - k * zStep);
      fractalRoot.add(pivot);

      // Per-clone uCloneScale uniform — driven by applyClone each frame
      // so the shader can un-scale vPanelXY back to clone-local for the
      // radial fade and silhouette/inner-star clip tests.
      const cloneScaleUniform = { value: 0.001 };

      const cp = panel.clone(true);
      cp.position.set(-fcx, -fcy, panel.position.z);
      const cu = underlay.clone(true);
      cu.position.set(-fcx, -fcy, underlay.position.z);
      [cp, cu].forEach(g => {
        const toRemove = [];
        g.traverse(o => { if (o.isPoints) toRemove.push(o); });
        for (const p of toRemove) p.parent && p.parent.remove(p);
      });
      cloneAllMaterials(cp, cloneScaleUniform);
      cloneAllMaterials(cu, cloneScaleUniform);
      pivot.add(cp);
      pivot.add(cu);
      pivot.scale.set(0, 0, 1);

      const fadeables = [];
      const seenMats  = new Set();
      pivot.traverse(o => {
        const mat = o.material;
        // Dedup: cloneAllMaterials shares one cloned material across all
        // meshes that referenced the same source. Skip duplicates so we
        // don't write the same opacity twice every frame.
        if (!mat || seenMats.has(mat)) return;
        seenMats.add(mat);
        if (mat.uniforms && mat.uniforms.uMaxOpacity) {
          fadeables.push({ mat, kind: 'uniform',
                           base: mat.uniforms.uMaxOpacity.value });
        } else if (typeof mat.opacity === 'number') {
          fadeables.push({ mat, kind: 'opacity', base: mat.opacity });
        }
      });

      // Per-tile reveal stagger. For every cascade-tagged tile in the
      // cloned panel + underlay, store a normalized phase ∈ [0,1] that
      // mixes the tile's radial position (innermost first, outermost
      // last) with a per-tile random offset. The mix is controlled by
      // `revealStaggerJitter`:
      //   0   → purely radial (clean wave from the focal centre outward —
      //         every tile in the same ring fires at exactly the same
      //         scale, which concentrates "tiles arriving at peak" in a
      //         narrow window and leaves a faint brightness pulse).
      //   1   → purely random (each rosette / hex pops in on its own
      //         schedule, no ring structure).
      //   mid → radial trend with per-tile jitter — the bloom-from-centre
      //         feel survives, but individual flowers within a ring grow
      //         on their own timing so the perceived wave of completion
      //         is smeared across the whole zoom and any residual flash
      //         disappears into the noise.
      // Each clone draws a fresh random sequence, so the diving stack
      // doesn't replay the same pattern at every level.
      const revealTiles = [];
      const jitterMix = Math.min(1, Math.max(0,
        (ANIM.fractalZoom && ANIM.fractalZoom.revealStaggerJitter) ?? 0));
      const speedMin = Math.max(0.05,
        (ANIM.fractalZoom && ANIM.fractalZoom.revealSpeedMin) ?? 1);
      const speedMax = Math.max(speedMin,
        (ANIM.fractalZoom && ANIM.fractalZoom.revealSpeedMax) ?? 1);
      [cp, cu].forEach(g => g.traverse(o => {
        if (o.userData && o.userData.baseX !== undefined) {
          const r = o.userData.radius || 0;
          const radialPhase = maxRadius > 1e-4 ? r / maxRadius : 0;
          const randomPhase = Math.random();
          const phase = radialPhase * (1 - jitterMix) + randomPhase * jitterMix;
          // Per-tile growth speed multiplier ∈ [speedMin, speedMax].
          // Higher = tile zips through its reveal window quickly; lower
          // = tile takes longer to reach full size. Combined with the
          // randomized start phase, every flower has a unique
          // "personality" through the zoom — no two rosettes grow on
          // the same schedule, which is what fully kills the residual
          // wave-front read.
          const speed = speedMin + Math.random() * (speedMax - speedMin);
          revealTiles.push({
            mesh: o,
            revealPhase: phase,
            speed,
            baseScaleX: o.scale.x,
            baseScaleY: o.scale.y,
            baseScaleZ: o.scale.z,
          });
        }
      }));

      // Continuous Droste dive: every clone is identical at construction.
      // Their per-frame role (depth, scale, opacity, rotation) is computed
      // entirely from the global d(t) in applyDive — no static per-clone
      // scaleFactor or stagger offset.
      clones.push({ pivot, fadeables, cloneScaleUniform, revealTiles,
                    lastRevealMode: 'unset' });
    }
  }

  fractalState.triggerZoom = (t) => {
    fractalState.phase      = 'intro';
    fractalState.phaseStart = t;
  };

  // Debug: snapshot scripts can call this to drive the visual directly,
  // bypassing the natural state machine. lambda ∈ [0,1] = intro
  // displacement (focal grow + push-out); d = continuous dive depth.
  fractalState.applyAt = (lambda, d = 0) => {
    applyDisplacement(lambda);
    applyDive(d);
  };

  function smoothstep(x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return x * x * (3 - 2 * x);
  }

  // Linearly remap x from [a, b] → [0, 1], clamped.
  function rampLin(x, a, b) {
    if (b <= a) return x >= b ? 1 : 0;
    if (x <= a) return 0;
    if (x >= b) return 1;
    return (x - a) / (b - a);
  }

  // Reset every live tile to its rest pose. Called at the cycle handoff
  // and whenever pattern mode is left, so accumulated displacement /
  // scale doesn't leak between frames.
  function parkAllLensTiles() {
    for (let i = 0; i < cascadeMeshes.length; i++) {
      const m = cascadeMeshes[i];
      m.position.x = m.userData.baseX;
      m.position.y = m.userData.baseY;
      m.scale.set(m.userData.baseScaleX, m.userData.baseScaleY,
                  m.userData.baseScaleZ);
    }
    // Invalidate the displacement short-circuit so the next applyDisplacement
    // re-applies even if its lambda matches the value we last cached.
    lastLambda = -999;
  }

  // Short-circuit caches: lambda/d/op are constant during the long static
  // hold and the long dive's plateau, so re-applying identical values
  // every frame burned cycles writing the same numbers to hundreds of
  // meshes/materials. Skipping no-op writes is a major perf win.
  let lastLambda   = -999;
  let lastDiveD    = NaN;
  let lastDiveOp   = NaN;
  let lastFadeMode = 'unset';

  function applyDisplacement(lambda) {
    if (Math.abs(lambda - lastLambda) < 1e-4) return;
    lastLambda = lambda;
    // Focal tile: scale up around its rest position. The growing rosette
    // is allowed to extend past the silhouette — the in-shader hullClip
    // discards any fragment outside the gate-frame polygon, so the
    // visible part stays inside the frame even at huge scales.
    const cfg = ANIM.fractalZoom || {};
    const focalGrow = cfg.focalGrowMax  ?? 6.0;
    const pushMax   = (cfg.othersPushMax ?? 2.0) * maxRadius;
    const focalScale = 1 + lambda * (focalGrow - 1);
    const push       = lambda * pushMax;

    for (let i = 0; i < cascadeMeshes.length; i++) {
      const m = cascadeMeshes[i];
      if (m === focalTile) {
        // Focal stays put, only scales up.
        m.position.x = m.userData.baseX;
        m.position.y = m.userData.baseY;
        m.scale.set(m.userData.baseScaleX * focalScale,
                    m.userData.baseScaleY * focalScale,
                    m.userData.baseScaleZ);
      } else {
        // Every other tile slides outward along its outward ray (already
        // computed at load as userData.rayX/Y). At λ=1 the push (≈ 2 ×
        // maxR) puts every tile far past the silhouette → fully masked.
        m.position.x = m.userData.baseX + push * m.userData.rayX;
        m.position.y = m.userData.baseY + push * m.userData.rayY;
        m.scale.set(m.userData.baseScaleX,
                    m.userData.baseScaleY,
                    m.userData.baseScaleZ);
      }
    }
  }

  // Continuous Droste dive — one global d drives every clone. Each
  // clone's "role" rotates through the full life cycle (tiny emergent →
  // peak → grown past peak → escape) as d advances; modular arithmetic
  // makes that rotation seamless because the wraparound happens where
  // opacity is already zero.
  //
  // `opacityMul` is the global cloneOp envelope (1 during dive, 0 in the
  // hold's pure-static window, ramping in/out across the fade windows).
  // `fadeMode` annotates the fade direction so per-clone fade staggering
  // (cloneFadeStagger) can apply during hold fade-in / fade-out without
  // perturbing the steady-state dive: 'fadeIn' = 1 → 0 (entering hold),
  // 'fadeOut' = 0 → 1 (leaving hold), 'steady' = no stagger applied.
  function applyDive(d, opacityMul = 1.0, fadeMode = 'steady') {
    const cfg = ANIM.fractalZoom || {};
    const N = clones.length;
    if (N === 0) return;
    // Fully-faded fast path. During the long pure-static hold window
    // (cloneOp = 0 for ~57 of every 60 seconds) we hide every clone
    // pivot and skip the per-clone scale/opacity sweep entirely — three.js
    // then culls them so we save 5× (panel+underlay) draw calls.
    if (opacityMul <= 1e-4) {
      if (!(lastDiveOp <= 1e-4)) {
        for (let k = 0; k < N; k++) clones[k].pivot.visible = false;
      }
      lastDiveOp = 0;
      return;
    }
    if (Math.abs(d - lastDiveD) < 1e-5 &&
        Math.abs(opacityMul - lastDiveOp) < 1e-4 &&
        fadeMode === lastFadeMode) return;
    lastDiveD     = d;
    lastDiveOp    = opacityMul;
    lastFadeMode  = fadeMode;
    const scaleF = cfg.cloneScaleFactor ?? 0.5;
    const g      = 1 / Math.max(scaleF, 0.05);   // growth factor between layers
    const sigma  = Math.max(cfg.droSigma ?? 0.45, 1e-3);
    const rotPer = cfg.droLayerRotation ?? 0.0;
    const half   = N * 0.5;
    const lnG    = Math.log(g);
    const revealSpread    = Math.min(0.95, Math.max(0, cfg.revealStaggerSpread ?? 0.0));
    const revealOvershoot = Math.max(0, cfg.revealOvershoot ?? 0.0);
    const fadeStagger     = Math.min(0.95, Math.max(0, cfg.cloneFadeStagger ?? 0.0));
    for (let k = 0; k < N; k++) {
      // Each clone's effective depth wraps modulo N into [-N/2, N/2).
      // Subtracting k staggers them by one Droste step apiece, so at any
      // instant the N clones occupy N evenly-spaced depths.
      let r = ((d - k + half) % N + N) % N - half;
      const scale = Math.pow(g, r);
      const c = clones[k];
      // Gaussian opacity envelope around scale = 1 (r = 0). At r = ±N/2
      // the exponent is huge so opacity ≈ 0 — that's where the modular
      // wraparound happens, hiding the seam.
      const logS = r * lnG;
      let op = Math.exp(-(logS / sigma) * (logS / sigma)) * opacityMul;

      // Per-clone fade stagger (only during hold's fade-in / fade-out).
      // Shallow clones (|r| close to 0) lead the crossfade; deeper clones
      // (|r| close to N/2) lag by up to `fadeStagger` of the window. So
      // when fading back in toward the dive, the closest-to-peak layer
      // appears first and deeper layers slip in behind it — the user no
      // longer sees "a few patterns appear simultaneously". When fading
      // INTO static, the same shift makes deep clones dissolve away
      // before the shallow layer finishes its descent. The global
      // cloneOp is already eased (ease-out cubic, set in updateFractalZoom),
      // so we apply a plain smoothstep per-clone — soft start + end on
      // each layer's local ramp window without double-easing.
      if (fadeStagger > 0 && fadeMode !== 'steady') {
        const rNorm = Math.min(1, Math.abs(r) / Math.max(half, 1e-4));
        const shift = rNorm * fadeStagger;
        // local in [0,1] = how far this clone is into its OWN fade window.
        // Same formula for fadeIn / fadeOut: opacityMul itself encodes
        // direction (1→0 vs 0→1), so local mirrors that.
        let local = (opacityMul - shift) / Math.max(1e-3, 1 - shift);
        if (local <= 0)      local = 0;
        else if (local >= 1) local = 1;
        else                 local = local * local * (3 - 2 * local); // smoothstep
        const baseEnv = Math.exp(-(logS / sigma) * (logS / sigma));
        op = baseEnv * local;
      }

      // Hide essentially-invisible clones so three.js skips their draw
      // calls. With sigma=0.7 and N=5 there are always 1–2 clones at
      // op < 1e-3 (the wrap-around layers); culling them costs nothing
      // visually and saves panel+underlay draw work each frame.
      if (op < 1e-3) {
        c.pivot.visible = false;
        // Park reveal state so the next time this clone re-emerges we
        // re-apply the staggered scale-up from scratch.
        c.lastRevealMode = 'hidden';
        continue;
      }
      c.pivot.visible = true;
      c.pivot.scale.set(scale, scale, 1);
      c.pivot.rotation.z = rotPer * r;
      // Drive the per-clone shader uniform so silhouette / inner-star
      // cutout work in clone-local coords (clamped to ≤1 so clones grown
      // past full size still get clipped against the world-space arch).
      c.cloneScaleUniform.value = Math.max(scale, 0.001);
      for (let i = 0; i < c.fadeables.length; i++) {
        const f = c.fadeables[i];
        if (f.kind === 'uniform') f.mat.uniforms.uMaxOpacity.value = f.base * op;
        else                      f.mat.opacity                    = f.base * op;
      }

      // Per-tile reveal stagger inside this clone. As the pivot scale
      // grows from 0 toward 1, each tile's LOCAL scale ramps from 0 → 1
      // on its own curve, with `revealPhase` (0 = innermost, 1 = outer
      // ring) controlling how late it joins. Net effect: each clone
      // appears to bloom outward from its focal centre instead of
      // arriving as a uniform rectangle whose outer tiles all reach the
      // gate-frame edge at the same instant. Once the clone has grown
      // past peak we lock every tile at full local scale and skip the
      // per-tile sweep until the clone wraps back to the emerging side.
      if (revealSpread <= 0) {
        // Stagger disabled — make sure tiles are at their cloned base
        // scale (idempotent fast path, no per-frame writes once set).
        if (c.lastRevealMode !== 'full-norevealcfg') {
          for (let i = 0; i < c.revealTiles.length; i++) {
            const rt = c.revealTiles[i];
            rt.mesh.scale.set(rt.baseScaleX, rt.baseScaleY, rt.baseScaleZ);
          }
          c.lastRevealMode = 'full-norevealcfg';
        }
      } else if (scale >= 1.0 + revealOvershoot) {
        // Past peak (and past every tile's individual end-scale) — pin
        // all tiles at full and skip per-frame writes.
        if (c.lastRevealMode !== 'full') {
          for (let i = 0; i < c.revealTiles.length; i++) {
            const rt = c.revealTiles[i];
            rt.mesh.scale.set(rt.baseScaleX, rt.baseScaleY, rt.baseScaleZ);
          }
          c.lastRevealMode = 'full';
        }
      } else {
        // Growing — apply staggered per-tile reveal. Each tile's window
        // is `[revealPhase × revealSpread, 1 + revealPhase × revealOvershoot]`:
        //   phase=0 (innermost) reveals over scale [0, 1].
        //   phase=1 (outermost) reveals over scale [revealSpread,
        //                                           1 + revealOvershoot].
        // Crucially, outermost tiles DON'T finish at scale=1 — they
        // finish PAST it. So when the clone first reaches scale=1, its
        // outer ring is still small / invisible and the gate-frame
        // silhouette is NOT outlined by a wall of full-size rosettes.
        // As the clone grows past scale=1, those outer tiles ramp up
        // inside the hullClip silhouette mask, filling the rim
        // gradually. By scale = 1+revealOvershoot every tile is at full.
        // Per-tile `speed` warps the smoothstep so individual rosettes
        // progress through their own window at their own rate.
        for (let i = 0; i < c.revealTiles.length; i++) {
          const rt = c.revealTiles[i];
          const t0  = rt.revealPhase * revealSpread;
          const t1  = 1 + rt.revealPhase * revealOvershoot;
          const den = t1 - t0;
          let f = den > 1e-4 ? (scale - t0) / den : 1;
          if (f <= 0) {
            rt.mesh.scale.set(0, 0, rt.baseScaleZ);
            continue;
          }
          if (f >= 1) f = 1;
          else {
            f = f * f * (3 - 2 * f);
            if (rt.speed !== 1) f = Math.pow(f, 1 / rt.speed);
          }
          rt.mesh.scale.set(rt.baseScaleX * f, rt.baseScaleY * f, rt.baseScaleZ);
        }
        c.lastRevealMode = 'growing';
      }
    }
  }

  // Force every clone to opacity 0 + scale 0 (used when leaving pattern
  // mode so the fractal stack is fully invisible and we don't bake
  // arbitrary per-frame state into the next entry).
  function parkAllClones() {
    for (let k = 0; k < clones.length; k++) {
      const c = clones[k];
      c.pivot.scale.set(0, 0, 1);
      c.pivot.rotation.z = 0;
      c.pivot.visible = false;
      c.cloneScaleUniform.value = 0.001;
      for (let i = 0; i < c.fadeables.length; i++) {
        const f = c.fadeables[i];
        if (f.kind === 'uniform') f.mat.uniforms.uMaxOpacity.value = 0;
        else                      f.mat.opacity                    = 0;
      }
      // Reset per-tile scales + reveal state so the next emergence
      // re-applies the staggered scale-up from scratch.
      for (let i = 0; i < c.revealTiles.length; i++) {
        const rt = c.revealTiles[i];
        rt.mesh.scale.set(0, 0, rt.baseScaleZ);
      }
      c.lastRevealMode = 'unset';
    }
    // Invalidate the dive short-circuit so the next applyDive re-applies.
    lastDiveD = NaN; lastDiveOp = NaN; lastFadeMode = 'unset';
  }

  function updateFractalZoom(t /*, dt */) {
    const cfg = ANIM.fractalZoom;
    // Bail in any non-pattern mode. Snap state back to a clean rest so
    // re-entering pattern mode starts fresh, and clear any accumulated
    // displacement / opacity on both originals and clones.
    if (!cfg || cfg.enabled === false || ANIM.viewMode !== 'pattern') {
      if (fractalRoot.visible) {
        fractalRoot.visible = false;
        parkAllLensTiles();
        parkAllClones();
      }
      fractalState.phase      = 'rest';
      fractalState.phaseStart = t;
      fractalState.lambda     = 0;
      fractalState.diveD      = 0;
      fractalState.cloneOp    = 0;
      fractalState.active     = 1;
      return;
    }

    fractalRoot.visible = true;

    const introDur = cfg.introDuration    ?? 4.0;
    const stepDur  = cfg.droStepDuration  ?? 9.0;
    const diveDur  = cfg.diveDuration     ?? 18.0;
    const holdDur  = cfg.holdDuration     ?? 60.0;
    const holdIn   = cfg.holdFadeIn       ?? 1.5;
    const holdOut  = cfg.holdFadeOut      ?? 1.5;
    const trigDel  = cfg.triggerDelay     ?? 0.0;
    const elapsed  = t - fractalState.phaseStart;
    let lambda  = 0;   // intro displacement progress (0..1)
    let d       = 0;   // dive depth — frozen at integer values during hold
    let cloneOp = 1;   // multiplier on clone opacity envelope (drops to 0
                       // during the static window so the original pattern
                       // is what's actually visible at rest)
    let holding = false;
    let fadeMode = 'steady';   // 'fadeIn' / 'fadeOut' during hold crossfade
                               // windows — gates per-clone fadeStagger in
                               // applyDive so the dive's steady state isn't
                               // perturbed.

    if (fractalState.phase === 'rest') {
      // Initial settle before the very first dive. After triggerDelay
      // seconds in pattern mode, kick into intro.
      if (elapsed >= trigDel) {
        fractalState.phase      = 'intro';
        fractalState.phaseStart = t;
      } else {
        parkAllLensTiles();
        parkAllClones();
        fractalState.lambda  = 0;
        fractalState.diveD   = 0;
        fractalState.cloneOp = 0;
        fractalState.active  = 1;
        return;
      }
    }
    const introElapsed = t - fractalState.phaseStart;
    if (fractalState.phase === 'intro') {
      // Two-track intro to keep the silhouette edge invisible:
      //   • d eases 0 → 1 over the FULL introDuration so the clone stack
      //     gradually emerges from the central rosette (no popping in).
      //   • λ eases 0 → 1 only in the LAST `lambdaFadeDur` seconds. By
      //     the time λ starts moving (the displacement transition that
      //     would expose the arch silhouette), the clones are already
      //     near full opacity and cover that motion entirely.
      // Both end at u=1 so derivative-zero at the intro→dive boundary
      // is preserved, matching the dive's own smoothstep ease-in.
      const introTotal = Math.max(introDur, 1e-3);
      const lDur       = Math.min(cfg.lambdaFadeDur ?? 1.5, introTotal);
      const u_d = Math.min(1, introElapsed / introTotal);
      const u_l = Math.min(1, Math.max(0, introElapsed - (introTotal - lDur)) /
                              Math.max(lDur, 1e-3));
      d      = smoothstep(u_d);
      lambda = smoothstep(u_l);
      if (u_d >= 1) {
        fractalState.phase      = 'dive';
        fractalState.phaseStart = t;
        // Carry the d we ended intro at into the dive's start so the
        // depth reading is continuous across the phase boundary.
        fractalState.diveD0     = 1;
      }
    } else if (fractalState.phase === 'dive') {
      // Eased Droste dive: d moves from startD → targetD with smoothstep
      // over the full segment (slow start, peak speed midway, slow end).
      // targetD is snapped to the next integer-d so the hold lands on an
      // at-peak clone (visually identical to the pattern at rest). The
      // Gaussian opacity envelope and modular role-rotation in applyDive
      // don't depend on d's velocity, so easing is safe here.
      lambda = 1;
      const startD = fractalState.diveD0 ?? 1;
      const stepsToCover = Math.max(1, Math.ceil(diveDur / Math.max(stepDur, 1e-3)));
      const targetD = Math.round(startD + stepsToCover);
      // Total segment duration = (targetD - startD) Droste steps at the
      // configured stepDur (peak speed). With smoothstep the average
      // speed is half of peak, so the segment takes 2× longer than the
      // raw step count would suggest — that's the "slow it down" feel.
      const segDur = (targetD - startD) * Math.max(stepDur, 1e-3);
      const u = Math.min(1, introElapsed / segDur);
      d = startD + (targetD - startD) * smoothstep(u);
      if (u >= 1) {
        d = targetD;
        // Skip hold entirely if user dialed it to ≤ 0 (continuous dive).
        if (holdDur > 0) {
          fractalState.phase      = 'hold';
          fractalState.phaseStart = t;
          fractalState.holdD      = d;
        } else {
          fractalState.diveD0 = d;
          fractalState.phaseStart = t;
        }
      }
    } else if (fractalState.phase === 'hold') {
      // Three sub-windows over holdDur. Within each fade window, λ and
      // cloneOp run on SEPARATE schedules:
      //   [0, holdIn)               — fade IN to static.
      //     • cloneOp 1 → 0 over the FULL holdIn (slow opacity crossfade
      //       — the Droste-nested clones gradually dissolve into the
      //       canonical pattern at rest).
      //     • λ 1 → 0 in the FIRST `lambdaFadeDur` seconds only. The
      //       displacement transition (focal shrink / pushed-tile slide)
      //       happens fast and is hidden under the still-opaque clones,
      //       so the arch silhouette never flashes through.
      //   [holdIn, holdDur-holdOut) — pure static. lambda=0, cloneOp=0.
      //                               Sparks snap (holding=true). Viewer
      //                               sees the canonical pattern at rest.
      //   [holdDur-holdOut, holdDur)— fade OUT of static.
      //     • cloneOp 0 → 1 over the FULL holdOut (Droste nesting
      //       gradually appears inside the static pattern).
      //     • λ 0 → 1 in the LAST `lambdaFadeDur` seconds, again under
      //       cover of mostly-opaque clones. Then dive resumes.
      d = fractalState.holdD ?? 1;
      const tIn   = Math.max(holdIn,  1e-3);
      const tOut  = Math.max(holdOut, 1e-3);
      const lDur  = cfg.lambdaFadeDur ?? 1.5;
      const lIn   = Math.min(lDur, holdIn);
      const lOut  = Math.min(lDur, holdOut);
      if (introElapsed < holdIn) {
        // Fade IN to static — clones dissolve out toward the canonical
        // rest pattern. Ease-OUT cubic on the descent: quick early drop
        // off the dive's full opacity, then a long soft tail into 0 so
        // the last sliver of clone presence dies away gently rather than
        // snapping to nothing.
        const u = introElapsed / tIn;
        cloneOp = Math.pow(1 - Math.min(1, u), 3);   // 1 → 0, ease-out
        lambda  = 1 - smoothstep(introElapsed / Math.max(lIn, 1e-3));
        fadeMode = 'fadeIn';
      } else if (cfg.oneShot || introElapsed < Math.max(0, holdDur - holdOut)) {
        // One-shot mode: after the single intro+dive completes and the
        // fade-IN to static finishes, stay parked at rest forever. Skip
        // both the fade-OUT and the dive-resume branches so the pattern
        // settles into its canonical look and never zooms again.
        lambda  = 0;
        cloneOp = 0;
        holding = true;
      } else if (introElapsed < holdDur) {
        // Fade OUT of static — clones well back in. Ease-OUT cubic
        // (1 - (1-u)³) so the Droste nesting reappears with a quick
        // initial presence and then a long soft approach toward full
        // opacity, instead of the previous smoothstep that hit peak
        // velocity midway and produced the brightness-flash feel. The
        // per-clone fadeStagger inside applyDive then spaces shallow vs
        // deep layers so we don't see "a few patterns appear at once".
        const offset = introElapsed - (holdDur - holdOut);
        const u = Math.min(1, offset / tOut);
        cloneOp = 1 - Math.pow(1 - u, 3);            // 0 → 1, ease-out
        // λ stays at 0 until the last lOut seconds, then ramps up.
        const lambdaStart = holdOut - lOut;
        lambda  = smoothstep(Math.max(0, offset - lambdaStart) /
                             Math.max(lOut, 1e-3));
        fadeMode = 'fadeOut';
      } else {
        // Hold complete — dive resumes from the held d.
        fractalState.phase      = 'dive';
        fractalState.phaseStart = t;
        fractalState.diveD0     = d;
        lambda  = 1;
        cloneOp = 1;
      }
    }

    fractalState.lambda  = lambda;
    fractalState.diveD   = d;
    fractalState.cloneOp = cloneOp;   // exposed for spark gating in main.js
    // Sparks snap at rest AND during hold's pure-static window (where the
    // canonical pattern is on screen); float free during intro, dive, and
    // the hold's crossfade windows (where motion is happening).
    fractalState.active = holding ? 1 : (1 - lambda);

    applyDisplacement(lambda);
    applyDive(d, cloneOp, fadeMode);
  }

  return { strokeTimeUniforms, sparkSystems, patternsToRefresh,
           updateRowCascade, cascadeState, updateRotations,
           updateFractalZoom, fractalState,
           panelGroup: panel,
           latticeGroup: underlay,
           gateFrameGroup: gate,
           archGroup: arch.group,
           updateArch: arch.update,
           triggerArchCascade: arch.triggerCascade,
           flameGroup:   flame.group,
           updateFlame:  flame.update,
           flameLights:  flame.lights,
           fireplaceGroup:  fireplace.group,
           updateFireplace: fireplace.update,
           // Mesh-local silhouette polygons (logoMesh sits at world origin
           // so these double as world-XY for downstream consumers like
           // src/dominoes.js).
           silhouettePolygons };
}
