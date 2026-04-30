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

  // Active view mode — driven by the digit keys 0–4 (handled in main.js).
  // 'all' plays today's synchronized sequence (cascade + flowers + sparks
  // sync'd via ANIM.timings.playAll). Single-effect modes solo one layer
  // on its own clock; the base scene (logo, gate frame, particles, lights)
  // stays on underneath.
  //   0 → 'all'  | 1 → 'pattern'  | 2 → 'hex'
  //   3 → 'flowers'  | 4 → 'fireplace'
  // 'fireplace' = procedural-brick arch wrapping a volumetric flame in
  // the central cutout, against the starry-sky galaxy backdrop.
  viewMode: 'fireplace',

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

  // Sparks for the procedural-brick arch (fireplace mode). Snap cloud is
  // built from an invisible LineSegments layer cloned from each brick's
  // edges, so sparks hop along brick outlines / mortar gaps the same way
  // panelSparks hop along stroke lines.
  archSparks:    { count: 90, gravity: 5, maxSpeed: 7, damping: 1.6,
                   snapStrength: 9,
                   tangentialFactor: 0.6, speedVariance: 0.55, sizeVariance: 0.75,
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
    brickWall: {
      enabled: true,
      // Multiplier on hex face opacity. Combines with the per-hex
      // entry/exit fade. 1.0 = fully opaque hexes (recommended so the
      // back-face alt colour stays hidden at rest); drop toward 0.4 for
      // see-through tiles.
      baseOpacity: 1.0,
      // Two parallel hex walls live behind the visible one — a LARGE
      // (sparse, slow domino wave) and a SMALL (dense, more tiles
      // flipping at once). At random moments in solo 'hex' mode the
      // wall sequentially fades from one size to the other.
      //   largeRadiusFactor — large hex circumradius as fraction of
      //                       starSize (≈ original wall density)
      //   smallRadiusFactor — small hex circumradius as fraction of
      //                       starSize (1/3 of large = ~9× more tiles)
      //   largeDominoTrigger — sec between adjacent large-wall flip
      //                        starts (0.18 = the original wave)
      //   smallDominoTrigger — sec between small-wall flip starts.
      //                        Small value = tiles flip nearly together
      //                        across a band, so the wall ripples fast.
      largeRadiusFactor:  0.25,
      smallRadiusFactor:  0.0833,    // 0.25 / 3
      largeDominoTrigger: 0.18,
      smallDominoTrigger: 0.04,
      sizeSwitch: {
        enabled:            true,
        startSize:          'small',  // initial size when entering hex mode
        minDwell:           8.0,      // min sec at one size before switching
        maxDwell:           25.0,     // max sec; actual is uniform random
        transitionDuration: 1.6,      // sec for the sequential out→in fade
      },
      // Random subset of hexes get a CONTRASTING colour on their back
      // face. As each tile flips, those random tiles flash the alt
      // colour for ~1s before the tile rotates back. Other tiles flip
      // showing the same warm hue on both faces.
      backFace: {
        enabled:     true,
        altChance:   0.30,       // fraction of tiles tagged for alt back (~30 %)
        altColor:    '#89CFF0',  // baby blue — cool contrast against the
                                 // warm hex wall.
        altOpacity:  1.0,        // peak alpha during a flip
        zOffset:     0.02,       // sit slightly behind the hex back face
      },
      // Slow color drift on the hex bricks — eases the wall's hue from
      // its base colour toward `deepColor` and back, on a sine cycle.
      // Half the cycle sits at the deep-red end, half at the base. Set
      // `enabled: false` to freeze the wall at its base colour.
      colorDrift: {
        enabled:       true,
        cycleDuration: 18.0,    // seconds for one full base→deep→base loop
        deepColor:     '#5C0A04', // deep oxblood-red at the cycle's far end
      },
    },
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

  // Fractal "telescope" zoom for the pattern effect (mode 1 only). One
  // designated focal tile (the central rosette) slowly grows toward the
  // camera while the rest of the pattern is pushed radially outward —
  // anything past the silhouette is auto-masked by the existing hullClip,
  // so nothing escapes the gate frame. As the focal tile grows huge, the
  // entire original pattern fades out and a smaller cloned copy of the
  // pattern simultaneously grows + fades IN at the same focal point. At
  // the end of the ramp the clone is at scale 1 with full opacity — a
  // pixel-identical replica of the original at rest — so the loop snaps
  // back to start invisibly. Gives the impression of falling THROUGH the
  // central tile to the next iteration of the pattern.
  //
  // Mode 0 ('all') is unaffected — this only fires when
  // viewMode === 'pattern' AND fractalZoom.enabled !== false.
  fractalZoom: {
    enabled:        true,     // false → fall back to the radial cascade in mode 1
    oneShot:        true,     // true → play intro + fade-IN to canonical rest
                              // pattern, then either park forever (loopStaticDur
                              // = 0) or retrigger after `loopStaticDur` seconds
                              // of static (set below). The Droste dive +
                              // hold↔dive loop is skipped entirely. false →
                              // continuous Droste dive with periodic holds
                              // (the original infinite-loop behaviour, governed
                              // by holdDuration / holdFadeOut below).
    loopStaticDur: 10.0,      // oneShot only. Seconds the canonical rest
                              // pattern stays static after fade-in completes
                              // before the intro re-triggers. 0 → park
                              // forever (no loop). Increase for longer
                              // breathing room between zoom cycles.

    // Intro (one-shot, before the dive begins) -------------------------
    // Focal tile grows, every other tile pushes outward past the
    // silhouette. Runs ONCE when entering pattern mode (or when triggered
    // via spacebar). After intro completes, hands off to the infinite
    // continuous Droste dive below — there is no return-to-rest cycle.
    focalGrowMax:  14.0,      // peak scale of the focal rosette. 14× =
                              // the central tile completely fills the
                              // silhouette by intro end, so the dive
                              // reads as "we're falling INTO this one
                              // shape" rather than "the whole pattern is
                              // shrinking." hullClip silhouette mask
                              // trims any overspill past the gate frame.
    othersPushMax:  2.0,      // peak outward displacement of every other
                              // tile, in maxR units. ~2 puts every tile
                              // well outside the silhouette so they're
                              // fully masked away by intro end.
    introDuration:  6.0,      // seconds for the intro to play out. d ramps
                              // 0 → 1 over the FULL introDuration so the
                              // clone stack gradually emerges from the
                              // central rosette. λ ramps 0 → 1 only in
                              // the LAST `lambdaFadeDur` seconds — by
                              // then the clones are at high opacity and
                              // cover the originals' displacement so the
                              // silhouette edge is never visible during
                              // the focal-grow / push-out transition.
    triggerDelay:   5.0,      // seconds in pattern mode before intro
                              // starts (initial settle — viewer reads the
                              // canonical pattern first so the dive lands
                              // as a clear transition, not a startle).

    // Continuous Droste dive --------------------------------------------
    // After intro, d(t) ramps linearly forever — no easing, no wrap, no
    // surfacing. For each clone k: effective depth r = mod(d - k +
    // N/2, N) - N/2 ∈ [-N/2, N/2). Scale = growthFactor^r where
    // growthFactor = 1/cloneScaleFactor. Opacity is a Gaussian centred
    // on scale = 1 (r = 0). So at any moment one clone is near peak
    // (visible at full size), one or two are growing in from the centre,
    // and one or two are growing past full size and fading out as they
    // exit the silhouette. When a clone wraps from r = N/2 (huge,
    // opacity ≈ 0) back to r = -N/2 (tiny, opacity ≈ 0) the seam is
    // hidden by the envelope being zero at both ends — true infinite-
    // zoom feel without ever repeating the snap.
    cloneCount:        5,     // total clones. 5 keeps ~2 partially
                              // visible plus one at peak at all times;
                              // higher = deeper recursion smoother dive,
                              // costs draw calls.
    cloneScaleFactor:  0.32,  // ratio between adjacent clone scales.
                              // growthFactor = 1 / this. 0.32 means each
                              // Droste step is a ~3.1× zoom (vs 2× at
                              // 0.5) — much more dramatic per-step
                              // emphasis on the focal centre, so a single
                              // dive segment covers a lot more apparent
                              // depth into one shape. Drop to ~0.25 for
                              // even more aggressive zoom; raise to 0.5
                              // for the classic gentler Droste.
    droStepDuration:   8.0,   // seconds for d to advance by 1 (one full
                              // Droste step) at peak dive speed. Bigger =
                              // slower, more meditative dive.
    diveDuration:      8.0,   // seconds of continuous diving before the
                              // hold. Rounded up to the next integer-d so
                              // the hold lands exactly on a clone-at-peak
                              // (visually identical to the pattern at
                              // rest). 8 with stepDur 8 = 1 Droste step
                              // per dive segment, so the apparent zoom
                              // per dive is ~3.1× into the focal shape —
                              // a single zoom-in, not a cascade. Eased
                              // so the dive ramps up slowly and slows
                              // again before settling.
    holdDuration:     60.0,   // total seconds of static hold at the end
                              // of each dive segment (includes fade-in +
                              // pure static + fade-out windows below).
                              // 0 → continuous dive (skip hold entirely).
    holdFadeIn:        0.0,   // seconds at start of hold spent crossfading
                              // the dive's clone stack out so the ORIGINAL
                              // pattern at rest reads through. cloneOp
                              // ramps 1 → 0 over the FULL holdFadeIn on a
                              // gentle ease-out (fast off, soft landing
                              // into rest), so the Droste nesting dissolves
                              // smoothly. λ snaps 1 → 0 in the FIRST
                              // `lambdaFadeDur` seconds (covered by the
                              // still-opaque clones) so the silhouette
                              // edge is never exposed during the focal
                              // shrink / pushed-tile slide-in.
    holdFadeOut:      20.0,   // seconds at end of hold spent crossfading
                              // back to the dive. cloneOp ramps 0 → 1 on
                              // an ease-out cubic so the clone stack wells
                              // back in gently instead of flashing — fast
                              // initial appearance, then a long soft tail.
                              // Per-clone stagger (cloneFadeStagger) further
                              // spaces shallow vs deep layers so multiple
                              // clones don't pop in simultaneously. λ snaps
                              // 0 → 1 in the LAST `lambdaFadeDur` seconds
                              // (covered by the now-opaque clones).
    cloneFadeStagger:  0.55,  // 0..0.95. During hold fade-in / fade-out,
                              // shallower clones (closer to peak |r|≈0)
                              // crossfade FIRST and deeper clones lag.
                              // 0 → no stagger (legacy: every clone fades
                              // on the same curve, producing the
                              // simultaneous "few patterns appear at once"
                              // flash). Higher → bigger spacing between
                              // shallow/deep onsets. ~0.55 keeps the
                              // shallow layer leading by half the window
                              // duration so deeper layers slip in behind
                              // it instead of stacking.
    revealStaggerSpread: 0.95,// 0..0.95 (max). Per-tile stagger applied as a
                              // clone grows: tiles with higher
                              // revealPhase START revealing later. Each
                              // tile's window is [revealPhase × Spread,
                              // 1 + revealPhase × Overshoot] — phase=0
                              // reveals over [0, 1]; phase=1 reveals
                              // over [Spread, 1+Overshoot]. So 0.65 =
                              // outermost tile doesn't START revealing
                              // until the clone has grown to 65% of
                              // peak. (See `revealOvershoot` below for
                              // when those outermost tiles FINISH.)
                              // The per-tile revealPhase is a mix of
                              // radial position and a random offset,
                              // governed by jitter below.
    revealStaggerJitter: 1.0, // 0..1. Mix between RADIAL revealPhase
                              // (innermost-first wave from the focal
                              // centre) and a per-tile RANDOM phase.
                              // 0 = clean wave (rosettes in the same
                              // ring fire together, briefly visible as a
                              // brightness pulse when the wave hits
                              // peak); 1 = each rosette / hex grows on
                              // its own random schedule (organic, no
                              // ring structure); ~0.7 keeps a hint of
                              // the bloom-from-centre feel but smears
                              // tile arrivals across the whole zoom so
                              // the residual brightness pulse dissolves
                              // into noise. Each clone draws its own
                              // random sequence so the stack doesn't
                              // replay the same pattern level-to-level.
    revealSpeedMin:    0.45,  // Per-tile growth-rate variance — each
    revealSpeedMax:    1.8,   // tile picks a random `speed` in
                              // [revealSpeedMin, revealSpeedMax] that
                              // warps the smoothstep curve via
                              // pow(f, 1/speed). speed > 1 races through
                              // the window (tile reaches full size
                              // early in its reveal); speed < 1 lingers
                              // low and snaps up near the end. Endpoints
                              // are preserved so every tile still
                              // finishes at its scheduled scale.
                              // Set both to 1 to disable. Default range
                              // ~0.45..1.8 means slow tiles take ~2× as
                              // long as fast tiles to traverse the same
                              // window, giving each rosette a clearly
                              // distinct "personality" through the zoom.
    revealOvershoot:   0.00,  // Each tile's reveal window is
                              // [revealPhase × revealSpread,
                              //  1 + revealPhase × revealOvershoot].
                              // 0 = every tile finishes revealing exactly
                              // at clone-scale=1 (correct for oneShot mode
                              // where r>0 is clamped, so clones never grow
                              // past 1). Raise > 0 only for multi-shot mode
                              // where clones grow past 1 during the dive.
                              // So the OUTERMOST tiles (revealPhase ≈ 1)
                              // don't finish revealing until the clone
                              // has grown PAST scale=1 by this much.
                              // At the moment the clone first reaches
                              // scale=1, its outer ring is still small
                              // / invisible — so the gate-frame
                              // silhouette is NOT outlined by a
                              // wall-of-rosettes touching the edge.
                              // The hullClip mask trims the over-grown
                              // clone back to the silhouette while the
                              // outer tiles ramp up inside it, so the
                              // rim fills gradually under cover instead
                              // of flashing into view all at once.
                              // 0 = legacy (every tile finishes at
                              // scale=1, silhouette flashes); 0.5 =
                              // outermost tiles take an extra half a
                              // Droste step to settle.
    droSigma:          1.50,  // Gaussian envelope half-width in log-scale
                              // units. Smaller = sharper crossfade
                              // between layers (fewer visible at once);
                              // larger = softer overlap. CRUCIAL for
                              // brightness flatness: with N transparent
                              // clones, the visible coverage is
                              //   1 − ∏(1 − αₖ)
                              // — non-linear. At sigma=0.70 a half-step
                              // moment had two clones at α≈0.52 each,
                              // giving coverage ≈ 0.77 (vs 1.0 at the
                              // integer-d moment), so the silhouette
                              // strobed bright/dim across each Droste
                              // step. sigma=1.5 spreads each clone's
                              // envelope wide enough that adjacent
                              // Gaussians overlap cleanly — coverage
                              // stays >99% at every d, no perceptible
                              // brightness oscillation. Trade-off: more
                              // clones at substantial opacity at once,
                              // so the Droste nesting reads "creamy"
                              // (soft depth blend) rather than crisp
                              // discrete steps. Drop to ~0.45 for
                              // a more "discrete depth steps" feel where
                              // each layer briefly stands out as it peaks.
    droLayerRotation:  0.0,   // radians of rotation accumulated per
                              // Droste step (a clone at effective depth
                              // r is rotated by r × this around the
                              // focal centre). 0 = no twist; try 0.05–
                              // 0.20 for a subtle Mandelbrot-style spiral
                              // deepening as you fall in.
    cloneZStep:        0.03,  // z recession added per clone level so
                              // deeper copies render BEHIND shallower
                              // ones in transparent-sort order.
    lambdaFadeDur:     5.0,   // seconds for λ (originals' focal-grow +
                              // push-out displacement) to ramp through
                              // its full range. Always shorter than
                              // introDuration / holdFadeIn / holdFadeOut
                              // so the displacement transition is hidden
                              // under the cover of mostly-opaque clones —
                              // this is the knob that prevents the arch
                              // silhouette from flashing during fades.
                              // Lower → faster, more "snap" displacement
                              // covered earlier; higher → softer but
                              // risks revealing the arch edge.
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
      brickHold:   15.0,    // brick wall holds at full ('all' mode)
      hexHold:     60.0,    // brick wall hold in solo 'hex' mode (effect 2).
                            // Independent so 'all' stays cascade-sync'd at 15s.
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

    // When true, the smooth extruded gate-frame ring is HIDDEN while
    // arch mode is active so the brick layers (outer frame stones +
    // floor wall) own the perimeter look on their own. The gate frame
    // returns to visible the instant another mode is selected.
    hideGateFrame: true,

    brick: {
      // Floor-fill brick orientation:
      //   local-X → world-X (horizontal)
      //   local-Y → world-Z (depth into wall, thin axis)
      //   local-Z → world-Y (vertical) — `depth` field below
      // So `width` = horizontal (X) extent, `depth` = vertical (Y) extent,
      // `height` = thickness through the wall (Z).
      width:        2.6,    // horizontal X — bumped up for chunkier bricks
      height:       1.5,    // Z thickness on floor — bumped (thicker)
      depth:        1.7,    // vertical Y — bumped up; rows still tight
      mortarGap:    0.0,    // base joint (used for brick-geometry shrink
                            // and as the default for the per-axis gaps
                            // below).
      mortarGapX:   0.08,   // horizontal joint — small gap between
                            // adjacent bricks within a row.
      mortarGapY:   0.0,    // vertical joint — bricks sit row-on-row
                            // edge-to-edge for a tight stack.
      faultAmount:  0.05,   // max vertex displacement, fraction of brick depth
      chamfer:      0.03,   // edge tuck, fraction of brick smallest dim
    },

    outerArch: {
      // Disabled: the long bricks here had Z-extent = brick.width = 7.0
      // units, which protrudes well past anything else in the scene and
      // violates "nothing should extend beyond the logo". The gate frame
      // itself already serves as the visible architectural ring around
      // the muqarnas. Re-enable if you want a 3D brick rim again.
      enabled:      false,
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
      // Optional: clip the brick wall to an OUTER band by carving an
      // inner cutout polygon (perimeterPoly inset by `innerInset`
      // units). Bricks whose centre falls inside this cutout are
      // skipped, leaving the inner panel bare so only the outer band
      // of the wall is built. 0 = no cutout (fill entire interior).
      innerInset:     0,
    },

    // Top-layer staircase — a SECOND brick layer sitting in front of
    // the floor wall. Bricks stream INWARD from the LEFT, RIGHT and
    // TOP edges of the logo and stop after reaching `reachFraction`
    // of each half-dimension; the bottom edge is bare and the inner
    // column-of-bottom region is bare, so the band reads as an
    // inverted U. Every brick is filtered against silhouette[0] so
    // none extend past the logo outline.
    //
    // Brick Z thickness is quantised into `stepCount` discrete steps
    // ramping from `maxStepHeight` at the outermost edge down to
    // `minStepHeight` at the inner reach limit. All bricks share a
    // back face flush with the floor top, so taller outer steps
    // protrude further toward the camera — i.e. the layer "builds up
    // depth as you move away from the centre", reading as a staircase.
    //
    //   reachFraction   — fraction of each half-dimension the brick
    //                     band reaches inward from L/R/T edges
    //                     (0..1). 0.66 ≈ user's "2/3 of the logo".
    //   stepCount       — number of discrete stair levels.
    //   minStepHeight   — Z thickness of the innermost step (units).
    //   maxStepHeight   — Z thickness of the outermost step (units).
    //   zLift           — Z above the floor brick top where the back
    //                     face of every step sits.
    //   widthScale,
    //   depthScale      — multipliers on the floor brick width / depth
    //                     for the in-plane footprint of each brick.
    //   mortarGapX,
    //   mortarGapY      — joint gaps used for grid stepping.
    // Per-step colour comes from the arch-level `gradientDark` /
    // `gradientBright` pair: the floor uses `gradientDark`, each step
    // lerps a notch lighter, and the outermost step (closest to
    // camera) lands on `gradientBright` — so no per-layer `color`
    // override is needed here.
    topLayer: {
      enabled:        true,
      reachFraction:  0.66,
      stepCount:      4,
      minStepHeight:  0.8,
      maxStepHeight:  3.2,
      zLift:          0.05,
      // Per-step kind. Length normalised to stepCount; missing entries
      // default to 'brick'. Setting alternating values gives a visible
      // brick → hex → brick → hex layer cadence as the staircase steps
      // inward, where each hex tile reuses the same step Z thickness
      // so the alternation reads as different masonry per tier.
      layerKinds:     ['brick', 'hex', 'brick', 'hex'],
      // Niche cutouts — rectangular regions (axis-aligned) in panel-XY
      // where bricks/hexes are SKIPPED so a carved alcove is left for
      // a lantern shelf + light figure. Filled in by patterns-layer.js
      // when lanterns are enabled, so positions stay synchronised with
      // lantern centres. Empty array = no carving.
      niches:         [],
      widthScale:     1.0,
      depthScale:     1.0,
      mortarGapX:     0.08,
      mortarGapY:     0.0,
      // Stencil mask — bricks are clipped to silhouette[0] inset by
      // this many units. Same technique as 3DOverlay's flower mask:
      // a stencil fill of the silhouette is drawn first, then the
      // brick material only renders where stencil=1, so any brick
      // edge poking past the logo outline is GPU-discarded. 0 = use
      // the raw silhouette; small positive value = avoid 1-px halo.
      maskInset:      0.4,

      // Corner hexes — three flat extruded hexagons nestled into each
      // upper corner (UL, UR) of the silhouette bbox, sitting on top of
      // the outermost staircase step. Each hex is centred near the
      // corner so the topLayer stencil mask clips ~2/3 of the body and
      // only ~1/3 protrudes inside the silhouette. Subsequent hexes
      // step diagonally inward toward the bbox centre and shrink by
      // shrinkRatio per step. Colour lerps from gradientBright (outer
      // corner) toward gradientDark (innermost) so the trio reads as
      // part of the same masonry gradient as the staircase.
      //   count        — hexes per corner.
      //   outerRadius  — radius of the largest (outer) hex.
      //   shrinkRatio  — multiplier on radius per step (0.7 = each
      //                  successive hex is 70% of the previous).
      //   spacingFrac  — packing factor: adjacent centres are pushed
      //                  apart by (r_k + r_{k+1}) * spacingFrac.
      //                  1.0 = hexes kiss; <1 = overlap; >1 = gap.
      //   cornerInset  — diagonal offset of the FIRST hex centre from
      //                  the bbox corner, units. 0 = centre exactly
      //                  on the corner (~1/4 visible). Positive shifts
      //                  inward (more visible).
      //   depth        — extrusion thickness on world-Z.
      //   zLift        — Z above the outermost staircase step's front
      //                  face where the hex back face sits.
      //   color        — optional override; falls back to the
      //                  gradientBright→gradientDark lerp.
      // Under-brick hex layers — one ring of half-hex tiles per stair
      // step, sitting on each step's front face. The half-hex's flat
      // cut edge follows the curve tangent (along the ring); the
      // rounded half points inward toward the logo centre. Each ring
      // traces silhouette[0] inset by (s+1)*reachLR/numSteps so step 0's
      // ring sits at the FIRST step seam (between outermost & second),
      // step (numSteps-1)'s ring is the deepest seam (closest to centre).
      // Rings are clipped above the floor's springer Y so hexes ride
      // only the upper L+R+T region the topLayer staircase covers.
      //   baseRadius   — circumradius of step 0's hexes (largest).
      //   shrinkRatio  — multiplier per step (0.78 = each ring is 78%
      //                  of the previous).
      //   pitchScale   — multiplier on the natural touching-hex pitch
      //                  along the tangent. 1.0 = adjacent flat edges
      //                  kiss; >1 introduces gap.
      //   depth        — extrusion thickness on world-Z.
      //   zLift        — Z above the step's brick front face where the
      //                  hex centre sits.
      //   color        — optional override; otherwise lerps per step
      //                  from gradientBright (outer) → gradientDark
      //                  (inner) like the topLayer's stepMats.
      underHexes: {
        enabled:      false,
        baseRadius:   3.4,
        shrinkRatio:  1.0,
        pitchScale:   1.0,
        depth:        0.8,
        zLift:        0.05,
      },
      cornerHexes: {
        enabled:      true,
        // Single hex per corner — the bright outer one. Bumping count up
        // to 2/3 emits successively darker hexes marching diagonally
        // inward (gradientBright → gradientDark per step).
        count:        1,
        outerRadius:  4.5,
        shrinkRatio:  0.7,
        spacingFrac:  0.95,
        // Negative cornerInset pushes the FIRST hex centre OUTWARD
        // along the diagonal (away from the bbox centre). With the
        // anchor on the silhouette[0] corner extreme, the hex centre
        // would otherwise sit on the boundary with ~50% visible;
        // pulling it outward by ~R/3 leaves ~1/3 of the hex inside
        // the silhouette (= the "nestled into the corner" look).
        cornerInset: -1.4,
        depth:        0.5,
        // Pushed past the fireplace brick ring (which sits ~3 units
        // forward of the topLayer's outermost step in fireplace mode).
        // Without this lift the hexes are occluded by the ring.
        zLift:        5.0,
        // Outline — set to true (or pass outlineColor) to draw an edge
        // stroke over each hex; false leaves bare faces.
        outline:      false,
      },
    },

    // Muqarnas vault — fractal-scaled pointed-arch niches DUG INTO the
    // wall thickness, restricted to the dome region above the springer
    // line so the SDG side flares stay clean. Tier 0 sits flush with
    // the gate-frame front; each successive tier is recessed by
    // `tierStepZ` into the wall (negative Z), so the cells read as
    // carved into the model rather than protruding outward. Each cell
    // is a 2D pointed-arch shape (flat base on the tier polygon, point
    // facing radially inward toward the star) extruded by
    // `cellThickness` on world-Z.
    //
    // FRACTAL SCALING — at tier r, every cell dimension is multiplied
    // by `fractalScale^r` from its tier-0 value. Because the polygon's
    // perimeter shrinks roughly linearly with each radial inset while
    // cell width shrinks geometrically, the cell COUNT per tier grows
    // ~geometrically (a self-similar packing where every successive
    // tier exposes finer detail at a smaller scale — the muqarnas
    // construction in the reference image is itself a recursive vault,
    // so this scaling is the right mathematical fit).
    //
    // CONTAINMENT — every cell stays strictly within the silhouette
    // (the dome polygon is an inset of silhouette[0] above the springer
    // line) and strictly within the logo's Z budget (deepest tier's
    // back face stays within the gate-frame thickness plus a bite of
    // the logo body; never forward of the gate-frame front face).
    //
    //   tierCount         — number of tiers. 0 disables.
    //   cellWidth         — base cell extent along the polygon tangent
    //                       at TIER 0. Tier r uses
    //                       cellWidth * fractalScale^r.
    //   cellRadialDepth   — base cell extent radially at tier 0 (how
    //                       far each pointed arch extends inward from
    //                       its tier polygon). Also = inset distance
    //                       between successive tier polygons.
    //   cellThickness     — base extruded depth on world-Z at tier 0.
    //   fractalScale      — geometric scaling factor applied to all
    //                       three cell dims per tier. ~0.7-0.85 gives
    //                       a visible self-similar fractal effect; 1.0
    //                       disables fractal scaling.
    //   tierStepZ         — extra Z recession per tier, units. The
    //                       deepest tier's front face sits this many
    //                       units × tierCount behind the gate-frame
    //                       front. Should fit within ~2.5 units total
    //                       (gate-frame depth 1.5 + logo body 1.0).
    //   colorMix          — fraction of (color → gradientDark) lerp
    //                       at the innermost tier; linear ramp.
    //   opacityFalloff    — extra alpha drop at the innermost tier
    //                       (linear from 0 at outer). 0 = opaque.
    //   tierOffsetAlternate — true: every other tier rotates its cell
    //                       start by half a cell so seams stagger.
    //   minPerimeter      — bail out once the inset polygon drops
    //                       below this perimeter length.
    muqarnas: {
      enabled:             false,
      // Fractal recursion: each tier's cell dims = previous × fractalScale.
      // Loop runs for tierCount iterations OR until the inset polygon's
      // perimeter drops below minPerimeter. 5 tiers at fractalScale 0.78
      // → tier 4 cells ≈ 37% of tier 0 — readable detail without
      // sub-pixel chaos.
      tierCount:           5,
      cellWidth:           5.0,    // tier-0 cell width (along tangent)
      cellRadialDepth:     4.5,    // tier-0 radial extent
      cellThickness:       0.6,    // niche front-face thickness
      fractalScale:        0.78,   // per-tier shrink
      tierOverlap:         0.55,   // adjacent tiers overlap radially by
                                   // (1 − tierOverlap) so they interlock
                                   // like a honeycomb
      tierStepZ:           0.18,   // Z recession per tier (×5 tiers = 0.90
                                   // total — fits gate-frame thickness;
                                   // bricks underneath stay clear)
      colorMix:            0.78,
      opacityFalloff:      0.0,
      tierOffsetAlternate: true,
      // No archMinYFrac — cells fill the entire face (per-cell
      // silhouette filter still keeps them inside the logo + out of
      // cutouts).
      minPerimeter:        3.0,
      // Stop tier recursion once the inset polygon has crossed into a
      // cutout (the star bay) — measured as the fraction of polygon
      // vertices that are still in the SOLID region. Below this
      // threshold we abort, which prevents the "star outline" effect
      // where cells near the cutout boundary form a thin ring around
      // the void. 0.85 = stop when 15% of vertices are inside cutouts.
      cutoutStopFrac:      0.90,
      // Shadow back-wall: a smaller, darker pointed-arch shape sitting
      // INSIDE each cell, recessed by ~half cellThick + offset. Reads
      // as the dark interior of a 3D niche behind the cell's front rim.
      backWallEnabled:     true,
      backWallScale:       0.72,    // child shape size as fraction of parent
      backWallOffset:      0.18,    // additional Z recession behind cell back face
      backWallColor:       '#1A0A04',
    },

    // Lit lantern niches — four small pointed-arch alcoves embedded in
    // the brick panels. Each contains a darkened back wall, a small
    // emissive flame mesh, and a real THREE.PointLight whose intensity
    // (and the flame's opacity) flicker via a two-sine envelope.
    //   frameSize       — niche frame dims (radial = upward extent,
    //                     width = horizontal opening, thickness = relief
    //                     toward camera).
    //   zBack           — relative Z behind the frame where the back
    //                     wall sits (negative = recessed into wall).
    //   zLift           — Z of the niche frame above the brick top.
    //   intensityMin/Max — point-light intensity bounds.
    //   flickerSpeedA/B  — angular speeds of the two flicker sines.
    //   flameColor       — emissive flame mesh tint.
    //   lightColor       — colour of the cast point light.
    //   decay            — point-light distance falloff exponent.
    //   positions        — list of {panel, yOffset} pairs, where
    //                     panel ∈ {0=UL, 1=UR, 2=LL, 3=LR} selects the
    //                     panel-quadrant centroid and yOffset is added
    //                     to that centroid's Y.
    lanterns: {
      enabled:        true,
      // Hexagonal wedge frame (set 'arch' for the original pointed-arch
      // shape). The hex frame reads as a stretched pointy-top hexagonal
      // alcove with `radial` = vertical extent, `width` = horizontal.
      frameShape:    'hex',
      frameSize:     { radial: 4.0, width: 3.0, thickness: 0.5 },
      zBack:         -0.6,
      // Lantern frame Z = floorTopZ + zLift. Set so the frame lands INSIDE
      // the carved niche cavity (between backZ and the outermost step
      // front), recessed enough that the shelf brick reads as protruding
      // forward of the frame.
      zLift:          1.5,
      // Brighter intensity range + stochastic jitter for candle-style
      // flicker. flickerJitter ∈ [0,1]: 0 = smooth two-sine breathing,
      // 1 = pure random per-frame noise. 0.5 mixes both for rapid
      // micro-flutter on top of slower breathing — reads as a real
      // candle's restless flame.
      intensityMin:   25.0,
      intensityMax:   80.0,
      flickerSpeedA:  7.0,
      flickerSpeedB:  13.0,
      flickerJitter:  0.5,
      // Flame mesh size — radius of the source sphere; geometry is
      // pre-stretched (0.7×, 1.5×, 0.7×) into a teardrop. Bigger
      // flameSize → bigger candle flame mesh.
      flameSize:      0.55,
      flameColor:    '#FFE090',
      lightColor:    '#FFB060',
      decay:          1.4,
      frameColor:    '#7A5028',
      // Two lanterns matching the reference image's lower-left + lower-
      // right alcoves. Panel indices: 0=UL, 1=UR, 2=LL, 3=LR.
      // The SDG logo's bbox extends well below its visible body (the
      // letter descenders), so the raw LL/LR panel-quadrant centroid
      // lands below the visible wall. Lift y by ~+40 to push the
      // lanterns up into the lower-wall band.
      // All four lanterns stacked in the LOWER side walls (matching the
      // reference image's bottom-corner alcoves). Panels 0/1 (UL/UR)
      // get a large negative yOffset to drag them DOWN below the
      // central star into the upper-lower-wall band; panels 2/3 (LL/LR)
      // keep a +15 offset which lifts them past the descenders into
      // the lower-lower-wall band. Result: 2 stacked lanterns per side.
      positions: [
        { panel: 0, yOffset: -45 }, { panel: 1, yOffset: -45 },
        { panel: 2, yOffset:  30 }, { panel: 3, yOffset:  30 },
      ],
    },

    // Embossed geometric inlays — four flat 8-point star medallions,
    // one centred in each quadrant of the panel area (formed by the
    // star bay against the outer silhouette bbox). Mounted on top of
    // the brick floor with a small relief depth so they read as
    // embossed decoration in the reference image.
    //   radius          — outer radius of the inlay's outer star.
    //   depth           — extrusion depth (relief thickness).
    //   zLift           — Z above the brick top (so the inlay sits
    //                     flush on the brick surface).
    inlays: {
      enabled: false,
      radius:  1.7,
      depth:   0.18,
      zLift:   0.05,
      color:   '#D4A06A',
    },

    // Outer brick arch — chunky voussoir-style bricks tiled along
    // silhouette[0] above the springer line, forming an upside-down U
    // of stones over the top + sides of the logo (the bottom edge is
    // bare). Each brick is tangent-aligned so neighbours share a face,
    // reading as a real archway's wedge stones. Inset by half the
    // brick height so outer faces kiss silhouette[0] and bodies extend
    // only one brick-height inward — never crossing into the inner
    // region of the logo.
    //   springerYFrac   — Y cut as fraction of the inset polygon's
    //                     Y range (0=bottom, 1=top). 0.30 keeps the
    //                     foot of the arch near the bottom 1/3.
    //   brickLength     — extent along the curve tangent (LONG axis).
    //   brickHeight     — radial extent inward (visible thickness).
    //   brickThick      — Z protrusion forward.
    //   mortarGap       — joint gap between adjacent bricks.
    //   zLift           — extra Z above the gate-frame front face.
    //   color           — brick colour (defaults to cfg.gradientBright,
    //                     so the outer arch lands on the lightest end
    //                     of the depth gradient — closest to camera).
    outerBrickArch: {
      enabled:        false,
      springerYFrac:  0.30,
      brickLength:    5.0,
      brickHeight:    2.5,
      brickThick:     1.5,
      mortarGap:      0.06,
      zLift:          0.5,
      // color overrides cfg.gradientBright. Leave undefined to inherit.
    },

    // Outer FRAME arch — chunky voussoir bricks tiled along silhouette[0]
    // OUTSET outward (so the ring sits entirely outside the logo
    // perimeter), forming an upside-down U over the top + left + right
    // edges. Bricks here are intentionally LARGER than the outerBrickArch
    // ones so the frame reads as a chunky stone surround around the logo.
    //   outwardOffset   — how far past silhouette[0] the brick's INNER
    //                     face sits. Increase to push the frame further
    //                     out from the logo.
    //   springerYFrac   — Y cut as fraction of the outset polygon's Y
    //                     range (0=bottom, 1=top). Lower values let the
    //                     legs reach further down.
    //   brickLength     — extent along the curve tangent (LONG axis).
    //   brickHeight     — radial extent outward (visible thickness).
    //   brickThick      — Z protrusion forward of gate-frame front face.
    //   mortarGap       — joint gap between adjacent bricks.
    //   zLift           — extra Z above the gate-frame front face.
    //   color           — brick colour (defaults to cfg.gradientBright).
    outerFrameArch: {
      // Disabled: the fireplace archway (ANIM.fireplace, with gap: 0)
      // now occupies this perimeter ring's position, so the chunky
      // voussoirs would double up on the same band. Re-enable if you
      // want the silhouette-tracing voussoir ring back instead of the
      // fireplace horseshoe at the perimeter.
      enabled:        false,
      // 0 = bricks sit INSIDE silhouette[0] (outer face flush with the
      // perimeter, body extending one brickHeight inward). Increase to
      // push the frame outside the logo.
      outwardOffset:  0.0,
      // Bbox-Y fraction where the upside-down U's feet sit. Higher values
      // make the U shorter (only the dome); lower values let the legs
      // reach further down the sides. The longest-connected-run picker
      // in placeOuterBrickArch keeps things robust against multiple Y
      // crossings caused by the SDG side flares.
      springerYFrac:  0.05,
      // Match the reference outer arch: rectangular stretchers with the
      // long edge running ALONG the curve (tangent), shorter radially,
      // subtle Z protrusion. Each brick is tangent-aligned, so its
      // local-Z (camera axis) tilts/rotates around the arch as the
      // tangent direction sweeps from horizontal at the apex to
      // vertical at the legs — fan-of-stones effect.
      brickLength:    3.0,    // tangent (along curve) — LONG axis
      brickHeight:    2.0,    // radial depth into the wall — short
      brickThick:     1.0,    // Z protrusion forward — subtle
      // Tight joint so adjacent stones nearly touch (thin seam).
      mortarGap:      0.04,
      // false: brickLength stays along the tangent — long edge follows
      // the curve, matching the reference outer ring.
      rotate90:       false,
      // Extra inward push so the brick's straight outer edge sits
      // safely inside silhouette[0]. Without this, the chord between
      // two sample points cuts past the actual curving silhouette
      // (especially at concave SDG flare-to-dome transitions) and
      // brick corners poke past the perimeter.
      inwardSafety:   0.4,
      zLift:          0.5,
      // color overrides cfg.gradientBright. Leave undefined to inherit.
    },

    // Outer frame bricks — a ring of cut-stone blocks tiled along the
    // gate frame's outer perimeter (silhouette[0]), sitting just in
    // front of the gate-frame front face. Decorates the outer rim of
    // the arch with visible stonework.
    //   brickLength     — extent along the perimeter tangent.
    //   brickHeight     — radial extent (visible thickness inward).
    //                     Inset polygon = silhouette inset by half this
    //                     value so the brick's outer face kisses
    //                     silhouette[0] without poking past it.
    //   thickness       — Z protrusion forward of gate-frame front.
    //                     Keep small to satisfy the "nothing extends
    //                     beyond the logo" rule.
    outerFrame: {
      enabled:     false,  // disabled — the gate-perimeter brick ring
                           // didn't read well visually; the floor brick
                           // wall + the innerFrame ring cover the look.
      brickLength: 3.0,    // tangent-direction (along curve)
      brickHeight: 2.4,    // radial (visible thickness inward)
      thickness:   1.10,   // Z protrusion forward — thicker stones
      mortarGap:   0.03,   // very tight joint so adjacent stones look snug
      color:       '#C18E5A',
    },

    // Second brick ring inside the outerFrame, framing the inner floor
    // wall. Sits just inside the outer-frame stones (silhouette inset
    // by `inset` units) and at a Z between the floor wall and the outer
    // frame so it reads as an intermediate "border" layer. Bricks here
    // are slightly larger than the floor bricks but smaller than the
    // outer-frame stones.
    //   inset       — radial inset from silhouette[0] to this ring's
    //                 polygon, units. Must clear the outerFrame's
    //                 brickHeight so the rings don't overlap.
    //   brickLength — extent along the perimeter tangent.
    //   brickHeight — radial extent (visible thickness inward).
    //   thickness   — Z extent (forward protrusion).
    //   zLift       — Z above the floor brick top where this ring sits.
    innerFrame: {
      enabled:     false,   // disabled — the second outline ring also
                            // didn't read well; just the floor brick
                            // wall on its own for now.
      inset:       3.6,     // sit clearly INSIDE the outerFrame stones
                            // (outerFrame brickHeight is 2.4; pushing
                            // this past it ensures no radial overlap
                            // between the two rings)
      brickLength: 2.2,     // a bit smaller than the outer-frame stones
      brickHeight: 1.5,
      thickness:   0.85,    // thicker stones
      zLift:       0.10,    // Z above the floor brick top
      mortarGap:   0.04,
      color:       '#A87B47',
    },

    // Curved brick rails wrapping the inner star bay. Each entry in
    // `rails` is one continuous ring of bricks placed along the star
    // perimeter expanded radially outward by `offset` units. Multiple
    // rails at increasing offsets and slightly different Z lifts give
    // the layered "framed star" read from the reference image. Bricks
    // run with their long axis along the curve (tangent), short axis
    // radial-outward, thin axis along world-Z.
    //   rails           — list of rings. Each: { offset, zLift,
    //                     brickLength, brickHeight, brickThick?, color }.
    //   mortarGap       — joint gap between adjacent bricks in a ring.
    //   enabled         — master toggle (independent of other arch
    //                     layers).
    starRails: {
      enabled:    false,
      mortarGap:  0.04,
      rails: [
        { offset: 0.6, zLift: 0.40, brickLength: 1.6, brickHeight: 1.0, brickThick: 0.40, color: '#B58454' },
        { offset: 1.7, zLift: 0.65, brickLength: 1.5, brickHeight: 0.9, brickThick: 0.40, color: '#A37544' },
        { offset: 2.9, zLift: 0.85, brickLength: 1.4, brickHeight: 0.8, brickThick: 0.40, color: '#8E6A3E' },
      ],
    },

    color:           '#8B5A2B',
    gradientDark:    '#5C3A1B',
    gradientBright:  '#A87242',
  },

  // -----------------------------------------------------------------------
  // ARCH CARVED — experimental viewMode (key 5). Fork of ANIM.arch where
  // the topLayer staircase is built MUCH deeper (more steps, taller Z
  // extrusion) and bricks are STRATEGICALLY removed in patterns to
  // expose lantern alcoves carved into the deeper wall. The user's
  // playground for sculpting carved-brick muqarnas-style patterns.
  // Inherits everything from ANIM.arch unless explicitly overridden;
  // the patterns-layer.js wiring shallow-merges ANIM.arch onto this
  // block before passing as configOverride.
  // -----------------------------------------------------------------------
  archCarved: {
    // Deep brick facade: 10 stair tiers, ALL bricks (no hex grooves),
    // with a much larger maxStepHeight so the outermost step pops
    // dramatically forward of the floor — reads as a thick masonry
    // wall whose 10 receding courses can be sculpted via niches.
    topLayer: {
      enabled:        true,
      reachFraction:  0.66,
      stepCount:      10,
      minStepHeight:  0.6,
      maxStepHeight:  7.0,
      zLift:          0.05,
      // All 10 tiers brick — no hex layers in this carved facade.
      layerKinds:     ['brick','brick','brick','brick','brick',
                       'brick','brick','brick','brick','brick'],
      niches:         [],            // populated by createArch from lantern positions
      widthScale:     1.0,
      depthScale:     1.0,
      mortarGapX:     0.08,
      mortarGapY:     0.0,
      maskInset:      0.4,
      underHexes: { enabled: false },
      cornerHexes: { enabled: false },
    },
    // Lanterns + floor + colours intentionally OMITTED here so the
    // shallow merge ({ ...ANIM.arch, ...ANIM.archCarved }) inherits
    // them from ANIM.arch (an explicit `undefined` would clobber the
    // inherited value).
  },

  // -----------------------------------------------------------------------
  // FLAME — fills the main central cutout of the logo with a volumetric,
  // organic flame (active in fireplace mode, alongside the brick arch).
  // Three coordinated layers:
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
  // Flame is hidden in every mode except 'fireplace'. Galaxy backdrop
  // stays visible behind it but lerps toward a black-sky-with-stars
  // (`uStarryMode`) while fireplace mode is active.
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
    // These are the *static* fallback values used when colorDrift is
    // disabled. With drift enabled, these get overwritten each frame
    // by the active palette crossfade and only get used during the
    // brief moment a palette interpolation crosses their value.
    colorBottom: '#FFB840',  // warm amber at the hot base — kept off pure
                             // white so the additive blend + brightness
                             // multiplier doesn't blow the base to a flat
                             // white blob. Push back toward '#FFE066' for
                             // a hotter, whiter core.
    colorMid:    '#FF8A20',  // orange middle band
    colorTop:    '#A41A0F',  // deep red at the cool tip

    // Slow palette drift on the main flame body. Cycles through a list
    // of {bottom, mid, top} hex palettes, smooth-crossfading between
    // adjacent entries. The list is intentionally biased: most entries
    // are the warm white→amber→red gradient with subtle analogous
    // shifts, so the flame *reads as fire most of the time* and only
    // occasionally drifts toward the coral/magenta accents for variety.
    //
    //   enabled       — master toggle; off = use the static colorBottom
    //                   /Mid/Top above
    //   cycleDuration — seconds for one full traversal of the palette
    //                   list (so each palette takes duration/N seconds
    //                   at the centre of its dwell)
    //   palettes      — list of {bottom, mid, top} hex stops. Repeating
    //                   the same palette at adjacent indices weights
    //                   the cycle to dwell longer on it.
    colorDrift: {
      enabled:       true,
      cycleDuration: 110,
      palettes: [
        // Warm amber default — listed twice in a row so the flame
        // dwells here longest before drifting on.
        { bottom: '#FFB840', mid: '#FF8A20', top: '#A41A0F' },
        { bottom: '#FFB840', mid: '#FF8A20', top: '#A41A0F' },
        // Hotter / whiter base — shifts the hot zone toward white.
        { bottom: '#FFD060', mid: '#FF7A18', top: '#8C0A0A' },
        // Red-shifted — base + mid push redder; the warm-amber default
        // sits next to this on either side so the cycle eases in/out
        // of red rather than slamming.
        { bottom: '#FF6A20', mid: '#D04A0E', top: '#5C0E08' },
        // Back to amber default — second long dwell on the way around.
        { bottom: '#FFB840', mid: '#FF8A20', top: '#A41A0F' },
        // Coral / pink-shifted — analogous accent (warm pink toward
        // magenta, but never crossing into cold blue territory).
        { bottom: '#FFB070', mid: '#E0526A', top: '#601020' },
      ],
    },

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
    bodyHalfWidthBase: 0.14,
    bodyHalfWidthTop:  0.005,
    columnWobble:      0.04,
    widthNoiseAmt:     0.42,
    widthNoiseFreq:    0.14,
    columnEdgeSoft:    0.45,

    // Bottom flare — additive widening at the base that decays quickly
    // with height, so the very bottom of the flame can match the wide
    // span of the cutout at the logo's lower opening while the rest of
    // the column stays at its slim `bodyHalfWidthBase` width.
    //   bottomFlareWidth  — extra column half-width fraction added at
    //                       t=0 (on top of `bodyHalfWidthBase`). Units
    //                       are the same: fraction of cutout half-width.
    //                       0.86 with base 0.14 fills the cutout at t=0.
    //                       0 disables the flare entirely.
    //   bottomFlareHeight — height fraction over which the flare decays
    //                       from full to zero. Smaller = sharper/quicker
    //                       transition back to the base column width.
    // The decay is quadratic ease-out (pow 2), so the drop is fast just
    // above the base and slow as it merges into the regular column.
    bottomFlareWidth:  0.95,
    bottomFlareHeight: 0.10,

    // Bottom fade — height fraction over which the flame ramps in from
    // invisible (at the polygon's bottom Y) to full intensity. The main
    // flame extends all the way to the bottom of the cutout polygon
    // with only a short ramp; the blue secondary uses NormalBlending so
    // it draws ON TOP of the orange at its column rather than adding
    // (which would blow the overlap to white) — so we don't need a
    // wide bottom fade on the orange to "make room" for blue any more.
    bottomFadeFrac: 0.04,

    // Rounded bottom — radius (as a t-fraction) of the half-circle dome
    // that shapes the flame's lower edge. 0 = flat horizontal bottom;
    // higher values pull the column-edge pixels' visible bottom upward
    // while keeping the column-center bottom anchored at t=0, giving a
    // domed/teardrop base.
    bottomRoundFrac: 0.10,

    // Optional Gaussian "waist" pinch — narrows the column at a chosen
    // height fraction so the flame necks in between the bright base and
    // the upper body. Used here to squeeze the yellow→orange transition
    // zone so the hot core flares out, then the column pinches before
    // fanning back up into the orange body.
    //   waistY     — height fraction where the pinch is centered
    //   waistAmt   — pinch strength (0 = no pinch, 1 = column closes to
    //                ~5 % width at the waist). 0 disables.
    //   waistWidth — Gaussian half-width of the pinch (in t units).
    waistY:     0.22,
    waistAmt:   0.55,
    waistWidth: 0.18,

    // Second narrow waist higher up — independent Gaussian pinch used
    // to keep the column off the inner-star polygon's neck (the spot
    // in the upper-middle where the cutout silhouette pinches in and
    // the flame would otherwise touch the logo). Tune `waist2Y` to the
    // height of the polygon's narrowest point and `waist2Amt` to the
    // pinch depth needed. Set `waist2Amt: 0` to disable this second
    // pinch entirely.
    waist2Y:     0.62,
    waist2Amt:   0.40,
    waist2Width: 0.18,   // wider Gaussian so the tail thins the visible
                         // middle of the body (~t=0.5) while the peak
                         // pinch stays at t=0.62 to keep the column off
                         // the inner-star polygon's neck.

    // Movement diversity — slowly modulates ALL motion uniforms
    // (noise scroll, column wobble, width-noise amplitude, branching
    // speed, spark sway) by a single scale that beats between
    // `minScale` and 1.0 over `cycleDuration` seconds. Result: the
    // flame oscillates between near-still moments where the noise
    // pattern barely moves and active moments where it licks fast. The
    // light flicker, palette drift, and hue oscillation are NOT scaled
    // — those stay on their own clocks so the flame never feels frozen.
    //
    //   enabled       — master toggle
    //   cycleDuration — seconds for one slow→fast→slow beat
    //   minScale      — scale during the deepest still moment. 0 would
    //                   freeze noise scroll entirely; 0.10 keeps a
    //                   barely-perceptible drift so the flame still
    //                   reads as alive
    movement: {
      enabled:       true,
      cycleDuration: 38,
      minScale:      0.10,
    },

    // Branching — a slow noise gates whether the flame splits into two
    // columns offset from the main centerline. When the noise is calm,
    // the columns coincide (one flame). When the noise spikes (above
    // `presenceThresh`), the columns spread by up to `separation`
    // (fraction of the cutout's half-width), giving a "the flame
    // branched apart" read. As the noise relaxes, they merge back.
    // Disabled on the secondary blue flame.
    //   enabled         — master toggle
    //   separation      — peak split distance, fraction of cutout half-
    //                     width. 0=no branching even at noise peaks
    //   freqY           — vertical frequency of the branch noise
    //   speed           — time-evolution rate of the branch noise; low
    //                     values give slow, deliberate branches
    //   presenceThresh  — abs-noise level above which branching kicks
    //                     in (0..1). Higher = rarer branches
    branching: {
      enabled:        true,
      separation:     0.55,
      freqY:          0.04,
      speed:          0.05,
      presenceThresh: 0.55,
    },

    // Vertical headroom past the pattern's vanishing point. The cutout
    // polygon extends above the vanishing point (the inner-star tips),
    // and that space is normally unused because the flame's t-mapping
    // ends at vpY. Lifting the effective top by this fraction of the
    // polygon's above-vpY span stretches the flame taller without
    // changing the cutout geometry. 0 = stop at vpY (old behaviour),
    // 1 = stretch all the way to the polygon's max Y.
    topExtendFrac: 0.45,

    // Rigid vertical offset applied to the entire flame group (body +
    // secondary blue + sparks + light), expressed as a fraction of the
    // cutout's vertical extent. Positive shifts everything UP. Use this
    // to nudge the flame's resting position within the cutout without
    // changing the cutout geometry or the t-mapping shape.
    yOffsetFrac: 0.02,

    // Overall multiplier applied to the flame body. With additive
    // blending values >1 saturate after ACES tonemapping, giving the
    // bright saturated-yellow core characteristic of real flame. Kept
    // moderate so the hot core stays visibly amber/orange instead of
    // blowing out to a flat white.
    brightness: 2.4,
    opacity:    1.0,

    // Multiplier applied to all base-scene warm lights (key, innerGlow,
    // front/rear pattern, rim, fill, ambient) while in fireplace mode.
    // 0 = base lights fully off — only the flame's own flickering
    // PointLight + spark particles illuminate the logo. Set to 1.0 to
    // keep base lights at full strength alongside the flame.
    baseLightDim: 0.35,

    // Multiplier on logo material's `envMapIntensity` in flame mode.
    // Default 1.0 lets the metallic logo reflect the neutral-grey env
    // even in flame mode, washing the body warm-grey. Drop to a small
    // value so the body goes nearly black between flame-light flicker
    // peaks, letting the flame's PointLight be the visible source of
    // illumination on the surrounding logo.
    envMapIntensity: 0.25,

    // While in fireplace mode, set `scene.environment = null` so the
    // grey PMREM ambient wash on every MeshStandardMaterial (arch
    // bricks, gate frame, logo) goes away — the only illumination on
    // those surfaces becomes the flame light stack + sparks. Set to
    // false to keep the env wash on (bricks/frame/logo will read
    // ~constant brightness from env reflection regardless of flame
    // flicker). The original env is restored as soon as you leave
    // fireplace mode either way.
    stripEnvironment: false,

    // Rim events — a thin ribbon along the inner-star cutout polygon
    // hosts two occasional gate-tracing effects, each with its own
    // Bernoulli-rate trigger:
    //
    //   • CHASE  — a Gaussian "pulse tongue" travels once around the
    //              perimeter from a launch point (the rim vertex
    //              closest to the flame's column base) over `duration`
    //              seconds, then dies. Reads as fire chasing around
    //              the gate.
    //   • IGNITE — a Gaussian glow centred on the same launch point
    //              whose spread radius expands outward in both
    //              directions until it covers the whole rim, then
    //              fades. Reads as the gate momentarily catching fire.
    //
    // Both fire independently — the same envelope drives a single
    // event from start → peak → fade, then the rate roll resets.
    //
    //   thickness     — ribbon width (mesh units). Sits on the front
    //                   face of the flame slab so it reads against
    //                   the logo regardless of camera angle.
    //   pulse.rate    — per-second Bernoulli probability. 0.05 ≈ one
    //                   chase every ~20s.
    //   pulse.duration— seconds the pulse takes to traverse the rim.
    //                   Shorter = faster fire chase.
    //   pulse.width   — Gaussian half-width as fraction of perimeter
    //                   (0.06 = the tongue spans ~6 % of the loop).
    //   pulse.color   — hex tongue colour.
    //   pulse.intensity — peak alpha multiplier.
    //   ignite.rate   — per-second Bernoulli probability for ignite.
    //   ignite.duration — total seconds, attack+sustain+decay.
    //   ignite.maxSpread — final Gaussian radius as fraction of
    //                   perimeter. 0.55 is the practical cap (covers
    //                   the whole loop without seam artefacts).
    //   ignite.color  — hex glow colour.
    //   ignite.intensity — peak alpha multiplier.
    rim: {
      enabled:   true,
      thickness: 3.0,            // load-only; reload after editing
      pulse: {
        enabled:   true,
        rate:      0.18,         // ~once every 5–6s (was 0.05)
        duration:  6.0,          // longer dwell (was 4.5)
        width:     0.10,         // wider tongue, easier to spot (was 0.05)
        color:     '#FFE8B0',    // hot warm-white — contrasts the body
        intensity: 3.5,          // hard peak (was 1.6)
      },
      ignite: {
        enabled:   true,
        rate:      0.08,         // ~once every 12s (was 0.025)
        duration:  5.0,          // longer fade (was 3.5)
        maxSpread: 0.55,
        color:     '#FF8830',    // saturated orange — pops vs. amber body
        intensity: 2.6,          // hard peak (was 1.3)
      },
    },

    // Multiplicative-blend "shadow halo" that darkens the background in
    // the dark gaps between bright flame tongues — adds contrast against
    // the galaxy backdrop so the bright bits read sharper. Same noise
    // field + column mask as the body, but the output is `1 - body
    // intensity` projected as a darken multiplier.
    //   intensity  — peak darkening (0 = no effect, 1 = pure black gaps)
    //   haloScale  — column-width multiplier; >1 widens the shadow past
    //                the visible flame edges so the dark halo wraps it
    //   yMax       — height fraction over which the shadow tapers off
    shadow: {
      enabled:   true,
      intensity: 0.72,
      haloScale: 1.7,
      yMax:      0.90,
    },

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
      pointSize:     54.0,
      sizeVariance:  0.6,
      bodyColor:     '#FFD68A',
      coreColor:     '#FFFAE0',
      brightness:    2.4,
      // Forward z-pop during a chromatic flare — sparks shoot toward the
      // camera by up to this many mesh units while the flare envelope is
      // active, ending up visibly in FRONT of the logo. Synced with
      // ANIM.flame.flares (same envelope drives both). 0 disables.
      flareForward:  4.5,
    },

    // Flickering point-light STACK — N lights distributed up the flame's
    // vertical axis so the whole arch is illuminated, not just the hot
    // zone. Each entry in `stack` becomes one THREE.PointLight; all
    // share the same flicker speed/jitter, decay, and flare blend, but
    // each carries its own yFraction (where on the flame's height it
    // sits), intensityScale (relative to intensityMin/Max), base color
    // (so the arch shows a vertical hue gradient — warm amber at the
    // base, deep red near the tip), and phaseOffset (so the layers
    // flicker out of sync — without this they pulse in lockstep and
    // look like one big light).
    //
    //   yFraction  — 0=bottom of cutout, 1=vanishing-point Y
    //   intensityMin/Max — base flicker bounds, multiplied per-light
    //                      by each stack entry's intensityScale
    //   flareIntensityBoost — extra intensity added during a chromatic
    //                         flare (also scaled per-light)
    //   flickerSpeed/Jitter — sine + stochastic noise frequencies
    //   coolColor — light tints toward this when a flare is active
    light: {
      enabled:    true,
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
      color:        '#FF7A22',   // fallback for stack entries that omit color
      coolColor:    '#5DAEFF',
      decay:        1.4,         // dropped from 1.6 → 1.4 so the upper stack
                                 // lights still reach the arch top before
                                 // attenuating to nothing
      // Stack of lights along the flame's height. Add/remove entries
      // to scale up or down. 4 entries is a good balance of even arch
      // coverage vs. per-fragment lighting cost.
      stack: [
        // Hot base — yellow-amber, full intensity, no phase shift.
        { yFraction: 0.15, intensityScale: 1.00,
          color: '#FFB840', phaseOffset: 0.0 },
        // Mid-low — saturated orange.
        { yFraction: 0.40, intensityScale: 0.85,
          color: '#FF8A20', phaseOffset: 0.7 },
        // Mid-high — red-orange.
        { yFraction: 0.65, intensityScale: 0.70,
          color: '#E04A18', phaseOffset: 1.4 },
        // Tip — deep red, dimmest. Reaches the top of the arch.
        { yFraction: 0.85, intensityScale: 0.55,
          color: '#A4220F', phaseOffset: 2.1 },
      ],
    },

    // Secondary flame — a small saturated-blue flame that sits at the
    // base of the main flame, like the hot blue core of a candle. Reuses
    // the same shader and same cutout polygon; only the colour stops,
    // width, and height range differ. Any field present here overrides
    // the corresponding main-flame value when the secondary's uniforms
    // are pushed each frame; missing fields fall through to the main
    // flame's value (so e.g. shimmer/flare settings inherit unless you
    // explicitly override them here).
    //   heightFraction — top of the secondary, expressed as a fraction
    //                    of the distance from the cutout bottom up to
    //                    the pattern's vanishing point. 0.33 = the
    //                    secondary occupies the lower third of that
    //                    span; the top fades out at this Y.
    //   bodyHalfWidthBase / bodyHalfWidthTop — column half-widths,
    //                    matching the main flame's units (fraction of
    //                    the cutout's half-width). Smaller = thinner.
    //   colorBottom / colorMid / colorTop — saturated blue palette.
    secondary: {
      enabled:           true,
      heightFraction:    0.33,
      // Animate the small flame's top Y over time. Two beating sines
      // give a non-repeating-feeling drift; the heightFrac that
      // determines the secondary's top sits at `heightFraction` plus
      // a wander of ±`amount`. The result is clamped so the small
      // flame can never disappear or punch through the main flame's
      // tip.
      //   enabled       — master toggle
      //   amount        — half-range of the wander (added to and
      //                   subtracted from `heightFraction`). 0.20
      //                   means the secondary roams between
      //                   ~heightFraction-0.20 and ~heightFraction+0.20
      //   cycleDuration — seconds for one beat of the slowest sine.
      //                   Long values give very gradual drift.
      heightAnimation: {
        enabled:       true,
        amount:        0.18,
        cycleDuration: 14,
      },
      // Narrower than main (which is 0.18 / 0.05) so the blue column
      // sits visibly inside the orange one. Width noise + wobble are
      // also dialed down so the blue doesn't poke past the orange's
      // perimeter on its width-modulation peaks.
      bodyHalfWidthBase: 0.07,
      bodyHalfWidthTop:  0.020,
      widthNoiseAmt:     0.30,
      columnWobble:      0.025,
      // Bottom flare on the blue core — narrower than the main flame's
      // flare so the blue still sits visibly INSIDE the orange's flared
      // base. Main is ~0.95 (column nearly fills the cutout at t=0);
      // 0.45 here puts the blue base at ~0.52 of cutout half-width,
      // a comfortable margin inside the orange.
      bottomFlareWidth:  0.45,
      bottomFlareHeight: 0.10,
      colorBottom: '#5FBEFF',  // saturated cyan-blue at the hot base
      colorMid:    '#1A55FF',  // saturated electric blue mid-band
      colorTop:    '#0A1FA8',  // deep saturated blue at the cool tip
      brightness:    2.2,      // moderate — saturated blue with normal
                               // blending; doesn't need to overpower
                               // anything since it draws on top
      opacity:       1.0,
      // Long bottom fade so the very base of the blue column dims
      // out — the wick area dark, body lifts off it.
      bottomFadeFrac: 0.22,
      topExtendFrac:  0.0,
      // Disable shimmer + flares on the secondary so it stays a clean
      // saturated blue without warm-tinted shimmer / palette flashes.
      shimmer: { enabled: false, intensity: 0, yMax: 0.4, speed: 1.3 },
      flares:  { enabled: false, rate: 0, duration: 1.0,
                 intensity: 0, yMax: 0.5, palette: [] },

      // Slow hue oscillation — wanders the HOT (bottom + mid) stops in a
      // narrow band around `baseHue` so the inside of the small flame
      // wavers warm-blue ↔ cyan ↔ violet without ever leaving the blue
      // half of the wheel. The OUTLINE (colorTop) is intentionally not
      // overwritten — it stays locked to the static `colorTop` above
      // (a saturated deep blue) so the flame's silhouette always reads
      // as blue regardless of what the hot core is doing.
      //
      //   duration   — seconds for one full sine cycle. Long values
      //                give very slow drift; short values give visible
      //                rolling colour change.
      //   baseHue    — HSL hue (0..1) the oscillation centres on.
      //                0.62 ≈ saturated electric blue.
      //   hueRange   — half-width of the hue oscillation, in HSL units.
      //                0.10 = ±36° around `baseHue` (stays blue-violet
      //                ↔ blue ↔ cyan). Push to 0.20 for noticeable
      //                excursions toward green / magenta.
      //   saturation — HSL saturation for the bottom + mid stops.
      //   lightness* — HSL lightness for each stop.
      //   midHueOffset — hue offset for the mid band relative to the
      //                  bottom, keeping a visible gradient.
      hueRotation: {
        enabled:         true,
        duration:        180,
        baseHue:         0.62,
        hueRange:        0.10,
        saturation:      0.92,
        lightnessBottom: 0.62,
        lightnessMid:    0.46,
        midHueOffset:    0.04,
      },
    },

    // Tertiary flame — a hard-outlined ring that traces the ORANGE main
    // flame's silhouette. Reuses the body shader in `outline` mode so the
    // column edge renders as a solid ring while the centre stays empty
    // (the orange + blue flames behind show through). Most silhouette-
    // shaping fields (column widths, waists, branching, top extension)
    // are intentionally OMITTED so they inherit from the main flame via
    // mergeFlameCfg — that way the outline always matches whatever shape
    // the orange currently has, including waist pinches and branching.
    // The vertical colour gradient runs deep red at the base → purple
    // bridge → vibrant blue at the tip.
    //
    //   outline.width  — ring thickness as a fraction of the column half-
    //                    width (0.18 ≈ outer 18 % of the column is filled,
    //                    inner 82 % is transparent core).
    //   outline.soft   — edge smoothness; small values give a harder /
    //                    sharper outline. 0.04 reads as a crisp ring.
    tertiary: {
      enabled:     true,
      // Vertical gradient — deep red at the base, purple bridge in the
      // middle, vibrant blue at the tip.
      colorBottom: '#B81A0E',
      colorMid:    '#5D1FA8',
      colorTop:    '#2280FF',
      brightness:  2.4,
      opacity:     0.55,
      // No shimmer / flares — the outline stays clean (no warm-tinted
      // flicker, no chromatic flashes overriding the red→blue gradient).
      // Branching is NOT overridden — it inherits the main flame's
      // setting so the outline visibly splits whenever the orange does.
      shimmer:   { enabled: false, intensity: 0, yMax: 0.4, speed: 1.3 },
      flares:    { enabled: false, rate: 0, duration: 1.0,
                   intensity: 0, yMax: 0.5, palette: [] },
      outline: {
        enabled: true,
        width:   0.18,
        soft:    0.04,
      },
    },

    // Galaxy starry-night mode. When viewMode === 'fireplace' the galaxy
    // shader lerps `uStarryMode` toward 1: nebula + warm core glow fade
    // out, deep-space goes pure black, and an extra dense star layer
    // fades in. `fadeSpeed` is 1/sec. `brightness` overrides the
    // galaxy's `uBrightness` uniform while fireplace mode is active so
    // the backdrop is darker and the flame body reads clearly against it.
    galaxyStarry: {
      fadeSpeed:   1.5,
      brightness:  0.32,
      // Subtle "powered by the flame" pulse: when >0, uBrightness is
      // multiplied by (1 - pulseAmount + pulseAmount * smoothedFlameEnv),
      // where smoothedFlameEnv is a 1-sec low-passed average of the flame
      // PointLight stack's instantaneous intensities. 0 = static; 0.5 =
      // backdrop dims to 50% of base when flame is at its dimmest.
      pulseAmount: 0.5,
    },
  },

  // -----------------------------------------------------------------------
  // FIREPLACE — brick frame that traces silhouette[0] directly so it
  // hugs the actual SDG curve (dome + flares) rather than a bbox-derived
  // half-ellipse. Lives in its own module (patterns/fireplace.js) and
  // reads ONLY this config block. Visible in the 'fireplace' view mode.
  //   springerYFrac — fraction of silhouette Y range below which the
  //                   centerline is clipped. 0 = legs trace silhouette
  //                   all the way down; 0.05 ≈ legs reach the bottom of
  //                   the SDG body but don't wrap under it; 0.5 = drops
  //                   the side flares entirely.
  //   archInset     — distance to push the centerline INWARD from
  //                   silhouette[0], units. 0 = brick outer face kisses
  //                   the silhouette; bigger values float the whole
  //                   archway inside the logo body.
  //   brickColor    — surround stone colour.
  //   brickZLift    — extra Z push toward the camera on the brick layer.
  //   brick.*       — per-brick dimensions; `depth` is the spacing along
  //                   the curve, so smaller = more bricks.
  //   petals.*      — muqarnas-style pointed-arch cells lining the inner
  //                   face with tips facing the logo. `spacing` controls
  //                   cell pitch along the curve.
  //   gap, domeRise, legHeight, arcSegments — INERT. Held over from the
  //   older bbox-horseshoe centerline (now replaced by silhouette
  //   tracing); kept here only so old presets don't crash.
  // -----------------------------------------------------------------------
  fireplace: {
    enabled:        true,
    // Tiny non-zero springerYFrac drops silhouette[0]'s bottom horizontal
    // edge from the longest-above-Y run so the band reads as a clean
    // upside-down U (top + sides) instead of wrapping across the floor.
    springerYFrac:  0.02,
    archInset:      2.0,
    // Dark voussoir colour — sharp contrast against the tan brick wall
    // fill (arch.floor + topLayer) so the rim reads as a distinct ring.
    brickColor:  '#8B5A2B',
    // Push the whole fireplace forward so the entire brick body lands
    // in front of arch.topLayer's outermost step (~gateFrontZ + 2.85).
    // 3.0 = brick back face at gateFrontZ + 3.0, fully clearing the step.
    brickZLift:  3.0,
    bricks: { enabled: true },
    // Ember-flicker emissive tint on the brick rim — same domain-warped
    // fbm the central flame uses, grafted onto the brick's StandardMaterial
    // via onBeforeCompile. PBR shading is preserved (bricks still read as
    // 3D stone) but they glow with subtle flickering ember light.
    //   strength  — final emissive multiplier. 0 disables (skips the
    //               onBeforeCompile patch entirely). 0.4-0.8 = subtle
    //               coals; >1 = clearly fiery.
    //   scale     — noise frequency in object-local XY. Higher = smaller
    //               flecks; lower = broader flame plates.
    //   speed     — vertical scroll speed (units/sec). Bigger = quicker
    //               licking.
    //   warp      — domain-warp strength; 0 = un-warped fbm (clean
    //               clouds); 1.5 = full flame-style turbulence.
    //   hotColor  — colour at noise peaks (the visible flame tongues).
    //   coldColor — colour in noise troughs (dark embers between).
    ember: {
      strength: 0.25,
      scale:    0.18,
      speed:    0.7,
      warp:     1.4,
      hotColor:  '#B07840',
      coldColor: '#2A0700',
    },
    brick: {
      width:       2.8,   // local-X — long axis pointing at the camera
      height:      5.0,   // local-Y — radial outward thickness (chunkier rim)
      depth:       2.3,   // local-Z — along-curve spacing
      mortarGap:   0.06,
      faultAmount: 0.05,
    },
    petals: {
      enabled:      false,
      length:       6.0,    // radial extent toward logo centre (longer = more visible)
      width:        3.0,    // tangential width along the curve
      thickness:    0.5,    // Z protrusion
      spacing:      2.2,    // along-curve pitch (smaller = denser)
      zLift:        0.0,    // additional forward push past the brick-centre anchor
      // How far inward (toward logo centre) to push the petal base from
      // silhouette[0]. Defaults to brick.height so the base sits exactly
      // flush with the inner face of the brick band.
      inwardOffset: undefined,
      // Warm contrast colour so petals pop against the dark voussoirs.
      color:        '#E06A3A',
    },
    // Inner hex band — tessellated pointy-top hexagons filling the inner
    // lining of the horseshoe. The outermost row's flat face kisses the
    // inner brick face; successive rows are pushed inward by 1.5·radius
    // and offset along the tangent by half a hex-width so adjacent rows
    // interlock (standard hex packing). The hex grid is laid out in the
    // curve's LOCAL frame at each sample (local-X = tangent, local-Y =
    // radial), so the tiling wraps around the horseshoe instead of being
    // drawn in flat world XY.
    //   radius            — hex circumradius (vertex-to-centre).
    //                       Width across flats = √3·radius.
    //   depth             — extrusion thickness on world-Z.
    //   rowCount          — how many hex rows deep the band runs (1 =
    //                       single row hugging the brick face; 3 = a
    //                       three-tile band reaching further inward).
    //   baseInwardOffset  — distance from silhouette[0] (after archInset)
    //                       at which row 0 sits. undefined → brick.height
    //                       so the outermost row is flush with the inner
    //                       brick face.
    //   alongOffset       — bonus tangential shift applied to every hex
    //                       (rotates the whole band along the curve).
    //   zLift             — extra Z above the brick centre. 0 = co-planar.
    //   color             — hex tile colour.
    innerHexes: {
      enabled:          false,
      radius:           3.0,
      depth:            0.5,
      rowCount:         1,
      // halfCut on  → pointy-top hex sliced along its horizontal
      //               diameter; only the upper half is drawn. The cut
      //               edge runs along the inner brick wall (curve
      //               tangent), the rounded half points inward toward
      //               the logo. Default base offset = brick.height so
      //               the cut edge sits flush against the wall.
      // halfCut off → full pointy-top hex. Default base offset =
      //               brick.height + radius so the hex's outer edge
      //               flushes with the inner brick face (no radial
      //               overlap with the brick rim).
      halfCut:          true,
      // undefined → resolved by halfCut above. Set explicitly to override.
      baseInwardOffset: undefined,
      alongOffset:      0.0,
      // pitchScale multiplies the natural touching-hex pitch along the
      // tangent. 1.0 = adjacent flat edges kiss; >1 introduces a gap
      // between tiles. 1.15 leaves a small gap for visual breathing.
      pitchScale:       1.0,
      zLift:            0.05,
      color:           '#E8B86E',
      // Outline — when true (or outlineColor is set), every hex tile
      // gets a LineSegments edge stroke laid over its mesh.
      outline:          false,
      outlineColor:    '#1a0d05',
    },
  },

  // -----------------------------------------------------------------------
  // DOMINO-FLIP — looping radial wave across every brick in the scene
  // (arch.floor + topLayer + fireplace rim). Press 'd' to TOGGLE the
  // loop on/off, or call window.__triggerDominoes() in devtools.
  // Implementation: src/dominoes.js. At each cycle start we rank every
  // brick by 2D Euclidean distance to the brick mass's CENTROID
  // (DESCENDING) — outermost circular ring fires first, next ring
  // inward fires next, and so on, so the wave reads as concentric
  // circles collapsing toward the centre regardless of the underlying
  // silhouette shape.
  //
  // Concurrent flippers ≈ duration / stagger. Bigger ratio = thicker
  // wavefront (more bricks in flight at once); smaller ratio = sharp
  // single-brick-deep ripple.
  //
  //   stagger  — seconds between adjacent bricks' start times. Smaller =
  //              denser wavefront.
  //   duration — seconds for a single brick's full rotation. Bigger =
  //              wavefront stays alive longer; more overlap with
  //              neighbours' flips.
  //   angle    — radians to rotate. Math.PI * 2 = full 360° spin that
  //              returns to rest. Math.PI = half-flip that settles in
  //              the upside-down pose.
  //   axis     — WORLD-frame rotation axis [x,y,z]. [1,0,0] = every
  //              brick tips around the world horizontal axis (the
  //              classic forward "domino fall"); [0,1,0] = world-Y
  //              spin (bricks rotate like a wheel on a pole);
  //              [0,0,1] = world-Z spin (in-screen pinwheel).
  // -----------------------------------------------------------------------
  dominoFlip: {
    stagger:  0.025,        // ~100 bricks flipping at once with duration 2.5
    duration: 2.5,
    angle:    Math.PI * 2,
    axis:     [1, 0, 0],
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
