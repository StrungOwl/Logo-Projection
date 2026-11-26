# Free shapes: the ink designs, pulled out of the circle. Still one piece.
#
#   /home/sydney/logo-shapes/venv/bin/python shapes/fire-flower/make_free.py
#
# A design from make_ink_flowers.py is built, then every layer is moved by
# the same smooth "pull" (a warp), so the layers still fit on each other.
# Writes freeNN.svg, freeNN-layers.svg, free-options.json. MOCK-UPS.
import json
import math
import os
import numpy as np
from shapely.ops import transform
from shapely import affinity, segmentize
import make_ink_flowers as ink

HERE = os.path.dirname(os.path.abspath(__file__))
R = 300.0


def pull(g, twist=0.0, lean=0.0, sx=1.0, sy=1.0):
    """g(theta) = how far the edge goes out at each angle (theta clockwise
    from up). The middle moves less than the edge. twist turns the edge
    (a swirl). lean pushes the top sideways (wind)."""
    def fn(x, y):
        x, y = np.asarray(x, float), np.asarray(y, float)
        r = np.hypot(x, y) / R
        th = np.arctan2(x, y)
        t = np.clip(r, 0, 1.2) ** 1.4
        k = 1.0 + (g(th) - 1.0) * t
        th2 = th + twist * t
        X, Y = r * k * np.sin(th2) * R * sx, r * k * np.cos(th2) * R * sy
        X = X + lean * R * (np.clip(Y / R, 0, 2) ** 2)
        return X, Y
    return fn


c, s_, ab = np.cos, np.sin, np.abs
pos = lambda v: np.maximum(v, 0.0)
FREE = [
    ('free01', 'Tall Flame', 'ink04', 'The dahlia, pulled up into one flame that leans in the wind.',
     pull(lambda t: 0.80 + 0.75 * pos(c(t)) ** 3, lean=0.10)),
    ('free02', 'Eye', 'ink05', 'A pointed oval, like an eye or a seed. Points up and down.',
     pull(lambda t: 0.70 + 0.55 * ab(c(t)) ** 2.5)),
    ('free03', 'Four-Point Star', 'ink01', 'Four long points, like the star in the logo.',
     pull(lambda t: 0.66 + 0.60 * ab(c(2 * t)) ** 4)),
    ('free04', 'Wings', 'ink08', 'Wide, like open wings. It fills the wide projector picture.',
     pull(lambda t: 0.62 + 0.75 * ab(s_(t)) ** 2.2 - 0.10 * pos(c(t)) ** 6)),
    ('free05', 'Comet', 'ink03', 'A flower with a tail of petals that streams to one side.',
     pull(lambda t: 0.72 + 0.95 * pos(s_(t - 0.25)) ** 5, twist=0.35)),
    ('free06', 'Trefoil', 'ink10', 'Three big lobes.',
     pull(lambda t: 0.80 + 0.36 * c(3 * t))),
    ('free07', 'Galaxy', 'ink02', 'An oval that swirls. The edge turns, the middle stays.',
     pull(lambda t: 0.72 + 0.50 * ab(s_(t)) ** 2, twist=0.9)),
    ('free08', 'Hanging Bloom', 'ink01', 'A drop shape. Long petals hang down.',
     pull(lambda t: 0.78 + 0.80 * pos(-c(t)) ** 3.5)),
    ('free09', 'Oval Gear', 'ink07', 'A gear that is an oval.',
     pull(lambda t: 1.0 + 0.0 * t, sx=1.0, sy=0.66)),
    ('free10', 'Cam Gear', 'ink06', 'A gear with one side pulled out, like a cam in a machine.',
     pull(lambda t: 0.80 + 0.55 * pos(c(t - 0.6)) ** 2.5)),
]


def main():
    by = {d['id']: d for d in ink.DESIGNS}
    cache, meta = {}, []
    for oid, name, src, note, fn in FREE:
        if src not in cache:
            cache[src] = ink.build(by[src])
        b = cache[src]
        W_ = lambda g: transform(fn, segmentize(g, 1.5)).buffer(0)
        base, plates, op, eng = W_(b['base']), [W_(p) for p in b['plates']], W_(b['op']), W_(b['eng'])
        base, op = ink.fill(base), ink.fill(op)
        plates = [max(p.geoms, key=lambda q: q.area) if p.geom_type == 'MultiPolygon' else p for p in plates]
        minx, miny, maxx, maxy = base.bounds
        f = 2 * R / max(maxx - minx, maxy - miny)
        cx0, cy0 = (minx + maxx) / 2, (miny + maxy) / 2
        F = lambda g: affinity.scale(affinity.translate(g, -cx0, -cy0), f, f, origin=(0, 0)).simplify(0.1)
        base, plates, op, eng = F(base), [F(p) for p in plates], F(op), F(eng)
        minx, miny, maxx, maxy = base.bounds
        pad = 12.0
        W, H = (maxx - minx) + 2 * pad, (maxy - miny) + 2 * pad
        cx, cy = pad - minx, pad + maxy
        P = lambda g: ink.path_d(g, cx, cy)
        with open(os.path.join(HERE, f'{oid}.svg'), 'w') as fh:
            fh.write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.1f}mm" height="{H:.1f}mm" viewBox="0 0 {W:.1f} {H:.1f}">\n'
                     f'<!-- {oid} {name} - projection shape (mock-up). Outline + opening. -->\n'
                     f'<path d="{P(base)}" fill="none" stroke="#f00" stroke-width="0.3"/>\n'
                     f'<path d="{P(op)}" fill="none" stroke="#f00" stroke-width="0.3"/>\n</svg>\n')
        tones = ['#a8733f', '#e6c897', '#6e4424', '#f0d8ae', '#7a4d29']
        body = [f'<path d="{P(base)}" fill="{tones[0]}" filter="url(#sh)"/>',
                f'<path d="{P(eng)}" fill="#4a2c14" fill-rule="evenodd" opacity="0.85"/>']
        body += [f'<path d="{P(pc)}" fill="{tones[min(i + 1, 4)]}" fill-rule="evenodd" filter="url(#sh)"/>' for i, pc in enumerate(plates)]
        with open(os.path.join(HERE, f'{oid}-layers.svg'), 'w') as fh:
            fh.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} {H:.1f}">\n'
                     f'<defs><filter id="sh" x="-10%" y="-10%" width="120%" height="120%">'
                     f'<feDropShadow dx="1.4" dy="2.2" stdDeviation="1.5" flood-color="#241206" flood-opacity="0.8"/></filter></defs>\n'
                     + '\n'.join(body) + '\n</svg>\n')
        meta.append(dict(id=oid, name=name, note=note, src=by[src]['src'] + f' (design {src})', pieces=1 + len(plates),
                         width=round(maxx - minx, 1), height=round(maxy - miny, 1), view=[round(W, 1), round(H, 1)], pad=pad,
                         windows=0, base=P(base), rings=[P(p) for p in plates], hole=P(op), engrave=P(eng)))
        print(f'{oid} {name:16s} {maxx - minx:6.1f} x {maxy - miny:6.1f} mm')
    json.dump(meta, open(os.path.join(HERE, 'free-options.json'), 'w'))


if __name__ == '__main__':
    main()
