"""Generalized winding number field.

Boolean-based fracture asks "is this point inside the mesh?" and the answer is only defined for a
watertight, manifold, non-self-intersecting surface. The generalized winding number (Jacobson et al.
2013) is defined for ANY triangle soup: it is exactly 1 inside a closed shell, 0 outside, and degrades
smoothly across holes, gaps, flipped faces, duplicate faces and overlapping shells. Thresholding it at
0.5 gives an inside test that keeps working on broken geometry.

A plain evaluation is O(queries x triangles). The triangles are grouped into a k-d partition of small
clusters; a cluster far from the query is replaced by its first-order dipole (area-weighted normal
sum at the cluster centroid) and only near clusters are summed exactly.
"""
import numpy as np

FOUR_PI = 4.0 * np.pi


class WindingField:
    def __init__(self, tris, leaf=32, beta=3.0):
        """tris: (T,3,3) float64, outward-oriented. An empty array gives a field that is 0 everywhere."""
        tris = np.ascontiguousarray(tris, dtype=np.float64).reshape(-1, 3, 3)
        self.beta = beta
        T = len(tris)
        self.count = T
        if T == 0:
            self.K = 0
            return
        cen = tris.mean(axis=1)
        order = np.arange(T)
        stack = [(0, T)]
        leaves = []
        while stack:
            a, b = stack.pop()
            if b - a <= leaf:
                leaves.append((a, b))
                continue
            idx = order[a:b]
            c = cen[idx]
            ax = int(np.argmax(c.max(axis=0) - c.min(axis=0)))
            mid = (b - a) // 2
            part = np.argpartition(c[:, ax], mid)
            order[a:b] = idx[part]
            stack.append((a, a + mid))
            stack.append((a + mid, b))
        leaves.sort()
        self.T = tris[order]
        cen = cen[order]
        e1 = self.T[:, 1] - self.T[:, 0]
        e2 = self.T[:, 2] - self.T[:, 0]
        an = 0.5 * np.cross(e1, e2)                       # area-weighted normal of each triangle
        area = np.linalg.norm(an, axis=1)
        K = len(leaves)
        C = np.empty((K, 3))
        Nk = np.empty((K, 3))
        R = np.empty(K)
        for k, (a, b) in enumerate(leaves):
            ar = area[a:b]
            s = ar.sum()
            c = (cen[a:b] * ar[:, None]).sum(axis=0) / s if s > 0 else cen[a:b].mean(axis=0)
            C[k] = c
            Nk[k] = an[a:b].sum(axis=0)
            R[k] = np.linalg.norm(self.T[a:b].reshape(-1, 3) - c, axis=1).max()
        self.K = K
        self.leaves = leaves
        self.C = C
        self.Nk = Nk
        self.far2 = (beta * R) ** 2
        self.leaf_xyz = [np.ascontiguousarray(self.T[a:b].transpose(1, 2, 0).reshape(9, -1)) for a, b in leaves]

    def _exact(self, p, k):
        """Summed solid angle of leaf k's triangles as seen from each point of p (nq,3), in component form."""
        t = self.leaf_xyz[k]                                     # (9, m): a.xyz, b.xyz, c.xyz
        px = p[:, 0:1]
        py = p[:, 1:2]
        pz = p[:, 2:3]
        ax = t[0] - px
        ay = t[1] - py
        az = t[2] - pz
        bx = t[3] - px
        by = t[4] - py
        bz = t[5] - pz
        cx = t[6] - px
        cy = t[7] - py
        cz = t[8] - pz
        la = np.sqrt(ax * ax + ay * ay + az * az)
        lb = np.sqrt(bx * bx + by * by + bz * bz)
        lc = np.sqrt(cx * cx + cy * cy + cz * cz)
        num = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
        den = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (bx * cx + by * cy + bz * cz) * la + (cx * ax + cy * ay + cz * az) * lb
        return (2.0 * np.arctan2(num, den)).sum(axis=1)

    def query(self, pts):
        """Winding number at each point, shape (Q,)."""
        P = np.ascontiguousarray(pts, dtype=np.float64).reshape(-1, 3)
        Q = len(P)
        out = np.zeros(Q)
        if self.K == 0 or Q == 0:
            return out
        CH = max(64, int(3.0e6 // max(self.K, 1)))
        for s in range(0, Q, CH):
            p = P[s:s + CH]
            d = self.C[None, :, :] - p[:, None, :]
            d2 = (d * d).sum(-1)
            far = d2 > self.far2[None, :]
            with np.errstate(divide='ignore', invalid='ignore'):
                contrib = (d * self.Nk[None]).sum(-1) / (d2 * np.sqrt(d2))
            contrib[~far] = 0.0
            res = contrib.sum(axis=1)
            nq, nk = np.nonzero(~far)
            if len(nq):
                o = np.argsort(nk, kind='stable')
                nq = nq[o]
                nk = nk[o]
                ks, st = np.unique(nk, return_index=True)
                en = np.append(st[1:], len(nk))
                for k, a, b in zip(ks.tolist(), st.tolist(), en.tolist()):
                    qs = nq[a:b]
                    res[qs] += self._exact(p[qs], k)
            out[s:s + CH] = res
        return out / FOUR_PI

    def inside(self, pts, thresh=0.5):
        return self.query(pts) > thresh
