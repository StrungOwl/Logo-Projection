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
  patterns: { enabled: false },

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
  panelSparks:   { count: 220, gravity: 8, maxSpeed: 7, damping: 1.6,
                   snapStrength: 10,
                   tangentialFactor: 0.8, speedVariance: 0.55, sizeVariance: 0.75,
                   color: '#FFD9A0', hueVariance: 0.08,
                   pointSize: 0.1, trailSize: 35 },
  latticeSparks: { count: 150, gravity: 7, maxSpeed: 6, damping: 1.5,
                   snapStrength: 3.5,
                   tangentialFactor: 0.8, speedVariance: 0.55, sizeVariance: 0.75,
                   color: '#FFE8C0', hueVariance: 0.08,
                   pointSize: 0.15, trailSize: 25 },

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
    opacity:        0.85,
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
    // Temporarily disabled while iterating on the flower fill. Remove
    // this line (or set enabled: true) to restore the 40s brick↔rose
    // morph cycle.
    brickWall: { enabled: false },
  },

  // Radial cascade — infinite loop where each tile independently cycles
  // rest → exit → gap → entry → rest, phase-offset by its radius from
  // the pattern's fade center (outer-first). Most tiles are at rest at
  // any instant; only a thin radial band is in motion, sweeping inward
  // while new tiles emerge from beyond the hull. Spark snap strength
  // tracks the at-rest fraction (idlePeriod / total period).
  rowCascade: {
    enabled:       true,   // master on/off (false = pattern frozen at base positions)
    continuous:    false,  // true = skip the per-tile rest, tiles cycle nonstop (idlePeriod ignored)
    triggerDelay:  10.0,   // seconds after load before the cycle kicks in
    idlePeriod:    30.0,   // per-tile rest between cycles, seconds (ignored if continuous)
    rowStagger:    1.5,    // phase offset between adjacent radial rings, seconds
    exitDuration:  6.0,    // one tile rest → fade-center, seconds (ease-in cubic)
    gap:           0.5,    // pause at center before teleport to outer ring, seconds
    entryDuration: 6.0,    // one tile outer-ring → rest, seconds (ease-in-out cubic)
    outerMargin:   5.0,    // distance past hull max-radius where entry rays begin, units
    phaseJitter:   1.0,    // random per-tile phase offset at load, seconds (< rowStagger keeps wave)
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
