# Shapes

The show can draw on any outline, not only the 3D logo.
A shape is one SVG file in this folder.

## See a shape

- Easy way: run `start-shapes.bat`. Click a shape.
- Direct way: open `index.html?shape=mandala`.
- For the projector: `index.html?shape=mandala&proj=1&w=1920&h=1080`.
- In TouchDesigner: select `/project1/logo`. Set **Shape** to the name. Clear it to go back to the logo.

All keys work the same as with the logo (`0` = the show, `1`–`8`, `Q` `W` `R` `T`, `9` = calibration).

Two more keys:

| Key | What it does |
|---|---|
| `G` | Next shape. After the last shape, the logo. |
| `H` | Mask: outline, then small holes dark, then off. |

## Add a shape (3 steps)

1. Put the SVG in this folder. Example: `shapes/my-shape.svg`.
2. Open `index.html?shape=my-shape`.
3. Optional. Add an entry in `shapes/shapes.js` to tune it and to show it on the shapes page:

```js
'my-shape': {
  file: 'my-shape.svg',
  label: 'My shape',
},
```

That is all. No other file changes.

## Rules for the SVG

- The **biggest closed path** is the outline.
- Smaller paths **inside** it are holes.
- Paths outside the outline are ignored. One shape = one piece.
- Lines, curves, `rect`, `circle`, `ellipse` and `polygon` all work.
- Stroke or fill does not matter. Only the path geometry is used.
- Size and units do not matter. The shape is scaled to fit.
- Text must be converted to paths first.

## The opening in the middle

The looks need an opening: the fire burns in it, the portal falls into it.

| `hole` | What you get |
|---|---|
| `'star'` | A four-point star is cut for you. This is the default. |
| `'svg'` | The biggest hole that is drawn in the SVG is the opening. |
| `'none'` | No opening. |

Star knobs: `holeWidth`, `holeHeight` (size), `holeX`, `holeY` (place), `holeScale` (one number for size).
If the star does not fit inside the outline, it shrinks until it fits.

## The mask (where light is allowed)

| `mask` | What you get |
|---|---|
| `'outline'` | Light only inside the exact outline. This is the default. |
| `'holes'` | The same, and the small holes of the SVG stay dark. Use this for a laser-cut piece with openwork. |
| `'off'` | No mask. |

The mask uses the exact SVG outline, so the edge of the light is the edge of the real object.

## All options

They are in `shapes/shapes.js` (`SHAPE_DEFAULTS`), each with a comment.

| Option | Use |
|---|---|
| `file`, `label` | File name. Name on the shapes page. |
| `hole`, `holeWidth`, `holeHeight`, `holeX`, `holeY`, `holeScale` | The opening. |
| `rotate`, `flipX`, `scale` | Turn, mirror, size. |
| `mask`, `maskFeather` | The mask. `maskFeather` gives a soft edge. |
| `maxPoints`, `curveSegments` | Detail of the outline that the looks follow. |
| `anim` | Values of `ANIM` (in `src/config.js`) for this shape only. |
| `skip` | Looks to leave out of THE SHOW on this shape. |

Try an option without an edit: add it to the address.
Example: `index.html?shape=mandala&hole=none&mask=holes&rotate=15`.

Change the mask while the show runs (browser console):
`__shapeMask.setMode('holes')`, `'outline'`, `'off'`.

## Line it up on the real object

Press `9`, then `C` for the patterns. "fill" and "outline" show the exact SVG outline and its real holes.
Move the four corners (TouchDesigner `pin`, or key `M` in the browser) until the white shape sits on the object.

## The shapes in this folder

| Name | File | Note |
|---|---|---|
| `mandala` | `mandala.svg` | Laser-cut mandala base, layer 0. 764.5 x 746.7 mm. |
| `mandala-openwork` | `mandala.svg` | Same file. The 198 small holes stay dark. |
| `hexagon` | `example-hexagon.svg` | Example. Safe to delete. |
| `arch` | `example-arch.svg` | Example with curves and its own hole. Safe to delete. |

The mandala SVG is a copy of
`E:\Art\2026\Projects\LASER CUTTER\Mandala\Cut Files\Openwork (with holes)\layer0_base_outline.svg`.

## Test a shape (pictures of every look)

```
python3 -m http.server 5501            (in the repo root)
QUERY='shape=mandala' OUT=my-test node .verify/shape-probe.mjs
node .verify/sheet.mjs my-test "" 4
```

The pictures go to `.verify/shots/my-test/`. `_sheet.png` is all of them on one page.

## How it works (for code changes)

- `src/core/shape.js` reads the SVG and builds a slab with that outline. The slab goes through the same code as the logo.
- The looks follow a simplified outline (at most `maxPoints` points). `src/core/shapeMask.js` trims the final picture to the exact outline.
- `src/core/logo.js` sets `meta.isShapeSurface`, `meta.shape` and `meta.footprint`.
- Outlines with many points use a mask texture for the pattern clip (`buildHullClip` in `src/effects/_shared/shaderPatches.js`).
- The edge frame uses a flat band on shapes (`robust` in `src/effects/_shared/logoFrame.js`), because spikes break the normal frame.
