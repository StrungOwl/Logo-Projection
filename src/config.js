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
    starCount:      1,
    starSize:       4.0,
    angleSpread:    Math.PI * 0.55,
    fanRadius:      2.8,
    zOffset:        0.22,
    scaleMin:       0.7,
    scaleMax:       1.1,
    pulsePeriod:    6.0,
    spinSpeed:      0.05,
    opacity:        0.35,
    previewXFactor: 1.2,  // preview: anchors overlay left of the model
                          // (in maxR units past the hull centroid) so
                          // geometry is inspectable without the main
                          // pattern behind it. 1.0 = flush with hull
                          // edge; >1 pulls it further out.
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
