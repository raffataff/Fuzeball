"""Silver Circuit rod set: graphite grip, satin aluminum bezels and end collar."""
import bpy, math, os
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(ROOT,'assets','rods','silver_circuit'); os.makedirs(OUT,exist_ok=True)
def mat(name,c,metal,rough):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough;return m
def bounds(o):
 pts=[o.matrix_world@Vector(p) for p in o.bound_box];return min(p.y for p in pts),max(p.y for p in pts)
def cyl(name,y,r,depth,m):
 bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=r,depth=depth,location=(0,y,0),rotation=(math.pi/2,0,0));o=bpy.context.object;o.name=name;o.data.materials.append(m)
 for f in o.data.polygons:f.use_smooth=len(f.vertices)==4
 bevel=o.modifiers.new('Rounded edges','BEVEL');bevel.width=.045;bevel.segments=3;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');return o
def ring(name,y,r,minor,m):
 bpy.ops.mesh.primitive_torus_add(major_segments=48,minor_segments=8,location=(0,y,0),rotation=(math.pi/2,0,0),major_radius=r,minor_radius=minor);o=bpy.context.object;o.name=name;o.data.materials.append(m)
 for f in o.data.polygons:f.use_smooth=True
def grip(name,a,b,m):
 N=64;K=24;v=[];faces=[]
 for k in range(K+1):
  t=k/K; radius=1.08+.34*math.sin(math.pi*t)**.65
  for j in range(N):
   ang=2*math.pi*j/N;r=radius-.045*(.5+.5*math.cos(10*ang))*math.sin(math.pi*t)**1.3;v.append((r*math.cos(ang),a+(b-a)*t,r*math.sin(ang)))
 for k in range(K):
  for j in range(N):faces.append((k*N+j,k*N+(j+1)%N,(k+1)*N+(j+1)%N,(k+1)*N+j))
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(v,[],faces);mesh.update();o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);mesh.materials.append(m)
 for f in mesh.polygons:f.use_smooth=True
def circuit_trace(name,a,b,angle,material,offset):
 # Three fine, stepped paths echo the cabinet engraving, following the grip.
 curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.bevel_depth=.018;curve.bevel_resolution=3
 spline=curve.splines.new('POLY'); points=[(.20,-.12),(.30,-.12),(.40,.10),(.70,.10),(.80,-.12)]
 spline.points.add(len(points)-1)
 for p,(t,turn) in zip(spline.points,points):
  t+=offset;theta=angle+turn;r=1.08+.34*math.sin(math.pi*t)**.65-.045*(.5+.5*math.cos(10*theta))*math.sin(math.pi*t)**1.3+.012
  p.co=(r*math.cos(theta),a+(b-a)*t,r*math.sin(theta),1)
 ob=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(ob);ob.data.materials.append(material)
 bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob;bpy.ops.object.convert(target='MESH')
def collar_trace(name,c0,c1,angle,material,radius=1.142):
 curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.bevel_depth=.016;curve.bevel_resolution=2
 spline=curve.splines.new('POLY');points=[(.27,-.15),(.38,-.15),(.47,.10),(.65,.10),(.73,-.08)];spline.points.add(len(points)-1)
 for p,(t,turn) in zip(spline.points,points):
  theta=angle+turn;p.co=(radius*math.cos(theta),c0+(c1-c0)*t,radius*math.sin(theta),1)
 ob=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(ob);ob.data.materials.append(material)
 bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob;bpy.ops.object.convert(target='MESH')
for count in (1,2,3,5):
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'assets','tables','classic','rods',f'fuzeball_rod_{count}man.glb'))
 old=next(o for o in bpy.context.scene.objects if o.type=='MESH' and 'handle' in o.name.lower());a,b=bounds(old);bpy.data.objects.remove(old,do_unlink=True)
 silver=mat('Silver Circuit | satin aluminum',(.52,.57,.60),.9,.31);dark=mat('Silver Circuit | graphite grip',(.025,.045,.065),.22,.42);inlay=mat('Silver Circuit | pale circuit inlay',(.45,.55,.60),.68,.32)
 grip(f'rod{count}_handle_silver_grip',a,b,dark)
 for side in range(4):
  for line in range(3):circuit_trace(f'rod{count}_handle_circuit_{side}_{line}',a,b,side*math.pi/2+line*.09,inlay,0)
 for i,t in enumerate((.055,.945)):
  y=a+(b-a)*t;cyl(f'rod{count}_handle_silver_bezel_{i}',y,1.20,.22,silver);ring(f'rod{count}_handle_inlay_{i}',y,1.20,.025,inlay)
 # Leave the stock team-coloured end knob and opposite end collar visible.
 knob=next(o for o in bpy.context.scene.objects if o.type=='MESH' and 'knob' in o.name.lower());tip,knob_end=bounds(knob)
 # A slim graphite sleeve and satin bezels break up the oversized plastic cap,
 # retaining the original team-coloured material as two clear accent bands.
 span=knob_end-tip
 cyl(f'rod{count}_handle_cap_graphite_sleeve',tip+span*.52,1.70,span*.38,dark)
 for i,t in enumerate((.28,.32,.72,.76)):
  ring(f'rod{count}_handle_cap_silver_trim_{i}',tip+span*t,1.69,.035 if i in (1,2) else .025,silver)
 for i in range(4):
  theta=i*math.pi/2
  collar_trace(f'rod{count}_handle_cap_circuit_{i}',tip,knob_end,theta,inlay, radius=1.715)
 cyl(f'rod{count}_handle_silver_endcap',tip-.03,1.22,.08,silver)
 for i,r in enumerate((.48,.86,1.08)):ring(f'rod{count}_handle_endcap_etch_{i}',tip-.075,r,.018,dark)
 collar=next(o for o in bpy.context.scene.objects if o.type=='MESH' and 'collar' in o.name.lower());c0,c1=bounds(collar)
 # Graphite instrument sleeve, leaving the team-colour bands at either end.
 cyl(f'rod{count}_collar_graphite_sleeve',(c0+c1)*.5,1.125,(c1-c0)*.54,dark)
 for side in range(4):
  for line in range(3):collar_trace(f'rod{count}_collar_circuit_{side}_{line}',c0,c1,side*math.pi/2+line*.11,inlay)
 for i,t in enumerate((.12,.88)):ring(f'rod{count}_collar_silver_bezel_{i}',c0+(c1-c0)*t,1.10,.055,silver)
 cyl(f'rod{count}_collar_silver_face',c1+.03,1.02,.07,silver)
 for i,r in enumerate((.48,.78)):ring(f'rod{count}_collar_etch_{i}',c1+.07,r,.018,dark)
 out=os.path.join(OUT,f'fuzeball_rod_{count}man.glb');bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',export_yup=True,export_apply=True);print('Wrote',out)
