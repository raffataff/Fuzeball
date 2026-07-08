# build_arena_table.py — generate the same curved arena as arena.js
# Blender 4.x bpy, run headless: blender -b -P tools/build_arena_table.py
# Outputs: assets/fuzeball_table_arena.glb + .blend

import bpy
import bmesh
import math
import os
import sys
import re
import json

# ---- parameters (mirror CONFIG.table + CONFIG.tables.arena) ----
L = 120.0
W = 68.0
wallH = 10.0
goalHalf = 11.0
goalH = 9.5
goalDepth = 9.0
cornerR = 12.0
creaseR = 5.0
postR = 3.0
mouthIn = 4.0
seg_loop = 200
seg_profile = 10

# optional --from-config path/to/config.js
args = sys.argv
for i, a in enumerate(args):
    if a == '--from-config' and i + 1 < len(args):
        with open(args[i + 1], 'r') as f:
            txt = f.read()
        def js_num(key, default):
            m = re.search(r'\b' + re.escape(key) + r'\s*:\s*([\d.]+)', txt)
            return float(m.group(1)) if m else default
        L = js_num('L', L)
        W = js_num('W', W)
        wallH = js_num('wallH', wallH)
        goalHalf = js_num('goalHalf', goalHalf)
        goalH = js_num('goalH', goalH)
        goalDepth = js_num('goalDepth', goalDepth)
        cornerR = js_num('cornerR', cornerR)
        creaseR = js_num('creaseR', creaseR)
        postR = js_num('postR', postR)
        mouthIn = js_num('mouthIn', mouthIn)
        sl = re.search(r'seg\s*:\s*\{\s*loop\s*:\s*(\d+)\s*,\s*profile\s*:\s*(\d+)', txt)
        if sl:
            seg_loop = int(sl.group(1))
            seg_profile = int(sl.group(2))
        print('--from-config: L=%.1f W=%.1f wallH=%.1f goalHalf=%.1f goalH=%.1f goalDepth=%.1f cornerR=%.1f creaseR=%.1f postR=%.1f mouthIn=%.1f' % (
            L, W, wallH, goalHalf, goalH, goalDepth, cornerR, creaseR, postR, mouthIn))

# ---- SDF functions ----
def sd_rrect(x, z, hx, hz, r):
    qx = abs(x) - hx + r
    qz = abs(z) - hz + r
    return math.hypot(max(qx, 0), max(qz, 0)) + min(max(qx, qz), 0) - r

def sd_box2(x, z, cx, cz, hx, hz):
    qx = abs(x - cx) - hx
    qz = abs(z - cz) - hz
    return math.hypot(max(qx, 0), max(qz, 0)) + min(max(qx, qz), 0)

def smin(a, b, k):
    h = max(0.0, min(1.0, 0.5 + 0.5 * (b - a) / k))
    return b * (1 - h) + a * h - k * h * (1 - h)

def arena_sd(x, z, gh0, gh1):
    r = sd_rrect(x, z, L / 2, W / 2, cornerR)
    ghL = L / 2 - mouthIn
    s0 = sd_box2(x, z, ghL + mouthIn, 0, mouthIn + goalDepth, gh0)
    s1 = sd_box2(x, z, -ghL - mouthIn, 0, mouthIn + goalDepth, gh1)
    return smin(smin(r, s0, postR), s1, postR)

grad_eps = 0.02

def arena_grad(x, z, gh0, gh1):
    dx = arena_sd(x + grad_eps, z, gh0, gh1) - arena_sd(x - grad_eps, z, gh0, gh1)
    dz = arena_sd(x, z + grad_eps, gh0, gh1) - arena_sd(x, z - grad_eps, gh0, gh1)
    l = math.hypot(dx, dz) / (2 * grad_eps)
    if l < 1e-9:
        return (1.0, 0.0)
    return (dx / (2 * grad_eps * l), dz / (2 * grad_eps * l))

def proj(x, z, target_sd, iters=5):
    gh0 = gh1 = goalHalf
    for _ in range(iters):
        sd = arena_sd(x, z, gh0, gh1)
        gx, gz = arena_grad(x, z, gh0, gh1)
        err = sd - target_sd
        x -= gx * err
        z -= gz * err
    return (x, z)

# ---- clear scene ----
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# ---- materials ----
def make_mat(name, color, metallic=0.0, roughness=0.5, emissive=(0, 0, 0, 1), emissive_str=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Emission'].default_value = emissive
    bsdf.inputs['Emission Strength'].default_value = emissive_str
    return mat

wall_mat = make_mat('wall', (0.48, 0.29, 0.13, 1.0), metallic=0.1, roughness=0.6)
crease_mat = make_mat('crease', (0.18, 0.40, 0.24, 1.0), metallic=0.05, roughness=0.7)
led_mat_bl = make_mat('led', (0.22, 0.88, 1.0, 1.0), metallic=0.4, roughness=0.4,
                       emissive=(0.22, 0.88, 1.0, 1.0), emissive_str=1.1)
goal_net_mat = make_mat('goal_net', (0.8, 0.8, 0.8, 1.0), metallic=0.0, roughness=0.9)
field_mat_bl = make_mat('field', (0.12, 0.49, 0.24, 1.0), metallic=0.0, roughness=0.85)
frame_mat = make_mat('frame', (1.0, 1.0, 1.0, 1.0), metallic=0.5, roughness=0.3,
                      emissive=(1.0, 1.0, 1.0, 1.0), emissive_str=0.3)
wood_mat = make_mat('wood', (0.35, 0.22, 0.12, 1.0), metallic=0.05, roughness=0.75)

# ---- swept bowl mesh ----
perim = seg_loop
profile = seg_profile
CR = creaseR
WH = wallH
filletP = int(profile * 0.55)

pfl = []
for j in range(profile + 1):
    if j <= filletP:
        th = (j / filletP) * math.pi / 2
        pfl.append((CR - CR * math.sin(th), CR - CR * math.cos(th)))
    else:
        t = (j - filletP) / (profile - filletP)
        pfl.append((0.0, CR + (WH - CR) * t))

halfL = L / 2
halfW = W / 2
mi = mouthIn

ploop = []
ploop.append((-halfL, -goalHalf))
ploop.append((-halfL + mi, -goalHalf))
ploop.append((-halfL + mi + goalDepth, -goalHalf))
ploop.append((-halfL + mi + goalDepth, goalHalf))
ploop.append((-halfL + mi, goalHalf))
ploop.append((-halfL, goalHalf))
ploop.append((-halfL, halfW))
ploop.append((halfL, halfW))
ploop.append((halfL, goalHalf))
ploop.append((halfL - mi, goalHalf))
ploop.append((halfL - mi - goalDepth, goalHalf))
ploop.append((halfL - mi - goalDepth, -goalHalf))
ploop.append((halfL - mi, -goalHalf))
ploop.append((halfL, -goalHalf))
ploop.append((halfL, -halfW))

# total length
tl = 0.0
for i in range(len(ploop)):
    if i == 0:
        continue
    pp = ploop[i - 1]
    p = ploop[i]
    tl += math.hypot(p[0] - pp[0], p[1] - pp[1])

# sample perimeter evenly
samples = []
dists = [0.0]
for i in range(1, len(ploop)):
    dists.append(dists[-1] + math.hypot(ploop[i][0] - ploop[i - 1][0],
                                         ploop[i][1] - ploop[i - 1][1]))
for i in range(perim):
    want = i / perim * tl
    ci = 0
    for k in range(1, len(dists)):
        if dists[k] >= want:
            ci = k - 1
            break
    if ci >= len(dists) - 2:
        ci = len(dists) - 2
    d0 = dists[ci]
    d1 = dists[ci + 1] if ci + 1 < len(dists) else d0 + 1
    t = max(0.0, min(1.0, (want - d0) / (d1 - d0 + 1e-12)))
    px = ploop[ci][0] + (ploop[ci + 1][0] - ploop[ci][0]) * t
    pz = ploop[ci][1] + (ploop[ci + 1][1] - ploop[ci][1]) * t
    sx, sz = proj(px, pz, 0.0)
    sx, sz = proj(sx, sz, 0.0)
    samples.append((sx, sz))

# build mesh with bmesh
bm = bmesh.new()
verts_by_row = []

for j in range(profile + 1):
    inset, y = pfl[j]
    row = []
    for i in range(perim):
        spx, spz = samples[i]
        vx = spx
        vz = spz
        # project to contour sd = -inset
        for _ in range(5):
            sd = arena_sd(vx, vz, goalHalf, goalHalf)
            gx, gz = arena_grad(vx, vz, goalHalf, goalHalf)
            err = sd + inset
            vx -= gx * err
            vz -= gz * err
        row.append(bm.verts.new((vx, y, vz)))
    verts_by_row.append(row)

bm.verts.ensure_lookup_table()
for j in range(profile):
    for i in range(perim):
        ni = (i + 1) % perim
        a = verts_by_row[j][i]
        b = verts_by_row[j][ni]
        c = verts_by_row[j + 1][ni]
        d = verts_by_row[j + 1][i]
        bm.faces.new((a, b, c, d))

# assign materials: fillet rows = crease, wall rows = wall
for face in bm.faces:
    cy = sum(v.co.y for v in face.verts) / len(face.verts)
    if cy < CR * 0.95:
        face.material_index = 1  # crease
    else:
        face.material_index = 0  # wall

bm.normal_update()

wall_mesh = bpy.data.meshes.new('arena_wall')
bm.to_mesh(wall_mesh)
bm.free()

wall_obj = bpy.data.objects.new('arena_wall', wall_mesh)
wall_obj.data.materials.append(wall_mat)
wall_obj.data.materials.append(crease_mat)
bpy.context.collection.objects.link(wall_obj)

# ---- LED top-lip ring ----
lip_verts = []
for i in range(perim + 1):
    si = i % perim
    spx, spz = samples[si]
    px, pz = proj(spx, spz, 0.0, 5)
    lip_verts.append((px, WH + 0.15, pz))

curve_data = bpy.data.curves.new('led_curve', 'CURVE')
curve_data.dimensions = '3D'
spline = curve_data.splines.new('POLY')
spline.points.add(len(lip_verts) - 1)
for i, (x, y, z) in enumerate(lip_verts):
    spline.points[i].co = (x, y, z, 1)

led_obj = bpy.data.objects.new('led', curve_data)
bpy.context.collection.objects.link(led_obj)
led_obj.data.materials.append(led_mat_bl)

# Bevel the LED curve
bevel_data = bpy.data.curves.new('led_bevel', 'CURVE')
bevel_spline = bevel_data.splines.new('POLY')
bevel_spline.points.add(3)
pts = [(0, 0.35, 0), (0.35, 0, 0), (0, -0.35, 0), (-0.35, 0, 0)]
for i, (x, y, z) in enumerate(pts):
    bevel_spline.points[i].co = (x, y, z, 1)
bevel_spline.use_cyclic_u = True
bevel_obj = bpy.data.objects.new('led_bevel_obj', bevel_data)
curve_data.bevel_object = bevel_obj
# hide the bevel object
bpy.context.collection.objects.link(bevel_obj)
bevel_obj.hide_viewport = True
bevel_obj.hide_render = True
led_obj.data.bevel_object = bevel_obj

# ---- field plane ----
field_bm = bmesh.new()
nearL = L / 2 - mouthIn

def add_field_quad(x0, z0, x1, z1):
    v0 = field_bm.verts.new((x0, 0.001, z0))
    v1 = field_bm.verts.new((x1, 0.001, z0))
    v2 = field_bm.verts.new((x1, 0.001, z1))
    v3 = field_bm.verts.new((x0, 0.001, z1))
    field_bm.faces.new((v0, v1, v2, v3))

# left strip
add_field_quad(-halfL, -halfW, -halfL, -goalHalf)
# middle-left
add_field_quad(-halfL, -goalHalf, -nearL, goalHalf)
# left cavity notch (open)
# middle
add_field_quad(-nearL, -halfW, nearL, halfW)
# right cavity notch (open)
# middle-right
add_field_quad(nearL, -halfW, halfL, goalHalf)
# right strip
add_field_quad(halfL, -halfW, halfL, halfW)

field_mesh = bpy.data.meshes.new('field')
field_bm.to_mesh(field_mesh)
field_bm.free()
field_obj = bpy.data.objects.new('field', field_mesh)
field_obj.data.materials.append(field_mat_bl)
bpy.context.collection.objects.link(field_obj)

# ---- goal nets ----
net_half = goalHalf
net_depth = goalDepth
net_h = goalH

for side, sx in [('left', -halfL), ('right', halfL)]:
    x0 = sx
    if side == 'left':
        x0 = -halfL + mi + net_depth / 2
    else:
        x0 = halfL - mi - net_depth / 2
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x0, net_h / 2, 0))
    net_obj = bpy.context.active_object
    net_obj.name = 'goal_net_' + side
    net_obj.scale = (net_depth / 2, net_h / 2, net_half)
    net_obj.data.materials.append(goal_net_mat)

# ---- goal frames ----
for side, sx in [('l', -halfL), ('r', halfL)]:
    bpy.ops.object.empty_add(type='SPHERE', location=(sx, 0, 0))
    grp = bpy.context.active_object
    grp.name = 'goal_frame_' + side

    # posts
    for sz in [goalHalf, -goalHalf]:
        bpy.ops.mesh.primitive_cylinder_add(radius=0.6, depth=goalH + 1,
                                            location=(sx + 0.6 * (1 if side == 'l' else -1),
                                                      (goalH + 1) / 2, sz))
        post = bpy.context.active_object
        post.name = 'goal_frame_' + side
        post.data.materials.append(frame_mat)
        post.parent = grp

    # crossbar
    bpy.ops.mesh.primitive_cylinder_add(radius=0.6, depth=goalHalf * 2 + 1.2,
                                        location=(sx, goalH + 0.5, 0))
    bar = bpy.context.active_object
    bar.rotation.y = math.pi / 2
    bar.name = 'goal_frame_' + side
    bar.data.materials.append(frame_mat)
    bar.parent = grp

# ---- body box ----
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -5.2, 0))
body = bpy.context.active_object
body.name = 'body'
body.scale = ((L + 10) / 2, 5, (W + 10) / 2)
body.data.materials.append(wood_mat)

# ---- legs ----
leg_size = (2, 17, 2)
for sx in [-1, 1]:
    for sz in [-1, 1]:
        bpy.ops.mesh.primitive_cube_add(size=1,
                                         location=(sx * (L / 2 - 2), -27, sz * (W / 2 - 2)))
        leg = bpy.context.active_object
        leg.name = 'leg'
        leg.scale = leg_size
        leg.data.materials.append(wood_mat)

# ---- apply transforms + export ----
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# save .blend next to the .glb
script_dir = os.path.dirname(os.path.abspath(__file__))
blend_path = os.path.join(script_dir, '..', 'assets', 'fuzeball_table_arena.blend')
glb_path = os.path.join(script_dir, '..', 'assets', 'fuzeball_table_arena.glb')

bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(blend_path))
bpy.ops.export_scene.gltf(filepath=os.path.abspath(glb_path), export_format='GLB',
                          export_yup=True, export_apply=True)

print('Exported:', os.path.abspath(glb_path))
print('Blend saved:', os.path.abspath(blend_path))
