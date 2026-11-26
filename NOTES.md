DONE 2026-11 (full visual review — every mode judged from shots and fixed):
- 1 Molten Gold: gold drips down on thinning threads and crawls up in fingers; clings to
    the walls. Stray shiny spots removed (edge comets off in this mode, no gold left at the
    feet, rear-light glint trimmed). Knobs: ANIM.molten.drip / .level.
- 2 Fractal: dark body, domed lit hexes, depth fog in the zoom, first zoom at 12 s (was 60).
- 3 Hexagons: smaller bevelled tiles, lit by the star (hot near, oxblood far).
- 4 Flowers: small shapes, no gate, no star glow (earlier pass).
- 5 Fireplace: the fire now lights the wall from the centre (hearth falloff); lantern
    notches off; wider flame sitting on the base; blue/purple flame layers off.
- 6 Depth Portal: outer-A outline added.
- 7 Constellations: rebuilt sky (three drifting star layers, dust), ten figures that place
    themselves and draw line by line, round twinkling stars. Knobs: ANIM.constellation.
- 8 Visual Sequence: bevelled wall with black seams, shorter empty gap.
- Q Star Dive: materials kept dark (a bright bronze + a grey fill light made it milky).
- W Mercury rebuilt as liquid chrome. R Strata: five layered motions. T Shards.
- All of them: ANIM.looks trims (glow / lights / gate / body / galaxy / embers) and
    ANIM.variations rows, so each look is different on every visit.

KNOWN, NOT FIXED:
- 8: ~2 s sparse at the flowers→pattern hand-off; the big rosette petals are still large.
- 2: the zoom is dimmer than the rest state (clones lose per-hex seeds).
- 2 / 8: a few pixels of light just outside the edge while tiles enter (cause unconfirmed).
- 4 (and other ember modes): ember specks can drift above the arch.
- 7: a passing comet / rim sweep still blooms slightly past the edge.
- 1: molten.surge during a drain was lowered but not re-shot.

DONE 2026-11 (review pass, Sydney's notes):
- ✔ E (corona) removed. W (mercury) rebuilt as liquid chrome. R (strata) has five layered
    motions. R / T / W: the drawn area is now the logo's FULL outline, so the star flows
    down into the flare beneath it (it was cut at the star's neck), and one gold line runs
    around the entire logo edge.
- ✔ Depth Portal: faint outer-A outline added so the ribbons are held by the edge.
- Every mode was reviewed shot-by-shot in this pass (see the entries below / git diff).

DONE 2026-11 (letter-row looks):
- ✔ Star Dive moved to key Q. More contrast: flats stay black, veins / rims / glints brighter.
- ✔ Four new looks (src/effects/looks/shaderLooks.js), all generative, no gate, Space = pulse:
    W mercury · E corona · R strata · T shards. Knobs: ANIM.shaderLooks.
- ✔ Keys moved to make room: warp editor W → M, quality Q → K.
- (R and T are in THE SHOW since 2026-11-16; W is not.)

DONE 2026-11 (clean-up pass — direction from Sydney: push the EXISTING looks, do not add new ones):
- ✔ Flowers (4): small shapes only (big rosettes out of the cycle, petals ~30 % smaller),
    no gate, orange star glow off. Back in THE SHOW. Order reshuffles every pass.
- ✔ Star Dive (Z): cleaned — dark slabs, crisp rims, thin veins, no gate, no twist; the
    front copy's star OPENS instead of burning away in blobs.
- ✔ GENERATIVE: ANIM.variations rolls knobs on every mode entry (flowers, portal, dive;
    sky speed for the rest). ANIM.looks = per-mode glow / light / gate trims.
- ✔ Research applied (Lemercier/AntiVJ, ISAM, live-show guides): more black, fewer
    elements, bold contrast. Star glow trimmed in hexagons / fractal / visual sequence.

STILL TO PUSH (same treatment, not yet done):
- Hexagons (3), Fractal (2), Visual Sequence (8): still bright orange and flat; they only
  got a glow trim. Need real variation knobs and a contrast pass.
- Fireplace (5), Constellations (7), Molten (1): only the sky speed varies so far.

DONE 2026-11 (depth pass):
- ✔ STAR DIVE (key Z, X reverses, Space rushes): continuous fractal zoom — the logo
    nested inside its own star, endlessly. Signed-distance shader: bevel lighting, drop
    shadows between copies, parallax, depth fog, three dark materials (obsidian / oxblood /
    bronze) with gold veins, the nearest copy burns away. src/effects/starDive/. Knobs: ANIM.dive.
- ✔ Depth Portal: the vanishing point drifts (parallax) so the tunnel reads as 3D.
- ✔ THE SHOW: Star Dive added after the portal; Flowers removed from the show (still key 4).
- ✔ Pattern modes: centre light max 4.8 → 3.4 (it was blowing out to flat orange-white).

IDEAS NOT DONE YET (judgment: next candidates):
- Constellations (7) is sparse — more figures at once, parallax star layers.
- Hexagons / Flowers / Visual Sequence are still flat 2D pattern modes; give them the
  Star Dive treatment (lit relief, shadows) or retire them.
- TouchDesigner layer on top of the three.js picture: feedback trails, audio reactivity.

DONE 2026-11 (TouchDesigner + portal pass):
- ✔ TOUCHDESIGNER PROJECT: touchdesigner/LogoProjection.toe — serves the app itself,
    Web Render TOP, Corner Pin, projector window (F1). No start.bat, no OBS.
- ✔ KEYBOARD IN TOUCHDESIGNER: every key is forwarded ({type:'key'} control message),
    so the browser key map works unchanged.
- ✔ Depth Portal (6): particle ribbons flow from the outlines into the vanishing point
    (the old Particle Practice goal), front star outline, fat outline lines (were 1 px).
    F = flow on/off. Space = rush.
- ✔ docs/TOUCHDESIGNER.md corrected (the WebSocket server is the Web Server DAT).
- ! TouchDesigner here is NON-COMMERCIAL: picture capped at 1280 x 720 through TD.

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

- Physically map the piece onto the real surface: Corner Pin in the .toe
  (docs/TOUCHDESIGNER.md) — or the built-in warp (W) in the browser.
- Decide: TouchDesigner licence for 1080p, or run the browser on the projector.
- Tune the auto-show playlist dwell times after seeing it run on the wall.
- Maybe: audio reactivity (mic → flame intensity / cascade triggers).

DONE in the big revamp (2026-07):
- ✔ Bricks look like amber stone (ANIM.arch.amber knobs)
- ✔ Domino waves flip whole rings at once (ANIM.dominoFlip.epicenters)
- ✔ Outer arch replaced with the radiant voussoir corona (ANIM.fireplace.legacy to compare)
- ✔ TD flow: projection mode + Spout/WebRender capture + WebSocket control
- ✔ Optimized & cleaned: vendored deps (offline), shared shader helpers,
    bloom pipeline with legacy escape hatch (Shift+B), verify probes


## 2026-11-16 — THE SHOW is now one story, with seamless changes

Story order (loops): gold → night sky → Depth Portal → Star Dive → strata (R) → shards (T) → hexagons → flowers → fireplace → gold.
Modes 2 (rosette), 8 (classic composite) and W (mercury) are out of the show; they stay on their keys.

- ✔ New morph transitions (`src/show/morph.js`): `fade`, `dissolve`, `iris`, `vortex`, `zoom`, `melt`, `pour`. No blink to black. A snapshot of the old look is warped / dissolved over the new live look by a post pass (after OutputPass, before the warp), masked to the logo hull. Lengths: `ANIM.transitions.morph`; one step: `transitionDur`. Needs `ANIM.post.enabled`; else falls back to `dip`. Mode keys still use `dip`.
- ✔ Star sky (mode 7): open sky first (`firstDelay` 7 s), shooting stars (`ANIM.constellation.meteor`, trigger `stellar.meteor`), the first figure is always the Big Dipper (`firstFigure`, not mirrored).
- ✔ Sky → portal: trigger `stellar.vortex` (cue 6 s before the seam) turns the sky about the star, the stars stretch into streaks and sink in, figures and frame dim. That sky stays live ~4 s into the Depth Portal (`vortex.linger`), under a short 1.6 s fade.
- ✔ Portal rush toned down (`recede.rush.brightMul/starBright/flowBright`): the old rush made a bloom halo over the whole frame.
- ✔ Tests pass: verify-show, verify-pipeline, verify-warp.
- New probes: `.verify/story-probe.mjs` (runs the show with real dwells, pictures at each seam), `.verify/reel-capture.mjs` (frame sequences for video, any size).
- Not done / to check: seen only as still pictures, not in TouchDesigner or on the projector. The frozen snapshot does not move during `dissolve` / `iris` (2.8 s). The post `vortex` style is built but not used (thick ribbons from the gold frame). FPS during a morph in TD not measured.
- Promo videos: `E:\Art\2026\Projects\Logo Projection\FINAL VIDEO\LogoProjection_Promo_Reel_1080x1920.mp4` (19.7 s) and `..._Reel_Long_1080x1920.mp4` (45.8 s). Work files: `/home/sydney/logo-reel`.

## 2026-11-24 — SHAPES: the show on any SVG outline (first shape: the mandala)

Sydney wants to try the laser-cut mandala base as the projection shape, and wants it easy to try other shapes.

- ✔ New surface type: an SVG shape. `index.html?shape=mandala`. Guide: `shapes/README.md`. Page to pick one: `shapes.html` (`start-shapes.bat`).
- ✔ To add a shape: put an SVG in `shapes/`, open `?shape=<name>`. Optional entry in `shapes/shapes.js` (opening, mask, rotate, per-shape `anim` values, looks to `skip`).
- ✔ Code: `src/core/shape.js` (SVG → slab), `src/core/shapeMask.js` (final mask, exact outline; `mask: 'holes'` keeps the small SVG holes dark). `meta.footprint` replaces the hull for the backdrop plate, wipe and morph mask on shapes. Big outlines use a mask texture for the pattern clip (`buildHullClip`). Flat band edge frame on shapes (`robust` in `logoFrame.js`); no gate rim ribbon on shapes.
- ✔ TouchDesigner: new **Shape** control on `/project1/logo` (set to `mandala` now; clear it for the logo). Old project file: `touchdesigner/Backup/LogoProjection.before-shapes.toe`.
- ✔ Shapes in the repo: `mandala`, `mandala-openwork` (holes dark), and two examples (`hexagon`, `arch`).
- ✔ Tests: verify-show, verify-pipeline, verify-warp pass. Logo pictures are the same as before. THE SHOW runs through every seam on the mandala with no error.
- ✔ New keys: `G` = next shape (then the logo), `H` = mask outline / small holes dark / off. In TouchDesigner `G` changes the Shape control.
- New probes: `.verify/verify-shapes.mjs` (asserts: every shape loads, light stays inside, keys, shapes page), `.verify/shape-probe.mjs` (pictures of every look on any shape). `story-probe.mjs` takes `QUERY='shape=...'`. Speed in TouchDesigner on the mandala: 60 fps in every look (1280 x 720).
- Mandala, known weak points: the fire look (5) has a thin flame because the flame lives in the star; its edge stones are off (`fireplace.enabled` false in the mandala entry). The hex wall (3) is dark near the edge (it is lit from the star, and the mandala is wider than the logo). Star Dive (Q): inner copies are a smooth blob, not the mandala outline.
- Not done: nothing is seen on the real object yet. Decision for Sydney: keep the mandala, or try another shape.
