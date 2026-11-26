# Builds the Logo Projection network in TouchDesigner: /project1/logo
#
# Run it (only needed if LogoProjection.toe is missing or stale):
#   Alt+T (Textport), then paste:
#   exec(open(r'C:\Users\root\OneDrive\Documents\GitHub\2026\Logo Projection\touchdesigner\logo_build.py', encoding='utf-8').read())
#   then File > Save As  touchdesigner/LogoProjection.toe
#
# What it builds
#   server   Web Server DAT. Serves the app's files AND is the app's
#            WebSocket control channel, on one port. No start.bat needed.
#   web      Web Render TOP. The app, in projection mode, at Width x Height.
#   pin      Corner Pin TOP. Drag the four corners onto the real surface.
#   out      Null TOP. The picture that goes to the projector.
#   win      Window COMP. Borderless full-screen window on the projector.
#   keys     Keyboard In DAT. Every key press goes to the app.
#   api      Python helpers: op('/project1/logo/api').module.key('6') ...
#   state    What the app last reported (mode, show state).
#
# The .py files next to this one are SYNCED into TouchDesigner: edit one,
# save, and TouchDesigner reloads it. No rebuild needed.

import os

ROOT = globals().get('LOGO_ROOT') or r'C:\Users\root\OneDrive\Documents\GitHub\2026\Logo Projection\touchdesigner'
APP_ROOT = os.path.dirname(ROOT)
PARENT = globals().get('LOGO_PARENT') or '/project1'
# Optional: the MCP bridge that lets Claude see and change this network.
MCP_TOX = globals().get('LOGO_MCP_TOX') or r'C:\Users\root\OneDrive\Documents\GitHub\2026\The Shape of Consciousness\touchdesigner\mcp\mcp_webserver_base.tox'

log = []
def say(s):
    log.append(s)
    print('[logo_build] ' + s)

def setpar(o, name, value):
    p = getattr(o.par, name, None)
    if p is None:
        say('  (no parameter %s on %s)' % (name, o.name))
        return
    try:
        p.val = value
    except Exception as e:
        say('  could not set %s.%s: %s' % (o.name, name, e))

def setexpr(o, name, expr):
    p = getattr(o.par, name, None)
    if p is None:
        say('  (no parameter %s on %s)' % (name, o.name))
        return
    p.expr = expr
    p.mode = ParMode.EXPRESSION

def synced_text(c, name, filename, x, y):
    d = c.create(textDAT, name)
    d.nodeX, d.nodeY = x, y
    setpar(d, 'file', os.path.join(ROOT, filename))
    setpar(d, 'syncfile', True)
    setpar(d, 'language', 'python')
    return d

# Shape names for the Shape menu: the entries of shapes/shapes.js, then any
# other .svg file in the shapes folder.
def shape_names():
    import re
    names = []
    folder = os.path.join(APP_ROOT, 'shapes')
    try:
        txt = open(os.path.join(folder, 'shapes.js'), encoding='utf-8').read()
        # SHAPE_MENU (the shapes in use) wins when it is not empty.
        m = re.search(r"export const SHAPE_MENU\s*=\s*\[(.*?)\]", txt, re.S)
        if m:
            menu = re.findall(r"^\s*'([A-Za-z0-9_-]+)'", m.group(1), re.M)
            if menu:
                return menu
        body = txt.split('export const SHAPES', 1)[1]
        for m in re.finditer(r"^  '?([A-Za-z0-9_-]+)'?\s*:\s*\{", body, re.M):
            if m.group(1) not in names:
                names.append(m.group(1))
        for f in sorted(os.listdir(folder)):
            n, ext = os.path.splitext(f)
            # A file that an entry already uses (file: 'x.svg') is not listed twice.
            if ext.lower() == '.svg' and n not in names and ("'%s'" % f) not in txt:
                names.append(n)
    except Exception as e:
        say('could not list the shapes: %s' % e)
    return names

# The app address. A shape wins over Surface.
URL_EXPR = ("'http://127.0.0.1:%d/%s?proj=1&w=%d&h=%d&ws=127.0.0.1:%d%s' % (me.par.Port, "
            "'fullscreen.html' if (me.par.Surface == 'screen' and not me.par.Shape.eval()) else 'index.html', "
            "me.par.Width, me.par.Height, me.par.Port, "
            "('&shape=' + me.par.Shape.eval()) if me.par.Shape.eval() else '')")

par_root = op(PARENT)
old = par_root.op('logo')
if old is not None:
    old.destroy()
    say('removed the old logo component')

c = par_root.create(baseCOMP, 'logo')
c.nodeX, c.nodeY = 0, 0
c.comment = 'Logo Projection. Select me: my parameters are the controls. F1 = show on the projector.'

# ---- the controls (custom parameters) ----
noncom = bool(licenses.isNonCommercial)
pg = c.appendCustomPage('Logo')
p = pg.appendInt('Width', label='Picture width')[0];  p.default = p.val = 1280 if noncom else 1920
p.normMin, p.normMax = 640, 3840
p = pg.appendInt('Height', label='Picture height')[0]; p.default = p.val = 720 if noncom else 1080
p.normMin, p.normMax = 360, 2160
p = pg.appendMenu('Surface', label='Surface')[0]
p.menuNames = ['logo', 'screen']
p.menuLabels = ['The 3D logo (map it onto the real logo)', 'Full screen (plain wall or screen)']
p.default = p.val = 'logo'
# SVG shape (a file in <app>/shapes). Empty = use Surface above.
# The menu lists the names in shapes/shapes.js plus every other .svg file.
# (No empty menu entry: TouchDesigner refuses an empty menu name. To go
# back to the logo, clear the field.)
p = pg.appendStrMenu('Shape', label='Shape (SVG, empty = none)')[0]
p.default = p.val = 'flower02'   # Compass Lotus, the main design
p.menuNames = shape_names()
p.menuLabels = list(p.menuNames)
p.help = 'SVG shape from the shapes folder. Clear this field to use Surface.'
p = pg.appendToggle('Keyboard', label='Keyboard to app')[0]; p.default = p.val = True
p = pg.appendPulse('Reload', label='Reload the app')[0]
p = pg.appendInt('Monitor', label='Projector monitor number')[0]
p.default = p.val = (len(monitors) - 1)
p.normMin, p.normMax = 0, 3
p = pg.appendPulse('Openwindow', label='Open the projector window')[0]
p = pg.appendPulse('Closewindow', label='Close the projector window')[0]
p = pg.appendInt('Port', label='Port (files + control)')[0]; p.default = p.val = 9980
p = pg.appendFolder('Approot', label='App folder')[0]; p.default = p.val = APP_ROOT.replace('\\', '/')
p = pg.appendStr('Url', label='App address (read only)')[0]
p.expr = URL_EXPR
p.mode = ParMode.EXPRESSION
p.readOnly = True

# ---- scripts (synced to the files next to this one) ----
srv_cb = synced_text(c, 'server_callbacks', 'logo_server.py', -400, 200)
api    = synced_text(c, 'api',              'logo_api.py',    -400, 50)
key_cb = synced_text(c, 'keys_callbacks',   'logo_keys.py',   -400, -100)

state = c.create(textDAT, 'state')
state.nodeX, state.nodeY = -200, -250
state.text = 'waiting for the app'
state.viewer = True

# ---- the server: files + control on one port ----
srv = c.create(webserverDAT, 'server')
srv.nodeX, srv.nodeY = -200, 200
setpar(srv, 'callbacks', srv_cb.name)
setexpr(srv, 'port', 'parent().par.Port')
setpar(srv, 'active', True)

# ---- the app ----
web = c.create(webrenderTOP, 'web')
web.nodeX, web.nodeY = 0, 0
setexpr(web, 'url', 'parent().par.Url')
setpar(web, 'outputresolution', 'custom')
setexpr(web, 'resolutionw', 'parent().par.Width')
setexpr(web, 'resolutionh', 'parent().par.Height')
setpar(web, 'audio', False)
setpar(web, 'maxrenderrate', 60)
setpar(web, 'alwayscook', True)
setpar(web, 'active', True)        # off by default on a new Web Render TOP

# ---- mapping: four corners ----
pin = c.create(cornerpinTOP, 'pin')
pin.nodeX, pin.nodeY = 200, 0
pin.inputConnectors[0].connect(web)
pin.comment = 'Pin page: move the four corners until the picture sits on the real surface.'

out = c.create(nullTOP, 'out')
out.nodeX, out.nodeY = 400, 0
out.inputConnectors[0].connect(pin)
out.viewer = True
out.display = True

# ---- keyboard ----
keys = c.create(keyboardinDAT, 'keys')
keys.nodeX, keys.nodeY = -200, -100
setpar(keys, 'callbacks', key_cb.name)
setpar(keys, 'webcodes', True)
setpar(keys, 'active', True)

# ---- the projector window ----
win = c.create(windowCOMP, 'win')
win.nodeX, win.nodeY = 600, 0
setpar(win, 'winop', out.path)
setpar(win, 'title', 'Logo Projection')
setexpr(win, 'display', 'parent().par.Monitor')
setpar(win, 'borders', False)
setpar(win, 'cursorvisible', False)
setpar(win, 'closeescape', True)
try:
    win.par.size = 'fill'
except Exception:
    pass
try:
    win.par.dpiscaling = 'native'
except Exception:
    pass
try:
    op('/perform').par.winop = win.path     # F1 = perform mode shows the piece
    say('F1 (perform mode) opens the projector window')
except Exception as e:
    say('could not point /perform at the window: %s' % e)

# ---- buttons ----
pe = c.create(parameterexecuteDAT, 'buttons')
pe.nodeX, pe.nodeY = -200, 50
setpar(pe, 'op', '..')
setpar(pe, 'pars', 'Reload Openwindow Closewindow')
setpar(pe, 'onpulse', True)
setpar(pe, 'active', True)
pe.text = '''def onPulse(par):
    c = parent()
    if par.name == 'Reload':
        c.op('web').par.reload.pulse()
    elif par.name == 'Openwindow':
        c.op('win').par.winopen.pulse()
    elif par.name == 'Closewindow':
        c.op('win').par.winclose.pulse()
    return
'''

try:
    project.cookRate = 60
    project.realTime = True
except Exception as e:
    say('could not set 60 fps: %s' % e)

if noncom:
    say('NON-COMMERCIAL licence: TouchDesigner caps every picture at 1280 x 1280, '
        'so the picture is 1280 x 720. A Commercial licence lifts this (then set 1920 x 1080).')

# ---- optional: the MCP bridge, so Claude can look at and change this network ----
if os.path.exists(MCP_TOX) and par_root.op('mcp_webserver_base') is None:
    try:
        import sys
        mroot = os.path.dirname(MCP_TOX)
        for pth in (os.path.join(mroot, 'modules', 'td_server'), os.path.join(mroot, 'modules')):
            if pth not in sys.path:
                sys.path.insert(0, pth)
        m = par_root.loadTox(MCP_TOX)
        m.nodeX, m.nodeY = 0, 300
        m.par.externaltox = MCP_TOX
        try:
            m.par.Restart.pulse()
        except Exception:
            pass
        say('loaded the MCP bridge: ' + m.path)
    except Exception as e:
        say('MCP bridge not loaded: %s' % e)

say('built ' + c.path + '  ->  ' + c.par.Url.eval())
