# Glossary

Plain-English reference for every term used in the codebase. If you forget what `sparks` does or where `edgeChase.js` lives, look here first.

## View modes

Switch with the digit keys (each goes through a dip-to-black transition).

| Key | Internal name | Display name | What you see |
|---|---|---|---|
| `0` | `visualSequence` | Visual Sequence | The "default show" — rosette pattern + hex lattice + flower overlay running on a synchronized cascade. |
| `1` | `fractalPattern` | Fractal Pattern | Rosette panel + hex lattice with the fractal "telescope" lens zooming infinitely into the center. |
| `2` | `hexagons` | Hexagons | The pulsing hex-brick wall; the sky auto-cycles between warm nebula and dense starfield. |
| `3` | `flowers` | Flowers | Hex bricks morph into rose petals and back. |
| `4` | `fireplaceOne` | Fireplace | Cascading amber-stone brick arch + voussoir corona + volumetric flame + starry sky. |
| `5` | `fireplaceTwo` | Depth Portal | Infinite conveyor of glowing receding A-outlines spiraling to a vanishing point. |
| `6` | `flameOnly` | Primal Ember | Black body, gilded frame, edge-light comets, constellation figures, hearth flame. |
| `7` | `moltenGold` | Molten Gold | Liquid gold filling the silhouette — convecting body, blooming surface line, sparks. |
| `9` | `calibration` | Calibration | Mapping alignment patterns (cycle with `C`). |

## Effects (what's in the `src/effects/` folders)

| Effect file | Lives in | What it does |
|---|---|---|
| `fractalPattern.js` | `effects/fractalPattern/` | The 12-pointed Islamic rosette panel tiling the front face. |
| `fractalZoom.js` | `effects/fractalPattern/` | The Droste-style recursive lens dive of mode 1. |
| `hexagons.js` | `effects/hexagons/` | The pointy-top hex lattice behind the rosettes, per-hex pulse phases. |
| `starFans.js` | `effects/flowers/` | The overlay: big hex-brick wall + the hex↔rose morph + edge rosette fans. |
| `fireplaceTiles.js` | `effects/fireplaceOne/` | The cascading-brick arch layers (now amber stone). |
| `flame.js` | `effects/fireplaceOne/` | The volumetric FBM flame + sparks + flickering light stack + flame rim. |
| `outerArch.js` | `effects/fireplaceTwo/` | Mode 4's outer treatment: the **radiant voussoir corona** (gilded-tip sunburst arch). Old muqarnas arch behind `ANIM.fireplace.legacy`. |
| `dominoAnim.js` | `effects/fireplaceTwo/` | Domino flip waves — multi-epicenter concentric RINGS flip together (`D`). |
| `recede.js` | `effects/fireplaceTwo/` | The Depth Portal conveyor (mode 5). `conveyor.enabled:false` = old static stack. |
| `molten.js` | `effects/moltenGold/` | Mode 7's liquid-gold fill: FBM body + overbright meniscus + spark emitter. |
| `constellation.js` | `effects/constellation/` | Star figures + stellar pulse events (mode 6). |
| `edgeChase.js` | `effects/_shared/` | Comet heads + ember tails racing the silhouette (mode 6/7 idle, `edge.burst` anywhere). |
| `logoFrame.js` | `effects/_shared/` | The extruded gate-frame ring; its lips/bosses carry the permanent gilded emissive. |
| `sparks.js` / `sparkFactory.js` | `effects/_shared/` | Edge-crawling glowing particles (see below). |
| `streams.js` | `effects/_shared/` | Free-flying rising ember + white ray streams. |
| `gateRim.js` | `effects/_shared/` | The flame-rim pulse/ignite driver on the gate aperture (mode 6). |
| `shaderPatches.js` | `effects/_shared/` | Shared hull-clip / radial-fade shader injection + `chainOnBeforeCompile`. |

**Sparks vs streams:** sparks crawl along pattern edges (snap to strokes); streams fly up freely from the inner-star outline.

## Engine (`src/core/`)

| Module | What it does |
|---|---|
| `pipeline.js` | THE render/size authority — window/projection/export mode stack, EffectComposer (bloom), warp pass slot. Only module allowed to resize the renderer. |
| `projection.js` | Fixed-resolution head-on framing for mapping (`?proj=1&w=&h=`, `Shift+P`). Locked fov-20 camera. |
| `calibration.js` | Mapping patterns: silhouette fill/outline (world-space) + grid/checker/corners (screen-space). |
| `control.js` | Remote-control dispatcher — one JSON protocol over WebSocket (TouchDesigner), BroadcastChannel (`control.html`), `window.__control`. |
| `ws-client.js` | Forever-reconnecting WebSocket client (TD is the server). |
| `warp.js` | Built-in corner-pin homography warp + drag/nudge editor (`W`). |
| `export.js` | Deterministic 4K/1080p PNG+MP4 export (Shift+E / Shift+D). |
| `scene.js` | Scene/camera/renderer + the procedural studio environment (gradient sphere + softboxes → streaked metal reflections). |
| `lights.js` | The breathing light rig + fireplace envelope. |
| `logo.js` | GLB loader + silhouette extraction + physical-gold material upgrade (`COLORS.logo.physical`). |

## Show system (`src/show/`)

| Module | What it does |
|---|---|
| `triggers.js` | Named trigger registry (`cascade.now`, `molten.fill`, `portal.rush`, …) shared by keyboard, playlist, remote, devtools (`window.__triggers`). |
| `transitions.js` | Mode-change envelopes: `dip` (exposure to black and back), `wipe` (silhouette disc from the pattern center), `edgeFlash` (dip + comet burst), `cut`. |
| `sequencer.js` | The auto-show: walks `ANIM.show.playlist` (mode, dwell, cues), pauses on manual input. Keys `S`/`N`. |

## Architectural terms

| Term | What it means |
|---|---|
| Cascade | Radial tile motion outward and back — the Visual Sequence heartbeat. |
| Fractal lens | Mode 1's zoom-into-itself Droste recursion. |
| Voussoir corona | Mode 4's outer arch: radial amber voussoirs, every 2nd tip gilded → dotted bloom halo. |
| Meniscus | Molten Gold's overbright liquid surface band — the intentional bloom emitter. |
| Comet / edge chase | A hot core + ember tail racing along the silhouette ribbon. |
| Portal / conveyor | Mode 5's endless stream of silhouette copies drifting toward the viewer. |
| Gate frame / aperture | The extruded ring along the silhouette; "aperture" = its inner edge. |
| Silhouette / hull | True concave outline (with cutouts) vs its convex hull. |
| Bloom threshold | Linear luminance above which pixels glow (1.6). Lit gold stays below; sparks, flame cores, gilding, meniscus cross it on purpose. |
| Legacy path | `ANIM.post.enabled=false` — the exact pre-revamp direct-render pipeline (Shift+B). |
| Ring stagger | Domino waves: all bricks in a distance-ring flip together; rings fire outward from epicenters. |

## Where to change common things

| To change… | Edit… |
|---|---|
| Default view mode at startup | `src/config.js` → `ANIM.viewMode` |
| Colors / gold material / environment | `src/config.js` → `COLORS` |
| Bloom | `ANIM.post.bloom` (live) |
| Auto-show playlist | `ANIM.show.playlist` |
| Projection framing | `ANIM.projection` (fov/margin/zoom/offset) |
| Amber stone / corona / domino rings | `ANIM.arch.amber`, `ANIM.fireplace.corona`, `ANIM.dominoFlip` |
| Molten / portal / edge chase | `ANIM.molten`, `ANIM.recede`, `ANIM.edgeChase` |
| Quality presets | `src/quality.js` → `QUALITY_PRESETS` |
| A new keyboard shortcut | `src/main.js` → the `keydown` listener |
| A new trigger | `registerTrigger(...)` in `src/main.js` — every control surface picks it up |
