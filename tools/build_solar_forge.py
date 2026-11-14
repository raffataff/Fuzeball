import bmesh, bpy, os, sys, tempfile, numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from goal_frame_textures import blur, load_tile, map_goal_frame, smoothstep, tile_gradient

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(ROOT,'assets','tables','circuit','solar_forge'); os.makedirs(OUT,exist_ok=True)
tempfile.tempdir=os.path.join(ROOT,'tools','build','solar-temp'); os.makedirs(tempfile.tempdir,exist_ok=True)
RAIL_INNER = (60.0, 34.0)
RAIL_LEFT, RAIL_RIGHT, RAIL_SIDE = -68.4787, 68.4582, 37.0
RAIL_ATLAS = (70.0, 38.0)
WALL_JOIN_HEIGHT = 12.5
INNER_HALF = 2*sum(RAIL_INNER)
INNER_WIDTH, INNER_STRIP_HEIGHT = 4096, 384
INNER_TEXELS_PER_UNIT = 19.5
INNER_PAD_U = (INNER_WIDTH-INNER_HALF*INNER_TEXELS_PER_UNIT)/2
INNER_MID_HEIGHT = 7.5

def save_image(name, rgb, colorspace):
 h,w=rgb.shape[:2]; rgba=np.ones((h,w,4),dtype=np.float32); rgba[:,:,:3]=np.clip(rgb,0,1)
 img=bpy.data.images.new(name,width=w,height=h,alpha=True); img.colorspace_settings.name=colorspace
 img.pixels.foreach_set(rgba.ravel()); img.filepath_raw=os.path.join(OUT,name+'.png'); img.file_format='PNG'; img.save(); return img

def rgb(values, color):
    return values[..., None] * np.asarray(color, dtype=np.float32)

def save_maps(name, base, rough, metal, height, emissive, normal_scale, spacing=(1, 1), repeat=False):
    if repeat:
        dy, dx = tile_gradient(height, spacing)
    else:
        dy, dx = np.gradient(height, *spacing)
    normal = np.stack((-dx * normal_scale, -dy * normal_scale, np.ones_like(dx)), axis=-1)
    normal = normal / np.linalg.norm(normal, axis=-1, keepdims=True) * .5 + .5
    return (
        save_image(name+'_basecolor', base, 'sRGB'),
        save_image(name+'_roughness', rgb(rough, (1, 1, 1)), 'Non-Color'),
        save_image(name+'_metallic', rgb(metal, (1, 1, 1)), 'Non-Color') if metal is not None else None,
        save_image(name+'_normal', normal, 'Non-Color'),
        save_image(name+'_emissive', emissive, 'sRGB'),
    )

def make_rock_maps(name, source):
    image = bpy.data.images.load(os.path.join(OUT, source), check_existing=False)
    w, h = image.size
    pixels = np.empty(w*h*4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    art = pixels.reshape(h, w, 4)[:, :, :3]
    red, green, blue = art.transpose(2, 0, 1)
    warmth = red - green*.8 - blue*.2
    core = smoothstep(.10, .58, warmth)
    shoulder = smoothstep(.04, .72, blur(core, 3))
    stone = red*.12 + green*.28 + blue*.60
    broad = blur(stone, 5)
    fine = blur(stone, 1)
    height = broad*.75 + (fine-broad)*1.40 + (stone-fine)*.36 - shoulder*.49 - core*.15
    base = art * (1 - .49*shoulder[..., None])
    base += rgb(shoulder-core*.25, (.092, .019, .004))
    rough = np.clip(.87 - fine*.33 - core*.48, .23, .88)
    metal = .04 + core*.09
    emissive = rgb(core**.72, (.90, 0, 0)) + rgb(core**2, (0, .54, .11))
    return save_maps(name, base, rough, metal, height, emissive, 9)


def make_goal_maps():
    art = load_tile(os.path.join(OUT, 'goal_source.png'))
    red, green, blue = art.transpose(2, 0, 1)
    hot = smoothstep(.06, .36, red - .6*green - .4*blue)
    # Widen the fissures enough to survive mip filtering on the thin frames.
    spread = [np.roll(hot, shift, axis) for axis in range(2) for shift in (-3, 3)]
    core = blur(np.maximum.reduce([hot, *spread]), 1, 'wrap')
    shoulder = smoothstep(.02, .57, blur(core, 3, 'wrap'))
    luma = .21*red + .72*green + .07*blue
    broad = blur(luma, 4, 'wrap')
    fine = blur(luma, 1, 'wrap')
    stone = np.clip(.085 + .50*broad + .52*(luma-broad), .07, .34)
    base = rgb(stone*(1-.52*shoulder), (1.08, 1, .95))
    base += rgb(shoulder, (.115, .019, .004)) + rgb(core, (.29, .067, .009))
    rough = np.clip(.89 - .24*fine - .54*core, .30, .89)
    height = .85*broad + 1.34*(fine-broad) + .42*(luma-fine) - .37*shoulder - .13*core
    emission = rgb(core**.82, (.97, .052, .006)) + rgb(core**2, (0, .65, .16))
    return save_maps('goal', base, rough, None, height, emission, 14, repeat=True)

def value_noise(x, y, cell, rng, period=None):
    columns = round(period/cell) if period else None
    gx, gy = x*(columns/period) if period else x/cell, y/cell
    ix, iy = np.floor(gx).astype(np.int32), np.floor(gy).astype(np.int32)
    u, v = smoothstep(0, 1, gx-ix), smoothstep(0, 1, gy-iy)
    j = iy-iy.min()
    if columns:
        i, next_i = ix % columns, (ix+1) % columns
    else:
        i = ix-ix.min()
        columns, next_i = i.max()+2, i+1
    grid = rng.random((j.max()+2, columns), dtype=np.float32)
    bottom = grid[j, i]*(1-u) + grid[j, next_i]*u
    top = grid[j+1, i]*(1-u) + grid[j+1, next_i]*u
    return (bottom*(1-v) + top*v).astype(np.float32)

def basalt_cells(x, y, period, rng):
    # Jittered cells give the rock angular plates. Return the distance between
    # the nearest two cell centers, which falls to zero along the fissures.
    columns = round(period/5.8)
    gx, gy = x*(columns/period), y/5.8
    ix, iy = np.floor(gx).astype(np.int32), np.floor(gy).astype(np.int32)
    u, v = gx-ix, gy-iy
    j = iy-iy.min()+1
    centers = .16+.68*rng.random((j.max()+2, columns, 2), dtype=np.float32)
    nearest = np.full(gx.shape, np.inf, dtype=np.float32)
    second = nearest.copy()
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            center = centers[j+dj, (ix+di) % columns]
            distance = (u-di-center[..., 0])**2 + (v-dj-center[..., 1])**2
            second = np.minimum(second, np.maximum(nearest, distance))
            nearest = np.minimum(nearest, distance)
    return np.sqrt(second)-np.sqrt(nearest)

def make_inner_maps():
    period = 2*INNER_HALF
    px = INNER_TEXELS_PER_UNIT
    x = (np.arange(INNER_WIDTH, dtype=np.float32)[None, None, :]+.5-INNER_PAD_U)/px
    x = x + np.array([0, INNER_HALF], dtype=np.float32)[:, None, None]
    y = INNER_MID_HEIGHT + (np.arange(INNER_STRIP_HEIGHT, dtype=np.float32)[None, :, None]+.5-INNER_STRIP_HEIGHT/2)/px
    rng = np.random.default_rng(1361)
    broad, grain, grit = (value_noise(x, y, scale, rng, period) for scale in (3.4, .68, .19))
    cells = basalt_cells(x+(broad-.5)*.72, y+(grain-.5)*.42, period, rng)
    plate = smoothstep(.018, .15, cells)
    heat = value_noise(x, y, 7.4, rng, period)*.75 + grain*.25
    ember = (1-smoothstep(.008, .041, cells))*smoothstep(.56, .81, heat)
    weather = broad*.53 + grain*.35 + grit*.12
    base = rgb((.45+weather*.92)*(.48+.52*plate), (.165, .149, .14))
    base += rgb(ember, (.53, .135, .021))
    rough = .87 - weather*.13 - ember*.43
    height = plate*.17 + broad*.18 + grain*.09 + grit*.015
    emissive = rgb(ember**.85, (.93, .24, .024))
    # Two halves share the same periodic texture field. Both have gutters for
    # the projecting wall returns and for filtering along the atlas split.
    shape = (2*INNER_STRIP_HEIGHT, INNER_WIDTH)
    return save_maps('inside', base.reshape(*shape, 3), rough.reshape(shape),
                     (.035+ember*.09).reshape(shape), height.reshape(shape),
                     emissive.reshape(*shape, 3), 1, (1/px, 1/px))

def make_rail_maps():
    w, h = 3072, 1668
    dx, dy = 2*RAIL_ATLAS[0]/w, 2*RAIL_ATLAS[1]/h
    x = (np.arange(w, dtype=np.float32)[None, :] + .5)*dx - RAIL_ATLAS[0]
    y = (np.arange(h, dtype=np.float32)[:, None] + .5)*dy - RAIL_ATLAS[1]
    inner = np.maximum(abs(x)-RAIL_INNER[0], abs(y)-RAIL_INNER[1])
    outer = np.minimum(np.minimum(x-RAIL_LEFT, RAIL_RIGHT-x), RAIL_SIDE-abs(y))
    # Use a rounded centerline measured in table units so the vein keeps its
    # width across the narrow sides, broad ends, and the four turns.
    radius = 1.04
    center_x = (RAIL_LEFT+RAIL_RIGHT)/4
    half_x = (RAIL_RIGHT-RAIL_LEFT)/4 + RAIL_INNER[0]/2
    half_y = (RAIL_SIDE+RAIL_INNER[1])/2
    qx, qy = abs(x-center_x)-half_x+radius, abs(y)-half_y+radius
    center_distance = (np.hypot(np.maximum(qx, 0), np.maximum(qy, 0))
                       + np.minimum(np.maximum(qx, qy), 0) - radius)
    rng = np.random.default_rng(947)
    broad, chips, grain = (value_noise(x, y, scale, rng) for scale in (4.2, .53, .16))
    distance = center_distance-(broad-.5)*.95-(chips-.5)*.23
    trench = 1-smoothstep(.07, .40, abs(distance))
    core = (1-smoothstep(.042, .17, abs(distance))) * (.36+.64*smoothstep(.15, .86, broad))
    split = (1-smoothstep(.025, .09, abs(distance-.33*chips-.12))) * smoothstep(.57, .86, broad)
    glow = np.maximum(core, split*.64)
    copper = 1-smoothstep(.13, .26, np.minimum(inner, outer))
    weathering = broad*.42 + chips*.44 + grain*.14
    basalt = rgb(.34+weathering*1.18, (.145, .131, .130))*(1-.74*trench[..., None])
    basalt += rgb(glow, (.62, .18, .025)) + rgb(trench, (.12, .025, .005))
    patina = rgb(.76+weathering*.42, (.49, .245, .104))
    base = basalt*(1-copper[..., None]) + patina*copper[..., None]
    rough = (.85-weathering*.18)*(1-copper) + (.31+grain*.14)*copper - .39*glow
    metal = .05 + .83*copper
    height = broad*.067 + chips*.076 + grain*.015 - trench*.19 - glow*.054 + copper*.062
    emissive = rgb(glow**.72, (.97, 0, 0)) + rgb(glow**1.75, (0, .62, .15))

    # Pad the edges for mipmaps, leaving unused atlas space constant.
    mask = (inner > -.65) & (outer > -.65)
    return save_maps('rail', base*mask[..., None], rough*mask, metal*mask,
                     height*mask, emissive*mask[..., None], 1, (dy, dx))

panel_maps = make_rock_maps('panel', 'fascia_long.png')
foot_maps = make_rock_maps('foot', 'pedestal_source.png')
inside_maps = make_inner_maps()
rail_maps = make_rail_maps()
goal_maps = make_goal_maps()
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'assets','tables','circuit','fuzeball_table_circuit.glb'))
for ob in list(bpy.context.scene.objects):
    if ob.name.startswith('standard_goal_floor_'): bpy.data.objects.remove(ob,do_unlink=True)
def textured_material(name, maps, emission_strength):
    albedo,rough_img,metal_img,normal_img,emissive_img=maps
    mat=bpy.data.materials.new(name); mat.use_nodes=True
    nodes=mat.node_tree.nodes; links=mat.node_tree.links
    bs=nodes.get('Principled BSDF')
    def tex(img,label):
        n=nodes.new('ShaderNodeTexImage'); n.image=img; n.label=label; n.interpolation='Linear'; return n
    links.new(tex(albedo,'Base color').outputs['Color'],bs.inputs['Base Color'])
    links.new(tex(rough_img,'Roughness').outputs['Color'],bs.inputs['Roughness'])
    if metal_img is not None:
        links.new(tex(metal_img,'Metallic').outputs['Color'],bs.inputs['Metallic'])
    nm=nodes.new('ShaderNodeNormalMap')
    links.new(tex(normal_img,'Normal').outputs['Color'],nm.inputs['Color']); links.new(nm.outputs['Normal'],bs.inputs['Normal'])
    links.new(tex(emissive_img,'Emissive traces').outputs['Color'],bs.inputs['Emission Color'])
    bs.inputs['Emission Strength'].default_value=emission_strength
    return mat

def solid(name,color,metal,rough,emission=None):
    m=bpy.data.materials.new(name); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal; p.inputs['Roughness'].default_value=rough
    if emission:
        p.inputs['Emission Color'].default_value=(*emission,1); p.inputs['Emission Strength'].default_value=1
    return m

side_panel=textured_material('Solar Forge | basalt fascia',panel_maps,1.30)
foot_panel=textured_material('Solar Forge | basalt pedestal',foot_maps,1.30)
trim=solid('Solar Forge | molten goal frame',(0.48,0.13,0.015),0.65,0.23,(1.0,0.22,0.01))
goal_frame=textured_material('Solar Forge | fractured basalt goal frame',goal_maps,2.60)
metalmat=solid('Solar Forge | rod collars',(0.12,0.075,0.045),0.85,0.26)
railmat=textured_material('Solar Forge | basalt and copper rim',rail_maps,1.60)
pedestal=foot_panel
inner=textured_material('Solar Forge | inner basalt wall',inside_maps,1.15)

def fascia_uv(p, axis):
    if axis == 2:
        return ((p.x+68.5)/137, (p.y+34)/34.25)
    return ((p.y+34 if axis == 0 else p.x+68.5)/137, (p.z+.6)/16.2)

def inner_uv(p, axis, positive, height):
    half_x, half_y = RAIL_INNER
    if axis == 0:
        distance = 2*half_x + half_y + (p.y if positive else -p.y)
        row = 0 if positive else 1
    else:
        distance = half_x + (-p.x if positive else p.x)
        row = 1 if positive else 0
    u = (INNER_PAD_U + distance*INNER_TEXELS_PER_UNIT)/INNER_WIDTH
    v = (row+.5)/2 + (height-INNER_MID_HEIGHT)*INNER_TEXELS_PER_UNIT/(2*INNER_STRIP_HEIGHT)
    return u, v


def rectangular_loop(left, right, half_y, z):
    return [(left, -half_y, z), (right, -half_y, z),
            (right, half_y, z), (left, half_y, z)]

def make_wall_band(name, loops, material, project):
    verts = [p for loop in loops for p in loop]
    faces = []
    for start in range(0, len(verts)-4, 4):
        for i in range(4):
            j = (i+1)%4
            faces.append((start+i, start+j, start+4+j, start+4+i))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    uv = mesh.uv_layers.new(name='UVMap')
    for poly in mesh.polygons:
        side = poly.index % 4
        axis = 1-side%2
        positive = side in (1, 2)
        for i in poly.loop_indices:
            uv.data[i].uv = project(mesh.vertices[mesh.loops[i].vertex_index].co, axis, positive)
    bpy.context.collection.objects.link(bpy.data.objects.new(name, mesh))
    mesh.materials.append(material)

def make_wall_rim():
    def outer(inset, z):
        return rectangular_loop(RAIL_LEFT+inset, RAIL_RIGHT-inset, RAIL_SIDE-inset, z)

    def inside(inset, z):
        x, y = (side+inset for side in RAIL_INNER)
        return rectangular_loop(-x, x, y, z)

    # The top bevel and both returns share their exact edge positions. The
    # returns meet the cabinet below the old channel and span the goal joints.
    outer_edge, inner_edge = outer(0, 15.49), inside(0, 15.49)
    make_wall_band('forge_wall_rim', (
        outer_edge, outer(.06, 15.57), outer(.13, 15.61),
        inside(.13, 15.61), inside(.06, 15.57), inner_edge,
    ), railmat, lambda p, _axis, _positive: (.5+p.x/(2*RAIL_ATLAS[0]), .5+p.y/(2*RAIL_ATLAS[1])))
    make_wall_band('forge_wall_outer_return', (outer(0, WALL_JOIN_HEIGHT), outer_edge),
                   side_panel, lambda p, axis, _positive: fascia_uv(p, axis))
    make_wall_band('forge_wall_inner_return', (inner_edge, inside(0, WALL_JOIN_HEIGHT)),
                   inner, lambda p, axis, positive: inner_uv(p, axis, positive, p.z))

for ob in list(bpy.context.scene.objects):
    if ob.type!='MESH': continue
    if ob.name.startswith('table_base'):
        for i in range(len(ob.data.materials)): ob.data.materials[i]=pedestal
        ob.data.materials.append(foot_panel); foot_index=len(ob.data.materials)-1
        uv=ob.data.uv_layers.active or ob.data.uv_layers.new(name='UVMap')
        for poly in ob.data.polygons:
            pts=[ob.matrix_world @ ob.data.vertices[ob.data.loops[li].vertex_index].co for li in poly.loop_indices]
            center=sum(pts,Vector())/len(pts)
            if center.z < -12 and abs(center.x)>39 and abs(poly.normal.x)>.6 and center.x*poly.normal.x>0:
                poly.material_index=foot_index
            # Project each face along its dominant normal. The old y/z-only
            # projection collapsed long stand faces and stretched the centre.
            axis=max(range(3),key=lambda i:abs(poly.normal[i]))
            for li,p in zip(poly.loop_indices,pts):
                if axis==0: uv.data[li].uv=((p.y+28)/84, .5+(p.z+26)/56)
                elif axis==1: uv.data[li].uv=((p.x+68.5)/51.4, (p.z+43)/34.25)
                else: uv.data[li].uv=((p.x+68.5)/51.4, (p.y+35.6)/34.25)
    elif ob.name.startswith(('wall_','goal_frame_header')):
        uv=ob.data.uv_layers.active or ob.data.uv_layers.new(name='UVMap')
        for i in range(len(ob.data.materials)): ob.data.materials[i]=inner
        ob.data.materials.append(side_panel); panel_index=len(ob.data.materials)-1
        side_wall = ob.name.startswith('wall_side')
        normal_matrix = ob.matrix_world.to_3x3().inverted().transposed()
        for poly in ob.data.polygons:
            verts = [ob.matrix_world @ ob.data.vertices[ob.data.loops[i].vertex_index].co
                     for i in poly.loop_indices]
            n = (normal_matrix @ poly.normal).normalized()
            center = sum(verts, Vector())/len(verts)
            outer_face = (side_wall and abs(center.y) > 35.5) or (
                not side_wall and abs(n.x) > .7 and abs(center.x) > 64.3)
            if outer_face:
                poly.material_index = panel_index
            axis = max(range(3), key=lambda i: abs(n[i]))
            wall_axis = (1 if side_wall else 0) if axis == 2 else axis
            for li, p in zip(poly.loop_indices, verts):
                if outer_face:
                    uv.data[li].uv = fascia_uv(p, axis)
                else:
                    height = p.z
                    if axis == 2:
                        height += abs(p[wall_axis])-RAIL_INNER[wall_axis]
                    uv.data[li].uv = inner_uv(p, wall_axis, center[wall_axis]>0, height)
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.bisect_plane(
            bm, geom=list(bm.verts)+list(bm.edges)+list(bm.faces), dist=1e-6,
            plane_co=ob.matrix_world.inverted() @ Vector((0, 0, WALL_JOIN_HEIGHT)),
            plane_no=ob.matrix_world.to_3x3().transposed() @ Vector((0, 0, 1)),
            clear_outer=True,
        )
        bm.to_mesh(ob.data)
        bm.free()
    elif ob.name.startswith('goal_frame_'):
        for i in range(len(ob.data.materials)): ob.data.materials[i]=goal_frame
        map_goal_frame(ob, repeats=9, offset=.38 if ob.name.startswith('goal_frame_l') else .73)
    elif ob.name.startswith('rod_hole'):
        for i in range(len(ob.data.materials)): ob.data.materials[i]=metalmat

make_wall_rim()
for side in (-1,1):
    bpy.ops.mesh.primitive_cube_add(size=1,location=(0,side*37.04,-0.34))
    strip=bpy.context.object; strip.name='forge_outer_rail_'+str(side)
    strip.dimensions=(136.6,0.12,0.14); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    strip.data.materials.append(trim)

# Extend the playing surface through each goal mouth to the cabinet edge.
# A separate dark satin slab avoids sampling the fascia texture on this face.
goal_floor=solid('Solar Forge | goal floor',(.012,.010,.016),.12,.66)
for end in (-1,1):
    bpy.ops.mesh.primitive_cube_add(size=1,location=(end*64.23,0,-.055))
    slab=bpy.context.object; slab.name='forge_goal_floor_'+('left' if end<0 else 'right')
    slab.dimensions=(8.50,22,.10); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    slab.data.materials.append(goal_floor)
# The concept lights the outside of the goal as well as the playing-side frame.
for side in (-1,1):
    curve=bpy.data.curves.new('forge outer goal','CURVE'); curve.dimensions='3D'; curve.bevel_depth=0.20; curve.bevel_resolution=3
    spline=curve.splines.new('POLY'); spline.points.add(3)
    coords = [Vector((side*68.58, y, z)) for y, z in
              [(-10.9, .2), (-10.9, 8.75), (10.9, 8.75), (10.9, .2)]]
    for p, co in zip(spline.points, coords): p.co=(*co,1)
    ob=bpy.data.objects.new('goal_frame_forge_outer_'+('l' if side<0 else 'r'),curve); bpy.context.collection.objects.link(ob); ob.data.materials.append(goal_frame)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active=ob; bpy.ops.object.convert(target='MESH')
    map_goal_frame(ob, repeats=15, offset=.28 if side<0 else .63, path=coords)

# Trace the real cabinet edge rather than painting a repeating line onto the pedestal.
base_ob=bpy.data.objects['table_base.001']
bvh=BVHTree.FromObject(base_ob,bpy.context.evaluated_depsgraph_get())
foot_trim=solid('Solar Forge | foot trim metal',(0.25,0.11,0.035),0.7,0.27)
for end in (-1,1):
    for path in ([(-26.3,float(z)) for z in np.linspace(-40,-14,80)],
                 [(26.3,float(z)) for z in np.linspace(-40,-14,80)],
                 [(float(y),-40) for y in np.linspace(-26.3,26.3,100)]):
        coords=[]
        for yy,zz in path:
            hit,normal_,idx,dist=bvh.ray_cast(Vector((end*80,yy,zz)),Vector((-end,0,0)),160)
            if hit and abs(hit.x)>35: coords.append((hit.x+end*0.2,yy,zz))
        if len(coords)>3:
            for label,depth,mat in (('bezel',0.21,foot_trim),('light',0.065,trim)):
                curve=bpy.data.curves.new('forge stand '+label,'CURVE'); curve.dimensions='3D'; curve.bevel_depth=depth; curve.bevel_resolution=2
                spline=curve.splines.new('POLY'); spline.points.add(len(coords)-1)
                for p,co in zip(spline.points,coords): p.co=(co[0]+end*(0.05 if label=='light' else 0),co[1],co[2],1)
                ob=bpy.data.objects.new('forge_stand_'+label+'_'+str(end),curve); bpy.context.collection.objects.link(ob); ob.data.materials.append(mat)
                bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active=ob; bpy.ops.object.convert(target='MESH')
for side in (-1,1):
    coords=[]
    for xx in np.linspace(-62,62,125):
        hits=[]
        for zz in np.arange(-33,-0.7,0.25):
            hit,normal_,idx,dist=bvh.ray_cast(Vector((float(xx),side*50,float(zz))),Vector((0,-side,0)),100)
            if hit and abs(hit.y)>35.2: hits.append((float(zz),hit.y))
        if hits:
            zz,yy=max(hits)
            coords.append((float(xx),side*35.9,zz-0.35))
    if len(coords)>2:
        zs=np.array([p[2] for p in coords]); smooth=np.convolve(np.pad(zs,(3,3),mode='edge'),np.ones(7)/7,mode='valid')
        coords=[(co[0],co[1],float(z)) for co,z in zip(coords,smooth)]
        curve=bpy.data.curves.new('forge pedestal edge','CURVE'); curve.dimensions='3D'; curve.resolution_u=2; curve.bevel_depth=0.12; curve.bevel_resolution=2
        spline=curve.splines.new('POLY'); spline.points.add(len(coords)-1)
        for p,co in zip(spline.points,coords): p.co=(*co,1)
        ob=bpy.data.objects.new('forge_pedestal_accent_'+str(side),curve); bpy.context.collection.objects.link(ob); ob.data.materials.append(trim)
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active=ob; bpy.ops.object.convert(target='MESH')
target=os.path.join(ROOT,'assets','tables','circuit','fuzeball_table_circuit_solar_forge.glb')
bpy.ops.export_scene.gltf(filepath=target,export_format='GLB',export_yup=True,export_apply=True,export_tangents=True)
print('Wrote',target)

