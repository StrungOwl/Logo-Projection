# Flowers, gears and flames: the precise set.
#
#   /home/sydney/logo-shapes/venv/bin/python shapes/fire-flower/make_fg.py [id ...]
#
# Writes, for each design:
#   <id>.svg          projection shape (outline + opening)
#   <id>-layers.svg   the wood pieces, stacked (a picture, not a cut file)
#   fg-options.json   data for the mock-up page
# The drawing tools are in fg.py. MOCK-UPS: no kerf, no tabs.
import json
import math
import os
import sys
import numpy as np
from shapely.geometry import Polygon, Point, LineString
from shapely.ops import unary_union
from shapely import affinity
import fg
from fg import (gear, ring_gear, circle_pts, offset_line, ticks, round_corners, prof, barbs, spine_xy, petal, dih, pull, rescale, petal_poly, petal_frame, petal_lines, stroke, spine, loop, band, dots,
                solid, main_part, crisp, join_all, ribbon, pen, circle)

HERE = os.path.dirname(os.path.abspath(__file__))
SIZE = 600.0       # mm, longest side of every piece

# Wood tones.
HONEY, MAPLE, CREAM, WALNUT, UMBER, BURN = '#c2945a', '#ecd5a8', '#f5e6c6', '#5b3a21', '#6c4628', '#3a2212'


# ------------------------------------------------------------------ flower
def row(at, r0, r1, W, a=0.8, b=1.35, curl=0.0, wob=0.0, lean=0.0, frame=None, vein=0.5, echo=(), cut=True, **kw):
    """One row of petals. at = place in the slice (0 = main axis, 1 = half
    way to the next main axis). frame: 'lace' = raised dark outline,
    'engrave' = burnt outline, None = no outline."""
    return dict(at=at, r0=r0, r1=r1, W=W, a=a, b=b, curl=curl, wob=wob, lean=lean, frame=frame, vein=vein, echo=echo, cut=cut, **kw)


def flower_parts(d, warp):
    """All shapes of a flower design, in mm. Returns the list of tiers."""
    n = d['n']
    H = math.pi / n
    mirror = d.get('mirror', True)
    tiers = []
    for T in d['tiers']:
        plate, lace, eng = ([loop(warp, T['core'])] if T.get('core') else []), [], []
        if T.get('blob') is not None:
            plate.append(Polygon(warp(T['blob'])))
        if T.get('band') is not None:
            lace.append(Polygon(warp(T['band'][0]), [warp(T['band'][1])[::-1]]))
        for rw in T['rows']:
            m = rw.get('n', n)
            Hm = math.pi / m
            mir = rw.get('mirror', mirror)
            on_axis = mir and rw['at'] in (0, 1)
            items = rw.get('items') or dih([petal(rw['r0'], rw['at'] * Hm, rw['r1'], rw['W'], rw['a'], rw['b'], rw['lean'], rw['curl'], rw['wob'],
                                                  cp=rw.get('cp', 1.6), axis=on_axis)], m, mir, rw.get('turn', 0.0))
            for it in items:
                if rw['cut']:
                    plate.append(petal_poly(it, warp))
                    for bb in barbs(it, rw.get('barbs', ())):
                        plate.append(petal_poly(bb, warp))
                        eng.extend(petal_lines(bb, warp, 0.3, (), s0=0.3, s1=0.85))
                if rw['frame'] == 'lace':
                    lace.append(petal_frame(it, warp, rw.get('inset', 1.3), rw.get('thin', 0.75), rw.get('thick', 1.6)))
                elif rw['frame'] == 'engrave':
                    eng.append(petal_frame(it, warp, rw.get('inset', 1.5), rw.get('thin', 0.3), rw.get('thick', 0.95)))
                eng += petal_lines(it, warp, rw['vein'], rw['echo'])
        for st in T.get('strokes', []):          # extra strokes: dict(to='lace'|'engrave', at, r0, r1, thin, thick, curl ...)
            m = st.get('n', n)
            Hm = math.pi / m
            mir = st.get('mirror', mirror)
            on_axis = mir and st['at'] in (0, 1)
            items = dih([dict(sp=spine(st['r0'], st['at'] * Hm, st['r1'] - st['r0'], st.get('lean', 0), st.get('curl', 0), st.get('wob', 0)),
                              axis=on_axis)], m, mir)
            for it in items:
                g = stroke(it['sp'], warp, st.get('thin', 0.5), st.get('thick', 1.4), tail=st.get('tail', 0.0))
                (lace if st.get('to', 'lace') == 'lace' else eng).append(g)
        if T.get('ring'):
            lace.append(band(warp, *T['ring']))
        for dd in T.get('dots', []):             # (radius, count, dot size mm, phase)
            eng += dots(warp, *dd)
        for rr in T.get('lines', []):            # thin engraved rings: (radius, width mm)
            w = rr[1] / warp.scale
            eng.append(band(warp, rr[0] + w / 2, rr[0] - w / 2))
        tiers.append(dict(plate=plate, lace=lace, eng=eng))
    return tiers


def build_flower(d):
    # Pass 1: measure. Pass 2: draw at the size that makes the piece SIZE mm.
    w0 = d['warp']
    T0 = d['tiers'][0]
    t0 = flower_parts({**d, 'tiers': [dict(core=T0.get('core'), blob=T0.get('blob'), rows=[{**r, 'frame': None, 'vein': 0, 'echo': ()} for r in T0['rows']])]}, w0)
    b0 = solid(join_all(t0[0]['plate']))
    x0, y0, x1, y1 = b0.bounds
    warp = rescale(w0, SIZE / max(x1 - x0, y1 - y0))
    tiers = flower_parts(d, warp)
    n = d['n']
    o = d['opening']
    no = o.get('n', n // 2)
    its = []
    if not o.get('items'):
        its = dih([petal(o['valley'] * 0.5, 0, o['tip'], o.get('W', o['valley'] * math.sin(math.pi / no) * 1.12), 0.5, o.get('b', 1.15), 0, o.get('curl', 0), axis=not o.get('curl'))], no, not o.get('curl'))
        if o.get('short'):
            its += dih([petal(o['valley'] * 0.5, math.pi / no, o['short'], o.get('W', o['valley'] * math.sin(math.pi / no) * 1.12) * 0.8, 0.5, o.get('b', 1.15), 0, o.get('curl', 0), axis=not o.get('curl'))], no, not o.get('curl'))
    if o.get('items'):
        op = solid(join_all([Polygon(warp(o['blob']))] + [petal_poly(it, warp) for it in o['items']]))
    else:
        op = solid(join_all([loop(warp, o['valley'])] + [petal_poly(it, warp) for it in its]))
    op = crisp(op, 0.2)
    oc = (op.centroid.x, op.centroid.y) if o.get('items') else (0, 0)
    layers = []
    nt = len(tiers)
    pieces = []
    for k, T in enumerate(tiers):
        depth = nt - 1 - k
        hole = affinity.scale(op, 0.84 ** depth, 0.84 ** depth, origin=oc)
        if not o.get('items'):
            hole = affinity.rotate(hole, (180.0 / no) * (depth % 2), origin=(0, 0))
        plate = solid(join_all(T['plate']))
        if k > 0:
            plate = plate.difference(hole)
        plate = crisp(plate)
        lace = None
        if T['lace']:
            parts = list(T['lace'])
            if k == nt - 1:
                parts.append(hole.buffer(d.get('rim', 2.4)))
            lace = join_all(parts).intersection(plate.buffer(0.9))
            if k > 0:
                lace = lace.difference(hole)
            whole = lace.area
            lace = crisp(lace, 0.2)
            if whole - lace.area > 0.02 * whole:
                print(f'   note: {d["id"]} tier {k}: {100 * (whole - lace.area) / whole:.1f} % of the lace is not joined (left out)')
        pieces.append(dict(plate=plate, lace=lace, eng=join_all(T['eng'])))
    for k, pc in enumerate(pieces):
        layers.append(dict(geom=pc['plate'], tone=HONEY if k == 0 else (MAPLE if k % 2 else CREAM), eng=pc['eng'], kind='plate'))
        if pc['lace'] is not None:
            layers.append(dict(geom=pc['lace'], tone=WALNUT if k % 2 else UMBER, eng=None, kind='lace'))
    return dict(layers=stack(layers), base=pieces[0]['plate'], op=op)


def stack(layers):
    """Bottom to top. Engraving stays only where its layer can be seen."""
    for i, L in enumerate(layers):
        if L.get('eng') is None:
            continue
        e = L['eng'] if not isinstance(L['eng'], (list, tuple)) else join_all(L['eng'])
        vis = L['geom'].buffer(-0.7)
        above = [q['geom'] for q in layers[i + 1:]]
        if above:
            vis = vis.difference(join_all(above).buffer(0.35))
        L['eng'] = e.intersection(vis)
    return layers


# ------------------------------------------------------------------- flames
def ellipse(rx, ry, cy=0.0, n=360):
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    return np.stack([rx * np.sin(t), cy + ry * np.cos(t)], axis=1)


def fan(m, spread, open_, L, W, rx, ry, cy=0.0, lenf=None, curl=0.45, wob=0.10, ph=0.0, bias=0.0, spin=0.0, a=0.6, b=1.45):
    """Flame tongues that rise from an oval bed of embers (round space).
    m tongues over +-spread (radians, 0 = up). open_ < 1 makes the side
    tongues stand more upright. lenf(angle, i) = length factor."""
    out = []
    for i in range(m):
        u = (i + 0.5) / m
        th = (2 * u - 1) * spread
        f = lenf(th, i) if lenf else 0.22 + 0.78 * (1 - abs(2 * u - 1) ** 1.2) ** 1.2
        ln = L * f * (0.86 + 0.14 * math.cos(2.4 * i + ph))
        cu = spin + curl * math.sin(1.9 * i + 1.3 * ph) + 0.22 * math.copysign(1.0, th) * (1 - f)
        wo = wob * (1 if i % 2 else -1)
        base = (0.78 * rx * math.sin(th), cy + 0.78 * ry * math.cos(th))
        out.append(dict(sp=spine_xy(base, th * open_ + bias, ln, cu, wo, n=90), W=W * (0.72 + 0.28 * f), a=a, b=b))
    return out


def skirt(ns, rx, ry, k, L=0.21, W=0.036, from_deg=116):
    """Small flames on the bottom edge. They start downward and curl up
    around the ember bed, so the bottom edge is not a plain arc."""
    out = []
    a0 = math.radians(from_deg)
    for j in range(ns):
        th = a0 + (2 * math.pi - 2 * a0) * (j + 0.5) / ns
        side = 1.0 if th < math.pi else -1.0
        f = 0.62 + 0.38 * abs(th - math.pi) / (math.pi - a0)
        base = (0.80 * rx * k * math.sin(th), 0.80 * ry * k * math.cos(th))
        out.append(dict(sp=spine_xy(base, th, L * k * f, curl=-side * 1.75, n=60), W=W * (0.6 + 0.4 * k), a=0.6, b=1.4))
    return out


def flame_tier(k, m, spread, open_, L, W, rx, ry, frame, echo=(0.5,), barbs=(), skirt_n=0, **kw):
    """One layer of a fire: the ember bed + its tongues. k = size factor."""
    its = fan(m, spread, open_, L * k, W * (0.6 + 0.4 * k), rx * k, ry * k, **kw)
    if skirt_n:
        its = its + skirt(skirt_n, rx, ry, k)
    T = dict(blob=ellipse(rx * k, ry * k), rows=[row(0, 0, 0, 0, items=its, frame=frame, echo=echo, barbs=barbs)])
    if frame == 'lace':
        T['band'] = (ellipse(rx * k * 0.88, ry * k * 0.88), ellipse(rx * k * 0.80, ry * k * 0.80))
    return T


def flame_core(h=0.36, w=0.085, y0=-0.10, wob=0.10, curl=0.0):
    """The opening of a fire: one small flame with two side tongues."""
    its = [dict(sp=spine_xy((0.0, y0), 0.0, h, curl, wob, n=80), W=w, a=0.5, b=1.3),
           dict(sp=spine_xy((-0.045, y0 + 0.02), -0.85, h * 0.62, 0.85, 0.0, n=60), W=w * 0.50, a=0.5, b=1.4),
           dict(sp=spine_xy((0.045, y0 + 0.02), 0.9, h * 0.52, -0.9, 0.0, n=60), W=w * 0.46, a=0.5, b=1.4)]
    return dict(items=its, blob=ellipse(w * 0.75, w * 0.6, y0 + 0.04))


LICKS = [(0.40, 0.50, 0.14, 0.017, 0.8), (0.58, 0.45, 0.11, 0.014, 0.8), (0.74, 0.40, 0.075, 0.011, 0.8)]
D = math.radians

FLAMES = [
    dict(id='fire01', kind='flower', name='Bonfire', n=8, mirror=False, rim=2.4,
         note='A wide fire. Three flames, one inside the other. Every tongue is different.',
         warp=pull(None),
         tiers=[flame_tier(1.00, 19, D(162), 0.56, 1.05, 0.090, 0.44, 0.36, 'engrave', skirt_n=9, echo=(0.55, 0.28), barbs=LICKS, ph=0.4),
                flame_tier(0.72, 15, D(158), 0.56, 1.02, 0.090, 0.44, 0.36, 'lace', skirt_n=7, ph=1.7),
                flame_tier(0.48, 11, D(150), 0.56, 1.00, 0.090, 0.44, 0.36, 'lace', skirt_n=5, echo=(), ph=2.9)],
         opening=flame_core()),

    dict(id='fire02', kind='flower', name='Candle Flame', n=8, mirror=False, rim=2.4,
         note='One tall flame that bends in the air, with small tongues along its sides.',
         warp=pull(None, lean=0.11),
         tiers=[flame_tier(1.00, 17, D(160), 0.30, 1.50, 0.085, 0.30, 0.36, 'engrave', skirt_n=7, echo=(0.55, 0.28), barbs=LICKS, ph=0.9, wob=0.13,
                           lenf=lambda th, i: 0.20 + 0.80 * math.exp(-(th / 0.85) ** 2)),
                flame_tier(0.72, 13, D(155), 0.30, 1.45, 0.085, 0.30, 0.36, 'lace', skirt_n=5, ph=2.1, wob=0.13,
                           lenf=lambda th, i: 0.20 + 0.80 * math.exp(-(th / 0.85) ** 2)),
                flame_tier(0.48, 9, D(150), 0.30, 1.40, 0.085, 0.30, 0.36, 'lace', skirt_n=5, echo=(), ph=3.3, wob=0.13,
                           lenf=lambda th, i: 0.20 + 0.80 * math.exp(-(th / 0.85) ** 2))],
         opening=flame_core(h=0.42, w=0.075)),

    dict(id='fire03', kind='flower', name='Wildfire', n=8, mirror=False, rim=2.4,
         note='A fire in a strong wind. All tongues stream to one side.',
         warp=pull(None, lean=0.06),
         tiers=[flame_tier(1.00, 21, D(165), 0.50, 1.25, 0.085, 0.46, 0.34, 'engrave', skirt_n=9, echo=(0.55, 0.28), barbs=LICKS, ph=0.2, bias=0.62, spin=0.28,
                           lenf=lambda th, i: 0.20 + 0.80 * math.exp(-((th - 0.75) / 1.05) ** 2)),
                flame_tier(0.72, 16, D(160), 0.50, 1.20, 0.085, 0.46, 0.34, 'lace', skirt_n=7, ph=1.4, bias=0.62, spin=0.28,
                           lenf=lambda th, i: 0.20 + 0.80 * math.exp(-((th - 0.75) / 1.05) ** 2)),
                flame_tier(0.48, 11, D(150), 0.50, 1.15, 0.085, 0.46, 0.34, 'lace', skirt_n=5, echo=(), ph=2.6, bias=0.62, spin=0.28,
                           lenf=lambda th, i: 0.20 + 0.80 * math.exp(-((th - 0.75) / 1.05) ** 2))],
         opening=flame_core(h=0.36, w=0.08, curl=0.5)),

    dict(id='fire04', kind='flower', name='Fire Wheel', n=8, mirror=False, rim=2.4,
         note='A ring of fire. The flames turn one way, the next layer turns the other way.',
         warp=pull(None),
         tiers=[flame_tier(1.00, 26, D(180), 1.0, 0.70, 0.070, 0.44, 0.44, 'engrave', echo=(0.55, 0.28), barbs=LICKS[:2], ph=0.5, spin=0.85, curl=0.25,
                           lenf=lambda th, i: 0.78 + 0.22 * math.cos(3 * i * 2 * math.pi / 26 + 0.4) * math.cos(5 * i * 2 * math.pi / 26)),
                flame_tier(0.74, 20, D(180), 1.0, 0.62, 0.070, 0.44, 0.44, 'lace', ph=1.5, spin=-0.85, curl=0.25,
                           lenf=lambda th, i: 0.80 + 0.20 * math.cos(3 * i * 2 * math.pi / 20 + 1.0)),
                flame_tier(0.50, 14, D(180), 1.0, 0.56, 0.070, 0.44, 0.44, 'lace', echo=(), ph=2.5, spin=0.85, curl=0.25,
                           lenf=lambda th, i: 0.82 + 0.18 * math.cos(2 * i * 2 * math.pi / 14))],
         opening=dict(n=7, tip=0.19, valley=0.09, b=1.3, curl=0.7)),

    dict(id='fire05', kind='flower', name='Phoenix', n=8, mirror=False, rim=2.4,
         note='Two wings of fire and one tall flame in the middle. Wide, for the projector picture.',
         warp=pull(None),
         tiers=[flame_tier(1.00, 23, D(165), 0.86, 1.18, 0.082, 0.46, 0.30, 'engrave', skirt_n=9, echo=(0.55, 0.28), barbs=LICKS, ph=0.7,
                           lenf=lambda th, i: 0.20 + 0.80 * max(math.exp(-((abs(th) - 1.12) / 0.42) ** 2), 0.74 * math.exp(-(th / 0.20) ** 2))),
                flame_tier(0.72, 17, D(160), 0.86, 1.12, 0.082, 0.46, 0.30, 'lace', skirt_n=7, ph=1.9,
                           lenf=lambda th, i: 0.20 + 0.80 * max(math.exp(-((abs(th) - 1.12) / 0.42) ** 2), 0.74 * math.exp(-(th / 0.20) ** 2))),
                flame_tier(0.48, 11, D(150), 0.86, 1.06, 0.082, 0.46, 0.30, 'lace', skirt_n=5, echo=(), ph=3.1,
                           lenf=lambda th, i: 0.20 + 0.80 * max(math.exp(-((abs(th) - 1.12) / 0.42) ** 2), 0.74 * math.exp(-(th / 0.20) ** 2)))],
         opening=flame_core(h=0.34, w=0.08)),
]


# ------------------------------------------------------------------- gears
def fit_k(pitch, N, tooth, lean=0.0):
    """mm per unit, so that the finished gear is SIZE mm on its longest side."""
    k = 300.0
    for _ in range(2):
        g, _, _ = gear(pitch(k), N, tooth, lean=lean)
        x0, y0, x1, y1 = g.bounds
        k *= SIZE / max(x1 - x0, y1 - y0)
    return k


def at(center, r, phi):
    return (center[0] + r * math.sin(phi), center[1] + r * math.cos(phi))


def spline(center, r, n=12):
    """The opening of a gear: a round hole with small teeth (a spline)."""
    return gear(circle_pts(center, r, 360), n, 'spur', soft=0.25)[0]


def spokes(center, k, specs, r0, w0, w1, length=1.9, power=1.6):
    """Curved spokes. specs: (angle, curl, wob). Returns (ribs, centre lines)."""
    ribs, lines = [], []
    for phi, curl, wob in specs:
        sp = spine_xy(at(center, r0 * k, phi), phi, length * k, curl, wob, n=110)
        s = np.linspace(0, 1, len(sp))
        ribs.append(ribbon(sp, w1 + (w0 - w1) * (1 - s) ** power))
        lines.append(sp)
    return ribs, lines


def wheel(outline, rim, center, hub_r, ribs, fillet=2.5):
    """A plate with windows between the spokes. Returns (plate, windows)."""
    inner = outline.buffer(-rim, join_style='round')
    win = inner.difference(Point(center).buffer(hub_r, 128))
    if ribs:
        win = win.difference(join_all(ribs))
    win = win.buffer(-fillet).buffer(fillet)
    return outline.difference(win), win


def hub(center, k, R=0.20, N=16, op_r=0.105, op_n=10, tooth='spur', lean=0.0, holes=0, hole_r=0.022):
    """The middle: a small gear (plate), a dark cap ring (lace), the opening."""
    op = spline(center, op_r * k, op_n)
    g, root, p = gear(circle_pts(center, R * k), N, tooth, lean=lean)
    plate = g.difference(op)
    for i in range(holes):
        plate = plate.difference(Point(at(center, 0.66 * R * k, 2 * math.pi * (i + 0.5) / holes)).buffer(hole_r * k, 24))
    cap = op.buffer(2.6).difference(op)
    ring = Point(center).buffer((op_r + 0.045) * k, 96)
    cap = join_all([cap, ring.difference(ring.buffer(-1.6))])
    eng = ticks(root, 1.2, N * 2, 1.6, 0.25)
    return plate, cap, op, eng


def gear_layers(base, plate1, lace1, plate2, lace2, e0=(), e1=(), e2=()):
    L = [dict(geom=base, tone=HONEY, eng=join_all(e0) if e0 else None, kind='plate'),
         dict(geom=plate1, tone=MAPLE, eng=join_all(e1) if e1 else None, kind='plate'),
         dict(geom=lace1, tone=WALNUT, eng=None, kind='lace'),
         dict(geom=plate2, tone=CREAM, eng=join_all(e2) if e2 else None, kind='plate'),
         dict(geom=lace2, tone=UMBER, eng=None, kind='lace')]
    return stack([x for x in L if x['geom'] is not None and not x['geom'].is_empty])


def gear_nautilus(d):
    kap = math.log(2.0) / (2 * math.pi)
    tt = np.linspace(0, 1, 90)[1:-1]
    def pitch(k, f=1.0, n=1200):
        ph = np.linspace(0, 2 * np.pi, n)
        r = 0.5 * f * np.exp(kap * ph)
        sp = np.stack([r * np.sin(ph), r * np.cos(ph)], axis=1)
        ap = np.stack([-0.11 * f * np.sin(np.pi * tt), f * (1.0 - 0.5 * tt)], axis=1)     # the mouth of the shell
        return np.vstack([sp, ap]) * k
    N = 46
    k = fit_k(pitch, N, 'spur')
    mouth = LineString(np.stack([-0.11 * np.sin(np.pi * tt), 1.0 - 0.5 * tt], axis=1) * k)
    pitch_len = Polygon(pitch(k)).exterior.length / N
    on_step = lambda c: Point(c).distance(mouth) < 0.36 * pitch_len
    base, root, p = gear(pitch(k), N, 'spur', skip=on_step)
    O = (0.0, 0.0)
    P1 = root.buffer(-3.2, join_style='round')
    whorl = Polygon(pitch(k, 0.5)).buffer(0.035 * k)
    rin = lambda ph: 0.25 * math.exp(kap * ph) + 0.03
    M = 15
    ribs, lines, growth = [], [], []
    for j in range(M * 4):
        ph = 2 * math.pi * (j + 0.6) / (M * 4)
        sp = spine_xy(at(O, rin(ph) * k, ph), ph + 0.75, 0.9 * k * math.exp(kap * ph), curl=-1.25, cp=1.2, n=90)
        if j % 4 == 0:
            ribs.append(ribbon(sp, 2.3))
            lines.append(sp)
        else:
            growth.append(ribbon(sp, pen(len(sp), 0.12, 0.42, tail=0.1)))
    inner = P1.buffer(-0.062 * k, join_style='round')
    win = inner.difference(whorl).difference(join_all(ribs)).buffer(-2.2).buffer(2.2)
    plate2, cap, op, e2 = hub(O, k, R=0.185, N=14, op_r=0.10, op_n=10, holes=7, hole_r=0.018)
    plate1 = P1.difference(win).difference(affinity.scale(op, 0.84, 0.84, origin=O))
    lace1 = join_all([offset_line(P1, 2.2, 2.0), offset_line(whorl, 1.6, 1.8)]
                     + [ribbon(sp, 0.85).intersection(inner.buffer(1.0)) for sp in lines])
    lace1 = lace1.difference(Point(O).buffer(0.13 * k)).intersection(P1)
    e1 = ticks(P1, 5.6, N * 4, 2.0, 0.22, long_every=4, long_len=4.0) + [offset_line(whorl, 5.5, 0.5)]
    e0 = [g.intersection(win) for g in growth]
    return dict(layers=gear_layers(base, plate1, lace1, plate2, cap, e0, e1, e2), base=base, op=op)


def gear_oval(d):
    pitch = lambda k: np.stack([1.0 * np.sin(np.linspace(0, 2 * np.pi, 1200, endpoint=False)),
                                0.70 * np.cos(np.linspace(0, 2 * np.pi, 1200, endpoint=False))], axis=1) * k
    N = 56
    k = fit_k(pitch, N, 'spur')
    base, root, p = gear(pitch(k), N, 'spur')
    O = (0.0, 0.0)
    P1 = root.buffer(-3.2, join_style='round')
    specs = [((j + 0.5) * math.pi / 6, 0.55 * (1 if j % 2 == 0 else -1), 0.0) for j in range(12)]
    ribs, lines = spokes(O, k, specs, 0.20, 0.022 * k, 0.010 * k)
    plate1, win = wheel(P1, 0.070 * k, O, 0.275 * k, ribs)
    plate2, cap, op, e2 = hub(O, k, R=0.20, N=18, op_r=0.105, op_n=12, holes=9)
    plate1 = plate1.difference(affinity.scale(op, 0.84, 0.84, origin=O))
    inner = P1.buffer(-0.070 * k)
    ringh = Point(O).buffer(0.29 * k, 128)
    lace1 = join_all([offset_line(P1, 2.2, 2.0), offset_line(P1, 0.070 * k - 3.6, 1.6), ringh.difference(ringh.buffer(-2.0))]
                     + [ribbon(sp, pen(len(sp), 0.9, 0.9, tip=0.001)).intersection(inner.buffer(0.5)).difference(ringh) for sp in lines])
    e1 = ticks(P1, 5.4, N * 4, 1.8, 0.22, long_every=4, long_len=3.6)
    e0 = [offset_line(root, 0.085 * k + i * 0.034 * k, 0.5).intersection(win) for i in range(14)]
    return dict(layers=gear_layers(base, plate1, lace1, plate2, cap, e0, e1, e2), base=base, op=op)


def gear_planet(d):
    def pitch(k, n=1200):
        ph = np.linspace(0, 2 * np.pi, n, endpoint=False)
        r = 0.88 * (1 + 0.125 * np.cos(3 * ph))
        return np.stack([r * np.sin(ph), r * np.cos(ph)], axis=1) * k
    N = 60
    k = fit_k(pitch, N, 'spur')
    base, root, p = gear(pitch(k), N, 'spur')
    O = (0.0, 0.0)
    P1 = root.buffer(-3.2, join_style='round')
    Nr, Ns, Np = 48, 16, 16
    Rr = 0.50 * k
    m = 2 * Rr / Nr
    Rs, Rp = Ns * m / 2, Np * m / 2
    window = ring_gear(O, Rr, Nr)
    lobes = [at(O, 0.775 * k, 2 * math.pi * i / 3) for i in range(3)]
    plate1 = P1.difference(window)
    idlers = []
    for c0 in lobes:
        plate1 = plate1.difference(Point(c0).buffer(0.118 * k, 96))
        g, _, _ = gear(circle_pts(c0, 0.090 * k), 12, 'spur')
        idlers.append(g.difference(spline(c0, 0.034 * k, 6)))
    trim = Point(O).buffer(Rr + 0.40 * (2 * math.pi * Rr / Nr) + 5.2, 180)
    lace1 = join_all([trim.difference(trim.buffer(-2.2)), offset_line(P1, 2.2, 2.0)] + idlers
                     + [Point(c0).buffer(0.118 * k + 4.0, 96).difference(Point(c0).buffer(0.118 * k + 2.0, 96)) for c0 in lobes])
    # Carrier with three planet gears (light), sun gear on top (dark).
    planets, bores = [], []
    for i in range(3):
        c0 = at(O, Rs + Rp, 2 * math.pi * i / 3)
        g, _, _ = gear(circle_pts(c0, Rp), Np, 'spur', phase=0.5)
        planets.append(g)
        bores.append(spline(c0, 0.045 * k, 6))
    arms = [ribbon(np.array([O, at(O, Rs + Rp, 2 * math.pi * i / 3)]), 0.045 * k) for i in range(3)]
    op = spline(O, 0.088 * k, 10)
    plate2 = join_all(planets + arms + [Point(O).buffer(0.13 * k, 96)]).difference(join_all(bores)).difference(affinity.scale(op, 0.9, 0.9, origin=O))
    sun, sroot, _ = gear(circle_pts(O, Rs), Ns, 'spur')
    lace2 = sun.difference(op)
    e1 = ticks(P1, 5.4, N * 4, 1.8, 0.22, long_every=4, long_len=3.6) + [offset_line(P1, 9.6, 0.5)]
    e0 = [Point(O).buffer(r_ * k, 180).difference(Point(O).buffer(r_ * k - 0.5, 180)) for r_ in np.arange(0.06, 0.52, 0.03)]
    e0 += [LineString([O, at(O, 0.56 * k, 2 * math.pi * i / 48)]).buffer(0.22) for i in range(48)]
    e2 = [t for c0 in [at(O, Rs + Rp, 2 * math.pi * i / 3) for i in range(3)]
          for t in ticks(Point(c0).buffer(Rp - 0.40 * (2 * math.pi * Rp / Np), 96), 1.2, 32, 1.5, 0.22)]
    return dict(layers=gear_layers(base, plate1, lace1, plate2, lace2, e0, e1, e2), base=base, op=op)


def gear_turbine(d):
    def pitch(k, n=1200):
        ph = np.linspace(0, 2 * np.pi, n, endpoint=False)
        r = 0.80 * (1 + 0.17 * np.cos(4 * ph))
        return np.stack([r * np.sin(ph), r * np.cos(ph)], axis=1) * k
    N = 52
    k = fit_k(pitch, N, 'flame', lean=0.5)
    base, root, p = gear(pitch(k), N, 'flame', lean=0.5)
    O = (0.0, 0.0)
    P1 = root.buffer(-3.2, join_style='round')
    specs = [(j * math.pi / 4 + 0.2, 1.35, 0.0) for j in range(8)]
    ribs, lines = spokes(O, k, specs, 0.18, 0.050 * k, 0.016 * k, power=1.0)
    plate1, win = wheel(P1, 0.066 * k, O, 0.26 * k, ribs, fillet=3.0)
    plate2, cap, op, e2 = hub(O, k, R=0.19, N=14, op_r=0.10, op_n=10, tooth='flame', lean=0.5)
    plate1 = plate1.difference(affinity.scale(op, 0.84, 0.84, origin=O))
    inner = P1.buffer(-0.066 * k)
    ringh = Point(O).buffer(0.275 * k, 128)
    lace1 = join_all([offset_line(P1, 2.2, 2.0), ringh.difference(ringh.buffer(-2.0))]
                     + [ribbon(sp, pen(len(sp), 0.8, 2.0, p=0.6, tip=0.001)).intersection(inner.buffer(0.5)).difference(ringh) for sp in lines])
    e1 = ticks(P1, 5.2, N * 2, 2.2, 0.25) + [offset_line(P1, 0.066 * k - 2.4, 0.5)]
    fine = [(j * math.pi / 32, 1.35, 0.0) for j in range(64)]
    _, fl = spokes(O, k, fine, 0.2, 1, 1)
    e0 = [ribbon(sp, pen(len(sp), 0.12, 0.38, tail=0.05)).intersection(win) for sp in fl]
    return dict(layers=gear_layers(base, plate1, lace1, plate2, cap, e0, e1, e2), base=base, op=op)


def gear_cam(d):
    def pitch(k, n=1200):
        ph = np.linspace(0, 2 * np.pi, n, endpoint=False)
        r = 0.78 + 0.26 * np.maximum(np.cos(ph - 0.7), 0) ** 2.2
        return np.stack([r * np.sin(ph), r * np.cos(ph)], axis=1) * k
    N = 34
    k = fit_k(pitch, N, 'escape', lean=0.26)
    base, root, p = gear(pitch(k), N, 'escape', lean=0.26, add=0.50 * (Polygon(pitch(k)).exterior.length / N))
    x0, y0, x1, y1 = base.bounds
    k *= SIZE / max(x1 - x0, y1 - y0)
    base, root, p = gear(pitch(k), N, 'escape', lean=0.26, add=0.50 * (Polygon(pitch(k)).exterior.length / N))
    O = (0.0, 0.0)
    P1 = root.buffer(-3.2, join_style='round')
    specs = [(j * 2 * math.pi / 5 + 0.1, 0.75, 0.0) for j in range(5)]
    ribs, lines = spokes(O, k, specs, 0.18, 0.026 * k, 0.011 * k)
    plate1, win = wheel(P1, 0.060 * k, O, 0.24 * k, ribs)
    nose = at(O, 0.80 * k, 0.7)
    plate2, cap, op, e2 = hub(O, k, R=0.19, N=16, op_r=0.10, op_n=10, holes=8)
    plate1 = plate1.difference(affinity.scale(op, 0.84, 0.84, origin=O)).difference(Point(nose).buffer(0.105 * k, 96))
    pin, _, _ = gear(circle_pts(nose, 0.078 * k), 10, 'spur')
    pinion = pin.difference(spline(nose, 0.03 * k, 6))
    # Hair spring: a thin spiral from the hub to the rim.
    t = np.linspace(0, 1, 900)
    rr, ph = (0.265 + (0.62 - 0.265) * t) * k, 2 * math.pi * 3.75 * t
    hair = ribbon(np.stack([rr * np.sin(ph), rr * np.cos(ph)], axis=1), 1.0)
    ringh = Point(O).buffer(0.265 * k, 128)
    stud = Point(at(O, 0.62 * k, 2 * math.pi * 3.75)).buffer(3.4, 24)
    noser = Point(nose).buffer(0.105 * k + 4.0, 96).difference(Point(nose).buffer(0.105 * k + 2.0, 96))
    lace1 = join_all([offset_line(P1, 2.2, 2.0), ringh.difference(ringh.buffer(-2.0)), hair, stud, pinion, noser])
    e1 = ticks(P1, 5.2, N * 5, 1.8, 0.22, long_every=5, long_len=3.6)
    e0 = [offset_line(root, 0.08 * k + i * 0.03 * k, 0.5).intersection(win) for i in range(16)]
    return dict(layers=gear_layers(base, plate1, lace1, plate2, cap, e0, e1, e2), base=base, op=op)


GEARS = [
    dict(id='gear01', kind='gear', name='Nautilus Gear', build=gear_nautilus,
         note='A spiral gear, like a nautilus shell. The chambers get bigger along the spiral.'),
    dict(id='gear02', kind='gear', name='Oval Flywheel', build=gear_oval,
         note='An oval gear. The curved spokes meet in pairs, like pointed arches.'),
    dict(id='gear03', kind='gear', name='Planet Gear', build=gear_planet,
         note='Three lobes. Inside: a ring gear, three planet gears and a sun gear, like a real gearbox.'),
    dict(id='gear04', kind='gear', name='Fire Turbine', build=gear_turbine,
         note='Four soft lobes. The teeth are small flames. Eight blades turn inside.'),
    dict(id='gear05', kind='gear', name='Clock Cam', build=gear_cam,
         note='A cam with long clock teeth, a hair spring spiral and a small pinion in the nose.'),
]


# ------------------------------------------------------------------ output
def path_d(geom, cx, cy):
    out = []
    polys = [geom] if geom.geom_type == 'Polygon' else [g for g in getattr(geom, 'geoms', []) if g.geom_type == 'Polygon']
    for poly in polys:
        for ring in [poly.exterior, *poly.interiors]:
            pts = list(ring.coords)[:-1]
            out.append('M' + ' L'.join(f'{cx + x:.2f},{cy - y:.2f}' for x, y in pts) + 'Z')
    return ' '.join(out)


def wood_svg(layers, W, H, cx, cy):
    """The stacked pieces as a picture: wood grain, burnt edges, shadows."""
    defs = ['<filter id="f-wood" x="-3%" y="-3%" width="106%" height="106%" color-interpolation-filters="sRGB">'
            '<feTurbulence type="fractalNoise" baseFrequency="0.004 0.45" numOctaves="2" seed="7" result="n"/>'
            '<feColorMatrix in="n" type="matrix" values="0 0 0 0 0.24  0 0 0 0 0.13  0 0 0 0 0.05  0 0 0 -0.55 0.36" result="g"/>'
            '<feComposite in="g" in2="SourceGraphic" operator="in" result="gg"/>'
            '<feGaussianBlur in="SourceAlpha" stdDeviation="1.3" result="b"/><feOffset in="b" dx="1.1" dy="1.8" result="o"/>'
            '<feComponentTransfer in="o" result="sh"><feFuncA type="linear" slope="0.75"/></feComponentTransfer>'
            '<feMerge><feMergeNode in="sh"/><feMergeNode in="SourceGraphic"/><feMergeNode in="gg"/></feMerge></filter>']
    body = []
    for L in layers:
        d = path_d(L['geom'], cx, cy)
        body.append(f'<path d="{d}" fill="{L["tone"]}" fill-rule="evenodd" stroke="{BURN}" stroke-width="0.4" stroke-opacity="0.75" filter="url(#f-wood)"/>')
        if L.get('eng') is not None and not L['eng'].is_empty:
            body.append(f'<path d="{path_d(L["eng"], cx, cy)}" fill="{BURN}" fill-rule="evenodd" opacity="0.88"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} {H:.1f}">\n<defs>{"".join(defs)}</defs>\n'
            + '\n'.join(body) + '\n</svg>\n')


def put(path, text):
    """Write a file in one step (a page that loads it never sees half a file)."""
    with open(path + '.tmp', 'w') as f:
        f.write(text)
    os.replace(path + '.tmp', path)


def write(d, b, meta):
    oid = d['id']
    S = lambda g: g.simplify(0.03, preserve_topology=True)
    base, op = S(b['base']), S(b['op'])
    layers = [dict(L, geom=S(L['geom']), eng=(S(L['eng']) if L.get('eng') is not None else None)) for L in b['layers']]
    minx, miny, maxx, maxy = base.bounds
    pad = 12.0
    W, H = (maxx - minx) + 2 * pad, (maxy - miny) + 2 * pad
    cx, cy = pad - minx, pad + maxy
    put(os.path.join(HERE, f'{oid}.svg'),
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.1f}mm" height="{H:.1f}mm" viewBox="0 0 {W:.1f} {H:.1f}">\n'
        f'<!-- {oid} {d["name"]} - projection shape (mock-up). Outline + opening. -->\n'
        f'<path d="{path_d(Polygon(base.exterior), cx, cy)}" fill="none" stroke="#f00" stroke-width="0.3"/>\n'
        f'<path d="{path_d(op, cx, cy)}" fill="none" stroke="#f00" stroke-width="0.3"/>\n</svg>\n')
    put(os.path.join(HERE, f'{oid}-layers.svg'), wood_svg(layers, W, H, cx, cy))
    # The wood layers for the layer director (layers.html): same drawing
    # units as <id>.svg. box = the box of the outline.
    put(os.path.join(HERE, f'{oid}.layers.json'), json.dumps(dict(
        id=oid, name=d['name'], box=[pad, pad, round(W - pad, 2), round(H - pad, 2)],
        layers=[dict(kind=L['kind'], d=path_d(L['geom'], cx, cy)) for L in layers])))
    engs = [L['eng'] for L in layers if L.get('eng') is not None and not L['eng'].is_empty]
    meta[oid] = dict(id=oid, name=d['name'], note=d['note'], kind=d['kind'], pieces=len(layers),
                     width=round(maxx - minx, 1), height=round(maxy - miny, 1), view=[round(W, 1), round(H, 1)], pad=pad,
                     windows=0, base=path_d(Polygon(base.exterior), cx, cy), rings=[path_d(L['geom'], cx, cy) for L in layers[1:]],
                     hole=path_d(op, cx, cy), engrave=path_d(unary_union(engs), cx, cy) if engs else '')
    pts = sum(len(r.coords) for L in layers for g in ([L['geom']] if L['geom'].geom_type == 'Polygon' else L['geom'].geoms) for r in [g.exterior, *g.interiors])
    print(f'{oid} {d["name"]:18s} {maxx - minx:6.1f} x {maxy - miny:6.1f} mm  layers {len(layers)}  points {pts}')


# ----------------------------------------------------------------- designs
c, s_, ab = np.cos, np.sin, np.abs
pos = lambda v: np.maximum(v, 0.0)

# Small helpers for rows that are used often.
def hooks(at, r0, r1, W=0.03, curl=0.9, **kw):
    """Small curled flames between the petals. They make the edge rich."""
    return row(at, r0, r1, W, a=0.6, b=1.5, curl=curl, vein=0.35, **kw)


def bud(at, r0, r1, W=0.034, **kw):
    """A bud on the end of a long spike."""
    return row(at, r0, r1, W, a=0.75, b=0.95, vein=0.35, frame='engrave', **kw)


FLOWERS = [
    dict(id='flower01', kind='flower', name='Flame Dahlia', n=16, mirror=False,
         note='A dahlia that is pulled up into a flame. Every petal bends a little in the wind.',
         warp=pull(lambda t: 0.84 + 0.62 * pos(c(t)) ** 3, lean=0.08),
         tiers=[
             dict(core=0.56, lines=[(0.575, 0.5)], rows=[
                 row(0, 0.44, 1.00, 0.098, curl=0.16, wob=0.07, frame='engrave', echo=(0.55, 0.28),
                     barbs=[(0.50, 0.55, 0.11, 0.020, 0.9), (0.68, 0.50, 0.075, 0.015, 0.9)]),
                 row(1, 0.44, 0.86, 0.088, curl=0.16, wob=0.07, frame='engrave', echo=(0.5,),
                     barbs=[(0.62, 0.55, 0.08, 0.016, 0.9)]),
                 hooks(0.5, 0.60, 0.80, 0.024, curl=1.0), hooks(1.5, 0.60, 0.78, 0.022, curl=1.0),
             ]),
             dict(core=0.42, ring=(0.405, 0.38), rows=[
                 row(1, 0.27, 0.74, 0.082, curl=-0.16, wob=-0.07, frame='lace', echo=(0.5,)),
                 row(0, 0.27, 0.64, 0.072, curl=-0.16, wob=-0.07, frame='engrave'),
             ]),
             dict(core=0.27, ring=(0.265, 0.245), dots=[(0.285, 32, 0.9, 0.0)], rows=[
                 row(0, 0.15, 0.50, 0.060, curl=0.16, wob=0.07, frame='lace', echo=(0.5,)),
                 row(1, 0.15, 0.43, 0.052, curl=0.16, wob=0.07, frame='engrave'),
             ]),
         ],
         opening=dict(n=8, tip=0.215, valley=0.105, b=1.25, curl=0.25)),

    dict(id='flower02', kind='flower', name='Compass Lotus', n=8,
         note='Long spikes with buds, and flame tongues that lean to the spikes. A lotus inside.',
         warp=pull(None),
         tiers=[
             dict(core=0.57, lines=[(0.585, 0.5)], rows=[
                 row(0, 0.40, 0.93, 0.105, n=4, a=0.55, b=1.7, frame='engrave', echo=(0.5,)),
                 row(1, 0.40, 0.84, 0.100, n=4, a=0.55, b=1.7, frame='engrave', echo=(0.5,)),
                 bud(0, 0.80, 1.00, n=4), bud(1, 0.72, 0.905, n=4),
                 row(0.25, 0.40, 0.80, 0.118, n=4, a=0.7, b=1.4, curl=-0.55, frame='engrave', echo=(0.5,)),
                 row(0.75, 0.40, 0.80, 0.118, n=4, a=0.7, b=1.4, curl=-0.55, frame='engrave', echo=(0.5,)),
                 row(0.125, 0.40, 0.70, 0.058, n=4, a=0.7, b=1.2, curl=-0.15, vein=0.4),
                 row(0.375, 0.40, 0.70, 0.058, n=4, a=0.7, b=1.2, curl=-0.37, vein=0.4),
                 row(0.625, 0.40, 0.70, 0.058, n=4, a=0.7, b=1.2, curl=-0.37, vein=0.4),
                 row(0.875, 0.40, 0.70, 0.058, n=4, a=0.7, b=1.2, curl=-0.15, vein=0.4),
                 hooks(0.06, 0.74, 0.83, 0.016, curl=1.2, n=4), hooks(0.94, 0.66, 0.75, 0.016, curl=-1.2, n=4),
             ]),
             dict(core=0.44, ring=(0.42, 0.395), rows=[
                 row(0, 0.26, 0.735, 0.118, a=0.75, b=1.0, frame='lace', echo=(0.6, 0.3)),
                 row(1, 0.26, 0.655, 0.104, a=0.75, b=1.0, frame='engrave', echo=(0.5,)),
             ]),
             dict(core=0.29, ring=(0.28, 0.26), dots=[(0.305, 32, 0.9, 0.0)], rows=[
                 row(1, 0.15, 0.50, 0.088, a=0.75, b=1.0, frame='lace', echo=(0.5,)),
                 row(0, 0.15, 0.44, 0.070, a=0.75, b=1.0, frame='engrave'),
             ]),
         ],
         opening=dict(n=8, tip=0.22, valley=0.11, b=1.1)),

    dict(id='flower03', kind='flower', name='Wind Comet', n=20, mirror=False,
         note='A chrysanthemum in a strong wind. Thin petals, all turn one way, with a tail.',
         warp=pull(lambda t: 0.74 + 0.85 * pos(s_(t - 0.3)) ** 5, twist=0.30),
         tiers=[
             dict(core=0.50, lines=[(0.515, 0.5)], rows=[
                 row(0, 0.40, 1.00, 0.060, a=0.7, b=1.5, curl=0.55, wob=0.05, frame='engrave', echo=(0.5,),
                     barbs=[(0.55, 0.5, 0.10, 0.016, 1.0), (0.72, 0.45, 0.07, 0.012, 1.0)]),
                 row(1, 0.40, 0.88, 0.056, a=0.7, b=1.5, curl=0.55, wob=0.05, frame='engrave',
                     barbs=[(0.66, 0.5, 0.07, 0.013, 1.0)]),
                 hooks(0.5, 0.56, 0.76, 0.020, curl=1.3), hooks(1.5, 0.56, 0.72, 0.018, curl=1.3),
             ]),
             dict(core=0.38, ring=(0.365, 0.345), rows=[
                 row(1, 0.24, 0.72, 0.052, a=0.7, b=1.5, curl=0.6, frame='lace', echo=(0.5,)),
                 row(0, 0.24, 0.62, 0.048, a=0.7, b=1.5, curl=0.6, frame='engrave'),
             ]),
             dict(core=0.25, ring=(0.245, 0.228), dots=[(0.262, 40, 0.8, 0.0)], rows=[
                 row(0, 0.14, 0.50, 0.040, a=0.7, b=1.5, curl=0.65, frame='lace'),
                 row(1, 0.14, 0.42, 0.036, a=0.7, b=1.5, curl=0.65, frame='engrave'),
             ]),
         ],
         opening=dict(n=10, tip=0.20, valley=0.10, b=1.3, curl=0.6)),

    dict(id='flower04', kind='flower', name='Wing Bloom', n=14,
         note='Wide, like two open wings. Petals like feathers. It fills the wide projector picture.',
         warp=pull(lambda t: 0.60 + 0.80 * ab(s_(t)) ** 2.4),
         tiers=[
             dict(core=0.52, lines=[(0.535, 0.5)], rows=[
                 row(0, 0.42, 1.00, 0.105, a=0.85, b=1.1, frame='engrave', echo=(0.72, 0.48, 0.24),
                     barbs=[(0.56, 0.6, 0.10, 0.018, 1.0), (0.72, 0.55, 0.07, 0.014, 1.0)]),
                 row(1, 0.42, 0.88, 0.095, a=0.85, b=1.1, frame='engrave', echo=(0.66, 0.33),
                     barbs=[(0.66, 0.6, 0.08, 0.016, 1.0)]),
                 hooks(0.5, 0.62, 0.82, 0.026, curl=1.0),
             ]),
             dict(core=0.40, ring=(0.385, 0.362), rows=[
                 row(1, 0.26, 0.74, 0.092, a=0.85, b=1.1, frame='lace', echo=(0.66, 0.33)),
                 row(0, 0.26, 0.64, 0.080, a=0.85, b=1.1, frame='engrave', echo=(0.5,)),
             ]),
             dict(core=0.26, ring=(0.255, 0.236), dots=[(0.275, 28, 0.9, 0.0)], rows=[
                 row(0, 0.15, 0.50, 0.066, a=0.85, b=1.1, frame='lace', echo=(0.5,)),
                 row(1, 0.15, 0.43, 0.056, a=0.85, b=1.1, frame='engrave'),
             ]),
         ],
         opening=dict(n=7, tip=0.20, valley=0.10, b=1.15)),

    dict(id='flower05', kind='flower', name='Tri Lily', n=12,
         note='Three big petals and three small, like a lily. Twelve mirrors inside.',
         warp=pull(lambda t: 0.80 + 0.34 * c(3 * t)),
         tiers=[
             dict(core=0.50, lines=[(0.515, 0.5)], rows=[
                 row(0, 0.30, 1.02, 0.230, n=3, a=0.9, b=1.25, frame='engrave', echo=(0.8, 0.6, 0.4, 0.2),
                     barbs=[(0.42, 0.75, 0.13, 0.024, 1.1), (0.56, 0.7, 0.115, 0.021, 1.1), (0.69, 0.65, 0.095, 0.018, 1.1), (0.81, 0.6, 0.07, 0.014, 1.1)]),
                 row(1, 0.30, 0.96, 0.150, n=3, a=0.9, b=1.4, frame='engrave', echo=(0.66, 0.33),
                     barbs=[(0.50, 0.7, 0.11, 0.020, 1.1), (0.64, 0.65, 0.09, 0.017, 1.1), (0.77, 0.6, 0.07, 0.014, 1.1)]),
                 row(0.5, 0.42, 0.90, 0.070, n=3, a=0.7, b=1.5, curl=0.5, frame='engrave', echo=(0.5,),
                     barbs=[(0.6, 0.6, 0.08, 0.015, 1.0)]),
                 hooks(0.27, 0.56, 0.80, 0.026, curl=-1.0, n=3), hooks(0.73, 0.56, 0.76, 0.024, curl=1.0, n=3),
             ]),
             dict(core=0.40, ring=(0.385, 0.362), rows=[
                 row(1, 0.26, 0.74, 0.105, n=6, a=0.85, b=1.2, frame='lace', echo=(0.66, 0.33)),
                 row(0, 0.26, 0.66, 0.090, n=6, a=0.85, b=1.2, frame='engrave', echo=(0.5,)),
             ]),
             dict(core=0.26, ring=(0.255, 0.236), dots=[(0.275, 36, 0.9, 0.0)], rows=[
                 row(0, 0.15, 0.50, 0.056, a=0.8, b=1.3, frame='lace'),
                 row(1, 0.15, 0.43, 0.050, a=0.8, b=1.3, frame='engrave'),
             ]),
         ],
         opening=dict(n=6, tip=0.21, valley=0.10, b=1.2, short=0.15)),
]

DESIGNS = FLOWERS + GEARS + FLAMES


def main():
    want = set(sys.argv[1:])
    meta_path = os.path.join(HERE, 'fg-options.json')
    meta = {m['id']: m for m in json.load(open(meta_path))} if os.path.exists(meta_path) else {}
    for d in DESIGNS:
        if want and d['id'] not in want:
            continue
        b = build_flower(d) if d['kind'] == 'flower' else d['build'](d)
        write(d, b, meta)
    json.dump([meta[d['id']] for d in DESIGNS if d['id'] in meta], open(meta_path, 'w'))


if __name__ == '__main__':
    main()
