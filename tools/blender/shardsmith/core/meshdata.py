"""Reading a Blender mesh into a flat numpy triangle soup, then analysing and repairing it.

The soup keeps ATTRIBUTES PER CORNER (position, shading normal, UVs, colours) exactly as Blender stores
them, and a separate welded vertex id per corner that is used for topology only (health checks, orientation,
duplicate cancelling). Output pieces are built from the original corners, so UV seams, hard edges and custom
normals survive the fracture untouched.
"""
import numpy as np

from .gwn import WindingField


class Source:
    """A triangle soup in WORLD space."""

    def __init__(self):
        self.name = ''
        self.mats = []            # material per slot (may hold None)
        self.P = None             # (T,3,3) corner positions
        self.N = None             # (T,3,3) corner shading normals (unit)
        self.M = None             # (T,) material slot
        self.uvs = []             # [(name, (T,3,2))]
        self.cols = []            # [(name, (T,3,4))]
        self.report = {}          # health report of the RAW mesh
        self.solid = True         # resolved interior mode
        self.gwn = None           # WindingField of the prepared soup, when prepare() needed one
        self.volume = 0.0

    @property
    def T(self):
        return len(self.P)

    def refresh(self):
        P = self.P
        self.tmin = P.min(axis=1)
        self.tmax = P.max(axis=1)
        self.bmin = self.tmin.min(axis=0)
        self.bmax = self.tmax.max(axis=0)
        self.diag = float(np.linalg.norm(self.bmax - self.bmin))
        cr = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
        ln = np.linalg.norm(cr, axis=1)
        self.area = 0.5 * ln
        with np.errstate(divide='ignore', invalid='ignore'):
            tn = cr / ln[:, None]
        tn[~np.isfinite(tn).all(axis=1)] = (0.0, 0.0, 1.0)
        self.tn = tn

    def take(self, idx):
        self.P = self.P[idx]
        self.N = self.N[idx]
        self.M = self.M[idx]
        self.uvs = [(n, a[idx]) for n, a in self.uvs]
        self.cols = [(n, a[idx]) for n, a in self.cols]

    def subset(self, idx):
        """A new Source holding only the triangles `idx` (shares the material list)."""
        o = Source()
        o.name, o.mats, o.solid, o.volume, o.report = self.name, self.mats, self.solid, self.volume, self.report
        o.P, o.N, o.M = self.P[idx], self.N[idx], self.M[idx]
        o.uvs = [(n, a[idx]) for n, a in self.uvs]
        o.cols = [(n, a[idx]) for n, a in self.cols]
        o.refresh()
        return o

    def flip(self, mask):
        """Reverse the winding of the masked triangles (swap corners 1 and 2, negate the shading normal)."""
        if not mask.any():
            return
        sw = [0, 2, 1]
        self.P[mask] = self.P[mask][:, sw]
        self.N[mask] = -self.N[mask][:, sw]
        for i, (n, a) in enumerate(self.uvs):
            a[mask] = a[mask][:, sw]
        for i, (n, a) in enumerate(self.cols):
            a[mask] = a[mask][:, sw]


# ---------------------------------------------------------------------------------------------------------
# reading
# ---------------------------------------------------------------------------------------------------------
def _get(coll, attr, n, dtype=np.float32, per=1):
    a = np.empty(n * per, dtype)
    coll.foreach_get(attr, a)
    return a


def extract(context, obj, use_modifiers=True):
    """Read an object's (optionally modifier-evaluated) mesh into a world-space Source."""
    import bpy
    if use_modifiers:
        dg = context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    else:
        me = obj.data.copy()
    try:
        return _from_mesh(me, obj)
    finally:
        bpy.data.meshes.remove(me)


def _from_mesh(me, obj):
    src = Source()
    src.name = obj.name
    src.mats = [s.material for s in obj.material_slots]
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    nl = len(me.loops)
    nv = len(me.vertices)
    if nt == 0:
        raise ValueError("The object has no faces to fracture.")
    tv = _get(me.loop_triangles, 'vertices', nt, np.int32, 3).reshape(nt, 3)
    tl = _get(me.loop_triangles, 'loops', nt, np.int32, 3).reshape(nt, 3)
    M = _get(me.loop_triangles, 'material_index', nt, np.int32)
    co = _get(me.vertices, 'co', nv, np.float64, 3).reshape(nv, 3)
    mw = np.array(obj.matrix_world, dtype=np.float64)
    A = mw[:3, :3]
    t = mw[:3, 3]
    src.P = co[tv] @ A.T + t
    try:
        cn = _get(me.corner_normals, 'vector', nl, np.float64, 3).reshape(nl, 3)
    except Exception:
        cn = np.zeros((nl, 3))
        me.calc_normals_split()
        me.loops.foreach_get('normal', cn.reshape(-1))
    nm = np.linalg.inv(A).T
    N = cn[tl] @ nm.T
    ln = np.linalg.norm(N, axis=2, keepdims=True)
    ln[ln == 0] = 1.0
    src.N = N / ln
    src.M = np.clip(M, 0, max(len(src.mats) - 1, 0)) if src.mats else np.zeros(nt, np.int32)
    for uvl in me.uv_layers:
        try:
            a = _get(uvl.uv, 'vector', nl, np.float64, 2)
        except Exception:
            a = _get(uvl.data, 'uv', nl, np.float64, 2)
        src.uvs.append((uvl.name, a.reshape(nl, 2)[tl]))
    for ca in me.color_attributes:
        try:
            if ca.domain == 'CORNER':
                a = _get(ca.data, 'color', nl, np.float64, 4).reshape(nl, 4)[tl]
            else:
                a = _get(ca.data, 'color', nv, np.float64, 4).reshape(nv, 4)[tv]
        except Exception:
            continue
        src.cols.append((ca.name, a))
    ok = np.isfinite(src.P).all(axis=(1, 2))
    if not ok.all():
        src.take(np.nonzero(ok)[0])
    src.refresh()
    return src


# ---------------------------------------------------------------------------------------------------------
# topology helpers (welded ids)
# ---------------------------------------------------------------------------------------------------------
def weld_ids(P, tol, robust=False):
    """Welded vertex id per corner. P is (T,3,3); returns ((T,3) ids, count).

    `robust` merges every pair of points closer than tol/2 even when a rounding boundary falls between them
    (eight half-cell-shifted grids, then a union of their groups); plain rounding is enough for exact duplicates."""
    pts = P.reshape(-1, 3)
    n = len(pts)
    if tol <= 0:
        _, inv = np.unique(pts, axis=0, return_inverse=True)
        inv = inv.reshape(-1)
        return inv.reshape(-1, 3).astype(np.int64), int(inv.max()) + 1
    q = pts / tol
    labs = []
    for sx in (0.0, 0.5):
        for sy in (0.0, 0.5):
            for sz in (0.0, 0.5):
                k = np.floor(q + np.array([sx, sy, sz])).astype(np.int64)
                _, lab = np.unique(k, axis=0, return_inverse=True)
                labs.append(lab.reshape(-1))
                if not robust:
                    break
            if not robust:
                break
        if not robust:
            break
    comp = np.arange(n)
    if robust:
        for _ in range(12):
            before = comp.copy()
            for lab in labs:
                m = np.full(int(lab.max()) + 1, n, np.int64)
                np.minimum.at(m, lab, comp)
                comp = np.minimum(comp, m[lab])
            comp = comp[comp]
            if (comp == before).all():
                break
        _, inv = np.unique(comp, return_inverse=True)
        inv = inv.reshape(-1)
    else:
        inv = labs[0]
    return inv.reshape(-1, 3).astype(np.int64), int(inv.max()) + 1


def degenerate_mask(ids, area, tiny):
    return (ids[:, 0] == ids[:, 1]) | (ids[:, 1] == ids[:, 2]) | (ids[:, 0] == ids[:, 2]) | (area <= tiny)


def edge_runs(ids, nv):
    """Group the directed edges of a welded triangle list into undirected edges.

    Returns dict(order, starts, sizes, tri, ea, eb): `order` sorts the valid edge slots by edge key,
    `starts`/`sizes` delimit each undirected edge, `tri`/`ea`/`eb` describe every slot (3 per triangle)."""
    T = len(ids)
    ea = ids.reshape(-1)
    eb = np.roll(ids, -1, axis=1).reshape(-1)
    tri = np.repeat(np.arange(T), 3)
    good = np.nonzero(ea != eb)[0]
    lo = np.minimum(ea[good], eb[good])
    hi = np.maximum(ea[good], eb[good])
    key = lo * np.int64(nv) + hi
    o = np.argsort(key, kind='stable')
    slots = good[o]
    ks = key[o]
    if len(ks) == 0:
        z = np.zeros(0, np.int64)
        return dict(slots=slots, starts=z, sizes=z, tri=tri, ea=ea, eb=eb)
    brk = np.nonzero(np.diff(ks))[0] + 1
    starts = np.concatenate([[0], brk])
    sizes = np.diff(np.concatenate([starts, [len(ks)]]))
    return dict(slots=slots, starts=starts, sizes=sizes, tri=tri, ea=ea, eb=eb)


def signed_volume(P):
    """Signed volume of a triangle soup, (T,3,3)."""
    return float(np.einsum('ti,ti->t', P[:, 0], np.cross(P[:, 1], P[:, 2])).sum() / 6.0)


def cancel_duplicates(ids, nv):
    """Coincident faces net out: same-orientation duplicates collapse to one, opposite-orientation pairs
    (an internal double wall left behind by a boolean) vanish. Returns a keep mask."""
    T = len(ids)
    keep = np.ones(T, bool)
    if T == 0:
        return keep
    s = np.sort(ids, axis=1)
    key = (s[:, 0] * np.int64(nv) + s[:, 1]) * np.int64(nv) + s[:, 2]
    uk, inv, cnt = np.unique(key, return_inverse=True, return_counts=True)
    dup = np.nonzero(cnt[inv] > 1)[0]
    if len(dup) == 0:
        return keep
    rank = np.argsort(np.argsort(ids, axis=1), axis=1)
    sign = np.where(((rank[:, 1] - rank[:, 0]) % 3) == 1, 1, -1)
    groups = {}
    for f in dup.tolist():
        groups.setdefault(int(inv[f]), []).append(f)
    for fs in groups.values():
        net = int(sum(sign[f] for f in fs))
        for f in fs:
            keep[f] = False
        if net != 0:
            want = 1 if net > 0 else -1
            for f in fs:
                if sign[f] == want:
                    keep[f] = True
                    break
    return keep


def components(ids, nv):
    """Connected component label per triangle (vertex connectivity)."""
    parent = list(range(nv))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for a, b, c in ids.tolist():
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra
        rc = find(c)
        ra = find(a)
        if rc != ra:
            parent[rc] = ra
    roots = np.array([find(int(a)) for a in ids[:, 0]]) if len(ids) else np.zeros(0, np.int64)
    _, lab = np.unique(roots, return_inverse=True)
    return lab.reshape(-1)


# ---------------------------------------------------------------------------------------------------------
# analysis
# ---------------------------------------------------------------------------------------------------------
def analyze(src, weld_tol, welded=None):
    """Health report of a Source (does not modify it)."""
    P = src.P
    T = len(P)
    ids, nv = welded if welded is not None else weld_ids(P, weld_tol, robust=True)
    tiny = (1e-12 * src.diag) ** 2 if src.diag > 0 else 0.0
    deg = degenerate_mask(ids, src.area, tiny)
    dupkeep = cancel_duplicates(ids[~deg], nv)
    er = edge_runs(ids[~deg], nv)
    sizes = er['sizes']
    n_b = int((sizes == 1).sum())
    n_m = int((sizes == 2).sum())
    n_n = int((sizes >= 3).sum())
    lab = components(ids[~deg], nv) if (~deg).any() else np.zeros(0, int)
    flip = orient_faces(P[~deg], ids[~deg], nv, keep_cavities=True)
    return dict(
        tris=int(T), degenerate=int(deg.sum()), duplicate=int((~dupkeep).sum()),
        boundary_edges=n_b, manifold_edges=n_m, nonmanifold_edges=n_n,
        shells=int(lab.max() + 1) if len(lab) else 0, flipped=int(flip.sum()),
        volume=signed_volume(P), size=tuple((src.bmax - src.bmin).tolist()),
        open_fraction=(n_b + n_n) / max(1, n_b + n_m + n_n),
    )


# ---------------------------------------------------------------------------------------------------------
# orientation
# ---------------------------------------------------------------------------------------------------------
def orient_faces(P, ids, nv, keep_cavities=True):
    """Boolean flip mask that makes every shell consistently wound.

    Windings are propagated across 2-manifold edges. A shell with no open border is then oriented outward
    (positive volume) unless it is a real cavity: a negative-volume shell that sits inside another shell is
    left inward-facing so the winding number is 0 inside it. An open shell keeps whichever winding needs
    the fewest changes from what the file had."""
    T = len(ids)
    if T == 0:
        return np.zeros(0, bool)
    er = edge_runs(ids, nv)
    slots, starts, sizes, tri, ea, eb = er['slots'], er['starts'], er['sizes'], er['tri'], er['ea'], er['eb']
    m2 = starts[sizes == 2]
    s1 = slots[m2]
    s2 = slots[m2 + 1]
    f1 = tri[s1]
    f2 = tri[s2]
    same = ((ea[s1] < eb[s1]) == (ea[s2] < eb[s2])).astype(np.int8)
    nbr = [[] for _ in range(T)]
    for x, y, r in zip(f1.tolist(), f2.tolist(), same.tolist()):
        if x != y:
            nbr[x].append((y, r))
            nbr[y].append((x, r))
    flip = [0] * T
    comp = [-1] * T
    nc = 0
    for s in range(T):
        if comp[s] >= 0:
            continue
        comp[s] = nc
        stack = [s]
        while stack:
            u = stack.pop()
            fu = flip[u]
            for v, r in nbr[u]:
                if comp[v] < 0:
                    comp[v] = nc
                    flip[v] = fu ^ r
                    stack.append(v)
        nc += 1
    flip = np.array(flip, np.int8)
    comp = np.array(comp, np.int32)

    b_slots = slots[starts[sizes == 1]] if len(starts) else np.zeros(0, np.int64)
    open_c = np.zeros(nc, bool)
    if len(b_slots):
        open_c[comp[tri[b_slots]]] = True
    sign = 1 - 2 * flip.astype(np.float64)
    vt = np.einsum('ti,ti->t', P[:, 0], np.cross(P[:, 1], P[:, 2])) / 6.0 * sign
    vol = np.bincount(comp, weights=vt, minlength=nc)
    nflip = np.bincount(comp, weights=flip.astype(np.float64), minlength=nc)
    size = np.bincount(comp, minlength=nc)
    toggle = np.zeros(nc, bool)
    scale = np.abs(vol).max() if nc else 0.0
    neg = [c for c in range(nc) if (not open_c[c]) and vol[c] < -1e-12 * max(scale, 1e-30)]
    toggle[open_c & (nflip > size / 2.0)] = True
    cavity = set()
    if keep_cavities and neg and nc > 1:
        # orient everything positive, then ask "is this shell's own point inside the OTHER shells?"
        pos_toggle = toggle.copy()
        for c in neg:
            pos_toggle[c] = True
        fl = (flip.astype(bool) ^ pos_toggle[comp])
        Pp = P.copy()
        Pp[fl] = Pp[fl][:, [0, 2, 1]]
        for c in neg[:8]:
            mine = comp == c
            probe = Pp[mine].reshape(-1, 3)
            probe = probe[np.argmax(probe[:, 0])][None, :]
            others = Pp[~mine]
            if len(others) and WindingField(others).query(probe)[0] > 0.5:
                cavity.add(c)
    for c in neg:
        if c not in cavity:
            toggle[c] = True
    return (flip.astype(bool) ^ toggle[comp])


# ---------------------------------------------------------------------------------------------------------
# preparation
# ---------------------------------------------------------------------------------------------------------
def prepare(src, weld_rel=1e-6, fix_normals=True, keep_cavities=True, interior='AUTO'):
    """Clean a Source in place and decide whether it is a solid. Returns the raw health report."""
    tol = weld_rel * src.diag
    ids, nv = weld_ids(src.P, tol, robust=True)
    rep = analyze(src, tol, (ids, nv))
    tiny = (1e-12 * src.diag) ** 2
    deg = degenerate_mask(ids, src.area, tiny)
    keep = ~deg
    idx = np.nonzero(keep)[0]
    dk = cancel_duplicates(ids[idx], nv)
    idx = idx[dk]
    if len(idx) != src.T:
        src.take(idx)
        src.refresh()
        ids = ids[idx]
    if fix_normals and src.T:
        flip = orient_faces(src.P, ids, nv, keep_cavities)
        rep['flipped_applied'] = int(flip.sum())
        src.flip(flip)
        src.refresh()
    src.volume = signed_volume(src.P)
    if interior == 'SOLID':
        src.solid = True
    elif interior == 'SHELL':
        src.solid = False
    elif rep['open_fraction'] == 0.0:
        src.solid = src.volume > 1e-9 * max(src.diag, 1e-30) ** 3
    else:
        # A watertight solid reads ~1 just inside its faces and ~0 just outside; a single-sided sheet reads +-0.5 on
        # both sides. Judge by the winding number, not by how many edges happen to be open (one crack in a cube
        # leaves half its edges open).
        src.gwn = WindingField(src.P)
        rng = np.random.default_rng(0)
        idx = rng.choice(src.T, size=min(src.T, 800), replace=False)
        c = src.P[idx].mean(axis=1)
        off = 1e-3 * src.diag * src.tn[idx]
        w_in = src.gwn.query(c - off)
        w_out = src.gwn.query(c + off)
        score = float(((w_in > 0.7) & (np.abs(w_out) < 0.3)).mean())
        rep['solid_score'] = score
        src.solid = score >= 0.5
    src.report = rep
    return rep
