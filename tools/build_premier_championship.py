"""Build the Championship Premier Division skin on the original Classic table.

First decode the shipped source without changing it:
  node tools/ktx2-decode.mjs assets/tables/classic/fuzeball_table_classic_premierLeague.glb output/premier-concepts/source-decoded.glb
Then run Blender --background --factory-startup --python tools/build_premier_championship.py.
The original playing surface, goal meshes, wall topology and rod-hole positions remain intact.
"""
import bpy, os, math, tempfile
import numpy as np
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC=os.path.join(ROOT,'output','premier-concepts','source-decoded.glb')
OUT=os.path.join(ROOT,'assets','tables','classic','fuzeball_table_classic_championship.glb')
tempfile.tempdir=os.path.join(ROOT,'tools','build','premier-temp')
os.makedirs(tempfile.tempdir,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=SRC)

def mat(name,color,metal=0,rough=.4,emission=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF')
 p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
 if emission: p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
 return m
black=mat('Championship | satin charcoal',(.025,.020,.018),.35,.31)
rail=mat('Championship | warm dark bronze',(.065,.042,.029),.62,.3)
gold=mat('Championship | satin gold',(.53,.32,.11),.72,.34)
edge=mat('Championship | deep gold',(.19,.09,.028),.7,.34)
red=mat('Championship | oxblood enamel',(.105,.012,.02),.32,.34)
inset=mat('Championship | textured inset',(.013,.016,.018),.3,.56)
light=mat('Championship | warm rail light',(.95,.38,.075),.15,.3,1.3)
ivory=mat('Championship | ivory ball',(.72,.65,.48),.2,.3)

def make_wood():
 # A long photographic-style veneer replaces synthetic periodic grain.
 # Derive the roughness and relief from that same image so all three maps
 # follow the actual grain, rather than superimposing an unrelated pattern.
 base=bpy.data.images.load(os.path.join(ROOT,'assets','tables','classic','championship','walnut-basecolor.png'),check_existing=True)
 base.pack();width,height=base.size
 pixels=np.empty(width*height*4,dtype=np.float32);base.pixels.foreach_get(pixels)
 rgb=pixels.reshape((height,width,4))[:,:,:3]
 lum=rgb[:,:,0]*.2126+rgb[:,:,1]*.7152+rgb[:,:,2]*.0722
 low,high=np.percentile(lum,[5,95]);figure=np.clip((lum-low)/max(high-low,.001),0,1)
 def image(name,rgb,noncolor=False):
  a=np.ones((height,width,4),dtype=np.float32);a[:,:,:3]=rgb
  im=bpy.data.images.new(name,width=width,height=height,alpha=True)
  if noncolor: im.colorspace_settings.name='Non-Color'
  im.pixels.foreach_set(a.ravel());im.pack();return im
 rough=np.repeat(np.clip(.48+.20*(1-figure),0,1)[:,:,None],3,axis=2)
 dy,dx=np.gradient(figure);dx*=.35;dy*=.35
 n=np.stack((-dx,-dy,np.ones_like(dx)),axis=2);n/=np.linalg.norm(n,axis=2,keepdims=True)
 normal=n*.5+.5
 maps=(base,image('Championship walnut roughness',rough,True),image('Championship walnut normal',normal,True))
 m=mat('Championship | figured walnut',(.18,.065,.018),0,.42)
 nodes=m.node_tree.nodes;links=m.node_tree.links;p=nodes.get('Principled BSDF')
 for im,slot in zip(maps,('Base Color','Roughness','Normal')):
  tex=nodes.new('ShaderNodeTexImage');tex.image=im;tex.interpolation='Linear';tex.extension='REPEAT'
  if slot=='Normal':
   node=nodes.new('ShaderNodeNormalMap');node.inputs['Strength'].default_value=.7
   links.new(tex.outputs['Color'],node.inputs['Color']);links.new(node.outputs['Normal'],p.inputs['Normal'])
  else: links.new(tex.outputs['Color'],p.inputs[slot])
 return m

wood=make_wood()
def wood_uv(o):
 # Horizontal grain on the sides and a matching lengthwise grain on the top.
 mesh=o.data; uv=mesh.uv_layers.active or mesh.uv_layers.new(name='Walnut grain')
 for poly in mesh.polygons:
  n=(o.matrix_world.to_3x3() @ poly.normal).normalized()
  for li in poly.loop_indices:
   p=o.matrix_world @ mesh.vertices[mesh.loops[li].vertex_index].co
   if o.name.startswith('table_leg'):
    uv.data[li].uv=((p.z+44)/126, .5+(p.x+p.y)/42)
   elif abs(n.z)>.65: uv.data[li].uv=((p.x+63)/126,.5+p.y/126)
   elif abs(n.x)>abs(n.y): uv.data[li].uv=((p.y+63)/126,.5+p.z/42)
   else: uv.data[li].uv=((p.x+63)/126,.5+p.z/42)

for o in list(bpy.context.scene.objects):
 if o.type!='MESH':continue
 if o.name.startswith('table_leg'):
  # Replace the original thin legs with the tapered version below.
  bpy.data.objects.remove(o,do_unlink=True)
  continue
 if o.name.startswith(('table_base','wall_side','wall_end')):
  o.data.materials.clear();o.data.materials.append(wood);wood_uv(o)
 # frames and hole collars keep their existing materials and names for game effects.

def box(name,loc,scale,material,bev=.10):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=scale
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(material)
 if bev:
  mod=o.modifiers.new('Soft machined edges','BEVEL');mod.width=bev;mod.segments=2
  o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
 return o

def panel(name,coords,y,thickness,material):
 # Closed solid on the outer vertical face; coordinates are (x,z).
 n=len(coords);vs=[(x,y-thickness/2,z) for x,z in coords]+[(x,y+thickness/2,z) for x,z in coords]
 faces=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(vs,[],faces);mesh.update();o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);o.data.materials.append(material)
 mod=o.modifiers.new('Fine edge','BEVEL');mod.width=.06;mod.segments=2;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');return o

def line(name,a,b,r,material):
 a,b=Vector(a),Vector(b);d=b-a;bpy.ops.mesh.primitive_cylinder_add(vertices=10,radius=r,depth=d.length,location=(a+b)/2);o=bpy.context.object;o.name=name;o.rotation_euler=d.to_track_quat('Z','Y').to_euler();o.data.materials.append(material);return o

def outline(name,coords,y,r,material):
 for i in range(len(coords)):
  a=coords[i];b=coords[(i+1)%len(coords)];line(name,(a[0],y,a[1]),(b[0],y,b[1]),r,material)

def leg(x,y):
 # Broad at the cabinet, gently tapering toward the foot. The ends stay at
 # the stock table's original heights and the wood stays inside the shell.
 verts=[]
 for z,width in ((-43.98,7.2),(-8.74,8.8)):
  for dx,dy in ((-1,-1),(1,-1),(1,1),(-1,1)):
   verts.append((x+dx*width/2,y+dy*width/2,z))
 faces=[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
 mesh=bpy.data.meshes.new('Stocky tapered leg');mesh.from_pydata(verts,[],faces);mesh.update()
 o=bpy.data.objects.new('table_leg_championship',mesh);bpy.context.collection.objects.link(o);mesh.materials.append(wood);wood_uv(o)
 bevel=o.modifiers.new('Rounded furniture edges','BEVEL');bevel.width=.38;bevel.segments=3
 o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
 return o

for x in (-58,58):
 for y in (-32,32):leg(x,y)

for side in (-1,1):
 y=side*37.15
 # Deepened fascia below the existing side wall, leaving every rod opening clear.
 fascia=box('champ_fascia',(0,y,-7.1),(115,.35,11.7),wood,.20);wood_uv(fascia)
 box('champ_lower_gold',(0,side*37.39,-12.65),(114,.16,.18),gold,.035)
 box('champ_upper_gold',(0,side*37.39,-1.65),(114,.16,.14),gold,.025)
 for s in (-1,1):
  # A dark set-back well, raised oxblood bevel and gold rim read as a
  # framed inset rather than a thin graphic painted onto the wood.
  outer=[(s*9,-2.8),(s*22,-2.8),(s*27,-4.1),(s*52.7,-4.1),(s*52.7,-11.3),(s*23,-11.3)]
  inner=[(s*13,-3.7),(s*21.3,-3.7),(s*26.7,-5.0),(s*51.7,-5.0),(s*51.7,-10.3),(s*23.8,-10.3)]
  panel('champ_panel_recess',outer,side*37.40,.18,inset)
  outline('champ_panel_bevel',outer,side*37.59,.20,red)
  outline('champ_panel_rim',outer,side*37.76,.095,gold)
  panel('champ_inner_panel',inner,side*37.54,.10,black)
  outline('champ_inner_rim',inner,side*37.65,.075,edge)
  for k in range(7):
   x=s*(31+k*2.7);line('champ_inset_etch',(x,side*37.64,-9.7),(x+s*1.7,side*37.64,-5.5),.038,edge)
 # Layered badge and crown sit below rods, centered on the long face.
 outer=[(-5.0,-2.4),(5,-2.4),(4.5,-9.0),(0,-12.6),(-4.5,-9.0)]
 inner=[(-4.1,-3.1),(4.1,-3.1),(3.6,-8.5),(0,-11.4),(-3.6,-8.5)]
 panel('champ_badge_shadow',outer,side*37.55,.28,inset)
 panel('champ_badge_gold',outer,side*37.75,.28,gold)
 panel('champ_badge_enamel',inner,side*37.96,.18,red)
 outline('champ_badge_border',inner,side*38.10,.13,edge)
 # A raised gold medallion bezel and stitched football: five small outer
 # patches and seam lines make it recognisable at normal viewing distance.
 bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=16,location=(0,side*38.17,-6.8));ball=bpy.context.object;ball.name='champ_badge_bezel';ball.scale=(2.55,.22,2.55);ball.data.materials.append(gold)
 bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=16,location=(0,side*38.37,-6.8));ball=bpy.context.object;ball.name='champ_badge_ball';ball.scale=(2.10,.18,2.10);ball.data.materials.append(ivory)
 pent=[(.68*math.sin(2*math.pi*i/5),-6.8+.68*math.cos(2*math.pi*i/5)) for i in range(5)]
 panel('champ_ball_pentagon',pent,side*38.57,.05,inset)
 for i in range(5):
  a=2*math.pi*i/5; cx=1.53*math.sin(a);cz=-6.8+1.53*math.cos(a)
  patch=[(cx+.34*math.sin(a+2*math.pi*j/5),cz+.34*math.cos(a+2*math.pi*j/5)) for j in range(5)]
  panel('champ_ball_patch',patch,side*38.57,.045,inset)
  line('champ_ball_stitch',(pent[i][0],side*38.60,pent[i][1]),(cx,side*38.60,cz),.035,edge)
 crown=[(-3.6,-2.0),(-3.9,.45),(-2.1,-.45),(-1.5,1.8),(0,.3),(1.5,1.8),(2.1,-.45),(3.9,.45),(3.6,-2.0)]
 panel('champ_crown',crown,side*37.89,.28,gold)
 line('champ_crown_band',(-3.4,side*38.10,-1.55),(3.4,side*38.10,-1.55),.15,edge)
 for x in (-2.5,0,2.5):
  bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=.23,location=(x,side*38.18,-1.22));bpy.context.object.name='champ_crown_jewel';bpy.context.object.data.materials.append(red)
 # Short laurel branches sit on the wood, framing rather than obscuring it.
 for s in (-1,1):
  line('champ_laurel_stem',(s*5.1,side*37.58,-11.7),(s*8.2,side*37.58,-3.9),.065,edge)
  for k in range(4):
   x=s*(5.6+.72*k); z=-10.7+1.65*k
   leaf=[(x,z),(x+s*1.3,z+.45),(x+s*1.5,z+1.0),(x+s*.45,z+.75)]
   panel('champ_laurel_leaf',leaf,side*37.63,.10,gold)
 # Thin warm line set under the outside edge of the top rail, below the playing surface.
 box('champ_rail_light',(0,side*33.97,10.0),(112,.13,.17),light,.03)
# Fine rounded metal piping follows the outer top edge, including the four
# curved corners. Stop at the goal openings rather than spanning them.
for side in (-1,1):
 z=11.03
 line('champ_outer_trim',(-60.975,side*36.98,z),(60.975,side*36.98,z),.13,gold)
 for end in (-1,1):
  line('champ_outer_trim',(end*62.98,side*11.15,z),(end*62.98,side*35.0,z),.13,gold)
  # The original mesh's outer top boundary: its corner has a radius of
  # about two units, centred on (60.975,35), not (60,34).
  corner=[(62.975,35.0),(62.877,35.618),(62.593,36.176),
          (62.151,36.618),(61.593,36.902),(60.975,37.0)]
  points=[(end*x,side*y,z) for x,y in corner]
  for a,b in zip(points,points[1:]):line('champ_outer_trim_curve',a,b,.13,gold)
for x in (-58,58):
 for y in (-32,32):
  box('champ_foot_shadow',(x,y,-41.7),(7.55,7.55,1.65),black,.20)
  box('champ_foot_cuff',(x,y,-41.0),(7.62,7.62,.32),gold,.10)
  box('champ_foot_cuff',(x,y,-42.35),(7.62,7.62,.20),edge,.07)
# Batch static additions by material; keep source meshes separate for game hooks.
for material in (black,rail,wood,gold,edge,red,inset,light,ivory):
 parts=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.name.startswith('champ_') and len(o.data.materials)==1 and o.data.materials[0]==material]
 if not parts: continue
 bpy.ops.object.select_all(action='DESELECT')
 for o in parts:
  bpy.context.view_layer.objects.active=o; o.select_set(True)
  for mod in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=mod.name)
 bpy.context.view_layer.objects.active=parts[0]; bpy.ops.object.join(); parts[0].name='champ_detail_'+material.name.split('|')[-1].strip()
# Preserve all source parts, retaining names used by the loader and goal animation.
bpy.ops.export_scene.gltf(filepath=OUT,export_format='GLB',export_apply=True)
print('BUILT',OUT,flush=True)
