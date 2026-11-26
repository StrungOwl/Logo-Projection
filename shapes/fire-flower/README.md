# Fire-flower mock-ups

Ten ideas for the new laser-cut piece. Round 2, made on 2026-11-24.
Round 1 (`ff01`-`ff10`) was not liked and is deleted. Only its option 4 outline was kept, as `compass()`.
Open `mockups.html` to see them.

| File | What it is |
|---|---|
| `mockups.html` | The page with all ten options. |
| `bloomNN.svg` | Projection shape: the outline and the fire-flower opening. |
| `bloomNN-layers.svg` | The wood pieces, stacked (picture only, not a cut file). |
| `make_fire_flowers.py` | Draws all of the above. Each option is one small function (`d_...`) in `DESIGNS`. |
| `options.json` | Names, sizes and ring edges for the page. |
| `mockups/` | Pictures of the show on each shape. |

See an option with the full show: `index.html?shape=bloom05`, or type `bloom05` in **Shape** in TouchDesigner.

These are sketches. They are NOT cut files: no kerf, no real size, no tabs.

## Make them again

```
/home/sydney/logo-shapes/venv/bin/python shapes/fire-flower/make_fire_flowers.py
python3 -m http.server 5501            (in the repo root)
for n in 01 02 03 04 05 06 07 08 09 10; do QUERY="shape=bloom$n" OUT="ff/bloom$n" MODES=moltenGold,strata,shards,starDive,flowers,fireplaceOne,hexagons,flameOnly TIMES=2,20 node .verify/shape-probe.mjs; done
node .verify/ff-mockups.mjs
```

The Python needs `shapely` and `numpy` (the venv in `/home/sydney/logo-shapes/venv` has them).

## How a design is made

- Every design is a mirror pattern. One slice is drawn, mirrored, and copied around the centre.
- `flame()` = one flame petal: a spine that can bend (the wind) and a width that ends in a point.
- `lace()` = only the edge of a petal stays. The middle is a window, so the layer below shows. Options: a centre vein, a smaller petal inside, side veins.
- `compass()` = the outline that was liked (old option 4): spikes with buds, and flame tongues between them.
- `fireflower()` = the opening in the middle.
- `piece()` = one wood piece. `tidy()` removes slits, slivers and tiny holes.
- The base is solid (it is the screen). The rings on top are lace. The top ring has the fire-flower opening; the ring below has a smaller, turned opening, so a second row of petals shows.

## The page

- "One visual on the whole piece" = real frames of the show on that shape.
- "A different visual on each wood layer" = a quick mock-up. The page cuts frames of different looks to the shape of each wood piece. The show cannot do this yet.

## Round 3: designs from the hand drawings (`ink01`-`ink10`)

Page: `mockups-round3.html`. Sydney's four drawings are in `drawings/`.

- `inklib.py` reads a drawing as ink and makes the kaleidoscope (a wedge of the drawing, mirrored and copied 8, 12 or 16 times).
- `make_ink_flowers.py` turns the ink into wood. One entry in `DESIGNS` = which drawing, how many mirrors, which wedge (`th0`), the scale, and the radius band.
  - Base: all strokes, filled. Its edge follows the tips of the outer strokes (`hug()`: a smooth body that stays inside the tips, plus the strokes). Its strokes are engraved.
  - `gear=(teeth of base, plate 1, plate 2)` in a design makes gears in place of stroke edges.
  - Plates: the strokes inside a radius, filled. Their strokes are cut out (windows). Loose islands get a small bridge.
  - Opening: the middle strokes when they make a star. If they make only a circle, a flame flower is drawn.
- Look at the ink only (fast): `make_ink_flowers.py --preview` writes `_ink-preview.png`. Red circles = plate edges, green = opening.

```
cd shapes/fire-flower && /home/sydney/logo-shapes/venv/bin/python make_ink_flowers.py
for n in 01 02 03 04 05 06 07 08 09 10; do QUERY="shape=ink$n" OUT="ff/ink$n" MODES=moltenGold,strata,shards,starDive,flowers,fireplaceOne,hexagons,flameOnly TIMES=2,20 node .verify/shape-probe.mjs; done
ROUND=3 node .verify/ff-mockups.mjs
```

The venv also needs `opencv-python-headless`.

## The precise set: 5 flowers, 5 gears, 5 fires (`flower01`-`05`, `gear01`-`05`, `fire01`-`05`)

Page: `mockups-fg.html`. This is the set to continue from (2026-11-24).
Nothing is traced from a picture. Every curve is exact geometry, so the lines are clean.

- `fg.py` = the drawing tools. `make_fg.py` = the designs (`FLOWERS`, `GEARS`, `FLAMES`).
- A design is drawn in "round space" (radius 1). Mirror + rotation gives exact symmetry. A smooth `pull()` moves the centre lines into the final outline (flame, wings, comet ...). Line widths are added after that, in millimetres, so a line keeps its exact width everywhere.
- 5 layers: base plate, plate + dark raised line layer ("lace"), plate + lace. Thin lines are engraved.
- Flowers: `row()` = one row of petals (`frame='lace'` or `'engrave'`, `echo` = fine lines inside, `barbs` = small flames on the petal edge), `hooks()`, `bud()`.
- Gears: `gear(pitch line, teeth, tooth='spur'|'flame'|'escape')` puts exact teeth on ANY closed line (spiral, oval, lobes, cam). `ring_gear()`, `spokes()`, `wheel()`, `hub()`.
- Fire: `fan()` = flame tongues from an oval ember bed, `skirt()` = small curled flames on the bottom edge, `flame_core()` = the opening.

```
cd shapes/fire-flower && /home/sydney/logo-shapes/venv/bin/python make_fg.py [id ...]
for n in flower01 ... fire05; do QUERY="shape=$n" OUT="ff/$n" MODES=moltenGold,strata,shards,starDive,flowers,fireplaceOne,hexagons,flameOnly TIMES=2,20 node .verify/shape-probe.mjs; done
ROUND=fg node .verify/ff-mockups.mjs
META=fg-options.json PX=1200 COLS=1 node .verify/ff-wood.mjs gear03      (one big wood picture, no server)
```
