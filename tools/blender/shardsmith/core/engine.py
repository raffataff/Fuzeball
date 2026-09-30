"""The fracture pipeline.

    source soup -> winding field -> sites -> per cell: polyhedron, surface clip, interior caps
                -> merge slivers by adjacency -> weld, split into islands -> pieces (numpy arrays)

`fracture()` is a generator: it yields (fraction, message) between cells so a modal operator can draw
progress and honour Esc, and returns a Result through StopIteration. `run()` drives it to the end.
"""
import heapq
import time
from dataclasses import dataclass, field

import numpy as np

from . import caps as capmod, clip, seeds, voronoi
from .gwn import WindingField
from .meshdata import components, signed_volume, weld_ids, degenerate_mask


@dataclass
class Params:
    # pattern
    pattern: str = 'EVEN'            # EVEN RANDOM IMPACT RADIAL GRID SLICE CUSTOM
    count: int = 40
    seed: int = 1
    regularity: float = 0.7
    relax: int = 2
    distribution: str = 'VOLUME'     # VOLUME SURFACE MIXED
    surface_ratio: float = 0.35
    impact_center: tuple = (0.0, 0.0, 0.0)
    impact_radius: float = 1.0
    impact_boost: float = 8.0
    size_variation: float = 0.0
    weight_influence: float = 0.0
    axis: str = 'Z'
    axis_custom: tuple = (0.0, 0.0, 1.0)
    radial_layers: int = 1
    jitter: float = 0.5
    custom_points: object = None
    # interior
    interior: str = 'AUTO'           # AUTO SOLID SHELL
    interior_slot: int = -1          # material slot of interior faces (-1: a new slot after the source's)
    rough: float = 0.0               # displacement, relative to the average shard size
    noise_scale: float = 1.0         # noise wavelength, relative to the average shard size
    detail: float = 0.18             # interior point spacing, relative to the average shard size (0 = flat)
    smooth_interior: bool = True
    uv_mode: str = 'PLANAR'          # PLANAR POINT
    uv_scale: float = 1.0
    uv_point: tuple = (0.5, 0.5)
    cap_color: tuple = (0.35, 0.35, 0.35, 1.0)
    # repair
    weld: float = 1e-6
    fix_normals: bool = True
    keep_cavities: bool = True
    remove_buried: bool = True       # drop faces with solid on both sides (overlapping shells, internal walls)
    # pieces
    merge_small: bool = True
    min_size: float = 0.12           # pieces smaller than this fraction of the average merge into a neighbour
    drop_dust: bool = True
    dust_size: float = 0.02          # islands smaller than this fraction of the average are discarded
    split_islands: bool = True


@dataclass
class CapOpts:
    detail: float = 0.0
    rough: float = 0.0
    taper: float = 0.0
    noise: float = 1.0
    smooth: bool = True
    seed: int = 0


class CellResult:
    __slots__ = ('site', 'clip', 'caps', 'metric', 'centre')


class Piece:
    __slots__ = ('pos', 'posf', 'nrm', 'uvs', 'cols', 'mat', 'is_cap', 'ids', 'nv', 'volume', 'com', 'closed', 'area', 'cells', 'ncap')


@dataclass
class Result:
    pieces: list = field(default_factory=list)
    sites: np.ndarray = None
    volume_in: float = 0.0
    volume_out: float = 0.0
    seconds: float = 0.0
    warnings: list = field(default_factory=list)
    cell_size: float = 0.0
    solid: bool = True
    interior_slot: int = -1
    cancelled: bool = False
    open_pieces: int = 0
    buried: int = 0


def _tetra(pos, o):
    a = pos[:, 0] - o
    b = pos[:, 1] - o
    c = pos[:, 2] - o
    return np.einsum('ti,ti->t', a, np.cross(b, c)) / 6.0


def average_cell_size(src, count):
    vol = src.volume if (src.solid and src.volume > 0) else float(np.prod(np.maximum(src.bmax - src.bmin, 1e-9)))
    return (max(vol, 1e-30) / max(count, 1)) ** (1.0 / 3.0)


def make_sites(src, p, weight_fn=None, gwn=None):
    """Winding field + deduplicated Voronoi sites for the pattern in `p`."""
    rng = np.random.default_rng(int(p.seed) & 0x7fffffff)
    diag = src.diag
    eps = 5e-7 * diag
    if gwn is None:
        gwn = WindingField(src.P if src.solid else np.zeros((0, 3, 3)))
    sites = seeds.generate(src, gwn, p, rng, weight_fn)
    keep = voronoi.dedupe_sites(sites, max(eps * 8, 1e-9 * diag))
    return gwn, np.ascontiguousarray(sites[keep], dtype=np.float64)


def fracture(src, p, weight_fn=None):
    t0 = time.time()
    res = Result(solid=src.solid)
    diag = src.diag
    eps = 5e-7 * diag
    delta = 2e-5 * diag
    if not src.uvs and src.solid:
        # No UV map to carry: make one, so a textured inside material (Innerds) has coordinates on the fracture faces.
        # The outside gets zeros; only the inside faces are projected.
        src.uvs = [('UVMap', np.zeros((src.T, 3, 2)))]
    yield 0.0, "Building the winding-number field"
    gwn = src.gwn if (src.solid and src.gwn is not None) else WindingField(src.P if src.solid else np.zeros((0, 3, 3)))
    yield 0.03, "Placing fracture seeds"
    gwn, sites = make_sites(src, p, weight_fn, gwn)
    full = src
    if src.solid and p.remove_buried:
        yield 0.04, "Removing buried faces"
        cen = src.P.mean(axis=1)
        off = 1e-4 * diag * src.tn
        buried = (gwn.query(cen + off) > 0.7) & (gwn.query(cen - off) > 0.7)
        if buried.any() and not buried.all():
            res.buried = int(buried.sum())
            src = src.subset(np.nonzero(~buried)[0])
    N = len(sites)
    res.sites = sites
    res.cell_size = average_cell_size(src, N)
    if N < 2:
        raise ValueError("Fewer than two distinct fracture seeds; raise the count.")
    kd = voronoi.make_tree(sites)
    pad = 0.02 * diag + eps * 10
    lo = tuple((src.bmin - pad).tolist())
    hi = tuple((src.bmax + pad).tolist())
    co = CapOpts(
        detail=p.detail * res.cell_size if (src.solid and (p.rough > 0)) else 0.0,
        rough=p.rough * res.cell_size,
        taper=max(0.6 * p.detail * res.cell_size, 2.2 * p.rough * res.cell_size),
        noise=1.0 / max(p.noise_scale * res.cell_size, 1e-12),
        smooth=p.smooth_interior, seed=int(p.seed))
    cells = []
    t_last = time.time()
    for i in range(N):
        try:
            cell = voronoi.build_cell(i, sites, kd, lo, hi, eps)
            cc = clip.clip_cell(src, cell, eps)
            cps = capmod.build_caps(cell, cc, gwn, eps, delta, co, int(p.seed)) if (src.solid and len(cc.planes)) else []
        except Exception as e:                                   # one bad cell must never sink the whole fracture
            res.warnings.append("cell %d skipped: %s" % (i, e))
            continue
        if len(cc.s_src) == 0 and not cps:
            continue
        cr = CellResult()
        cr.site = i
        cr.clip = cc
        cr.caps = cps
        c0 = sites[i]
        v = float(_tetra(cc.s_pos, c0).sum())
        for c in cps:
            v += float(_tetra(c.verts[c.tris], c0).sum())
        cr.metric = abs(v) if src.solid else float(0.5 * np.linalg.norm(np.cross(cc.s_pos[:, 1] - cc.s_pos[:, 0], cc.s_pos[:, 2] - cc.s_pos[:, 0]), axis=1).sum())
        cr.centre = c0
        cells.append(cr)
        now = time.time()
        if now - t_last > 0.03 or i == N - 1:
            t_last = now
            yield 0.05 + 0.85 * (i + 1) / N, "Fracturing cell %d / %d" % (i + 1, N)
    if not cells:
        raise ValueError("The fracture produced no geometry. Check that the mesh has faces and a sensible scale.")
    yield 0.92, "Merging small pieces"
    mean_metric = float(np.mean([c.metric for c in cells]))
    group = _group(cells, p, src.solid, mean_metric)
    yield 0.95, "Assembling pieces"
    res.interior_slot = p.interior_slot if p.interior_slot >= 0 else len(src.mats)
    by_group = {}
    for c in cells:
        by_group.setdefault(group[c.site], []).append(c)
    weld_tol = 8e-6 * diag
    for gid, members in by_group.items():
        for pc in _assemble(src, members, group, gid, p, res.interior_slot, weld_tol, sites, res.cell_size):
            res.pieces.append(pc)
    if p.drop_dust and res.pieces:
        mean_v = np.mean([abs(q.volume) if q.closed else q.area for q in res.pieces])
        res.pieces = [q for q in res.pieces if (abs(q.volume) if q.closed else q.area) >= p.dust_size * mean_v] or res.pieces
    res.volume_in = src.volume
    res.volume_out = float(sum(q.volume for q in res.pieces))
    res.open_pieces = sum(1 for q in res.pieces if not q.closed)
    res.seconds = time.time() - t0
    yield 1.0, "Done"
    return res


def run(src, p, weight_fn=None):
    g = fracture(src, p, weight_fn)
    while True:
        try:
            next(g)
        except StopIteration as e:
            return e.value


# ---------------------------------------------------------------------------------------------------------
# grouping small cells into their biggest neighbour
# ---------------------------------------------------------------------------------------------------------
def _group(cells, p, solid, mean_metric):
    group = {c.site: c.site for c in cells}
    if not p.merge_small or p.min_size <= 0 or len(cells) < 2:
        return group
    metric = {c.site: c.metric for c in cells}
    adj = {c.site: {} for c in cells}
    if solid:
        for c in cells:
            for cap in c.caps:
                if cap.nbr in adj:
                    adj[c.site][cap.nbr] = adj[c.site].get(cap.nbr, 0.0) + cap.area
                    adj[cap.nbr][c.site] = adj[cap.nbr].get(c.site, 0.0) + cap.area
    else:
        for c in cells:
            for k, (tag, n, d, poly) in enumerate(c.clip.planes):
                if c.clip.segs[k] and tag in adj:
                    adj[c.site][tag] = adj[c.site].get(tag, 0.0) + len(c.clip.segs[k])
                    adj[tag][c.site] = adj[tag].get(c.site, 0.0) + len(c.clip.segs[k])
    thr = p.min_size * mean_metric
    ver = {s: 0 for s in metric}
    heap = [(m, s, 0) for s, m in metric.items() if m < thr]
    heapq.heapify(heap)
    alive = set(metric)
    while heap:
        m, s, v = heapq.heappop(heap)
        if s not in alive or ver[s] != v or metric[s] >= thr or not adj[s]:
            continue
        h = max(adj[s], key=lambda x: (adj[s][x], metric[x]))
        for x, w in adj[s].items():
            if x == h:
                continue
            adj[h][x] = adj[h].get(x, 0.0) + w
            adj[x][h] = adj[x].get(h, 0.0) + w
            del adj[x][s]
        del adj[h][s]
        adj[s] = {}
        metric[h] += metric[s]
        alive.discard(s)
        ver[h] += 1
        for k in [k for k, g in group.items() if g == s]:
            group[k] = h
        if metric[h] < thr:
            heapq.heappush(heap, (metric[h], h, ver[h]))
    return group


# ---------------------------------------------------------------------------------------------------------
# assembly
# ---------------------------------------------------------------------------------------------------------
def _cap_uv(cap, P, p, cell):
    """Planar UVs of an inside face. One texture repeat is `uv_scale` average piece-widths across, so a tiling
    texture looks the same on a 2-unit prop and a 12-unit figurine."""
    if p.uv_mode == 'POINT':
        return np.tile(np.array(p.uv_point, float), (len(P), 1))
    s = 1.0 / max(p.uv_scale * cell, 1e-9)
    return np.stack([P @ cap.u, P @ cap.v], axis=1) * s + 0.5


def _assemble(src, members, group, gid, p, cap_slot, weld_tol, sites, cell=1.0):
    pos, posf, nrm, is_cap, mat = [], [], [], [], []
    uvs = [[] for _ in src.uvs]
    cols = [[] for _ in src.cols]
    ncap = 0
    for c in members:
        cc = c.clip
        if len(cc.s_src):
            b = cc.s_bary
            pos.append(cc.s_pos)
            posf.append(cc.s_pos)
            nn = np.einsum('nck,nkd->ncd', b, src.N[cc.s_src])
            ln = np.linalg.norm(nn, axis=2, keepdims=True)
            ln[ln == 0] = 1.0
            nrm.append(nn / ln)
            is_cap.append(np.zeros(len(b), bool))
            mat.append(src.M[cc.s_src])
            for i, (_, a) in enumerate(src.uvs):
                uvs[i].append(np.einsum('nck,nkd->ncd', b, a[cc.s_src]))
            for i, (_, a) in enumerate(src.cols):
                cols[i].append(np.einsum('nck,nkd->ncd', b, a[cc.s_src]))
        for cap in c.caps:
            if group.get(cap.nbr, -1) == gid:
                continue
            T = cap.tris
            n = len(T)
            pos.append(cap.verts[T])
            posf.append(cap.flat[T])
            nrm.append(cap.nrm[T])
            is_cap.append(np.ones(n, bool))
            mat.append(np.full(n, cap_slot, np.int32))
            uv2 = _cap_uv(cap, cap.verts, p, cell)
            for i in range(len(src.uvs)):
                uvs[i].append(uv2[T])
            for i in range(len(src.cols)):
                cols[i].append(np.tile(np.array(p.cap_color, float), (n, 3, 1)))
            ncap += n
    if not pos:
        return []
    pos = np.concatenate(pos)
    posf = np.concatenate(posf)
    nrm = np.concatenate(nrm)
    is_cap = np.concatenate(is_cap)
    mat = np.concatenate(mat)
    uvs = [np.concatenate(u) for u in uvs]
    cols = [np.concatenate(c) for c in cols]
    ids, nv = weld_ids(pos, weld_tol, robust=True)
    ar = 0.5 * np.linalg.norm(np.cross(pos[:, 1] - pos[:, 0], pos[:, 2] - pos[:, 0]), axis=1)
    ok = ~degenerate_mask(ids, ar, 0.25 * weld_tol * weld_tol)
    if not ok.all():
        pos, posf, nrm, is_cap, mat, ids = pos[ok], posf[ok], nrm[ok], is_cap[ok], mat[ok], ids[ok]
        uvs = [u[ok] for u in uvs]
        cols = [c[ok] for c in cols]
    if len(pos) == 0:
        return []
    if p.split_islands:
        lab = components(ids, nv)
    else:
        lab = np.zeros(len(pos), np.int64)
    out = []
    for l in range(int(lab.max()) + 1):
        m = lab == l
        pc = Piece()
        pc.pos = pos[m]
        pc.posf = posf[m] if p.rough > 0 else None
        pc.nrm = nrm[m]
        pc.is_cap = is_cap[m]
        pc.mat = mat[m]
        pc.uvs = [u[m] for u in uvs]
        pc.cols = [c[m] for c in cols]
        loc = ids[m]
        used, inv = np.unique(loc, return_inverse=True)
        pc.ids = inv.reshape(-1, 3)
        pc.nv = len(used)
        pc.cells = [c.site for c in members]
        pc.ncap = int(pc.is_cap.sum())
        _measure(pc)
        out.append(pc)
    return out


def _measure(pc):
    """Volume, centre of mass, closedness and area of a piece; flips it if it came out inside-out."""
    from .meshdata import edge_runs
    er = edge_runs(pc.ids, pc.nv)
    pc.closed = bool(len(er['sizes']) and (er['sizes'] == 2).all())
    o = pc.pos.reshape(-1, 3).mean(axis=0)
    vt = _tetra(pc.pos, o)
    vol = float(vt.sum())
    if pc.closed and vol < 0:
        sw = [0, 2, 1]
        pc.pos = pc.pos[:, sw]
        if pc.posf is not None:
            pc.posf = pc.posf[:, sw]
        pc.nrm = -pc.nrm[:, sw]
        pc.ids = pc.ids[:, sw]
        pc.uvs = [u[:, sw] for u in pc.uvs]
        pc.cols = [c[:, sw] for c in pc.cols]
        vt = -vt
        vol = -vol
    pc.volume = vol
    pc.area = float(0.5 * np.linalg.norm(np.cross(pc.pos[:, 1] - pc.pos[:, 0], pc.pos[:, 2] - pc.pos[:, 0]), axis=1).sum())
    if pc.closed and vol > 1e-30:
        cen = (pc.pos.sum(axis=1) + o) / 4.0
        pc.com = (vt[:, None] * cen).sum(axis=0) / vol
    else:
        pc.com = pc.pos.reshape(-1, 3).mean(axis=0)
