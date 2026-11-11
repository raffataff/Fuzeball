"""Build Strike racing grips and collars, retaining the original rod bars."""
import bpy, math, os, tempfile
import numpy as np
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(ROOT,'assets','rods','strike');os.makedirs(OUT,exist_ok=True)
tempfile.tempdir=os.path.join(ROOT,'tools','build','strike-rods-temp');os.makedirs(tempfile.tempdir,exist_ok=True)
ART=os.path.join(ROOT,'assets','tables','classic','strike_legs');TAU=math.tau

def mat(name,color,metal,rough):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough;return m

def decal():
 m=mat('Strike | distressed carbon racing livery',(1,1,1),.45,.42);nodes=m.node_tree.nodes;links=m.node_tree.links;p=nodes.get('Principled BSDF')
 for file,slot in [('strike_leg_basecolor.png','Base Color'),('strike_leg_normal.png','Normal'),('strike_leg_roughness.png','Roughness'),('strike_leg_metallic.png','Metallic')]:
  image=bpy.data.images.load(os.path.join(ART,file),check_existing=True)
  if slot!='Base Color':image.colorspace_settings.name='Non-Color'
  image.pack();tex=nodes.new('ShaderNodeTexImage');tex.image=image;tex.extension='REPEAT'
  if slot=='Normal':
   nm=nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.6;links.new(tex.outputs['Color'],nm.inputs['Color']);links.new(nm.outputs['Normal'],p.inputs['Normal'])
  else:links.new(tex.outputs['Color'],p.inputs[slot])
 return m

def rubber_material():
 # Fine moulded rubber grain: base and relief use the same surface pattern.
 n=512; rng=np.random.default_rng(42); y,x=np.mgrid[0:n,0:n]
 grain=rng.normal(0,.004,(n,n))+.003*np.sin(x*2*math.pi/8)*np.sin(y*2*math.pi/8)
 base=np.clip(.035+grain,.015,.06);dy,dx=np.gradient(base);normal=np.stack((-dx*3,-dy*3,np.ones_like(base)),axis=2);normal/=np.linalg.norm(normal,axis=2,keepdims=True)
 m=mat('Strike | textured ribbed rubber',(1,1,1),.05,.76);nodes=m.node_tree.nodes;links=m.node_tree.links;p=nodes.get('Principled BSDF')
 for name,data in [('Strike rubber colour',np.repeat(base[:,:,None],3,axis=2)),('Strike rubber normal',normal*.5+.5)]:
  rgba=np.ones((n,n,4),dtype=np.float32);rgba[:,:,:3]=data;im=bpy.data.images.new(name,width=n,height=n,alpha=True)
  if name.endswith('normal'):im.colorspace_settings.name='Non-Color'
  im.pixels.foreach_set(rgba.ravel());im.pack();tex=nodes.new('ShaderNodeTexImage');tex.image=im
  if name.endswith('normal'):
   nm=nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.7;links.new(tex.outputs['Color'],nm.inputs['Color']);links.new(nm.outputs['Normal'],p.inputs['Normal'])
  else:links.new(tex.outputs['Color'],p.inputs['Base Color'])
 return m

def bounds(o):
 p=[o.matrix_world@Vector(v) for v in o.bound_box];return min(v.y for v in p),max(v.y for v in p)

def grip_profile(t):return 1.28+.17*math.exp(-((t-.08)/.18)**2)+.19*math.exp(-((t-.94)/.17)**2)-.09*math.exp(-((t-.60)/.24)**2)

def lathe(name,a,b,profile,material,steps=120,sides=96,ribs=False,uv_height=1):
 vs=[];faces=[]
 for k in range(steps+1):
  t=k/steps
  for j in range(sides):
   u=j/sides;angle=TAU*u;r=profile(t)
   if ribs:
    env=max(0,min(1,t/.08,(1-t)/.08))
    # Make room for the inlaid team panel: ribs fade under its bezel.
    distance=min(abs((angle-math.pi/2+math.pi)%TAU-math.pi),abs((angle-3*math.pi/2+math.pi)%TAU-math.pi))
    relief=max(0,min(1,(distance-.21)/.10))
    r+=env*relief*.08*(.5+.5*math.cos(TAU*(19*t-1.8*u)))**6
   vs.append((r*math.cos(angle),a+(b-a)*t,r*math.sin(angle)))
 for k in range(steps):
  for j in range(sides):faces.append((k*sides+j,(k+1)*sides+j,(k+1)*sides+(j+1)%sides,k*sides+(j+1)%sides))
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(vs,[],faces);mesh.update();o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);mesh.materials.append(material);uv=mesh.uv_layers.new(name='Racing livery')
 for p in mesh.polygons:
  k=p.index//sides;j=p.index%sides
  for li,co in zip(p.loop_indices,[(j/sides,(.4 if uv_height<1 else 0)+uv_height*k/steps),(j/sides,(.4 if uv_height<1 else 0)+uv_height*(k+1)/steps),((j+1)/sides,(.4 if uv_height<1 else 0)+uv_height*(k+1)/steps),((j+1)/sides,(.4 if uv_height<1 else 0)+uv_height*k/steps)]):uv.data[li].uv=co
  p.use_smooth=True
 return o

def ring(name,a,b,r,material,bevel=.05):
 bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=r,depth=b-a,location=(0,(a+b)/2,0),rotation=(math.pi/2,0,0));o=bpy.context.object;o.name=name;o.data.materials.append(material)
 for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
 mod=o.modifiers.new('Rounded edge','BEVEL');mod.width=bevel;mod.segments=3;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');return o

def insert(name,a,b,angle,material,outer=False):
 # Curved, tapered applique follows the grip, repeated on opposite faces.
 verts=[];faces=[];steps=32;cross=12
 for k in range(steps+1):
  q=k/steps;t=.28+.43*q
  # Rounded taper blends each end into the ribbed sleeve.
  fade=max(0,min(1,q/.16,(1-q)/.16));fade=fade*fade*(3-2*fade)
  width=(.215 if outer else .160)*fade
  for j in range(cross+1):
   ang=angle+width*(2*j/cross-1);r=grip_profile(t)+(.019 if outer else .023)
   verts.append((r*math.cos(ang),a+(b-a)*t,r*math.sin(ang)))
 for k in range(steps):
  for j in range(cross):i=k*(cross+1)+j;faces.append((i,i+cross+1,i+cross+2,i+1))
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);mesh.materials.append(material)
 for p in mesh.polygons:p.use_smooth=True
for count in (1,2,3,5):
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'assets','rods',f'fuzeball_rod_{count}man.glb'))
 parts={key:next(o for o in bpy.context.scene.objects if o.type=='MESH' and key in o.name.lower()) for key in ('handle','knob','collar')}
 h0,h1=bounds(parts['handle']);k0,k1=bounds(parts['knob']);c0,c1=bounds(parts['collar'])
 for o in parts.values():bpy.data.objects.remove(o,do_unlink=True)
 art=decal();rubber=rubber_material();edge=mat('Strike | dark machined bezels',(.03,.033,.038),.7,.35);team=mat('team_glow',(1,1,1),.12,.38)
 a=k0+.40;b=h1-.36
 lathe(f'rod{count}_handle_livery',a,b,grip_profile,art)
 # Ribbed rubber sleeve occupies the centre, leaving livery visible at both ends.
 start=.25;end=.74
 lathe(f'rod{count}_handle_ribbed_grip',a+(b-a)*start,a+(b-a)*end,lambda t:grip_profile(start+(end-start)*t)+.012,rubber,steps=160,ribs=True)
 for i,angle in enumerate((math.pi/2,3*math.pi/2)):
  insert(f'rod{count}_handle_insert_bezel_{i}',a,b,angle,edge,True);insert(f'rod{count}_handle_team_inset_{i}',a,b,angle,team)
 ring(f'rod{count}_handle_end_cap',k0+.02,a+.02,1.39,edge,.10)
 ring(f'rod{count}_handle_neck',b-.02,h1+.02,1.48,edge,.10)
 # Far-end collar repeats the livery and uses a separate white team ring.
 lathe(f'rod{count}_collar_livery',c0+.15,c1-.42,lambda t:1.055+.025*math.sin(math.pi*t),art,steps=40,uv_height=.18)
 ring(f'rod{count}_collar_inner',c0,c0+.18,1.12,edge,.045)
 ring(f'rod{count}_collar_team_ring',c1-.42,c1-.18,1.12,team,.035)
 ring(f'rod{count}_collar_outer',c1-.18,c1+.02,1.12,edge,.055)
 bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,f'fuzeball_rod_{count}man.glb'),export_format='GLB',export_apply=True)
 print('BUILT STRIKE ROD',count,flush=True)

