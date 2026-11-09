"""Build the arena Comet grip and separate stationary wall collar in Blender."""
import bpy, math, os
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(ROOT,'assets','rods','arena_comet'); os.makedirs(OUT,exist_ok=True)

def mat(name,c,metal=0,rough=.35):
 m=bpy.data.materials.new(name); m.diffuse_color=(*c,1); m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*c,1); p.inputs['Metallic'].default_value=metal; p.inputs['Roughness'].default_value=rough
 return m
def cyl(name,y,r,depth,m):
 bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=r,depth=depth,location=(0,y,0),rotation=(math.pi/2,0,0)); o=bpy.context.object; o.name=name; o.data.materials.append(m)
 for p in o.data.polygons: p.use_smooth=len(p.vertices)==4
 mod=o.modifiers.new('Soft edges','BEVEL'); mod.width=.065; mod.segments=3
 o.modifiers.new('Normals','WEIGHTED_NORMAL'); return o
def torus(name,y,r,minor,m):
 bpy.ops.mesh.primitive_torus_add(major_segments=64,minor_segments=10,location=(0,y,0),rotation=(math.pi/2,0,0),major_radius=r,minor_radius=minor)
 o=bpy.context.object; o.name=name; o.data.materials.append(m)
 for p in o.data.polygons:p.use_smooth=True
 return o
def grip(name,a,b,m):
 verts=[]; faces=[]; N=96; K=32
 for k in range(K+1):
  t=k/K; radius=1.04+.39*math.sin(math.pi*t)**.6
  for j in range(N):
   ang=2*math.pi*j/N; flute=.10*(.5+.5*math.cos(8*ang))*math.sin(math.pi*t)**1.3
   r=radius-flute; verts.append((r*math.cos(ang),a+(b-a)*t,r*math.sin(ang)))
 for k in range(K):
  for j in range(N):faces.append((k*N+j,k*N+(j+1)%N,(k+1)*N+(j+1)%N,(k+1)*N+j))
 faces.extend([tuple(reversed(range(N))),tuple(K*N+j for j in range(N))])
 mesh=bpy.data.meshes.new(name); mesh.from_pydata(verts,[],faces); mesh.update(); ob=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(ob); mesh.materials.append(m)
 for p in mesh.polygons:p.use_smooth=len(p.vertices)==4
 return ob
def bounds(o):
 pts=[o.matrix_world@Vector(p) for p in o.bound_box]; return min(p.y for p in pts),max(p.y for p in pts)
for count in (1,2,3,5):
 bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
 bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'assets','tables','classic','rods',f'fuzeball_rod_{count}man.glb'))
 old=next(o for o in bpy.context.scene.objects if o.type=='MESH' and 'handle' in o.name.lower())
 a,b=bounds(old); bpy.data.objects.remove(old,do_unlink=True)
 dark=mat('Comet graphite',(.025,.03,.04),.18,.4); gold=mat('Comet satin brass',(.56,.32,.09),.78,.3); team=mat('team_comet',(.8,.03,.04),.25,.3)
 grip(f'rod{count}_handle_comet_grip',a,b,dark)
 # Sleeve covers one end of the original grip; material name drives game tinting.
 cyl(f'rod{count}_handle_team_sleeve',b-.50,1.18,.8,team)
 for y in (b-.94,b-.06):torus(f'rod{count}_handle_brass_rim',y,1.17,.045,gold)
 cyl(f'rod{count}_handle_endcap',a+.06,1.10,.13,gold)
 torus(f'rod{count}_handle_cap_rim',a+.14,1.06,.045,gold)
 # Replace the original team-coloured knob with neutral brass where present.
 for ob in list(bpy.context.scene.objects):
  if ob.type=='MESH' and 'knob' in ob.name.lower():
   for i in range(len(ob.data.materials)):ob.data.materials[i]=gold
 out=os.path.join(OUT,f'fuzeball_rod_{count}man.glb')
 bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',export_yup=True,export_apply=True)
 if count==1:bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'comet_rod_editable.blend'))

# A separate stationary collar: annular parts with an open rod bore, not parented
# to a sliding rod. This is supplied separately for table-side integration.
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
gold=mat('Collar satin brass',(.56,.32,.09),.78,.3); team=mat('team_collar',(.8,.03,.04),.25,.3)
torus('collar_outer_bezel',0,1.08,.20,gold); torus('collar_team_insert',-.05,.78,.16,team)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'comet_wall_collar.glb'),export_format='GLB',export_yup=True,export_apply=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'comet_wall_collar.blend'))
