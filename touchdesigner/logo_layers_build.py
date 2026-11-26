# Adds the LAYERS network to /project1/logo (a different visual on each
# wood layer). Run it once in an open LogoProjection.toe:
#
#   exec(open(project.folder + '/logo_layers_build.py').read())
#
# It is safe to run it again. What it makes, inside /project1/logo:
#   web2, web3     two more copies of the show (the accents)
#   zonesA, zonesB the wood-layer pictures  (shapes/zones/*.png)
#   mix_glsl, mix  the shader that puts the three copies together
#   layers         the fades (file: logo_layers.py)
#   layers_exec    runs layers.update() every frame
# and the 'Layers' switch on the component. pin now reads from mix.
import os

c = op('/project1/logo')
folder = project.folder.replace('\\', '/')
web, pin = c.op('web'), c.op('pin')

for old in ('mixtest',):
    if c.op(old) is not None:
        c.op(old).destroy()

# ---- the switch ------------------------------------------------------------
page = [p for p in c.customPages if p.name == 'Logo'][0]
if not hasattr(c.par, 'Layers'):
    p = page.appendToggle('Layers', label='Layers (a visual on each wood layer)')[0]
    p.default = True
    p.val = True
c.par.Layers.help = ('On: at times the upper wood layers change to other visuals. '
                     'Off: one visual on the whole piece. Needs a Shape with layer pictures (shapes/zones).')
if hasattr(c.par, 'Stats'):
    c.par.Stats.destroy()
c.par.Url.expr = ("'http://127.0.0.1:%d/%s?proj=1&w=%d&h=%d&ws=127.0.0.1:%d%s%s' % (me.par.Port, "
                  "'fullscreen.html' if (me.par.Surface == 'screen' and not me.par.Shape.eval()) else 'index.html', "
                  "me.par.Width, me.par.Height, me.par.Port, "
                  "('&shape=' + me.par.Shape.eval()) if me.par.Shape.eval() else '', "
                  "'&layers=1' if (me.par.Layers and me.par.Shape.eval()) else '')")
order = ['Width', 'Height', 'Surface', 'Shape', 'Layers', 'Keyboard', 'Reload', 'Monitor', 'Openwindow', 'Closewindow', 'Port', 'Approot', 'Url']
page.sort(*[n for n in order if hasattr(c.par, n)])

# ---- the two accent pages ---------------------------------------------------
for i in (1, 2):
    name = 'web%d' % (i + 1)
    w = c.op(name)
    if w is None:
        w = c.copy(web, name=name)
    w.nodeX, w.nodeY = web.nodeX, web.nodeY - 150 * i
    w.par.url.expr = ("('http://127.0.0.1:%d/index.html?proj=1&w=%d&h=%d&shape=%s&slot=" + str(i) + "' % "
                      "(parent().par.Port, parent().par.Width, parent().par.Height, parent().par.Shape.eval())) "
                      "if (parent().par.Layers and parent().par.Shape.eval()) else 'about:blank'")
    w.par.url.mode = ParMode.EXPRESSION
    w.par.active = True

# ---- the wood-layer pictures --------------------------------------------------
for k, letter in enumerate('AB'):
    name = 'zones' + letter
    z = c.op(name)
    if z is None:
        z = c.create(moviefileinTOP, name)
    z.nodeX, z.nodeY = web.nodeX, web.nodeY - 150 * (3 + k)
    z.par.file.expr = ("(lambda f, none: f if __import__('os').path.isfile(f) else none)("
                       "'%s/shapes/zones/%s." + letter + ".%dx%d.png' % (parent().par.Approot.eval().replace('\\\\', '/'), parent().par.Shape.eval(), parent().par.Width, parent().par.Height), "
                       "parent().par.Approot.eval().replace('\\\\', '/') + '/shapes/zones/none.png')")
    z.par.file.mode = ParMode.EXPRESSION

# ---- the shader ---------------------------------------------------------------
g = c.op('mix_glsl')
if g is None:
    g = c.create(textDAT, 'mix_glsl')
g.nodeX, g.nodeY = web.nodeX + 200, web.nodeY - 300
g.par.file = folder + '/logo_layers.glsl'
g.par.syncfile = True
m = c.op('mix')
if m is None:
    m = c.create(glslTOP, 'mix')
m.nodeX, m.nodeY = web.nodeX + 200, web.nodeY - 150
m.par.pixeldat = 'mix_glsl'
m.setInputs([c.op('web'), c.op('web2'), c.op('web3'), c.op('zonesA'), c.op('zonesB')])
m.par.outputresolution = 'useinput'
try:
    m.seq.vec.numBlocks = 6
except Exception:
    m.par.vec.sequence.numBlocks = 6
for i, name in enumerate(['uW0', 'uW1', 'uW2', 'uW3', 'uW4', 'uMisc']):
    setattr(m.par, 'vec%dname' % i, name)
    setattr(m.par, 'vec%dvaluex' % i, 1.0)
    setattr(m.par, 'vec%dvaluey' % i, 0.0)
    setattr(m.par, 'vec%dvaluez' % i, 0.0)
pin.setInputs([m])

# ---- the fades ------------------------------------------------------------------
lay = c.op('layers')
if lay is None:
    lay = c.create(textDAT, 'layers')
lay.nodeX, lay.nodeY = web.nodeX + 400, web.nodeY - 300
lay.par.file = folder + '/logo_layers.py'
lay.par.syncfile = True
ex = c.op('layers_exec')
if ex is None:
    ex = c.create(executeDAT, 'layers_exec')
ex.nodeX, ex.nodeY = web.nodeX + 400, web.nodeY - 420
ex.text = ("# Runs the layer fades every frame (see the Text DAT 'layers').\n"
           "def onFrameStart(frame):\n"
           "    lay = op('layers')\n"
           "    if lay is not None:\n"
           "        lay.module.update()\n"
           "    return\n")
ex.par.framestart = True
ex.par.active = True
print('layers network ready')
