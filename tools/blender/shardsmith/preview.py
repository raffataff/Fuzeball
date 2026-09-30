"""Viewport overlay of the fracture pattern: the seeds and the cell edges that pass through the solid."""
import bpy
import numpy as np

_state = {'handle': None, 'sites': None, 'lines': None, 'batches': None}


def compute(src, params, weight_fn=None):
    """Sites and the Voronoi edges that lie inside the solid, as (N,2,3) segments."""
    from .core import engine, voronoi
    gwn, sites = engine.make_sites(src, params, weight_fn)
    eps = 5e-7 * src.diag
    kd = voronoi.make_tree(sites)
    pad = 0.02 * src.diag
    lo = tuple((src.bmin - pad).tolist())
    hi = tuple((src.bmax + pad).tolist())
    segs = {}
    for i in range(len(sites)):
        cell = voronoi.build_cell(i, sites, kd, lo, hi, eps)
        for tag, n, d, poly in cell.faces:
            if tag < 0:
                continue
            m = len(poly)
            for k in range(m):
                a, b = poly[k], poly[(k + 1) % m]
                key = tuple(sorted((tuple(np.round(a, 6)), tuple(np.round(b, 6)))))
                segs[key] = (a, b)
    if not segs:
        return sites, np.zeros((0, 2, 3))
    L = np.array(list(segs.values()), dtype=np.float64)
    if not src.solid:
        return sites, L
    # Voronoi edges run on past the object: cut each into short pieces and keep the ones inside the solid
    length = np.linalg.norm(L[:, 1] - L[:, 0], axis=1)
    k = np.clip(np.ceil(length / max(src.diag / 45.0, 1e-12)).astype(int), 1, 40)
    a = np.repeat(L[:, 0], k, axis=0)
    b = np.repeat(L[:, 1], k, axis=0)
    idx = np.concatenate([np.arange(n) for n in k])
    t0 = (idx / np.repeat(k, k))[:, None]
    t1 = ((idx + 1) / np.repeat(k, k))[:, None]
    s0 = a + (b - a) * t0
    s1 = a + (b - a) * t1
    keep = gwn.query(0.5 * (s0 + s1)) > 0.5
    return sites, np.stack([s0[keep], s1[keep]], axis=1)


def set_data(sites, lines):
    _state['sites'] = np.asarray(sites, dtype=np.float32)
    _state['lines'] = np.asarray(lines, dtype=np.float32).reshape(-1, 3)
    _state['batches'] = None


def has_data():
    return _state['sites'] is not None


def _draw():
    try:
        import gpu
        from gpu_extras.batch import batch_for_shader
        if _state['batches'] is None:
            sh = gpu.shader.from_builtin('UNIFORM_COLOR')
            bl = batch_for_shader(sh, 'LINES', {"pos": _state['lines']}) if len(_state['lines']) else None
            bp = batch_for_shader(sh, 'POINTS', {"pos": _state['sites']})
            _state['batches'] = (sh, bl, bp)
        sh, bl, bp = _state['batches']
        gpu.state.blend_set('ALPHA')
        gpu.state.depth_test_set('NONE')
        sh.bind()
        if bl is not None:
            gpu.state.line_width_set(1.5)
            sh.uniform_float("color", (0.94, 0.70, 0.29, 0.75))
            bl.draw(sh)
        gpu.state.point_size_set(7.0)
        sh.uniform_float("color", (1.0, 1.0, 1.0, 0.95))
        bp.draw(sh)
        gpu.state.blend_set('NONE')
    except Exception:
        disable()


def enable():
    if _state['handle'] is None:
        _state['handle'] = bpy.types.SpaceView3D.draw_handler_add(_draw, (), 'WINDOW', 'POST_VIEW')
    for w in bpy.context.window_manager.windows:
        for a in w.screen.areas:
            a.tag_redraw()


def disable():
    if _state['handle'] is not None:
        try:
            bpy.types.SpaceView3D.draw_handler_remove(_state['handle'], 'WINDOW')
        except Exception:
            pass
        _state['handle'] = None
    try:
        for w in bpy.context.window_manager.windows:
            for a in w.screen.areas:
                a.tag_redraw()
    except Exception:
        pass


def clear():
    disable()
    _state['sites'] = None
    _state['lines'] = None
    _state['batches'] = None


def active():
    return _state['handle'] is not None
