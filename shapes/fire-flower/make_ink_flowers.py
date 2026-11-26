# Fire-flower shapes, round 3: made from the hand drawings.
#
#   /home/sydney/logo-shapes/venv/bin/python shapes/fire-flower/make_ink_flowers.py [--preview] [id ...]
#
# The brush strokes of the drawings (shapes/fire-flower/drawings/) are put
# through a kaleidoscope with 8, 12 or 16 mirrors (the drawings have 4).
# Then the strokes become wood:
#   base    the big back piece. Its edge follows the outer strokes.
#           Its strokes are engraved (burnt lines).
#   plates  smaller pieces on top. Their strokes are cut out (windows).
#   opening the middle strokes, filled: the fire flower.
# Writes <id>.svg (projection shape), <id>-layers.svg (wood mock-up) and
# ink-options.json (for the mock-up page). MOCK-UPS, not cut files.
import json
import math
import os
import sys
import cv2
import numpy as np
from shapely.geometry import Polygon, Point, LineString
from shapely.ops import unary_union, nearest_points
from shapely import affinity
from inklib import kaleido
from make_fire_flowers import fireflower

HERE = os.path.dirname(os.path.abspath(__file__))
R = 300.0
EXT = 1.30
SIZE = 3600


def K(src, n, th0, scale=1.0, r0=0.0, r1=9.0, **kw):
    return dict(src=src, n=n, th0=th0, scale=scale, r0=r0, r1=r1, **kw)


# id, name, note, rings (outside first), plate radii (big to small), opening radius
DESIGNS = [
    dict(id='ink01', name='Flame Crown', src='0070 + 0071', note='Your round drawing, with a row of your windy petals around it. 8 mirrors inside, 16 on the edge.',
         rings=[K('0071', 16, 60, 1.32, r0=1.04, gain=1.6), K('0070', 16, 0, 1.0, r0=0.80, r1=1.04, gain=1.4), K('0070', 8, 0, 1.0, r0=0.30, r1=0.80, gain=1.4), K('0070', 8, 0, 2.0, r1=0.30, gain=1.7)],
         plates=[0.76, 0.48], open=0.19),
    dict(id='ink02', name='Bud Crown', src='0070', note='From your round drawing. 12 mirrors. Buds on the edge.',
         rings=[K('0070', 12, 45, 1.0, r0=0.30, gain=1.6), K('0070', 12, 45, 2.2, r1=0.30, gain=1.5)], plates=[0.74, 0.46], open=0.19),
    dict(id='ink03', name='Zigzag Bloom', src='0070 + 0071', note='Your round drawing, with a row of your flame petals around it. 12 mirrors.',
         rings=[K('0071', 12, 0, 1.30, r0=1.03), K('0070', 12, 15, 1.0, r0=0.32, r1=1.03, gain=1.6), K('0071', 12, 45, 2.6, r1=0.32)],
         plates=[0.74, 0.46], open=0.2),
    dict(id='ink04', name='Fire Dahlia', src='0071', note='From your flower drawing. 12 mirrors inside, 24 on the edge.',
         rings=[K('0071', 24, 0, 1.05, r0=0.80), K('0071', 12, 0, 1.05, r0=0.30, r1=0.80), K('0071', 12, 0, 2.4, r1=0.30)],
         plates=[0.72, 0.48], open=0.2),
    dict(id='ink05', name='Wind Dahlia', src='0071', note='From your flower drawing. 8 mirrors in the middle, 16 on the edge.',
         rings=[K('0071', 16, 60, 1.05, r0=0.62, gain=1.8), K('0071', 8, 60, 1.05, r0=0.30, r1=0.62, gain=1.8), K('0071', 8, 60, 2.2, r1=0.30)],
         plates=[0.72, 0.48], open=0.2, plate_close=28.0),
    dict(id='ink06', name='Sun Gear', src='0068', gear=(36, 24, 12), note='A gear. From your burst drawing. 12 mirrors.',
         rings=[K('0068', 12, 30, 0.80, r0=0.30), K('0068', 12, 30, 1.6, r1=0.30)], plates=[0.72, 0.46], open=0.2),
    dict(id='ink07', name='Feather Gear', src='0068', gear=(32, 16, 8), note='A gear. From your burst drawing. 8 mirrors in the middle, 16 on the edge.',
         rings=[K('0068', 16, 15, 0.85, r0=0.60), K('0068', 8, 15, 0.85, r0=0.30, r1=0.60), K('0068', 8, 15, 1.6, r1=0.30)],
         plates=[0.72, 0.46], open=0.2),
    dict(id='ink08', name='Baroque Bloom', src='0069 + 0071', note='From your tall swirl drawing. 8 mirrors. Heart from your flower drawing.',
         rings=[K('0069', 8, 45, 0.80, r0=0.32), K('0071', 8, 60, 2.3, r1=0.32)], plates=[0.72, 0.46], open=0.19),
    dict(id='ink09', name='Heart Gear', src='0069', gear=(36, 24, 12), note='A gear. From your tall swirl drawing. 12 mirrors.',
         rings=[K('0069', 12, 60, 1.0, r0=0.30), K('0069', 12, 60, 2.0, r1=0.30)], plates=[0.72, 0.46], open=0.2),
    dict(id='ink10', name='Three Drawings', src='0070 + 0068 + 0071', note='A mix of three drawings: buds, a burst ring, a flower heart, and petals on the edge. 12 and 24 mirrors.',
         rings=[K('0071', 24, 0, 1.30, r0=1.06), K('0070', 12, 45, 1.0, r0=0.72, r1=1.06, gain=1.6), K('0068', 12, 30, 0.70, r0=0.33, r1=0.72), K('0071', 12, 45, 2.6, r1=0.33)],
         plates=[0.74, 0.46], open=0.2),
]

THR = 0.22


def disk(r):
    return Point(0, 0).buffer(r * R, 128)


def profile(ink):
    """Mean ink at each radius (0..EXT), 400 steps."""
    size = ink.shape[0]
    half = size / 2.0
    yy, xx = np.mgrid[0:size, 0:size]
    rho = np.hypot(xx - half + 0.5, yy - half + 0.5) / half * EXT
    idx = np.clip((rho / EXT * 400).astype(int), 0, 399)
    s = np.bincount(idx.ravel(), weights=(ink > THR).ravel().astype(float), minlength=400)
    c = np.bincount(idx.ravel(), minlength=400)
    return s / np.maximum(c, 1)


def snap(prof, r, win=0.07):
    """The emptiest radius near r (a gap between rings of strokes)."""
    k = np.convolve(prof, np.ones(7) / 7, mode='same')
    i0, i1 = int((r - win) / EXT * 400), int((r + win) / EXT * 400)
    j = i0 + int(np.argmin(k[i0:i1] + 0.02 * np.abs(np.arange(i0, i1) - (i0 + i1) / 2) / (i1 - i0)))
    return j / 400 * EXT


def vectorize(mask):
    """Binary image -> shapely geometry in mm (y up, centre 0,0)."""
    size = mask.shape[0]
    half = size / 2.0
    k = EXT * R / half
    cs, hier = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    if hier is None:
        return Polygon()
    hier = hier[0]
    polys = []
    for i, c in enumerate(cs):
        if hier[i][3] != -1 or len(c) < 8:
            continue
        ext = [((p[0][0] - half + 0.5) * k, (half - p[0][1] - 0.5) * k) for p in c]
        holes = []
        j = hier[i][2]
        while j != -1:
            if len(cs[j]) >= 8:
                holes.append([((p[0][0] - half + 0.5) * k, (half - p[0][1] - 0.5) * k) for p in cs[j]])
            j = hier[j][0]
        p = Polygon(ext, holes).buffer(0)
        if not p.is_empty and p.area > 3.0:
            polys.append(p)
    g = unary_union(polys).simplify(0.12, preserve_topology=True)
    return g.buffer(0.3, join_style='round').buffer(-0.15, join_style='round')


def fill(g):
    """Every part without its holes, then the biggest part."""
    if g.geom_type == 'MultiPolygon':
        g = unary_union([Polygon(p.exterior) for p in g.geoms])
        if g.geom_type == 'MultiPolygon':
            g = max(g.geoms, key=lambda p: p.area)
    return Polygon(g.exterior)


def closing(g, d):
    return g.buffer(d, join_style='round').buffer(-d, join_style='round')


def bridged(g, minarea=45.0, w=1.4):
    """Keep the loose islands: tie each one to the main part with a bridge."""
    if g.geom_type != 'MultiPolygon':
        return g
    parts = sorted(g.geoms, key=lambda p: -p.area)
    main = parts[0]
    todo = [p for p in parts[1:] if p.area >= minarea]
    for _ in range(6):                         # islands behind islands
        rest = []
        add = []
        for isl in todo:
            a, b = nearest_points(isl, main)
            if a.distance(b) > 14.0:
                rest.append(isl)
                continue
            dx, dy = b.x - a.x, b.y - a.y
            L = math.hypot(dx, dy) or 1.0
            ex, ey = dx / L * 1.6, dy / L * 1.6
            add += [isl, LineString([(a.x - ex, a.y - ey), (b.x + ex, b.y + ey)]).buffer(w)]
        if not add:
            break
        main = unary_union([main] + add)
        if main.geom_type == 'MultiPolygon':
            main = max(main.geoms, key=lambda p: p.area)
        todo = rest
    return main


def roundness(g):
    return 4 * math.pi * g.area / (g.length ** 2)


def opening(S, r_open, n, gap=4.5):
    """The fire flower in the middle.
    1. Ink in the centre: that ink, filled (a star of strokes).
    2. No ink in the centre: the empty heart that the first strokes enclose.
    3. If that is only a plain circle: a flame flower with n petals."""
    heart = disk(0.05)
    lim = disk(r_open + 0.06)
    cand = None
    if S.intersection(heart).area > 0.3 * heart.area:
        cand = fill(closing(S.intersection(disk(r_open)), 6.0)).buffer(1.6)
    else:
        free = lim.difference(S.buffer(gap))
        parts = [free] if free.geom_type == 'Polygon' else list(free.geoms)
        mid = [g for g in parts if g.contains(Point(0, 0))]
        if mid:
            g = fill(mid[0]).buffer(gap - 2.2, join_style='mitre', mitre_limit=2.5).intersection(lim)
            cand = fill(g.buffer(-1.2).buffer(1.2))
    if cand is not None and not cand.is_empty and roundness(cand) < 0.62 and cand.area > 0.35 * disk(r_open).area:
        return cand, 'strokes'
    k = n if n <= 10 else n // 2
    return fireflower(k, tip=r_open + 0.05, valley=(r_open + 0.05) * 0.5, short=(r_open + 0.05) * 0.72, curl=0.35, b=1.25), 'flame flower'


def hug(Sx, core, close_d=16.0, shrink=6.0, fat=1.8):
    """A piece whose edge follows the strokes: a smooth body that stays
    inside the stroke tips, plus the strokes themselves. The tips stick out."""
    body = fill(closing(unary_union([Sx, disk(core)]), close_d)).buffer(-shrink)
    g = closing(unary_union([body, Sx.buffer(fat)]), 2.0)
    g = fill(g)
    return fill(g.buffer(-0.6).buffer(0.6))


def gear(root, teeth, depth=0.07):
    """A gear outline. root = radius at the bottom of the teeth (fraction of R)."""
    pts = []
    step = 2 * math.pi / teeth
    r0, r1 = root * R, (root + depth) * R
    for i in range(teeth):
        a = i * step
        for f, r in ((0.00, r0), (0.20, r0), (0.31, r1), (0.69, r1), (0.80, r0)):
            pts.append((r * math.sin(a + f * step), r * math.cos(a + f * step)))
    g = Polygon(pts)
    return g.buffer(1.4).buffer(-2.8).buffer(1.4)


def reach(g):
    """Biggest distance from the centre, as a fraction of R."""
    x0, y0, x1, y1 = g.bounds
    c = np.array(g.convex_hull.exterior.coords)
    return float(np.hypot(c[:, 0], c[:, 1]).max()) / R


def build(d, size=SIZE):
    ink = kaleido(d['rings'], size=size, extent=EXT)
    prof = profile(ink)
    S = vectorize(ink > THR)
    n_in = d['rings'][-1]['n']
    teeth = d.get('gear')
    # Fit: the finished piece has radius R.
    room = (0.012 + 0.075) if teeth else 0.008
    f = (1.0 - room) / reach(S) if teeth else 0.992 / reach(S)
    S = affinity.scale(S, f, f, origin=(0, 0))
    cuts = [snap(prof, r) * f for r in d['plates']]
    r_open = snap(prof, d['open'], 0.04) * f
    op, op_kind = opening(S, r_open, n_in)
    op = op.simplify(0.15)
    rings_eng = []
    if teeth:
        root = reach(S) + 0.012
        base = gear(root, teeth[0], 0.075)
        rings_eng.append(disk(root - 0.006).difference(disk(root - 0.006 - 0.004)))
        outs = []
        for r, t in zip(cuts, teeth[1:]):
            rr = reach(S.intersection(disk(r))) + 0.012
            outs.append(gear(rr, t, 0.06))
    else:
        base = hug(S, 0.6, d.get('close', 17.0), d.get('shrink', 6.5))
        outs = [hug(S.intersection(disk(r)), max(min(r * 0.5, 0.3), r_open + 0.13), d.get('plate_close', 15.0), 5.5)
                for r in cuts]
    # Each plate is solid and light. On top of it sits a "lace" piece: the
    # strokes themselves, raised, in a darker wood, held by a rim.
    # (Lesson from layered laser-cut fine art: raised webs with deep gaps,
    # more layers, and a tone change from layer to layer.)
    plates = []
    for i, P in enumerate(outs):
        top = i == len(outs) - 1
        depth = len(outs) - 1 - i
        hole = affinity.rotate(affinity.scale(op, 0.82 ** depth, 0.82 ** depth, origin=(0, 0)), (180.0 / n_in) * (depth % 2), origin=(0, 0))
        solid = P.difference(hole)
        if solid.geom_type == 'MultiPolygon':
            solid = max(solid.geoms, key=lambda q: q.area)
        plates.append(solid.simplify(0.12, preserve_topology=True))
        rim = P.difference(P.buffer(-2.6))
        if top:
            inner = hole.buffer(4.2)
            keep = P
        else:
            nxt = outs[i + 1]
            inner = nxt.buffer(-0.5).difference(nxt.buffer(-7.0))
            keep = P.difference(nxt.buffer(-7.0))
        web = S.buffer(0.55).intersection(P.buffer(-0.4)).intersection(keep)
        g = unary_union([rim, inner, web]).difference(hole)
        g = bridged(g, minarea=18.0, w=1.0)
        g = g.buffer(-0.3).buffer(0.3)
        g = bridged(g, minarea=1e9) if g.geom_type == 'MultiPolygon' else g
        if g.geom_type == 'MultiPolygon':
            g = max(g.geoms, key=lambda q: q.area)
        holes = [h for h in g.interiors if Polygon(h).area >= 4.0]
        plates.append(Polygon(g.exterior, holes).simplify(0.12, preserve_topology=True))
    # Engraved strokes on the base (only where the base shows).
    eng = unary_union([S.intersection(base.buffer(-1.6))] + rings_eng).difference(outs[0].buffer(1.0)).simplify(0.12)
    return dict(ink=ink, base=base.simplify(0.12), plates=plates, op=op, eng=eng, cuts=cuts, r_open=r_open, op_kind=op_kind)


def path_d(geom, cx, cy):
    out = []
    polys = [geom] if geom.geom_type == 'Polygon' else [g for g in getattr(geom, 'geoms', []) if g.geom_type == 'Polygon']
    for poly in polys:
        for ring in [poly.exterior, *poly.interiors]:
            pts = list(ring.coords)[:-1]
            out.append('M' + ' L'.join(f'{cx + x:.2f},{cy - y:.2f}' for x, y in pts) + ' Z')
    return ' '.join(out)


def preview(want):
    tiles = []
    for d in DESIGNS:
        if want and d['id'] not in want:
            continue
        s = 520
        ink = kaleido(d['rings'], size=s, extent=EXT)
        prof = profile(cv2.resize(ink, (800, 800)))
        img = cv2.cvtColor((255 * (1 - np.clip(ink * 1.7, 0, 1))).astype(np.uint8), cv2.COLOR_GRAY2BGR)
        for r, col in [(snap(prof, r), (0, 0, 255)) for r in d['plates']] + [(snap(prof, d['open'], 0.04), (0, 160, 0))]:
            cv2.circle(img, (s // 2, s // 2), int(r / EXT * s / 2), col, 1)
        cv2.putText(img, f"{d['id']} {d['name']}", (6, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)
        tiles.append(img)
    while len(tiles) % 5:
        tiles.append(np.full_like(tiles[0], 255))
    rows = [np.hstack(tiles[i:i + 5]) for i in range(0, len(tiles), 5)]
    out = os.environ.get('PREVIEW', os.path.join(HERE, '_ink-preview.png'))
    cv2.imwrite(out, np.vstack(rows))
    print('wrote', out)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    want = set(args)
    if '--preview' in sys.argv:
        return preview(want)
    meta_path = os.path.join(HERE, 'ink-options.json')
    meta = {m['id']: m for m in json.load(open(meta_path))} if os.path.exists(meta_path) else {}
    for d in DESIGNS:
        oid = d['id']
        if want and oid not in want:
            continue
        b = build(d)
        base, plates, op, eng = b['base'], b['plates'], b['op'], b['eng']
        minx, miny, maxx, maxy = base.bounds
        pad = 12.0
        W, Hh = (maxx - minx) + 2 * pad, (maxy - miny) + 2 * pad
        cx, cy = pad - minx, pad + maxy
        with open(os.path.join(HERE, f'{oid}.svg'), 'w') as f:
            f.write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.1f}mm" height="{Hh:.1f}mm" viewBox="0 0 {W:.1f} {Hh:.1f}">\n'
                    f'<!-- {oid} {d["name"]} - projection shape (mock-up). Outline + fire-flower opening. -->\n'
                    f'<path d="{path_d(base, cx, cy)}" fill="none" stroke="#f00" stroke-width="0.3"/>\n'
                    f'<path d="{path_d(op, cx, cy)}" fill="none" stroke="#f00" stroke-width="0.3"/>\n</svg>\n')
        tones = ['#a8733f', '#e6c897', '#6e4424', '#f0d8ae', '#7a4d29']
        body = [f'<path d="{path_d(base, cx, cy)}" fill="{tones[0]}" filter="url(#sh)"/>',
                f'<path d="{path_d(eng, cx, cy)}" fill="#4a2c14" fill-rule="evenodd" opacity="0.85"/>']
        for i, pc in enumerate(plates):
            body.append(f'<path d="{path_d(pc, cx, cy)}" fill="{tones[min(i + 1, 4)]}" fill-rule="evenodd" filter="url(#sh)"/>')
        with open(os.path.join(HERE, f'{oid}-layers.svg'), 'w') as f:
            f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} {Hh:.1f}">\n'
                    f'<defs><filter id="sh" x="-10%" y="-10%" width="120%" height="120%">'
                    f'<feDropShadow dx="1.4" dy="2.2" stdDeviation="1.5" flood-color="#241206" flood-opacity="0.8"/></filter></defs>\n'
                    + '\n'.join(body) + '\n</svg>\n')
        meta[oid] = dict(
            id=oid, name=d['name'], note=d['note'], src=d['src'], pieces=1 + len(plates),
            width=round(maxx - minx, 1), height=round(maxy - miny, 1), view=[round(W, 1), round(Hh, 1)], pad=pad,
            windows=sum(len(p.interiors) - 1 for p in plates),
            base=path_d(base, cx, cy), rings=[path_d(p, cx, cy) for p in plates], hole=path_d(op, cx, cy),
            engrave=path_d(eng, cx, cy),
        )
        print(f'{oid} {d["name"]:15s} {maxx - minx:6.1f} x {maxy - miny:6.1f} mm  pieces {1 + len(plates)}  windows {meta[oid]["windows"]}'
              f'  plate radii {[round(c, 2) for c in b["cuts"]]}  opening {b["r_open"]:.2f} ({b["op_kind"]})  outline pts {len(base.exterior.coords)}')
    with open(meta_path, 'w') as f:
        json.dump([meta[d['id']] for d in DESIGNS if d['id'] in meta], f)


if __name__ == '__main__':
    main()
