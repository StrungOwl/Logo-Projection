DONE 2026-09 (upgrade pass):
- ✔ Portal (6) converges into the star, twist calmed (was spiralling off-frame)
- ✔ Fire (5) is a broad flame, not a needle; blue/purple layers are accents
- ✔ Constellations (7) show in 4 s, fat 2.5 px lines, bigger figures
- ✔ Molten (1) reads as gold under ACES
- ✔ Overlay leak fixed: fractal mode drew 1,152 hidden petals, hex mode ~940 (hexagons 1018 → 76 calls)
- ✔ Hidden effects no longer simulate (molten sparks, hearth, arch, hex-mode ghost decompose)
- ✔ Bloom pyramid 60 % on HIGH; every mode ≥ 70 fps uncapped at 1080p
- ✔ Show can't freeze on a throwing cue; cut/burst honoured mid-transition; control.html key map current
- ✔ FULL-SCREEN VERSION: fullscreen.html / start-fullscreen.bat (src/core/surface.js)

THINGS I STILL NEED TO DO:

- Physically map the piece onto the real surface with TouchDesigner
  (docs/TOUCHDESIGNER.md has the full flow) — or use the built-in warp (W).
- Tune the auto-show playlist dwell times after seeing it run on the wall.
- Maybe: audio reactivity (mic → flame intensity / cascade triggers).

DONE in the big revamp (2026-07):
- ✔ Bricks look like amber stone (ANIM.arch.amber knobs)
- ✔ Domino waves flip whole rings at once (ANIM.dominoFlip.epicenters)
- ✔ Outer arch replaced with the radiant voussoir corona (ANIM.fireplace.legacy to compare)
- ✔ TD flow: projection mode + Spout/WebRender capture + WebSocket control
- ✔ Optimized & cleaned: vendored deps (offline), shared shader helpers,
    bloom pipeline with legacy escape hatch (Shift+B), verify probes
