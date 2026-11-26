# Precise drawing kernel for the "flowers and gears" set (make_fg.py).
#
# Everything is drawn as exact curves (no tracing of pictures):
#   1. A design is drawn in "round space" (radius 1 = the outer edge).
#   2. Curves are copied by mirror + rotation (exact symmetry).
#   3. A smooth "pull" moves the curves into the final outline (a flame,
#      a star ...). Only the centre lines move.
#   4. Then the curves get their width, in millimetres. So a line keeps
#      the same exact width everywhere, also where the shape is stretched.
import math
import numpy as np
from shapely.geometry import Polygon, Point, LineString
from shapely.ops import unary_union
from shapely import affinity

R = 300.0          # mm for radius 1 (before the final fit)


# ---------------------------------------------------------------- curves
def prof(s, a=0.6, b=1.4, e=0.06):
    """Width along a petal, 0..1. b > 1 gives a sharp flame tip."""
    p = ((s + e) / (1 + e)) ** a * (1.0 - s) ** b
    return p / p.max()


def spine(r0, phi, length, lean=0.0, curl=0.0, wob=0.0, cp=1.6, n=90):
    """Centre line of a petal or stroke, in round space. It starts at radius
    r0, angle phi (clockwise from up). curl turns the tip (+ = clockwise),
    wob gives an S shape."""
    s = np.linspace(0.0, 1.0, n)
    h = phi + lean + curl * s ** cp + wob * np.sin(2 * np.pi * s) * s
    ds = length / (n - 1)
    x = r0 * math.sin(phi) + np.concatenate([[0.0], np.cumsum(np.sin(h[:-1]) * ds)])
    y = r0 * math.cos(phi) + np.concatenate([[0.0], np.cumsum(np.cos(h[:-1]) * ds)])
    return np.stack([x, y], axis=1)


def petal(r0, phi, r1, W, a=0.6, b=1.4, lean=0.0, curl=0.0, wob=0.0, cp=1.6, n=90, **kw):
    """A petal: centre line + half width W (round units) + shape (a, b)."""
    return dict(sp=spine(r0, phi, r1 - r0, lean, curl, wob, cp, n), W=W, a=a, b=b, **kw)


def spine_xy(p0, heading, length, curl=0.0, wob=0.0, cp=1.6, n=60):
    """Centre line from point p0 (any units). heading clockwise from up."""
    s = np.linspace(0.0, 1.0, n)
    h = heading + curl * s ** cp + wob * np.sin(2 * np.pi * s) * s
    ds = length / (n - 1)
    x = p0[0] + np.concatenate([[0.0], np.cumsum(np.sin(h[:-1]) * ds)])
    y = p0[1] + np.concatenate([[0.0], np.cumsum(np.cos(h[:-1]) * ds)])
    return np.stack([x, y], axis=1)


def barbs(it, specs):
    """Small flames that branch from the sides of a petal (round space).
    specs: (place 0..1 along the petal, angle away from it, length, half
    width, curl back). One on each side."""
    sp = it['sp']
    n = len(sp)
    out = []
    for (sb, ang, length, Wb, cb) in specs:
        i = min(max(int(sb * (n - 1)), 1), n - 2)
        d = sp[i + 1] - sp[i - 1]
        h = math.atan2(d[0], d[1])
        wb = it['W'] * float(prof(np.linspace(0, 1, n), it['a'], it['b'])[i])
        nrm = np.array([math.cos(h), -math.sin(h)])          # to the right
        for sg in (1.0, -1.0):
            start = sp[i] + sg * 0.78 * wb * nrm              # just inside the edge of the petal
            out.append(dict(sp=spine_xy(start, h + sg * ang, length, curl=-sg * cb, n=50), W=Wb, a=0.55, b=1.45))
    return out


def circle(r, n=720, phase=0.0):
    t = np.linspace(0, 2 * np.pi, n, endpoint=False) + phase
    return np.stack([r * np.sin(t), r * np.cos(t)], axis=1)


def turned(pts, ang):
    c, s = math.cos(ang), math.sin(ang)       # clockwise by ang
    return np.stack([pts[:, 0] * c + pts[:, 1] * s, -pts[:, 0] * s + pts[:, 1] * c], axis=1)


def flipped(pts):
    return np.stack([-pts[:, 0], pts[:, 1]], axis=1)


def dih(items, n, mirror=True, turn=0.0):
    """Copy items n times around the centre, each also mirrored.
    An item with axis=True lies on a mirror line (it is its own mirror)."""
    out = []
    for it in items:
        for k in range(n):
            ang = turn + 2 * math.pi * k / n
            for m in ((False, True) if (mirror and not it.get('axis')) else (False,)):
                sp = flipped(it['sp']) if m else it['sp']
                out.append({**it, 'sp': turned(sp, ang)})
    return out


# ------------------------------------------------------------------ pull
def pull(g=None, twist=0.0, lean=0.0, sx=1.0, sy=1.0, power=1.4):
    """Round space -> millimetres. g(theta) = how far the edge goes out at
    each angle. The middle moves less than the edge. twist = swirl,
    lean = the top goes sideways (wind)."""
    def fn(pts):
        x, y = pts[:, 0], pts[:, 1]
        r = np.hypot(x, y)
        th = np.arctan2(x, y)
        t = np.clip(r, 0, 1.3) ** power
        k = 1.0 if g is None else 1.0 + (g(th) - 1.0) * t
        th2 = th + twist * t
        X, Y = r * k * np.sin(th2) * sx, r * k * np.cos(th2) * sy
        X = X + lean * np.clip(Y, 0, 3) ** 2
        return np.stack([X, Y], axis=1) * R
    fn.scale = R
    return fn


def rescale(fn, k):
    """The same pull, k times bigger. Line widths (mm) do not change."""
    g2 = lambda pts: fn(pts) * k
    g2.scale = fn.scale * k
    return g2


# ----------------------------------------------------- width (millimetres)
def normals(c):
    t = np.gradient(c, axis=0)
    t = t / np.maximum(np.hypot(t[:, 0], t[:, 1]), 1e-9)[:, None]
    return np.stack([t[:, 1], -t[:, 0]], axis=1)        # to the right


def ribbon(c, w):
    """Polygon around centre line c (mm) with half width w (mm, per point)."""
    w = np.broadcast_to(np.asarray(w, float), (len(c),))
    nrm = normals(c)
    left, right = c - nrm * w[:, None], c + nrm * w[:, None]
    p = Polygon(np.concatenate([left, right[::-1]]))
    return p if p.is_valid else p.buffer(0)


def pen(n, thin, thick, p=0.9, tip=0.07, tail=0.0):
    """Calligraphy width along a stroke: thin at the ends, thick in the
    middle, a sharp point at the end (tip) and, if tail > 0, at the start."""
    s = np.linspace(0, 1, n)
    w = thin + (thick - thin) * np.sin(np.pi * s) ** p
    w = w * np.clip((1 - s) / tip, 0, 1) ** 0.75
    if tail:
        w = w * np.clip(s / tail, 0, 1) ** 0.75
    return w


def petal_poly(it, warp, inset=0.0, scale=1.0):
    """The filled petal (mm)."""
    c = warp(it['sp'])
    s = np.linspace(0, 1, len(c))
    w = np.maximum(it['W'] * warp.scale * scale * prof(s, it['a'], it['b']) - inset, 0.0)
    return ribbon(c, w)


def petal_frame(it, warp, inset=1.3, thin=0.7, thick=1.5, s0=0.0, s1=1.0):
    """The outline of a petal as two calligraphy strokes (mm). They join
    at the tip (a dark point) and at the base (a stem)."""
    c = warp(it['sp'])
    n = len(c)
    s = np.linspace(0, 1, n)
    w = np.maximum(it['W'] * warp.scale * prof(s, it['a'], it['b']) - inset, 0.0)
    nrm = normals(c)
    i0, i1 = int(s0 * (n - 1)), int(s1 * (n - 1)) + 1
    hw = pen(n, thin, thick)[i0:i1]
    parts = []
    for sg in (-1.0, 1.0):
        edge = (c + nrm * (sg * w)[:, None])[i0:i1]
        parts.append(ribbon(edge, hw))
    return unary_union(parts)


def petal_lines(it, warp, vein=0.5, echo=(), s0=0.10, s1=0.80, hw=0.4):
    """Fine lines inside a petal: a centre vein, and echo lines that follow
    the edge at a fraction of the width."""
    c = warp(it['sp'])
    n = len(c)
    s = np.linspace(0, 1, n)
    w = it['W'] * warp.scale * prof(s, it['a'], it['b'])
    nrm = normals(c)
    i0, i1 = int(s0 * (n - 1)), int(s1 * (n - 1)) + 1
    parts = []
    if vein:
        parts.append(ribbon(c[i0:i1], pen(i1 - i0, 0.15, vein, tail=0.2)))
    for f in echo:
        j0, j1 = int((s0 + 0.06) * (n - 1)), int((s1 - 0.04 - 0.1 * abs(f)) * (n - 1)) + 1
        for sg in (-1.0, 1.0):
            parts.append(ribbon((c + nrm * (sg * f * w)[:, None])[j0:j1], pen(j1 - j0, 0.12, hw, tail=0.25)))
    return parts


def stroke(sp, warp, thin, thick, p=0.9, tip=0.07, tail=0.0):
    c = warp(sp)
    return ribbon(c, pen(len(c), thin, thick, p, tip, tail))


def loop(warp, r, n=720):
    return Polygon(warp(circle(r, n)))


def band(warp, r_out, r_in, n=720):
    return Polygon(warp(circle(r_out, n)), [warp(circle(r_in, n))[::-1]])


def dots(warp, r, count, d, phase=0.0):
    """A ring of small round dots (engraved)."""
    c = warp(circle(r, count, phase))
    return [Point(p).buffer(d, 16) for p in c]


# ---------------------------------------------------------------- cleanup
def solid(g):
    """One piece, no holes."""
    if g.geom_type == 'MultiPolygon':
        g = unary_union([Polygon(p.exterior) for p in g.geoms])
        if g.geom_type == 'MultiPolygon':
            g = max(g.geoms, key=lambda p: p.area)
    return Polygon(g.exterior)


def main_part(g):
    if g.geom_type == 'MultiPolygon':
        g = max(g.geoms, key=lambda p: p.area)
    return g


def crisp(g, r=0.25, minhole=1.5):
    """Remove hair-thin slivers and pin holes. Keeps the corners sharp."""
    g = g.buffer(-r, join_style='mitre', mitre_limit=4).buffer(r, join_style='mitre', mitre_limit=4)
    g = main_part(g)
    if g.is_empty:
        return g
    return Polygon(g.exterior, [h for h in g.interiors if Polygon(h).area >= minhole])


def join_all(parts):
    return unary_union([p for p in parts if p is not None and not p.is_empty])


# ------------------------------------------------------------------ gears
def resample(pts, n):
    """n points at equal distance along a closed line."""
    q = np.vstack([pts, pts[:1]])
    seg = np.hypot(*np.diff(q, axis=0).T)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    t = np.linspace(0.0, cum[-1], n, endpoint=False)
    return np.stack([np.interp(t, cum, q[:, 0]), np.interp(t, cum, q[:, 1])], axis=1)


def ccw(pts):
    x, y = pts[:, 0], pts[:, 1]
    area = 0.5 * np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y)
    return pts if area > 0 else pts[::-1]


def round_corners(g, r):
    """Round the corners a little (inside and outside), like a real cut."""
    return g.buffer(r).buffer(-2 * r).buffer(r)


def gear(pitch, N, tooth='spur', add=None, ded=None, lean=0.0, phase=0.0, skip=None, soft=0.3):
    """A gear on any closed pitch line (mm points). N teeth at equal
    distance along the line. tooth: 'spur' (classic), 'flame' (hooked,
    like a saw or a flame), 'escape' (long thin, like a clock).
    Returns (gear polygon, root polygon, pitch length per tooth)."""
    pts = ccw(np.asarray(pitch, float))
    poly = Polygon(pts)
    p = poly.exterior.length / N
    add = (0.318 * p) if add is None else add
    ded = (0.40 * p) if ded is None else ded
    root = poly.buffer(-ded, join_style='round')
    M = 60
    dense = resample(pts, N * M)
    teeth = []
    for i in range(N):
        j = int(round((i + phase) * M)) % (N * M)
        c = dense[j]
        if skip is not None and skip(c):
            continue
        t = dense[(j + 2) % (N * M)] - dense[(j - 2) % (N * M)]
        t = t / np.hypot(*t)
        nrm = np.array([t[1], -t[0]])                       # outward (line is counter-clockwise)
        L = lambda u, v: c + t * (u * p) + nrm * v
        if tooth == 'spur':
            loc = [(-0.31, -ded - 0.8), (-0.27, -0.25 * ded), (-0.15, add), (0.15, add), (0.27, -0.25 * ded), (0.31, -ded - 0.8)]
            teeth.append(Polygon([L(u, v) for u, v in loc]))
        elif tooth == 'flame':
            h = math.atan2(nrm[0], nrm[1]) + lean
            base = c - nrm * (ded + 0.8)
            sp = spine_xy(base, h, (add + ded + 0.8) * 1.12, curl=lean * 1.6, n=30)
            teeth.append(ribbon(sp, 0.36 * p * prof(np.linspace(0, 1, 30), 0.35, 1.25)))
        else:                                               # escape wheel
            loc = [(-0.30, -ded - 0.8), (lean - 0.02, add), (lean + 0.05, add), (0.10, -ded - 0.8)]
            teeth.append(Polygon([L(u, v) for u, v in loc]))
    g = unary_union([root] + [x if x.is_valid else x.buffer(0) for x in teeth])
    g = main_part(g)
    if soft:
        g = round_corners(g, soft)
    return Polygon(g.exterior), root, p


def ring_gear(center, Rp, N, phase=0.0, soft=0.3):
    """The window of a ring gear: a round hole with teeth that point in."""
    p = 2 * math.pi * Rp / N
    add, ded = 0.318 * p, 0.40 * p
    hole = Point(center).buffer(Rp + ded, 180)
    teeth = []
    for i in range(N):
        a = 2 * math.pi * (i + phase) / N
        pol = lambda r, da: (center[0] + r * math.sin(a + da), center[1] + r * math.cos(a + da))
        r0, r1 = Rp + ded + 0.8, Rp - add
        teeth.append(Polygon([pol(r0, -0.31 * p / Rp), pol(Rp + 0.25 * ded, -0.27 * p / Rp), pol(r1, -0.15 * p / Rp),
                              pol(r1, 0.15 * p / Rp), pol(Rp + 0.25 * ded, 0.27 * p / Rp), pol(r0, 0.31 * p / Rp)]))
    g = hole.difference(unary_union(teeth))
    return round_corners(main_part(g), soft) if soft else main_part(g)


def circle_pts(center, r, n=720):
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    return np.stack([center[0] + r * np.sin(t), center[1] + r * np.cos(t)], axis=1)


def offset_line(poly, inset, w):
    """A thin line that follows the edge of a shape, `inset` mm inside."""
    g = poly.buffer(-inset, join_style='round')
    return g.difference(g.buffer(-w, join_style='round'))


def ticks(poly, inset, count, length, hw=0.3, long_every=0, long_len=0.0):
    """Small marks along the edge of a shape, like on a ruler."""
    g = poly.buffer(-inset, join_style='round')
    pts = ccw(np.array(main_part(g).exterior.coords)[:-1])
    dense = resample(pts, count * 8)
    out = []
    for i in range(count):
        j = i * 8
        c = dense[j]
        t = dense[(j + 2) % len(dense)] - dense[(j - 2) % len(dense)]
        t = t / np.hypot(*t)
        nrm = np.array([t[1], -t[0]])
        ln = long_len if (long_every and i % long_every == 0) else length
        out.append(LineString([c, c - nrm * ln]).buffer(hw, cap_style='flat'))
    return out
