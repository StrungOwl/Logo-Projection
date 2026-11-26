# Send control messages to the Logo Projection app.
#   op('/project1/logo/api').module.send({'type': 'key', 'key': '6'})
#   op('/project1/logo/api').module.key('space')
#   op('/project1/logo/api').module.mode('fireplaceTwo')
# Message shapes: header of src/core/control.js.
#
# Route: the app's WebSocket when it is connected; otherwise JavaScript
# straight into the Web Render TOP (window.__control), so control still
# works if the socket is down.

import json


def send(obj):
    comp = parent()
    srv = comp.op('server')
    txt = json.dumps(obj)
    clients = comp.fetch('ws_clients', [])
    sent = False
    for c in list(clients):
        try:
            srv.webSocketSendText(c, txt)
            sent = True
        except Exception:
            pass
    if not sent:
        comp.op('web').executeJavaScript('window.__control && window.__control(%s)' % txt)


def key(name, shift=False):
    send({'type': 'key', 'key': name, 'shift': bool(shift)})


def mode(name, style='dip'):
    send({'type': 'mode', 'value': name, 'style': style})


def trigger(name):
    send({'type': 'trigger', 'name': name})


def param(path, value):
    send({'type': 'param', 'path': path, 'value': value})
