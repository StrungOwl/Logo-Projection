# Logo Projection

Animated 3D logo projection with six interactive view modes. Built on Three.js, no build step — everything runs as ES modules straight from the browser.

See [GLOSSARY.md](GLOSSARY.md) for plain-English definitions of every term used in the codebase (effects, particle systems, view modes).

## Run locally

The Three.js CDN imports require an HTTP server (won't work via `file://`). From the project root:

```
python -m http.server 8000
```

Then open `http://localhost:8000` in Chrome or Edge.

## Keyboard controls

| Key | Action |
|---|---|
| `0` | Visual Sequence — synchronized rosette + hex lattice + flower overlay |
| `1` | Fractal Pattern — rosette + hex lattice with the fractal lens zoom |
| `2` | Hexagons — pulsing hex grid only |
| `3` | Flowers — rose petals morphing in and out |
| `4` | Fireplace One — cascading brick arch + flame, against a starry sky |
| `5` | Fireplace Two — horseshoe arch + muqarnas petals + flame |
| `D` | Domino flip wave (in fireplace modes) — taps several bricks; walls open in concentric rings |
| `Space` | Trigger the cascade / fractal zoom now (skip the rest, fire the next sequence immediately) |
| `Q` | Cycle quality preset HIGH → MED → LOW → HIGH (default: HIGH = full visuals) |
| `Shift+E` | Export 4K (3840×2160) video |
| `Shift+D` | Export 1080p (1920×1080) video |

## File structure

```
src/
├── main.js                  Orchestrator — boots scene, runs the per-frame tick
├── config.js                Every animation knob lives here
├── quality.js               Quality presets + Q-key cycle
├── core/                    Engine plumbing (scene, lights, logo loader, video export)
├── effects/                 Visual effects, grouped by view mode
│   ├── effects.js           Wires all effects onto the logo at startup
│   ├── _shared/             Reusable effects used by multiple view modes
│   │   ├── logoFrame.js     Extruded ring along the logo silhouette
│   │   ├── sparks.js        Edge-crawling glowing particles
│   │   └── streams.js       Free-flying ember + ray streams
│   ├── fractalPattern/      Mode 1 — Fractal Pattern
│   ├── hexagons/            Mode 2 — Hexagons
│   ├── flowers/             Mode 3 — Flowers
│   ├── fireplaceOne/        Mode 4 — Fireplace One
│   └── fireplaceTwo/        Mode 5 — Fireplace Two (horseshoe + dominoes)
├── shaders/                 GLSL fragments (galaxy backdrop, gradient tint, etc.)
└── util/                    Pure helpers (color, geometry, polygon)
```

Mode 0 (Visual Sequence) composites the other modes' effects; it has no own folder.

## Performance

Every visual is unchanged from the original at HIGH quality (the default). Lossless optimizations — devicePixelRatio cap, dirty flags on the per-frame brightness loop, skip-on-hidden for spark/stream physics, cache the scene environment swap, early-return when dominoes are idle — apply on every device.

If the scene drops frames on a weaker laptop, press `Q` to cycle to MED or LOW. This caps the pixel ratio and reduces rendered particle/spark counts. Visitors on weaker hardware still see HIGH unless you opt them in.

## Editing

`src/config.js` holds every tunable knob (colors, particle counts, animation timings, light intensities). All values are also reachable live from the browser devtools as `window.ANIM.*` and take effect on the next frame — no reload needed.
