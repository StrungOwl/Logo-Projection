# Logo Projection

Animated 3D logo piece built for **projection mapping onto a physical A-logo surface**. Three.js, no build step — ES modules served statically, all dependencies vendored (runs fully offline). Nine view modes, post-processing bloom, an auto-show sequencer for unattended installation duty, remote control from TouchDesigner, and two complete projection pipelines.

It also ships as a **full-screen version** (`fullscreen.html` / `start-fullscreen.bat`) that draws the same show on a procedural slab in the projector's aspect ratio — for a plain wall or screen, no 3D logo, no mapping. See [Full-screen version](#full-screen-version).

See [GLOSSARY.md](GLOSSARY.md) for plain-English definitions of every term, and [docs/TOUCHDESIGNER.md](docs/TOUCHDESIGNER.md) for the TouchDesigner capture + control setup.

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

## View modes

| Key | Mode | What you see |
|---|---|---|
| `0` | **The Show** | The curated full sequence — every visual with a bespoke transition per seam, looping |
| `1` | Molten Gold | Opens as the full gold logo, holds, then particlizes downward to reveal the stars |
| `2` | Fractal Pattern | Rosette + lattice with the infinite fractal lens zoom |
| `3` | Hexagons | Pulsing hex-brick wall; sky auto-cycles nebula ↔ dense starfield |
| `4` | Flowers | Hex bricks morph → rose petals → back |
| `5` | Fireplace | Amber-stone brick arch + radiant voussoir corona + flame + starry sky |
| `6` | Depth Portal | Infinite conveyor of glowing receding A-outlines in a black void |
| `7` | Constellations | Star figures + gilded frame + edge-light comets |
| `8` | Visual Sequence | The classic composite — rosettes + hex lattice + flower overlay cascade |
| `9` | Calibration | Alignment patterns for mapping (cycle with `C`) |

## Keyboard

| Key | Action |
|---|---|
| `0`–`7`, `9` | Switch view mode (through a dip-to-black transition) |
| `I` | On-screen controls card (this table, in-app) |
| `Space` | Fire the cascade / fractal zoom now |
| `D` | Toggle the domino flip waves (fireplace bricks, concentric rings) |
| `P` | Fire a constellation stellar pulse (mode 6) |
| `S` / `N` | Auto-show: play–pause / next playlist step |
| `C` | Cycle calibration pattern (fill → outline → grid → checker → corners) |
| `B` / `Shift+B` | Toggle bloom / toggle the whole post-processing composer (A-B the legacy look) |
| `W` | Corner-pin warp editor (drag corners; Tab select, arrows nudge, R reset) |
| `Q` | Cycle quality preset HIGH → MED → LOW |
| `Shift+P` | Toggle fixed-resolution projection mode |
| `Shift+E` / `Shift+D` | Export 4K / 1080p video |
| Double-click | Reset the camera framing (editing view) |

## Projection pipelines

**A — through TouchDesigner (recommended, needs a Commercial+ license):** run the app in projection mode at your projector's resolution, capture via OBS→Spout or TD's Web Render TOP, map with Kantan Mapper using the calibration patterns, and control everything over the WebSocket channel. Full walkthrough: [docs/TOUCHDESIGNER.md](docs/TOUCHDESIGNER.md).

**B — no TouchDesigner:** fullscreen the browser on the projector in projection mode, press `W`, and drag the four corners onto the physical surface (persists per resolution). The calibration patterns (`9` + `C`) work here too.

## Auto-show

`ANIM.show.playlist` in `src/config.js` defines the unattended show: mode, dwell seconds, transition style (`dip` / `wipe` / `edgeFlash` / `cut`), and timed trigger cues. It starts automatically in projection boots (`autoStartInProjection`) and pauses the moment you press a mode key. Remote: `{"type":"show","action":"play|pause|next|goto"}`.

## Remote control

One JSON protocol over three transports: TouchDesigner WebSocket (`?ws=host:port`, TD is the server), BroadcastChannel (`control.html`), and `window.__control({...})` in devtools. Modes, triggers (`window.__triggers.list()`), live `ANIM` parameter writes, calibration, warp, quality, show control. Message reference: header of `src/core/control.js`.

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
vendor/                    three.js 0.170 + mp4-muxer, committed (offline)
docs/TOUCHDESIGNER.md      Capture + control walkthrough
control.html               Remote-control panel
.verify/                   Playwright screenshot probes (cd .verify && npm i)
```

## Verification harness

With the server running (`start.bat`):

```
node .verify/modes.mjs <label>        # deterministic screenshots of every mode (orbit view)
node .verify/proj-modes.mjs <label> [modes] [times]   # 1920x1080 projection-mode shots at several times
SURFACE=screen node .verify/proj-modes.mjs <label>   # same, on the full-screen surface
node .verify/diff.mjs <a> <b> 0.1     # pixel-diff two shot sets
node .verify/verify-pipeline.mjs      # projection + calibration asserts
node .verify/verify-show.mjs          # transitions/sequencer/control asserts
node .verify/verify-warp.mjs          # warp + wipe smoke test
node .verify/perf-calls.mjs           # draw calls + triangles per mode
node .verify/fps.mjs [seconds]        # real-GPU frame rate per mode (headed Chromium); UNCAP=1 removes vsync
```

Probe caveat: a projection boot auto-starts THE SHOW, whose opening wipe is still in flight for ~1 s — pause the show and tick past it before writing `ANIM.viewMode` directly, or the wipe flips the mode back to its own target (`proj-modes.mjs` does this).

Probes are deterministic (seeded RNG + fixed timestep). Caveat: changing the ORDER of object creation at load shifts the seeded stream — expect a re-baseline after structural changes, and judge diffs visually.

## Performance

Post-processing runs on a HalfFloat MSAA render target; quality presets (`Q`) scale MSAA samples, bloom resolution, particle counts, and pixel ratio. `ANIM.post.enabled=false` (Shift+B) bypasses the composer entirely and reproduces the exact pre-revamp pipeline. The composer is the single biggest per-frame cost (~5 ms at 1080p); the HIGH preset runs the bloom pyramid at 60 % resolution, which is invisible on the wall and saves ~2 ms.

Uncapped 1080p on an RTX 3070 (2026-09): every mode ≥ 70 fps; Visual Sequence ~70, Fractal ~80, the rest 85–125. Per-mode draw calls: `node .verify/perf-calls.mjs`.
