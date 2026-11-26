# LAYERS - a different visual on each wood layer.
#
# TouchDesigner shows three copies of the show:
#   web   the STORY   (THE SHOW as always: keys, control, transitions)
#   web2  ACCENT 1    (one look)
#   web3  ACCENT 2    (one more look)
# The GLSL TOP 'mix' puts them together, one per wood layer. The layer
# pictures are shapes/zones/<shape>.A/B.<w>x<h>.png (made by
# .verify/make-zones.mjs).
#
# The story page decides WHEN (src/layers/planner.js). It sends short
# messages: warm, mix, unite. This file does the fades and tells the two
# accent pages which look to show.
#
# This file is SYNCED into TouchDesigner (Text DAT 'layers'): edit, save,
# TD reloads it.

ZONES = 5        # wood layers, bottom to top: base, plate, lines, plate, lines
ACCENTS = ('web2', 'web3')


def _one(slot):
    return [1.0 if slot == i else 0.0 for i in range(3)]


S = {
    'fades': [{'a': _one(0), 'b': _one(0), 't0': 0.0, 'dur': 0.001} for _ in range(ZONES)],
    'w': [_one(0) for _ in range(ZONES)],
    'lines': 1.0,
    'park_at': None,       # time to stop the accent pages (after a mix)
    'mixed': False,
    'modes': [],
}


def _now():
    return absTime.seconds


def _js(name, code):
    w = parent().op(name)
    if w is not None:
        try:
            w.executeJavaScript('try{%s}catch(e){}' % code)
        except Exception:
            pass


def _fade(z, slot, delay, dur):
    S['fades'][z] = {'a': list(S['w'][z]), 'b': _one(slot), 't0': _now() + delay, 'dur': max(dur, 0.001)}


def warm(modes):
    """Start the accent pages on their looks (they are not visible yet)."""
    S['modes'] = list(modes)
    for i, name in enumerate(ACCENTS):
        mode = modes[i] if i < len(modes) else 'moltenGold'
        _js(name, "window.__ctx.paused=false;window.__sequencer.pause();window.__transitions.requestMode('%s','cut');" % mode)
    S['park_at'] = None


def park():
    """Stop the accent pages (they are not visible). Saves the graphics card."""
    for name in ACCENTS:
        _js(name, 'window.__sequencer.pause();window.__ctx.paused=true;')
    S['park_at'] = None


def on_message(msg):
    """A message from the story page: {action: hello | warm | mix | unite | lines}."""
    action = msg.get('action')
    if 'lines' in msg:
        S['lines'] = 1.0 if msg.get('lines') else 0.0
    if action == 'warm':
        warm(msg.get('modes') or [])
    elif action == 'mix':
        pattern = msg.get('pattern') or []
        delays = msg.get('delays') or []
        fade = float(msg.get('fade', 2.2))
        for z in range(ZONES):
            _fade(z, int(pattern[z]) if z < len(pattern) else 0, float(delays[z]) if z < len(delays) else 0.0, fade)
        S['mixed'] = True
        S['park_at'] = None
    elif action in ('unite', 'hello'):
        delays = msg.get('delays') or []
        fade = float(msg.get('fade', 0.3))
        for z in range(ZONES):
            _fade(z, 0, float(delays[z]) if z < len(delays) else 0.0, fade)
        S['mixed'] = False
        S['park_at'] = _now() + (max(delays) if delays else 0.0) + fade + 1.5


def update():
    """Every frame: the fades, then the numbers for the GLSL TOP."""
    mix = parent().op('mix')
    if mix is None:
        return
    t = _now()
    for z in range(ZONES):
        f = S['fades'][z]
        u = min(max((t - f['t0']) / f['dur'], 0.0), 1.0)
        k = u * u * (3.0 - 2.0 * u)
        w = [f['a'][i] + (f['b'][i] - f['a'][i]) * k for i in range(3)]
        S['w'][z] = w
        setattr(mix.par, 'vec%dvaluex' % z, w[0])
        setattr(mix.par, 'vec%dvaluey' % z, w[1])
        setattr(mix.par, 'vec%dvaluez' % z, w[2])
    mix.par.vec5valuex = S['lines'] if parent().par.Layers else 0.0
    if S['park_at'] is not None and t >= S['park_at']:
        park()
