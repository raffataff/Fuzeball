"""Build Pro League's wrapped grips on the stock rod geometry."""
import bpy, math, os
from mathutils import Vector

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(ROOT,'assets','rods','pro_league'); os.makedirs(OUT,exist_ok=True)
TAU=math.tau

def material(name,color,metal,rough):
 m=bpy.data.materials.new(name); m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1); p.inputs['Metallic'].default_value=metal; p.inputs['Roughness'].default_value=rough
 return m

def wrap_material():
 # A seamless woven tape texture with diagonal overlap, shared by grip and collar.
 size=512; pixels=[]; normals=[]
 for y in range(size):
  v=y/size
  for x in range(size):
   u=x/size; phase=(6*v-u)%1; edge=min(phase,1-phase)
   seam=math.exp(-((edge/.024)**2)); weave=.5+.5*math.sin(TAU*64*u)*math.sin(TAU*96*v)
   grain=.5+.5*math.sin(TAU*(17*u+23*v))*math.sin(TAU*(29*u-11*v))
   c=max(.012,.075+.035*weave+.012*grain-.050*seam)
   pixels.extend((c,c,c,1))
   dx=.25*math.cos(TAU*64*u)*math.sin(TAU*96*v)
   dy=.25*math.sin(TAU*64*u)*math.cos(TAU*96*v)
   normals.extend((.5+dx,.5+dy,1,1))
 im=bpy.data.images.new('Matchday woven wrap',width=size,height=size,alpha=True); im.pixels.foreach_set(pixels); im.pack()
 normal=bpy.data.images.new('Matchday woven normal',width=size,height=size,alpha=True);normal.colorspace_settings.name='Non-Color';normal.pixels.foreach_set(normals);normal.pack()
 m=material('Pro League | charcoal woven tape',(.07,.07,.07),.14,.88)
 n=m.node_tree.nodes.new('ShaderNodeTexImage'); n.image=im
 m.node_tree.links.new(n.outputs['Color'],m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
 n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=normal
 bump=m.node_tree.nodes.new('ShaderNodeNormalMap');bump.inputs['Strength'].default_value=1.5
 m.node_tree.links.new(n.outputs['Color'],bump.inputs['Color']);m.node_tree.links.new(bump.outputs['Normal'],m.node_tree.nodes.get('Principled BSDF').inputs['Normal'])
 return m

def mesh_wrap(name,a,b,profile,mat,turns=6):
 sides=80; steps=144 if turns==6 else 64; verts=[]; faces=[]
 for k in range(steps+1):
  t=k/steps
  for j in range(sides):
   u=j/sides; ang=TAU*u; phase=(turns*t-u)%1; edge=min(phase,1-phase)
   seam=.052*math.exp(-((edge/.042)**2)); lip=.021*math.exp(-(((phase-.075)/.045)**2)); r=profile(t)-seam+lip
   verts.append((r*math.cos(ang),a+(b-a)*t,r*math.sin(ang)))
 for k in range(steps):
  for j in range(sides): faces.append((k*sides+j,(k+1)*sides+j,(k+1)*sides+(j+1)%sides,k*sides+(j+1)%sides))
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update(); o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);mesh.materials.append(mat)
 uv=mesh.uv_layers.new(name='WrapUV')
 for poly in mesh.polygons:
  k=poly.index//sides;j=poly.index%sides
  for li,coord in zip(poly.loop_indices,[(j/sides,k/steps*turns/6),(j/sides,(k+1)/steps*turns/6),((j+1)/sides,(k+1)/steps*turns/6),((j+1)/sides,k/steps*turns/6)]): uv.data[li].uv=coord
  poly.use_smooth=True
 return o

def cylinder(name,a,b,r,mat,bevel=.06):
 bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=r,depth=b-a,location=(0,(a+b)/2,0),rotation=(math.pi/2,0,0));o=bpy.context.object;o.name=name;o.data.materials.append(mat)
 for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
 mod=o.modifiers.new('Soft machined edge','BEVEL');mod.width=bevel;mod.segments=3
 o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
 return o

def bounds(o):
 p=[o.matrix_world@Vector(v) for v in o.bound_box];return min(v.y for v in p),max(v.y for v in p)

def brushed_steel():
 m=material('Pro League | brushed steel',(.60,.62,.64),1.0,.32)
 size=512;pixels=[]
 for y in range(size):
  v=y/size; c=.52+.045*math.sin(TAU*103*v)+.025*math.sin(TAU*173*v)+.012*math.sin(TAU*227*v)
  for x in range(size):pixels.extend((c,c*1.015,c*1.03,1))
 im=bpy.data.images.new('Matchday brushed steel',width=size,height=size,alpha=True);im.pixels.foreach_set(pixels);im.pack()
 node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=im
 m.node_tree.links.new(node.outputs['Color'],m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
 return m

for count in (1,2,3,5):
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'assets','rods',f'fuzeball_rod_{count}man.glb'))
 parts={key:next(o for o in bpy.context.scene.objects if o.type=='MESH' and key in o.name.lower()) for key in ('handle','knob','collar')}
 h0,h1=bounds(parts['handle']); k0,k1=bounds(parts['knob']); c0,c1=bounds(parts['collar'])
 for o in parts.values():bpy.data.objects.remove(o,do_unlink=True)
 steel=brushed_steel()
 black=material('Pro League | black edging',(.017,.019,.021),.12,.45)
 team=material('team_glow',(1,1,1),.18,.35)
 wrap=wrap_material()
 # Keep the original overall extent; the cap is shallow and the tape carries to the steel neck.
 grip0=k0+.70; grip1=h1-.65
 def profile(t):return 1.30+.04*t+.23*math.exp(-((t-.98)/.14)**2)-.10*math.exp(-((t-.76)/.14)**2)
 mesh_wrap(f'rod{count}_handle_wrapped_grip',grip0,grip1,profile,wrap)
 cylinder(f'rod{count}_handle_neck_shadow',grip1-.03,grip1+.07,1.54,black,.02)
 cylinder(f'rod{count}_handle_neck',grip1+.045,h1+.03,1.55,steel,.14)
 cylinder(f'rod{count}_handle_cap_bezel',grip0-.20,grip0+.03,1.32,steel,.045)
 cylinder(f'rod{count}_handle_cap_edge',k0+.03,grip0-.17,1.31,team,.13)
 # Compact opposite-end collar echoes the same tape and metal treatment.
 mesh_wrap(f'rod{count}_collar_wrapped',c0+.22,c1-.22,lambda t:1.04+.025*math.sin(math.pi*t),wrap,turns=2)
 cylinder(f'rod{count}_collar_inner_bezel',c0,c0+.26,1.10,steel,.045)
 cylinder(f'rod{count}_collar_outer_bezel',c1-.26,c1,1.10,steel,.045)
 cylinder(f'rod{count}_collar_end',c1-.02,c1+.07,.91,black,.035)
 bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,f'fuzeball_rod_{count}man.glb'),export_format='GLB',export_yup=True,export_apply=True)
 print('BUILT pro league rod',count)
