"""Clip the source surface to one Voronoi cell.

This is a triangle-soup clip, not a boolean: it never asks whether the mesh is closed. Triangles fully inside
the cell are kept as they are (vectorised), triangles fully outside are dropped, and the few that straddle a
cell wall are clipped with Sutherland-Hodgman in BARYCENTRIC space so every attribute (normals, UVs, colours)
can be interpolated afterwards from the original corners.

Every polygon edge remembers whether it is an original mesh edge or was created by clipping against cell
plane k. The edges tagged k are exactly the cross-section of the surface with that wall: they are handed to
the cap builder as constraints.

Triangles lying exactly ON a wall are assigned to the side their normal faces away from, so a face coincident
with a cut is kept by one cell and only one.
"""
import numpy as np


class CellClip:
    __slots__ = ('planes', 's_src', 's_bary', 's_pos', 'segs')

    def __init__(self):
        self.planes = []      # [(tag, n(3,), d, poly (m,3))] cell walls that can cut the surface
        self.s_src = np.zeros(0, np.int64)
        self.s_bary = np.zeros((0, 3, 3))
        self.s_pos = np.zeros((0, 3, 3))
        self.segs = []        # per plane: [(pa, pb)] section segments


def _isect(a, b, ba, bb, da, db):
    if a > b:
        a, b, ba, bb, da, db = b, a, bb, ba, db, da
    t = da / (da - db)
    return ((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])),
            (ba[0] + t * (bb[0] - ba[0]), ba[1] + t * (bb[1] - ba[1]), ba[2] + t * (bb[2] - ba[2])))


def _clip_tagged(pos, bar, tag, n0, n1, n2, d, k, eps):
    ds = [n0 * p[0] + n1 * p[1] + n2 * p[2] - d for p in pos]
    st = [(-1 if x < -eps else (1 if x > eps else 0)) for x in ds]
    if max(st) <= 0:
        return pos, bar, tag
    m = len(pos)
    npos, nbar, ntag = [], [], []
    for i in range(m):
        j = i + 1 if i + 1 < m else 0
        sa = st[i]
        sb = st[j]
        if sa <= 0:
            npos.append(pos[i])
            nbar.append(bar[i])
            if sb <= 0:
                ntag.append(k if (sa == 0 and sb == 0) else tag[i])
            elif sa == 0:
                ntag.append(k)
            else:
                ntag.append(tag[i])
                x, xb = _isect(pos[i], pos[j], bar[i], bar[j], ds[i], ds[j])
                npos.append(x)
                nbar.append(xb)
                ntag.append(k)
        elif sb < 0:
            x, xb = _isect(pos[i], pos[j], bar[i], bar[j], ds[i], ds[j])
            npos.append(x)
            nbar.append(xb)
            ntag.append(tag[i])
    return npos, nbar, ntag


def clip_cell(src, cell, eps):
    cc = CellClip()
    lo = np.array(cell.lo)
    hi = np.array(cell.hi)
    cc.planes = [(f[0], np.array(f[1]), float(f[2]), np.array(f[3])) for f in cell.faces if f[0] >= 0]
    K = len(cc.planes)
    cc.segs = [[] for _ in range(K)]
    sel = np.nonzero(np.all(src.tmax >= lo - eps, axis=1) & np.all(src.tmin <= hi + eps, axis=1))[0]
    if len(sel) == 0:
        return cc
    if K == 0:
        whole_idx = sel
        cut_idx = np.zeros(0, np.int64)
        D = None
    else:
        Nk = np.array([p[1] for p in cc.planes])
        Dk = np.array([p[2] for p in cc.planes])
        Ps = src.P[sel]
        D = Ps @ Nk.T - Dk                                   # (m,3,K) signed distance of every corner to every wall
        disc = (D > eps).all(axis=1).any(axis=1)             # entirely beyond some wall
        cop = (np.abs(D) <= eps).all(axis=1)                 # lying on a wall ...
        back = cop & ((src.tn[sel] @ Nk.T) <= 0)             # ... and facing into the cell: belongs to the neighbour
        disc |= back.any(axis=1)
        inside = (D <= eps).all(axis=(1, 2))
        whole = ~disc & inside
        cut = ~disc & ~inside
        whole_idx = sel[whole]
        cut_idx = np.nonzero(cut)[0]
    srcs, barys, poss = [], [], []
    tiny = eps * eps
    if len(cut_idx):
        Dc = D[cut_idx]
        need = (Dc > eps).any(axis=1)                        # walls that actually cut each triangle
        Pc = Ps[cut_idx]
        pl = [(float(p[1][0]), float(p[1][1]), float(p[1][2]), p[2]) for p in cc.planes]
        ident = [(1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)]
        for row in range(len(cut_idx)):
            pos = [tuple(v) for v in Pc[row].tolist()]
            bar = list(ident)
            tag = [-1, -1, -1]
            for k in np.nonzero(need[row])[0].tolist():
                n0, n1, n2, d = pl[k]
                pos, bar, tag = _clip_tagged(pos, bar, tag, n0, n1, n2, d, k, eps)
                if len(pos) < 3:
                    break
            m = len(pos)
            if m < 3:
                continue
            a = np.array(pos)
            t = int(sel[cut_idx[row]])
            for i in range(1, m - 1):
                if 0.5 * np.linalg.norm(np.cross(a[i] - a[0], a[i + 1] - a[0])) < tiny:
                    continue                                    # a collinear sliver: its neighbours already share the long edge
                srcs.append(t)
                barys.append((bar[0], bar[i], bar[i + 1]))
                poss.append((pos[0], pos[i], pos[i + 1]))
            for i in range(m):
                if tag[i] >= 0:
                    pa = pos[i]
                    pb = pos[i + 1 if i + 1 < m else 0]
                    if (pa[0] - pb[0]) ** 2 + (pa[1] - pb[1]) ** 2 + (pa[2] - pb[2]) ** 2 > tiny:
                        cc.segs[tag[i]].append((pa, pb))
    W = len(whole_idx)
    cc.s_src = np.concatenate([whole_idx.astype(np.int64), np.array(srcs, np.int64)])
    cc.s_bary = np.concatenate([np.broadcast_to(np.eye(3), (W, 3, 3)), np.array(barys, float).reshape(-1, 3, 3)])
    cc.s_pos = np.concatenate([src.P[whole_idx], np.array(poss, float).reshape(-1, 3, 3)])
    return cc
