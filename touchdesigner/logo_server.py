# Web Server DAT callbacks for the Logo Projection TouchDesigner project.
#
# ONE port does two jobs:
#   1. HTTP  - serves the app's own files (index.html, src/, vendor/ ...)
#              straight from the project folder, so no start.bat / python
#              server is needed. The Web Render TOP loads the app from here.
#   2. WebSocket - the app connects back (the ?ws= part of the URL). Keys
#              and control messages go out; the app's state comes back.
#
# This file is SYNCED into TouchDesigner: edit, save, TD reloads it.

import json
import os
from urllib.parse import unquote

TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'text/javascript; charset=utf-8',
    '.mjs':  'text/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.glb':  'model/gltf-binary',
    '.wasm': 'application/wasm',
    '.ico':  'image/x-icon',
}


def _root():
    return os.path.realpath(parent().par.Approot.eval())


def onHTTPRequest(webServerDAT, request, response):
    uri = unquote(request.get('uri', '/').split('?')[0])
    if uri == '/__report':
        # Diagnostics: the page can report numbers back, e.g. a measured
        # frame rate: fetch('/__report?fps=59.8'). Read it with
        # op('/project1/logo').fetch('report').
        rep = dict(parent().fetch('report', {}))      # keep earlier numbers (several pages can report)
        rep.update(dict(request.get('pars', {})))
        parent().store('report', rep)
        response['statusCode'] = 200
        response['statusReason'] = 'OK'
        response['data'] = 'ok'
        return response
    if uri in ('', '/'):
        uri = '/index.html'
    root = _root()
    path = os.path.realpath(os.path.join(root, uri.lstrip('/')))
    # Never serve anything outside the app folder.
    if not (path == root or path.startswith(root + os.sep)) or not os.path.isfile(path):
        response['statusCode'] = 404
        response['statusReason'] = 'Not Found'
        response['data'] = 'not found: ' + uri
        return response
    with open(path, 'rb') as f:
        data = f.read()
    ext = os.path.splitext(path)[1].lower()
    response['statusCode'] = 200
    response['statusReason'] = 'OK'
    response['content-type'] = TYPES.get(ext, 'application/octet-stream')
    response['cache-control'] = 'no-cache'
    response['data'] = data
    return response


def onWebSocketOpen(webServerDAT, client, uri):
    parent().store('ws_clients', list(set(parent().fetch('ws_clients', []) + [client])))
    op('state').text = 'app connected'
    lay = op('layers')
    if lay is not None:                     # a new page: start from one visual
        lay.module.on_message({'action': 'hello'})
    return


def onWebSocketClose(webServerDAT, client):
    parent().store('ws_clients', [c for c in parent().fetch('ws_clients', []) if c != client])
    return


def onWebSocketReceiveText(webServerDAT, client, data):
    # The app pushes {type:'state', mode, show, ...} after every change.
    try:
        msg = json.loads(data)
    except Exception:
        return
    if msg.get('type') == 'state':
        show = msg.get('show') or {}
        op('state').text = 'mode: %s\nshow: %s\ncalibration: %s' % (
            msg.get('mode'), 'playing' if show.get('playing') else 'paused',
            msg.get('calibration'))
        parent().store('app_state', msg)
    # LAYERS: the story page says when the wood layers change (logo_layers.py).
    if msg.get('type') == 'event' and msg.get('name') == 'layers':
        lay = op('layers')
        if lay is not None:
            lay.module.on_message(msg)
    return


def onWebSocketReceiveBinary(webServerDAT, client, data):
    return


def onWebSocketReceivePing(webServerDAT, client, data):
    webServerDAT.webSocketSendPong(client, data=data)
    return


def onWebSocketReceivePong(webServerDAT, client, data):
    return


def onServerStart(webServerDAT):
    parent().store('ws_clients', [])
    return


def onServerStop(webServerDAT):
    parent().store('ws_clients', [])
    return
