"""Build the Pro League's standalone tapered legs and matching PBR finish."""
import bpy, os, math, tempfile
import numpy as np
root=os.getcwd(); tempfile.tempdir=os.path.join(root,'tools','build','pro-leg-temp'); os.makedirs(tempfile.tempdir,exist_ok=True); out=os.path.join(root,'assets','tables','classic','pro_league');os.makedirs(out,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
# Subtle vertically brushed charcoal coating. Every map is derived from the same
# base image, so grooves and roughness variations follow the visible finish.
n=512; y,x=np.mgrid[0:n,0:n]; rng=np.random.default_rng(417)
line=rng.normal(0,1,n);line=(line+np.roll(line,1)+np.roll(line,-1))/3
pattern=np.tile(line,(n,1)); pattern=(pattern-pattern.mean())/(pattern.std()+1e-6)
pattern=np.clip(pattern,-2,2); # A recessed vertical centre panel, fine silver-grey borders, and a brushed
# graphite field make the support read as designed metal at game distance.
u=x/(n-1); v=y/(n-1)
panel=((u>.16)&(u<.84)&(v>.06)&(v<.94)).astype(float)
border=((((u>.16)&(u<.18))|((u>.82)&(u<.84)))&(v>.06)&(v<.94)).astype(float)
horizontal=((((v>.06)&(v<.066))|((v>.934)&(v<.94)))&(u>.16)&(u<.84)).astype(float)
color=np.clip(.075+.007*pattern+.002*np.sin(2*np.pi*y/n*3)+.026*panel+.075*border+.075*horizontal,.04,.22)
base=np.stack((color*.93,color*.98,color*1.04),axis=2)
# Height, roughness and metallic variation are calculated from base luminance.
lum=base[:,:,0]*.2126+base[:,:,1]*.7152+base[:,:,2]*.0722
height=(lum-lum.mean())*.30
dy,dx=np.gradient(height);norm=np.stack((-dx*3,-dy*3,np.ones_like(dx)),axis=2);norm/=np.linalg.norm(norm,axis=2,keepdims=True)
rough=np.clip(.40+(lum.mean()-lum)*1.4,.32,.5); metal=np.clip(.78+(lum-lum.mean())*.6,.72,.84)
def img(name,data,noncolor=False):
 a=np.ones((n,n,4),dtype=np.float32);a[:,:,:3]=data
 im=bpy.data.images.new(name,width=n,height=n,alpha=True);im.pixels.foreach_set(a.ravel());im.filepath_raw=os.path.join(out,name+'.png');im.file_format='PNG';im.save();
 if noncolor:im.colorspace_settings.name='Non-Color'
 im.pack();return im
maps=[img('leg_basecolor',base),img('leg_roughness',np.repeat(rough[:,:,None],3,axis=2),True),img('leg_metallic',np.repeat(metal[:,:,None],3,axis=2),True),img('leg_normal',norm*.5+.5,True)]
m=bpy.data.materials.new('Pro League | brushed graphite');m.use_nodes=True;nodes=m.node_tree.nodes;links=m.node_tree.links;p=nodes.get('Principled BSDF')
for im,slot in zip(maps,('Base Color','Roughness','Metallic','Normal')):
 tex=nodes.new('ShaderNodeTexImage');tex.image=im;tex.extension='REPEAT'
 if slot=='Normal':
  nm=nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.65;links.new(tex.outputs['Color'],nm.inputs['Color']);links.new(nm.outputs['Normal'],p.inputs[slot])
 else:links.new(tex.outputs['Color'],p.inputs[slot])
steel=bpy.data.materials.new('Pro League | satin silver foot trim');steel.use_nodes=True;sp=steel.node_tree.nodes.get('Principled BSDF');sp.inputs['Base Color'].default_value=(.38,.40,.42,1);sp.inputs['Metallic'].default_value=.8;sp.inputs['Roughness'].default_value=.34
rubber=bpy.data.materials.new('Pro League | dark foot');rubber.diffuse_color=(.012,.014,.016,1);rubber.use_nodes=True;rp=rubber.node_tree.nodes.get('Principled BSDF');rp.inputs['Base Color'].default_value=(.012,.014,.016,1);rp.inputs['Roughness'].default_value=.75
def leg(cx,cy):
 vs=[]
 for z,w in ((-43.4,7.2),(-8.74,8.8)):
  for dx,dy in ((-1,-1),(1,-1),(1,1),(-1,1)):vs.append((cx+dx*w/2,cy+dy*w/2,z))
 faces=[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
 mesh=bpy.data.meshes.new('tapered support');mesh.from_pydata(vs,[],faces);mesh.update();o=bpy.data.objects.new('table_leg_pro',mesh);bpy.context.collection.objects.link(o);mesh.materials.append(m)
 uv=mesh.uv_layers.new(name='Vertical brushed finish')
 for face in mesh.polygons:
  for li in face.loop_indices:
   v=mesh.vertices[mesh.loops[li].vertex_index].co
   uv.data[li].uv=(.5+((v.x-cx)/8 if abs(face.normal.y)>.5 else (v.y-cy)/8),(v.z+44)/36)
 bevel=o.modifiers.new('Soft machined edges','BEVEL');bevel.width=.24;bevel.segments=3;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
def box(name,loc,dims,material,bevel):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=dims;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(material)
 mod=o.modifiers.new('Rounded edges','BEVEL');mod.width=bevel;mod.segments=3;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
for cx in (-58,58):
 for cy in (-32,32):
  leg(cx,cy);box('pro_leg_silver_toe',(cx,cy,-43.45),(7.25,7.25,.34),steel,.1);box('pro_leg_rubber_foot',(cx,cy,-43.78),(7.15,7.15,.35),rubber,.09)
# Delicate metal lines on the inner faces, clear of rod openings and goals.
# These are set flush against the faces, with no change to the playable walls.
for side in (-1,1):
 for h in (1.15,10.30):
  box('pro_inner_rail',(0,side*33.97,h),(116,.065,.12),steel,.035)
 for end in (-1,1):
  for h in (1.15,10.30):
   box('pro_inner_rail',(end*59.97,side*22.5,h),(.065,22.0,.12),steel,.03)
bpy.ops.export_scene.gltf(filepath=os.path.join(root,'output','pro-league-new-legs.glb'),export_format='GLB',export_apply=True)

