"""Fracture patterns: where the Voronoi sites go.

Even/impact/random patterns draw a POOL of candidate points inside the solid (winding number > 0.5, importance
sampled by a density field), pick sites from it by best-candidate (blue noise: `regularity` trades random for
even) and relax them with Lloyd iterations against the same pool, so the size gradient of an impact survives the
relaxation. Radial, grid, slice and custom patterns build their sites directly.
"""
import math

import numpy as np


# ---------------------------------------------------------------------------------------------------------
# pools
# ---------------------------------------------------------------------------------------------------------
def _voxel_candidates(src, gwn):
    bmin, bmax = src.bmin, src.bmax
    ext = np.maximum(bmax - bmin, 1e-12 * max(src.diag, 1e-12))
    h = (ext.prod() / 9000.0) ** (1.0 / 3.0)
    h = max(h, ext.max() / 36.0)
    dims = np.maximum(1, np.ceil(ext / h)).astype(int)
    ax = [bmin[i] + (np.arange(dims[i]) + 0.5) * h for i in range(3)]
    gx, gy, gz = np.meshgrid(*ax, indexing='ij')
    C = np.stack([gx.ravel(), gy.ravel(), gz.ravel()], axis=1)
    w = gwn.query(C).reshape(dims)
    vox = w > 0.5
    d = vox.copy()
    for a in range(3):
        for s in (1, -1):
            sh = np.roll(vox, s, axis=a)
            idx = [slice(None)] * 3
            idx[a] = slice(0, 1) if s == 1 else slice(-1, None)
            sh[tuple(idx)] = False
            d |= sh
    vi = np.clip(((src.P.reshape(-1, 3) - bmin) / h).astype(int), 0, dims - 1)
    d[vi[:, 0], vi[:, 1], vi[:, 2]] = True
    return bmin, h, np.argwhere(d)


def volume_pool(src, gwn, n, rng, dens):
    bmin, h, cand = _voxel_candidates(src, gwn)
    if len(cand) == 0:
        return np.zeros((0, 3))
    out = []
    have = 0
    for _ in range(60):
        m = max(3 * (n - have), 2000)
        vi = cand[rng.integers(0, len(cand), m)]
        p = bmin + (vi + rng.random((m, 3))) * h
        p = p[gwn.query(p) > 0.5]
        if dens is not None and len(p):
            p = p[rng.random(len(p)) < dens(p)]
        out.append(p)
        have += len(p)
        if have >= n:
            break
    return np.vstack(out)[:n] if out else np.zeros((0, 3))


def surface_pool(src, n, rng, dens):
    cum = np.cumsum(src.area)
    if len(cum) == 0 or cum[-1] <= 0:
        return np.zeros((0, 3))
    out = []
    have = 0
    for _ in range(60):
        m = max(3 * (n - have), 2000)
        t = np.minimum(np.searchsorted(cum, rng.random(m) * cum[-1]), len(cum) - 1)
        r1 = np.sqrt(rng.random(m))
        r2 = rng.random(m)
        a, b, c = src.P[t, 0], src.P[t, 1], src.P[t, 2]
        p = (1 - r1)[:, None] * a + (r1 * (1 - r2))[:, None] * b + (r1 * r2)[:, None] * c
        if dens is not None:
            p = p[rng.random(len(p)) < dens(p)]
        out.append(p)
        have += len(p)
        if have >= n:
            break
    return np.vstack(out)[:n] if out else np.zeros((0, 3))


# ---------------------------------------------------------------------------------------------------------
# selection and relaxation
# ---------------------------------------------------------------------------------------------------------
def best_candidate(pool, count, regularity, rng):
    P = len(pool)
    count = min(count, P)
    if count <= 0:
        return np.zeros((0, 3))
    K = P if regularity >= 0.99 else int(1 + 60 * regularity * regularity)
    first = int(rng.integers(P))
    chosen = [first]
    dmin = np.linalg.norm(pool - pool[first], axis=1)
    for _ in range(count - 1):
        if K >= P:
            j = int(np.argmax(dmin))
        else:
            c = rng.integers(0, P, K)
            j = int(c[np.argmax(dmin[c])])
        chosen.append(j)
        np.minimum(dmin, np.linalg.norm(pool - pool[j], axis=1), out=dmin)
    return pool[chosen].copy()


def lloyd(pool, sites, iters):
    N = len(sites)
    for _ in range(iters):
        near = np.empty(len(pool), np.int64)
        step = max(1, int(4e6 // max(N, 1)))
        for s in range(0, len(pool), step):
            d2 = ((pool[s:s + step, None, :] - sites[None]) ** 2).sum(-1)
            near[s:s + step] = d2.argmin(axis=1)
        cnt = np.bincount(near, minlength=N)
        m = cnt > 0
        for a in range(3):
            sites[m, a] = np.bincount(near, weights=pool[:, a], minlength=N)[m] / cnt[m]
    return sites


# ---------------------------------------------------------------------------------------------------------
# procedural patterns
# ---------------------------------------------------------------------------------------------------------
def _axis_vec(name, custom):
    if name == 'X':
        return np.array([1.0, 0.0, 0.0])
    if name == 'Y':
        return np.array([0.0, 1.0, 0.0])
    if name == 'CUSTOM' and custom is not None and np.linalg.norm(custom) > 0:
        return np.asarray(custom, float) / np.linalg.norm(custom)
    return np.array([0.0, 0.0, 1.0])


def grid_sites(src, count, jitter, rng):
    ext = np.maximum(src.bmax - src.bmin, 1e-3 * src.diag)
    n = (count / ext.prod()) ** (1.0 / 3.0) * ext
    n = np.maximum(1, np.round(n)).astype(int)
    cell = ext / n
    ix, iy, iz = np.meshgrid(np.arange(n[0]), np.arange(n[1]), np.arange(n[2]), indexing='ij')
    idx = np.stack([ix.ravel(), iy.ravel(), iz.ravel()], axis=1)
    return src.bmin + (idx + 0.5) * cell + (rng.random(idx.shape) - 0.5) * jitter * cell


def slice_sites(src, count, jitter, axis, rng):
    a = axis
    proj = src.P.reshape(-1, 3) @ a
    lo, hi = proj.min(), proj.max()
    n = max(1, count)
    t = lo + (np.arange(n) + 0.5 + (rng.random(n) - 0.5) * jitter) * (hi - lo) / n
    c = 0.5 * (src.bmin + src.bmax)
    c = c - a * (c @ a)
    return c + t[:, None] * a


def radial_sites(src, count, center, axis, layers, jitter, rng):
    a = axis
    e = np.zeros(3)
    e[int(np.argmin(np.abs(a)))] = 1.0
    e1 = np.cross(a, e)
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(a, e1)
    corners = np.array([[x, y, z] for x in (src.bmin[0], src.bmax[0]) for y in (src.bmin[1], src.bmax[1]) for z in (src.bmin[2], src.bmax[2])])
    rel = corners - center
    rel = rel - (rel @ a)[:, None] * a
    Rmax = float(np.linalg.norm(rel, axis=1).max()) or src.diag
    proj = src.P.reshape(-1, 3) @ a
    layers = max(1, layers)
    per = max(1, count // layers)

    def ring_plan(kr):
        r = Rmax * ((np.arange(1, kr + 1) / kr) ** 1.35)
        g = np.diff(np.concatenate([[0.0], r]))
        m = np.maximum(4, np.round(2 * math.pi * r / (1.2 * g))).astype(int)
        return r, g, m
    best = min(range(1, 61), key=lambda kr: abs(1 + int(ring_plan(kr)[2].sum()) - per))
    r, g, m = ring_plan(best)
    pts2 = [(0.0, 0.0)]
    for k in range(best):
        th0 = rng.random() * 2 * math.pi
        for j in range(int(m[k])):
            th = th0 + (j + (rng.random() - 0.5) * 0.5 * jitter) * 2 * math.pi / m[k]
            rr = r[k] - g[k] * 0.5 + (rng.random() - 0.5) * 0.3 * jitter * g[k]
            pts2.append((rr * math.cos(th), rr * math.sin(th)))
    pts2 = np.array(pts2)
    out = []
    lo, hi = proj.min(), proj.max()
    c_ax = center - a * (center @ a)
    for l in range(layers):
        t = 0.5 * (lo + hi) if layers == 1 else lo + (l + 0.5) * (hi - lo) / layers
        base = c_ax + a * t
        out.append(base + pts2[:, 0:1] * e1 + pts2[:, 1:2] * e2)
    return np.vstack(out)


# ---------------------------------------------------------------------------------------------------------
# density
# ---------------------------------------------------------------------------------------------------------
def make_density(p, src, rng, weight_fn):
    """Relative density in (0,1] over space, or None when it is flat."""
    boost = p.impact_boost if p.pattern in ('IMPACT',) else 1.0
    var = p.size_variation
    infl = p.weight_influence if weight_fn is not None else 0.0
    if boost <= 1.0 and var <= 0 and infl <= 0:
        return None
    c = np.asarray(p.impact_center, float)
    R = max(p.impact_radius, 1e-9)
    ks = rng.normal(size=(3, 3))
    ks = ks / np.linalg.norm(ks, axis=1, keepdims=True) * (2 * math.pi / max(src.diag * 0.55, 1e-9))
    ph = rng.random(3) * 2 * math.pi

    def dens(P):
        d = np.ones(len(P))
        if boost > 1.0:
            r = np.linalg.norm(P - c, axis=1) / R
            d *= (1.0 + (boost - 1.0) * np.exp(-r * r)) / boost
        if var > 0:
            n = (np.sin(P @ ks[0] + ph[0]) + np.sin(P @ ks[1] + ph[1]) + np.sin(P @ ks[2] + ph[2])) / 3.0
            d *= 1.0 - var * (0.5 - 0.5 * n) * 0.95
        if infl > 0:
            d *= (1.0 - infl) + infl * np.clip(weight_fn(P), 0.0, 1.0)
        return np.maximum(d, 0.01)
    return dens


# ---------------------------------------------------------------------------------------------------------
def generate(src, gwn, p, rng, weight_fn=None):
    """Voronoi sites (N,3) for parameters `p`."""
    kind = p.pattern
    count = max(2, int(p.count))
    if kind == 'CUSTOM':
        pts = np.asarray(p.custom_points, float).reshape(-1, 3) if p.custom_points is not None else np.zeros((0, 3))
        if len(pts) >= 2:
            return pts
        kind = 'EVEN'
    if kind == 'GRID':
        return grid_sites(src, count, p.jitter, rng)
    if kind == 'SLICE':
        return slice_sites(src, count, p.jitter, _axis_vec(p.axis, p.axis_custom), rng)
    if kind == 'RADIAL':
        return radial_sites(src, count, np.asarray(p.impact_center, float), _axis_vec(p.axis, p.axis_custom), p.radial_layers, p.jitter, rng)
    dens = make_density(p, src, rng, weight_fn)
    n_pool = int(min(40000, max(2500, count * 30)))
    surf = 1.0 if not src.solid else (0.0 if p.distribution == 'VOLUME' else (1.0 if p.distribution == 'SURFACE' else p.surface_ratio))
    parts = []
    if surf < 1.0:
        parts.append(volume_pool(src, gwn, int(n_pool * (1.0 - surf)), rng, dens))
    if surf > 0.0:
        parts.append(surface_pool(src, int(n_pool * surf) + 1, rng, dens))
    pool = np.vstack([q for q in parts if len(q)]) if any(len(q) for q in parts) else np.zeros((0, 3))
    if len(pool) < 2:
        pool = surface_pool(src, n_pool, rng, None)
    if len(pool) < 2:
        raise ValueError("Could not find any points inside the mesh to seed the fracture from.")
    reg = 0.0 if kind == 'RANDOM' else p.regularity
    sites = best_candidate(pool, count, reg, rng)
    if kind != 'RANDOM' and p.relax > 0:
        sites = lloyd(pool, sites, p.relax)
    return sites
