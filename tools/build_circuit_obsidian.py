"""Build the Obsidian Volt Circuit skin from the shipped Circuit GLB.

Run from the project root with Blender: blender -b --factory-startup -P tools/build_circuit_obsidian.py
The source GLB is read-only; maps and the new GLB are written alongside it.
"""
import bpy
import bmesh
import os
import sys
import tempfile
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from goal_frame_textures import blur, smoothstep, tile_gradient

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'tables', 'circuit', 'obsidian')
os.makedirs(OUT, exist_ok=True)
tempfile.tempdir = os.path.join(ROOT, 'tools', 'build', 'obsidian-temp')
os.makedirs(tempfile.tempdir, exist_ok=True)

# The Circuit master has separate end blocks and goal headers. The rim spans
# their joints and stays in place when those blocks move for Big Goal.
RIM_LEFT, RIM_RIGHT, RIM_SIDE = -68.4787, 68.4582, 37.0
RIM_INNER_X, RIM_INNER_Y = 60.0, 34.0
RIM_JOIN_Z, RIM_EDGE_Z, RIM_TOP_Z = 14.65, 15.45, 15.60
RIM_RETURN = 1.05
RIM_ATLAS_X, RIM_ATLAS_Y = 71, 40


def save_image(name, rgb, colorspace):
    h,w=rgb.shape[:2]
    rgba = np.ones((h,w,4),dtype=np.float32); rgba[:,:,:3] = rgb
    img = bpy.data.images.new(name, width=w, height=h, alpha=True)
    img.colorspace_settings.name = colorspace
    img.pixels.foreach_set(rgba.ravel()); img.filepath_raw = os.path.join(OUT,name+'.png')
    img.file_format='PNG'; img.save()
    return img


def make_goal_maps(rail_art):
    # Reuse the actual rail decal. Its parallel traces, vias and diagonal
    # lane changes run the full length of the frame UV unwrap.
    red, green, blue = rail_art[241:433].transpose(2, 0, 1)
    decal = smoothstep(.018, .29, np.minimum(green, blue)-red)
    rows = (np.arange(256, dtype=np.float32)+.5)/256
    charge = np.zeros((len(rows), rail_art.shape[1]), dtype=np.float32)
    for center in (.08, .42):
        v = ((rows-center+.5) % 1-.5)/.285+.5
        idx = np.clip(v, 0, 1)*(len(decal)-1)
        low = idx.astype(np.int32)
        mix = (idx-low)[:, None]
        band = decal[low]*(1-mix) + decal[np.minimum(low+1, len(decal)-1)]*mix
        fade = smoothstep(0, .085, v)*smoothstep(0, .085, 1-v)
        charge = np.maximum(charge, band*fade[:, None])
    # Keep the narrow lines visible after mip filtering, while retaining the pads.
    core = blur(np.maximum.reduce([charge, np.roll(charge, -1, axis=0),
                                    np.roll(charge, 1, axis=0)]), 1, 'wrap')
    trench = smoothstep(.02, .57, blur(core, 2, 'wrap'))
    # Sample the bare obsidian from beside the rail decal, wrapping it around the frame.
    stone_rows = (21 + 216*(1-np.cos(2*np.pi*rows))*.5).astype(np.int32)
    stone = rail_art[stone_rows, :, 0]
    broad = blur(stone, 4, 'wrap')
    fine = blur(stone, 1, 'wrap')
    glass = np.clip(.048 + 1.06*broad + .55*(stone-broad), .032, .43)
    base = (glass*(1-.49*trench))[..., None]*np.array([.80, .92, 1.06])
    base += core[..., None]*np.array([.006, .19, .22])
    rough = np.clip(.53 - .83*fine + .07*trench - .25*core, .21, .58)
    height = .75*broad + .99*(fine-broad) + .29*(stone-fine) - .17*trench
    dy, dx = tile_gradient(height)
    normal = np.stack((-6*dx, -5*dy, np.ones_like(dx)), axis=-1)
    normal = normal / np.linalg.norm(normal, axis=-1, keepdims=True)*.5 + .5
    emission = np.stack((.02*core**2, .82*core**.78, .95*core**.77), axis=-1)
    return (
        save_image('goal_basecolor', base, 'sRGB'),
        save_image('goal_roughness', np.repeat(rough[..., None], 3, axis=2), 'Non-Color'),
        None,
        save_image('goal_normal', normal, 'Non-Color'),
        save_image('goal_emissive', emission, 'sRGB'),
    )


def map_goal_decal(ob, path=None, center=0, direction=1):
    # Preserve one full decal along the frame and turn the outer corners'
    # evenly spaced U coordinates into distance along the profile.
    if path is not None:
        distances = np.cumsum([0, *((b-a).length for a, b in zip(path, path[1:]))])
        distances /= distances[-1]
    for loop in ob.data.uv_layers.active.data:
        u, v = loop.uv
        if path is not None:
            u = np.interp(u, (0, 1/3, 2/3, 1), distances)
        loop.uv = (u, (v-center)*direction)

# A single composed design spans each entire long side; it is never tiled.
panel_src=bpy.data.images.load(os.path.join(OUT,'obsidian_panel_source.png'),check_existing=False)
panel_src.scale(2048,680)
px=np.empty(2048*680*4,dtype=np.float32); panel_src.pixels.foreach_get(px)
panel=px.reshape(680,2048,4)[210:470,:,:3]
panel=panel[np.linspace(0,len(panel)-1,512).astype(int)]
panel=np.clip(panel*1.45,0,1)
plum=panel[:,:,0]*0.2126+panel[:,:,1]*0.7152+panel[:,:,2]*0.0722
pmask=np.clip((panel[:,:,1]-panel[:,:,0]-0.006)*7,0,0.8)
pmat=np.clip(pmask*2.2,0,1)
ph=0.5+(plum-0.02)*0.85-pmat*0.065
pdy,pdx=np.gradient(ph)
pn=np.stack((-pdx*3.2,-pdy*3.2,np.ones_like(pdx)),axis=-1)
pn=pn/np.maximum(np.linalg.norm(pn,axis=-1,keepdims=True),1e-6)*0.5+0.5
panel_rough=np.clip(0.54-plum*0.32-pmat*0.21,0.27,0.58)
panel_metal=np.clip(0.07+pmat*0.53,0,1)
panel_maps=(
    save_image('panel_basecolor',panel,'sRGB'),
    save_image('panel_roughness',np.repeat(panel_rough[:,:,None],3,axis=2),'Non-Color'),
    save_image('panel_metallic',np.repeat(panel_metal[:,:,None],3,axis=2),'Non-Color'),
    save_image('panel_normal',pn,'Non-Color'),
    save_image('panel_emissive',np.stack((pmask*0.02,pmask*0.5,pmask*0.6),axis=-1),'sRGB'))

# Inner walls use a quieter version of the composed drawing, not the outside finish.
inside=np.clip(panel*0.5+np.array([0.012,0.019,0.024],dtype=np.float32),0,1)
inside_maps=(save_image('inside_basecolor',inside,'sRGB'),panel_maps[1],panel_maps[2],panel_maps[3],
    save_image('inside_emissive',np.stack((pmask*0.006,pmask*0.24,pmask*0.29),axis=-1),'sRGB'))

# One composed image covers each end of the stand, following its own UVs.
foot_src=bpy.data.images.load(os.path.join(OUT,'obsidian_foot_source.png'),check_existing=False)
foot_src.scale(1024,1024)
fp=np.empty(1024*1024*4,dtype=np.float32); foot_src.pixels.foreach_get(fp)
foot=fp.reshape(1024,1024,4)[25:999,25:999,:3]
foot=np.clip(foot[np.linspace(0,len(foot)-1,1024).astype(int)][:,np.linspace(0,foot.shape[1]-1,1024).astype(int)]*1.85,0,1)
flum=foot[:,:,0]*0.2126+foot[:,:,1]*0.7152+foot[:,:,2]*0.0722
fmask=np.clip((foot[:,:,1]-foot[:,:,0]-0.005)*6,0,0.7)
fmat=np.clip(fmask*2.2,0,1)
fh=0.5+flum*0.7-fmat*0.06
fdy,fdx=np.gradient(fh); fn=np.stack((-fdx*3,-fdy*3,np.ones_like(fdx)),axis=-1)
fn=fn/np.maximum(np.linalg.norm(fn,axis=-1,keepdims=True),1e-6)*0.5+0.5
foot_maps=(save_image('foot_basecolor',foot,'sRGB'),
    save_image('foot_roughness',np.repeat(np.clip(0.52-flum*0.28-fmat*0.19,0.27,0.56)[:,:,None],3,axis=2),'Non-Color'),
    save_image('foot_metallic',np.repeat(np.clip(0.07+fmat*0.53,0,1)[:,:,None],3,axis=2),'Non-Color'),
    save_image('foot_normal',fn,'Non-Color'),
    save_image('foot_emissive',np.stack((fmask*0.01,fmask*0.38,fmask*0.46),axis=-1),'sRGB'))

# The goal frame uses the traces from the original rail artwork.
rail_src=bpy.data.images.load(os.path.join(OUT,'rail_imagegen_source.png'),check_existing=False)
rail_src.scale(2048,683)
rp=np.empty(2048*683*4,dtype=np.float32); rail_src.pixels.foreach_get(rp)
rail_art=rp.reshape(683,2048,4)[:,:,:3]


def sample_art(art, u, v):
    """Bilinear sampling with the same UV convention as the glTF textures."""
    h, w = art.shape[:2]
    x, y = u*w-.5, v*h-.5
    i, j = np.floor(x).astype(np.int32), np.floor(y).astype(np.int32)
    fx, fy = (x-i)[..., None], (y-j)[..., None]
    low = art[j % h, i % w]*(1-fx) + art[j % h, (i+1) % w]*fx
    high = art[(j+1) % h, i % w]*(1-fx) + art[(j+1) % h, (i+1) % w]*fx
    return low*(1-fy) + high*fy


def rim_wall_colors(x, y, outer, inner):
    # Unfold the upper faces into gutters on either side of the rim. At the
    # bottom of each gutter the samples meet the original wall UVs.
    end = x > 0
    outer_x = np.where(end, x-RIM_RIGHT, RIM_LEFT-x)
    outer_y = abs(y)-RIM_SIDE
    inner_x, inner_y = abs(x)-RIM_INNER_X, abs(y)-RIM_INNER_Y
    inside = inner < outer
    offset = np.where(inside, -inner, -outer)
    grow = np.clip(offset, -.5, RIM_RETURN)
    center = (RIM_LEFT+RIM_RIGHT)/2
    half = (RIM_RIGHT-RIM_LEFT)/2
    along_x = np.where(inside, x*RIM_INNER_X/(RIM_INNER_X-grow),
                       center+(x-center)*half/(half+grow))
    along_y = np.where(inside, y*RIM_INNER_Y/(RIM_INNER_Y-grow),
                       y*RIM_SIDE/(RIM_SIDE+grow))
    height = RIM_EDGE_Z-grow*(RIM_EDGE_Z-RIM_JOIN_Z)/RIM_RETURN
    v = (height+.6)/16.2
    side = sample_art(panel, (along_x+68.5)/137, v)
    cap = sample_art(panel, (along_y+34)/68, v)
    corner = smoothstep(-.60, .60, np.where(inside, inner_x-inner_y, outer_x-outer_y))
    art = side + (cap-side)*corner[..., None]
    wall = np.where(inside[..., None], art*.5 + (.012, .019, .024), art)
    wall_charge = np.clip((art[..., 1]-art[..., 0]-.006)*7, 0, .8)
    return art, wall, wall_charge, inside, smoothstep(-.45, .85, offset)


def make_rail_maps():
    w, h = 3072, 1728
    dx, dy = 2*RIM_ATLAS_X/w, 2*RIM_ATLAS_Y/h
    x = (np.arange(w, dtype=np.float32)[None, :]+.5)*dx-RIM_ATLAS_X
    y = (np.arange(h, dtype=np.float32)[:, None]+.5)*dy-RIM_ATLAS_Y
    outer = np.minimum(np.minimum(x-RIM_LEFT, RIM_RIGHT-x), RIM_SIDE-abs(y))
    inner = np.maximum(abs(x)-RIM_INNER_X, abs(y)-RIM_INNER_Y)
    ys, xs = np.where((outer > -1.8) & (inner > -1.8))
    px, py = x[0, xs], y[ys, 0]

    # Sample the bare crystal artwork around the old decal at roughly equal
    # texel density in both directions. Feather the projection at the corners.
    side_u = .5 + .47*px/RIM_ATLAS_X
    side_v = np.where(py < 0, .19, .80) + .020*(abs(py)-35.5)
    side_stone = sample_art(rail_art, side_u, side_v)[:, 0]
    end_u = np.where(px < 0, .34, .65) + .007*py
    end_v = np.where(px < 0, .20, .80) + .020*(abs(px)-64)
    end_stone = sample_art(rail_art, end_u, end_v)[:, 0]
    corner = smoothstep(-2, 2, (abs(px)-60) - (abs(py)-34))
    tone = side_stone + (end_stone-side_stone)*corner
    stone = np.clip(.016 + 1.62*tone, .026, .44)

    # Trace a single closed circuit in table units, with staggered jogs and
    # branches. The signed distance rounds the tracks through each corner.
    cx = (RIM_LEFT+RIM_RIGHT)/4
    hx = (RIM_RIGHT-RIM_LEFT)/4 + RIM_INNER_X/2
    hy = (RIM_SIDE+RIM_INNER_Y)/2
    radius = 1.12
    qx, qy = abs(px-cx)-hx+radius, abs(py)-hy+radius
    distance = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - radius
    s = np.where(qx > qy,
                 np.where(px > cx, 2*hx+hy+py, 4*hx+3*hy-py),
                 np.where(py < 0, hx+px-cx, 3*hx+2*hy-px+cx))
    route = np.interp(s, (0, 20, 20.8, 54, 54.7, 94, 95, 114, 115, 146, 147, 183, 184,
                          224, 225, 254, 255, 291, 292, 311, 312, 347, 348, 378, 379),
                      (0, 0, .46, .46, -.19, -.19, .52, .52, 0, 0, -.56, -.56, 0,
                       0, -.61, -.61, .21, .21, -.40, -.40, 0, 0, .64, .64, 0))
    line = distance-route
    primary = 1-smoothstep(.044, .137, abs(line))
    branch = np.zeros_like(primary)
    for a, b, lane in ((8, 44, -.48), (65, 108, .46), (153, 181, .52),
                       (209, 249, .45), (270, 308, -.53), (333, 370, -.5)):
        trace = (1-smoothstep(.025, .098, abs(line-lane))) * (smoothstep(a, a+.5, s)-smoothstep(b, b+.5, s))
        pads = 1-smoothstep(.10, .18, np.hypot(np.minimum(abs(s-a), abs(s-b)), line-lane))
        branch = np.maximum(branch, np.maximum(trace, pads))
    core = np.maximum(.80*primary, .54*branch)

    art, wall, charge, inside, blend = rim_wall_colors(px, py, outer[ys, xs], inner[ys, xs])
    base = stone[:, None]*np.array([.82, .97, 1.12]) + core[:, None]*(.004, .135, .172)
    base += (wall-base)*blend[:, None]
    glow = core[:, None]*(.008, .64, .79)
    wall_glow = charge[:, None]*np.where(inside[:, None], (.006, .24, .29), (.02, .5, .6))
    glow += (wall_glow-glow)*blend[:, None]
    lum = art @ np.array([.2126, .7152, .0722])
    metal = np.clip(charge*2.2, 0, 1)
    rough = (.77-.70*stone-.26*core)*(1-blend) + np.clip(.54-.32*lum-.21*metal, .27, .58)*blend
    metallic = .07 + .53*(core*.2*(1-blend)+metal*blend)
    height = np.zeros((h, w), dtype=np.float32)
    height[ys, xs] = (stone*.58-core*.025)*(1-blend) + (.85*(lum-.02)-.065*metal)*blend
    hy, hx = np.gradient(height)
    normal = np.stack((-3.2*hx, -3.2*hy, np.ones_like(hx)), axis=-1)
    normal = normal / np.linalg.norm(normal, axis=-1, keepdims=True)*.5+.5

    def bake(name, values, colorspace):
        rgb = np.zeros((h, w, 3), dtype=np.float32)
        rgb[ys, xs] = values
        return save_image('rail_'+name, rgb, colorspace)

    return (bake('basecolor', base, 'sRGB'), bake('roughness', rough[:, None], 'Non-Color'),
            bake('metallic', metallic[:, None], 'Non-Color'), save_image('rail_normal', normal, 'Non-Color'),
            bake('emissive', glow, 'sRGB'))

bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'assets','tables','circuit','fuzeball_table_circuit.glb'))
for ob in list(bpy.context.scene.objects):
    if ob.name.startswith('standard_goal_floor_'): bpy.data.objects.remove(ob,do_unlink=True)

def textured_material(name, maps, normal_strength=2.5, emission_strength=1.0):
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
    nm=nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value=normal_strength
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

side_panel=textured_material('Obsidian Volt | composed side panel',panel_maps)
foot_panel=textured_material('Obsidian Volt | stand end panel',foot_maps)
trim=solid('Obsidian Volt | cyan goal frame',(0.025,0.20,0.23),0.5,0.26,(0.025,0.65,0.78))
goal_frame=textured_material('Obsidian Volt | circuit goal frame', make_goal_maps(rail_art),
                             normal_strength=1.0, emission_strength=2.85)
metalmat=solid('Obsidian Volt | rod collars',(0.16,0.22,0.25),0.85,0.26)
railmat=textured_material('Obsidian Volt | wrapped obsidian rim',make_rail_maps())
pedestal=solid('Obsidian Volt | black satin pedestal',(0.022,0.032,0.042),0.32,0.3)
inner=textured_material('Obsidian Volt | inner wall circuitry',inside_maps)


def make_wall_rim():
    def outer(inset, z):
        left, right, y = RIM_LEFT+inset, RIM_RIGHT-inset, RIM_SIDE-inset
        return [(left, -y, z), (right, -y, z), (right, y, z), (left, y, z)]

    def inside(inset, z):
        x, y = RIM_INNER_X+inset, RIM_INNER_Y+inset
        return [(-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z)]

    # Flatten the short vertical returns into the texture gutters so their
    # artwork follows the bevel and meets the existing vertical walls below.
    loops = (outer(0, RIM_JOIN_Z), outer(0, RIM_EDGE_Z), outer(.15, RIM_TOP_Z),
             inside(.15, RIM_TOP_Z), inside(0, RIM_EDGE_Z), inside(0, RIM_JOIN_Z))
    uv_loops = (outer(-RIM_RETURN, 0), *loops[1:-1], inside(-RIM_RETURN, 0))
    faces = []
    for row in range(len(loops)-1):
        for i in range(4):
            j = (i+1) % 4
            faces.append((4*row+i, 4*row+j, 4*(row+1)+j, 4*(row+1)+i))
    name = 'volt_wall_rim'
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([p for loop in loops for p in loop], [], faces)
    mesh.update()
    coords = [p for loop in uv_loops for p in loop]
    uv = mesh.uv_layers.new(name='UVMap')
    for loop in mesh.loops:
        x, y, _ = coords[loop.vertex_index]
        uv.data[loop.index].uv = (.5+x/(2*RIM_ATLAS_X), .5+y/(2*RIM_ATLAS_Y))
    mesh.materials.append(railmat)
    bpy.context.collection.objects.link(bpy.data.objects.new(name, mesh))


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
            axis=max(range(3),key=lambda i:abs(poly.normal[i]))
            for li,p in zip(poly.loop_indices,pts):
                if axis==0: uv.data[li].uv=((p.y+28)/56,.5+(p.z+26)/56)
                elif axis==1: uv.data[li].uv=((p.x+68.5)/137,(p.z+43)/34.25)
                else: uv.data[li].uv=((p.x+68.5)/137,(p.y+35.6)/34.25)
    elif ob.name.startswith(('wall_','goal_frame_header')):
        uv=ob.data.uv_layers.active or ob.data.uv_layers.new(name='UVMap')
        for i in range(len(ob.data.materials)): ob.data.materials[i]=inner
        ob.data.materials.append(side_panel); panel_index=len(ob.data.materials)-1
        side_wall = ob.name.startswith('wall_side')
        for poly in ob.data.polygons:
            verts = [ob.matrix_world @ ob.data.vertices[ob.data.loops[i].vertex_index].co
                     for i in poly.loop_indices]
            center = sum(verts, Vector())/len(verts)
            if (side_wall and abs(center.y)>35.5) or (
                    not side_wall and abs(poly.normal.x)>.7 and abs(center.x)>64.3):
                poly.material_index = panel_index
            for li, p in zip(poly.loop_indices, verts):
                if abs(poly.normal.z)>0.7:
                    uv.data[li].uv=((p.x+68.5)/137,(p.y+34)/34.25)
                elif side_wall:
                    uv.data[li].uv=((p.x+68.5)/137,(p.z+0.6)/16.2)
                else:
                    uv.data[li].uv=((p.y+34)/68,(p.z+0.6)/16.2)
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.bisect_plane(
            bm, geom=list(bm.verts)+list(bm.edges)+list(bm.faces), dist=1e-6,
            plane_co=ob.matrix_world.inverted() @ Vector((0, 0, RIM_JOIN_Z)),
            plane_no=ob.matrix_world.to_3x3().transposed() @ Vector((0, 0, 1)),
            clear_outer=True,
        )
        bm.to_mesh(ob.data)
        bm.free()
    elif ob.name.startswith('goal_frame_'):
        for i in range(len(ob.data.materials)): ob.data.materials[i]=goal_frame
        map_goal_decal(ob)
    elif ob.name.startswith('rod_hole'):
        for i in range(len(ob.data.materials)): ob.data.materials[i]=metalmat

make_wall_rim()

# Extend the floor through each goal mouth to the outer wall.
goal_floor=solid('Obsidian Volt | goal floor',(.012,.016,.022),.12,.66)
for end in (-1,1):
    bpy.ops.mesh.primitive_cube_add(size=1,location=(end*64.23,0,-.055))
    slab=bpy.context.object; slab.name='obsidian_goal_floor_'+('left' if end<0 else 'right')
    slab.dimensions=(8.50,22,.10); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    slab.data.materials.append(goal_floor)

for side in (-1,1):
    bpy.ops.mesh.primitive_cube_add(size=1,location=(0,side*37.04,-0.34))
    strip=bpy.context.object; strip.name='volt_outer_rail_'+str(side)
    strip.dimensions=(136.6,0.12,0.14); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    strip.data.materials.append(trim)

# The concept lights the outside of the goal as well as the playing-side frame.
for side in (-1,1):
    curve=bpy.data.curves.new('volt outer goal','CURVE'); curve.dimensions='3D'; curve.bevel_depth=0.20; curve.bevel_resolution=3
    spline=curve.splines.new('POLY'); spline.points.add(3)
    coords = [Vector((side*68.58, y, z)) for y, z in
              [(-10.9, .2), (-10.9, 8.75), (10.9, 8.75), (10.9, .2)]]
    for p, co in zip(spline.points, coords): p.co=(*co,1)
    ob=bpy.data.objects.new('goal_frame_volt_outer_'+('l' if side<0 else 'r'),curve); bpy.context.collection.objects.link(ob); ob.data.materials.append(goal_frame)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active=ob; bpy.ops.object.convert(target='MESH')
    map_goal_decal(ob, path=coords, center=.90 if side<0 else .40, direction=-side)

# Trace the real cabinet edge rather than painting a repeating line onto the pedestal.
base_ob=bpy.data.objects['table_base.001']
bvh=BVHTree.FromObject(base_ob,bpy.context.evaluated_depsgraph_get())
foot_trim=solid('Obsidian Volt | foot trim metal',(0.09,0.14,0.17),0.7,0.27)
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
                curve=bpy.data.curves.new('volt stand '+label,'CURVE'); curve.dimensions='3D'; curve.bevel_depth=depth; curve.bevel_resolution=2
                spline=curve.splines.new('POLY'); spline.points.add(len(coords)-1)
                for p,co in zip(spline.points,coords): p.co=(co[0]+end*(0.05 if label=='light' else 0),co[1],co[2],1)
                ob=bpy.data.objects.new('volt_stand_'+label+'_'+str(end),curve); bpy.context.collection.objects.link(ob); ob.data.materials.append(mat)
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
        curve=bpy.data.curves.new('volt pedestal edge','CURVE'); curve.dimensions='3D'; curve.resolution_u=2; curve.bevel_depth=0.12; curve.bevel_resolution=2
        spline=curve.splines.new('POLY'); spline.points.add(len(coords)-1)
        for p,co in zip(spline.points,coords): p.co=(*co,1)
        ob=bpy.data.objects.new('volt_pedestal_accent_'+str(side),curve); bpy.context.collection.objects.link(ob); ob.data.materials.append(trim)
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active=ob; bpy.ops.object.convert(target='MESH')
target=os.path.join(ROOT,'assets','tables','circuit','fuzeball_table_circuit_obsidian.glb')
bpy.ops.export_scene.gltf(filepath=target,export_format='GLB',export_yup=True,export_apply=True)
print('Wrote',target)
