"""Interior (cap) faces for one cell.

For each cell wall the cross-section of the surface with that wall is known exactly (the tagged clip edges).
Instead of chasing those segments into closed loops (which is what fails on open or self-intersecting
meshes), the wall polygon is triangulated by a CONSTRAINED DELAUNAY triangulation that has the section
segments as constraints (crossing, overlapping and duplicate segments are split and merged by the CDT), and
each resulting triangle is kept or dropped by the winding-number field at its centroid. Triangles whose winding
number is decisive are classified directly; the ambiguous ones (slivers hugging the rim, where the wall meets
the surface at a grazing angle, or triangles lying in a coplanar face) take the class of their neighbours
across unconstrained edges, strongest first, and only what is still undecided is probed just inside the cell.
A gap in the surface leaves a gap in the cap boundary and nothing else.

Optional roughness: extra points are scattered over the wall and displaced along the wall normal by noise
that fades to zero at the rim. The displacement direction is canonical per pair of cells (from the lower
site index toward the higher), so the two pieces sharing a wall move it identically and never overlap.
"""
import heapq

import numpy as np
from mathutils import geometry, noise, Vector


class Cap:
    __slots__ = ('nbr', 'n', 'verts', 'flat', 'tris', 'nrm', 'u', 'v', 'area')


def _basis(n):
    e = np.zeros(3)
    e[int(np.argmin(np.abs(n)))] = 1.0
    u = np.cross(n, e)
    u /= np.linalg.norm(u)
    return u, np.cross(n, u)


def _dist_to_segments(pts, A, B):
    out = np.empty(len(pts))
    ab = B - A
    ab2 = np.maximum((ab * ab).sum(1), 1e-30)
    step = max(1, int(1.5e6 // max(len(A), 1)))
    for s in range(0, len(pts), step):
        p = pts[s:s + step]
        ap = p[:, None, :] - A[None]
        t = np.clip((ap * ab[None]).sum(-1) / ab2[None], 0.0, 1.0)
        q = A[None] + t[..., None] * ab[None]
        out[s:s + step] = np.sqrt(((p[:, None, :] - q) ** 2).sum(-1)).min(axis=1)
    return out


def build_caps(cell, cc, gwn, eps, delta, o, seed):
    """Caps for every wall of `cell`. `o` carries detail/rough/taper/noise/smooth (see engine.CapOpts)."""
    plans = []
    probes = []
    rng = np.random.default_rng([seed & 0x7fffffff, cell.site])
    for k, (tag, n, d, poly) in enumerate(cc.planes):
        segs = cc.segs[k]
        u, v = _basis(n)
        c0 = poly.mean(axis=0)
        st3 = np.zeros((0, 3))
        if o.detail > 0 and len(poly) >= 3:
            rel = poly - c0
            xy = np.stack([rel @ u, rel @ v], axis=1)
            mn, mx = xy.min(axis=0), xy.max(axis=0)
            h = o.detail
            nx = int((mx[0] - mn[0]) / h) + 1
            ny = int((mx[1] - mn[1]) / h) + 1
            while nx * ny > 2500:
                h *= 1.5
                nx = int((mx[0] - mn[0]) / h) + 1
                ny = int((mx[1] - mn[1]) / h) + 1
            gx, gy = np.meshgrid(mn[0] + (np.arange(nx) + 0.5) * h, mn[1] + (np.arange(ny) + 0.5) * h)
            g = np.stack([gx.ravel(), gy.ravel()], axis=1) + (rng.random((nx * ny, 2)) - 0.5) * 0.7 * h
            ok = np.ones(len(g), bool)
            for i in range(len(xy)):
                a = xy[i]
                b = xy[(i + 1) % len(xy)]
                e = b - a
                el = np.linalg.norm(e)
                if el < 1e-30:
                    continue
                ok &= ((e[0] * (g[:, 1] - a[1]) - e[1] * (g[:, 0] - a[0])) / el) > 0.3 * h
            g = g[ok]
            st3 = c0 + g[:, 0:1] * u + g[:, 1:2] * v
        p = dict(k=k, tag=tag, n=n, u=u, v=v, c0=c0, poly=poly, segs=segs, st3=st3)
        p['probe_lo'] = len(probes)
        probes.append(c0)
        for q in st3:
            probes.append(q)
        p['probe_hi'] = len(probes)
        plans.append(p)
    if not plans:
        return []
    w = gwn.query(np.array(probes))
    cdt_eps = 2.0 * eps

    tri_pts = []
    work = []
    for p in plans:
        lo, hi = p['probe_lo'], p['probe_hi']
        if not p['segs'] and w[lo] <= 0.5:
            continue
        st = p['st3'][w[lo + 1:hi] > 0.5]
        segs = p['segs']
        S = len(segs)
        seg3 = np.array([q for s in segs for q in s]).reshape(-1, 3)
        pts3 = np.vstack([seg3, p['poly'], st])
        rel = pts3 - p['c0']
        pts2 = np.stack([rel @ p['u'], rel @ p['v']], axis=1)
        m = len(p['poly'])
        edges = [(2 * i, 2 * i + 1) for i in range(S)]
        face = list(range(2 * S, 2 * S + m))
        try:
            vo, eo, fo, ov, oe, _ = geometry.delaunay_2d_cdt([Vector((float(a), float(b))) for a, b in pts2], edges, [face], 1, cdt_eps)
            cons = {(min(e), max(e)) for e, o_ in zip(eo, oe) if o_}
        except Exception:
            if S:
                continue
            vo = [Vector((float(a), float(b))) for a, b in pts2[2 * S:2 * S + m]]
            fo = [[0, i, i + 1] for i in range(1, m - 1)]
            ov = [[2 * S + i] for i in range(m)]
            cons = set()
        if not fo:
            continue
        V = np.empty((len(vo), 3))
        for q, (vec, orig) in enumerate(zip(vo, ov)):
            V[q] = pts3[min(orig)] if orig else p['c0'] + vec.x * p['u'] + vec.y * p['v']
        F = np.array([f for f in fo if len(f) == 3], dtype=np.int64).reshape(-1, 3)
        if len(F) == 0:
            continue
        cr = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
        flip = (cr @ p['n']) < 0
        F[flip] = F[flip][:, [0, 2, 1]]
        area = 0.5 * np.abs(cr @ p['n'])
        F = F[area > eps * eps]                              # CDT bridges near-boundary points with zero-area triangles
        if len(F) == 0:
            continue
        cen = V[F].mean(axis=1)
        p['V'] = V
        p['F'] = F
        p['cons'] = cons
        p['t_lo'] = len(tri_pts)
        tri_pts.extend(cen.tolist())
        p['t_hi'] = len(tri_pts)
        work.append(p)
    if not work:
        return []
    tw = gwn.query(np.array(tri_pts)) if tri_pts else np.zeros(0)
    undecided = []
    for p in work:
        p['cls'] = _classify(p['F'], tw[p['t_lo']:p['t_hi']], p['cons'])
        bad = np.nonzero(p['cls'] < 0)[0]
        p['bad'] = bad
        p['bad_lo'] = len(undecided)
        if len(bad):
            undecided.extend((p['V'][p['F'][bad]].mean(axis=1) - delta * p['n']).tolist())
    if undecided:
        uw = gwn.query(np.array(undecided))
        for p in work:
            if len(p['bad']):
                p['cls'][p['bad']] = uw[p['bad_lo']:p['bad_lo'] + len(p['bad'])] > 0.5
    caps = []
    for p in work:
        F = p['F'][p['cls'] > 0]
        if len(F) == 0:
            continue
        used, inv = np.unique(F, return_inverse=True)
        V = p['V'][used].copy()
        F = inv.reshape(-1, 3).astype(np.int64)
        cap = Cap()
        cap.nbr = p['tag']
        cap.n = p['n']
        cap.u = p['u']
        cap.v = p['v']
        cr = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
        cap.area = float(0.5 * np.linalg.norm(cr, axis=1).sum())
        cap.flat = V.copy()                                   # the undisplaced wall: what the collision hull is built from
        if o.rough > 0 and len(V) > 3:
            _rough(cap, V, F, p, cell.site, o, eps)
        cap.verts = V
        cap.tris = F
        cap.nrm = _normals(V, F, p['n'], o.smooth)
        caps.append(cap)
    return caps


def _classify(F, w, cons, tau=0.2):
    """1 inside / 0 outside per triangle; -1 where nothing decisive could be propagated."""
    nT = len(F)
    conf = np.abs(w - 0.5)
    cls = np.full(nT, -1, np.int8)
    dec = conf >= tau
    cls[dec] = w[dec] > 0.5
    if dec.all() or not dec.any():
        return cls
    edge_map = {}
    for t in range(nT):
        a, b, c = F[t].tolist()
        for x, y in ((a, b), (b, c), (c, a)):
            key = (x, y) if x < y else (y, x)
            if key not in cons:
                edge_map.setdefault(key, []).append(t)
    nbrs = [[] for _ in range(nT)]
    for ts in edge_map.values():
        if len(ts) == 2:
            nbrs[ts[0]].append(ts[1])
            nbrs[ts[1]].append(ts[0])
    heap = [(-float(conf[t]), int(t)) for t in np.nonzero(dec)[0]]
    heapq.heapify(heap)
    while heap:
        c, t = heapq.heappop(heap)
        for u in nbrs[t]:
            if cls[u] < 0:
                cls[u] = cls[t]
                heapq.heappush(heap, (c, u))
    return cls


def _rough(cap, V, F, p, site, o, eps):
    """Displace interior cap vertices along the canonical wall normal by rim-faded noise."""
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    key = np.sort(e, axis=1)
    uk, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    rim_e = uk[cnt == 1]
    if len(rim_e) == 0:
        return
    rim_v = np.zeros(len(V), bool)
    rim_v[rim_e.ravel()] = True
    inner = np.nonzero(~rim_v)[0]
    if len(inner) == 0:
        return
    rel = V - p['c0']
    xy = np.stack([rel @ p['u'], rel @ p['v']], axis=1)
    dist = _dist_to_segments(xy[inner], xy[rim_e[:, 0]], xy[rim_e[:, 1]])
    t = np.clip(dist / max(o.taper, 1e-30), 0.0, 1.0)
    fade = t * t * (3.0 - 2.0 * t)
    sgn = 1.0 if site < p['tag'] else -1.0
    f = o.noise
    off = np.array([o.seed % 977 * 0.37, o.seed % 613 * 0.53, o.seed % 389 * 0.71])
    for i, vi in enumerate(inner.tolist()):
        q = Vector(((V[vi] + off) * f).tolist())
        nv = noise.noise(q) + 0.5 * noise.noise(q * 2.13) + 0.25 * noise.noise(q * 4.37)
        V[vi] += p['n'] * (sgn * o.rough * fade[i] * nv / 1.75)


def _normals(V, F, n, smooth):
    N = np.tile(n, (len(V), 1))
    if not smooth:
        return N
    cr = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    acc = np.zeros((len(V), 3))
    for i in range(3):
        np.add.at(acc, F[:, i], cr)
    ln = np.linalg.norm(acc, axis=1)
    ok = ln > 1e-30
    N[ok] = acc[ok] / ln[ok, None]
    return N
