"""Create Strike leg artwork and PBR maps, then apply them to its existing legs."""
import bpy, os, tempfile
import numpy as np
from mathutils import Vector
root=os.getcwd();tempfile.tempdir=os.path.join(root,'tools','build','strike-leg-temp');os.makedirs(tempfile.tempdir,exist_ok=True)
out=os.path.join(root,'assets','tables','classic','strike_legs');os.makedirs(out,exist_ok=True)
# Image-generated Strike livery is the source for colour and all PBR maps.
n=1024
art=bpy.data.images.load(os.path.join(out,'strike_leg_art_v2.png'),check_existing=False)
art.scale(n,n)
pixels=np.empty(n*n*4,dtype=np.float32);art.pixels.foreach_get(pixels)
base=pixels.reshape((n,n,4))[:,:,:3].copy()
lum=base[:,:,0]*.2126+base[:,:,1]*.7152+base[:,:,2]*.0722
height=(lum-lum.mean())*.25;dy,dx=np.gradient(height);normal=np.stack((-dx*2,-dy*2,np.ones_like(dx)),axis=2);normal/=np.linalg.norm(normal,axis=2,keepdims=True)
rough=np.clip(.48-(lum-lum.mean())*.6,.33,.58);metal=np.clip(.60+(lum-lum.mean())*.4,.48,.72)
def img(name,data,noncolor=False):
 a=np.ones((n,n,4),dtype=np.float32);a[:,:,:3]=data
 im=bpy.data.images.new(name,width=n,height=n,alpha=True);im.pixels.foreach_set(a.ravel());im.filepath_raw=os.path.join(out,name+'.png');im.file_format='PNG';im.save()
 if noncolor:im.colorspace_settings.name='Non-Color'
 im.pack();return im
maps=[img('strike_leg_basecolor',base),img('strike_leg_roughness',np.repeat(rough[:,:,None],3,2),True),img('strike_leg_metallic',np.repeat(metal[:,:,None],3,2),True),img('strike_leg_normal',normal*.5+.5,True)]
m=bpy.data.materials.new('Strike | graphite carbon and racing red');m.use_nodes=True;nodes=m.node_tree.nodes;links=m.node_tree.links;p=nodes.get('Principled BSDF')
for im,slot in zip(maps,('Base Color','Roughness','Metallic','Normal')):
 tex=nodes.new('ShaderNodeTexImage');tex.image=im;tex.extension='REPEAT'
 if slot=='Normal':
  nm=nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.7;links.new(tex.outputs['Color'],nm.inputs['Color']);links.new(nm.outputs['Normal'],p.inputs[slot])
 else:links.new(tex.outputs['Color'],p.inputs[slot])
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=os.path.join(root,'output','leg-preview-strike.glb'))
legs=[]
for o in list(bpy.context.scene.objects):
 if o.type=='MESH' and o.name.startswith('table_leg'):
  legs.append(o);o.data.materials.clear();o.data.materials.append(m)
  world=[o.matrix_world@v.co for v in o.data.vertices];cx=sum(p.x for p in world)/len(world);cy=sum(p.y for p in world)/len(world)
  # The geometry is symmetrical; use the midpoint of bounds, not the vertex mean.
  cx=(min(p.x for p in world)+max(p.x for p in world))/2;cy=(min(p.y for p in world)+max(p.y for p in world))/2
  uv=o.data.uv_layers.active or o.data.uv_layers.new(name='Strike panels')
  for face in o.data.polygons:
   normal=(o.matrix_world.to_3x3()@face.normal).normalized()
   for li in face.loop_indices:
    p=o.matrix_world@o.data.vertices[o.data.loops[li].vertex_index].co
    uv.data[li].uv=(.5+((p.x-cx)/8.8 if abs(normal.y)>.5 else (p.y-cy)/8.8),(p.z+43.978)/35.241)
 else:bpy.data.objects.remove(o,do_unlink=True)
assert len(legs)==4
bpy.ops.export_scene.gltf(filepath=os.path.join(root,'output','strike-new-legs.glb'),export_format='GLB',export_apply=True)
