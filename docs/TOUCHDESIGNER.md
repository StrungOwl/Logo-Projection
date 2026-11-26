# TouchDesigner Guide

Run the Logo Projection show inside TouchDesigner, send it to the projector,
and keep every keyboard control.

## Quick start

1. Open `touchdesigner/LogoProjection.toe`.
2. Wait about 10 seconds. The show starts by itself.
3. Press `F1`. The picture goes full-screen on the projector monitor. `Esc` comes back.
4. Press the same keys as in the browser (`0`–`9`, `Q` `W` `R` `T`, `X`, `Space`, `F`, `D`, `P`, `S`, `N`, `C`, `K`, `B` …).
   The full list is in the README, or press `I` in a browser window.

No `start.bat`, no OBS, no internet. TouchDesigner serves the app's files itself.

## Licence limit (read this)

A **Non-Commercial** TouchDesigner licence caps every picture at **1280 × 1280**.
The project then runs at **1280 × 720**. On a 1080p projector that is a little soft.

- Commercial / Educational licence: select `/project1/logo`, set Picture width `1920`, height `1080`.
- No licence and you need full sharpness: do not use TouchDesigner. Run `start.bat` or
  `start-fullscreen.bat`, put Chrome on the projector, press `F11`. All keys work there, and
  `M` gives the built-in four-corner warp.

## What is inside `/project1/logo`

| Node | Job |
|---|---|
| `server` | Web Server DAT. Serves the app files **and** is the control channel (WebSocket). One port: 9980. |
| `web` | Web Render TOP. The app, in projection mode, at Width × Height. |
| `pin` | Corner Pin TOP. Move the four corners onto the real surface. |
| `out` | The picture that goes to the projector. |
| `win` | Window COMP. Borderless window on the projector (`F1`). |
| `keys` | Keyboard In DAT. Sends every key press to the app. |
| `api` | Python helpers (below). |
| `state` | What the app last reported: mode, show playing or paused. |

Controls (select `/project1/logo`, page **Logo**):

| Control | What it does |
|---|---|
| Picture width / height | Render size. Match the projector (subject to the licence limit). |
| Surface | The 3D logo, or the full-screen version for a plain wall. |
| Shape | An SVG shape from the `shapes` folder (for example `mandala`). It wins over Surface. Clear the field to go back. Guide: `shapes/README.md`. |
| Keyboard to app | On: keys drive the show. Turn off while you type in TouchDesigner. |
| Reload the app | Reloads the page (after you edit the code). |
| Projector monitor number | Which monitor the window opens on (0 = first). |
| Open / Close the projector window | Same as `F1` / `Esc`. |

## Keyboard

The Keyboard In DAT sends each key as `{"type":"key","key":"Digit6","shift":false}`.
The app runs its normal key handler, so the key map is the same as in the browser and
there is nothing to wire per key. `Ctrl` / `Alt` combos and `F1`–`F12` stay with TouchDesigner.

Keys only arrive while a TouchDesigner window has focus.

## Control from Python

```python
api = op('/project1/logo/api').module
api.key('6')                    # same as pressing 6
api.key('space')                # portal rush / cascade
api.mode('fireplaceTwo')        # switch mode with a dip to black
api.trigger('portal.flow')      # any trigger name
api.param('recede.flow.count', 1100)   # tune a knob live (ANIM.* path)
api.send({'type': 'show', 'action': 'play'})   # any raw message
```

Message shapes: header of `src/core/control.js`. Trigger names arrive in every `state`
message; highlights: `cascade.now`, `arch.cascade`, `fractal.zoom`, `domino.toggle`,
`stellar.pulse`, `stellar.meteor`, `stellar.vortex`, `edge.burst`, `molten.fill/drain/surge`, `portal.rush`, `portal.flow`,
`dive.rush`, `dive.reverse`, `look.pulse`.

## Mapping onto the real surface

1. Press `9` (calibration), then `C` to cycle patterns: fill → outline → grid → checker → corners.
2. Select `pin`. On its **Pin** page move the four corners until the white shape sits on the real logo.
3. Press `0` to start the show.

For a curved or complex surface use Kantan Mapper or Stoner from the Palette: feed it `web`
instead of `pin`.

## Rebuild the project file

Only if `LogoProjection.toe` is missing or broken. New TouchDesigner project, `Alt+T`, paste:

```
exec(open(r'C:\Users\root\OneDrive\Documents\GitHub\2026\Logo Projection\touchdesigner\logo_build.py', encoding='utf-8').read())
```

Then File → Save As `touchdesigner/LogoProjection.toe`.

The scripts `logo_server.py`, `logo_api.py`, `logo_keys.py` are synced into TouchDesigner:
edit and save a file and TouchDesigner reloads it.

## Other capture path: OBS → Spout

Still works if you prefer it. Run `start.bat`, add an OBS Browser source at
`http://127.0.0.1:5501/index.html?proj=1&w=1920&h=1080`, enable Spout output, and read it with
a Syphon Spout In TOP. The licence limit applies to that TOP too.
