// =======================================================================
// CONFIG — the single tweak file.
// Edit values here and reload to change the design. For live tweaks in
// devtools, every export is mirrored onto `window.{MODEL,ANIM,COLORS}`
// and most values are re-read each frame (see src/lights.js + src/main.js).
// Values that are only read at model-load time (spark counts, particle
// counts, material metalness) require a reload.
//
// Color format: every colour is a '#RRGGBB' hex string so values are
// eyeball-able. THREE.Color accepts hex strings directly; shader-uniform
// RGB arrays are converted via `hexToRgb()` at the consumer site.
// =======================================================================

// -----------------------------------------------------------------------
// MODEL — which 3D file to load and how to place it. Extension drives the
// loader (.glb / .gltf / .obj supported). Edit `path` and reload to swap.
// -----------------------------------------------------------------------
export const MODEL = {
  path:            './3DModels/SDG_logo_3d.glb',
  scaleToMaxDim:   8,
  positionOffsetY: -1.0,
};

// -----------------------------------------------------------------------
// ANIM — every animated value lives here. Edit in source or at runtime
// via `window.ANIM` in devtools. Most values are re-read each frame.
// Spark `count` + particle count are read only at load (reload to change).
// -----------------------------------------------------------------------
export const ANIM = {
  pulseSpeed: 1.0,

  // Master toggle for the front-face pattern layers (Islamic panel +
  // lattice underlay, plus their child spark systems). Flip to false —
  // or `ANIM.patterns.enabled = false` in devtools — to hide the
  // decorative layers so the bare model, gate frame, and overlay are
  // visible on their own. Gate frame stays put.
  patterns: { enabled: true },

  // Active view mode — driven by the digit keys 0–5 (handled in main.js).
  // 'all' plays today's synchronized sequence (cascade + flowers + sparks
  // sync'd via ANIM.timings.playAll). Single-effect modes solo one layer
  // on its own clock; the base scene (logo, gate frame, particles, lights)
  // stays on underneath.
  //   0 → 'all'  | 1 → 'pattern'  | 2 → 'hex'
  //   3 → 'flowers'  | 4 → 'arch'  | 5 → 'flame'
  viewMode: 'all',

  keyLight:          { intensityMin: 0.0,  intensityMax: 4.6,
                       colorAtMin: '#FF1400', colorAtMax: '#FFCC2E' },
  innerGlow:         { intensityMin: 40,   intensityMax: 260, color: '#FF6A18' },
  frontPatternLight: { intensityMin: 1.2,  intensityMax: 4.8, color: '#FFB070' },
  rimLight:          { intensityMin: 0.5,  intensityMax: 2.5,
                       phaseOffset: Math.PI * 0.5, color: '#4D8AFF' },

  ambientIntensity:     0.1,
  fillIntensity:        0.4,
  rearPatternIntensity: 1.2,
  rearPatternColor:     '#7A96C8',

  galaxy: { timeScale: 1.0, brightness: 1.0 },

  // Logo base material breathes between near-black and full brightness.
  logoBase: { brightnessMin: 0.2, brightnessMax: 1.0, period: 20.0 },

  // Over-exaggerated per-hex pulse on the lattice underlay. Each hex gets
  // a random phase seed + random speed factor at load time so neighbours
  // drift out of sync in both phase and period. `brightness*` modulates
  // diffuse, `emissive*` drives a self-lit pop that cuts past the scene
  // lighting. `colorAt{Min,Max}` are the dim/bright colour endpoints.
  latticeHex: { brightnessMin: 0.25, brightnessMax: 1.6,
                emissiveMin:   0.0,  emissiveMax: 2.8,
                pulseSpeed:    0.55, speedVariance: 0.6,
                colorAtMin: '#1A0800', colorAtMax: '#FFB040' },

  emberParticles: { cycleDuration: 7.0,
                    bodyColor: '#FF851A', coreColor: '#FFE08C',
                    brightness: 1.7 },
  whiteParticles: { cycleDuration: 7.0,
                    bodyColor: '#E0EBFF', coreColor: '#FFFFFF',
                    brightness: 1.7 },

  // `hueVariance` shifts each spark's hue by ±that fraction of the colour
  // wheel from `color` at spawn time (0 = monochrome, 0.1 ≈ ±36°).
  // `trailSize` is the ring-buffer length of past positions drawn behind each
  // spark (load-only; reload after editing). Higher = longer tracer.
  panelSparks:   { count: 220, gravity: 5, maxSpeed: 7, damping: 1.6,
                   snapStrength: 18,
                   tangentialFactor: 1.1, speedVariance: 0.55, sizeVariance: 0.75,
                   color: '#FFD9A0', hueVariance: 0.08,
                   pointSize: 0.1, trailSize: 150 },
  latticeSparks: { count: 150, gravity: 4, maxSpeed: 6, damping: 1.5,
                   snapStrength: 8,
                   tangentialFactor: 1.1, speedVariance: 0.55, sizeVariance: 0.75,
                   color: '#FFE8C0', hueVariance: 0.08,
                   pointSize: 0.15, trailSize: 40 },
  // Companion layer that follows the stroke lines like panelSparks but in
  // white — delayed start so it lights up after the main spark layer is
  // established, and dimmer so it reads as a secondary glow rather than
  // competing.
  centralSparks: { count: 55, gravity: 11, maxSpeed: 8, damping: 1.4,
                   snapStrength: 18,
                   tangentialFactor: 1.1, speedVariance: 0.4, sizeVariance: 0.5,
                   color: '#FFFFFF', hueVariance: 0,
                   pointSize: 0.13, trailSize: 150,
                   startDelay: 2.0, startDelayMax: 18.0, brightness: 1.0 },

  // Sparks for the procedural-brick arch (mode 4). Snap cloud is built from
  // an invisible LineSegments layer cloned from each brick's edges, so
  // sparks hop along brick outlines / mortar gaps the same way panelSparks
  // hop along stroke lines.
  archSparks:    { count: 90, gravity: 5, maxSpeed: 7, damping: 1.6,
                   snapStrength: 18,
                   tangentialFactor: 1.1, speedVariance: 0.55, sizeVariance: 0.75,
                   color: '#FFD9A0', hueVariance: 0.08,
                   pointSize: 0.12, trailSize: 150 },

  // Slow rotation on a random subset of rosettes ("flowers") and lattice
  // hexes. Each picked mesh gets a random phase offset and a signed angular
  // speed picked uniformly from [speedMin, speedMax] (half CCW, half CW) so
  // neighbours drift out of sync. `rosetteFraction`/`hexFraction` control
  // what share of each pattern rotates; the rest stay still. Fractions +
  // per-mesh speed assignments are sampled at load (reload to resample);
  // `enabled`, `speedMin`, `speedMax` are read live but changing speed at
  // runtime causes a small jump since `rotation.z = phase + speed*t`.
  patternRotation: {
    enabled:         true,
    rosetteFraction: 0.35,  // share of rosettes that rotate
    hexFraction:     0.35,  // share of lattice hexes that rotate
    speedMin:        0.15,  // radians/sec (≈8.6°/sec)
    speedMax:        0.50,  // radians/sec (≈28.6°/sec)
  },

  // Two translucent star fans anchored to the left and right edges,
  // fanning inward (see src/3DOverlay.js). Each fan is a row of 12-pt
  // rosettes on rays from an edge pivot; the wrapper pulses (scale
  // breathes) and slowly spins. One side spins CW, the other CCW.
  //   starCount    — stars per fan blade count
  //   starSize     — rosette outer radius (main pattern uses 2.4, so
  //                  1.2 = half-size)
  //   angleSpread  — total fan angle, radians (π*0.55 ≈ 100°)
  //   fanRadius    — distance from pivot to each star along its ray
  //   zOffset      — depth above maxZ; between main patterns and gate
  //   scaleMin/Max — wrapper scale at trough / peak of the pulse
  //   pulsePeriod  — seconds for one full scale in-out
  //   spinSpeed    — radians/sec; one side CW, the other CCW
  //   opacity      — star alpha (0..1)
  overlay: {
    enabled:        true,
    instances:      10,    // instance count on the OUTERMOST ring.
                           // Inner rings scale their count down with
                           // ring radius so angular spacing stays
                           // roughly uniform across the fill.
    radialRadiusFactor: 0.64, // outermost ring radius, as a multiple
                           // of maxR. Too large and flowers fall
                           // outside the silhouette mask and get
                           // clipped.
    ringSpacingFactor:  0.28, // radial gap between adjacent rings, as
                           // a multiple of maxR. Lower = more rings
                           // (denser fill); higher = fewer rings.
    innerRadiusFactor:  0.14, // stop adding rings once radius drops
                           // below this (× maxR). Keeps the central
                           // vanishing-point area clear so the
                           // particle convergence stays readable.
    maskClip:       true,  // stencil-clip cluster fragments to the
                           // silhouette interior so any rays poking
                           // past the gate-frame outline are masked.
                           // false = no clip (overflow visible).
    maskInset:      1.6,   // inset the stencil polygon inward by this
                           // many units so it lines up with the gate
                           // frame's INNER edge (gateFrameWidth in
                           // patterns-layer.js is 1.6). Clusters never
                           // overlap the frame ring. 0 = clip to the
                           // outer silhouette (old behaviour).
    starCount:      1,
    starSize:       30.0,  // outer radius of the largest cascade layer.
                           // Wrapper scales by up to scaleMax, so the
                           // max on-screen radius is starSize * scaleMax.
                           // Keep it under the gate-frame's inner span.
    starDepth:      1.5,   // z-extrusion thickness (load-only). Set to
                           // null/undefined to auto-derive from starSize.
    cascade: {             // stack of concentric rosettes at this fan
                           // position — largest first, each next layer
                           // scaled down by `scaleStep` and pushed
                           // forward by `zStep` so extrusions overlap.
      count:         3,
      scaleStep:     0.75, // size ratio between adjacent layers
      zStep:         1.0,  // z gap between layer bases. With
                           // starDepth=1.5, a zStep of 1.0 sinks each
                           // layer's base 0.5 units into the one below.
      tipLift:       0.6,  // dome the outer rim toward the camera
                           // (layer-local units at the outermost
                           // vertex, quadratic falloff from the hub).
                           // 0 = flat extrusion. Scaled per-layer so
                           // every star shares the same dish angle.
      pulseVariance: 0.3,  // ±fraction of `pulsePeriod` each layer's
                           // own period may drift by (picked randomly
                           // at load). 0 = all layers locked to the
                           // base period; 0.3 = organic detune.
      colorDarkest:  '#6B4820',  // colour of the largest/bottom layer
                                 // — deep amber, most hue-shifted.
      colorLightest: '#F0D088',  // colour of the smallest/top layer —
                                 // bright warm-gold highlight.
    },
    angleSpread:    Math.PI * 0.55,
    fanRadius:      2.8,
    zOffset:        6.0,   // star sits at maxZ+zOffset; hex backdrop sits
                           // depth behind that (hex front face at
                           // maxZ+zOffset-depth/2). Keep zOffset > 1.5*
                           // hexagon.depth so the hex clears the model
                           // front face instead of getting clipped by it.
    scaleMin:       0.85,  // flower scale pulse — wrapper breathes
    scaleMax:       1.10,  // between these two values each pulsePeriod.
    pulsePeriod:    6.0,
    spinSpeed:      0.00,
    opacity:        0.5,
    halfCut:        false, // full 12-point rosette (hub + all petals).
                           // true drops the -x half so it reads as a
                           // crescent — useful when the flower is
                           // anchored flush to an outline edge, not for
                           // radial placement around a centre point.
    snapToEdge:     true,  // true: wrapper anchored to the left outline
                           // pivot so the rosette's cut edge lines up
                           // with the archway's side. false: use
                           // previewXFactor to park it in empty space.
    rotationOffset: 0.0,   // extra clockwise rotation (radians) layered
                           // on top of the edge-aligned base rotation.
                           // Positive = clockwise. Useful when the
                           // detected tangent doesn't quite match the
                           // straight side you have in mind.
    previewXFactor: -1.5,  // preview: offsets overlay from hull centroid
                           // in maxR units. Negative = left, positive =
                           // right. Magnitude must clear half the
                           // rosette's own outer radius so it sits
                           // beside the logo instead of overlapping.

    // Domino petal-flip — each rosette picks a random start petal every
    // cycle, then chains to the angularly closest unvisited petal from
    // the most recent trigger, so the wave walks neighbour-to-neighbour
    // like falling dominoes. Each petal does one full 360° rotation
    // around its base-tangent axis over `fallDuration` seconds; the
    // next petal fires `triggerInterval` seconds later so adjacent
    // petals overlap mid-flip. After the last petal completes, the
    // flower holds flat for `pause` seconds before restarting with a
    // fresh random start + direction.
    //   triggerInterval — seconds between consecutive petal firings
    //                     (< fallDuration for a visible domino wave)
    //   fallDuration    — seconds for one petal's full 2π flip
    //   pause           — gap between cycles, seconds
    //   initStaggerMax  — each flower delays its first cycle by up to
    //                     this many seconds so neighbouring rosettes
    //                     don't all start in sync on load
    petalDomino: {
      enabled:         true,
      triggerInterval: 0.08,
      fallDuration:    0.9,
      pause:           1.5,
      initStaggerMax:  3.0,
      ringStagger:     0.9,  // seconds of delay added per inward ring,
                             // so the flip wave starts on the OUTER
                             // ring and propagates toward the centre.
                             // Higher = slower inward sweep; 0 = all
                             // rings fire simultaneously.
    },

    // Per-petal brightness twinkle — each petal owns its own material
    // clone and pulses between brightnessMin/Max (diffuse) + emissive
    // Min/Max with an independent random phase and a period scaled by a
    // random factor in [1-speedVariance, 1+speedVariance]. Result is a
    // "slightly random" shimmer where neighbours drift in/out of sync
    // without any single global beat. Emissive uses each petal's base
    // colour so the pulse reads as warm glow rather than a wash.
    petalBrightness: {
      enabled:       true,
      brightnessMin: 0.45,  // diffuse colour multiplier at trough
      brightnessMax: 1.35,  // diffuse colour multiplier at peak
      emissiveMin:   0.0,   // emissiveIntensity at trough
      emissiveMax:   0.8,   // emissiveIntensity at peak
      pulsePeriod:   3.8,   // seconds for one full brightness cycle
      speedVariance: 0.45,  // ±fraction of pulsePeriod per-petal drift
      startDelay:    2.5,   // seconds after load that petals stay steady
                            // (no brightness modulation) before the
                            // shimmer begins to fade in.
      rampDuration:  4.0,   // seconds for the shimmer envelope to ramp
                            // from 0 (flat) to 1 (full amplitude) after
                            // startDelay. Uses a smoothstep curve so
                            // the pulse grows rather than snaps on.
    },

    // Large 3D hexagonal prism centred on the logo — a neutral canvas
    // for future "looks" (material swaps, emissive pulses, rotation,
    // etc.). Not driven by the fan pulse/spin; add animation hooks in
    // src/3DOverlay.js if you want it to move.
    //   radiusFactor — hex circumradius as a multiple of starSize
    //                  (so the hex tracks the rosette's outer radius;
    //                  >1 = hex slightly larger than the star)
    //   depth        — extrusion thickness along z
    //   zOffset      — z-shift relative to the preview star's depth
    //                  plane (0 = coplanar with star, negative =
    //                  behind it, positive = in front)
    //   flatTop      — true: flat edge on top; false: vertex on top
    //   halfCut      — true: keep the +x half only (matches the
    //                  rosette's halfCut — cut edge on -x, faces +x)
    hexagon: {
      enabled:      false,
      radiusFactor: 1.15,
      depth:        20.0,
      opacity:      0.35,
      zOffset:      1.0,
      flatTop:      true,
      halfCut:      true,
    },
    brickWall: { enabled: true },
  },

  // Radial cascade — infinite loop where each tile independently cycles
  // rest → exit → gap → entry → rest, phase-offset by its radius from
  // the pattern's fade center (outer-first). Most tiles are at rest at
  // any instant; only a thin radial band is in motion, sweeping inward
  // while new tiles emerge from beyond the hull. Spark snap strength
  // tracks the at-rest fraction (rest / total period).
  //
  // All timing knobs (rest / out / in / stagger / etc.) live in
  // ANIM.timings.cascade further down; this block keeps only structural
  // settings that aren't durations.
  rowCascade: {
    enabled:     true,   // master on/off (false = pattern frozen at base positions)
    continuous:  false,  // true = skip the per-tile rest, tiles cycle nonstop (rest ignored)
    outerMargin: 5.0,    // distance past hull max-radius where entry rays begin, units
  },

  // ---------------------------------------------------------------------
  // TIMINGS — central knobs for orchestrating the cascade and the 3D overlay.
  //
  // `playAll` is the master sequencer toggle:
  //   - false: cascade and overlay free-run independently (legacy behaviour).
  //             `cascade.gap` is the short pause at center; the overlay's
  //             brick↔petals morph cycles continuously on its own clock.
  //   - true:  the cascade's per-tile gap is auto-elongated so every tile
  //             reaches center at the same instant, and the 3D overlay
  //             (brick wall → petals → brick) plays exactly once during
  //             that all-at-center window. Per-tile staggered exit + entry
  //             curves are unchanged — only the gap is stretched, and the
  //             overlay is hidden outside the window.
  //
  // `cascade.*` — timing knobs for the per-tile cascade.
  // `overlay.*` — duration of each phase of the overlay morph. Their sum
  //               is the morph's total length and, in playAll mode, the
  //               length of the all-at-center window.
  // ---------------------------------------------------------------------
  timings: {
    playAll: true,

    cascade: {
      rest:         30.0,   // per-tile rest between cycles, seconds (ignored if continuous)
      out:           6.0,   // one tile rest → fade-center, seconds (ease-in cubic)
      in:            6.0,   // one tile outer-ring → rest, seconds (ease-in-out cubic)
      stagger:       1.5,   // phase offset between adjacent radial rings, seconds
      triggerDelay: 10.0,   // seconds after load before the cycle kicks in
      phaseJitter:   1.0,   // random per-tile phase offset at load, seconds (< stagger keeps wave)
      gap:           0.5,   // pause at center, seconds — used when playAll: false.
                            // When playAll: true the effective gap is auto-
                            // computed so the all-at-center window equals
                            // the overlay morph total below.
    },

    overlay: {              // 3D overlay morph phase durations, seconds.
                            // Sum = total morph length = the auto-extended
                            // gap window length when playAll: true. Matches
                            // the legacy 40s free-run split (15+5+15+5).
      brickHold:   15.0,    // brick wall holds at full
      brickToRose:  5.0,    // morph brick → rosette petals
      roseHold:    15.0,    // petal rosettes dance at full
      roseToBrick:  5.0,    // morph rosette petals → brick

      // Per-hex stagger for the brick wall's window-edge glide. Hexes are
      // ordered by `flipStep` (left → right across the wall). Each hex
      // glides in (entry) / out (exit) along its own drift vector so the
      // wall reads as a wave instead of a uniform fade.
      // Total entry time = hexEntryStagger + hexEntryGlide; should fit
      // inside `brickHold` so the wall is settled before brick→rose
      // begins. Exit is anchored to the END of the cycle — the last hex
      // finishes its fade-out exactly at the window close.
      // Ignored in free-running (playAll: false) mode.
      hexEntryDelay:   1.5, // delay after window opens before the first
                            // hex starts gliding in, sec. Lets the cascade
                            // suck-in finish dissolving inward before the
                            // brick wall starts forming.
      hexEntryStagger: 3.0, // seconds for the entry wave to traverse all hexes
      hexEntryGlide:   4.0, // per-hex glide-in + fade-in duration, sec
      hexExitStagger:  2.5, // seconds for the exit wave to traverse all hexes
      hexExitGlide:    3.5, // per-hex glide-out + fade-out duration, sec

      // Spark fade — when the playAll window opens, panel + lattice sparks
      // fade out instead of vanishing; they fade back in as the window
      // closes (so they're already lit when the cascade returns).
      sparkFade:       0.8, // seconds for the fade in/out
    },
  },

  // -----------------------------------------------------------------------
  // ARCH — procedural-brick effect that hugs the gate frame's inner ogee.
  //   • Outer arch  — bricks long-on-Z (protruding toward camera), static.
  //   • Inner arch  — same curve, slightly less Z protrusion, animated in
  //                   via cascade (apex-first stagger by default).
  //   • Floor fill  — bricks laid flat (long-on-X) running-bond, tiled
  //                   under the arch springer line, point-in-polygon
  //                   clipped to the gate frame interior.
  // Each brick instance gets a deterministic seeded fault — vertex jitter
  // on the non-mating front/back faces only, so neighbours never poke into
  // each other. A small per-brick mortar shrink gives the joint look.
  // -----------------------------------------------------------------------
  arch: {
    enabled: true,

    brick: {
      width:        7.0,    // long axis (length)
      height:       2.75,   // short axis
      depth:        4.25,   // Z-axis dimension on the arch / vertical on floor
      mortarGap:    0.2,    // uniform per-brick shrink before fault, units
      faultAmount:  0.06,   // max vertex displacement, fraction of brick depth
      chamfer:      0.03,   // edge tuck, fraction of brick smallest dim
    },

    outerArch: {
      enabled:      true,
      insetExtra:   0.0,    // additional inset past gateFrameWidth, units
    },

    innerArch: {            // the cascading row (disabled — outline + fill is
                            // now the default two-layer setup; re-enable if
                            // you want a cascade row layered on top)
      enabled:      false,
      depthScale:   0.65,   // fraction of brick.depth — "slightly shorter on Z"
      cascade: {
        direction:     'apex-first', // or 'springer-first'
        fallHeight:    5.0,          // start Y above rest pose, units
        fallDuration:  1.2,          // per-brick fall duration, sec
        stagger:       0.08,         // sec between adjacent bricks
        triggerDelay:  3.0,          // sec after load before first cascade
        repeatPeriod:  0,            // 0 = one-shot. >0 = re-fire every N sec.
      },
    },

    floor: {
      enabled:        true,
      springerYFrac:  0.30,          // Y cut as fraction of (hullMaxY-hullMinY)
      pattern:        'running-bond',// or 'stack'
      rowOffset:      0.5,           // running-bond shift, fraction of brick.width
      yLevel:         0.0,           // brick top Z relative to maxZ + frameDepth
    },

    color:           '#9A7544',
    gradientDark:    '#5C4530',
    gradientBright:  '#E0BE89',
  },

  // -----------------------------------------------------------------------
  // FLAME — fills the main central cutout of the logo with a volumetric,
  // organic flame (mode 5 only). Three coordinated layers:
  //   • Body  — extruded mesh of the cutout shape, custom shader using
  //             domain-warped fbm noise for the licking, organic look.
  //             Vertical gradient (yellow → orange → deep red) with
  //             continuous chromatic shimmer + rare brighter flares
  //             (blue/green/purple) confined to the hot zone at the base.
  //   • Sparks — GPU points rising along the flame height; denser toward
  //             the upper portion. Loop independently per-particle.
  //   • Light — flickering THREE.PointLight at the flame's hot zone,
  //             intensity + colour modulated by the same flare envelope.
  //             Illuminates the inner walls of the cutout (StandardMaterial
  //             on the logo) for the "fire glow" reaction.
  //
  // Flame is hidden in every mode except 'flame'. Galaxy backdrop stays
  // visible behind it but lerps toward a black-sky-with-stars (`uStarryMode`)
  // while flame mode is active.
  // -----------------------------------------------------------------------
  flame: {
    // Z extent of the flame volume relative to the model's front face
    // (maxZ). Negative = recessed into the cutout hole; positive = flames
    // lick forward through the cutout toward the camera.
    zBack:   -2.5,
    zFront:   1.0,

    // Vertical taper toward the vanishing point. Higher = flame narrows
    // faster as it rises. Low values keep the bell area bright; high
    // values squeeze brightness into the bottom point.
    taperPower: 0.85,

    // Color stops along the height (0=bottom, 1=at vanishing point).
    colorBottom: '#FFE066',  // bright yellow at the hot base
    colorMid:    '#FF8A20',  // orange middle band
    colorTop:    '#A41A0F',  // deep red at the cool tip

    // Domain-warped fbm parameters. The model's mesh-local coords run
    // ~80x80 units across the cutout, so noiseScale needs to be small
    // enough that the noise doesn't tile too tightly inside the body.
    noiseScale:   0.08,   // larger = finer detail
    noiseSpeed:   3.5,    // mesh-units/sec the noise scrolls upward
    warpStrength: 2.4,    // how strongly the noise self-warps
    threshLow:    0.05,   // raw-noise threshold band — anything below
    threshHigh:   0.32,   // threshLow is invisible, threshHigh fully bright.
                          // The vertical taper is applied as a final
                          // alpha multiplier AFTER this threshold so the
                          // bottom of the flame stays uniformly visible
                          // while only the tip fades.

    // Edge softening band as fraction of cutout half-width.
    edgeSoftness: 0.30,

    // Narrow vertical column the flame body actually occupies, expressed
    // as a fraction of the cutout's half-width. The cutout polygon is
    // very wide (the inner-star bay), so without this mask the flame
    // sprawls across the whole cavity and reads as a gradient bar
    // instead of a flame. The column tapers from `bodyHalfWidthBase` at
    // the bottom to `bodyHalfWidthTop` near the vanishing point, giving
    // a pointed candle-flame silhouette.
    //   columnWobble    — fbm-driven horizontal sway of the column's
    //                     centerline, fraction of cutout half-width
    //   widthNoiseAmt   — fbm-driven per-row width modulation, ±fraction
    //                     of the local column half-width (gives organic
    //                     curling silhouette instead of straight sides)
    //   widthNoiseFreq  — vertical frequency of the width noise
    //   columnEdgeSoft  — soft-edge fraction at the column boundary
    //                     (separate from `edgeSoftness` which still
    //                     fades against the cutout polygon edges)
    bodyHalfWidthBase: 0.13,
    bodyHalfWidthTop:  0.035,
    columnWobble:      0.06,
    widthNoiseAmt:     0.55,
    widthNoiseFreq:    0.18,
    columnEdgeSoft:    0.45,

    // Bottom fade — height fraction over which the flame ramps in from
    // invisible (at the polygon's bottom Y) to full intensity. Real
    // flames don't have a hard bright base — the wick is dark and the
    // body starts a little above it.
    bottomFadeFrac: 0.12,

    // Vertical headroom past the pattern's vanishing point. The cutout
    // polygon extends above the vanishing point (the inner-star tips),
    // and that space is normally unused because the flame's t-mapping
    // ends at vpY. Lifting the effective top by this fraction of the
    // polygon's above-vpY span stretches the flame taller without
    // changing the cutout geometry. 0 = stop at vpY (old behaviour),
    // 1 = stretch all the way to the polygon's max Y.
    topExtendFrac: 0.45,

    // Overall multiplier applied to the flame body. With additive
    // blending values >1 saturate after ACES tonemapping, giving the
    // bright saturated-yellow core characteristic of real flame.
    brightness: 3.5,
    opacity:    1.0,

    // Multiplier applied to all base-scene warm lights (key, innerGlow,
    // front/rear pattern, rim, fill, ambient) while in flame mode. Drops
    // the existing orange wash so the flame's own light dominates. Set
    // to 1.0 to keep base lights at full strength alongside the flame.
    baseLightDim: 0.06,

    // Multiplier on logo material's `envMapIntensity` in flame mode.
    // Default 1.0 lets the metallic logo reflect the neutral-grey env
    // even in flame mode, washing the body warm-grey. Drop to a small
    // value so the body goes nearly black between flame-light flicker
    // peaks, letting the flame's PointLight be the visible source of
    // illumination on the surrounding logo.
    envMapIntensity: 0.05,

    // Continuous low-amplitude chromatic shimmer on the hot zone — gives
    // the base a constant flickering blue/cool tint without a single
    // strong flash. Confined to t < yMax (height fraction).
    shimmer: {
      enabled:   true,
      intensity: 0.18,
      yMax:      0.40,
      speed:     1.3,
    },

    // Rare brighter chromatic flares — randomly picked colours from the
    // palette flash up in the hot zone with a smooth ramp envelope. Same
    // colour also tints the point light for that flare's duration so the
    // surrounding glow shifts cool with the flame.
    flares: {
      enabled:   true,
      rate:      0.35,   // average flares per second (Bernoulli)
      duration:  1.6,    // each flare's life, seconds (envelope)
      intensity: 0.85,   // peak amount the flare colour overrides base
      yMax:      0.50,   // flares only show below this height fraction
      palette: ['#3DB7FF', '#41E0B8', '#A668FF', '#5BFF7E', '#7AC0FF'],
    },

    // Sparks rising from the flame.
    //   count       — total particles in the system (load-only)
    //   cycleDuration — average lifetime; per-particle ±lifeVariance
    //   spawnYMin/Max — vertical band sparks emit from (height fractions)
    //   riseDistance — how far above their spawn Y they reach at end of life
    //   pointSize   — base px size at unit depth (load-only)
    sparks: {
      count:         55,         // load-only; keeps sparks readable
                                 // without overpowering the body.
      cycleDuration: 3.6,
      lifeVariance:  0.5,
      spawnYMin:     0.05,       // stay in the lower half so sparks
      spawnYMax:     0.55,       // visually rise FROM the flame body.
      riseDistance:  18.0,       // mesh-units; the cutout's vertical
                                 // span is ~78 units, so sparks rise
                                 // ~23 % of the body height before
                                 // dying — long enough to read as
                                 // climbing past the vanishing point.
      swayAmount:    1.6,
      swayFreq:      1.1,
      pointSize:     14.0,
      sizeVariance:  0.6,
      bodyColor:     '#FFD68A',
      coreColor:     '#FFFAE0',
      brightness:    0.55,
    },

    // Flickering point light at the flame's hot zone. Position is computed
    // in flame-local coords from the cutout extents.
    //   yFraction  — 0=bottom of cutout, 1=vanishing-point Y
    //   intensityMin/Max — base flicker bounds
    //   flareIntensityBoost — extra intensity added during a chromatic flare
    //   flickerSpeed/Jitter — sine + stochastic noise frequencies
    //   coolColor — light tints toward this when a flare is active
    light: {
      enabled:    true,
      yFraction:  0.20,
      // Light Z relative to maxZ. Negative = INSIDE the cutout volume so
      // only the inner walls of the hole are lit; the outer front face
      // (normal +z) keeps a strong negative dot-product with the
      // light-to-face vector and stays unlit (FrontSide rendering only
      // illuminates the camera-facing side, not the back, so the front
      // face's outer surface is unaffected by lights placed behind it).
      zOffsetFromFront: -2.0,
      intensityMin: 30,
      intensityMax: 110,
      flareIntensityBoost: 140,
      flickerSpeed:  2.4,
      flickerJitter: 0.55,
      color:        '#FF7A22',
      coolColor:    '#5DAEFF',
      decay:        1.6,
    },

    // Galaxy starry-night mode. When viewMode === 'flame' the galaxy
    // shader lerps `uStarryMode` toward 1: nebula + warm core glow fade
    // out, deep-space goes pure black, and an extra dense star layer
    // fades in. `fadeSpeed` is 1/sec. `brightness` overrides the
    // galaxy's `uBrightness` uniform while flame mode is active so the
    // backdrop is darker and the flame body reads clearly against it.
    galaxyStarry: {
      fadeSpeed:  1.5,
      brightness: 0.18,
    },
  },
};

// -----------------------------------------------------------------------
// COLORS — non-animated tints. Read at model-load / material-create time,
// so reload the page after editing.
//
// `gradientDark` is the world-Y bottom tint, `gradientBright` the top —
// they're multiplied over the base material colour to give a subtle
// vertical depth cue. Hex caps them at #FFFFFF (no overbright); the
// previously-used tiny 1.02-1.05 overbrights aren't representable but
// were visually imperceptible.
// -----------------------------------------------------------------------
export const COLORS = {
  sceneBackground: '#000000',
  envTint:         '#888888',

  logo:            { base: '#FFBF00', metalness: 0.6, roughness: 0.35,
                     gradientDark:   '#B89466',
                     gradientBright: '#FFFFF2' },
  islamicPanel:    { gold: '#B08552', stroke: '#E06A3A',
                     gradientDark:   '#AD8C66',
                     gradientBright: '#FFFFF2' },
  latticeUnderlay: { fill: '#6B4A22', stroke: '#FFC968',
                     gradientDark:   '#997A59',
                     gradientBright: '#FFFFF2' },
  gateFrame:       { base: '#B8915A',
                     gradientDark:   '#594733',
                     gradientBright: '#FFFFF2' },

  ambient: '#FFFFFF',
  fill:    '#FFFFFF',
};

// Expose on window for live devtools tweaking.
if (typeof window !== 'undefined') {
  window.MODEL  = MODEL;
  window.ANIM   = ANIM;
  window.COLORS = COLORS;
}
