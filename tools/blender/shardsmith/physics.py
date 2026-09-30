"""Explosion physics on top of Blender's rigid body world.

Blender has no "apply impulse" API, so each shard is launched the way a keyframed object is thrown: it is a
kinematic (Animated) body that is moved by v*dt between frames R-2 and R-1 and released at frame R. Bullet keeps
the velocity of the last kinematic step, so the hand-over is exact (measured in the test suite for linear speed
and spin). A shockwave delay staggers R with distance from the blast.

Every animation-data access goes through fcurves_of(), which understands both the pre-5.0 Action.fcurves and the
layered-action API that replaced it.
"""
import contextlib
import math

import bpy
import numpy as np
from mathutils import Quaternion, Vector

from .objects import ROUGH_KEY

DENSITY = {'PLASTIC': 1100.0, 'CERAMIC': 2400.0, 'STONE': 2600.0, 'CONCRETE': 2400.0, 'WOOD': 700.0,
           'GLASS': 2500.0, 'METAL': 7800.0, 'RUBBER': 1100.0, 'FOAM': 60.0}
FLOOR_NAME = "SS_Floor"


# ---------------------------------------------------------------------------------------------------------
# animation API compatibility
# ---------------------------------------------------------------------------------------------------------
def fcurves_of(ob):
    """[(collection, fcurve)] for every fcurve on an object's action, on any Blender version."""
    ad = ob.animation_data
    act = ad.action if ad else None
    out = []
    if act is None:
        return out
    fc = getattr(act, 'fcurves', None)
    if fc is not None:
        return [(fc, f) for f in list(fc)]
    for layer in act.layers:
        for strip in layer.strips:
            for cb in getattr(strip, 'channelbags', []):
                out.extend((cb.fcurves, f) for f in list(cb.fcurves))
    return out


def set_constant(ob, path):
    for _, f in fcurves_of(ob):
        if f.data_path == path:
            for k in f.keyframe_points:
                k.interpolation = 'CONSTANT'


def drop_curves(ob, prefix):
    for coll, f in fcurves_of(ob):
        if f.data_path.startswith(prefix):
            coll.remove(f)



COMMON_LAYER = 19
MASS_SPREAD = 4.0


def piece_geometry(shards):
    """[(world rest vertices of the UNDISPLACED piece, centre, mean squared radius)] per shard.

    The mesh data of a rough shard is its flat basis (the roughness is a shape key), which is also what the rigid
    body builds its collision hull from, so this is the shape the physics actually sees."""
    out = []
    for ob in shards:
        n = len(ob.data.vertices)
        co = np.empty(n * 3)
        ob.data.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        loc = np.array(rest_location(ob))
        out.append((co + loc, loc, float((co * co).sum(axis=1).mean())))
    return out


def piece_contacts(geo, size, floor_top, prox=0.08):
    """Contact patches between pieces that touch or nearly touch, and between pieces and the floor.

    Pieces are neighbours where they have vertices within `prox` of the object size of each other (touching pieces
    share fracture-wall vertices; pieces that merely come close still have colliding hulls, so they count too).
    Returns ([(i, j, n, points, push)], adjacency): n points from piece i toward j, j = -1 is the floor (n points
    down), push is 1 for pieces that really touch (they get separated) and 0 for close ones (they only must not
    approach)."""
    from mathutils.kdtree import KDTree
    n = len(geo)
    near = max(size, 1e-6) * prox
    touch = max(size, 1e-6) * 5e-4
    total = sum(len(g[0]) for g in geo)
    kd = KDTree(total)
    owner = np.empty(total, np.int64)
    pos = np.empty((total, 3))
    k = 0
    for i, g in enumerate(geo):
        for q in g[0]:
            kd.insert(q.tolist(), k)
            owner[k] = i
            pos[k] = q
            k += 1
    kd.balance()
    pts = {}
    dmin = {}
    for k in range(total):
        i = int(owner[k])
        for _, idx, dist in kd.find_range(pos[k].tolist(), near):
            j = int(owner[idx])
            if j > i:
                pts.setdefault((i, j), []).append(0.5 * (pos[k] + pos[idx]))
                dmin[(i, j)] = min(dmin.get((i, j), 1e30), dist)
    contacts = []
    adj = [set() for _ in range(n)]
    for (i, j), P in pts.items():
        P = np.array(P)
        adj[i].add(j)
        adj[j].add(i)
        cij = geo[j][1] - geo[i][1]
        nrm = None
        if len(P) >= 3:
            _, sv, vt = np.linalg.svd(P - P.mean(axis=0), full_matrices=False)
            if sv[1] > 1e-3 * max(sv[0], 1e-30):
                nrm = vt[2]
        if nrm is None:
            nrm = cij / max(np.linalg.norm(cij), 1e-12)
        if nrm @ cij < 0:
            nrm = -nrm
        if len(P) > 16:
            P = P[np.linspace(0, len(P) - 1, 16).astype(int)]
        contacts.append((i, j, nrm, P, 1.0 if dmin[(i, j)] <= touch else 0.0))
    if floor_top is not None:
        for i, g in enumerate(geo):
            low = g[0][g[0][:, 2] <= floor_top + max(size, 1e-6) * 2e-3]
            if len(low):
                if len(low) > 16:
                    low = low[np.linspace(0, len(low) - 1, 16).astype(int)]
                contacts.append((i, -1, np.array([0.0, 0.0, -1.0]), low, 0.0))
    return contacts, adj


def assign_layers(adj):
    """Collision layer (0..18) per piece such that pieces that touch never share one.

    Greedy colouring, most-connected first; if the palette runs out the least-used neighbour colour is reused."""
    n = len(adj)
    order = sorted(range(n), key=lambda i: -len(adj[i]))
    col = [-1] * n
    for i in order:
        used = {}
        for j in adj[i]:
            if col[j] >= 0:
                used[col[j]] = used.get(col[j], 0) + 1
        free = [c for c in range(COMMON_LAYER) if c not in used]
        col[i] = free[0] if free else min(used, key=used.get)
    return col


def free_release_order(contacts, vel, release):
    """Release times such that nothing is launched into a neighbour that has not been released yet.

    A shockwave from a central impact reaches the middle of the object first, but a piece in the middle is enclosed
    by pieces that would be released later and it cannot leave through them. If piece i moves toward neighbour j,
    j must be released no later than i. Only ever moves releases earlier, so it settles."""
    rel = release.copy()
    pairs = [(i, j, nrm) for i, j, nrm, _, _ in contacts if j >= 0]
    for _ in range(len(rel) + 2):
        changed = False
        for i, j, nrm in pairs:
            closing = float((vel[i] - vel[j]) @ nrm)
            if closing > 1e-9:
                if rel[j] > rel[i]:
                    rel[j] = rel[i]
                    changed = True
            elif closing < -1e-9:
                if rel[i] > rel[j]:
                    rel[i] = rel[j]
                    changed = True
        if not changed:
            break
    return rel


def solve_launch(geo, mass, vel, ang, release, contacts, vsep, iters=40):
    """Adjust launch velocities so that no two touching pieces (or a piece and the floor) move toward each other.

    Sequential impulses on the assembled pose: for every contact point the relative normal velocity, including the
    rotation of each piece about its centre, must separate at least at `vsep`. A neighbour released LATER is still
    sitting at rest while this piece makes its kinematic launch move, so it counts as fixed (kinematic bodies do not
    collide with each other, so nothing else would stop the piece passing through it).
    Without this, pieces that launch toward each other interpenetrate and Bullet shoves them apart hard."""
    n = len(geo)
    com = np.array([g[1] for g in geo])
    invm = 1.0 / mass
    invi = 1.0 / np.maximum(0.4 * mass * np.array([g[2] for g in geo]), 1e-30)
    v = vel.copy()
    w = ang.copy()
    for _ in range(iters):
        worst = 0.0
        for i, j, nrm, P, push in contacts:
            floor = j < 0
            di = True if floor else release[i] <= release[j]
            dj = False if floor else release[j] <= release[i]
            target = vsep * push
            for q in P:
                ri = q - com[i]
                vi = v[i] + np.cross(w[i], ri)
                if floor:
                    sep = -float(vi @ nrm)
                    rj = None
                else:
                    rj = q - com[j]
                    sep = float(((v[j] + np.cross(w[j], rj)) - vi) @ nrm)
                if sep >= target:
                    continue
                rin = np.cross(ri, nrm)
                k = 0.0
                if di:
                    k += invm[i] + float(rin @ rin) * invi[i]
                if dj:
                    rjn = np.cross(rj, nrm)
                    k += invm[j] + float(rjn @ rjn) * invi[j]
                if k <= 0.0:
                    continue
                lam = (target - sep) / k
                worst = max(worst, target - sep)
                if di:
                    v[i] -= lam * nrm * invm[i]
                    w[i] -= lam * rin * invi[i]
                if dj:
                    v[j] += lam * nrm * invm[j]
                    w[j] += lam * rjn * invi[j]
        if worst < 1e-6 * max(1.0, float(np.abs(vel).max())):
            break
    return v, w


def lift_from_floor(geo, vel, ang, floor_top, dt):
    """Raise the launch velocity of any piece whose launch step would end below the floor.

    The launch is a finite kinematic move (v*dt, rotated by w*dt), not an instant, and the contact constraints above
    only look at instantaneous point velocities. A piece lying on the floor that spins hard sweeps its corners through
    the floor in that one step even when every contact point is moving up, and Bullet then ejects it from the floor at
    hundreds of times the blast speed. So the final pose is checked exactly and the piece is lifted just clear of it."""
    out = vel.copy()
    for i, (P, com, _) in enumerate(geo):
        r = P - com
        th = ang[i] * dt
        a = float(np.linalg.norm(th))
        if a > 1e-9:
            ax = th / a
            c, s = math.cos(a), math.sin(a)
            r = r * c + np.cross(ax, r) * s + np.outer(r @ ax, ax) * (1.0 - c)
        low = float(com[2] + out[i][2] * dt + r[:, 2].min())
        if low < floor_top:
            out[i][2] += (floor_top - low) / dt
    return out


# ---------------------------------------------------------------------------------------------------------
def rest_location(ob):
    """Where a shard sits assembled. matrix_world is stale on a freshly created object, and moves once animated."""
    r = ob.get("ss_rest")
    return Vector(r) if r is not None else ob.location.copy()


def shards_bounds(shards):
    pts = []
    for ob in shards:
        loc = rest_location(ob)
        pts.extend(loc + Vector(c) for c in ob.bound_box)
    a = np.array([[p.x, p.y, p.z] for p in pts])
    return a.min(axis=0), a.max(axis=0)


def blast_origin(context, s, shards):
    lo, hi = shards_bounds(shards)
    c = 0.5 * (lo + hi)
    mode = s.origin_mode
    if mode == 'BASE':
        return Vector((c[0], c[1], lo[2]))
    if mode == 'CURSOR':
        return context.scene.cursor.location.copy()
    if mode == 'OBJECT' and s.origin_object is not None:
        return s.origin_object.matrix_world.translation.copy()
    return Vector(c)


def ensure_world(context):
    sc = context.scene
    if sc.rigidbody_world is None:
        bpy.ops.rigidbody.world_add()
    return sc.rigidbody_world


def _override(context, obj, objs):
    return context.temp_override(active_object=obj, object=obj, selected_objects=objs, selected_editable_objects=objs)


def make_floor(context, s, z, size, col):
    """A passive slab whose TOP face is at `z`. Bullet centres a box collider on the object origin, so the mesh is
    centred on its origin and the object is lowered by half its thickness (an origin on the top face would put
    the collider half a slab too high)."""
    t = max(size, 1e-3) * 0.5
    ob = bpy.data.objects.get(FLOOR_NAME)
    if ob is None:
        me = bpy.data.meshes.new(FLOOR_NAME)
        w = max(size, 1e-3) * 60.0
        h = t * 0.5
        v = [(-w, -w, -h), (w, -w, -h), (w, w, -h), (-w, w, -h), (-w, -w, h), (w, -w, h), (w, w, h), (-w, w, h)]
        f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        me.from_pydata(v, [], f)
        me.update()
        ob = bpy.data.objects.new(FLOOR_NAME, me)
        ob.display_type = 'WIRE'
        ob.hide_render = True
        col.objects.link(ob)
    if ob.rigid_body is None:                        # new, or left behind without one by a bake
        with _override(context, ob, [ob]):
            bpy.ops.rigidbody.objects_add(type='PASSIVE')
        ob.rigid_body.collision_shape = 'BOX'
        ob.rigid_body.use_margin = True
        ob.rigid_body.collision_margin = 0.0
        ob.rigid_body.collision_collections = [True] * 20
    ob.location = (0.0, 0.0, z - 0.5 * t)
    ob.rigid_body.friction = s.floor_friction
    ob.rigid_body.restitution = s.bounce
    return ob


def setup_explosion(context, shards, s, collection, log=None):
    """Turn `shards` into rigid bodies and key their launch. Returns a summary dict."""
    sc = context.scene
    rng = np.random.default_rng(int(s.seed) + 1013)
    lo, hi = shards_bounds(shards)
    size = float(np.max(hi - lo))
    origin = np.array(blast_origin(context, s, shards))
    fps = sc.render.fps / max(sc.render.fps_base, 1e-6)
    unit = size / s.real_height if s.real_height > 0 else 1.0
    rbw = ensure_world(context)
    rbw.solver_iterations = int(s.solver_iters)
    # Without split impulse Bullet turns the correction of an overlap into real velocity, at (overlap / step length):
    # a shard squeezed between the floor and a heavy piece, or left inside a neighbour's hull, is fired across the room
    rbw.use_split_impulse = True
    rbw.time_scale = 1.0
    sc.use_gravity = True
    sc.gravity = (0.0, 0.0, -9.81 * unit)
    dt = rbw.time_scale / fps
    start = max(3, int(s.start_frame))
    n = len(shards)

    # clean anything from a previous run
    for ob in shards:
        if ob.rigid_body is not None:
            with _override(context, ob, [ob]):
                bpy.ops.rigidbody.objects_remove()
        if ob.animation_data:
            ob.animation_data_clear()
        rest = ob.get("ss_rest")
        if rest:
            ob.location = rest
        ob.rotation_mode = 'QUATERNION'
        ob.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)

    floor_top = None
    if s.add_floor:
        floor_top = float(lo[2]) if s.floor_mode == 'AUTO' else float(s.floor_z)
        make_floor(context, s, floor_top, size, collection)

    # ---- what each piece is asked to do -----------------------------------------------------------------
    geo = piece_geometry(shards)
    com = np.array([g[1] for g in geo])
    vols = np.array([max(float(ob.get("ss_volume", 0.0)), 1e-12) for ob in shards])
    real = (s.real_height / size) if s.real_height > 0 else 1.0
    true_mass = np.maximum(vols * (real ** 3) * DENSITY[s.material], 1e-4)
    mref = float(np.exp(np.log(true_mass).mean()))
    # What the bodies weigh is kept within MASS_SPREAD^2 : 1 of each other. A shard a seven-hundredth of the weight of
    # the piece that lands on it, pinned against the floor, is more than Bullet's solver can hold and it is ejected.
    mass = np.clip(true_mass, mref / MASS_SPREAD, mref * MASS_SPREAD)
    R = max(s.blast_radius * size, 1e-9)
    vel = np.zeros((n, 3))
    ang = np.zeros((n, 3))
    release = np.zeros(n, np.int64)
    for i in range(n):
        d = com[i] - origin
        dist = float(np.linalg.norm(d))
        dirn = d / dist if dist > 1e-9 else _unit(rng)
        v = dirn + _unit(rng) * s.blast_spread
        v[2] += s.blast_up
        v = v / max(np.linalg.norm(v), 1e-9)
        x = dist / R
        f = 1.0 if s.blast_falloff == 'NONE' else (max(1.0 - 0.85 * x, 0.15) if s.blast_falloff == 'LINEAR' else 1.0 / (1.0 + 2.0 * x * x))
        mf = float(np.clip((mref / true_mass[i]) ** (s.mass_influence * 0.33), 0.5, 2.0))
        vel[i] = v * (s.blast_speed * size * f * mf * (1.0 + s.speed_variation * (rng.random() * 2 - 1)))
        ang[i] = _unit(rng) * (s.spin * 2.0 * math.pi * (0.4 + 0.6 * rng.random()) * (0.5 + 0.5 * f))
        delay = dist / (s.wave_speed * size) * fps if s.wave_speed > 0 else 0.0
        delay += rng.random() * s.delay_jitter
        release[i] = start + int(round(delay))
    last = int(release.max())

    contacts, adj = piece_contacts(geo, size, floor_top)
    release = free_release_order(contacts, vel, release)
    last = int(release.max())
    typical = float(np.linalg.norm(vel, axis=1).mean())
    vel, ang = solve_launch(geo, mass, vel, ang, release, contacts, s.separation * typical)
    if floor_top is not None:
        vel = lift_from_floor(geo, vel, ang, floor_top + size * 1e-3, dt)
    radius = np.sqrt(np.array([g[2] for g in geo]))
    vmax = float((np.linalg.norm(vel, axis=1) + np.linalg.norm(ang, axis=1) * radius).max())

    # ---- physics world: enough steps that the fastest piece cannot bury itself in one, but not many more ----
    # Bullet pushes overlapping bodies apart at a speed of (overlap / step length), so an overlap that is already there
    # (pieces that passed through each other during the break-up delay, a shard pinned under a heavy piece) is thrown
    # out harder the SMALLER the step: 25 substeps gave a clean blast where 112 flung a piece at 4x the launch speed,
    # and 400 at 9x. Split impulse (above) removes most of it; this keeps the rest small. A step of an eighth of a
    # piece's thickness is fine for the pieces themselves.
    if s.substeps > 0:
        sub = int(s.substeps)
    else:
        thin = float(np.median([min(ob.dimensions) for ob in shards]))         # not the thinnest: a few tiny shards would set the step for all
        fall = math.sqrt(2.0 * 9.81 * unit * size)                  # how fast a piece is going by the time it lands
        sub = int(np.clip(math.ceil(max(vmax, fall) * dt / max(0.12 * thin, 1e-9)), 3, 40))
    rbw.substeps_per_frame = sub

    with _override(context, shards[0], list(shards)):
        bpy.ops.rigidbody.objects_add(type='ACTIVE')
    layers = assign_layers(adj) if s.collision_delay > 0 else None
    for i, ob in enumerate(shards):
        rb = ob.rigid_body
        rb.type = 'ACTIVE'
        rb.mass = float(mass[i])
        rb.friction = s.friction
        rb.restitution = s.bounce
        rb.collision_shape = s.collision_shape
        rb.mesh_source = 'BASE'                       # collide as the flat piece, not the roughness shape key
        if s.collision_shape in ('CONVEX_HULL', 'MESH'):
            rb.use_margin = True
            rb.collision_margin = max(s.collision_margin * size, 0.0)
        rb.linear_damping = s.linear_damping
        rb.angular_damping = s.angular_damping
        rb.use_deactivation = False
        if layers is not None:
            rb.collision_collections = [k == layers[i] for k in range(20)]
        ob["ss_launch"] = [float(x) for x in vel[i]]
        ob["ss_spin"] = [float(x) for x in ang[i]]
        R_f = int(release[i])
        rest = ob.location.copy()
        ob.rotation_mode = 'QUATERNION'
        ob.location = rest
        ob.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        ob.keyframe_insert('location', frame=1)
        ob.keyframe_insert('rotation_quaternion', frame=1)
        if R_f - 2 > 1:
            ob.keyframe_insert('location', frame=R_f - 2)
            ob.keyframe_insert('rotation_quaternion', frame=R_f - 2)
        ob.location = rest + Vector(vel[i] * dt)
        a = float(np.linalg.norm(ang[i]) * dt)
        ob.rotation_quaternion = Quaternion(Vector(ang[i] / max(np.linalg.norm(ang[i]), 1e-12)), a) if a > 1e-9 else Quaternion((1, 0, 0, 0))
        ob.keyframe_insert('location', frame=R_f - 1)
        ob.keyframe_insert('rotation_quaternion', frame=R_f - 1)
        rb.kinematic = True
        ob.keyframe_insert('rigid_body.kinematic', frame=1)
        ob.keyframe_insert('rigid_body.kinematic', frame=R_f - 1)
        rb.kinematic = False
        ob.keyframe_insert('rigid_body.kinematic', frame=R_f)
        set_constant(ob, 'rigid_body.kinematic')
        if layers is not None:
            # touching pieces ignore each other until `collision_delay` frames after their release
            rb.collision_collections[COMMON_LAYER] = False
            ob.keyframe_insert('rigid_body.collision_collections', index=COMMON_LAYER, frame=1)
            rb.collision_collections[COMMON_LAYER] = True
            ob.keyframe_insert('rigid_body.collision_collections', index=COMMON_LAYER, frame=R_f + int(s.collision_delay))
            rb.collision_collections[COMMON_LAYER] = False
            set_constant(ob, 'rigid_body.collision_collections')
            ob["ss_join"] = R_f + int(s.collision_delay)          # the frame this piece joins the shared layer (prevent_pops reads it)
        elif "ss_join" in ob:
            del ob["ss_join"]
        ob.location = rest
        ob.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
    sc.frame_start = 1
    sc.frame_end = int(last + s.duration * fps)
    pc = rbw.point_cache
    pc.frame_start = 1
    pc.frame_end = sc.frame_end
    sc.frame_set(1)
    kept = prevent_pops(context, shards, s)
    speeds = np.linalg.norm(vel, axis=1)
    return dict(origin=tuple(origin), size=size, fps=fps, last_release=last, frame_end=sc.frame_end,
                speed_min=float(speeds.min()), speed_max=float(speeds.max()), mass_total=float(mass.sum()),
                substeps=sub, contacts=len(contacts), kept_off=kept)


def _unit(rng):
    v = rng.normal(size=3)
    return v / max(np.linalg.norm(v), 1e-12)


def clear_physics(context, shards, remove_floor=True):
    for ob in shards:
        if ob.rigid_body is not None:
            with _override(context, ob, [ob]):
                bpy.ops.rigidbody.objects_remove()
        if ob.animation_data:
            ob.animation_data_clear()
        rest = ob.get("ss_rest")
        if rest:
            ob.location = rest
        ob.rotation_mode = 'QUATERNION'
        ob.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
    fl = bpy.data.objects.get(FLOOR_NAME)
    if remove_floor and fl is not None:
        bpy.data.objects.remove(fl, do_unlink=True)
    rbw = context.scene.rigidbody_world
    if rbw is not None and (rbw.collection is None or len(rbw.collection.objects) == 0):
        bpy.ops.rigidbody.world_remove()
    context.scene.frame_set(1)


def _hull(ob):
    """(plane normals, plane offsets, hull vertices, bounding radius) of a piece's convex collision hull, or None.

    Local to the piece: this is the flat base mesh, which is what the rigid body collides as."""
    import bmesh
    co = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    bm = bmesh.new()
    for p in co:
        bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=list(bm.verts))
    faces = list(bm.faces)
    if not faces:
        bm.free()
        return None
    N = np.array([list(f.normal) for f in faces])
    D = np.array([float(np.dot(f.normal, f.calc_center_median())) for f in faces])
    hv = np.array([list(v.co) for v in bm.verts if v.link_faces])
    bm.free()
    return N, D, hv, float(np.linalg.norm(co, axis=1).max())


def _depth(hi, Ti, Ri, hj, Tj, Rj):
    """How far the vertices of hull i reach into hull j (0 when they do not)."""
    A = hi[2] @ Ri.T + Ti
    sd = ((A - Tj) @ Rj) @ hj[0].T - hj[1]
    return max(0.0, float((-sd.max(axis=1)).max()))


def find_pops(shards, hulls, T, R, join, f0, tol):
    """Pieces that would be pushed out of a neighbour the instant their collision layer switches on.

    Touching pieces sit on different layers for a few frames after release so they can separate without fighting.
    Then every piece joins the shared layer, and a pair whose hulls still overlap at that moment is pushed apart by
    Bullet at (overlap / step length), which throws the lighter piece across the room. That happens to small shards
    that sit inside the convex hull of a heavier neighbour (the hull fills in its concavity), and it does not go
    away with time: they stay inside it. `T` and `R` are every piece's position and rotation on every frame, `join`
    the frame each piece joins the shared layer (-1 = never). Returns the pieces to keep off the shared layer."""
    n = len(shards)
    order = sorted((i for i in range(n) if join[i] >= 0 and hulls[i] is not None), key=lambda i: join[i])
    off = set()
    for i in order:
        f = join[i] - 1 - f0                    # the pose when the step that turns the collisions on begins
        if f < 0 or f >= len(T):
            continue
        for j in order:
            if j == i or j in off or join[j] > join[i] or (join[j] == join[i] and j > i):
                continue
            if float(np.linalg.norm(T[f][i] - T[f][j])) > hulls[i][3] + hulls[j][3]:
                continue
            d = max(_depth(hulls[i], T[f][i], R[f][i], hulls[j], T[f][j], R[f][j]),
                    _depth(hulls[j], T[f][j], R[f][j], hulls[i], T[f][i], R[f][i]))
            if d > tol:
                if join[j] == join[i] and shards[j].rigid_body.mass < shards[i].rigid_body.mass:
                    off.add(j)                  # both arrive together: the lighter one is the one that gets thrown
                else:
                    off.add(i)
                    break
    return sorted(off)


def _keep_off_shared_layer(ob):
    """Make a piece collide only on its own layer (and with the floor): it never joins the shared one."""
    for _, f in fcurves_of(ob):
        if f.data_path == 'rigid_body.collision_collections':
            for k in f.keyframe_points:
                k.co[1] = 0.0
            f.update()
    ob.rigid_body.collision_collections[COMMON_LAYER] = False
    ob["ss_join"] = -1


def prevent_pops(context, shards, s):
    """Keep off the shared collision layer every piece that would be thrown out of a neighbour when it joins it.

    Steps the timeline to the last join, asks find_pops which pieces overlap a neighbour at the moment they join,
    keeps those off the layer and looks again (the poses change once a piece stops colliding). Only the frames up to
    the last join matter, so a pass is a dozen frames. Returns how many pieces were kept off."""
    sc = context.scene
    rbw = sc.rigidbody_world
    fps = sc.render.fps / max(sc.render.fps_base, 1e-6)
    f0 = sc.frame_start
    join = [int(ob.get("ss_join", -1)) for ob in shards]
    if not s.guard_pops or not any(j >= 0 for j in join):
        return 0
    lo, hi = shards_bounds(shards)
    size = float(np.max(hi - lo))
    n = len(shards)
    hulls = [_hull(ob) for ob in shards]
    typical = float(np.mean([np.linalg.norm(ob["ss_launch"]) for ob in shards]))
    # a pair overlapping by `tol` is pushed apart at about 0.2 * tol * fps * substeps: allow a quarter of a typical launch
    tol = max(1.25 * typical / (fps * max(rbw.substeps_per_frame, 1)), 0.002 * size)
    kept = 0
    for _ in range(4):
        last = min(sc.frame_end, max(join))
        T = np.empty((last - f0 + 1, n, 3))
        R = np.empty((last - f0 + 1, n, 3, 3))
        sc.frame_set(f0)
        for f in range(f0, last + 1):
            sc.frame_set(f)
            for k, ob in enumerate(shards):
                mw = ob.matrix_world
                T[f - f0, k] = mw.translation
                R[f - f0, k] = np.array(mw.to_3x3())
        off = find_pops(shards, hulls, T, R, join, f0, tol)
        if not off:
            break
        for i in off:
            _keep_off_shared_layer(shards[i])
            join[i] = -1
        kept += len(off)
        if not any(j >= 0 for j in join):
            break
    sc.frame_set(f0)
    return kept


def bake(context, shards, s):
    """Bake the simulation to plain keyframes, then drop the rigid bodies so the animation stands alone.

    This steps the timeline itself instead of calling bpy.ops.rigidbody.bake_to_keyframes, which needs a UI area
    and so fails in background mode. Bullet only advances one frame per evaluation, so EVERY frame is stepped even
    when only every Bake Step-th one is keyed. With Run Until Settled the timeline is extended (by up to twice the
    Duration) while any piece is still moving, so the clip does not end with debris frozen mid-air.

    Returns dict(first, last, extended, settled)."""
    sc = context.scene
    rbw = sc.rigidbody_world
    fps = sc.render.fps / max(sc.render.fps_base, 1e-6)
    f0 = sc.frame_start
    step = max(1, int(s.bake_step))
    lo, hi = shards_bounds(shards)
    size = float(np.max(hi - lo))
    data = {ob.name: [] for ob in shards}
    hist = []                                    # every piece's pose for the last three frames

    def pose(f, keep):
        cur = []
        for ob in shards:
            mw = ob.matrix_world
            q = mw.to_quaternion()
            p = mw.translation.copy()
            if keep:
                d = data[ob.name]
                if d and q.dot(d[-1][2]) < 0.0:
                    q.negate()
                d.append((f, p, q))
            cur.append((p, q))
        hist.append(cur)
        del hist[:-3]

    def settled():
        if len(hist) < 3:
            return False
        span = (len(hist) - 1) / fps
        for (p0, q0), (p1, q1) in zip(hist[0], hist[-1]):
            if (p1 - p0).length / span > 0.04 * size:                          # under half a unit per second on a 13-unit model
                return False
            if 2.0 * math.acos(min(1.0, abs(q0.dot(q1)))) / span > 0.8:
                return False
        return True

    sc.frame_set(f0)
    pose(f0, True)
    extra = 0
    limit = int(max(2.0, 2.0 * s.duration) * fps) if s.settle else 0
    chunk = max(6, int(fps // 2))
    f = f0
    while True:
        f += 1
        if f > sc.frame_end:
            if extra >= limit or settled():
                break
            grow = min(chunk, limit - extra)
            sc.frame_end += grow
            rbw.point_cache.frame_end = sc.frame_end
            extra += grow
        sc.frame_set(f)
        pose(f, (f - f0) % step == 0 or f == sc.frame_end)
    done = settled()
    for ob in shards:
        if ob.rigid_body is not None:
            with _override(context, ob, [ob]):
                bpy.ops.rigidbody.objects_remove()
        ob.animation_data_clear()
        ob.rotation_mode = 'QUATERNION'
        for f, loc, q in data[ob.name]:
            ob.location = loc
            ob.rotation_quaternion = q
            ob.keyframe_insert('location', frame=f)
            ob.keyframe_insert('rotation_quaternion', frame=f)
    fl = bpy.data.objects.get(FLOOR_NAME)
    if fl is not None and fl.rigid_body is not None:
        with _override(context, fl, [fl]):
            bpy.ops.rigidbody.objects_remove()
    sc.frame_set(f0)
    return dict(first=f0, last=sc.frame_end, extended=extra, settled=done)


def animation_state(shards):
    """'SIM' while the rigid bodies are live (the motion is not keyed yet), 'BAKED' once it is plain keyframes,
    'NONE' when the pieces have no animation at all."""
    if any(ob.rigid_body is not None for ob in shards):
        return 'SIM'
    if any(fcurves_of(ob) for ob in shards):
        return 'BAKED'
    return 'NONE'


def glb_report(path):
    """What a written GLB contains: dict(nodes, clips, channels, seconds, keys)."""
    from .importer import read_glb
    j, _ = read_glb(path)
    acc = j.get('accessors', [])
    seconds = keys = channels = 0
    for a in j.get('animations', []):
        channels += len(a['channels'])
        for smp in a['samplers']:
            t = acc[smp['input']]
            seconds = max(seconds, float(t['max'][0]))
            keys = max(keys, int(t['count']))
    return dict(nodes=len(j.get('nodes', [])), clips=len(j.get('animations', [])), channels=channels, seconds=seconds, keys=keys)


@contextlib.contextmanager
def roughness_baked(shards):
    """Temporarily make the roughness shape key the real mesh.

    The glTF exporter writes the base mesh of an object with shape keys (even when the evaluated mesh differs), so
    without this the exported shards would be the flat ones. The keys are put back afterwards so the shards stay
    re-simulatable with their tight collision hulls."""
    saved = []
    for ob in shards:
        me = ob.data
        sk = me.shape_keys
        if sk is not None and ROUGH_KEY in sk.key_blocks:
            n = len(me.vertices)
            flat = np.empty(n * 3, np.float32)
            me.vertices.foreach_get('co', flat)
            rough = np.empty(n * 3, np.float32)
            sk.key_blocks[ROUGH_KEY].data.foreach_get('co', rough)
            saved.append((ob, flat, rough))
            ob.shape_key_clear()
            me.vertices.foreach_set('co', rough)
            me.update()
    try:
        yield
    finally:
        for ob, flat, rough in saved:
            me = ob.data
            me.vertices.foreach_set('co', flat)
            me.update()
            ob.shape_key_add(name="Basis", from_mix=False)
            key = ob.shape_key_add(name=ROUGH_KEY, from_mix=False)
            key.data.foreach_set('co', rough)
            key.value = 1.0


def export_glb(context, shards, path):
    """Export the shards and their animation as one GLB for the game."""
    import addon_utils
    try:
        addon_utils.enable("io_scene_gltf2", default_set=False)
    except Exception:
        pass
    props = bpy.ops.export_scene.gltf.get_rna_type().properties
    # roughness_baked() below turns the roughness shape key into the real mesh, and morph export is switched off, so
    # the shards go out as plain static meshes with the rough fracture faces, not as morph targets
    want = dict(filepath=path, export_format='GLB', use_selection=True, export_animations=True, export_yup=True,
                export_apply=True, export_morph=False, export_frame_range=True, export_force_sampling=True,
                export_optimize_animation_size=True, export_current_frame=False)
    if 'export_animation_mode' in props:
        modes = [i.identifier for i in props['export_animation_mode'].enum_items]
        want['export_animation_mode'] = 'ACTIVE_ACTIONS' if 'ACTIVE_ACTIONS' in modes else 'ACTIONS'
    kw = {k: v for k, v in want.items() if k in props}
    for ob in context.view_layer.objects:
        ob.select_set(False)
    for ob in shards:
        ob.select_set(True)
    context.view_layer.objects.active = shards[0]
    with roughness_baked(shards):
        bpy.ops.export_scene.gltf(**kw)
    return kw
