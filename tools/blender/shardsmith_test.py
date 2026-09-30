"""Shardsmith test suite. Run inside Blender:

    blender -b --factory-startup --python tools/blender/shardsmith_test.py [-- name ...]

Each test builds geometry, fractures it and asserts on the result: pieces are closed 2-manifolds, their volumes
sum to the source volume (nothing lost), they do not overlap, and broken inputs (holes, flipped faces,
duplicates, non-manifold fins, overlapping shells, loose geometry, open sheets) still fracture sensibly.
"""
import os
import sys
import time
import traceback

import bmesh
import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from shardsmith.core import engine, meshdata                # noqa: E402
from shardsmith.core.gwn import WindingField                # noqa: E402

FAILS = []
OUT = os.path.join(HERE, '..', 'build', 'shardsmith')


def ok(cond, msg):
    print(('   PASS ' if cond else '   FAIL ') + msg)
    if not cond:
        FAILS.append(msg)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def obj_from_bmesh(bm, name='T'):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    return ob


def prim(kind, **kw):
    clear()
    bm = bmesh.new()
    if kind == 'cube':
        bmesh.ops.create_cube(bm, size=2.0)
    elif kind == 'sphere':
        bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=1.0)
    elif kind == 'ico':
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    elif kind == 'torus':
        # a torus from a circle sweep
        n, m, R, r = 32, 16, 1.0, 0.4
        import math
        vs = []
        for i in range(n):
            for j in range(m):
                a = 2 * math.pi * i / n
                b = 2 * math.pi * j / m
                vs.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b))))
        for i in range(n):
            for j in range(m):
                a, b = vs[i * m + j], vs[((i + 1) % n) * m + j]
                c, d = vs[((i + 1) % n) * m + (j + 1) % m], vs[i * m + (j + 1) % m]
                bm.faces.new((a, b, c, d))
    elif kind == 'monkey':
        bmesh.ops.create_monkey(bm)
    bm.normal_update()
    ob = obj_from_bmesh(bm, kind)
    return ob


def load(ob, **kw):
    src = meshdata.extract(bpy.context, ob, use_modifiers=True)
    rep = meshdata.prepare(src, weld_rel=kw.pop('weld', 1e-6), fix_normals=kw.pop('fix_normals', True), interior=kw.pop('interior', 'AUTO'))
    return src, rep


def frac(ob, **kw):
    prep = {k: kw.pop(k) for k in ('weld', 'fix_normals', 'interior') if k in kw}
    src, rep = load(ob, **prep)
    p = engine.Params(**kw)
    t = time.time()
    res = engine.run(src, p)
    return src, rep, res, time.time() - t


def piece_watertight(pc):
    return pc.closed


def overlap_check(res, src, n=300, seed=3):
    """Random points inside the source belong to exactly one piece."""
    rng = np.random.default_rng(seed)
    g = WindingField(src.P)
    pts = src.bmin + rng.random((n * 6, 3)) * (src.bmax - src.bmin)
    pts = pts[g.query(pts) > 0.5][:n]
    counts = np.zeros(len(pts), int)
    for pc in res.pieces:
        counts += WindingField(pc.pos).query(pts) > 0.5
    return len(pts), int((counts == 0).sum()), int((counts > 1).sum())


def report(res, src, t):
    closed = sum(1 for p in res.pieces if p.closed)
    cov = res.volume_out / src.volume if src.volume else 0
    print('   pieces=%d closed=%d coverage=%.5f time=%.2fs warnings=%d' % (len(res.pieces), closed, cov, t, len(res.warnings)))
    return closed, cov


def check_solid(res, src, t, tol=2e-3, min_closed=1.0, part_tol=0.0):
    closed, cov = report(res, src, t)
    ok(len(res.pieces) >= 2, 'more than one piece')
    ok(closed >= min_closed * len(res.pieces), 'all pieces are closed manifolds (%d/%d)' % (closed, len(res.pieces)))
    ok(abs(cov - 1) < tol, 'piece volumes sum to the source volume (%.5f)' % cov)
    n, lost, dup = overlap_check(res, src)
    ok(lost <= n * part_tol and dup <= n * part_tol, 'partition: %d probe points, %d in no piece, %d in several' % (n, lost, dup))


# ---------------------------------------------------------------------------------------------------------
def t_cube():
    ob = prim('cube')
    src, rep, res, t = frac(ob, count=24, seed=5)
    check_solid(res, src, t)


def t_sphere_uv():
    ob = prim('sphere')
    ob.data.uv_layers.new(name='UVMap')
    src, rep, res, t = frac(ob, count=40, seed=2)
    check_solid(res, src, t)
    ok(len(res.pieces[0].uvs) == 1, 'UV layer carried through')


def t_monkey():
    ob = prim('monkey')
    # Blender's Suzanne has 42 boundary edges (her eye sockets are open), so a few pieces are genuinely open
    src, rep, res, t = frac(ob, count=60, seed=11)
    check_solid(res, src, t, tol=0.05, min_closed=0.75)


def t_torus():
    ob = prim('torus')
    src, rep, res, t = frac(ob, count=30, seed=4)
    check_solid(res, src, t, tol=3e-3)


def t_patterns():
    ob = prim('ico')
    for pat, extra in (('RANDOM', {}), ('IMPACT', dict(impact_center=(0.7, 0, 0), impact_radius=0.6, impact_boost=30)),
                       ('RADIAL', dict(impact_center=(0, 0, 0), axis='Z')), ('GRID', {}), ('SLICE', dict(axis='X'))):
        print(' pattern', pat)
        src, rep, res, t = frac(ob, pattern=pat, count=30, seed=8, **extra)
        check_solid(res, src, t, tol=3e-3)


def t_rough():
    ob = prim('ico')
    src, rep, res, t = frac(ob, count=20, seed=3, rough=0.25, detail=0.2, noise_scale=0.7)
    check_solid(res, src, t, tol=0.02, part_tol=0.02)


# --- broken inputs -----------------------------------------------------------------------------------------
def broken_cube(kind):
    clear()
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=2, use_grid_fill=True)
    bm.faces.ensure_lookup_table()
    if kind == 'hole':
        bmesh.ops.delete(bm, geom=[bm.faces[3], bm.faces[17]], context='FACES_ONLY')
    elif kind == 'flipped':
        for f in [bm.faces[1], bm.faces[9], bm.faces[20], bm.faces[30]]:
            f.normal_flip()
    elif kind == 'duplicate':
        geo = bmesh.ops.duplicate(bm, geom=[bm.faces[5], bm.faces[6], bm.faces[7]])
    elif kind == 'fin':
        v = [bm.verts.new((0, -1, 1.0)), bm.verts.new((0, 1, 1.0)), bm.verts.new((0, -1, 2.5)), bm.verts.new((0, 1, 2.5))]
        bm.faces.new((v[0], v[1], v[3], v[2]))
    elif kind == 'loose':
        bm.verts.new((5, 5, 5))
        a, b = bm.verts.new((4, 4, 4)), bm.verts.new((4.5, 4, 4))
        bm.edges.new((a, b))
    elif kind == 'overlap':
        bm2 = bmesh.new()
        bmesh.ops.create_cube(bm2, size=1.4)
        bmesh.ops.translate(bm2, vec=(0.9, 0.5, 0.3), verts=bm2.verts)
        me = bpy.data.meshes.new('o')
        bm2.to_mesh(me)
        bm2.free()
        bm.from_mesh(me)
    elif kind == 'insideout':
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
    elif kind == 'gaps':
        # tiny cracks: split some verts apart so edges no longer meet
        bm.verts.ensure_lookup_table()
        for i in (4, 21, 37):
            bm.verts[i].co.x += 0.004
    elif kind == 'cavity':
        bm2 = bmesh.new()
        bmesh.ops.create_cube(bm2, size=0.8)
        bmesh.ops.reverse_faces(bm2, faces=list(bm2.faces))
        me = bpy.data.meshes.new('c')
        bm2.to_mesh(me)
        bm2.free()
        bm.from_mesh(me)
    bm.normal_update()
    return obj_from_bmesh(bm, 'broken_' + kind)


def t_broken():
    for kind, tol in (('hole', 0.08), ('flipped', 1e-3), ('duplicate', 1e-3), ('fin', 0.02), ('loose', 1e-3),
                      ('overlap', None), ('insideout', 1e-3), ('gaps', 0.05), ('cavity', None)):
        print(' broken:', kind)
        ob = broken_cube(kind)
        src, rep = load(ob)
        print('   health', {k: rep[k] for k in ('boundary_edges', 'nonmanifold_edges', 'degenerate', 'duplicate', 'shells', 'flipped')}, 'solid', src.solid, 'vol %.4f' % src.volume)
        p = engine.Params(count=24, seed=7)
        t0 = time.time()
        res = engine.run(src, p)
        t = time.time() - t0
        closed, cov = report(res, src, t)
        ok(len(res.pieces) >= 2, kind + ': produces pieces')
        ok(not res.warnings, kind + ': no cell warnings %s' % res.warnings[:2])
        if tol is not None:
            ok(abs(cov - 1) < tol, kind + ': volume conserved (%.4f)' % cov)
        if kind == 'overlap':
            n, lost, dup = overlap_check(res, src)
            ok(lost <= n // 100 and dup <= n // 100, 'overlap: union partitioned (%d probes, %d lost, %d doubled), %d buried faces removed' % (n, lost, dup, res.buried))
            ok(res.buried > 0, 'overlap: buried faces detected')
        else:
            ok(closed >= 0.7 * len(res.pieces), kind + ': most pieces are closed (%d/%d)' % (closed, len(res.pieces)))


def t_open_sheet():
    clear()
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=6, y_segments=6, size=2.0)
    ob = obj_from_bmesh(bm, 'sheet')
    src, rep = load(ob)
    print('   solid?', src.solid, rep['boundary_edges'])
    ok(not src.solid, 'an open sheet is recognised as a shell')
    res = engine.run(src, engine.Params(count=12, seed=1))
    ok(len(res.pieces) >= 4, 'sheet breaks into pieces (%d)' % len(res.pieces))
    area = sum(p.area for p in res.pieces)
    ok(abs(area / 16.0 - 1) < 1e-3, 'sheet area conserved (%.5f)' % (area / 16.0))


def t_cracked():
    """A cube whose top face floats 0.003 above the sides: a real hairline gap, not just a bad normal."""
    clear()
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    bm.faces.ensure_lookup_table()
    top = max(bm.faces, key=lambda f: f.calc_center_median().z)
    bmesh.ops.split(bm, geom=[top])
    bm.faces.ensure_lookup_table()
    top = max(bm.faces, key=lambda f: f.calc_center_median().z)
    for v in top.verts:
        v.co.z += 0.003
    ob = obj_from_bmesh(bm, 'cracked')
    src, rep = load(ob)
    print('   health', {k: rep[k] for k in ('boundary_edges', 'nonmanifold_edges', 'shells')}, 'solid', src.solid)
    res = engine.run(src, engine.Params(count=24, seed=5))
    closed, cov = report(res, src, res.seconds)
    ok(not res.warnings, 'no cell warnings')
    ok(abs(cov - 1) < 0.03, 'volume kept through the crack (%.4f)' % cov)
    n, lost, dup = overlap_check(res, src)
    ok(lost <= n * 0.03 and dup <= n * 0.03, 'partition holds across the crack (%d lost, %d doubled of %d)' % (lost, dup, n))


def strip_ktx(src, dst):
    """The game's GLBs use KTX2 textures, which Blender's importer refuses; only geometry is needed here."""
    import json
    import struct
    d = open(src, 'rb').read()
    magic, ver, length = struct.unpack('<4sII', d[:12])
    off, chunks = 12, []
    while off < len(d):
        cl, ct = struct.unpack('<II', d[off:off + 8])
        chunks.append([ct, d[off + 8:off + 8 + cl]])
        off += 8 + cl
    j = json.loads(chunks[0][1].decode('utf8'))
    for key in ('extensionsUsed', 'extensionsRequired'):
        if key in j:
            j[key] = [e for e in j[key] if e != 'KHR_texture_basisu']
    j['textures'] = []
    j['images'] = []
    for m in j.get('materials', []):
        for k in ('baseColorTexture', 'metallicRoughnessTexture'):
            m.get('pbrMetallicRoughness', {}).pop(k, None)
        for k in ('normalTexture', 'occlusionTexture', 'emissiveTexture'):
            m.pop(k, None)
    js = json.dumps(j).encode('utf8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    chunks[0][1] = js
    out = b''.join(struct.pack('<II', len(c), t) + c for t, c in chunks)
    open(dst, 'wb').write(struct.pack('<4sII', magic, ver, 12 + len(out)) + out)


def t_figurines():
    """The game's own figurines: open borders, non-manifold edges, flipped faces, several shells."""
    root = os.path.abspath(os.path.join(HERE, '..', '..'))
    for name in ('womanKimi', 'cyborg', 'manJerry'):
        path = os.path.join(root, 'assets', 'fuzeball_%s.glb' % name)
        if not os.path.exists(path):
            print('   skip %s (asset missing)' % name)
            continue
        print(' figurine', name)
        clear()
        os.makedirs(OUT, exist_ok=True)
        tmp = os.path.join(OUT, 'fig_%s.glb' % name)
        strip_ktx(path, tmp)
        bpy.ops.import_scene.gltf(filepath=tmp)
        ob = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
        src, rep = load(ob)
        lo, hi = src.bmin, src.bmax
        size = float((hi - lo).max())
        c = 0.5 * (lo + hi)
        print('   health', {k: rep[k] for k in ('boundary_edges', 'nonmanifold_edges', 'flipped', 'shells')})
        p = engine.Params(pattern='IMPACT', count=36, seed=4, regularity=0.75, impact_boost=6.0, impact_radius=0.55 * size,
                          impact_center=(c[0], c[1], lo[2] + 0.35 * (hi[2] - lo[2])), rough=0.18, detail=0.2, interior_slot=len(src.mats))
        res = engine.run(src, p)
        closed, cov = report(res, src, res.seconds)
        ok(not res.warnings, name + ': no cell warnings')
        ok(len(res.pieces) >= 25, name + ': %d pieces' % len(res.pieces))
        ok(0.94 < cov < 1.06, name + ': volume kept (%.3f)' % cov)
        ok(closed >= 0.5 * len(res.pieces), name + ': most pieces are closed (%d/%d)' % (closed, len(res.pieces)))
        n, lost, dup = overlap_check(res, src, n=200)
        ok(lost <= n * 0.03 and dup <= n * 0.03, name + ': partition (%d lost, %d doubled of %d)' % (lost, dup, n))


# --- does the simulation behave: no repulsion, no energy from nowhere ----------------------------------------
def hull_data(ob):
    """(planes n, offsets d, hull vertices, bounding radius) of a shard's collision shape (the flat base mesh)."""
    co = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    bm = bmesh.new()
    for p in co:
        bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=list(bm.verts))
    N = np.array([np.array(f.normal) for f in bm.faces])
    D = np.array([np.array(f.normal) @ np.array(f.calc_center_median()) for f in bm.faces])
    hv = np.array([list(v.co) for v in bm.verts if v.link_faces])
    bm.free()
    return N, D, hv, float(np.linalg.norm(co, axis=1).max())


def sim_quality(shards, size):
    """Run the timeline; return (deepest hull interpenetration after release as a fraction of size, energy gained
    after release as a fraction of the energy at release, fraction of pieces at rest in the last second)."""
    from shardsmith.physics import fcurves_of
    sc = bpy.context.scene
    fps = sc.render.fps / sc.render.fps_base
    H = [hull_data(o) for o in shards]
    rel = []
    for o in shards:
        kf = [f for _, f in fcurves_of(o) if f.data_path == 'rigid_body.kinematic'][0]
        rel.append(int(kf.keyframe_points[-1].co[0]))
    mass = np.array([o.rigid_body.mass for o in shards])
    g = -sc.gravity.z
    Tr, Rot = [], []
    for f in range(1, sc.frame_end + 1):
        sc.frame_set(f)
        Tr.append(np.array([list(o.matrix_world.translation) for o in shards]))
        Rot.append(np.array([np.array(o.matrix_world.to_3x3()) for o in shards]))
    Tr, Rot = np.array(Tr), np.array(Rot)
    n = len(shards)
    last = max(rel)
    depth = 0.0
    for f in range(last + 3, len(Tr), 2):
        for i in range(n):
            for j in range(i + 1, n):
                if np.linalg.norm(Tr[f, i] - Tr[f, j]) > H[i][3] + H[j][3]:
                    continue
                for a, b in ((i, j), (j, i)):
                    A = H[a][2] @ Rot[f, a].T + Tr[f, a]
                    sd = ((A - Tr[f, b]) @ Rot[f, b]) @ H[b][0].T - H[b][1]
                    depth = max(depth, float((-sd.max(axis=1)).max()))
    V = (Tr[1:] - Tr[:-1]) * fps
    E = (0.5 * mass * (V ** 2).sum(axis=2) + mass * g * (Tr[1:, :, 2] - Tr[:, :, 2].min())).sum(axis=1)
    st = last + 2
    d = np.diff(E[st:])
    gain = float(d[d > 0].sum() / max(E[st], 1e-30))
    tail = np.linalg.norm(V[-24:], axis=2).mean(axis=0) / size
    return depth / size, gain, float((tail < 0.3).mean())


def run_blast(ob, **kw):
    s = bpy.context.scene.shardsmith if hasattr(bpy.types.Scene, 'shardsmith') else enable_addon()
    for k, v in kw.items():
        setattr(s, k, v)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.shardsmith.fracture(explode=True)
    from shardsmith.operators import shards_of
    return shards_of(ob)[1]


def t_physics_quality():
    """The pieces must not repel each other: no interpenetration after release, no energy gained from contacts."""
    ob = prim('cube')
    ob.scale = (1.0, 1.0, 2.0)
    bpy.context.view_layer.update()
    shards = run_blast(ob, count=30, seed=7, rough=0.3, detail=0.2, spin=2.5, wave_speed=4.0, blast_up=0.4, blast_speed=3.0,
                       start_frame=5, duration=3.0)
    ok(shards[0].data.shape_keys is not None and 'Rough' in shards[0].data.shape_keys.key_blocks, 'roughness lives on a shape key')
    ok(shards[0].rigid_body.mesh_source == 'BASE', 'the rigid body collides as the flat piece')
    depth, gain, rest = sim_quality(shards, 4.0)
    print('   interpenetration after release %.2f%% of size, energy gained from contacts %.2f%%, %d%% of pieces at rest at the end' % (100 * depth, 100 * gain, 100 * rest))
    ok(depth < 0.015, 'pieces never interpenetrate after release (%.2f%% of size)' % (100 * depth))
    ok(gain < 0.015, 'contacts do not add energy (%.2f%% gained)' % (100 * gain))
    ok(rest > 0.7, 'the debris settles (%.0f%% at rest)' % (100 * rest))


def t_physics_figurines():
    root = os.path.abspath(os.path.join(HERE, '..', '..'))
    for name in ('womanKimi', 'cyborg'):
        path = os.path.join(root, 'assets', 'fuzeball_%s.glb' % name)
        if not os.path.exists(path):
            print('   skip %s (asset missing)' % name)
            continue
        print(' figurine', name)
        clear()
        os.makedirs(OUT, exist_ok=True)
        tmp = os.path.join(OUT, 'fig_%s.glb' % name)
        strip_ktx(path, tmp)
        bpy.ops.import_scene.gltf(filepath=tmp)
        ob = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
        s = enable_addon()
        s.preset = 'FIGURINE'
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.shardsmith.fracture(explode=True)
        from shardsmith.operators import shards_of
        shards = shards_of(ob)[1]
        depth, gain, rest = sim_quality(shards, float(max(ob.dimensions)))
        print('   interpenetration after release %.2f%% of size, energy gained %.2f%%, %d%% at rest' % (100 * depth, 100 * gain, 100 * rest))
        # this is hull against hull: shards that land in a heap nest into each other's concavities, so a few percent is
        # normal (3-4% with or without split impulse); a repulsive force would show up as energy gained, checked next
        ok(depth < 0.06, name + ': pieces do not sink far into each other after release (%.2f%%)' % (100 * depth))
        ok(gain < 0.03, name + ': contacts do not add energy (%.2f%%)' % (100 * gain))


def t_export_roughness():
    """Roughness is a shape key while simulating, but the GLB must contain the rough mesh as plain geometry."""
    ob = prim('ico')
    shards = run_blast(ob, count=12, seed=2, rough=0.35, detail=0.2, duration=0.5)
    sc = bpy.context.scene
    sc.frame_set(1)
    os.makedirs(OUT, exist_ok=True)
    s = sc.shardsmith
    s.export_path = os.path.abspath(OUT)
    s.export_name = 'rough_export'
    bpy.ops.shardsmith.bake()
    ok('FINISHED' in bpy.ops.shardsmith.export_glb(), 'export finishes')
    j = glb_json(os.path.join(os.path.abspath(OUT), 'rough_export.glb'))
    prims = [p for m in j['meshes'] for p in m['primitives']]
    ok(not any('targets' in p for p in prims), 'no morph targets in the GLB')
    o = shards[0]
    co = np.empty(len(o.data.vertices) * 3)
    o.data.vertices.foreach_get('co', co)
    flat = np.sort(np.linalg.norm(np.unique(np.round(co.reshape(-1, 3), 5), axis=0), axis=1))
    key = o.data.shape_keys.key_blocks['Rough']
    rk = np.empty(len(o.data.vertices) * 3)
    key.data.foreach_get('co', rk)
    rough = np.sort(np.linalg.norm(np.unique(np.round(rk.reshape(-1, 3), 5), axis=0), axis=1))
    j, binc = glb_read(os.path.join(os.path.abspath(OUT), 'rough_export.glb'))
    got = glb_vertex_norms(j, binc, o.name)
    ok(len(got) == len(rough) and np.allclose(got, rough, atol=2e-4), 'the exported vertices are the rough ones (%d unique, max diff %.5f)' % (len(got), float(np.abs(got - rough).max()) if len(got) == len(rough) else -1))
    ok(len(flat) == len(rough) and float(np.abs(flat - rough).max()) > 1e-3, 'and they differ from the flat base mesh (%.4f)' % float(np.abs(flat - rough).max()))
    ok(o.data.shape_keys is not None and 'Rough' in o.data.shape_keys.key_blocks and o.data.shape_keys.key_blocks['Rough'].value == 1.0,
       'the roughness shape key is restored after the export')
    co2 = np.empty(len(o.data.vertices) * 3)
    o.data.vertices.foreach_get('co', co2)
    ok(np.allclose(co2, co, atol=1e-6), 'and the base mesh is the flat piece again')


# --- importing the game's KTX2 GLBs ---------------------------------------------------------------------------
def t_import_ktx2():
    """Blender refuses KHR_texture_basisu; the add-on decodes through the project's tools/ktx2-decode.mjs."""
    import shutil
    from shardsmith import importer
    root = os.path.abspath(os.path.join(HERE, '..', '..'))
    src = os.path.join(root, 'assets', 'fuzeball_womanKimi.glb')
    if not os.path.exists(src) or importer.find_node(None) is None or importer.find_decoder(src, None) is None:
        print('   skip (asset, Node or tools/ktx2-decode.mjs missing)')
        return
    ok(importer.needs_ktx2_decode(src), 'the figurine is detected as KTX2-textured')
    clear()
    try:
        bpy.ops.import_scene.gltf(filepath=src)
        ok(False, 'Blender should refuse the raw file')
    except RuntimeError:
        ok(True, "Blender's own importer refuses the raw file, as reported")
    clear()
    s = enable_addon()
    r = bpy.ops.shardsmith.import_glb(filepath=src, texture_size='1024')
    ok('FINISHED' in r, 'import_glb finishes')
    ob = bpy.context.view_layer.objects.active
    ok(ob is not None and ob.type == 'MESH', 'a mesh is imported and active')
    names = [m.name for m in ob.data.materials if m]
    ok('kit_kimi' in names and 'kit_kimi_skln' in names, 'kit materials survive (%s)' % names)
    imgs = [i for i in bpy.data.images if i.size[0] > 0 and i.name not in ('Render Result', 'Viewer Node')]
    ok(len(imgs) >= 1 and all(max(i.size) == 1024 for i in imgs), 'textures decoded at the requested size (%s)' % [tuple(i.size) for i in imgs])
    ok(all(i.packed_file is not None for i in imgs), 'textures are packed into the blend (they survive the temp folder going away)')
    base = None
    for m in ob.data.materials:
        if m and m.use_nodes:
            for n in m.node_tree.nodes:
                if n.type == 'TEX_IMAGE' and n.image is not None:
                    base = n.image
                    break
        if base:
            break
    ok(base is not None, 'materials are wired to the decoded image')
    if base is not None:
        px = np.array(base.pixels[:], dtype=np.float32).reshape(-1, 4)
        ok(px[:, :3].std() > 0.05 and 0.15 < px[:, :3].mean() < 0.95, 'the image has real content (mean %.2f, std %.2f)' % (px[:, :3].mean(), px[:, :3].std()))
    # and it survives the whole workflow, textures included
    s.count, s.seed, s.rough = 16, 3, 0.1
    bpy.ops.shardsmith.fracture(explode=True)
    os.makedirs(OUT, exist_ok=True)
    s.export_path = os.path.abspath(OUT)
    s.export_name = 'kimi_ktx_explosion'
    s.export_ktx2 = False
    ok('FINISHED' in bpy.ops.shardsmith.bake(), 'bake')
    ok('FINISHED' in bpy.ops.shardsmith.export_glb(), 'export')
    j, binc = glb_read(os.path.join(os.path.abspath(OUT), 'kimi_ktx_explosion.glb'))
    ok(len(j.get('images', [])) >= 1 and all(i.get('mimeType') in ('image/png', 'image/jpeg') for i in j['images']), 'the exported GLB carries the textures (%s)' % [i.get('mimeType') for i in j.get('images', [])])
    ok(any('baseColorTexture' in m.get('pbrMetallicRoughness', {}) for m in j['materials']), 'and the materials still use them')
    # ...and the export can hand them back as KTX2, which is what the game loads
    png_size = os.path.getsize(os.path.join(os.path.abspath(OUT), 'kimi_ktx_explosion.glb'))
    ok(importer.find_tool(importer.ENCODER, os.path.abspath(OUT), None) is not None, 'the encoder is found from the export folder')
    s.export_name, s.export_ktx2 = 'kimi_ktx_explosion_ktx2', True
    ok('FINISHED' in bpy.ops.shardsmith.export_glb(), 'export with compression')
    p2 = os.path.join(os.path.abspath(OUT), 'kimi_ktx_explosion_ktx2.glb')
    j2, _ = glb_read(p2)
    ok(j2.get('images') and all(i.get('mimeType') == 'image/ktx2' for i in j2['images']), 'the textures are KTX2 (%s)' % [i.get('mimeType') for i in j2.get('images', [])])
    ok('KHR_texture_basisu' in (j2.get('extensionsRequired') or []), 'and the file declares KHR_texture_basisu')
    ok(len(j2.get('animations', [])) == len(j.get('animations', [])) and len(j2['nodes']) == len(j['nodes']), 'animation and pieces are untouched by the compression')
    print('   %.1f MB as PNG, %.1f MB as KTX2' % (png_size / 1e6, os.path.getsize(p2) / 1e6))
    ok(not os.path.exists(os.path.join(os.path.abspath(OUT), 'kimi_ktx_explosion_ktx2.ktx2tmp.glb')), 'no temporary file is left behind')
    # a GLB with no decoder anywhere near it still imports (geometry and materials, no textures)
    clear()
    enable_addon()
    import tempfile
    stray = tempfile.mkdtemp(prefix='shardsmith_stray_')          # outside the project: no tools/ktx2-decode.mjs above it
    dst = os.path.join(stray, 'kimi.glb')
    shutil.copyfile(src, dst)
    ok(importer.find_decoder(dst, None) is None, 'no decoder can be found from that location')
    r = bpy.ops.shardsmith.import_glb(filepath=dst)
    ok('FINISHED' in r, 'a KTX2 file with no decoder available still imports')
    ob = bpy.context.view_layer.objects.active
    ok(ob is not None and ob.type == 'MESH' and len(ob.data.polygons) > 1000, 'with its geometry (%d faces)' % (len(ob.data.polygons) if ob else 0))
    ok(ob is not None and 'kit_kimi' in [m.name for m in ob.data.materials if m], 'and its materials')
    ok(not [i for i in bpy.data.images if i.size[0] > 0 and i.name not in ('Render Result', 'Viewer Node')], 'but no textures')

    class Prefs:
        project_folder = root
        node_path = ''
    ok(importer.find_decoder(dst, Prefs) is not None, 'the project-folder preference finds the decoder for a file that lives elsewhere')
    shutil.rmtree(stray, ignore_errors=True)


def t_import_plain():
    """A GLB without KTX2 goes straight through the normal importer."""
    from shardsmith import importer
    ob = prim('ico')
    ob.data.materials.append(bpy.data.materials.new('Plain'))
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'plain_ico.glb')
    ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True)
    ok(not importer.needs_ktx2_decode(path), 'not detected as KTX2')
    clear()
    enable_addon()
    ok('FINISHED' in bpy.ops.shardsmith.import_glb(filepath=path), 'import_glb finishes')
    ob = bpy.context.view_layer.objects.active
    ok(ob is not None and ob.type == 'MESH' and [m.name for m in ob.data.materials] == ['Plain'], 'mesh and material imported')


# --- the Innerds material --------------------------------------------------------------------------------------
def t_innerds():
    """A wet, slightly gory material whose colour is set per species, and which survives glTF export."""
    from shardsmith import innerds
    a, n = innerds.make_maps(128, 3)
    ok(a.shape == (128, 128) and n.shape == (128, 128, 3), 'maps have the right shape')
    ok(0.15 <= a.min() and a.max() <= 1.0 and 0.35 < a.mean() < 0.8, 'albedo is a grey value map with real tonal range (mean %.2f, min %.2f, max %.2f)' % (a.mean(), a.min(), a.max()))
    ok(a.std() > 0.1, 'and real variation (std %.2f)' % a.std())
    ok(n[:, :, 2].mean() > 0.8 and 0.0 <= n.min() and n.max() <= 1.0, 'normal map is mostly facing out (mean blue %.2f)' % n[:, :, 2].mean())
    step = np.abs(a[:, 40:41] - a[:, 41:42]).mean() + 0.02
    ok(np.abs(a[:, 0] - a[:, -1]).mean() < 2.5 * step and np.abs(a[0] - a[-1]).mean() < 2.5 * step, 'the albedo tiles seamlessly')
    a2, _ = innerds.make_maps(128, 4)
    ok(np.abs(a - a2).mean() > 0.02, 'a different seed gives a different pattern')

    clear()
    ob = prim('ico')
    s = enable_addon()
    ok('FINISHED' in bpy.ops.shardsmith.create_innerds(species='ALIEN_GREEN', size='256'), 'create_innerds finishes')
    mat = s.interior_material
    ok(mat is not None and mat.name == 'Innerds' and innerds.is_innerds(mat), 'the material is called Innerds and is set as the interior material')
    imgs = [i for i in bpy.data.images if i.name.startswith('Innerds ')]
    ok(len(imgs) == 2 and all(i.packed_file is not None and tuple(i.size) == (256, 256) for i in imgs), 'two maps are generated and packed into the file')
    ok(imgs[0].colorspace_settings.name != imgs[1].colorspace_settings.name, 'colour and normal map use different colour spaces (%s / %s)' % (imgs[0].colorspace_settings.name, imgs[1].colorspace_settings.name))
    alb = next(i for i in imgs if 'Albedo' in i.name)
    nor = next(i for i in imgs if 'Normal' in i.name)
    pa = np.array(alb.pixels[:], dtype=np.float32).reshape(-1, 4)
    pn = np.array(nor.pixels[:], dtype=np.float32).reshape(-1, 4)
    ok(pa[:, :3].std() > 0.1, 'the albedo image actually holds the pattern (std %.2f)' % pa[:, :3].std())
    ok(pn[:, 2].mean() > 0.8 and pn[:, 0].std() > 0.005, 'and the normal image holds a normal map (blue %.2f, red spread %.3f)' % (pn[:, 2].mean(), pn[:, 0].std()))
    ctl = innerds.controls(mat)
    ok(set(ctl) == {'colour', 'wet', 'bump'}, 'the panel controls are found (%s)' % sorted(ctl))
    green = innerds.COLOURS['ALIEN_GREEN']
    ok(all(abs(ctl['colour'].default_value[i] - green[i]) < 1e-5 for i in range(3)), 'species colour applied')
    ok('FINISHED' in bpy.ops.shardsmith.create_innerds(species='HUMAN'), 'recolouring finishes')
    ok(len([m for m in bpy.data.materials if innerds.is_innerds(m)]) == 1, 'recolouring reuses the same material, no duplicate')
    ok(abs(innerds.controls(mat)['colour'].default_value[0] - innerds.COLOURS['HUMAN'][0]) < 1e-5, 'and changes its colour')

    # a material of the user's own under the same name is never touched
    clear()
    ob = prim('ico')
    s = enable_addon()
    mine = bpy.data.materials.new('Innerds')
    mine.diffuse_color = (0.1, 0.2, 0.3, 1.0)
    bpy.ops.shardsmith.create_innerds(species='HUMAN', size='256')
    ours = s.interior_material
    ok(ours is not mine and ours.name != 'Innerds' and innerds.is_innerds(ours), 'an existing hand-made Innerds is left alone; ours is named %s' % ours.name)
    ok(tuple(round(x, 3) for x in mine.diffuse_color) == (0.1, 0.2, 0.3, 1.0) and not innerds.is_innerds(mine), 'and it is unchanged')

    # through the whole workflow and out to the game
    clear()
    ob = prim('ico')
    ob.data.materials.append(bpy.data.materials.new('Skin'))
    s = enable_addon()
    bpy.ops.shardsmith.create_innerds(species='ALIEN_PURPLE', size='256')
    shards = run_blast(ob, count=10, seed=2, duration=0.5)
    ok(any(m and m.name == 'Innerds' for m in shards[0].data.materials), 'the shards use the Innerds material')
    os.makedirs(OUT, exist_ok=True)
    s.export_path = os.path.abspath(OUT)
    ok('FINISHED' in bpy.ops.shardsmith.bake(), 'bake')

    def exported_material(name):
        s.export_name = name
        ok('FINISHED' in bpy.ops.shardsmith.export_glb(), 'export ' + name)
        j, _ = glb_read(os.path.join(os.path.abspath(OUT), name + '.glb'))
        return j, next(m for m in j['materials'] if m['name'] == 'Innerds')
    j, m = exported_material('innerds_purple')
    pbr = m['pbrMetallicRoughness']
    ok('baseColorTexture' in pbr, 'exported with its albedo texture')
    purple = innerds.COLOURS['ALIEN_PURPLE']
    fac = pbr.get('baseColorFactor', [1, 1, 1, 1])
    ok(all(abs(fac[i] - purple[i]) < 1e-3 for i in range(3)), 'and the species colour as baseColorFactor (%s)' % [round(x, 3) for x in fac])
    ok('normalTexture' in m, 'with its normal map')
    ok('KHR_materials_clearcoat' in (m.get('extensions') or {}), 'and the wet clearcoat')
    ok(len(j['images']) >= 2, 'both images are in the GLB (%d)' % len(j['images']))
    innerds.set_colour(s.interior_material, innerds.COLOURS['ALIEN_GREEN'])
    j, m = exported_material('innerds_green')
    fac = m['pbrMetallicRoughness'].get('baseColorFactor', [1, 1, 1, 1])
    green = innerds.COLOURS['ALIEN_GREEN']
    ok(all(abs(fac[i] - green[i]) < 1e-3 for i in range(3)), 'changing the species colour changes the exported colour (%s)' % [round(x, 3) for x in fac])


def t_innerds_saved():
    """The generated maps must survive saving the .blend and opening it again."""
    from shardsmith import innerds
    clear()
    prim('ico')
    s = enable_addon()
    bpy.ops.shardsmith.create_innerds(species='CYBORG', size='256')
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'innerds_saved.blend')
    bpy.ops.wm.save_as_mainfile(filepath=path)
    bpy.ops.wm.open_mainfile(filepath=path)
    mat = bpy.data.materials.get('Innerds')
    ok(mat is not None and innerds.is_innerds(mat), 'the material is still there after reopening')
    imgs = [i for i in bpy.data.images if i.name.startswith('Innerds ')]
    ok(len(imgs) == 2 and all(i.packed_file is not None for i in imgs), 'both maps are packed in the file')
    alb = next((i for i in imgs if 'Albedo' in i.name), None)
    px = np.array(alb.pixels[:], dtype=np.float32).reshape(-1, 4) if alb else np.zeros((1, 4))
    ok(px[:, :3].std() > 0.05, 'and still hold their pattern (std %.2f)' % px[:, :3].std())
    ok(all(abs(innerds.controls(mat)['colour'].default_value[i] - innerds.COLOURS['CYBORG'][i]) < 1e-5 for i in range(3)), 'and the species colour is kept')


def t_uv_scale_invariant():
    """Inside-face UVs are in piece widths, so the same texture looks the same on a small prop and a large figurine."""
    ranges = []
    for k in (1.0, 6.0):
        ob = prim('cube')
        ob.data.uv_layers.new(name='UVMap')
        ob.scale = (k, k, k)
        bpy.context.view_layer.update()
        src, rep = load(ob)
        res = engine.run(src, engine.Params(count=12, seed=3, merge_small=False))
        pc = max(res.pieces, key=lambda q: q.volume)
        ranges.append(float(np.ptp(pc.uvs[0][pc.is_cap])) if pc.uvs and pc.is_cap.any() else 0.0)
    print('   uv extent per piece: scale 1 -> %.3f, scale 6 -> %.3f' % tuple(ranges))
    ok(min(ranges) > 0.2, 'inside faces have a real UV extent (%.2f, %.2f)' % tuple(ranges))
    ok(abs(ranges[0] - ranges[1]) < 0.2 * max(ranges), 'and it does not depend on the size of the object')


def t_transform():
    ob = prim('cube')
    ob.scale = (1.0, 2.0, 0.5)
    ob.rotation_euler = (0.3, 0.2, 0.9)
    ob.location = (3, -2, 5)
    bpy.context.view_layer.update()
    src, rep, res, t = frac(ob, count=18, seed=9)
    ok(abs(src.volume - 8 * 1.0 * 2.0 * 0.5) < 1e-6, 'world-space volume respects object transform (%.4f)' % src.volume)
    check_solid(res, src, t)



# --- the add-on as a user runs it -----------------------------------------------------------------------------
def enable_addon():
    import shardsmith
    try:
        shardsmith.unregister()
    except Exception:
        pass
    shardsmith.register()
    return bpy.context.scene.shardsmith


def glb_json(path):
    import json
    import struct
    with open(path, 'rb') as f:
        data = f.read()
    magic, ver, length = struct.unpack('<4sII', data[:12])
    clen, ctype = struct.unpack('<II', data[12:20])
    return json.loads(data[20:20 + clen].decode('utf8'))


def glb_read(path):
    import json
    import struct
    d = open(path, 'rb').read()
    off, chunks = 12, []
    while off < len(d):
        cl, ct = struct.unpack('<II', d[off:off + 8])
        chunks.append(d[off + 8:off + 8 + cl])
        off += 8 + cl
    return json.loads(chunks[0].decode('utf8')), chunks[1]


def glb_vertex_norms(j, binc, node_name):
    """Sorted distances from the origin of the unique POSITION values of a node's mesh (axis-swap invariant)."""
    node = next(n for n in j['nodes'] if n.get('name') == node_name)
    acc = j['accessors'][j['meshes'][node['mesh']]['primitives'][0]['attributes']['POSITION']]
    bv = j['bufferViews'][acc['bufferView']]
    off = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    v = np.frombuffer(binc, dtype='<f4', count=acc['count'] * 3, offset=off).reshape(-1, 3)
    v = np.unique(np.round(v, 5), axis=0)
    return np.sort(np.linalg.norm(v, axis=1))


def t_addon_pipeline():
    """Register the add-on, fracture, explode, run the simulation, bake, export, reset."""
    from mathutils import Vector
    ob = prim('cube')
    ob.data.materials.append(bpy.data.materials.new('Skin'))
    s = enable_addon()
    ok(hasattr(bpy.types.Scene, 'shardsmith'), 'add-on registers')
    s.count, s.seed, s.rough, s.detail = 24, 3, 0.15, 0.25
    s.start_frame, s.blast_speed, s.wave_speed, s.duration = 6, 3.0, 4.0, 2.5
    s.blast_spread, s.speed_variation, s.spin = 0.2, 0.0, 1.0
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    r = bpy.ops.shardsmith.fracture(explode=True)
    ok('FINISHED' in r, 'fracture operator finishes')
    col, shards = None, []
    from shardsmith.operators import shards_of
    col, shards = shards_of(ob)
    ok(len(shards) >= 10, 'pieces were created (%d)' % len(shards))
    ok(ob.hide_get() or ob.hide_viewport, 'source is hidden')
    ok(all(o.rigid_body is not None for o in shards), 'every piece is a rigid body')
    ok(bpy.data.objects.get('SS_Floor') is not None, 'floor exists')
    bad = sum(1 for o in shards if o.data.validate(verbose=False))
    ok(bad == 0, 'meshes validate clean (%d changed)' % bad)
    mats = [m.name if m else None for m in shards[0].data.materials]
    ok(mats[:1] == ['Skin'] and len(mats) == 2, 'source material kept in slot 0, interior added in slot 1 (%s)' % mats)
    sc = bpy.context.scene
    end = sc.frame_end
    rest = {o.name: Vector(o['ss_rest']) for o in shards}
    launch = {o.name: Vector(o['ss_launch']) for o in shards}
    traj = {}
    fps = sc.render.fps / sc.render.fps_base
    for f in range(1, end + 1):
        sc.frame_set(f)
        traj[f] = {o.name: o.matrix_world.translation.copy() for o in shards}
    d0 = max((traj[3][n] - rest[n]).length for n in rest)
    ok(d0 < 1e-5, 'pieces hold still before the blast (max drift %.2e)' % d0)
    lo = min(v.z for v in (rest[n] for n in rest)) - 1.0
    # release-time velocity: the piece speed one frame after its release should match the launch
    errs = []
    for n in rest:
        t = traj[end][n]
        pass
    mean_out0 = np.mean([(rest[n] - Vector((0, 0, 0))).length for n in rest])
    mean_out1 = np.mean([(traj[end][n] - Vector((0, 0, 0))).length for n in rest])
    ok(mean_out1 > mean_out0 * 2.0, 'pieces flew outward (mean radius %.2f -> %.2f)' % (mean_out0, mean_out1))
    floor_z = -1.0
    def lowest_vertex(o):
        co = np.empty(len(o.data.vertices) * 3)
        o.data.vertices.foreach_get('co', co)
        mw = np.array(o.matrix_world)
        return float((co.reshape(-1, 3) @ mw[:3, :3].T)[:, 2].min() + mw[2, 3])
    zmin = min(lowest_vertex(o) for o in shards)
    ok(zmin > floor_z - 0.1, 'nothing fell through the floor (lowest vertex %.3f, floor %.3f)' % (zmin, floor_z))
    # first-frame velocity check on the earliest-released pieces
    first = min(range(1, end + 1), key=lambda f: -1 if any((traj[f][n] - rest[n]).length > 1e-4 for n in rest) else 1e9)
    moved = [f for f in range(1, end + 1) if any((traj[f][n] - rest[n]).length > 1e-4 for n in rest)]
    f0 = moved[0]
    dt = 1.0 / fps
    rel = []
    for n in rest:
        if (traj[f0 + 3][n] - rest[n]).length < 1e-4:
            continue
        # find this piece's own release: first frame it moved
        fm = next(f for f in range(1, end + 1) if (traj[f][n] - rest[n]).length > 1e-4)
        if fm + 2 > end:
            continue
        v = (traj[fm + 2][n] - traj[fm + 1][n]) / dt
        v = v + Vector((0, 0, -sc.gravity.z * 1.5 * dt))   # undo the gravity of the frames since release
        want = launch[n]
        rel.append((v - want).length / max(want.length, 1e-6))
    ok(len(rel) > 5 and float(np.median(rel)) < 0.2, 'measured launch velocity matches the commanded one (median error %.1f%%, %d pieces)' % (100 * float(np.median(rel)), len(rel)))
    # bake
    before = {n: traj[end][n].copy() for n in rest}
    r = bpy.ops.shardsmith.bake()
    ok('FINISHED' in r, 'bake finishes')
    ok(all(o.rigid_body is None for o in shards), 'rigid bodies removed after bake')
    from shardsmith.physics import fcurves_of
    paths = {f.data_path for _, f in fcurves_of(shards[0])}
    ok('location' in paths and any(p.startswith('rotation') for p in paths) and not any(p.startswith('rigid_body') for p in paths), 'baked curves are transform-only (%s)' % sorted(paths))
    sc.frame_set(end)
    d1 = max((o.matrix_world.translation - before[o.name]).length for o in shards)
    ok(d1 < 0.05, 'baked animation reproduces the simulation (max diff %.4f)' % d1)
    # export
    os.makedirs(OUT, exist_ok=True)
    s.export_path = os.path.abspath(OUT)
    s.export_name = 'test_explosion'
    r = bpy.ops.shardsmith.export_glb()
    path = os.path.join(os.path.abspath(OUT), 'test_explosion.glb')
    ok('FINISHED' in r and os.path.exists(path), 'GLB written (%s)' % (os.path.getsize(path) if os.path.exists(path) else 'missing'))
    if os.path.exists(path):
        j = glb_json(path)
        ok(len(j.get('animations', [])) >= 1, 'GLB has animation (%d clip(s), %d channels)' % (len(j.get('animations', [])), sum(len(a['channels']) for a in j.get('animations', []))))
        ok(len(j['nodes']) >= len(shards), 'GLB has one node per piece (%d)' % len(j['nodes']))
        ok(len(j.get('materials', [])) >= 2, 'GLB keeps the materials (%s)' % [m.get('name') for m in j.get('materials', [])])
    # reset + clear
    r = bpy.ops.shardsmith.reset_physics()
    d2 = max((o.matrix_world.translation - rest[o.name]).length for o in shards)
    ok(d2 < 1e-6, 'reset puts every piece back (%.2e)' % d2)
    r = bpy.ops.shardsmith.clear()
    ok(not any(c.name.startswith('cube_Shards') for c in bpy.data.collections) and not ob.hide_get() and 'ss_shards' not in ob, 'clear deletes the result and shows the source')
    ok(bpy.data.objects.get('SS_Floor') is None, 'clear removes the floor')
    import shardsmith
    shardsmith.unregister()
    ok(not hasattr(bpy.types.Scene, 'shardsmith'), 'add-on unregisters')


# --- the export is always the complete animation --------------------------------------------------------------
def t_export_flow():
    """Whatever state the scene is in when Export is pressed, the GLB holds the whole animation.

    A scene that was only shattered exported no animation at all, and one that was set up but not baked exported
    the handful of keys of the launch, so in the game the pieces stopped dead in mid-air a third of a second in."""
    from shardsmith.operators import shards_of
    from shardsmith.physics import animation_state, glb_report
    os.makedirs(OUT, exist_ok=True)
    out = os.path.abspath(OUT)
    for flow in ('shatter_only', 'unbaked', 'baked'):
        print(' flow', flow)
        ob = prim('ico')
        s = enable_addon()
        s.count, s.seed, s.rough, s.detail, s.duration = 14, 5, 0.2, 0.2, 1.5
        s.export_path, s.export_name, s.export_ktx2 = out, 'flow_%s' % flow, False
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.shardsmith.fracture(explode=(flow != 'shatter_only'))
        shards = shards_of(ob)[1]
        state = animation_state(shards)
        ok(state == {'shatter_only': 'NONE', 'unbaked': 'SIM', 'baked': 'SIM'}[flow], '%s: starts as %s' % (flow, state))
        if flow == 'baked':
            ok('FINISHED' in bpy.ops.shardsmith.bake(), 'bake finishes')
            ok(animation_state(shards) == 'BAKED', 'and leaves plain keyframes')
            ok('CANCELLED' in bpy.ops.shardsmith.bake(), 'a second bake is refused')
        ok('FINISHED' in bpy.ops.shardsmith.export_glb(), flow + ': export finishes')
        ok(animation_state(shards) == 'BAKED', flow + ': the scene is baked afterwards')
        sc = bpy.context.scene
        fps = sc.render.fps / sc.render.fps_base
        rep = glb_report(os.path.join(out, 'flow_%s.glb' % flow))
        ok(rep['clips'] >= 1 and rep['channels'] >= 2 * len(shards), '%s: %d clip(s), %d channels for %d pieces' % (flow, rep['clips'], rep['channels'], len(shards)))
        ok(abs(rep['seconds'] - sc.frame_end / fps) < 1.5 / fps, '%s: the clip runs to the end of the simulation (%.2f s, scene %.2f s)' % (flow, rep['seconds'], sc.frame_end / fps))
        ok(rep['keys'] >= 0.9 * (sc.frame_end - sc.frame_start), '%s: a key per frame (%d)' % (flow, rep['keys']))
    # Bake Step keys every Nth frame, but must still simulate every frame (Bullet advances one frame per evaluation)
    ob = prim('ico')
    s = enable_addon()
    s.count, s.seed, s.rough, s.detail, s.duration, s.bake_step, s.settle = 14, 5, 0.2, 0.2, 1.5, 3, False
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.shardsmith.fracture(explode=True)
    shards = shards_of(ob)[1]
    sc = bpy.context.scene
    end = sc.frame_end
    for f in range(1, end + 1):                                  # Bullet only advances one frame at a time
        sc.frame_set(f)
    ref = {o.name: o.matrix_world.translation.copy() for o in shards}
    ok('FINISHED' in bpy.ops.shardsmith.bake(), 'bake with a step of 3')
    sc.frame_set(end)
    diff = max((o.matrix_world.translation - ref[o.name]).length for o in shards)
    ok(diff < 0.05, 'a stepped bake still reproduces the simulation (max diff %.4f)' % diff)
    # Run Until Settled: a Duration that ends while pieces are still moving is extended until nothing moves,
    # unless it is switched off
    for settle, dur in ((False, 1.5), (True, 1.5), (True, 0.2)):
        ob = prim('ico')
        s = enable_addon()
        s.count, s.seed, s.rough, s.detail, s.duration, s.settle = 14, 5, 0.2, 0.2, dur, settle
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.shardsmith.fracture(explode=True)
        shards = shards_of(ob)[1]
        sc = bpy.context.scene
        end0 = sc.frame_end
        info = physics_bake(shards)
        if not settle:
            ok(info['extended'] == 0 and sc.frame_end == end0, 'switched off, the timeline is left alone (%d)' % end0)
            ok(not info['settled'], 'and the report says the pieces were still moving')
        else:
            ok(info['extended'] > 0 and sc.frame_end > end0, 'a %.1f s Duration is extended (%d -> %d)' % (dur, end0, sc.frame_end))
            if dur >= 1.0:
                ok(info['settled'], 'and the pieces are at rest at the end')
    # the extension is real simulation, not held poses: it matches a run that was simply long enough
    at = {}
    for dur, settle in ((1.5, True), (5.0, False)):
        ob = prim('ico')
        s = enable_addon()
        s.count, s.seed, s.rough, s.detail, s.duration, s.settle = 14, 5, 0.2, 0.2, dur, settle
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.shardsmith.fracture(explode=True)
        shards = shards_of(ob)[1]
        physics_bake(shards)
        bpy.context.scene.frame_set(70)
        at[dur] = np.array([list(o.matrix_world.translation) for o in shards])
    gap = float(np.abs(at[1.5] - at[5.0]).max())
    ok(gap < 1e-3, 'frames past the original end are the same simulation a longer Duration gives (max diff %.5f)' % gap)


def physics_bake(shards):
    from shardsmith import physics
    return physics.bake(bpy.context, shards, bpy.context.scene.shardsmith)


def t_resimulate():
    """Change a setting and Set Up Explosion again after a bake (the workflow the README describes).

    The bake removes the floor's rigid body but leaves the floor object, and setting up again then failed on it."""
    from shardsmith.operators import shards_of
    from shardsmith.physics import animation_state
    ob = prim('ico')
    s = enable_addon()
    s.count, s.seed, s.rough, s.detail, s.duration = 14, 5, 0.2, 0.2, 1.0
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.shardsmith.fracture(explode=True)
    shards = shards_of(ob)[1]
    ok('FINISHED' in bpy.ops.shardsmith.bake(), 'first bake')
    fl = bpy.data.objects.get('SS_Floor')
    ok(fl is not None and fl.rigid_body is None, 'the baked floor is a plain object again')
    s.blast_speed = 1.0
    ok('FINISHED' in bpy.ops.shardsmith.explode(), 'Set Up Explosion works again after a bake')
    ok(animation_state(shards) == 'SIM' and fl.rigid_body is not None, 'and the floor is a rigid body once more')
    ok('FINISHED' in bpy.ops.shardsmith.bake(), 'second bake')
    ok(animation_state(shards) == 'BAKED', 'and it is baked')


def t_find_pops():
    """The bake keeps a piece off the shared collision layer if it would be pushed out of a neighbour when it joins."""
    from shardsmith import physics

    class RB:
        def __init__(self, m):
            self.mass = m

    class Ob:
        def __init__(self, m):
            self.rigid_body = RB(m)

    N = np.array([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], float)
    hull = (N, np.full(6, 0.5), np.array([[x, y, z] for x in (-.5, .5) for y in (-.5, .5) for z in (-.5, .5)], float), 0.87)
    eye = np.eye(3)

    def frames(*offsets):
        T = np.array([[0, 0, 0]] + [list(o) for o in offsets], float)
        return [T] * 40, [np.array([eye] * len(T))] * 40

    shards, hulls = [Ob(1.0), Ob(0.1)], [hull, hull]
    T, R = frames((0.5, 0.1, 0.1))                                   # unit cubes overlapping by 0.1
    ok(physics.find_pops(shards, hulls, T, R, [10, 10], 1, 0.01) == [1], 'joining together while overlapping: the lighter one is kept off')
    ok(physics.find_pops(shards, hulls, T, R, [10, 20], 1, 0.01) == [1], 'the piece that joins later is the one kept off')
    ok(physics.find_pops(shards, hulls, T, R, [20, 10], 1, 0.01) == [0], 'whichever it is')
    ok(physics.find_pops(shards, hulls, T, R, [10, -1], 1, 0.01) == [], 'a piece that never joins is not checked')
    ok(physics.find_pops(shards, hulls, T, R, [10, 10], 1, 0.2) == [], 'an overlap below the tolerance is left alone')
    T, R = frames((1.5, 0.0, 0.0))
    ok(physics.find_pops(shards, hulls, T, R, [10, 10], 1, 0.01) == [], 'pieces that are clear of each other are left alone')
    T, R = frames((0.5, 0.1, 0.1))
    ok(physics.find_pops(shards, hulls, T, R, [10, 10], 5, 0.01) == [1], 'and the frame is read relative to the timeline start')


def t_collapse_preset():
    """Figurine Collapse must stay inside what the game's existing explosion clips do (measured: peak ~1.3 model
    heights per second, pieces landing a median 0.23 / p90 0.39 / max 0.5 heights from where they started)."""
    from shardsmith.operators import shards_of
    root = os.path.abspath(os.path.join(HERE, '..', '..'))
    fps = 24.0
    for name in ('alienKatum', 'alienGrimlot'):
        path = os.path.join(root, 'assets', 'fuzeball_%s.glb' % name)
        if not os.path.exists(path):
            print('   skip %s (asset missing)' % name)
            continue
        print(' figurine', name)
        clear()
        s = enable_addon()
        bpy.ops.shardsmith.import_glb(filepath=path, texture_size='512')
        ob = bpy.context.view_layer.objects.active
        s.preset = 'FIGURINE'
        s.count, s.seed = 30, 3
        ob.select_set(True)
        bpy.ops.shardsmith.fracture(explode=True)
        shards = shards_of(ob)[1]
        size = float(max(ob.dimensions))
        rest = np.array([list(o['ss_rest']) for o in shards])
        info = physics_bake(shards)
        sc = bpy.context.scene
        T = np.empty((info['last'], len(shards), 3))
        for f in range(1, info['last'] + 1):
            sc.frame_set(f)
            for i, o in enumerate(shards):
                T[f - 1, i] = o.matrix_world.translation
        trav = np.linalg.norm(T[-1, :, :2] - rest[:, :2], axis=1) / size
        peak = float((np.linalg.norm(np.diff(T, axis=0), axis=2) * fps).max()) / size
        kept = sum(1 for o in shards if o.get('ss_join', 0) == -1)
        print('   travel/size median %.2f p90 %.2f max %.2f, peak/size %.2f, %.1f s, %d pieces kept off the shared layer' % (
            np.median(trav), np.percentile(trav, 90), trav.max(), peak, info['last'] / fps, kept))
        ok(np.median(trav) < 0.35 and np.percentile(trav, 90) < 0.7, '%s: the pieces land close to where the figure stood' % name)
        ok(trav.max() < 1.0, '%s: nothing is thrown a whole model height away (%.2f)' % (name, trav.max()))
        ok(peak < 1.6, '%s: nothing moves faster than the game clips do (%.2f heights/s)' % (name, peak))
        ok(info['settled'] and info['last'] / fps < 12.0, '%s: it settles and the clip is a sensible length (%.1f s)' % (name, info['last'] / fps))


def t_no_flung_pieces():
    """No piece may leave at many times the blast speed. Blast the game's own figurines and look at the fastest frame.

    Three things did this. A piece resting on the floor that was launched spinning swung its corners through the floor
    in the one-frame launch step, and Bullet ejected it. Pieces that pass through each other during the break-up
    delay and are still overlapping when the delay ends are pushed apart at a speed proportional to the overlap over
    the substep length, so a high substep count made it worse. And a tiny shard pinned under a heavy piece was ejected
    the same way (split impulse and a limit on the mass ratio stop that)."""
    from shardsmith.operators import shards_of
    root = os.path.abspath(os.path.join(HERE, '..', '..'))
    fps = 24.0
    for preset, names in (('BURST', ('alienGrimlot', 'alienKatum', 'alienZargon', 'womanKimi', 'womanMaria', 'rocko')),
                          ('FIGURINE', ('alienGrimlot', 'alienKatum', 'rocko'))):
        for name in names:
            path = os.path.join(root, 'assets', 'fuzeball_%s.glb' % name)
            if not os.path.exists(path):
                print('   skip %s (asset missing)' % name)
                continue
            print(' figurine', name, preset)
            clear()
            s = enable_addon()
            bpy.ops.shardsmith.import_glb(filepath=path, texture_size='512')
            ob = bpy.context.view_layer.objects.active
            s.preset = preset
            s.count, s.seed = 30, 3
            ob.select_set(True)
            bpy.ops.shardsmith.fracture(explode=True)
            shards = shards_of(ob)[1]
            sc = bpy.context.scene
            n = len(shards)
            T = np.empty((sc.frame_end, n, 3))
            for f in range(1, sc.frame_end + 1):
                sc.frame_set(f)
                for i, o in enumerate(shards):
                    T[f - 1, i] = o.matrix_world.translation
            V = np.linalg.norm(np.diff(T, axis=0), axis=2) * fps
            launch = np.array([np.linalg.norm(o['ss_launch']) for o in shards])
            size = float(max(ob.dimensions))
            g = -sc.gravity.z
            ceil = 1.6 * float(np.sqrt(launch.max() ** 2 + 2 * g * size))     # fastest launch plus a fall from the top
            print('   %d pieces, launch up to %.1f, fastest frame %.1f (ceiling %.1f)' % (n, launch.max(), V.max(), ceil))
            ok(V.max() <= ceil, '%s %s: no piece is flung (%.1f <= %.1f)' % (preset, name, V.max(), ceil))
            info = physics_bake(shards)
            ok(info['settled'], '%s %s: everything is at rest when the baked animation ends (%d frames)' % (preset, name, info['last']))


TESTS = [(n[2:], f) for n, f in sorted(globals().items()) if n.startswith('t_') and callable(f)]


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for name, fn in TESTS:
        if argv and name not in argv:
            continue
        print('== %s' % name)
        try:
            fn()
        except Exception:
            traceback.print_exc()
            FAILS.append(name + ': exception')
    print('\nRESULT: %s (%d failures)' % ('FAIL' if FAILS else 'OK', len(FAILS)))
    for f in FAILS:
        print('  -', f)
    sys.stdout.flush()
    os._exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
