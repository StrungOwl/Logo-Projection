// SHAPES — the list of projection shapes.
//
// A shape is one SVG file in this folder. The show draws on that shape
// instead of the 3D logo. To add a shape:
//
//   1. Put the SVG in this folder.            shapes/my-shape.svg
//   2. Open the show with its name.           index.html?shape=my-shape
//   3. (Optional) Add an entry below to tune it.
//
// Step 3 is optional: a shape with no entry uses SHAPE_DEFAULTS.
// The full guide is shapes/README.md.
//
// The biggest closed path in the SVG is the outline. Smaller paths inside
// it are holes (see `hole` and `mask`).

export const SHAPE_DEFAULTS = {
  // file: SVG file name in this folder. Default = '<name>.svg'.
  file: null,
  label: null,              // name shown on shapes.html

  // ---- the opening in the middle ------------------------------------
  // The looks are built around an opening (the star in the logo): the
  // fire burns in it, the portal falls into it, the gold star glows in it.
  //   'star'  cut a four-point star (size and place set below)
  //   'svg'   use the biggest hole that the SVG already has
  //   'none'  no opening (the fire then uses an invisible star column)
  hole: 'star',
  holeWidth:  0.34,         // star width,  fraction of the shape width
  holeHeight: 0.42,         // star height, fraction of the shape height
  holeX: 0.0,               // star centre, fraction of width  (+ = right)
  holeY: 0.0,               // star centre, fraction of height (+ = up)
  holeScale: 1.0,           // one number to make the star bigger / smaller

  // ---- placement -----------------------------------------------------
  rotate: 0,                // degrees, counter-clockwise
  flipX: false,             // mirror left / right
  scale: 1.0,               // 1 = longest side as tall as the logo

  // ---- detail --------------------------------------------------------
  // The looks follow a simplified outline (fast). The exact SVG outline
  // is kept for the mask, so the edge of the light stays exact.
  maxPoints: 700,           // most points in the simplified outline
  curveSegments: 12,        // points per curve when the SVG has curves

  // ---- mask: where light is allowed ------------------------------------
  //   'outline'  light only inside the exact SVG outline  (default)
  //   'holes'    same, and the small SVG holes stay dark too (openwork)
  //   'off'      no mask
  mask: 'outline',
  maskFeather: 0.0,         // soft edge, in mask pixels (0 = hard)
  maskOpening: true,        // hole 'svg': keep the cut opening dark too

  // ---- looks -----------------------------------------------------------
  // ANIM values for this shape only. Key = path in src/config.js ANIM.
  //   anim: { 'recede.twistDeg': 0, 'post.bloom.strength': 0.25 }
  // (The default below gives the edge-distance map more detail than the
  // logo needs: an SVG outline has finer parts. Bigger = sharper edges in
  // Star Dive / Strata / Shards / Mercury / Gold, and a slower start.)
  anim: { 'dive.sdfSize': 576 },
  // Looks to leave out of THE SHOW on this shape (viewMode names).
  //   skip: ['fireplaceOne']
  skip: [],
};

// Look values for the mandala (both entries use them).
const MANDALA_ANIM = {
  // The fire look puts a row of bright stones on the outline. On this
  // spiky outline they scatter, so they are off.
  'fireplace.enabled': false,
  // The hex wall is lit from the star. The mandala is wider than the
  // logo, so the tiles near the edge were almost black: more light there.
  'overlay.brickWall.starLight.far': 0.5,
};

// Look values for the fire-flower mock-ups.
const FLOWER_ANIM = {
  'fireplace.enabled': false,               // no edge stones on a petal outline
  'overlay.brickWall.starLight.far': 0.5,   // light reaches the petal tips
};

// SHAPE_MENU - the shapes that are in use now.
//   Key G steps through this list (then the logo, then round again).
//   The TouchDesigner Shape menu shows this list.
// Every shape in SHAPES still works by name (index.html?shape=<name>).
// An empty list = every shape in SHAPES.
// 2026-11-24: the six designs that were chosen from the precise set.
// 2026-11-25: Compass Lotus is the main design, so it is first.
export const SHAPE_MENU = [
  'flower02',   // Compass Lotus  (main design)
  'fire04',     // Fire Wheel
  'fire02',     // Candle Flame
  'flower04',   // Wing Bloom
  'flower01',   // Flame Dahlia
  'flower05',   // Tri Lily
];

export const SHAPES = {
  // The laser-cut mandala base (layer 0), 764.5 x 746.7 mm.
  // Source: E:\Art\2026\Projects\LASER CUTTER\Mandala\Cut Files\
  //         Openwork (with holes)\layer0_base_outline.svg
  mandala: {
    file: 'mandala.svg',
    label: 'Mandala base',
    hole: 'star',
    anim: MANDALA_ANIM,
  },
  // Same file. The 198 small laser-cut holes stay dark, so the light is
  // only on the wood.
  'mandala-openwork': {
    file: 'mandala.svg',
    label: 'Mandala base, holes dark',
    hole: 'star',
    mask: 'holes',
    anim: MANDALA_ANIM,
  },

  // ---- examples (safe to delete) ---------------------------------------
  // A plain polygon. Shows the smallest possible shape file.
  hexagon: {
    file: 'example-hexagon.svg',
    label: 'Example: hexagon',
    holeWidth: 0.40, holeHeight: 0.46,
  },
  // Curves, and a hole that is drawn in the SVG itself (hole: 'svg').
  arch: {
    file: 'example-arch.svg',
    label: 'Example: arch window',
    hole: 'svg',
  },

  // ---- fire-flower mock-ups, round 2 (2026-11-24) ---------------------
  // Ten ideas for the new laser-cut piece: the outline of old option 4,
  // with a fire flower as the opening (hole: 'svg'). The lace rings are
  // only in the wood drawings (shapes/fire-flower/<id>-layers.svg).
  // Made by shapes/fire-flower/make_fire_flowers.py. Delete the ones
  // that are not used when the design is chosen.
  bloom01: { file: 'fire-flower/bloom01.svg', label: 'Fire flower 01 - Compass Lotus', hole: 'svg', anim: FLOWER_ANIM },
  bloom02: { file: 'fire-flower/bloom02.svg', label: 'Fire flower 02 - Sun Dahlia', hole: 'svg', anim: FLOWER_ANIM },
  bloom03: { file: 'fire-flower/bloom03.svg', label: 'Fire flower 03 - Wind Rose', hole: 'svg', anim: FLOWER_ANIM },
  bloom04: { file: 'fire-flower/bloom04.svg', label: 'Fire flower 04 - Rose Window', hole: 'svg', anim: FLOWER_ANIM },
  bloom05: { file: 'fire-flower/bloom05.svg', label: 'Fire flower 05 - Flame Corona', hole: 'svg', anim: FLOWER_ANIM },
  bloom06: { file: 'fire-flower/bloom06.svg', label: 'Fire flower 06 - Peacock', hole: 'svg', anim: FLOWER_ANIM },
  bloom07: { file: 'fire-flower/bloom07.svg', label: 'Fire flower 07 - Chrysanthemum', hole: 'svg', anim: FLOWER_ANIM },
  bloom08: { file: 'fire-flower/bloom08.svg', label: 'Fire flower 08 - Water Lily', hole: 'svg', anim: FLOWER_ANIM },
  bloom09: { file: 'fire-flower/bloom09.svg', label: 'Fire flower 09 - Fern Wreath', hole: 'svg', anim: FLOWER_ANIM },
  bloom10: { file: 'fire-flower/bloom10.svg', label: 'Fire flower 10 - Star Seed', hole: 'svg', anim: FLOWER_ANIM },

  // ---- fire-flower mock-ups, round 3 (2026-11-24) ---------------------
  // Made from Sydney's hand drawings (shapes/fire-flower/drawings/), put
  // through a kaleidoscope with 8, 12 or 16 mirrors.
  // Made by shapes/fire-flower/make_ink_flowers.py.
  ink01: { file: 'fire-flower/ink01.svg', label: 'Ink flower 01 - Flame Crown', hole: 'svg', anim: FLOWER_ANIM },
  ink02: { file: 'fire-flower/ink02.svg', label: 'Ink flower 02 - Bud Crown', hole: 'svg', anim: FLOWER_ANIM },
  ink03: { file: 'fire-flower/ink03.svg', label: 'Ink flower 03 - Zigzag Bloom', hole: 'svg', anim: FLOWER_ANIM },
  ink04: { file: 'fire-flower/ink04.svg', label: 'Ink flower 04 - Fire Dahlia', hole: 'svg', anim: FLOWER_ANIM },
  ink05: { file: 'fire-flower/ink05.svg', label: 'Ink flower 05 - Wind Dahlia', hole: 'svg', anim: FLOWER_ANIM },
  ink06: { file: 'fire-flower/ink06.svg', label: 'Ink flower 06 - Sun Gear', hole: 'svg', anim: FLOWER_ANIM },
  ink07: { file: 'fire-flower/ink07.svg', label: 'Ink flower 07 - Feather Gear', hole: 'svg', anim: FLOWER_ANIM },
  ink08: { file: 'fire-flower/ink08.svg', label: 'Ink flower 08 - Baroque Bloom', hole: 'svg', anim: FLOWER_ANIM },
  ink09: { file: 'fire-flower/ink09.svg', label: 'Ink flower 09 - Heart Gear', hole: 'svg', anim: FLOWER_ANIM },
  ink10: { file: 'fire-flower/ink10.svg', label: 'Ink flower 10 - Three Drawings', hole: 'svg', anim: FLOWER_ANIM },

  // ---- free shapes (2026-11-24): one piece, not round -------------------
  // The ink designs, pulled into other outlines. Made by
  // shapes/fire-flower/make_free.py.
  free01: { file: 'fire-flower/free01.svg', label: 'Free shape 01 - Tall Flame', hole: 'svg', anim: FLOWER_ANIM },
  free02: { file: 'fire-flower/free02.svg', label: 'Free shape 02 - Eye', hole: 'svg', anim: FLOWER_ANIM },
  free03: { file: 'fire-flower/free03.svg', label: 'Free shape 03 - Four-Point Star', hole: 'svg', anim: FLOWER_ANIM },
  free04: { file: 'fire-flower/free04.svg', label: 'Free shape 04 - Wings', hole: 'svg', anim: FLOWER_ANIM },
  free05: { file: 'fire-flower/free05.svg', label: 'Free shape 05 - Comet', hole: 'svg', anim: FLOWER_ANIM },
  free06: { file: 'fire-flower/free06.svg', label: 'Free shape 06 - Trefoil', hole: 'svg', anim: FLOWER_ANIM },
  free07: { file: 'fire-flower/free07.svg', label: 'Free shape 07 - Galaxy', hole: 'svg', anim: FLOWER_ANIM },
  free08: { file: 'fire-flower/free08.svg', label: 'Free shape 08 - Hanging Bloom', hole: 'svg', anim: FLOWER_ANIM },
  free09: { file: 'fire-flower/free09.svg', label: 'Free shape 09 - Oval Gear', hole: 'svg', anim: FLOWER_ANIM },
  free10: { file: 'fire-flower/free10.svg', label: 'Free shape 10 - Cam Gear', hole: 'svg', anim: FLOWER_ANIM },

  // ---- the precise set (2026-11-24): 5 flowers, 5 gears, 5 fires ---------
  // Exact vector drawings. Made by shapes/fire-flower/make_fg.py.
  flower01: { file: 'fire-flower/flower01.svg', label: 'Flower 01 - Flame Dahlia', hole: 'svg', anim: FLOWER_ANIM },
  // Main design (2026-11-25). Five looks fill the body but leave the thin
  // outer tips dark, so they get the gold edge frame here.
  flower02: { file: 'fire-flower/flower02.svg', label: 'Flower 02 - Compass Lotus', hole: 'svg', anim: {
    ...FLOWER_ANIM,
    'arch.hideGateFrame': false,          // fire (fireplaceOne)
    'looks.flowers.gate': true,
    'looks.hexagons.gate': true,
    'looks.fractalPattern.gate': true,
    'looks.visualSequence.gate': true,
  } },
  flower03: { file: 'fire-flower/flower03.svg', label: 'Flower 03 - Wind Comet', hole: 'svg', anim: FLOWER_ANIM },
  flower04: { file: 'fire-flower/flower04.svg', label: 'Flower 04 - Wing Bloom', hole: 'svg', anim: FLOWER_ANIM },
  flower05: { file: 'fire-flower/flower05.svg', label: 'Flower 05 - Tri Lily', hole: 'svg', anim: FLOWER_ANIM },
  gear01: { file: 'fire-flower/gear01.svg', label: 'Gear 01 - Nautilus Gear', hole: 'svg', anim: FLOWER_ANIM },
  gear02: { file: 'fire-flower/gear02.svg', label: 'Gear 02 - Oval Flywheel', hole: 'svg', anim: FLOWER_ANIM },
  gear03: { file: 'fire-flower/gear03.svg', label: 'Gear 03 - Planet Gear', hole: 'svg', anim: FLOWER_ANIM },
  gear04: { file: 'fire-flower/gear04.svg', label: 'Gear 04 - Fire Turbine', hole: 'svg', anim: FLOWER_ANIM },
  gear05: { file: 'fire-flower/gear05.svg', label: 'Gear 05 - Clock Cam', hole: 'svg', anim: FLOWER_ANIM },
  fire01: { file: 'fire-flower/fire01.svg', label: 'Fire 01 - Bonfire', hole: 'svg', anim: FLOWER_ANIM },
  fire02: { file: 'fire-flower/fire02.svg', label: 'Fire 02 - Candle Flame', hole: 'svg', anim: FLOWER_ANIM },
  fire03: { file: 'fire-flower/fire03.svg', label: 'Fire 03 - Wildfire', hole: 'svg', anim: FLOWER_ANIM },
  fire04: { file: 'fire-flower/fire04.svg', label: 'Fire 04 - Fire Wheel', hole: 'svg', anim: FLOWER_ANIM },
  fire05: { file: 'fire-flower/fire05.svg', label: 'Fire 05 - Phoenix', hole: 'svg', anim: FLOWER_ANIM },
};
