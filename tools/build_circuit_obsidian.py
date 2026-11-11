"""Build the Obsidian Volt Circuit skin from the shipped Circuit GLB.

Run from the project root with Blender: blender -b --factory-startup -P tools/build_circuit_obsidian.py
The source GLB is read-only; maps and the new GLB are written alongside it.
"""
import bpy
import os
import tempfile
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'tables', 'circuit', 'obsidian')
os.makedirs(OUT, exist_ok=True)
tempfile.tempdir = os.path.join(ROOT, 'tools', 'build', 'obsidian-temp')
os.makedirs(tempfile.tempdir, exist_ok=True)
def save_image(name, rgb, colorspace):
    h,w=rgb.shape[:2]
    rgba = np.ones((h,w,4),dtype=np.float32); rgba[:,:,:3] = rgb
    img = bpy.data.images.new(name, width=w, height=h, alpha=True)
    img.colorspace_settings.name = colorspace
    img.pixels.foreach_set(rgba.ravel()); img.filepath_raw = os.path.join(OUT,name+'.png')
    img.file_format='PNG'; img.save()
    return img

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

# Image-authored rail art, cropped to keep its proportions on the narrow tops.
rail_src=bpy.data.images.load(os.path.join(OUT,'rail_imagegen_source.png'),check_existing=False)
rail_src.scale(2048,683)
rp=np.empty(2048*683*4,dtype=np.float32); rail_src.pixels.foreach_get(rp)
rail=np.clip(rp.reshape(683,2048,4)[241:433,:,:3]*1.45,0,1)
for i in range(96):
    blend=0.5*(1-i/96)
    left=rail[:,i,:].copy(); right=rail[:,-1-i,:].copy()
    rail[:,i,:]=left*(1-blend)+right*blend; rail[:,-1-i,:]=right*(1-blend)+left*blend
rlum=rail[:,:,0]*0.2126+rail[:,:,1]*0.7152+rail[:,:,2]*0.0722
rmask=np.clip((rail[:,:,1]-rail[:,:,0]-0.006)*7,0,0.8)
rmat=np.clip(rmask*2.2,0,1)
height=0.5+(rlum-0.02)*0.85-rmat*0.065
rd_y,rd_x=np.gradient(height); rail_n=np.stack((-rd_x*3.2,-rd_y*3.2,np.ones_like(rd_x)),axis=-1)
rail_n=rail_n/np.maximum(np.linalg.norm(rail_n,axis=-1,keepdims=True),1e-6)*0.5+0.5
rail_maps=(save_image('rail_basecolor',rail,'sRGB'),
    save_image('rail_roughness',np.repeat(np.clip(0.54-rlum*0.32-rmat*0.21,0.27,0.58)[:,:,None],3,axis=2),'Non-Color'),
    save_image('rail_metallic',np.repeat(np.clip(0.07+rmat*0.53,0,1)[:,:,None],3,axis=2),'Non-Color'),
    save_image('rail_normal',rail_n,'Non-Color'),
    save_image('rail_emissive',np.stack((rmask*0.02,rmask*0.5,rmask*0.6),axis=-1),'sRGB'))

bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'assets','tables','circuit','fuzeball_table_circuit.glb'))
for ob in list(bpy.context.scene.objects):
    if ob.name.startswith('standard_goal_floor_'): bpy.data.objects.remove(ob,do_unlink=True)

def textured_material(name, maps):
    albedo,rough_img,metal_img,normal_img,emissive_img=maps
    mat=bpy.data.materials.new(name); mat.use_nodes=True
    nodes=mat.node_tree.nodes; links=mat.node_tree.links
    bs=nodes.get('Principled BSDF')
    def tex(img,label):
        n=nodes.new('ShaderNodeTexImage'); n.image=img; n.label=label; n.interpolation='Linear'; return n
    links.new(tex(albedo,'Base color').outputs['Color'],bs.inputs['Base Color'])
    links.new(tex(rough_img,'Roughness').outputs['Color'],bs.inputs['Roughness'])
    links.new(tex(metal_img,'Metallic').outputs['Color'],bs.inputs['Metallic'])
    nm=nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value=2.5
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

side_panel=textured_material('Obsidian Volt | composed side panel',panel_maps)
foot_panel=textured_material('Obsidian Volt | stand end panel',foot_maps)
frame=solid('Obsidian Volt | cyan goal frame',(0.025,0.20,0.23),0.5,0.26,(0.025,0.65,0.78))
metalmat=solid('Obsidian Volt | rod collars',(0.16,0.22,0.25),0.85,0.26)
railmat=textured_material('Obsidian Volt | brushed graphite rail',rail_maps)
pedestal=solid('Obsidian Volt | black satin pedestal',(0.022,0.032,0.042),0.32,0.3)
inner=textured_material('Obsidian Volt | inner wall circuitry',inside_maps)

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
        for poly in ob.data.polygons:
            n=poly.normal; axis=max(range(3),key=lambda i:abs(n[i]))
            top=n.z>0.8 and all((ob.matrix_world @ ob.data.vertices[ob.data.loops[li].vertex_index].co).z > 15.45 for li in poly.loop_indices)
            for li in poly.loop_indices:
                p=ob.matrix_world @ ob.data.vertices[ob.data.loops[li].vertex_index].co
                if top and ob.name.startswith('wall_side'):
                    uv.data[li].uv=((p.x+68.5)/32,(abs(p.y)-34)/3)
                elif top:
                    uv.data[li].uv=((p.y+34)/32,(abs(p.x)-60)/3)
                elif abs(n.z)>0.7:
                    uv.data[li].uv=((p.x+68.5)/137,(p.y+34)/34.25)
                elif ob.name.startswith('wall_side'):
                    uv.data[li].uv=((p.x+68.5)/137,(p.z+0.6)/16.2)
                else:
                    uv.data[li].uv=((p.y+34)/68,(p.z+0.6)/16.2)
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

# Extend the floor through each goal mouth to the outer wall.
goal_floor=solid('Obsidian Volt | goal floor',(.012,.016,.022),.12,.66)
for end in (-1,1):
    bpy.ops.mesh.primitive_cube_add(size=1,location=(end*64.23,0,-.055))
    slab=bpy.context.object; slab.name='obsidian_goal_floor_'+('left' if end<0 else 'right')
    slab.dimensions=(8.50,22,.10); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    slab.data.materials.append(goal_floor)

for side in (-1,1):
    bpy.ops.mesh.primitive_cube_add(size=1,location=(0,side*34.08,15.61))
    strip=bpy.context.object; strip.name='volt_rail_accent_'+str(side)
    strip.dimensions=(119.7,0.16,0.12); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    strip.data.materials.append(frame)
    bpy.ops.mesh.primitive_cube_add(size=1,location=(0,side*37.04,-0.34))
    strip=bpy.context.object; strip.name='volt_outer_rail_'+str(side)
    strip.dimensions=(136.6,0.12,0.14); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    strip.data.materials.append(frame)

# The concept lights the outside of the goal as well as the playing-side frame.
for side in (-1,1):
    curve=bpy.data.curves.new('volt outer goal','CURVE'); curve.dimensions='3D'; curve.bevel_depth=0.20; curve.bevel_resolution=3
    spline=curve.splines.new('POLY'); spline.points.add(3)
    for p,co in zip(spline.points,[(side*68.58,-10.9,0.2),(side*68.58,-10.9,8.75),(side*68.58,10.9,8.75),(side*68.58,10.9,0.2)]): p.co=(*co,1)
    ob=bpy.data.objects.new('goal_frame_volt_outer_'+('l' if side<0 else 'r'),curve); bpy.context.collection.objects.link(ob); ob.data.materials.append(frame)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active=ob; bpy.ops.object.convert(target='MESH')

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
            for label,depth,mat in (('bezel',0.21,foot_trim),('light',0.065,frame)):
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
        ob=bpy.data.objects.new('volt_pedestal_accent_'+str(side),curve); bpy.context.collection.objects.link(ob); ob.data.materials.append(frame)
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active=ob; bpy.ops.object.convert(target='MESH')
target=os.path.join(ROOT,'assets','tables','circuit','fuzeball_table_circuit_obsidian.glb')
bpy.ops.export_scene.gltf(filepath=target,export_format='GLB',export_yup=True,export_apply=True)
print('Wrote',target)
