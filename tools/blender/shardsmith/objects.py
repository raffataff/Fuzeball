"""Turn engine pieces into Blender objects."""
import bpy
import numpy as np

INTERIOR_MAT = "Shardsmith Interior"
ROUGH_KEY = "Rough"


def interior_material(color=(0.46, 0.38, 0.30, 1.0), roughness=0.85):
    mat = bpy.data.materials.get(INTERIOR_MAT)
    if mat is None:
        mat = bpy.data.materials.new(INTERIOR_MAT)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf is not None:
            bsdf.inputs["Base Color"].default_value = color
            bsdf.inputs["Roughness"].default_value = roughness
        mat.diffuse_color = color
    return mat


def unique_collection(context, base):
    name = base
    i = 1
    while name in bpy.data.collections:
        i += 1
        name = "%s.%03d" % (base, i)
    col = bpy.data.collections.new(name)
    context.scene.collection.children.link(col)
    return col


def _set_uv(layer, arr):
    flat = np.ascontiguousarray(arr.reshape(-1), dtype=np.float32)
    try:
        layer.uv.foreach_set('vector', flat)
    except Exception:
        layer.data.foreach_set('uv', flat)


def _vertex_positions(ids, corners, nv):
    v = np.zeros((nv, 3))
    cnt = np.zeros(nv)
    np.add.at(v, ids.reshape(-1), corners.reshape(-1, 3))
    np.add.at(cnt, ids.reshape(-1), 1.0)
    return v / cnt[:, None]


def build_piece(src, pc, name, cap_mat, cap_slot, mats):
    """Mesh for one piece. With roughness the mesh itself is the UNDISPLACED piece and the visible roughness is a
    shape key: the rigid body reads the base mesh, so its collision hull is the tight flat piece and the noise
    can never make neighbours interpenetrate. Returns (mesh, rough vertex coordinates or None)."""
    nt = len(pc.ids)
    vr = _vertex_positions(pc.ids, pc.pos, pc.nv) - pc.com
    vf = _vertex_positions(pc.ids, pc.posf, pc.nv) - pc.com if pc.posf is not None else None
    me = bpy.data.meshes.new(name)
    me.from_pydata(vf if vf is not None else vr, [], pc.ids)
    for m in mats:
        me.materials.append(m)
    while len(me.materials) <= cap_slot:
        me.materials.append(None)
    if cap_slot >= len(mats):
        me.materials[cap_slot] = cap_mat
    me.polygons.foreach_set('material_index', pc.mat.astype(np.int32))
    me.polygons.foreach_set('use_smooth', np.ones(nt, bool))
    for i, (uname, _) in enumerate(src.uvs):
        layer = me.uv_layers.new(name=uname)
        _set_uv(layer, pc.uvs[i])
    for i, (cname, _) in enumerate(src.cols):
        attr = me.color_attributes.new(cname, 'FLOAT_COLOR', 'CORNER')
        attr.data.foreach_set('color', np.ascontiguousarray(pc.cols[i].reshape(-1), dtype=np.float32))
    me.update()
    me.normals_split_custom_set(pc.nrm.reshape(-1, 3).astype(np.float64).tolist())
    return me, (vr if vf is not None else None)


def build_objects(context, src_obj, src, res, params, collection=None, cap_material=None):
    """Create one object per piece, in `collection`. Returns the objects."""
    col = collection or unique_collection(context, "%s_Shards" % src_obj.name)
    mats = list(src.mats)
    slot = res.interior_slot
    cap_mat = cap_material or interior_material()
    objs = []
    for i, pc in enumerate(res.pieces):
        name = "%s_shard_%03d" % (src_obj.name, i)
        me, rough = build_piece(src, pc, name, cap_mat, slot, mats)
        ob = bpy.data.objects.new(name, me)
        ob.location = pc.com
        ob.rotation_mode = 'QUATERNION'
        ob["ss_volume"] = float(pc.volume)
        ob["ss_rest"] = [float(x) for x in pc.com]
        ob["ss_source"] = src_obj.name
        col.objects.link(ob)
        if rough is not None:
            ob.shape_key_add(name="Basis", from_mix=False)
            key = ob.shape_key_add(name=ROUGH_KEY, from_mix=False)
            key.data.foreach_set('co', np.ascontiguousarray(rough.reshape(-1), dtype=np.float32))
            key.value = 1.0
        objs.append(ob)
    col["ss_source"] = src_obj.name
    return objs, col
