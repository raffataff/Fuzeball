import bpy, os, tempfile, numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(ROOT,'assets','tables','circuit','solar_forge'); os.makedirs(OUT,exist_ok=True)
tempfile.tempdir=os.path.join(ROOT,'tools','build','solar-temp'); os.makedirs(tempfile.tempdir,exist_ok=True)
def save_image(name, rgb, colorspace):
 h,w=rgb.shape[:2]; rgba=np.ones((h,w,4),dtype=np.float32); rgba[:,:,:3]=np.clip(rgb,0,1)
 img=bpy.data.images.new(name,width=w,height=h,alpha=True); img.colorspace_settings.name=colorspace
 img.pixels.foreach_set(rgba.ravel()); img.filepath_raw=os.path.join(OUT,name+'.png'); img.file_format='PNG'; img.save(); return img

def make_maps(name,kind):
 source={'foot':'pedestal_source.png','inside':'inside_source.png'}.get(kind,'fascia_long.png')
 src=bpy.data.images.load(os.path.join(OUT,source),check_existing=False)
 w,h=src.size; px=np.empty(w*h*4,dtype=np.float32); src.pixels.foreach_get(px); base=px.reshape(h,w,4)[:,:,:3].copy()
 # Keep the inner wall dark, but derive its relief and lava mask from the
 # original artwork before dimming so the rock detail does not disappear.
 detail=base.copy() if kind=='inside' else None
 if kind=='inside': base*=.75
 rng=np.random.default_rng(833+len(name)); noise=rng.random((h,w),dtype=np.float32)
 # Gold filaments and hot cores receive their own emissive and metallic response.
 red,green,blue=base[:,:,0],base[:,:,1],base[:,:,2]
 gold=np.clip((red-blue*.9)*2.3,0,1); hot=np.clip((red-.30)*2,0,1)*np.clip((red-blue)*3,0,1)
 lum=red*.2126+green*.7152+blue*.0722
 rough=np.clip(.73-lum*.18+noise*.035,.48,.78); metal=np.clip(.08+gold*.28,0,1)
 if kind=='inside':
  dr,dg,db=detail[:,:,0],detail[:,:,1],detail[:,:,2]
  detail_lum=dr*.2126+dg*.7152+db*.0722
  hot=np.clip((dr-.30)*2,0,1)*np.clip((dr-db)*3,0,1)
  height=detail_lum*.9-hot*.35
 else: height=lum*.9-hot*.35
 dy,dx=np.gradient(height); normal=np.stack((-dx*4,-dy*4,np.ones_like(dx)),axis=-1); normal=normal/np.linalg.norm(normal,axis=-1,keepdims=True)*.5+.5
 glow=.42 if kind=='inside' else 1
 emiss=np.stack((hot*.95*glow,hot*.35*glow,hot*.035*glow),axis=-1)
 return (save_image(name+'_basecolor',base,'sRGB'),save_image(name+'_roughness',np.repeat(rough[:,:,None],3,axis=2),'Non-Color'),save_image(name+'_metallic',np.repeat(metal[:,:,None],3,axis=2),'Non-Color'),save_image(name+'_normal',normal,'Non-Color'),save_image(name+'_emissive',emiss,'sRGB'))

panel_maps=make_maps('panel','panel'); foot_maps=make_maps('foot','foot'); inside_maps=make_maps('inside','inside')
def make_brushed_copper():
 h,w=256,1024
 rng=np.random.default_rng(947)
 streak=rng.normal(0,.026,(h,1)).astype(np.float32)+rng.normal(0,.004,(h,w)).astype(np.float32)
 base=np.clip(np.array([.25,.085,.032],dtype=np.float32)[None,None,:]*(1+streak[:,:,None]*3),0,1)
 rough=np.clip(.32+streak*.8,.24,.4)
 normal=np.zeros((h,w,3),dtype=np.float32); normal[:,:,0]=.5; normal[:,:,1]=np.clip(.5+np.gradient(streak,axis=0)*.65,.4,.6); normal[:,:,2]=1
 return (save_image('rail_basecolor',base,'sRGB'),save_image('rail_roughness',np.repeat(rough[:,:,None],3,axis=2),'Non-Color'),save_image('rail_metallic',np.full((h,w,3),.82,dtype=np.float32),'Non-Color'),save_image('rail_normal',normal,'Non-Color'),save_image('rail_emissive',np.zeros((h,w,3),dtype=np.float32),'sRGB'))
rail_maps=make_brushed_copper()
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'assets','tables','circuit','fuzeball_table_circuit.glb'))
for ob in list(bpy.context.scene.objects):
    if ob.name.startswith('standard_goal_floor_'): bpy.data.objects.remove(ob,do_unlink=True)
def textured_material(name, maps, normal_strength=0.55):
    albedo,rough_img,metal_img,normal_img,emissive_img=maps
    mat=bpy.data.materials.new(name); mat.use_nodes=True
    nodes=mat.node_tree.nodes; links=mat.node_tree.links
    bs=nodes.get('Principled BSDF')
    def tex(img,label):
        n=nodes.new('ShaderNodeTexImage'); n.image=img; n.label=label; n.interpolation='Linear'; return n
    links.new(tex(albedo,'Base color').outputs['Color'],bs.inputs['Base Color'])
    links.new(tex(rough_img,'Roughness').outputs['Color'],bs.inputs['Roughness'])
    links.new(tex(metal_img,'Metallic').outputs['Color'],bs.inputs['Metallic'])
    nm=nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value=normal_strength
    links.new(tex(normal_img,'Normal').outputs['Color'],nm.inputs['Color']); links.new(nm.outputs['Normal'],bs.inputs['Normal'])
    links.new(tex(emissive_img,'Emissive traces').outputs['Color'],bs.inputs['Emission Color'])
    bs.inputs['Emission Strength'].default_value=1.0
    return mat

def solid(name,color,metal,rough,emission=None):
    m=bpy.data.materials.new(name); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal; p.inputs['Roughness'].default_value=rough
    if emission:
        p.inputs['Emission Color'].default_value=(*emission,1); p.inputs['Emission Strength'].default_value=1
    return m

side_panel=textured_material('Solar Forge | composed side panel',panel_maps)
foot_panel=textured_material('Solar Forge | stand end panel',foot_maps)
frame=solid('Solar Forge | cyan goal frame',(0.48,0.13,0.015),0.65,0.23,(1.0,0.22,0.01))
metalmat=solid('Solar Forge | rod collars',(0.12,0.075,0.045),0.85,0.26)
railmat=textured_material('Solar Forge | brushed copper rail',rail_maps)
pedestal=foot_panel
inner=textured_material('Solar Forge | inner wall circuitry',inside_maps,normal_strength=1.0)

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
        for poly in ob.data.polygons:
            n=poly.normal; axis=max(range(3),key=lambda i:abs(n[i]))
            top=n.z>0.8 and all((ob.matrix_world @ ob.data.vertices[ob.data.loops[li].vertex_index].co).z > 15.45 for li in poly.loop_indices)
            for li in poly.loop_indices:
                p=ob.matrix_world @ ob.data.vertices[ob.data.loops[li].vertex_index].co
                if top and ob.name.startswith('wall_side'):
                    uv.data[li].uv=((p.x+68.5)/137,(abs(p.y)-34)/3)
                elif top:
                    uv.data[li].uv=((p.y+34)/68,(abs(p.x)-60)/8.5)
                elif abs(n.z)>0.7:
                    # Horizontal ledges must use both horizontal axes.
                    uv.data[li].uv=((p.x+68.5)/137,(p.y+34)/34.25)
                elif ob.name.startswith('wall_side'):
                    uv.data[li].uv=((p.x+68.5)/137,(p.z+0.6)/16.2)
                else:
                    uv.data[li].uv=((p.y+34)/137,(p.z+0.6)/16.2)
        for i in range(len(ob.data.materials)): ob.data.materials[i]=inner
        ob.data.materials.append(railmat); rail_index=len(ob.data.materials)-1
        ob.data.materials.append(side_panel); panel_index=len(ob.data.materials)-1
        for poly in ob.data.polygons:
            verts=[ob.matrix_world @ ob.data.vertices[ob.data.loops[li].vertex_index].co for li in poly.loop_indices]
            if ob.name.startswith('wall_side') and sum(abs(p.y) for p in verts)/len(verts)>35.5:
                poly.material_index=panel_index
            elif not ob.name.startswith('wall_side') and abs(poly.normal.x)>0.7 and sum(abs(p.x) for p in verts)/len(verts)>64.3:
                poly.material_index=panel_index
            if poly.normal.z > 0.8 and all((ob.matrix_world @ ob.data.vertices[ob.data.loops[li].vertex_index].co).z > 15.45 for li in poly.loop_indices):
                poly.material_index=rail_index
    elif ob.name.startswith('goal_frame_'):
        for i in range(len(ob.data.materials)): ob.data.materials[i]=frame
    elif ob.name.startswith('rod_hole'):
        for i in range(len(ob.data.materials)): ob.data.materials[i]=metalmat

for side in (-1,1):
    bpy.ops.mesh.primitive_cube_add(size=1,location=(0,side*34.08,15.61))
    strip=bpy.context.object; strip.name='forge_rail_accent_'+str(side)
    strip.dimensions=(119.7,0.16,0.12); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    strip.data.materials.append(frame)
    bpy.ops.mesh.primitive_cube_add(size=1,location=(0,side*37.04,-0.34))
    strip=bpy.context.object; strip.name='forge_outer_rail_'+str(side)
    strip.dimensions=(136.6,0.12,0.14); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    strip.data.materials.append(frame)

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
    for p,co in zip(spline.points,[(side*68.58,-10.9,0.2),(side*68.58,-10.9,8.75),(side*68.58,10.9,8.75),(side*68.58,10.9,0.2)]): p.co=(*co,1)
    ob=bpy.data.objects.new('goal_frame_forge_outer_'+('l' if side<0 else 'r'),curve); bpy.context.collection.objects.link(ob); ob.data.materials.append(frame)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active=ob; bpy.ops.object.convert(target='MESH')

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
            for label,depth,mat in (('bezel',0.21,foot_trim),('light',0.065,frame)):
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
        ob=bpy.data.objects.new('forge_pedestal_accent_'+str(side),curve); bpy.context.collection.objects.link(ob); ob.data.materials.append(frame)
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active=ob; bpy.ops.object.convert(target='MESH')
target=os.path.join(ROOT,'assets','tables','circuit','fuzeball_table_circuit_solar_forge.glb')
bpy.ops.export_scene.gltf(filepath=target,export_format='GLB',export_yup=True,export_apply=True)
print('Wrote',target)

