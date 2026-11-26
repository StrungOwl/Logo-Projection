# Logo Projection

Animated 3D logo piece built for **projection mapping onto a physical A-logo surface**. Three.js, no build step — ES modules served statically, all dependencies vendored (runs fully offline). Thirteen view modes, post-processing bloom, an auto-show sequencer for unattended installation duty, remote control from TouchDesigner, and two complete projection pipelines.

It also ships as a **full-screen version** (`fullscreen.html` / `start-fullscreen.bat`) that draws the same show on a procedural slab in the projector's aspect ratio — for a plain wall or screen, no 3D logo, no mapping. See [Full-screen version](#full-screen-version).

See [GLOSSARY.md](GLOSSARY.md) for plain-English definitions of every term, and [docs/TOUCHDESIGNER.md](docs/TOUCHDESIGNER.md) for TouchDesigner.

## Run in TouchDesigner

Open `touchdesigner/LogoProjection.toe`. The show starts by itself; `F1` puts it on the projector; every key below works. TouchDesigner serves the app itself — no `start.bat`. A Non-Commercial licence limits the picture to 1280 × 720 (see the guide).

## Run locally

```
start.bat
```

starts a server on port **5501** and opens Chrome. (Or run any static server in the project root — `python -m http.server 5501` — and open `http://127.0.0.1:5501`.) Everything is vendored under `vendor/`; no internet needed.

Useful URLs:
- `index.html` — normal editing view (orbit camera)
- `index.html?proj=1&w=1920&h=1080` — fixed-resolution projection mode
- `index.html?proj=1&w=1920&h=1080&ws=127.0.0.1:9980` — projection + TouchDesigner control
- `fullscreen.html` — the full-screen (no logo) version, boots straight into projection framing
- `control.html` — remote-control panel (open in a second window of the same browser)

## Full-screen version

`start-fullscreen.bat` (or open `fullscreen.html`) runs every mode and THE SHOW on a flat slab that fills the whole output — the projector's aspect ratio is read from the window (or `?w=&h=`), the margin is zero, and THE SHOW auto-starts. Press `F11` on the projector output and it fills edge to edge. A four-point star aperture in the middle keeps the fire, the galaxy glow and the portal's vanishing point; the gilded gate frame becomes a thin border.

| URL knob | Effect |
|---|---|
| `?hole=none` | Solid slab, no star aperture (the fire uses a synthetic column in the same place) |
| `?holeScale=1.3` | Bigger / smaller aperture (also `MODEL.screen.holeWidth/holeHeight/holeY` in `src/config.js`) |
| `?aspect=1.333` | Force an aspect instead of following the window |
| `?proj=0` | Editing view with the orbit camera |
| `?surface=screen` on `index.html` | Same thing without the dedicated page (`?surface=logo` forces the GLB) |

Implementation: `src/core/surface.js` builds the slab in the same mesh units as the GLB (height 110.85, depth 10) so every effect keeps its authored size; `src/core/logo.js` dispatches on the surface and finishes both through the same path.

## Shapes (any SVG outline)

The show can draw on any outline: put an SVG in `shapes/` and open `index.html?shape=<name>`. `start-shapes.bat` opens a page with every shape (`shapes.html`). In TouchDesigner, set **Shape** on `/project1/logo`.

| Shape | What it is |
|---|---|
| `mandala` | The laser-cut mandala base (layer 0) |
| `mandala-openwork` | The same, and its 198 small holes stay dark |
| `hexagon`, `arch` | Examples |

A four-point star is cut in the middle for the looks (or use a hole that the SVG has, or none). The final picture is trimmed to the exact SVG outline. Full guide, options and how to add a shape: `shapes/README.md`.

Implementation: `src/core/shape.js` (SVG to slab, same mesh units as the GLB), `src/core/shapeMask.js` (final mask), options in `shapes/shapes.js`.

## View modes

| Key | Mode | What you see |
|---|---|---|
| `0` | **The Show** | The curated full sequence — every visual with a bespoke transition per seam, looping |
| `1` | Molten Gold | Opens as the full gold logo, holds, then particlizes downward to reveal the stars |
| `2` | Fractal Pattern | Rosette + lattice with the infinite fractal lens zoom |
| `3` | Hexagons | Pulsing hex-brick wall; sky auto-cycles nebula ↔ dense starfield |
| `4` | Flowers | A field of small petals that re-forms into a honeycomb, a sunflower swirl, breathing rings and a spiral burst. No gate, no star glow. Order and shapes differ on every visit |
| `5` | Fireplace | Amber-stone brick arch + radiant voussoir corona + flame + starry sky |
| `6` | Depth Portal | Infinite conveyor of glowing receding A-outlines in a black void, the star outline held in front, and particle ribbons flowing from the outlines into the vanishing point |
| `7` | Constellations | Star figures + gilded frame + edge-light comets |
| `Q` | **Star Dive** | Continuous fractal zoom: the logo nested inside its own star, forever. Lit, bevelled slabs with drop shadows, parallax and depth fog; the star of the nearest copy opens around you as you pass through it. No gate |
| `W` | Mercury | Liquid chrome. Bars of gold and cold light bend and break up on a slowly moving surface |
| `R` | Strata | The logo carved into terraces of fine contour lines. Lines creep, merge and split; beads of light run along them; a tide of light leaves the star |
| `T` | Shards | Faceted obsidian. Facets flash as the light moves; cracks glow in waves from the star |
| `8` | Visual Sequence | The classic composite — rosettes + hex lattice + flower overlay cascade |
| `9` | Calibration | Alignment patterns for mapping (cycle with `C`) |

## Generative looks

Every time a mode is entered, `ANIM.variations` (in `src/config.js`) rolls a few of its knobs to random values inside safe ranges — spiral divergence, curl, depth, speeds — so no two visits look the same. `ANIM.looks` holds per-mode trims: the orange star glow, the front light, and whether the gilded gate shows. Set `variations.enabled: false` to freeze every look.

## Keyboard

| Key | Action |
|---|---|
| `0`–`7`, `9` | Switch view mode (through a dip-to-black transition) |
| `I` | On-screen controls card (this table, in-app) |
| `Space` | Fire the cascade / fractal zoom now; in the Depth Portal and Star Dive: rush; in W/R/T: a pulse of light |
| `F` | Toggle the Depth Portal particle flow (fades in / out) |
| `Q` / `X` | Star Dive mode / reverse its direction (fall in ↔ rise out) |
| `W` `R` `T` | Mercury / Strata / Shards (`E` is free) |
| `D` | Toggle the domino flip waves (fireplace bricks, concentric rings) |
| `P` | Fire a constellation stellar pulse (mode 7) |
| `S` / `N` | Auto-show: play–pause / next playlist step |
| `C` | Cycle calibration pattern (fill → outline → grid → checker → corners) |
| `B` / `Shift+B` | Toggle bloom / toggle the whole post-processing composer (A-B the legacy look) |
| `M` | Corner-pin warp editor (drag corners; Tab select, arrows nudge, R reset) |
| `K` | Cycle quality preset HIGH → MED → LOW |
| `Shift+P` | Toggle fixed-resolution projection mode |
| `Shift+E` / `Shift+D` | Export 4K / 1080p video |
| Double-click | Reset the camera framing (editing view) |

## Projection pipelines

**A — through TouchDesigner:** open `touchdesigner/LogoProjection.toe`. It serves the app, renders it in a Web Render TOP, forwards the keyboard, and has a Corner Pin for mapping. Full 1080p needs a Commercial/Educational licence; Non-Commercial runs at 1280 × 720. Guide: [docs/TOUCHDESIGNER.md](docs/TOUCHDESIGNER.md).

**B — no TouchDesigner:** fullscreen the browser on the projector in projection mode, press `M`, and drag the four corners onto the physical surface (persists per resolution). The calibration patterns (`9` + `C`) work here too.

## Auto-show

`ANIM.show.playlist` in `src/config.js` defines the unattended show: mode, dwell seconds, transition style, and timed trigger cues.

THE SHOW is one story that loops: **gold** melts and runs down → the **night sky** (twinkle, shooting stars, the Big Dipper, more figures) → the sky starts to turn and its stars stretch into the flow lines of the **Depth Portal** → a rush through the star into the **Star Dive** → the molten rock cools into **contour lines**, cracks into **shards**, sets into the **hex wall** → the wall opens into **flowers** → the **hearth** lights from the star → liquid gold pours back down over the fire.

Transition styles: the morphs `fade` / `dissolve` / `iris` / `vortex` / `zoom` / `melt` / `pour` (no blink to black: a snapshot of the old look is warped or dissolved over the new live look, masked to the logo — `src/show/morph.js`, lengths in `ANIM.transitions.morph`, per step with `transitionDur`), and the older `dip` / `wipe` / `edgeFlash` / `burst` / `cut`. Mode keys still use `dip`. Keys `2`, `8` and `W` are not in the story. It starts automatically in projection boots (`autoStartInProjection`) and pauses the moment you press a mode key. Remote: `{"type":"show","action":"play|pause|next|goto"}`.

## Remote control

One JSON protocol over three transports: TouchDesigner WebSocket (`?ws=host:port`, TD's Web Server DAT is the server), BroadcastChannel (`control.html`), and `window.__control({...})` in devtools. Modes, triggers (`window.__triggers.list()`), live `ANIM` parameter writes, calibration, warp, quality, show control, and remote key presses (`{"type":"key","key":"6"}` runs the normal keyboard handler). Message reference: header of `src/core/control.js`.

## File structure

```
src/
├── main.js                Orchestrator — boots everything, runs tick(t, dt)
├── config.js              Every knob (live-editable via window.ANIM.*)
├── quality.js             Quality presets (Q key)
├── core/                  Engine: scene, lights, logo loader, render pipeline,
│                          projection mode, calibration, control, warp, export
├── show/                  Trigger registry, mode transitions, auto-show sequencer
├── effects/               Visual effects, one folder per mode + _shared/
├── shaders/               GLSL patches (galaxy, gold shimmer, amber stone, …)
└── util/                  Pure helpers (color, geometry, polygon)
shapes/                    SVG shapes + shapes.js (options) + README.md (guide)
shapes.html                Page to pick a shape (start-shapes.bat)
vendor/                    three.js 0.170 + mp4-muxer, committed (offline)
docs/TOUCHDESIGNER.md      TouchDesigner guide
touchdesigner/             LogoProjection.toe + its build script and synced Python
control.html               Remote-control panel
.verify/                   Playwright screenshot probes (cd .verify && npm i)
```

## Verification harness

With the server running (`start.bat`):

```
node .verify/modes.mjs <label>        # deterministic screenshots of every mode (orbit view)
node .verify/proj-modes.mjs <label> [modes] [times]   # 1920x1080 projection-mode shots at several times
SURFACE=screen node .verify/proj-modes.mjs <label>   # same, on the full-screen surface
QUERY='shape=mandala' OUT=<label> node .verify/shape-probe.mjs   # every look on an SVG shape
node .verify/diff.mjs <a> <b> 0.1     # pixel-diff two shot sets
node .verify/verify-pipeline.mjs      # projection + calibration asserts
node .verify/verify-show.mjs          # transitions/sequencer/control asserts
node .verify/verify-warp.mjs          # warp + wipe smoke test
node .verify/portal-probe.mjs <label> [seconds] ['{"recede.flow.count":600}'] [key:space@12]   # Depth Portal shot with overrides / a cue
node .verify/perf-calls.mjs           # draw calls + triangles per mode
node .verify/fps.mjs [seconds]        # real-GPU frame rate per mode (headed Chromium); UNCAP=1 removes vsync
```

Probe caveat: a projection boot auto-starts THE SHOW, whose opening wipe is still in flight for ~1 s — pause the show and tick past it before writing `ANIM.viewMode` directly, or the wipe flips the mode back to its own target (`proj-modes.mjs` does this).

On a machine where Chromium is not at the default Windows path, set `CHROME=/path/to/chrome` first.

Probes are deterministic (seeded RNG + fixed timestep). Caveat: changing the ORDER of object creation at load shifts the seeded stream — expect a re-baseline after structural changes, and judge diffs visually.

## Performance

Post-processing runs on a HalfFloat MSAA render target; quality presets (`K`) scale MSAA samples, bloom resolution, particle counts, and pixel ratio. `ANIM.post.enabled=false` (Shift+B) bypasses the composer entirely and reproduces the exact pre-revamp pipeline. The composer is the single biggest per-frame cost (~5 ms at 1080p); the HIGH preset runs the bloom pyramid at 60 % resolution, which is invisible on the wall and saves ~2 ms.

Uncapped 1080p on an RTX 3070 (2026-09): every mode ≥ 70 fps; Visual Sequence ~70, Fractal ~80, the rest 85–125. Per-mode draw calls: `node .verify/perf-calls.mjs`.
