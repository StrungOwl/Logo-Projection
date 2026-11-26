# Kaleidoscope tools for the hand drawings in shapes/fire-flower/drawings/.
# A drawing is read as "ink" (0 = paper, 1 = full ink). A wedge of the
# drawing is mirrored and copied around the centre.
import math
import os
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
_cache = {}


def source(name):
    """Ink map of a drawing, and its centre. Radius 1 = 1024 px."""
    if name not in _cache:
        im = cv2.imread(os.path.join(HERE, 'drawings', f'IMG_{name}.png'), cv2.IMREAD_GRAYSCALE)
        ink = 1.0 - im.astype(np.float32) / 255.0
        ink = cv2.GaussianBlur(ink, (0, 0), 2.2)      # removes the brush grain
        _cache[name] = ink
    return _cache[name]


def smooth(x, a, b):
    t = np.clip((x - a) / max(b - a, 1e-6), 0, 1)
    return t * t * (3 - 2 * t)


def kaleido(rings, size=1600, extent=1.06):
    """rings: dicts with src, n, th0 (degrees, start of the wedge, clockwise
    from up), scale (source radius 1 lands at this target radius),
    r0, r1 (target band, fraction of the outer radius), gain.
    Returns the ink image (size x size), radius 1 = size/2/extent px."""
    half = size / 2.0
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    X = (xx - half + 0.5) / half * extent
    Y = (half - yy - 0.5) / half * extent
    rho = np.hypot(X, Y)
    th = np.arctan2(X, Y)                             # clockwise from up
    out = np.zeros((size, size), np.float32)
    for rg in rings:
        ink = source(rg['src'])
        h, w = ink.shape
        n = rg['n']
        step = 2 * math.pi / n
        t = np.mod(th - math.radians(rg.get('turn', 0.0)), step)
        if rg.get('mirror', True):
            t = np.where(t > step / 2, step - t, t)
        a = math.radians(rg.get('th0', 0.0)) + t
        rs = rho / rg.get('scale', 1.0) * 1024.0
        mx = (w / 2.0 + rs * np.sin(a)).astype(np.float32)
        my = (h / 2.0 - rs * np.cos(a)).astype(np.float32)
        s = cv2.remap(ink, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        f = rg.get('fade', 0.03)
        wgt = smooth(rho, rg.get('r0', 0.0) - f, rg.get('r0', 0.0) + f) * (1 - smooth(rho, rg.get('r1', 9.0) - f, rg.get('r1', 9.0) + f))
        if rg.get('r0', 0.0) <= 0:
            wgt = 1 - smooth(rho, rg.get('r1', 9.0) - f, rg.get('r1', 9.0) + f)
        out = np.maximum(out, s * wgt * rg.get('gain', 1.0))
    return out
