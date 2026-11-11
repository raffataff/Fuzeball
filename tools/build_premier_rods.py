"""Build Premier Championship rods from the stock rod meshes.

Run Blender --background --factory-startup --python tools/build_premier_rods.py.
The bar and player mounting meshes remain from the stock rods. The white
team_glow rings are the only team-tinted surfaces, on both ends of each rod.
"""
import bpy, math, os
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(ROOT,'assets','rods','premier_championship');os.makedirs(OUT,exist_ok=True)
TAU=math.tau

def mat(name,color,metal,rough):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF')
 p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
 return m

def walnut():
 m=mat('Championship | walnut',(.3,.13,.06),0,.42)
 im=bpy.data.images.load(os.path.join(ROOT,'assets','tables','classic','championship','walnut-basecolor.png'),check_existing=True);im.pack()
 node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=im
 m.node_tree.links.new(node.outputs['Color'],m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
 return m

def bounds(o):
 p=[o.matrix_world@Vector(v) for v in o.bound_box];return min(v.y for v in p),max(v.y for v in p)

def lathe(name,a,b,profile,material,steps=128,sides=48):
 verts=[];faces=[]
 for k in range(steps+1):
  t=k/steps;r=profile(t)
  for j in range(sides):
   ang=TAU*j/sides;verts.append((r*math.cos(ang),a+(b-a)*t,r*math.sin(ang)))
 for k in range(steps):
  for j in range(sides):faces.append((k*sides+j,(k+1)*sides+j,(k+1)*sides+(j+1)%sides,k*sides+(j+1)%sides))
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);mesh.materials.append(material)
 uv=mesh.uv_layers.new(name='Wood along grip')
 for p in mesh.polygons:
  k=p.index//sides;j=p.index%sides
  for li,co in zip(p.loop_indices,[(k/steps,j/sides),((k+1)/steps,j/sides),((k+1)/steps,(j+1)/sides),(k/steps,(j+1)/sides)]):uv.data[li].uv=co
  p.use_smooth=True
 return o

def ring(name,a,b,r,material,bevel=.04):
 bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=r,depth=b-a,location=(0,(a+b)/2,0),rotation=(math.pi/2,0,0));o=bpy.context.object;o.name=name;o.data.materials.append(material)
 for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
 mod=o.modifiers.new('Soft machined edge','BEVEL');mod.width=bevel;mod.segments=3;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
 return o

for count in (1,2,3,5):
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'assets','rods',f'fuzeball_rod_{count}man.glb'))
 parts={key:next(o for o in bpy.context.scene.objects if o.type=='MESH' and key in o.name.lower()) for key in ('handle','knob','collar')}
 h0,h1=bounds(parts['handle']);k0,k1=bounds(parts['knob']);c0,c1=bounds(parts['collar'])
 for o in parts.values():bpy.data.objects.remove(o,do_unlink=True)
 wood=walnut();gold=mat('Championship | brushed gold',(.53,.32,.11),.72,.34)
 dark=mat('Championship | dark metal',(.025,.020,.018),.45,.4)
 team=mat('team_glow',(1,1,1),.12,.42)
 # The existing handle/knob bounds are retained; lathed wood has subtle
 # circumferential grip flutes rather than the concept's leather wrapping.
 a=k0+.60;b=h1-.68
 def grip(t):
  body=1.22+.18*math.exp(-((t-.12)/.22)**2)+.18*math.exp(-((t-.90)/.17)**2)-.08*math.exp(-((t-.58)/.22)**2)
  envelope=max(0,min(1,(t-.08)/.08,(.92-t)/.08))
  return body-.026*envelope*(.5+.5*math.cos(TAU*23*t))
 lathe(f'rod{count}_handle_walnut_grip',a,b,grip,wood)
 ring(f'rod{count}_handle_cap',k0+.02,a-.32,1.31,gold,.10)
 ring(f'rod{count}_handle_cap_dark',a-.34,a-.25,1.32,dark,.02)
 ring(f'rod{count}_handle_team_band',a-.25,a-.04,1.32,team,.025)
 ring(f'rod{count}_handle_cap_bezel',a-.06,a+.02,1.32,gold,.025)
 ring(f'rod{count}_handle_neck_bezel',b-.03,b+.08,1.39,gold,.025)
 ring(f'rod{count}_handle_team_neck',b+.07,b+.33,1.39,team,.025)
 ring(f'rod{count}_handle_neck',b+.32,h1+.02,1.39,gold,.08)
 # The opposing end collar mirrors the same materials and has a white
 # tintable ring; no wood or gold is accidentally team-tinted.
 lathe(f'rod{count}_collar_walnut',c0+.17,c1-.38,lambda t:1.04+.025*math.sin(math.pi*t),wood,steps=32)
 ring(f'rod{count}_collar_inner',c0,c0+.20,1.10,gold,.04)
 ring(f'rod{count}_collar_team_band',c1-.38,c1-.17,1.10,team,.025)
 ring(f'rod{count}_collar_outer',c1-.17,c1+.02,1.10,gold,.04)
 bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,f'fuzeball_rod_{count}man.glb'),export_format='GLB',export_yup=True,export_apply=True)
 print('BUILT PREMIER ROD',count,flush=True)
