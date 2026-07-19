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
