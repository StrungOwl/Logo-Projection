# Fire-flower shapes, round 2: draws the mock-up options.
#
#   /home/sydney/logo-shapes/venv/bin/python shapes/fire-flower/make_fire_flowers.py [id ...]
#
# For each option it writes, in this folder:
#   <id>.svg          the projection shape (outline + fire-flower opening)
#   <id>-layers.svg   every cut piece, stacked, as a wood mock-up
#   options.json      names, sizes and the piece outlines (for the mock-up page)
#
# Every design is a mirror pattern (a kaleidoscope): one slice is drawn,
# mirrored, and copied around the centre. A slice is made of flame petals.
# A petal can be solid, or "lace": only its edge stays and the middle is cut
# out, so the layer below shows through.
# These are MOCK-UPS. The cut files (kerf, tabs, real size) come later.
import json
import math
import os
import sys
import numpy as np
from shapely.geometry import Polygon, Point, LineString, MultiPolygon
from shapely.ops import unary_union
from shapely import affinity

HERE = os.path.dirname(os.path.abspath(__file__))
R = 300.0          # mm, nominal outer radius (600 mm piece). Sizes below are fractions of R.


# --------------------------------------------------------------------------
# Building blocks
# --------------------------------------------------------------------------
class Petal:
    def __init__(self, poly, spine):
        self.poly, self.spine = poly, spine


def flame(r0, phi, tip, w, curl=0.0, lean=0.0, a=0.55, b=1.5, wob=0.0, cp=1.7, skew=0.0, n=60):
    """A flame petal. It starts at radius r0, at angle phi (clockwise from up),
    and is (tip - r0) long. w = half width. lean turns the whole petal,
    curl turns the tip (+ = clockwise), wob gives an S shape, b>1 a sharp tip."""
    s = np.linspace(0.0, 1.0, n)
    h = phi + lean + curl * s ** cp + wob * np.sin(2 * np.pi * s) * s
    ds = (tip - r0) * R / (n - 1)
    x = r0 * R * math.sin(phi) + np.concatenate([[0.0], np.cumsum(np.sin(h[:-1]) * ds)])
    y = r0 * R * math.cos(phi) + np.concatenate([[0.0], np.cumsum(np.cos(h[:-1]) * ds)])
    s0 = (s + 0.08) / 1.08
    prof = s0 ** a * (1.0 - s) ** b
    prof = prof / prof.max()
    nx, ny = np.cos(h), -np.sin(h)
    wl, wr = w * R * prof * (1 + skew), w * R * prof * (1 - skew)
    left = np.stack([x - nx * wl, y - ny * wl], axis=1)
    right = np.stack([x + nx * wr, y + ny * wr], axis=1)[::-1]
    poly = Polygon(np.concatenate([left, right])).buffer(0)
    if poly.geom_type == 'MultiPolygon':
        poly = max(poly.geoms, key=lambda g: g.area)
    return Petal(poly, LineString(np.stack([x, y], axis=1)))


def lace(pet, band, rib=0.0, nest=0.0, rib_to=1.0, veins=0, vein_w=0.0045, vein_ang=0.9):
    """Edge of a petal only (the middle is a window). rib = a centre vein,
    nest = a smaller petal inside (with a slot of that width around it),
    veins = side veins, like a leaf."""
    win = pet.poly.buffer(-band * R, join_style='mitre', mitre_limit=3)
    if win.is_empty or win.area < 40:
        return [pet.poly]
    parts = [pet.poly.difference(win)]
    if nest:
        isl = pet.poly.buffer(-(band + nest) * R, join_style='mitre', mitre_limit=3)
        if not isl.is_empty and isl.area > 60:
            parts.append(isl)
            rib = rib or 0.006
    pts = np.array(pet.spine.coords)
    m = len(pts)
    if veins:
        rib = rib or 0.0055
        for j in range(veins):
            i = int(m * (0.20 + 0.50 * j / max(veins - 1, 1)))
            d = pts[min(i + 2, m - 1)] - pts[max(i - 2, 0)]
            d = d / np.hypot(*d)
            for sg in (1, -1):
                c, sn = math.cos(vein_ang * sg), math.sin(vein_ang * sg)
                v = np.array([d[0] * c - d[1] * sn, d[0] * sn + d[1] * c])
                parts.append(LineString([pts[i], pts[i] + v * R * 0.3]).buffer(vein_w * R).intersection(pet.poly))
    if rib:
        line = pet.spine if rib_to >= 1 else LineString(pts[:max(2, int(m * rib_to))])
        parts.append(line.buffer(rib * R, cap_style='flat').intersection(pet.poly))
    return parts


def both(fn):
    """A feature and its mirror twin: fn(sign) with sign = +1 and -1."""
    return [fn(1.0), fn(-1.0)]


def polys(items):
    out = []
    for it in items:
        if isinstance(it, Petal):
            out.append(it.poly)
        elif isinstance(it, (list, tuple)):
            out.extend(polys(it))
        elif it is not None and not it.is_empty:
            out.append(it)
    return out


def around(geom, n, turn=0.0):
    return [affinity.rotate(geom, -(k * 360.0 / n + turn), origin=(0, 0)) for k in range(n)]


def tidy(g, close=1.0, open_=1.1, minhole=14.0):
    """Make it laser-safe: no slits, no slivers, no tiny holes, one piece."""
    g = g.buffer(close, join_style='round').buffer(-close, join_style='round')
    g = g.buffer(-open_, join_style='round').buffer(open_, join_style='round')
    if g.geom_type == 'MultiPolygon':
        g = max(g.geoms, key=lambda p: p.area)
    holes = [h for h in g.interiors if Polygon(h).area >= minhole]
    return Polygon(g.exterior, holes)


def disk(r):
    return Point(0, 0).buffer(r * R, 128)


def dot(r, phi, d):
    return Point(r * R * math.sin(phi), r * R * math.cos(phi)).buffer(d * R, 24)


def piece(n, core, feats, cut=(), hole=None, turn=0.0, close=1.0):
    """One wood piece: a core (radius, or a shape) + the slice features
    copied n times. cut = windows (also copied). hole = the opening."""
    c = disk(core) if isinstance(core, (int, float)) else core
    g = unary_union([c] + around(unary_union(polys(feats)), n, turn))
    if cut:
        g = g.difference(unary_union(around(unary_union(polys(cut)), n, turn)))
    if hole is not None:
        g = g.difference(hole)
    return tidy(g, close=close)


def bloom(n, feats, core=0.0, turn=0.0, soft=1.6):
    """The fire flower (the opening): solid petals, rounded a little."""
    g = unary_union(([disk(core)] if core else []) + around(unary_union(polys(feats)), n, turn))
    g = g.buffer(soft).buffer(-2 * soft).buffer(soft)
    if g.geom_type == 'MultiPolygon':
        g = max(g.geoms, key=lambda p: p.area)
    return Polygon(g.exterior)


def under(op, n, k=0.80, half=True):
    """Opening of the ring below: smaller, and turned half a petal."""
    g = affinity.scale(op, k, k, origin=(0, 0))
    return affinity.rotate(g, 180.0 / n, origin=(0, 0)) if half else g


def rim(op, w):
    """A band that follows the edge of the opening."""
    return op.buffer(w * R, join_style='round')


def bud(r0, phi, tip, w, sepal=0.0, lantern=0.0):
    """A bud on the end of a spike. sepal = two small leaves that hold it,
    lantern = the bud has a window."""
    b = flame(r0, phi, tip, w, a=0.62, b=1.05)
    out = lace(b, lantern) if lantern else [b.poly]
    if sepal:
        out += [flame(r0 - 0.03, phi, r0 - 0.03 + sepal, w * 0.42, lean=s * 0.55, curl=-s * 0.5, b=1.3).poly for s in (1, -1)]
    return out


def compass(n=4, arms=(1.0, 0.905), core=0.58, spike_w=0.12, tongue=0.80, tongue_w=0.126, tcurl=0.53,
            small=0.70, small_w=0.061, bud_w=0.036, sepal=0.0, lantern=0.0, leaflets=0, close=3.2, extra=()):
    """The outline that was liked (old option 4): main spikes with buds,
    shorter spikes between them, and flame tongues that lean to the main
    spikes. n = number of main spikes."""
    H = math.pi / n
    feats = []
    for phi, k in ((0.0, arms[0]), (H, arms[1])):
        feats.append(flame(0.40, phi, 0.93 * k, spike_w, a=0.45, b=1.6))
        feats.append(bud(0.80 * k, phi, 1.0 * k, bud_w, sepal=sepal, lantern=lantern))
        for j in range(leaflets):
            r = (0.70 + 0.055 * j) * k
            feats += both(lambda s: flame(r, phi, r + 0.07, 0.017, lean=s * 0.8, curl=-s * 0.7, b=1.3))
    for f in (0.25, 0.75):
        feats += both(lambda s: flame(0.40, s * f * H, tongue, tongue_w, curl=-s * tcurl, a=0.6, b=1.4))
    for f, c in ((0.125, 0.15), (0.375, 0.37), (0.625, 0.37), (0.875, 0.15)):
        feats += both(lambda s: flame(0.40, s * f * H, small, small_w, curl=-s * c, a=0.6, b=1.2))
    return piece(n, core, feats + list(extra), close=close)


def fireflower(n, tip=0.29, valley=0.17, short=0.0, curl=0.0, b=1.0, fat=1.0):
    """The opening: a flower of flame petals around a round heart.
    valley = radius of the gaps between petals. short > 0 adds shorter
    petals between the long ones. curl turns every tip (wind)."""
    H = math.pi / n
    w = valley * math.sin(H) * 1.12 * fat
    feats = [flame(valley * 0.5, 0, tip, w, curl=curl, a=0.5, b=b)]
    if short:
        feats.append(flame(valley * 0.5, H, short, w * 0.85, curl=curl, a=0.5, b=b))
    return bloom(n, feats, core=valley)


def plate(op, w=0.12):
    """A flower-shaped plate around an opening (the solid heart of a ring)."""
    return op.buffer(w * R, join_style='round')


# --------------------------------------------------------------------------
# The designs. Each returns: base, rings (biggest first), opening.
# H = half of one slice (the angle from a petal to the next gap).
# --------------------------------------------------------------------------
def d_compass_lotus():
    base = compass()
    n = 8; H = math.pi / n
    op = fireflower(n, 0.29, 0.17, b=1.05)
    u = under(op, n)
    ring1 = piece(n, plate(u), [
        lace(flame(0.18, 0, 0.735, 0.118, a=0.75, b=0.95), 0.016, nest=0.017),
        lace(flame(0.18, H, 0.655, 0.104, a=0.75, b=0.95), 0.016, rib=0.006),
    ], hole=u)
    ring2 = piece(n, rim(op, 0.02), [
        lace(flame(0.13, H, 0.50, 0.088, a=0.5, b=0.95), 0.014, rib=0.0055),
        lace(flame(0.13, 0, 0.44, 0.070, a=0.5, b=1.0), 0.013),
    ], hole=op)
    return base, [ring1, ring2], op


def d_sun_dahlia():
    base = compass(n=6, arms=(1.0, 0.88), spike_w=0.085, tongue_w=0.092, small_w=0.046, tongue=0.79, bud_w=0.032)
    n = 12; H = math.pi / n
    op = fireflower(n, 0.28, 0.19, b=1.3)
    u = under(op, n)
    ring1 = piece(n, plate(u), [
        lace(flame(0.2, 0, 0.74, 0.074, a=0.7, b=1.15), 0.013, rib=0.005),
        lace(flame(0.2, H, 0.66, 0.068, a=0.7, b=1.15), 0.013),
        both(lambda s: flame(0.3, s * 0.5 * H, 0.56, 0.022, a=0.5, b=1.4)),
    ], hole=u)
    ring2 = piece(n, rim(op, 0.018), [
        lace(flame(0.17, H, 0.52, 0.060, a=0.45, b=1.15), 0.012, rib=0.005),
        lace(flame(0.17, 0, 0.45, 0.054, a=0.45, b=1.15), 0.012),
        both(lambda s: flame(0.2, s * 0.5 * H, 0.37, 0.02, a=0.5, b=1.3)),
    ], hole=op)
    return base, [ring1, ring2], op


def d_wind_rose():
    base = compass(tcurl=0.62)
    n = 8; H = math.pi / n
    op = fireflower(n, 0.31, 0.16, curl=1.1, b=1.3)
    u = under(op, n, 0.78, half=False)
    ring1 = piece(n, plate(u), [
        lace(flame(0.16, 0, 0.84, 0.105, curl=1.05, a=0.6, b=1.3), 0.016, rib=0.006),
        lace(flame(0.16, H, 0.70, 0.080, curl=1.05, a=0.6, b=1.3), 0.014),
    ], hole=u)
    ring2 = piece(n, rim(op, 0.02), [
        lace(flame(0.12, H * 0.6, 0.56, 0.085, curl=1.15, a=0.5, b=1.3), 0.014, rib=0.0055),
        flame(0.14, -H * 0.4, 0.42, 0.04, curl=1.1, a=0.5, b=1.4),
    ], hole=op)
    return base, [ring1, ring2], op


def d_rose_window():
    base = compass(n=4, leaflets=2)
    n = 8; H = math.pi / n
    op = fireflower(n, 0.28, 0.18, b=0.7)
    u = under(op, n)
    arch = lambda r0, phi, tip, w: flame(r0, phi, tip, w, a=0.5, b=0.62)
    ring1 = piece(n, plate(u), [
        lace(arch(0.2, 0, 0.72, 0.135), 0.016, nest=0.02),
        lace(arch(0.2, H, 0.72, 0.135), 0.016, rib=0.006),
        flame(0.60, 0, 0.78, 0.03, a=0.5, b=1.5), flame(0.60, H, 0.78, 0.03, a=0.5, b=1.5),
    ], hole=u)
    ring2 = piece(n, rim(op, 0.02), [
        lace(arch(0.14, H, 0.47, 0.092), 0.014, rib=0.0055),
        lace(arch(0.14, 0, 0.47, 0.092), 0.014),
        flame(0.40, 0, 0.53, 0.022, a=0.5, b=1.5), flame(0.40, H, 0.53, 0.022, a=0.5, b=1.5),
    ], hole=op)
    return base, [ring1, ring2], op


def d_flame_corona():
    base = compass(n=4, arms=(1.0, 0.82), spike_w=0.105, tongue=0.82, tcurl=0.7)
    n = 8; H = math.pi / n
    op = fireflower(n, 0.31, 0.15, short=0.22, b=1.5)
    u = under(op, n)
    ring1 = piece(n, plate(u), [
        lace(flame(0.16, 0, 0.80, 0.052, a=0.5, b=1.7), 0.012),
        both(lambda s: lace(flame(0.2, s * 0.55 * H, 0.70, 0.066, lean=s * 0.28, curl=-s * 1.0, a=0.6, b=1.4), 0.013, rib=0.005)),
        flame(0.2, H, 0.60, 0.035, a=0.5, b=1.6),
    ], hole=u)
    ring2 = piece(n, rim(op, 0.02), [
        lace(flame(0.12, H, 0.53, 0.04, a=0.5, b=1.7), 0.011),
        both(lambda s: lace(flame(0.16, s * 0.5 * H, 0.47, 0.052, lean=-s * 0.22, curl=s * 0.95, a=0.6, b=1.4), 0.012)),
    ], hole=op)
    return base, [ring1, ring2], op


def d_peacock():
    base = compass(n=5, arms=(1.0, 0.9), spike_w=0.10, tongue_w=0.105, small_w=0.052, leaflets=1)
    n = 10; H = math.pi / n
    op = fireflower(n, 0.28, 0.18, b=1.0)
    u = under(op, n)
    ring1 = piece(n, plate(u), [
        both(lambda s: lace(flame(0.18, s * 0.5 * H, 0.76, 0.085, lean=s * 0.20, curl=-s * 1.35, a=0.6, b=1.05), 0.015, nest=0.016)),
        flame(0.3, 0, 0.72, 0.028, a=0.5, b=1.6),
    ], hole=u)
    ring2 = piece(n, rim(op, 0.02), [
        lace(flame(0.12, H, 0.52, 0.070, a=0.55, b=0.9), 0.013, rib=0.005),
        both(lambda s: flame(0.14, s * 0.35 * H, 0.42, 0.03, lean=-s * 0.1, curl=s * 0.9, b=1.4)),
    ], hole=op)
    return base, [ring1, ring2], op


def d_chrysanthemum():
    base = compass(n=4, spike_w=0.10, tongue_w=0.11, small_w=0.055, leaflets=3, bud_w=0.032)
    n = 12; H = math.pi / n
    op = fireflower(n, 0.26, 0.17, b=1.3)
    u1, u2 = under(op, n), under(op, n, 0.66, half=False)
    row = lambda r0, tip, w, band, c: [
        both(lambda s: lace(flame(r0, s * 0.5 * H, tip, w, lean=s * 0.1, curl=-s * c, a=0.6, b=1.3), band)),
        lace(flame(r0, 0, tip * 0.95, w * 0.9, a=0.6, b=1.3), band)]
    ring1 = piece(n, plate(u2, 0.22), row(0.15, 0.80, 0.048, 0.011, 0.8), hole=u2)
    ring2 = piece(n, plate(u1, 0.10), row(0.14, 0.63, 0.044, 0.011, -0.8), hole=u1)
    ring3 = piece(n, rim(op, 0.018), row(0.13, 0.46, 0.038, 0.010, 0.8), hole=op)
    return base, [ring1, ring2, ring3], op


def d_water_lily():
    base = compass(n=4, arms=(1.0, 0.93), tongue_w=0.14, small_w=0.075, spike_w=0.125)
    n = 8; H = math.pi / n
    op = fireflower(n, 0.30, 0.17, b=0.9)
    u = under(op, n)
    ring1 = piece(n, plate(u), [
        lace(flame(0.18, 0, 0.75, 0.135, a=0.75, b=0.9), 0.02, nest=0.028),
    ], hole=u)
    ring2 = piece(n, rim(op, 0.022), [
        lace(flame(0.13, H, 0.54, 0.108, a=0.6, b=0.9), 0.018, rib=0.007),
    ], hole=op)
    return base, [ring1, ring2], op


def d_fern_wreath():
    base = compass(n=6, arms=(1.0, 0.9), spike_w=0.085, tongue_w=0.09, small_w=0.045, leaflets=3, bud_w=0.03)
    n = 12; H = math.pi / n
    op = fireflower(n, 0.27, 0.18, b=1.2)
    u = under(op, n)
    ring1 = piece(n, plate(u), [
        lace(flame(0.18, 0, 0.77, 0.080, a=0.7, b=1.1, curl=0.22), 0.013, veins=4),
        lace(flame(0.18, H, 0.68, 0.066, a=0.7, b=1.1, curl=0.22), 0.013, veins=3),
    ], hole=u)
    ring2 = piece(n, rim(op, 0.018), [
        lace(flame(0.13, H, 0.51, 0.062, a=0.55, b=1.1), 0.012, veins=3),
        lace(flame(0.13, 0, 0.43, 0.05, a=0.55, b=1.1), 0.012),
    ], hole=op)
    return base, [ring1, ring2], op


def d_star_seed():
    H4 = math.pi / 4
    base = compass(n=4, arms=(1.0, 0.76), spike_w=0.13, tongue=0.78, tcurl=0.75, extra=[
        both(lambda s: bud(0.70, s * 0.5 * H4, 0.80, 0.022))])
    n = 4; H = H4
    op = fireflower(n, 0.33, 0.13, short=0.23, b=1.2, fat=0.75)
    u = under(op, n, 0.8, half=False)
    ring1 = piece(n, plate(u), [
        lace(flame(0.16, 0, 0.80, 0.17, a=0.75, b=1.0), 0.018, nest=0.022),
        lace(flame(0.16, H, 0.66, 0.135, a=0.75, b=1.0), 0.016, rib=0.006),
        both(lambda s: lace(flame(0.25, s * 0.5 * H, 0.66, 0.055, lean=s * 0.1, curl=-s * 1.0, a=0.6, b=1.3), 0.012)),
    ], hole=u)
    H8 = math.pi / 8
    ring2 = piece(8, rim(op, 0.02), [
        lace(flame(0.13, H8, 0.50, 0.085, a=0.55, b=0.95), 0.014, rib=0.0055),
        lace(flame(0.13, 0, 0.44, 0.07, a=0.55, b=1.0), 0.013),
    ], hole=op)
    return base, [ring1, ring2], op


DESIGNS = [
    ('bloom01', 'Compass Lotus', 'The outline you liked. Inside: a lotus of lace petals.', d_compass_lotus),
    ('bloom02', 'Sun Dahlia', 'Six main spikes. Inside: a dahlia with many thin petals.', d_sun_dahlia),
    ('bloom03', 'Wind Rose', 'The outline you liked. Inside: every petal turns in the wind.', d_wind_rose),
    ('bloom04', 'Rose Window', 'Buds with windows, small leaves on the spikes. Inside: round arches, like a church window.', d_rose_window),
    ('bloom05', 'Flame Corona', 'Long and short spikes. Inside: sharp rays, with flames that curl in pairs.', d_flame_corona),
    ('bloom06', 'Peacock', 'Five main spikes. Inside: curled feathers in pairs.', d_peacock),
    ('bloom07', 'Chrysanthemum', 'Small leaves on the spikes. Inside: three rows of thin windy petals. Four pieces.', d_chrysanthemum),
    ('bloom08', 'Water Lily', 'Bold and calm. Few big petals. Most room for the picture.', d_water_lily),
    ('bloom09', 'Fern Wreath', 'Six main spikes with small leaves. Inside: leaves with veins.', d_fern_wreath),
    ('bloom10', 'Star Seed', 'A four-point star, like the star in the logo. Inside: four big petals.', d_star_seed),
]


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------
def path_d(poly, cx, cy):
    out = []
    for ring in [poly.exterior, *poly.interiors]:
        pts = list(ring.coords)[:-1]
        out.append('M' + ' L'.join(f'{cx + x:.2f},{cy - y:.2f}' for x, y in pts) + ' Z')
    return ' '.join(out)


def simp(g, tol=0.12):
    return g.simplify(tol, preserve_topology=True)


def main():
    want = set(sys.argv[1:])
    meta_path = os.path.join(HERE, 'options.json')
    meta = {m['id']: m for m in json.load(open(meta_path))} if os.path.exists(meta_path) else {}
    for oid, name, note, fn in DESIGNS:
        if want and oid not in want:
            continue
        base, rings, op = fn()
        base, rings, op = simp(base), [simp(r) for r in rings], simp(op)
        minx, miny, maxx, maxy = base.bounds
        pad = 12.0
        W, Hh = (maxx - minx) + 2 * pad, (maxy - miny) + 2 * pad
        cx, cy = pad - minx, pad + maxy
        one = lambda ring: path_d(Polygon(ring), cx, cy)
        # 1. Projection shape: outline, the opening, and any windows of the base.
        paths = [one(base.exterior), one(op.exterior)] + [one(h) for h in base.interiors]
        with open(os.path.join(HERE, f'{oid}.svg'), 'w') as f:
            f.write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.1f}mm" height="{Hh:.1f}mm" viewBox="0 0 {W:.1f} {Hh:.1f}">\n'
                    f'<!-- {oid} {name} - projection shape (mock-up). Outline + fire-flower opening. -->\n'
                    + ''.join(f'<path d="{d}" fill="none" stroke="#f00" stroke-width="0.3"/>\n' for d in paths) + '</svg>\n')
        # 2. Wood mock-up: the pieces stacked, with shadows.
        tones = ['#b08050', '#c6986a', '#dab280', '#ecca9c', '#f6dcb4']
        body = [f'<path d="{path_d(base, cx, cy)}" fill="{tones[0]}" fill-rule="evenodd" filter="url(#sh)"/>']
        for i, pc in enumerate(rings):
            body.append(f'<path d="{path_d(pc, cx, cy)}" fill="{tones[min(i + 1, 4)]}" fill-rule="evenodd" filter="url(#sh)"/>')
        with open(os.path.join(HERE, f'{oid}-layers.svg'), 'w') as f:
            f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.1f} {Hh:.1f}">\n'
                    f'<defs><filter id="sh" x="-10%" y="-10%" width="120%" height="120%">'
                    f'<feDropShadow dx="1.6" dy="2.4" stdDeviation="1.7" flood-color="#241206" flood-opacity="0.8"/></filter></defs>\n'
                    + '\n'.join(body) + '\n</svg>\n')
        # 3. Numbers and outlines for the mock-up page.
        thin = []
        for pc in [base] + rings:
            t = pc.buffer(-1.4)
            thin.append(round(100 * (1 - t.buffer(1.4).area / pc.area), 2))
        meta[oid] = dict(
            id=oid, name=name, note=note, pieces=1 + len(rings),
            width=round(maxx - minx, 1), height=round(maxy - miny, 1),
            view=[round(W, 1), round(Hh, 1)], pad=pad,
            windows=sum(len(r.interiors) - 1 for r in rings) + len(base.interiors),
            base=path_d(base, cx, cy), rings=[path_d(r, cx, cy) for r in rings], hole=one(op.exterior),
        )
        print(f'{oid} {name:16s} {maxx - minx:6.1f} x {maxy - miny:6.1f} mm  pieces {1 + len(rings)}  '
              f'windows {meta[oid]["windows"]}  outline pts {len(base.exterior.coords)}  thin-part % {thin}')
    order = [d[0] for d in DESIGNS]
    with open(meta_path, 'w') as f:
        json.dump([meta[i] for i in order if i in meta], f)


if __name__ == '__main__':
    main()
