# Glossary

Plain-English reference for every term used in the codebase. If you forget what `sparks` does or where `outerArch.js` lives, look here first.

## View modes

The six numbered modes you switch between with the digit keys. Each one swaps which effects are visible.

| Key | Internal name | Display name | What you see |
|---|---|---|---|
| `0` | `visualSequence` | Visual Sequence | The "default show" — rosette pattern + hex lattice + flower overlay running on a synchronized cascade. |
| `1` | `fractalPattern` | Fractal Pattern | Rosette panel + hex lattice with the fractal "telescope" lens zooming infinitely into the center. |
| `2` | `hexagons` | Hexagons | The pulsing hex grid alone (no rosette, no flame). |
| `3` | `flowers` | Flowers | Rose petals morphing in and out of view. |
| `4` | `fireplaceOne` | Fireplace One | Cascading brick arch + volumetric flame body, sky fades to black starfield. |
| `5` | `fireplaceTwo` | Fireplace Two | Horseshoe arch with muqarnas (petal-tile) dome + flame, dominoes can be triggered. |

## Effects (what's in the `src/effects/` folders)

Every visual element on screen is one of these.

| Effect file | Lives in | What it does |
|---|---|---|
| `fractalPattern.js` | `effects/fractalPattern/` | The 12-pointed Islamic rosette pattern that tiles the front face. The "fractal" name comes from the recursive zoom lens in mode 1. |
| `hexagons.js` | `effects/hexagons/` | The pointy-top hexagon grid behind the rosettes. Each hex pulses with its own random phase. |
| `starFans.js` | `effects/flowers/` | Two translucent fans of rosettes anchored to the left and right edges of the logo, fanning inward. Holds the flower morph (brick → rose → brick) too. |
| `fireplaceTiles.js` | `effects/fireplaceOne/` | The cascading-brick arch in mode 4 — three layers of bricks (outer row, falling cascade, floor fill) that build the arch keystone-first. |
| `flame.js` | `effects/fireplaceOne/` | The volumetric flame that fills the central cutout. FBM-noise body + sparks + flickering point light. |
| `outerArch.js` | `effects/fireplaceTwo/` | The Roman horseshoe arch with muqarnas petal tiles in mode 5. Wraps the outside of the logo's bounding box. |
| `dominoAnim.js` | `effects/fireplaceTwo/` | The domino flip wave triggered by `D`. Multiple ripples expand from random epicenter bricks in concentric rings. |
| `logoFrame.js` | `effects/_shared/` | The extruded ring (with bosses/studs) that follows the logo silhouette and frames the patterns inside. |
| `sparks.js` | `effects/_shared/` | The edge-crawling glowing particles. See "Particle systems" below. |
| `streams.js` | `effects/_shared/` | The free-flying ember + ray streams. See "Particle systems" below. |

## Particle systems — sparks vs streams

The two particle systems look similar but behave very differently.

**Sparks** (`_shared/sparks.js`) — small glowing dots that *cling to the edges* of patterns. They snap to the strokes of rosettes, the perimeters of hex tiles, and the edges of bricks. Like fireflies dancing along a wire. Always tied to a host geometry (you can see them tracing the panel outlines in modes 0 and 1).

**Streams** (`_shared/streams.js`) — free-flying particles that *rise upward* from the inner-star outline of the logo toward a vanishing point. Two streams: warm orange embers + cool white rays. Not tied to any pattern — a soft rising aura around the logo. Hidden in the fireplace modes (where they'd compete with the flame).

In short: **sparks crawl along edges, streams fly up freely.**

## Folders — what lives where

| Folder | What's in it |
|---|---|
| `src/core/` | The render engine. Scene/camera setup, light rig, model loader, video export bridge. |
| `src/effects/` | Every visual effect. One subfolder per view mode + a `_shared/` folder for effects used by multiple modes. |
| `src/effects/_shared/` | `logoFrame.js`, `sparks.js`, `streams.js` — referenced by multiple view modes. |
| `src/shaders/` | Custom GLSL — galaxy backdrop, gradient tint, ember flicker, gold shimmer. |
| `src/util/` | Pure helpers with no Three.js scene state — color conversion (`color.js`), brick geometry (`geometry.js`), polygon math (`polygon.js`). |

## Keys

| Key | What it does |
|---|---|
| `0`–`5` | Switch view mode (see the View modes table). |
| `D` | Trigger a domino-flip wave through the bricks (fireplace modes). |
| `Space` | Skip ahead — fire the next cascade or fractal zoom immediately. |
| `Q` | Cycle quality preset HIGH → MED → LOW → HIGH (default HIGH). |
| `Shift+E` | Start a 4K video export. |
| `Shift+D` | Start a 1080p video export. |
| `Double-click` | Reset the camera to the default framing. |

## Quality presets

The `Q` key cycles between three presets. Default is HIGH (identical to original visuals).

| Preset | Particles | Sparks | Pixel ratio cap | Trail length |
|---|---|---|---|---|
| HIGH | 100% | 100% | 2.0× | full |
| MED | 60% | 60% | 1.5× | 60% |
| LOW | 35% | 35% | 1.0× | 40% |

Lossless optimizations (devicePixelRatio cap of 2, skip-on-hidden updates, dirty flags) apply on every quality level — you only lose visual fidelity when you opt into MED or LOW.

## Architectural terms

| Term | What it means |
|---|---|
| Cascade | The radial motion where pattern tiles slide outward toward the edges, then back to rest. The "Visual Sequence" mode is built around this cycle. |
| Fractal lens | The zoom-into-itself effect in mode 1 — a Droste-style recursion where pattern clones nest inside the original. |
| Muqarnas | The pointed petal tiles arranged in rows on the inner face of the horseshoe arch (mode 5). Traditional Islamic architectural ornament — looks like stalactite vaulting. |
| Rosette | The 12-pointed star at the center of each tile in the Islamic panel pattern. |
| Lattice | The hex grid behind the rosette panel. Provides the underlying texture you see in modes 0, 1, 2. |
| Logo silhouette | The actual outline of the SDG logo — used to clip patterns flush with the model edge and place the gate frame. Read from the SVG file. |
| Inner-star outline | The hole in the middle of the logo (where the volumetric flame burns in fireplace modes). The streams emit from this outline. |
| Brick / tile | A small extruded box (BoxGeometry) with seeded vertex jitter so it reads as hand-cut stone. The arch effects place hundreds of these along their curves. |
| Stroke | The line geometry of a pattern — the perimeter of a hex tile, the petal of a rosette. Sparks snap to these. |
| Stagger | The per-tile delay that makes the cascade look like a wave (outer tiles move first, inner tiles last) rather than every tile firing at once. |

## Where to change common things

| To change… | Edit… |
|---|---|
| Default view mode at startup | `src/config.js` → `ANIM.viewMode` |
| Colors | `src/config.js` → `COLORS` and per-effect color blocks |
| Particle counts | `src/config.js` → `ANIM.panelSparks.count` etc. |
| Animation timings | `src/config.js` → `ANIM.timings` |
| Quality preset values | `src/quality.js` → `QUALITY_PRESETS` |
| Add a new keyboard shortcut | `src/main.js` → the `keydown` listener at the bottom |
