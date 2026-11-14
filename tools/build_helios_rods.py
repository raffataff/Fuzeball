"""Build Helios Runners rod set from the classic rod hardware."""
import bpy, os, math
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(ROOT,'assets','rods','helios_runners'); MAP=os.path.join(OUT,'textures')
def solid(name,col,metal,rough):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*col,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough;return m
def gripmat():
 m=solid('Helios | printed technical rubber',(.8,.8,.8),0,.5);n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF')
 def tex(name,space):
  t=n.new('ShaderNodeTexImage');t.image=bpy.data.images.load(os.path.join(MAP,'grip_'+name+'.png'),check_existing=True);t.image.colorspace_settings.name=space;return t
 l.new(tex('basecolor','sRGB').outputs['Color'],p.inputs['Base Color']);l.new(tex('roughness','Non-Color').outputs['Color'],p.inputs['Roughness']);l.new(tex('metallic','Non-Color').outputs['Color'],p.inputs['Metallic'])
 norm=n.new('ShaderNodeNormalMap');norm.inputs['Strength'].default_value=.55;l.new(tex('normal','Non-Color').outputs['Color'],norm.inputs['Color']);l.new(norm.outputs['Normal'],p.inputs['Normal']);return m
def torus(name,y,r,minor,mat):
 bpy.ops.mesh.primitive_torus_add(major_segments=64,minor_segments=12,location=(0,y,0),rotation=(math.pi/2,0,0),major_radius=r,minor_radius=minor);o=bpy.context.object;o.name=name;o.data.materials.append(mat)
 for p in o.data.polygons:p.use_smooth=True
def cyl(name,y,r,depth,mat):
 bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=r,depth=depth,location=(0,y,0),rotation=(math.pi/2,0,0));o=bpy.context.object;o.name=name;o.data.materials.append(mat)
 for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
 mod=o.modifiers.new('Machined edges','BEVEL');mod.width=.045;mod.segments=3;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
def grip(name,a,b,mat):
 profile=[(0,1.05),(.035,1.13),(.12,1.25),(.3,1.36),(.5,1.40),(.7,1.36),(.88,1.25),(.965,1.13),(1,1.05)];N=96;verts=[];faces=[]
 for t,r in profile:
  for j in range(N):
   ang=2*math.pi*j/N;verts.append((r*math.cos(ang),a+(b-a)*t,r*math.sin(ang)))
 for k in range(len(profile)-1):
  for j in range(N):faces.append((k*N+j,(k+1)*N+j,(k+1)*N+(j+1)%N,k*N+(j+1)%N))
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);mesh.materials.append(mat);uv=mesh.uv_layers.new(name='HeliosWrap')
 for p in mesh.polygons:
  k,j=divmod(p.index,N);coords=[(profile[k][0],j/N),(profile[k+1][0],j/N),(profile[k+1][0],(j+1)/N),(profile[k][0],(j+1)/N)]
  for li,co in zip(p.loop_indices,coords):uv.data[li].uv=co
  p.use_smooth=True
for count in (1,2,3,5):
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'assets','rods',f'fuzeball_rod_{count}man.glb'))
 old=next(o for o in bpy.context.scene.objects if o.type=='MESH' and 'handle' in o.name.lower());pts=[old.matrix_world@Vector(p) for p in old.bound_box];a=min(p.y for p in pts);b=max(p.y for p in pts);bpy.data.objects.remove(old,do_unlink=True)
 dark=solid('Helios | satin black alloy',(.018,.017,.015),.7,.3);gold=solid('Helios | anodized gold',(.55,.25,.035),.8,.27);orange=solid('Helios | orange enamel',(.75,.11,.008),.25,.28);team=solid('team_helios',(.8,.03,.04),.2,.34)
 grip(f'rod{count}_handle_helios_grip',a,b,gripmat())
 cyl(f'rod{count}_handle_team_sleeve',b-.38,1.15,.58,team)
 for y in (b-.71,b-.05):torus(f'rod{count}_handle_gold_rim',y,1.13,.055,gold)
 cyl(f'rod{count}_handle_endcap',a+.06,1.10,.15,dark);torus(f'rod{count}_handle_end_bezel',a-.02,1.02,.055,gold);torus(f'rod{count}_handle_end_inlay',a-.025,.72,.035,orange)
 for ob in list(bpy.context.scene.objects):
  if ob.type=='MESH' and 'knob' in ob.name.lower():
   for i in range(len(ob.data.materials)):ob.data.materials[i]=gold
 bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,f'fuzeball_rod_{count}man.glb'),export_format='GLB',export_yup=True,export_apply=True,export_tangents=True)

