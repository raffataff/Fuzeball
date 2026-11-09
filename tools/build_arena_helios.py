import bpy, math, os, bmesh
from mathutils import Vector
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR=os.path.join(ROOT,'assets','tables','arena'); MAP=os.path.join(DIR,'helios_runners')
keep=('arena_bowl','goal_frame','goal_net','off_led_ring','table_leg_')
for o in list(bpy.context.scene.objects):
 if o.type!='MESH' or not o.name.startswith(keep): bpy.data.objects.remove(o,do_unlink=True)

def solid(name,c,metal=0,rough=.4):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough;return m

def textured(name,kind):
 m=solid(name,(1,1,1),1,1);n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF')
 def tex(s,non=False):
  t=n.new('ShaderNodeTexImage'); t.image=bpy.data.images.load(os.path.join(MAP,kind+'_'+s+'.png'),check_existing=True);t.extension='REPEAT'
  if non:t.image.colorspace_settings.name='Non-Color'
  return t
 c=tex('basecolor');l.new(c.outputs['Color'],p.inputs['Base Color'])
 mr=tex('orm',True); sep=n.new('ShaderNodeSeparateColor');l.new(mr.outputs['Color'],sep.inputs[0]);l.new(sep.outputs['Green'],p.inputs['Roughness']);l.new(sep.outputs['Blue'],p.inputs['Metallic'])
 normal=tex('normal',True);nm=n.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.35;l.new(normal.outputs['Color'],nm.inputs['Color']);l.new(nm.outputs['Normal'],p.inputs['Normal'])
 return m
fascia=textured('Helios | printed enamel','fascia');brace=textured('Helios | solar system brace','brace');inner=textured('Helios | inner racing stripes','inner');stand=textured('Helios | painted stand','stand');leg=textured('Helios | racing leg decals','leg')
black=solid('Helios | satin black rail',(.014,.014,.014),.18,.3);cream=solid('Helios | warm ivory',(.72,.48,.27),.08,.4); gold=solid('Helios | anodized gold',(.55,.25,.035),.75,.27);dark=solid('Helios | black hardware',(.02,.019,.018),.55,.32); led=solid('Helios | ivory diffuser',(.8,.5,.22),.05,.3)
def fascia_u(a):
 # One livery per long side. Map only the matching blank margins
 # around goal ends; keep a small nonzero U span for normal-map tangents.
 turns=math.floor(a); t=a-turns
 if t<.125: u=.16*t
 elif t<.375: u=.02+(t-.125)*3.84
 elif t<.625: u=.98+(t-.375)*.16
 elif t<.875: u=1.02+(t-.625)*3.84
 else: u=1.98+(t-.875)*.16
 return u+turns*2
for o in list(bpy.context.scene.objects):
 if o.name.startswith('arena_bowl'):
  while o.data.uv_layers:o.data.uv_layers.remove(o.data.uv_layers[0])
  uv=o.data.uv_layers.new(name='HeliosWrap')
  for face in o.data.polygons:
   pts=[o.data.vertices[o.data.loops[i].vertex_index].co for i in face.loop_indices]
   aa=[math.atan2(p.y/41,p.x/72)/(2*math.pi)+.5 for p in pts]
   if max(aa)-min(aa)>.5:aa=[a+1 if a<.5 else a for a in aa]
   for li,p,a in zip(face.loop_indices,pts,aa):
    v=p.z/9.94 if face.material_index in (0,1) else (p.z+2.91)/13.22
    uv.data[li].uv=(fascia_u(a) if face.material_index==2 else a*4+.5,v)
  materials={'Worn timber ramp':inner,'Inner enamel':inner,'Club fascia':fascia,'Aged hardware':gold,'Dark hardware':dark,'Dark inserts':black,'Existing lip diffuser':led}
  for slot in o.material_slots:slot.material=materials.get(slot.material.name,black)
 elif o.name.startswith('table_leg_'):
  bm=bmesh.new();bm.from_mesh(o.data);seen=set();dup=[]
  for face in bm.faces:
   key=(face.material_index,tuple(sorted(tuple(round(c,5) for c in v.co) for v in face.verts)))
   if key in seen:dup.append(face)
   else:seen.add(key)
  bmesh.ops.delete(bm,geom=dup,context='FACES_ONLY');bm.to_mesh(o.data);bm.free()
  while o.data.uv_layers:o.data.uv_layers.remove(o.data.uv_layers[0])
  uv=o.data.uv_layers.new(name='HeliosStand')
  for face in o.data.polygons:
   pts=[o.data.vertices[o.data.loops[i].vertex_index].co for i in face.loop_indices];center=sum(pts,Vector())/len(pts)
   extent=[max(p[k] for p in pts)-min(p[k] for p in pts) for k in range(3)]
   for li,p in zip(face.loop_indices,pts):
    if extent[0]>30 and abs(face.normal.y)>.9: u,v=(p.x+45.19)/90.38,(p.z+34.15)/12.34
    elif extent[0]>30: u,v=(p.x+56)/112,(p.z+46)/44
    elif extent[1]>20: u,v=(p.y+30)/60,(p.z+46)/44
    else:
     sign=1 if center.x>=0 else -1
     across=p.y if abs(face.normal.x)>abs(face.normal.y) else p.x+sign*.5*p.z
     mid=(1 if center.y>=0 else -1)*25 if abs(face.normal.x)>abs(face.normal.y) else sign*50
     u,v=(across-mid)/20+.5,(p.z+46)/44
    uv.data[li].uv=(u,v)
  for slot in o.material_slots:slot.material=stand if 'Timber' in slot.material.name else gold if 'Aged' in slot.material.name else dark
  o.data.materials.append(leg);leg_index=len(o.data.materials)-1
  o.data.materials.append(brace);brace_index=len(o.data.materials)-1
  for face in o.data.polygons:
   pts=[o.data.vertices[o.data.loops[i].vertex_index].co for i in face.loop_indices]; center=sum(pts,Vector())/len(pts)
   extent=[max(p[k] for p in pts)-min(p[k] for p in pts) for k in range(3)]
   if o.material_slots[face.material_index].material==stand and extent[0]>30 and abs(face.normal.y)>.9: face.material_index=brace_index
   elif o.material_slots[face.material_index].material==stand and abs(center.x)>28 and center.z<-8 and extent[0]<30 and extent[1]<20: face.material_index=leg_index
 elif o.name.startswith('goal_frame'):
  for s in o.material_slots:s.material=gold
 elif o.name.startswith('off_led_ring'):
  for s in o.material_slots:s.material=led
# Export only actual game parts; preserve arena_bowl and goal_frame prefixes.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.join(DIR,'fuzeball_table_arena_helios.glb'),export_format='GLB',use_selection=True,export_apply=False)
