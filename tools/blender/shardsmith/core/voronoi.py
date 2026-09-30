"""Exact 3D Voronoi cells as convex polyhedra.

Each cell starts as the bounding box and is clipped by the bisector plane of every neighbouring site, nearest
first, until the next site is provably too far away to matter (its bisector lies beyond the farthest cell
vertex). Vertices that land on a clipping plane are treated as ON it, so degenerate arrangements (regular
grids, cospherical sites) do not create slivers or duplicate faces. Intersection points are computed with a
canonical endpoint order, so two faces that share a polyhedron edge produce bit-identical vertices.
"""
import math

from mathutils.kdtree import KDTree


class Cell:
    __slots__ = ('site', 'faces', 'lo', 'hi')

    def __init__(self, site, faces):
        self.site = site
        self.faces = faces    # [(tag, (nx,ny,nz), d, [(x,y,z),...])]  tag >= 0 is the neighbouring site, < 0 the box
        xs = [v[0] for f in faces for v in f[3]]
        ys = [v[1] for f in faces for v in f[3]]
        zs = [v[2] for f in faces for v in f[3]]
        self.lo = (min(xs), min(ys), min(zs))
        self.hi = (max(xs), max(ys), max(zs))


def _isect(a, b, da, db):
    if a > b:
        a, b, da, db = b, a, db, da
    t = da / (da - db)
    return (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2]))


def _box_faces(lo, hi):
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    return [
        [-1, (1.0, 0.0, 0.0), x1, [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)]],
        [-2, (-1.0, 0.0, 0.0), -x0, [(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)]],
        [-3, (0.0, 1.0, 0.0), y1, [(x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)]],
        [-4, (0.0, -1.0, 0.0), -y0, [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)]],
        [-5, (0.0, 0.0, 1.0), z1, [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]],
        [-6, (0.0, 0.0, -1.0), -z0, [(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)]],
    ]


def _cap(points, n, eps):
    """Dedupe the points where a plane cuts a polyhedron and order them CCW around n."""
    pts = []
    tol2 = (4.0 * eps) ** 2
    for p in points:
        for q in pts:
            if (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 <= tol2:
                break
        else:
            pts.append(p)
    if len(pts) < 3:
        return None
    m = len(pts)
    c = (sum(p[0] for p in pts) / m, sum(p[1] for p in pts) / m, sum(p[2] for p in pts) / m)
    ax = min(range(3), key=lambda i: abs(n[i]))
    e = [0.0, 0.0, 0.0]
    e[ax] = 1.0
    u = (n[1] * e[2] - n[2] * e[1], n[2] * e[0] - n[0] * e[2], n[0] * e[1] - n[1] * e[0])
    ul = math.sqrt(u[0] ** 2 + u[1] ** 2 + u[2] ** 2)
    u = (u[0] / ul, u[1] / ul, u[2] / ul)
    v = (n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0])

    def ang(p):
        d = (p[0] - c[0], p[1] - c[1], p[2] - c[2])
        return math.atan2(d[0] * v[0] + d[1] * v[1] + d[2] * v[2], d[0] * u[0] + d[1] * u[1] + d[2] * u[2])
    pts.sort(key=ang)
    return pts


def _clip_faces(faces, n, d, tag, eps):
    """Clip a polyhedron (list of [tag, n, d, poly]) by n.x <= d; returns the new list (or None if untouched)."""
    out = []
    cut = []
    changed = False
    for f in faces:
        poly = f[3]
        ds = [n[0] * v[0] + n[1] * v[1] + n[2] * v[2] - d for v in poly]
        mx = max(ds)
        if mx <= eps:
            for v, dv in zip(poly, ds):
                if -eps <= dv:
                    cut.append(v)
            out.append(f)
            continue
        changed = True
        m = len(poly)
        new = []
        for i in range(m):
            a = poly[i]
            b = poly[(i + 1) % m]
            da = ds[i]
            db = ds[(i + 1) % m]
            sa = -1 if da < -eps else (1 if da > eps else 0)
            sb = -1 if db < -eps else (1 if db > eps else 0)
            if sa <= 0:
                new.append(a)
                if sa < 0 and sb > 0:
                    new.append(_isect(a, b, da, db))
            elif sb < 0:
                new.append(_isect(a, b, da, db))
        for v in new:
            if abs(n[0] * v[0] + n[1] * v[1] + n[2] * v[2] - d) <= eps:
                cut.append(v)
        if len(new) >= 3:
            out.append([f[0], f[1], f[2], new])
    if not changed:
        return None
    capp = _cap(cut, n, eps)
    if capp is not None:
        out.append([tag, n, d, capp])
    return out


def dedupe_sites(sites, tol):
    """Indices of sites to keep (later duplicates within `tol` are dropped)."""
    N = len(sites)
    kd = KDTree(N)
    for i in range(N):
        kd.insert(tuple(sites[i]), i)
    kd.balance()
    keep = []
    dead = set()
    for i in range(N):
        if i in dead:
            continue
        keep.append(i)
        for _, j, _ in kd.find_range(tuple(sites[i]), tol):
            if j > i:
                dead.add(j)
    return keep


def make_tree(sites):
    kd = KDTree(len(sites))
    for i, s in enumerate(sites):
        kd.insert((float(s[0]), float(s[1]), float(s[2])), i)
    kd.balance()
    return kd


def build_cell(i, sites, kd, lo, hi, eps):
    s = (float(sites[i][0]), float(sites[i][1]), float(sites[i][2]))
    faces = _box_faces(lo, hi)
    R = max(math.dist(s, (x, y, z)) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2]))
    N = len(sites)
    k = min(N, 24)
    seen = {i}
    while True:
        res = kd.find_n(s, k)
        stop = False
        for co, j, dist in res:
            if j in seen:
                continue
            if 0.5 * dist > R + eps:
                stop = True
                break
            seen.add(j)
            if dist <= 0:
                continue
            n = ((co[0] - s[0]) / dist, (co[1] - s[1]) / dist, (co[2] - s[2]) / dist)
            d = n[0] * 0.5 * (co[0] + s[0]) + n[1] * 0.5 * (co[1] + s[1]) + n[2] * 0.5 * (co[2] + s[2])
            nf = _clip_faces(faces, n, d, j, eps)
            if nf is not None:
                faces = nf
                R = max(math.dist(s, v) for f in faces for v in f[3])
        if stop or k >= N:
            break
        k = min(N, k * 2)
    return Cell(i, [(f[0], f[1], f[2], f[3]) for f in faces])
