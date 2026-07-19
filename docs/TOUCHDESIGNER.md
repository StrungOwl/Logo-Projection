# TouchDesigner Integration Guide

How to get the Logo Projection app into TouchDesigner at full resolution,
map it onto the physical A-logo surface, and control it from TD.

Requires a **TouchDesigner Commercial/Educational/Pro license** — the free
Non-Commercial edition caps every TOP at 1280×1280, which downscales any
capture no matter how it arrives.

There are two capture paths (pick one) plus one control channel (works with
both). The app also has a built-in corner-pin warp (`W` key) if you ever
want to skip TD entirely — see README.

---

## 1. Capture path A — OBS → Spout (recommended)

GPU texture sharing, near-zero latency, no browser inside TD.

1. Install [OBS Studio](https://obsproject.com/) and the
   [OBS-Spout2 plugin](https://github.com/Off-World-Live/obs-spout2-plugin).
2. In OBS: add a **Browser** source →
   - URL: `http://127.0.0.1:5501/index.html?proj=1&w=1920&h=1080&ws=127.0.0.1:9980`
   - Width/Height: `1920 × 1080` (or your projector's native res — also
     update `w`/`h` in the URL to match; the app renders at exactly that
     internal resolution).
3. OBS → Tools → **Spout Output Settings** → enable Spout output.
4. TouchDesigner: add a **Spout In TOP** (Syphon Spout In) → select the OBS
   sender. Full-res frames arrive on the GPU.

Start the app server first (`start.bat` in the project root serves port 5501).

## 2. Capture path B — Web Render TOP (no OBS)

Simplest wiring; TD runs a Chromium instance internally.

1. Add a **Web Render TOP**.
2. URL: `http://127.0.0.1:5501/index.html?proj=1&w=1920&h=1080&ws=127.0.0.1:9980`
3. Set the TOP resolution to the same `w × h`.
4. Note: the keyboard does not reach a Web Render TOP — ALL control goes
   through the WebSocket channel (below), which is why `?ws=` is in the URL.
   If the TOP renders black, its Chromium build may be too old for
   importmaps/WebGL2 — fall back to path A.

## 3. Control channel — WebSocket DAT

The app is the WebSocket **client**; TD is the **server**. With `?ws=HOST:PORT`
in the URL the app connects (and reconnects forever, so start order doesn't
matter).

1. Add a **WebSocket DAT** → set *Network Type* to **Server**, port `9980`
   (any port works; keep it in sync with the `?ws=` URL param).
2. Send JSON text messages to drive the app. From any DAT/script:

```python
import json
ws = op('websocket1')

def send(obj):
    ws.sendText(json.dumps(obj))

send({ "type": "mode",    "value": "fireplaceOne", "style": "dip" })
send({ "type": "trigger", "name": "cascade.now" })
send({ "type": "trigger", "name": "domino.toggle" })
send({ "type": "param",   "path": "flame.light.intensityMax", "value": 4.5 })
send({ "type": "show",    "action": "play" })          # auto-show sequencer
send({ "type": "calibration", "pattern": "grid" })     # alignment patterns
```

3. The app pushes state back — parse it in the WebSocket DAT callbacks:

```python
# websocket1_callbacks
import json

def onReceiveText(dat, rowIndex, message):
    msg = json.loads(message)
    if msg.get('type') == 'state':
        # msg['mode'], msg['show'], msg['triggers'] (full trigger list), ...
        op('current_mode_text').par.text = msg['mode']
    elif msg.get('type') == 'event':
        # e.g. name == 'trigger:cascade.now' — sync TD-side visuals to beats
        pass
    return
```

Full message reference: header comment in `src/core/control.js`.

### Message cheat sheet

| Goal | Message |
|---|---|
| Switch mode with dip-to-black | `{"type":"mode","value":"moltenGold","style":"dip"}` |
| Hard cut | `{"type":"mode","value":"hexagons","style":"cut"}` |
| Fire any trigger | `{"type":"trigger","name":"molten.surge"}` |
| Tune a knob live | `{"type":"param","path":"post.bloom.strength","value":0.6}` |
| Start / stop the auto-show | `{"type":"show","action":"play"}` / `"pause"` |
| Jump to a playlist step | `{"type":"show","action":"goto","target":"fireplaceOne"}` |
| Calibration patterns | `{"type":"calibration","pattern":"fill|outline|grid|checker|corners|off"}` |

## 4. Mapping the surface (Kantan Mapper)

1. Send `{"type":"calibration","pattern":"fill"}` then
   `{"type":"mode","value":"calibration"}` (or press `9` in a normal browser
   window): the app renders a pure-white silhouette of the logo.
2. In Kantan Mapper, create a shape for the physical surface and drag its
   points until the white silhouette lands exactly on the physical A.
   Use `outline` to fine-check edges, `grid` / `checker` to judge focus and
   keystone, `corners` to confirm nothing is cropped.
3. Feed the Spout In / Web Render TOP through your Kantan mapping, switch
   the calibration pattern to `off`, and start the show:
   `{"type":"show","action":"play"}`.

## 5. Useful trigger names

The definitive list arrives in every `state` message (`triggers` array).
Highlights: `cascade.now`, `arch.cascade`, `fractal.zoom`, `domino.on/off/toggle`,
`stellar.pulse`, `edge.burst`, `molten.fill/drain/surge`, `portal.rush`,
`show.*` via the `show` message type.
